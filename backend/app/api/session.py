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
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_USERS, RequestContext, get_context
from app.config import get_settings
from app.db import get_db
from app.models import Membership, Organization, Profile

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


@router.get("/disclosure", response_model=DisclosureResponse)
def get_disclosure() -> DisclosureResponse:
    """Returns persistent AI disclosure, models used, and responsible AI notices."""
    settings = get_settings()
    provider_name = "Google Gemini API" if settings.llm_provider == "gemini" else "Groq API"
    model_name = "gemini-2.5-flash" if settings.llm_provider == "gemini" else "llama-3.3-70b-versatile"

    return DisclosureResponse(
        provider=provider_name,
        model=model_name,
        prompt_version="check_v1.4",
        data_use_note=(
            "Content is processed by the AI provider to inspect brand consistency. "
            "Data is evaluated strictly as delimited content and not stored permanently by the provider."
        ),
        sent_data_scope=(
            "Only the submitted draft text and relevant active library rules/facts are sent. "
            "No database passwords, internal IDs, or unapproved rules are transmitted."
        ),
        human_control_guarantee=(
            "AI suggestions are never auto-applied. Final approval and editing decisions "
            "always remain under human creator and reviewer authority."
        ),
        known_limitations=[
            "English language content only in V1",
            "Text-first checking; complex visual layout is out of scope",
            "Accuracy depends on the depth and clarity of the Brand Library",
            "Nuanced sarcasm and domain-specific jargon may require human reviewer override",
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

    matched_role = "creator"
    matched_name = "Workspace Member"
    for r, u in DEMO_USERS.items():
        if u["email"].lower() == email_clean:
            matched_role = r
            matched_name = u["display_name"]
            break

    if settings.demo_mode:
        prof = db.execute(select(Profile).where(Profile.email == email_clean)).scalar_one_or_none()
        if not prof:
            prof = Profile(
                id=DEMO_USERS.get(matched_role, {}).get("id", uuid4()),
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

