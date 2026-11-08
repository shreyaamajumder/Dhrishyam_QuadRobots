"""Content Intake, Versions & Document Management API Router (TRD Section 8: Content, PRD M2, M9).

Endpoints:
  - GET /content: List content items with status and owner filters
  - GET /content/{id}: Get complete content item with versions, latest check, and comments
  - POST /content: Create draft with version 1 (paste)
  - POST /content/upload: Upload .txt or .docx document
  - PUT /content/{id}/body: Save manual edit (creates new immutable version, returns to draft)
  - POST /content/{id}/duplicate: Clone content as new draft
  - DELETE /content/{id}: Not available yet (content history is append-only)
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.brand_check import latest_run_for_content, run_json
from app.db import get_db
from app.models import AuditLog, Comment, ContentItem, ContentVersion, Finding, Profile

router = APIRouter(prefix="/content", tags=["content"])


class ContentCreateIn(BaseModel):
    title: str
    content_type: str = "blog"
    body_text: str


class ContentBodyUpdateIn(BaseModel):
    body_text: str
    source: str = "manual"


def _word_count(text: str) -> int:
    return len([w for w in text.split() if w.strip()])


def _build_timeline(content_id: UUID, org_id: UUID, db: Session) -> list[dict[str, Any]]:
    audits = db.execute(
        select(AuditLog)
        .where(AuditLog.org_id == org_id, AuditLog.entity_id == content_id)
        .order_by(AuditLog.created_at.asc())
    ).scalars().all()

    timeline = []
    for a in audits:
        actor_name = "User"
        actor_role = "creator"
        if a.actor_id:
            prof = db.get(Profile, a.actor_id)
            if prof:
                actor_name = prof.display_name or prof.email
        summary = (a.payload or {}).get("summary") or a.action.replace(".", " ").capitalize()
        timeline.append({
            "id": f"tl_{a.id.hex[:8]}",
            "content_id": str(content_id),
            "actor_name": actor_name,
            "actor_role": actor_role,
            "event_type": a.action,
            "summary": summary,
            "created_at": a.created_at.isoformat() if a.created_at else datetime.now(timezone.utc).isoformat(),
        })
    return timeline


def _serialize_content_item(item: ContentItem, db: Session, full: bool = True) -> dict[str, Any]:
    creator_name = "Creator"
    creator = db.get(Profile, item.creator_id)
    if creator:
        creator_name = creator.display_name or creator.email

    reviewer_name = None
    if item.reviewer_id:
        rev = db.get(Profile, item.reviewer_id)
        if rev:
            reviewer_name = rev.display_name or rev.email

    versions = db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == item.id)
        .order_by(ContentVersion.version_no.asc())
    ).scalars().all()

    latest_ver = versions[-1] if versions else None
    current_body = latest_ver.body_text if latest_ver else ""

    result: dict[str, Any] = {
        "id": str(item.id),
        "org_id": str(item.org_id),
        "creator_id": str(item.creator_id),
        "creator_name": creator_name,
        "title": item.title,
        "content_type": item.content_type or "blog",
        "status": item.status,
        "current_version_no": item.current_version_no,
        "reviewer_id": str(item.reviewer_id) if item.reviewer_id else None,
        "reviewer_name": reviewer_name,
        "updated_at": item.updated_at.isoformat() if item.updated_at else datetime.now(timezone.utc).isoformat(),
        "language_detected": "en",
        "word_count": _word_count(current_body),
    }

    if not full:
        # Lightweight for lists
        return result

    # Serialize versions
    serialized_versions = []
    for v in versions:
        v_creator_name = creator_name
        if v.created_by != item.creator_id:
            vc = db.get(Profile, v.created_by)
            if vc:
                v_creator_name = vc.display_name or vc.email
        serialized_versions.append({
            "id": str(v.id),
            "content_id": str(v.content_id),
            "version_no": v.version_no,
            "body_text": v.body_text,
            "source": v.source,
            "created_by_id": str(v.created_by),
            "created_by_name": v_creator_name,
            "created_at": v.created_at.isoformat() if v.created_at else datetime.now(timezone.utc).isoformat(),
        })
    result["versions"] = serialized_versions

    # Latest check (on any version: accepted suggestions create new versions, and the
    # check's findings stay open on them)
    run = latest_run_for_content(db, item.id)
    latest_check = run_json(db, run) if run else None

    result["latest_check"] = latest_check

    # Comments
    comments = db.execute(
        select(Comment).where(Comment.content_id == item.id).order_by(Comment.created_at.asc())
    ).scalars().all()
    serialized_comments = []
    for c in comments:
        c_author = db.get(Profile, c.author_id)
        serialized_comments.append({
            "id": str(c.id),
            "content_id": str(c.content_id),
            "version_no": c.version_no,
            "author_id": str(c.author_id),
            "author_name": c_author.display_name or c_author.email if c_author else "Reviewer",
            "author_role": "reviewer",
            "body": c.body,
            "anchor_text": None,
            "finding_id": str(c.finding_id) if c.finding_id else None,
            "created_at": c.created_at.isoformat() if c.created_at else datetime.now(timezone.utc).isoformat(),
        })
    result["comments"] = serialized_comments

    # Timeline
    result["timeline"] = _build_timeline(item.id, item.org_id, db)
    return result


@router.get("")
def list_content(
    status_filter: str | None = Query(default=None, alias="status"),
    mine: bool | None = Query(default=None),
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List content items for the current organization."""
    stmt = select(ContentItem).where(ContentItem.org_id == context.org_id)

    # Scoping by role
    if context.role == "creator":
        stmt = stmt.where(ContentItem.creator_id == context.user_id)
    elif mine:
        stmt = stmt.where(ContentItem.creator_id == context.user_id)

    if status_filter:
        stmt = stmt.where(ContentItem.status == status_filter)

    stmt = stmt.order_by(desc(ContentItem.updated_at))
    items = db.execute(stmt).scalars().all()
    return [_serialize_content_item(item, db, full=True) for item in items]


@router.get("/{content_id}")
def get_content(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve full content item with all versions, checks, and comments."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    if context.role == "creator" and item.creator_id != context.user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only view your own drafts")

    return _serialize_content_item(item, db, full=True)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_content(
    payload: ContentCreateIn,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a new draft with version 1 from pasted text."""
    body_clean = payload.body_text.strip()
    words = _word_count(body_clean)
    if words < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content is too short (minimum 3 words).")
    if words > 2000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content exceeds 2,000 words limit.")

    item = ContentItem(
        id=uuid4(),
        org_id=context.org_id,
        creator_id=context.user_id,
        title=payload.title.strip() or "Untitled Draft",
        content_type=payload.content_type,
        status="draft",
        current_version_no=1,
    )
    db.add(item)
    db.flush()

    v1 = ContentVersion(
        id=uuid4(),
        content_id=item.id,
        version_no=1,
        body_text=body_clean,
        source="paste",
        created_by=context.user_id,
    )
    db.add(v1)

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="content.created",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": f"Created draft v1 via pasted text ({words} words)"},
        )
    )
    db.commit()

    return _serialize_content_item(item, db, full=True)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_content(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    content_type: str = Form(default="blog"),
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Upload a .txt or .docx document and extract text into a new draft."""
    file_bytes = await file.read()
    filename = (file.filename or "").lower()

    extracted_text = ""
    if filename.endswith(".txt"):
        try:
            extracted_text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            extracted_text = file_bytes.decode("latin-1")
    elif filename.endswith(".docx"):
        try:
            import docx

            doc = docx.Document(io.BytesIO(file_bytes))
            extracted_text = "\n\n".join([p.text for p in doc.paragraphs if p.text.strip()])
        except Exception as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not read .docx file: {e}")
    else:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported file format. Please upload .txt or .docx.")

    clean_text = extracted_text.strip()
    words = _word_count(clean_text)
    if words < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Extracted file content is too short (minimum 3 words).")

    final_title = title.strip() or filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").title()

    item = ContentItem(
        id=uuid4(),
        org_id=context.org_id,
        creator_id=context.user_id,
        title=final_title,
        content_type=content_type,
        status="draft",
        current_version_no=1,
    )
    db.add(item)
    db.flush()

    v1 = ContentVersion(
        id=uuid4(),
        content_id=item.id,
        version_no=1,
        body_text=clean_text,
        source="upload",
        created_by=context.user_id,
    )
    db.add(v1)

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="content.uploaded",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": f"Uploaded document '{file.filename}' ({words} words)"},
        )
    )
    db.commit()

    return _serialize_content_item(item, db, full=True)


@router.put("/{content_id}/body")
def update_content_body(
    content_id: UUID,
    payload: ContentBodyUpdateIn,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Save document edits. Creates a new immutable ContentVersion and resets status to draft."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    new_body = payload.body_text.strip()
    words = _word_count(new_body)
    if words < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content cannot be empty or under 3 words.")

    next_version = item.current_version_no + 1
    new_ver = ContentVersion(
        id=uuid4(),
        content_id=item.id,
        version_no=next_version,
        body_text=new_body,
        source=payload.source,
        created_by=context.user_id,
    )
    db.add(new_ver)

    # The text changed by hand, so the last check's open findings may no longer line up.
    run = latest_run_for_content(db, item.id)
    if run:
        for finding in db.scalars(select(Finding).where(Finding.check_run_id == run.id)).all():
            finding.is_stale = True

    # Per SRS FR-WFL-6: editing returns status to draft and clears prior approvals
    old_status = item.status
    item.current_version_no = next_version
    item.status = "draft"

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="content.edited",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": f"Saved manual edit as v{next_version} (status reset from {old_status} to draft)"},
        )
    )
    db.commit()

    return _serialize_content_item(item, db, full=True)


@router.post("/{content_id}/duplicate")
def duplicate_content(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Duplicate an existing content item as a new draft."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    latest_ver = db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == item.id, ContentVersion.version_no == item.current_version_no)
    ).scalar_one_or_none()

    body = latest_ver.body_text if latest_ver else "Draft copy"

    new_item = ContentItem(
        id=uuid4(),
        org_id=context.org_id,
        creator_id=context.user_id,
        title=f"{item.title} (Copy)",
        content_type=item.content_type,
        status="draft",
        current_version_no=1,
    )
    db.add(new_item)
    db.flush()

    v1 = ContentVersion(
        id=uuid4(),
        content_id=new_item.id,
        version_no=1,
        body_text=body,
        source="manual",
        created_by=context.user_id,
    )
    db.add(v1)
    db.commit()

    return _serialize_content_item(new_item, db, full=True)


@router.delete("/{content_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> None:
    """Drafts cannot be deleted yet.

    Content versions (and check steps, citations and suggestions) are append-only by design,
    and the database refuses to delete them. A later migration can add an "archived" flag so
    drafts can be hidden instead.
    """
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")
    raise HTTPException(status.HTTP_409_CONFLICT,
                        "Drafts can't be deleted yet. Content history is kept for the audit trail.")
