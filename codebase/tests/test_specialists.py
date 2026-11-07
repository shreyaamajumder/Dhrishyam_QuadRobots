"""Tests for the specialists, the aggregate step and the graph's parallel fan-out."""

import asyncio
from uuid import uuid4

import pytest

from gates import apply_gates
from harness.aggregate import aggregate_findings
from harness.deterministic import run_deterministic_baseline, run_intake_guard
from harness.corrector import CorrectorAnswer
from harness.critic import CriticAnswer
from harness.graph import AI_UNAVAILABLE, partly_unavailable
from harness.llm import UNTRUSTED_NOTICE
from harness.orchestrator import InvestigationTask, PlanAnswer
from harness.runner import run_brand_check_with_library
from harness.schemas import (
    Category,
    ClaimOutcome,
    DisplayStatus,
    Finding,
    Origin,
    RunContext,
    RunEventType,
    RunMode,
)
from harness.seed import SHOWCASE_DRAFT, seed_repo
from harness.specialists import (
    AccessibilityAnswer,
    BrandConsistencyAnswer,
    ClaimsEvidenceAnswer,
    build_specialist_messages,
    convert_answer,
    gather_evidence,
    run_specialist,
)
from tests.fakes import answer, fake_client

RANKING = InvestigationTask(task_id="t1", specialist="claims_evidence", focus="Is the ranking supported?",
                            priority="high", reason="r", rule_ids=["CLAIM-001"],
                            span_start=8, span_end=10, span_text="#1")
USERS = InvestigationTask(task_id="t2", specialist="claims_evidence",
                          focus="Do approved facts support 10 million users?", priority="high",
                          reason="r", rule_ids=["CLAIM-004"], span_start=43, span_end=59,
                          span_text="10 million users")
assert SHOWCASE_DRAFT[8:10] == "#1" and SHOWCASE_DRAFT[43:59] == "10 million users"


def context(draft=SHOWCASE_DRAFT):
    return RunContext(run_id=uuid4(), org_id=uuid4(), submission_version_id=uuid4(), draft=draft,
                      content_type="social post", audience="students", library_version=1)


def baseline_for(draft, library=None):
    library = library or seed_repo()
    return run_deterministic_baseline(draft, library, run_intake_guard(draft, library))


def claims(*assessments, gaps=()):
    return ClaimsEvidenceAnswer.model_validate(
        {"assessments": list(assessments), "evidence_gaps": list(gaps)})


def assessment(quote="#1", outcome="unsupported", ids=("FACT-010", "CLAIM-001"), task_id="t1",
               explanation="No approved fact supports a ranking; FACT-010 says Lumio has not been ranked.",
               severity="high", confidence=0.9):
    return {"task_id": task_id, "quote": quote, "outcome": outcome, "severity": severity,
            "explanation": explanation, "evidence_ids": list(ids), "confidence": confidence}


def issue(quote, category="messaging", ids=("MSG-002",), task_id="t1", severity="high",
          explanation="Describes the AI as replacing teachers, against MSG-002.", confidence=0.8):
    return {"task_id": task_id, "quote": quote, "category": category, "severity": severity,
            "explanation": explanation, "rule_ids": list(ids), "confidence": confidence}


# Evidence


def test_claims_evidence_retrieves_facts_and_rules_separately():
    evidence, calls, notes = gather_evidence("claims_evidence", [RANKING, USERS], seed_repo(), 20)
    assert {"FACT-001", "FACT-002", "FACT-010", "CLAIM-001", "CLAIM-004"} <= set(evidence)
    assert "FACT-006" not in evidence  # employees: unrelated facts are not sent
    assert len(calls) == 2 and notes == []  # one search per task, covering facts and claim rules
    assert calls[0]["task_id"] == "t1" and calls[0]["types"] == ["fact", "claim_rule"]


def test_rule_ids_from_the_plan_are_always_included():
    task = RANKING.model_copy(update={"rule_ids": ["CLAIM-005"]})
    evidence, _, _ = gather_evidence("claims_evidence", [task], seed_repo(), 0)
    assert list(evidence) == ["CLAIM-005"]


def test_tool_call_budget_is_respected():
    evidence, calls, notes = gather_evidence("claims_evidence", [RANKING, USERS], seed_repo(), 1)
    assert len(calls) == 1
    assert notes == ["Tool-call budget reached, so these tasks had no search: t2."]


def test_brand_consistency_gets_brand_rules_but_not_accessibility_rules():
    task = InvestigationTask(task_id="t1", specialist="brand_consistency", priority="medium",
                             focus="Does this replace teachers?", reason="r",
                             span_start=0, span_end=10, span_text="AI teacher")
    evidence, _, _ = gather_evidence("brand_consistency", [task], seed_repo(), 20)
    assert {"MSG-002", "TERM-003"} <= set(evidence)
    assert not any(public_id.startswith("ACC") for public_id in evidence)


def test_accessibility_gets_every_accessibility_rule_in_one_call():
    task = InvestigationTask(task_id="t1", specialist="accessibility", priority="low",
                             focus="Reading level for students?", reason="r")
    evidence, calls, _ = gather_evidence("accessibility", [task], seed_repo(), 20)
    assert list(evidence) == ["ACC-001", "ACC-002", "ACC-003", "ACC-004"]
    assert len(calls) == 1


def test_messages_contain_tasks_evidence_and_wrapped_draft():
    evidence, _, _ = gather_evidence("claims_evidence", [RANKING], seed_repo(), 20)
    messages, version = build_specialist_messages(
        "claims_evidence", [RANKING], evidence, context(), baseline_for(SHOWCASE_DRAFT), "Promote Lumio")
    system, user = messages
    assert version == "claims_evidence.v2"
    assert UNTRUSTED_NOTICE in system.content and "Never call a claim false" in system.content
    assert '- t1: "#1". Check: Is the ranking supported? Suggested rules: CLAIM-001.' in user.content
    assert "[FACT-010] fact" in user.content
    assert f"<untrusted_draft>\n{SHOWCASE_DRAFT}\n</untrusted_draft>" in user.content


def test_accessibility_messages_include_tool_measurements():
    draft = "JOIN TODAY AND SAVE. [Click here](https://lumio.example) for your plan."
    task = InvestigationTask(task_id="t1", specialist="accessibility", priority="low",
                             focus="Is this accessible?", reason="r")
    evidence, _, _ = gather_evidence("accessibility", [task], seed_repo(), 20)
    _, user = build_specialist_messages("accessibility", [task], evidence, context(draft),
                                        baseline_for(draft), "Sell")[0]
    assert "Measurements:" in user.content and "reading grade" in user.content
    assert '- detect_all_caps found: "JOIN TODAY AND SAVE"' in user.content
    assert '- check_link_text found: "Click here"' in user.content


# Checking the model's answer


def convert(answer_, tasks=(RANKING, USERS), draft=SHOWCASE_DRAFT, specialist="claims_evidence"):
    evidence, _, _ = gather_evidence(specialist, list(tasks), seed_repo(), 20)
    return convert_answer(specialist, answer_, list(tasks), evidence, draft)


def test_claim_becomes_ai_candidate_with_code_located_span_and_citations():
    candidates, rejected, supported, notes = convert(claims(assessment()))
    (candidate,) = candidates
    assert (candidate["span_start"], candidate["span_end"], candidate["span_text"]) == (8, 10, "#1")
    assert candidate["claim_outcome"] == "unsupported"
    assert candidate["display_status"] is DisplayStatus.NEEDS_HUMAN_VERIFICATION
    assert candidate["origin"] is Origin.AI
    assert [c["entry_version"] for c in candidate["citations"]] == [1, 1]
    assert rejected == [] and supported == [] and notes == []


def test_supported_claims_are_set_aside_not_reported():
    candidates, _, supported, _ = convert(claims(assessment(outcome="supported")))
    assert candidates == [] and supported == ["#1"]


def test_quote_not_in_draft_is_rejected_by_the_span_check():
    _, rejected, _, _ = convert(claims(assessment(quote="#1 in Asia")))
    assert rejected[0].gate == "span"


def test_citations_the_specialist_was_not_shown_are_removed():
    candidates, _, _, notes = convert(claims(assessment(ids=["FACT-010", "FACT-006", "MADE-UP"])))
    assert len(candidates[0]["citations"]) == 1
    assert "FACT-006" in notes[0] and "MADE-UP" in notes[0]


def test_quote_prefers_the_occurrence_inside_the_task_passage():
    draft = "The best plan. Lumio is the best for learners."
    second = draft.rindex("best")
    task = InvestigationTask(task_id="t1", specialist="claims_evidence", priority="medium",
                             focus="Superlative?", reason="r", span_start=second,
                             span_end=second + 4, span_text="best")
    candidates, _, _, _ = convert(claims(assessment(quote="best", ids=["CLAIM-002"])), [task], draft)
    assert candidates[0]["span_start"] == second != draft.index("best")


def test_confidence_is_clamped():
    candidates, _, _, _ = convert(claims(assessment(confidence=1.7)))
    assert candidates[0]["confidence"] == 1.0


def test_brand_and_accessibility_issues_get_their_categories():
    brand = BrandConsistencyAnswer.model_validate({"issues": [issue("AI-powered", "tone", ["TONE-001"])],
                                                   "evidence_gaps": []})
    access = AccessibilityAnswer.model_validate({"issues": [
        {"task_id": "t1", "quote": "India's #1", "severity": "low", "explanation": "x",
         "rule_ids": ["ACC-003"], "confidence": 0.5}], "evidence_gaps": []})
    tone_task = InvestigationTask(task_id="t1", specialist="brand_consistency", priority="low",
                                  focus="Tone", reason="r", rule_ids=["TONE-001"])
    acc_task = tone_task.model_copy(update={"specialist": "accessibility"})
    assert convert(brand, [tone_task], specialist="brand_consistency")[0][0]["category"] is Category.TONE
    assert convert(access, [acc_task], specialist="accessibility")[0][0]["category"] is Category.ACCESSIBILITY


# run_specialist


def test_run_specialist_gates_findings_and_records_the_call():
    client, model = fake_client(answer(claims(assessment(), assessment(
        quote="10 million users", outcome="partially_supported", task_id="t2",
        ids=["FACT-001", "FACT-002", "CLAIM-004"],
        explanation="FACT-001 gives 8 million registered users and FACT-002 2.4 million active users."))))
    outcome = asyncio.run(run_specialist("claims_evidence", [RANKING, USERS], context(), seed_repo(),
                                         baseline_for(SHOWCASE_DRAFT), "Promote", client, 20))
    assert outcome.succeeded and outcome.rejected == []
    assert [f.claim_outcome for f in outcome.findings] == [
        ClaimOutcome.UNSUPPORTED, ClaimOutcome.PARTIALLY_SUPPORTED]
    assert outcome.llm_call["node"] == "claims_evidence"
    assert outcome.prompt_version == "claims_evidence.v2"
    assert model.schemas == [ClaimsEvidenceAnswer]


def test_wording_gate_rejects_a_claim_called_false():
    client, _ = fake_client(answer(claims(assessment(explanation="This ranking is false."))))
    outcome = asyncio.run(run_specialist("claims_evidence", [RANKING], context(), seed_repo(),
                                         baseline_for(SHOWCASE_DRAFT), "Promote", client, 20))
    assert outcome.findings == []
    assert outcome.rejected[0].gate == "wording"


def test_specialist_failure_is_returned_not_raised():
    client, _ = fake_client(RuntimeError("down"), RuntimeError("down"))
    outcome = asyncio.run(run_specialist("claims_evidence", [RANKING], context(), seed_repo(),
                                         baseline_for(SHOWCASE_DRAFT), "Promote", client, 20))
    assert outcome.succeeded is False
    assert outcome.llm_call["attempts"] == 2
    assert outcome.tool_calls  # evidence was still gathered and is in the trace


# Aggregate


def finding(text, start, category="facts_and_claims", origin="ai", status="needs_human_verification",
            outcome="unsupported", severity="medium", confidence=0.5, citations=(), produced_by="claims_evidence"):
    return Finding.model_validate({
        "category": category, "severity": severity, "display_status": status,
        "claim_outcome": outcome if category == "facts_and_claims" else None,
        "origin": origin, "confidence": confidence, "span_start": start,
        "span_end": start + len(text), "span_text": text, "explanation": "x",
        "produced_by": [produced_by], "citations": list(citations)})


CITE = {"entry_id": uuid4(), "entry_version": 1, "quote": "Rankings need evidence."}


def test_ai_claim_replaces_rule_based_placeholder_and_inherits_its_citation():
    placeholder = finding("#1", 8, origin="rule_based", outcome="needs_human_verification",
                          citations=[CITE], produced_by="deterministic_baseline")
    ai = finding("#1", 8)
    merged, notes = aggregate_findings([placeholder], [ai])
    assert len(merged) == 1 and merged[0].origin is Origin.AI
    assert merged[0].citations[0].entry_id == CITE["entry_id"]
    assert "replaced the rule-based check" in notes[0]


def test_confirmed_rule_based_finding_wins_over_ai_duplicate():
    rule = finding("kids", 20, category="terminology", origin="rule_based", status="confirmed",
                   citations=[CITE], produced_by="deterministic_baseline")
    ai = finding("kids", 20, category="terminology")
    merged, _ = aggregate_findings([rule], [ai])
    assert merged == [rule]


def test_different_categories_on_the_same_words_are_kept():
    rule = finding("AI teacher", 11, category="terminology", origin="rule_based", status="confirmed",
                   citations=[CITE], produced_by="deterministic_baseline")
    ai = finding("AI teacher", 11, category="messaging")
    merged, _ = aggregate_findings([rule], [ai])
    assert [f.category.value for f in merged] == ["messaging", "terminology"]


def test_ai_duplicates_are_merged_keeping_the_more_severe():
    first = finding("best", 4, category="tone", severity="low", citations=[CITE])
    other = {"entry_id": uuid4(), "entry_version": 2, "quote": "Be confident."}
    second = finding("the best", 0, category="tone", severity="high", citations=[other],
                     produced_by="brand_consistency")
    merged, _ = aggregate_findings([], [first, second])
    assert len(merged) == 1 and merged[0].severity.value == "high"
    assert len(merged[0].citations) == 2


# The whole graph


PLAN = PlanAnswer.model_validate({
    "intent": "Promote Lumio to new learners.", "audience": "Students",
    "tasks": [
        {"specialist": "claims_evidence", "focus": "Is the ranking supported?", "quote": "#1",
         "rule_ids": ["CLAIM-001"], "priority": "high", "reason": "Ranking."},
        {"specialist": "claims_evidence", "focus": "Do approved facts support 10 million users?",
         "quote": "10 million users", "rule_ids": ["CLAIM-004"], "priority": "high", "reason": "Count."},
        {"specialist": "brand_consistency", "focus": "Is the tone boastful?", "quote": "AI-powered platform",
         "rule_ids": ["TONE-001"], "priority": "medium", "reason": "Tone."},
    ],
    "skipped": [{"specialist": "accessibility", "reason": "Short plain text."}],
})
CLAIMS_ANSWER = claims(
    assessment(),
    assessment(quote="10 million users", outcome="partially_supported", task_id="t3",
               ids=["FACT-001", "FACT-002", "CLAIM-004"], severity="medium",
               explanation="FACT-001 gives 8 million registered users and FACT-002 gives "
                           "2.4 million monthly active users, so 10 million is not supported."),
    gaps=[{"task_id": "t3", "description": "Whether the draft means registered or active users",
           "search_query": "active users"}],
)
QUIET_BRAND = BrandConsistencyAnswer.model_validate({"issues": [], "evidence_gaps": []})


def review(candidate_id, verdict="confirm", **changes):
    data = {"candidate_id": candidate_id, "verdict": verdict, "evidence_supports_finding": True,
            "span_correct": True, "severity_justified": True, "genuine_violation": True,
            "suggested_severity": None, "reason": "The cited evidence supports this.",
            "follow_up_question": None, "search_query": None}
    data.update(changes)
    return data


def critic_answer(*reviews):
    return answer(CriticAnswer.model_validate({"reviews": list(reviews)}))


CONFIRM_BOTH = critic_answer(review("c1"), review("c2"))
NO_FIXES = answer(CorrectorAnswer.model_validate({"fixes": []}))


def run(llm, draft=SHOWCASE_DRAFT):
    events = []

    async def emit(event):
        events.append(event)

    result = asyncio.run(run_brand_check_with_library(context(draft), emit, seed_repo(), llm=llm))
    return result, events


# After sorting by position, the plan's tasks are t1 "#1", t2 "AI-powered platform", t3 "10 million users".


def test_showcase_draft_end_to_end():
    client, model = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [CONFIRM_BOTH],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, events = run(client)

    assert result.mode is RunMode.FULL
    assert result.degraded_reason is None
    by_text = {f.span_text: f for f in result.findings}
    assert set(by_text) == {"#1", "10 million users"}
    assert by_text["#1"].claim_outcome is ClaimOutcome.UNSUPPORTED
    assert by_text["10 million users"].claim_outcome is ClaimOutcome.PARTIALLY_SUPPORTED
    for f in result.findings:
        assert f.origin is Origin.AI and f.display_status is DisplayStatus.CONFIRMED
        assert f.citations and f.critic_verdict["verdict"] == "confirm"
    assert len(model.calls_for("ClaimsEvidenceAnswer")) == 1
    assert len(model.calls_for("BrandConsistencyAnswer")) == 1
    assert model.calls_for("AccessibilityAnswer") == []

    gaps = [e for e in events if e.type is RunEventType.EVIDENCE_GAP]
    assert gaps[0].node == "claims_evidence" and gaps[0].data["search_query"] == "active users"
    retrievals = [e for e in events if e.type is RunEventType.TOOL_CALLED and e.node != "deterministic_baseline"]
    assert {e.node for e in retrievals} == {"claims_evidence", "brand_consistency"}
    assert result.tool_calls == 5 + len(retrievals)
    assert [e.seq for e in events] == list(range(len(events)))
    summary = events[-1].data["specialists"]
    assert {s["specialist"] for s in summary} == {"claims_evidence", "brand_consistency"}


def test_final_findings_pass_the_gates_again():
    library = seed_repo()
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(CLAIMS_ANSWER)],
        "BrandConsistencyAnswer": [answer(QUIET_BRAND)],
        "CriticAnswer": [CONFIRM_BOTH],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, _ = run(client)
    assert apply_gates(result.findings, SHOWCASE_DRAFT, library.valid_citations()).rejected == []


def test_one_failed_specialist_keeps_rule_based_results_for_its_passages():
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [RuntimeError("down"), RuntimeError("down")],
        "BrandConsistencyAnswer": [answer(BrandConsistencyAnswer.model_validate({"issues": [
            issue("AI-powered platform", "tone", ["TONE-001"], explanation="Sounds boastful for students.",
                  severity="low")], "evidence_gaps": []}))],
        "CriticAnswer": [critic_answer(review("c1"))],
        "CorrectorAnswer": [NO_FIXES],
    })
    result, _ = run(client)
    assert result.mode is RunMode.FULL
    assert result.degraded_reason == partly_unavailable(["claims_evidence"])
    origins = {f.span_text: f.origin for f in result.findings}
    assert origins == {"#1": Origin.RULE_BASED, "AI-powered platform": Origin.AI,
                       "10 million users": Origin.RULE_BASED}


def test_all_specialists_failing_falls_back_to_rule_based_with_plan_kept():
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [RuntimeError("down")] * 2,
        "BrandConsistencyAnswer": [RuntimeError("down")] * 2,
    })
    result, events = run(client)
    assert result.mode is RunMode.DETERMINISTIC_ONLY
    assert result.degraded_reason == AI_UNAVAILABLE
    assert len(result.plan) == 3
    assert all(f.origin is Origin.RULE_BASED for f in result.findings)
    degraded = next(e for e in events if e.type is RunEventType.RUN_DEGRADED)
    assert len(degraded.data["llm_calls"]) == 3  # orchestrator + two failed specialists


def test_rejected_ai_candidates_are_reported_and_returned():
    bad = claims(assessment(quote="#1 worldwide"))
    client, _ = fake_client(answer(PLAN), by_schema={
        "ClaimsEvidenceAnswer": [answer(bad)], "BrandConsistencyAnswer": [answer(QUIET_BRAND)]})
    result, events = run(client)
    rejected = [e for e in events if e.type is RunEventType.GATE_REJECTED]
    assert rejected[0].data["specialist"] == "claims_evidence" and rejected[0].node == "span_gate"
    assert result.rejected[0].gate == "span"
    assert {f.span_text for f in result.findings} == {"#1", "10 million users"}  # placeholders stay


def test_plan_with_no_tasks_skips_the_specialists():
    empty = PlanAnswer.model_validate({"intent": "Inform", "audience": "All", "tasks": [], "skipped": []})
    client, model = fake_client(answer(empty))
    result, _ = run(client, "You can plan your week in minutes with a clear study plan.")
    assert result.mode is RunMode.FULL and result.degraded_reason is None
    assert result.findings == [] and len(model.calls) == 1
