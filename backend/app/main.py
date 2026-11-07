from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import me
from app.config import get_settings
from app.db import get_db


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BrandGuard API", version="0.1.0")

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

    app.include_router(me.router, prefix="/api/v1")
    # Later phases: library, submissions, runs, workflow routers go here.
    return app


app = create_app()
