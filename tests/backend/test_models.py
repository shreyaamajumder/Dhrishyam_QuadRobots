import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app import models as m


def test_shared_enums_match_harness_schemas():
    schemas = pytest.importorskip("harness.schemas")
    pairs = [
        (m.CATEGORIES, schemas.Category),
        (m.SEVERITIES, schemas.Severity),
        (m.DISPLAY_STATUSES, schemas.DisplayStatus),
        (m.CLAIM_OUTCOMES, schemas.ClaimOutcome),
        (m.ORIGINS, schemas.Origin),
        (m.RUN_MODES, schemas.RunMode),
        (m.RUN_EVENT_TYPES, schemas.RunEventType),
    ]
    for db_values, harness_enum in pairs:
        assert set(db_values) == {item.value for item in harness_enum}, harness_enum.__name__


# ---- helpers ---------------------------------------------------------------------------
def seed(db, org_name="Lumio"):
    org = m.Organization(name=org_name)
    user = m.Profile(id=uuid.uuid4(), email=f"{uuid.uuid4()}@example.com")
    db.add_all([org, user]); db.flush()
    item = m.ContentItem(org_id=org.id, creator_id=user.id, title="Launch post")
    db.add(item); db.flush()
    version = m.ContentVersion(content_id=item.id, version_no=1, body_text="Hello world",
                               source="paste", created_by=user.id)
    entry = m.BrandEntry(org_id=org.id, code=f"F-USERS-{uuid.uuid4().hex[:6]}", entry_type="fact",
                         title="Users", body="8 million registered users")
    db.add_all([version, entry]); db.flush()
    entry_v1 = m.BrandEntryVersion(entry_id=entry.id, version=1, snapshot={"body": entry.body})
    run = m.CheckRun(content_version_id=version.id, org_id=org.id)
    db.add_all([entry_v1, run]); db.flush()
    return org, user, item, version, entry, run


def finding(org, run, **over):
    base = dict(check_run_id=run.id, org_id=org.id, category="facts_and_claims", severity="high",
                display_status="needs_human_verification", claim_outcome="unsupported",
                origin="ai", span_start=0, span_end=5, span_text="Hello", explanation="x",
                produced_by=["claims_evidence"])
    return m.Finding(**{**base, **over})


def citation(f, entry, version=1, quote="8 million registered users"):
    return m.FindingCitation(finding_id=f.id, entry_id=entry.id, entry_version=version, quote=quote)


def fails(db, *objects):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add_all(objects); db.flush()


def check_now(db):
    """Run the deferred grounded-or-silent check now instead of at COMMIT."""
    db.execute(text("SET CONSTRAINTS findings_grounded_or_flagged IMMEDIATE"))


def commit_check_fails(db, *objects):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add_all(objects); db.flush()
            check_now(db)
    db.execute(text("SET CONSTRAINTS findings_grounded_or_flagged DEFERRED"))


# ---- findings: grounded or silent ---------------------------------------------------------
def test_confirmed_finding_with_citation_is_accepted(db):
    org, _, _, _, entry, run = seed(db)
    f = finding(org, run, display_status="confirmed"); db.add(f); db.flush()
    db.add(citation(f, entry)); db.flush()
    check_now(db)


def test_citation_can_be_added_after_the_finding_in_the_same_transaction(db):
    org, _, _, _, entry, run = seed(db)
    f = finding(org, run, display_status="confirmed"); db.add(f); db.flush()
    db.execute(text("select 1"))  # other work in between is fine: the check waits for COMMIT
    db.add(citation(f, entry)); db.flush()
    check_now(db)


def test_confirmed_finding_without_citation_is_rejected(db):
    org, _, _, _, _, run = seed(db)
    commit_check_fails(db, finding(org, run, display_status="confirmed"))


def test_finding_needing_verification_may_have_no_citation(db):
    org, _, _, _, _, run = seed(db)
    db.add(finding(org, run)); db.flush()
    check_now(db)


def test_finding_cannot_be_switched_to_confirmed_without_citation(db):
    org, _, _, _, _, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.execute(text("update findings set display_status='confirmed' where id=:i"),
                       {"i": f.id})
            check_now(db)


def test_finding_can_have_many_citations(db):
    org, _, _, _, entry, run = seed(db)
    other = m.BrandEntry(org_id=org.id, code="C-RANK", entry_type="claim_rule",
                         title="Rankings", body="Rankings need evidence")
    third = m.BrandEntry(org_id=org.id, code="C-NUM", entry_type="claim_rule",
                         title="Numbers", body="Numbers must match facts")
    db.add_all([other, third]); db.flush()
    db.add_all([m.BrandEntryVersion(entry_id=e.id, version=1, snapshot={}) for e in (other, third)])
    f = finding(org, run, display_status="confirmed", guideline_conflict=True)
    db.add(f); db.flush()
    db.add_all([citation(f, entry), citation(f, other, quote=other.body),
                citation(f, third, quote=third.body)]); db.flush()
    check_now(db)


def test_citation_must_point_at_a_real_entry_version(db):
    org, _, _, _, entry, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    fails(db, citation(f, entry, version=2))


def test_same_citation_cannot_be_added_twice(db):
    org, _, _, _, entry, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    db.add(citation(f, entry)); db.flush()
    fails(db, citation(f, entry))


def test_citation_quote_cannot_be_blank(db):
    org, _, _, _, entry, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    fails(db, citation(f, entry, quote="  "))


def test_finding_cannot_cite_another_organisations_entry(db):
    org, _, _, _, _, run = seed(db)
    _, _, _, _, foreign_entry, _ = seed(db, org_name="Other org")
    f = finding(org, run); db.add(f); db.flush()
    fails(db, citation(f, foreign_entry))


# ---- findings: values the harness produces -------------------------------------------------
@pytest.mark.parametrize("outcome", m.CLAIM_OUTCOMES)
def test_every_claim_outcome_can_be_stored(db, outcome):
    org, _, _, _, _, run = seed(db)
    db.add(finding(org, run, claim_outcome=outcome)); db.flush()


def test_false_is_not_a_claim_outcome(db):
    org, _, _, _, _, run = seed(db)
    fails(db, finding(org, run, claim_outcome="false"))


def test_claim_outcome_only_on_claim_findings(db):
    org, _, _, _, _, run = seed(db)
    fails(db, finding(org, run, claim_outcome=None))
    fails(db, finding(org, run, category="tone", claim_outcome="unsupported"))
    db.add(finding(org, run, category="tone", claim_outcome=None)); db.flush()


def test_origin_and_status_values(db):
    org, _, _, _, _, run = seed(db)
    fails(db, finding(org, run, origin="rule_engine"))
    fails(db, finding(org, run, display_status="issue"))
    db.add(finding(org, run, origin="rule_based")); db.flush()


def test_span_and_value_rules(db):
    org, _, _, _, _, run = seed(db)
    fails(db, finding(org, run, span_start=5, span_end=5))
    fails(db, finding(org, run, span_text="Hello!"))  # length must match the offsets
    fails(db, finding(org, run, severity="urgent"))
    fails(db, finding(org, run, confidence=1.5))


def test_provenance_and_flags_are_stored(db):
    org, _, _, _, _, run = seed(db)
    f = finding(org, run, produced_by=["orchestrator", "claims_evidence", "critic"],
                critic_verdict={"verdict": "confirmed", "reason": "no approved ranking"})
    db.add(f); db.flush(); db.refresh(f)
    assert f.produced_by == ["orchestrator", "claims_evidence", "critic"]
    assert f.critic_verdict["verdict"] == "confirmed"
    assert f.is_stale is False and f.guideline_conflict is False


def test_findings_can_be_marked_stale(db):
    org, _, _, _, _, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    db.execute(text("update findings set is_stale = true where id=:i"), {"i": f.id})


# ---- suggestions ---------------------------------------------------------------------------
def test_structured_suggestion_is_stored_once_per_finding(db):
    org, _, _, _, _, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    db.add(m.Suggestion(finding_id=f.id, before_text="10 million users",
                        after_text="8 million registered users",
                        rationale="FACT-001 states 8 million registered users.")); db.flush()
    fails(db, m.Suggestion(finding_id=f.id, before_text="x", after_text="y", rationale="z"))


def test_suggestion_may_delete_text_but_needs_a_rationale(db):
    org, _, _, _, _, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    fails(db, m.Suggestion(finding_id=f.id, before_text="x", after_text="", rationale=" "))
    fails(db, m.Suggestion(finding_id=f.id, before_text="", after_text="y", rationale="r"))
    db.add(m.Suggestion(finding_id=f.id, before_text="x", after_text="", rationale="Remove it."))
    db.flush()


# ---- run steps and check runs --------------------------------------------------------------
def test_run_steps_keep_event_order_and_reject_duplicates(db):
    org, _, _, _, _, run = seed(db)
    db.add_all([
        m.RunStep(run_id=run.id, seq=0, event_type="run.started"),
        m.RunStep(run_id=run.id, seq=1, event_type="plan.created", node="orchestrator",
                  kind="plan", data={"tasks": ["ranking", "user count"]}, latency_ms=900),
        m.RunStep(run_id=run.id, seq=2, event_type="gate.rejected", node="citation_gate",
                  kind="gate", data={"gate": "citation", "reason": "unknown entry"}),
    ]); db.flush()
    fails(db, m.RunStep(run_id=run.id, seq=1, event_type="tool.called"))


def test_run_step_values_are_checked(db):
    org, _, _, _, _, run = seed(db)
    fails(db, m.RunStep(run_id=run.id, seq=0, event_type="run.exploded"))
    fails(db, m.RunStep(run_id=run.id, seq=0, event_type="run.started", kind="magic"))
    fails(db, m.RunStep(run_id=run.id, seq=-1, event_type="run.started"))


def test_check_run_mode_and_library_version(db):
    org, _, _, version, _, _ = seed(db)
    db.add(m.CheckRun(content_version_id=version.id, org_id=org.id, mode="deterministic_only",
                      library_version=3)); db.flush()
    fails(db, m.CheckRun(content_version_id=version.id, org_id=org.id, mode="turbo"))
    fails(db, m.CheckRun(content_version_id=version.id, org_id=org.id, library_version=-1))


# ---- uniqueness and roles ------------------------------------------------------------------
def test_entry_code_is_unique_per_org(db):
    org, _, _, _, entry, _ = seed(db)
    fails(db, m.BrandEntry(org_id=org.id, code=entry.code, entry_type="fact", title="b", body="b"))


def test_entry_type_values_follow_the_spec(db):
    org, *_ = seed(db)
    fails(db, m.BrandEntry(org_id=org.id, code="X-1", entry_type="guideline", title="b", body="b"))


def test_membership_role_and_uniqueness(db):
    org, user, *_ = seed(db)
    fails(db, m.Membership(org_id=org.id, user_id=user.id, role="owner"))
    db.add(m.Membership(org_id=org.id, user_id=user.id, role="creator")); db.flush()
    fails(db, m.Membership(org_id=org.id, user_id=user.id, role="admin"))


def test_content_version_numbers_are_unique_per_item(db):
    _, user, item, *_ = seed(db)
    fails(db, m.ContentVersion(content_id=item.id, version_no=1, body_text="dup",
                               source="manual", created_by=user.id))


# ---- reviews and comments -------------------------------------------------------------------
def test_changes_requested_needs_a_comment(db):
    _, user, item, *_ = seed(db)
    fails(db, m.ReviewDecision(content_id=item.id, version_no=1, reviewer_id=user.id,
                               decision="changes_requested", comment="  "))
    db.add(m.ReviewDecision(content_id=item.id, version_no=1, reviewer_id=user.id,
                            decision="changes_requested", comment="Fix the claim")); db.flush()


def test_review_must_reference_an_existing_version(db):
    _, user, item, *_ = seed(db)
    fails(db, m.ReviewDecision(content_id=item.id, version_no=7, reviewer_id=user.id,
                               decision="approved"))


def test_comment_anchors_are_optional_but_must_be_valid(db):
    _, user, item, *_ = seed(db)
    db.add(m.Comment(content_id=item.id, version_no=1, author_id=user.id, body="ok")); db.flush()
    db.add(m.Comment(content_id=item.id, version_no=1, author_id=user.id, body="ok",
                     anchor_start=0, anchor_end=4)); db.flush()
    fails(db, m.Comment(content_id=item.id, version_no=1, author_id=user.id, body="bad",
                        anchor_start=4, anchor_end=4))
    fails(db, m.Comment(content_id=item.id, version_no=1, author_id=user.id, body="bad",
                        anchor_start=2, anchor_end=None))


# ---- append-only tables ---------------------------------------------------------------------
def blocked(db, sql, **params):
    with pytest.raises(DBAPIError):
        with db.begin_nested():
            db.execute(text(sql), params)


def test_audit_log_is_append_only(db):
    org, *_ = seed(db)
    row = m.AuditLog(org_id=org.id, action="test", entity_type="x")
    db.add(row); db.flush()
    blocked(db, "update audit_log set action='changed' where id=:i", i=row.id)
    blocked(db, "delete from audit_log where id=:i", i=row.id)


def test_content_versions_are_immutable(db):
    _, _, _, version, *_ = seed(db)
    blocked(db, "update content_versions set body_text='changed' where id=:i", i=version.id)
    blocked(db, "delete from content_versions where id=:i", i=version.id)


def test_brand_entry_versions_are_immutable(db):
    _, _, _, _, entry, _ = seed(db)
    blocked(db, "update brand_entry_versions set snapshot='{}' where entry_id=:i", i=entry.id)


@pytest.mark.parametrize("table", ["finding_citations", "suggestions", "run_steps"])
def test_new_harness_tables_are_immutable(db, table):
    org, _, _, _, entry, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    db.add_all([citation(f, entry),
                m.Suggestion(finding_id=f.id, before_text="x", after_text="y", rationale="r"),
                m.RunStep(run_id=run.id, seq=0, event_type="run.started")]); db.flush()
    blocked(db, f"update {table} set created_at = now()")
    blocked(db, f"delete from {table}")


def test_finding_decisions_are_append_only_and_view_shows_latest(db):
    org, user, _, _, entry, run = seed(db)
    f = finding(org, run); db.add(f); db.flush()
    first = m.FindingDecision(finding_id=f.id, actor_id=user.id, action="dismissed", reason="n/a")
    db.add(first); db.flush()
    db.add(m.FindingDecision(finding_id=f.id, actor_id=user.id, action="confirmed")); db.flush()
    latest = db.execute(text("select action from finding_current_decision where finding_id=:i"),
                        {"i": f.id}).scalar_one()
    assert latest == "confirmed"
    blocked(db, "update finding_decisions set action='accepted' where id=:i", i=first.id)
    blocked(db, "delete from finding_decisions where id=:i", i=first.id)
    fails(db, m.FindingDecision(finding_id=f.id, actor_id=user.id, action="ignored"))
