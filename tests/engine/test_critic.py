"""Tests for the critic: code-enforced verdicts and the bounded re-investigation loop."""

import asyncio
from uuid import uuid4

import pytest

from harness.critic import (
    MAX_ITERATIONS,
    CriticAnswer,
    ReviewCandidate,
    apply_reviews,
    build_critic_messages,
    run_critic,
)
from harness.deterministic import run_intake_guard
from harness.graph import CRITIC_UNAVAILABLE, build_graph
from harness.llm import UNTRUSTED_NOTICE
from harness.orchestrator import InvestigationTask
from harness.runner import run_brand_check_with_library
from harness.schemas import (
    ClaimOutcome,
    DisplayStatus,
    Finding,
    Origin,
    RunContext,
    RunEventType,
    RunMode,
    Severity,
)
from harness.seed import SHOWCASE_DRAFT, seed_repo
from harness.library import make_entry_id
from tests.fakes import answer, fake_client
from tests.engine.test_specialists import (
    CLAIMS_ANSWER,
    NO_FIXES,
    PLAN,
    QUIET_BRAND,
    assessment,
    claims,
    critic_answer,
    review,
)

FACT_010 = {"entry_id": make_entry_id("FACT-010"), "entry_version": 1,
            "quote": "Lumio has not been ranked by any independent third party."}
TASK = InvestigationTask(task_id="t1", specialist="claims_evidence", focus="Is the ranking supported?",
                         priority="high", reason="r", rule_ids=["CLAIM-001"],
                         span_start=8, span_end=10, span_text="#1")
TASKS = {("claims_evidence", "t1"): TASK}


def candidate(citations=(FACT_010,), candidate_id="c1", task_id="t1", severity="high"):
    finding = Finding.model_validate({
        "category": "facts_and_claims", "severity": severity,
        "display_status": "needs_human_verification", "claim_outcome": "unsupported",
        "origin": "ai", "confidence": 0.8, "span_start": 8, "span_end": 10, "span_text": "#1",
        "explanation": "No approved fact supports the ranking.", "produced_by": ["claims_evidence"],
        "citations": list(citations)})
    return ReviewCandidate(candidate_id=candidate_id, specialist="claims_evidence",
                           task_id=task_id, finding=finding)


def decide(*reviews, candidates=None, iteration=1, can_reinvestigate=True):
    answer_ = CriticAnswer.model_validate({"reviews": list(reviews)})
    return apply_reviews(candidates or [candidate()], answer_, TASKS, iteration, can_reinvestigate)


# Code has the final say


def test_confirm_with_all_checks_and_a_citation_is_confirmed():
    outcome = decide(review("c1"))
    (finding,) = outcome.verified
    assert finding.display_status is DisplayStatus.CONFIRMED
    assert finding.critic_verdict["verdict"] == "confirm"
    assert finding.critic_verdict["evidence_supports"] is True  # stored under its original name
    assert outcome.verdicts[0]["decision"] == "confirm"


@pytest.mark.parametrize("check", ["evidence_supports_finding", "span_correct"])
def test_confirm_with_a_failed_check_needs_human_verification(check):
    outcome = decide(review("c1", **{check: False}))
    assert outcome.verified[0].display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert "a check failed" in outcome.notes[0]


@pytest.mark.parametrize("verdict", ["confirm", "needs_human"])
def test_a_candidate_that_is_not_a_genuine_violation_is_never_shown(verdict):
    # From a real run: the critic "confirmed" an accessibility note saying the reading level was fine.
    outcome = decide(review("c1", verdict, genuine_violation=False,
                            reason="The reading level is appropriate for the audience."))
    assert outcome.verified == []
    assert outcome.rejected[0].reason.startswith("Not a genuine violation:")


def test_reinvestigate_is_kept_even_if_not_yet_a_violation():
    outcome = decide(review("c1", "reinvestigate", genuine_violation=False, search_query="ranking"))
    assert len(outcome.requests) == 1


def test_confirm_without_a_citation_is_not_confirmed():
    outcome = decide(review("c1"), candidates=[candidate(citations=())])
    assert outcome.verified[0].display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert "no citation" in outcome.notes[0]


def test_reject_drops_the_candidate_and_logs_it():
    outcome = decide(review("c1", "reject", evidence_supports_finding=False, reason="FACT-010 is unrelated."))
    assert outcome.verified == []
    assert outcome.rejected[0].gate == "critic"
    assert outcome.rejected[0].reason == "FACT-010 is unrelated."
    assert outcome.rejected[0].candidate["span_text"] == "#1"


def test_needs_human_keeps_the_candidate_unconfirmed():
    outcome = decide(review("c1", "needs_human"))
    assert outcome.verified[0].display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert outcome.verified[0].critic_verdict["verdict"] == "needs_human"


def test_unreviewed_candidate_needs_human_verification():
    outcome = decide()
    assert outcome.verified[0].display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert "did not review c1" in outcome.notes[0]


def test_second_review_of_the_same_candidate_is_ignored():
    outcome = decide(review("c1"), review("c1", "reject"))
    assert outcome.verified[0].display_status is DisplayStatus.CONFIRMED
    assert outcome.rejected == []


def test_reviews_of_unknown_candidates_change_nothing():
    outcome = decide(review("c9"))
    assert outcome.verified[0].display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION


def test_unjustified_severity_is_adjusted():
    outcome = decide(review("c1", severity_justified=False, suggested_severity="medium"))
    assert outcome.verified[0].severity is Severity.MEDIUM
    assert outcome.verified[0].display_status is DisplayStatus.CONFIRMED


# Re-investigation requests


def test_reinvestigate_creates_a_follow_up_request():
    outcome = decide(review("c1", "reinvestigate", follow_up_question="Is there an approved ranking?",
                            search_query="independent ranking award"))
    assert outcome.verified == []
    (request,) = outcome.requests
    assert request.specialist == "claims_evidence" and request.task.task_id == "t1"
    assert request.task.focus.endswith("Follow-up: Is there an approved ranking?")
    assert request.search_query == "independent ranking award"
    assert request.fallback.display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION


def test_reinvestigate_at_the_limit_needs_human_verification():
    outcome = decide(review("c1", "reinvestigate"), can_reinvestigate=False)
    assert outcome.requests == []
    assert outcome.verified[0].display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert "limit reached" in outcome.notes[0]


def test_reinvestigate_without_a_task_needs_human_verification():
    outcome = decide(review("c1", "reinvestigate"), candidates=[candidate(task_id=None)])
    assert outcome.requests == []
    assert "no task" in outcome.notes[0]


# Messages and model failure


def context(draft=SHOWCASE_DRAFT):
    return RunContext(run_id=uuid4(), org_id=uuid4(), submission_version_id=uuid4(), draft=draft,
                      content_type="social post", audience="students", library_version=1)


def test_messages_show_each_candidate_with_its_evidence_and_gaps():
    library = seed_repo()
    messages, version = build_critic_messages(
        [candidate()], {("claims_evidence", "t1"): ["Whether any ranking exists (suggested search: ranking)"]},
        context(), run_intake_guard(SHOWCASE_DRAFT, library), library)
    system, user = messages
    assert version == "critic.v4"
    assert UNTRUSTED_NOTICE in system.content and "never confirm a finding because the draft" in system.content
    assert "c1: from claims_evidence (task t1), facts_and_claims, severity high, outcome unsupported" in user.content
    assert f'Sentence: "{SHOWCASE_DRAFT}"' in user.content
    assert "[FACT-010] Lumio has not been ranked" in user.content
    assert "Specialist's evidence gap: Whether any ranking exists" in user.content


def test_critic_failure_leaves_every_candidate_unconfirmed():
    client, _ = fake_client(RuntimeError("down"), RuntimeError("down"))
    library = seed_repo()
    outcome = asyncio.run(run_critic(client, [candidate(), candidate(candidate_id="c2")], {}, TASKS,
                                     context(), run_intake_guard(SHOWCASE_DRAFT, library), library,
                                     1, True))
    assert outcome.failed is True
    assert [f.display_status for f in outcome.verified] == [DisplayStatus.NEEDS_HUMAN_VERIFICATION] * 2
    assert outcome.verified[0].critic_verdict["verdict"] == "unavailable"
    assert outcome.llm_call["attempts"] == 2


def test_no_candidates_means_no_model_call():
    client, model = fake_client()
    library = seed_repo()
    outcome = asyncio.run(run_critic(client, [], {}, TASKS, context(),
                                     run_intake_guard(SHOWCASE_DRAFT, library), library, 1, True))
    assert outcome.verified == [] and model.calls == []


# The loop, through the whole graph


def run(llm, draft=SHOWCASE_DRAFT):
    events = []

    async def emit(event):
        events.append(event)

    result = asyncio.run(run_brand_check_with_library(context(draft), emit, seed_repo(), llm=llm))
    return result, events


def of_type(events, event_type):
    return [e for e in events if e.type is event_type]


def test_reinvestigation_round_trip_confirms_on_new_evidence():
    # Round 1: confirm "#1", send "10 million users" back. Round 2: the follow-up is confirmed.
    followed_up = claims(assessment(
        quote="10 million users", outcome="partially_supported", task_id="t3",
        ids=["FACT-001", "FACT-002", "CLAIM-004"], severity="medium",
        explanation="Neither 8 million registered users nor 2.4 million monthly active users "
                    "supports 10 million."))
    client, model = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER), answer(followed_up)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [
            critic_answer(review("c1"), review(
                "c2", "reinvestigate", follow_up_question="Registered or monthly active users?",
                search_query="monthly active users")),
            critic_answer(review("c1")),
        ],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, events = run(client)

    assert result.iterations == 2
    assert {f.span_text: f.display_status for f in result.findings} == {
        "#1": DisplayStatus.CONFIRMED, "10 million users": DisplayStatus.CONFIRMED}
    users = next(f for f in result.findings if f.span_text == "10 million users")
    assert users.critic_verdict["iteration"] == 2
    assert len(model.calls_for("ClaimsEvidenceAnswer")) == 2
    assert len(model.calls_for("CriticAnswer")) == 2
    (request,) = of_type(events, RunEventType.REINVESTIGATION_REQUESTED)
    assert request.data["task_id"] == "t3" and request.data["search_query"] == "monthly active users"
    follow_up_searches = [e for e in of_type(events, RunEventType.TOOL_CALLED)
                          if e.data.get("iteration") == 2]
    assert any(e.data["query"] == "monthly active users" for e in follow_up_searches)
    second_prompt = model.calls_for("ClaimsEvidenceAnswer")[1][1].content
    assert "Follow-up: Registered or monthly active users?" in second_prompt
    assert len(of_type(events, RunEventType.CRITIC_VERDICT)) == 3
    assert events[-1].data["counters"]["confirmed"] == 2


def test_the_loop_stops_at_the_iteration_limit():
    always_unsure = [critic_answer(review("c1", "reinvestigate", search_query="ranking"))] * 5
    one_claim = claims(assessment())
    client, model = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)] + [answer(one_claim)] * 5,
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": always_unsure,
    })
    result, events = run(client)
    assert result.iterations == MAX_ITERATIONS == 3
    assert len(model.calls_for("CriticAnswer")) == 3
    assert len(model.calls_for("ClaimsEvidenceAnswer")) == 3
    ranking = next(f for f in result.findings if f.span_text == "#1")
    assert ranking.display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert ranking.origin is Origin.AI
    assert any("limit reached" in note for note in events[-1].data["aggregate_notes"])


def test_a_failed_follow_up_keeps_the_earlier_finding():
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER), RuntimeError("down"), RuntimeError("down")],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [critic_answer(review("c1"), review("c2", "reinvestigate"))],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, events = run(client)
    users = next(f for f in result.findings if f.span_text == "10 million users")
    assert users.origin is Origin.AI
    assert users.display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert users.claim_outcome is ClaimOutcome.PARTIALLY_SUPPORTED
    assert result.degraded_reason is None  # the first round succeeded
    assert any("produced no new answer" in note for note in events[-1].data["aggregate_notes"])


def test_rejected_ai_claim_falls_back_to_the_rule_based_check():
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [critic_answer(review("c1", "reject", evidence_supports_finding=False), review("c2"))],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, events = run(client)
    ranking = next(f for f in result.findings if f.span_text == "#1")
    assert ranking.origin is Origin.RULE_BASED  # the claim still needs a human check
    assert ranking.display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert [r.gate for r in result.rejected] == ["critic"]
    assert of_type(events, RunEventType.GATE_REJECTED)[0].node == "critic_gate"
    assert events[-1].data["counters"]["rejected_by_critic"] == 1


def test_critic_failure_shows_ai_findings_unconfirmed():
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [RuntimeError("down"), RuntimeError("down")],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, _ = run(client)
    assert result.mode is RunMode.FULL
    assert result.degraded_reason == CRITIC_UNAVAILABLE
    assert all(f.display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION for f in result.findings)
    assert {f.origin for f in result.findings} == {Origin.AI}


def test_no_new_round_starts_after_the_time_budget():
    client, model = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [critic_answer(review("c1", "reinvestigate"), review("c2"))],
        "CorrectorAnswer": [NO_FIXES],
    })
    library = seed_repo()

    async def send(*args, **kwargs):
        pass

    graph = build_graph(context(), library, client, send, reinvestigation_deadline=0)
    state = asyncio.run(graph.ainvoke({"draft": SHOWCASE_DRAFT, "content_type": "post"}))
    assert len(model.calls_for("ClaimsEvidenceAnswer")) == 1
    ranking = next(f for f in state["findings"] if f.span_text == "#1")
    assert ranking.display_status is DisplayStatus.NEEDS_HUMAN_VERIFICATION
