"""Specialist capabilities (PRD 6.1.2, M6, M7): brand consistency, claims and evidence,
and accessibility.

Each specialist receives its tasks from the investigation plan and runs in three steps:
1. Retrieve evidence (code). It searches the active library for each task, within a
   tool-call budget, and adds any rule IDs the orchestrator named. Only these entries are
   sent to the model, as the PRD requires.
2. Assess (model). One structured call per specialist returns issues or claim
   assessments, plus evidence gaps.
3. Check (code). Each quote is located in the draft, so offsets come from code, never the
   model. A quote spanning more than one sentence is refused, so every finding points at
   specific words. A claims finding must contain something the PRD scopes as checkable (a
   number, date, ranking, superlative, guarantee or comparison). Citations the specialist
   was not shown are removed, "supported" claims are set aside, and every candidate goes
   through the gates (schema, citation, span, wording).

Every AI finding leaves here as "needs_human_verification". Only the critic can confirm
one (TRD 5.3, gate 4). The critic can also send a task back with a follow-up question and
search, which arrive here as extra_queries on a later iteration.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple, Type

from pydantic import BaseModel, ConfigDict, Field

from gates import apply_gates
from harness.deterministic import BaselineResult
from harness.library import BrandEntry, EntryType, LibraryRepo
from harness.llm import LLMClient, LLMUnavailable, build_messages, untrusted_block
from harness.orchestrator import InvestigationTask
from harness.prompts import load_prompt
from harness.tools import detect_claim_patterns, segment_sentences
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
SCOPE_GATE = "scope"
# Comparisons are claims too (CLAIM-005), but the claim-pattern tool does not detect them.
_COMPARISON = re.compile(
    r"\b(?:better|faster|cheaper|smarter|easier|stronger|bigger|more|less|fewer)\b[^.!?]{0,40}?\bthan\b"
    r"|\boutperform|\bcompared\s+(?:to|with)\b|\bvs\.?(?!\w)",
    re.IGNORECASE,
)


def is_checkable_claim(text: str) -> bool:
    """True if the passage holds a claim PRD M7 scopes for checking against approved facts."""
    return bool(re.search(r"\d", text) or detect_claim_patterns(text) or _COMPARISON.search(text))
# Tone and messaging rules apply to every passage, so the brand specialist sees all of them,
# as long as there are few enough to send. Past this, it relies on search alone.
MAX_ALWAYS_SHOWN_RULES = 25
_ALWAYS_SHOWN_CATEGORIES = {"tone", "messaging"}
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
    confidence: float = Field(description="How sure you are of the outcome you chose, from 0 to 1.")


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


class SupportedClaim(StrictModel):
    """A claim the specialist judged supported, with the approved facts it relied on."""

    task_id: Optional[str] = None
    span_start: int
    span_end: int
    span_text: str
    fact_quotes: List[str] = Field(default_factory=list)


class SpecialistOutcome(StrictModel):
    specialist: str
    succeeded: bool
    iteration: int = 1
    findings: List[Finding] = Field(default_factory=list)
    task_ids: List[Optional[str]] = Field(default_factory=list)  # one per finding, in order
    assessed_task_ids: List[str] = Field(default_factory=list)
    rejected: List[RejectedFinding] = Field(default_factory=list)
    supported: List[str] = Field(default_factory=list)
    supported_claims: List[SupportedClaim] = Field(default_factory=list)
    evidence_gaps: List[EvidenceGap] = Field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    llm_call: Optional[Dict[str, Any]] = None
    prompt_version: Optional[str] = None
    notes: List[str] = Field(default_factory=list)
    error: Optional[str] = None


# Step 1: evidence


# (entry types, results per type, guideline categories kept). One task's query runs every
# search listed for its specialist, and counts as ONE tool call.
_SEARCHES: Dict[str, List[Tuple[List[EntryType], int, Optional[set]]]] = {
    "brand_consistency": [
        ([EntryType.GUIDELINE, EntryType.TERM], 4, {"tone", "terminology", "messaging"}),
    ],
    "claims_evidence": [([EntryType.FACT], 4, None), ([EntryType.CLAIM_RULE], 2, None)],
    "accessibility": [],
}


def searches_needed(
    specialist: str, tasks: Sequence[InvestigationTask], extra_queries: Optional[Dict[str, str]] = None
) -> int:
    """How many tool calls a specialist needs: one per task query, or one for accessibility."""
    if specialist == "accessibility":
        return 1
    searches = len(tasks) + sum(1 for task in tasks if (extra_queries or {}).get(task.task_id))
    return searches + (1 if specialist == "brand_consistency" else 0)


def gather_evidence(
    specialist: str,
    tasks: Sequence[InvestigationTask],
    library: LibraryRepo,
    budget: int,
    extra_queries: Optional[Dict[str, str]] = None,
) -> Tuple[Dict[str, BrandEntry], List[Dict[str, Any]], List[str]]:
    """Return the entries to show the model (by public ID), the searches made, and notes.

    extra_queries maps a task ID to a follow-up search requested by the critic.
    """
    extra_queries = extra_queries or {}
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

    if specialist == "brand_consistency" and budget > 0:
        rules = [entry for entry in library.get_entries([EntryType.GUIDELINE])
                 if entry.category and entry.category.value in _ALWAYS_SHOWN_CATEGORIES]
        if len(rules) <= MAX_ALWAYS_SHOWN_RULES:
            for entry in rules:
                evidence.setdefault(entry.public_id, entry)
            calls.append({"tool": "get_entries", "query": "tone and messaging guidelines",
                          "returned": [entry.public_id for entry in rules]})

    searches = []
    for task in tasks:
        searches.append((task, f"{task.span_text or ''} {task.focus}".strip()))
        if extra_queries.get(task.task_id):
            searches.append((task, extra_queries[task.task_id].strip()))
    skipped = []
    for task, query in searches:
        if len(calls) >= budget:
            skipped.append(task.task_id)
            continue
        found: List[BrandEntry] = []
        for types, k, categories in _SEARCHES[specialist]:
            found += [
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
            "types": [t.value for types, _, _ in _SEARCHES[specialist] for t in types],
            "returned": list(dict.fromkeys(entry.public_id for entry in found)),
        })
    if skipped:
        notes.append("Tool-call budget reached, so these tasks had no search: "
                     + ", ".join(dict.fromkeys(skipped)) + ".")
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
        self.sentences = [(s.span_start, s.span_end) for s in segment_sentences(draft)]
        self.specialist = specialist
        self.tasks = {task.task_id: task for task in tasks}
        self.evidence = evidence
        self.draft = draft
        self.candidates: List[Dict[str, Any]] = []
        self.candidate_task_ids: List[Optional[str]] = []
        self.assessed: List[str] = []
        self.rejected: List[RejectedFinding] = []
        self.notes: List[str] = []
        self.supported_claims: List[SupportedClaim] = []

    def add(self, item: BaseModel, *, category: Category, severity: str, ids: List[str],
            claim_outcome: Optional[str] = None) -> None:
        task = self.tasks.get(item.task_id)
        if task is None:
            self.notes.append(f"Answer named unknown task {item.task_id}.")
        else:
            self.assessed.append(item.task_id)
        span = _locate(self.draft, item.quote, task)
        record = item.model_dump()
        if span is None:
            self.rejected.append(RejectedFinding(
                gate=SPAN_GATE, reason="the quoted text is not in the draft", candidate=record))
            return
        if self.sentences and not any(s <= span[0] and span[1] <= e for s, e in self.sentences):
            self.rejected.append(RejectedFinding(
                gate=SPAN_GATE, candidate=record,
                reason="the quote covers more than one sentence; a finding must point at specific words"))
            return
        if claim_outcome is not None and not is_checkable_claim(self.draft[span[0]:span[1]]):
            self.rejected.append(RejectedFinding(
                gate=SCOPE_GATE, candidate=record,
                reason="no number, date, ranking, superlative, guarantee or comparison to check "
                       "against approved facts; wording is checked by the brand specialist"))
            return
        known = [i for i in ids if i in self.evidence]
        unknown = [i for i in ids if i not in self.evidence]
        cited = [self.evidence[i].category for i in known if self.evidence[i].category]
        if self.specialist == "brand_consistency" and cited and category not in cited:
            self.notes.append(
                f'"{item.quote}" was reported as {category.value} but cites a '
                f"{cited[0].value} rule, so it is filed as {cited[0].value}.")
            category = cited[0]
        if unknown:
            self.notes.append(
                f"Removed citations the {self.specialist} specialist was not shown: "
                + ", ".join(unknown))
        self.candidate_task_ids.append(item.task_id if task else None)
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


def _convert(specialist, answer, tasks, evidence, draft) -> Tuple["_Converter", List[str]]:
    converter = _Converter(specialist, tasks, evidence, draft)
    supported: List[str] = []
    if isinstance(answer, ClaimsEvidenceAnswer):
        for item in answer.assessments:
            if item.outcome == "supported":
                supported.append(item.quote)
                task = converter.tasks.get(item.task_id)
                if task is not None:
                    converter.assessed.append(item.task_id)
                span = _locate(draft, item.quote, task)
                facts = [evidence[i].body for i in item.evidence_ids
                         if i in evidence and evidence[i].entry_type == EntryType.FACT]
                if span is not None:
                    converter.supported_claims.append(SupportedClaim(
                        task_id=item.task_id if task else None, span_start=span[0],
                        span_end=span[1], span_text=draft[span[0]:span[1]], fact_quotes=facts))
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
    return converter, supported


def convert_answer(
    specialist: str,
    answer: _ModelAnswer,
    tasks: Sequence[InvestigationTask],
    evidence: Dict[str, BrandEntry],
    draft: str,
) -> Tuple[List[Dict[str, Any]], List[RejectedFinding], List[str], List[str]]:
    """Turn a model answer into finding candidates. Returns candidates, rejected, supported, notes."""
    converter, supported = _convert(specialist, answer, tasks, evidence, draft)
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
    *,
    extra_queries: Optional[Dict[str, str]] = None,
    iteration: int = 1,
) -> SpecialistOutcome:
    """Run one specialist on its tasks. A model failure is returned, not raised."""
    evidence, tool_calls, notes = gather_evidence(
        specialist, tasks, library, budget, extra_queries)
    messages, prompt_version = build_specialist_messages(
        specialist, tasks, evidence, ctx, baseline, intent)
    try:
        result = await llm.structured(
            ANSWER_SCHEMAS[specialist], messages, node=specialist, prompt_version=prompt_version)
    except LLMUnavailable as error:
        return SpecialistOutcome(
            specialist=specialist, succeeded=False, iteration=iteration,
            tool_calls=tool_calls, notes=notes,
            prompt_version=prompt_version, error=error.reason,
            llm_call=error.call.as_step_data() if error.call and error.call.attempts else None,
        )

    converter, supported = _convert(specialist, result.value, tasks, evidence, ctx.draft)
    valid = library.valid_citations()
    findings: List[Finding] = []
    task_ids: List[Optional[str]] = []
    rejected = list(converter.rejected)
    for candidate, task_id in zip(converter.candidates, converter.candidate_task_ids):
        report = apply_gates([candidate], ctx.draft, valid)  # one at a time keeps the task link
        findings += report.passed
        task_ids += [task_id] * len(report.passed)
        rejected += report.rejected
    return SpecialistOutcome(
        specialist=specialist,
        succeeded=True,
        iteration=iteration,
        findings=findings,
        task_ids=task_ids,
        assessed_task_ids=list(dict.fromkeys(converter.assessed)),
        rejected=rejected,
        supported=supported,
        supported_claims=converter.supported_claims,
        evidence_gaps=list(result.value.evidence_gaps),
        tool_calls=tool_calls,
        llm_call=result.call.as_step_data(),
        prompt_version=prompt_version,
        notes=notes + converter.notes,
    )
