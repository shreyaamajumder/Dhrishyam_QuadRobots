"""Session, Identity & AI Disclosure API Router (TRD Section 8: Session).

Exposes:
  - GET /me: Current authenticated user profile, organization, and active role.
  - GET /disclosure: AI provider, model, prompt version, and responsible AI notices.
  - POST /auth/demo-login: 1-click role switcher login for Demo Mode.
  - POST /auth/login: Email-based workspace member login.
  - GET /auth/demo-users: Seeded demo accounts metadata.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_USERS, RequestContext, get_context
from app.config import get_settings
from app.db import get_db
from app.models import Membership, Organization, Profile
from harness.llm import LLMClient
from harness.prompts import load_prompt

router = APIRouter(tags=["session"])


class DemoLoginRequest(BaseModel):
    role: str = "creator"


class LoginRequest(BaseModel):
    email: str
    password: str | None = None


class UserProfileResponse(BaseModel):
    id: str
    user_id: str
    email: str
    display_name: str
    role: str
    org_id: str
    org_name: str
    library_version: int
    last_active: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfileResponse


class DisclosureResponse(BaseModel):
    provider: str
    model: str
    prompt_version: str
    available: bool
    unavailable_reason: str | None = None
    data_use_note: str
    sent_data_scope: str
    human_control_guarantee: str
    known_limitations: list[str]


def _build_profile_response(
    user_id: UUID, email: str, display_name: str, role: str, org_id: UUID, org_name: str, library_version: int = 1
) -> UserProfileResponse:
    return UserProfileResponse(
        id=str(user_id),
        user_id=str(user_id),
        email=email,
        display_name=display_name,
        role=role,
        org_id=str(org_id),
        org_name=org_name,
        library_version=library_version,
        last_active=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/me")
def me(context: RequestContext = Depends(get_context), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Who am I, in which organisation, with which role. The frontend uses this after login."""
    org = db.get(Organization, context.org_id)
    profile = db.get(Profile, context.user_id)
    email = context.email or (profile.email if profile else "")
    display_name = (profile.display_name if profile and profile.display_name else None) or email or "User"
    return {
        "id": str(context.user_id),
        "user_id": str(context.user_id),
        "email": email,
        "display_name": display_name,
        "org_id": str(context.org_id),
        "org_name": org.name if org else "Acme Cloud Workspace",
        "role": context.role,
        "library_version": org.library_version if org else 1,
        "last_active": datetime.now(timezone.utc).isoformat(),
    }


PROMPTS = ("orchestrator", "claims_evidence", "brand_consistency", "accessibility", "critic",
           "corrector")


@router.get("/disclosure", response_model=DisclosureResponse)
def get_disclosure() -> DisclosureResponse:
    """Which AI is used, what is sent to it, and the human-control guarantee.

    Read from the harness's LLM settings (codebase/.env), so it always names the model that
    really runs. Contains no keys.
    """
    ai = LLMClient.from_env().status()
    prompt_version = ", ".join(load_prompt(name).version for name in PROMPTS)
    return DisclosureResponse(
        provider=ai["provider"],
        model=ai["model"],
        prompt_version=prompt_version,
        available=ai["available"],
        unavailable_reason=ai["reason"],
        data_use_note=ai["disclosure"],
        sent_data_scope=(
            "Only the draft text and the relevant active brand library entries are sent. "
            "Keys, passwords and other organisations' data are never sent."
        ),
        human_control_guarantee=(
            "AI suggestions are never applied automatically. Every AI finding is labelled, "
            "and creators and reviewers make every decision."
        ),
        known_limitations=[
            "English content only in this version.",
            "Text only: images and layout are not checked.",
            "Findings are only as good as the brand library: unclear rules give unclear findings.",
            "When AI review is unavailable, only the rule-based checks run, and the check says so.",
        ],
    )


@router.post("/auth/demo-login", response_model=AuthTokenResponse)
def demo_login(req: DemoLoginRequest, db: Session = Depends(get_db)) -> AuthTokenResponse:
    """Instant one-click login as Creator, Reviewer, or Admin in Demo Mode."""
    settings = get_settings()
    if not settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo login is only available when DEMO_MODE=true.",
        )

    role = req.role.lower().strip()
    if role not in DEMO_USERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid demo role: {role}. Allowed roles: {list(DEMO_USERS.keys())}",
        )

    demo_info = DEMO_USERS[role]
    user_id = demo_info["id"]

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
        mem = Membership(org_id=DEMO_ORG_ID, user_id=user_id, role=role)
        db.add(mem)
        db.flush()

    db.commit()

    token = f"demo-{role}-token"
    profile_resp = _build_profile_response(
        user_id=user_id,
        email=demo_info["email"],
        display_name=demo_info["display_name"],
        role=role,
        org_id=DEMO_ORG_ID,
        org_name=org.name,
        library_version=org.library_version,
    )

    return AuthTokenResponse(access_token=token, token_type="bearer", user=profile_resp)


@router.post("/auth/login", response_model=AuthTokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> AuthTokenResponse:
    """Work email login. Matches demo users or provisions an organization member in demo mode."""
    settings = get_settings()
    email_clean = req.email.strip().lower()
    if not email_clean:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Work email is required.")

    matched_role = None
    matched_name = "Workspace Member"
    for r, u in DEMO_USERS.items():
        if u["email"].lower() == email_clean:
            matched_role = r
            matched_name = u["display_name"]
            break

    if settings.demo_mode:
        # Demo tokens stand for the three demo accounts only, so only they can sign in here.
        if matched_role is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "In demo mode, sign in with one of the demo accounts.")
        prof = db.execute(select(Profile).where(Profile.email == email_clean)).scalar_one_or_none()
        if not prof:
            prof = Profile(
                id=DEMO_USERS[matched_role]["id"],
                email=email_clean,
                display_name=matched_name,
            )
            db.add(prof)
            db.flush()

        org = db.get(Organization, DEMO_ORG_ID)
        if not org:
            org = Organization(id=DEMO_ORG_ID, name=DEMO_ORG_NAME, library_version=1)
            db.add(org)
            db.flush()

        mem = db.execute(
            select(Membership).where(Membership.org_id == DEMO_ORG_ID, Membership.user_id == prof.id)
        ).scalar_one_or_none()
        if not mem:
            mem = Membership(org_id=DEMO_ORG_ID, user_id=prof.id, role=matched_role)
            db.add(mem)
            db.flush()

        db.commit()

        token = f"demo-{matched_role}-token"
        profile_resp = _build_profile_response(
            user_id=prof.id,
            email=prof.email,
            display_name=prof.display_name or matched_name,
            role=mem.role,
            org_id=DEMO_ORG_ID,
            org_name=org.name,
            library_version=org.library_version,
        )
        return AuthTokenResponse(access_token=token, token_type="bearer", user=profile_resp)

    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Standard password auth requires Supabase Auth configured.",
    )


@router.get("/auth/demo-users")
def get_demo_users() -> dict[str, Any]:
    """Returns metadata for the 3 seeded demo accounts."""
    return {
        role: {
            "id": str(u["id"]),
            "email": u["email"],
            "display_name": u["display_name"],
            "role": u["role"],
            "org_id": str(DEMO_ORG_ID),
            "org_name": DEMO_ORG_NAME,
        }
        for role, u in DEMO_USERS.items()
    }

