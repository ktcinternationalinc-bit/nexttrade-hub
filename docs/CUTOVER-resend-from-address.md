# Resend FROM-Address Cutover — `onboarding@resend.dev` → `notifications@ktcus.com`

**Status: BLOCKED on ktcus.com domain verification in Resend (failed in past attempt).**

---

## What this is

A small, isolated change: switch the FROM address on outbound notification emails from Resend's testing address (`onboarding@resend.dev`) to your own branded address (`notifications@ktcus.com`).

This is COMPLETELY SEPARATE from the portal URL cutover. See `CUTOVER-hub-ktcus-com.md` for that one. **They have nothing to do with each other.** The portal URL stays at `nexttrade-hub.vercel.app` either way.

## Why we want it

Currently `NOTIFICATION_FROM_EMAIL = onboarding@resend.dev`. Resend's testing domain only delivers to YOU (the account owner). That's why other teammates haven't been getting emails. To deliver to the whole team, we need to send from a verified domain.

## What it touches in the portal

Only outbound notification email FROM addresses. Read by these 4 files:
- `src/lib/notify-server.js`
- `src/app/api/notify/route.js`
- `src/app/api/notify/test/route.js` (test buttons)
- `src/app/api/email/send/route.js` (Communications-tab manual send)

Nothing else in the portal reads `NOTIFICATION_FROM_EMAIL`. Confirmed by grep audit.

## What it does NOT touch

- Portal URL (stays `nexttrade-hub.vercel.app`)
- Gmail OAuth (different env vars)
- WhatsApp (different env vars)
- Twilio phone (different env vars)
- Plaid, Anthropic, OpenAI, ElevenLabs, Supabase
- Database, user accounts, any data
- Resend API key itself (`RESEND_API_KEY` stays the same)

---

## Prerequisite: fix the failed ktcus.com verification in Resend

Past attempt failed during DNS verification. Resolve by going through the records one by one.

1. Open https://resend.com → log in → Domains
2. Click on `ktcus.com`
3. Resend shows you the DNS records and which are ✓ Verified vs ✗ Not Verified
4. Take a screenshot of that page → share with Claude in next session
5. The 3 records to add at Bluehost (or wherever ktcus.com DNS is hosted):

| Type | Host/Name | Value | Notes |
|---|---|---|---|
| TXT | `resend._domainkey` | (long DKIM string from Resend) | DKIM signing |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` priority 10 | Bounce handling |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF — sender policy |

Common reasons verification fails:
- TXT value got truncated when pasted (DKIM strings are long — 200+ chars)
- Host field has the full domain instead of just the subdomain prefix (i.e., put `resend._domainkey` not `resend._domainkey.ktcus.com` — many DNS panels auto-append the domain)
- DNS propagation delay (15 min – 2 hours, sometimes up to 24 hours)

Once you see green ✓ on every record in Resend, you're ready for the switch.

---

## The actual switch (after verification is green)

Single Vercel env var change:

1. Vercel → KTC NextTrade Hub → Settings → Environment Variables
2. Find `NOTIFICATION_FROM_EMAIL`
3. Change value from `onboarding@resend.dev` to `notifications@ktcus.com`
4. Save → Redeploy

That's it.

## Test

- Open the portal → Admin tab → Email Status panel
- Click **📨 Send test email to me** — should arrive in your inbox from `notifications@ktcus.com`
- Click **📬 Test all teammates** — confirm prompt → results table shows every active teammate as ✅ Sent

## Rollback

Change `NOTIFICATION_FROM_EMAIL` back to `onboarding@resend.dev` → redeploy. 30 seconds. Reverts to current state.

---

**Last updated:** May 6 2026 (v55.53)
**Blocker:** ktcus.com Resend domain verification (failed in past attempt — needs DNS records re-verified)
**Independent of:** the portal URL cutover (which is a separate, larger task documented elsewhere)
