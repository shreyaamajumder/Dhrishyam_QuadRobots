"""The harness as one LangGraph graph with shared state (PRD 6.1, TRD 5.2).

Current graph:

    intake_guard -> deterministic_baseline -> orchestrator -> END
          |                    |
       blocked           AI cannot run
          v                    v
         END                  END

Still to add after the orchestrator: specialists in parallel (Send), aggregate, critic
with a bounded loop back to the orchestrator, citation gate and corrector.

Things that cannot live in graph state (the library, the LLM client and the event sender)
are captured when the graph is built, so the state stays plain data.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from harness.deterministic import (
    BaselineResult,
    IntakeResult,
    run_deterministic_baseline,
    run_intake_guard,
)
from harness.library import LibraryRepo
from harness.llm import LLMClient, LLMDisabled, LLMNotConfigured, LLMUnavailable
from harness.orchestrator import InvestigationPlan, run_orchestrator
from harness.schemas import RunContext, RunEventType

SendEvent = Callable[..., Awaitable[None]]

AI_NOT_SET_UP = "AI review is not set up, so only rule-based checks were run."
AI_TURNED_OFF = "AI review is turned off, so only rule-based checks were run."
AI_NOT_CONFIGURED = "AI review is not configured, so only rule-based checks were run."
AI_UNAVAILABLE = "AI review was unavailable, so only rule-based checks were run."
ENGLISH_ONLY = "This version supports English only, so only rule-based checks were run."
SPECIALISTS_PENDING = (
    "An investigation plan was made, but the AI specialists are not connected yet, "
    "so only rule-based findings are shown."
)


class BrandGuardState(TypedDict, total=False):
    """Shared state for one run (PRD 6.1.7). Fields are added as nodes are built."""

    draft: str
    content_type: str
    audience: Optional[str]
    intake: IntakeResult
    baseline: BaselineResult
    investigation_plan: Optional[InvestigationPlan]
    llm_calls: List[Dict[str, Any]]
    prompt_versions: List[str]
    iteration_count: int
    degraded_reason: Optional[str]


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
            "degraded_reason": SPECIALISTS_PENDING,
        }

    def after_intake(state: BrandGuardState) -> str:
        return "deterministic_baseline" if state["intake"].allowed else END

    def after_baseline(state: BrandGuardState) -> str:
        return "orchestrator" if _ai_skip_reason(state, llm) is None else "rule_based_only"

    async def rule_based_only(state: BrandGuardState) -> BrandGuardState:
        return {"degraded_reason": _ai_skip_reason(state, llm)}

    graph = StateGraph(BrandGuardState)
    graph.add_node("intake_guard", intake_guard)
    graph.add_node("deterministic_baseline", deterministic_baseline)
    graph.add_node("orchestrator", orchestrator)
    graph.add_node("rule_based_only", rule_based_only)
    graph.add_edge(START, "intake_guard")
    graph.add_conditional_edges("intake_guard", after_intake, ["deterministic_baseline", END])
    graph.add_conditional_edges(
        "deterministic_baseline", after_baseline, ["orchestrator", "rule_based_only"]
    )
    graph.add_edge("orchestrator", END)
    graph.add_edge("rule_based_only", END)
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
