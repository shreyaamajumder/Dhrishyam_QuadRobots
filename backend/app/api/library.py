"""Brand Library API Router (TRD Section 8: Library, PRD M1).

Endpoints:
  - GET /library/entries: List active/all entries with filters
  - GET /library/entries/{id}: Get single entry
  - GET /library/entries/{id}/versions: Get version history of an entry
  - POST /library/entries: Create entry (Admin only)
  - PATCH /library/entries/{id}: Update entry or toggle is_active (Admin only)
  - POST /library/seed: Reload / seed demo brand kit (Admin only)
  - POST /library/import/preview: (L2) Preview AI-extracted rules from raw text
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context, require_role
from app.db import get_db
from app.models import AuditLog, BrandEntry, BrandEntryVersion, Organization, Profile

router = APIRouter(prefix="/library", tags=["library"])


class EntryPattern(BaseModel):
    rule_type: str | None = None
    banned: str | None = None
    preferred: str | None = None
    regex: str | None = None


class BrandEntryIn(BaseModel):
    code: str
    entry_type: str
    category: str
    title: str
    body: str
    check_mode: str = "deterministic"
    pattern: EntryPattern | dict[str, Any] | None = None
    good_example: str | None = None
    bad_example: str | None = None
    severity_default: str = "medium"
    is_active: bool = True
    change_note: str | None = None


class BrandEntryUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    category: str | None = None
    check_mode: str | None = None
    pattern: EntryPattern | dict[str, Any] | None = None
    good_example: str | None = None
    bad_example: str | None = None
    severity_default: str | None = None
    is_active: bool | None = None
    change_note: str | None = None


class GuidelineImportRequest(BaseModel):
    raw_text: str


def _serialize_entry(entry: BrandEntry, db: Session) -> dict[str, Any]:
    # Look up last updater name from latest version snapshot or fallback
    updater_name = "Admin"
    latest_ver = db.execute(
        select(BrandEntryVersion)
        .where(BrandEntryVersion.entry_id == entry.id)
        .order_by(desc(BrandEntryVersion.version))
        .limit(1)
    ).scalar_one_or_none()
    if latest_ver and latest_ver.changed_by:
        prof = db.get(Profile, latest_ver.changed_by)
        if prof:
            updater_name = prof.display_name or prof.email

    return {
        "id": str(entry.id),
        "org_id": str(entry.org_id),
        "code": entry.code,
        "entry_type": entry.entry_type,
        "category": "facts_claims" if entry.category == "facts_and_claims" else (entry.category or "tone"),
        "title": entry.title,
        "body": entry.body,
        "check_mode": entry.check_mode or "deterministic",
        "pattern": entry.pattern,
        "good_example": entry.good_example,
        "bad_example": entry.bad_example,
        "severity_default": entry.severity_default or "medium",
        "is_active": entry.is_active,
        "current_version": entry.current_version,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else datetime.now(timezone.utc).isoformat(),
        "updated_by_name": updater_name,
    }


@router.get("/entries")
def get_library_entries(
    entry_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all library entries for the organization with optional filters."""
    stmt = select(BrandEntry).where(BrandEntry.org_id == context.org_id)
    if entry_type:
        stmt = stmt.where(BrandEntry.entry_type == entry_type)
    if category:
        cat_filter = "facts_and_claims" if category == "facts_claims" else category
        stmt = stmt.where(BrandEntry.category == cat_filter)
    if is_active is not None:
        stmt = stmt.where(BrandEntry.is_active == is_active)
    if search:
        s = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            BrandEntry.code.ilike(s) | BrandEntry.title.ilike(s) | BrandEntry.body.ilike(s)
        )

    stmt = stmt.order_by(BrandEntry.code.asc())
    entries = db.execute(stmt).scalars().all()
    return [_serialize_entry(e, db) for e in entries]


@router.get("/entries/{entry_id}")
def get_library_entry(
    entry_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve a single library entry."""
    entry = db.get(BrandEntry, entry_id)
    if not entry or entry.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Library entry not found")
    return _serialize_entry(entry, db)


@router.get("/entries/{entry_id}/versions")
def get_entry_versions(
    entry_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Retrieve the immutable version history of a library entry."""
    entry = db.get(BrandEntry, entry_id)
    if not entry or entry.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Library entry not found")

    versions = db.execute(
        select(BrandEntryVersion)
        .where(BrandEntryVersion.entry_id == entry_id)
        .order_by(desc(BrandEntryVersion.version))
    ).scalars().all()

    results = []
    for v in versions:
        changed_by_name = "Admin"
        if v.changed_by:
            prof = db.get(Profile, v.changed_by)
            if prof:
                changed_by_name = prof.display_name or prof.email
        results.append({
            "id": str(v.id),
            "entry_id": str(v.entry_id),
            "version": v.version,
            "snapshot": v.snapshot,
            "change_note": v.snapshot.get("change_note") or f"Version {v.version} update",
            "changed_by_name": changed_by_name,
            "created_at": v.created_at.isoformat() if v.created_at else datetime.now(timezone.utc).isoformat(),
        })
    return results


@router.post("/entries", status_code=status.HTTP_201_CREATED)
def create_library_entry(
    payload: BrandEntryIn,
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a new Brand Library entry. Admin only."""
    clean_code = payload.code.strip().upper()
    existing = db.execute(
        select(BrandEntry).where(BrandEntry.org_id == context.org_id, BrandEntry.code == clean_code)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Entry with code '{clean_code}' already exists.")

    cat = "facts_and_claims" if payload.category == "facts_claims" else payload.category
    pattern_dict = payload.pattern.model_dump() if isinstance(payload.pattern, BaseModel) else payload.pattern

    entry = BrandEntry(
        id=uuid4(),
        org_id=context.org_id,
        code=clean_code,
        entry_type=payload.entry_type,
        category=cat,
        title=payload.title.strip(),
        body=payload.body.strip(),
        check_mode=payload.check_mode,
        pattern=pattern_dict,
        good_example=payload.good_example,
        bad_example=payload.bad_example,
        severity_default=payload.severity_default,
        is_active=payload.is_active,
        current_version=1,
    )
    db.add(entry)
    db.flush()

    # Create immutable version 1 snapshot
    snapshot_data = {
        "title": entry.title,
        "body": entry.body,
        "category": entry.category,
        "check_mode": entry.check_mode,
        "pattern": entry.pattern,
        "severity_default": entry.severity_default,
        "change_note": payload.change_note or "Initial version creation",
    }
    v1 = BrandEntryVersion(
        id=uuid4(),
        entry_id=entry.id,
        version=1,
        snapshot=snapshot_data,
        changed_by=context.user_id,
    )
    db.add(v1)

    # Increment organization library_version
    org = db.get(Organization, context.org_id)
    if org:
        org.library_version += 1

    # Append to audit log
    audit = AuditLog(
        id=uuid4(),
        org_id=context.org_id,
        actor_id=context.user_id,
        action="library.entry_created",
        entity_type="library",
        entity_id=entry.id,
        payload={"code": entry.code, "title": entry.title, "type": entry.entry_type},
    )
    db.add(audit)
    db.commit()

    return _serialize_entry(entry, db)


@router.patch("/entries/{entry_id}")
def update_library_entry(
    entry_id: UUID,
    payload: BrandEntryUpdate,
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Update an existing Brand Library entry. Admin only. Increments version snapshot."""
    entry = db.get(BrandEntry, entry_id)
    if not entry or entry.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Library entry not found")

    changed = False
    if payload.title is not None and payload.title.strip() != entry.title:
        entry.title = payload.title.strip()
        changed = True
    if payload.body is not None and payload.body.strip() != entry.body:
        entry.body = payload.body.strip()
        changed = True
    if payload.category is not None:
        cat = "facts_and_claims" if payload.category == "facts_claims" else payload.category
        if cat != entry.category:
            entry.category = cat
            changed = True
    if payload.check_mode is not None and payload.check_mode != entry.check_mode:
        entry.check_mode = payload.check_mode
        changed = True
    if payload.pattern is not None:
        pattern_dict = payload.pattern.model_dump() if isinstance(payload.pattern, BaseModel) else payload.pattern
        entry.pattern = pattern_dict
        changed = True
    if payload.good_example is not None and payload.good_example != entry.good_example:
        entry.good_example = payload.good_example
        changed = True
    if payload.bad_example is not None and payload.bad_example != entry.bad_example:
        entry.bad_example = payload.bad_example
        changed = True
    if payload.severity_default is not None and payload.severity_default != entry.severity_default:
        entry.severity_default = payload.severity_default
        changed = True
    if payload.is_active is not None and payload.is_active != entry.is_active:
        entry.is_active = payload.is_active
        changed = True

    if changed:
        entry.current_version += 1
        snapshot_data = {
            "title": entry.title,
            "body": entry.body,
            "category": entry.category,
            "check_mode": entry.check_mode,
            "pattern": entry.pattern,
            "severity_default": entry.severity_default,
            "is_active": entry.is_active,
            "change_note": payload.change_note or f"Updated to version {entry.current_version}",
        }
        new_version = BrandEntryVersion(
            id=uuid4(),
            entry_id=entry.id,
            version=entry.current_version,
            snapshot=snapshot_data,
            changed_by=context.user_id,
        )
        db.add(new_version)

        org = db.get(Organization, context.org_id)
        if org:
            org.library_version += 1

        db.add(
            AuditLog(
                id=uuid4(),
                org_id=context.org_id,
                actor_id=context.user_id,
                action="library.entry_updated",
                entity_type="library",
                entity_id=entry.id,
                payload={"code": entry.code, "version": entry.current_version, "is_active": entry.is_active},
            )
        )
        db.commit()

    return _serialize_entry(entry, db)


@router.post("/seed")
def seed_demo_library(
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Admin endpoint to reseed or prime the Brand Library."""
    from app.seed_loader import auto_seed_if_needed

    counts = auto_seed_if_needed(session=db)
    db.commit()
    return {"message": "Brand Library seeded successfully", "counts": counts}


@router.post("/import/preview")
def preview_guideline_import(
    req: GuidelineImportRequest,
    context: RequestContext = Depends(require_role("admin")),
) -> list[dict[str, Any]]:
    """(L2) Propose structured Brand Library entries from pasted unstructured guideline text."""
    text = req.raw_text.strip()
    if not text:
        return []

    lines = [line.strip() for line in text.split("\n") if len(line.strip()) > 10]
    proposed: list[dict[str, Any]] = []

    for idx, line in enumerate(lines[:10], start=1):
        is_term = any(w in line.lower() for w in ["instead of", "always write", "refer to", "term", "never use"])
        is_claim = any(w in line.lower() for w in ["guarantee", "#1", "superlative", "must prove", "evidence"])

        entry_type = "term" if is_term else ("claim_rule" if is_claim else "rule")
        category = "terminology" if is_term else ("facts_claims" if is_claim else "tone")
        code = f"IMP-{entry_type[:4].upper()}-{idx:03d}"

        proposed.append({
            "temp_id": f"tmp_{idx}_{uuid4().hex[:6]}",
            "code": code,
            "entry_type": entry_type,
            "category": category,
            "title": line[:50] + ("..." if len(line) > 50 else ""),
            "body": line,
            "check_mode": "deterministic" if is_term else "llm",
            "severity_default": "high" if is_claim else "medium",
            "decision": "pending",
        })

    return proposed
