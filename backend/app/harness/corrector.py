"""M5 Correction and recommendation agent (PRD 6.1.4, TRD 5.2).

The model proposes the smallest grounded edit for each confirmed finding that has no
suggestion yet. Code then checks every proposal before it is attached:
- before_text is real draft text that covers the highlighted words, inside their sentence;
- the edit changes the highlighted words, and the model says it keeps the creator's meaning;
- after_text adds no new ranking, superlative, guarantee or comparison, and no number that
  is not already in the draft passage or the finding's cited evidence;
- after_text adds no banned term and no all-caps passage;
- the sentence still reads correctly once the edit is applied, with no dangling "and .",
  stray punctuation or lowercase start left behind by a deletion;
- the finding, with its suggestion, still passes every gate (including the wording gate,
  which checks the rationale).
A proposal that fails a check is dropped, and the finding is shown without a suggestion.

The draft is never changed here. apply_suggestion() is the one shared way to apply an
accepted suggestion, so the backend and the harness locate the edit identically.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from pydantic import BaseModel, ConfigDict, Field

from gates import apply_gates
from harness.deterministic import IntakeResult
from harness.library import LibraryRepo
from harness.llm import LLMClient, LLMUnavailable, build_messages, untrusted_block
from harness.prompts import load_prompt
from harness.schemas import DisplayStatus, Finding, RunContext, StrictModel, Suggestion
from harness.tools import (
    ClaimKind,
    detect_all_caps,
    detect_claim_patterns,
    lookup_banned_terms,
    make_diff,
)

MAX_FIXES_PER_RUN = 15
_LONE_PASSAGE_LIMIT = 160  # characters, when a span is in no detected sentence
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_BROKEN_SENTENCE = [
    (re.compile(r"\b(?:and|or|but|the|a|an|of|to|with|by|for|is|are|than)\s*[.,;:!?](?!\w)"),
     "a word left hanging before punctuation"),
    (re.compile(r"\s[,.;:!?]"), "a space before punctuation"),
    (re.compile(r"^\s*[,.;:!?]"), "the sentence starts with punctuation"),
    (re.compile(r"\S  +\S"), "a double space"),
]


def broken_sentence(original: str, edited: str) -> Optional[str]:
    """Describe what a deletion or replacement broke in a sentence, or None if it reads cleanly."""
    if not edited.strip():
        return None  # the whole sentence was removed
    for pattern, problem in _BROKEN_SENTENCE:
        if pattern.search(edited) and not pattern.search(original):
            return problem
    first_original = next((ch for ch in original if ch.isalpha()), "")
    first_edited = next((ch for ch in edited.lstrip() if ch.isalpha() or not ch.isspace()), "")
    if first_original.isupper() and first_edited.islower():
        return "the sentence no longer starts with a capital letter"
    return None


class _ModelAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposedFix(_ModelAnswer):
    finding_id: str
    before_text: str = Field(description="Exact draft text to replace; includes the highlight.")
    after_text: str
    rationale: str
    keeps_meaning: bool
    adds_new_claims: bool


class CorrectorAnswer(_ModelAnswer):
    fixes: List[ProposedFix]


class CorrectorOutcome(StrictModel):
    findings: List[Finding] = Field(default_factory=list)
    suggested: List[Dict[str, Any]] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)
    llm_call: Optional[Dict[str, Any]] = None
    prompt_version: Optional[str] = None
    failed: bool = False
    error: Optional[str] = None


def needs_fix(finding: Finding) -> bool:
    return finding.display_status is DisplayStatus.CONFIRMED and finding.suggestion is None


def locate_suggestion(draft: str, finding: Finding) -> Optional[Tuple[int, int]]:
    """Where the suggestion's before_text sits: the occurrence covering the finding's span."""
    if finding.suggestion is None:
        return None
    before = finding.suggestion.before_text
    start = draft.find(before)
    while start != -1:
        end = start + len(before)
        if start <= finding.span_start and finding.span_end <= end:
            return start, end
        start = draft.find(before, start + 1)
    return None


def apply_suggestion(draft: str, finding: Finding) -> str:
    """Return the draft with an accepted suggestion applied. Raises ValueError if it no longer fits."""
    where = locate_suggestion(draft, finding)
    if where is None:
        raise ValueError("The suggestion no longer matches the draft at this finding's position.")
    return draft[: where[0]] + finding.suggestion.after_text + draft[where[1]:]


def _sentence_bounds(intake: IntakeResult, finding: Finding, draft: str) -> Tuple[int, int]:
    for sentence in intake.sentences:
        if sentence.span_start <= finding.span_start and finding.span_end <= sentence.span_end:
            return sentence.span_start, sentence.span_end
    return (max(0, finding.span_start - _LONE_PASSAGE_LIMIT),
            min(len(draft), finding.span_end + _LONE_PASSAGE_LIMIT))


def _numbers(text: str) -> set:
    return {match.replace(",", "") for match in _NUMBER.findall(text)}


def check_fix(
    fix: ProposedFix,
    finding: Finding,
    draft: str,
    sentence: Tuple[int, int],
    library: LibraryRepo,
) -> Optional[str]:
    """Return why a proposed fix is refused, or None if it may be attached."""
    before, after = fix.before_text, fix.after_text
    if not before:
        return "it does not say what to replace"
    if before == after:
        return "it changes nothing"
    if fix.adds_new_claims:
        return "the agent reported that it adds a new claim"
    if not fix.keeps_meaning:
        return "the agent reported that it changes the creator's meaning"

    probe = finding.model_copy(update={"suggestion": Suggestion(
        before_text=before, after_text=after, rationale=fix.rationale.strip() or "-")})
    where = locate_suggestion(draft, probe)
    if where is None:
        return "its before text does not cover the highlighted words"
    if where[0] < sentence[0] or where[1] > sentence[1]:
        return "it changes text outside the highlighted sentence"
    if finding.span_text in after:
        return "it keeps the highlighted words unchanged"
    original = draft[sentence[0]:sentence[1]]
    edited = draft[sentence[0]:where[0]] + after + draft[where[1]:sentence[1]]
    problem = broken_sentence(original, edited)
    if problem:
        return f"it would leave the sentence broken ({problem}): \"{edited.strip()}\""

    old_claims = {(c.kind, c.span_text.lower()) for c in detect_claim_patterns(before)}
    evidence_numbers = set().union(*(_numbers(c.quote) for c in finding.citations)) | _numbers(before)
    for claim in detect_claim_patterns(after):
        if (claim.kind, claim.span_text.lower()) in old_claims:
            continue
        if claim.kind is not ClaimKind.STATISTIC:
            return f'it adds a new {claim.kind.value} claim: "{claim.span_text}"'
        if not _numbers(claim.span_text) <= evidence_numbers:
            return f'it adds a number the cited evidence does not support: "{claim.span_text}"'

    old_terms = {match.term.lower() for match in lookup_banned_terms(before, library.term_entries())}
    for match in lookup_banned_terms(after, library.term_entries()):
        if match.term.lower() not in old_terms:
            return f'it adds a banned term: "{match.span_text}"'
    if len(detect_all_caps(after)) > len(detect_all_caps(before)):
        return "it adds an all-caps passage"
    return None


def build_corrector_messages(
    targets: Sequence[Tuple[str, Finding]],
    ctx: RunContext,
    intake: IntakeResult,
    intent: str,
    library: LibraryRepo,
) -> Tuple[list, str]:
    prompt = load_prompt("corrector")
    blocks = []
    for finding_id, f in targets:
        start, end = _sentence_bounds(intake, f, ctx.draft)
        lines = [
            f"{finding_id}: {f.category.value}, severity {f.severity.value}"
            + (f", outcome {f.claim_outcome.value}" if f.claim_outcome else ""),
            f'  Highlighted: "{f.span_text}"',
            f'  Sentence: "{ctx.draft[start:end]}"',
            f"  Issue: {f.explanation}",
            "  Cited evidence:",
        ]
        for citation in f.citations:
            entry = library.get_entry(citation.entry_id)
            lines.append(f"    [{entry.public_id if entry else citation.entry_id}] {citation.quote}")
        blocks.append("\n".join(lines))
    user = "\n\n".join([
        f"Content type: {ctx.content_type}\nAudience: {ctx.audience or 'not given'}\n"
        f"Creator's intent: {intent or ctx.objective or 'not given'}",
        "Confirmed findings:\n\n" + "\n\n".join(blocks),
        "Draft:\n" + untrusted_block(ctx.draft),
    ])
    return build_messages(prompt.text, user), prompt.version


async def run_corrector(
    llm: LLMClient,
    findings: Sequence[Finding],
    ctx: RunContext,
    intake: IntakeResult,
    intent: str,
    library: LibraryRepo,
) -> CorrectorOutcome:
    """Attach checked suggestions to confirmed findings. Never raises for a model failure."""
    targets = [(f"f{n}", f) for n, f in enumerate(
        [f for f in findings if needs_fix(f)][:MAX_FIXES_PER_RUN], 1)]
    if not targets:
        return CorrectorOutcome(findings=list(findings))
    messages, prompt_version = build_corrector_messages(targets, ctx, intake, intent, library)
    try:
        result = await llm.structured(
            CorrectorAnswer, messages, node="corrector", prompt_version=prompt_version)
    except LLMUnavailable as error:
        return CorrectorOutcome(
            findings=list(findings), failed=True, error=error.reason, prompt_version=prompt_version,
            llm_call=error.call.as_step_data() if error.call and error.call.attempts else None)

    outcome = CorrectorOutcome(llm_call=result.call.as_step_data(), prompt_version=prompt_version)
    by_id = dict(targets)
    proposals: Dict[str, ProposedFix] = {}
    for fix in result.value.fixes:
        if fix.finding_id not in by_id:
            outcome.notes.append(f"Ignored a fix for unknown finding {fix.finding_id}.")
        elif fix.finding_id in proposals:
            outcome.notes.append(f"Ignored a second fix for {fix.finding_id}.")
        else:
            proposals[fix.finding_id] = fix

    fixed: Dict[int, Finding] = {}
    valid = library.valid_citations()
    for finding_id, finding in targets:
        fix = proposals.get(finding_id)
        if fix is None:
            continue
        sentence = _sentence_bounds(intake, finding, ctx.draft)
        refusal = check_fix(fix, finding, ctx.draft, sentence, library)
        if refusal is None:
            candidate = finding.model_copy(update={"suggestion": Suggestion(
                before_text=fix.before_text, after_text=fix.after_text,
                rationale=fix.rationale.strip())})
            gated = apply_gates([candidate], ctx.draft, valid)
            if gated.passed:
                fixed[id(finding)] = gated.passed[0]
                diff = make_diff(fix.before_text, fix.after_text)
                outcome.suggested.append({
                    "finding_id": finding_id, "span_text": finding.span_text,
                    "before_text": fix.before_text, "after_text": fix.after_text,
                    "changes": len(diff.changes), "similarity": diff.similarity,
                })
                continue
            refusal = f"it failed the {gated.rejected[0].gate} gate: {gated.rejected[0].reason}"
        outcome.notes.append(f'No suggestion for "{finding.span_text}": {refusal}.')

    outcome.findings = [fixed.get(id(f), f) for f in findings]
    return outcome
