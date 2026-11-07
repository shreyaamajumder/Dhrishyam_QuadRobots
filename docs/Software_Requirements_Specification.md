# Software Requirements Specification

## Dhrishyam: Pre-Publication Brand Governance Platform

**Standard:** ISO/IEC/IEEE 29148:2018 (supersedes IEEE 830-1998) · **Version:** 1.0 (Draft for team confirmation) · **Date:** 05 November 2026 · **Prepared by:** Product Management · **Scope:** Hackathon V1 · **Sources:** PRD v1, TRD v1 (working name "BrandGuard", now Dhrishyam)

| Rev | Date | Description |
| --- | --- | --- |
| 0.1 | 05 Nov 2026 | Consolidation of PRD and TRD |
| 1.0 | 05 Nov 2026 | First formal SRS baseline |

---

## 1. Introduction

### 1.1 Purpose

This SRS defines the functional, non-functional, interface and data requirements of **Dhrishyam**, so that developers, testers, judges and stakeholders share one verifiable description of what V1 must do. Requirements use "shall" (mandatory), "should" (desirable) and "may" (optional).

### 1.2 Scope

Dhrishyam checks draft content against an organisation's approved brand guidelines, facts, terminology and claim rules **before publication**. It flags issues, cites the exact approved source for each, proposes a minimal correction, and routes content through a human review and approval workflow. An insights view shows which rules are repeatedly broken or disputed, exposing unclear guidelines.

**In scope (V1):** one organisation workspace; English text content (paste, .txt, .docx); hybrid rule-engine plus LLM checking; cited findings; suggested fixes; three-role workflow; versioning and audit trail; insights; responsible-AI disclosures. Optional (MVP-lite): single-image check, AI-assisted guideline import.

**Out of scope:** content generation, auto-fix/approve/publish, publishing integrations, web fact-checking, legal certification, PDF/video/audio/design files, SSO, multi-tenant administration, billing, model training, native mobile apps, real-time co-editing, multi-language.

### 1.3 Definitions, acronyms, abbreviations

| Term | Meaning |
| --- | --- |
| Brand Library | Organisation's source of truth: rules, facts, terms, claim rules |
| Entry | One library item with a code (e.g. R-TONE-003) and version |
| Finding | A flagged issue with span, severity, explanation, citation and suggestion |
| Check run | One execution of the check engine on one content version |
| Grounding Gate | Validation stage (G1–G7) that discards ungrounded LLM findings |
| Library manifest | Entry id → version map recorded per check run |
| Unsupported claim | A claim with no matching approved fact (not asserted false) |
| Clarity Score | Per-rule metric combining dismissal and override rates |
| Degraded run | Run completed with deterministic findings only because AI failed |
| JWT / JWKS | JSON Web Token / its public key set; RBAC: role-based access control |
| LLM | Large language model |

### 1.4 References

1. PRD: Pre-Publication Brand Governance Platform (Hackathon V1), Draft v1
2. TRD: BrandGuard Technical Requirements (Hackathon V1), Draft v1
3. ISO/IEC/IEEE 29148:2018, Requirements engineering
4. ISO/IEC 25010:2011, Software quality models
5. WCAG 2.1 AA (accessibility of the product's own UI)
6. OWASP ASVS and OWASP Top 10 for LLM Applications (security guidance)

### 1.5 Document overview

Section 2 gives context and constraints; Section 3 lists specific requirements; Section 4 defines verification; appendices hold the state machine, traceability, and open issues.

---

## 2. Overall Description

### 2.1 Product perspective

Dhrishyam is a new, self-contained web application implemented as a **modular monolith**: a React single-page frontend, a single FastAPI backend, one PostgreSQL database (Supabase), and external LLM providers reachable only from the check module.

```
Browser (React SPA) --JWT/REST--> FastAPI backend
  modules: auth | library | content | checks | workflow | insights | audit
  --> PostgreSQL (Supabase)   --> Supabase Storage (L1)   --> Gemini / Groq (checks only)
```

### 2.2 Product functions (summary)

1. Maintain the Brand Library with versioned entries and a seeded demo kit.
2. Accept content (paste, .txt, .docx) as immutable versions.
3. Run hybrid brand checks (deterministic rules + one structured LLM call) gated by the Grounding Gate.
4. Present cited, explainable findings with before/after suggestions; creator accepts, edits or dismisses.
5. Enforce a human review workflow with comments, approval and rejection.
6. Record version history and an append-only audit trail.
7. Show governance insights and a Clarity Score.
8. Disclose AI use and protect confidentiality.

### 2.3 User classes

| Class | Description | Priority for design |
| --- | --- | --- |
| Creator | Employee or agency writer who submits drafts | **Primary** |
| Reviewer / Brand Manager | Approves or rejects, overrides findings | Secondary |
| Admin | Owns the library, roles and insights (may also be reviewer) | Secondary |
| Judge/Evaluator | Uses demo accounts and public API docs | Demo only |

### 2.4 Operating environment

- Client: current Chrome, Edge, Firefox, Safari (desktop); responsive down to tablet width.
- Server: Python 3.11+, FastAPI, Render free web service (Docker or Python runtime).
- Database/Auth/Storage: Supabase (PostgreSQL, Supabase Auth, private bucket).
- Frontend hosting: Vercel or Cloudflare Pages. AI: Gemini API (primary), Groq (fallback).

### 2.5 Design and implementation constraints

- **C-1** Modular monolith; no microservices, Kubernetes, Redis/Celery, vector DB, GraphQL, WebSockets or custom auth in V1.
- **C-2** All services shall be usable on free tiers without a credit card.
- **C-3** Backend: FastAPI, Pydantic v2, SQLAlchemy 2, Alembic. Frontend: React, Vite, TypeScript (JavaScript permitted), Tailwind, shadcn/ui, TanStack Query, Recharts, jsdiff.
- **C-4** Categorical columns use TEXT with CHECK constraints, not native enums.
- **C-5** Secrets exist only as backend environment variables; model name is configuration (`LLM_MODEL`).
- **C-6** Build order: Library → Check engine → Suggestions → Workflow → Claim/accessibility → Insights → Responsible-AI/eval → L1 → L2. **Cut line:** L1, L2 and M10 simplification go first; M4, M5, M8 shall not be cut.

### 2.6 Assumptions and dependencies

- **A-1** Demo uses a fictional brand kit and sample drafts only (free LLM tiers may expose content to the provider).
- **A-2** Free-tier quotas and model names change; limits are read from the team's own accounts at build time.
- **A-3** Supabase free projects pause after 7 days idle; Render free services cold-start. Keep-alive pings and pre-demo warm-up are required.
- **A-4** The organiser may or may not supply sample brand material (open issue OI-4).

### 2.7 Apportioning of requirements

MVP (must ship): M1–M11. MVP-lite (after MVP works): L1, L2. Future releases: Section 3.8.

---

## 3. Specific Requirements

Priority: **M** = Must, **S** = Should, **C** = Could (MVP-lite). Each requirement is atomic and testable (see Section 4).

### 3.1 External interface requirements

**3.1.1 User interfaces**

- UI-1 Pages: Login, Library, My Content, New Review, Review Workspace, Reviewer Queue, Insights.
- UI-2 The Review Workspace shall show content with highlighted spans (overlaps segmented), a findings panel grouped by category, and tabs for Versions, Comments and Timeline.
- UI-3 Each finding card shall show severity, explanation, cited source (code and text), provenance badge (**Rule engine** or **AI (model)**), confidence label, before/after diff, and Accept / Edit / Dismiss actions.
- UI-4 A persistent AI disclosure banner shall name the provider, model and data-use note from `GET /disclosure`.
- UI-5 Navigation shall be role-aware (convenience only; the server enforces permissions).
- UI-6 The product UI shall meet WCAG 2.1 AA basics: keyboard navigation, visible focus, contrast, ARIA labels.

**3.1.2 Hardware interfaces:** none.

**3.1.3 Software interfaces**

- SI-1 REST/JSON API under `/api/v1`, OpenAPI at `/docs`, Bearer JWT, list pagination via `limit` and `cursor`, async work returns 202.
- SI-2 Error format: `{"error":{"code","message","details","request_id"}}`.
- SI-3 `LLMProvider` interface implemented for Gemini and Groq; structured JSON output per contract in 3.2.4.
- SI-4 Supabase Auth (sign-in), PostgreSQL via connection string, Supabase Storage (L1).
- SI-5 Frontend types generated from the OpenAPI file (`openapi-typescript`).

**3.1.4 Communications:** HTTPS/TLS everywhere; the browser polls `GET /checks/{id}` every 2 s; no WebSockets.

### 3.2 Functional requirements

**3.2.1 Authentication and authorisation (AUTH)**

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-AUTH-1 | The system shall authenticate users via Supabase Auth and verify JWT signature and expiry on every request. | M |
| FR-AUTH-2 | The system shall read the user's role (creator, reviewer, admin) from the `memberships` table, not the token, so changes apply immediately (cache ≤ 60 s). | M |
| FR-AUTH-3 | Every route shall enforce `require_role`; every data access shall be scoped by `org_id` via a mandatory repository helper. | M |
| FR-AUTH-4 | Creators shall see only their own items; reviewers only items assigned to them; admins all items in the organisation. | M |
| FR-AUTH-5 | An admin shall be able to list members and change roles. | S |
| FR-AUTH-6 | When `DEMO_MODE=true`, three seeded accounts and a role switcher shall be available; the mode shall be disabled outside the demo environment. | S |

**3.2.2 Brand Library (LIB)** (PRD M1)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-LIB-1 | Admins shall create entries of type rule, fact, term and claim\_rule, each with unique code, category, title, body, check\_mode (deterministic or llm), optional pattern, good/bad example, default severity. | M |
| FR-LIB-2 | Every edit shall create a version snapshot and increment the organisation's `library_version`. | M |
| FR-LIB-3 | Admins shall activate and deactivate entries; inactive entries shall not be used in checks. | M |
| FR-LIB-4 | All roles shall be able to read entries and entry version history. | M |
| FR-LIB-5 | An idempotent seed shall load a demo kit of about 15 rules, 10 facts and 15 terms. | M |
| FR-LIB-6 | (L2) Admins shall paste guideline text, receive AI-proposed structured entries, and confirm each individually before saving. | C |

**3.2.3 Content intake and versioning (CNT)** (M2, M9)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-CNT-1 | Creators shall submit a title, content type (blog, social post, announcement, product copy) and text by paste or by `.txt`/`.docx` upload. | M |
| FR-CNT-2 | The system shall extract `.docx` as text only (macros ignored) and enforce a file-size and type allow-list. | M |
| FR-CNT-3 | The system shall reject empty/too-short content, and content over about 2,000 words (stating the limit or offering the first N words with a visible notice). | M |
| FR-CNT-4 | The system shall detect language; for non-English content it shall show an English-only notice and run deterministic checks only where feasible. | M |
| FR-CNT-5 | Each body change shall create a new **immutable** content version with its source (paste, upload, suggestion, manual). | M |
| FR-CNT-6 | The system shall show a diff between any two versions and a per-item timeline. | M |
| FR-CNT-7 | Corrupted, unsupported or password-protected files shall yield a clear error with no partial result. | M |

**3.2.4 Check engine (CHK)** (M3, M4, M6, M7)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-CHK-1 | `POST /content/{id}/checks` shall validate role, length and language, create a `queued` check run and return 202; processing shall be a background task. | M |
| FR-CHK-2 | The engine shall preprocess text (normalise, word count, language, sentence split). | M |
| FR-CHK-3 | The **rule engine** shall run deterministic entries: `banned_term`/`preferred_term`, `claim_pattern` (superlatives, guarantees, statistics), `fact_match`, `a11y_text` ("click here" links, ALL-CAPS runs, reading level above target, missing alt text field) and `system` (prompt-injection phrases, built-in SYS-001). | M |
| FR-CHK-4 | Deterministic rules with a `preferred` value shall supply their own replacement suggestion. | M |
| FR-CHK-5 | A claim (superlative, statistic, guarantee) with no matching approved fact shall be labelled `unsupported_claim` ("needs evidence or an approved fact") and never stated as false. | M |
| FR-CHK-6 | The **LLM pass** shall make one structured call judging tone, messaging and fact consistency using only active LLM-mode entries and approved facts relevant to the content. | M |
| FR-CHK-7 | The LLM shall return JSON: `entry_code`, `category` (tone, messaging, facts\_claims), `severity`, `span_text` (exact substring), `explanation`, `suggestion` (replacement for the span only), `confidence`. | M |
| FR-CHK-8 | Content shall be passed as delimited data; the model shall have no tools and no access to workflow or database layers; prompts shall be versioned files recorded in `engine_info`. | M |
| FR-CHK-9 | The **Grounding Gate** shall discard any LLM finding that fails: **G1** schema valid; **G2** entry code exists, active, in run manifest; **G3** span occurs verbatim (server computes offsets); **G4** category matches the entry; **G5** suggestion non-empty, differs from span, minimal (≤ \~2× span + 20 chars); **G6** suggestion passes the rule engine (no banned term or new unsupported claim); **G7** not a duplicate of a deterministic finding on the same span. Rejections shall be counted in `stats.rejected` and logged. | M |
| FR-CHK-10 | Findings with low confidence shall be labelled `needs_human_check`. | M |
| FR-CHK-11 | Two conflicting library rules affecting one span shall produce one finding carrying both citations, labelled `guideline_conflict`. | M |
| FR-CHK-12 | On 429/5xx/timeout the engine shall retry once, then use the fallback provider, within about 25 s total; if all fail, the run ends `degraded` with deterministic findings and an "AI review unavailable" banner. | M |
| FR-CHK-13 | Each run shall persist findings, library manifest, engine info, stats and a `cache_key`; identical content + manifest + prompt version shall return the cached result. | M |
| FR-CHK-14 | The system shall refuse to run when the library is empty or has no relevant entries, and shall never produce generic AI opinions. | M |
| FR-CHK-15 | When no findings result, the UI shall show "No issues found" plus what was checked (rule count, categories). | M |
| FR-CHK-16 | Stale `running` jobs shall be marked `failed` on startup. | M |
| FR-CHK-17 | (L1) A single PNG/JPG image shall be checked by a vision model against a short list of visual rules and prompt for alt text; oversize files rejected; low-confidence results labelled `needs human check`. | C |

**3.2.5 Findings and decisions (FND)** (M5)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-FND-1 | Every displayed finding shall have category, severity (High/Medium/Low), highlighted span, explanation, verified citation, label and provenance. | M |
| FR-FND-2 | A finding without a verifiable source shall never be shown as a confirmed issue. | M |
| FR-FND-3 | Creators shall Accept (server creates a new content version), Edit manually, or Dismiss each finding. | M |
| FR-FND-4 | A dismissal reason shall be mandatory for High severity and optional otherwise. | M |
| FR-FND-5 | The system shall never apply a change, approve content or alter workflow status without a human action. | M |
| FR-FND-6 | Decisions shall be append-only; the latest decision is the finding's current state. | M |
| FR-FND-7 | After an accepted suggestion the server shall shift later offsets; if text at a span no longer matches, it shall return `409 stale_finding`. | M |
| FR-FND-8 | Reviewers and admins shall confirm or override (dismiss) any finding. | M |
| FR-FND-9 | Creators shall re-run checks; each run applies to a specific content version. | M |

**3.2.6 Review workflow (WFL)** (M8)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-WFL-1 | The system shall implement the status machine in Appendix A in a single module. | M |
| FR-WFL-2 | Creators shall submit for approval and choose a reviewer; submission requires a decision on every High finding (to be confirmed, OI-1). | M |
| FR-WFL-3 | Reviewers shall see content, latest findings, creator decisions and reasons, version history, and the library version used. | M |
| FR-WFL-4 | Reviewers shall Approve or Request changes; a comment is mandatory for the latter. | M |
| FR-WFL-5 | A creator shall not approve or request changes on their own content; the attempt shall be disabled and logged. | M |
| FR-WFL-6 | Editing content in status checked, changes\_requested or approved shall return it to draft and clear approval, retaining history. | M |
| FR-WFL-7 | Users shall add comments, optionally anchored to a text range or finding. | M |
| FR-WFL-8 | Status changes shall create in-app notifications; users shall list and mark them read. | M |
| FR-WFL-9 | On concurrent actions on one submission the last action wins with a visible conflict warning; both are logged. | M |

**3.2.7 Audit (AUD)** (M9)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-AUD-1 | Every state-changing action (check run, edit, decision, comment, status change, library edit, role change) shall be written to an append-only audit log with actor, entity, payload and time. | M |
| FR-AUD-2 | Database triggers shall reject UPDATE and DELETE on `content_versions`, `finding_decisions`, `review_decisions` and `audit_log`. | M |
| FR-AUD-3 | Admins shall query the audit log by entity. | S |

**3.2.8 Insights (INS)** (M10)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-INS-1 | The system shall show the most violated rules and violations by category over time (counts and bar charts). | M |
| FR-INS-2 | The system shall show per-rule dismissal rate, override rate and **Clarity Score** (`0.6×dismissal + 0.4×override`, last 30 days, rules with ≥ 5 decided findings). | M |
| FR-INS-3 | Rules above a threshold (default 0.5) shall be marked "may be unclear", with guideline-conflict counts. | M |
| FR-INS-4 | Admins shall jump from a flagged rule to its library entry; reviewers have read-only access. | S |

**3.2.9 Responsible AI (RAI)** (M11)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-RAI-1 | AI use and external provider shall be disclosed persistently; each finding shall be labelled rule-based or AI-generated with confidence. | M |
| FR-RAI-2 | Only the content under review and relevant library entries shall be sent to a provider. | M |
| FR-RAI-3 | Prompt-injection text in content shall be flagged (SYS-001) and treated strictly as data. | M |
| FR-RAI-4 | The UI shall warn that content is processed by an external AI service and may be sensitive; the disclosure shall state free-tier data-use terms (resolves TRD note on PRD §10). | M |
| FR-RAI-5 | The product's known limitations (English only, text-first, library-dependent accuracy, AI may miss subtle issues) shall be stated in the UI help and submission. | S |

### 3.3 Use cases (summary)

| ID | Use case | Actor | Main success scenario |
| --- | --- | --- | --- |
| UC-1 | Set up brand source of truth | Admin | Open Library → add/seed entries → activate |
| UC-2 | Run brand check | Creator | New review → paste/upload → Run check → view cited findings |
| UC-3 | Resolve findings | Creator | Accept / edit / dismiss each → re-run → new version |
| UC-4 | Submit for approval | Creator | Pick reviewer → submit (guard passes) → status in\_review |
| UC-5 | Review and decide | Reviewer | Open queue → inspect findings and history → comment → approve or request changes |
| UC-6 | Review governance insights | Admin | Open Insights → inspect high-dismissal rules → edit rule |

### 3.4 Performance requirements

- **NFR-PERF-1** Results for content ≤ 1,000 words shall appear within 30 s of "Run brand check" (95% of runs on the demo environment, warm).
- **NFR-PERF-2** Non-AI endpoints shall respond within 500 ms at the 95th percentile with ≤ 20 concurrent users.
- **NFR-PERF-3** Deterministic findings shall be produced within 2 s for 2,000 words.
- **NFR-PERF-4** Capacity: one organisation, tens of users, a few hundred checks per day.

### 3.5 Security and privacy requirements

- **NFR-SEC-1** Per-organisation isolation by mandatory `org_id` scoping; RLS is an optional later hardening.
- **NFR-SEC-2** Secrets only in backend environment; frontend holds only the public Supabase URL and anon key.
- **NFR-SEC-3** Logs contain request ids, sizes, timings and error codes, **never content or prompts**.
- **NFR-SEC-4** Uploads: size limit, type allow-list, docx parsed as text; attachments in a private bucket with signed URLs.
- **NFR-SEC-5** Per-user rate limit on check endpoints to protect quota.
- **NFR-SEC-6** The LLM module shall have no access to workflow or database layers.
- **NFR-SEC-7** Only HTTPS shall be served; inputs validated by Pydantic; OWASP Top 10 mitigations applied.

### 3.6 Software quality attributes

| Attribute | Requirement |
| --- | --- |
| Reliability | NFR-REL-1: deterministic checks run even when AI is unavailable. NFR-REL-2: 100% of displayed LLM findings carry a verified citation; 0 hallucinated citations reach the UI. NFR-REL-3: end-to-end demo passes in 3 consecutive dry runs. |
| Availability | NFR-AVL-1: best effort on free tiers; keep-alive pings for Supabase and Render and a pre-demo health check (`GET /health`). |
| Accuracy | NFR-ACC-1: recall ≥ 80% and precision ≥ 75% on the golden set (≈10 drafts, ≈30 planted issues). NFR-ACC-2: 0 auto-applied changes. |
| Usability | NFR-USA-1: ≥ 80% task completion by first-time testers without help. NFR-USA-2: average rating ≥ 4.0/5 for "I understood why each issue was flagged". NFR-USA-3: findings use plain language, no unexplained jargon. |
| Maintainability | NFR-MNT-1: Alembic migrations from day one; NFR-MNT-2: typed API contracts; NFR-MNT-3: Ruff + pytest + frontend type check in CI on every push; NFR-MNT-4: prompts versioned in files. |
| Portability | NFR-PRT-1: provider swappable via `LLMProvider` and configuration; DB via plain connection string. |
| Auditability | NFR-AUD-1: every run is reproducible from stored manifest, prompt version and model. |
| Scalability | NFR-SCL-1: design shall allow later upgrades (job table with SKIP LOCKED, pgvector, chunking, RLS) without redesign; none built in V1. |

### 3.7 Logical data requirements

PostgreSQL, UUID keys, `timestamptz`, `org_id` on every tenant table.

| Entity | Key attributes |
| --- | --- |
| organizations | id, name, library\_version |
| profiles | id (= auth user), email, display\_name |
| memberships | org\_id, user\_id, role; unique (org, user) |
| brand\_entries / brand\_entry\_versions | code (unique per org), entry\_type, category, body, check\_mode, pattern, is\_active, current\_version; snapshot per edit |
| content\_items / content\_versions | status, reviewer\_id, current\_version\_no; immutable body\_text, source |
| attachments (L1) | storage\_path, mime, size\_bytes, alt\_text |
| check\_runs | status (queued, running, completed, degraded, failed), library\_manifest, engine\_info, cache\_key, stats, error |
| findings | category, severity, source\_type, entry\_id, entry\_version, secondary\_entry\_id, span\_start/end/text, explanation, suggestion\_text, confidence, label |
| finding\_decisions | action (accepted, edited, dismissed, confirmed, overridden), reason, resulting\_version\_id (append-only) |
| comments, review\_decisions, notifications, audit\_log | per TRD §7 |

Required indexes: findings(check\_run\_id), findings(entry\_id), content\_items(org\_id,status), brand\_entries(org\_id,is\_active), audit\_log(org\_id,created\_at), check\_runs(cache\_key).

### 3.8 Future (not V1)

PDF/slide/video review; multi-image and layout analysis; CMS, Slack, Google Docs integrations and publishing; SSO and fine-grained permissions; multiple brands per organisation; multi-language; email notifications; real-time co-editing; learned preferences and auto guideline-gap suggestions; live fact sources; private model option for confidential material.

---

## 4. Verification

### 4.1 Methods

- **Unit tests (pytest):** every deterministic rule type, Grounding Gate G1–G7 with crafted bad LLM outputs, state machine, role guards, offset shifting.
- **Contract tests:** `LLMProvider` with a fake provider (no quota used).
- **Evaluation harness:** `make eval` on the golden JSONL set reports recall, precision, citation validity, gate rejections and latency; output stored in the repo.
- **End-to-end script:** Flows A–D against a local stack; three consecutive clean runs.
- **Usability test:** 3–5 testers per role; task completion and understanding rating.
- **CI:** Ruff, pytest, frontend type check on every push.

### 4.2 Acceptance criteria (Release 1.0)

1. Library → submit → check → review → approve → insights completes with no error, 3 times in a row.
2. Citation validity 100%; hallucinated citations in UI 0; auto-applied changes 0.
3. Recall ≥ 80%, precision ≥ 75% on the golden set.
4. Check latency < 30 s for ≤ 1,000 words.
5. All edge cases in Appendix C behave as specified.

---

## Appendix A. Status state machine

| From | Event | To | Actor | Guard |
| --- | --- | --- | --- | --- |
| draft | check completes | checked | system | latest version checked |
| checked | submit | in\_review | creator | every High finding decided (OI-1) |
| in\_review | request changes | changes\_requested | reviewer | comment required; reviewer ≠ creator |
| changes\_requested | edit/re-check, resubmit | in\_review | creator | same as submit |
| in\_review | approve | approved | reviewer | reviewer ≠ creator |
| checked / changes\_requested / approved | edit body | draft | creator | approval cleared, history kept |

## Appendix B. Role–capability matrix

| Capability | Creator | Reviewer | Admin |
| --- | :-: | :-: | :-: |
| Create content, run checks, decide own findings, submit | ✓ |  | ✓ |
| Comment | ✓ | ✓ | ✓ |
| Override findings, approve, request changes |  | ✓ | ✓ |
| Edit library, manage roles |  |  | ✓ |
| View insights |  | read | ✓ |

## Appendix C. Edge-case requirements

| ID | Situation | Required behaviour | Covered by |
| --- | --- | --- | --- |
| EC-1 | Empty/short content | Block with message | FR-CNT-3 |
| EC-2 | Over length | Reject or truncate with notice | FR-CNT-3 |
| EC-3 | Bad/protected file | Clear error, paste fallback | FR-CNT-7 |
| EC-4 | Non-English | Notice; deterministic only | FR-CNT-4 |
| EC-5 | No findings | Show what was checked | FR-CHK-15 |
| EC-6 | Empty library | Block with prompt to add/seed | FR-CHK-14 |
| EC-7 | Invalid citation from LLM | Discard and log | FR-CHK-9 |
| EC-8 | LLM failure | Retry, fallback, degraded banner | FR-CHK-12 |
| EC-9 | Claim without fact | Label unsupported | FR-CHK-5 |
| EC-10 | Conflicting rules | Dual citation, conflict label | FR-CHK-11 |
| EC-11 | Library changed mid-review | Manifest shows version used; re-run allowed | FR-CHK-13 |
| EC-12 | Edit after approval | Back to draft | FR-WFL-6 |
| EC-13 | Self-approval | Disabled and logged | FR-WFL-5 |
| EC-14 | Dismissal without reason | Required for High | FR-FND-4 |
| EC-15 | Prompt injection | Flag, treat as data | FR-RAI-3 |
| EC-16 | Sensitive data | External-processing warning | FR-RAI-4 |
| EC-17 | Concurrent actions | Last wins, warning, both logged | FR-WFL-9 |
| EC-18 | Image issues (L1) | Reject oversize; needs human check | FR-CHK-17 |

## Appendix D. Traceability (PRD → SRS)

| PRD item | SRS requirements |
| --- | --- |
| M1 Library | FR-LIB-1…5 |
| M2 Intake | FR-CNT-1…7 |
| M3 Engine | FR-CHK-1…8, 12…16 |
| M4 Cited findings | FR-CHK-9, FR-FND-1, 2 |
| M5 Suggestions | FR-FND-3…9 |
| M6 Accessibility | FR-CHK-3 (a11y\_text) |
| M7 Unsupported claims | FR-CHK-3, 5 |
| M8 Workflow | FR-WFL-1…9, FR-AUTH |
| M9 Versions and audit | FR-CNT-5, 6, FR-AUD-1…3 |
| M10 Insights | FR-INS-1…4 |
| M11 Responsible AI | FR-RAI-1…5, NFR-SEC |
| L1 / L2 | FR-CHK-17 / FR-LIB-6 |

## Appendix E. Open issues

| ID | Issue | Owner |
| --- | --- | --- |
| OI-1 | Confirm submit guard (all High findings decided) | Product |
| OI-2 | Confirm Gemini primary / Groq fallback against current free-tier limits | Engineering |
| OI-3 | TypeScript vs JavaScript decision (affects generated types) | Engineering |
| OI-4 | Organiser-supplied brand material or fictional kit (affects golden set) | Product |
| OI-5 | Align PRD §10 wording on provider training opt-out with free-tier reality | Product |
| OI-6 | Build window and team size (decides whether L1 is feasible) | Team |
