"""Brand checks (TRD Section 8: Checks, PRD M3, M4).

Endpoints:
  - POST /content/{id}/checks: start a check (202 Accepted; the harness runs in the background)
  - GET /checks/{id}: poll a check's status, stats and findings
  - GET /checks/{id}/steps: every step the harness took, for the Investigation Trace
  - GET /content/{id}/findings: findings from the content's latest check

The check itself is app.brand_check.execute_check, which calls the harness
(harness.runner.build_run_brand_check) and stores its findings.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.brand_check import execute_check, latest_run_for_content, run_json
from app.db import get_db
from app.models import CheckRun, ContentItem, ContentVersion, RunStep

router = APIRouter(tags=["checks"])


@router.post("/content/{content_id}/checks", status_code=status.HTTP_202_ACCEPTED)
def trigger_check_run(
    content_id: UUID,
    background_tasks: BackgroundTasks,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Start a brand check on the latest version. Returns 202 with the check run ID."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")
    if context.role == "creator" and item.creator_id != context.user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only check your own drafts")

    latest_ver = db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == item.id, ContentVersion.version_no == item.current_version_no)
    ).scalar_one_or_none()
    if not latest_ver or not latest_ver.body_text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content body is empty. Please enter text before checking.")

    words = len(latest_ver.body_text.split())
    if words < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content is too short (minimum 3 words required).")
    if words > 2000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content exceeds 2,000 words limit.")

    run = CheckRun(
        id=uuid4(),
        content_version_id=latest_ver.id,
        org_id=context.org_id,
        status="queued",
        stats={"deterministic_done": False, "llm_done": False},
    )
    db.add(run)
    db.commit()

    background_tasks.add_task(execute_check, run.id)

    return {
        "check_run_id": str(run.id),
        "status": "queued",
        "content_id": str(item.id),
        "content_version_no": latest_ver.version_no,
        "message": "Brand check started.",
    }


def _get_run(check_id: UUID, context: RequestContext, db: Session) -> CheckRun:
    run = db.get(CheckRun, check_id)
    if not run or run.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check run not found")
    return run


@router.get("/checks/{check_id}")
def get_check_run(
    check_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Polling endpoint: status, stats and (once finished) the findings."""
    return run_json(db, _get_run(check_id, context, db))


@router.get("/checks/{check_id}/steps")
def get_check_steps(
    check_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Every harness event for this check, in order (plan, tool calls, critic verdicts, ...)."""
    run = _get_run(check_id, context, db)
    steps = db.scalars(select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.seq)).all()
    return [
        {"seq": s.seq, "event_type": s.event_type, "node": s.node, "kind": s.kind,
         "data": s.data, "created_at": s.created_at.isoformat() if s.created_at else None}
        for s in steps
    ]


@router.get("/content/{content_id}/findings")
def get_content_findings(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Findings from the latest check on this content."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")
    run = latest_run_for_content(db, item.id)
    return run_json(db, run)["findings"] if run else []
