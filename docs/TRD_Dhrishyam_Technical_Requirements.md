# TRD: BrandGuard Technical Requirements (Hackathon V1)

**Status:** Draft v1 · **Input:** PRD v1 (M1–M11 MVP, L1–L2 MVP-lite) · **Audience:** the build team and judges reading the repo

## 1. Technical principles

1. **A modular monolith, not microservices.** One backend, one database, one frontend. Clear module boundaries so any module can be split out later.
2. **Free for students, no credit card for V1.** Every service below has a free tier usable for a hackathon. Limits are listed in section 9.
3. **Beginner-friendly.** Python on the backend (the language most of the team likely knows), one popular React toolchain, auto-generated API docs, no exotic infrastructure.
4. **Stable over clever.** Typed schemas, migrations, immutable history, tests and an evaluation harness. These matter more to Round 3 than extra features.
5. **Built around the problem statement.** The architecture exists to deliver four judged ideas: *grounded findings, human control, explainability, and governance insights.*

## 2. Technology decisions (summary)

| Layer | Choice | Why it fits |
| --- | --- | --- |
| Frontend | **React + Vite + TypeScript**, Tailwind CSS, shadcn/ui, TanStack Query, Recharts, `diff` (jsdiff) | Huge beginner community; shadcn/ui gives a polished look fast; jsdiff gives the before/after suggestion view. TypeScript is recommended because API types are generated; plain JS works if the team prefers. |
| Backend | **Python 3.11+, FastAPI**, Pydantic v2, SQLAlchemy 2 + Alembic | Auto OpenAPI docs at `/docs` (judges can try the API); Pydantic validates LLM output; Alembic gives safe migrations. |
| Database | **PostgreSQL on Supabase (free)** | Real Postgres (JSONB, constraints, triggers), no lock-in because the backend uses a plain connection string. |
| Auth | **Supabase Auth** (email + password, optional Google) | No password handling in our code; JWTs verified by the backend. |
| AI | **Gemini API free tier** (primary), **Groq free tier** (fallback), both behind our own `LLMProvider` interface | Free, structured JSON output, vision for L1. Provider is swappable. |
| File storage (L1 only) | Supabase Storage (private bucket) | Same account, free allowance. |
| Hosting | Frontend: **Vercel or Cloudflare Pages**; Backend: **Render free web service** (Docker or Python) | Git-push deploys, HTTPS included. |
| Quality tooling | pytest, Ruff, GitHub Actions (free for public repos) | Evidence of testing for Round 3. |

**Deliberately not used (avoid overengineering):** microservices, Kubernetes, Redis/Celery, a vector database, GraphQL, WebSockets, event sourcing, a custom auth system, fine-tuned models.

## 3. System architecture overview

```
 Browser (React SPA)
   | 1. sign in via Supabase Auth  ->  JWT
   | 2. REST + JSON, Authorization: Bearer <JWT>
   v
 FastAPI backend (single deployable)
   |-- auth/        verify JWT, load membership + role
   |-- library/     brand entries + versions
   |-- content/     items, immutable versions, file intake
   |-- checks/      CHECK ENGINE (see section 4)
   |-- workflow/    status machine, comments, review decisions
   |-- insights/    SQL aggregates, clarity score
   |-- audit/       append-only event log
   |
   |---> PostgreSQL (Supabase)         all application data
   |---> Supabase Storage (L1)         images only
   '---> LLM providers (Gemini, Groq)  only inside checks/
```

**Request lifecycle for the main flow ("Run brand check"):**

1. `POST /content/{id}/checks` validates role, content length and language, then creates a `check_runs` row (`queued`) and returns **202** with its id.
2. A FastAPI background task runs the engine and writes findings. Free hosting means one process, so no queue infrastructure is needed.
3. The browser polls `GET /checks/{id}` every 2 seconds until the status is `completed`, `degraded` or `failed`.
4. The creator decides on each finding. **Accept** makes the *server* create a new content version; the AI never writes content by itself.

**Why polling and a background task:** LLM latency and free-tier throttling make a long synchronous request fragile. The 202 + poll pattern is simple, survives slow responses, and keeps the UI honest about progress. On restart, a startup sweep marks stale `running` jobs as `failed`.

## 4. Check engine design (the core of the product)

The engine is a pipeline with **two sources of findings** and **one gate**.

### 4.1 Pipeline

1. **Preprocess:** normalise text, count words, detect language (`langdetect`), split sentences.
2. **Rule engine (deterministic):** compiles library entries with `check_mode = deterministic` into checks. Fast, free, always available, fully explainable.
3. **LLM pass (one structured call):** judges tone, messaging and fact consistency using only the active LLM-judged entries and approved facts. Content is passed as delimited data; instructions never come from content.
4. **Grounding Gate:** validates everything the LLM returned (4.3). Only findings that pass are stored.
5. **Persist:** findings, run statistics and the **library manifest** (entry id + version used) are saved so every run is reproducible.

### 4.2 Deterministic rule types

| Rule type | Detects | PRD item |
| --- | --- | --- |
| `banned_term` / `preferred_term` | Wrong or banned terminology with a ready replacement | M1, M3 |
| `claim_pattern` | Superlatives ("best", "#1"), guarantees, percentages and statistics | M7 |
| `fact_match` | A number or entity claim checked against approved facts; no match gives label `unsupported_claim` | M7 |
| `a11y_text` | "click here" link text, ALL-CAPS runs, reading level above target (`textstat`), missing alt text | M6 |
| `system` | Prompt-injection phrases (built-in rule `SYS-001`, cited like any other rule) | Edge cases |

Non-LLM rules carry their own `preferred` replacement, so many suggestions need no AI at all.

### 4.3 Grounding Gate (our signature reliability feature)

Every LLM finding must pass all checks or it is discarded and counted in `check_runs.stats.rejected`:

| Gate | Check |
| --- | --- |
| G1 | Output matches the Pydantic schema |
| G2 | `entry_code` exists, is active, and is in this run's manifest |
| G3 | `span_text` occurs **verbatim** in the content; offsets are computed by the server, never trusted from the model |
| G4 | Finding category matches the cited entry's category |
| G5 | Suggestion is non-empty, different from the span, and a minimal edit (length within about 2x the span + 20 characters) so the creator's intent is preserved |
| G6 | **Self-lint:** the suggestion is run through the rule engine and must not introduce a banned term or a new unsupported claim |
| G7 | Not a duplicate of a deterministic finding on the same span (the deterministic one wins) |

This directly produces the PRD metrics "100% verified citations" and "0 hallucinated citations reaching the UI", and the rejection counts are displayed in the evaluation report as reliability evidence.

### 4.4 LLM contract

```json
{ "findings": [ {
  "entry_code": "R-TONE-003",
  "category": "tone | messaging | facts_claims",
  "severity": "high | medium | low",
  "span_text": "exact substring of the content",
  "explanation": "plain-language reason for the creator",
  "suggestion": "replacement for span_text only",
  "confidence": "high | medium | low"
} ] }
```

- Temperature low; prompts live in versioned files (`prompts/check_v1.md`) and the version is stored in `check_runs.engine_info`.
- Low confidence is shown with the label `needs_human_check`.
- The model has **no tools and no ability to change workflow state**. Content is wrapped in delimiters and the system prompt states that text inside is data only.

### 4.5 Failure handling

| Failure | Behaviour |
| --- | --- |
| 429 / 5xx / timeout from primary provider | Backoff and retry once, then the fallback provider, within a total budget of about 25 seconds |
| All providers fail or output is unusable | Run ends as `degraded`: deterministic findings only, with the "AI review unavailable" banner |
| Same content + same library manifest + same prompt version | Return the cached result (`cache_key` hash), saving free-tier quota |
| Empty library | Check refused with an explanatory error (no generic AI opinions) |

## 5. Frontend responsibilities

**Does:**

- Authentication UI via `supabase-js` (sign-in only), token attached to every API call.
- Pages: Login · Library (list, edit) · My content · New review · **Review workspace** · Reviewer queue · Insights.
- **Review workspace:** content with highlighted spans (segmented to handle overlaps), a findings panel grouped by category, `FindingCard` (reason, cited source, severity, provenance badge, before/after diff, Accept / Edit / Dismiss), tabs for Versions, Comments and Timeline.
- Provenance badges on every finding: **Rule engine** vs **AI (model name)**, plus a persistent **AI disclosure banner** populated from `GET /disclosure`.
- Polling the check run, with clear states for running, degraded and failed.
- Role-aware navigation (hiding what a role cannot use). This is convenience only.
- Charts for Insights (Recharts) and the plain-language **Clarity Score** explanation.
- Accessibility of the product itself: keyboard navigation, visible focus, colour contrast, ARIA labels. This is part of the accessibility explanation in the Round 3 submission.

**Does not:**

- Evaluate rules, call any LLM, or hold any secret (only the public Supabase URL and anon key).
- Enforce permissions or apply suggestions itself; it always asks the server, which writes a new version.
- Store application data locally beyond the session.

**State:** TanStack Query for server state; React Router for routes; no global state library. Types are generated from the backend's OpenAPI file (`openapi-typescript`), so frontend and backend cannot silently drift.

## 6. Backend responsibilities

| Module | Responsibilities |
| --- | --- |
| `auth` | Verify JWT, load membership and role, enforce role and org scoping on every request |
| `library` | CRUD for entries; every edit creates a version row; seeding of the demo brand kit; (L2) import preview/confirm |
| `content` | Items, **immutable versions**, `.txt`/`.docx` extraction (`python-docx`), size and language validation |
| `checks` | Engine in section 4; provider abstraction; job lifecycle; caching |
| `workflow` | Status state machine, submit, approve / request changes, comments, notifications, self-approval block |
| `insights` | SQL aggregates and Clarity Score |
| `audit` | Append-only event log written from the service layer for every state-changing action |
| `core` | Config from environment, structured logging (no content in logs), error format, request ids, health check |

**Cross-cutting rules:**

- All data access goes through a repository helper that **requires `org_id`**, so a missing tenant filter cannot happen by accident.
- State transitions are validated in one place (the table in section 8), never scattered across endpoints.
- Secrets (LLM keys, DB URL) exist only as environment variables on the backend host.
- Idempotent seed script so a fresh deploy always has a working demo kit.

## 7. Database schema proposal

PostgreSQL. UUID primary keys (`gen_random_uuid()`). Categorical columns use `TEXT` with `CHECK` constraints rather than native enums, because enums are painful to change in later migrations. Every tenant table carries `org_id`. Timestamps are `timestamptz`.

| Table | Key columns | Notes |
| --- | --- | --- |
| `organizations` | id, name, library\_version (int) | `library_version` increments on any library change |
| `profiles` | id (= auth user id), email, display\_name | Identity itself lives in Supabase Auth |
| `memberships` | org\_id, user\_id, role (`creator` / `reviewer` / `admin`) | Unique (org\_id, user\_id). **Role source of truth** |
| `brand_entries` | id, org\_id, code (e.g. `R-TONE-003`), entry\_type (`rule` / `fact` / `term` / `claim_rule`), category, title, body, check\_mode (`deterministic` / `llm`), pattern (jsonb), good\_example, bad\_example, severity\_default, is\_active, current\_version | Unique (org\_id, code) |
| `brand_entry_versions` | id, entry\_id, version, snapshot (jsonb), changed\_by, created\_at | Full snapshot per edit (PRD: versioning) |
| `content_items` | id, org\_id, creator\_id, title, content\_type, status, current\_version\_no, reviewer\_id | status in the PRD model (section 8) |
| `content_versions` | id, content\_id, version\_no, body\_text, source (`paste` / `upload` / `suggestion` / `manual`), created\_by, created\_at | **Immutable**; unique (content\_id, version\_no) |
| `attachments` (L1) | id, content\_id, storage\_path, mime, size\_bytes, alt\_text |  |
| `check_runs` | id, content\_version\_id, org\_id, status (`queued` / `running` / `completed` / `degraded` / `failed`), library\_manifest (jsonb), engine\_info (jsonb: provider, model, prompt\_version), cache\_key, stats (jsonb), error, started\_at, finished\_at | Manifest = entry id → version used |
| `findings` | id, check\_run\_id, org\_id, category, severity, source\_type (`rule_engine` / `ai`), entry\_id, entry\_version, secondary\_entry\_id, span\_start, span\_end, span\_text, explanation, suggestion\_text, confidence, label (`issue` / `unsupported_claim` / `guideline_conflict` / `needs_human_check`) | `secondary_entry_id` holds the second citation for conflicts |
| `finding_decisions` | id, finding\_id, actor\_id, action (`accepted` / `edited` / `dismissed` / `confirmed` / `overridden`), reason, resulting\_version\_id, created\_at | **Append-only**; latest row = current state |
| `comments` | id, content\_id, version\_no, author\_id, body, anchor\_start, anchor\_end, finding\_id | Anchors optional |
| `review_decisions` | id, content\_id, version\_no, reviewer\_id, decision (`approved` / `changes_requested`), comment, created\_at |  |
| `notifications` | id, user\_id, content\_id, kind, read\_at, created\_at | In-app only |
| `audit_log` | id, org\_id, actor\_id, action, entity\_type, entity\_id, payload (jsonb), created\_at | **Append-only** |

**Integrity rules:**

- Database triggers reject `UPDATE` and `DELETE` on `content_versions`, `finding_decisions`, `review_decisions` and `audit_log`. History cannot be rewritten by a bug or by anyone using the API.
- Indexes: `findings(check_run_id)`, `findings(entry_id)`, `content_items(org_id, status)`, `brand_entries(org_id, is_active)`, `audit_log(org_id, created_at)`, `check_runs(cache_key)`.
- Offsets in `findings` refer to the `content_versions` row the run was made on. After an accepted suggestion, the server shifts later offsets in that run and returns `409 stale_finding` if the text at the span no longer matches.

**Insights query (Clarity Score, a proposal to tune on the test set):**

```sql
-- per rule, last 30 days; ignore rules with fewer than 5 decided findings
SELECT e.code,
       COUNT(*)                                             AS findings,
       AVG((d.action = 'dismissed')::int)                   AS dismissal_rate,
       AVG((d.action = 'overridden')::int)                  AS override_rate,
       0.6*AVG((d.action = 'dismissed')::int)
     + 0.4*AVG((d.action = 'overridden')::int)              AS clarity_risk
FROM findings f
JOIN brand_entries e ON e.id = f.entry_id
JOIN LATERAL (SELECT action FROM finding_decisions
              WHERE finding_id = f.id ORDER BY created_at DESC LIMIT 1) d ON true
WHERE f.org_id = :org AND f.created_at > now() - interval '30 days'
GROUP BY e.code HAVING COUNT(*) >= 5
ORDER BY clarity_risk DESC;
```

Rules above a threshold (for example 0.5) are shown as "may be unclear", together with guideline-conflict counts. This is exactly the "areas where the brand guidelines are unclear" insight from the problem statement.

## 8. API structure

**Conventions:** base path `/api/v1`; JSON; `Authorization: Bearer <JWT>`; errors as `{ "error": { "code", "message", "details", "request_id" } }`; list endpoints take `limit` and `cursor`; OpenAPI served at `/docs`; async work returns **202**.

| Area | Endpoint | Roles |
| --- | --- | --- |
| Session | `GET /me` (profile, org, role) · `GET /disclosure` (provider, model, data-use note) · `GET /health` | all |
| Library | `GET /library/entries` (filters: type, category, active) · `GET /library/entries/{id}` · `GET /library/entries/{id}/versions` | all |
|  | `POST /library/entries` · `PATCH /library/entries/{id}` (creates a version; includes activate / deactivate) · `POST /library/seed` | admin |
|  | (L2) `POST /library/import/preview` · `POST /library/import/confirm` | admin |
| Content | `POST /content` (title, type, text) · `POST /content/upload` (multipart `.txt` / `.docx`) | creator, admin |
|  | `GET /content` (filters: status, mine) · `GET /content/{id}` · `PUT /content/{id}/body` (new version) · `GET /content/{id}/versions` · `GET /content/{id}/timeline` | role-scoped |
| Checks | `POST /content/{id}/checks` → 202 · `GET /checks/{id}` (status, stats, findings) · `GET /content/{id}/findings?version=latest` | creator, reviewer, admin |
| Findings | `POST /findings/{id}/decision` body `{action, reason}`. `accepted` makes the server create the new version | creator (own), reviewer (override) |
| Workflow | `POST /content/{id}/submit` `{reviewer_id}` · `POST /content/{id}/review` `{decision, comment}` · `GET /review-queue` | creator · reviewer · reviewer |
| Comments | `GET/POST /content/{id}/comments` | all with access |
| Insights | `GET /insights/summary` · `GET /insights/rules` (with Clarity Score) · `GET /insights/categories-over-time` | admin (reviewer read-only) |
| Audit / Notifications | `GET /audit?entity=` · `GET /notifications` · `POST /notifications/{id}/read` | admin · own |
| Members | `GET /members` · `PATCH /members/{id}/role` | admin |

**Status state machine (single source of truth in `workflow/`):**

| From | Event | To | Who | Guard |
| --- | --- | --- | --- | --- |
| draft | check completes | checked | system | latest version checked |
| checked | submit | in\_review | creator | every **High** finding has a decision (proposal to confirm) |
| in\_review | request changes | changes\_requested | reviewer | comment required; reviewer ≠ creator |
| changes\_requested | creator edits or re-checks, then resubmits | in\_review | creator | same guard as submit |
| in\_review | approve | approved | reviewer | reviewer ≠ creator |
| checked / changes\_requested / approved | edit body | draft | creator | approval cleared, history kept |

## 9. Authentication and authorization strategy

- **Authentication:** Supabase Auth issues the JWT. The backend verifies its signature using the project's published signing keys (JWKS) or JWT secret, checks expiry, and reads only the user id (`sub`).
- **Authorization:** the **role is read from `memberships` in our database**, not from the token, so a role change takes effect immediately. A short in-memory cache (about 60 seconds) avoids a query per request.
- **Enforcement points:** a `require_role(...)` dependency on each route, the repository helper that always filters by `org_id`, and ownership checks (creators only see their own items; reviewers see items assigned to them).
- **Hard rules:** creators cannot approve their own content; only humans can change workflow state; the LLM module has no access to the workflow or database layers.
- **Demo mode (`DEMO_MODE=true`):** three seeded accounts (creator, reviewer, admin) with a one-click role switcher so judges can try the full flow. Disabled outside the demo environment.
- **Optional defence in depth:** Postgres Row Level Security on tenant tables. The backend connects with a privileged role that bypasses RLS, so RLS is a later hardening step and the app-level `org_id` scoping stays primary in V1.

| Capability | Creator | Reviewer | Admin |
| --- | :-: | :-: | :-: |
| Create content, run checks, decide own findings | yes |  | yes |
| Submit for approval | yes |  | yes |
| Comment | yes | yes | yes |
| Override findings, approve, request changes |  | yes | yes |
| Edit library, view insights, manage roles |  | read insights | yes |

## 10. Third-party dependencies

| Dependency | Use | Free allowance (verify before relying) | Risk and mitigation |
| --- | --- | --- | --- |
| **Gemini API** (Google AI Studio key) | Primary LLM and vision | Free tier with no card; exact per-model limits are shown in your AI Studio project | **Daily request quotas are small and change.** Mitigate with result caching, one call per check, fallback provider, deterministic mode. **Data use:** on the unpaid tier Google may use prompts and responses to improve its products, and human reviewers may read them. See the note below. |
| **Groq API** | Fallback LLM (open-weight model) | Free tier with rate limits | Different output quirks; the same Pydantic validation and Grounding Gate apply |
| **Supabase** | Postgres, Auth, Storage | Free plan: 2 projects, 500 MB database, 1 GB file storage, 50,000 monthly active users | **Free projects pause after 7 days of inactivity.** Use a keep-alive request (scheduled GitHub Action or uptime pinger) and check the dashboard before demos. Keep a second free project as dev |
| **Render** | Backend hosting | Free web service | **Spins down after about 15 minutes idle; the first request can take up to a minute.** Warm it before judging, or keep a pinger. Filesystem is ephemeral, so nothing is stored locally |
| **Vercel / Cloudflare Pages** | Frontend hosting | Free hobby tier | Hobby terms are for non-commercial use, which fits a hackathon |
| **GitHub + Actions** | Repo, CI, keep-alive job | Free for public repos | Judges get a public repository and commit history |
| Libraries | `fastapi`, `pydantic`, `sqlalchemy`, `alembic`, `httpx`, `python-docx`, `textstat`, `langdetect`, `google-genai`, `react`, `tailwindcss`, `shadcn/ui`, `@tanstack/react-query`, `recharts`, `diff`, `openapi-typescript` | Open source licences | All listed in the README for the "details of libraries used" submission item |

**Provider data-use note (important for this problem statement):** the product's theme is protecting confidential brand material. Using a free LLM tier means that material may be seen by the provider. The honest, judge-friendly approach for V1 is: (1) **demo only with a fictional brand kit and sample drafts**, (2) show the disclosure banner naming the provider and the free-tier data terms, (3) keep provider and model in configuration, and (4) list "paid tier or private model for real confidential content" on the roadmap. Note that PRD section 10 says customer content is not used for training "where the provider allows opting out"; on the free tier it does not, so the PRD wording should be adjusted to match.

Model names and quotas change often. Pin the model in an environment variable (`LLM_MODEL`) and read the current free-tier limits from your own AI Studio project at build time.

## 11. Security, privacy and responsible-AI implementation

- Per-org isolation through mandatory `org_id` scoping; role checks on every route; append-only audit trail.
- Only the content under review plus the relevant library entries are sent to the provider. No whole-library or cross-content context.
- Logs contain request ids, sizes, timings and error codes, **never content or prompts**.
- Upload limits (file size, type allow-list, `.docx` parsed as text only, macros ignored); attachments in a private bucket with signed URLs.
- Prompt-injection defence: content as delimited data, no tools for the model, deterministic injection flag (`SYS-001`), and the Grounding Gate.
- Transparency: provenance badge on every finding, model and prompt version stored per run, persistent AI disclosure.
- Rate limit per user on check endpoints to protect free-tier quota.

## 12. Testing and evaluation (evidence for Round 2 and 3)

- **Golden set:** about 10 drafts with about 30 planted issues, stored as JSONL in `/eval`. `make eval` runs the engine and prints **recall, precision, citation validity, Grounding Gate rejections and latency**, matching the PRD success metrics. Run it before every demo and keep the output in the repo.
- **Unit tests (pytest):** each deterministic rule type, the Grounding Gate (G1–G7 with crafted bad LLM outputs), the status state machine, role guards, offset shifting.
- **Contract tests:** the LLM provider interface with a fake provider, so tests never spend quota.
- **End-to-end script:** one scripted run of Flows A–D against a local stack; this is the "3 consecutive dry runs" target.
- **CI:** Ruff + pytest + frontend type check on every push.

## 13. Scalability considerations

V1 targets one organisation, tens of users and a few hundred checks a day. The design avoids tricks now but leaves clear upgrade paths.

| What breaks first | Why | Planned response (not built in V1) |
| --- | --- | --- |
| **LLM quota and latency** | Free-tier limits; one slow provider | Result caching (built), per-user rate limits (built), fallback provider (built), paid tier later |
| In-process background jobs | Lost on restart; single process | Postgres job table with `SELECT ... FOR UPDATE SKIP LOCKED` and a worker process, before considering Redis or Celery |
| Library grows beyond what fits in a prompt | V1 library is about 40 entries and fits easily | Pre-filter by content type and category, then **pgvector** retrieval inside the same Postgres |
| Long documents | One call per check is capped at about 2,000 words | Paragraph chunking with merged findings |
| Free hosting cold starts and pauses | Render and Supabase free behaviour | Paid instance and Supabase Pro; the code does not change |
| Many organisations | Single workspace in V1 | The `org_id` model already exists; add Row Level Security and an org switcher |
| Large audit and findings tables | Append-only growth | Time-based partitioning and archiving |
| Observability | Only logs in V1 | Metrics and tracing once there is real traffic |

Long-term stability comes from decisions already in V1: migrations from day one, immutable versions, library-version-pinned check runs, a provider interface, typed contracts between frontend and backend, and tests that run on every push.

## 14. Build sequence (maps to PRD section 12)

1. Repo, CI, FastAPI skeleton, Supabase project, Alembic initial migration, auth dependency, seed script with the demo kit.
2. Library module and UI (M1).
3. Content intake plus check engine: rule engine first, then LLM pass, then Grounding Gate (M2–M4, M6, M7).
4. Decisions, suggestions and new-version creation (M5).
5. Workflow, comments, versions, audit, notifications (M8, M9).
6. Insights and Clarity Score (M10).
7. Disclosure, error states, eval harness, README with libraries, models and contribution statement (M11).
8. Deploy early (step 1) and redeploy at every step; do not leave deployment to the last hour. Then L1 and L2 only if time remains.

## 15. Open decisions

- Confirm the proposed submit guard (all **High** findings need a decision before submission).
- Confirm Gemini as primary and Groq as fallback after checking current free-tier limits in your own accounts.
- Decide whether the team is comfortable with TypeScript; if not, use JavaScript and skip generated types.
- Confirm whether the organiser supplies sample brand material or the team writes a fictional kit (affects the golden set).
