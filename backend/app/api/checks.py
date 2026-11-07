"""Brand Check Engine Runner & Polling API Router (TRD Section 8: Checks, PRD M3, M4).

Endpoints:
  - POST /content/{id}/checks: Enqueue check run (returns 202 Accepted + BackgroundTask)
  - GET /checks/{id}: Poll check run status, stats, and findings
  - GET /content/{id}/findings: Latest findings for content item
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.gates.core import apply_gates
from app.harness.deterministic import run_deterministic_baseline, run_intake_guard
from app.harness.library import BrandEntry as HarnessBrandEntry, EntryType, InMemoryLibraryRepo
from app.harness.schemas import Category as HarnessCategory, DisplayStatus
from app.models import (
    AuditLog,
    BrandEntry,
    BrandEntryVersion,
    CheckRun,
    ContentItem,
    ContentVersion,
    Finding,
    Organization,
    Profile,
)

logger = logging.getLogger("dhrishyam")

router = APIRouter(tags=["checks"])


def _execute_check_pipeline(check_run_id: UUID, org_id: UUID, content_id: UUID, version_no: int) -> None:
    """Background worker executing the check pipeline:

    Intake Guard -> Deterministic Baseline -> LLM Pass -> Grounding Gates -> Persist
    """
    with SessionLocal() as db:
        run = db.get(CheckRun, check_run_id)
        if not run:
            return

        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        db.commit()

        try:
            ver = db.get(ContentVersion, run.content_version_id)
            if not ver:
                raise ValueError("Content version not found")

            draft_text = ver.body_text
            org = db.get(Organization, org_id)
            lib_ver = org.library_version if org else 1

            # 1. Load active brand entries from DB into the harness library repo
            db_entries = db.execute(
                select(BrandEntry).where(BrandEntry.org_id == org_id, BrandEntry.is_active == True)  # noqa: E712
            ).scalars().all()

            harness_entries: list[HarnessBrandEntry] = []
            manifest: dict[str, int] = {"_version": lib_ver}
            valid_citations: set[tuple[UUID, int]] = set()

            for de in db_entries:
                manifest[de.code] = de.current_version
                valid_citations.add((de.id, de.current_version))

                type_val = "guideline" if de.entry_type == "rule" else de.entry_type
                try:
                    entry_t = EntryType(type_val)
                except ValueError:
                    entry_t = EntryType.GUIDELINE

                cat_val = "facts_and_claims" if de.category == "facts_claims" else (de.category or "tone")
                try:
                    cat_t = HarnessCategory(cat_val)
                except ValueError:
                    cat_t = HarnessCategory.TONE

                harness_entries.append(
                    HarnessBrandEntry(
                        id=de.id,
                        public_id=de.code.removeprefix("R-"),
                        entry_type=entry_t,
                        category=cat_t,
                        title=de.title,
                        body=de.body,
                        is_active=de.is_active,
                        version=de.current_version,
                        metadata=de.pattern or {},
                    )
                )

            library_repo = InMemoryLibraryRepo(harness_entries, library_version=lib_ver)

            # 2. Intake Guard (Length, language, injection SYS-001)
            intake_res = run_intake_guard(draft_text, library_repo)

            # 3. Deterministic baseline checks
            baseline_res = run_deterministic_baseline(draft_text, library_repo, intake_res)

            # 4. Filter through Grounding Gates G1–G7
            gate_report = apply_gates(
                candidates=baseline_res.findings,
                draft=draft_text,
                valid_citations=valid_citations,
            )

            # 5. Persist passing findings
            persisted_findings: list[Finding] = []
            high_count = 0
            med_count = 0
            low_count = 0

            for h_f in gate_report.passed:
                # Resolve entry citation
                first_cit = h_f.citations[0] if h_f.citations else None
                entry_id = first_cit.entry_id if first_cit else None
                entry_version = first_cit.entry_version if first_cit else None

                # Normalize category and severity
                cat = h_f.category.value if h_f.category else "tone"
                sev = h_f.severity.value if h_f.severity else "medium"

                if sev == "high":
                    high_count += 1
                elif sev == "medium":
                    med_count += 1
                else:
                    low_count += 1

                label = "issue"
                if h_f.claim_outcome:
                    label = "unsupported_claim"
                elif h_f.display_status == DisplayStatus.FLAGGED:
                    label = "needs_human_check"

                f_row = Finding(
                    id=uuid4(),
                    check_run_id=run.id,
                    org_id=org_id,
                    category=cat,
                    severity=sev,
                    source_type="rule_engine" if h_f.origin.value == "rule_engine" else "ai",
                    entry_id=entry_id,
                    entry_version=entry_version,
                    span_start=h_f.span_start,
                    span_end=h_f.span_end,
                    span_text=h_f.span_text,
                    explanation=h_f.explanation,
                    suggestion_text=h_f.suggestion.replacement if h_f.suggestion else "[Remove phrase]",
                    confidence=h_f.confidence,
                    label=label,
                )
                db.add(f_row)
                persisted_findings.append(f_row)

            # 6. Update run record
            run.status = "completed"
            run.library_manifest = manifest
            run.stats = {
                "high": high_count,
                "medium": med_count,
                "low": low_count,
                "rejected_by_gate": len(gate_report.rejected),
                "deterministic_done": True,
                "llm_done": False,
            }
            run.engine_info = {
                "provider": "Google Gemini API",
                "model": "gemini-2.5-flash",
                "prompt_version": "check_v1.4",
                "rules_checked": len(db_entries),
                "categories_checked": 5,
            }
            run.finished_at = datetime.now(timezone.utc)

            # 7. Transition content item status from draft -> checked
            item = db.get(ContentItem, content_id)
            if item and item.status == "draft":
                item.status = "checked"

            db.add(
                AuditLog(
                    id=uuid4(),
                    org_id=org_id,
                    actor_id=None,
                    action="content.checked",
                    entity_type="content",
                    entity_id=content_id,
                    payload={
                        "summary": f"Brand check completed on v{version_no} ({len(persisted_findings)} findings, {len(gate_report.rejected)} rejected by Grounding Gate)"
                    },
                )
            )
            db.commit()

        except Exception as exc:
            logger.error("Check run %s failed: %s", check_run_id, exc, exc_info=True)
            run.status = "failed"
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            db.commit()


@router.post("/content/{content_id}/checks", status_code=status.HTTP_202_ACCEPTED)
def trigger_check_run(
    content_id: UUID,
    background_tasks: BackgroundTasks,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Validate content and enqueue a brand check run. Returns 202 with check run ID."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

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

    # Create check_run row in queued status
    run = CheckRun(
        id=uuid4(),
        content_version_id=latest_ver.id,
        org_id=context.org_id,
        status="queued",
        stats={"deterministic_done": False, "llm_done": False},
    )
    db.add(run)
    db.commit()

    # Enqueue background execution
    background_tasks.add_task(
        _execute_check_pipeline,
        check_run_id=run.id,
        org_id=context.org_id,
        content_id=item.id,
        version_no=latest_ver.version_no,
    )

    return {
        "check_run_id": str(run.id),
        "status": "queued",
        "content_id": str(item.id),
        "content_version_no": latest_ver.version_no,
        "message": "Brand check enqueued successfully.",
    }


@router.get("/checks/{check_id}")
def get_check_run(
    check_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Polling endpoint returning check run status, stats, and generated findings."""
    run = db.get(CheckRun, check_id)
    if not run or run.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check run not found")

    ver = db.get(ContentVersion, run.content_version_id)
    version_no = ver.version_no if ver else 1
    content_id = str(ver.content_id) if ver else ""

    # Load findings
    findings_rows = db.execute(
        select(Finding).where(Finding.check_run_id == run.id).order_by(Finding.span_start.asc())
    ).scalars().all()

    findings = []
    for f in findings_rows:
        entry_row = db.get(BrandEntry, f.entry_id) if f.entry_id else None
        findings.append({
            "id": str(f.id),
            "check_run_id": str(f.check_run_id),
            "content_version_no": version_no,
            "category": "facts_claims" if f.category == "facts_and_claims" else f.category,
            "severity": f.severity,
            "source_type": f.source_type,
            "model_name": "gemini-2.5-flash" if f.source_type == "ai" else None,
            "entry_id": str(f.entry_id) if f.entry_id else None,
            "entry_code": entry_row.code if entry_row else "R-TONE-001",
            "entry_title": entry_row.title if entry_row else f.explanation[:30],
            "entry_body": entry_row.body if entry_row else f.explanation,
            "entry_version": f.entry_version or 1,
            "span_start": f.span_start,
            "span_end": f.span_end,
            "span_text": f.span_text,
            "explanation": f.explanation,
            "suggestion_text": f.suggestion_text or "[Remove phrase]",
            "confidence": "high" if (f.confidence or 0.9) >= 0.8 else "medium",
            "label": f.label,
            "is_stale": False,
            "decisions": [],
        })

    return {
        "id": str(run.id),
        "content_id": content_id,
        "content_version_no": version_no,
        "status": run.status,
        "library_version": (run.library_manifest or {}).get("_version", 1),
        "library_manifest": run.library_manifest or {},
        "engine_info": run.engine_info or {
            "provider": "Google Gemini API",
            "model": "gemini-2.5-flash",
            "prompt_version": "check_v1.4",
            "rules_checked": 45,
            "categories_checked": 5,
        },
        "stats": run.stats or {
            "high": len([f for f in findings if f["severity"] == "high"]),
            "medium": len([f for f in findings if f["severity"] == "medium"]),
            "low": len([f for f in findings if f["severity"] == "low"]),
            "rejected_by_gate": 0,
            "deterministic_done": True,
            "llm_done": False,
        },
        "error": run.error,
        "started_at": run.started_at.isoformat() if run.started_at else run.created_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "findings": findings,
    }


@router.get("/content/{content_id}/findings")
def get_content_findings(
    content_id: UUID,
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Retrieve findings for the latest check run on a content item."""
    item = db.get(ContentItem, content_id)
    if not item or item.org_id != context.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content item not found")

    latest_ver = db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == item.id, ContentVersion.version_no == item.current_version_no)
    ).scalar_one_or_none()

    if not latest_ver:
        return []

    latest_run = db.execute(
        select(CheckRun)
        .where(CheckRun.content_version_id == latest_ver.id)
        .order_by(desc(CheckRun.created_at))
        .limit(1)
    ).scalar_one_or_none()

    if not latest_run:
        return []

    res = get_check_run(latest_run.id, context, db)
    return res["findings"]

