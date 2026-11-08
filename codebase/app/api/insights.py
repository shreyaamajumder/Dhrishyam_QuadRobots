"""Governance insights and rule clarity (TRD Sections 7 and 8: Insights, PRD M10).

GET /insights/summary: KPIs, most-cited rules, findings by category per week, and the rules
that may be unclear (Clarity Score, SRS FR-INS-2: 0.6 x dismissal rate + 0.4 x override rate).

Every number comes from this organisation's own checks and decisions. When there is no data
yet, rates are null and lists are empty, and the page shows "no data yet".
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.db import get_db
from app.models import BrandEntry, CheckRun, Finding, FindingCitation, FindingDecision

router = APIRouter(prefix="/insights", tags=["insights"])

CLARITY_THRESHOLD = 0.45
MIN_DECISIONS_FOR_CLARITY = 3  # one dismissal is not enough to call a rule unclear
CATEGORY_KEYS = ("tone", "terminology", "messaging", "facts_claims", "accessibility", "visual")


def _frontend_category(category: str | None) -> str:
    return "facts_claims" if category == "facts_and_claims" else (category or "tone")


@router.get("/summary")
@router.get("")
def get_insights_summary(
    period_days: int = Query(default=30, ge=1, le=365),
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    org_id = context.org_id
    since = datetime.now(timezone.utc) - timedelta(days=period_days)

    checks_run = db.scalar(select(func.count(CheckRun.id)).where(
        CheckRun.org_id == org_id, CheckRun.created_at >= since)) or 0
    findings = db.scalars(select(Finding).where(
        Finding.org_id == org_id, Finding.created_at >= since)).all()
    finding_ids = [f.id for f in findings]

    # The latest decision on each finding is its current state (decisions are append-only).
    latest_action: dict[Any, str] = {}
    if finding_ids:
        for finding_id, action in db.execute(
            select(FindingDecision.finding_id, FindingDecision.action)
            .where(FindingDecision.finding_id.in_(finding_ids))
            .order_by(FindingDecision.created_at)
        ).all():
            latest_action[finding_id] = action
    actions = Counter(latest_action.values())
    decided = sum(actions.values())
    accept_rate = (actions["accepted"] + actions["edited"]) / decided if decided else None
    dismiss_rate = (actions["dismissed"] + actions["overridden"]) / decided if decided else None

    # Which brand entries the findings cite.
    cited_by: dict[Any, list[Finding]] = defaultdict(list)
    if finding_ids:
        by_id = {f.id: f for f in findings}
        for finding_id, entry_id in db.execute(
            select(FindingCitation.finding_id, FindingCitation.entry_id)
            .where(FindingCitation.finding_id.in_(finding_ids))
        ).all():
            cited_by[entry_id].append(by_id[finding_id])
    entries = {e.id: e for e in db.scalars(select(BrandEntry).where(BrandEntry.org_id == org_id))}

    most_violated = sorted(
        ({"code": entries[eid].code, "title": entries[eid].title, "count": len(rows),
          "category": _frontend_category(entries[eid].category)}
         for eid, rows in cited_by.items() if eid in entries),
        key=lambda rule: rule["count"], reverse=True)[:6]

    # Findings per category, per week (oldest first), only weeks that have findings.
    weeks: dict[int, Counter] = defaultdict(Counter)
    for f in findings:
        weeks[(f.created_at - since).days // 7][_frontend_category(f.category)] += 1
    category_over_time = [
        {"period": f"Week {week + 1}", **{key: weeks[week][key] for key in CATEGORY_KEYS}}
        for week in sorted(weeks)
    ]

    unclear_rules = []
    for eid, rows in cited_by.items():
        entry = entries.get(eid)
        if entry is None:
            continue
        rule_actions = [latest_action[f.id] for f in rows if f.id in latest_action]
        if not rule_actions:
            continue
        dismissal = rule_actions.count("dismissed") / len(rule_actions)
        override = rule_actions.count("overridden") / len(rule_actions)
        score = round(0.6 * dismissal + 0.4 * override, 2)
        unclear_rules.append({
            "entry_id": str(entry.id),
            "code": entry.code,
            "title": entry.title,
            "category": _frontend_category(entry.category),
            "findings_count": len(rows),
            "decisions_count": len(rule_actions),
            "dismissal_rate": round(dismissal, 2),
            "override_rate": round(override, 2),
            "clarity_score": score,
            "conflicts_count": sum(1 for f in rows if f.guideline_conflict),
            "may_be_unclear": score >= CLARITY_THRESHOLD and len(rule_actions) >= MIN_DECISIONS_FOR_CLARITY,
        })
    unclear_rules.sort(key=lambda rule: rule["clarity_score"], reverse=True)

    return {
        "period_days": period_days,
        "kpis": {
            "checks_run": checks_run,
            "total_findings": len(findings),
            "accept_rate": round(accept_rate, 3) if accept_rate is not None else None,
            "dismiss_rate": round(dismiss_rate, 3) if dismiss_rate is not None else None,
        },
        "most_violated_rules": most_violated,
        "category_over_time": category_over_time,
        "unclear_rules": unclear_rules,
    }
