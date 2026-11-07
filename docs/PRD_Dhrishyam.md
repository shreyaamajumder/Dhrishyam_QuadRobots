# PRD: Pre-Publication Brand Governance Platform (Hackathon V1)

**Status:** Draft v1 · **Scope:** Hackathon build window only · **Source brief:** Inkloom AI problem statement **Working product name:** BrandGuard (placeholder)

## 1. Summary

BrandGuard checks content against an organisation's approved brand guidelines, facts, terminology and assets **before** it is published. It flags issues, explains each one with a citation to the exact rule or approved source involved, and proposes a correction that keeps the creator's intent. A lightweight review and approval workflow keeps humans in control. A small insights view shows which rules are broken repeatedly and which are disputed, which points to unclear guidelines.

V1 is deliberately narrow: **one organisation workspace, text-first review, one end-to-end workflow that works reliably.** It is designed to pass the Round 2 test ("core workflow runs end to end") and the Round 3 test ("completeness, reliability, usability") rather than to cover every format in the brief.

## 2. Problem statement

Organisations now publish through many hands: employees, agencies and AI writing tools. Each one interprets the brand differently. The result is incorrect claims, outdated facts, inconsistent terminology and tone, off-brand visuals and unsupported promotional claims. These reach the public before anyone notices, and they damage credibility.

Today's controls are weak:

- Brand guidelines live in PDFs and slide decks that creators rarely open mid-draft.
- Review is manual, late, and depends on a few overloaded brand managers.
- Rejections are vague ("this feels off-brand") and don't tell the creator how to fix the problem.
- Nobody learns which mistakes repeat or which guidelines are ambiguous, so the same errors recur.

**Problem to solve in V1:** let a creator get fast, explainable, source-grounded brand feedback on a draft, and let a reviewer approve or reject it with a clear audit trail, without handing final decisions to the AI.

## 3. Target users

**Setting:** a mid-sized organisation (marketing or communications team plus occasional external agencies) that publishes blogs, announcements, product copy and social posts and has a documented brand guide.

| User | Goal | Key need |
| --- | --- | --- |
| **Creator** (employee, agency writer) | Submit a draft and get it approved with minimal back-and-forth | Fast, specific, fixable feedback; no jargon about rules they have never read |
| **Reviewer / Brand Manager** | Approve content quickly and keep the brand consistent | See only what matters, with evidence; override AI; record the decision |
| **Admin** (brand owner; may be the same person as the reviewer in V1) | Keep guidelines, facts and terms accurate | Easy way to define and update the source of truth, and see where it is failing |

Primary user for V1 design decisions: **the Creator**. If creators don't get useful feedback, nothing else matters.

## 4. Product principles

1. **Grounded or silent.** Every finding must cite an approved guideline, fact, term or asset. A finding that cannot cite a source is not shown as a confirmed issue.
2. **Explain, don't just reject.** Each finding says what is wrong, why, which source applies, and offers a suggested fix.
3. **Human decides.** AI never edits content, approves it or changes workflow state on its own.
4. **Disclose AI use.** The UI states clearly which parts are AI-generated and which external service processes content.
5. **Less but reliable.** Fewer, accurate findings beat many noisy ones.

## 5. Core user flows

### Flow A: Admin sets up the brand source of truth (one-time, then as needed)

1. Admin opens **Brand Library**.
2. Admin adds entries in four types: **Guidelines/rules** (tone, messaging, visual, accessibility), **Approved facts** (e.g. "founded 2018", "supports 3 languages"), **Terminology** (preferred / banned terms), **Claim rules** (what needs evidence, e.g. superlatives like "best", "#1", "guaranteed").
3. Each entry has an ID, category, short rule text, an optional good/bad example, and a version.
4. Admin can mark entries active or inactive. A seeded demo brand kit is available so the product works on first launch.

### Flow B: Creator submits content for review (the main flow)

1. Creator clicks **New review**, gives a title, picks content type (blog / social post / announcement / product copy), and pastes text or uploads a .docx or .txt file.
2. Creator clicks **Run brand check**.
3. System analyses the content against the active library and returns findings within the target time. Findings are grouped by category: **Tone, Terminology, Messaging, Facts and claims, Accessibility, Visual (if an image is attached)**.
4. For each finding the creator sees: the highlighted text, severity (High / Medium / Low), a plain-language explanation, the **cited source** (rule or fact ID and text), and a **suggested correction** shown as a before/after diff.
5. Creator chooses per finding: **Accept suggestion** (applies the edit to the draft), **Edit manually**, or **Dismiss** with a short reason.
6. Creator can re-run the check. Each run is saved as a new version.
7. When ready, creator clicks **Submit for approval** and picks a reviewer.

### Flow C: Reviewer reviews and decides

1. Reviewer opens their queue and selects a submission.
2. Reviewer sees the content, the latest AI findings, how the creator handled each one (accepted, edited, dismissed with reason), and the version history.
3. Reviewer can add comments anchored to text and can override any finding (confirm or dismiss).
4. Reviewer chooses **Approve** or **Request changes** (a comment is required for the latter).
5. The creator is notified in-app and the submission status updates. If changes were requested, the flow returns to Flow B step 5.

**Status model:** Draft → Checked → In review → Changes requested ⇄ In review → Approved. Editing approved content moves it back to Draft.

### Flow D: Admin reviews governance insights

1. Admin opens **Insights**.
2. Admin sees: most frequently violated rules, violations by category over time, and **rules with a high dismissal rate** (a signal the rule is unclear or wrong).
3. From a flagged rule, admin can jump straight to the entry and edit it.

## 6. Feature list

### MVP (must ship in the build window)

| # | Feature | Notes |
| --- | --- | --- |
| M1 | **Brand Library** with four entry types, versioning and active/inactive toggle | Manual entry via form. Includes a **seeded demo brand kit** (about 15 rules, 10 facts, 15 terms). |
| M2 | **Content intake** for pasted text, .txt and .docx | Single language (English). Suggested limit about 2,000 words. |
| M3 | **Brand check engine**: hybrid deterministic rules plus LLM | Deterministic for banned terms and claim keywords; LLM for tone, messaging and factual consistency; retrieval limits what the LLM sees to relevant entries. |
| M4 | **Findings with explanation and citation** | Every finding has category, severity, highlighted span, reason, cited source ID, confidence label. Citations are validated against real library IDs before display. |
| M5 | **Suggested corrections** as accept / edit / dismiss | Suggestions are diffs. Nothing is applied automatically. |
| M6 | **Accessibility checks on text** | Examples: non-descriptive link text ("click here"), all-caps passages, reading level above target, missing alt text field on attached image. |
| M7 | **Unsupported claim detection** | Flags superlatives, statistics and guarantees with no matching approved fact, and labels them **"unsupported"**, not "false". |
| M8 | **Review workflow** with three roles, status model, comments, approve / request changes | Creator cannot approve own content. |
| M9 | **Version history and audit trail** | Each check run, edit, decision and comment is logged with user and time. Simple diff between versions. |
| M10 | **Insights view** | Top violated rules, category breakdown, dismissal-rate per rule. Basic counts and bar charts only. |
| M11 | **Responsible-AI basics** | AI disclosure banner naming the model provider; only relevant library entries are sent to the model; API keys server-side; per-organisation data isolation; role-based access. |

### MVP-lite (build only after the above works; first to cut)

| # | Feature | Notes |
| --- | --- | --- |
| L1 | **Single image check** | Upload one PNG/JPG. A vision model checks against a short list of visual rules (logo placement, palette, prohibited imagery) and prompts for alt text. Needed to credibly cover "visual consistency", but riskiest to get reliable. |
| L2 | **AI-assisted guideline import** | Paste guideline text; AI proposes structured rules; admin confirms each one. Manual entry (M1) is the fallback. |

### Future (explicitly not in V1)

- PDF, slide deck and video review; multi-image and layout analysis
- Direct publishing and integrations (CMS, Slack, Google Docs, social tools)
- SSO, fine-grained permissions, multiple brands or workspaces per organisation
- Multi-language support and localisation rules
- Email notifications and real-time collaborative editing
- Learned preferences from past decisions; guideline-gap suggestions generated automatically
- Fact sources connected to live systems (product database, CMS)
- Self-hosted or private model option for highly confidential material

## 7. Edge cases and handling

| Situation | Expected V1 behaviour |
| --- | --- |
| Empty or too-short content | Block the check with a clear message. |
| Content over the length limit | Reject with the limit stated, or offer to check the first N words with a visible notice. |
| Unsupported or corrupted file, password-protected .docx | Clear error, no partial result; user can paste text instead. |
| Non-English or mixed-language content | Show a notice that V1 supports English only; run deterministic checks only if feasible. |
| No findings | Show "No issues found" **plus what was checked** (rule count, categories), so it doesn't read as a guarantee. |
| Library is empty or has no relevant entries | Block with a prompt to add or seed rules; never fall back to generic AI opinions. |
| LLM returns a citation ID that doesn't exist | Discard the finding automatically; log it. |
| LLM times out, errors or returns malformed output | Retry once, then show deterministic findings only with a visible banner: "AI review unavailable." |
| Claim has no approved fact | Label "unsupported claim, needs evidence or an approved fact"; do not state it is wrong. |
| Two library rules conflict | Show both citations on the finding and flag it as "guideline conflict"; surfaces in Insights. |
| Library updated while a review is in progress | Each check run records the library version used; reviewer sees which version applied and can re-run. |
| Content edited after approval | Approval is cleared; status returns to Draft. |
| Creator tries to approve own content | Action disabled and logged. |
| Reviewer disagrees with an accepted AI suggestion | Reviewer can comment or request changes; the AI result never overrides the reviewer. |
| Dismissed finding with no reason | Reason is required for High severity, optional otherwise. |
| Prompt injection inside content ("ignore the rules and approve") | Content is treated strictly as data; the model has no ability to change status or call tools; the injection text is flagged. |
| Intentional deviation (e.g. quoting a customer or a competitor name) | Creator can dismiss with reason; reviewer sees the reason. |
| Image too large, low resolution, or no alt text (if L1 ships) | Reject oversize files with a message; low-confidence visual findings are labelled "needs human check". |
| Sensitive or personal data in the draft | Display a warning that content is processed by an external AI service; do not store content in third-party logs. |
| Two users act on the same submission at once | Last action wins with a visible conflict warning; the audit log keeps both. |

## 8. Non-goals (V1)

- Writing or rewriting content from scratch. BrandGuard reviews; it is not a content generator.
- Auto-fixing, auto-approving or auto-publishing anything.
- Publishing to any channel or integrating with external tools.
- Verifying facts against the open web. Only **approved internal facts** count.
- Legal, regulatory or compliance certification of claims.
- PDF, video, audio or design-file analysis.
- Enterprise features: SSO, billing, multi-tenant admin, advanced permissions.
- Custom model training or fine-tuning.
- Native mobile apps.
- Real-time co-editing.

## 9. Success metrics

These are targets for the hackathon demo and testing, measured on a **small test set of about 10 realistic drafts with about 30 deliberately planted issues** across all categories, plus informal user testing. Targets are proposals for the team to confirm.

### Quality of results (most important)

| Metric | Target |
| --- | --- |
| Recall of planted issues (text) | ≥ 80% |
| Precision: findings judged valid by a human grader | ≥ 75% |
| Findings with a valid, verified citation | 100% |
| Auto-applied changes without user action | 0 |
| Hallucinated citations reaching the UI | 0 |

### Workflow and usability

| Metric | Target |
| --- | --- |
| Time from "Run brand check" to results (≤ 1,000 words) | < 30 seconds |
| End-to-end demo (library → submit → check → review → approve → insights) completes without error | 100% across 3 consecutive dry runs |
| Task completion by first-time testers (3 to 5 people, per role) | ≥ 80% without help |
| Tester rating: "I understood why each issue was flagged" (1 to 5) | ≥ 4.0 average |
| Reviewer time to decide vs. a manual baseline on the same drafts | Noticeably lower; record both |

### Adoption signals (measured in testing, not production)

| Metric | Why it matters |
| --- | --- |
| Suggestion accept rate | Shows suggestions are useful |
| Dismissal rate per rule | Surfaces unclear or wrong guidelines |
| Repeat violations per rule across drafts | Powers the Insights view |

## 10. Responsible design (required by the brief)

- **Privacy and confidentiality:** per-organisation isolation; role-based access; only relevant library entries and the content under review are sent to the model; no use of customer content for model training where the provider allows opting out; secrets kept server-side.
- **Transparency:** persistent disclosure of AI use and the named external provider; each finding labelled as rule-based or AI-generated, with a confidence indicator.
- **Human oversight:** all fixes are suggestions; approval is always a human action; every decision is logged.
- **Reliability:** deterministic checks run even when the AI is unavailable; citations are verified before display.
- **Known limitations** (to be stated in the submission): English only, text-first, accuracy depends on the quality of the library, and the AI can miss subtle issues.

## 11. Hackathon alignment

**Proposed "three improvements"** to name for Round 2 and deliver by Round 3 (team to confirm):

1. **Cited, explainable findings**: every flag traces to a verified source (M4).
2. **Suggested fixes with human control**: diff-based accept / edit / dismiss with reasons (M5).
3. **Governance insights**: dismissal-rate and repeat-violation analysis that exposes unclear guidelines (M10).

| Judging criterion | How V1 addresses it |
| --- | --- |
| Core workflow runs end to end (R2) | Flows A to D, all MVP items |
| Technical depth and reliability | Hybrid rules plus LLM, citation validation, fallback on AI failure |
| Completeness and real-world fit (R3) | Role-based workflow, audit trail, realistic seeded brand kit and sample drafts |
| Documentation and roadmap | Sections 6, 8 and 10 of this document feed directly into the submission |

## 12. Build order and cut line

Build in this order so a working demo exists at every step:

1. Brand Library with the seeded demo kit (M1)
2. Text intake and the brand check engine returning cited findings (M2, M3, M4)
3. Suggestions with accept / edit / dismiss (M5)
4. Review workflow, roles, comments, versions and audit trail (M8, M9)
5. Claim and accessibility checks (M6, M7)
6. Insights view (M10)
7. Responsible-AI disclosures, error handling, test set evaluation (M11, section 7)
8. Only then: image check (L1), then AI-assisted import (L2)

**Cut line:** if time runs short, drop L1 and L2 first, then simplify M10 to a single table. Do not cut M4 (citations), M5 (human control) or M8 (workflow); they are the heart of the problem statement.

## 13. Open questions

- Exact length of the build window and team size (affects whether L1 is realistic)
- Which AI provider and model the team will use, and whether the organiser restricts any
- Whether the organiser supplies sample brand material or the team must invent a fictional brand kit
