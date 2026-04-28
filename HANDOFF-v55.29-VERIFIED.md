# NextTrade Hub — Session Handoff (v55.29 VERIFIED)

**Date:** 2026-04-27
**Build stamp in code:** v55.29-DIAL-FORMAT
**Status:** ✅ BUILD VERIFIED + 61/61 TEST SUITES GREEN

---

## What's in this build

Two phone fixes plus one open item that has to be done in Twilio Console (not in code).

### Fix 1 — The dial pad now auto-formats numbers

**The bug:** Typing 17322086932 on the on-screen keypad and hitting Call gave you "Destination must be in E.164 format starting with plus sign." That was happening because Twilio strictly requires international format (`+17322086932` with the leading plus). The keypad only had digit buttons, so users typing numbers naturally never produced the `+`.

**The fix:** The phone widget now does the right thing automatically. When you type:
- **10 digits** (e.g. `7322086932`) → dials `+17322086932` (assumes US/Canada)
- **11 digits starting with 1** (e.g. `17322086932`) → dials `+17322086932` (US with country code already typed)
- **Already starts with +** (e.g. `+201234567890`) → dials as-is (international, you knew what you were doing)
- **Anything else** → button is greyed out with a "Add country code (e.g. +1 for US, +20 for Egypt)" hint

There's also a live preview right under the input field showing exactly what number will be dialed — so before you click Call, you can confirm the system is going to dial what you intended.

### Fix 2 — Outbound calls work even without an assigned number

The widget shows "No number assigned" if your row in `phone_numbers` doesn't have your user ID in `assigned_to`. Previously this also meant the outbound call would silently fail because the system had no caller-ID to use.

**Now there's a 3-tier fallback:**
1. Your assigned phone_numbers row (preferred — recipient sees you as the caller)
2. `TWILIO_MAIN_NUMBER` env var (legacy override)
3. The shared "main" toll-free line in the phone_numbers table

If all three fail, you'll hear a clear voice message ("No phone number is configured for outgoing calls. Please ask an admin to assign you a phone number in Settings") instead of the call dying with no explanation.

### Open item — Two of your KTC numbers still point at Twilio's demo URL

The diagnostics in your screenshot caught this:

> Some numbers have a voice URL that does not point at /api/phone/incoming. Inbound calls to those numbers will not reach our app.
> Affected: **+17328005428** (voiceUrl: https://demo.twilio.com/welcome/voice/) and **+17328100075** (voiceUrl: https://demo.twilio.com/welcome/voice/)

**You need to fix this in Twilio Console — code can't fix this for you.** Steps:

1. Go to [console.twilio.com](https://console.twilio.com)
2. Left sidebar: **Phone Numbers → Manage → Active numbers**
3. Click **+17328005428** (Bound Brook NJ line — Adam Eltheim's based on your s30 SQL)
4. Scroll to **Voice & Fax** section
5. Find **A CALL COMES IN** — currently shows "Webhook" + "https://demo.twilio.com/welcome/voice/"
6. Change to: `https://nexttrade-hub.vercel.app/api/phone/incoming`
7. Method: `HTTP POST`
8. Click **Save** at the bottom
9. **Repeat for +17328100075** (the other affected line)

After both are fixed, click Run Diagnostics again — that warning should turn green.

Until you do this, calls TO those two numbers will hit Twilio's generic demo voice instead of your app. Outbound from those team members still works fine — this only affects inbound.

---

## Files changed in v55.29

```
EDIT   src/components/PhoneWidget.jsx              (toE164 helper, live E.164 preview, gated Call button)
EDIT   src/app/api/phone/outbound/route.js         (3-tier caller ID fallback + clear voice error)
EDIT   src/app/page.jsx                            (build stamp v55.28 → v55.29 in both spots)
NEW    __tests__/test-v55-29-dial-format.js        (13 assertions covering the fixes)
```

---

## Verification

- `next build` → **exit 0**, all 46 routes generated, compile clean.
- Full test sweep: **61 / 61 suites passing** (added v55.29 tests).
- Build stamps confirmed at v55.29.

---

## Deploy steps for v55.29

1. GitHub Desktop → Show in Finder → delete all → unzip MERGED-COMPLETE-55.29.zip → commit → push.
2. Wait 90 seconds for Vercel.
3. Hard refresh (Cmd+Shift+R).
4. Look for **`v55.29`** in the header.
5. Click the green phone button bottom-left → type a 10-digit number on the keypad.
6. Confirm the live preview underneath shows "Will dial: +1...".
7. Click Call → should connect.
8. **In Twilio Console**, fix the two numbers still pointing at the demo URL (see "Open item" above).
9. Run Diagnostics again — should be all green now.
10. Test inbound by calling +17328005428 from your cell — should ring whoever's assigned to it (in the Bound Brook NJ line — was Adam in the s30 seed).

---

## What was inherited from earlier versions (still in effect)

- Calendar cancel/delete buttons show prominent z-200 overlay confirmations
- Toast errors fire when permission is denied
- Calendar grid re-fetches after cancel/delete
- Phone widget bundles `@twilio/voice-sdk` (no more "[object Event]" errors)
- Settings → Phone shows the 4 numbers
- Modern Supabase split-cookie format recognized
- Starred priority-board cards have readable dark text on amber background
- Tickets Blocked / On Hold buttons actually update the status (s33 migration required)
- Phone diagnostics page in Settings → Phone (System Health card)

---

## Carry-over to-do (after phone is fully verified)

- Resend email setup (env vars + DNS for ktcus.com)
- Plaid env vars
- 189 USD treasury transactions still need importing
- Bilingual categories UI
- Mobile Nadia freeze fix
- Customs broker tab
- hub.ktcus.com subdomain
- Color coding on Treasury/Sales views
- Warehouse all-years display fix
