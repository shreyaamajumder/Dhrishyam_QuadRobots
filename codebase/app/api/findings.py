"""Decisions on findings (TRD Section 8: Findings, PRD M5).

POST /findings/{id}/decision records accepted, edited, dismissed, confirmed or overridden.

- accepted: the finding's suggestion is applied with harness.corrector.apply_suggestion, the
  same function the harness uses, so the edit lands exactly where the corrector checked it.
- edited: the creator's own wording replaces the same passage.
Both create a new immutable content version. Other findings from the same check move with
the text; any that overlap the edited passage are marked stale (the frontend offers a re-check).
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.db import get_db
from app.models import (
    DECISION_ACTIONS,
    AuditLog,
    CheckRun,
    ContentItem,
    ContentVersion,
    Finding,
    FindingDecision,
    Profile,
    Suggestion,
)
from harness.corrector import locate_suggestion

router = APIRouter(prefix="/findings", tags=["findings"])

REVIEWER_ACTIONS = ("confirmed", "overridden")


class FindingDecisionIn(BaseModel):
    action: str
    reason: str | None = None
    edited_text: str | None = None


def _conflict(message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, message)


def _passage(finding: Finding, suggestion: Suggestion | None, text: str) -> tuple[int, int]:
    """Where in the current text the edit goes: the suggestion's passage, or the highlight."""
    if suggestion is not None:
        target = SimpleNamespace(span_start=finding.span_start, span_end=finding.span_end,
                                 suggestion=suggestion)
        where = locate_suggestion(text, target)
        if where is None:
            raise ValueError("suggestion no longer matches")
        return where
    if text[finding.span_start:finding.span_end] != finding.span_text:
        raise ValueError("highlight no longer matches")
    return finding.span_start, finding.span_end


@router.post("/{finding_id}/decision")
def decide_finding(
    finding_id: UUID,
    payload: FindingDecisionIn,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    action = payload.action.lower().strip()
    if action not in DECISION_ACTIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Invalid action: '{action}'. Allowed actions: {DECISION_ACTIONS}")
    if action in REVIEWER_ACTIONS and context.role not in ("reviewer", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a reviewer or admin can do this")

    # SRS FR-FND-4: a reason is required to dismiss a High severity finding
    if action == "dismissed" and finding.severity == "high" and not (payload.reason or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "A reason is mandatory when dismissing a High severity finding.")

    run = db.get(CheckRun, finding.check_run_id)
    checked_version = db.get(ContentVersion, run.content_version_id)
    item = db.get(ContentItem, checked_version.content_id)

    resulting_version_id = None
    resulting_version_no = None

    if action in ("accepted", "edited"):
        already = db.scalar(select(FindingDecision.id).where(
            FindingDecision.finding_id == finding.id,
            FindingDecision.action.in_(("accepted", "edited"))).limit(1))
        if already is not None:
            raise _conflict("This finding's change has already been applied.")
        if finding.is_stale:
            raise _conflict("The text has changed since the check. Please run the check again.")
        suggestion = db.scalar(select(Suggestion).where(Suggestion.finding_id == finding.id))
        if action == "accepted":
            if suggestion is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                    "This finding has no suggestion. Use edit instead.")
            replacement = suggestion.after_text
        else:
            if payload.edited_text is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "edited_text is required to edit.")
            replacement = payload.edited_text

        # Always edit the latest version, so earlier accepted suggestions are kept.
        latest = db.execute(select(ContentVersion).where(
            ContentVersion.content_id == item.id,
            ContentVersion.version_no == item.current_version_no)).scalar_one()
        # An image cannot be rewritten by text. For an image the decision is recorded as "I will
        # make this change in the design", and the creator uploads the revised image as a new version.
        if latest.source != "image":
            try:
                start, end = _passage(finding, suggestion, latest.body_text)
            except ValueError:
                finding.is_stale = True
                db.commit()
                raise _conflict("The text has changed since the check. Please run the check again.") from None

            new_body = latest.body_text[:start] + replacement + latest.body_text[end:]
            next_no = item.current_version_no + 1
            new_ver = ContentVersion(id=uuid4(), content_id=item.id, version_no=next_no, body_text=new_body,
                                     source="suggestion", created_by=context.user_id)
            db.add(new_ver)
            db.flush()
            item.current_version_no = next_no
            resulting_version_id, resulting_version_no = new_ver.id, next_no

            # Move the other findings from this check; mark the ones the edit touched as stale.
            delta = len(replacement) - (end - start)
            others = db.scalars(select(Finding).where(Finding.check_run_id == run.id,
                                                      Finding.id != finding.id)).all()
            for other in others:
                if other.is_stale:
                    continue
                if other.span_start >= end:
                    other.span_start += delta
                    other.span_end += delta
                elif other.span_end > start:
                    other.is_stale = True

    decision = FindingDecision(
        id=uuid4(), finding_id=finding.id, actor_id=context.user_id, action=action,
        reason=payload.reason.strip() if payload.reason else None,
        resulting_version_id=resulting_version_id)
    db.add(decision)

    db.add(AuditLog(
        id=uuid4(), org_id=context.org_id, actor_id=context.user_id, action=f"finding.{action}",
        entity_type="finding", entity_id=finding.id,
        payload={"action": action, "finding_id": str(finding.id),
                 "resulting_version_no": resulting_version_no, "reason": payload.reason}))
    db.commit()

    actor = db.get(Profile, context.user_id)
    return {
        "id": str(decision.id),
        "finding_id": str(finding.id),
        "actor_id": str(context.user_id),
        "actor_name": (actor.display_name or actor.email) if actor else "User",
        "actor_role": context.role,
        "action": action,
        "reason": payload.reason,
        "resulting_version_no": resulting_version_no,
        "created_at": (decision.created_at or datetime.now(timezone.utc)).isoformat(),
    }
