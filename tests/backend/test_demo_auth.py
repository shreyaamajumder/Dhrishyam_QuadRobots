"""Unit tests for Demo Mode authentication and responsible-AI disclosure endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.auth import DEMO_USERS, get_verifier
from app.db import get_db
from app.main import create_app


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_disclosure_endpoint(client):
    res = client.get("/api/v1/disclosure")
    assert res.status_code == 200
    data = res.json()
    assert "provider" in data
    assert "model" in data
    assert "data_use_note" in data
    assert isinstance(data["known_limitations"], list)
    assert len(data["known_limitations"]) > 0


def test_demo_users_endpoint(client):
    res = client.get("/api/v1/auth/demo-users")
    assert res.status_code == 200
    users = res.json()
    assert "creator" in users
    assert "reviewer" in users
    assert "admin" in users
    assert users["creator"]["email"] == DEMO_USERS["creator"]["email"]


def test_demo_login_creator(client):
    res = client.post("/api/v1/auth/demo-login", json={"role": "creator"})
    assert res.status_code == 200
    data = res.json()
    assert data["access_token"] == "demo-creator-token"
    assert data["user"]["role"] == "creator"
    assert data["user"]["email"] == DEMO_USERS["creator"]["email"]


def test_demo_login_invalid_role(client):
    res = client.post("/api/v1/auth/demo-login", json={"role": "superman"})
    assert res.status_code == 400


def test_me_with_demo_tokens(client):
    for role in ("creator", "reviewer", "admin"):
        headers = {"Authorization": f"Bearer demo-{role}-token"}
        res = client.get("/api/v1/me", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["role"] == role
        assert data["email"] == DEMO_USERS[role]["email"]
        assert data["display_name"] == DEMO_USERS[role]["display_name"]


def test_auto_seed_loads_entries_and_draft(db):
    from sqlalchemy import func, select
    from app.auth import DEMO_ORG_ID
    from app.models import BrandEntry, ContentItem, Organization
    from app.seed_loader import auto_seed_if_needed

    already_seeded = db.get(Organization, DEMO_ORG_ID) is not None
    counts = auto_seed_if_needed(session=db)
    if not already_seeded:
        assert counts["brand_entries"] > 0
        assert counts["organizations"] == 1

    assert db.get(Organization, DEMO_ORG_ID) is not None
    entry_count = db.scalar(select(func.count(BrandEntry.id)).where(BrandEntry.org_id == DEMO_ORG_ID))
    content_count = db.scalar(select(func.count(ContentItem.id)).where(ContentItem.org_id == DEMO_ORG_ID))
    assert entry_count > 0
    assert content_count > 0

    # Second run is idempotent
    second_counts = auto_seed_if_needed(session=db)
    assert second_counts["brand_entries"] == 0
    assert second_counts["organizations"] == 0


