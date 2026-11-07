"""Findings Decisions & Offset Shifting API Router (TRD Section 8: Findings, PRD M5).

Endpoints:
  - POST /findings/{id}/decision: Accept, edit, dismiss, confirm, or override a finding.
    If action is 'accepted', the server creates a new ContentVersion with the replacement applied.
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
from app.models import (
    AuditLog,
    CheckRun,
    ContentItem,
    ContentVersion,
    DECISION_ACTIONS,
    Finding,
    FindingDecision,
    Profile,
)

router = APIRouter(prefix="/findings", tags=["findings"])


class FindingDecisionIn(BaseModel):
    action: str
    reason: str | None = None
    edited_text: str | None = None


@router.post("/{finding_id}/decision")
def decide_finding(
    finding_id: UUID,
    payload: FindingDecisionIn,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Record a decision on a finding.

    - accepted: Server applies suggestion to text, creates new immutable ContentVersion, shifts subsequent offsets.
    - edited: Server applies custom edited text to text, creates new version.
    - dismissed: Mandatory reason required if severity is High.
    - confirmed / overridden: Reviewer / Admin action.
    """
    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    action = payload.action.lower().strip()
    if action not in DECISION_ACTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invalid action: '{action}'. Allowed actions: {DECISION_ACTIONS}",
        )

    # SRS FR-FND-4: Mandatory dismissal reason for High severity
    if action == "dismissed" and finding.severity == "high":
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "A reason is mandatory when dismissing a High severity finding.",
            )

    run = db.get(CheckRun, finding.check_run_id)
    ver = db.get(ContentVersion, run.content_version_id) if run else None
    item = db.get(ContentItem, ver.content_id) if ver else None

    resulting_version_id = None
    resulting_version_no = None

    # Handle text replacement for accepted or edited
    if action in ("accepted", "edited") and ver and item:
        replacement = payload.edited_text.strip() if action == "edited" and payload.edited_text else (finding.suggestion_text or "")
        current_text = ver.body_text

        # Verify span still matches
        start = finding.span_start
        end = finding.span_end
        if start >= len(current_text) or end > len(current_text) or current_text[start:end] != finding.span_text:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Stale finding: Text at this span has already changed. Please re-run brand check.",
            )

        new_body = current_text[:start] + replacement + current_text[end:]
        next_ver_no = item.current_version_no + 1

        new_ver = ContentVersion(
            id=uuid4(),
            content_id=item.id,
            version_no=next_ver_no,
            body_text=new_body,
            source="suggestion",
            created_by=context.user_id,
        )
        db.add(new_ver)
        db.flush()

        item.current_version_no = next_ver_no
        resulting_version_id = new_ver.id
        resulting_version_no = next_ver_no

        # Shift subsequent non-overlapping findings in the same check run
        delta = len(replacement) - (end - start)
        subsequent_findings = db.execute(
            select(Finding)
            .where(Finding.check_run_id == run.id, Finding.id != finding.id)
        ).scalars().all()

        for sf in subsequent_findings:
            if sf.span_start >= end:
                sf.span_start += delta
                sf.span_end += delta

    decision = FindingDecision(
        id=uuid4(),
        finding_id=finding.id,
        actor_id=context.user_id,
        action=action,
        reason=payload.reason.strip() if payload.reason else None,
        resulting_version_id=resulting_version_id,
    )
    db.add(decision)

    prof = db.get(Profile, context.user_id)
    actor_name = prof.display_name or prof.email if prof else "User"

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action=f"finding.{action}",
            entity_type="finding",
            entity_id=finding.id,
            payload={
                "action": action,
                "finding_id": str(finding.id),
                "resulting_version_no": resulting_version_no,
                "reason": payload.reason,
            },
        )
    )
    db.commit()

    return {
        "id": str(decision.id),
        "finding_id": str(finding.id),
        "actor_id": str(context.user_id),
        "actor_name": actor_name,
        "actor_role": context.role,
        "action": action,
        "reason": payload.reason,
        "resulting_version_no": resulting_version_no,
        "created_at": decision.created_at.isoformat() if decision.created_at else datetime.now(timezone.utc).isoformat(),
    }

