import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends
from fastapi.testclient import TestClient

from app import models as m
from app.auth import AuthError, RequestContext, TokenVerifier, get_verifier, require_role
from app.db import get_db
from app.main import create_app

SUPABASE_URL = "https://demo-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"

PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


class StubJWKS:
    """Stands in for the project's public-keys endpoint."""

    class _Key:
        key = PRIVATE_KEY.public_key()

    def get_signing_key_from_jwt(self, token):
        return self._Key()


def make_token(user_id=None, *, key=PRIVATE_KEY, algorithm="ES256", **overrides):
    claims = {"sub": str(user_id or uuid.uuid4()), "aud": "authenticated", "iss": ISSUER,
              "exp": int(time.time()) + 600, "email": "someone@example.com"}
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": "k1"})


def verifier(**kwargs):
    return TokenVerifier(SUPABASE_URL, jwks_client=StubJWKS(), **kwargs)


# ---- token verification (no database) -------------------------------------------------------
def test_valid_token_is_accepted():
    uid = uuid.uuid4()
    assert verifier().verify(make_token(uid))["sub"] == str(uid)


@pytest.mark.parametrize("overrides", [
    {"exp": int(time.time()) - 10},          # expired
    {"aud": "someone-else"},                 # wrong audience
    {"iss": "https://evil.example/auth/v1"}, # wrong issuer
    {"sub": "not-a-uuid"},                   # subject is not a user id
    {"sub": None},                           # missing required claim
])
def test_bad_claims_are_rejected(overrides):
    with pytest.raises(AuthError):
        verifier().verify(make_token(**overrides))


def test_token_signed_by_another_key_is_rejected():
    with pytest.raises(AuthError):
        verifier().verify(make_token(key=OTHER_KEY))


def test_algorithm_confusion_attack_is_rejected():
    # Attacker signs with HS256 using the PUBLIC key bytes as the "secret".
    public_pem = PRIVATE_KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    # PyJWT refuses to build that token itself, so craft it by hand.
    import base64, hashlib, hmac, json

    def b64(data: bytes) -> bytes:
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"sub": str(uuid.uuid4()), "aud": "authenticated", "iss": ISSUER,
                           "exp": int(time.time()) + 600}).encode())
    signature = b64(hmac.new(public_pem, header + b"." + body, hashlib.sha256).digest())
    with pytest.raises(AuthError):
        verifier().verify((header + b"." + body + b"." + signature).decode())


def test_alg_none_is_rejected():
    import base64, json
    b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=")  # noqa: E731
    token = (b64(json.dumps({"alg": "none"}).encode()) + b"." +
             b64(json.dumps({"sub": str(uuid.uuid4()), "aud": "authenticated", "iss": ISSUER,
                             "exp": int(time.time()) + 600}).encode()) + b".")
    with pytest.raises(AuthError):
        verifier().verify(token.decode())


def test_legacy_shared_secret_only_when_configured():
    secret = "x" * 40
    token = make_token(key=secret, algorithm="HS256")
    with pytest.raises(AuthError):
        verifier().verify(token)                        # not configured: rejected
    assert verifier(legacy_secret=secret).verify(token)  # configured: accepted
    with pytest.raises(AuthError):
        verifier(legacy_secret="y" * 40).verify(token)   # wrong secret: rejected


def test_garbage_is_rejected():
    with pytest.raises(AuthError):
        verifier().verify("not.a.token")


# ---- API behaviour (needs the database) ------------------------------------------------------
@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_verifier] = lambda: verifier()

    @app.get("/test/reviewers-only")
    def reviewers_only(ctx: RequestContext = Depends(require_role("reviewer", "admin"))):
        return {"role": ctx.role}

    return TestClient(app)


def add_member(db, role, org=None):
    org = org or m.Organization(name=f"Org {uuid.uuid4().hex[:6]}")
    user = m.Profile(id=uuid.uuid4(), email=f"{uuid.uuid4()}@example.com")
    db.add_all([org, user]); db.flush()
    db.add(m.Membership(org_id=org.id, user_id=user.id, role=role)); db.flush()
    return org, user


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_me_requires_a_token(client):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers=auth("garbage")).status_code == 401
    assert client.get("/api/v1/me", headers=auth(make_token(exp=int(time.time()) - 5))).status_code == 401


def test_unauthorised_response_does_not_say_why(client):
    body = client.get("/api/v1/me", headers=auth("garbage")).json()
    assert body == {"detail": "Invalid or missing credentials"}


def test_valid_token_without_membership_is_forbidden(client):
    assert client.get("/api/v1/me", headers=auth(make_token())).status_code == 403


def test_me_returns_org_and_role_from_the_database(client, db):
    org, user = add_member(db, "creator")
    # The token CLAIMS admin; the database says creator. The database wins.
    token = make_token(user.id, role="admin", app_metadata={"role": "admin"})
    response = client.get("/api/v1/me", headers=auth(token))
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "creator"
    assert body["org_id"] == str(org.id) and body["org_name"] == org.name


def test_role_guard(client, db):
    org, creator = add_member(db, "creator")
    _, reviewer = add_member(db, "reviewer")
    _, admin = add_member(db, "admin")
    url = "/test/reviewers-only"
    assert client.get(url, headers=auth(make_token(creator.id))).status_code == 403
    assert client.get(url, headers=auth(make_token(reviewer.id))).json() == {"role": "reviewer"}
    assert client.get(url, headers=auth(make_token(admin.id))).json() == {"role": "admin"}
    assert client.get(url).status_code == 401


def test_user_in_several_orgs_must_choose_one(client, db):
    org_a, user = add_member(db, "creator")
    org_b = m.Organization(name="Second"); db.add(org_b); db.flush()
    db.add(m.Membership(org_id=org_b.id, user_id=user.id, role="reviewer")); db.flush()
    token = make_token(user.id)
    assert client.get("/api/v1/me", headers=auth(token)).status_code == 400
    chosen = client.get("/api/v1/me", headers={**auth(token), "X-Org-Id": str(org_b.id)})
    assert chosen.status_code == 200 and chosen.json()["role"] == "reviewer"


def test_cannot_pick_an_org_you_do_not_belong_to(client, db):
    _, user = add_member(db, "creator")
    other_org, _ = add_member(db, "admin")
    headers = {**auth(make_token(user.id)), "X-Org-Id": str(other_org.id)}
    assert client.get("/api/v1/me", headers=headers).status_code == 403
    headers["X-Org-Id"] = "nonsense"
    assert client.get("/api/v1/me", headers=headers).status_code == 400
