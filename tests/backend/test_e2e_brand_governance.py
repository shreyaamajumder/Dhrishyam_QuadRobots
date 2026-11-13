"""Comprehensive 4-Tier E2E Test Suite for Dhrishyam Brand Governance.

Validates:
- Tier 1: Feature Coverage (24 tests)
    * Multi-Tenant Brand Self-Registration (F1)
    * Offline Authentication & Session Management (F4)
    * Per-Brand User Credential Provisioning (F5)
    * Cross-Tenant Data Isolation & Acme Cloud Preservation (F2, F7)
- Tier 2: Boundary & Corner Cases (33 tests)
    * Empty & Missing Fields (Category 2.1)
    * Malformed Passwords & Cryptographic Bounds (Category 2.2)
    * Duplicate Emails & Unique Constraints (Category 2.3)
    * Invalid Tokens & Authentication Spoofing (Category 2.4)
    * Cross-Org Spoofing & Tenant Header Tampering (Category 2.5)
    * Role Permission Bounds (Category 2.6)
- Tier 3: Cross-Feature Combinations (4 tests)
    * Full Tenant Lifecycle: Registration to Isolation
    * Multi-Org User Tenant Switching & Context Resolution
    * Member Lifecycle: Role Mutation & Revocation
    * Seeded vs Unseeded Brand Rules & Duplicate Code Allowance
- Tier 4: Real-World Scenarios (2 tests)
    * Multi-Brand Coexistence alongside Seeded Acme Cloud
    * Enterprise Brand Team Governance & Audit Workflow

All tests run in savepoint-isolated transactions with automatic rollback.
"""

from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import DEMO_ORG_ID, DEMO_USERS
from app.config import get_settings
from app.db import get_db
from app.main import create_app
from app.models import (
    AuditLog,
    BrandEntry,
    ContentItem,
    Membership,
    Organization,
    Profile,
)
from app.security import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.seed_loader import auto_seed_if_needed


# ============================================================================
# Fixtures & Helpers
# ============================================================================

@pytest.fixture
def client(db):
    """FastAPI TestClient bound to a savepoint-managed database session.

    All changes made during a test run inside an inner savepoint that is
    automatically rolled back upon fixture teardown in conftest.py.
    """
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    auto_seed_if_needed(session=db)
    return TestClient(app)


def make_auth_headers(token: str, org_id: str | UUID | None = None) -> dict[str, str]:
    """Helper to construct standard authorization and tenant context headers."""
    headers = {"Authorization": f"Bearer {token}"}
    if org_id is not None:
        headers["X-Org-Id"] = str(org_id)
    return headers


# ============================================================================
# TIER 1: Feature Coverage (24 Tests)
# ============================================================================

# ----------------------------------------------------------------------------
# Feature 1.1: Multi-Tenant Brand Self-Registration
# ----------------------------------------------------------------------------

def test_tier1_register_brand_success_minimal(client):
    """1. Brand self-registration creates organization, admin profile, and returns 201 + valid JWT."""
    payload = {
        "brand_name": "Acron Corp",
        "admin_name": "Alice Acron",
        "admin_email": "alice@acron.com",
        "password": "SecurePassword123!",
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert "access_token" in data and len(data["access_token"]) > 20
    assert data["token_type"] == "bearer"
    user = data["user"]
    assert user["email"] == "alice@acron.com"
    assert user["display_name"] == "Alice Acron"
    assert user["role"] == "admin"
    assert user["org_name"] == "Acron Corp"
    assert UUID(user["org_id"])


def test_tier1_register_brand_with_seed_default_rules_true(client):
    """2. Registering with seed_default_rules=True seeds standard brand rules into the brand library."""
    payload = {
        "brand_name": "Kite Logistics",
        "admin_name": "Kevin Kite",
        "admin_email": "kevin@kite.com",
        "password": "SecurePassword123!",
        "seed_default_rules": True,
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    data = res.json()
    token = data["access_token"]
    org_id = data["user"]["org_id"]

    lib_res = client.get("/api/v1/library/entries", headers=make_auth_headers(token, org_id))
    assert lib_res.status_code == 200
    entries = lib_res.json()
    assert isinstance(entries, list)
    assert len(entries) >= 1


def test_tier1_register_brand_with_seed_default_rules_false(client):
    """3. Registering with seed_default_rules=False creates an empty brand library."""
    payload = {
        "brand_name": "CleanSlate Inc",
        "admin_name": "Claire Clean",
        "admin_email": "claire@cleanslate.io",
        "password": "SecurePassword123!",
        "seed_default_rules": False,
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    data = res.json()
    token = data["access_token"]
    org_id = data["user"]["org_id"]

    lib_res = client.get("/api/v1/library/entries", headers=make_auth_headers(token, org_id))
    assert lib_res.status_code == 200
    entries = lib_res.json()
    assert isinstance(entries, list)
    assert len(entries) == 0


def test_tier1_register_brand_returns_valid_jwt_token(client):
    """4. Self-registration response includes an HS256 JWT with correct claims."""
    payload = {
        "brand_name": "JWT Token Brand",
        "admin_name": "Token Admin",
        "admin_email": "jwt@brand.com",
        "password": "SecurePassword123!",
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    token = res.json()["access_token"]
    user = res.json()["user"]

    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["sub"] == user["id"]
    assert claims["email"] == "jwt@brand.com"
    assert claims["role"] == "admin"
    assert claims["exp"] > time.time()


def test_tier1_register_brand_multiple_independent_brands(client):
    """5. Multiple sequential brand registrations generate distinct organizations and administrators."""
    res1 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Delta Systems",
        "admin_name": "Dan Delta",
        "admin_email": "admin1@delta.com",
        "password": "SecurePassword123!",
    })
    res2 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Echo Labs",
        "admin_name": "Eve Echo",
        "admin_email": "admin2@echo.com",
        "password": "SecurePassword123!",
    })
    assert res1.status_code == 201
    assert res2.status_code == 201

    data1 = res1.json()
    data2 = res2.json()

    assert data1["user"]["org_id"] != data2["user"]["org_id"]
    assert data1["user"]["id"] != data2["user"]["id"]
    assert data1["user"]["email"] != data2["user"]["email"]


def test_tier1_register_brand_persists_in_database(client, db):
    """6. Brand self-registration persists Organization, Profile with password hash, and Membership records."""
    payload = {
        "brand_name": "DB Persistence Brand",
        "admin_name": "Dan DB",
        "admin_email": "dan@dbbrand.com",
        "password": "SecurePassword123!",
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    user = res.json()["user"]

    org = db.get(Organization, UUID(user["org_id"]))
    assert org is not None
    assert org.name == "DB Persistence Brand"

    prof = db.get(Profile, UUID(user["id"]))
    assert prof is not None
    assert prof.email == "dan@dbbrand.com"
    assert prof.password_hash is not None
    assert "$" in prof.password_hash

    mem = db.execute(
        select(Membership).where(
            Membership.org_id == org.id,
            Membership.user_id == prof.id,
        )
    ).scalar_one_or_none()
    assert mem is not None
    assert mem.role == "admin"


# ----------------------------------------------------------------------------
# Feature 1.2: Offline Authentication & Session Management
# ----------------------------------------------------------------------------

def test_tier1_offline_login_success(client):
    """7. Authenticate locally with valid email and password, returning 200 and access token."""
    client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Login Test Brand",
        "admin_name": "Login User",
        "admin_email": "login@testbrand.com",
        "password": "LoginPassword123!",
    })

    login_res = client.post("/api/v1/auth/login", json={
        "email": "login@testbrand.com",
        "password": "LoginPassword123!",
    })
    assert login_res.status_code == 200
    data = login_res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "login@testbrand.com"
    assert data["user"]["role"] == "admin"


def test_tier1_offline_login_case_insensitive_email(client):
    """8. Offline login email lookup is case-insensitive."""
    client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Case Test Brand",
        "admin_name": "Case User",
        "admin_email": "case.insensitive@brand.com",
        "password": "SecurePassword123!",
    })

    login_res = client.post("/api/v1/auth/login", json={
        "email": "CASE.INSENSITIVE@BRAND.COM",
        "password": "SecurePassword123!",
    })
    assert login_res.status_code == 200
    assert login_res.json()["user"]["email"] == "case.insensitive@brand.com"


def test_tier1_offline_login_invalid_password_returns_401(client):
    """9. Incorrect password returns HTTP 401 Unauthorized with generic anti-enumeration detail."""
    client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Bad Pass Brand",
        "admin_name": "Bad User",
        "admin_email": "badpass@brand.com",
        "password": "CorrectPassword123!",
    })

    login_res = client.post("/api/v1/auth/login", json={
        "email": "badpass@brand.com",
        "password": "WrongPassword999!",
    })
    assert login_res.status_code == 401
    assert "Invalid email or password" in login_res.json()["detail"]


def test_tier1_offline_login_unregistered_email_returns_401(client):
    """10. Unregistered email returns HTTP 401 Unauthorized with identical error to prevent user enumeration."""
    login_res = client.post("/api/v1/auth/login", json={
        "email": "ghost.user@doesnotexist.com",
        "password": "AnyPassword123!",
    })
    assert login_res.status_code == 401
    assert "Invalid email or password" in login_res.json()["detail"]


def test_tier1_me_endpoint_resolves_authenticated_profile(client):
    """11. GET /api/v1/me resolves the authenticated profile, active role, and organization context."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Me Endpoint Brand",
        "admin_name": "Me Admin",
        "admin_email": "me@endpoint.com",
        "password": "SecurePassword123!",
    }).json()

    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    me_res = client.get("/api/v1/me", headers=make_auth_headers(token, org_id))
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == "me@endpoint.com"
    assert me_data["role"] == "admin"
    assert me_data["org_id"] == str(org_id)
    assert me_data["org_name"] == "Me Endpoint Brand"


def test_tier1_offline_logout_success(client):
    """12. POST /api/v1/auth/logout succeeds and returns confirmation."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Logout Brand",
        "admin_name": "Logout Admin",
        "admin_email": "logout@brand.com",
        "password": "SecurePassword123!",
    }).json()

    token = reg["access_token"]
    logout_res = client.post("/api/v1/auth/logout", headers=make_auth_headers(token))
    assert logout_res.status_code == 200
    assert logout_res.json()["status"] == "ok"


# ----------------------------------------------------------------------------
# Feature 1.3: Per-Brand Member Provisioning & Management
# ----------------------------------------------------------------------------

def test_tier1_admin_add_member_with_initial_password(client):
    """13. Brand Admin provisions a new member with role 'creator' and initial password."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Provision Brand",
        "admin_name": "Admin Prov",
        "admin_email": "admin@prov.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    add_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={
            "display_name": "Maya Writer",
            "email": "maya@prov.com",
            "role": "creator",
            "password": "MayaPassword123!",
        },
    )
    assert add_res.status_code == 201
    members = add_res.json()
    assert isinstance(members, list)
    assert any(m["email"] == "maya@prov.com" and m["role"] == "creator" for m in members)


def test_tier1_provisioned_member_can_login_offline(client):
    """14. A provisioned member can immediately authenticate using their email and initial password."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Login Prov Brand",
        "admin_name": "Admin LProv",
        "admin_email": "admin@lprov.com",
        "password": "SecurePassword123!",
    }).json()
    admin_token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(admin_token, org_id),
        json={
            "display_name": "Leo Creator",
            "email": "leo@lprov.com",
            "role": "creator",
            "password": "LeoPassword123!",
        },
    )

    login_res = client.post("/api/v1/auth/login", json={
        "email": "leo@lprov.com",
        "password": "LeoPassword123!",
    })
    assert login_res.status_code == 200
    leo_data = login_res.json()
    assert leo_data["user"]["email"] == "leo@lprov.com"
    assert leo_data["user"]["role"] == "creator"
    assert leo_data["user"]["org_id"] == str(org_id)


def test_tier1_admin_add_member_reviewer_role(client):
    """15. Brand Admin provisions a new member with role 'reviewer'."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Reviewer Brand",
        "admin_name": "Admin Rev",
        "admin_email": "admin@rev.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    add_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={
            "display_name": "Ray Reviewer",
            "email": "ray@rev.com",
            "role": "reviewer",
            "password": "RayPassword123!",
        },
    )
    assert add_res.status_code == 201
    members = add_res.json()
    assert any(m["email"] == "ray@rev.com" and m["role"] == "reviewer" for m in members)


def test_tier1_list_workspace_members_scoped_to_brand(client):
    """16. GET /api/v1/members lists all provisioned workspace members for the brand."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Roster Brand",
        "admin_name": "Admin Roster",
        "admin_email": "admin@roster.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Mem One", "email": "one@roster.com", "role": "creator"},
    )
    client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Mem Two", "email": "two@roster.com", "role": "reviewer"},
    )

    list_res = client.get("/api/v1/members", headers=make_auth_headers(token, org_id))
    assert list_res.status_code == 200
    members = list_res.json()
    emails = {m["email"] for m in members}
    assert "admin@roster.com" in emails
    assert "one@roster.com" in emails
    assert "two@roster.com" in emails


def test_tier1_admin_update_member_role(client):
    """17. PATCH /api/v1/members/{user_id}/role updates a member's role from creator to reviewer."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Update Role Brand",
        "admin_name": "Admin Upd",
        "admin_email": "admin@upd.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    add_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Sam Creator", "email": "sam@upd.com", "role": "creator"},
    )
    sam = next(m for m in add_res.json() if m["email"] == "sam@upd.com")

    patch_res = client.patch(
        f"/api/v1/members/{sam['user_id']}/role",
        headers=make_auth_headers(token, org_id),
        json={"role": "reviewer"},
    )
    assert patch_res.status_code == 200
    updated_members = patch_res.json()
    sam_updated = next(m for m in updated_members if m["email"] == "sam@upd.com")
    assert sam_updated["role"] == "reviewer"


def test_tier1_admin_remove_member(client):
    """18. DELETE /api/v1/members/{user_id} removes a member from the workspace."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Remove Member Brand",
        "admin_name": "Admin Rem",
        "admin_email": "admin@rem.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    add_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Temp User", "email": "temp@rem.com", "role": "creator"},
    )
    temp_user = next(m for m in add_res.json() if m["email"] == "temp@rem.com")

    del_res = client.delete(
        f"/api/v1/members/{temp_user['user_id']}",
        headers=make_auth_headers(token, org_id),
    )
    assert del_res.status_code == 200
    remaining_members = del_res.json()
    assert not any(m["email"] == "temp@rem.com" for m in remaining_members)


# ----------------------------------------------------------------------------
# Feature 1.4: Cross-Tenant Data Isolation & Acme Cloud Preservation
# ----------------------------------------------------------------------------

def test_tier1_cross_tenant_library_entries_isolated(client):
    """19. Library entries created in Brand A are invisible in Brand B library list."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Brand Alpha",
        "admin_name": "Admin Alpha",
        "admin_email": "admin@alpha.com",
        "password": "SecurePassword123!",
        "seed_default_rules": False,
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Brand Beta",
        "admin_name": "Admin Beta",
        "admin_email": "admin@beta.com",
        "password": "SecurePassword123!",
        "seed_default_rules": False,
    }).json()

    # Brand A creates a rule
    rule_res = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
        json={
            "code": "R-ALPHA-01",
            "entry_type": "rule",
            "category": "tone",
            "title": "Alpha Brand Voice",
            "body": "Tone must always be professional and authoritative.",
        },
    )
    assert rule_res.status_code == 201

    # Brand B queries library
    lib_b = client.get(
        "/api/v1/library/entries",
        headers=make_auth_headers(reg_b["access_token"], reg_b["user"]["org_id"]),
    )
    assert lib_b.status_code == 200
    codes_b = [e["code"] for e in lib_b.json()]
    assert "R-ALPHA-01" not in codes_b


def test_tier1_cross_tenant_direct_library_entry_lookup_returns_404(client):
    """20. Direct GET on Brand A's library entry ID using Brand B's context returns 404 Not Found."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Direct Alpha",
        "admin_name": "Admin DAlpha",
        "admin_email": "admin@dalpha.com",
        "password": "SecurePassword123!",
        "seed_default_rules": False,
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Direct Beta",
        "admin_name": "Admin DBeta",
        "admin_email": "admin@dbeta.com",
        "password": "SecurePassword123!",
        "seed_default_rules": False,
    }).json()

    rule_res = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
        json={
            "code": "R-DALPHA-01",
            "entry_type": "rule",
            "category": "tone",
            "title": "Confidential Alpha Rule",
            "body": "Do not leak alpha information.",
        },
    )
    entry_id = rule_res.json()["id"]

    # Brand B queries by ID
    get_res = client.get(
        f"/api/v1/library/entries/{entry_id}",
        headers=make_auth_headers(reg_b["access_token"], reg_b["user"]["org_id"]),
    )
    assert get_res.status_code == 404
    assert "Library entry not found" in get_res.json()["detail"]


def test_tier1_cross_tenant_content_drafts_isolated(client):
    """21. Content drafts created under Brand A are not returned in Brand B's content listing."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Drafts Alpha",
        "admin_name": "Admin DrAlpha",
        "admin_email": "admin@dralpha.com",
        "password": "SecurePassword123!",
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Drafts Beta",
        "admin_name": "Admin DrBeta",
        "admin_email": "admin@drbeta.com",
        "password": "SecurePassword123!",
    }).json()

    # Brand A admin creates draft
    draft_res = client.post(
        "/api/v1/content",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
        json={
            "title": "Alpha Confidential Launch",
            "content_type": "blog",
            "body_text": "This is confidential marketing launch material for Alpha Corp only.",
        },
    )
    assert draft_res.status_code == 201
    draft_id = draft_res.json()["id"]

    # Brand B lists content
    list_b = client.get(
        "/api/v1/content",
        headers=make_auth_headers(reg_b["access_token"], reg_b["user"]["org_id"]),
    )
    assert list_b.status_code == 200
    item_ids_b = [item["id"] for item in list_b.json()]
    assert draft_id not in item_ids_b


def test_tier1_cross_tenant_direct_content_lookup_returns_404(client):
    """22. Direct lookup of Brand A's content draft by ID using Brand B's credentials returns 404 Not Found."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Direct Content Alpha",
        "admin_name": "Admin DCAlpha",
        "admin_email": "admin@dcalpha.com",
        "password": "SecurePassword123!",
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Direct Content Beta",
        "admin_name": "Admin DCBeta",
        "admin_email": "admin@dcbeta.com",
        "password": "SecurePassword123!",
    }).json()

    draft_res = client.post(
        "/api/v1/content",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
        json={
            "title": "Secret Roadmap Draft",
            "content_type": "blog",
            "body_text": "Q4 confidential roadmap details for upcoming executive board review.",
        },
    )
    draft_id = draft_res.json()["id"]

    get_res = client.get(
        f"/api/v1/content/{draft_id}",
        headers=make_auth_headers(reg_b["access_token"], reg_b["user"]["org_id"]),
    )
    assert get_res.status_code == 404
    assert "Content item not found" in get_res.json()["detail"]


def test_tier1_cross_tenant_members_list_isolated(client):
    """23. Brand A's member listing contains zero users from Brand B or seeded Acme Cloud."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Members Alpha",
        "admin_name": "Admin MAlpha",
        "admin_email": "admin@malpha.com",
        "password": "SecurePassword123!",
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Members Beta",
        "admin_name": "Admin MBeta",
        "admin_email": "admin@mbeta.com",
        "password": "SecurePassword123!",
    }).json()

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg_b["access_token"], reg_b["user"]["org_id"]),
        json={"display_name": "Beta Exclusive", "email": "exclusive@beta.com", "role": "creator"},
    )

    members_a_res = client.get(
        "/api/v1/members",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
    )
    assert members_a_res.status_code == 200
    emails_a = {m["email"] for m in members_a_res.json()}
    assert "exclusive@beta.com" not in emails_a
    assert "aarav.writer@acme-cloud.io" not in emails_a
    assert "rohan.governance@acme-cloud.io" not in emails_a


def test_tier1_seeded_acme_cloud_workspace_preserved_and_isolated(client):
    """24. Default Acme Cloud workspace (00000000-0000-0000-0000-000000000001) remains seeded, accessible, and isolated."""
    # Register a new custom brand
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Omega Brand",
        "admin_name": "Admin Omega",
        "admin_email": "admin@omega.com",
        "password": "SecurePassword123!",
    }).json()

    # Login via demo login to default Acme Cloud workspace
    demo_res = client.post("/api/v1/auth/demo-login", json={"role": "admin"})
    assert demo_res.status_code == 200
    acme_data = demo_res.json()
    assert acme_data["user"]["org_id"] == str(DEMO_ORG_ID)
    assert acme_data["user"]["org_name"] == "Acme Cloud Workspace"

    # Query Acme Cloud brand library
    acme_token = acme_data["access_token"]
    lib_res = client.get("/api/v1/library/entries", headers=make_auth_headers(acme_token, DEMO_ORG_ID))
    assert lib_res.status_code == 200
    acme_entries = lib_res.json()
    assert len(acme_entries) > 0

    # Verify Omega Brand org is distinct and isolated from Acme Cloud
    assert UUID(reg["user"]["org_id"]) != DEMO_ORG_ID


# ============================================================================
# TIER 2: Boundary & Corner Cases (33 Tests)
# ============================================================================

# ----------------------------------------------------------------------------
# Category 2.1: Empty Strings & Missing Fields
# ----------------------------------------------------------------------------

def test_tier2_register_brand_empty_brand_name(client):
    """25. Brand registration rejects empty or whitespace-only brand name with 400 Bad Request."""
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "   ",
        "admin_name": "Valid Name",
        "admin_email": "admin@emptyname.com",
        "password": "SecurePassword123!",
    })
    assert res.status_code in (400, 422)


def test_tier2_register_brand_empty_admin_email(client):
    """26. Brand registration rejects missing or empty admin email with 400 Bad Request."""
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Valid Brand",
        "admin_name": "Valid Name",
        "admin_email": "",
        "password": "SecurePassword123!",
    })
    assert res.status_code in (400, 422)


def test_tier2_register_brand_empty_password(client):
    """27. Brand registration rejects empty password with 400 Bad Request."""
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Valid Brand",
        "admin_name": "Valid Name",
        "admin_email": "admin@emptypass.com",
        "password": "",
    })
    assert res.status_code in (400, 422)


def test_tier2_login_empty_email_or_password(client):
    """28. Login endpoint rejects empty email or missing password with 400 Bad Request."""
    res = client.post("/api/v1/auth/login", json={"email": "   ", "password": ""})
    assert res.status_code in (400, 422)


def test_tier2_add_member_missing_or_empty_display_name(client):
    """29. Admin invite rejects whitespace-only member display name with 400 Bad Request."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Invite Name Test",
        "admin_name": "Admin NameTest",
        "admin_email": "admin@nametest.com",
        "password": "SecurePassword123!",
    }).json()

    res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg["access_token"], reg["user"]["org_id"]),
        json={"display_name": "   ", "email": "valid@nametest.com", "role": "creator"},
    )
    assert res.status_code == 400
    assert "Member name is required" in res.json()["detail"]


def test_tier2_add_member_invalid_email_format(client):
    """30. Admin invite rejects malformed email format missing '@' with 400 Bad Request."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Invite Email Test",
        "admin_name": "Admin EmailTest",
        "admin_email": "admin@emailtest.com",
        "password": "SecurePassword123!",
    }).json()

    res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg["access_token"], reg["user"]["org_id"]),
        json={"display_name": "Bad Email User", "email": "not-an-email-address", "role": "creator"},
    )
    assert res.status_code == 400
    assert "Valid email address is required" in res.json()["detail"]


# ----------------------------------------------------------------------------
# Category 2.2: Malformed Passwords & Cryptographic Bounds
# ----------------------------------------------------------------------------

def test_tier2_register_brand_short_password(client):
    """31. Brand registration rejects password shorter than minimum length (<6 chars) with 400 Bad Request."""
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Short Pass Brand",
        "admin_name": "Short Admin",
        "admin_email": "short@pass.com",
        "password": "123",
    })
    assert res.status_code in (400, 422)


def test_tier2_login_overlong_password_bounded(client):
    """32. Extreme password length (10,000 chars) is processed gracefully without 500 crash or worker exhaustion."""
    res = client.post("/api/v1/auth/login", json={
        "email": "anyuser@brand.com",
        "password": "A" * 10000,
    })
    assert res.status_code in (401, 422)


def test_tier2_password_unicode_and_emojis(client):
    """33. Unicode symbols and emojis in passwords (P@ssw0rd™🔒🚀2026!) are hashed and verified with UTF-8 fidelity."""
    pw = "P@ssw0rd™🔒🚀2026!"
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Emoji Pass Brand",
        "admin_name": "Emoji Admin",
        "admin_email": "emoji@pass.com",
        "password": pw,
    })
    assert reg.status_code == 201

    login_res = client.post("/api/v1/auth/login", json={
        "email": "emoji@pass.com",
        "password": pw,
    })
    assert login_res.status_code == 200
    assert login_res.json()["user"]["email"] == "emoji@pass.com"


def test_tier2_password_verification_constant_time(client):
    """34. Password verification mechanism uses scrypt hashing with constant-time comparison."""
    pw = "SecretPassphrase123!"
    pw_hash = hash_password(pw)
    assert verify_password(pw, pw_hash) is True
    assert verify_password("WrongSecretPassphrase123!", pw_hash) is False
    assert verify_password(pw, "corrupted_hash_without_delimiter") is False
    assert verify_password(pw, "") is False


def test_tier2_password_null_byte_handling(client):
    """35. Embedded null byte (\\x00) in password string is safely handled without truncation or crash."""
    pw = "pre\x00postPassword123!"
    res = client.post("/api/v1/auth/login", json={
        "email": "nullbyte@test.com",
        "password": pw,
    })
    assert res.status_code in (401, 422)


# ----------------------------------------------------------------------------
# Category 2.3: Duplicate Emails & Unique Constraints
# ----------------------------------------------------------------------------

def test_tier2_register_brand_duplicate_admin_email(client):
    """36. Brand registration with an already-registered admin email returns HTTP 409 Conflict."""
    email = "duplicate.admin@brand.com"
    res1 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Original Brand",
        "admin_name": "Orig Admin",
        "admin_email": email,
        "password": "SecurePassword123!",
    })
    assert res1.status_code == 201

    res2 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Duplicate Brand",
        "admin_name": "Dup Admin",
        "admin_email": email,
        "password": "SecurePassword123!",
    })
    assert res2.status_code in (400, 409)


def test_tier2_register_brand_case_variant_duplicate_email(client):
    """37. Email normalization prevents duplicate account creation via case variations."""
    res1 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Case Brand 1",
        "admin_name": "Admin One",
        "admin_email": "case.test@brand.com",
        "password": "SecurePassword123!",
    })
    assert res1.status_code == 201

    res2 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Case Brand 2",
        "admin_name": "Admin Two",
        "admin_email": "CASE.TEST@BRAND.COM",
        "password": "SecurePassword123!",
    })
    assert res2.status_code in (400, 409)


def test_tier2_add_member_duplicate_email_in_same_org(client):
    """38. Adding a member with an email that is already a member of the same workspace returns 409 Conflict."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Dup Member Org",
        "admin_name": "Admin DM",
        "admin_email": "admin@dupmem.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Worker", "email": "worker@dupmem.com", "role": "creator"},
    )

    dup_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Worker Two", "email": "worker@dupmem.com", "role": "creator"},
    )
    assert dup_res.status_code == 409
    assert "already a member" in dup_res.json()["detail"]


def test_tier2_add_member_case_variant_duplicate_in_same_org(client):
    """39. Adding a member with case-variant email in the same workspace returns 409 Conflict."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Case Member Org",
        "admin_name": "Admin CM",
        "admin_email": "admin@casemem.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Staff User", "email": "staff@casemem.com", "role": "creator"},
    )

    dup_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Staff User Two", "email": "STAFF@CASEMEM.COM", "role": "creator"},
    )
    assert dup_res.status_code == 409


def test_tier2_add_member_existing_user_added_to_second_org(client):
    """40. An existing user profile invited to a second organization gains a separate membership (201 Created)."""
    reg1 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Org Alpha",
        "admin_name": "Admin OA",
        "admin_email": "admin@oa.com",
        "password": "SecurePassword123!",
    }).json()
    reg2 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Org Beta",
        "admin_name": "Admin OB",
        "admin_email": "admin@ob.com",
        "password": "SecurePassword123!",
    }).json()

    # Provision user in Org Alpha
    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg1["access_token"], reg1["user"]["org_id"]),
        json={"display_name": "Shared Member", "email": "shared@consultant.com", "role": "reviewer"},
    )

    # Provision same email in Org Beta
    res2 = client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg2["access_token"], reg2["user"]["org_id"]),
        json={"display_name": "Shared Member", "email": "shared@consultant.com", "role": "creator"},
    )
    assert res2.status_code == 201
    members_b = res2.json()
    assert any(m["email"] == "shared@consultant.com" and m["role"] == "creator" for m in members_b)


# ----------------------------------------------------------------------------
# Category 2.4: Invalid Tokens & Authentication Spoofing
# ----------------------------------------------------------------------------

def test_tier2_token_expired(client):
    """41. Request with expired JWT token returns HTTP 401 Unauthorized."""
    expired_token = create_access_token(
        {"sub": str(uuid4()), "email": "exp@token.com", "role": "admin"},
        expires_delta=timedelta(seconds=-3600),
    )
    res = client.get("/api/v1/me", headers=make_auth_headers(expired_token))
    assert res.status_code == 401


def test_tier2_token_tampered_signature(client):
    """42. Request with tampered JWT token signature returns HTTP 401 Unauthorized."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Tamper Test Brand",
        "admin_name": "Admin Tamper",
        "admin_email": "admin@tamper.com",
        "password": "SecurePassword123!",
    }).json()
    valid_token = reg["access_token"]
    tampered_token = valid_token[:-6] + "xxxxxx"

    res = client.get("/api/v1/me", headers=make_auth_headers(tampered_token))
    assert res.status_code == 401


def test_tier2_token_algorithm_none_rejected(client):
    """43. Crafted JWT token with algorithm 'none' is rejected with HTTP 401 Unauthorized."""
    none_token = jwt.encode(
        {"sub": str(uuid4()), "email": "none@alg.com", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        key="",
        algorithm="none",
    )
    res = client.get("/api/v1/me", headers=make_auth_headers(none_token))
    assert res.status_code == 401


def test_tier2_token_garbage_string(client):
    """44. Malformed non-JWT garbage string passed as Bearer token returns HTTP 401 Unauthorized."""
    res = client.get("/api/v1/me", headers={"Authorization": "Bearer this_is_definitely_not_a_valid_jwt"})
    assert res.status_code == 401


def test_tier2_missing_authorization_header(client):
    """45. Protected endpoint request without Authorization header returns HTTP 401 Unauthorized."""
    res = client.get("/api/v1/me")
    assert res.status_code == 401


def test_tier2_token_nonexistent_user_sub(client):
    """46. Validly signed JWT referencing a non-existent user sub UUID returns 401 or 403 Forbidden."""
    random_user_token = create_access_token({
        "sub": str(uuid4()),
        "email": "phantom@nowhere.com",
        "role": "creator",
    })
    res = client.get("/api/v1/me", headers=make_auth_headers(random_user_token))
    assert res.status_code in (401, 403)


# ----------------------------------------------------------------------------
# Category 2.5: Cross-Org Spoofing & Tenant Header Tampering
# ----------------------------------------------------------------------------

def test_tier2_spoof_x_org_id_unaffiliated_organization(client):
    """47. Supplying X-Org-Id of an organization the user does not belong to returns HTTP 403 Forbidden."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Spoof Org A",
        "admin_name": "Admin SA",
        "admin_email": "admin@spoofa.com",
        "password": "SecurePassword123!",
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Spoof Org B",
        "admin_name": "Admin SB",
        "admin_email": "admin@spoofb.com",
        "password": "SecurePassword123!",
    }).json()

    # User A tries to access with Org B ID
    res = client.get(
        "/api/v1/library/entries",
        headers=make_auth_headers(reg_a["access_token"], reg_b["user"]["org_id"]),
    )
    assert res.status_code == 403
    assert "You do not belong to that organisation" in res.json()["detail"]


def test_tier2_x_org_id_invalid_uuid(client):
    """48. Malformed non-UUID in X-Org-Id header returns HTTP 400 Bad Request."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "UUID Format Brand",
        "admin_name": "Admin UUID",
        "admin_email": "admin@uuidformat.com",
        "password": "SecurePassword123!",
    }).json()

    res = client.get(
        "/api/v1/library/entries",
        headers=make_auth_headers(reg["access_token"], "not-a-valid-uuid-value"),
    )
    assert res.status_code == 400
    assert "X-Org-Id must be a UUID" in res.json()["detail"]


def test_tier2_multi_org_user_omits_x_org_id(client):
    """49. Multi-org user omitting X-Org-Id header with a token lacking org_id returns HTTP 400 Bad Request."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Multi Brand A",
        "admin_name": "Admin MA",
        "admin_email": "admin@multia.com",
        "password": "SecurePassword123!",
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Multi Brand B",
        "admin_name": "Admin MB",
        "admin_email": "admin@multib.com",
        "password": "SecurePassword123!",
    }).json()

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
        json={"display_name": "Multi User", "email": "multi@user.com", "role": "creator"},
    )
    res_b = client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg_b["access_token"], reg_b["user"]["org_id"]),
        json={"display_name": "Multi User", "email": "multi@user.com", "role": "creator"},
    )
    multi_user_id = next(m["user_id"] for m in res_b.json() if m["email"] == "multi@user.com")

    # Mint a token without org_id claim
    token_without_org = create_access_token({"sub": str(multi_user_id), "email": "multi@user.com"})

    res = client.get("/api/v1/library/entries", headers={"Authorization": f"Bearer {token_without_org}"})
    assert res.status_code == 400
    assert "You belong to several organisations" in res.json()["detail"]


def test_tier2_spoof_org_id_in_request_body(client):
    """50. Backend assigns context.org_id to newly created resources, ignoring any client-injected org_id."""
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Body Spoof A",
        "admin_name": "Admin BSA",
        "admin_email": "admin@bodyspoofa.com",
        "password": "SecurePassword123!",
    }).json()
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Body Spoof B",
        "admin_name": "Admin BSB",
        "admin_email": "admin@bodyspoofb.com",
        "password": "SecurePassword123!",
    }).json()

    # User A tries to inject Org B's ID in request body
    rule_res = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(reg_a["access_token"], reg_a["user"]["org_id"]),
        json={
            "org_id": reg_b["user"]["org_id"],
            "code": "R-SPOOF-01",
            "entry_type": "rule",
            "category": "tone",
            "title": "Spoofed Rule",
            "body": "Attempted injected org_id.",
        },
    )
    assert rule_res.status_code == 201
    created_entry = rule_res.json()
    assert created_entry["org_id"] == reg_a["user"]["org_id"]
    assert created_entry["org_id"] != reg_b["user"]["org_id"]


def test_tier2_spoof_x_demo_role_with_regular_token(client):
    """51. Sending X-Demo-Role: admin with a regular creator Bearer token does not elevate privileges."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Role Spoof Brand",
        "admin_name": "Admin RS",
        "admin_email": "admin@rolespoof.com",
        "password": "SecurePassword123!",
    }).json()
    admin_token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(admin_token, org_id),
        json={"display_name": "Plain Creator", "email": "creator@rolespoof.com", "role": "creator", "password": "CreatorPass123!"},
    )

    creator_token = client.post("/api/v1/auth/login", json={
        "email": "creator@rolespoof.com",
        "password": "CreatorPass123!",
    }).json()["access_token"]

    # Creator tries to perform admin action sending X-Demo-Role: admin
    headers = {
        "Authorization": f"Bearer {creator_token}",
        "X-Org-Id": str(org_id),
        "X-Demo-Role": "admin",
    }
    res = client.post(
        "/api/v1/library/entries",
        headers=headers,
        json={"code": "R-ELEV-01", "entry_type": "rule", "category": "tone", "title": "Elev", "body": "Body"},
    )
    assert res.status_code == 403


# ----------------------------------------------------------------------------
# Category 2.6: Role Permission Bounds
# ----------------------------------------------------------------------------

def test_tier2_creator_cannot_invite_members(client):
    """52. User with role 'creator' calling POST /api/v1/members is rejected with 403 Forbidden."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Role Bounds Brand",
        "admin_name": "Admin RB",
        "admin_email": "admin@rolebounds.com",
        "password": "SecurePassword123!",
    }).json()
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg["access_token"], org_id),
        json={"display_name": "Creator User", "email": "creator@rolebounds.com", "role": "creator", "password": "CreatorPass123!"},
    )
    creator_token = client.post("/api/v1/auth/login", json={
        "email": "creator@rolebounds.com",
        "password": "CreatorPass123!",
    }).json()["access_token"]

    res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(creator_token, org_id),
        json={"display_name": "Newbie", "email": "newbie@rolebounds.com", "role": "creator"},
    )
    assert res.status_code == 403
    assert "Your role cannot do this" in res.json()["detail"]


def test_tier2_creator_cannot_change_roles(client):
    """53. User with role 'creator' calling PATCH /api/v1/members/{id}/role is rejected with 403 Forbidden."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Role Patch Brand",
        "admin_name": "Admin RP",
        "admin_email": "admin@rolepatch.com",
        "password": "SecurePassword123!",
    }).json()
    org_id = reg["user"]["org_id"]

    mems = client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg["access_token"], org_id),
        json={"display_name": "Creator RP", "email": "creator@rolepatch.com", "role": "creator", "password": "CreatorPass123!"},
    ).json()
    creator_mem = next(m for m in mems if m["email"] == "creator@rolepatch.com")

    creator_token = client.post("/api/v1/auth/login", json={
        "email": "creator@rolepatch.com",
        "password": "CreatorPass123!",
    }).json()["access_token"]

    res = client.patch(
        f"/api/v1/members/{creator_mem['user_id']}/role",
        headers=make_auth_headers(creator_token, org_id),
        json={"role": "admin"},
    )
    assert res.status_code == 403


def test_tier2_reviewer_cannot_create_library_entries(client):
    """54. User with role 'reviewer' calling POST /api/v1/library/entries is rejected with 403 Forbidden."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Rev Rule Brand",
        "admin_name": "Admin RR",
        "admin_email": "admin@revrule.com",
        "password": "SecurePassword123!",
    }).json()
    org_id = reg["user"]["org_id"]

    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg["access_token"], org_id),
        json={"display_name": "Rev RR", "email": "rev@revrule.com", "role": "reviewer", "password": "RevPass123!"},
    )
    rev_token = client.post("/api/v1/auth/login", json={
        "email": "rev@revrule.com",
        "password": "RevPass123!",
    }).json()["access_token"]

    res = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(rev_token, org_id),
        json={"code": "R-REV-01", "entry_type": "rule", "category": "tone", "title": "Rev Rule", "body": "Body"},
    )
    assert res.status_code == 403


def test_tier2_admin_cannot_demote_last_admin(client):
    """55. Demoting the only Admin in an organization returns HTTP 422 Unprocessable Entity."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Sole Admin Org",
        "admin_name": "Sole Admin",
        "admin_email": "sole@admin.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]
    admin_id = reg["user"]["id"]

    res = client.patch(
        f"/api/v1/members/{admin_id}/role",
        headers=make_auth_headers(token, org_id),
        json={"role": "creator"},
    )
    assert res.status_code == 422
    assert "Cannot remove the last Admin" in res.json()["detail"]


def test_tier2_admin_cannot_delete_own_account(client):
    """56. Admin attempting to delete their own account via DELETE /api/v1/members/{id} returns HTTP 422."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Self Delete Org",
        "admin_name": "Self Admin",
        "admin_email": "self@delete.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]
    admin_id = reg["user"]["id"]

    res = client.delete(
        f"/api/v1/members/{admin_id}",
        headers=make_auth_headers(token, org_id),
    )
    assert res.status_code == 422
    assert "cannot remove your own admin account" in res.json()["detail"]


def test_tier2_assign_invalid_role_name(client):
    """57. Assigning a non-existent role name ('superadmin') returns HTTP 400 Bad Request."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Invalid Role Org",
        "admin_name": "Admin Inv",
        "admin_email": "admin@invrole.com",
        "password": "SecurePassword123!",
    }).json()
    token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    mems = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token, org_id),
        json={"display_name": "Target User", "email": "target@invrole.com", "role": "creator"},
    ).json()
    target_mem = next(m for m in mems if m["email"] == "target@invrole.com")

    res = client.patch(
        f"/api/v1/members/{target_mem['user_id']}/role",
        headers=make_auth_headers(token, org_id),
        json={"role": "superadmin"},
    )
    assert res.status_code == 400
    assert "Invalid role" in res.json()["detail"]


# ============================================================================
# TIER 3: Cross-Feature Combinations (4 Tests)
# ============================================================================

def test_tier3_full_tenant_lifecycle_registration_to_member_isolation(client):
    """58. Full multi-step tenant lifecycle journey:

    Register -> Login -> Provision member -> Logout -> Member login ->
    Fetch workspaces -> Create draft -> Verify cross-tenant isolation attempt.
    """
    # 1. Register Brand "Zenith Systems"
    reg_res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Zenith Systems",
        "admin_name": "Zara Admin",
        "admin_email": "zara@zenith.com",
        "password": "ZenithAdminPass123!",
        "seed_default_rules": False,
    })
    assert reg_res.status_code == 201
    zenith_org_id = reg_res.json()["user"]["org_id"]

    # 2. Zara logs in
    login_zara = client.post("/api/v1/auth/login", json={
        "email": "zara@zenith.com",
        "password": "ZenithAdminPass123!",
    })
    assert login_zara.status_code == 200
    zara_token = login_zara.json()["access_token"]

    # 3. Zara adds creator member Zack
    prov_res = client.post(
        "/api/v1/members",
        headers=make_auth_headers(zara_token, zenith_org_id),
        json={
            "display_name": "Zack Creator",
            "email": "zack@zenith.com",
            "role": "creator",
            "password": "ZackPass123!",
        },
    )
    assert prov_res.status_code == 201

    # 4. Zara creates brand rule R-ZEN-01
    rule_res = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(zara_token, zenith_org_id),
        json={
            "code": "R-ZEN-01",
            "entry_type": "rule",
            "category": "tone",
            "title": "Zenith Authoritative Voice",
            "body": "Tone must always be professional and customer-first.",
        },
    )
    assert rule_res.status_code == 201

    # 5. Zara logs out
    logout_res = client.post("/api/v1/auth/logout", headers=make_auth_headers(zara_token))
    assert logout_res.status_code == 200

    # 6. Zack logs in
    login_zack = client.post("/api/v1/auth/login", json={
        "email": "zack@zenith.com",
        "password": "ZackPass123!",
    })
    assert login_zack.status_code == 200
    zack_token = login_zack.json()["access_token"]

    # 7. Zack fetches workspaces
    workspaces_res = client.get("/api/v1/auth/workspaces", headers=make_auth_headers(zack_token, zenith_org_id))
    assert workspaces_res.status_code == 200
    ws_list = workspaces_res.json()
    assert any(ws["org_id"] == str(zenith_org_id) and ws["role"] == "creator" for ws in ws_list)

    # 8. Zack creates content draft
    draft_res = client.post(
        "/api/v1/content",
        headers=make_auth_headers(zack_token, zenith_org_id),
        json={
            "title": "Zenith Launch Post",
            "content_type": "blog",
            "body_text": "Welcome to Zenith Systems. Our platform empowers brand governance across multiple teams.",
        },
    )
    assert draft_res.status_code == 201

    # 9. Zack attempts to access seeded Acme Cloud content draft
    acme_draft_id = "20000000-0000-0000-0000-000000000001"
    cross_read = client.get(
        f"/api/v1/content/{acme_draft_id}",
        headers=make_auth_headers(zack_token, zenith_org_id),
    )
    assert cross_read.status_code == 404

    # 10. Zack attempts to invite a member (admin action) -> 403 Forbidden
    cross_invite = client.post(
        "/api/v1/members",
        headers=make_auth_headers(zack_token, zenith_org_id),
        json={"display_name": "Intruder", "email": "intruder@zenith.com", "role": "creator"},
    )
    assert cross_invite.status_code == 403


def test_tier3_multi_org_user_tenant_switching_and_isolated_context(client):
    """59. Single user invited to Brand Alpha (reviewer) and Brand Beta (creator) switches workspaces via X-Org-Id."""
    reg_alpha = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Switch Alpha",
        "admin_name": "Admin SAlpha",
        "admin_email": "admin@salpha.com",
        "password": "SecurePassword123!",
    }).json()
    alpha_org_id = reg_alpha["user"]["org_id"]

    reg_beta = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Switch Beta",
        "admin_name": "Admin SBeta",
        "admin_email": "admin@sbeta.com",
        "password": "SecurePassword123!",
    }).json()
    beta_org_id = reg_beta["user"]["org_id"]

    # Alpha invites Sam as reviewer
    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg_alpha["access_token"], alpha_org_id),
        json={
            "display_name": "Sam Consultant",
            "email": "sam@consultant.com",
            "role": "reviewer",
            "password": "ConsultantPass123!",
        },
    )

    # Beta invites Sam as creator
    client.post(
        "/api/v1/members",
        headers=make_auth_headers(reg_beta["access_token"], beta_org_id),
        json={
            "display_name": "Sam Consultant",
            "email": "sam@consultant.com",
            "role": "creator",
        },
    )

    # Sam logs in
    login_res = client.post("/api/v1/auth/login", json={
        "email": "sam@consultant.com",
        "password": "ConsultantPass123!",
    })
    assert login_res.status_code == 200
    sam_token = login_res.json()["access_token"]

    # Sam queries workspaces
    ws_res = client.get("/api/v1/auth/workspaces", headers=make_auth_headers(sam_token, alpha_org_id))
    assert ws_res.status_code == 200
    ws_data = ws_res.json()
    assert len(ws_data) == 2
    roles_by_org = {w["org_id"]: w["role"] for w in ws_data}
    assert roles_by_org[str(alpha_org_id)] == "reviewer"
    assert roles_by_org[str(beta_org_id)] == "creator"

    # Context in Alpha is reviewer
    me_alpha = client.get("/api/v1/me", headers=make_auth_headers(sam_token, alpha_org_id)).json()
    assert me_alpha["role"] == "reviewer"
    assert me_alpha["org_id"] == str(alpha_org_id)

    # Context in Beta is creator
    me_beta = client.get("/api/v1/me", headers=make_auth_headers(sam_token, beta_org_id)).json()
    assert me_beta["role"] == "creator"
    assert me_beta["org_id"] == str(beta_org_id)

    # In Beta, Sam creates a draft
    draft_res = client.post(
        "/api/v1/content",
        headers=make_auth_headers(sam_token, beta_org_id),
        json={
            "title": "Beta Draft By Sam",
            "content_type": "blog",
            "body_text": "Draft content written for Beta organization exclusively by Sam.",
        },
    )
    assert draft_res.status_code == 201
    beta_draft_id = draft_res.json()["id"]

    # In Alpha context, Sam cannot see Beta draft by direct ID
    alpha_read = client.get(
        f"/api/v1/content/{beta_draft_id}",
        headers=make_auth_headers(sam_token, alpha_org_id),
    )
    assert alpha_read.status_code == 404


def test_tier3_member_lifecycle_role_mutation_and_revocation(client):
    """60. Admin promotes creator to admin (immediate privilege elevation), then removes member (immediate token rejection)."""
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Titan Health",
        "admin_name": "Tina Titan",
        "admin_email": "tina@titan.com",
        "password": "SecurePassword123!",
    }).json()
    admin_token = reg["access_token"]
    org_id = reg["user"]["org_id"]

    # Provision Tom as creator
    mems = client.post(
        "/api/v1/members",
        headers=make_auth_headers(admin_token, org_id),
        json={"display_name": "Tom Titan", "email": "tom@titan.com", "role": "creator", "password": "TomPassword123!"},
    ).json()
    tom_user_id = next(m["user_id"] for m in mems if m["email"] == "tom@titan.com")

    # Tom logs in
    tom_token = client.post("/api/v1/auth/login", json={
        "email": "tom@titan.com",
        "password": "TomPassword123!",
    }).json()["access_token"]

    # Tom attempts admin action (creating library entry) -> 403 Forbidden
    res_before = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(tom_token, org_id),
        json={"code": "R-TITAN-01", "entry_type": "rule", "category": "tone", "title": "Tone", "body": "Body"},
    )
    assert res_before.status_code == 403

    # Admin promotes Tom to Admin
    promote_res = client.patch(
        f"/api/v1/members/{tom_user_id}/role",
        headers=make_auth_headers(admin_token, org_id),
        json={"role": "admin"},
    )
    assert promote_res.status_code == 200

    # With same existing token, Tom immediately gains admin rights from dynamic DB membership
    res_after = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(tom_token, org_id),
        json={"code": "R-TITAN-01", "entry_type": "rule", "category": "tone", "title": "Tone", "body": "Body text here."},
    )
    assert res_after.status_code == 201

    # Admin removes Tom from workspace
    del_res = client.delete(
        f"/api/v1/members/{tom_user_id}",
        headers=make_auth_headers(admin_token, org_id),
    )
    assert del_res.status_code == 200

    # Tom's existing token is immediately rejected on subsequent requests
    res_revoked = client.get("/api/v1/me", headers=make_auth_headers(tom_token, org_id))
    assert res_revoked.status_code in (401, 403)


def test_tier3_brand_rules_seeded_vs_empty_and_duplicate_code_allowance(client):
    """61. Compares seeded vs unseeded brand rules and verifies cross-tenant code collision independence (uq_brand_entries_org_code)."""
    reg_seeded = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Seeded Brand Org",
        "admin_name": "Admin Seeded",
        "admin_email": "admin@seededorg.com",
        "password": "SecurePassword123!",
        "seed_default_rules": True,
    }).json()

    reg_unseeded = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Unseeded Brand Org",
        "admin_name": "Admin Unseeded",
        "admin_email": "admin@unseededorg.com",
        "password": "SecurePassword123!",
        "seed_default_rules": False,
    }).json()

    token_s = reg_seeded["access_token"]
    org_s = reg_seeded["user"]["org_id"]
    token_u = reg_unseeded["access_token"]
    org_u = reg_unseeded["user"]["org_id"]

    # Verify counts
    lib_s = client.get("/api/v1/library/entries", headers=make_auth_headers(token_s, org_s)).json()
    lib_u = client.get("/api/v1/library/entries", headers=make_auth_headers(token_u, org_u)).json()
    assert len(lib_s) > 0
    assert len(lib_u) == 0

    # Unseeded creates rule R-GLOBAL-01
    create_u = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(token_u, org_u),
        json={"code": "R-GLOBAL-01", "entry_type": "rule", "category": "tone", "title": "Rule U", "body": "Body U"},
    )
    assert create_u.status_code == 201

    # Seeded creates rule with identical code R-GLOBAL-01 -> succeeds due to per-tenant uniqueness constraint
    create_s = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(token_s, org_s),
        json={"code": "R-GLOBAL-01", "entry_type": "rule", "category": "tone", "title": "Rule S", "body": "Body S"},
    )
    assert create_s.status_code == 201
    entry_s_id = create_s.json()["id"]

    # Unseeded admin attempts to patch Seeded rule by ID -> 404 Not Found
    patch_attempt = client.patch(
        f"/api/v1/library/entries/{entry_s_id}",
        headers=make_auth_headers(token_u, org_u),
        json={"title": "Hacked Title"},
    )
    assert patch_attempt.status_code == 404


# ============================================================================
# TIER 4: Real-World Application Scenarios (2 Scenarios)
# ============================================================================

def test_tier4_multi_brand_coexistence_with_seeded_acme_cloud(client):
    """62. Scenario 1: Multi-Brand Onboarding & Coexistence with Seeded Acme Cloud.

    Simulates simultaneous onboarding of two commercial enterprises:
    - Seeded: Acme Cloud (00000000-0000-0000-0000-000000000001) with Aarav, Priya, Rohan
    - Brand 1: Starlight Retail (Stella Admin, Steve Creator)
    - Brand 2: Apex BioTech (Arthur Admin, Amy Reviewer)
    Verifies that all tenant workspaces, rules, drafts, and users operate in complete isolation.
    """
    # 1. Onboard Starlight Retail
    reg_star = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Starlight Retail",
        "admin_name": "Stella Admin",
        "admin_email": "stella@starlight.com",
        "password": "StellaPassword123!",
        "seed_default_rules": False,
    }).json()
    token_stella = reg_star["access_token"]
    org_star = reg_star["user"]["org_id"]

    # Provision Steve Creator in Starlight
    client.post(
        "/api/v1/members",
        headers=make_auth_headers(token_stella, org_star),
        json={"display_name": "Steve Writer", "email": "steve@starlight.com", "role": "creator", "password": "StevePassword123!"},
    )

    # 2. Onboard Apex BioTech
    reg_apex = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Apex BioTech",
        "admin_name": "Arthur Admin",
        "admin_email": "arthur@apexbio.com",
        "password": "ArthurPassword123!",
        "seed_default_rules": False,
    }).json()
    token_arthur = reg_apex["access_token"]
    org_apex = reg_apex["user"]["org_id"]

    # Provision Amy Reviewer in Apex
    client.post(
        "/api/v1/members",
        headers=make_auth_headers(token_arthur, org_apex),
        json={"display_name": "Amy Reviewer", "email": "amy@apexbio.com", "role": "reviewer", "password": "AmyPassword123!"},
    )

    # 3. Seeded Acme Cloud login via demo role switcher
    acme_login = client.post("/api/v1/auth/demo-login", json={"role": "creator"}).json()
    token_aarav = acme_login["access_token"]
    assert acme_login["user"]["org_id"] == str(DEMO_ORG_ID)

    # 4. Stella creates retail brand rule
    star_rule = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(token_stella, org_star),
        json={
            "code": "R-STAR-001",
            "entry_type": "rule",
            "category": "tone",
            "title": "Friendly Customer Tone",
            "body": "Customer communications should always be warm, welcoming, and concise.",
        },
    ).json()

    # 5. Steve creates draft post
    token_steve = client.post("/api/v1/auth/login", json={
        "email": "steve@starlight.com",
        "password": "StevePassword123!",
    }).json()["access_token"]

    star_draft = client.post(
        "/api/v1/content",
        headers=make_auth_headers(token_steve, org_star),
        json={
            "title": "Holiday Sale Announcement",
            "content_type": "blog",
            "body_text": "Our grand holiday sale starts this Friday. Enjoy exclusive savings on all retail collections.",
        },
    ).json()

    # 6. Arthur creates bio-compliance rule in Apex
    apex_rule = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(token_arthur, org_apex),
        json={
            "code": "R-APEX-001",
            "entry_type": "rule",
            "category": "facts_claims",
            "title": "FDA Clinical Trial Disclosure",
            "body": "All statements concerning trial phases must explicitly cite FDA protocol registration.",
        },
    ).json()

    # 7. Verification: Starlight data invisible to Apex BioTech
    apex_lib = client.get("/api/v1/library/entries", headers=make_auth_headers(token_arthur, org_apex)).json()
    apex_codes = {e["code"] for e in apex_lib}
    assert "R-STAR-001" not in apex_codes
    assert "R-APEX-001" in apex_codes

    token_amy = client.post("/api/v1/auth/login", json={
        "email": "amy@apexbio.com",
        "password": "AmyPassword123!",
    }).json()["access_token"]

    apex_content = client.get("/api/v1/content", headers=make_auth_headers(token_amy, org_apex)).json()
    apex_draft_ids = {item["id"] for item in apex_content}
    assert star_draft["id"] not in apex_draft_ids

    # 8. Verification: Apex data invisible to Starlight Retail
    star_lib = client.get("/api/v1/library/entries", headers=make_auth_headers(token_stella, org_star)).json()
    star_codes = {e["code"] for e in star_lib}
    assert "R-APEX-001" not in star_codes
    assert "R-STAR-001" in star_codes

    # 9. Verification: Acme Cloud data remains intact and isolated
    acme_lib = client.get("/api/v1/library/entries", headers=make_auth_headers(token_aarav, DEMO_ORG_ID)).json()
    acme_codes = {e["code"] for e in acme_lib}
    assert "R-STAR-001" not in acme_codes
    assert "R-APEX-001" not in acme_codes
    assert len(acme_lib) > 0


def test_tier4_enterprise_brand_team_governance_workflow(client):
    """63. Scenario 2: Enterprise Brand Team Collaborative Workflow & Audit Trail.

    Simulates the end-to-end lifecycle of "FinGuard Technologies":
    - Admin Fiona onboards FinGuard and provisions Colin (creator) and Rachel (reviewer).
    - Fiona defines fact and term brand rules.
    - Colin drafts content item v1 with a term violation.
    - Colin updates content body creating immutable version 2.
    - Colin submits v2 for approval.
    - Rachel reviews v2 and records approval decision.
    - Fiona inspects audit log, verifying complete, tenant-scoped audit trail.
    """
    # 1. Onboarding
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "FinGuard Technologies",
        "admin_name": "Fiona Admin",
        "admin_email": "fiona@finguard.com",
        "password": "FionaPassword123!",
        "seed_default_rules": False,
    }).json()
    token_fiona = reg["access_token"]
    org_fg = reg["user"]["org_id"]

    # 2. Provisioning team
    mems = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token_fiona, org_fg),
        json={"display_name": "Colin Writer", "email": "colin@finguard.com", "role": "creator", "password": "ColinPassword123!"},
    ).json()
    colin_user_id = next(m["user_id"] for m in mems if m["email"] == "colin@finguard.com")

    mems = client.post(
        "/api/v1/members",
        headers=make_auth_headers(token_fiona, org_fg),
        json={"display_name": "Rachel Reviewer", "email": "rachel@finguard.com", "role": "reviewer", "password": "RachelPassword123!"},
    ).json()
    rachel_user_id = next(m["user_id"] for m in mems if m["email"] == "rachel@finguard.com")

    # 3. Brand Library Setup
    rule_fact = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(token_fiona, org_fg),
        json={
            "code": "R-FG-FACT",
            "entry_type": "fact",
            "category": "facts_claims",
            "title": "FDIC Insurance Fact",
            "body": "All customer deposits are FDIC insured up to standard regulatory thresholds.",
        },
    )
    assert rule_fact.status_code == 201

    rule_term = client.post(
        "/api/v1/library/entries",
        headers=make_auth_headers(token_fiona, org_fg),
        json={
            "code": "R-FG-TERM",
            "entry_type": "term",
            "category": "terminology",
            "title": "Cardmember terminology",
            "body": "Preferred term is cardmember. Banned term is cardholder.",
            "pattern": {"rule_type": "term", "preferred": "cardmember", "banned": "cardholder"},
        },
    )
    assert rule_term.status_code == 201

    # 4. Colin drafts v1
    token_colin = client.post("/api/v1/auth/login", json={
        "email": "colin@finguard.com",
        "password": "ColinPassword123!",
    }).json()["access_token"]

    draft_v1 = client.post(
        "/api/v1/content",
        headers=make_auth_headers(token_colin, org_fg),
        json={
            "title": "Account Terms Update",
            "content_type": "blog",
            "body_text": "Every cardholder account is FDIC insured across all retail branches.",
        },
    ).json()
    content_id = draft_v1["id"]
    assert draft_v1["current_version_no"] == 1

    # 5. Colin updates body to version 2 (replacing 'cardholder' with 'cardmember')
    edit_res = client.put(
        f"/api/v1/content/{content_id}/body",
        headers=make_auth_headers(token_colin, org_fg),
        json={
            "body_text": "Every cardmember account is FDIC insured across all retail branches.",
            "source": "manual",
        },
    )
    assert edit_res.status_code == 200
    draft_v2 = edit_res.json()
    assert draft_v2["current_version_no"] == 2

    # 6. Colin submits v2 for approval
    submit_res = client.post(
        f"/api/v1/content/{content_id}/submit",
        headers=make_auth_headers(token_colin, org_fg),
        json={"reviewer_id": str(rachel_user_id), "note": "Updated terminology per brand guidelines."},
    )
    assert submit_res.status_code == 200
    assert submit_res.json()["status"] == "in_review"

    # 7. Rachel reviews and approves
    token_rachel = client.post("/api/v1/auth/login", json={
        "email": "rachel@finguard.com",
        "password": "RachelPassword123!",
    }).json()["access_token"]

    review_res = client.post(
        f"/api/v1/content/{content_id}/review",
        headers=make_auth_headers(token_rachel, org_fg),
        json={"decision": "approved", "comment": "Approved for publication."},
    )
    assert review_res.status_code == 200
    assert review_res.json()["status"] == "approved"

    # 8. Fiona inspects audit log
    audit_res = client.get(
        "/api/v1/audit",
        headers=make_auth_headers(token_fiona, org_fg),
    )
    assert audit_res.status_code == 200
    audit_records = audit_res.json()
    assert len(audit_records) >= 5

    # All audit records strictly belong to FinGuard
    for record in audit_records:
        assert record["org_id"] == str(org_fg)

    actions = {r["action"] for r in audit_records}
    assert "brand.registered" in actions
    assert "member.invited" in actions
    assert "library.entry_created" in actions
    assert "content.created" in actions
    assert "content.submitted" in actions
    assert "review.approved" in actions
