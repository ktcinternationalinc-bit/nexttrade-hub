# Phone System — Complete Setup Guide

If diagnostics show red, this guide gets you to all green.

The phone system has three sides that all have to be in sync:
1. **Vercel** — environment variables that prove who we are to Twilio
2. **Twilio Console** — where the phone numbers live and the rules for what happens when a call arrives
3. **Supabase** — database tables that record every call and let the team configure routing

---

## Step 1 — Find your Twilio credentials

Go to [console.twilio.com](https://console.twilio.com) and log in.

### Account SID + Auth Token (the "main keys")

On the home dashboard you'll see **Account Info** at the top. Two values to copy:
- **Account SID** — starts with `AC...` — this is your account number
- **Auth Token** — click the eye icon to reveal — this is the secret password for your whole account

Treat the Auth Token like a password. Anyone with it can spend your money.

### API Key + Secret (separate from Auth Token)

In the left sidebar: **Account → API keys & tokens → Create API key**.
- Name: anything you'll recognize, like "NextTrade Hub"
- Key type: **Standard**
- Click Create

You'll see two values that are ONLY shown once:
- **SID** — starts with `SK...` — that's your `TWILIO_API_KEY_SID`
- **Secret** — long random string — that's your `TWILIO_API_KEY_SECRET`

Save both immediately. If you lose the Secret you have to delete the key and make a new one.

### TwiML App SID (the rule for outbound calls)

Twilio needs to know what to do when the browser asks to dial out. You tell it via a TwiML App.

In the left sidebar: **Voice → Manage → TwiML Apps → Create new TwiML App**.
- Friendly name: "KTC Browser Dialing"
- Voice section → **Request URL**: `https://nexttrade-hub.vercel.app/api/phone/outbound`
- Voice section → method: `HTTP POST`
- Save

After saving, the page shows the **App SID** at the top — starts with `AP...` — that's your `TWILIO_TWIML_APP_SID`.

---

## Step 2 — Add the env vars in Vercel

Go to your Vercel project → **Settings → Environment Variables**. Add these five:

| Variable name | Value | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | The `AC...` from Twilio dashboard | |
| `TWILIO_AUTH_TOKEN` | The eye-icon value from Twilio dashboard | This is what verifies incoming Twilio webhooks AND lets us play back voicemail audio. **Critical — voicemail playback fails without it.** |
| `TWILIO_API_KEY_SID` | The `SK...` you copied | |
| `TWILIO_API_KEY_SECRET` | The long random string you copied | |
| `TWILIO_TWIML_APP_SID` | The `AP...` from your TwiML App | |

Plus these two helpers:

| Variable name | Value | Notes |
|---|---|---|
| `INTERNAL_SECRET` | Any 32+ char random string | Run `openssl rand -hex 32` in a terminal to make one. Used by voicemail transcription jobs. |
| `NEXT_PUBLIC_APP_URL` | `https://nexttrade-hub.vercel.app` | Optional. Set this if you switch to hub.ktcus.com later. |

After adding all of them, **redeploy** so Vercel picks them up. (On the Deployments tab, click the three dots on the latest deployment → Redeploy.)

---

## Step 3 — Point each phone number at our app

In Twilio Console, go to **Phone Numbers → Manage → Active numbers**.

For each of your 4 KTC numbers, click the number and find the **Voice & Fax** section. Set:
- **A CALL COMES IN**: Webhook → `https://nexttrade-hub.vercel.app/api/phone/incoming` → HTTP POST
- **PRIMARY HANDLER FAILS**: leave blank (we have an internal fallback)

Save. Repeat for all 4 numbers.

---

## Step 4 — Make sure the database is ready

In Supabase SQL editor, paste and run these in order if you haven't already:
1. `sql/s29_phone_system.sql` — creates the phone_numbers, phone_calls, phone_voicemails, phone_recordings tables
2. `sql/s30_seed_ktc_phone_numbers.sql` — inserts your 4 KTC numbers
3. `sql/s31_phone_routing_user_columns.sql` — adds forwarding_number, phone_routing, phone_vacation_mode to users
4. `sql/s32_phone_rls_policies.sql` — adds Row-Level Security and the unique index that prevents duplicate voicemails

All four are idempotent — safe to re-run if you're not sure.

---

## Step 5 — Verify with the diagnostics tool

In the app, go to **Settings → Phone**. At the top there's a new section called **🔍 System Health** with a **Run Diagnostics** button. Click it.

You'll see a checklist. Every green check ✓ means that piece is working. Anything yellow ⚠ or red ✗ tells you exactly what to fix. The diagnostics check:
- All 5 env vars are set (and warn if values look wrong, e.g. don't start with the right prefix)
- Twilio credentials actually authenticate (talks to Twilio's API)
- Your TwiML App is configured with the right voice URL
- All 4 KTC numbers are owned by your Twilio account
- Each KTC number has its inbound webhook pointing at our `/api/phone/incoming`
- The database tables exist
- At least one phone number is assigned to a team member

If everything is green, browser dialing and inbound calling are both ready.

---

## Step 6 — Assign each number to a team member

Still on **Settings → Phone**, scroll past the diagnostics. You'll see your 4 numbers listed. For each one:
- Set **Assigned to** dropdown to the team member who owns that line
- Confirm **Recording** and **Voicemail** are on (or off if you don't want them)

Below the numbers section is **Team member call routing**. For each person:
- **Forwarding number** — their personal cell (in `+1...` E.164 format)
- **Routing mode** — pick one:
  - **Browser only** — only their browser rings (cheapest)
  - **Cell only** — only their cell rings (works without browser open)
  - **Browser then cell** — browser rings 25 seconds, then cell takes over (recommended)
- **Vacation mode** — when on, calls skip them entirely and go to voicemail

---

## Step 7 — Test outbound (browser dialing)

1. Open the app, click the green phone button on the bottom-left.
2. The first time you click it, the browser asks for microphone permission. Allow.
3. After 1-2 seconds you should see "📞 Twilio Device registered — ready to receive calls" in the browser console (open Developer Tools → Console).
4. Type a number you can answer (your own cell), click 📞 Call.
5. The call status changes from Connecting → Ringing → On Call when answered.
6. The recipient hears "This call may be recorded for quality and training purposes" then the call connects.
7. Their caller ID shows the KTC number assigned to you.

If something goes wrong, the error appears as red text in the phone widget. Common things:
- "Phone init failed" — usually means an env var is missing. Run diagnostics.
- "Missing Twilio env vars: ..." — the diagnostics will tell you exactly which.
- "[some Twilio code] message" — paste the code into Twilio's error decoder: [twilio.com/docs/api/errors](https://www.twilio.com/docs/api/errors)

---

## Step 8 — Test inbound

1. From your cell, dial one of your 4 KTC numbers.
2. You should hear "Thank you for calling KTC International. This call may be recorded..."
3. Then the assigned team member's browser AND/OR cell should ring (depending on their routing mode).
4. If nobody answers in 25 seconds, the caller hears "The team is unavailable right now. Please leave a message after the beep" and can record a voicemail.
5. Open **Settings → Phone → Voicemails** (or the Voicemails section of the dashboard) — you should see the voicemail with a play button.

If the call never reaches anyone:
- Check Twilio's **Monitor → Logs → Calls** to see if Twilio even received it
- Check the diagnostics — most likely the number's webhook URL is wrong, or `assigned_to` is NULL

---

## Common gotchas

**"Browser dialing works but the recipient hears silence"**
The recording disclaimer plays first via `<Say>` before `<Dial>` connects. If you don't hear anything, something else is wrong — probably the recipient hung up or call failed before answer.

**"Inbound rings but voicemail playback says 'fetch failed'"**
This is what `TWILIO_AUTH_TOKEN` fixes. Add it in Vercel and redeploy.

**"Calls work for me but not for my team"**
Each team member has to:
1. Open the phone widget at least once per session (browser dialing is lazy-init)
2. Allow microphone permission
3. Have an `assigned_to` row in the phone_numbers table
4. Be listed in the users table with a role

**"Browser dialing keeps disconnecting after an hour"**
Tokens expire after 1 hour. The Voice SDK is supposed to refresh them automatically via the `tokenWillExpire` event we listen for. If this fails, the user just needs to close + reopen the phone widget.

---

## Cost estimate (rough, for planning)

| Activity | Cost |
|---|---|
| Each Twilio US local number rented | $1.15/month |
| Each toll-free number rented | $2.00/month |
| Inbound call to a US number | $0.0085/min |
| Inbound call to toll-free | $0.0220/min |
| Outbound call (US → US) | $0.0140/min |
| Outbound call (US → Egypt mobile) | ~$0.20/min |
| Cell forwarding leg (Egypt) | additional ~$0.16-0.22/min |
| Voicemail storage | free up to 10,000 recordings |
| OpenAI Whisper transcription | ~$0.006/min of audio |

Browser-to-browser calls are essentially free (pays for the inbound minute only). Cell forwarding to Egypt is the expensive part — set vacation mode or browser-only routing during off hours to avoid paying for cell legs to nobody.
