# Portal URL Cutover Playbook — `nexttrade-hub.vercel.app` → `hub.ktcus.com`

**Status: DRAFT — not yet executed.** This is the planned cutover document. Follow it in order when ready.

---

## What this is

When you decide to move the portal off the Vercel default URL onto your own custom domain (`hub.ktcus.com`), this is the playbook that walks through everything that needs to change so nothing breaks.

This is SEPARATE from the Resend `notifications@ktcus.com` email FROM-address change. That one is purely email and doesn't touch the portal URL. This playbook is about the portal URL itself.

## Why a previous attempt failed

A past attempt to set up `hub.ktcus.com` failed during DNS verification at the Resend domain step. That's a separate (email) failure, not a portal failure. You have NOT actually attempted a portal-URL cutover yet — that's what this document is for. Don't conflate the two.

---

# Pre-flight checklist (do BEFORE the cutover day)

These can all be done over time without breaking anything. They prepare the cutover so the actual switch is fast.

## 1. Confirm where ktcus.com DNS is hosted

Likely Bluehost based on past chats. Verify by logging into Bluehost or running:
```
dig NS ktcus.com
```
Whatever shows in the NS records is your DNS host. You'll need login access to that provider for the next step.

## 2. Add `hub.ktcus.com` as a custom domain in Vercel

- Vercel → KTC NextTrade Hub project → Settings → Domains
- Click "Add" → type `hub.ktcus.com`
- Vercel shows you DNS instructions. There are two options:
  - **CNAME approach (recommended):** add CNAME `hub` → `cname.vercel-dns.com` at Bluehost
  - **A record approach:** add A record `hub` → `76.76.21.21` (Vercel's IP)
- Save the DNS record at Bluehost
- Wait 15 min – 2 hours for DNS to propagate
- Back in Vercel → it will show "Valid Configuration" with a green checkmark
- Vercel automatically issues an SSL cert via Let's Encrypt
- Test: open `https://hub.ktcus.com` in a browser — it should load the portal

After this step, BOTH URLs work simultaneously:
- `https://nexttrade-hub.vercel.app` — original
- `https://hub.ktcus.com` — new

This step alone breaks nothing. The portal is reachable from both URLs.

## 3. Recover Twilio Console access

Past chats note "Twilio Console access recovery" as still pending. Without console access you can't update phone-number webhooks during the cutover. Resolve this now — log in via password reset, support ticket, whatever it takes.

You'll need:
- Username/email used to create the Twilio account
- Access to the recovery email
- Twilio account ID (or phone number on the account, which you have — the NJ numbers)

Until Twilio Console access is back, do NOT proceed with the cutover. Phones will break.

---

# Cutover day — execute in this exact order

Every step below is paired with a rollback. If something goes wrong, you can revert any single step in seconds.

## Step 1 — Add `NEXT_PUBLIC_APP_URL` env var in Vercel

- Vercel → Settings → Environment Variables → Add new variable:
  - Name: `NEXT_PUBLIC_APP_URL`
  - Value: `https://hub.ktcus.com`
  - Apply to all 3 environments (Production, Preview, Development)
- Save → trigger a redeploy

**What this does:** The code already has logic to use this env var if set, falling back to `nexttrade-hub.vercel.app` if not. Setting it makes every Twilio webhook URL the code generates point to `hub.ktcus.com` from this point forward.

**Rollback:** Delete the env var → redeploy. Code goes back to the Vercel URL.

**Test before proceeding:** open `https://hub.ktcus.com`, log in, verify the portal works exactly as before. The header version pill should still show v55.5x. Don't move to Step 2 until this is confirmed.

## Step 2 — Update Twilio webhook URLs

Twilio has its own webhook URLs configured per phone number and per TwiML app. These do NOT update automatically — you change them in the Twilio Console.

For EACH NJ phone number on your Twilio account:
1. Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click the number
3. Voice & Fax section → "A CALL COMES IN"
   - Change from: `https://nexttrade-hub.vercel.app/api/phone/incoming`
   - Change to: `https://hub.ktcus.com/api/phone/incoming`
   - Method: HTTP POST (unchanged)
4. Save

Then for the TwiML App (used for outbound calling from the browser):
1. Twilio Console → Voice → TwiML Apps
2. Click your app (likely named something like "NextTrade" or "KTC")
3. Voice Configuration → Request URL
   - Change from: `https://nexttrade-hub.vercel.app/api/phone/outbound`
   - Change to: `https://hub.ktcus.com/api/phone/outbound`
   - Method: HTTP POST (unchanged)
4. Save

**Test:** call one of your NJ numbers from a personal phone. You should hear the proper greeting; if the call drops with "an application error has occurred," the webhook URL is wrong — go back and check.

**Rollback:** change the webhook URL back to the old `nexttrade-hub.vercel.app` value. 30 seconds.

## Step 3 — Update Google Cloud Console (Gmail OAuth)

Google's OAuth strictly requires the redirect URI in the request to match one of the URIs whitelisted in the Cloud Console. If they don't match, Gmail Connect breaks for everyone.

- Open https://console.cloud.google.com → KTC NextTrade Hub project
- APIs & Services → Credentials → click your OAuth 2.0 Client ID
- "Authorized redirect URIs" section
- Click "+ ADD URI" → add `https://hub.ktcus.com/api/gmail/callback`
- DO NOT delete the old `https://nexttrade-hub.vercel.app/api/gmail/callback` URI yet — keep both during the transition so existing connections don't break
- Save

Then in Vercel:
- Settings → Environment Variables → find `GOOGLE_REDIRECT_URI`
- Change from `https://nexttrade-hub.vercel.app/api/gmail/callback` to `https://hub.ktcus.com/api/gmail/callback`
- Save → redeploy

**Effect on existing Gmail connections:** access tokens still work because they're stored in the database, not regenerated on URL change. Refresh tokens still work because Google's token refresh endpoint doesn't use the redirect URI. So in theory, no teammate should need to reconnect.

**However** — if any teammate's OAuth flow happens to fail later (e.g. their token expired and refresh fails for an unrelated reason), they'll need to click "Connect Gmail" again to re-authorize through the new redirect URI. This is fine; it's a single button click for them.

**Rollback:** revert the Vercel env var → redeploy. Google's whitelist still has both URIs, so old connections continue to work.

**Test:** ask one teammate to disconnect Gmail in Settings → Communications, then reconnect. Should work seamlessly. Then ask another teammate who hasn't reconnected — verify their inbox still loads via the existing token.

## Step 4 — Update Supabase Auth URL allowlist

If Supabase Auth's "Site URL" or "Redirect URLs" allowlist still points only to the Vercel URL, password reset emails and any auth-related redirects will go to the wrong place.

- Supabase → KTC project → Authentication → URL Configuration
- "Site URL": change from `https://nexttrade-hub.vercel.app` to `https://hub.ktcus.com`
- "Redirect URLs" allowlist: ADD `https://hub.ktcus.com/**` (don't remove the old one yet — keep both)
- Save (no Supabase redeploy needed; takes effect immediately)

**Test:** trigger a password reset email to one teammate, click the link, verify it lands on `https://hub.ktcus.com/...` not the old Vercel URL.

**Rollback:** revert Site URL back. Instant.

## Step 5 — Update WhatsApp webhook (only if Meta Cloud API is already configured)

Skip this step if the 5 WhatsApp env vars (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) aren't yet set in Vercel — that means WhatsApp isn't live yet, so there's nothing to update. When you eventually configure WhatsApp Cloud API, just use `hub.ktcus.com` from the start.

If WhatsApp IS already configured:
- Meta Business → your app → WhatsApp → Configuration → Webhook
- Callback URL: change from `https://nexttrade-hub.vercel.app/api/whatsapp/webhook` to `https://hub.ktcus.com/api/whatsapp/webhook`
- Verify token: keep the same string
- Click "Verify and save"
- Meta does a one-time GET handshake. Should succeed because the verify token is unchanged.

**Test:** send a WhatsApp message to your business number from a personal phone. It should land in the inbox.

**Rollback:** revert the Callback URL back. Instant.

## Step 6 — Code patch — clean up hard-coded URLs in notification email templates

Several email templates have `https://nexttrade-hub.vercel.app` hard-coded as the "Open NextTrade Hub" link inside the email body. These will still work after cutover because Vercel keeps the old URL alive — but emails will show the old URL, which looks unprofessional.

**Files to clean up:**
- `src/app/api/notify/route.js` line 140 — "Open NextTrade Hub" link
- `src/app/api/notify/test/route.js` line ~141 — same template

I should patch these to read `process.env.NEXT_PUBLIC_APP_URL || 'https://nexttrade-hub.vercel.app'` so emails reflect the canonical URL once `NEXT_PUBLIC_APP_URL` is set.

Plan to do this BEFORE cutover day so emails are correct from day one. (Tell me when ready and I'll ship this in the next build.)

## Step 7 — Communicate to the team

Send a short email or Slack message:

> Hey team — the portal has a new URL: **https://hub.ktcus.com**. Update your bookmarks. The old URL still works during the transition, so no rush, but use the new one going forward. Nothing else changes — same login, same data, same everything else.

## Step 8 — Soak period (recommended: 1-2 weeks)

Keep BOTH URLs active for 1-2 weeks before removing the Vercel default URL. This catches any forgotten reference. After the soak:

- Twilio webhooks confirmed working with new URL
- All teammates have logged in via the new URL at least once
- No issues reported for 7+ consecutive days

Then optionally tighten up:
- Google Cloud Console → remove the old `nexttrade-hub.vercel.app/api/gmail/callback` redirect URI (keeps the whitelist clean)
- Supabase Auth → remove the old URL from the Redirect URLs allowlist
- Vercel still keeps the default URL alive forever — that one you don't have to remove

---

# What does NOT need to change (reference)

These were checked in the audit and confirmed cutover-safe. Listed here so we don't waste time worrying about them later:

| System | Why it's safe |
|---|---|
| Database (Supabase data, schema, all tables) | URL change doesn't touch data |
| Anthropic API (Nadia) | Uses `ANTHROPIC_API_KEY` env var; doesn't care about portal URL |
| OpenAI Whisper | Uses `OPENAI_API_KEY`; doesn't care about portal URL |
| ElevenLabs | Uses `ELEVENLABS_API_KEY`; doesn't care about portal URL |
| Plaid (US bank) | Uses `PLAID_*` env vars; webhook can be configured later |
| Resend API key | `RESEND_API_KEY` — the key itself is portal-URL-independent |
| Resend FROM address | `NOTIFICATION_FROM_EMAIL` — separate change, separate trigger (see ktcus-email-from-cutover doc) |
| PWA manifest | Uses `start_url: '/'` (relative) — auto-adapts to whatever URL the app is loaded from |
| Vercel cron jobs | Use relative paths (`/api/categorize`, etc.) — auto-adapt |
| User accounts, profiles, team data | All in Supabase — URL change doesn't touch any of it |
| Saved tickets, calendar events, treasury rows, invoices, customs clearances | All in Supabase |
| Notification preferences | All in Supabase |
| Module permissions | All in Supabase |
| Login behavior | Supabase Auth — only thing that needs the URL allowlist update (Step 4) |

---

# Files in code that reference the portal URL (audit complete)

Total: 15 hard-coded references across these files. All of them either honor `NEXT_PUBLIC_APP_URL` first OR are diagnostic/comment text:

**Honor `NEXT_PUBLIC_APP_URL`, fall back to default — auto-update after Step 1:**
- `src/lib/phone-auth.js` (signature verification — line 218 fallback)
- `src/app/api/phone/incoming/route.js` (line 56-63 — uses env first)
- `src/app/api/phone/outbound/route.js` (line 43-48 — uses env first)
- `src/app/api/phone/voicemail-record/route.js` (line 37-42 — uses env first)
- `src/app/api/phone/recording-callback/route.js` (line 26-31 — uses env first)
- `src/app/api/phone/transcribe-cron/route.js` (line 33-38 — uses env first)
- `src/app/api/ask-v2/route.js` (line 142 — uses env first)

**Diagnostic / setup-instructions text (cosmetic only):**
- `src/components/SettingsTab.jsx` (line 1444 — WhatsApp webhook setup hint)
- `src/app/api/phone/diagnose/route.js` (lines 125, 242, 297 — instruction strings)
- `src/app/api/ask/diag/route.js` (line 5 — comment)
- `src/app/api/phone/incoming/route.js` (line 84, 338 — last-resort safety fallbacks)

**Cleaned in Step 6 (email templates):**
- `src/app/api/notify/route.js` (line 140 — "Open NextTrade Hub" link)
- `src/app/api/notify/test/route.js` (line ~141 — bulk-test email link)

---

# Rollback strategy if cutover goes sideways

The whole cutover is reversible at every step. Worst case scenario at any point:

1. Vercel → `NEXT_PUBLIC_APP_URL` → delete the env var → redeploy. Code reverts to Vercel URL.
2. Twilio Console → revert each phone number's webhook URL back to Vercel default. 30 seconds per number.
3. Google Cloud Console → revert `GOOGLE_REDIRECT_URI` env var. The Vercel URI is still in the whitelist (we never removed it), so it just works again.
4. Supabase Auth → revert Site URL. Instant.
5. Meta WhatsApp → revert webhook URL. Instant.

Nothing is permanent. Nothing touches user data. Nothing touches the database. Worst-case downtime if everything goes wrong AND you have to roll back: ~5 minutes.

---

# Estimated time

- Pre-flight (DNS, custom domain in Vercel, Twilio access recovery): scattered over a week
- Cutover day execution: 1-2 hours hands-on work
- Soak period: 1-2 weeks of monitoring with no action needed

---

**Last updated:** May 6 2026 (v55.53)
**Owner:** Max
**Next step:** confirm `hub.ktcus.com` DNS + custom domain in Vercel before scheduling cutover day
