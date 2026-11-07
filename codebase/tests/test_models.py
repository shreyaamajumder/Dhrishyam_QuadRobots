import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app import models as m


def test_shared_enums_match_harness_schemas():
    schemas = pytest.importorskip("harness.schemas")
    assert set(m.CATEGORIES) == {c.value for c in schemas.Category}
    assert set(m.SEVERITIES) == {c.value for c in schemas.Severity}


# ---- helpers ---------------------------------------------------------------------------
def seed(db):
    org = m.Organization(name="Lumio")
    user = m.Profile(id=uuid.uuid4(), email=f"{uuid.uuid4()}@example.com")
    db.add_all([org, user]); db.flush()
    item = m.ContentItem(org_id=org.id, creator_id=user.id, title="Launch post")
    db.add(item); db.flush()
    version = m.ContentVersion(content_id=item.id, version_no=1, body_text="Hello world",
                               source="paste", created_by=user.id)
    entry = m.BrandEntry(org_id=org.id, code="F-USERS", entry_type="fact", title="Users",
                         body="8 million registered users")
    db.add_all([version, entry]); db.flush()
    entry_v1 = m.BrandEntryVersion(entry_id=entry.id, version=1, snapshot={"body": entry.body})
    run = m.CheckRun(content_version_id=version.id, org_id=org.id)
    db.add_all([entry_v1, run]); db.flush()
    return org, user, item, version, entry, run


def finding(org, run, entry=None, **over):
    base = dict(check_run_id=run.id, org_id=org.id, category="facts_and_claims", severity="high",
                source_type="ai", entry_id=entry.id if entry else None,
                entry_version=1 if entry else None, span_start=0, span_end=5, span_text="Hello",
                explanation="x", label="unsupported_claim")
    return m.Finding(**{**base, **over})


def fails(db, *objects):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add_all(objects); db.flush()


# ---- findings: grounded or silent ---------------------------------------------------------
def test_valid_cited_finding_is_accepted(db):
    org, _, _, _, entry, run = seed(db)
    db.add(finding(org, run, entry)); db.flush()


def test_uncited_finding_is_rejected_unless_needs_human_check(db):
    org, _, _, _, _, run = seed(db)
    fails(db, finding(org, run, None, label="issue"))
    db.add(finding(org, run, None, label="needs_human_check")); db.flush()


def test_citation_must_point_at_a_real_entry_version(db):
    org, _, _, _, entry, run = seed(db)
    fails(db, finding(org, run, entry, entry_version=2))


def test_citation_id_and_version_come_as_a_pair(db):
    org, _, _, _, entry, run = seed(db)
    fails(db, finding(org, run, entry, entry_version=None))


def test_secondary_citation_is_version_checked(db):
    org, _, _, _, entry, run = seed(db)
    fails(db, finding(org, run, entry, label="guideline_conflict",
                      secondary_entry_id=entry.id, secondary_entry_version=9))
    db.add(finding(org, run, entry, label="guideline_conflict",
                   secondary_entry_id=entry.id, secondary_entry_version=1)); db.flush()


def test_span_and_value_rules(db):
    org, _, _, _, entry, run = seed(db)
    fails(db, finding(org, run, entry, span_start=5, span_end=5))
    fails(db, finding(org, run, entry, severity="urgent"))
    fails(db, finding(org, run, entry, confidence=1.5))


# ---- uniqueness and roles ------------------------------------------------------------------
def test_entry_code_is_unique_per_org(db):
    org, *_ = seed(db)
    fails(db, m.BrandEntry(org_id=org.id, code="F-USERS", entry_type="fact", title="b", body="b"))


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


def test_finding_decisions_are_append_only_and_view_shows_latest(db):
    org, user, _, _, entry, run = seed(db)
    f = finding(org, run, entry); db.add(f); db.flush()
    first = m.FindingDecision(finding_id=f.id, actor_id=user.id, action="dismissed", reason="n/a")
    db.add(first); db.flush()
    db.add(m.FindingDecision(finding_id=f.id, actor_id=user.id, action="confirmed")); db.flush()
    latest = db.execute(text("select action from finding_current_decision where finding_id=:i"),
                        {"i": f.id}).scalar_one()
    assert latest == "confirmed"
    blocked(db, "update finding_decisions set action='accepted' where id=:i", i=first.id)
    blocked(db, "delete from finding_decisions where id=:i", i=first.id)
    fails(db, m.FindingDecision(finding_id=f.id, actor_id=user.id, action="ignored"))
