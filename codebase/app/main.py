import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import (
    audit,
    checks,
    comments,
    content,
    findings,
    insights,
    library,
    members,
    session,
    workflow,
)
from app.config import get_settings
from app.db import get_db

logger = logging.getLogger("brandguard")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.demo_mode:
        # Gives the demo organisation the Lumio brand kit, three accounts and a sample draft.
        try:
            from app.seed_loader import auto_seed_if_needed

            logger.info("Demo database seed: %s", auto_seed_if_needed())
        except Exception as exc:
            logger.warning("Demo seed skipped: %s", exc)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.demo_mode and settings.env == "production":
        # Demo tokens let anyone act as an admin.
        raise RuntimeError("DEMO_MODE must not be turned on in production.")

    app = FastAPI(title="BrandGuard API", version="0.1.0", lifespan=lifespan)

    # Strict allowlist (TRD section 8): exact origins only, never "*".
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz", tags=["system"])
    def healthz() -> dict[str, str]:
        """Cheap liveness check. Used by Render and the uptime pinger."""
        return {"status": "ok"}

    @app.get("/readyz", tags=["system"])
    def readyz(db: Session = Depends(get_db)) -> dict[str, str]:
        """Proves the database connection works."""
        db.execute(text("select 1"))
        return {"status": "ready"}

    for module in (session, library, content, checks, findings, workflow, comments, insights,
                   members, audit):
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
