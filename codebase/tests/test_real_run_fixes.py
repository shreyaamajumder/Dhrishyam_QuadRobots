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


# Second real run (draft 1, after the first fixes)
#
# 5. "Since we launched in 2016" was still missed: neither the plan nor the rule-based check
#    treated a dated history claim as a claim, so nothing checked it against FACT-003.
# 6. Two deletions left broken sentences once applied.
# 7. A finding about a misleading claim was filed as accessibility, citing the reading-level
#    rule, and confirmed. Fixed in the critic (v3) and accessibility (v3) prompts.

from harness.corrector import ProposedFix, broken_sentence, check_fix  # noqa: E402
from harness.deterministic import run_deterministic_baseline, run_intake_guard  # noqa: E402
from harness.orchestrator import finalise_plan  # noqa: E402


def test_a_launch_year_is_now_a_claim_that_the_plan_must_cover():
    library = seed_repo()
    intake = run_intake_guard(DRAFT_1, library)
    baseline = run_deterministic_baseline(DRAFT_1, library, intake)
    assert "launched in 2016" in [c.span_text for c in baseline.claim_candidates]
    model_plan = PlanAnswer.model_validate({"intent": "x", "audience": "y", "tasks": [], "skipped": []})
    plan = finalise_plan(model_plan, DRAFT_1, library, baseline)
    dated = [t for t in plan.tasks if t.span_text == "launched in 2016"]
    assert dated and dated[0].specialist == "claims_evidence" and dated[0].source == "coverage"


def test_a_correct_founding_year_is_cleared_by_the_fact():
    text = "founded in 2018"
    claim = Finding.model_validate({
        "category": "facts_and_claims", "severity": "medium", "display_status": "needs_human_verification",
        "claim_outcome": "needs_human_verification", "origin": "rule_based", "confidence": 0.5,
        "span_start": 9, "span_end": 9 + len(text), "span_text": text, "explanation": "Check.",
        "produced_by": ["deterministic_baseline"]})
    merged, _ = aggregate_findings([claim], [], [SupportedClaim(
        span_start=9, span_end=24, span_text=text, fact_quotes=["Lumio was founded in 2018."])])
    assert merged == []


SENTENCE_1 = "Lumio is India's number one study planner and the fastest way to prepare for exams."
SENTENCE_4 = "Lumio is better than a private tutor, and your plan is guaranteed to improve your grades."


def claim_in(sentence, text):
    start = sentence.index(text)
    return Finding.model_validate({
        "category": "facts_and_claims", "severity": "high", "display_status": "confirmed",
        "claim_outcome": "unsupported", "origin": "ai", "confidence": 0.9, "span_start": start,
        "span_end": start + len(text), "span_text": text, "explanation": "Unsupported.",
        "produced_by": ["claims_evidence"],
        "citations": [{"entry_id": uuid4(), "entry_version": 1, "quote": "Claims need evidence."}]})


def proposal(before, after):
    return ProposedFix(finding_id="f1", before_text=before, after_text=after, rationale="Removes it.",
                       keeps_meaning=True, adds_new_claims=False)


def check_in(sentence, text, before, after):
    return check_fix(proposal(before, after), claim_in(sentence, text), sentence,
                     (0, len(sentence)), seed_repo())


def test_the_real_broken_deletions_are_refused():
    refusal = check_in(SENTENCE_1, "the fastest way to prepare for exams",
                       "the fastest way to prepare for exams", "")
    assert "broken (a word left hanging before punctuation)" in refusal
    refusal = check_in(SENTENCE_4, "Lumio is better than a private tutor",
                       "Lumio is better than a private tutor", "")
    assert "broken (the sentence starts with punctuation)" in refusal


def test_deletions_that_take_the_joining_words_are_accepted():
    assert check_in(SENTENCE_1, "the fastest way to prepare for exams",
                    " and the fastest way to prepare for exams", "") is None
    assert check_in(SENTENCE_4, "Lumio is better than a private tutor",
                    "Lumio is better than a private tutor, and your plan",
                    "Your plan") is None


def test_removing_the_whole_sentence_is_allowed():
    assert check_in("Our servers have 100% uptime.", "100% uptime",
                    "Our servers have 100% uptime.", "") is None


def test_broken_sentence_only_blames_the_edit():
    assert broken_sentence("A plan, and more .", "A plan, and more .") is None
    assert broken_sentence("Join us and learn.", "Join us and .") is not None
    assert broken_sentence("Join us and learn.", "join us.") == (
        "the sentence no longer starts with a capital letter")
    assert broken_sentence("Join us and learn.", "Join us  today.") == "a double space"


# Drafts 2 and 3 (third round of real runs)
#
# 8. Draft 2's brand specialist was only ever shown TONE-001 and a few terms, so it could
#    not flag stacked exclamation marks, pressure, "the user", replacing tutors, promised
#    results or competitors. Messaging problems went to the claims specialist instead.
# 9. "Hey kids!!!" was reported as tone while citing the TERM rule for "kids", so it
#    duplicated the rule-based terminology finding.
# 10. Draft 3: "may facilitate incremental attainment" was confirmed as a promised outcome.
#     Fixed in the brand (v3) and critic (v4) prompts: cautious wording is not a promise.

from harness.specialists import BrandConsistencyAnswer, convert_answer  # noqa: E402

DRAFT_2 = (
    "Hey kids!!! Don't fall behind - only 2 hours left to sign up now. Our AI teacher replaces "
    "your tutor and will help you crush every exam. Score 95% or more with Lumio, way better than "
    "BrandX. The user can grab the cheap plan today. JOIN TODAY AND SAVE BIG. "
    "[Click here](https://lumio.example/offer)"
)
NEEDED_FOR_DRAFT_2 = ("TONE-002", "TONE-003", "TONE-004", "MSG-002", "MSG-003", "MSG-004")


def test_the_brand_specialist_now_sees_every_tone_and_messaging_rule():
    sentence = "Hey kids!!! Don't fall behind - only 2 hours left to sign up now."
    only_task = InvestigationTask(task_id="t1", specialist="brand_consistency", priority="medium",
                                  reason="r", focus="Is the tone friendly?", rule_ids=["TONE-001"],
                                  span_start=0, span_end=len(sentence), span_text=sentence)
    evidence, calls, _ = gather_evidence("brand_consistency", [only_task], seed_repo(), 20)
    for rule in NEEDED_FOR_DRAFT_2:
        assert rule in evidence, rule
    assert calls[0] == {"tool": "get_entries", "query": "tone and messaging guidelines",
                        "returned": ["MSG-001", "MSG-002", "MSG-003", "MSG-004",
                                     "TONE-001", "TONE-002", "TONE-003", "TONE-004"]}
    assert searches_needed("brand_consistency", [only_task]) == 2


def test_a_plan_without_a_whole_draft_brand_check_gets_one():
    library = seed_repo()
    intake = run_intake_guard(DRAFT_2, library)
    baseline = run_deterministic_baseline(DRAFT_2, library, intake)
    only_claims = PlanAnswer.model_validate({"intent": "Sell", "audience": "Students", "skipped": [],
        "tasks": [{"specialist": "claims_evidence", "focus": "Supported?", "quote": "Score 95% or more",
                   "rule_ids": ["CLAIM-004"], "priority": "high", "reason": "r"}]})
    plan = finalise_plan(only_claims, DRAFT_2, library, baseline)
    whole = [t for t in plan.tasks if t.specialist == "brand_consistency" and t.span_start is None]
    assert len(whole) == 1 and whole[0].source == "coverage"
    assert "Added a whole-draft tone and messaging check." in plan.notes


def test_a_clean_draft_with_no_tasks_gets_no_extra_check():
    clean = "You can plan your week in minutes with a clear study plan."
    library = seed_repo()
    intake = run_intake_guard(clean, library)
    baseline = run_deterministic_baseline(clean, library, intake)
    empty = PlanAnswer.model_validate({"intent": "x", "audience": "y", "tasks": [], "skipped": []})
    assert finalise_plan(empty, clean, library, baseline).tasks == []


def test_a_brand_issue_takes_the_category_of_the_rule_it_cites():
    whole = InvestigationTask(task_id="t1", specialist="brand_consistency", priority="medium",
                              reason="r", focus="Tone and messaging.")
    evidence, _, _ = gather_evidence("brand_consistency", [whole], seed_repo(), 20)
    evidence["TERM-001"] = next(e for e in seed_repo().get_entries() if e.public_id == "TERM-001")
    answer_ = BrandConsistencyAnswer.model_validate({"evidence_gaps": [], "issues": [{
        "task_id": "t1", "quote": "Hey kids!!!", "category": "tone", "severity": "medium",
        "explanation": "'kids' is not the preferred term.", "rule_ids": ["TERM-001"], "confidence": 0.9}]})
    candidates, _, _, notes = convert_answer("brand_consistency", answer_, [whole], evidence, DRAFT_2)
    assert candidates[0]["category"].value == "terminology"
    assert "filed as terminology" in notes[0]


def test_the_refiled_issue_merges_with_the_rule_based_finding():
    library = seed_repo()
    baseline = run_deterministic_baseline(DRAFT_2, library, run_intake_guard(DRAFT_2, library))
    kids_rule = next(f for f in baseline.findings if f.span_text == "kids")
    ai = Finding.model_validate({
        "category": "terminology", "severity": "medium", "display_status": "confirmed",
        "origin": "ai", "confidence": 0.9, "span_start": 0, "span_end": 11, "span_text": "Hey kids!!!",
        "explanation": "Use learners.", "produced_by": ["brand_consistency"],
        "citations": [c.model_dump() for c in kids_rule.citations]})
    merged, _ = aggregate_findings(baseline.findings, [ai])
    assert "Hey kids!!!" not in [f.span_text for f in merged]
    assert kids_rule in merged


# Draft 2, second run
#
# 11. The whole-draft check returned ONE messaging finding spanning five sentences and citing
#     nine rules. The merge step then folded the specific, confirmed "replaces your tutor"
#     (MSG-002) finding into it, so it could not be highlighted or fixed on its own.
# 12. "The user can grab the cheap plan today." was still sent to the claims specialist and
#     came back "partially supported", although it states no checkable fact.

import pytest  # noqa: E402

from harness.specialists import ClaimsEvidenceAnswer as _Claims, is_checkable_claim  # noqa: E402

GIANT = DRAFT_2[:DRAFT_2.index("JOIN TODAY AND SAVE BIG.") + len("JOIN TODAY AND SAVE BIG.")]
WHOLE = InvestigationTask(task_id="t8", specialist="brand_consistency", priority="medium",
                          reason="r", focus="Whole draft.")


def brand(*issues):
    return BrandConsistencyAnswer.model_validate({"evidence_gaps": [], "issues": [
        {"task_id": "t8", "severity": "high", "explanation": "Breaks a rule.", "confidence": 0.9,
         "category": category, "quote": quote, "rule_ids": list(rules)}
        for quote, category, rules in issues]})


def test_a_finding_spanning_several_sentences_is_refused():
    evidence, _, _ = gather_evidence("brand_consistency", [WHOLE], seed_repo(), 20)
    answer_ = brand((GIANT, "messaging", ["TONE-002", "TONE-004", "MSG-002", "MSG-003", "MSG-004"]),
                    ("replaces your tutor", "messaging", ["MSG-002"]),
                    ("The user", "tone", ["TONE-003"]))
    candidates, rejected, _, _ = convert_answer("brand_consistency", answer_, [WHOLE], evidence, DRAFT_2)
    assert [c["span_text"] for c in candidates] == ["replaces your tutor", "The user"]
    assert rejected[0].gate == "span" and "more than one sentence" in rejected[0].reason


def test_a_short_finding_is_not_folded_into_a_long_one():
    def ai(text):
        start = DRAFT_2.index(text)
        return Finding.model_validate({
            "category": "messaging", "severity": "high", "display_status": "confirmed",
            "origin": "ai", "confidence": 0.9, "span_start": start, "span_end": start + len(text),
            "span_text": text, "explanation": "x", "produced_by": ["brand_consistency"],
            "citations": [{"entry_id": uuid4(), "entry_version": 1, "quote": "q"}]})
    sentence = "Our AI teacher replaces your tutor and will help you crush every exam."
    merged, _ = aggregate_findings([], [ai(sentence), ai("replaces your tutor")])
    assert [m.span_text for m in merged] == [sentence, "replaces your tutor"]


@pytest.mark.parametrize("text, checkable", [
    ("Score 95% or more with Lumio", True),
    ("way better than BrandX", True),
    ("Since we launched in 2016", True),
    ("India's number one study planner", True),
    ("your plan is guaranteed to improve your grades", True),
    ("Lumio is better than a private tutor", True),
    ("The user can grab the cheap plan today.", False),
    ("Our AI teacher replaces your tutor", False),
])
def test_claims_are_limited_to_what_prd_m7_scopes(text, checkable):
    assert is_checkable_claim(text) is checkable


def test_a_word_choice_sent_to_the_claims_specialist_is_refused():
    sentence = "The user can grab the cheap plan today."
    start = DRAFT_2.index(sentence)
    task_ = InvestigationTask(task_id="t5", specialist="claims_evidence", priority="medium", reason="r",
                              focus="Does 'cheap plan' align?", span_start=start,
                              span_end=start + len(sentence), span_text=sentence)
    evidence, _, _ = gather_evidence("claims_evidence", [task_], seed_repo(), 20)
    answer_ = _Claims.model_validate({"evidence_gaps": [], "assessments": [{
        "task_id": "t5", "quote": sentence, "outcome": "partially_supported", "severity": "low",
        "explanation": "'cheap' is subjective.", "evidence_ids": ["FACT-009"], "confidence": 0.8}]})
    candidates, rejected, _, _ = convert_answer("claims_evidence", answer_, [task_], evidence, DRAFT_2)
    assert candidates == []
    assert rejected[0].gate == "scope"
