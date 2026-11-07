"""Deterministic gates that run outside the LLM (TRD Section 5.3).

Gate order is schema, citation, span, wording. A candidate stops at its first
failure, and rejected candidates are returned for logging in run_steps.

The critic verdict gate (TRD 5.3, item 4) is added with the critic in Block 2.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from harness.schemas import Category, Finding, RejectedFinding

CitationKey = tuple[UUID, int]

SCHEMA_GATE = "schema"
CITATION_GATE = "citation"
SPAN_GATE = "span"
WORDING_GATE = "wording"

# Missing evidence must never be presented as proof that a claim is wrong.
_PROHIBITED_CLAIM_WORDING = re.compile(
    r"\b(?:false|falsely|falsehood|untrue|(?:is|are|was|were)\s+(?:wrong|incorrect))\b",
    re.IGNORECASE,
)


class GateRejection(Exception):
    """Raised when a candidate fails a gate."""

    def __init__(self, gate: str, reason: str) -> None:
        super().__init__(f"{gate}: {reason}")
        self.gate = gate
        self.reason = reason


@dataclass
class GateReport:
    passed: list[Finding] = field(default_factory=list)
    rejected: list[RejectedFinding] = field(default_factory=list)


def schema_gate(candidate: Any) -> Finding:
    """Parse a Finding, a dict or JSON text into a validated Finding."""
    try:
        if isinstance(candidate, Finding):
            return Finding.model_validate(candidate.model_dump())
        if isinstance(candidate, (str, bytes, bytearray)):
            return Finding.model_validate_json(candidate)
        return Finding.model_validate(candidate)
    except ValidationError as error:
        problems = error.errors(include_input=False, include_url=False)
        details = "; ".join(
            f"{'.'.join(str(part) for part in problem['loc']) or 'finding'}: {problem['msg']}"
            for problem in problems
        )
        raise GateRejection(SCHEMA_GATE, details) from error


def citation_gate(finding: Finding, valid_citations: Collection[CitationKey]) -> None:
    """Require each citation to be in the org's active library for this run.

    The caller builds valid_citations from the library version used by the run,
    so unknown IDs, other organisations' entries, inactive entries and old
    versions are all absent from it.
    """
    for citation in finding.citations:
        key = (citation.entry_id, citation.entry_version)
        if key not in valid_citations:
            raise GateRejection(
                CITATION_GATE,
                f"citation {citation.entry_id} v{citation.entry_version} "
                "is not active in this run's library",
            )


def span_gate(finding: Finding, draft: str) -> None:
    """Require draft[span_start:span_end] to equal span_text exactly."""
    if finding.span_end > len(draft):
        raise GateRejection(
            SPAN_GATE,
            f"span end {finding.span_end} is past the draft length {len(draft)}",
        )
    if draft[finding.span_start : finding.span_end] != finding.span_text:
        raise GateRejection(
            SPAN_GATE,
            f"draft text at {finding.span_start}:{finding.span_end} does not match span_text",
        )


def wording_gate(finding: Finding) -> None:
    """Enforce claim labels and block wording that overstates missing evidence."""
    is_claim = finding.category is Category.FACTS_AND_CLAIMS

    if is_claim and finding.claim_outcome is None:
        raise GateRejection(WORDING_GATE, "a facts and claims finding needs a claim outcome")
    if not is_claim and finding.claim_outcome is not None:
        raise GateRejection(WORDING_GATE, "only a facts and claims finding can have a claim outcome")
    if not is_claim:
        return

    texts = {"explanation": finding.explanation}
    if finding.suggestion is not None:
        texts["suggestion rationale"] = finding.suggestion.rationale

    for name, text in texts.items():
        # The draft's own words may be quoted, as in a claim of "no false alarms".
        match = _PROHIBITED_CLAIM_WORDING.search(text.replace(finding.span_text, " "))
        if match:
            raise GateRejection(
                WORDING_GATE,
                f'{name} uses prohibited claim wording: "{match.group(0)}"',
            )


def apply_gates(
    candidates: Iterable[Any],
    draft: str,
    valid_citations: Collection[CitationKey],
) -> GateReport:
    """Run every candidate through the gates and separate passes from rejections."""
    report = GateReport()
    for candidate in candidates:
        try:
            finding = schema_gate(candidate)
            citation_gate(finding, valid_citations)
            span_gate(finding, draft)
            wording_gate(finding)
        except GateRejection as rejection:
            report.rejected.append(
                RejectedFinding(
                    gate=rejection.gate,
                    reason=rejection.reason,
                    candidate=_as_log_record(candidate),
                )
            )
        else:
            report.passed.append(finding)
    return report


def _as_log_record(candidate: Any) -> dict[str, Any]:
    if isinstance(candidate, Finding):
        return candidate.model_dump(mode="json")
    if isinstance(candidate, dict):
        return candidate
    return {"raw": repr(candidate)}
