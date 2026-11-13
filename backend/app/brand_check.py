"""Where the API meets the harness: load the library, run a check, store and show findings.

Used by app/api/checks.py, content.py, findings.py and workflow.py, so every route reads and
writes findings the same way.

Findings are returned in the migration-0002 shape (display_status, claim_outcome, origin,
citations, suggestion). The current frontend still reads the older field names (label,
source_type, entry_code, suggestion_text, ...), so those are added as well, worked out from
the new ones. Remove them once the frontend types use the new fields.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import UUID, uuid4

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app import models as m
from app.db import SessionLocal
from harness.library import BrandEntry as LibraryEntry
from harness.library import EntryType, InMemoryLibraryRepo
from harness.llm import LLMClient
from harness.runner import RunBlocked, build_run_brand_check
from harness.schemas import Finding as HarnessFinding
from harness.schemas import RunContext, RunEvent

logger = logging.getLogger("brandguard.checks")

# ---- library -------------------------------------------------------------------------------

_SHORT_CODE = re.compile(r"^([FTC])-(\d+)$")
_SHORT_PREFIX = {"F": "FACT", "T": "TERM", "C": "CLAIM"}


def public_id_for(code: str) -> str:
    """Database code -> the ID the harness shows the model. Reverses seed_loader.code_for.

    R-TONE-001 -> TONE-001, F-001 -> FACT-001, T-001 -> TERM-001, C-001 -> CLAIM-001.
    Codes written by hand in the library (for example IMP-TERM-001) are used as they are.
    """
    if code.startswith("R-"):
        return code[2:]
    short = _SHORT_CODE.match(code)
    if short:
        return f"{_SHORT_PREFIX[short.group(1)]}-{short.group(2)}"
    return code


def load_library(db: Session, org_id: UUID) -> tuple[InMemoryLibraryRepo, list[LibraryEntry]]:
    """The organisation's active brand library, as the harness reads it."""
    org = db.get(m.Organization, org_id)
    rows = db.scalars(select(m.BrandEntry).where(
        m.BrandEntry.org_id == org_id, m.BrandEntry.is_active.is_(True))).all()
    entries = [
        LibraryEntry(
            id=row.id,  # the database id, so citations match brand_entry_versions
            public_id=public_id_for(row.code),
            entry_type=EntryType.GUIDELINE if row.entry_type == "rule" else EntryType(row.entry_type),
            category=row.category,
            title=row.title,
            body=row.body,
            good_example=row.good_example,
            bad_example=row.bad_example,
            metadata=row.pattern or {},
            version=row.current_version,
        )
        for row in rows
    ]
    version = org.library_version if org else 1
    return InMemoryLibraryRepo(entries, library_version=version), entries


# ---- running a check -------------------------------------------------------------------------

_STEP_KIND = {
    "plan.created": "plan",
    "tool.called": "tool_call",
    "critic.verdict": "verdict",
    "reinvestigation.requested": "route",
    "gate.rejected": "gate",
}

def new_llm() -> LLMClient:
    """A fresh LLM client for one run, read from codebase/.env (OPENAI_API_KEY, LLM_ENABLED).

    When AI review is off or has no key, the client says so and the run falls back to
    rule-based checks with a degraded_reason. Not shared between runs: each run has its own
    event loop (asyncio.run), and the OpenAI client's connections belong to that loop.
    """
    return LLMClient.from_env()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _finish_failed(db: Session, run: m.CheckRun, message: str) -> None:
    db.rollback()
    run = db.get(m.CheckRun, run.id)
    run.status = "failed"
    run.error = message
    run.finished_at = now()
    db.commit()


def execute_check(check_run_id: UUID, *, llm_factory: Callable[[], Any] = new_llm) -> None:
    """Background job: run the harness on the run's content version and store the result.

    A plain function (not async) on purpose. FastAPI runs it on a worker thread, where
    asyncio.run can start the harness's own event loop.
    """
    with SessionLocal() as db:
        run = db.get(m.CheckRun, check_run_id)
        if run is None:
            return
        version = db.get(m.ContentVersion, run.content_version_id)
        item = db.get(m.ContentItem, version.content_id)
        library, entries = load_library(db, run.org_id)

        run.status = "running"
        run.started_at = now()
        run.library_version = library.library_version
        run.library_manifest = {entry.public_id: entry.version for entry in entries}
        db.commit()

        ctx = RunContext(
            run_id=run.id,
            org_id=run.org_id,
            submission_version_id=version.id,
            draft=version.body_text,
            content_type=item.content_type or "general",
            library_version=library.library_version,
        )

        async def emit(event: RunEvent) -> None:
            # Every step is stored as it happens, so the frontend can show progress.
            db.add(m.RunStep(run_id=run.id, seq=event.seq, event_type=event.type.value,
                             node=event.node, kind=_STEP_KIND.get(event.type.value),
                             data=event.data))
            db.commit()

        check = build_run_brand_check(lambda _org_id: library, llm=llm_factory())
        try:
            result = asyncio.run(check(ctx, emit))
        except RunBlocked as blocked:
            _finish_failed(db, run, blocked.message)
            return
        except Exception:
            logger.exception("Check run %s failed", check_run_id)
            _finish_failed(db, run, "The check could not finish. Please try again.")
            return

        # Findings, citations and suggestions are committed together: a database trigger
        # checks at commit time that every confirmed finding has a citation.
        for finding in result.findings:
            save_finding(db, run, finding)

        severities = [f.severity.value for f in result.findings]
        run.mode = result.mode.value
        run.status = "degraded" if result.degraded_reason else "completed"
        run.engine_info = {
            "provider": result.llm_provider,
            "model": result.llm_model,
            "prompt_version": result.prompt_version,
            "degraded_reason": result.degraded_reason,
            "rules_checked": len(entries),
            "categories_checked": len({e.category for e in entries if e.category}),
        }
        run.stats = {
            "high": severities.count("high"),
            "medium": severities.count("medium"),
            "low": severities.count("low"),
            "rejected_by_gate": len(result.rejected),
            "iterations": result.iterations,
            "tool_calls": result.tool_calls,
            "deterministic_done": True,
            "llm_done": result.mode.value == "full",
        }
        run.finished_at = now()
        if item.status == "draft":
            item.status = "checked"
        db.add(m.AuditLog(
            id=uuid4(), org_id=run.org_id, actor_id=None, action="content.checked",
            entity_type="content", entity_id=item.id,
            payload={"summary": f"Brand check finished on v{version.version_no}: "
                                f"{len(result.findings)} findings, "
                                f"{len(result.rejected)} candidates rejected by the gates"}))
        db.commit()


def save_finding(db: Session, run: m.CheckRun, finding: HarnessFinding) -> m.Finding:
    row = m.Finding(
        check_run_id=run.id, org_id=run.org_id,
        category=finding.category.value, severity=finding.severity.value,
        display_status=finding.display_status.value,
        claim_outcome=finding.claim_outcome.value if finding.claim_outcome else None,
        origin=finding.origin.value, confidence=finding.confidence,
        span_start=finding.span_start, span_end=finding.span_end, span_text=finding.span_text,
        explanation=finding.explanation, produced_by=list(finding.produced_by),
        critic_verdict=finding.critic_verdict, guideline_conflict=finding.guideline_conflict)
    db.add(row)
    db.flush()
    for citation in finding.citations:
        db.add(m.FindingCitation(finding_id=row.id, entry_id=citation.entry_id,
                                 entry_version=citation.entry_version, quote=citation.quote))
    if finding.suggestion:
        db.add(m.Suggestion(finding_id=row.id, before_text=finding.suggestion.before_text,
                            after_text=finding.suggestion.after_text,
                            rationale=finding.suggestion.rationale))
    return row


# ---- reading runs and findings ---------------------------------------------------------------


def latest_run_for_content(db: Session, content_id: UUID) -> m.CheckRun | None:
    """The newest check on any version of this content.

    Accepting a suggestion creates a new version, and the findings from the check stay
    open on it (their positions are moved by findings.py), so we look across versions.
    """
    return db.scalar(
        select(m.CheckRun)
        .join(m.ContentVersion, m.ContentVersion.id == m.CheckRun.content_version_id)
        .where(m.ContentVersion.content_id == content_id)
        .order_by(desc(m.CheckRun.created_at))
        .limit(1))


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _old_label(row: m.Finding) -> str:
    if row.guideline_conflict:
        return "guideline_conflict"
    if row.display_status == "needs_human_verification":
        return "needs_human_check"
    if row.claim_outcome in ("unsupported", "partially_supported", "conflicting_evidence"):
        return "unsupported_claim"
    return "issue"


def _confidence_level(score: float | None) -> str:
    if score is None:
        return "low"
    return "high" if score >= 0.8 else "medium" if score >= 0.5 else "low"


def decisions_json(db: Session, finding_id: UUID) -> list[dict[str, Any]]:
    rows = db.scalars(select(m.FindingDecision).where(m.FindingDecision.finding_id == finding_id)
                      .order_by(m.FindingDecision.created_at)).all()
    out = []
    for d in rows:
        actor = db.get(m.Profile, d.actor_id)
        out.append({
            "id": str(d.id), "finding_id": str(d.finding_id), "actor_id": str(d.actor_id),
            "actor_name": (actor.display_name or actor.email) if actor else "User",
            "action": d.action, "reason": d.reason, "created_at": _iso(d.created_at),
        })
    return out


def finding_json(db: Session, row: m.Finding, run: m.CheckRun) -> dict[str, Any]:
    citations = db.scalars(select(m.FindingCitation).where(m.FindingCitation.finding_id == row.id)
                           .order_by(m.FindingCitation.created_at, m.FindingCitation.id)).all()
    suggestion = db.scalar(select(m.Suggestion).where(m.Suggestion.finding_id == row.id))
    cited = []
    for c in citations:
        entry = db.get(m.BrandEntry, c.entry_id)
        cited.append({
            "entry_id": str(c.entry_id), "entry_version": c.entry_version, "quote": c.quote,
            "entry_code": entry.code if entry else None,
            "entry_title": entry.title if entry else None,
            "entry_body": entry.body if entry else None,
        })
    version = db.get(m.ContentVersion, run.content_version_id)
    first = cited[0] if cited else None
    second = cited[1] if len(cited) > 1 else None
    return {
        # Migration-0002 fields (use these)
        "id": str(row.id),
        "check_run_id": str(row.check_run_id),
        "content_version_no": version.version_no if version else None,
        "category_key": row.category,
        "severity": row.severity,
        "display_status": row.display_status,
        "claim_outcome": row.claim_outcome,
        "origin": row.origin,
        "confidence_score": row.confidence,
        "span_start": row.span_start,
        "span_end": row.span_end,
        "span_text": row.span_text,
        "explanation": row.explanation,
        "citations": cited,
        "suggestion": None if suggestion is None else {
            "before_text": suggestion.before_text, "after_text": suggestion.after_text,
            "rationale": suggestion.rationale},
        "produced_by": row.produced_by,
        "critic_verdict": row.critic_verdict,
        "guideline_conflict": row.guideline_conflict,
        "is_stale": row.is_stale,
        "decisions": decisions_json(db, row.id),
        # Older names the current frontend reads (remove after step 5)
        "category": "facts_claims" if row.category == "facts_and_claims" else row.category,
        "source_type": "rule_engine" if row.origin == "rule_based" else "ai",
        "model_name": (run.engine_info or {}).get("model") if row.origin == "ai" else None,
        "label": _old_label(row),
        "confidence": _confidence_level(row.confidence),
        "entry_id": first["entry_id"] if first else None,
        "entry_code": (first or {}).get("entry_code") or "",
        "entry_title": (first or {}).get("entry_title") or "",
        "entry_body": (first or {}).get("quote") or "",
        "entry_version": first["entry_version"] if first else None,
        "secondary_entry_id": second["entry_id"] if second else None,
        "secondary_entry_code": second["entry_code"] if second else None,
        "secondary_entry_title": second["entry_title"] if second else None,
        "secondary_entry_body": second["quote"] if second else None,
        "suggestion_text": suggestion.after_text if suggestion else "",
    }


def run_json(db: Session, run: m.CheckRun, *, with_findings: bool = True) -> dict[str, Any]:
    version = db.get(m.ContentVersion, run.content_version_id)
    info = run.engine_info or {}
    stats = run.stats or {}
    result: dict[str, Any] = {
        "id": str(run.id),
        "content_id": str(version.content_id) if version else None,
        "content_version_no": version.version_no if version else None,
        "status": run.status,
        "mode": run.mode,
        "degraded_reason": info.get("degraded_reason"),
        "library_version": run.library_version,
        "library_manifest": run.library_manifest or {},
        "engine_info": {
            "provider": info.get("provider"),
            "model": info.get("model"),
            "prompt_version": info.get("prompt_version"),
            "rules_checked": info.get("rules_checked"),
            "categories_checked": info.get("categories_checked"),
        },
        "stats": {
            "high": stats.get("high", 0), "medium": stats.get("medium", 0),
            "low": stats.get("low", 0), "rejected_by_gate": stats.get("rejected_by_gate", 0),
            "iterations": stats.get("iterations"), "tool_calls": stats.get("tool_calls"),
            "deterministic_done": stats.get("deterministic_done", False),
            "llm_done": stats.get("llm_done", False),
        },
        "error": run.error,
        "started_at": _iso(run.started_at) or _iso(run.created_at),
        "finished_at": _iso(run.finished_at),
    }
    if with_findings:
        rows = db.scalars(select(m.Finding).where(m.Finding.check_run_id == run.id)
                          .order_by(m.Finding.span_start, m.Finding.id)).all()
        result["findings"] = [finding_json(db, row, run) for row in rows]
    return result
