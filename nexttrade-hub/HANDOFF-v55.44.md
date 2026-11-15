# NextTrade Hub — v55.44 Handoff

## What this build fixes

Four things you reported, in order of how they hit you day-to-day:

### 1. Shipping rates import — rate values + dates + full template

The old import was unreliable. Sometimes the rate value didn't pull through. Sometimes the dates were wrong. The template was missing half the fields. You couldn't see what was being imported until after it landed in the database. **Now you can.**

**📄 Download Full Template** — the button in the Import screen now creates an Excel file with **21 columns** covering everything the system reads: Origin, Destination, POL, POD, Vendor, Shipping Line, Transport Mode, Container Type, **Rate Amount, Currency, Effective Date, Expiry Date,** Transit Days, Free Days, Port Fees, THC, Documentation Fees, Customs Fees, Other Fees, Other Fees Description, Notes. Plus a second tab called **"Field Guide"** that explains what each column means and which are required.

**Editable preview before import** — when you upload your spreadsheet, you now see EVERY field for every row in a live editable table:
- Tap any cell to fix it. Rate, dates, fees, currency, container type — all editable.
- Rows where the rate is 0 highlight in **red** so you can spot them at a glance.
- A warning banner at the top tells you "X rows have rate = 0 — fix or remove them before importing."
- Each row has an **✕** button to drop it from the import (handy for that totals row at the bottom of every freight forwarder's Excel).
- A **Total** column auto-recalculates as you edit, so you can sanity-check the math.

**Manual column override** — above the preview there's a **Column Mapping** grid showing every field with a dropdown of your spreadsheet's column names. If the auto-detect picked the wrong column for "Rate" or "Expiry Date", just pick the right one from the dropdown and the preview rebuilds instantly. No need to re-upload.

### 2. Comment double-submit — fixed

Tapping the Send button on a ticket comment 2-3 times no longer posts the same comment 3 times.

The Send button now disables the moment you tap it (greys out, shows "⏳ Sending…"), and stays disabled until the save finishes. If you tap again while it's saving, nothing happens. Same protection on Ctrl+Enter.

If the save fails, the button re-enables so you can try again — and your typed text isn't lost.

### 3. Priority + due-date changes now log as comments

You said: "if someone changes the assignee or due date or urgency, it should be logged as a comment in the ticket." Status changes and reassignments already did this. **Now priority and due-date changes do too.**

When someone changes a ticket's priority or due date, an automatic entry appears in the **Activity Log** section of that ticket showing:
- **⚡ Priority changed: MEDIUM → HIGH (by Max)**
- **📅 Due date changed: 2026-05-10 → 2026-05-15 (by Max)**

These entries:
- Show the **before → after** values, not just the new one
- Stamp who made the change and when
- Render in the existing Activity Log section (📋), separate from regular comments
- Can't be edited or deleted by anyone, including super admin
- Appear instantly without needing to refresh the page

**No-op protection:** if you click the dropdown but pick the same value that was already there, no audit entry fires.

**Best-effort:** if the audit insert fails (e.g. database hiccup), the underlying field update still saves — you don't lose the priority change.

### 4. Everyone on a ticket now gets notified — bell + email

You said: "Make sure everyone that created the ticket or is assigned to a ticket is getting an update on their dashboard and email when someone updates that ticket." **Done.**

**Who gets notified:** any time something changes on a ticket — comment, status change, reassignment, priority change, due-date change — every one of these people gets a notification:
- The person who **created** the ticket
- The **current assignee**
- All **additional assignees** (the multi-assign list)

The actor (whoever made the change) is never notified about their own change — no useless "You updated your own ticket" emails.

The list is **deduped** — if the creator is also an assignee, they only get one notification, not two.

**Where notifications show up:**
- 🔔 **Dashboard bell** (top right, with the red unread dot) — shows up immediately, even if Resend email isn't set up yet
- 📧 **Email** — fires automatically once you set up Resend (still pending — see Carry-forward)

The dashboard bell now works **independently of email**. Previously, when Resend wasn't configured, the notification endpoint returned a 500 error and **nothing** happened — no email AND no bell. Now the bell always fires; email fires too once Resend is configured.

**New notification types:** `ticket_priority`, `ticket_due_date`, `ticket_update` — they show in Settings → Notifications alongside the existing types so you can globally turn any of them off if they get too noisy.

---

## Build stamp

- Header pill: **v55.44**
- Build modal: **BUILD v55.44-IMPORT-COMMENT-AUDIT-FIX**

---

## Deploy steps

**No SQL needed.** No new env vars required. Backwards-compatible with the existing `ticket_comments` and `notifications` tables.

> **Optional but recommended:** add the `RESEND_API_KEY` env var when you're ready (still pending from v55.43) so the bell notifications also fire as emails. Until then, dashboard bell-only notifications work fine.

1. GitHub Desktop → Show in Finder → delete every file in the folder
2. Unzip **MERGED-COMPLETE-55.44.zip** into the folder
3. Commit message: `v55.44 — shipping import + comment guard + audit + notification fan-out`
4. Push origin (Vercel auto-deploys ~2 min)
5. Hard-refresh your browser

---

## Verification — try these in order

### Shipping rates import
1. Open **Shipping Rates** tab → **Import**
2. Tap **📄 Download Full Template** → save the file
3. Open it. Confirm you see two sheets: **Rates Template** (21 columns, 4 example rows) and **Field Guide**
4. Take any of your real rate spreadsheets (or the template you just downloaded) and upload it
5. On the preview screen:
   - Confirm you see ALL columns: Origin, Dest, POL, POD, Vendor, Line, **Mode**, Container, **Rate ⭐**, **Curr**, **Effective**, **Expiry**, Transit, Free, **Port**, **THC**, **Doc**, **Customs**, **Other**, **Total**
   - If the Rate column shows 0s for some rows, look for a "Column Mapping" section above the table — change the **Rate Amount ⭐** dropdown to point to the correct column from your spreadsheet. The preview rebuilds.
   - Tap any cell — you should be able to type into it and the value updates
   - Edit a Port Fees number — the **Total** column should update on the same row
   - Tap an **✕** on any row to drop it
6. Tap **✅ Import All** → confirm the rates land in the routes view with correct amounts and dates

### Ticket comment double-submit
1. Open any ticket
2. Type a comment
3. **Tap Send 3 times fast** — only ONE comment should be posted
4. While it's saving, the button should show "⏳ Sending…" and be greyed out
5. Try the same with Ctrl+Enter — same protection

### Priority + due-date audit comments
1. Open any ticket
2. Change the **priority** dropdown (e.g. MEDIUM → HIGH)
3. Scroll to the **📋 Activity Log** section — confirm a new entry appears immediately:
   `⚡ Priority changed: MEDIUM → HIGH (by [your name])`
4. Change the **due date** and tap **Set**
5. Confirm a new entry: `📅 Due date changed: [old date] → [new date] (by [your name])`
6. Set the priority back to its current value (e.g. HIGH → HIGH) — confirm NO new audit entry is created

### Notifications fan out to creator + assignees
1. Pick a ticket where YOU are NOT the creator and NOT the assignee — but Omar IS the creator and Haitham IS the assignee. (Reassign one if needed for the test.)
2. As Max, change the priority on that ticket
3. Log in as Omar (or have him check) — the 🔔 bell should show a new unread notification: "Priority Changed: [ticket title]"
4. Same for Haitham
5. As Max, change the due date — same notification fan-out should happen
6. Same for adding a comment, changing status, or reassigning
7. Make sure YOU (Max, the actor) do NOT get a bell notification for the change you just made

---

## Tests

**119 v55.44 assertions** — all green
**108 source files parse cleanly** (build syntax check)
The two pre-existing calendar test failures from v55.41/42/43 are unchanged.

---

## Files in v55.44

### Edited
- `src/components/RichCommentComposer.jsx` — `submitting` prop + internal `localSubmitting` backstop, disabled Send button + Ctrl+Enter guard
- `src/components/TicketsTab.jsx` — `submittingComment` state, `addComment` with try/finally guard, audit comments for priority + due-date changes, **notification fan-out for priority + due-date** to creator + assignees + additional assignees (deduped, no self-notify)
- `src/components/ShippingRatesTab.jsx` — comprehensive 21-column template + Field Guide sheet, full editable preview with all fields including fees + currency + total, manual column-remap grid, zero-rate warning banner + red row highlights, per-row remove button
- `src/lib/notify.js` — new helpers: `notifyTicketPriority`, `notifyTicketDueDate`, `notifyTicketUpdate`, `ticketRecipients()` (creator + assignees, deduped, no self)
- `src/app/api/notify/route.js` — every notification now writes to the `notifications` table for the dashboard bell, not just email; **Resend is now optional** (bell fires even when Resend isn't configured); recipients without email still get the bell
- `src/app/page.jsx` — version stamps bumped to v55.44

### New
- `__tests__/test-v55-44-import-comments-audit.js` — 119 assertions
- `HANDOFF-v55.44.md` — this document

### Untouched
- All v55.43 voice and phone fixes
- All v55.42 bank-edit fixes
- All v55.41 duplicate-confirm fixes
- All v55.40 phone auto-inbound features
- All v55.39 voicemail dial-failed branch
- All v55.38 login hydration fix
- All v55.37 WhatsApp inbox

---

## Carry-forward (still pending from v55.43)

- **Resend setup** (creates the email half of every notification): create account at resend.com, add ktcus.com domain + DNS, get API key, set `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` in Vercel. Until then, bell works but email doesn't.
- WhatsApp Cloud API setup at Meta
- `NEXT_PUBLIC_APP_URL` env var (for phone signature verification candidate URL)
- Twilio Console access recovery
- Run `import_usd_transactions.sql` and merchandiser SQL imports
- Fill in cell forwarding numbers in Settings → Phone → Team Routing Preferences

---

## What's next if anything still doesn't work

**Import:** if rates STILL come in as 0 after using the column-mapping override, send me your spreadsheet (rename the vendor names if you want) and I can write a one-off importer for that exact format. The column-mapping override should handle 99% of cases now though.

**Double-submit:** if you can still produce duplicate comments somehow, tell me HOW (e.g. "I tapped Send, the button greyed out, but then…"). Open DevTools (F12) → Console tab → reproduce → send me the console output.

**Audit comments:** if priority or due-date changes don't show up in the Activity Log, check whether there's a database error in the browser console — the audit insert is best-effort, so a silent failure there is the most likely cause. The actual field change will still save.

**Bell notifications:** if other users don't see the notification in their bell after you change something:
- Check the Vercel logs for `[notify]` lines — they tell you exactly how many bell rows were inserted
- Check Settings → Notifications and confirm the type isn't globally disabled
- If the bell row was inserted but doesn't show in the UI, the user may need to refresh — the bell polls every 60 seconds
