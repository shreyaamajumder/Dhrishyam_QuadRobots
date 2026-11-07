"""The single entry point between the backend and the harness (TRD Section 3, Flow B).

Rule-based mode for now: run_brand_check runs intake_guard and deterministic_baseline,
streams every step as a RunEvent, and returns a gated HarnessResult. The LangGraph agent
stage plugs in later at the marked point; until then every run is "deterministic_only"
and says so, which is also the required fallback when the LLM is unavailable.

The backend uses it like this:

    run_brand_check = build_run_brand_check(library_for_org=postgres_library_for_org,
                                            llm_enabled=settings.llm_enabled)
    result = await run_brand_check(ctx, emit)

Try it from the command line, using the demo brand kit:

    python -m harness.runner draft.txt
    echo "India's #1 AI-powered platform" | python -m harness.runner -
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union
from uuid import UUID, uuid4

from harness.deterministic import (
    BaselineResult,
    IntakeBlockCode,
    IntakeResult,
    run_deterministic_baseline,
    run_intake_guard,
)
from harness.library import LibraryRepo
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

AI_TURNED_OFF = "AI review is turned off, so only rule-based checks were run."
AI_NOT_CONNECTED = "AI review is not connected yet, so only rule-based checks were run."
ENGLISH_ONLY = "This version supports English only, so only rule-based checks were run."


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


def _tool_counts(baseline: BaselineResult) -> Dict[str, int]:
    counts = {tool: 0 for tool in baseline.checks.tools}
    for finding in baseline.findings:
        for name in finding.produced_by:
            if name in counts:
                counts[name] += 1
    counts["detect_claim_patterns"] = len(baseline.claim_candidates)
    return counts


async def run_brand_check_with_library(
    ctx: RunContext,
    emit: EmitEvent,
    library: LibraryRepo,
    *,
    llm_enabled: bool = False,
) -> HarnessResult:
    """Run one brand check against a library the caller has already loaded.

    Raises RunBlocked when intake_guard refuses the draft. Any other error is reported
    as a run.failed event and then raised again, so the backend can mark the run failed.
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
        intake = run_intake_guard(ctx.draft, library)
        if not intake.allowed:
            await events.send(
                RunEventType.RUN_FAILED,
                "intake_guard",
                block_code=intake.block_code,
                message=intake.message,
            )
            raise RunBlocked(intake)

        baseline = run_deterministic_baseline(ctx.draft, library, intake)
        for tool, matches in _tool_counts(baseline).items():
            await events.send(
                RunEventType.TOOL_CALLED, "deterministic_baseline", tool=tool, matches=matches
            )
        for rejected in baseline.rejected:
            await events.send(RunEventType.GATE_REJECTED, f"{rejected.gate}_gate", **rejected.model_dump())

        # Agent stage (orchestrator, specialists, critic, corrector) plugs in here.
        if not intake.english_supported:
            degraded_reason = ENGLISH_ONLY
        elif not llm_enabled:
            degraded_reason = AI_TURNED_OFF
        else:
            degraded_reason = AI_NOT_CONNECTED
        await events.send(RunEventType.RUN_DEGRADED, reason=degraded_reason)

        for finding in baseline.findings:
            await events.send(RunEventType.FINDING_READY, finding.produced_by[0], finding=finding)

        result = HarnessResult(
            mode=RunMode.DETERMINISTIC_ONLY,
            findings=baseline.findings,
            rejected=baseline.rejected,
            tool_calls=len(baseline.checks.tools),
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
    library_for_org: LibraryProvider, *, llm_enabled: bool = False
) -> RunBrandCheck:
    """Return a function matching the shared RunBrandCheck contract.

    library_for_org(org_id) returns that organisation's read-only library, directly or
    as an awaitable. The backend passes its Postgres implementation here.
    """

    async def run_brand_check(ctx: RunContext, emit: EmitEvent) -> HarnessResult:
        library = library_for_org(ctx.org_id)
        if asyncio.iscoroutine(library) or isinstance(library, asyncio.Future):
            library = await library
        return await run_brand_check_with_library(ctx, emit, library, llm_enabled=llm_enabled)

    return run_brand_check


# Command line


def _print_event(event: RunEvent) -> None:
    detail = ""
    data = event.data
    if event.type is RunEventType.TOOL_CALLED:
        detail = f"{data['tool']}: {data['matches']}"
    elif event.type is RunEventType.FINDING_READY:
        finding = data["finding"]
        detail = f"{finding['severity']} {finding['category']}: \"{finding['span_text']}\""
    elif event.type is RunEventType.GATE_REJECTED:
        detail = f"{data['gate']}: {data['reason']}"
    elif event.type in (RunEventType.RUN_DEGRADED, RunEventType.RUN_FAILED):
        detail = data.get("reason") or data.get("message", "")
    print(f"{event.seq:>3}  {event.type.value:<18} {detail}", file=sys.stderr)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run a brand check on a draft.")
    parser.add_argument("draft", help="path to a .txt file, or - to read standard input")
    parser.add_argument("--content-type", default="blog")
    parser.add_argument("--audience", default=None)
    parser.add_argument("--llm", action="store_true", help="ask for AI review")
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
            run_brand_check_with_library(ctx, emit, library, llm_enabled=args.llm)
        )
    except RunBlocked as blocked:
        print(f"Blocked: {blocked.message}", file=sys.stderr)
        return 2
    print(json.dumps(result.model_dump(mode="json"), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
