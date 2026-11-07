"""The single entry point between the backend and the harness (TRD Section 3, Flow B).

run_brand_check runs the harness graph (harness/graph.py), streams every step as a
RunEvent, and returns a gated HarnessResult: rule-based findings merged with the
specialists' AI findings. Whenever the LLM is off or unavailable, the run falls back to
rule-based findings ("deterministic_only") and says why in degraded_reason.

The backend uses it like this:

    run_brand_check = build_run_brand_check(library_for_org=postgres_library_for_org,
                                            llm=LLMClient.from_env())
    result = await run_brand_check(ctx, emit)

Try it from the command line, using the demo brand kit:

    python -m harness.runner draft.txt            # rule-based only
    python -m harness.runner draft.txt --llm      # with the orchestrator (needs OPENAI_API_KEY)
    echo "India's #1 AI-powered platform" | python -m harness.runner -
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union
from uuid import UUID, uuid4

from harness.deterministic import IntakeBlockCode, IntakeResult
from harness.graph import (  # noqa: F401  (reasons re-exported for the backend and tests)
    AI_NOT_CONFIGURED,
    AI_NOT_SET_UP,
    AI_TURNED_OFF,
    AI_UNAVAILABLE,
    CRITIC_PENDING,
    ENGLISH_ONLY,
    build_graph,
)
from harness.library import LibraryRepo
from harness.llm import LLMClient
from harness.schemas import (
    EmitEvent,
    HarnessResult,
    RunBrandCheck,
    RunContext,
    RunEvent,
    RunEventType,
    RunMode,
)

LibraryProvider = Callable[[UUID], Union[LibraryRepo, Awaitable[LibraryRepo]]]


class RunBlocked(Exception):
    """The draft cannot be checked. The backend should show `message` to the creator."""

    def __init__(self, intake: IntakeResult) -> None:
        super().__init__(intake.message)
        self.intake = intake
        self.code: Optional[IntakeBlockCode] = intake.block_code
        self.message: str = intake.message or "This draft cannot be checked."


class _Events:
    """Numbers events from 0 and sends each one before the run continues."""

    def __init__(self, run_id: UUID, emit: EmitEvent) -> None:
        self._run_id = run_id
        self._emit = emit
        self.count = 0

    async def send(
        self, event_type: RunEventType, node: Optional[str] = None, **data: Any
    ) -> None:
        event = RunEvent(
            run_id=self._run_id,
            seq=self.count,
            type=event_type,
            node=node,
            data=_jsonable(data),
        )
        self.count += 1
        await self._emit(event)


def _jsonable(value: Any) -> Any:
    """Make event data safe to store as JSON and send over SSE."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "value"):  # enums
        return value.value
    return str(value)


async def run_brand_check_with_library(
    ctx: RunContext,
    emit: EmitEvent,
    library: LibraryRepo,
    *,
    llm: Optional[LLMClient] = None,
) -> HarnessResult:
    """Run one brand check against a library the caller has already loaded.

    llm is the shared LLMClient, or None to run rule-based checks only. Raises RunBlocked
    when intake_guard refuses the draft. Any other error is reported as a run.failed event
    and then raised again, so the backend can mark the run failed.
    """
    events = _Events(ctx.run_id, emit)
    library_version = library.library_version
    await events.send(
        RunEventType.RUN_STARTED,
        content_type=ctx.content_type,
        audience=ctx.audience,
        library_version=library_version,
        requested_library_version=ctx.library_version,
    )

    try:
        graph = build_graph(ctx, library, llm, events.send)
        state = await graph.ainvoke(
            {"draft": ctx.draft, "content_type": ctx.content_type, "audience": ctx.audience}
        )
        intake: IntakeResult = state["intake"]
        if not intake.allowed:
            await events.send(
                RunEventType.RUN_FAILED,
                "intake_guard",
                block_code=intake.block_code,
                message=intake.message,
            )
            raise RunBlocked(intake)

        baseline = state["baseline"]
        plan = state.get("investigation_plan")
        llm_calls = state.get("llm_calls") or []
        degraded_reason = state.get("degraded_reason")
        specialist_results = state.get("specialist_results") or []
        if degraded_reason:
            await events.send(RunEventType.RUN_DEGRADED, reason=degraded_reason, llm_calls=llm_calls)

        findings = state["findings"]
        for finding in findings:
            await events.send(RunEventType.FINDING_READY, finding.produced_by[0], finding=finding)

        used_llm = bool(llm_calls) and llm is not None
        prompt_versions = list(dict.fromkeys(state.get("prompt_versions") or []))
        retrievals = sum(len(result.tool_calls) for result in specialist_results)
        result = HarnessResult(
            mode=state["mode"],
            findings=findings,
            rejected=baseline.rejected + (state.get("ai_rejected") or []),
            plan=[task.model_dump(mode="json") for task in plan.tasks] if plan else [],
            iterations=state.get("iteration_count", 0),
            tool_calls=len(baseline.checks.tools) + retrievals,
            llm_provider=llm.settings.provider if used_llm else None,
            llm_model=llm.settings.model if used_llm else None,
            prompt_version=",".join(prompt_versions) or None,
            library_version=library_version,
            degraded_reason=degraded_reason,
        )
        await events.send(
            RunEventType.RUN_COMPLETED,
            mode=result.mode,
            finding_count=len(result.findings),
            rejected_count=len(result.rejected),
            checks=baseline.checks,
            readability=baseline.readability,
            notices=intake.notices,
            specialists=[
                {"specialist": r.specialist, "succeeded": r.succeeded, "findings": len(r.findings),
                 "supported_claims": r.supported, "error": r.error}
                for r in specialist_results
            ],
            aggregate_notes=state.get("aggregate_notes") or [],
        )
        return result
    except RunBlocked:
        raise
    except Exception as error:
        await events.send(
            RunEventType.RUN_FAILED, error=type(error).__name__, message="The brand check failed."
        )
        raise


def build_run_brand_check(
    library_for_org: LibraryProvider, *, llm: Optional[LLMClient] = None
) -> RunBrandCheck:
    """Return a function matching the shared RunBrandCheck contract.

    library_for_org(org_id) returns that organisation's read-only library, directly or
    as an awaitable. The backend passes its Postgres implementation here, and one shared
    LLMClient (LLMClient.from_env()), or None for rule-based checks only.
    """

    async def run_brand_check(ctx: RunContext, emit: EmitEvent) -> HarnessResult:
        library = library_for_org(ctx.org_id)
        if asyncio.iscoroutine(library) or isinstance(library, asyncio.Future):
            library = await library
        return await run_brand_check_with_library(ctx, emit, library, llm=llm)

    return run_brand_check


# Command line


def _print_event(event: RunEvent) -> None:
    detail = ""
    data = event.data
    if event.type is RunEventType.TOOL_CALLED and "matches" in data:
        detail = f"{data['tool']}: {data['matches']}"
    elif event.type is RunEventType.TOOL_CALLED:
        detail = f"{event.node} {data['tool']}: {', '.join(data['returned']) or 'nothing found'}"
    elif event.type is RunEventType.FINDING_READY:
        finding = data["finding"]
        outcome = f" ({finding['claim_outcome']})" if finding["claim_outcome"] else ""
        detail = (f"{finding['origin']} {finding['severity']} {finding['category']}{outcome}: "
                  f"\"{finding['span_text']}\"")
    elif event.type is RunEventType.GATE_REJECTED:
        detail = f"{data['gate']}: {data['reason']}"
    elif event.type is RunEventType.EVIDENCE_GAP:
        detail = f"{data['task_id']}: {data['description']}"
    elif event.type is RunEventType.PLAN_CREATED:
        tasks = data["tasks"]
        detail = f"{len(tasks)} tasks. Intent: {data['intent']}"
        for task in tasks:
            where = f'"{task["span_text"]}"' if task["span_text"] else "whole draft"
            detail += f"\n       {task['task_id']} {task['specialist']} ({task['priority']}): {where}: {task['focus']}"
        for note in data["notes"]:
            detail += f"\n       note: {note}"
    elif event.type in (RunEventType.RUN_DEGRADED, RunEventType.RUN_FAILED):
        detail = data.get("reason") or data.get("message", "")
    print(f"{event.seq:>3}  {event.type.value:<18} {detail}", file=sys.stderr)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run a brand check on a draft.")
    parser.add_argument("draft", help="path to a .txt file, or - to read standard input")
    parser.add_argument("--content-type", default="blog")
    parser.add_argument("--audience", default=None)
    parser.add_argument("--llm", action="store_true", help="run the AI stage (needs OPENAI_API_KEY)")
    parser.add_argument("--quiet", action="store_true", help="hide the event stream")
    args = parser.parse_args(argv)

    if args.draft == "-":
        draft = sys.stdin.read()
    else:
        with open(args.draft, encoding="utf-8") as handle:
            draft = handle.read()

    from harness.seed import seed_repo

    library = seed_repo()
    ctx = RunContext(
        run_id=uuid4(),
        org_id=uuid4(),
        submission_version_id=uuid4(),
        draft=draft,
        content_type=args.content_type,
        audience=args.audience,
        library_version=library.library_version,
    )

    async def emit(event: RunEvent) -> None:
        if not args.quiet:
            _print_event(event)

    try:
        result = asyncio.run(
            run_brand_check_with_library(
                ctx, emit, library, llm=LLMClient.from_env() if args.llm else None
            )
        )
    except RunBlocked as blocked:
        print(f"Blocked: {blocked.message}", file=sys.stderr)
        return 2
    print(json.dumps(result.model_dump(mode="json"), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
