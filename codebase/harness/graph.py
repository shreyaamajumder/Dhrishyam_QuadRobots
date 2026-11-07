"""The harness as one LangGraph graph with shared state (PRD 6.1, TRD 5.2).

Current graph:

    intake_guard -> deterministic_baseline -> orchestrator -> specialists (in parallel) -> aggregate -> END
          |                    |                   |                                       ^
       blocked           AI cannot run        no tasks, or the model failed ---------------|
          v                    v                                                           |
         END            rule_based_only -----------------------------------------------------

Still to add: the critic, with a bounded loop back to the orchestrator for re-investigation,
and the corrector. Until the critic exists, AI findings are "needs_human_verification".

Things that cannot live in graph state (the library, the LLM client and the event sender)
are captured when the graph is built, so the state stays plain data.
"""

from __future__ import annotations

import operator
from typing import Any, Awaitable, Callable, Dict, List, Optional

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from typing_extensions import Annotated, TypedDict

from harness.aggregate import aggregate_findings
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
from harness.specialists import MAX_TOOL_CALLS, SpecialistOutcome, run_specialist

SendEvent = Callable[..., Awaitable[None]]

AI_NOT_SET_UP = "AI review is not set up, so only rule-based checks were run."
AI_TURNED_OFF = "AI review is turned off, so only rule-based checks were run."
AI_NOT_CONFIGURED = "AI review is not configured, so only rule-based checks were run."
AI_UNAVAILABLE = "AI review was unavailable, so only rule-based checks were run."
ENGLISH_ONLY = "This version supports English only, so only rule-based checks were run."
CRITIC_PENDING = (
    "AI findings have not been checked by the critic yet, so they are marked as needing "
    "human verification."
)


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


def _tool_counts(baseline: BaselineResult) -> Dict[str, int]:
    counts = {tool: 0 for tool in baseline.checks.tools}
    for finding in baseline.findings:
        for name in finding.produced_by:
            if name in counts:
                counts[name] += 1
    counts["detect_claim_patterns"] = len(baseline.claim_candidates)
    return counts


def build_graph(
    ctx: RunContext, library: LibraryRepo, llm: Optional[LLMClient], send: SendEvent
) -> Any:
    """Compile the graph for one run."""

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
            llm, payload["budget"],
        )
        for call in outcome.tool_calls:
            await send(RunEventType.TOOL_CALLED, name, **call)
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

    async def aggregate(state: BrandGuardState) -> BrandGuardState:
        baseline = state["baseline"]
        results = state.get("specialist_results") or []
        ai_findings = [finding for result in results for finding in result.findings]
        findings, notes = aggregate_findings(baseline.findings, ai_findings)
        update: BrandGuardState = {
            "findings": findings,
            "ai_rejected": [item for result in results for item in result.rejected],
            "aggregate_notes": notes + [note for result in results for note in result.notes],
        }

        if state.get("degraded_reason"):  # the AI stage never ran
            update["mode"] = RunMode.DETERMINISTIC_ONLY
            return update
        succeeded = [result for result in results if result.succeeded]
        failed = [result.specialist for result in results if not result.succeeded]
        if results and not succeeded:
            update["mode"] = RunMode.DETERMINISTIC_ONLY
            update["degraded_reason"] = AI_UNAVAILABLE
            return update
        update["mode"] = RunMode.FULL
        reasons = []
        if failed:
            reasons.append(partly_unavailable(failed))
        if succeeded:
            reasons.append(CRITIC_PENDING)
        update["degraded_reason"] = " ".join(reasons) or None
        return update

    def after_intake(state: BrandGuardState) -> str:
        if state["intake"].allowed:
            return "deterministic_baseline"
        return END

    def after_baseline(state: BrandGuardState) -> str:
        return "orchestrator" if _ai_skip_reason(state, llm) is None else "rule_based_only"

    def after_plan(state: BrandGuardState) -> Any:
        plan = state.get("investigation_plan")
        if plan is None:
            return "aggregate"
        assigned = [name for name in SPECIALISTS if plan.tasks_for(name)]
        if not assigned:
            return "aggregate"
        budget = max(1, MAX_TOOL_CALLS // len(assigned))
        return [
            Send("specialist", {"specialist": name, "tasks": plan.tasks_for(name),
                                "intent": plan.intent, "budget": budget,
                                "baseline": state["baseline"]})
            for name in assigned
        ]

    graph = StateGraph(BrandGuardState)
    graph.add_node("intake_guard", intake_guard)
    graph.add_node("deterministic_baseline", deterministic_baseline)
    graph.add_node("rule_based_only", rule_based_only)
    graph.add_node("orchestrator", orchestrator)
    graph.add_node("specialist", specialist)
    graph.add_node("aggregate", aggregate)
    graph.add_edge(START, "intake_guard")
    graph.add_conditional_edges("intake_guard", after_intake, ["deterministic_baseline", END])
    graph.add_conditional_edges(
        "deterministic_baseline", after_baseline, ["orchestrator", "rule_based_only"]
    )
    graph.add_conditional_edges("orchestrator", after_plan, ["specialist", "aggregate"])
    graph.add_edge("specialist", "aggregate")
    graph.add_edge("rule_based_only", "aggregate")
    graph.add_edge("aggregate", END)
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
