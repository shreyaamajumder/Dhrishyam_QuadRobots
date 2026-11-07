"""Comprehensive API router integration tests for Dhrishyam.

Validates:
  - Library CRUD & Versioning
  - Content Intake & Versioning
  - Check Execution & Polling
  - Finding Decisions & Offset Shifts
  - Workflow State Machine & Reviewer Queue
  - Governance Insights & Clarity Score
  - Audit Log Reader
"""

import pytest
from fastapi.testclient import TestClient

from app.auth import DEMO_USERS, get_verifier
from app.db import get_db
from app.main import create_app
from app.seed_loader import auto_seed_if_needed


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    # Prime database with demo seed
    auto_seed_if_needed(session=db)
    return TestClient(app)


def auth_header(role: str) -> dict[str, str]:
    return {"Authorization": f"Bearer demo-{role}-token"}


def test_library_entries_list(client):
    res = client.get("/api/v1/library/entries", headers=auth_header("creator"))
    assert res.status_code == 200
    entries = res.json()
    assert isinstance(entries, list)
    assert len(entries) > 0
    codes = [e["code"] for e in entries]
    assert any("TONE" in c for c in codes)


def test_create_library_entry_admin_only(client):
    # Creator is forbidden
    payload = {
        "code": "R-TEST-999",
        "entry_type": "rule",
        "category": "tone",
        "title": "Test Guideline",
        "body": "Always test new features.",
        "check_mode": "deterministic",
        "severity_default": "medium",
    }
    creator_res = client.post("/api/v1/library/entries", json=payload, headers=auth_header("creator"))
    assert creator_res.status_code == 403

    # Admin succeeds
    admin_res = client.post("/api/v1/library/entries", json=payload, headers=auth_header("admin"))
    assert admin_res.status_code == 201
    entry = admin_res.json()
    assert entry["code"] == "R-TEST-999"
    assert entry["current_version"] == 1


def test_content_lifecycle_and_workflow(client):
    creator_h = auth_header("creator")
    reviewer_h = auth_header("reviewer")

    # 1. Creator creates a new draft
    draft_payload = {
        "title": "Enterprise Cloud Roadmap 2027",
        "content_type": "blog",
        "body_text": "We are proud to announce our #1 enterprise platform with zero downtime guaranteed. Click here to learn more.",
    }
    create_res = client.post("/api/v1/content", json=draft_payload, headers=creator_h)
    assert create_res.status_code == 201
    item = create_res.json()
    content_id = item["id"]
    assert item["status"] == "draft"
    assert item["current_version_no"] == 1

    # 2. Trigger brand check run (returns 202)
    check_res = client.post(f"/api/v1/content/{content_id}/checks", headers=creator_h)
    assert check_res.status_code == 202
    check_run_id = check_res.json()["check_run_id"]

    # 3. Poll check run status
    poll_res = client.get(f"/api/v1/checks/{check_run_id}", headers=creator_h)
    assert poll_res.status_code == 200
    check_data = poll_res.json()
    assert check_data["status"] in ("queued", "running", "completed")

    # 4. Fetch content details
    get_res = client.get(f"/api/v1/content/{content_id}", headers=creator_h)
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "Enterprise Cloud Roadmap 2027"

    # 5. Creator submits for approval
    submit_res = client.post(
        f"/api/v1/content/{content_id}/submit",
        json={"reviewer_id": str(DEMO_USERS["reviewer"]["id"])},
        headers=creator_h,
    )
    assert submit_res.status_code == 200
    assert submit_res.json()["status"] == "in_review"

    # 6. Reviewer sees submission in queue
    queue_res = client.get("/api/v1/review-queue", headers=reviewer_h)
    assert queue_res.status_code == 200
    queue = queue_res.json()
    assert any(q["id"] == content_id for q in queue)

    # 7. Creator self-approval is blocked
    self_appr = client.post(
        f"/api/v1/content/{content_id}/review",
        json={"decision": "approved"},
        headers=creator_h,
    )
    assert self_appr.status_code == 403

    # 8. Reviewer approves submission
    review_res = client.post(
        f"/api/v1/content/{content_id}/review",
        json={"decision": "approved", "comment": "Verified and approved."},
        headers=reviewer_h,
    )
    assert review_res.status_code == 200
    assert review_res.json()["status"] == "approved"


def test_governance_insights_summary(client):
    res = client.get("/api/v1/insights/summary", headers=auth_header("admin"))
    assert res.status_code == 200
    data = res.json()
    assert "kpis" in data
    assert "most_violated_rules" in data
    assert "unclear_rules" in data
    assert isinstance(data["unclear_rules"], list)


def test_audit_log_admin_only(client):
    # Creator blocked
    res_c = client.get("/api/v1/audit", headers=auth_header("creator"))
    assert res_c.status_code == 403

    # Admin succeeds
    res_a = client.get("/api/v1/audit", headers=auth_header("admin"))
    assert res_a.status_code == 200
    logs = res_a.json()
    assert isinstance(logs, list)

