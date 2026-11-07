# BrandGuard backend

FastAPI + SQLAlchemy 2 + Alembic on PostgreSQL. Database follows TRD section 7 ("Database schema proposal").

## Run locally

```bash
python3.12 -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                      # Windows: copy .env.example .env
docker compose up -d                                      # Postgres 16
alembic upgrade head                                      # creates all tables
uvicorn app.main:app --reload                             # http://localhost:8000/docs
pytest -q                                                 # DB tests skip if Postgres is down
```

## Supabase (no Alembic needed for the first setup)

Open the Supabase SQL Editor, paste `schema.sql`, and run it. It creates every table, the four
protective triggers and the `finding_current_decision` view, and records revision `0001`, so
`alembic upgrade head` against the same database later does nothing wrong.
Regenerate it after any migration: `alembic upgrade head --sql > schema.sql`.

## Authentication (Phase 2)

Supabase Auth proves identity; the `memberships` table decides the role. `app/auth.py`:
- verifies the bearer token with your project's public keys (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`),
  with pinned algorithms (ES256, RS256; HS256 only if `SUPABASE_JWT_SECRET` is set for an older project),
  and checks expiry, issuer and audience;
- loads the role from the database, never from the token;
- a user in several organisations sends an `X-Org-Id` header;
- routes use `Depends(require_role("reviewer", "admin"))`. `GET /api/v1/me` shows who you are.

Set `SUPABASE_URL` in `.env` (the Project URL, `https://<ref>.supabase.co`). No secret is needed.

## Tests

Database tests run only against a local database and are skipped when `DATABASE_URL` points
elsewhere (such as Supabase), so tests never touch your live data. Override with `ALLOW_DB_TESTS=1`
only if you really mean it.

## Tables (15 + 1 view)

organizations, profiles, memberships, brand_entries, brand_entry_versions, content_items,
content_versions, attachments, check_runs, findings, finding_decisions, comments,
review_decisions, notifications, audit_log. View: `finding_current_decision` (latest decision per finding).

## Rules enforced by Postgres itself (all tested)

- Append-only / immutable: `audit_log`, `finding_decisions`, `content_versions`, `brand_entry_versions`
  (trigger rejects UPDATE and DELETE).
- A finding's citation must reference a real `(entry_id, entry_version)`; id and version come as a pair.
  Only a `needs_human_check` finding may have no citation (grounded or silent).
- `span_end > span_start`, confidence between 0 and 1, all categorical columns have CHECK constraints.
- Unique: `(org_id, code)` on entries, `(org_id, user_id)` on memberships,
  `(content_id, version_no)` on versions, `(entry_id, version)` on entry versions.
- Reviews and comments must point at an existing content version; "changes requested" needs a comment.

## Differences from the spec text (deliberate)

- `findings.secondary_entry_version` added next to `secondary_entry_id`, so the second citation of a
  conflict can be version-checked as well.
- `brand_entry_versions` is immutable (the spec only says "full snapshot per edit").
- `created_at` added on tables whose key-column list did not show one.
- No embedding / pgvector column: the spec does not list one. Add it in a later migration if wanted.
- No trace table (e.g. `run_steps`): the spec does not list one; `check_runs.stats` is the only place for run detail.

## Deploy notes

- Render: Docker web service, root directory `backend`, health check path `/healthz`.
  Use the Supabase **Session pooler** URL as `DATABASE_URL`. The container runs `alembic upgrade head` on start.
- Free-tier limits change often. Confirm Supabase, Render and LLM quotas on day 1.
