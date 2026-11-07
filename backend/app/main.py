from contextlib import asynccontextmanager
import logging

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

logger = logging.getLogger("dhrishyam")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # Ensure database append-only trigger allows controlled draft deletion
    try:
        from app.db import SessionLocal

        with SessionLocal() as db:
            db.execute(
                text(
                    """
                CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
                BEGIN
                    IF current_setting('brandguard.allow_deletion', true) = 'on' THEN
                        RETURN OLD;
                    END IF;
                    RAISE EXCEPTION USING MESSAGE = TG_TABLE_NAME || ' is append-only';
                END;
                $$ LANGUAGE plpgsql;
            """
                )
            )
            db.commit()
    except Exception as exc:
        logger.warning("Could not sync forbid_change trigger: %s", exc)

    if settings.demo_mode:
        try:
            from app.seed_loader import auto_seed_if_needed

            counts = auto_seed_if_needed()
            logger.info("Demo database auto-seed: %s", counts)
        except Exception as exc:
            logger.warning("Auto-seed skipped or encountered error: %s", exc)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Dhrishyam API", version="0.1.0", lifespan=lifespan)

    # Strict allowlist (TRD section 8): exact origins only, never "*".
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz", tags=["system"])
    @app.get("/health", tags=["system"])
    @app.get("/api/v1/health", tags=["system"])
    def healthz() -> dict[str, str]:
        """Cheap liveness check. Used by Render, uptime pinger, and frontend."""
        return {"status": "ok", "env": settings.env, "demo_mode": str(settings.demo_mode)}

    @app.get("/readyz", tags=["system"])
    def readyz(db: Session = Depends(get_db)) -> dict[str, str]:
        """Proves the database connection works."""
        db.execute(text("select 1"))
        return {"status": "ready"}

    app.include_router(session.router, prefix="/api/v1")
    app.include_router(library.router, prefix="/api/v1")
    app.include_router(content.router, prefix="/api/v1")
    app.include_router(checks.router, prefix="/api/v1")
    app.include_router(findings.router, prefix="/api/v1")
    app.include_router(workflow.router, prefix="/api/v1")
    app.include_router(comments.router, prefix="/api/v1")
    app.include_router(insights.router, prefix="/api/v1")
    app.include_router(members.router, prefix="/api/v1")
    app.include_router(audit.router, prefix="/api/v1")
    return app


app = create_app()
