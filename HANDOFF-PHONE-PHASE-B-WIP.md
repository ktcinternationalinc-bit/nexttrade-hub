# KTC Phone System — Handoff to Next Session

**Last touched:** 2026-04-27
**Build stamp:** v55.19-PHONE-WIP
**Status:** PARTIAL — code shipped, signature validation + RLS still TODO, needs build verification

---

## What you (next Claude) must do FIRST

1. **Verify the build compiles.** I parse-checked all 14 modified files but did NOT run `npx next build`. Run it before doing anything else:
   ```
   cd /home/claude/work/build/MERGED-COMPLETE-55
   cat > .env.local <<EOF
   NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
   SUPABASE_SERVICE_ROLE_KEY=placeholder
   EOF
   rm -rf .next && timeout 120 npx next build 2>&1 | grep "Compiled\|Failed"
   ```
   Look for "✓ Compiled successfully". If anything fails, fix imports first.

2. **Likely import path issue to check:** I added `import {...} from '../../../../lib/phone-auth'` to several routes. Count the `..` carefully:
   - `src/app/api/phone/token/route.js` → 4 levels up to reach `src/lib/`
   - Same for `numbers`, `voicemails`, `call` routes
   
   If build fails on these, the path may need adjusting.

---

## What's done in this drop (v55.19-PHONE-WIP)

### Round 1 — Critical fixes ✅
- **#3** — Removed financial-exploit GET handler in `/api/phone/incoming` (was: anyone could dial any number)
- **#2** — Caller ID on cell forwarding now uses KTC number (was: customer's number, confusing)
- **#1** — Fallback voicemail (when number not in `phone_numbers`) now records + transcribes
- **#19/#30** — NEW route `/api/phone/recording-stream` proxies Twilio audio with auth → fixes voicemail playback in browser
- **#5/#22** — NEW route `/api/phone/transcribe-cron` (every 5 min) catches stuck transcriptions

### Round 2 — Functional fixes ✅
- **#14/#15/#16/#17** — PhoneWidget rewritten for Twilio Voice SDK v2:
  - SDK URL: `https://sdk.twilio.com/js/voice/releases/2.10.2/twilio.min.js`
  - Calls `device.register()` to enable incoming
  - `tokenWillExpire` handler refreshes before 1hr expiry
  - Inits as soon as user logs in (not gated on assigned phone number)
- **#32/#33** — `statusCallback` wired into `<Dial>` TwiML in both inbound + outbound — call status/duration now updates for ALL numbers, not just where webhook is set in Twilio Console
- **#8** — Outbound validates E.164 + blocks 1-900/1-976 premium-rate scams
- **#10** — Outbound disclaimer respects `recording_enabled` per-number setting

### Round 3 — Security hardening (PARTIAL) 🟡
- **#12** — Token endpoint requires Supabase auth, matches user_id to authenticated user
- **#13** — Token rate limit (10/min/IP) via in-memory map
- **#26** — `/api/phone/numbers` POST/PATCH/DELETE require admin role
- **#28** — `/api/phone/voicemails` filters to current user (regular users can't query other users' VMs)
- **#27/#29** — `/api/phone/call` now requires auth, force user_id = authenticated user
- **#24** — `/api/phone/transcribe-async` is internal-only + SSRF-protected (only Twilio URLs)
- **NEW helper:** `src/lib/phone-auth.js` with `requireUser()`, `verifyTwilioSignature()`, `checkRateLimit()`

---

## What's NOT done — finish in this next session

### High priority (must finish before declaring Phase B done)

1. **#23 — Twilio webhook signature validation**
   - Helper exists: `verifyTwilioSignature()` in `src/lib/phone-auth.js`
   - Apply to these routes: `/api/phone/incoming`, `/api/phone/voicemail-record`, `/api/phone/recording-callback`, `/api/phone/call-status`
   - For each: read formData as object via `readFormDataAsObject(req)`, call `verifyTwilioSignature(req, obj)`, reject with 403 if false
   - **Twilio sets `X-Twilio-Signature` header on every webhook call.** Without verification, anyone can spoof recording data.

2. **#31 — RLS migration** (SQL file already written: `sql/s32_phone_rls_policies.sql`)
   - Max needs to run this in Supabase BEFORE deploying
   - Adds RLS policies so direct Supabase JS client access is gated
   - File is complete and ready to run

3. **`INTERNAL_SECRET` env var** — needs to be added to Vercel
   - Generate a random ~32-char string (e.g. `openssl rand -hex 32`)
   - Add to Vercel as `INTERNAL_SECRET` env var (all 3 environments)
   - Used by `transcribe-async` to verify internal-only callers

### Medium priority (polish, can defer)

4. **#4** — Greeting + disclaimer always plays before dial (8+ sec intro). Move disclaimer AFTER team member picks up.
5. **#7** — Outbound disclaimer to customer: "Hello, recording" timing is awkward.
6. **#11** — JWT format: should verify against Twilio Voice SDK v2 docs to confirm grants format is correct.
7. **#18** — `endCall` referenced before defined (works due to closure timing, but fragile).
8. **#20** — VoicemailsWidget `setInterval` runs forever even if user navigates away. Pause on `document.hidden`.
9. **#21/#6** — Race condition in dedup (TOCTOU between existence check and insert). Use upsert with onConflict instead.
10. **#25** — Add `transcript_completed_at` column for debugging stuck transcriptions.
11. **#9** — Outbound: capture `customer.name` in `caller_name` when matched.
12. **#34** — `voicemail-record` checks `dialCallStatus === 'answered'` which Twilio never sends. Real values: `completed | no-answer | busy | failed | canceled`.

---

## Files modified in this session

```
src/app/api/phone/incoming/route.js          — major: removed GET, fixed caller ID, fallback w/ recording
src/app/api/phone/outbound/route.js          — major: E.164 validation, premium block, statusCallback, recording_enabled gate
src/app/api/phone/voicemail-record/route.js  — added X-Internal-Trigger header on transcribe trigger
src/app/api/phone/recording-callback/route.js — added X-Internal-Trigger header
src/app/api/phone/transcribe-async/route.js  — added internal-only check + SSRF (Twilio URL whitelist)
src/app/api/phone/token/route.js             — auth + rate limit + user_id mismatch check
src/app/api/phone/numbers/route.js           — admin-only on POST/PATCH/DELETE
src/app/api/phone/voicemails/route.js        — auth + filter to current user
src/app/api/phone/call/route.js              — auth + force user_id from session
src/app/api/phone/recording-stream/route.js  — NEW: Twilio audio proxy with Basic Auth
src/app/api/phone/transcribe-cron/route.js   — NEW: 5-min safety net for stuck transcriptions
src/lib/phone-auth.js                        — NEW: shared auth helpers
src/components/PhoneWidget.jsx               — major: Twilio Voice SDK v2 rewrite
src/components/VoicemailsWidget.jsx          — audio src now uses recording-stream proxy
src/components/CRMTab.jsx                    — audio src now uses recording-stream proxy
src/app/page.jsx                             — build stamp v55.19-PHONE-WIP
vercel.json                                  — added /api/phone/transcribe-cron */5min cron
sql/s32_phone_rls_policies.sql               — NEW: RLS migration (run BEFORE deploy)
```

---

## Pre-deploy checklist for Max

When this is ready to ship to Max:

1. **Add to Vercel env vars:**
   - `INTERNAL_SECRET` — generate random 32+ char hex string

2. **Run in Supabase BEFORE deploying:**
   - `sql/s32_phone_rls_policies.sql`

3. **Deploy:**
   - GitHub Desktop → delete all except .git → unzip → drag in → commit + push
   - Wait 90 sec for Vercel
   - Hard-refresh browser (Ctrl+Shift+R)
   - Verify modal header shows the new build stamp

4. **Test plan:**
   - **Voicemail playback** — go to dashboard, find existing voicemail, click play. Should hear audio (was 401 before).
   - **Cell forwarding** — call your toll-free from another phone. Your cell should ring after the greeting.
   - **Browser dialing** — click PhoneWidget bottom-right → enter a phone number → click call. **Will require granting microphone permission** the first time. May need to test in Chrome (best WebRTC support).
   - **Browser receiving** — ask someone to call your assigned number while you're on the dashboard. PhoneWidget should pop up with caller info.

---

## Honest risks for next session

1. **Twilio Voice SDK v2 may reject the JWT format.** I structured it per Twilio docs but didn't test. If browser dialing fails with "AccessTokenInvalid", the JWT format is the first place to check. Alternative: use the `twilio` npm package's `AccessToken` class (server-side) instead of hand-rolled JWT.

2. **Recording-stream proxy may break audio seeking on some browsers.** I forwarded Range headers but stream piping in Next.js Edge can be flaky. If seeking doesn't work, audio still plays start-to-end fine.

3. **`requireUser()` cookie parsing.** Supabase's cookie format varies by client version. If auth fails on browser-originated requests, check `phone-auth.js:requireUser()` — may need to adjust the cookie regex.

4. **Rate limit map is per-instance.** Vercel cold starts wipe it. For real protection use Upstash Redis or Vercel KV. The current implementation is a speedbump, not a wall.

5. **File: `src/lib/supabase.js`** is referenced by PhoneWidget — verify it exports a `supabase` client. If it doesn't (or the path differs), the import will break.

---

## Tool budget warning

This session ran out of tool calls before finishing Round 3 + verifying the build. Next session should:
1. Build verify FIRST (1 tool call)
2. Apply Twilio signature validation to 4 routes (~8 tool calls)
3. Re-verify build (1 tool call)
4. Package zip (1 tool call)
5. Present files (1 tool call)

That's ~12 tool calls. Plenty of room.

---

## What works RIGHT NOW (proven by Max in this session)

- ✅ Inbound calls land at incoming webhook
- ✅ Greeting + disclaimer plays
- ✅ Voicemail recorded
- ✅ Whisper transcription saved to DB

## What should work AFTER this WIP build deploys (untested, theory only)

- Voicemail audio playback (proxy endpoint)
- Cell forwarding rings team member's cell with KTC caller ID
- Call status/duration updates in DB
- Browser dialing (subject to JWT format risk)
- Browser receiving incoming calls (subject to JWT format risk)

## What still won't work until next session finishes

- Webhook signature validation (anyone can spoof)
- Direct Supabase access protection (anyone logged in can query phone_* tables until s32 SQL runs)
