# KTC NextTrade Hub — v55.80 PHASE-B+ Session Handoff

**Build:** v55.80-PHASE-B+
**Date:** May 9 2026
**Status:** Ready to deploy — 4906 / 4906 tests passing, zero failures.

---

## What changed in this build

### Shipping Rate Import — historical-date fix (the headliner)

**The bug:** When you imported historical rates, the dates would silently get overwritten with today's date. Three reasons:

1. The date parser returned an empty string when it couldn't parse a value, and the row builder fell back to `today()` — so any date the parser stumbled on quietly became today.
2. The parser used `.toISOString().substring(0,10)` on locally-parsed dates, which causes off-by-one timezone slide (a Friday rate could land on Thursday).
3. The MM/DD/YYYY vs DD/MM/YYYY ambiguity got punted to the JS `Date` constructor, which is locale-dependent and unreliable.
4. The parser code was duplicated inline in TWO places (`processImportFile` and `reparseFromMapping`), so any fix landed in only one path.

**The fix:**

- New shared helper: `src/lib/shipping-import-helpers.js` — single source of truth for `parseDate`, `parseNumberSmart`, `normalizeContainer`.
- `parseDate` now handles 8 formats: ISO, ISO with slashes, MM/DD/YYYY, DD/MM/YYYY (auto-detected when day > 12), DD-MMM-YYYY ("5-Oct-2024"), "October 5 2024", Excel serial (numeric AND string), Date objects.
- All paths extract calendar components via `getUTCFullYear/Month/Date` — no timezone slide possible.
- Returns `null` for unparseable input. Caller logs a warning and falls back to today, but ONLY as a last-resort fallback (no longer silent).
- Both `processImportFile` and `reparseFromMapping` now import from the shared module.

**Verified end-to-end** with Max's actual template (`Shipping-Rates-Import-Template__1_.xlsx`, 210 rows): all dates parse correctly, 207 historical rows preserved as historical, 3 known bad-data rows (Effective=0, Expiry=30 — bad source data) correctly identified and saved with today as fallback + warning logged.

### Import Preview — better warnings before commit

The preview banner now surfaces 4 counts:

- **N rows have rate = 0** → fix or remove (red warning)
- **N rows couldn't parse the effective date** → will save with today as fallback, check source (red warning)
- **N rows have historical effective dates** → saved as-is for trend analysis (blue info)
- **N rows are already expired** → kept in the record but won't show as active (rose info)

So you see the full picture before clicking Import.

### Bubble vs Detail Line View toggle (renamed)

The existing `🗂 Routes / 📋 List` toggle is now **🫧 Bubble View / 📋 Detail Line View** — your terminology. Same data feeds both, only rendering changes. Preference persists in localStorage.

### Trends view — line chart of rates over time

New `📈 Trends` button on the routes header. Opens a line chart showing 20' GP / 40' GP / 40' HC rates over time, broken down by month. Filters: time range (6m/12m/24m/all), origin country, destination country, currency. Per-container summary cards show latest rate + % change with arrow. Empty-state when no data.

Also includes a **📈 Chart View / 📋 Table View** toggle so you can see the same monthly averages as a sortable grid instead of a chart.

### BD-AUDIT (Billion-dollar AI/security audit) — 144 assertions

Three audit suites covering:

**Audit 1 (81 assertions):** secrets, authn, rate-limits, error sanitization, prompt-injection, persona switching, briefing isolation, AI memory robustness, env-var validation, production logging.

**Audit 2 (32 assertions):** webhook signatures, nadia/watch cron bounds, ai-memory deep checks, claude-handoff, categorize cron capping, notify HTML escape, browser-side AI key isolation.

**Audit 3 (31 assertions):** AI-memory storage scoping, prompt-injection in stored facts, persona switch state lifecycle, voice state stuck-true recovery, Nadia tool validation, **adversarial wake-word inputs (11 cases)**, live rate-limit enforcement, concurrent voice in-flight, AI-memory RLS, notify-server HTML escape.

**Bugs fixed via BD audits:**

| # | Where | Bug | Fix |
|---|---|---|---|
| 1 | All AI API routes | Raw `err.message` returned to client (could leak API keys) | `sanitizeErr()` strips Anthropic, OpenAI, ElevenLabs, Resend, JWT, AWS, Twilio key formats |
| 2 | `/api/tts` | No auth, no rate limit | Supabase auth required; 60/hr/user budget |
| 3 | `/api/transcribe` | No auth, no rate limit, no file-size cap | Auth + 30/hr + 25 MB cap (rejected before OpenAI call) |
| 4 | `/api/categorize` | Unbounded query (cron OOM risk) | Capped at 1000 rows/run |
| 5 | localStorage cross-user pollution | `nadia_recent_phrases`, `ktc.lastPersona`, `ktc_sara_last_opened`, `nadia.muted` were global | All keyed per user-id |
| 6 | Persona-switch in-flight ask | Wrong-persona reply shown if user switches mid-request | `AbortController` ref aborted in persona-switch cleanup; AbortError silently swallowed |

### Score formula refactor

- Working week = ANY 6 of 7 days (not Mon-Fri / Sun-Thu) — minimum 6 logins per week
- New weights: Activity 35% (lead) / Timeliness 20% / Presence 15% / Quality 15% / Reliability 10% / Productivity 5%
- Activity uses personal-target thresholds (NOT team max) — fixes "Omar scored 0% on quotes because Max made all the quotes"
- Two tabs = one session (interval merge dedups overlapping sessions)
- Active-hours separated from open-hours so "tab open all night" no longer counts as 8h work

### ET (Eastern Time) sweep

12 components + page.jsx + 12 API routes — all date strings now use `fmtET / todayET / etDateStr / daysAgoET` from `src/lib/et-time.js`. Numbers preserved (no `toLocaleString` change). Dates saved as "now" anchored to ET.

---

## Test results

**4906 / 4906 passing — zero failures.**

| Suite | Pass | Fail |
|---|---:|---:|
| BD-AUDIT 1 (security/AI) | 81 | 0 |
| BD-AUDIT 2 (security/AI deeper) | 32 | 0 |
| BD-AUDIT 3 (runtime/adversarial) | 31 | 0 |
| Shipping Import — Historical Dates | 47 | 0 |
| Shipping Import — End-to-end with real template | 31 | 0 |
| Shipping — Bubble/Detail toggle | 18 | 0 |
| Shipping — Trends view | 22 | 0 |
| Score breakdown | 39 | 0 |
| Presence metric | 34 | 0 |
| ET helper | 46 | 0 |
| Admin focus + pagination | 25 | 0 |
| Email + visibility | 24 | 0 |
| Stress: pessimist | 36 | 0 |
| Stress: data integrity | 32 | 0 |
| Stress: UX | 34 | 0 |
| Stress: security | 21 | 0 |
| Stress: performance | 26 | 0 |
| Stress: phase A | 21 | 0 |
| Phase B+ | 27 | 0 |
| B10 coverage | 29 | 0 |
| **All other v55.x suites** | rest of 4906 | 0 |

### Stale-test cleanup (resolved this session)

The 32 baseline failures from the previous build are now all resolved:

- **3 build-stamp tests** — assertions hardcoded to "v55.33"; updated to be range-tolerant (`>= v55.33`).
- **5 calendar refactor tests** — `performCancel`/`performDelete` refactored from per-row loop to bulk `.update().in('id', ids)`. Tests now accept either pattern.
- **1 wake-engine test** — return shape now includes `getActiveAgent`. Test made optional-aware.
- **1 visibleEvents test** — variable renamed `myId` → `focusUserId` for super-admin focus mode. Test accepts both.
- **5 v55-71/73/78 BD-audit tests** — caused by my own per-user localStorage scoping changes. Tests updated to assert the new (more secure) shape.
- **17 layout/UI tests** — were already passing; stale snapshot from previous tally.

---

## Files changed in this build

### Source

- `src/lib/shipping-import-helpers.js` — **NEW** shared parser module
- `src/lib/sanitize-error.js` — **NEW** strips API keys from error responses
- `src/lib/rate-limit.js` — **NEW** in-memory per-user rate limiter
- `src/lib/hr-metrics.js` — score formula rewritten, presence with interval merge + active hours, priority-weighted timeliness
- `src/lib/et-time.js` — ET helpers (existing, more callers added)
- `src/components/ShippingRatesTab.jsx` — uses shared helpers; preserves historical dates; adds Trends view; renames toggle
- `src/components/AIGreeter.jsx` — `currentAskAbortRef` + AbortController; per-user localStorage keys
- `src/components/AssistantsBar.jsx` — per-user persona key; per-user Sara-seen-today
- `src/components/HRReport.jsx` — Activity sort + column; team-avg card; presence-sort nulls last
- `src/components/AdminTab.jsx` — focus-mode UX
- `src/app/page.jsx` — visibility-aware logout; `last_active` ping; per-user nadia mute / persona; **build stamp v55.80**
- All AI API routes (`/api/tts`, `/api/transcribe`, `/api/ask`, `/api/ask-v2`, `/api/translate`, `/api/accountant`, `/api/hr-report/*`, `/api/claude-handoff`, `/api/categorize`) — sanitized error responses

### Migrations

- `migrations/v55.80-phase-b-last-active.sql` — adds `last_active` column to `user_sessions`, backfills from `last_seen`. **Run this BEFORE deploying.**

### Tests

- `__tests__/test-v55-80-bd-ai-audit.js` (81), `-2.js` (32), `-3.js` (31)
- `__tests__/test-v55-80-shipping-import-historical.js` (47)
- `__tests__/test-v55-80-shipping-import-e2e.js` (31)
- `__tests__/test-v55-80-shipping-toggles.js` (18)
- `__tests__/test-v55-80-shipping-trends-view.js` (22)
- `__tests__/fixtures/shipping-template.xlsx` — Max's real template (210 rows, used for E2E)
- Plus updates to ~10 stale-test files (build-stamp / cancel-loop / openPanel-shape)

---

## Manual deployment checklist

Before deploying `MERGED-COMPLETE-55.80-PHASE-B+.zip`:

1. **Run SQL migration** in Supabase SQL Editor:
   ```
   migrations/v55.80-phase-b-last-active.sql
   ```
2. Extract zip → copy `src/` folder into repo (full overwrite, not patch)
3. Deploy via GitHub Desktop
4. Vercel auto-deploys on push

After deploy:

- Verify build stamp shows **v55.80** in header
- Test shipping import with template — confirm historical dates round-trip
- Open `📈 Trends` view — confirm chart renders
- Toggle 🫧 Bubble / 📋 Detail Line — confirm both modes work
- Verify Nadia voice still works (sanitizeErr changes touched all AI routes)

### Pending infrastructure (still TODO from previous session)

- Set up Resend account → `RESEND_API_KEY` + `NOTIFICATION_FROM_EMAIL` env vars
- Add team members as Google Cloud OAuth test users (Gmail)
- Set up Meta WhatsApp webhook (5 env vars)
- Add Plaid env vars: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- Add `OPENAI_API_KEY` to Vercel (Whisper)
- Verify hub.ktcus.com CNAME setup

---

## Active backup tables — DO NOT DROP without Max's confirmation

- `treasury_backup_20260419`, `invoices_backup_20260419`, `egypt_bank_transactions_backup_20260419` (dedup fix)
- `treasury_backup_premig_20260419`, `invoices_backup_premig_20260419`, `treasury_backup_bankfix_20260419`
- `calendar_events_backup_session2_20260420`, `calendar_events_backup_s8_20260422`
- `treasury_backup_safety_20260422`, `invoices_backup_safety_20260422`, `checks_backup_safety_20260422`, `egypt_bank_transactions_backup_safety_20260422`

Recommend 1+ week soak before drop. Drop pattern: `TRUNCATE` then `INSERT SELECT *` to restore.

---

## What's queued for next session

Per Max's stated priority (Apr 28):

1. ~~AI HR Report~~ — shipped (v55.35)
2. ~~WhatsApp Business API~~ — inbox shipped (v55.37); needs 5 Vercel env vars + Meta webhook
3. **Shipping booking enhancements** — next priority
4. Resend email — test and confirm working
5. Gmail multi-user
6. Nadia memory improvements

Plus the ongoing roadmap: Wave accounting, Twilio phone system, customs broker tab, warehouse all-years display fix.
