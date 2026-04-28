# NextTrade Hub — Session Handoff (v55.31 SCAFFOLDING)

**Date:** 2026-04-27
**Build stamp in code:** v55.31-WHATSAPP-SCAFFOLD
**Status:** ✅ BUILD VERIFIED + 63/63 TEST SUITES GREEN
**⚠️ This is a partial build — UI is not yet wired in. Read carefully.**

---

## Honest summary

You asked for full WhatsApp integration with all 6 v1 features and 3 UI views. That is a 2–3 hour build done properly. **This delivery covers about 40% of it** — the foundation that everything else sits on top of. The remaining 60% (UI components, three more API endpoints, tab wiring) needs a fresh session because this conversation is too long to safely keep stacking new code without risking regressions in the rest of the app.

**What you can actually do with v55.31 today:**
- Run the SQL and have the database tables ready
- Configure Meta Business Manager and have webhooks landing in your DB
- Send messages programmatically via `POST /api/whatsapp/send` (e.g. from another internal tool, or curl, or the AI assistant)
- See incoming messages stored in `whatsapp_messages` and conversations created automatically

**What you CANNOT do yet:**
- See an inbox in the portal — there's no UI tab
- Click "Reply" or "Send template" — those buttons don't exist yet
- Browse media that customers send — the download proxy isn't built
- See available templates — no list endpoint

If you don't want a half-built feature in your repo, **don't push this build yet.** Wait for v55.32 next session which finishes the UI. The choice is yours.

---

## What's in v55.31

### Database (`sql/s35_whatsapp_tables.sql`)

Three new tables that everything else builds on:

**whatsapp_conversations** — one row per customer phone. Tracks who claimed the conversation, last inbound/outbound timestamps (used for the 24-hour reply window), unread counter, pin/archive flags. The `customer_wa_id` column is UNIQUE — that's what makes simultaneous incoming messages from the same customer race-safe (only one conversation row can exist).

**whatsapp_messages** — every message in or out. The `wa_message_id` column is UNIQUE so when Meta retries a webhook (which it does aggressively), we don't end up with duplicate rows. Stores text, media (id/mime/filename), templates (name/lang/variables), and outbound status (sending → sent → delivered → read OR failed with error code).

**whatsapp_templates** — local cache of Meta-approved templates. Refreshed via the templates endpoint (planned for v55.32).

All three have RLS enabled. API routes use the service-role key (bypasses RLS). Direct browser queries via supabase-js can SELECT but not modify.

### Helper library (`src/lib/whatsapp.js`)

The Meta Cloud API specifics live here so the route handlers stay clean. Functions:

- `verifyMetaSignature(rawBody, sigHeader)` — HMAC-SHA256 verification with constant-time compare. Fails closed if the secret isn't set (otherwise an attacker could send any forged webhook).
- `sendText(toE164, body)` — standard text message
- `sendMedia(toE164, kind, mediaId, opts)` — image/document/audio/video by media_id
- `uploadMedia(buffer, mimeType, filename)` — upload bytes to Meta, get media_id back
- `sendTemplate(toE164, name, langCode, variables, headerImageMediaId?)` — fills `{{1}}, {{2}}, ...` in the approved template
- `getMediaInfo(mediaId)` — exchanges a media_id for Meta's temporary download URL (for inbound media we want to play back)
- `listTemplates()` — pulls every template from Meta for caching
- `isInWindow(lastInboundAt)` — returns true if free-text reply is allowed (within 24h of last customer message), false if a template is required
- `normalizePhone(raw)` — canonical E.164 conversion so customer phones match CRM phones

Graph API version is pinned to v21.0 (Meta deprecates Graph API versions every ~2 years, pinning protects against silent breakage).

### Webhook (`src/app/api/whatsapp/webhook/route.js`) — replaces the old Twilio stub

Two HTTP methods on the same URL:

- **GET** — Meta's one-time verification handshake when you set up the webhook. It echoes Meta's `hub.challenge` back in plain text if our `WHATSAPP_VERIFY_TOKEN` matches.
- **POST** — every actual webhook event. Verifies HMAC signature on the raw body BEFORE parsing JSON (re-stringifying parsed JSON breaks the signature because whitespace differs). Then:
  - For inbound messages: dedupes by `wa_message_id`, finds-or-creates the conversation row, auto-matches CRM customer by phone last-10-digits, stores text or media reference, updates conversation timestamps + unread count
  - For status updates: updates the matching outbound message's status field (sent → delivered → read, or failed with error code/message)

Every code path returns 200 even on internal errors. Meta retries on non-2xx and a 500 storm would get our IP blocked. Errors go to Vercel logs instead.

Handles every WhatsApp message type: text, image, video, audio, document, sticker, location, contacts, interactive (button/list reply), and reaction (emoji on our message). Unknown types are logged but still saved so nothing is silently lost.

### Send (`src/app/api/whatsapp/send/route.js`) — replaces the old Twilio stub

Single endpoint with three modes detected from request body shape:

- **Text:** `{ conversation_id, body }`
- **Media:** `{ conversation_id, kind: 'image'|'document'|'audio'|'video', upload: {base64, mime_type, filename} | media_id, caption? }`
- **Template:** `{ conversation_id, template_name, language_code?, variables: [...], header_image_media_id? }`

24-hour window is enforced for text and media. Outside the window you'll get a clear `WINDOW_EXPIRED` error code so the UI (when it exists) can switch to template mode automatically. Templates can be sent at any time.

Failed sends still create a row marked `status: 'failed'` with the error code and message so the team has an audit trail of what didn't go through. Successful sends stamp the `wa_message_id` so when the webhook later receives the delivered/read status update, it can find the row to update.

Media size is capped at 16MB to keep upload latency reasonable. Meta's actual limits are higher (5MB image, 16MB video, 100MB doc) but those upload times would block the API call too long.

---

## Files changed in v55.31

```
NEW    sql/s35_whatsapp_tables.sql                          (run this in Supabase first)
NEW    src/lib/whatsapp.js                                  (Meta API helpers)
EDIT   src/app/api/whatsapp/webhook/route.js                (full Meta Cloud rewrite — was Twilio stub)
EDIT   src/app/api/whatsapp/send/route.js                   (full Meta Cloud rewrite — was Twilio stub)
EDIT   src/app/page.jsx                                     (build stamp v55.30 → v55.31)
NEW    __tests__/test-v55-31-whatsapp-scaffold.js           (32 assertions covering everything shipped)
```

Notable: NO new tab in the TABS array yet. NO new components. The portal looks identical to v55.30 from the user's perspective.

---

## Verification

- `next build` → **exit 0**, all 46 routes generated, compile clean
- WhatsApp routes appear in the build output: `/api/whatsapp/send`, `/api/whatsapp/webhook`
- Full test sweep: **63 / 63 suites passing** (added v55.31 scaffolding tests, no regressions)
- Build stamps confirmed at v55.31

---

## What's still pending for v55.32 (next session)

1. **`/api/whatsapp/media`** — proxy media downloads. Meta's media URLs require a Bearer token (same problem as Twilio recordings). The browser can't add that header to an `<img src>` or `<audio src>` tag, so we proxy through our domain.

2. **`/api/whatsapp/templates`** — GET cached templates from our DB, POST refreshes from Meta and upserts into `whatsapp_templates`.

3. **`/api/whatsapp/diagnose`** — admin health check page following the same pattern as `/api/phone/diagnose`. Verifies env vars set, Meta credentials authenticate, business account ID is correct, template count, webhook URL configured, etc.

4. **Conversation claim endpoint** — `POST /api/whatsapp/conversations/[id]/claim` to mark `assigned_to = me`.

5. **Mark-as-read endpoint** — resets `unread_count` when the user opens a conversation.

6. **`src/components/WhatsAppTab.jsx`** — top-level inbox view. Conversation list on the left (with unread badges, claim status, last message preview, time), message thread on the right with composer at the bottom. Composer auto-switches to template picker when 24h window has expired. Handles drag-drop image/PDF upload. Shows delivery status icons (✓ sent, ✓✓ delivered, ✓✓ read).

7. **Communications tab embed** — pulls the WhatsAppInbox component into the existing Communications tab.

8. **CRM customer detail thread** — filters conversations to the selected customer's phone, shows the thread inline on their CRM card.

9. **Add `whatsapp` to the `TABS` array** in page.jsx so the new tab appears in navigation.

10. **Tests** for all of the above.

11. **Run full test sweep + production build verification + zip** as v55.32.

---

## What you must do BEFORE this code does anything

This is the part that will take the longest — none of it is code, all of it is Meta and Vercel setup.

### 1. Meta Business Manager setup (1–7 days)

a. Go to [business.facebook.com](https://business.facebook.com) and either log into your existing Business Manager or create one for KTC International Inc.

b. **Get verified.** Meta wants:
   - KTC's certificate of incorporation
   - A utility bill or bank statement at the registered business address
   - A business website that exists and looks legit (ktcus.com — fine)
   - Possibly a 15-minute video call if anything looks off
   - Verification typically takes 1–7 business days

c. **Add a WhatsApp Business Account.** From Business Manager → Settings → WhatsApp Accounts → Add. You'll register a phone number here. **CRITICAL: this number can never be used in regular WhatsApp again.** Per your prior plan, you'll flip your existing business number to API and put personal contacts on a new SIM.

d. **Create a System User.** Business Manager → Settings → Users → System Users → Add. Generate a long-lived access token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions. Save it — you can't see it again.

### 2. Set up the webhook in Meta dashboard

a. Go to [developers.facebook.com](https://developers.facebook.com) → your App → WhatsApp → Configuration

b. **Webhook URL:** `https://nexttrade-hub.vercel.app/api/whatsapp/webhook`

c. **Verify token:** any random string YOU pick, e.g. `ktcus-wa-verify-7f3a2b9c`. You'll put this same string in Vercel as `WHATSAPP_VERIFY_TOKEN`. When you click "Verify and save" Meta hits our GET endpoint with `?hub.verify_token=YOUR_STRING&hub.challenge=RANDOM`. We only echo the challenge back if the token matches, so this proves to Meta that you control both ends.

d. **Subscribe to webhook fields:** at minimum `messages`. (You can add `message_template_status_update` later if you want to know when Meta approves/rejects templates.)

### 3. Vercel environment variables

Add all five before deploying (Vercel → Project Settings → Environment Variables):

| Variable | Where to find it | Notes |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta dashboard → WhatsApp → API Setup → "From" phone number ID | This is an ID, NOT the actual phone number |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta dashboard → WhatsApp → API Setup → WhatsApp Business Account ID | Required for templates list endpoint |
| `WHATSAPP_ACCESS_TOKEN` | The system user token you generated above | Long-lived. Treat like a password. |
| `WHATSAPP_APP_SECRET` | Meta dashboard → App Settings → Basic → App Secret (click Show) | Used to verify webhook signatures. **Without this, the webhook fails closed** — every inbound message gets rejected as "unsigned." |
| `WHATSAPP_VERIFY_TOKEN` | The random string YOU picked above | Must match what you typed in Meta dashboard |

After adding all five, **redeploy** so Vercel picks them up.

### 4. Pre-approve at least one message template

Until you have an approved template, you can ONLY reply to customers who messaged you first (within 24 hours). To proactively message customers (order updates, invoice reminders, anything), you need templates pre-approved by Meta.

Submit your first templates at Meta dashboard → WhatsApp → Message Templates → New. Approval typically takes 1–24 hours per template. Categories:
- **Utility** — order updates, appointment reminders, account notifications. Cheapest.
- **Marketing** — promotional. Most expensive, strictest rules.
- **Authentication** — OTP codes only.

Useful starter templates for KTC:
- "Hi {{1}}, your order #{{2}} has been shipped and is expected to arrive by {{3}}."
- "Reminder: invoice #{{1}} for {{2}} EGP is due on {{3}}."
- "Hi {{1}}, your payment of {{2}} EGP for invoice #{{3}} has been received. Thank you!"

---

## Deploy steps for v55.31

This is the part where you decide whether to push this build or wait for v55.32.

**If you want to push v55.31 now (foundation only, no UI):**

1. **Run the SQL first** — Supabase → SQL editor → paste `sql/s35_whatsapp_tables.sql` → Run. Should say "Success. No rows returned."

2. **Set Vercel env vars** (the five above). Redeploy.

3. **Set up Meta webhook** pointing at `https://nexttrade-hub.vercel.app/api/whatsapp/webhook` with your chosen verify token.

4. **Push the code:** GitHub Desktop → Show in Finder → delete all → unzip MERGED-COMPLETE-55.31.zip → commit → push.

5. **Wait 90s for Vercel.** Hard refresh. The portal looks identical (no new tab) — that's expected.

6. **Test inbound:** Send a WhatsApp message from your phone to the KTC business number. Within seconds you should see a row appear in `whatsapp_messages` and a row in `whatsapp_conversations` (Supabase → Table Editor). If nothing appears, check the webhook signature is right (Meta dashboard → Webhook → "Send test").

7. **Test outbound (via curl or AI assistant):**
   ```
   curl -X POST https://nexttrade-hub.vercel.app/api/whatsapp/send \
     -H "Content-Type: application/json" \
     -H "Cookie: <your auth cookie>" \
     -d '{"conversation_id": "UUID_FROM_STEP_6", "body": "Hello from NextTrade"}'
   ```
   The customer should receive the message on WhatsApp.

**If you'd rather wait for v55.32 (full UI):** keep the zip but don't deploy. Or push only the SQL migration so the database is ready when v55.32 lands.

---

## What was inherited from earlier versions (still in effect)

- v55.30 — calendar `all_day` column resilience: dbInsert/dbUpdate auto-strip missing columns and retry, so feature drops gracefully if SQL migration hasn't run
- v55.29 — dial-pad auto-formats numbers to E.164; outbound calls have 3-tier caller-ID fallback
- v55.28 — Settings → Phone → Run Diagnostics button
- v55.27 — Tickets Blocked / On Hold buttons (s33 migration required)
- v55.26 — Starred priority cards have readable dark text on amber
- v55.25 — Calendar cancel/delete have z-200 overlay confirmations; phone widget bundles `@twilio/voice-sdk`

---

## Open Twilio Console items (still pending from prior session)

- **+17328005428** voice URL still points at Twilio demo
- **+17328100075** same issue

Steps unchanged: Twilio Console → Phone Numbers → Manage → click each number → Voice & Fax → "A CALL COMES IN" → set webhook to `https://nexttrade-hub.vercel.app/api/phone/incoming`, method POST → Save.

---

## Carry-over to-do (everything pending across sessions)

- v55.32 finish (the 11 items in "What's still pending" above)
- Resend email setup (env vars + DNS for ktcus.com)
- Plaid env vars
- 189 USD treasury transactions still need importing
- Bilingual categories UI
- Mobile Nadia freeze fix
- Customs broker tab
- hub.ktcus.com subdomain
- Color coding on Treasury/Sales views
- Warehouse all-years display fix
