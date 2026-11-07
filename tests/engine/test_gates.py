"""Contract tests for the deterministic gates. Each rejection has its own test."""

import json
from uuid import UUID, uuid4

import pytest

from gates import (
    CITATION_GATE,
    SCHEMA_GATE,
    SPAN_GATE,
    WORDING_GATE,
    apply_gates,
)
from harness.schemas import Finding, HarnessResult

DRAFT = "India's #1 AI-powered platform, trusted by 10 million users."
RANKING_START = DRAFT.index("#1")
ACTIVE_ENTRY = UUID("11111111-1111-1111-1111-111111111111")
INACTIVE_ENTRY = UUID("22222222-2222-2222-2222-222222222222")
OTHER_ORG_ENTRY = UUID("33333333-3333-3333-3333-333333333333")
VALID_CITATIONS = frozenset({(ACTIVE_ENTRY, 2)})


def candidate(**changes):
    """Return a candidate that passes every gate, with optional changes."""
    data = {
        "category": "facts_and_claims",
        "severity": "high",
        "display_status": "confirmed",
        "claim_outcome": "unsupported",
        "origin": "ai",
        "confidence": 0.82,
        "span_start": RANKING_START,
        "span_end": RANKING_START + 2,
        "span_text": "#1",
        "explanation": "Unsupported claim: it needs evidence or an approved fact.",
        "produced_by": ["claims_evidence"],
        "citations": [
            {
                "entry_id": str(ACTIVE_ENTRY),
                "entry_version": 2,
                "quote": "Rankings require approved evidence.",
            }
        ],
    }
    data.update(changes)
    return data


def tone_candidate(**changes):
    """Return a passing tone finding, which has no claim outcome."""
    span_start = DRAFT.index("trusted")
    return candidate(
        category="tone",
        claim_outcome=None,
        span_start=span_start,
        span_end=span_start + len("trusted"),
        span_text="trusted",
        explanation="This wording is more casual than the tone rule allows.",
        produced_by=["brand_consistency"],
        **changes,
    )


def run(item, draft=DRAFT, valid_citations=VALID_CITATIONS):
    return apply_gates([item], draft, valid_citations)


def assert_rejected(report, gate):
    assert report.passed == []
    assert len(report.rejected) == 1
    assert report.rejected[0].gate == gate
    assert report.rejected[0].reason


# Candidates that should pass


def test_valid_claim_finding_passes():
    report = run(candidate())
    assert report.rejected == []
    assert isinstance(report.passed[0], Finding)
    assert report.passed[0].span_text == "#1"


def test_valid_tone_finding_passes():
    report = run(tone_candidate())
    assert report.rejected == []
    assert len(report.passed) == 1


def test_finding_instance_passes():
    report = run(Finding.model_validate(candidate()))
    assert report.rejected == []


def test_valid_json_text_passes():
    report = run(json.dumps(candidate()))
    assert report.rejected == []


def test_uncited_needs_verification_finding_passes():
    report = run(candidate(display_status="needs_human_verification", citations=[]))
    assert report.rejected == []


@pytest.mark.parametrize(
    "outcome",
    [
        "supported",
        "unsupported",
        "partially_supported",
        "conflicting_evidence",
        "needs_human_verification",
    ],
)
def test_all_allowed_claim_outcomes_pass(outcome):
    assert run(candidate(claim_outcome=outcome)).rejected == []


# Schema gate rejections


def test_schema_rejects_malformed_json():
    assert_rejected(run('{"category": "tone"'), SCHEMA_GATE)


@pytest.mark.parametrize("value", [None, 42, ["not", "a", "finding"]])
def test_schema_rejects_non_object_output(value):
    assert_rejected(run(value), SCHEMA_GATE)


def test_schema_rejects_missing_required_field():
    data = candidate()
    del data["explanation"]
    assert_rejected(run(data), SCHEMA_GATE)


def test_schema_rejects_unknown_field():
    assert_rejected(run(candidate(approve_submission=True)), SCHEMA_GATE)


def test_schema_rejects_invalid_category():
    assert_rejected(run(candidate(category="legal")), SCHEMA_GATE)


def test_schema_rejects_invalid_severity():
    assert_rejected(run(candidate(severity="critical")), SCHEMA_GATE)


def test_schema_rejects_false_claim_label():
    assert_rejected(run(candidate(claim_outcome="false")), SCHEMA_GATE)


@pytest.mark.parametrize("confidence", [-0.1, 1.1])
def test_schema_rejects_confidence_out_of_range(confidence):
    assert_rejected(run(candidate(confidence=confidence)), SCHEMA_GATE)


def test_schema_rejects_confirmed_finding_without_citation():
    assert_rejected(run(candidate(citations=[])), SCHEMA_GATE)


def test_schema_rejects_reversed_span():
    report = run(candidate(span_start=RANKING_START + 2, span_end=RANKING_START))
    assert_rejected(report, SCHEMA_GATE)


# Citation gate rejections


def test_citation_rejects_unknown_entry_id():
    citation = {"entry_id": str(uuid4()), "entry_version": 2, "quote": "Invented rule"}
    assert_rejected(run(candidate(citations=[citation])), CITATION_GATE)


def test_citation_rejects_wrong_version():
    citation = {"entry_id": str(ACTIVE_ENTRY), "entry_version": 1, "quote": "Old rule"}
    assert_rejected(run(candidate(citations=[citation])), CITATION_GATE)


def test_citation_rejects_inactive_entry():
    citation = {"entry_id": str(INACTIVE_ENTRY), "entry_version": 1, "quote": "Retired rule"}
    assert_rejected(run(candidate(citations=[citation])), CITATION_GATE)


def test_citation_rejects_other_organisations_entry():
    citation = {"entry_id": str(OTHER_ORG_ENTRY), "entry_version": 1, "quote": "Other org"}
    assert_rejected(run(candidate(citations=[citation])), CITATION_GATE)


def test_citation_rejects_when_any_citation_is_invalid():
    citations = [
        {"entry_id": str(ACTIVE_ENTRY), "entry_version": 2, "quote": "Real rule"},
        {"entry_id": str(uuid4()), "entry_version": 1, "quote": "Invented rule"},
    ]
    assert_rejected(run(candidate(citations=citations)), CITATION_GATE)


def test_citation_rejects_invalid_citation_on_unconfirmed_finding():
    citation = {"entry_id": str(uuid4()), "entry_version": 1, "quote": "Invented rule"}
    report = run(candidate(display_status="needs_human_verification", citations=[citation]))
    assert_rejected(report, CITATION_GATE)


def test_citation_rejects_everything_when_library_is_empty():
    assert_rejected(run(candidate(), valid_citations=frozenset()), CITATION_GATE)


# Span gate rejections


def test_span_rejects_text_that_does_not_match_offsets():
    report = run(candidate(span_text="AI"))
    assert_rejected(report, SPAN_GATE)


def test_span_rejects_case_difference():
    start = DRAFT.index("trusted")
    report = run(
        tone_candidate() | {"span_start": start, "span_end": start + 7, "span_text": "Trusted"}
    )
    assert_rejected(report, SPAN_GATE)


def test_span_rejects_offsets_past_end_of_draft():
    end = len(DRAFT) + 2
    report = run(candidate(span_start=end - 2, span_end=end, span_text="#1"))
    assert_rejected(report, SPAN_GATE)


def test_span_rejects_empty_draft():
    assert_rejected(run(candidate(), draft=""), SPAN_GATE)


def test_span_uses_python_string_offsets_with_emoji():
    draft = "🚀🚀 #1 platform"
    start = draft.index("#1")
    report = run(candidate(span_start=start, span_end=start + 2), draft=draft)
    assert report.rejected == []


# Wording gate rejections


@pytest.mark.parametrize(
    "explanation",
    [
        "This claim is false.",
        "THIS CLAIM IS FALSE.",
        "The ranking is untrue.",
        "This statement is falsely presented.",
        "This is a falsehood.",
        "The figure is wrong.",
        "These numbers are incorrect.",
        "The claim was\nwrong.",
    ],
)
def test_wording_rejects_prohibited_explanation(explanation):
    assert_rejected(run(candidate(explanation=explanation)), WORDING_GATE)


def test_wording_rejects_prohibited_suggestion_rationale():
    suggestion = {
        "before_text": "#1",
        "after_text": "a leading",
        "rationale": "The original ranking is false.",
    }
    assert_rejected(run(candidate(suggestion=suggestion)), WORDING_GATE)


def test_wording_rejects_claim_finding_without_outcome():
    assert_rejected(run(candidate(claim_outcome=None)), WORDING_GATE)


def test_wording_rejects_outcome_on_non_claim_finding():
    report = run(tone_candidate() | {"claim_outcome": "unsupported"})
    assert_rejected(report, WORDING_GATE)


def test_wording_allows_prohibited_word_inside_quoted_draft_text():
    draft = "Our tool gives no false alarms."
    text = "no false alarms"
    start = draft.index(text)
    report = run(
        candidate(
            span_start=start,
            span_end=start + len(text),
            span_text=text,
            explanation=f'The claim "{text}" is unsupported and needs an approved fact.',
        ),
        draft=draft,
    )
    assert report.rejected == []


def test_wording_still_rejects_prohibited_word_outside_quoted_draft_text():
    draft = "Our tool gives no false alarms."
    text = "no false alarms"
    start = draft.index(text)
    report = run(
        candidate(
            span_start=start,
            span_end=start + len(text),
            span_text=text,
            explanation=f'The claim "{text}" is false.',
        ),
        draft=draft,
    )
    assert_rejected(report, WORDING_GATE)


def test_wording_allows_false_in_non_claim_finding():
    report = run(
        tone_candidate()
        | {"explanation": "This phrase sounds like false modesty, which the tone rule discourages."}
    )
    assert report.rejected == []


def test_wording_does_not_match_inside_other_words():
    report = run(candidate(explanation="Unsupported claim that may be falsifiable with evidence."))
    assert report.rejected == []


# Pipeline behaviour


def test_each_candidate_stops_at_its_first_failed_gate():
    citation = {"entry_id": str(uuid4()), "entry_version": 1, "quote": "Invented rule"}
    report = run(candidate(citations=[citation], span_text="AI", explanation="This is false."))
    assert_rejected(report, CITATION_GATE)


def test_one_rejection_does_not_affect_other_candidates():
    report = apply_gates(
        [candidate(), "not json", candidate(span_text="AI"), tone_candidate()],
        DRAFT,
        VALID_CITATIONS,
    )
    assert len(report.passed) == 2
    assert [item.gate for item in report.rejected] == [SCHEMA_GATE, SPAN_GATE]


def test_rejections_can_be_saved_in_harness_result():
    finding = Finding.model_validate(candidate())
    report = apply_gates(
        [finding.model_copy(update={"span_text": "AI"}), "not json", None],
        DRAFT,
        VALID_CITATIONS,
    )
    result = HarnessResult(
        mode="full",
        findings=report.passed,
        rejected=report.rejected,
        library_version=1,
    )
    saved = json.loads(result.model_dump_json())
    assert len(saved["rejected"]) == 3
