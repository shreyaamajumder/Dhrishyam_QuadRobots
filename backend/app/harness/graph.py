"""The harness as one LangGraph graph with shared state (PRD 6.1, TRD 5.2).

    intake_guard -> deterministic_baseline -> orchestrator -> specialists (parallel) -> critic -> aggregate -> corrector -> END
         |                    |                    |               ^                     |          ^
      blocked           AI cannot run          no tasks or         +-- re-investigate ---+          |
         v                    v               model failed            (bounded)                     |
        END            rule_based_only ----------------+------------------------------------------>+

The loop is bounded three ways: MAX_ITERATIONS rounds, MAX_TOOL_CALLS searches and a time
budget. When any runs out, open candidates become "needs_human_verification" (PRD 6.1.5).

The corrector proposes a checked, minimal fix for each confirmed finding without one. It
runs only when AI review ran; it never changes the draft.

Things that cannot live in graph state (the library, the LLM client and the event sender)
are captured when the graph is built, so the state stays plain data.
"""

from __future__ import annotations

import operator
import time
from collections import defaultdict
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from typing_extensions import Annotated, TypedDict

from harness.aggregate import aggregate_findings
from harness.corrector import run_corrector
from harness.critic import (
    MAX_ITERATIONS,
    ReinvestigationRequest,
    ReviewCandidate,
    run_critic,
)
from harness.deterministic import (
    BaselineResult,
    IntakeResult,
    run_deterministic_baseline,
    run_intake_guard,
)
from harness.library import LibraryRepo
from harness.llm import LLMClient, LLMDisabled, LLMNotConfigured, LLMUnavailable
from harness.orchestrator import SPECIALISTS, InvestigationPlan, InvestigationTask, run_orchestrator
from harness.schemas import Finding, RejectedFinding, RunContext, RunEventType, RunMode
from harness.specialists import (
    MAX_TOOL_CALLS,
    SpecialistOutcome,
    run_specialist,
    searches_needed,
)

SendEvent = Callable[..., Awaitable[None]]
REINVESTIGATION_DEADLINE_SECONDS = 25.0  # no new round starts after this (TRD 5.2 budget)

AI_NOT_SET_UP = "AI review is not set up, so only rule-based checks were run."
AI_TURNED_OFF = "AI review is turned off, so only rule-based checks were run."
AI_NOT_CONFIGURED = "AI review is not configured, so only rule-based checks were run."
AI_UNAVAILABLE = "AI review was unavailable, so only rule-based checks were run."
ENGLISH_ONLY = "This version supports English only, so only rule-based checks were run."
CRITIC_UNAVAILABLE = (
    "The critic was unavailable, so AI findings are marked as needing human verification."
)
CORRECTOR_UNAVAILABLE = "Suggested fixes were unavailable for this run."


def partly_unavailable(specialists: List[str]) -> str:
    names = ", ".join(name.replace("_", " ") for name in specialists)
    return f"Some AI checks were unavailable ({names}), so those passages have rule-based results only."


class BrandGuardState(TypedDict, total=False):
    """Shared state for one run (PRD 6.1.7)."""

    draft: str
    content_type: str
    audience: Optional[str]
    intake: IntakeResult
    baseline: BaselineResult
    investigation_plan: Optional[InvestigationPlan]
    specialist_results: Annotated[List[SpecialistOutcome], operator.add]
    verified_findings: Annotated[List[Finding], operator.add]
    critic_rejected: Annotated[List[RejectedFinding], operator.add]
    critic_verdicts: Annotated[List[Dict[str, Any]], operator.add]
    critic_notes: Annotated[List[str], operator.add]
    critic_failed: bool
    reinvestigation_requests: List[ReinvestigationRequest]
    llm_calls: Annotated[List[Dict[str, Any]], operator.add]
    prompt_versions: Annotated[List[str], operator.add]
    iteration_count: int
    findings: List[Finding]
    ai_rejected: List[RejectedFinding]
    aggregate_notes: List[str]
    mode: RunMode
    degraded_reason: Optional[str]


class SpecialistInput(TypedDict):
    specialist: str
    tasks: List[InvestigationTask]
    intent: str
    budget: int
    baseline: BaselineResult
    iteration: int
    extra_queries: Dict[str, str]


def _tool_counts(baseline: BaselineResult) -> Dict[str, int]:
    counts = {tool: 0 for tool in baseline.checks.tools}
    for finding in baseline.findings:
        for name in finding.produced_by:
            if name in counts:
                counts[name] += 1
    counts["detect_claim_patterns"] = len(baseline.claim_candidates)
    return counts


def _searches_used(state: BrandGuardState) -> int:
    return sum(len(result.tool_calls) for result in state.get("specialist_results") or [])


def allocate_searches(needs: Dict[str, int], available: int) -> Dict[str, int]:
    """Give each specialist the searches it needs; if they do not fit, share in proportion."""
    total = sum(needs.values())
    if total <= available:
        return dict(needs)
    return {name: max(1, available * need // total) for name, need in needs.items()}


def build_graph(
    ctx: RunContext,
    library: LibraryRepo,
    llm: Optional[LLMClient],
    send: SendEvent,
    *,
    reinvestigation_deadline: float = REINVESTIGATION_DEADLINE_SECONDS,
) -> Any:
    """Compile the graph for one run."""
    started = time.monotonic()

    async def intake_guard(state: BrandGuardState) -> BrandGuardState:
        return {"intake": run_intake_guard(state["draft"], library)}

    async def deterministic_baseline(state: BrandGuardState) -> BrandGuardState:
        baseline = run_deterministic_baseline(state["draft"], library, state["intake"])
        for tool, matches in _tool_counts(baseline).items():
            await send(RunEventType.TOOL_CALLED, "deterministic_baseline", tool=tool, matches=matches)
        for rejected in baseline.rejected:
            await send(RunEventType.GATE_REJECTED, f"{rejected.gate}_gate", **rejected.model_dump())
        return {"baseline": baseline}

    async def rule_based_only(state: BrandGuardState) -> BrandGuardState:
        return {"degraded_reason": _ai_skip_reason(state, llm)}

    async def orchestrator(state: BrandGuardState) -> BrandGuardState:
        try:
            plan, call = await run_orchestrator(
                llm, ctx, library, state["intake"], state["baseline"]
            )
        except LLMUnavailable as error:
            reason = AI_UNAVAILABLE
            if isinstance(error, LLMDisabled):
                reason = AI_TURNED_OFF
            elif isinstance(error, LLMNotConfigured):
                reason = AI_NOT_CONFIGURED
            calls = [error.call.as_step_data()] if error.call and error.call.attempts else []
            return {"investigation_plan": None, "degraded_reason": reason, "llm_calls": calls}

        await send(
            RunEventType.PLAN_CREATED,
            "orchestrator",
            intent=plan.intent,
            audience=plan.audience,
            tasks=plan.tasks,
            skipped=plan.skipped,
            notes=plan.notes,
            llm_call=call.as_step_data(),
        )
        return {
            "investigation_plan": plan,
            "llm_calls": [call.as_step_data()],
            "prompt_versions": [call.prompt_version] if call.prompt_version else [],
            "iteration_count": 1,
        }

    async def specialist(payload: SpecialistInput) -> BrandGuardState:
        name = payload["specialist"]
        outcome = await run_specialist(
            name, payload["tasks"], ctx, library, payload["baseline"], payload["intent"],
            llm, payload["budget"], extra_queries=payload["extra_queries"],
            iteration=payload["iteration"],
        )
        for call in outcome.tool_calls:
            await send(RunEventType.TOOL_CALLED, name, iteration=outcome.iteration, **call)
        for gap in outcome.evidence_gaps:
            await send(RunEventType.EVIDENCE_GAP, name, **gap.model_dump())
        for rejected in outcome.rejected:
            await send(RunEventType.GATE_REJECTED, f"{rejected.gate}_gate", specialist=name,
                       **rejected.model_dump())
        return {
            "specialist_results": [outcome],
            "llm_calls": [outcome.llm_call] if outcome.llm_call else [],
            "prompt_versions": [outcome.prompt_version] if outcome.prompt_version else [],
        }

    async def critic(state: BrandGuardState) -> BrandGuardState:
        iteration = state.get("iteration_count", 1)
        plan = state["investigation_plan"]
        current = [r for r in state.get("specialist_results") or [] if r.iteration == iteration]
        update: BrandGuardState = {"reinvestigation_requests": [], "critic_notes": []}

        # A follow-up that failed, or never answered its task, keeps the original candidate.
        fallbacks: List[Finding] = []
        for request in state.get("reinvestigation_requests") or []:
            answered = any(
                r.specialist == request.specialist and r.succeeded
                and request.task.task_id in r.assessed_task_ids
                for r in current
            )
            if not answered:
                fallbacks.append(request.fallback)
                update["critic_notes"].append(
                    f'The follow-up on "{request.span_text}" produced no new answer, so the '
                    "earlier finding is kept as needing human verification.")

        candidates = []
        gaps: Dict[Tuple[str, str], List[str]] = defaultdict(list)
        for result in current:
            for finding, task_id in zip(result.findings, result.task_ids):
                candidates.append(ReviewCandidate(
                    candidate_id=f"c{len(candidates) + 1}", specialist=result.specialist,
                    task_id=task_id, finding=finding))
            for gap in result.evidence_gaps:
                gaps[(result.specialist, gap.task_id)].append(
                    f"{gap.description} (suggested search: {gap.search_query})")
        tasks = {(task.specialist, task.task_id): task for task in plan.tasks}
        can_reinvestigate = (
            iteration < MAX_ITERATIONS
            and _searches_used(state) < MAX_TOOL_CALLS
            and time.monotonic() - started < reinvestigation_deadline
        )

        outcome = await run_critic(llm, candidates, gaps, tasks, ctx, state["intake"], library,
                                   iteration, can_reinvestigate)
        for verdict in outcome.verdicts:
            await send(RunEventType.CRITIC_VERDICT, "critic", iteration=iteration, **verdict)
        for rejected in outcome.rejected:
            await send(RunEventType.GATE_REJECTED, "critic_gate", **rejected.model_dump())
        for request in outcome.requests:
            await send(RunEventType.REINVESTIGATION_REQUESTED, "critic", iteration=iteration,
                       specialist=request.specialist, task_id=request.task.task_id,
                       span_text=request.span_text, question=request.question,
                       search_query=request.search_query)

        update.update({
            "verified_findings": fallbacks + outcome.verified,
            "critic_rejected": outcome.rejected,
            "critic_verdicts": outcome.verdicts,
            "critic_notes": update["critic_notes"] + outcome.notes,
            "reinvestigation_requests": outcome.requests,
            "llm_calls": [outcome.llm_call] if outcome.llm_call else [],
            "prompt_versions": [outcome.prompt_version] if outcome.llm_call else [],
        })
        if outcome.failed:
            update["critic_failed"] = True
        if outcome.requests:
            update["iteration_count"] = iteration + 1
        return update

    async def aggregate(state: BrandGuardState) -> BrandGuardState:
        baseline = state["baseline"]
        results = state.get("specialist_results") or []
        findings, notes = aggregate_findings(
            baseline.findings, state.get("verified_findings") or [],
            [claim for r in results for claim in r.supported_claims])
        update: BrandGuardState = {
            "findings": findings,
            "ai_rejected": [item for r in results for item in r.rejected]
            + (state.get("critic_rejected") or []),
            "aggregate_notes": (state.get("critic_notes") or []) + notes
            + [note for r in results for note in r.notes],
        }

        if state.get("degraded_reason"):  # the AI stage never ran
            update["mode"] = RunMode.DETERMINISTIC_ONLY
            return update
        first_round = [r for r in results if r.iteration == 1]
        succeeded = [r for r in first_round if r.succeeded]
        failed = [r.specialist for r in first_round if not r.succeeded]
        if first_round and not succeeded:
            update["mode"] = RunMode.DETERMINISTIC_ONLY
            update["degraded_reason"] = AI_UNAVAILABLE
            return update
        update["mode"] = RunMode.FULL
        reasons = []
        if failed:
            reasons.append(partly_unavailable(failed))
        if state.get("critic_failed"):
            reasons.append(CRITIC_UNAVAILABLE)
        update["degraded_reason"] = " ".join(reasons) or None
        return update

    async def corrector(state: BrandGuardState) -> BrandGuardState:
        if llm is None or state.get("mode") is not RunMode.FULL:
            return {}
        plan = state.get("investigation_plan")
        outcome = await run_corrector(llm, state["findings"], ctx, state["intake"],
                                      plan.intent if plan else "", library)
        for suggestion in outcome.suggested:
            await send(RunEventType.TOOL_CALLED, "corrector", tool="make_diff", **suggestion)
        update: BrandGuardState = {
            "findings": outcome.findings,
            "aggregate_notes": (state.get("aggregate_notes") or []) + outcome.notes,
            "llm_calls": [outcome.llm_call] if outcome.llm_call else [],
            "prompt_versions": [outcome.prompt_version] if outcome.llm_call else [],
        }
        if outcome.failed:
            reasons = [state.get("degraded_reason"), CORRECTOR_UNAVAILABLE]
            update["degraded_reason"] = " ".join(r for r in reasons if r)
        return update

    def after_intake(state: BrandGuardState) -> str:
        return "deterministic_baseline" if state["intake"].allowed else END

    def after_baseline(state: BrandGuardState) -> str:
        return "orchestrator" if _ai_skip_reason(state, llm) is None else "rule_based_only"

    def after_plan(state: BrandGuardState) -> Any:
        plan = state.get("investigation_plan")
        if plan is None:
            return "aggregate"
        assigned = [name for name in SPECIALISTS if plan.tasks_for(name)]
        if not assigned:
            return "aggregate"
        budgets = allocate_searches(
            {name: searches_needed(name, plan.tasks_for(name)) for name in assigned}, MAX_TOOL_CALLS)
        return [
            Send("specialist", {
                "specialist": name, "tasks": plan.tasks_for(name), "intent": plan.intent,
                "budget": budgets[name], "baseline": state["baseline"], "iteration": 1,
                "extra_queries": {},
            })
            for name in assigned
        ]

    def after_critic(state: BrandGuardState) -> Any:
        requests = state.get("reinvestigation_requests") or []
        if not requests:
            return "aggregate"
        by_specialist: Dict[str, List[ReinvestigationRequest]] = defaultdict(list)
        for request in requests:
            by_specialist[request.specialist].append(request)
        plan = state["investigation_plan"]
        queries = {
            name: {r.task.task_id: r.search_query for r in group if r.search_query}
            for name, group in by_specialist.items()
        }
        budgets = allocate_searches(
            {name: searches_needed(name, [r.task for r in group], queries[name])
             for name, group in by_specialist.items()},
            max(1, MAX_TOOL_CALLS - _searches_used(state)),
        )
        return [
            Send("specialist", {
                "specialist": name,
                "tasks": [request.task for request in group],
                "intent": plan.intent,
                "budget": budgets[name],
                "baseline": state["baseline"],
                "iteration": state["iteration_count"],
                "extra_queries": queries[name],
            })
            for name, group in by_specialist.items()
        ]

    graph = StateGraph(BrandGuardState)
    graph.add_node("intake_guard", intake_guard)
    graph.add_node("deterministic_baseline", deterministic_baseline)
    graph.add_node("rule_based_only", rule_based_only)
    graph.add_node("orchestrator", orchestrator)
    graph.add_node("specialist", specialist)
    graph.add_node("critic", critic)
    graph.add_node("aggregate", aggregate)
    graph.add_node("corrector", corrector)
    graph.add_edge(START, "intake_guard")
    graph.add_conditional_edges("intake_guard", after_intake, ["deterministic_baseline", END])
    graph.add_conditional_edges(
        "deterministic_baseline", after_baseline, ["orchestrator", "rule_based_only"]
    )
    graph.add_conditional_edges("orchestrator", after_plan, ["specialist", "aggregate"])
    graph.add_edge("specialist", "critic")
    graph.add_conditional_edges("critic", after_critic, ["specialist", "aggregate"])
    graph.add_edge("rule_based_only", "aggregate")
    graph.add_edge("aggregate", "corrector")
    graph.add_edge("corrector", END)
    return graph.compile()


def _ai_skip_reason(state: BrandGuardState, llm: Optional[LLMClient]) -> Optional[str]:
    """Why the AI stage will not run, or None if it should."""
    if not state["intake"].english_supported:
        return ENGLISH_ONLY
    if llm is None:
        return AI_NOT_SET_UP
    if not llm.settings.enabled:
        return AI_TURNED_OFF
    if llm.unavailable_reason() is not None:
        return AI_NOT_CONFIGURED
    return None
