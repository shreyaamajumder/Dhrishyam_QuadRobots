"""Review Workflow & Approval State Machine API Router (TRD Section 8: Workflow, PRD M8).

Endpoints:
  - POST /content/{id}/submit: Creator submits draft for approval (with High findings guard)
  - POST /content/{id}/withdraw: Creator withdraws submission back to draft
  - POST /content/{id}/review: Reviewer approves or requests changes (self-approval blocked)
  - GET /review-queue: Reviewer queue of submissions awaiting action
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context, require_role
from app.brand_check import latest_run_for_content
from app.db import get_db
from app.models import (
    AuditLog,
    ContentItem,
    Finding,
    FindingDecision,
    Notification,
    Profile,
    REVIEW_DECISIONS,
    ReviewDecision,
)

router = APIRouter(tags=["workflow"])


class SubmitApprovalIn(BaseModel):
    reviewer_id: UUID | None = None
    note: str | None = None


class ReviewDecisionIn(BaseModel):
    decision: str
    comment: str | None = None


@router.post("/content/{content_id}/submit")
def submit_for_approval(
    content_id: UUID,
    payload: SubmitApprovalIn,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Submit content for approval. Enforces guard: all High findings must be decided."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    if item.status not in ("checked", "changes_requested", "draft"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Content in status '{item.status}' cannot be submitted for approval.",
        )

    # Self-assignment block
    if payload.reviewer_id and payload.reviewer_id == context.user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "You cannot assign yourself as the reviewer for your own content.",
        )

    # SRS FR-WFL-2 / Submit Guard: verify all High severity findings on latest check have decisions
    # The latest check on any version: accepting a suggestion creates a new version,
    # and that check's High findings still need decisions.
    latest_run = latest_run_for_content(db, item.id)
    if latest_run:
        high_findings = db.execute(
            select(Finding).where(Finding.check_run_id == latest_run.id, Finding.severity == "high")
        ).scalars().all()

        for hf in high_findings:
            has_dec = db.execute(
                select(FindingDecision.id).where(FindingDecision.finding_id == hf.id).limit(1)
            ).scalar_one_or_none()
            if not has_dec:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "All High severity brand findings must have a decision before submission.",
                )

    # Transition state to in_review
    item.status = "in_review"
    if payload.reviewer_id:
        item.reviewer_id = payload.reviewer_id

    reviewer_name = "Assigned Reviewer"
    if item.reviewer_id:
        rev_prof = db.get(Profile, item.reviewer_id)
        if rev_prof:
            reviewer_name = rev_prof.display_name or rev_prof.email

            # Create in-app notification for reviewer
            db.add(
                Notification(
                    id=uuid4(),
                    user_id=item.reviewer_id,
                    content_id=item.id,
                    kind="content.submitted",
                )
            )

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="content.submitted",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": f"Submitted v{item.current_version_no} for approval to {reviewer_name}"},
        )
    )
    db.commit()

    return {
        "content_id": str(item.id),
        "status": item.status,
        "reviewer_id": str(item.reviewer_id) if item.reviewer_id else None,
        "reviewer_name": reviewer_name,
        "message": "Submission sent for approval.",
    }


@router.post("/content/{content_id}/withdraw")
def withdraw_submission(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Creator withdraws an in-review submission back to draft."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    if item.status != "in_review":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only in-review submissions can be withdrawn.")

    if context.role == "creator" and item.creator_id != context.user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot withdraw someone else's submission.")

    item.status = "draft"
    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="content.withdrawn",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": f"Withdrew submission v{item.current_version_no} back to draft"},
        )
    )
    db.commit()

    return {"content_id": str(item.id), "status": "draft", "message": "Submission withdrawn."}


@router.post("/content/{content_id}/review")
def submit_review_decision(
    content_id: UUID,
    payload: ReviewDecisionIn,
    context: RequestContext = Depends(require_role("reviewer", "admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Reviewer decision: Approve or Request Changes. Creator self-approval is blocked."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    if item.status != "in_review":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot review content in status '{item.status}'.")

    # SRS FR-WFL-5: Creator cannot approve or request changes on their own content
    if item.creator_id == context.user_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You cannot approve or request changes on your own content.",
        )

    decision_clean = payload.decision.lower().strip()
    if decision_clean not in REVIEW_DECISIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invalid decision '{decision_clean}'. Must be one of {REVIEW_DECISIONS}.",
        )

    # SRS FR-WFL-4: Comment mandatory for changes_requested
    if decision_clean == "changes_requested":
        if not payload.comment or not payload.comment.strip():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "A comment is required when requesting changes.",
            )

    # Append immutable ReviewDecision
    rev_dec = ReviewDecision(
        id=uuid4(),
        content_id=item.id,
        version_no=item.current_version_no,
        reviewer_id=context.user_id,
        decision=decision_clean,
        comment=payload.comment.strip() if payload.comment else None,
    )
    db.add(rev_dec)

    # Update item status
    item.status = "approved" if decision_clean == "approved" else "changes_requested"

    # Notify creator
    db.add(
        Notification(
            id=uuid4(),
            user_id=item.creator_id,
            content_id=item.id,
            kind=f"content.{item.status}",
        )
    )

    prof = db.get(Profile, context.user_id)
    rev_name = prof.display_name or prof.email if prof else "Reviewer"

    summary_msg = (
        f"Approved v{item.current_version_no} for publication"
        if decision_clean == "approved"
        else f"Requested changes on v{item.current_version_no}: {payload.comment}"
    )

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action=f"review.{decision_clean}",
            entity_type="content",
            entity_id=item.id,
            payload={"summary": summary_msg, "reviewer_name": rev_name},
        )
    )
    db.commit()

    return {
        "content_id": str(item.id),
        "status": item.status,
        "decision": decision_clean,
        "comment": payload.comment,
        "reviewer_id": str(context.user_id),
        "reviewer_name": rev_name,
    }


@router.get("/review-queue")
def get_review_queue(
    context: RequestContext = Depends(require_role("reviewer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Queue of all submissions currently in_review."""
    stmt = (
        select(ContentItem)
        .where(ContentItem.org_id == context.org_id, ContentItem.status == "in_review")
        .order_by(desc(ContentItem.updated_at))
    )

    items = db.execute(stmt).scalars().all()
    queue = []
    for item in items:
        creator_prof = db.get(Profile, item.creator_id)
        creator_name = creator_prof.display_name or creator_prof.email if creator_prof else "Creator"

        # Load check run severity counts
        stats = {"high": 0, "medium": 0, "low": 0}
        dismissed_count = 0
        run = latest_run_for_content(db, item.id)
        if run and run.stats:
            stats = {
                "high": run.stats.get("high", 0),
                "medium": run.stats.get("medium", 0),
                "low": run.stats.get("low", 0),
            }

        queue.append({
            "id": str(item.id),
            "title": item.title,
            "creator_id": str(item.creator_id),
            "creator_name": creator_name,
            "content_type": item.content_type,
            "status": item.status,
            "current_version_no": item.current_version_no,
            "updated_at": item.updated_at.isoformat() if item.updated_at else datetime.now(timezone.utc).isoformat(),
            "submitted_at": item.updated_at.isoformat() if item.updated_at else datetime.now(timezone.utc).isoformat(),
            "high_issues": stats["high"],
            "medium_issues": stats["medium"],
            "low_issues": stats["low"],
            "dismissed_count": dismissed_count,
            "library_version": run.library_version if run else None,
        })

    return queue

