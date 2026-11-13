"""Session, Identity & AI Disclosure API Router (TRD Section 8: Session).

Exposes:
  - GET /me: Current authenticated user profile, organization, and active role.
  - GET /disclosure: AI provider, model, prompt version, and responsible AI notices.
  - POST /auth/demo-login: 1-click role switcher login for Demo Mode.
  - POST /auth/login: Email-based workspace member login.
  - GET /auth/demo-users: Seeded demo accounts metadata.
  - GET /auth/workspaces: Every organisation the signed-in user belongs to (workspace switcher).
  - POST /auth/register-brand: A signed-in user creates a new brand organisation and becomes its admin.
  - POST /auth/logout: Nothing to clear on the server (Supabase sessions end in the browser).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (
    DEMO_ORG_ID,
    DEMO_ORG_NAME,
    DEMO_USERS,
    RequestContext,
    current_claims,
    get_context,
)
from app.config import get_settings
from app.db import get_db
from app.models import AuditLog, Membership, Organization, Profile
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


class RegisterBrandIn(BaseModel):
    brand_name: str
    admin_name: str | None = None
    seed_default_rules: bool = True


MAX_BRANDS_PER_USER = 5


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
            "Images: the AI reads their text and visible elements; it does not judge artistic quality.",
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



@router.post("/auth/logout")
def logout() -> dict[str, str]:
    """Supabase sessions end in the browser, so there is nothing to clear here."""
    return {"status": "ok"}


@router.get("/auth/workspaces")
def get_workspaces(
    claims: dict[str, Any] = Depends(current_claims),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Every organisation the signed-in user belongs to, for the workspace switcher.

    Needs only a valid sign-in, not an X-Org-Id, so the frontend can call it before it
    knows which workspace to open.
    """
    user_id = UUID(str(claims["sub"]))
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user_id)
        .order_by(Organization.name)
    ).all()
    return [
        {"org_id": str(org.id), "org_name": org.name, "role": membership.role,
         "library_version": org.library_version}
        for membership, org in rows
    ]


def _starter_rules() -> list[Any]:
    """The general tone, messaging, accessibility and claim rules from the sample kit.

    Facts, preferred terms and anything naming the sample brand (Lumio) are left out:
    they describe that company, not the new one.
    """
    from harness.seed import build_seed_entries

    return [
        e for e in build_seed_entries()
        if e.entry_type.value in ("guideline", "claim_rule")
        and "lumio" not in f"{e.title} {e.body} {e.metadata}".lower()
    ]


@router.post("/auth/register-brand", status_code=status.HTTP_201_CREATED)
def register_brand(
    payload: RegisterBrandIn,
    claims: dict[str, Any] = Depends(current_claims),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a brand organisation for the signed-in user, who becomes its admin.

    The account itself is created by Supabase sign-up in the browser; this only needs a
    valid Supabase token. Optionally seeds general starter rules.
    """
    if claims.get("iss") == "demo":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Registering a brand needs a real account, not a demo account.")
    brand_name = " ".join(payload.brand_name.split())
    if not 2 <= len(brand_name) <= 120:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Brand name must be between 2 and 120 characters.")

    user_id = UUID(str(claims["sub"]))
    email = (claims.get("email") or "").strip().lower()
    admin_name = " ".join((payload.admin_name or "").split()) or None

    admin_orgs = db.execute(
        select(Organization.name)
        .join(Membership, Membership.org_id == Organization.id)
        .where(Membership.user_id == user_id, Membership.role == "admin")
    ).scalars().all()
    if any(name.lower() == brand_name.lower() for name in admin_orgs):
        raise HTTPException(status.HTTP_409_CONFLICT, f"You already have a brand called {brand_name}.")
    if len(admin_orgs) >= MAX_BRANDS_PER_USER:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"You can register at most {MAX_BRANDS_PER_USER} brands.")

    profile = db.get(Profile, user_id)
    if profile is None:
        if not email:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your sign-in has no email address.")
        if db.execute(select(Profile.id).where(Profile.email == email)).scalar_one_or_none():
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "This email already belongs to another account.")
        profile = Profile(id=user_id, email=email, display_name=admin_name)
        db.add(profile)
    elif admin_name and not profile.display_name:
        profile.display_name = admin_name

    org = Organization(id=uuid4(), name=brand_name, library_version=1)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user_id, role="admin"))
    db.flush()

    seeded = 0
    if payload.seed_default_rules:
        from app.seed_loader import load_seed

        seeded = load_seed(db, _starter_rules(), org_name=brand_name, org_id=org.id)["brand_entries"]

    db.add(AuditLog(id=uuid4(), org_id=org.id, actor_id=user_id, action="brand.registered",
                    entity_type="organization", entity_id=org.id,
                    payload={"brand_name": brand_name, "starter_rules": seeded}))
    db.commit()

    return {
        "id": str(user_id),
        "user_id": str(user_id),
        "email": profile.email,
        "display_name": profile.display_name or profile.email,
        "org_id": str(org.id),
        "org_name": org.name,
        "role": "admin",
        "library_version": org.library_version,
        "last_active": datetime.now(timezone.utc).isoformat(),
        "starter_rules": seeded,
    }
