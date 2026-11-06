"""The harness's two deterministic nodes (TRD Section 5.2).

intake_guard decides whether a draft can be checked and flags injection text.
deterministic_baseline produces rule-based findings. It runs first in every
check and is the only source of findings when the LLM is unavailable.

Neither node calls an LLM, changes the draft or changes workflow status.

Linking findings to library rules:
  claim_rule entries can set metadata "claim_kinds", for example ["ranking"].
  guideline entries can set metadata "deterministic_checks", for example
  ["all_caps", "link_text", "long_sentence", "prompt_injection"], and
  "max_sentence_words" for long_sentence.
Without that metadata, DEFAULT_CLAIM_RULES and DEFAULT_CHECK_RULES map the
seed kit's public IDs instead.
"""

from __future__ import annotations

import re
from collections import defaultdict
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from pydantic import Field
from typing_extensions import TypedDict

from gates import apply_gates
from harness.library import BrandEntry, EntryType, LibraryRepo
from harness.schemas import (
    Category,
    Citation,
    ClaimOutcome,
    DisplayStatus,
    Finding,
    Origin,
    RejectedFinding,
    Severity,
    StrictModel,
    Suggestion,
)
from harness.tools import (
    LONG_SENTENCE_WORDS,
    AllCapsPassage,
    ClaimCandidate,
    ClaimKind,
    LinkIssueKind,
    LinkTextIssue,
    ReadabilityResult,
    Sentence,
    TermMatch,
    TextSpan,
    check_link_text,
    detect_all_caps,
    detect_claim_patterns,
    lookup_banned_terms,
    readability,
    segment_sentences,
)

MIN_WORDS = 3
MAX_WORDS = 2000
MIN_LATIN_LETTER_SHARE = 0.7
MIN_WORDS_FOR_LANGUAGE_CHECK = 20
MIN_ENGLISH_WORD_SHARE = 0.08

CONFIDENCE_RULE_MATCH = 0.9
CONFIDENCE_NEEDS_REVIEW = 0.5
BASELINE_NODE = "deterministic_baseline"

# Used only when an entry has no claim_kinds or deterministic_checks metadata.
DEFAULT_CLAIM_RULES: Dict[str, str] = {
    "ranking": "CLAIM-001",
    "superlative": "CLAIM-002",
    "guarantee": "CLAIM-003",
    "statistic": "CLAIM-004",
}
DEFAULT_CHECK_RULES: Dict[str, str] = {
    "link_text": "ACC-001",
    "all_caps": "ACC-002",
}

_HIGH_RISK_CLAIMS = frozenset({ClaimKind.RANKING.value, ClaimKind.GUARANTEE.value})
_WORD = re.compile(r"\w+(?:['’-]\w+)*")

_COMMON_ENGLISH_WORDS = frozenset(
    "the and of to in is for with our your we you that this it on are as by from at be an "
    "or has have will can their they not was were".split()
)

_REVIEW_TARGET = r"(?:\s+(?:this|the|it)(?:\s+(?:draft|content|submission|document|post|article))?)?"

# Each pattern only flags text for a person. The text is never treated as an instruction.
_INJECTION_PATTERNS = re.compile(
    r"\b(?:ignore|disregard|forget|override|bypass|skip)\s+"
    r"(?:(?:all|any|the|these|those|your|previous|prior|above|earlier|brand)\s+){0,3}"
    r"(?:rules?|instructions?|guidelines?|prompts?|checks?|polic(?:y|ies))\b"
    r"(?:\s+and\s+approve" + _REVIEW_TARGET + r")?"
    r"|\b(?:please|you\s+must|you\s+should)\s+approve\b" + _REVIEW_TARGET +
    r"|\bapprove\s+(?:this|the)\s+(?:draft|content|submission|document|post|article)\b"
    r"|\bmark\s+(?:this|it|the\s+\w+)\s+as\s+(?:approved|compliant|passed)\b"
    r"|\b(?:do\s+not|don['’]t)\s+(?:flag|report|check|review)\s+"
    r"(?:this|it|anything|any\s+issues?|the\s+(?:draft|content|claims?|issues?|findings?))\b"
    r"|\byou\s+are\s+now\s+(?:a|an|the)\s+(?:\w+\s+)?(?:assistant|reviewer|bot|ai|model|system)\b"
    r"|\b(?:reveal|show|print)\s+(?:your|the)\s+(?:system\s+)?prompt\b"
    r"|\bsystem\s+prompt\b",
    re.IGNORECASE,
)


class IntakeBlockCode(str, Enum):
    EMPTY_DRAFT = "empty_draft"
    TOO_SHORT = "too_short"
    TOO_LONG = "too_long"
    EMPTY_LIBRARY = "empty_library"


class InjectionFlag(TextSpan):
    """Text that looks like an instruction to the system."""


class IntakeResult(StrictModel):
    allowed: bool
    block_code: Optional[IntakeBlockCode] = None
    message: Optional[str] = None
    word_count: int = Field(ge=0)
    sentences: List[Sentence] = Field(default_factory=list)
    injection_flags: List[InjectionFlag] = Field(default_factory=list)
    english_supported: bool = True
    notices: List[str] = Field(default_factory=list)


class ChecksPerformed(StrictModel):
    """Supports the "what was checked" message when a run has no findings."""

    library_version: int = Field(ge=0)
    active_rule_count: int = Field(ge=0)
    term_rule_count: int = Field(ge=0)
    claim_rule_count: int = Field(ge=0)
    categories: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)


class BaselineResult(StrictModel):
    findings: List[Finding] = Field(default_factory=list)
    rejected: List[RejectedFinding] = Field(default_factory=list)
    readability: ReadabilityResult
    claim_candidates: List[ClaimCandidate] = Field(default_factory=list)
    checks: ChecksPerformed


class DeterministicState(TypedDict, total=False):
    """The part of BrandGuardState that these two nodes read and write."""

    draft: str
    library: LibraryRepo
    intake: IntakeResult
    baseline: BaselineResult


def _value(item: Any) -> str:
    """Return an enum's value, so text never reads like ClaimKind.RANKING."""
    return str(item.value) if isinstance(item, Enum) else str(item)


# Library lookups


def _active(library: LibraryRepo, entry_type: Optional[EntryType] = None) -> List[BrandEntry]:
    return library.get_entries([entry_type] if entry_type else None)


def _by_public_id(library: LibraryRepo, public_id: Optional[str]) -> Optional[BrandEntry]:
    if not public_id:
        return None
    return next((e for e in _active(library) if e.public_id == public_id), None)


def _active_by_id(library: LibraryRepo) -> Dict[Any, BrandEntry]:
    return {entry.id: entry for entry in _active(library)}


def _rule_for_claim(library: LibraryRepo, kind: str) -> Optional[BrandEntry]:
    rules = _active(library, EntryType.CLAIM_RULE)
    for entry in rules:
        if kind in [_value(k) for k in entry.metadata.get("claim_kinds", [])]:
            return entry
    default = _by_public_id(library, DEFAULT_CLAIM_RULES.get(kind))
    return default if default and default.entry_type == EntryType.CLAIM_RULE else None


def _rule_for_check(library: LibraryRepo, check: str) -> Optional[BrandEntry]:
    for entry in _active(library, EntryType.GUIDELINE):
        if check in entry.metadata.get("deterministic_checks", []):
            return entry
    default = _by_public_id(library, DEFAULT_CHECK_RULES.get(check))
    return default if default and default.entry_type == EntryType.GUIDELINE else None


def _citation(entry: BrandEntry) -> Citation:
    return Citation(entry_id=entry.id, entry_version=entry.version, quote=entry.body)


# intake_guard


def _is_probably_english(draft: str, words: List[str]) -> bool:
    letters = [character for character in draft if character.isalpha()]
    if not letters:
        return True
    latin = sum(1 for character in letters if ord(character) < 0x250)
    if latin / len(letters) < MIN_LATIN_LETTER_SHARE:
        return False
    if len(words) < MIN_WORDS_FOR_LANGUAGE_CHECK:
        return True
    common = sum(1 for word in words if word.lower() in _COMMON_ENGLISH_WORDS)
    return common / len(words) >= MIN_ENGLISH_WORD_SHARE


def run_intake_guard(
    draft: str,
    library: LibraryRepo,
    *,
    min_words: int = MIN_WORDS,
    max_words: int = MAX_WORDS,
) -> IntakeResult:
    """Decide whether the draft can be checked. The draft is only ever read."""
    words = _WORD.findall(draft)
    word_count = len(words)

    def blocked(code: IntakeBlockCode, message: str) -> IntakeResult:
        return IntakeResult(allowed=False, block_code=code, message=message, word_count=word_count)

    if word_count == 0:
        return blocked(IntakeBlockCode.EMPTY_DRAFT, "Add some text before running a brand check.")
    if word_count < min_words:
        return blocked(
            IntakeBlockCode.TOO_SHORT,
            f"This draft is too short to check. Add at least {min_words} words.",
        )
    if word_count > max_words:
        return blocked(
            IntakeBlockCode.TOO_LONG,
            f"This draft has {word_count} words, and the limit is {max_words}. "
            "Shorten it and try again.",
        )
    if not _active(library):
        return blocked(
            IntakeBlockCode.EMPTY_LIBRARY,
            "The Brand Library has no active entries. Add or seed rules before running a check.",
        )

    english_supported = _is_probably_english(draft, words)
    return IntakeResult(
        allowed=True,
        word_count=word_count,
        sentences=segment_sentences(draft),
        injection_flags=[
            InjectionFlag(span_start=m.start(), span_end=m.end(), span_text=m.group(0))
            for m in _INJECTION_PATTERNS.finditer(draft)
        ],
        english_supported=english_supported,
        notices=(
            []
            if english_supported
            else ["This version supports English only, so only rule-based checks were run."]
        ),
    )


# deterministic_baseline


def _candidate(
    span: TextSpan,
    *,
    category: Category,
    severity: Severity,
    display_status: DisplayStatus,
    confidence: float,
    explanation: str,
    tool: str,
    entries: List[BrandEntry],
    claim_outcome: Optional[ClaimOutcome] = None,
    suggestion: Optional[Suggestion] = None,
    guideline_conflict: bool = False,
) -> Dict[str, Any]:
    return {
        "category": category,
        "severity": severity,
        "display_status": display_status,
        "claim_outcome": claim_outcome,
        "origin": Origin.RULE_BASED,
        "confidence": confidence,
        "span_start": span.span_start,
        "span_end": span.span_end,
        "span_text": span.span_text,
        "explanation": explanation,
        "produced_by": [BASELINE_NODE, tool],
        "citations": [_citation(entry) for entry in entries],
        "suggestion": suggestion,
        "guideline_conflict": guideline_conflict,
    }


def _capitalise_like(source: str, replacement: str) -> str:
    if source[:1].isupper() and replacement[:1].islower():
        return replacement[0].upper() + replacement[1:]
    return replacement


def _term_finding(
    matches: List[TermMatch], entries_by_id: Dict[Any, BrandEntry]
) -> Optional[Dict[str, Any]]:
    first = matches[0]
    entries = [entries_by_id.get(match.entry_id) for match in matches]
    if any(entry is None for entry in entries):
        return None
    labels = ", ".join(entry.public_id for entry in entries)
    preferred = sorted({match.preferred for match in matches if match.preferred})
    conflict = len(preferred) > 1

    explanation = f'"{first.span_text}" is not approved wording under {labels}.'
    suggestion = None
    if conflict:
        explanation += " These rules recommend different terms, so a reviewer needs to choose."
    elif preferred:
        replacement = _capitalise_like(first.span_text, preferred[0])
        explanation += f' Use "{replacement}" instead.'
        suggestion = Suggestion(
            before_text=first.span_text,
            after_text=replacement,
            rationale=f"{labels} lists this as the preferred term.",
        )

    return _candidate(
        first,
        category=Category.TERMINOLOGY,
        severity=Severity.MEDIUM,
        display_status=(
            DisplayStatus.NEEDS_HUMAN_VERIFICATION if conflict else DisplayStatus.CONFIRMED
        ),
        confidence=CONFIDENCE_NEEDS_REVIEW if conflict else CONFIDENCE_RULE_MATCH,
        explanation=explanation,
        tool="lookup_banned_terms",
        entries=entries,
        suggestion=suggestion,
        guideline_conflict=conflict,
    )


def _claim_finding(item: ClaimCandidate, library: LibraryRepo) -> Dict[str, Any]:
    kind = _value(item.kind)
    rule = _rule_for_claim(library, kind)
    source = f" under {rule.public_id}" if rule else ""
    return _candidate(
        item,
        category=Category.FACTS_AND_CLAIMS,
        severity=Severity.HIGH if kind in _HIGH_RISK_CLAIMS else Severity.MEDIUM,
        display_status=DisplayStatus.NEEDS_HUMAN_VERIFICATION,
        claim_outcome=ClaimOutcome.NEEDS_HUMAN_VERIFICATION,
        confidence=CONFIDENCE_NEEDS_REVIEW,
        explanation=(
            f"This {kind} claim needs a check against approved facts{source}. "
            "The rule-based check only found the wording and has not assessed the evidence."
        ),
        tool="detect_claim_patterns",
        entries=[rule] if rule else [],
    )


def _accessibility_finding(
    span: TextSpan,
    rule: Optional[BrandEntry],
    *,
    tool: str,
    with_rule: str,
    without_rule: str,
) -> Dict[str, Any]:
    return _candidate(
        span,
        category=Category.ACCESSIBILITY,
        severity=Severity.LOW,
        display_status=DisplayStatus.CONFIRMED if rule else DisplayStatus.NEEDS_HUMAN_VERIFICATION,
        confidence=CONFIDENCE_RULE_MATCH if rule else CONFIDENCE_NEEDS_REVIEW,
        explanation=with_rule.format(rule=rule.public_id) if rule else without_rule,
        tool=tool,
        entries=[rule] if rule else [],
    )


def _all_caps_finding(item: AllCapsPassage, library: LibraryRepo) -> Dict[str, Any]:
    return _accessibility_finding(
        item,
        _rule_for_check(library, "all_caps"),
        tool="detect_all_caps",
        with_rule="This all-caps passage is harder to read and goes against {rule}.",
        without_rule=(
            "This all-caps passage may be harder to read. "
            "No library rule covers it, so a person should decide."
        ),
    )


def _link_finding(item: LinkTextIssue, library: LibraryRepo) -> Dict[str, Any]:
    problem = (
        "This link has no text"
        if _value(item.kind) == LinkIssueKind.EMPTY.value
        else "This link text does not say where the link goes"
    )
    return _accessibility_finding(
        item,
        _rule_for_check(library, "link_text"),
        tool="check_link_text",
        with_rule=problem + ", which goes against {rule}.",
        without_rule=f"{problem}. No library rule covers it, so a person should decide.",
    )


def _long_sentence_findings(draft: str, library: LibraryRepo) -> List[Dict[str, Any]]:
    """Report long sentences only when a library rule sets a limit for them."""
    rule = _rule_for_check(library, "long_sentence")
    if rule is None:
        return []
    limit = int(rule.metadata.get("max_sentence_words", LONG_SENTENCE_WORDS))
    return [
        _accessibility_finding(
            sentence,
            rule,
            tool="readability",
            with_rule=(
                f"This sentence has {sentence.word_count} words, "
                f"over the limit of {limit} in {{rule}}."
            ),
            without_rule="",
        )
        for sentence in readability(draft, long_sentence_words=limit).long_sentences
    ]


def _injection_finding(item: InjectionFlag, library: LibraryRepo) -> Dict[str, Any]:
    rule = _rule_for_check(library, "prompt_injection")
    return _candidate(
        item,
        category=Category.MESSAGING,
        severity=Severity.HIGH,
        display_status=DisplayStatus.NEEDS_HUMAN_VERIFICATION,
        confidence=CONFIDENCE_NEEDS_REVIEW,
        explanation=(
            "This text looks like an instruction to the review system. "
            "It was treated as draft content and was not followed, so a person should review it."
        ),
        tool="intake_guard",
        entries=[rule] if rule else [],
    )


def run_deterministic_baseline(
    draft: str,
    library: LibraryRepo,
    intake: IntakeResult,
) -> BaselineResult:
    """Build rule-based findings and pass them through the gates."""
    if not intake.allowed:
        raise ValueError("The baseline cannot run on a draft blocked by intake_guard.")

    entries_by_id = _active_by_id(library)
    grouped_terms: Dict[Tuple[int, int], List[TermMatch]] = defaultdict(list)
    for match in lookup_banned_terms(draft, library.term_entries()):
        grouped_terms[(match.span_start, match.span_end)].append(match)

    claim_candidates = detect_claim_patterns(draft)
    candidates: List[Dict[str, Any]] = []
    for matches in grouped_terms.values():
        finding = _term_finding(matches, entries_by_id)
        if finding is not None:
            candidates.append(finding)
    candidates += [_claim_finding(item, library) for item in claim_candidates]
    candidates += [_all_caps_finding(item, library) for item in detect_all_caps(draft)]
    candidates += [_link_finding(item, library) for item in check_link_text(draft)]
    candidates += _long_sentence_findings(draft, library)
    candidates += [_injection_finding(item, library) for item in intake.injection_flags]

    report = apply_gates(candidates, draft, library.valid_citations())
    active = _active(library)
    return BaselineResult(
        findings=sorted(report.passed, key=lambda item: (item.span_start, item.span_end)),
        rejected=report.rejected,
        readability=readability(draft),
        claim_candidates=claim_candidates,
        checks=ChecksPerformed(
            library_version=library.library_version,
            active_rule_count=len(active),
            term_rule_count=sum(1 for e in active if e.entry_type == EntryType.TERM),
            claim_rule_count=sum(1 for e in active if e.entry_type == EntryType.CLAIM_RULE),
            categories=sorted({_value(e.category) for e in active if e.category is not None}),
            tools=[
                "lookup_banned_terms",
                "detect_claim_patterns",
                "detect_all_caps",
                "check_link_text",
                "readability",
            ],
        ),
    )


# LangGraph node wrappers. Each returns only the state it adds.


def intake_guard(state: DeterministicState) -> DeterministicState:
    return {"intake": run_intake_guard(state["draft"], state["library"])}


def deterministic_baseline(state: DeterministicState) -> DeterministicState:
    return {
        "baseline": run_deterministic_baseline(state["draft"], state["library"], state["intake"])
    }
