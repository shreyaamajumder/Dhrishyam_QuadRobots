"""aggregate: merge rule-based and AI findings into one list (TRD 5.2).

Rules, applied in order:
1. An AI claim assessment replaces the rule-based "needs a check" placeholder on the same
   passage, because the specialist actually assessed the evidence. If the AI finding has no
   citation, it keeps the placeholder's claim-rule citation.
2. A confirmed rule-based finding wins over an AI finding of the same category on an
   overlapping passage, so exact rule matches are not shown twice.
3. Two AI findings of the same category on overlapping passages are merged, keeping the more
   severe (then more confident) one and both sets of citations.
Findings of different categories on the same words are all kept: they cite different rules.
"""

from __future__ import annotations

from typing import Iterable, List, Tuple

from harness.schemas import Category, DisplayStatus, Finding, Origin

_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _overlaps(a: Finding, b: Finding) -> bool:
    return a.span_start < b.span_end and b.span_start < a.span_end


def _merge_citations(*groups: Iterable) -> list:
    seen = {}
    for group in groups:
        for citation in group:
            seen.setdefault((citation.entry_id, citation.entry_version), citation)
    return list(seen.values())


def _rank(finding: Finding) -> Tuple[int, float]:
    return (_SEVERITY_RANK[finding.severity.value], -finding.confidence)


def aggregate_findings(
    rule_based: List[Finding], ai: List[Finding]
) -> Tuple[List[Finding], List[str]]:
    notes: List[str] = []
    superseded = set()
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
             if other.category is finding.category and _overlaps(other, finding)),
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
