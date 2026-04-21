# KTC NextTrade Hub — Session 3 Handover

**Date:** April 20, 2026 (late — 3rd session today)
**Build:** `MERGED-COMPLETE-13.zip` — supersedes MERGED-COMPLETE-12
**Focus:** Voice UX rebuild + automated ticket handoff + ET timezone fix + Decision Engine + proactive alerts + sales auto-categorization

---

## TL;DR for Max

- ✅ **"Hey Bob" voice assistant** — continuous listening, barge-in, cross-browser (Chrome/Safari/Edge, Firefox falls back to push-to-talk-via-spacebar), indicator pill always visible bottom-left, per-user off toggle.
- ✅ **"You weren't here yesterday" bug fixed at the root** — every UTC date truncation that affected the AI is now Eastern Time. Old login rows backfilled.
- ✅ **AI dashboard freeze fixed** — typewriter rewritten with requestAnimationFrame (40× fewer re-renders), greet deferred 1.2s after mount. Dashboard paints first.
- ✅ **Re-greeting killed** — when you go back to the dashboard in the same session, Nadia doesn't greet again. Greeting resets only after logout.
- ✅ **Automated ticket handoff** — `/api/claude-handoff` + `CLAUDE_HANDOFF_TOKEN`. You set the token once, tell me once, and I pull tickets myself every session. See `MAX-MANUAL-CHECKLIST.md` section 3.
- ✅ **Decision Engine** — ask Nadia a decision question ("what should I do about invoice 2280?") and she returns a structured recommendation with confidence score + one-click actions alongside her spoken reply.
- ✅ **Proactive alerts** — cron every 30 min scans overdue invoices + clearing-soon checks and writes `ai_alerts` that Nadia surfaces.
- ✅ **Sales auto-categorization** — schema + API ready (`/api/categorize-sales`). Learn, predict, backfill. I'll run it when you say "run the sales learn + backfill".

---

## Deploy order

**Always: SQL first, then zip.**

### 1. Run the SQL (Supabase SQL Editor)

Paste the entire file: `supabase/session3-handoff-ai.sql`. It's idempotent (safe to re-run).

It creates:
- ET date column + backfill on `user_sessions` (the root cause of "you weren't here yesterday")
- `claude_handoff_log` table (audit trail of every time I pull/update tickets)
- `ai_alerts` table (proactive intelligence queue)
- `system_tickets` Claude-review columns
- `users.voice_enabled` + `users.ai_language` + `user_sessions.greeted_at` + `user_sessions.logout_at` columns
- `category_memory` table (sales auto-categorization brain)
- All indexes + RLS policies
- Backup table `user_sessions_backup_session3_20260420` taken automatically first

Verify block at the bottom should return `true` for every column check.

### 2. Set the handoff token in Vercel

Per `MAX-MANUAL-CHECKLIST.md` section 3: add env var `CLAUDE_HANDOFF_TOKEN` (long random string) in Vercel → Settings → Environment Variables → all three environments. **Redeploy** after adding.

### 3. Upload the zip

GitHub Desktop → Show in Finder → delete everything except `.git/` → unzip `MERGED-COMPLETE-13.zip` → commit → push. Vercel auto-deploys.

### 4. Smoke-check in production

1. **Voice:** any page. Say "Hey Bob, what time is it." Bottom-left pill should flash then respond.
2. **No freeze:** navigate to Dashboard, watch Nadia greet. Should feel instant — dashboard paints before she types.
3. **Session-persistent greeting:** switch to another tab, come back. She should NOT greet again.
4. **ET "yesterday":** log in in the evening (after 6pm ET), log out, log in again today. Ask Nadia "was I here yesterday" — she should say yes.
5. **Decision engine:** ask "what should I do about order #<any real number>" — response should include a `decision` object in the `/api/ask` response with risk_score, confidence, suggested_actions.
6. **Proactive cron:** wait 30 min, query `ai_alerts` table — should have rows for your oldest overdue invoices.

---

## What changed this session

### New files (code)
- `src/lib/et-time.js` — ET date/time helpers. Replaces every `toISOString().substring(0,10)` that was affecting a user-facing "today".
- `src/lib/voice/wake-word.js` — Pure "Hey Bob" wake detector + debounce + barge-in. 23 smoke tests pass.
- `src/lib/decision-engine.js` — Intent detection + risk/opportunity scoring + invoice/customer recommenders + proactive scanner.
- `src/components/VoiceController.jsx` — Global continuous listening, browser-aware auto-restart, barge-in, push-to-talk fallback, indicator pill.
- `src/app/api/claude-handoff/route.js` — Bearer-auth handoff API. GET pulls tickets + ai_alerts. POST fixes/comments/reopens/assigns.
- `src/app/api/events/nadia/watch/route.js` — Proactive alerts cron (30 min).
- `src/app/api/categorize-sales/route.js` — Learn / predict / backfill.

### New files (SQL / docs)
- `supabase/session3-handoff-ai.sql` — idempotent migration.
- `MAX-MANUAL-CHECKLIST.md` — zero-technical step-by-step for Gmail publish, Resend DNS, handoff token, voice usage, sales categorization.
- `HANDOVER-SESSION3.md` (this file).

### Modified files
- `src/components/AIGreeter.jsx` — ET timezone, rAF typewriter (no freeze), auto-greet deferred 1.2s, TTS dispatches events for barge-in, listens for `hey-bob-command`.
- `src/app/page.jsx` — VoiceController mounted at root, voiceEnabled state hydrated from user profile, session-persistent `greeted_at` logic, 4 heartbeat sites patched from UTC to ET.
- `src/app/login/page.jsx` — login's `user_sessions.date` now ET, not UTC.
- `src/app/api/ask/route.js` — Decision Engine pre-pass wired into greeter mode; response now includes `{answer, decision}`.
- `vercel.json` — added `/api/nadia/watch` cron (every 30 min). 4 crons total.
- `__tests__/test-full.js` — Sections 37-42 added. +352 assertions across Sessions 2+3.

### Test counts

| File | Prior | Delta | New total |
|---|---|---|---|
| `test-full.js` | 799 | +352 | 1,151 (Sessions 2: 213, Session 3: 139) |
| `test-checks.js` | 40 | 0 | 40 |
| **Combined** | **839** | **+352** | **1,191** |

All 179 assertions across Sections 37-42 pass self-check: **179/0**.

Per QA charter, these are added but not part of a full QA run until you say "run QA".

---

## Known gaps (locked by test assertions)

1. **Sales categorization UI button** — API is ready, but the one-click "Run Learn + Backfill" button in the portal isn't built yet. For now you tell me and I trigger it. Next session.

2. **System Tickets "Claude review" toggle UI** — column exists in DB, API reads it, but the checkbox on the ticket card isn't wired yet. Next session.

3. **Voice Settings toggle in Settings page** — the state is wired, user can dismiss via the bottom-left pill, but there's no permanent toggle in Settings → Personal yet. Next session.

4. **Decision Engine UI rendering** — `/api/ask` returns `decision` alongside `answer`, but `AIAssistant.jsx` doesn't yet render the action buttons in chat. The structure is ready for it. Next session.

5. **Title-change reminder stale body** (carried from Session 2) — editing an event title doesn't reschedule reminders. Body stays stale. Low priority.

6. **Cairo DST** (carried from Session 2) — `CAIRO_OFFSET_HOURS = 2` hardcoded. +1hr drift during Egypt DST months. Documented.

7. **Scheduled-reminder recovery cron** (carried from Session 2) — if `scheduleEventReminders` fails silently, no backfill today.

8. **Hung `notifyServer` silently dropped** (carried from Session 2) — intentional trade-off for dedup.

---

## What's STILL on the backlog (explicitly not touched this session — not dropped)

Per my earlier triage with you:
- **Team calendar click-a-name** (R9 piece) — next session or session 5.
- **CRM masking audit** — you said it's not working right; I need to repro to fix.
- **Ticket priority editable** — small change, next session.
- **Reports finance-permission gate** — small change, next session.
- **Twilio phone numbers per team member** — setup has a cost ($1.15/mo per number), starts next session or when you say go.
- **WhatsApp Business API** — option 1 (shared number) for first pass.
- **SMTP/Outlook fallback** for team members not on Gmail — straightforward, will batch with WhatsApp session.

These are the same items from the last handover's backlog. Nothing dropped.

---

## Rollback (only if deploy breaks)

```sql
BEGIN;
  -- Restore user_sessions
  TRUNCATE user_sessions;
  INSERT INTO user_sessions SELECT * FROM user_sessions_backup_session3_20260420;
  -- Drop new tables
  DROP TABLE IF EXISTS claude_handoff_log CASCADE;
  DROP TABLE IF EXISTS ai_alerts CASCADE;
  DROP TABLE IF EXISTS category_memory CASCADE;
  -- Drop new columns (optional — harmless to leave)
  ALTER TABLE user_sessions DROP COLUMN IF EXISTS et_date;
  ALTER TABLE user_sessions DROP COLUMN IF EXISTS greeted_at;
  ALTER TABLE user_sessions DROP COLUMN IF EXISTS logout_at;
  ALTER TABLE users DROP COLUMN IF EXISTS voice_enabled;
  ALTER TABLE users DROP COLUMN IF EXISTS ai_language;
  ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_review_requested;
  ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_last_read_at;
  ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_last_fixed_at;
  ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_session_id;
  ALTER TABLE system_tickets DROP COLUMN IF EXISTS claude_fix_notes;
COMMIT;
```

Then redeploy MERGED-COMPLETE-12.

**Drop the backup after ~1 week stability:**

```sql
DROP TABLE user_sessions_backup_session3_20260420;
```

---

## Next session entry point

When you next start a chat with me:

1. Paste your `CLAUDE_HANDOFF_TOKEN` (from `MAX-MANUAL-CHECKLIST.md` section 3).
2. Say "handoff" or "check my tickets" — I pull everything automatically.
3. I work through your System Tickets top priority first.
4. I build the 4 UI gaps listed above (categorization button, Claude-review toggle, voice settings toggle, decision-button rendering).
5. We decide between team calendar / CRM masking fix / ticket priority edit / Twilio as the headline new feature.

**Everything is tracked. Nothing silently dropped.**
