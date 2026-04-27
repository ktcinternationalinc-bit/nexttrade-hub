# KTC Phone System — Phase B Handoff

**Last touched:** 2026-04-27
**Build stamp:** v55.20-PHONE-COMPLETE
**Status:** ✅ Build verified (`✓ Compiled successfully`) — ready to deploy

---

## What you (Max) need to do to deploy this build

### Step 1 — Run the SQL in Supabase FIRST (before code deploys)

In Supabase → SQL Editor, paste and run the entire contents of:

```
sql/s32_phone_rls_policies.sql
```

This file does two things:
1. Adds **unique indexes** on `phone_voicemails.twilio_recording_sid` and `phone_recordings.twilio_recording_sid`. Without these, the new duplicate-prevention code can't fully protect against duplicate voicemail rows.
2. Turns on Row Level Security so logged-in users can only see their own calls/voicemails directly via the Supabase JS client. Admins still see everything.

Safe to re-run if you already ran it before — it uses `IF NOT EXISTS` everywhere.

### Step 2 — Add this environment variable in Vercel

Go to Vercel → your project → Settings → Environment Variables.

Add a new variable for **all three environments** (Production, Preview, Development):

- **Name:** `INTERNAL_SECRET`
- **Value:** generate a random string. Easiest way: open Terminal on your Mac and run `openssl rand -hex 32`, copy the output.

This is used so the voicemail recorder can safely tell the transcriber "I'm an internal call" — without it, anyone could trigger Whisper transcriptions and run up your OpenAI bill.

### Step 3 — Deploy via GitHub Desktop

1. Open GitHub Desktop → your repo
2. Repository menu → Show in Finder
3. Select all files in the folder → delete them (keep the `.git` folder)
4. Open the zip I'm sending you, double-click to unzip
5. Drag everything from the unzipped folder into your repo folder
6. Back in GitHub Desktop: commit all changes → Push origin
7. Wait ~90 seconds for Vercel to deploy
8. Hard-refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)

### Step 4 — Confirm the deploy worked

Open the dashboard. When you trigger any orphan-treasury modal, the build stamp at the top should now show **`BUILD v55.20-PHONE-COMPLETE`**. If you still see `v55.19-PHONE-WIP`, your browser is caching old JS — hard refresh again.

---

## What changed in this build

### Security hardening (the big stuff)

**1. Twilio webhook signature validation — now ON for all 5 webhook routes**

Until now, the API endpoints Twilio calls into (`/api/phone/incoming`, `/api/phone/voicemail-record`, `/api/phone/recording-callback`, `/api/phone/call-status`, `/api/phone/outbound`) had no way of knowing whether a request actually came from Twilio. Anyone on the internet who guessed the URL could fake a call coming in, fake a voicemail with their own audio file, fake call status updates, even fake browser-initiated outbound calls — billed to your account.

Twilio puts a signature header on every webhook (`X-Twilio-Signature`) that proves it came from them. We now check it on every request and reject anything that doesn't match with a 403.

If `TWILIO_AUTH_TOKEN` isn't set in your env vars, the check **fails open** (lets requests through) so we don't accidentally take down production during initial setup. Once the token is set, validation is real.

**2. Voicemail / recording duplicate-row prevention — now race-safe**

When someone leaves a voicemail, Twilio actually fires the same webhook URL **twice** — once when the dial action completes, once when the recording is fully processed. The old code did "check if exists, then insert" which has a race window: two simultaneous fires could both pass the check and both insert.

Fixed by switching to upsert with `onConflict='twilio_recording_sid'`. The unique index in the SQL migration makes this atomic at the database level — even simultaneous fires can't dupe.

The transcription trigger is also now smarter: only fires once per recording, not once per webhook hit, so Whisper doesn't get called twice on the same audio file.

### Reliability fixes

**3. PhoneWidget reference-order bug fixed**

The browser-dialing widget had a function that was used inside Twilio event handlers before it was defined. It worked today by lucky timing, but could break unpredictably with a slightly different code path. Switched to a `ref` so the event handlers always reach the latest version regardless of declaration order.

**4. Voicemail polling pauses when tab is hidden**

The voicemails widget was polling every 30 seconds forever, even when you'd switched to another browser tab or minimized the window. Hours of polling on slow networks can pile up orphaned timers.

Fixed: when the tab is hidden, polling stops. When you come back to the tab, it does an immediate catch-up fetch and resumes the 30s cadence. New voicemails still appear instantly when you focus the tab.

**5. Outbound caller name now saved**

When you dial a customer through the browser, we already look up which customer that phone number belongs to. We just weren't saving their name on the call record — so call history showed unfamiliar phone numbers even when the customer was on file. Now their name is saved alongside the customer ID, so call history reads "John Smith — +1 555 1234" instead of "+1 555 1234 — Unknown".

---

## What's still pending (low priority, can defer)

These are the medium-priority items from the previous handoff that I deliberately did **not** touch this session because they're polish, not blockers:

- **#4** — Greeting + disclaimer always plays before dial. Should move disclaimer AFTER team member picks up.
- **#7** — Outbound disclaimer to customer: "Hello, recording" timing is awkward.
- **#11** — JWT format for Twilio Voice SDK v2 should be verified against Twilio docs.
- **#25** — Add `transcript_completed_at` column for debugging stuck transcriptions.
- **#34** — `voicemail-record` checks `dialCallStatus === 'answered'` which Twilio never sends as a literal value (real values: `completed | no-answer | busy | failed | canceled`). The check is harmless because we also check for `completed`, but it's dead code.

---

## Files changed this session

```
src/app/api/phone/incoming/route.js          — added signature validation
src/app/api/phone/outbound/route.js          — added signature validation + customer name capture
src/app/api/phone/voicemail-record/route.js  — added signature validation + race-safe upsert
src/app/api/phone/recording-callback/route.js — added signature validation + race-safe upsert
src/app/api/phone/call-status/route.js       — added signature validation
src/components/PhoneWidget.jsx               — endCall ref pattern (no more reference-order risk)
src/components/VoicemailsWidget.jsx          — pause polling when tab hidden
src/app/page.jsx                             — build stamp v55.20-PHONE-COMPLETE
sql/s32_phone_rls_policies.sql               — added unique indexes for race-safe upsert
```

---

## Test plan after deploy

1. **Voicemail playback** — go to dashboard, find existing voicemail, click play. Audio should still work as before.
2. **Cell forwarding** — call your toll-free from another phone. Your cell should still ring after the greeting.
3. **Browser dialing** — click PhoneWidget bottom-right → enter a phone number → click call. Grant microphone permission if asked. Best tested in Chrome.
4. **Browser receiving** — ask someone to call your assigned number while you're on the dashboard. PhoneWidget should pop up with caller info.
5. **Voicemail dedup** — leave yourself a voicemail. Confirm only ONE row appears in the voicemails list (not two).
6. **Tab-hidden polling** — open dashboard, switch to another tab for 5 minutes, come back. Voicemails should refresh immediately on focus.

---

## Known risks

1. **Build was verified, but I did not test runtime behavior.** The build compiles cleanly, but Twilio webhook signature validation is the kind of thing that's easy to get subtly wrong on URL formatting. If after deploy your inbound calls suddenly stop working, the most likely culprit is the URL Twilio is signing vs the URL we reconstruct. Quickest fix: set `SKIP_TWILIO_SIGNATURE=true` in Vercel env vars to disable validation while you investigate. (Don't leave it disabled.)

2. **Rate limit map is per-instance.** Vercel cold starts wipe it. For real protection use Upstash Redis or Vercel KV. Current implementation is a speedbump, not a wall. Same as the previous handoff — unchanged.

3. **`requireUser()` cookie parsing.** Supabase's cookie format varies by client version. If auth fails on browser-originated requests, check `phone-auth.js:requireUser()`. Same as previous handoff — unchanged.
