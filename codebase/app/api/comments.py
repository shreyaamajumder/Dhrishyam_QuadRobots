"""Content Comments API Router (TRD Section 8: Comments).

Endpoints:
  - GET /content/{content_id}/comments: Get comments for content
  - POST /content/{content_id}/comments: Add anchored or general comment
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.db import get_db
from app.models import AuditLog, Comment, ContentItem, ContentVersion, Profile

router = APIRouter(prefix="/content", tags=["comments"])


class CommentCreateIn(BaseModel):
    version_no: int = 1
    body: str
    anchor_text: str | None = None
    finding_id: UUID | None = None


@router.get("/{content_id}/comments")
def get_comments(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Retrieve all comments on a content item."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    comments = db.execute(
        select(Comment)
        .where(Comment.content_id == content_id)
        .order_by(Comment.created_at.asc())
    ).scalars().all()

    result = []
    for c in comments:
        prof = db.get(Profile, c.author_id)
        author_name = prof.display_name or prof.email if prof else "Reviewer"
        result.append({
            "id": str(c.id),
            "content_id": str(c.content_id),
            "version_no": c.version_no,
            "author_id": str(c.author_id),
            "author_name": author_name,
            "author_role": context.role,
            "body": c.body,
            "anchor_text": None,
            "finding_id": str(c.finding_id) if c.finding_id else None,
            "created_at": c.created_at.isoformat() if c.created_at else datetime.now(timezone.utc).isoformat(),
        })
    return result


@router.post("/{content_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    content_id: UUID,
    payload: CommentCreateIn,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Add a new anchored or general review comment."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    clean_body = payload.body.strip()
    if not clean_body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Comment body cannot be empty.")

    # Ensure version exists
    ver = db.execute(
        select(ContentVersion).where(
            ContentVersion.content_id == content_id, ContentVersion.version_no == payload.version_no
        )
    ).scalar_one_or_none()
    if not ver:
        payload.version_no = item.current_version_no

    comment = Comment(
        id=uuid4(),
        content_id=item.id,
        version_no=payload.version_no,
        author_id=context.user_id,
        body=clean_body,
        finding_id=payload.finding_id,
    )
    db.add(comment)

    prof = db.get(Profile, context.user_id)
    author_name = prof.display_name or prof.email if prof else "Reviewer"

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="comment.added",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": f"Comment added on v{payload.version_no}: {clean_body[:60]}"},
        )
    )
    db.commit()

    return {
        "id": str(comment.id),
        "content_id": str(comment.content_id),
        "version_no": comment.version_no,
        "author_id": str(comment.author_id),
        "author_name": author_name,
        "author_role": context.role,
        "body": comment.body,
        "anchor_text": payload.anchor_text,
        "finding_id": str(comment.finding_id) if comment.finding_id else None,
        "created_at": comment.created_at.isoformat() if comment.created_at else datetime.now(timezone.utc).isoformat(),
    }

