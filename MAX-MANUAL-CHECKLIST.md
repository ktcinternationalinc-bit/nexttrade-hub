# KTC NextTrade Hub — Things YOU have to do yourself

These 4 things nobody but you can do. I can't touch your Google account, your Resend account, your Vercel settings, or your DNS provider. Follow each section exactly. **If you get stuck on any step, tell me which number you're on and what you see on the screen, and I'll walk you through it.**

All of these are one-time setups. After you do them, they stay done forever.

---

## 1. FIX: Your Gmail keeps disconnecting (do this first — 5 minutes)

**What's going wrong:** Google has a security rule that says: if your Gmail-connecting "app" is still marked as "testing", everyone's connection breaks every 7 days. That's why yours keeps disconnecting. Publishing the app makes it permanent.

### Steps:

1. Open a new browser tab.
2. Go to this exact address: `https://console.cloud.google.com/`
3. Sign in with the Google account you used when you first set up Gmail for KTC.
4. At the very top of the page you'll see a little drop-down that says a project name (probably "KTC NextTrade" or similar). Make sure that's selected.
5. On the LEFT side of the page, find a menu item called **APIs & Services**. Click it.
6. Under that, click **OAuth consent screen**.
7. You'll see a box at the top that says **Publishing status**. Next to it, it probably says **Testing**.
8. There should be a button that says **PUBLISH APP**. Click it.
9. A popup will appear asking "Push to production?" — click **CONFIRM**.
10. The status changes from **Testing** to **In production**.

**Done.** Now you AND your whole team can connect Gmail to the portal and it will never break again.

**After you do this:**
- Log out of the KTC portal
- Log back in
- Go to Settings → Gmail → click "Reconnect Gmail"
- Do the same for Omar and anyone else who needs Gmail

---

## 2. FIX: Only you get Resend emails, nobody else does (15 minutes)

**What's going wrong:** Resend (the service we use to send emails) has a safety rule: until your company's email domain is verified with them, they only deliver to you. That's why you get ticket notifications and the team doesn't. Verifying `ktcus.com` with Resend unlocks sending to anyone.

### Steps — Part A: Add the domain in Resend

1. Open a new browser tab.
2. Go to `https://resend.com/domains`
3. Sign in with your Resend account.
4. Click the blue **+ Add Domain** button at the top right.
5. In the box, type exactly: `ktcus.com`
6. Leave the "Region" as whatever it defaults to. Click **Add**.
7. The page now shows you a list of about 4 lines. Each line has three parts:
   - A **Type** (like `MX`, `TXT`, `CNAME`)
   - A **Name** (a short address like `send._domainkey.ktcus.com`)
   - A **Value** (a long string that looks like `v=DKIM1; k=rsa; p=...`)
8. **LEAVE THIS TAB OPEN.** You'll need to copy-paste those values into your DNS provider next.

### Steps — Part B: Add the records at your DNS provider

Your DNS provider is wherever you bought `ktcus.com` or wherever your website is hosted. The most common ones are: **GoDaddy**, **Cloudflare**, **Namecheap**, **Google Domains**. If you don't know which one, search your email inbox for any of those names — you'll find the signup email.

**Tell me which one, and I'll give you click-by-click instructions specific to that provider.** The general idea is the same everywhere:

1. Log into your DNS provider's website.
2. Find the page called **DNS**, **DNS Records**, **Manage DNS**, or **Zone Editor** (name varies).
3. You'll see a list of existing records for `ktcus.com`.
4. Click **Add Record** (the button might say **Add New** or **+**).
5. For EACH of the records Resend showed you (Part A, step 7), you add ONE new record:
   - Pick the matching **Type** from a dropdown (`TXT` is most common).
   - In the **Name** or **Host** field, paste what Resend said. **Important:** your DNS provider might show only the part before `.ktcus.com` — so if Resend says `send._domainkey.ktcus.com`, you might only need to type `send._domainkey` in the Name field. Don't worry if you're unsure — try both ways, one will work.
   - In the **Value** or **Content** field, paste the long string Resend gave you.
   - Save / Add.
6. Repeat for each record.

### Steps — Part C: Verify

1. Go back to the Resend tab from Part A.
2. Click the **Verify DNS Records** button.
3. You'll see green checkmarks next to each record. **This can take 5-60 minutes.** If they're still red after an hour, message me.
4. Once all green, you're done. Emails now go to anyone.

### Test it:

1. Log into KTC portal as yourself.
2. Create a test ticket and assign it to Omar.
3. Omar should get an email. If not, tell me.

---

## 3. SET UP: Let me pull your System Tickets automatically (one-time, 5 minutes)

**What this does:** Right now, to work on your bug tickets, you have to copy-paste them into our chat. After this one-time setup, I can pull them directly from your portal myself. You never copy-paste again.

**How it works:** I have a brand-new endpoint in your portal called `/api/claude-handoff`. It's locked behind a secret password. You create the password once, tell it to me once, and from then on I can read and update your System Tickets whenever you say "handoff" or "check my tickets" at the start of a session.

### Steps — Part A: Make a secret password

1. Think of a long random string — at least 32 characters. Mix letters + numbers. Example (DON'T actually use this one): `R7xQ3mK9pZ2wYvB8nT4cL6hF1sJ5aDe0G`
2. **Easier way to make one:** Open this URL in a new tab: `https://1password.com/password-generator/` → set length to 40, no symbols → click **Copy**.
3. **Keep this password somewhere safe.** (Your password manager, or a note you won't delete.) You'll paste it twice.

### Steps — Part B: Add the password to Vercel

1. Open `https://vercel.com/dashboard`
2. Click on your KTC project (it's probably named `nexttrade-hub`).
3. Click the **Settings** tab at the top.
4. On the LEFT menu, click **Environment Variables**.
5. In the form:
   - **Key**: type exactly: `CLAUDE_HANDOFF_TOKEN`
   - **Value**: paste the password from Part A.
   - **Environments**: check all three boxes (Production, Preview, Development).
6. Click **Save**.
7. IMPORTANT: Vercel does NOT automatically redeploy. You need to trigger a redeploy for the new password to take effect. Click the **Deployments** tab → find the latest deployment → click the `⋯` menu → click **Redeploy**. Confirm. Wait 1-2 minutes for it to finish.

### Steps — Part C: Give the password to me

At the start of your NEXT session with me, paste this one line (replacing `<paste-your-token>` with the real password):

```
My CLAUDE_HANDOFF_TOKEN is: <paste-your-token>
```

I will save it to memory. From then on, whenever you say **"handoff"** or **"start"** or **"check my tickets"**, I'll automatically:
- Pull every open and reopened System Ticket
- Read the descriptions and comments
- Work on the fixes
- Update each ticket with a 🤖 Claude-labeled comment describing what I did
- Mark the ones I fixed as "Fixed"
- Re-flag anything that needs you to confirm

**You never copy-paste another ticket.**

### Steps — Part D (optional, in-portal convenience)

In the portal's System Tickets page, each ticket now has a new button. Click it to mark a ticket "Claude-review requested". Next session, I'll see those first and work on them priority before the general backlog.

---

## 4. TURN ON THE VOICE ASSISTANT ("Hey Bob")

You already have this — no external setup needed. It's built into the portal now. Here's how to use it:

### On any page:

1. Just say out loud: **"Hey Bob, ..."** followed by your command.
2. Examples:
   - "Hey Bob, what's on my calendar today?"
   - "Hey Bob, remind Omar to look at his tickets."
   - "Hey Bob, what should I do about invoice 2280?"
   - "Hey Bob, create a ticket to fix the warehouse year filter."
3. Bob listens continuously in the background. You don't need to click anything.
4. When Bob is talking and you want to interrupt, just start talking — Bob stops speaking and listens.

### To turn off voice:

Click the little microphone pill in the bottom-left corner of the screen. It says "🎙️ Hey Bob" when listening. Click the **OFF** button on that pill, and it goes idle for the rest of your session.

To turn voice off permanently for your user, go to Settings → Personal → Voice → toggle off. It stays off even after logout.

### Browser support:

- ✅ Chrome — works great
- ✅ Safari (Mac + iPhone) — works
- ✅ Edge — works
- ❌ Firefox — voice recognition isn't supported by Firefox itself. Use any other browser for voice. Firefox still works for everything else in the portal.

### First time you use voice:

Your browser will pop up asking for microphone permission. Click **Allow**. This only happens once per browser.

---

## 5. (Optional) Turn on Sales Auto-Categorization

The portal now learns how you categorize sales and can auto-fill the category + subcategory fields on new invoices, plus go back and fix old uncategorized ones.

### How to trigger it the first time:

You can't do this from the portal UI yet (that button is next session's work). For now, if you want to run it, just tell me in chat: **"run the sales learn + backfill"** and I'll do it for you in one call.

**What happens:**
1. I tell the portal to LEARN — it scans all your already-categorized invoices and builds a memory of which customers and keywords go with which category.
2. I tell the portal to BACKFILL in dry-run mode — it tells you how many invoices it would fix, without actually touching anything.
3. You look at the preview numbers, confirm they look right.
4. I run the real BACKFILL — now your uncategorized rows get filled in.

From that point on, new invoices auto-categorize when created.

---

## Quick summary of what to do and in what order

| # | Task | Minutes | Why |
|---|---|---|---|
| 1 | Publish the Google OAuth app | 5 | Your Gmail stops disconnecting |
| 2 | Verify ktcus.com with Resend | 15 | Your whole team gets emails |
| 3 | Add `CLAUDE_HANDOFF_TOKEN` to Vercel + give it to me | 10 | I pull your tickets automatically forever |
| 4 | (Nothing — already working) Hey Bob | 0 | Built in, just talk |
| 5 | (When you want) run sales learn + backfill | 1 (tell me) | Fills in past categories |

**Total: 30 minutes of your time once.** After that, everything stays fixed.

---

## If anything goes wrong

- Don't guess — tell me which step number + what you're seeing on the screen.
- Screenshots help more than descriptions.
- If you get locked out of anything, say so. We'll troubleshoot together.

I can't do any of these 5 tasks for you because they require login to YOUR accounts. But everything in the portal itself I can do.
