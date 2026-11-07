"""aggregate: merge rule-based and AI findings into one list (TRD 5.2).

Rules, applied in order:
1. An AI claim assessment replaces the rule-based "needs a check" placeholder on the same
   passage, because the specialist actually assessed the evidence. If the AI finding has no
   citation, it keeps the placeholder's claim-rule citation.
2. A confirmed rule-based finding wins over an AI finding of the same category on an
   overlapping passage, so exact rule matches are not shown twice.
3. Two AI findings of the same category on overlapping passages of similar length are merged,
   keeping the more severe (then more confident) one and both sets of citations. A short,
   specific finding is never folded into a much longer one: both are kept.
4. A rule-based "needs a check" placeholder is removed when a specialist judged that claim
   supported AND code confirms it: the specialist cited at least one approved fact, and every
   number in the claim appears in those facts. A ranking, superlative or guarantee with no
   number keeps its placeholder, because code cannot confirm it.
Findings of different categories on the same words are all kept: they cite different rules.
"""

from __future__ import annotations

import re
from typing import Iterable, List, Sequence, Tuple

from harness.schemas import Category, DisplayStatus, Finding, Origin

_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def _numbers(text: str) -> set:
    return {match.replace(",", "") for match in _NUMBER.findall(text)}


def _confirmed_support(placeholder: Finding, supported: Sequence) -> bool:
    numbers = _numbers(placeholder.span_text)
    if not numbers:
        return False
    for claim in supported:
        overlaps = claim.span_start < placeholder.span_end and placeholder.span_start < claim.span_end
        if overlaps and claim.fact_quotes and numbers <= set().union(*map(_numbers, claim.fact_quotes)):
            return True
    return False


def _overlaps(a: Finding, b: Finding) -> bool:
    return a.span_start < b.span_end and b.span_start < a.span_end


def _merge_citations(*groups: Iterable) -> list:
    seen = {}
    for group in groups:
        for citation in group:
            seen.setdefault((citation.entry_id, citation.entry_version), citation)
    return list(seen.values())


def _similar_length(a: Finding, b: Finding) -> bool:
    shorter, longer = sorted((a.span_end - a.span_start, b.span_end - b.span_start))
    return shorter * 2 >= longer


def _rank(finding: Finding) -> Tuple[int, float]:
    return (_SEVERITY_RANK[finding.severity.value], -finding.confidence)


def aggregate_findings(
    rule_based: List[Finding], ai: List[Finding], supported: Sequence = ()
) -> Tuple[List[Finding], List[str]]:
    notes: List[str] = []
    superseded = set()
    for index, base in enumerate(rule_based):
        if (base.origin is Origin.RULE_BASED and base.category is Category.FACTS_AND_CLAIMS
                and _confirmed_support(base, supported)):
            superseded.add(index)
            notes.append(f'Approved facts support "{base.span_text}", so its rule-based check was cleared.')
    kept_ai: List[Finding] = []

    for finding in sorted(ai, key=lambda f: (f.span_start, f.span_end)):
        if finding.category is Category.FACTS_AND_CLAIMS:
            placeholders = [
                (index, base) for index, base in enumerate(rule_based)
                if base.origin is Origin.RULE_BASED
                and base.category is Category.FACTS_AND_CLAIMS
                and _overlaps(base, finding)
            ]
            if placeholders:
                for index, base in placeholders:
                    superseded.add(index)
                    notes.append(f'The AI claim assessment replaced the rule-based check of "{base.span_text}".')
                if not finding.citations:
                    finding = finding.model_copy(update={
                        "citations": _merge_citations(*(base.citations for _, base in placeholders))})
        else:
            covered = next(
                (base for base in rule_based
                 if base.origin is Origin.RULE_BASED
                 and base.display_status is DisplayStatus.CONFIRMED
                 and base.category is finding.category
                 and _overlaps(base, finding)),
                None,
            )
            if covered is not None:
                notes.append(
                    f'Kept the rule-based {finding.category.value} finding for "{covered.span_text}" '
                    "instead of the AI duplicate.")
                continue

        duplicate = next(
            (index for index, other in enumerate(kept_ai)
             if other.category is finding.category and _overlaps(other, finding)
             and _similar_length(other, finding)),
            None,
        )
        if duplicate is None:
            kept_ai.append(finding)
            continue
        other = kept_ai[duplicate]
        winner, loser = (finding, other) if _rank(finding) < _rank(other) else (other, finding)
        kept_ai[duplicate] = winner.model_copy(update={
            "citations": _merge_citations(winner.citations, loser.citations),
            "produced_by": list(dict.fromkeys(winner.produced_by + loser.produced_by)),
        })
        notes.append(f'Merged two AI {finding.category.value} findings on "{winner.span_text}".')

    merged = [f for index, f in enumerate(rule_based) if index not in superseded] + kept_ai
    merged.sort(key=lambda f: (f.span_start, f.span_end, f.category.value))
    return merged, notes
