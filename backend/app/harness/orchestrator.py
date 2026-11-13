"""M3 Governance Orchestrator: the investigation plan (PRD 6.1.1).

The model proposes a plan; code then checks it before anything uses it:
- every quoted passage is located in the draft, giving exact offsets (the model never
  supplies offsets, which it gets wrong);
- rule IDs not in the active library are removed;
- duplicate tasks are merged and the plan is capped at MAX_TASKS;
- every claim the rule-based check found gets a claims_evidence task, even if the model
  missed it, so no candidate claim goes uninvestigated;
- a plan with any tasks also gets one whole-draft tone and messaging check, so the brand
  rules are always applied across the draft.
Every change is listed in plan.notes, so the trace shows what code corrected.
"""

from __future__ import annotations

from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

from harness.deterministic import BaselineResult, IntakeResult
from harness.library import EntryType, LibraryRepo
from harness.llm import LLMCall, LLMClient, build_messages, untrusted_block
from harness.prompts import load_prompt
from harness.schemas import RunContext, StrictModel
from harness.tools import ClaimKind

Specialist = Literal["brand_consistency", "claims_evidence", "accessibility"]
Priority = Literal["high", "medium", "low"]
SPECIALISTS: Tuple[str, ...] = ("brand_consistency", "claims_evidence", "accessibility")
MAX_TASKS = 12
_PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
_HIGH_RISK_CLAIMS = {ClaimKind.RANKING.value, ClaimKind.GUARANTEE.value}


# What the model returns. Every field is required, so the answer suits strict JSON schema.


class _ModelAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlannedTask(_ModelAnswer):
    specialist: Specialist
    focus: str = Field(description="What the specialist should find out. Not a conclusion.")
    quote: Optional[str] = Field(
        description="Exact passage copied from the draft, or null for a whole-draft task."
    )
    rule_ids: List[str] = Field(description="Brand library IDs from the catalogue that apply.")
    priority: Priority
    reason: str = Field(description="Why this passage needs investigation.")


class SkippedSpecialist(_ModelAnswer):
    specialist: Specialist
    reason: str


class PlanAnswer(_ModelAnswer):
    intent: str = Field(description="What the draft is trying to achieve, in one sentence.")
    audience: str = Field(description="Who the draft is written for.")
    tasks: List[PlannedTask]
    skipped: List[SkippedSpecialist]


# The checked plan the rest of the harness uses.


class InvestigationTask(StrictModel):
    task_id: str
    specialist: Specialist
    focus: str
    priority: Priority
    reason: str
    rule_ids: List[str] = Field(default_factory=list)
    span_start: Optional[int] = None
    span_end: Optional[int] = None
    span_text: Optional[str] = None
    source: Literal["orchestrator", "coverage"] = "orchestrator"


class InvestigationPlan(StrictModel):
    intent: str
    audience: str
    tasks: List[InvestigationTask] = Field(default_factory=list)
    skipped: List[SkippedSpecialist] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)

    def tasks_for(self, specialist: str) -> List[InvestigationTask]:
        return [task for task in self.tasks if task.specialist == specialist]


def _catalogue(library: LibraryRepo) -> str:
    lines = []
    for entry in library.get_entries([EntryType.GUIDELINE, EntryType.CLAIM_RULE]):
        category = entry.category.value if entry.category else "general"
        lines.append(f"- {entry.public_id} ({category}): {entry.title}")
    facts = [entry.title for entry in library.get_entries([EntryType.FACT])]
    if facts:
        lines.append("Approved facts exist on: " + ", ".join(facts) + ".")
    return "\n".join(lines) or "(no guidelines or claim rules)"


def _signals(intake: IntakeResult, baseline: BaselineResult) -> str:
    lines = [f'- {item.kind.value} claim: "{item.span_text}"' for item in baseline.claim_candidates]
    for finding in baseline.findings:
        if finding.category.value in ("terminology", "accessibility"):
            lines.append(f'- {finding.category.value}: "{finding.span_text}"')
    for flag in intake.injection_flags:
        lines.append(f'- possible instruction to the system: "{flag.span_text}"')
    grade = baseline.readability.flesch_kincaid_grade
    if grade is not None:
        reliability = "" if baseline.readability.scores_reliable else " (short text, approximate)"
        lines.append(f"- reading grade {grade}{reliability}")
    return "\n".join(lines) or "- none"


def build_plan_messages(
    ctx: RunContext, library: LibraryRepo, intake: IntakeResult, baseline: BaselineResult
) -> Tuple[list, str]:
    prompt = load_prompt("orchestrator")
    user = "\n\n".join(
        [
            f"Content type: {ctx.content_type}\n"
            f"Audience: {ctx.audience or 'not given'}\n"
            f"Objective: {ctx.objective or 'not given'}",
            "Brand library catalogue:\n" + _catalogue(library),
            "Rule-based signals:\n" + _signals(intake, baseline),
            "Draft:\n" + untrusted_block(ctx.draft),
        ]
    )
    return build_messages(prompt.text, user), prompt.version


def _locate(draft: str, quote: str, taken: List[Tuple[int, int]]) -> Optional[Tuple[int, int]]:
    """Find the quote, preferring an exact match, then a case-insensitive one.

    Repeated passages are matched in order, so two tasks quoting the same words point at
    different places when the draft repeats them.
    """
    for haystack, needle in ((draft, quote), (draft.lower(), quote.lower())):
        start = haystack.find(needle)
        first = None
        while start != -1:
            span = (start, start + len(needle))
            first = first or span
            if span not in taken:
                return span
            start = haystack.find(needle, start + 1)
        if first:
            return first
    return None


def finalise_plan(
    answer: PlanAnswer, draft: str, library: LibraryRepo, baseline: BaselineResult
) -> InvestigationPlan:
    known_ids = {entry.public_id for entry in library.get_entries()}
    notes: List[str] = []
    tasks: List[InvestigationTask] = []
    seen = set()
    taken: List[Tuple[int, int]] = []

    for planned in answer.tasks:
        span = None
        quote = (planned.quote or "").strip()
        if quote:
            span = _locate(draft, quote, taken)
            if span is None:
                notes.append(f'Quote not found in the draft, so the task covers the whole draft: "{quote}"')
        rule_ids = [rule_id for rule_id in planned.rule_ids if rule_id in known_ids]
        unknown = [rule_id for rule_id in planned.rule_ids if rule_id not in known_ids]
        if unknown:
            notes.append("Removed rule IDs that are not in the active library: " + ", ".join(unknown))

        key = (planned.specialist, span, planned.focus.strip().lower())
        if key in seen:
            notes.append(f"Merged a duplicate {planned.specialist} task.")
            continue
        seen.add(key)
        if span:
            taken.append(span)
        tasks.append(
            InvestigationTask(
                task_id="",
                specialist=planned.specialist,
                focus=planned.focus.strip(),
                priority=planned.priority,
                reason=planned.reason.strip(),
                rule_ids=rule_ids,
                span_start=span[0] if span else None,
                span_end=span[1] if span else None,
                span_text=draft[span[0] : span[1]] if span else None,
            )
        )

    if len(tasks) > MAX_TASKS:
        notes.append(f"Kept the {MAX_TASKS} highest-priority tasks out of {len(tasks)}.")
        tasks = sorted(tasks, key=lambda task: _PRIORITY_ORDER[task.priority])[:MAX_TASKS]

    has_whole_draft_brand_check = any(
        task.specialist == "brand_consistency" and task.span_start is None for task in tasks)
    if tasks and not has_whole_draft_brand_check:
        tasks.append(InvestigationTask(
            task_id="", specialist="brand_consistency", priority="medium", source="coverage",
            focus="Check the whole draft against every tone and messaging rule: pressure or "
                  "urgency, how the reader is addressed, exclamation marks, promised outcomes, "
                  "competitors, and how the AI is described.",
            reason="Every reviewed draft gets one full tone and messaging check.",
        ))
        notes.append("Added a whole-draft tone and messaging check.")

    for candidate in baseline.claim_candidates:
        covered = any(
            task.specialist == "claims_evidence"
            and task.span_start is not None
            and task.span_start < candidate.span_end
            and candidate.span_start < task.span_end
            for task in tasks
        )
        if covered:
            continue
        kind = candidate.kind.value
        tasks.append(
            InvestigationTask(
                task_id="",
                specialist="claims_evidence",
                focus=f"Check whether approved facts support this {kind} claim.",
                priority="high" if kind in _HIGH_RISK_CLAIMS else "medium",
                reason="The rule-based check found this claim and the plan did not cover it.",
                span_start=candidate.span_start,
                span_end=candidate.span_end,
                span_text=candidate.span_text,
                source="coverage",
            )
        )
        notes.append(f'Added a claims_evidence task for "{candidate.span_text}".')

    tasks.sort(key=lambda task: (task.span_start is None, task.span_start or 0, task.specialist))
    tasks = [task.model_copy(update={"task_id": f"t{number}"}) for number, task in enumerate(tasks, 1)]
    assigned = {task.specialist for task in tasks}
    skipped = [item for item in answer.skipped if item.specialist not in assigned]
    return InvestigationPlan(
        intent=answer.intent.strip(),
        audience=answer.audience.strip(),
        tasks=tasks,
        skipped=skipped,
        notes=notes,
    )


async def run_orchestrator(
    llm: LLMClient,
    ctx: RunContext,
    library: LibraryRepo,
    intake: IntakeResult,
    baseline: BaselineResult,
) -> Tuple[InvestigationPlan, LLMCall]:
    """Ask the model for a plan and return it checked. Raises LLMUnavailable on failure."""
    messages, prompt_version = build_plan_messages(ctx, library, intake, baseline)
    result = await llm.structured(
        PlanAnswer, messages, node="orchestrator", prompt_version=prompt_version
    )
    return finalise_plan(result.value, ctx.draft, library, baseline), result.call
