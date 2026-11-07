"""Load the harness demo brand kit (harness/seed.py) into the database.

    python -m app.seed_loader
    python -m app.seed_loader --member <auth-user-uuid>,creator@example.com,creator

Safe to run more than once: rows that already exist are skipped. The entry ids are the same
UUIDs the harness uses (make_entry_id), so citations match between the harness and the database.
Needs the harness package importable (copy harness/ and gates/ into backend/).
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterable
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app import models as m

# Harness entry type -> database entry_type (TRD section 7).
TYPE_MAP = {"guideline": "rule", "fact": "fact", "term": "term", "claim_rule": "claim_rule"}
CODE_PREFIX = {"fact": "F", "term": "T", "claim_rule": "C"}

# Starting values chosen for the demo kit; the library admin can edit them later.
CHECK_MODE_BY_PREFIX = {"TONE": "llm", "MSG": "llm", "ACC": "deterministic"}  # VIS has none
SEVERITY_BY_PREFIX = {"TONE": "low", "MSG": "medium", "ACC": "medium", "VIS": "low"}


def org_id_for(name: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"brandguard/org/{name.lower()}")


def code_for(public_id: str, entry_type: str) -> str:
    """TONE-001 -> R-TONE-001 (rules); FACT-001 -> F-001; TERM-001 -> T-001; CLAIM-001 -> C-001."""
    if entry_type == "guideline":
        return f"R-{public_id}"
    number = re.search(r"(\d+)$", public_id).group(1)  # type: ignore[union-attr]
    return f"{CODE_PREFIX[entry_type]}-{number}"


def entry_row(entry: Any, org_id: UUID) -> dict[str, Any]:
    kind = entry.entry_type.value
    prefix = entry.public_id.split("-")[0]
    if kind == "guideline":
        check_mode, severity = CHECK_MODE_BY_PREFIX.get(prefix), SEVERITY_BY_PREFIX.get(prefix)
    elif kind == "term":
        check_mode, severity = "deterministic", "low"
    elif kind == "claim_rule":
        check_mode, severity = "llm", "high"
    else:  # fact
        check_mode, severity = None, None
    return {
        "id": entry.id,
        "org_id": org_id,
        "code": code_for(entry.public_id, kind),
        "entry_type": TYPE_MAP[kind],
        "category": entry.category.value if entry.category else None,
        "title": entry.title,
        "body": entry.body,
        "check_mode": check_mode,
        "pattern": entry.metadata or None,
        "good_example": entry.good_example,
        "bad_example": entry.bad_example,
        "severity_default": severity,
        "is_active": entry.is_active,
        "current_version": 1,
    }


def snapshot(row: dict[str, Any]) -> dict[str, Any]:
    keep = ("code", "entry_type", "category", "title", "body", "check_mode", "pattern",
            "good_example", "bad_example", "severity_default")
    return {key: row[key] for key in keep}


def _inserted(session: Session, model: Any, values: Any) -> int:
    """Run INSERT ... ON CONFLICT DO NOTHING and count the rows that were really added."""
    statement = pg_insert(model).values(values).on_conflict_do_nothing().returning(model.__table__.c.id)
    return len(session.execute(statement).all())


def load_seed(
    session: Session,
    entries: Iterable[Any],
    org_name: str = "Lumio",
    members: Iterable[tuple[Any, ...]] = (),
    org_id: UUID | None = None,
) -> dict[str, int]:
    """Insert org, entries, version-1 snapshots and optional members. Returns rows inserted."""
    target_org_id = org_id or org_id_for(org_name)
    counts = {"organizations": 0, "brand_entries": 0, "brand_entry_versions": 0,
              "profiles": 0, "memberships": 0}

    counts["organizations"] = _inserted(
        session, m.Organization, {"id": target_org_id, "name": org_name, "library_version": 1})

    rows = [entry_row(entry, target_org_id) for entry in entries]
    if rows:
        counts["brand_entries"] = _inserted(session, m.BrandEntry, rows)
        counts["brand_entry_versions"] = _inserted(
            session, m.BrandEntryVersion,
            [{"entry_id": r["id"], "version": 1, "snapshot": snapshot(r)} for r in rows])

    for item in members:
        if len(item) == 4:
            user_id, email, role, display_name = item
        else:
            user_id, email, role = item
            display_name = None

        existing = session.execute(
            select(m.Profile.id).where(m.Profile.email == email)).scalar_one_or_none()
        if existing is not None and existing != user_id:
            raise ValueError(
                f"{email} is already registered under a different user id ({existing}). "
                "Use the User UID shown in Supabase Authentication for that email.")
        
        prof_values: dict[str, Any] = {"id": user_id, "email": email}
        if display_name:
            prof_values["display_name"] = display_name
        counts["profiles"] += _inserted(session, m.Profile, prof_values)
        counts["memberships"] += _inserted(
            session, m.Membership, {"org_id": target_org_id, "user_id": user_id, "role": role})
    return counts


def auto_seed_if_needed(session: Session | None = None) -> dict[str, int]:
    """Auto-seeds demo kit, demo members, and showcase draft if not already present."""
    from app.auth import DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_USERS
    from app.db import SessionLocal
    from harness.seed import SHOWCASE_DRAFT, build_seed_entries

    demo_members = [
        (DEMO_USERS["creator"]["id"], DEMO_USERS["creator"]["email"], "creator", DEMO_USERS["creator"]["display_name"]),
        (DEMO_USERS["reviewer"]["id"], DEMO_USERS["reviewer"]["email"], "reviewer", DEMO_USERS["reviewer"]["display_name"]),
        (DEMO_USERS["admin"]["id"], DEMO_USERS["admin"]["email"], "admin", DEMO_USERS["admin"]["display_name"]),
    ]

    def _do_seed(s: Session) -> dict[str, int]:
        counts = load_seed(
            s,
            entries=build_seed_entries(),
            org_name=DEMO_ORG_NAME,
            members=demo_members,
            org_id=DEMO_ORG_ID,
        )

        # Seed initial showcase draft content if none exists
        has_content = s.execute(
            select(m.ContentItem.id).where(m.ContentItem.org_id == DEMO_ORG_ID).limit(1)
        ).scalar_one_or_none()
        if not has_content:
            creator_id = DEMO_USERS["creator"]["id"]
            reviewer_id = DEMO_USERS["reviewer"]["id"]
            demo_item = m.ContentItem(
                id=UUID("20000000-0000-0000-0000-000000000001"),
                org_id=DEMO_ORG_ID,
                creator_id=creator_id,
                title="Q4 Platform Launch Announcement",
                content_type="blog",
                status="draft",
                current_version_no=1,
                reviewer_id=reviewer_id,
            )
            s.add(demo_item)
            s.flush()

            demo_ver = m.ContentVersion(
                id=UUID("30000000-0000-0000-0000-000000000001"),
                content_id=demo_item.id,
                version_no=1,
                body_text=SHOWCASE_DRAFT,
                source="paste",
                created_by=creator_id,
            )
            s.add(demo_ver)
            s.flush()

        return counts

    if session is not None:
        return _do_seed(session)

    with SessionLocal() as session_ctx:
        with session_ctx.begin():
            return _do_seed(session_ctx)


def parse_member(text: str) -> tuple[UUID, str, str]:
    try:
        user_id, email, role = [part.strip() for part in text.split(",")]
        if role not in m.ROLES:
            raise ValueError(f"role must be one of {m.ROLES}")
        return UUID(user_id), email, role
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            f"use <auth-user-uuid>,<email>,<role>; {error}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load the Lumio demo brand kit.")
    parser.add_argument("--org-name", default="Lumio")
    parser.add_argument("--member", action="append", type=parse_member, default=[],
                        metavar="UUID,EMAIL,ROLE",
                        help="repeatable; the UUID is the user's id under Supabase Authentication")
    args = parser.parse_args(argv)

    try:
        from harness.seed import build_seed_entries
    except ModuleNotFoundError as error:
        if (error.name or "").split(".")[0] in ("harness", "gates"):
            print("Cannot import harness.seed. Copy the harness/ and gates/ folders into backend/.",
                  file=sys.stderr)
        else:
            print(f"A package the harness needs is missing: {error.name}. "
                  "Run: python -m pip install -r requirements.txt", file=sys.stderr)
        return 1

    from app.db import SessionLocal

    try:
        with SessionLocal.begin() as session:
            counts = load_seed(session, build_seed_entries(), args.org_name, args.member)
    except ValueError as error:
        print(f"Not loaded: {error}", file=sys.stderr)
        return 1
    for table, inserted in counts.items():
        print(f"{table:22} +{inserted}")
    if not any(counts.values()):
        print("Nothing new: already seeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
