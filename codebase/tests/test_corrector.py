"""Tests for the corrector: checked, minimal, grounded suggestions that never edit the draft."""

import asyncio
from uuid import uuid4

import pytest

from harness.corrector import (
    CorrectorAnswer,
    ProposedFix,
    apply_suggestion,
    check_fix,
    needs_fix,
    run_corrector,
)
from harness.deterministic import run_intake_guard
from harness.graph import CORRECTOR_UNAVAILABLE
from harness.library import make_entry_id
from harness.runner import run_brand_check_with_library
from harness.schemas import DisplayStatus, Finding, RunContext, RunEventType, RunMode, Suggestion
from harness.seed import SHOWCASE_DRAFT, seed_repo
from tests.fakes import answer, fake_client
from tests.test_specialists import (
    CLAIMS_ANSWER,
    CONFIRM_BOTH,
    NO_FIXES,
    PLAN,
    QUIET_BRAND,
)

DRAFT = SHOWCASE_DRAFT  # "India's #1 AI-powered platform, trusted by 10 million users."
FACT_001 = {"entry_id": make_entry_id("FACT-001"), "entry_version": 1,
            "quote": "Lumio has 8 million registered users."}
FACT_010 = {"entry_id": make_entry_id("FACT-010"), "entry_version": 1,
            "quote": "Lumio has not been ranked by any independent third party."}


def finding(text="10 million users", status="confirmed", citations=(FACT_001,), suggestion=None,
            category="facts_and_claims", draft=DRAFT, outcome="partially_supported"):
    start = draft.index(text)
    return Finding.model_validate({
        "category": category, "severity": "medium", "display_status": status,
        "claim_outcome": outcome if category == "facts_and_claims" else None,
        "origin": "ai", "confidence": 0.8, "span_start": start, "span_end": start + len(text),
        "span_text": text, "explanation": "Approved facts give 8 million registered users.",
        "produced_by": ["claims_evidence"], "citations": list(citations), "suggestion": suggestion})


def fix(before="10 million users", after="8 million registered users", finding_id="f1",
        rationale="FACT-001 gives 8 million registered users.", keeps_meaning=True, adds_new_claims=False):
    return ProposedFix(finding_id=finding_id, before_text=before, after_text=after, rationale=rationale,
                       keeps_meaning=keeps_meaning, adds_new_claims=adds_new_claims)


def check(proposed, target=None, draft=DRAFT):
    target = target or finding(draft=draft)
    return check_fix(proposed, target, draft, (0, len(draft)), seed_repo())


# Code checks on each proposal


def test_grounded_minimal_fix_is_accepted():
    assert check(fix()) is None


def test_a_deletion_is_allowed():
    target = finding("#1", citations=(FACT_010,), outcome="unsupported")
    assert check(fix(before="#1 ", after=""), target) is None


@pytest.mark.parametrize("proposed, reason", [
    (fix(after="10 million users"), "changes nothing"),
    (fix(before=""), "does not say what to replace"),
    (fix(adds_new_claims=True), "adds a new claim"),
    (fix(keeps_meaning=False), "creator's meaning"),
    (fix(before="million users", after="million learners"), "does not cover the highlighted words"),
    (fix(before="10 million", after="8 million"), "does not cover the highlighted words"),
    (fix(before="trusted by 10 million users", after="trusted by 10 million users and more"),
     "keeps the highlighted words unchanged"),
    (fix(after="9 million registered users"), "number the cited evidence does not support"),
    (fix(after="8 million registered users, the best in India"), "new superlative claim"),
    (fix(after="8 million users, guaranteed"), "new guarantee claim"),
    (fix(after="#1 with 8 million registered users"), "new ranking claim"),
    (fix(after="8 million registered kids"), "banned term"),
    (fix(after="8 MILLION REGISTERED USERS"), "all-caps"),
])
def test_unsafe_or_ineffective_fixes_are_refused(proposed, reason):
    refusal = check(proposed)
    assert refusal is not None and reason in refusal


def test_fix_must_stay_inside_the_highlighted_sentence():
    draft = "Lumio helps you plan. It has 10 million users."
    target = finding(draft=draft)
    proposed = fix(before="plan. It has 10 million users", after="plan. It has 8 million registered users")
    sentence = (draft.index("It has"), len(draft))
    assert "outside the highlighted sentence" in check_fix(proposed, target, draft, sentence, seed_repo())


def test_a_number_already_in_the_passage_may_stay():
    draft = "Over 10 years, 10 million users joined."
    target = finding(draft=draft)
    proposed = fix(before="Over 10 years, 10 million users", after="Over 10 years, 8 million registered users")
    assert check_fix(proposed, target, draft, (0, len(draft)), seed_repo()) is None


# Applying an accepted suggestion


def test_apply_suggestion_replaces_the_covering_occurrence():
    draft = "10 million users love it. Trusted by 10 million users."
    second = draft.rindex("10 million users")
    target = finding(draft=draft).model_copy(update={
        "span_start": second, "span_end": second + 16,
        "suggestion": Suggestion(before_text="10 million users", after_text="8 million registered users",
                                 rationale="r")})
    assert apply_suggestion(draft, target) == "10 million users love it. Trusted by 8 million registered users."


def test_apply_suggestion_refuses_a_draft_that_has_changed():
    target = finding().model_copy(update={"suggestion": Suggestion(
        before_text="10 million users", after_text="8 million registered users", rationale="r")})
    with pytest.raises(ValueError):
        apply_suggestion(DRAFT.replace("10 million", "12 million"), target)


# run_corrector


def context(draft=DRAFT):
    return RunContext(run_id=uuid4(), org_id=uuid4(), submission_version_id=uuid4(), draft=draft,
                      content_type="social post", audience="students", objective="Drive sign-ups",
                      library_version=1)


def correct(findings, *outputs):
    client, model = fake_client(*outputs)
    library = seed_repo()
    outcome = asyncio.run(run_corrector(client, findings, context(), run_intake_guard(DRAFT, library),
                                        "Promote Lumio to new learners.", library))
    return outcome, model


def fixes(*items):
    return answer(CorrectorAnswer.model_validate({"fixes": [item.model_dump() for item in items]}))


def test_only_confirmed_findings_without_a_suggestion_are_sent():
    existing = Suggestion(before_text="#1", after_text="", rationale="r")
    findings = [finding(), finding("#1", status="needs_human_verification", outcome="unsupported"),
                finding("AI-powered", category="tone", suggestion=existing)]
    assert [needs_fix(f) for f in findings] == [True, False, False]
    outcome, model = correct(findings, fixes(fix()))
    prompt = model.calls[0][1][1].content
    assert "f1: facts_and_claims" in prompt and "f2:" not in prompt
    assert "[FACT-001] Lumio has 8 million registered users." in prompt
    assert "Creator's intent: Promote Lumio to new learners." in prompt
    assert "<untrusted_draft>" in prompt


def test_accepted_fix_is_attached_and_order_is_kept():
    findings = [finding("#1", status="needs_human_verification", outcome="unsupported"), finding()]
    outcome, _ = correct(findings, fixes(fix()))
    assert outcome.findings[0] == findings[0]
    suggestion = outcome.findings[1].suggestion
    assert (suggestion.before_text, suggestion.after_text) == ("10 million users", "8 million registered users")
    assert outcome.suggested[0]["changes"] == 2  # "10" to "8", and "registered" added
    assert outcome.notes == []


def test_refused_fix_leaves_the_finding_without_a_suggestion():
    outcome, _ = correct([finding()], fixes(fix(after="9 million registered users")))
    assert outcome.findings[0].suggestion is None
    assert "No suggestion for \"10 million users\"" in outcome.notes[0]


def test_rationale_calling_a_claim_false_fails_the_wording_gate():
    outcome, _ = correct([finding()], fixes(fix(rationale="The original number is false.")))
    assert outcome.findings[0].suggestion is None
    assert "wording gate" in outcome.notes[0]


def test_unknown_and_duplicate_fixes_are_ignored():
    outcome, _ = correct([finding()], fixes(fix(finding_id="f7"), fix(), fix(after="8 million registered users!")))
    assert outcome.findings[0].suggestion.after_text == "8 million registered users"
    assert any("unknown finding f7" in note for note in outcome.notes)
    assert any("second fix for f1" in note for note in outcome.notes)


def test_model_failure_returns_findings_unchanged():
    outcome, _ = correct([finding()], RuntimeError("down"), RuntimeError("down"))
    assert outcome.failed and outcome.findings[0].suggestion is None
    assert outcome.llm_call["attempts"] == 2


def test_nothing_to_fix_means_no_model_call():
    outcome, model = correct([finding(status="needs_human_verification")])
    assert model.calls == [] and outcome.llm_call is None


# Through the whole graph


SHOWCASE_FIXES = CorrectorAnswer.model_validate({"fixes": [
    fix(before="India's #1 AI-powered platform", after="An AI-powered platform from India",
        rationale="FACT-010 says Lumio has not been ranked, so the ranking is removed."),
    fix(finding_id="f2"),
]})


def run(llm, draft=DRAFT):
    events = []

    async def emit(event):
        events.append(event)

    result = asyncio.run(run_brand_check_with_library(context(draft), emit, seed_repo(), llm=llm))
    return result, events


def full_run(corrector_outputs):
    client, model = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [CONFIRM_BOTH],
        "CorrectorAnswer": corrector_outputs,
    })
    return run(client) + (model,)


def test_showcase_draft_gets_grounded_suggestions():
    result, events, model = full_run([answer(SHOWCASE_FIXES)])
    by_text = {f.span_text: f for f in result.findings}
    ranking, users = by_text["#1"], by_text["10 million users"]
    assert ranking.suggestion.after_text == "An AI-powered platform from India"
    assert users.suggestion.after_text == "8 million registered users"
    assert apply_suggestion(DRAFT, users) == "India's #1 AI-powered platform, trusted by 8 million registered users."
    diffs = [e for e in events if e.type is RunEventType.TOOL_CALLED and e.node == "corrector"]
    assert [e.data["tool"] for e in diffs] == ["make_diff", "make_diff"]
    assert events[-1].data["counters"]["suggestions"] == 2
    assert "corrector.v1" in result.prompt_version
    assert result.degraded_reason is None


def test_corrector_failure_keeps_confirmed_findings():
    result, _, _ = full_run([RuntimeError("down"), RuntimeError("down")])
    assert result.mode is RunMode.FULL
    assert result.degraded_reason == CORRECTOR_UNAVAILABLE
    assert all(f.display_status is DisplayStatus.CONFIRMED and f.suggestion is None for f in result.findings)


def test_rule_based_runs_never_call_the_corrector():
    result, _ = run(None)
    assert result.mode is RunMode.DETERMINISTIC_ONLY
    assert all(f.suggestion is None for f in result.findings if f.category.value == "facts_and_claims")


def test_rule_based_term_suggestions_are_not_sent_again():
    draft = "Our kids plan is #1."
    client, model = fake_client(
        answer(PLAN.model_copy(update={"tasks": [], "skipped": []})),
        by_schema={"CorrectorAnswer": [NO_FIXES]})
    result, _ = run(client, draft)
    kids = next(f for f in result.findings if f.span_text == "kids")
    assert kids.suggestion.after_text == "learners"  # from the term rule, untouched
    assert model.calls_for("CorrectorAnswer") == []
