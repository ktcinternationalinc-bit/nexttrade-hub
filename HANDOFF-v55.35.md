# NextTrade Hub — v55.35 Handoff

## What's in this build

This release rolls TWO things together:

1. **The HR Performance Report** (originally planned for v55.34) — self-view for everyone, analytical view for super admin / privileged users
2. **The Emad bounce-out fixes** — five patches that solve the "I log in successfully but get kicked back to login" problem

Both pieces are independently shippable but they're combined here because nothing was deployed between them.

---

## Part A — Emad bounce-out (the urgent one)

### What was broken

When Emad (or anyone with email casing weirdness) tried to log in, three things were going wrong simultaneously:

1. **The browser hung waiting for a Supabase auth lock.** The default Supabase JS client uses the browser's `LockManager` to coordinate token refresh across tabs. On Windows + Chrome that lock occasionally hangs — the dashboard shows "Lock 'sb-...-auth-token' was not released within 5000ms" in the console. While that lock is stuck, every database query returns 401 because the token can't refresh, the dashboard panics and bounces the user back to /login.
2. **The login page used `.single()` to look up the user's profile after auth succeeded.** `.single()` throws if the email casing doesn't match exactly. Auth had already succeeded, but the throw was caught as a generic "login error", so the redirect to / was blocked. User saw the login form again with an error.
3. **The dashboard did the same case-sensitive profile lookup.** Same casing mismatch → `userProfile` stayed `null` → ~30 components downstream crashed with React #418/#423/#425 hydration errors.

Plus two cosmetic noisemakers: the voicemail widget was firing a 401 on every dashboard load (no auth header), and `manifest.json` was 404'ing.

### The 5 patches

| # | File | What changed |
|---|---|---|
| 1 | `src/lib/supabase.js` | Replaced the un-configured `createClient(url, key)` with explicit auth config including a no-op `lock` function. This bypasses the buggy LockManager. **This is the critical fix for the bounce.** |
| 2 | `src/app/login/page.jsx` | Hardened `handleLogin`: trims email at sign-in, swapped `.single()` → `.maybeSingle()`, swapped `.eq()` → `.ilike()` for case-insensitive match, wrapped the profile lookup in its own try/catch so a profile-lookup hiccup can never undo a successful auth |
| 3 | `src/app/page.jsx` | The dashboard's profile lookup now trims both sides before comparing, plus falls back to matching by Supabase auth `user.id` when email match fails |
| 4 | `src/components/VoicemailsWidget.jsx` | Now reads the Supabase session token and forwards it as a Bearer token in the Authorization header. The 401 spam in the console is gone. |
| 5 | `public/manifest.json` (new) | Silences the 404 noise on dashboard load |

### Test coverage

New suite: `__tests__/test-v55-35-auth-and-bounce.js` — **29 assertions** that lock down all 5 patches by checking the source content. So if a future merge accidentally re-pastes an old version of any of these files, the test breaks.

---

## Part B — AI HR Performance Report

### Two views, one engine

A team-member-facing self-view ("My Performance") and an admin-facing analytical view ("HR Report"). Both consume the same metric calculations from `src/lib/hr-metrics.js`, so the numbers always match. Different UI, different tone.

### For every team member — "My Performance"

Embedded at the top of every Personal Dashboard. Period selector (yesterday / 7 days / 30 days / 3 months / 1 year). Shows:

- Wins-this-period highlight if they had any
- 9 activity tiles with arrows showing trend vs their own prior matching period
- Daily-log fill bar (% of working days with a manual entry)
- On-time callout if they closed any tickets — phrased positively even when numbers are mixed
- "Get Coach Feedback" button → Claude returns a 3-paragraph encouragement note (max 180 words, growth-oriented, never judgmental)

What they DON'T see: no score, no ranking, no comparison to teammates. Coach output is rule-bound to be warm.

### For super admin and privileged users — "HR Report"

New section button inside the Admin tab. Same metrics, full analytical framing:

- Team summary banner (averages)
- One row per visible team member, sorted by overall score by default
- Each row: overall score 0–100 with three sub-scores (Productivity / Timeliness / Engagement) and a pill row of headline metrics
- Click row → expands into 6 detail blocks plus a "Generate Review" button that returns a structured manager-style write-up (SUMMARY · STRENGTHS · AREAS TO WATCH · RECOMMENDED ACTIONS)

**Anti-gaming visibility rule:**
- Super admin → sees everyone, including themselves
- Privileged user (with new "HR Report" permission ON) → sees everyone EXCEPT themselves
- Everyone else → section hidden

### Scoring formula (provisional)

Three sub-scores, equal weight, 0–100, all relative to team:
- **Productivity** = volume across tickets closed, rates added, quotes created, bookings made, tickets created
- **Timeliness** = on-time close % + overdue penalty + comments-per-ticket
- **Engagement** = daily-log fill % + meetings attended + activity-category variety

This is a starting formula. Once real data accumulates over a few weeks we tune it together.

---

## Build stamp

Header pill reads **v55.35**. In-app build modal reads **BUILD v55.35-HR-REPORT+AUTH-BOUNCE-FIX**. Hard-refresh after deploy (Cmd+Shift+R or Ctrl+Shift+R).

## Deploy steps

There is ONE SQL migration. Run it before deploying code.

1. **Supabase SQL Editor** → paste contents of `sql/s36_hr_report_permission.sql` → Run. This seeds an "HR Report" permission row (default OFF) for every non-super user.
2. **GitHub Desktop** → Repository → Show in Finder
3. Delete every file in that folder
4. Unzip `MERGED-COMPLETE-55.35.zip` directly into the folder (this includes the new `public/` directory)
5. Commit message: `v55.35 — HR Report + Emad bounce-out fix`
6. Push origin → Vercel auto-deploys (~2 min)
7. Hard-refresh, confirm v55.35 in the header

## After deploy — what to verify

**Auth fix verification:**
- Open the dashboard in Chrome on Windows. Open DevTools console.
- The "Lock not released within 5000ms" warning should be GONE.
- The 401 on `/api/phone/voicemails` should be GONE.
- Have Emad try logging in. He should land on the dashboard and STAY there.

**HR Report verification:**
- On Personal Dashboard you should see the "📊 My Performance" widget at the top with an "Open" button.
- Admin tab should have a new "📋 HR Report" button in the section nav.
- Settings → Permissions → action permissions table should have a new "HR Report" row.

## Test summary at ship time

- 102 source files parse cleanly
- 61 HR metric assertions — all green
- 29 v55.35 patch assertions — all green
- 19 admin dashboard assertions — all green
- Full Next.js production build — `✓ Compiled successfully`, 48 pages generated, both HR Report API routes registered

## Files in this build

### New files
- `src/lib/hr-metrics.js` — pure metric engine
- `src/components/MyPerformance.jsx` — self-view widget
- `src/components/HRReport.jsx` — admin-view component
- `src/app/api/hr-report/coach/route.js` — encouragement API
- `src/app/api/hr-report/review/route.js` — analytical review API
- `sql/s36_hr_report_permission.sql` — permission seeding migration
- `__tests__/test-hr-metrics.js` — 61 metric assertions
- `__tests__/test-v55-35-auth-and-bounce.js` — 29 patch assertions
- `public/manifest.json` — silences 404 noise
- `HANDOFF-v55.35.md` — this document

### Edited files
- `src/lib/supabase.js` — Patch 1 (LockManager opt-out)
- `src/app/login/page.jsx` — Patch 2 (handleLogin hardening)
- `src/app/page.jsx` — Patch 3 (profile lookup hardening) + version bump + AdminTab modulePerms prop
- `src/components/VoicemailsWidget.jsx` — Patch 4 (Bearer token)
- `src/components/AdminTab.jsx` — HR Report section button + render block
- `src/components/PersonalDashboard.jsx` — embeds MyPerformance
- `src/components/SettingsTab.jsx` — adds "HR Report" to permission matrix

## Carry-forward (not new — same as v55.34)

Pending environment variables at Vercel:
- `OPENAI_API_KEY` (for Whisper voice transcription)
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`
- `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` (after verifying ktcus.com domain at resend.com)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`

Pending Supabase imports:
- `import_usd_transactions.sql` (189 USD transactions)
- Merchandiser SQL imports

Coming next sessions (per priority list):
1. WhatsApp completion (your number first)
2. Shipping booking workflow
3. Resend end-to-end + test button
4. Gmail multi-user OAuth
5. Better Nadia memory
