from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import RequestContext, get_context
from app.db import get_db
from app.models import Organization

router = APIRouter(tags=["auth"])


@router.get("/me")
def me(context: RequestContext = Depends(get_context), db: Session = Depends(get_db)) -> dict:
    """Who am I, in which organisation, with which role. The frontend uses this after login."""
    org = db.get(Organization, context.org_id)
    return {
        "user_id": str(context.user_id),
        "email": context.email,
        "org_id": str(context.org_id),
        "org_name": org.name if org else None,
        "role": context.role,
    }
