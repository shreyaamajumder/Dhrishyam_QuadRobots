Dhrishyam: pre-publication brand governance

Dhrishyam checks content before it is published against an organisation's approved brand guidelines, facts and terminology. It flags off-brand tone, banned wording, unsupported claims and accessibility problems, explains each one with a citation to the rule or fact it relies on, and suggests a minimal fix that keeps the creator's meaning. People make every decision: nothing is changed or approved automatically.

# 🔐 LOGIN CREDENTIALS

> ## ⚠️ DEMO / TEST ACCOUNTS

| **ROLE** | **EMAIL** | **PASSWORD** |
|:---:|:---:|:---:|
| 🔴 **ADMIN** | `admin@example.com` | `dhrish@adm358` |
| 🟢 **CREATOR** | `creator@example.com` | `dhrish@creat112` |
| 🔵 **REVIEWER** | `reviewer@example.com` | `dhrish@rev235` |

> **⚠️ IMPORTANT:** These credentials are provided for demonstration/testing purposes only.
> 
Built by Team QuadRobots:

Member	Role
Ankit	AI & Governance Engineer (harness, gates, AI review)
Samiran	Backend & System Architecture Lead
Rohan	Frontend & UI/UX Lead
Shreya	Full stack and product workflow (database, backend, sign-in)
What it does
Brand check. A creator pastes or uploads a draft. Rule-based checks run first (banned terms, claim patterns, all-caps, link text, reading level), then an AI review investigates tone, messaging and claims against the organisation's brand library.
Grounded or silent. Every confirmed finding cites an approved rule or fact. A finding without evidence is either dropped or shown as "needs human verification", never as confirmed. Claims are never called "false"; findings say what the evidence does or does not support.
Explained suggestions. Each confirmed finding can carry a minimal rewrite. Code checks every suggestion before it is shown: it must change the flagged words, stay in the same sentence and add no new claim, number, banned term or all-caps text.
Review workflow. Creators accept, edit or dismiss findings (a reason is required to dismiss a High one), then submit to a reviewer, who approves or requests changes. Every version, decision and check step is kept (append-only), so the audit trail is complete.
Image review. A creator uploads a JPEG, PNG or WebP creative for a chosen platform. Size, sharpness and brightness are measured, the AI reads the text and visible elements, and findings are drawn as boxes on the image.
Brands and workspaces. Anyone can register a new brand (Supabase sign-up) and becomes its admin, optionally with general starter rules. People who belong to several brands switch between them from the sidebar.
Insights. Most-cited rules, accept and dismiss rates, and a Clarity Score that points at brand rules people keep dismissing or overriding, which may be unclear.
Graceful degradation. If the AI is off or unavailable, the rule-based checks still run and the check says why the AI part did not.
How it fits together
sign in
REST /api/v1Bearer token
Browser
FrontendReact + ViteVercel
Supabase Auth
BackendFastAPIRender
Supabase Postgres
AI harnessLangGraph
OpenAIgpt-4o-mini

A brand check runs in the background and the frontend polls for the result:

intake guard
rule-based baseline
orchestrator plan
claims & evidence
brand consistency
accessibility
criticmay re-investigate
aggregate + gates
correctorsuggestions
intake guard: refuses drafts that are too long, not English, or try to instruct the AI.
gates: schema, citation, span and wording checks in code; anything that fails is rejected and recorded as a gate.rejected step, never shown.
Every step is stored in run_steps and available at GET /api/v1/checks/{id}/steps.
Repository layout
.
├── codebase/                 Backend, AI harness and database (Python)
│   ├── app/                  FastAPI app: auth, models, API routes
│   │   ├── api/              session, library, content, checks, findings, workflow,
│   │   │                     comments, insights, members, audit
│   │   └── brand_check.py    Runs the harness for a check and stores the findings
│   ├── harness/              AI harness: graph, orchestrator, specialists, critic, corrector,
│   │   └── prompts/          versioned prompts (<name>.v<N>.md; the highest version is used)
│   ├── gates/                Deterministic gates every finding must pass
│   ├── alembic/              Database migrations (0001 core tables, 0002 harness findings)
│   ├── schema.sql            Full schema for a new Supabase database
│   ├── migration_0002.sql    Upgrade for a database created from the 0001 schema
│   ├── scripts/smoke_api.py  End-to-end walk-through of the API
│   ├── tests/                Tests for the API, database rules and harness
│   └── README.md             Backend and database details
└── frontend/                 React 19 + Vite + Tailwind single-page app
    └── src/
        ├── services/api.ts       All backend calls
        ├── services/supabase.ts  Supabase sign-in client
        ├── context/              Signed-in user and app state
        ├── pages/                My Content, New Review, Review Workspace, Review Queue,
        │                         Brand Library, Insights, Team, Audit Log
        └── components/
Run it locally

You need Python 3.12+, Node.js 20+, and either a Supabase project or Docker (for a local Postgres).

1. Backend
bash
cd codebase
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1   macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
copy .env.example .env        # macOS/Linux: cp .env.example .env

Fill in codebase/.env (see Environment variables), then:

bash
alembic upgrade head          # creates or updates the tables (safe to run again)
uvicorn app.main:app --port 8000

Check http://localhost:8000/healthz ({"status":"ok"}) and http://localhost:8000/readyz ({"status":"ready"} means the database is connected). All routes are listed at http://localhost:8000/docs.

Using Supabase: for DATABASE_URL, use the Session pooler connection string (Supabase → Connect → Session pooler; host ends in pooler.supabase.com). The direct db.<project>.supabase.co address only works over IPv6 and fails on most networks and on Render. For a new database you can also paste codebase/schema.sql into the Supabase SQL editor instead of running Alembic; see codebase/README.md.

Using local Postgres: docker compose up -d in codebase/ and keep the default DATABASE_URL.

2. Brand library and accounts

The demo brand kit is for a fictional study-planner company, Lumio (45 entries: tone and messaging rules, approved facts, preferred terms and claim rules).

Demo mode (DEMO_MODE=true, local only): on start-up the backend creates a demo workspace with the Lumio kit, a sample draft and three accounts (creator, reviewer, admin) that need no password setup.
Real accounts: create users in Supabase (Authentication → Users → Add user), then link each to the Lumio organisation with a role. The role always comes from the database, never from the token:
bash
  python -m app.seed_loader --member <user-uid>,<email>,creator --member <user-uid>,<email>,reviewer --member <user-uid>,<email>,admin

Take each UID from Supabase → Authentication → Users. The command also loads the Lumio kit and is safe to run more than once. A user who signs in without a membership sees "Your account is not linked to an organisation yet."

3. Frontend
bash
cd frontend
npm install
copy .env.example .env        # macOS/Linux: cp .env.example .env
npm run dev                   # http://localhost:3000

With VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY set, the login page uses Supabase sign-in. With both empty, it uses the backend's demo accounts.

4. Check that everything works

With the backend running (in demo mode), in a second terminal:

bash
cd codebase
python scripts/smoke_api.py

It signs in, creates a draft, runs a check, accepts a suggestion, submits for review and reads the insights, and ends with SMOKE OK. It writes real rows, so run it against a local or demo database.

Run the tests with pytest -q from codebase/. Database tests only run against a local database and are skipped when DATABASE_URL points elsewhere, so they never touch live data.

Environment variables

Real values go only in codebase/.env, frontend/.env, Render and Vercel. The .env files are git-ignored; the .env.example files hold placeholders only. Never commit a key.

Backend (codebase/.env, Render)
Variable	Example	Notes
ENV	local	production on Render with real sign-in.
DEMO_MODE	true	Local only. Demo tokens let anyone act as admin, so the app refuses to start with DEMO_MODE=true and ENV=production.
DATABASE_URL	postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres	Supabase Session pooler. URL-encode @ # / : in the password.
CORS_ORIGINS	http://localhost:3000	Comma-separated, exact origins, no trailing slash. Add the Vercel URL in production.
SUPABASE_URL	https://<ref>.supabase.co	Used to verify sign-in tokens. Not a secret.
SUPABASE_JWT_AUDIENCE	authenticated	Always this value for Supabase.
SUPABASE_JWT_SECRET	(empty)	Only for older projects that still sign tokens with the legacy shared secret.
LLM_ENABLED	true	false runs rule-based checks only.
LLM_PROVIDER	openai	
LLM_MODEL	gpt-4o-mini	Default.
OPENAI_API_KEY	sk-...	Secret.
LLM_TIMEOUT_SECONDS, LLM_TEMPERATURE		Optional (defaults 20 and 0).

The backend does not use SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY; leave them out.

Frontend (frontend/.env, Vercel)
Variable	Example	Notes
VITE_API_URL	http://localhost:8000	The backend, without /api/v1 and without a trailing slash.
VITE_SUPABASE_URL	https://<ref>.supabase.co	Same as the backend's SUPABASE_URL.
VITE_SUPABASE_PUBLISHABLE_KEY	sb_publishable_...	Public key.

Every VITE_ value is built into the public website. Never put a secret key in one. Vite reads them at build time, so redeploy after changing them.

Deploy

Deploy the backend first (the frontend needs its URL), then the frontend, then tell the backend the frontend's address. Render and Vercel can only see repositories owned by the GitHub account connected to them; deploy from the owner's account or from a fork (sync the fork after each merge).

Backend on Render
New → Web Service → this repository, branch main.
Root Directory codebase, Runtime Docker (uses codebase/Dockerfile), Health Check Path /healthz.
Add the backend variables with ENV=production and DEMO_MODE=false.
Deploy, then open https://<service>.onrender.com/readyz.

The container runs alembic upgrade head on start, which does nothing when the database is already up to date. Render's free plan sleeps after 15 minutes without traffic and takes about a minute to wake; open /healthz before a demo.

Frontend on Vercel
Add New → Project → this repository.
Root Directory frontend, framework Vite (build npm run build, output dist).
Add the three frontend variables, with VITE_API_URL set to the Render URL.
Deploy.
Connect them
In Render, set CORS_ORIGINS to the Vercel URL (plus http://localhost:3000 for local work).
In Supabase → Authentication → URL Configuration, set the Site URL to the Vercel URL and add it to the Redirect URLs.
Troubleshooting
Symptom	Cause and fix
connection timeout to localhost:5432 at start-up	DATABASE_URL is missing or still the local example. Set the Supabase Session pooler string and restart.
failed to resolve host 'db.<ref>.supabase.co'	The direct connection string (IPv6 only). Use the Session pooler string.
WITHIN GROUP is required for ordered-set aggregate mode	Migration 0002 is missing in that database. Run alembic upgrade head or migration_0002.sql.
ConnectError ... actively refused from smoke_api.py	The backend is not running. Start uvicorn in another terminal first.
"Your account is not linked to an organisation yet"	Add the user with python -m app.seed_loader --member ....
401 on /api/v1/me after signing in	SUPABASE_URL on the backend does not exactly match VITE_SUPABASE_URL, or the backend was not restarted.
CORS error in the browser console	The frontend address is missing from CORS_ORIGINS, or has a typo or trailing slash.
A check ends as degraded	The AI review did not run; degraded_reason says why (for example a missing OPENAI_API_KEY or LLM_ENABLED=false). Rule-based findings are still shown.
Pages show sample data that is not in the database	The frontend could not reach the backend and fell back to its built-in data. Check VITE_API_URL and the browser's Network tab.
Known limitations
English text only; images, layout and visual brand checks are not covered yet.
Drafts cannot be deleted yet: content history is append-only for the audit trail.
Findings are only as good as the brand library. Vague rules give vague findings, which the Clarity Score helps to spot.
The API returns findings in the new shape (display_status, claim_outcome, origin, citations, suggestion) and, for now, also the older field names the frontend still reads (label, source_type, entry_code, suggestion_text). Remove the older names once the frontend types use the new ones.
