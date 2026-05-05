# NextTrade Hub — v55.43 Handoff

## What this build does

Two things, in order of importance to you right now:

### 1. Voice input — RESTORED and fixed properly

I made a mistake in the previous build by interpreting "without Hey Nadia" as "without voice." That was wrong. The press-to-record button is back, and there's now a proper ChatGPT-style hands-free conversation mode too.

**🎙️ Press-to-record button** (Mode 1 — like ChatGPT's keyboard mic):
- Tap once → mic opens, button turns rose-red and pulses
- Talk for as long as you want
- Tap again → audio uploads to Whisper → transcript appears as a chat message → Nadia replies
- Disabled while transcribing (so double-taps can't break it)

**🗣️ Voice conversation button** (Mode 2 — like ChatGPT's advanced voice):
- Tap once → mic opens, button turns emerald-green and pulses
- Talk → stop talking → after ~1.8s of silence the system auto-stops → Whisper transcribes → Nadia replies with voice (TTS) → when she finishes, mic re-opens automatically
- Loop continues until you tap the 🗣️ button again to end
- Hands-free, no need to keep tapping
- Has a 30-second hard cap per turn so a stuck mic never hangs forever
- If you want to interrupt Nadia mid-sentence, you can stop conversation mode by tapping 🗣️ again — that stops her TTS and the loop

**No more "Hey Nadia" wake word.** You said you don't want it, so it's not coming back. Both modes are explicit user actions — tap to start, tap to stop. No always-on background mic.

### 2. Phone "an application error has occurred" — root cause found and fixed

When customers called your NJ numbers (e.g. +17328005428), they heard the greeting + disclaimer, then "an application error has occurred," then the call dropped. That message is what Twilio plays when they hit our webhook and we return an error.

The root cause: Twilio sends every webhook with an `X-Twilio-Signature` header, and we're supposed to verify it by hashing the URL Twilio called against our secret. **On Vercel, the URL we computed didn't match the URL Twilio signed** because Vercel proxies through internal hashes that differ from the public domain. Hash mismatch → we returned 403 → Twilio plays the error.

Fixed in `src/lib/phone-auth.js`. Instead of computing one signature and demanding an exact URL match, we now compute signatures for **four candidate URLs** (host-header, literal `req.url`, `NEXT_PUBLIC_APP_URL`, and the production fallback) and accept the request if **any** of them match. Plus loud logging when none do, so if there's still an edge case we can see it in Vercel logs.

I also hardened the `incoming` route's catch handler so even a totally unexpected error returns a polite voicemail prompt instead of bombing.

## Build stamp

Header pill reads **v55.43**. Build modal reads **BUILD v55.43-VOICE-RESTORED-AND-PHONE-FIX**.

## Deploy steps

**No SQL needed. No env vars needed.** (`OPENAI_API_KEY` and `ELEVENLABS_API_KEY` were already set per the diagnostics — both are required for the voice modes to work, and both are in place.)

1. **GitHub Desktop** → Show in Finder → delete every file → unzip `MERGED-COMPLETE-55.43.zip`
2. Commit `v55.43 — voice restored + phone signature fix`
3. Push origin (Vercel auto-deploys ~2 min)
4. Hard-refresh

## Verification

### Voice — Mode 1 (press-to-record)
1. Open the dashboard, hard-refresh
2. Open Nadia (the chat input at the bottom)
3. You should see two buttons: 🎙️ and 🗣️
4. Tap 🎙️ → button turns rose-red and pulses
5. Say "Hello Nadia, what's my treasury balance"
6. Tap 🎙️ again → button stops pulsing, you'll see "Transcribing..."
7. Within ~2 seconds, your transcribed message appears in the chat and Nadia responds

### Voice — Mode 2 (conversation)
1. Same place, tap 🗣️ → button turns emerald-green and pulses
2. Say "Hi Nadia, how are my open tickets today?"
3. Stop talking — after ~1.8s of silence, the recorder auto-stops
4. "Transcribing..." appears, then Nadia's response, then her voice plays
5. When her voice ends, the mic re-opens automatically (you'll see the green button still pulsing)
6. Say "What about my voicemails?" → loop continues
7. Tap 🗣️ again to end the conversation

### Phone — call from your cell
1. Call any of the NJ numbers (e.g. +17328005428)
2. Hear: greeting, disclaimer, then either Nadia rings your browser (if your phone widget is open and you're set up for browser routing) OR rings your forwarding cell OR drops to voicemail with a clear "leave a message" prompt
3. **You should NOT hear "an application error has occurred."** If you still do, check the Vercel logs at `https://vercel.com/your-project/logs` and look for `[twilio-sig]` lines — those will tell us exactly which URL is mismatching, and we can pin it down precisely in v55.44.

## Tests

- **55 v55.43 assertions** — all green
- **72 of 74 regression suites** — all green
- 2 remaining failures are **pre-existing** calendar tests (unrelated to anything in this build — same failures present in v55.41 and v55.42)
- 108 source files parse cleanly (build syntax check)

## Files in v55.43

### Edited
- `src/lib/phone-auth.js` — multi-candidate signature verification
- `src/app/api/phone/incoming/route.js` — bullet-proof catch handler with last-resort fallback TwiML
- `src/components/AIGreeter.jsx` — restored 🎙️ press-to-record button, added 🗣️ conversation mode with silence-based auto-stop and TTS-end auto-restart
- `src/components/SettingsTab.jsx` — restored Voice tab in Settings nav
- `src/app/page.jsx` — version stamps bumped to v55.43
- `__tests__/test-voice-recorder-whisper.js` — REC17 disabled clause expanded to allow conversationMode
- `__tests__/test-v55-42-bank-edit-voice-off.js` — onTurnOff tests relaxed (VoiceController is gone)
- `__tests__/test-full.js` — voice-mount assertions relaxed (no VoiceController in v55.43)

### New
- `__tests__/test-v55-43-voice-restored-and-phone-fix.js` — 55 assertions
- `HANDOFF-v55.43.md` — this document

### Untouched
- `src/components/VoiceController.jsx` — kept on disk but no longer mounted (so reactivation is easy if you ever change your mind on Hey Nadia)
- All v55.42 bank-edit fixes
- All v55.41 duplicate-confirm fixes
- All v55.40 phone auto-inbound features
- All v55.39 voicemail dial-failed branch
- All v55.38 login hydration fix
- All v55.37 WhatsApp inbox

## Carry-forward (still pending)

- WhatsApp Cloud API setup at Meta
- Resend account + DNS + env vars
- `NEXT_PUBLIC_APP_URL` env var (only matters when you cut over to hub.ktcus.com — strongly recommended now since it's also one of the four signature-verification candidates)
- Twilio Console access recovery
- Run `import_usd_transactions.sql` and merchandiser SQL imports
- Fill in cell forwarding numbers in Settings → Phone → Team Routing Preferences

## What's next if voice works for you

1. Test both voice modes — Mode 1 (press-to-record) and Mode 2 (conversation)
2. Test the phone fix — call your NJ numbers and confirm no "application error" anymore
3. If something specific in the voice flow still breaks, tell me what exactly happens (e.g. "tap 🗣️, talk, but transcription never comes back" vs "tap 🗣️, transcribes fine but Nadia doesn't speak back") and I'll fix the specific failure mode

## What's next if voice STILL doesn't work for you

If the voice modes don't work after v55.43 deploys, the most useful thing you can send me is the **browser console output** when you tap a button. Open DevTools (F12), go to the Console tab, then tap 🎙️ or 🗣️. Console will print lines starting with `[record]` and `[conversation]` — those tell us exactly where the flow is failing (mic permission, network upload, Whisper response, TTS playback, etc.). With those lines I can fix the specific step rather than guessing.
