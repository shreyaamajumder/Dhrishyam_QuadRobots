"""Deterministic, read-only tools for the harness (TRD Section 5.2).

These functions measure text and report candidates. They never decide that
something is a violation, and they never change the draft. Every span uses
Python string offsets, so draft[span_start:span_end] == span_text.
"""

from __future__ import annotations

import difflib
import re
from collections.abc import Iterable, Sequence
from enum import Enum
from typing import Literal
from typing_extensions import Self
from uuid import UUID

import pyphen
from pydantic import Field, model_validator

from harness.schemas import StrictModel

LONG_SENTENCE_WORDS = 25
MIN_ALL_CAPS_WORDS = 3
# Flesch scores are designed for samples of about 100 words or more.
MIN_WORDS_FOR_RELIABLE_READABILITY = 100

_WORD = re.compile(r"\w+(?:['’-]\w+)*")


class TextSpan(StrictModel):
    span_start: int = Field(ge=0)
    span_end: int = Field(gt=0)
    span_text: str = Field(min_length=1)

    @model_validator(mode="after")
    def check_span_length(self) -> Self:
        if self.span_end - self.span_start != len(self.span_text):
            raise ValueError("span_text length must match the span offsets")
        return self


def _span_kwargs(text: str, start: int, end: int) -> dict[str, int | str]:
    return {"span_start": start, "span_end": end, "span_text": text[start:end]}


# Sentence segmentation

_ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "inc", "ltd", "co", "corp",
    "vs", "etc", "e.g", "i.e", "no", "st",
}
_SENTENCE_END = re.compile(r"[.!?]+[\"'”’)\]]*(?=\s|$)|\n\s*\n")


class Sentence(TextSpan):
    word_count: int = Field(ge=0)


def segment_sentences(text: str) -> list[Sentence]:
    sentences: list[Sentence] = []
    start = 0

    def add(end: int) -> None:
        left = start
        right = end
        while left < right and text[left].isspace():
            left += 1
        while right > left and text[right - 1].isspace():
            right -= 1
        if left < right:
            sentences.append(
                Sentence(
                    **_span_kwargs(text, left, right),
                    word_count=len(_WORD.findall(text[left:right])),
                )
            )

    for match in _SENTENCE_END.finditer(text):
        previous = re.search(r"[\w.]+$", text[start : match.start()])
        if (
            match.group(0).startswith(".")
            and previous
            and previous.group(0).lower() in _ABBREVIATIONS
        ):
            continue
        add(match.end())
        start = match.end()
    add(len(text))
    return sentences


# Banned-term lookup


class TermEntry(StrictModel):
    """A terminology entry from the Brand Library."""

    entry_id: UUID
    entry_version: int = Field(ge=1)
    banned: list[str] = Field(default_factory=list)
    preferred: str | None = None


class TermMatch(TextSpan):
    term: str
    preferred: str | None = None
    entry_id: UUID
    entry_version: int


def _term_pattern(term: str) -> re.Pattern[str]:
    words = [re.sub("['’]", "['’]", re.escape(word)) for word in term.split()]
    return re.compile(r"(?<!\w)" + r"\s+".join(words) + r"(?!\w)", re.IGNORECASE)


def lookup_banned_terms(text: str, terms: Iterable[TermEntry]) -> list[TermMatch]:
    """Find banned terms. Longer terms win, and rules banning the same words all report."""
    matches: list[TermMatch] = []
    for entry in terms:
        for term in entry.banned:
            if not term.strip():
                continue
            for match in _term_pattern(term).finditer(text):
                matches.append(
                    TermMatch(
                        **_span_kwargs(text, match.start(), match.end()),
                        term=term,
                        preferred=entry.preferred,
                        entry_id=entry.entry_id,
                        entry_version=entry.entry_version,
                    )
                )

    accepted: list[TermMatch] = []
    for match in sorted(matches, key=lambda item: item.span_start - item.span_end):
        same_span = any(
            match.span_start == item.span_start and match.span_end == item.span_end
            for item in accepted
        )
        overlaps = any(
            match.span_start < item.span_end and item.span_start < match.span_end
            for item in accepted
        )
        if same_span or not overlaps:
            accepted.append(match)
    return sorted(accepted, key=lambda item: (item.span_start, str(item.entry_id)))


# Claim-pattern detection


class ClaimKind(str, Enum):
    RANKING = "ranking"
    SUPERLATIVE = "superlative"
    GUARANTEE = "guarantee"
    STATISTIC = "statistic"


class ClaimCandidate(TextSpan):
    """Text to investigate. A match alone is never a violation."""

    kind: ClaimKind


_NUMBER = r"(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?"
_MAGNITUDE = r"(?:thousand|million|billion|trillion|lakhs?|crores?|mn|bn|cr|[km])"
_COUNTED_NOUN = (
    r"(?:users?|customers?|clients?|downloads?|installs?|subscribers?|members?|companies|"
    r"businesses|brands?|countries|cities|languages?|employees|teams?|reviews?|partners?|"
    r"transactions?|people|organi[sz]ations?|enterprises?|students?|learners?)"
)
_NOUN_QUALIFIER = (
    r"(?:(?:active|registered|paying|monthly|daily|weekly|happy|satisfied|global|verified|"
    r"loyal)\s+)?"
)
_NUMBER_START = r"(?<![\w.,])"

_CLAIM_PATTERNS: dict[ClaimKind, re.Pattern[str]] = {
    ClaimKind.RANKING: re.compile(
        r"(?<!\w)#\s?\d+\b"
        r"|\bno\.?\s?1\b"
        r"|\bnumber[\s-]one\b"
        r"|\btop[\s-]\d+\b"
        r"|\branked\s+(?:#?\d+|first|second|third|top|number\s+\w+)\b"
        r"|\b(?:world|india|asia|europe|america)['’]s\s+first\b"
        r"|\bmarket[\s-]leaders?\b",
        re.IGNORECASE,
    ),
    ClaimKind.SUPERLATIVE: re.compile(
        r"\b(?:best[\s-]in[\s-]class|industry[\s-]leading|world[\s-]class|"
        r"state[\s-]of[\s-]the[\s-]art|best|fastest|cheapest|largest|biggest|strongest|"
        r"safest|smartest|greatest|highest|lowest|leading|unmatched|unrivall?ed|unbeatable|"
        r"unparalleled|most\s+(?:trusted|advanced|popular|reliable|secure|accurate|powerful|"
        r"innovative|affordable|comprehensive))\b",
        re.IGNORECASE,
    ),
    ClaimKind.GUARANTEE: re.compile(
        r"\bguarantee(?:s|d)?\b|\bguaranteeing\b|\brisk[\s-]free\b|\bno[\s-]risk\b"
        r"|\bnever\s+fails?\b|\bzero\s+(?:risk|downtime|errors?)\b|\bmoney[\s-]back\b"
        r"|\bpromise[sd]?\b|\bproven\b"
        r"|(?<!\w)100\s?(?:%|percent|per\s+cent)\s+"
        r"(?:safe|secure|accurate|reliable|effective|free|guaranteed)\b",
        re.IGNORECASE,
    ),
    ClaimKind.STATISTIC: re.compile(
        _NUMBER_START + r"(?:[$₹€£]|(?:rs\.?|inr|usd)\s?)" + _NUMBER
        + r"(?:\s?" + _MAGNITUDE + r"\b)?"
        + r"|" + _NUMBER_START + _NUMBER + r"\s?(?:%|percent\b|per\s+cent\b)"
        + r"|" + _NUMBER_START + _NUMBER + r"(?:x\b|[\s-]times\b)"
        + r"|" + _NUMBER_START + _NUMBER + r"\+?\s?" + _MAGNITUDE + r"\b\+?"
        + r"(?:\s+" + _NOUN_QUALIFIER + _COUNTED_NOUN + r"\b)?"
        + r"|" + _NUMBER_START + _NUMBER + r"\+?\s+" + _NOUN_QUALIFIER + _COUNTED_NOUN + r"\b",
        re.IGNORECASE,
    ),
}


def detect_claim_patterns(text: str) -> list[ClaimCandidate]:
    """Find rankings, superlatives, guarantees and statistics to investigate."""
    found = [
        ClaimCandidate(**_span_kwargs(text, match.start(), match.end()), kind=kind)
        for kind, pattern in _CLAIM_PATTERNS.items()
        for match in pattern.finditer(text)
    ]
    kept = [
        item
        for item in found
        if not any(
            other is not item
            and other.span_start <= item.span_start
            and item.span_end <= other.span_end
            and (other.span_end - other.span_start) > (item.span_end - item.span_start)
            for other in found
        )
    ]
    return sorted(kept, key=lambda item: (item.span_start, item.span_end, item.kind))


# Readability


# textstat needs an NLTK download at runtime, so a failed download would break the
# deterministic fallback. These are the same published formulas, using pyphen directly.
_HYPHENATOR = pyphen.Pyphen(lang="en_US")


class ReadabilityResult(StrictModel):
    word_count: int = Field(ge=0)
    sentence_count: int = Field(ge=0)
    average_words_per_sentence: float = Field(ge=0)
    flesch_reading_ease: float | None = None
    flesch_kincaid_grade: float | None = None
    scores_reliable: bool
    long_sentences: list[Sentence] = Field(default_factory=list)


def _syllable_count(word: str) -> int:
    return len(_HYPHENATOR.positions(word.lower())) + 1


def readability(text: str, long_sentence_words: int = LONG_SENTENCE_WORDS) -> ReadabilityResult:
    """Measure reading complexity. The accessibility specialist interprets the result."""
    sentences = segment_sentences(text)
    word_count = len(_WORD.findall(text))
    if word_count == 0:
        return ReadabilityResult(
            word_count=0,
            sentence_count=0,
            average_words_per_sentence=0,
            scores_reliable=False,
        )
    words_per_sentence = word_count / len(sentences)
    syllables_per_word = sum(_syllable_count(word) for word in _WORD.findall(text)) / word_count
    return ReadabilityResult(
        word_count=word_count,
        sentence_count=len(sentences),
        average_words_per_sentence=round(words_per_sentence, 1),
        flesch_reading_ease=round(206.835 - 1.015 * words_per_sentence - 84.6 * syllables_per_word, 1),
        flesch_kincaid_grade=round(0.39 * words_per_sentence + 11.8 * syllables_per_word - 15.59, 1),
        scores_reliable=word_count >= MIN_WORDS_FOR_RELIABLE_READABILITY,
        long_sentences=[item for item in sentences if item.word_count > long_sentence_words],
    )


# All-caps detection


class AllCapsPassage(TextSpan):
    word_count: int = Field(ge=1)


def detect_all_caps(text: str, min_words: int = MIN_ALL_CAPS_WORDS) -> list[AllCapsPassage]:
    """Find runs of capitalised words. Short runs are left out as likely acronyms."""
    passages: list[AllCapsPassage] = []
    run_start: int | None = None
    run_end = 0
    run_words = 0

    def close_run() -> None:
        nonlocal run_start, run_words
        if run_start is not None and run_words >= min_words:
            passages.append(
                AllCapsPassage(**_span_kwargs(text, run_start, run_end), word_count=run_words)
            )
        run_start = None
        run_words = 0

    for match in _WORD.finditer(text):
        word = match.group(0)
        between = text[run_end : match.start()]
        if run_start is not None and "\n" in between:
            close_run()
        if word.isupper():
            if run_start is None:
                run_start = match.start()
            run_end = match.end()
            run_words += 1
        elif not word.replace(",", "").replace(".", "").isdigit():
            close_run()
    close_run()
    return passages


# Link-text checks


class LinkIssueKind(str, Enum):
    NON_DESCRIPTIVE = "non_descriptive"
    EMPTY = "empty"
    PLAIN_PHRASE = "plain_phrase"


class LinkTextIssue(TextSpan):
    kind: LinkIssueKind
    link_text: str
    url: str | None = None


_NON_DESCRIPTIVE_LINK_TEXT = {
    "click here", "click", "here", "this", "this link", "link", "read more", "learn more",
    "more", "more info", "more information", "details", "go", "go here", "tap here", "see here",
    "see more", "find out more", "continue", "continue reading",
}
_MARKDOWN_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]*)[^)]*\)")
_HTML_LINK = re.compile(
    r"<a\b([^>]*)>(.*?)</a\s*>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_HREF = re.compile(r"""\bhref\s*=\s*["']([^"']*)["']""", re.IGNORECASE)
_PLAIN_PHRASE = re.compile(r"\b(?:click|tap)\s+(?:here|this\s+link)\b", re.IGNORECASE)


def _normalise_link_text(text: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", text).split()).strip(" .,:;!?>»→").lower()


def check_link_text(text: str) -> list[LinkTextIssue]:
    """Find empty or non-descriptive links in Markdown, HTML and pasted plain text."""
    issues: list[LinkTextIssue] = []
    link_ranges: list[tuple[int, int]] = []

    def add_link(whole: re.Match[str], text_group: int, url: str | None) -> None:
        link_ranges.append(whole.span())
        link_text = whole.group(text_group)
        normalised = _normalise_link_text(link_text)
        if not normalised:
            kind = LinkIssueKind.EMPTY
            start, end = whole.span()
        elif normalised in _NON_DESCRIPTIVE_LINK_TEXT:
            kind = LinkIssueKind.NON_DESCRIPTIVE
            start, end = whole.span(text_group)
        else:
            return
        issues.append(
            LinkTextIssue(
                **_span_kwargs(text, start, end),
                kind=kind,
                link_text=link_text.strip(),
                url=url,
            )
        )

    for match in _MARKDOWN_LINK.finditer(text):
        add_link(match, 1, match.group(2) or None)
    for match in _HTML_LINK.finditer(text):
        href = _HTML_HREF.search(match.group(1))
        add_link(match, 2, href.group(1) if href else None)

    for match in _PLAIN_PHRASE.finditer(text):
        if any(start <= match.start() and match.end() <= end for start, end in link_ranges):
            continue
        issues.append(
            LinkTextIssue(
                **_span_kwargs(text, match.start(), match.end()),
                kind=LinkIssueKind.PLAIN_PHRASE,
                link_text=match.group(0),
            )
        )
    return sorted(issues, key=lambda item: item.span_start)


# Text diff


class DiffChange(StrictModel):
    op: Literal["insert", "delete", "replace"]
    before: str
    after: str
    before_start: int = Field(ge=0)
    before_end: int = Field(ge=0)


class DiffResult(StrictModel):
    before_text: str
    after_text: str
    changes: list[DiffChange] = Field(default_factory=list)
    similarity: float = Field(ge=0, le=1)


_DIFF_TOKEN = re.compile(r"\s+|\w+(?:['’-]\w+)*|[^\w\s]")


def _tokens(text: str) -> Sequence[str]:
    return _DIFF_TOKEN.findall(text)


def make_diff(before: str, after: str) -> DiffResult:
    """Return a word-level proposed edit. Nothing is applied to the draft."""
    before_tokens = _tokens(before)
    after_tokens = _tokens(after)
    matcher = difflib.SequenceMatcher(None, before_tokens, after_tokens, autojunk=False)

    positions = [0]
    for token in before_tokens:
        positions.append(positions[-1] + len(token))

    changes = [
        DiffChange(
            op=op,
            before="".join(before_tokens[i1:i2]),
            after="".join(after_tokens[j1:j2]),
            before_start=positions[i1],
            before_end=positions[i2],
        )
        for op, i1, i2, j1, j2 in matcher.get_opcodes()
        if op != "equal"
    ]
    return DiffResult(
        before_text=before,
        after_text=after,
        changes=changes,
        similarity=round(matcher.ratio(), 3),
    )
