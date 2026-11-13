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
from app.models import AuditLog, Membership, Organization, Profile
from app.security import create_access_token, hash_password, verify_password
from harness.llm import LLMClient
from harness.prompts import load_prompt

router = APIRouter(tags=["session"])


def load_seed_rules(db: Session, org_id: UUID) -> None:
    from app.seed_loader import load_seed
    from harness.seed import build_seed_entries

    load_seed(db, entries=build_seed_entries(), org_id=org_id)


class RegisterBrandIn(BaseModel):
    brand_name: str
    admin_name: str
    admin_email: str
    password: str
    seed_default_rules: bool = True


class WorkspaceOut(BaseModel):
    org_id: str
    org_name: str
    role: str


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


@router.post("/auth/register-brand", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
def register_brand(payload: RegisterBrandIn, db: Session = Depends(get_db)) -> AuthTokenResponse:
    """Register a new brand organization, create admin profile and membership, and optionally seed default brand rules."""
    brand_name = payload.brand_name.strip()
    admin_name = payload.admin_name.strip()
    admin_email = str(payload.admin_email).strip().lower()
    password = payload.password

    if not brand_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Brand name is required.")
    if not admin_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin name is required.")
    if not admin_email or "@" not in admin_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Valid admin email is required.")
    if not password or len(password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 6 characters.")

    existing_profile = db.execute(select(Profile).where(Profile.email == admin_email)).scalar_one_or_none()
    if existing_profile:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"User with email '{admin_email}' already exists.",
        )

    # 1. Create Organization
    org = Organization(id=uuid4(), name=brand_name, library_version=1)
    db.add(org)
    db.flush()

    # 2. Create Admin Profile with scrypt password hash
    pw_hash = hash_password(password)
    profile = Profile(
        id=uuid4(),
        email=admin_email,
        display_name=admin_name,
        password_hash=pw_hash,
    )
    db.add(profile)
    db.flush()

    # 3. Create Admin Membership
    membership = Membership(
        id=uuid4(),
        org_id=org.id,
        user_id=profile.id,
        role="admin",
    )
    db.add(membership)
    db.flush()

    # 4. Optional seed default rules
    if payload.seed_default_rules:
        load_seed_rules(db, org.id)

    # 5. Audit log
    db.add(
        AuditLog(
            id=uuid4(),
            org_id=org.id,
            actor_id=profile.id,
            action="brand.registered",
            entity_type="organization",
            entity_id=org.id,
            payload={"brand_name": brand_name, "admin_email": admin_email},
        )
    )

    db.commit()

    token = create_access_token({
        "sub": str(profile.id),
        "email": profile.email,
        "org_id": str(org.id),
        "role": "admin",
    })

    profile_resp = _build_profile_response(
        user_id=profile.id,
        email=profile.email,
        display_name=admin_name,
        role="admin",
        org_id=org.id,
        org_name=org.name,
        library_version=org.library_version,
    )

    return AuthTokenResponse(access_token=token, token_type="bearer", user=profile_resp)


@router.post("/auth/login", response_model=AuthTokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> AuthTokenResponse:
    """Work email login. Authenticates offline credentials or demo accounts in demo mode."""
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

    # If demo mode and (password is empty/None or equals 'demo') and matched a demo user
    if settings.demo_mode and matched_role is not None and (not req.password or req.password == "demo"):
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

    # Standard Offline Authentication via password
    prof = db.execute(select(Profile).where(Profile.email == email_clean)).scalar_one_or_none()
    if not prof or not prof.password_hash:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    if not req.password or not verify_password(req.password, prof.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    # Fetch memberships
    memberships = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == prof.id)
    ).all()

    if not memberships:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User does not belong to any organization")

    primary_mem, primary_org = memberships[0]

    token = create_access_token({
        "sub": str(prof.id),
        "email": prof.email,
        "org_id": str(primary_org.id),
        "role": primary_mem.role,
    })

    profile_resp = _build_profile_response(
        user_id=prof.id,
        email=prof.email,
        display_name=prof.display_name or email_clean,
        role=primary_mem.role,
        org_id=primary_org.id,
        org_name=primary_org.name,
        library_version=primary_org.library_version,
    )
    return AuthTokenResponse(access_token=token, token_type="bearer", user=profile_resp)


@router.post("/auth/logout")
def logout() -> dict[str, str]:
    """Logout endpoint for offline auth session invalidation."""
    return {"status": "ok", "message": "Logged out successfully"}


@router.get("/auth/workspaces", response_model=list[WorkspaceOut])
def get_workspaces(
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, str]]:
    """List all workspace organizations the authenticated user belongs to."""
    memberships = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == context.user_id)
    ).all()
    return [
        {
            "org_id": str(m.org_id),
            "org_name": org.name,
            "role": m.role,
        }
        for m, org in memberships
    ]


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

