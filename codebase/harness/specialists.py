"""Specialist capabilities (PRD 6.1.2, M6, M7): brand consistency, claims and evidence,
and accessibility.

Each specialist receives its tasks from the investigation plan and runs in three steps:
1. Retrieve evidence (code). It searches the active library for each task, within a
   tool-call budget, and adds any rule IDs the orchestrator named. Only these entries are
   sent to the model, as the PRD requires.
2. Assess (model). One structured call per specialist returns issues or claim
   assessments, plus evidence gaps.
3. Check (code). Each quote is located in the draft, so offsets come from code, never the
   model. Citations the specialist was not shown are removed, "supported" claims are set
   aside, and every candidate goes through the gates (schema, citation, span, wording).

Until the critic exists, every AI finding is "needs_human_verification", so nothing the
model produced is shown as confirmed (TRD 5.3, gate 4).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple, Type

from pydantic import BaseModel, ConfigDict, Field

from gates import apply_gates
from harness.deterministic import BaselineResult
from harness.library import BrandEntry, EntryType, LibraryRepo
from harness.llm import LLMClient, LLMUnavailable, build_messages, untrusted_block
from harness.orchestrator import InvestigationTask
from harness.prompts import load_prompt
from harness.schemas import (
    Category,
    DisplayStatus,
    Finding,
    Origin,
    RejectedFinding,
    RunContext,
    StrictModel,
)

MAX_TOOL_CALLS = 20
SPAN_GATE = "span"
SeverityLevel = Literal["high", "medium", "low"]
Outcome = Literal[
    "supported", "partially_supported", "unsupported", "conflicting_evidence",
    "needs_human_verification",
]


# What the models return. Every field is required, so the answers suit strict JSON schema.


class _ModelAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceGap(_ModelAnswer):
    task_id: str
    description: str = Field(description="What evidence is missing.")
    search_query: str = Field(description="A short query that could find it.")


class BrandIssue(_ModelAnswer):
    task_id: str
    quote: str = Field(description="Exact words from the draft.")
    category: Literal["tone", "terminology", "messaging"]
    severity: SeverityLevel
    explanation: str
    rule_ids: List[str]
    confidence: float


class BrandConsistencyAnswer(_ModelAnswer):
    issues: List[BrandIssue]
    evidence_gaps: List[EvidenceGap]


class ClaimAssessment(_ModelAnswer):
    task_id: str
    quote: str = Field(description="Exact words of the claim from the draft.")
    outcome: Outcome
    severity: SeverityLevel
    explanation: str
    evidence_ids: List[str]
    confidence: float


class ClaimsEvidenceAnswer(_ModelAnswer):
    assessments: List[ClaimAssessment]
    evidence_gaps: List[EvidenceGap]


class AccessibilityIssue(_ModelAnswer):
    task_id: str
    quote: str = Field(description="Exact words from the draft.")
    severity: SeverityLevel
    explanation: str
    rule_ids: List[str]
    confidence: float


class AccessibilityAnswer(_ModelAnswer):
    issues: List[AccessibilityIssue]
    evidence_gaps: List[EvidenceGap]


ANSWER_SCHEMAS: Dict[str, Type[_ModelAnswer]] = {
    "brand_consistency": BrandConsistencyAnswer,
    "claims_evidence": ClaimsEvidenceAnswer,
    "accessibility": AccessibilityAnswer,
}


# What a specialist hands to the aggregate step.


class SpecialistOutcome(StrictModel):
    specialist: str
    succeeded: bool
    findings: List[Finding] = Field(default_factory=list)
    rejected: List[RejectedFinding] = Field(default_factory=list)
    supported: List[str] = Field(default_factory=list)
    evidence_gaps: List[EvidenceGap] = Field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    llm_call: Optional[Dict[str, Any]] = None
    prompt_version: Optional[str] = None
    notes: List[str] = Field(default_factory=list)
    error: Optional[str] = None


# Step 1: evidence


# (entry types, results per search, guideline categories kept) for each search a task makes
_SEARCHES: Dict[str, List[Tuple[List[EntryType], int, Optional[set]]]] = {
    "brand_consistency": [
        ([EntryType.GUIDELINE, EntryType.TERM], 4, {"tone", "terminology", "messaging"}),
    ],
    "claims_evidence": [([EntryType.FACT], 4, None), ([EntryType.CLAIM_RULE], 2, None)],
    "accessibility": [],
}


def gather_evidence(
    specialist: str,
    tasks: Sequence[InvestigationTask],
    library: LibraryRepo,
    budget: int,
) -> Tuple[Dict[str, BrandEntry], List[Dict[str, Any]], List[str]]:
    """Return the entries to show the model (by public ID), the searches made, and notes."""
    by_public_id = {entry.public_id: entry for entry in library.get_entries()}
    evidence: Dict[str, BrandEntry] = {}
    calls: List[Dict[str, Any]] = []
    notes: List[str] = []

    for task in tasks:
        for rule_id in task.rule_ids:
            if rule_id in by_public_id:
                evidence.setdefault(rule_id, by_public_id[rule_id])

    if specialist == "accessibility":
        for entry in library.get_entries([EntryType.GUIDELINE]):
            if entry.category and entry.category.value == "accessibility":
                evidence.setdefault(entry.public_id, entry)
        calls.append({"tool": "get_entries", "query": "accessibility guidelines",
                      "returned": sorted(evidence)})
        return evidence, calls, notes

    skipped = 0
    for task in tasks:
        query = f"{task.span_text or ''} {task.focus}".strip()
        for types, k, categories in _SEARCHES[specialist]:
            if len(calls) >= budget:
                skipped += 1
                continue
            found = [
                entry
                for entry in library.retrieve_entries(query, types, k)
                if categories is None
                or entry.entry_type != EntryType.GUIDELINE
                or (entry.category and entry.category.value in categories)
            ]
            for entry in found:
                evidence.setdefault(entry.public_id, entry)
            calls.append({
                "tool": "retrieve_entries",
                "task_id": task.task_id,
                "query": query,
                "types": [t.value for t in types],
                "returned": [entry.public_id for entry in found],
            })
    if skipped:
        notes.append(f"Tool-call budget reached, so {skipped} searches were skipped.")
    return evidence, calls, notes


def _format_entry(entry: BrandEntry) -> str:
    line = f"[{entry.public_id}] {entry.entry_type.value}: {entry.title}. {entry.body}"
    if entry.good_example:
        line += f' Good: "{entry.good_example}".'
    if entry.bad_example:
        line += f' Bad: "{entry.bad_example}".'
    return line


# Step 2: the model call


def _measurements(baseline: BaselineResult) -> str:
    readability = baseline.readability
    lines = [
        f"- words: {readability.word_count}, sentences: {readability.sentence_count}, "
        f"average words per sentence: {readability.average_words_per_sentence}",
    ]
    if readability.flesch_kincaid_grade is not None:
        note = "" if readability.scores_reliable else " (short text, so this is approximate)"
        lines.append(
            f"- reading grade {readability.flesch_kincaid_grade}, "
            f"reading ease {readability.flesch_reading_ease}{note}"
        )
    for sentence in readability.long_sentences:
        lines.append(f'- long sentence ({sentence.word_count} words): "{sentence.span_text}"')
    for finding in baseline.findings:
        if finding.category is Category.ACCESSIBILITY:
            lines.append(f'- {finding.produced_by[-1]} found: "{finding.span_text}"')
    return "\n".join(lines)


def build_specialist_messages(
    specialist: str,
    tasks: Sequence[InvestigationTask],
    evidence: Dict[str, BrandEntry],
    ctx: RunContext,
    baseline: BaselineResult,
    intent: str,
) -> Tuple[list, str]:
    prompt = load_prompt(specialist)
    task_lines = []
    for task in tasks:
        where = f'"{task.span_text}"' if task.span_text else "the whole draft"
        hints = f" Suggested rules: {', '.join(task.rule_ids)}." if task.rule_ids else ""
        task_lines.append(f"- {task.task_id}: {where}. Check: {task.focus}{hints}")
    sections = [
        f"Content type: {ctx.content_type}\nAudience: {ctx.audience or 'not given'}\n"
        f"Objective: {ctx.objective or 'not given'}\nIntent of the draft: {intent}",
        "Tasks:\n" + "\n".join(task_lines),
        "Evidence:\n" + ("\n".join(_format_entry(e) for e in evidence.values()) or "(none found)"),
    ]
    if specialist == "accessibility":
        sections.append("Measurements:\n" + _measurements(baseline))
    sections.append("Draft:\n" + untrusted_block(ctx.draft))
    return build_messages(prompt.text, "\n\n".join(sections)), prompt.version


# Step 3: checking what the model returned


def _locate(draft: str, quote: str, task: Optional[InvestigationTask]) -> Optional[Tuple[int, int]]:
    """Find the quote, preferring an occurrence inside the task's passage."""
    quote = quote.strip()
    if not quote:
        return None
    for haystack, needle in ((draft, quote), (draft.lower(), quote.lower())):
        spans = []
        start = haystack.find(needle)
        while start != -1:
            spans.append((start, start + len(needle)))
            start = haystack.find(needle, start + 1)
        if not spans:
            continue
        if task and task.span_start is not None:
            for span in spans:
                if span[0] < task.span_end and task.span_start < span[1]:
                    return span
        return spans[0]
    return None


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


class _Converter:
    def __init__(self, specialist: str, tasks: Sequence[InvestigationTask],
                 evidence: Dict[str, BrandEntry], draft: str) -> None:
        self.specialist = specialist
        self.tasks = {task.task_id: task for task in tasks}
        self.evidence = evidence
        self.draft = draft
        self.candidates: List[Dict[str, Any]] = []
        self.rejected: List[RejectedFinding] = []
        self.notes: List[str] = []

    def add(self, item: BaseModel, *, category: Category, severity: str, ids: List[str],
            claim_outcome: Optional[str] = None) -> None:
        task = self.tasks.get(item.task_id)
        if task is None:
            self.notes.append(f"Answer named unknown task {item.task_id}.")
        span = _locate(self.draft, item.quote, task)
        record = item.model_dump()
        if span is None:
            self.rejected.append(RejectedFinding(
                gate=SPAN_GATE, reason="the quoted text is not in the draft", candidate=record))
            return
        known = [i for i in ids if i in self.evidence]
        unknown = [i for i in ids if i not in self.evidence]
        if unknown:
            self.notes.append(
                f"Removed citations the {self.specialist} specialist was not shown: "
                + ", ".join(unknown))
        self.candidates.append({
            "category": category,
            "severity": severity,
            "display_status": DisplayStatus.NEEDS_HUMAN_VERIFICATION,
            "claim_outcome": claim_outcome,
            "origin": Origin.AI,
            "confidence": _clamp(item.confidence),
            "span_start": span[0],
            "span_end": span[1],
            "span_text": self.draft[span[0]:span[1]],
            "explanation": item.explanation.strip(),
            "produced_by": [self.specialist],
            "citations": [
                {"entry_id": self.evidence[i].id, "entry_version": self.evidence[i].version,
                 "quote": self.evidence[i].body}
                for i in dict.fromkeys(known)
            ],
        })


def convert_answer(
    specialist: str,
    answer: _ModelAnswer,
    tasks: Sequence[InvestigationTask],
    evidence: Dict[str, BrandEntry],
    draft: str,
) -> Tuple[List[Dict[str, Any]], List[RejectedFinding], List[str], List[str]]:
    """Turn a model answer into finding candidates. Returns candidates, rejected, supported, notes."""
    converter = _Converter(specialist, tasks, evidence, draft)
    supported: List[str] = []
    if isinstance(answer, ClaimsEvidenceAnswer):
        for item in answer.assessments:
            if item.outcome == "supported":
                supported.append(item.quote)
                continue
            converter.add(item, category=Category.FACTS_AND_CLAIMS, severity=item.severity,
                          ids=item.evidence_ids, claim_outcome=item.outcome)
    elif isinstance(answer, BrandConsistencyAnswer):
        for item in answer.issues:
            converter.add(item, category=Category(item.category), severity=item.severity,
                          ids=item.rule_ids)
    elif isinstance(answer, AccessibilityAnswer):
        for item in answer.issues:
            converter.add(item, category=Category.ACCESSIBILITY, severity=item.severity,
                          ids=item.rule_ids)
    return converter.candidates, converter.rejected, supported, converter.notes


async def run_specialist(
    specialist: str,
    tasks: Sequence[InvestigationTask],
    ctx: RunContext,
    library: LibraryRepo,
    baseline: BaselineResult,
    intent: str,
    llm: LLMClient,
    budget: int,
) -> SpecialistOutcome:
    """Run one specialist on its tasks. A model failure is returned, not raised."""
    evidence, tool_calls, notes = gather_evidence(specialist, tasks, library, budget)
    messages, prompt_version = build_specialist_messages(
        specialist, tasks, evidence, ctx, baseline, intent)
    try:
        result = await llm.structured(
            ANSWER_SCHEMAS[specialist], messages, node=specialist, prompt_version=prompt_version)
    except LLMUnavailable as error:
        return SpecialistOutcome(
            specialist=specialist, succeeded=False, tool_calls=tool_calls, notes=notes,
            prompt_version=prompt_version, error=error.reason,
            llm_call=error.call.as_step_data() if error.call and error.call.attempts else None,
        )

    candidates, rejected, supported, convert_notes = convert_answer(
        specialist, result.value, tasks, evidence, ctx.draft)
    report = apply_gates(candidates, ctx.draft, library.valid_citations())
    return SpecialistOutcome(
        specialist=specialist,
        succeeded=True,
        findings=report.passed,
        rejected=rejected + report.rejected,
        supported=supported,
        evidence_gaps=list(result.value.evidence_gaps),
        tool_calls=tool_calls,
        llm_call=result.call.as_step_data(),
        prompt_version=prompt_version,
        notes=notes + convert_notes,
    )
