"""Backend Multi-Tenancy & Offline Authentication Integration Tests.

Validates Milestone 1 acceptance criteria:
- F1: Multi-Tenant Brand Self-Registration (seed rules, admin membership, JWT minting)
- F2: Seeded Acme Cloud Preservation (default demo workspace, accounts, and rules intact)
- F3: Offline Cryptographic Security (scrypt hashing, verify, local HS256 JWT)
- F4: Offline Login & Session Management (email/pwd login, 401 on invalid, logout)
- F5: Per-Brand User Credential Provisioning (admin adds user with password, user can log in)
- F6: Multi-Tenant Workspace Resolution (GET /auth/workspaces, X-Org-Id header switching)
- F7: Cross-Tenant Data Isolation (brand rules and data strictly scoped by org_id, 403 on foreign org)
"""

import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import models as m
from app.auth import DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_USERS
from app.db import get_db
from app.main import create_app
from app.security import decode_access_token, hash_password, verify_password
from app.seed_loader import auto_seed_if_needed


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    # Prime database with demo seed
    auto_seed_if_needed(session=db)
    return TestClient(app)


def test_brand_registration_with_seed_rules(client, db):
    """F1: New brand self-registration creates organization, admin profile, admin membership, and seeds rules."""
    payload = {
        "brand_name": "Starlight Corp",
        "admin_name": "Alice Admin",
        "admin_email": "alice@starlight.io",
        "password": "StrongPassword123!",
        "seed_default_rules": True,
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    user = data["user"]
    assert user["email"] == "alice@starlight.io"
    assert user["display_name"] == "Alice Admin"
    assert user["role"] == "admin"
    assert user["org_name"] == "Starlight Corp"
    org_id = uuid.UUID(user["org_id"])

    # Token payload verification
    decoded = decode_access_token(data["access_token"])
    assert decoded is not None
    assert decoded["sub"] == user["id"]
    assert decoded["email"] == "alice@starlight.io"
    assert decoded["org_id"] == str(org_id)
    assert decoded["role"] == "admin"

    # Database state verification
    org = db.get(m.Organization, org_id)
    assert org is not None
    assert org.name == "Starlight Corp"

    prof = db.get(m.Profile, uuid.UUID(user["id"]))
    assert prof is not None
    assert prof.email == "alice@starlight.io"
    assert prof.password_hash is not None
    assert verify_password("StrongPassword123!", prof.password_hash) is True

    # Seeded rules verification for the new organization
    entry_count = db.scalar(
        select(func.count(m.BrandEntry.id)).where(m.BrandEntry.org_id == org_id)
    )
    assert entry_count > 0

    # User can list library entries with their minted token
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    entries_res = client.get("/api/v1/library/entries", headers=headers)
    assert entries_res.status_code == 200
    entries = entries_res.json()
    assert len(entries) == entry_count


def test_brand_registration_without_seed_rules(client, db):
    """F1: Self-registration with seed_default_rules=False creates an empty library."""
    payload = {
        "brand_name": "Clean Slate Tech",
        "admin_name": "Bob Admin",
        "admin_email": "bob@cleanslate.io",
        "password": "PasswordBob456!",
        "seed_default_rules": False,
    }
    res = client.post("/api/v1/auth/register-brand", json=payload)
    assert res.status_code == 201
    user = res.json()["user"]
    org_id = uuid.UUID(user["org_id"])

    entry_count = db.scalar(
        select(func.count(m.BrandEntry.id)).where(m.BrandEntry.org_id == org_id)
    )
    assert entry_count == 0


def test_brand_registration_duplicate_email(client):
    """F1: Registering with an existing email returns HTTP 409 Conflict."""
    payload = {
        "brand_name": "Brand Alpha",
        "admin_name": "Admin One",
        "admin_email": "duplicate@test.io",
        "password": "SecretPassword123!",
    }
    res1 = client.post("/api/v1/auth/register-brand", json=payload)
    assert res1.status_code == 201

    payload2 = {
        "brand_name": "Brand Beta",
        "admin_name": "Admin Two",
        "admin_email": "duplicate@test.io",
        "password": "AnotherPassword456!",
    }
    res2 = client.post("/api/v1/auth/register-brand", json=payload2)
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"].lower()


def test_brand_registration_validation(client):
    """F1: Registration validation checks required fields and password length."""
    # Blank brand name
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "   ",
        "admin_name": "Alice",
        "admin_email": "alice@valid.io",
        "password": "validpassword",
    })
    assert res.status_code == 400

    # Invalid email
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Valid Brand",
        "admin_name": "Alice",
        "admin_email": "not-an-email",
        "password": "validpassword",
    })
    assert res.status_code == 400

    # Short password
    res = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Valid Brand",
        "admin_name": "Alice",
        "admin_email": "alice@valid.io",
        "password": "123",
    })
    assert res.status_code == 400


def test_acme_cloud_preservation(client, db):
    """F2: Seeded Acme Cloud workspace and demo users remain present and functional."""
    acme_org = db.get(m.Organization, DEMO_ORG_ID)
    assert acme_org is not None
    assert acme_org.name == DEMO_ORG_NAME

    # Demo accounts exist
    for role, demo_data in DEMO_USERS.items():
        prof = db.get(m.Profile, demo_data["id"])
        assert prof is not None
        assert prof.email == demo_data["email"]

    # Demo login operates seamlessly
    res = client.post("/api/v1/auth/demo-login", json={"role": "reviewer"})
    assert res.status_code == 200
    data = res.json()
    assert data["access_token"] == "demo-reviewer-token"
    assert data["user"]["role"] == "reviewer"

    # Context resolution succeeds with demo token
    me_res = client.get("/api/v1/me", headers={"Authorization": "Bearer demo-reviewer-token"})
    assert me_res.status_code == 200
    assert me_res.json()["org_id"] == str(DEMO_ORG_ID)


def test_offline_login_flow(client):
    """F4: Offline local authentication via email and password."""
    # Register brand first
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Solaris Innovations",
        "admin_name": "Sam Admin",
        "admin_email": "sam@solaris.io",
        "password": "SolarisPassword2026!",
    })
    assert reg.status_code == 201

    # Successful login
    login_res = client.post("/api/v1/auth/login", json={
        "email": "sam@solaris.io",
        "password": "SolarisPassword2026!",
    })
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert "access_token" in login_data
    assert login_data["user"]["email"] == "sam@solaris.io"
    assert login_data["user"]["org_name"] == "Solaris Innovations"

    # Authenticate /me with new token
    me_res = client.get("/api/v1/me", headers={"Authorization": f"Bearer {login_data['access_token']}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "sam@solaris.io"

    # Failed login: wrong password
    bad_pw = client.post("/api/v1/auth/login", json={
        "email": "sam@solaris.io",
        "password": "IncorrectPassword!",
    })
    assert bad_pw.status_code == 401
    assert "Invalid email or password" in bad_pw.json()["detail"]

    # Failed login: non-existent email
    bad_email = client.post("/api/v1/auth/login", json={
        "email": "nobody@nowhere.io",
        "password": "AnyPassword123!",
    })
    assert bad_email.status_code == 401


def test_logout_endpoint(client):
    """F4: Logout endpoint returns successful confirmation."""
    res = client.post("/api/v1/auth/logout")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "message": "Logged out successfully"}


def test_workspaces_listing(client, db):
    """F6: GET /auth/workspaces returns all organizations for the authenticated user."""
    # Register user in Org 1
    reg1 = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Primary Workspace",
        "admin_name": "Multi User",
        "admin_email": "multi@example.io",
        "password": "PasswordMulti123!",
    })
    token = reg1.json()["access_token"]
    user_id = uuid.UUID(reg1.json()["user"]["id"])
    org1_id = reg1.json()["user"]["org_id"]

    # List workspaces
    ws_res1 = client.get("/api/v1/auth/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert ws_res1.status_code == 200
    workspaces = ws_res1.json()
    assert len(workspaces) == 1
    assert workspaces[0]["org_id"] == org1_id
    assert workspaces[0]["org_name"] == "Primary Workspace"
    assert workspaces[0]["role"] == "admin"

    # Add user to a second organization in DB
    org2 = m.Organization(id=uuid.uuid4(), name="Secondary Workspace", library_version=1)
    db.add(org2)
    db.flush()
    mem2 = m.Membership(id=uuid.uuid4(), org_id=org2.id, user_id=user_id, role="reviewer")
    db.add(mem2)
    db.commit()

    # List workspaces again
    ws_res2 = client.get("/api/v1/auth/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert ws_res2.status_code == 200
    workspaces2 = ws_res2.json()
    assert len(workspaces2) == 2
    org_ids = [w["org_id"] for w in workspaces2]
    assert org1_id in org_ids
    assert str(org2.id) in org_ids


def test_member_provisioning_with_password_and_login(client):
    """F5: Admin provisions new member with initial password; new member can authenticate offline."""
    # Register brand admin
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Apex Creative",
        "admin_name": "Apex Admin",
        "admin_email": "admin@apexcreative.io",
        "password": "AdminPassword123!",
    })
    admin_token = reg.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Admin adds new member with password
    add_res = client.post(
        "/api/v1/members",
        headers=admin_headers,
        json={
            "display_name": "David Designer",
            "email": "david@apexcreative.io",
            "role": "creator",
            "password": "DavidInitialPassword789!",
        },
    )
    assert add_res.status_code == 201
    members = add_res.json()
    assert any(m["email"] == "david@apexcreative.io" for m in members)

    # New member logs in via offline auth
    member_login = client.post("/api/v1/auth/login", json={
        "email": "david@apexcreative.io",
        "password": "DavidInitialPassword789!",
    })
    assert member_login.status_code == 200
    member_data = member_login.json()
    assert member_data["user"]["role"] == "creator"
    assert member_data["user"]["display_name"] == "David Designer"

    # Member can access /me with their token
    member_token = member_data["access_token"]
    me_res = client.get("/api/v1/me", headers={"Authorization": f"Bearer {member_token}"})
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "creator"
    assert me_res.json()["email"] == "david@apexcreative.io"


def test_cross_tenant_data_isolation(client, db):
    """F7: Strict data isolation prevents users from accessing or modifying other brands' data."""
    # 1. Register Brand A (Alpha)
    reg_a = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Alpha Brands",
        "admin_name": "Alice Alpha",
        "admin_email": "alice@alpha.io",
        "password": "AlphaPassword123!",
        "seed_default_rules": False,
    })
    token_a = reg_a.json()["access_token"]
    org_a_id = reg_a.json()["user"]["org_id"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # 2. Register Brand B (Beta)
    reg_b = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Beta Brands",
        "admin_name": "Bob Beta",
        "admin_email": "bob@beta.io",
        "password": "BetaPassword123!",
        "seed_default_rules": False,
    })
    token_b = reg_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 3. Alpha creates a proprietary brand rule
    create_res = client.post(
        "/api/v1/library/entries",
        headers=headers_a,
        json={
            "code": "R-ALPHA-SECRET",
            "entry_type": "rule",
            "category": "tone",
            "title": "Alpha Confidential Tone",
            "body": "Always speak with supreme confidential authority.",
            "check_mode": "deterministic",
        },
    )
    assert create_res.status_code == 201
    alpha_rule_id = create_res.json()["id"]

    # 4. Beta lists library entries -> Alpha's secret rule MUST NOT appear
    beta_entries = client.get("/api/v1/library/entries", headers=headers_b)
    assert beta_entries.status_code == 200
    assert not any(e["code"] == "R-ALPHA-SECRET" for e in beta_entries.json())

    # 5. Beta attempts to access Brand A directly via X-Org-Id header -> 403 Forbidden
    spoof_headers = {"Authorization": f"Bearer {token_b}", "X-Org-Id": org_a_id}
    spoof_res = client.get("/api/v1/library/entries", headers=spoof_headers)
    assert spoof_res.status_code == 403
    assert "You do not belong to that organisation" in spoof_res.json()["detail"]


def test_tenant_header_switching(client, db):
    """F6: User belonging to multiple organizations can switch context via X-Org-Id header."""
    # Create Org A and Org B
    reg = client.post("/api/v1/auth/register-brand", json={
        "brand_name": "Workspace One",
        "admin_name": "Switch User",
        "admin_email": "switcher@test.io",
        "password": "PasswordSwitch123!",
    })
    token = reg.json()["access_token"]
    user_id = uuid.UUID(reg.json()["user"]["id"])
    org1_id = reg.json()["user"]["org_id"]

    # Add to Org 2 as reviewer
    org2 = m.Organization(id=uuid.uuid4(), name="Workspace Two", library_version=1)
    db.add(org2)
    db.flush()
    mem2 = m.Membership(id=uuid.uuid4(), org_id=org2.id, user_id=user_id, role="reviewer")
    db.add(mem2)
    db.commit()

    # Context with X-Org-Id = Org 1
    h1 = {"Authorization": f"Bearer {token}", "X-Org-Id": org1_id}
    r1 = client.get("/api/v1/me", headers=h1)
    assert r1.status_code == 200
    assert r1.json()["org_id"] == org1_id
    assert r1.json()["role"] == "admin"

    # Context with X-Org-Id = Org 2
    h2 = {"Authorization": f"Bearer {token}", "X-Org-Id": str(org2.id)}
    r2 = client.get("/api/v1/me", headers=h2)
    assert r2.status_code == 200
    assert r2.json()["org_id"] == str(org2.id)
    assert r2.json()["role"] == "reviewer"

    # Unauthorized org
    random_org = str(uuid.uuid4())
    h_bad = {"Authorization": f"Bearer {token}", "X-Org-Id": random_org}
    assert client.get("/api/v1/me", headers=h_bad).status_code == 403

    # Malformed org UUID
    h_invalid = {"Authorization": f"Bearer {token}", "X-Org-Id": "not-a-valid-uuid"}
    assert client.get("/api/v1/me", headers=h_invalid).status_code == 400
