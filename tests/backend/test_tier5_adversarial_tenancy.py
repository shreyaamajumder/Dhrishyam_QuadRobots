"""Tier 5 Adversarial Tenancy, Security & Concurrency Test Suite.

Initiated by Challenger 2 for Milestone 3 Phase 2 (Tier 5 Hardening).
Validates multi-tenant boundary integrity, anti-hijacking defenses,
concurrency race resilience, Acme Cloud preservation under hostile stress,
and rule namespace collision independence.
"""

from __future__ import annotations

import concurrent.futures
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.auth import DEMO_ORG_ID, DEMO_USERS
from app.db import get_db
from app.main import create_app
from app.models import (
    AuditLog,
    BrandEntry,
    BrandEntryVersion,
    ContentItem,
    ContentVersion,
    Membership,
    Organization,
    Profile,
)
from app.security import create_access_token
from app.seed_loader import auto_seed_if_needed


# ============================================================================
# Fixtures & Test Helpers
# ============================================================================

@pytest.fixture
def client(db):
    """Savepoint-isolated TestClient ensuring clean rollback."""
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    auto_seed_if_needed(session=db)
    return TestClient(app)


def register_brand(
    client: TestClient,
    brand_name: str,
    admin_name: str,
    admin_email: str,
    password: str = "SecurePass123!",
    seed_rules: bool = True,
) -> dict[str, Any]:
    """Helper to self-register a brand and return the auth token response."""
    res = client.post(
        "/api/v1/auth/register-brand",
        json={
            "brand_name": brand_name,
            "admin_name": admin_name,
            "admin_email": admin_email,
            "password": password,
            "seed_default_rules": seed_rules,
        },
    )
    assert res.status_code == 201, f"Brand registration failed: {res.text}"
    return res.json()


def auth_headers(token: str, org_id: str | UUID | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if org_id is not None:
        headers["X-Org-Id"] = str(org_id)
    return headers


# ============================================================================
# Group 1: Cross-Tenant Resource Hijacking & Parameter Tampering Probes
# ============================================================================

def test_tier5_cross_tenant_library_entry_read_hijack_blocked(client):
    """Adversary in Brand B cannot read private brand rules of Brand A by entry_id."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    # Brand A creates a proprietary confidential rule
    create_res = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_a),
        json={
            "code": "R-ALPHA-SECRET",
            "entry_type": "rule",
            "category": "tone",
            "title": "Alpha Secret Tone Directive",
            "body": "Do not disclose unreleased platform features.",
        },
    )
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    # Brand B attempts to read Brand A's rule directly
    tamper_res = client.get(
        f"/api/v1/library/entries/{entry_id}",
        headers=auth_headers(token_b),
    )
    assert tamper_res.status_code == 404, "Brand B must NOT read Brand A rule"


def test_tier5_cross_tenant_library_entry_patch_tampering_blocked(client, db):
    """Adversary in Brand B cannot alter or deactivate rules belonging to Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-patch.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-patch.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    create_res = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_a),
        json={
            "code": "R-INTEGRITY-001",
            "entry_type": "rule",
            "category": "tone",
            "title": "Critical Compliance Directive",
            "body": "Must enforce full regulatory disclosures.",
        },
    )
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    # Brand B attempts hostile modification
    patch_res = client.patch(
        f"/api/v1/library/entries/{entry_id}",
        headers=auth_headers(token_b),
        json={"title": "HACKED TITLE", "is_active": False},
    )
    assert patch_res.status_code == 404, "Brand B must NOT update Brand A rule"

    # Verify DB state in Brand A remains intact
    entry = db.get(BrandEntry, UUID(entry_id))
    assert entry.title == "Critical Compliance Directive"
    assert entry.is_active is True


def test_tier5_cross_tenant_library_entry_versions_leak_blocked(client):
    """Adversary in Brand B cannot inspect version history snapshots of Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-ver.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-ver.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    create_res = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_a),
        json={
            "code": "R-CONFIDENTIAL-01",
            "entry_type": "rule",
            "category": "messaging",
            "title": "Version History Target",
            "body": "Internal guidelines v1.",
        },
    )
    entry_id = create_res.json()["id"]

    # Brand B attempts to fetch versions
    ver_res = client.get(
        f"/api/v1/library/entries/{entry_id}/versions",
        headers=auth_headers(token_b),
    )
    assert ver_res.status_code == 404


def test_tier5_cross_tenant_library_create_org_id_tampering_ignored(client, db):
    """Injecting a foreign target org_id into POST /library/entries does NOT contaminate foreign org."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-inject.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-inject.io", seed_rules=False)

    org_a_id = data_a["user"]["org_id"]
    org_b_id = data_b["user"]["org_id"]
    token_b = data_b["access_token"]

    # Brand B sends create request attempting to place rule inside Brand A
    create_res = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_b),
        json={
            "org_id": org_a_id,
            "code": "R-INJECT-001",
            "entry_type": "rule",
            "category": "tone",
            "title": "Injected Rule Attempt",
            "body": "Attempted cross-tenant contamination.",
        },
    )
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    # Verify rule was assigned to Brand B, NEVER Brand A
    entry = db.get(BrandEntry, UUID(entry_id))
    assert str(entry.org_id) == org_b_id
    assert str(entry.org_id) != org_a_id


def test_tier5_cross_tenant_content_mutation_and_deletion_blocked(client):
    """Adversary in Brand B cannot read, edit, clone, or delete drafts of Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-doc.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-doc.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    # Brand A creates a confidential draft
    doc_res = client.post(
        "/api/v1/content",
        headers=auth_headers(token_a),
        json={"title": "Q4 Secret Strategy", "content_type": "blog", "body_text": "Confidential corporate announcement."},
    )
    assert doc_res.status_code == 201
    doc_id = doc_res.json()["id"]

    # Brand B attempts all mutation vectors
    assert client.get(f"/api/v1/content/{doc_id}", headers=auth_headers(token_b)).status_code == 404
    assert client.put(f"/api/v1/content/{doc_id}/body", headers=auth_headers(token_b), json={"body_text": "Hostile text rewrite"}).status_code == 404
    assert client.post(f"/api/v1/content/{doc_id}/duplicate", headers=auth_headers(token_b)).status_code == 404
    assert client.delete(f"/api/v1/content/{doc_id}", headers=auth_headers(token_b)).status_code == 404


def test_tier5_cross_tenant_check_run_and_findings_leak_blocked(client):
    """Adversary in Brand B cannot inspect check runs or findings of Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-chk.io", seed_rules=True)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-chk.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    doc_res = client.post(
        "/api/v1/content",
        headers=auth_headers(token_a),
        json={"title": "Draft for Brand Check", "content_type": "blog", "body_text": "We offer best in class synergy."},
    )
    doc_id = doc_res.json()["id"]

    chk_res = client.post(f"/api/v1/content/{doc_id}/checks", headers=auth_headers(token_a))
    assert chk_res.status_code == 202
    run_id = chk_res.json()["check_run_id"]

    # Brand B attempts to inspect check run and steps
    assert client.get(f"/api/v1/checks/{run_id}", headers=auth_headers(token_b)).status_code == 404
    assert client.get(f"/api/v1/checks/{run_id}/steps", headers=auth_headers(token_b)).status_code == 404
    assert client.get(f"/api/v1/content/{doc_id}/findings", headers=auth_headers(token_b)).status_code == 404


def test_tier5_cross_tenant_review_workflow_and_queue_isolation(client):
    """Reviewers in Brand B cannot see or approve submissions belonging to Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-rev.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-rev.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    # Create and submit draft in Brand A
    doc_res = client.post(
        "/api/v1/content",
        headers=auth_headers(token_a),
        json={"title": "Alpha Submission", "content_type": "blog", "body_text": "Draft awaiting review."},
    )
    doc_id = doc_res.json()["id"]
    sub_res = client.post(f"/api/v1/content/{doc_id}/submit", headers=auth_headers(token_a), json={})
    assert sub_res.status_code == 200

    # Brand B reviewer checks queue and attempts review
    queue_res = client.get("/api/v1/review-queue", headers=auth_headers(token_b))
    assert queue_res.status_code == 200
    queue_ids = [item["id"] for item in queue_res.json()]
    assert doc_id not in queue_ids, "Brand A submission must not leak into Brand B review queue"

    rev_res = client.post(
        f"/api/v1/content/{doc_id}/review",
        headers=auth_headers(token_b),
        json={"decision": "approved"},
    )
    assert rev_res.status_code == 404


def test_tier5_cross_tenant_audit_log_isolation(client):
    """Admin in Brand B cannot view audit events generated by Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-audit.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-audit.io", seed_rules=False)

    org_a_id = data_a["user"]["org_id"]
    token_b = data_b["access_token"]

    audit_res = client.get("/api/v1/audit", headers=auth_headers(token_b))
    assert audit_res.status_code == 200
    events = audit_res.json()
    for ev in events:
        assert ev["org_id"] != org_a_id, "Brand A audit events must not be visible to Brand B"


def test_tier5_cross_tenant_member_mutation_and_deletion_blocked(client):
    """Admin B cannot alter roles or remove team members belonging to Brand A."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-mbr.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-mbr.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    # Provision user in Brand A
    add_res = client.post(
        "/api/v1/members",
        headers=auth_headers(token_a),
        json={"display_name": "Target Member", "email": "target@alpha-mbr.io", "role": "creator"},
    )
    assert add_res.status_code == 201
    member = [m for m in add_res.json() if m["email"] == "target@alpha-mbr.io"][0]
    target_user_id = member["id"]

    # Brand B attempts to modify role or delete
    patch_res = client.patch(
        f"/api/v1/members/{target_user_id}/role",
        headers=auth_headers(token_b),
        json={"role": "admin"},
    )
    assert patch_res.status_code == 404

    del_res = client.delete(
        f"/api/v1/members/{target_user_id}",
        headers=auth_headers(token_b),
    )
    assert del_res.status_code == 404


# ============================================================================
# Group 2: Header Spoofing & Token-Header Desynchronization
# ============================================================================

def test_tier5_spoofed_x_org_id_with_valid_token_forbidden(client):
    """Sending a foreign X-Org-Id with a valid token returns 403 Forbidden."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-hdr.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-hdr.io", seed_rules=False)

    token_a = data_a["access_token"]
    org_b_id = data_b["user"]["org_id"]

    res = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token_a}", "X-Org-Id": org_b_id})
    assert res.status_code == 403
    assert "You do not belong to that organisation" in res.json()["detail"]


def test_tier5_spoofed_acme_cloud_x_org_id_forbidden(client):
    """Brand admin attempting to access Acme Cloud via X-Org-Id spoofing receives 403."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-acme.io", seed_rules=False)
    token_a = data_a["access_token"]

    res = client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {token_a}", "X-Org-Id": str(DEMO_ORG_ID)},
    )
    assert res.status_code == 403
    assert "You do not belong to that organisation" in res.json()["detail"]


def test_tier5_malformed_and_injection_x_org_id_rejected(client):
    """Malformed or SQL injection X-Org-Id header is cleanly rejected with 400 Bad Request."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-sqli.io", seed_rules=False)
    token_a = data_a["access_token"]

    # Non-UUID string
    res1 = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token_a}", "X-Org-Id": "invalid-uuid"})
    assert res1.status_code == 400
    assert "X-Org-Id must be a UUID" in res1.json()["detail"]

    # SQL Injection payload
    res2 = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token_a}", "X-Org-Id": "' OR 1=1 --"})
    assert res2.status_code == 400
    assert "X-Org-Id must be a UUID" in res2.json()["detail"]


def test_tier5_demo_header_ignored_when_bearer_token_provided(client):
    """Sending X-Demo-Role: admin alongside a Bearer token evaluates authenticated user, NOT demo admin."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-demo-hdr.io", seed_rules=False)
    token_a = data_a["access_token"]
    org_a_id = data_a["user"]["org_id"]

    res = client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {token_a}", "X-Demo-Role": "admin"},
    )
    assert res.status_code == 200
    me = res.json()
    assert me["email"] == "admin@alpha-demo-hdr.io"
    assert me["org_id"] == org_a_id
    assert me["org_id"] != str(DEMO_ORG_ID)


def test_tier5_multi_tenant_user_header_resolution(client):
    """Multi-org member resolves context cleanly via X-Org-Id header, and 400 when missing."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-multi.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-multi.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]
    org_a_id = data_a["user"]["org_id"]
    org_b_id = data_b["user"]["org_id"]

    # Invite same user into Brand A and Brand B
    shared_email = "collab-user@enterprise.io"
    client.post(
        "/api/v1/members",
        headers=auth_headers(token_a),
        json={"display_name": "Collab User", "email": shared_email, "role": "creator", "password": "UserPass123!"},
    )
    client.post(
        "/api/v1/members",
        headers=auth_headers(token_b),
        json={"display_name": "Collab User", "email": shared_email, "role": "reviewer", "password": "UserPass123!"},
    )

    # User logs in
    login_res = client.post("/api/v1/auth/login", json={"email": shared_email, "password": "UserPass123!"})
    assert login_res.status_code == 200
    token_user = login_res.json()["access_token"]

    # Mint a bare token without org_id claim to simulate header-dependent resolution
    bare_token = create_access_token({"sub": login_res.json()["user"]["id"], "email": shared_email})

    # Missing X-Org-Id header on bare token raises 400 Bad Request
    no_hdr_res = client.get("/api/v1/me", headers={"Authorization": f"Bearer {bare_token}"})
    assert no_hdr_res.status_code == 400
    assert "send an X-Org-Id header" in no_hdr_res.json()["detail"]

    # Explicit X-Org-Id selects Brand A
    hdr_a_res = client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {bare_token}", "X-Org-Id": org_a_id},
    )
    assert hdr_a_res.status_code == 200
    assert hdr_a_res.json()["org_id"] == org_a_id
    assert hdr_a_res.json()["role"] == "creator"

    # Explicit X-Org-Id selects Brand B
    hdr_b_res = client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {bare_token}", "X-Org-Id": org_b_id},
    )
    assert hdr_b_res.status_code == 200
    assert hdr_b_res.json()["org_id"] == org_b_id
    assert hdr_b_res.json()["role"] == "reviewer"


# ============================================================================
# Group 3: Concurrency & Race Conditions
# ============================================================================

def test_tier5_concurrent_brand_registration_duplicate_email(client, db):
    """Concurrent brand registrations with the same admin email safely resolve: 1 created, 1 conflict."""
    clash_email = "clash_admin@adversary.com"
    payload = {
        "brand_name": "Clash Brand",
        "admin_name": "Clash Admin",
        "admin_email": clash_email,
        "password": "Password123!",
        "seed_default_rules": False,
    }

    # Simulate rapid consecutive or parallel requests
    res1 = client.post("/api/v1/auth/register-brand", json=payload)
    res2 = client.post("/api/v1/auth/register-brand", json=payload)

    statuses = [res1.status_code, res2.status_code]
    assert 201 in statuses, "At least one registration must succeed"
    assert 409 in statuses, "The duplicate registration must return 409 Conflict"

    # Verify exactly one profile in database
    profiles = db.execute(select(Profile).where(Profile.email == clash_email)).scalars().all()
    assert len(profiles) == 1


def test_tier5_concurrent_member_invite_across_orgs(client, db):
    """Concurrent invitations of an identical email across multiple brands succeed cleanly."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-concur.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-concur.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]
    shared_email = "shared_talent@marketplace.io"

    # Invite concurrently into Brand A and Brand B
    res_a = client.post(
        "/api/v1/members",
        headers=auth_headers(token_a),
        json={"display_name": "Shared Talent", "email": shared_email, "role": "creator", "password": "TalentPass123!"},
    )
    res_b = client.post(
        "/api/v1/members",
        headers=auth_headers(token_b),
        json={"display_name": "Shared Talent", "email": shared_email, "role": "reviewer", "password": "TalentPass123!"},
    )

    assert res_a.status_code == 201
    assert res_b.status_code == 201

    # Verify 1 Profile and 2 Memberships in DB
    prof = db.execute(select(Profile).where(Profile.email == shared_email)).scalar_one_or_none()
    assert prof is not None

    mems = db.execute(select(Membership).where(Membership.user_id == prof.id)).scalars().all()
    assert len(mems) == 2


def test_tier5_last_admin_cannot_self_remove_or_demote_when_solo(client):
    """Last admin in an organization cannot remove self or demote self to creator."""
    data = register_brand(client, "Solo Org", "Solo Admin", "admin@solo.io", seed_rules=False)
    token = data["access_token"]
    admin_id = data["user"]["id"]

    # 1. Attempt self-removal
    del_res = client.delete(f"/api/v1/members/{admin_id}", headers=auth_headers(token))
    assert del_res.status_code == 422
    assert "cannot remove your own admin account" in del_res.json()["detail"]

    # 2. Attempt self-demotion
    patch_res = client.patch(
        f"/api/v1/members/{admin_id}/role",
        headers=auth_headers(token),
        json={"role": "creator"},
    )
    assert patch_res.status_code == 422
    assert "Cannot remove the last Admin" in patch_res.json()["detail"]


def test_tier5_concurrent_last_admin_demotion_race_prevented(client, db):
    """Organization with two admins cannot end up with 0 admins under demotion attempts."""
    data = register_brand(client, "Dual Org", "Admin One", "admin1@dual.io", seed_rules=False)
    token1 = data["access_token"]
    admin1_id = data["user"]["id"]

    # Add second admin
    add_res = client.post(
        "/api/v1/members",
        headers=auth_headers(token1),
        json={"display_name": "Admin Two", "email": "admin2@dual.io", "role": "admin", "password": "Admin2Pass123!"},
    )
    assert add_res.status_code == 201
    member2 = [m for m in add_res.json() if m["email"] == "admin2@dual.io"][0]
    admin2_id = member2["id"]

    # Demote Admin 1 -> creator (succeeds because Admin 2 is present)
    demote1 = client.patch(
        f"/api/v1/members/{admin1_id}/role",
        headers=auth_headers(token1),
        json={"role": "creator"},
    )
    assert demote1.status_code == 200

    # Log in as Admin 2 to obtain token
    login2 = client.post("/api/v1/auth/login", json={"email": "admin2@dual.io", "password": "Admin2Pass123!"})
    token2 = login2.json()["access_token"]

    # Demote Admin 2 -> creator (MUST fail with 422 because Admin 2 is now the sole admin)
    demote2 = client.patch(
        f"/api/v1/members/{admin2_id}/role",
        headers=auth_headers(token2),
        json={"role": "creator"},
    )
    assert demote2.status_code == 422
    assert "Cannot remove the last Admin" in demote2.json()["detail"]

    # Organization still has exactly 1 admin in DB
    admins = db.execute(
        select(Membership).where(
            Membership.org_id == UUID(data["user"]["org_id"]),
            Membership.role == "admin",
        )
    ).scalars().all()
    assert len(admins) == 1
    assert str(admins[0].user_id) == admin2_id


# ============================================================================
# Group 4: Seeded Acme Cloud Preservation Under Stress
# ============================================================================

def test_tier5_acme_cloud_rules_cannot_be_modified_or_deactivated_by_foreign_brand(client, db):
    """Brand admin cannot deactivate or alter Acme Cloud demo rules."""
    data = register_brand(client, "Rogue Brand", "Rogue Admin", "admin@rogue.io", seed_rules=False)
    token_rogue = data["access_token"]

    # Retrieve an Acme Cloud rule
    acme_rule = db.execute(
        select(BrandEntry).where(BrandEntry.org_id == DEMO_ORG_ID).limit(1)
    ).scalar_one_or_none()
    assert acme_rule is not None

    patch_res = client.patch(
        f"/api/v1/library/entries/{acme_rule.id}",
        headers=auth_headers(token_rogue),
        json={"is_active": False, "title": "Defaced Rule"},
    )
    assert patch_res.status_code == 404

    # Verify Acme Cloud rule is unmodified in DB
    refreshed = db.get(BrandEntry, acme_rule.id)
    assert refreshed.is_active is True
    assert refreshed.title == acme_rule.title


def test_tier5_acme_cloud_content_cannot_be_modified_or_deleted_by_foreign_brand(client):
    """Foreign brand cannot delete or overwrite seeded Acme Cloud showcase draft."""
    data = register_brand(client, "Rogue Brand", "Rogue Admin", "admin@rogue-cnt.io", seed_rules=False)
    token_rogue = data["access_token"]

    acme_content_id = UUID("20000000-0000-0000-0000-000000000001")

    assert client.delete(f"/api/v1/content/{acme_content_id}", headers=auth_headers(token_rogue)).status_code == 404
    assert client.put(f"/api/v1/content/{acme_content_id}/body", headers=auth_headers(token_rogue), json={"body_text": "Corrupted content"}).status_code == 404


def test_tier5_acme_cloud_demo_admins_cannot_be_demoted_or_evicted(client):
    """Foreign brand admin cannot mutate or evict Rohan Kapoor (Acme Cloud Admin)."""
    data = register_brand(client, "Rogue Brand", "Rogue Admin", "admin@rogue-adm.io", seed_rules=False)
    token_rogue = data["access_token"]

    rohan_id = DEMO_USERS["admin"]["id"]

    assert client.patch(f"/api/v1/members/{rohan_id}/role", headers=auth_headers(token_rogue), json={"role": "creator"}).status_code == 404
    assert client.delete(f"/api/v1/members/{rohan_id}", headers=auth_headers(token_rogue)).status_code == 404


def test_tier5_acme_cloud_name_collision_impersonation_resistant(client, db):
    """Registering with exact name 'Acme Cloud Workspace' creates an isolated new UUID tenant without collision."""
    data = register_brand(client, "Acme Cloud Workspace", "Copycat Admin", "admin@copycat.io", seed_rules=False)
    new_org_id = UUID(data["user"]["org_id"])

    # New org must have its own distinct UUID, not the seeded DEMO_ORG_ID
    assert new_org_id != DEMO_ORG_ID

    # Seeded Acme Cloud remains intact
    acme_org = db.get(Organization, DEMO_ORG_ID)
    assert acme_org is not None
    assert acme_org.name == "Acme Cloud Workspace"

    # Copycat org is empty (seed_rules=False)
    copycat_entries = db.scalar(
        select(func.count(BrandEntry.id)).where(BrandEntry.org_id == new_org_id)
    )
    assert copycat_entries == 0

    # Acme Cloud still has its full library
    acme_entries = db.scalar(
        select(func.count(BrandEntry.id)).where(BrandEntry.org_id == DEMO_ORG_ID)
    )
    assert acme_entries > 0


def test_tier5_acme_cloud_demo_login_preserves_seeded_workspace(client):
    """Seeded demo accounts login and return authentic Acme Cloud context."""
    for role in ("creator", "reviewer", "admin"):
        res = client.post("/api/v1/auth/demo-login", json={"role": role})
        assert res.status_code == 200
        user = res.json()["user"]
        assert user["org_id"] == str(DEMO_ORG_ID)
        assert user["role"] == role
        assert user["email"] == DEMO_USERS[role]["email"]


# ============================================================================
# Group 5: Rule Namespace Collision Independence
# ============================================================================

def test_tier5_identical_rule_code_creation_across_brands_permitted(client):
    """Identical rule codes (e.g., R-VOICE-001) can be created simultaneously in separate brand organizations."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-ns.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-ns.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]

    rule_code = "R-VOICE-001"

    # Brand A creates R-VOICE-001
    res_a = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_a),
        json={
            "code": rule_code,
            "entry_type": "rule",
            "category": "tone",
            "title": "Alpha Voice Directive",
            "body": "Use warm, friendly, informal phrasing.",
        },
    )
    assert res_a.status_code == 201

    # Brand B creates colliding R-VOICE-001
    res_b = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_b),
        json={
            "code": rule_code,
            "entry_type": "rule",
            "category": "tone",
            "title": "Beta Voice Directive",
            "body": "Use strict, precise, executive vocabulary.",
        },
    )
    assert res_b.status_code == 201


def test_tier5_colliding_rule_code_lifecycle_independence(client, db):
    """Modifying or deactivating a rule in Brand A does NOT affect the identically coded rule in Brand B."""
    data_a = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-life.io", seed_rules=False)
    data_b = register_brand(client, "Brand Beta", "Admin Beta", "admin@beta-life.io", seed_rules=False)

    token_a = data_a["access_token"]
    token_b = data_b["access_token"]
    rule_code = "R-SHARED-001"

    res_a = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_a),
        json={"code": rule_code, "entry_type": "rule", "category": "tone", "title": "Alpha Shared v1", "body": "Alpha rule body"},
    )
    entry_a_id = res_a.json()["id"]

    res_b = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token_b),
        json={"code": rule_code, "entry_type": "rule", "category": "tone", "title": "Beta Shared v1", "body": "Beta rule body"},
    )
    entry_b_id = res_b.json()["id"]

    # Brand A deactivates its rule and updates title
    patch_a = client.patch(
        f"/api/v1/library/entries/{entry_a_id}",
        headers=auth_headers(token_a),
        json={"is_active": False, "title": "Alpha Shared v2 (Archived)"},
    )
    assert patch_a.status_code == 200

    # Verify Brand B rule remains active, untouched, version 1
    get_b = client.get(f"/api/v1/library/entries/{entry_b_id}", headers=auth_headers(token_b))
    assert get_b.status_code == 200
    b_data = get_b.json()
    assert b_data["is_active"] is True
    assert b_data["title"] == "Beta Shared v1"
    assert b_data["current_version"] == 1

    # Brand A active entries does not contain R-SHARED-001
    list_a = client.get("/api/v1/library/entries?is_active=true", headers=auth_headers(token_a)).json()
    assert not any(e["code"] == rule_code for e in list_a)

    # Brand B active entries DOES contain R-SHARED-001
    list_b = client.get("/api/v1/library/entries?is_active=true", headers=auth_headers(token_b)).json()
    assert any(e["code"] == rule_code for e in list_b)


def test_tier5_duplicate_rule_code_within_same_brand_rejected(client):
    """Attempting to create duplicate rule code within the SAME brand returns 409 Conflict."""
    data = register_brand(client, "Brand Alpha", "Admin Alpha", "admin@alpha-dup.io", seed_rules=False)
    token = data["access_token"]
    rule_code = "R-DUP-001"

    res1 = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token),
        json={"code": rule_code, "entry_type": "rule", "category": "tone", "title": "Initial Rule", "body": "Body"},
    )
    assert res1.status_code == 201

    res2 = client.post(
        "/api/v1/library/entries",
        headers=auth_headers(token),
        json={"code": rule_code, "entry_type": "rule", "category": "tone", "title": "Duplicate Rule", "body": "Body 2"},
    )
    assert res2.status_code == 409
    assert f"Entry with code '{rule_code}' already exists" in res2.json()["detail"]
