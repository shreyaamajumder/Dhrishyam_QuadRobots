"""Brand registration and the workspace switcher (needs the database).

The account itself is created by Supabase sign-up in the browser. The backend only needs a
valid Supabase token to create the organisation and make that person its admin.
"""

import uuid

from sqlalchemy import select

from app import models as m
from tests.test_auth import add_member, auth, client, make_token  # noqa: F401,F811  (client is a fixture)

REGISTER = "/api/v1/auth/register-brand"
WORKSPACES = "/api/v1/auth/workspaces"


def test_new_account_registers_a_brand_and_becomes_its_admin(client, db):
    user_id = uuid.uuid4()
    token = make_token(user_id, email="founder@pebblewise.example")
    response = client.post(REGISTER, headers=auth(token),
                           json={"brand_name": "  Pebblewise  ", "admin_name": "Asha Rao"})
    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "admin" and body["org_name"] == "Pebblewise"
    assert body["email"] == "founder@pebblewise.example" and body["display_name"] == "Asha Rao"
    assert body["starter_rules"] > 0

    org_id = uuid.UUID(body["org_id"])
    entries = db.execute(select(m.BrandEntry).where(m.BrandEntry.org_id == org_id)).scalars().all()
    assert len(entries) == body["starter_rules"]
    # Only general rules: no facts, no preferred terms, nothing naming the sample brand.
    assert {e.entry_type for e in entries} <= {"rule", "claim_rule"}
    assert not any("lumio" in f"{e.title} {e.body}".lower() for e in entries)

    me = client.get("/api/v1/me", headers=auth(token)).json()
    assert me["org_id"] == body["org_id"] and me["role"] == "admin"
    audit = db.execute(select(m.AuditLog).where(m.AuditLog.org_id == org_id)).scalars().all()
    assert [a.action for a in audit] == ["brand.registered"]


def test_registering_without_starter_rules_leaves_the_library_empty(client, db):
    token = make_token(email="empty@example.com")
    body = client.post(REGISTER, headers=auth(token),
                       json={"brand_name": "Blank Co", "seed_default_rules": False}).json()
    assert body["starter_rules"] == 0
    org_id = uuid.UUID(body["org_id"])
    assert db.execute(select(m.BrandEntry).where(m.BrandEntry.org_id == org_id)).first() is None


def test_existing_member_can_add_a_second_brand_and_switch(client, db):
    org, user = add_member(db, "creator")
    token = make_token(user.id, email=user.email)
    created = client.post(REGISTER, headers=auth(token), json={"brand_name": "Second Brand"}).json()

    workspaces = client.get(WORKSPACES, headers=auth(token)).json()
    assert {(w["org_name"], w["role"]) for w in workspaces} == {(org.name, "creator"), ("Second Brand", "admin")}

    # With two workspaces, requests name the one they mean.
    assert client.get("/api/v1/me", headers=auth(token)).status_code == 400
    me = client.get("/api/v1/me", headers={**auth(token), "X-Org-Id": created["org_id"]}).json()
    assert me["role"] == "admin"


def test_workspaces_lists_nothing_for_an_account_without_brands(client):
    assert client.get(WORKSPACES, headers=auth(make_token())).json() == []


def test_registration_needs_a_valid_sign_in(client):
    assert client.post(REGISTER, json={"brand_name": "Nope"}).status_code == 401
    assert client.post(REGISTER, headers=auth("garbage"), json={"brand_name": "Nope"}).status_code == 401


def test_same_brand_name_twice_is_refused(client):
    token = make_token(email="twice@example.com")
    assert client.post(REGISTER, headers=auth(token), json={"brand_name": "Acme"}).status_code == 201
    again = client.post(REGISTER, headers=auth(token), json={"brand_name": "acme"})
    assert again.status_code == 409


def test_brand_name_must_be_sensible(client):
    token = make_token(email="short@example.com")
    assert client.post(REGISTER, headers=auth(token), json={"brand_name": " x "}).status_code == 422


def test_cannot_take_over_an_email_owned_by_another_account(client, db):
    _, other = add_member(db, "creator")
    token = make_token(email=other.email)  # a different user id with the same email
    assert client.post(REGISTER, headers=auth(token), json={"brand_name": "Hijack"}).status_code == 409


def test_logout_always_succeeds(client):
    assert client.post("/api/v1/auth/logout").json() == {"status": "ok"}
