# KTC NextTrade Hub — Things YOU have to do yourself

All one-time setups. After you do them, they stay done forever.

---

## Before anything else — SQL migrations

**Run these in Supabase SQL Editor, in order. Skip any you've already run.**

1. `session3-handoff-ai.sql` — voice + ET columns, claude_handoff_log, ai_alerts, category_memory
2. `session5-meeting-notes.sql` — NEW. Creates meeting notes thread table + migrates old single-column notes into it. Idempotent.

Paste file contents into Supabase SQL Editor, click **Run**, scroll to bottom to see verification counts.

---

## 1. Gmail stops disconnecting (5 min)

**Why:** Google auto-revokes "testing" OAuth apps every 7 days.

1. Open `https://console.cloud.google.com/`
2. Sign in with your KTC Google account
3. At the top, make sure your KTC project is selected
4. Left menu → **APIs & Services** → **OAuth consent screen**
5. **Publishing status: Testing** at the top → click **PUBLISH APP**
6. Confirm "Push to production"
7. Status changes to **In production**

Then log out, log back in, Settings → Gmail → Reconnect Gmail.

---

## 2. Team members get emails too (15 min)

**Why:** Resend only delivers to verified domains.

### Part A — In Resend
1. `https://resend.com/domains`
2. **+ Add Domain** → type `ktcus.com` → **Add**
3. Resend shows ~4 DNS records. Keep tab open.

### Part B — In your DNS provider
Tell me which provider (GoDaddy / Cloudflare / Namecheap / Google Domains) for click-by-click. General:
1. Log in, find **DNS Records** / **Manage DNS** / **Zone Editor**
2. For each Resend record: click **Add Record**, pick the Type, paste Name + Value, save

### Part C — Verify
1. Back in Resend → click **Verify DNS Records**
2. Wait 5-60 min for green checkmarks
3. Test: assign a ticket to Omar, he should get an email

---

## 3. Auto-pull System Tickets each session (10 min)

**Why:** I read your tickets directly instead of you copy-pasting.

### Part A — Make a password
`https://1password.com/password-generator/` → length 40, no symbols → Copy. Save in password manager.

### Part B — Add it to Vercel
1. `https://vercel.com/dashboard` → your KTC project
2. **Settings** → **Environment Variables**
3. Add: Key = `CLAUDE_HANDOFF_TOKEN`, Value = (paste password), check all 3 environments
4. Save
5. **Deployments** → latest → `⋯` → **Redeploy** → wait 1-2 min

### Part C — Tell me
At start of next session, paste:
```
My CLAUDE_HANDOFF_TOKEN is: <paste>
```

Then say "handoff" or "check tickets" and I pull automatically.

---

## 4. Using "Hey Bob" (zero setup)

On any page: "Hey Bob, ..." + command. Examples:
- "Hey Bob, what's on my calendar today?"
- "Hey Bob, what should I do about invoice 2280?"
- "Hey Bob, create a ticket to fix the warehouse year filter."

Voice pill sits **bottom-left** (always visible).
While Bob is speaking, start talking → he stops.

Browser support: ✅ Chrome / Safari / Edge · ❌ Firefox (no voice; everything else works).

Turn off this session: click pill's OFF. Permanent per-user: Settings → Voice.

---

## 5. Try the new AI v2 — tool use (opt-in)

Add `?nadia_v2=1` to any KTC URL: `https://nexttrade-hub.vercel.app/?nadia_v2=1`

Or permanently in browser console: `localStorage.setItem('nadia_v2', '1')` → refresh.

**What's different:** Nadia actually queries your data via tools instead of guessing. Ask "show me Ali's outstanding invoices" — she'll query live. Ask her to draft an email — she opens the composer pre-filled.

Turn off: `localStorage.removeItem('nadia_v2')` + refresh.

---

## 6. Meeting notes — how it works now

**Before:** one note per meeting, editing overwrote everyone.
**Now:** thread. Each person adds their own. Each note has a kind:

- 📝 **Note** — general
- ☐ **Action item** — checkable
- 💡 **Decision** — highlighted

On any calendar event (before/during/after):
1. Click event → thread modal opens
2. See everyone's notes as thread with author + timestamp
3. Type note → pick kind → post
4. Export thread as .txt (also clipboard) via **📥 Export**

📝 badge on event card shows note count.

---

## 7. Ticket due-dates on the Calendar

Any ticket you're **assigned to** with a due date now appears on your calendar on that date. Click the 🎫 chip → jumps straight to the ticket.

- Unassigned tickets: don't show (clutter prevention).
- Closed/Resolved/Fixed tickets: don't show.
- "My Calendar" view: only tickets assigned to you.
- "Team Calendar" view: all assigned tickets.

---

## 8. Sales Auto-Categorization (optional)

Settings → **🛠️ Admin Tools** (super admin only):
1. **Learn** — scan past invoices, build memory (~30-60 sec)
2. **Preview** — dry-run, shows how many rows WOULD be filled
3. **Apply** — actually fills them (confirmation prompt)

---

## Quick summary

| # | Task | Time |
|---|---|---|
| 0 | Run SQL migrations | 2 min |
| 1 | Publish Google OAuth | 5 min |
| 2 | Verify ktcus.com in Resend | 15 min |
| 3 | Add CLAUDE_HANDOFF_TOKEN | 10 min |
| 4 | Use Hey Bob | — |
| 5 | Try AI v2 via URL flag | — |
| 6 | Use new meeting notes | — |
| 7 | See tickets on calendar | — |
| 8 | Run sales categorization | 1 min |

---

If stuck: tell me the number + what you see on screen. Screenshots help.
