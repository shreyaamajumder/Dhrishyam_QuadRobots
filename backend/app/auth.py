"""Authentication and role checks (TRD: Supabase Auth proves identity, memberships decide role).

Flow per request:
  1. Verify the bearer token (signature, expiry, issuer, audience) with the project's public keys.
  2. Look the user up in `memberships`. The ROLE COMES FROM THE DATABASE, never from the token.
  3. Routes declare what they need with `Depends(require_role("reviewer", "admin"))`.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Membership, Organization, Profile

ASYMMETRIC_ALGORITHMS = ("ES256", "RS256")

# Deterministic UUIDs for Demo Workspace & Users in Demo Mode
DEMO_ORG_ID = UUID("00000000-0000-0000-0000-000000000001")
DEMO_ORG_NAME = "Acme Cloud Workspace"

DEMO_USERS: dict[str, dict[str, Any]] = {
    "creator": {
        "id": UUID("10000000-0000-0000-0000-000000000001"),
        "email": "aarav.writer@acme-cloud.io",
        "display_name": "Aarav Mehta",
        "role": "creator",
    },
    "reviewer": {
        "id": UUID("10000000-0000-0000-0000-000000000002"),
        "email": "priya.brand@acme-cloud.io",
        "display_name": "Priya Nair",
        "role": "reviewer",
    },
    "admin": {
        "id": UUID("10000000-0000-0000-0000-000000000003"),
        "email": "rohan.governance@acme-cloud.io",
        "display_name": "Rohan Kapoor",
        "role": "admin",
    },
}


class AuthError(Exception):
    """The token is missing, malformed, expired or not trusted."""


class TokenVerifier:
    """Verifies Supabase access tokens.

    Algorithms are pinned: only ES256 / RS256 (public keys from the project's JWKS endpoint),
    and HS256 only when a legacy shared secret is configured. Anything else, including
    alg "none", is rejected before any key is looked at.
    """

    def __init__(
        self,
        supabase_url: str,
        audience: str = "authenticated",
        jwks_client: Any | None = None,
        legacy_secret: str = "",
    ) -> None:
        self.issuer = f"{supabase_url.rstrip('/')}/auth/v1"
        self.audience = audience
        self._jwks = jwks_client or PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json", cache_keys=True, lifespan=600)
        self._legacy_secret = legacy_secret

    def verify(self, token: str) -> dict[str, Any]:
        try:
            algorithm = jwt.get_unverified_header(token).get("alg")
            if algorithm in ASYMMETRIC_ALGORITHMS:
                key: Any = self._jwks.get_signing_key_from_jwt(token).key
            elif algorithm == "HS256" and self._legacy_secret:
                key = self._legacy_secret
            else:
                raise AuthError("unsupported signing algorithm")
            claims = jwt.decode(
                token, key, algorithms=[algorithm], audience=self.audience, issuer=self.issuer,
                options={"require": ["exp", "sub", "iss", "aud"]})
        except jwt.PyJWTError as error:
            raise AuthError(str(error)) from error
        try:
            UUID(str(claims["sub"]))
        except ValueError as error:
            raise AuthError("token subject is not a user id") from error
        return claims


@lru_cache
def get_verifier() -> TokenVerifier | None:
    settings = get_settings()
    if not settings.supabase_url:
        if settings.demo_mode:
            return None
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured")
    return TokenVerifier(settings.supabase_url, settings.supabase_jwt_audience,
                         legacy_secret=settings.supabase_jwt_secret)


@dataclass(frozen=True)
class RequestContext:
    user_id: UUID
    org_id: UUID
    role: str
    email: str | None = None


_bearer = HTTPBearer(auto_error=False)
_UNAUTHORIZED = HTTPException(
    status.HTTP_401_UNAUTHORIZED, "Invalid or missing credentials",
    headers={"WWW-Authenticate": "Bearer"})


def current_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    verifier: TokenVerifier | None = Depends(get_verifier),
    x_demo_role: str | None = Header(default=None),
) -> dict[str, Any]:
    settings = get_settings()

    # In DEMO_MODE, support demo tokens (e.g. Bearer demo-creator-token) or X-Demo-Role header
    if settings.demo_mode:
        token = credentials.credentials if credentials else None
        role: str | None = None
        if token and token.startswith("demo-"):
            clean = token.removeprefix("demo-").removesuffix("-token").lower()
            if clean in DEMO_USERS:
                role = clean
        elif not token and x_demo_role and x_demo_role.lower() in DEMO_USERS:
            role = x_demo_role.lower()

        if role:
            demo_user = DEMO_USERS[role]
            return {
                "sub": str(demo_user["id"]),
                "email": demo_user["email"],
                "role": role,
                "display_name": demo_user["display_name"],
                "aud": "authenticated",
                "iss": "demo",
            }

    if credentials is None:
        raise _UNAUTHORIZED
    if verifier is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured")
    try:
        return verifier.verify(credentials.credentials)
    except AuthError:
        raise _UNAUTHORIZED from None  # never tell the caller why


def get_context(
    claims: dict[str, Any] = Depends(current_claims),
    db: Session = Depends(get_db),
    x_org_id: str | None = Header(default=None),
) -> RequestContext:
    user_id = UUID(str(claims["sub"]))
    memberships = {
        org_id: role
        for org_id, role in db.execute(
            select(Membership.org_id, Membership.role).where(Membership.user_id == user_id)).all()
    }

    settings = get_settings()
    # In demo mode, automatically ensure demo user and organization exist if not yet seeded
    if not memberships and settings.demo_mode:
        for role_key, demo_info in DEMO_USERS.items():
            if demo_info["id"] == user_id:
                org = db.get(Organization, DEMO_ORG_ID)
                if not org:
                    org = Organization(id=DEMO_ORG_ID, name=DEMO_ORG_NAME, library_version=1)
                    db.add(org)
                    db.flush()
                prof = db.get(Profile, user_id)
                if not prof:
                    prof = Profile(id=user_id, email=demo_info["email"], display_name=demo_info["display_name"])
                    db.add(prof)
                    db.flush()
                mem = db.execute(
                    select(Membership).where(Membership.org_id == DEMO_ORG_ID, Membership.user_id == user_id)
                ).scalar_one_or_none()
                if not mem:
                    mem = Membership(org_id=DEMO_ORG_ID, user_id=user_id, role=demo_info["role"])
                    db.add(mem)
                    db.flush()
                memberships[DEMO_ORG_ID] = demo_info["role"]
                break

    if not memberships:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not belong to any organisation")

    if x_org_id is not None:
        try:
            org_id = UUID(x_org_id)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "X-Org-Id must be a UUID") from None
        if org_id not in memberships:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not belong to that organisation")
    elif len(memberships) == 1:
        org_id = next(iter(memberships))
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "You belong to several organisations: send an X-Org-Id header")

    return RequestContext(user_id=user_id, org_id=org_id, role=memberships[org_id],
                          email=claims.get("email"))


def require_role(*roles: str):
    """Dependency factory: `Depends(require_role("reviewer", "admin"))`."""
    allowed = set(roles)

    def checker(context: RequestContext = Depends(get_context)) -> RequestContext:
        if context.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot do this")
        return context

    return checker
