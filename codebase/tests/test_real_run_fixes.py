"""Regression tests for problems found in the first real OpenAI run (draft 1, 8 November).

1. Nine claim tasks shared a budget of 6 searches, so 6 tasks got no evidence and
   "1,200 partner schools" was called unsupported without FACT-007 ever being shown.
2. Claims the specialist judged supported kept their rule-based "needs a check" placeholder.
3. The critic "confirmed" a note saying the reading level was fine (tested in test_critic.py).
4. A file saved by Windows PowerShell starts with a byte-order mark, which shifted every span.
"""

import asyncio
import json
from uuid import uuid4

from harness.aggregate import aggregate_findings
from harness.graph import allocate_searches
from harness.orchestrator import InvestigationTask, PlanAnswer
from harness.runner import main, run_brand_check_with_library
from harness.schemas import Finding, Origin, RunContext
from harness.seed import seed_repo
from harness.specialists import (
    MAX_TOOL_CALLS,
    ClaimsEvidenceAnswer,
    SupportedClaim,
    gather_evidence,
    searches_needed,
)
from tests.fakes import answer, fake_client
from tests.test_specialists import NO_FIXES, critic_answer

DRAFT_1 = (
    "Lumio is India's number one study planner and the fastest way to prepare for exams. "
    "Since we launched in 2016, more than 10 million learners have joined, and 3 million of "
    "them use Lumio every month. We are used by 1,200 partner schools and support 3 languages: "
    "English, Hindi and Bengali. Lumio is better than a private tutor, and your plan is "
    "guaranteed to improve your grades. Our servers have 100% uptime."
)
CLAIM_PASSAGES = [
    "India's number one study planner", "the fastest way to prepare for exams",
    "more than 10 million learners", "3 million of them use Lumio every month",
    "1,200 partner schools", "3 languages: English, Hindi and Bengali",
    "Lumio is better than a private tutor", "your plan is guaranteed to improve your grades",
    "100% uptime",
]


def task(n, text, specialist="claims_evidence"):
    start = DRAFT_1.index(text)
    return InvestigationTask(task_id=f"t{n}", specialist=specialist, priority="high", reason="r",
                             focus=f"Is this supported: {text}?", span_start=start,
                             span_end=start + len(text), span_text=text)


REAL_TASKS = [task(n, text) for n, text in enumerate(CLAIM_PASSAGES, 1)]


# 1. Every task gets its search


def test_the_real_plan_fits_within_the_search_limit():
    needs = {"claims_evidence": searches_needed("claims_evidence", REAL_TASKS),
             "brand_consistency": 1, "accessibility": 1}
    assert needs["claims_evidence"] == 9
    assert allocate_searches(needs, MAX_TOOL_CALLS) == needs


def test_every_claim_task_now_gets_evidence():
    budget = allocate_searches({"claims_evidence": 9, "accessibility": 1, "brand_consistency": 1},
                               MAX_TOOL_CALLS)["claims_evidence"]
    evidence, calls, notes = gather_evidence("claims_evidence", REAL_TASKS, seed_repo(), budget)
    assert sorted(c["task_id"] for c in calls) == sorted(t.task_id for t in REAL_TASKS)
    assert notes == []
    for fact in ("FACT-001", "FACT-002", "FACT-004", "FACT-007", "FACT-008", "FACT-010"):
        assert fact in evidence, fact
    assert {"CLAIM-003", "CLAIM-005"} <= set(evidence)


def test_searches_are_shared_in_proportion_when_they_do_not_fit():
    shares = allocate_searches({"claims_evidence": 30, "brand_consistency": 10}, 20)
    assert shares == {"claims_evidence": 15, "brand_consistency": 5}
    assert allocate_searches({"a": 1, "b": 100}, 10)["a"] == 1  # never zero


# 2. Supported claims clear their placeholder, when code can confirm it


def placeholder(text):
    start = DRAFT_1.index(text)
    return Finding.model_validate({
        "category": "facts_and_claims", "severity": "medium",
        "display_status": "needs_human_verification", "claim_outcome": "needs_human_verification",
        "origin": "rule_based", "confidence": 0.5, "span_start": start, "span_end": start + len(text),
        "span_text": text, "explanation": "Needs a check.",
        "produced_by": ["deterministic_baseline", "detect_claim_patterns"]})


def supported(text, *facts):
    start = DRAFT_1.index(text)
    return SupportedClaim(span_start=start, span_end=start + len(text), span_text=text,
                          fact_quotes=list(facts))


def test_matching_numbers_in_a_cited_fact_clear_the_placeholder():
    merged, notes = aggregate_findings(
        [placeholder("1,200 partner schools"), placeholder("3 languages")], [],
        [supported("1,200 partner schools", "Lumio is used by 1,200 partner schools."),
         supported("3 languages: English, Hindi and Bengali",
                   "Lumio supports 3 languages: English, Hindi and Bengali.")])
    assert merged == []
    assert len(notes) == 2


def test_a_supported_judgement_with_different_numbers_does_not_clear_it():
    merged, _ = aggregate_findings(
        [placeholder("10 million learners")], [],
        [supported("more than 10 million learners", "Lumio has 8 million registered users.")])
    assert len(merged) == 1


def test_a_supported_judgement_without_a_fact_does_not_clear_it():
    merged, _ = aggregate_findings(
        [placeholder("1,200 partner schools")], [], [supported("1,200 partner schools")])
    assert len(merged) == 1


def test_a_claim_with_no_number_keeps_its_placeholder():
    merged, _ = aggregate_findings(
        [placeholder("number one")], [],
        [supported("India's number one study planner", "Lumio is the number one planner.")])
    assert len(merged) == 1


def test_supported_claims_clear_placeholders_through_the_whole_graph():
    plan = PlanAnswer.model_validate({
        "intent": "Promote Lumio.", "audience": "Students", "skipped": [],
        "tasks": [{"specialist": "claims_evidence", "focus": "Supported?", "quote": "1,200 partner schools",
                   "rule_ids": ["CLAIM-004"], "priority": "high", "reason": "Count."}]})
    claims = ClaimsEvidenceAnswer.model_validate({"evidence_gaps": [], "assessments": [{
        "task_id": "t1", "quote": "1,200 partner schools", "outcome": "supported", "severity": "low",
        "explanation": "FACT-007 states 1,200 partner schools.", "evidence_ids": ["FACT-007"],
        "confidence": 0.95}]})
    draft = "We are used by 1,200 partner schools."
    client, model = fake_client(answer(plan), by_schema={
        "ClaimsEvidenceAnswer": [answer(claims)], "CriticAnswer": [critic_answer()],
        "CorrectorAnswer": [NO_FIXES]})

    async def emit(event):
        pass

    ctx = RunContext(run_id=uuid4(), org_id=uuid4(), submission_version_id=uuid4(), draft=draft,
                     content_type="blog", library_version=1)
    result = asyncio.run(run_brand_check_with_library(ctx, emit, seed_repo(), llm=client))
    assert result.findings == []
    assert model.calls_for("CriticAnswer") == []  # nothing left to review


# 4. A byte-order mark is not part of the draft


def test_command_line_ignores_a_windows_byte_order_mark(tmp_path, capsys):
    path = tmp_path / "draft.txt"
    path.write_text("India's #1 AI-powered platform, trusted by 10 million users.", encoding="utf-8-sig")
    assert path.read_bytes().startswith(b"\xef\xbb\xbf")
    assert main([str(path), "--quiet"]) == 0
    ranking = json.loads(capsys.readouterr().out)["findings"][0]
    assert (ranking["span_start"], ranking["span_text"]) == (8, "#1")
    assert all(f["origin"] == Origin.RULE_BASED.value
               for f in json.loads(json.dumps([ranking])))
