"""Workspace Team Members & Role Management API Router (TRD Section 8: Members, SRS FR-AUTH-5).

Endpoints:
  - GET /members: List workspace members with roles
  - PATCH /members/{member_id}/role: Update member role (Admin only, last-admin block)
  - POST /members: Invite new member (Admin only)
  - DELETE /members/{member_id}: Remove member (Admin only)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context, require_role
from app.db import get_db
from app.models import AuditLog, Membership, Organization, Profile, ROLES

router = APIRouter(prefix="/members", tags=["members"])


class MemberRoleUpdateIn(BaseModel):
    role: str


class MemberCreateIn(BaseModel):
    display_name: str
    email: str
    role: str = "creator"


def _serialize_member(prof: Profile, role: str, org_id: UUID, org_name: str, lib_ver: int) -> dict[str, Any]:
    return {
        "id": str(prof.id),
        "user_id": str(prof.id),
        "email": prof.email,
        "display_name": prof.display_name or prof.email,
        "role": role,
        "org_id": str(org_id),
        "org_name": org_name,
        "library_version": lib_ver,
        "last_active": prof.created_at.isoformat() if prof.created_at else datetime.now(timezone.utc).isoformat(),
    }


@router.get("")
def list_members(
    context: RequestContext = Depends(get_context),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all members and their roles within the current organization."""
    memberships = db.execute(
        select(Membership, Profile)
        .join(Profile, Profile.id == Membership.user_id)
        .where(Membership.org_id == context.org_id)
    ).all()

    org = db.get(Organization, context.org_id)
    org_name = org.name if org else "Workspace"
    lib_ver = org.library_version if org else 1

    return [_serialize_member(prof, mem.role, context.org_id, org_name, lib_ver) for mem, prof in memberships]


@router.patch("/{member_id}/role")
def update_member_role(
    member_id: UUID,
    payload: MemberRoleUpdateIn,
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Change member role. Prevents removing the last admin in the organization."""
    new_role = payload.role.lower().strip()
    if new_role not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid role '{new_role}'. Allowed: {ROLES}")

    mem = db.execute(
        select(Membership).where(Membership.org_id == context.org_id, Membership.user_id == member_id)
    ).scalar_one_or_none()
    if not mem:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found in this organization")

    # Guard: Cannot remove last admin
    if mem.role == "admin" and new_role != "admin":
        admin_count = db.execute(
            select(Membership).where(Membership.org_id == context.org_id, Membership.role == "admin")
        ).scalars().all()
        if len(admin_count) <= 1:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Cannot remove the last Admin from the organisation. Assign another Admin first.",
            )

    old_role = mem.role
    mem.role = new_role

    prof = db.get(Profile, member_id)
    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="member.role_changed",
            entity_type="member",
            entity_id=member_id,
            payload={"email": prof.email if prof else "", "old_role": old_role, "new_role": new_role},
        )
    )
    db.commit()

    return list_members(context, db)


@router.post("", status_code=status.HTTP_201_CREATED)
def add_member(
    payload: MemberCreateIn,
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Invite/add a new member to the organization."""
    email_clean = payload.email.strip().lower()
    name_clean = payload.display_name.strip()
    role_clean = payload.role.lower().strip()

    if not email_clean or "@" not in email_clean:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Valid email address is required.")
    if not name_clean:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Member name is required.")
    if role_clean not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid role '{role_clean}'. Allowed: {ROLES}")

    # Check if profile exists or create
    prof = db.execute(select(Profile).where(Profile.email == email_clean)).scalar_one_or_none()
    if not prof:
        prof = Profile(id=uuid4(), email=email_clean, display_name=name_clean)
        db.add(prof)
        db.flush()

    existing_mem = db.execute(
        select(Membership).where(Membership.org_id == context.org_id, Membership.user_id == prof.id)
    ).scalar_one_or_none()

    if existing_mem:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"User with email '{email_clean}' is already a member of this workspace.",
        )

    mem = Membership(id=uuid4(), org_id=context.org_id, user_id=prof.id, role=role_clean)
    db.add(mem)

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="member.invited",
            entity_type="member",
            entity_id=prof.id,
            payload={"email": email_clean, "role": role_clean},
        )
    )
    db.commit()

    return list_members(context, db)


@router.delete("/{member_id}")
def remove_member(
    member_id: UUID,
    context: RequestContext = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Remove a member from the workspace."""
    if member_id == context.user_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "You cannot remove your own admin account from the workspace.",
        )

    mem = db.execute(
        select(Membership).where(Membership.org_id == context.org_id, Membership.user_id == member_id)
    ).scalar_one_or_none()
    if not mem:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

    if mem.role == "admin":
        admins = db.execute(
            select(Membership).where(Membership.org_id == context.org_id, Membership.role == "admin")
        ).scalars().all()
        if len(admins) <= 1:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Cannot remove the last Admin from the organisation.",
            )

    prof = db.get(Profile, member_id)
    db.delete(mem)

    db.add(
        AuditLog(
            id=uuid4(),
            org_id=context.org_id,
            actor_id=context.user_id,
            action="member.removed",
            entity_type="member",
            entity_id=member_id,
            payload={"email": prof.email if prof else ""},
        )
    )
    db.commit()

    return list_members(context, db)

