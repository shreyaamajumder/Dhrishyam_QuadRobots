# Dhrishyam backend and AI harness

FastAPI + SQLAlchemy 2 + Alembic on PostgreSQL. Database follows TRD section 7 ("Database schema proposal").

Everything runs from this `codebase/` folder. `app/` is the API, `harness/` and `gates/` are the AI
harness, and `tests/` covers both. The harness is imported directly, so there is nothing to copy.

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

New database: open the Supabase SQL Editor, paste `schema.sql`, and run it. It creates every table,
the protective triggers and the `finding_current_decision` view, and records the current revision,
so `alembic upgrade head` against the same database later does nothing wrong.

Database already set up from the earlier `schema.sql` (revision 0001): run `migration_0002.sql` instead.

Regenerate both after any migration:
`alembic upgrade head --sql > schema.sql` and `alembic upgrade 0001:0002 --sql > migration_0002.sql`.

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

## Tables (18 + 1 view)

organizations, profiles, memberships, brand_entries, brand_entry_versions, content_items,
content_versions, attachments, check_runs, findings, finding_citations, suggestions, run_steps,
finding_decisions, comments, review_decisions, notifications, audit_log.
View: `finding_current_decision` (latest decision per finding).

Findings follow the harness model in `harness/schemas.py` (migration 0002): any number of citations,
a structured suggestion, display status and claim outcome kept separate, and provenance.
`run_steps` stores every harness event in order, including rejected candidates (`gate.rejected`).

## Rules enforced by Postgres itself (all tested)

- Append-only / immutable: `audit_log`, `finding_decisions`, `content_versions`, `brand_entry_versions`,
  `finding_citations`, `suggestions`, `run_steps` (trigger rejects UPDATE and DELETE).
- Grounded or silent: a `confirmed` finding needs at least one citation. This is checked at COMMIT,
  so insert the finding and its citations in the same transaction, in any order.
- A citation must reference a real `(entry_id, entry_version)` from the finding's own organisation.
- Only `facts_and_claims` findings have a claim outcome, and "false" is not an allowed outcome.
- `span_end > span_start` and `span_text` length matches the offsets; confidence between 0 and 1;
  all categorical columns have CHECK constraints.
- Unique: `(org_id, code)` on entries, `(org_id, user_id)` on memberships,
  `(content_id, version_no)` on versions, `(entry_id, version)` on entry versions,
  one suggestion per finding, and `(run_id, seq)` on run steps.
- Reviews and comments must point at an existing content version; "changes requested" needs a comment.

## Differences from the spec text (deliberate)

- `brand_entry_versions` is immutable (the spec only says "full snapshot per edit").
- `created_at` added on tables whose key-column list did not show one.
- No embedding / pgvector column: the spec does not list one. Add it in a later migration if wanted.
- `run_steps` stores the harness event type (`event_type`) and one `data` field, instead of
  separate input and output columns.

## Deploy notes

- Render: Docker web service, root directory `codebase`, health check path `/healthz`.
  Use the Supabase **Session pooler** URL as `DATABASE_URL`. The container runs `alembic upgrade head` on start.
- Free-tier limits change often. Confirm Supabase, Render and LLM quotas on day 1.
