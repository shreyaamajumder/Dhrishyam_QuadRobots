# Dhrishyam – UX Screen Breakdown (V1)

**Role:** Senior UX · **Basis:** PRD v1, TRD v1, SRS v1.0 · **Principle:** minimal, task-first, evidence beside every claim. Primary persona is the **Creator**; Reviewer and Admin views reuse the same components with different density and permissions.

## 1. Design principles

1. **One job per screen.** Creator: fix the draft. Reviewer: decide. Admin: maintain the source of truth.
2. **Evidence before verdict.** No finding appears without its cited rule, provenance badge and suggested fix.
3. **Human control is visible.** AI never applies anything; every state change is a labelled button the user pressed.
4. **Status is always on screen.** Content status, check status and library version are never hidden.
5. **Same component, different permissions.** Roles change which actions are enabled, not the layout. Unavailable actions are hidden if irrelevant, disabled with a tooltip reason if the user could reasonably expect them.
6. **Calm visual system.** One accent colour, neutral greys, severity shown by icon + label + colour (never colour alone). 8 px spacing grid, 14–16 px body text, system font stack, WCAG 2.1 AA contrast, full keyboard support, visible focus ring.

## 2. Information architecture and navigation

**Shell:** left sidebar (collapsible to icons below 1024 px), top bar, content area. Top bar: breadcrumb · AI disclosure chip (always) · notifications bell · user menu (role, sign out; in demo mode a role switcher).

| Nav item | Creator | Reviewer | Admin |
| --- | :-: | :-: | :-: |
| My content | ✓ |  | ✓ |
| New review | ✓ |  | ✓ |
| Review queue |  | ✓ | ✓ |
| Library | read | read | edit |
| Insights |  | read | ✓ |
| Team (members, roles) |  |  | ✓ |
| Audit log |  |  | ✓ |

Default landing: Creator → My content; Reviewer → Review queue; Admin → Insights.

## 3. Screen list

| ID | Screen | Roles | Priority |
| --- | --- | --- | --- |
| S01 | Login | all | M |
| S02 | My content | Creator, Admin | M |
| S03 | New review (intake) | Creator, Admin | M |
| S04 | Review workspace (core) | all, mode varies | M |
| S05 | Submit for approval (dialog) | Creator | M |
| S06 | Review queue | Reviewer, Admin | M |
| S07 | Reviewer decision panel (inside S04) | Reviewer, Admin | M |
| S08 | Library list | all (edit: Admin) | M |
| S09 | Library entry editor (side panel) | Admin | M |
| S10 | Insights | Admin, Reviewer (read) | M |
| S11 | Notifications (popover) | all | M |
| S12 | Team and roles | Admin | S |
| S13 | Audit log | Admin | S |
| S14 | AI disclosure and limitations (modal/page) | all | M |
| S15 | System pages: 403, 404, offline, session expired | all | M |
| S16 | Guideline import (L2) | Admin | C |

## 4. Shared components

| Component | Behaviour |
| --- | --- |
| **StatusBadge** | draft, checked, in review, changes requested, approved. Icon + text. |
| **SeverityTag** | High / Medium / Low with icon. |
| **ProvenanceBadge** | "Rule engine" or "AI · model name"; confidence label; "Needs human check" for low confidence. |
| **CitationChip** | Entry code (e.g. R-TONE-003); click opens a popover with rule text, version, example, link to Library entry. Conflicts show two chips. |
| **FindingCard** | Collapsed: severity, category, span snippet, one-line reason. Expanded: full explanation, citation, before/after diff, actions Accept / Edit / Dismiss, decision history. |
| **DiffView** | Inline before/after for suggestions; side-by-side for version compare. |
| **HighlightedText** | Spans coloured by severity (underline style plus colour), overlaps segmented, click selects the finding and scrolls the panel. |
| **DataTable** | Sortable, filterable, cursor pagination, keyboard row navigation, sticky header. |
| **ConfirmDialog** | Used for irreversible or status-changing actions; names the consequence. |
| **Toast / InlineAlert** | Toast for success (auto-dismiss 5 s); inline alert for errors (persist until fixed). |
| **EmptyState** | Icon, one-line explanation, one primary action. |
| **Skeleton** | Loading placeholders matching final layout; no spinners over 1 s without text. |

**Global rules:** every async action shows a pending state and disables its trigger; every error shows what happened, what is preserved, and the next action; request id is available under "Details" for support; unsaved text prompts before leaving.

---

## 5. Screen specifications

### S01 Login

**Layout:** centred card (max 400 px) → product name → form → footer link to disclosure. **Components:** email, password, Sign in button, optional Google button, "Forgot password" link. Demo mode: three "Continue as Creator / Reviewer / Admin" buttons. **Interaction:** Enter submits; on success route to role landing; remember intended deep link. **Empty:** n/a. **Errors:** wrong credentials ("Email or password is incorrect", no field leak); network failure (inline alert + retry); account has no organisation membership ("Ask your admin to add you"); session expired returns here with a notice and restores the previous route after sign-in.

### S02 My content

**Layout:** page header (title, **New review** primary button) → filter bar (status chips, search, "Mine/All" for Admin) → DataTable. **Columns:** title, type, status, latest check (time, issue counts by severity), reviewer, updated. **Interaction:** row click opens S04; status chip filters; row menu: Open, Duplicate as draft, Delete draft (only draft, confirm). Changes-requested rows show a highlighted "Reviewer comments" link. **Empty:** no content → "No drafts yet. Check your first piece of content against your brand rules." + New review. Filtered-empty → "No results" + clear filters. **Errors:** list load failure → inline alert with Retry, table kept blank; stale data after action → refetch silently.

### S03 New review (intake)

**Layout:** single column form (max 720 px): title → content type select → input tabs (**Paste text** | **Upload file**) → live word counter → footer actions (**Run brand check** primary, Save draft secondary). **Components:** text area, drop zone (.txt, .docx, size limit stated), counter ("842 / 2,000 words"), language notice, privacy note ("Content is processed by an external AI service" with link to S14). **Interaction:** upload extracts text into the editor (editable); Run check is disabled until title and ≥ minimum words; on click creates draft + version, starts a check, routes to S04 in running state. **Empty:** empty form with helper text and sample-content link in demo mode. **Errors:** empty or too short (inline under field); over limit (count turns red, offer "Check first 2,000 words" with visible notice); unsupported, corrupted or password-protected file ("We couldn't read this file. Paste the text instead.", text area keeps focus); non-English (warning, deterministic checks only); library empty (blocking banner: Admin sees "Add rules" link, others see "Ask an admin to set up the Brand Library").

### S04 Review workspace (core screen)

**Layout (desktop, 3 zones):**

1. **Header bar:** back, title, StatusBadge, version selector (v3 ▾), library version used, **Run brand check / Re-run**, primary role action (Submit for approval or Approve / Request changes).
2. **Left, main (≈ 60%): Document pane** with HighlightedText; toggle "Edit text" (switches to editable mode; saving creates a new version and returns to draft).
3. **Right (≈ 40%): tabs** — **Findings** (default) · Versions · Comments · Timeline.

**Findings tab:** run summary strip (counts by severity; "12 rules checked, 6 categories"; engine info) → category filter chips (Tone, Terminology, Messaging, Facts and claims, Accessibility, Visual) → FindingCards sorted by severity then position → "Dismissed (n)" collapsible group. **Mobile/tablet (< 1024 px):** panes stack with a segmented control "Document | Findings".

**Interaction logic:**

- Click highlight ↔ card: selecting either scrolls and focuses the other. Keyboard: J/K next/previous finding, A accept, D dismiss, E edit.
- **Accept:** server creates a new version, document refreshes, remaining spans shift; toast with **Undo** (creates another version restoring the previous text).
- **Edit:** inline editable text of the suggestion; saving records "edited".
- **Dismiss:** inline reason field; mandatory for High, optional otherwise.
- **Run/Re-run:** button turns to progress state; polling every 2 s; findings panel shows skeleton cards plus "Rule checks done, AI review in progress" as deterministic results arrive first.
- **Unsupported claim** cards use neutral wording: "Needs evidence or an approved fact" (never "false").
- Changing text after a check marks the run "Outdated" with a Re-run prompt.
- Role modes: **Creator** sees Accept/Edit/Dismiss and Submit. **Reviewer** sees creator decisions and reasons on each card, plus Confirm / Override; creator-only actions are hidden. **Admin** has both sets. Creator never sees Approve on own content (disabled with tooltip "You can't approve your own content" for Admin-creators).

**Empty states:** before first check → document shown, findings panel says "Run a brand check to see issues with cited rules."; no findings → "No issues found" + what was checked + note that this is not a guarantee; no comments; no versions beyond v1. **Error states:**

- Check failed → inline alert in Findings tab: "The check couldn't complete. Your text is saved." + Retry.
- Degraded run → amber banner "AI review unavailable — showing rule-based findings only" + Re-run later.
- Library empty or no relevant entries → check blocked, links to Library.
- Stale finding (text changed) → card shows "This suggestion no longer matches the text" with Re-run; actions disabled.
- Edit conflict (another user acted) → banner "Updated by Priya at 10:42. Reload" and the user's unsaved input is kept in a copy box.
- Timeout > 30 s → message "Taking longer than usual" with Keep waiting / Cancel.
- Injection phrase detected → High finding citing SYS-001.
- (L1) Image: oversize/unsupported rejected inline; low-confidence visual findings tagged "Needs human check"; missing alt text field flagged.

### S05 Submit for approval (dialog)

**Layout:** modal: title → reviewer select (only users with Reviewer/Admin role, not self) → checklist summary ("All High findings decided: 3 of 3") → optional note → Cancel / **Submit**. **Interaction:** Submit disabled while any High finding is undecided; the checklist item links to the first one. On success status becomes In review; toast; Creator returns to S02 or stays read-only on S04. **Empty:** no eligible reviewer → "No reviewers available. Ask an admin to assign the Reviewer role." **Errors:** version outdated (needs re-check) → explain, offer Re-run; submission conflict → refresh; network failure → inline, dialog stays open.

### S06 Review queue

**Layout:** header → tabs (**Awaiting me** · Decided · All for Admin) → DataTable. **Columns:** title, creator, type, submitted time, High/Med/Low counts, creator-dismissed count, library version, waiting time (highlight oldest). **Interaction:** row opens S04 in reviewer mode; sort default oldest first; filters by creator and severity. **Empty:** "Nothing waiting for review." **Errors:** load failure with Retry; item reassigned or withdrawn while open → notice and return to queue.

### S07 Reviewer decision panel (in S04)

**Layout:** sticky footer in the right pane: Comment box → **Request changes** (secondary) and **Approve** (primary). **Interaction:** Approve opens ConfirmDialog ("Approve version 3? Approval is cleared if the text changes."); Request changes requires a comment (button disabled until entered); comments can be anchored by selecting text; Override on a finding records reason and updates insights data. **Empty:** no comments yet. **Errors:** same-user block (disabled + logged); concurrent decision → conflict banner showing who acted last.

### S08 Library list

**Layout:** header (title, library version, **Add entry** for Admin) → tabs by type (Rules · Facts · Terms · Claim rules) → filter bar (category, active, search) → DataTable. **Columns:** code, title/summary, category, check mode (Rule engine / AI), severity default, version, active toggle (Admin), updated. **Interaction:** row opens S09 in a side panel; toggle active shows ConfirmDialog stating impact ("Future checks will ignore this rule"); non-admins get read-only rows. **Empty:** Admin → "Your Brand Library is empty" + **Load demo kit** and **Add entry**; others → read-only message. Filter-empty → clear filters. **Errors:** load failure + Retry; seeding failure → inline alert, safe to retry (idempotent).

### S09 Library entry editor (side panel)

**Layout:** panel (480 px) with tabs **Details** and **History**. Details: type, code (unique), category, title, rule text, check mode, pattern/term fields (preferred and banned values), default severity, good and bad example, active toggle. Footer: Cancel / **Save new version**. **Interaction:** live preview "Test against sample text" for deterministic patterns; Save asks for a short change note, increments library version, toast; History tab lists versions with diff and who changed. **Empty:** history shows only v1. **Errors:** duplicate code, invalid pattern (field-level message), required field missing; save conflict ("Edited by someone else—review changes"); non-admin opens read-only view with a note.

### S10 Insights

**Layout:** header with period selector (7/30/90 days) → KPI row (checks run, findings, accept rate, dismiss rate) → two-column charts: **Most violated rules** (horizontal bar), **Violations by category over time** (stacked bar) → table **Rules that may be unclear** (code, findings, dismissal rate, override rate, Clarity Score with plain-language explanation tooltip, conflicts). **Interaction:** click a rule row opens its Library entry (Admin) or read-only view (Reviewer); chart bars filter the table; "How is Clarity Score calculated?" opens an info popover. **Empty:** "Not enough data yet. Insights appear after rules have 5 or more reviewed findings." with checks-run count shown. **Errors:** a failed widget shows its own retry without blanking the page; zero-denominator values show "—" not 0%.

### S11 Notifications (popover)

**Layout:** bell with unread count → popover list (event text, item title, time) → "Mark all read". **Interaction:** click opens the item and marks read. **Empty:** "You're all caught up." **Error:** "Couldn't load notifications" + Retry.

### S12 Team and roles (Admin)

**Layout:** table (name, email, role select, last active). **Interaction:** role change via select + ConfirmDialog; cannot remove the last Admin. **Empty:** n/a (always ≥ 1 user). **Errors:** last-admin block with explanation; save failure reverts the select.

### S13 Audit log (Admin)

**Layout:** filter bar (entity, actor, action, date) → read-only DataTable (time, actor, action, entity, details expander) → export CSV. **Empty:** "No events match these filters." **Errors:** load failure + Retry. No edit or delete controls exist.

### S14 AI disclosure and limitations

**Layout:** modal opened from the top-bar chip: what is AI-generated, provider and model name, data-use note (free-tier terms), what is sent (content and relevant rules only), what is never done (no auto-apply or approve), known limitations (English only, text-first, depends on library quality, can miss subtle issues). **Error:** if disclosure fails to load, show a static fallback text and a retry link.

### S15 System pages

- **403:** "You don't have access to this." + go to home. **404:** "We can't find that." + home.
- **Offline:** top banner "You're offline. Changes will not be saved"; actions disabled.
- **Session expired:** modal prompting sign in, draft text preserved locally for the session.
- **Server error:** generic message, request id, Retry.

### S16 Guideline import (L2, Admin)

**Layout:** stepper: Paste text → Review proposed entries (table with editable rows and per-row Accept/Reject) → Save. **Interaction:** nothing saves until each accepted row is confirmed; AI badge on proposals. **Empty:** instructions. **Errors:** AI unavailable → fallback link to manual entry; unparsable output → "No rules found" with guidance.

---

## 6. Core interaction flows (screen path)

| Flow | Path |
| --- | --- |
| Admin setup | S08 → Load demo kit / S09 → activate entries |
| Creator check and fix | S03 → S04 (run) → decide findings → re-run → S05 |
| Reviewer decision | S11/S06 → S04 reviewer mode → S07 → notification to creator |
| Rework loop | S02 (changes requested) → S04 → fix → S05 |
| Governance | S10 → flagged rule → S09 |

## 7. Status-driven UI rules

| Status | Creator can | Reviewer can | Document |
| --- | --- | --- | --- |
| Draft / Checked | edit, check, decide, submit | view | editable |
| In review | withdraw view-only | comment, override, decide | read-only |
| Changes requested | edit, re-check, resubmit | comment | editable |
| Approved | view; editing resets to Draft with confirm | view | read-only (edit shows confirm: "This clears approval") |

## 8. Accessibility and quality checklist

- Full keyboard path for the core flow; focus moves to results region when a check completes; polling updates announced via `aria-live="polite"`.
- Highlights use underline pattern plus colour; severity has text label.
- Tap targets ≥ 40 px; reflow at 320 px for text content; respects reduced motion.
- Plain-language copy: reason first, rule code second; no jargon ("citation", "manifest") in user-facing text.
- Performance targets: first paint of S04 < 2 s; findings rendered progressively; table pagination at 25 rows.

## 9. Scalability notes

The shell, DataTable, FindingCard and EmptyState are reused across screens, so adding PDF or image formats means a new document-pane renderer, not new screens. Navigation items are role-driven from one config, enabling future roles (e.g. Legal reviewer) or multiple brands via a workspace switcher in the sidebar header. Deferred screens: workspace switcher, email notification settings, integrations.
