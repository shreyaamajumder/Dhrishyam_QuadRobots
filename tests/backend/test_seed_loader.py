import uuid

import pytest
from sqlalchemy import func, select

from app import models as m
from app.seed_loader import code_for, load_seed, org_id_for, parse_member

seed = pytest.importorskip("harness.seed")


def test_code_mapping():
    assert code_for("TONE-001", "guideline") == "R-TONE-001"
    assert code_for("FACT-001", "fact") == "F-001"
    assert code_for("TERM-012", "term") == "T-012"
    assert code_for("CLAIM-005", "claim_rule") == "C-005"


def test_loads_whole_kit_and_passes_every_check_constraint(db):
    counts = load_seed(db, seed.build_seed_entries())
    assert counts["organizations"] == 1
    assert counts["brand_entries"] == 45
    assert counts["brand_entry_versions"] == 45
    types = dict(db.execute(select(m.BrandEntry.entry_type, func.count())
                            .where(m.BrandEntry.org_id == org_id_for("Lumio"))
                            .group_by(m.BrandEntry.entry_type)).all())
    assert types == {"rule": 15, "fact": 10, "term": 15, "claim_rule": 5}


def test_running_twice_adds_nothing(db):
    load_seed(db, seed.build_seed_entries())
    again = load_seed(db, seed.build_seed_entries())
    assert sum(again.values()) == 0


def test_entry_ids_match_the_harness_and_can_be_cited(db):
    entries = seed.build_seed_entries()
    load_seed(db, entries)
    fact = next(e for e in entries if e.public_id == "FACT-001")
    row = db.get(m.BrandEntry, fact.id)
    assert row.code == "F-001" and row.current_version == 1
    # A finding can cite the seeded entry, so the version rows are in place.
    user = m.Profile(id=uuid.uuid4(), email="a@example.com"); db.add(user); db.flush()
    item = m.ContentItem(org_id=row.org_id, creator_id=user.id, title="t"); db.add(item); db.flush()
    ver = m.ContentVersion(content_id=item.id, version_no=1, body_text="x", source="paste",
                           created_by=user.id); db.add(ver); db.flush()
    run = m.CheckRun(content_version_id=ver.id, org_id=row.org_id); db.add(run); db.flush()
    db.add(m.Finding(check_run_id=run.id, org_id=row.org_id, category="facts_and_claims",
                     severity="high", source_type="ai", entry_id=fact.id, entry_version=1,
                     span_start=0, span_end=1, span_text="x", explanation="x",
                     label="unsupported_claim"))
    db.flush()


def test_members_are_created_once(db):
    member = (uuid.uuid4(), "creator@example.com", "creator")
    first = load_seed(db, [], members=[member])
    second = load_seed(db, [], members=[member])
    assert first["profiles"] == 1 and first["memberships"] == 1
    assert second["profiles"] == 0 and second["memberships"] == 0


def test_member_argument_parsing():
    parsed = parse_member(f"{uuid.uuid4()},a@b.com,reviewer")
    assert parsed[2] == "reviewer"
    with pytest.raises(Exception):
        parse_member("not-a-uuid,a@b.com,reviewer")
    with pytest.raises(Exception):
        parse_member(f"{uuid.uuid4()},a@b.com,owner")
