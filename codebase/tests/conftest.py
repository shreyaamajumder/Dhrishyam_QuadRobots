import os

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import engine


@pytest.fixture
def db():
    """A session whose work is always rolled back. Skips if Postgres is not running."""
    local_hosts = {"localhost", "127.0.0.1", "::1", "db"}
    if engine.url.host not in local_hosts and os.environ.get("ALLOW_DB_TESTS") != "1":
        pytest.skip("Database tests only run against a local database "
                    "(DATABASE_URL points elsewhere, e.g. Supabase). Set ALLOW_DB_TESTS=1 to override.")
    try:
        connection = engine.connect()
    except OperationalError:
        pytest.skip("Postgres not reachable (run: docker compose up -d && alembic upgrade head)")
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        session.execute(text("select 1 from alembic_version limit 1"))
    except Exception:
        session.close(); transaction.rollback(); connection.close()
        pytest.skip("Database is not migrated (run: alembic upgrade head)")
    yield session
    session.close()
    transaction.rollback()
    connection.close()
