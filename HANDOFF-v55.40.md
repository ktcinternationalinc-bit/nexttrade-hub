# NextTrade Hub — v55.40 Handoff

## Where do voicemails appear? (the question you asked)

Two places after this build:

1. **Dashboard — VoicemailsWidget.** This already existed. It sits below "Personal Dashboard" on the main dashboard. Each card shows: caller name (matched to a customer if known) + phone number, when the message was left, the Whisper-generated transcript, an audio player, and a Mark-as-read button. Defaults to showing unread voicemails; "Show all" toggle reveals everything. Auto-refreshes every 30 seconds.

2. **Header badge — NEW in v55.40.** A small `📬 N` button appears in the top header (between the notification bell and the alerts bell) whenever the current user has unread voicemails. Tap it → app jumps to the dashboard and smooth-scrolls down to the voicemail list. Hidden when there are zero unread, so it doesn't add noise. Refreshes every 30 seconds in lock-step with the widget itself, so marking one read in the widget makes the badge count drop within ~30s.

Each team member sees their OWN voicemails — the badge count and the dashboard list both filter by `assigned_to = current user`. Admins see only their own badge too; if you want admins to see all voicemails system-wide, that's a future tweak.

## What this build does

### 1. Auto-register browsers for inbound calls

**The problem before.** The phone widget only registered with Twilio when the user manually opened it. So nobody's browser was ever ready to ring. EVERY inbound call went straight to voicemail (and on the NJ numbers, before v55.39, didn't even reach voicemail). Customers calling KTC almost never spoke to a live person.

**The fix.** On app load, the PhoneWidget checks four conditions:
1. The browser exposes the Permissions API for microphone (Chrome, Firefox, modern Safari)
2. Microphone permission is **already granted** (i.e. the user has used the phone or Nadia voice before and said yes)
3. The user's `phone_routing` is not `'cell'` (browser explicitly disabled)
4. The user is not in vacation mode

When all four hold, the widget silently registers with Twilio in the background. No prompts, no UI takeover. The user just sees a green dot appear on the floating phone button — that's the new visual cue that **inbound calls will ring this browser right now**. Tap to confirm tooltip says "Phone (ready to receive calls)".

If any condition fails — most commonly, the user has never granted mic permission — auto-register stays quiet and the system falls back to the existing lazy behavior (open the widget once to enable). No regression.

### 2. Cell forwarding setup (Settings UI was already built)

I'd been planning to build this but on closer inspection it's **already shipped** — the SettingsTab already has a "Team Routing Preferences" section under Settings → Phone with:
- Cell phone forwarding number input (E.164 format, e.g. `+201001234567`)
- Routing mode dropdown: `Browser, then cell` (recommended) / `Browser only` / `Cell only`
- Vacation mode toggle
- Yellow validation banners when routing requires a forwarding number that isn't set

It's wired to `users.forwarding_number`, `users.phone_routing`, and `users.phone_vacation_mode` (added by `s31_phone_routing_user_columns.sql`, which has been run).

**What's missing is just data.** Nobody has filled it in for any team member yet. So calls fall through browser → voicemail because no cell number is set as the fallback. To complete the work:

1. Open **Settings → Phone**
2. Scroll to **Team Routing Preferences**
3. For each team member, fill in:
   - Their cell phone number in E.164 format (the Egypt cell would look like `+201XXXXXXXXX`)
   - Routing mode → leave on **"Browser, then cell"** (the default)
4. Each row auto-saves on blur

Once filled in: when a customer calls, our TwiML rings the team member's browser AND their cell in parallel. Whoever picks up first wins. With v55.40's auto-register live, the browser usually wins (cheaper and they have keyboard for notes); when they're away from the desk, the cell catches it.

### Cost note for cell forwarding to Egypt
Twilio bills outbound legs at ~$0.16-$0.22/min for Egyptian mobile. Forwarding only happens if the browser doesn't pick up in 25 seconds. So the bill mostly accrues during after-hours when team members aren't at their desks. For a typical week of inbound traffic this stays in the low single-digit dollars per team member.

## Build stamp

Header pill reads **v55.40**. Build modal reads **BUILD v55.40-PHONE-AUTO-INBOUND**. Hard-refresh after deploy.

## Deploy steps

**No SQL needed.** No env vars. No Twilio Console changes.

1. **GitHub Desktop** → Show in Finder → delete every file → unzip `MERGED-COMPLETE-55.40.zip`
2. Commit `v55.40 — phone auto-inbound + voicemail badge`
3. Push origin
4. Vercel auto-deploys (~2 min)
5. Hard-refresh browser to confirm v55.40 in the build modal

## Verification (5 minutes end to end)

**Test 1 — auto-register works for users who already granted mic.**
1. Log in as yourself (you've already granted mic for Nadia, so you're a perfect test case)
2. Wait ~3 seconds after the dashboard loads
3. Look at the floating green phone button (bottom-left) — there should be a small green dot in the top-right corner of it
4. Hover the button — tooltip should read "Phone (ready to receive calls)"

**Test 2 — inbound call actually rings the browser.**
1. From your cell, call any of the NJ numbers (e.g. `+17328005428`)
2. The greeting + disclaimer plays
3. Within ~2 seconds, the dashboard should pop up an "Incoming Call" overlay with answer/reject buttons
4. Tap the green answer button → talk

**Test 3 — voicemail badge appears.**
1. From your cell, call a NJ number again, but DON'T pick up in the dashboard
2. After ~25 seconds the call goes to voicemail (v55.39 behavior)
3. Leave a 5-second message
4. Within ~30 seconds, a `📬 1` badge should appear in the top header
5. Tap it → app jumps to dashboard, scrolls to the Voicemails widget
6. Click the audio play button → hear your test message
7. Mark as read → badge disappears within ~30 seconds

**Test 4 — cell forwarding (after you fill in the numbers in Settings).**
1. Settings → Phone → Team Routing Preferences → set your own cell number
2. Wait for auto-save
3. Close the dashboard tab entirely
4. From a different phone, call the NJ number
5. After ~15 seconds, your cell should ring (browser couldn't be reached because tab is closed → fall through to cell)

If 1, 2, and 3 all work, the system is fully live. Test 4 is the proof that team members can take calls from anywhere — but it requires you to enter forwarding numbers first.

## Tests

- **42 v55.40 phone auto-inbound assertions — new, all green**
- 31 v55.39 voicemail dial-fail assertions — green
- 38 v55.38 login hydration assertions — green
- 42 v55.37 WhatsApp inbox assertions — green
- 61 HR metrics — green
- 19 admin dashboard — green
- 29 v55.35 auth + bounce-out — green
- **108 source files parse cleanly**

## Files in v55.40

### Edited
- `src/components/PhoneWidget.jsx` — auto-register useEffect, deviceReady state, green-dot indicator on the floating phone button
- `src/app/page.jsx` — unread voicemail badge in header (state, polling, UI), `id="voicemails-widget"` anchor on the widget container, version stamps bumped to v55.40
- `__tests__/test-v55-39-voicemail-dial-fail.js` — version assertions made forward-compatible

### New
- `__tests__/test-v55-40-phone-auto-inbound.js` — 42 assertions
- `HANDOFF-v55.40.md` — this document

### Untouched (carried over verbatim)
- `src/components/SettingsTab.jsx` — already had the cell forwarding UI; nothing to add
- `src/components/VoicemailsWidget.jsx` — already shows all the right info; just gets a parent anchor
- All v55.39 voicemail-record dial-failed branch
- All v55.38 login hydration fixes
- All v55.37 WhatsApp inbox + APIs
- AI HR Report, Treasury, CRM, etc.

## Carry-forward (still pending)

- **Fill in cell forwarding numbers** for each team member in Settings → Phone → Team Routing Preferences (this is data entry, not code)
- WhatsApp Cloud API setup at Meta
- Resend account + DNS + env vars
- Plaid env vars
- `NEXT_PUBLIC_APP_URL` env var (only matters when you cut over to hub.ktcus.com)
- Twilio Console access recovery (so you can manage things directly there)
- Run `import_usd_transactions.sql` and merchandiser SQL imports

## Coming next priority items

1. ~~AI HR Report~~ ✅ shipped (v55.35)
2. ~~WhatsApp completion~~ ✅ shipped (v55.37)
3. ~~Login hydration fix~~ ✅ shipped (v55.38)
4. ~~Voicemail dial-fail fix~~ ✅ shipped (v55.39)
5. ~~Auto-register browsers + voicemail visibility~~ ✅ shipped (v55.40)
6. **Twilio "Fix All Webhooks" button** (one-click webhook updates from inside the app, so you don't need Twilio Console access)
7. **Voicemail visibility for super_admin** — you should be able to see EVERYONE's voicemails, not just your own. Currently each user sees their own only.
8. **Shipping booking workflow** (uses WhatsApp inbox)
9. Resend test button + verify
10. Gmail multi-user OAuth
11. Better Nadia memory
