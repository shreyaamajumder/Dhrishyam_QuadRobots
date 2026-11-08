"""Audit Log & In-App Notifications API Router (TRD Section 8: Audit, PRD M9).

Endpoints:
  - GET /audit: Append-only audit log reader (Admin only)
  - GET /notifications: User's in-app notifications
  - POST /notifications/mark-read: Mark all notifications read
  - POST /notifications/{id}/read: Mark single notification read
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context, require_role
from app.db import get_db
from app.models import AuditLog, ContentItem, Notification, Profile

router = APIRouter(tags=["audit"])


@router.get("/audit")
def get_audit_log(
    entity_type: str | None = Query(default=None),
    limit: int = Query(default=100),
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Retrieve append-only audit events. Admin only."""
    stmt = select(AuditLog).where(AuditLog.org_id == context.org_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)

    stmt = stmt.order_by(desc(AuditLog.created_at)).limit(limit)
    rows = db.execute(stmt).scalars().all()

    results = []
    for r in rows:
        actor_name = "System"
        actor_role = "admin"
        if r.actor_id:
            prof = db.get(Profile, r.actor_id)
            if prof:
                actor_name = prof.display_name or prof.email

        results.append({
            "id": str(r.id),
            "org_id": str(r.org_id),
            "actor_id": str(r.actor_id) if r.actor_id else None,
            "actor_name": actor_name,
            "actor_role": actor_role,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": str(r.entity_id) if r.entity_id else None,
            "payload": r.payload or {},
            "created_at": r.created_at.isoformat() if r.created_at else datetime.now(timezone.utc).isoformat(),
        })
    return results


@router.get("/notifications")
def get_notifications(
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Retrieve in-app notifications for the authenticated user."""
    notifs = db.execute(
        select(Notification)
        .where(Notification.user_id == context.user_id)
        .order_by(desc(Notification.created_at))
        .limit(50)
    ).scalars().all()

    results = []
    for n in notifs:
        item = db.get(ContentItem, n.content_id) if n.content_id else None
        item_title = item.title if item else "Content Item"

        message = "New event on your submission"
        if n.kind == "content.submitted":
            message = f"New submission awaiting your review: '{item_title}'"
        elif n.kind == "content.approved":
            message = f"Your submission '{item_title}' was approved!"
        elif n.kind == "content.changes_requested":
            message = f"Changes requested on '{item_title}'"

        results.append({
            "id": str(n.id),
            "user_id": str(n.user_id),
            "content_id": str(n.content_id) if n.content_id else None,
            "content_title": item_title,
            "message": message,
            "read_at": n.read_at.isoformat() if n.read_at else None,
            "created_at": n.created_at.isoformat() if n.created_at else datetime.now(timezone.utc).isoformat(),
        })
    return results


@router.post("/notifications/mark-read")
def mark_all_notifications_read(
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Mark all notifications read for the current user."""
    notifs = db.execute(
        select(Notification)
        .where(Notification.user_id == context.user_id, Notification.read_at == None)  # noqa: E711
    ).scalars().all()

    now = datetime.now(timezone.utc)
    for n in notifs:
        n.read_at = now
    db.commit()

    return {"status": "ok", "message": "All notifications marked as read."}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Mark a single notification as read."""
    notif = db.get(Notification, notification_id)
    if notif and notif.user_id == context.user_id:
        notif.read_at = datetime.now(timezone.utc)
        db.commit()
    return {"status": "ok"}

