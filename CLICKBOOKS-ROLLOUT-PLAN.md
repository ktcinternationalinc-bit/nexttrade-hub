# ClickBooks Rollout Plan — keep everything, turn on slowly, run both, then choose

**For:** Max · **Build:** v55.83-OX · **Written:** Nov 4, 2026 (click-by-click edition)

The golden rule the whole plan follows: **Wave stays the boss of the US books until the very
last phase.** Everything you have today (reconciliation, dashboard, invoices, bank matching,
US/Egypt split, P&L) keeps working unchanged through every phase. ClickBooks fills up
quietly next to it, you compare the two for weeks, and only when they agree do you even
consider switching. Every phase has an "undo" and a "stop if" line.

**If any screen doesn't look like what's described: stop, screenshot it, send it to Claude.
Nothing in Phases 0–2 can break anything as long as you stop when unsure.**

---

## The two websites you'll use, once, up front

**Supabase** (the database): go to **https://supabase.com** → click **Sign in** (top right)
→ sign in the same way you did when the project was set up. You land on a page listing your
projects → click the hub's project. You're now "inside the project": there's a **left
sidebar** of icons/names — that sidebar is where everything below lives.

**Vercel** (the website host): go to **https://vercel.com** → **Log in** (top right). You
land on a dashboard listing your projects → click **nexttrade-hub**. Across the top you'll
see tabs like **Overview · Deployments · Settings** — those tabs are where everything below lives.

---

## Phase 0 — Safety net (15 minutes, do before anything else)

### 0.1 Confirm a database backup exists
1. In Supabase, left sidebar → click **Database**.
2. In the menu that appears, click **Backups**.
3. You should see a list with dates. If the newest one is from today or yesterday, you're
   covered (Supabase makes them daily). If the page is empty, stop and tell Claude.

### 0.2 Note the current live deployment (your code undo button)
1. In Vercel → **Deployments** tab.
2. The top entry marked **Production · Ready** is the live site. Don't click anything —
   just know this page: if a deploy ever goes wrong, you come here, click the **⋯** (three
   dots) on the one that worked, choose **Redeploy**, and the old site is back in ~2 minutes.

### 0.3 Get your Auth ID (one copy-paste)
1. In Supabase, left sidebar → click **SQL Editor** (icon looks like `>_` or says SQL Editor).
2. Click **+ New query** (or you may land straight in an empty editor box).
3. Paste this, but replace the email with the one YOU sign in to the hub with — keep the
   quote marks around it:

   ```sql
   select id, email from auth.users where lower(email) = lower('ktcinternationalinc@gmail.com');
   ```

4. Click the green **Run** button (bottom right of the editor).
5. A small table appears underneath with two columns, `id` and `email`.
   - ✅ **Exactly one row:** the `id` is a long code like `a1b2c3d4-….` Click it, copy it,
     and paste it somewhere safe (Notes). That's your **Auth ID** — needed in Phase 1.
   - ❌ **Zero rows or two rows:** STOP. Screenshot it, send to Claude. (It means your
     email exists twice or not at all in the sign-in system, and deploying could lock you
     out of bank screens.)

---

## Phase 1 — Deploy the new build with ClickBooks OFF (one evening, ~30 minutes)

Do these **in this exact order**, ideally late at night — bank screens blink for about
5 minutes in the middle.

### 1.1 Add the two settings in Vercel (harmless on its own)
1. Vercel → **Settings** tab → in the left menu click **Environment Variables**.
2. You'll see a form with two boxes: **Key** (the name) and **Value**.
3. In **Key** type exactly: `HUB_SUPER_ADMIN_AUTH_USER_IDS`
   In **Value** paste your Auth ID from step 0.3.
   If there are checkboxes for Production / Preview / Development, it's fine to leave all
   checked. Click **Save**.
4. Repeat for a second one — **Key:** `HUB_ADMIN_AUTH_USER_IDS` · **Value:** the same
   Auth ID. Click **Save**.
5. You should now see both names listed on that page. (Nothing on the live site changes yet.)

### 1.2 Push the new code (your normal zip routine)
1. Unzip **NEXTTRADE-HUB-v55.83-OX.zip** and copy its contents over your repo folder,
   exactly the way you always do.
2. Open **GitHub Desktop** — it will list the changed files on the left.
3. Type a short summary (e.g. `v55.83-OX clickbooks merge`) → click **Commit to main** →
   click **Push origin** (top bar).
4. Go to Vercel → **Deployments**. A new entry appears at the top saying **Building**.
   **Wait** until it says **Ready** (usually 2–5 minutes). Don't do step 1.3 before Ready.

### 1.3 Run the one SQL file (immediately after Ready)
1. On your computer, open the unzipped folder → `sql` folder → right-click
   **bank-balance-visibility.sql** → Open With → **Notepad** (Windows) or **TextEdit** (Mac).
2. Select **all** of it (Ctrl/Cmd+A), copy (Ctrl/Cmd+C).
3. Supabase → **SQL Editor** → **+ New query** → paste → **Run**.
4. Wait for it to finish (a few seconds). ✅ Expect something like **"Success. No rows
   returned."** ❌ Any red error text: screenshot, send to Claude, don't re-run it.

### 1.4 Verify (5 minutes)
1. Open the hub in your browser and do a **hard refresh**: hold **Shift** and click the
   reload button (or Ctrl+Shift+R / Cmd+Shift+R). Sign in.
2. Check, in order:
   - Version badge says **v55.83-OX**.
   - **Accounting → Bank Review** opens and transactions load.
   - Reconciliation, Open Balances, Sales Report, P&L, All Invoices all open.
   - The dashboard still shows your treasury/cash boxes.
   - **Settings** now has a **Financial data access** panel.

### 1.5 Re-grant dashboards to your people
One deliberate change in this build: staff no longer see company-wide money (monthly sales
widget, treasury totals, bank balances) from an old role/module toggle — that was a security
hole. In **Settings → Financial data access**, for each person who should see them, switch
on **Full dashboard** and/or **Banking information**. You don't need to grant yourself
anything — your Auth ID in Vercel already makes you the verified super admin.

**Stop if:** the SQL shows an error, Bank Review is still broken 10+ minutes after 1.3, or
you see "needs configuration" while signed in as yourself. Instant undo: Vercel →
Deployments → the previous Ready production entry → **⋯ → Redeploy**. (The SQL is safe to
leave in place either way.)

**Then live here a few days.** Normal work, nothing new turned on.

---

## Phase 2 — Turn the ClickBooks screens on, read-only (peek mode, ~15 minutes)

Four new tabs appear under Accounting — ClickBooks · US, Rules & Migration, Reports & Tax,
Parallel & Cutover — all **look, don't touch**. Nothing posts anywhere. Wave untouched.

1. Vercel → **Settings → Environment Variables**. Add each of these the same way as 1.1 —
   the **Key** is the part before the `=`, the **Value** is the word after it (`true` or
   `false`, lowercase):

   ```
   CLICKBOOKS_US_ENABLED=true
   NEXT_PUBLIC_CLICKBOOKS_US_ENABLED=true
   CLICKBOOKS_US_WORKBENCH_ENABLED=true
   NEXT_PUBLIC_CLICKBOOKS_US_WORKBENCH_ENABLED=true
   CLICKBOOKS_US_REPORTS_ENABLED=true
   NEXT_PUBLIC_CLICKBOOKS_US_REPORTS_ENABLED=true
   CLICKBOOKS_US_CUTOVER_ENABLED=true
   NEXT_PUBLIC_CLICKBOOKS_US_CUTOVER_ENABLED=true
   CLICKBOOKS_US_STAGE_WRITES_ENABLED=false
   CLICKBOOKS_US_RULES_AUTO_STAGE_ENABLED=false
   CLICKBOOKS_US_REPORT_SETTINGS_WRITES_ENABLED=false
   CLICKBOOKS_US_SHADOW_SYNC_ENABLED=false
   ```

   Yes, it's twelve of them. The four `false` ones are the write switches — they stay
   false until Phase 4. Adding them now as `false` is deliberate, so later phases are a
   one-word change.

2. Settings changes only take effect on a new deploy: go to **Deployments** → top
   Production entry → **⋯ → Redeploy** → confirm.
3. When it's **Ready**, hard-refresh the hub. The four ClickBooks tabs appear under
   Accounting. The ledger shows 0 journals — correct, it's installed but empty.

**Undo:** change the first two variables' values to `false` (pencil/edit icon next to each)
and Redeploy — the tabs disappear, nothing else changes.

---

## Phase 3 — Put history in: the opening balance (the accountant step)

ClickBooks can't just copy nine years of Wave history — 1,142 old paid invoices have no
detailed payment records, and the system correctly refuses to guess. So history enters as
**one reconciled opening entry** at a cutoff date (for example Dec 31, 2026), plus the
detailed list of who still owes what. Old invoices stay visible in the hub forever as
evidence — nothing is deleted.

**What you collect (Claude can't do this part for you):**
- Pick the cutoff date (a month-end; year-end is cleanest).
- From Wave: trial balance / account balances as of that date, and the open-invoice
  (AR) list as of that date.
- Bank statements for every active US account showing the balance on that date.
- Anything owed to vendors (AP), if any.

**Then, with Claude in a session:** fresh snapshot → review the chart of accounts and the
bank-account mappings → load the opening balance through the package's operator scripts →
check ClickBooks' numbers against your documents to the cent → **certify history**.
Iron rule: *never insert a made-up balancing line to force the books to equal — every
difference gets explained or the migration doesn't commit.* If the opening entry turns out
wrong, there's a linked reversal script; nothing is ever hand-deleted.

**Stop if:** the accountant evidence and Wave disagree with each other — resolve that
first; ClickBooks must be loaded from numbers you trust.

---

## Phase 4 — BOTH SYSTEMS AT ONCE (shadow mode)

Now the new system runs quietly next to the old one. **You and the team change nothing
about how you work.** Invoices are entered in the hub and pushed to Wave exactly as today.
The shadow engine ALSO writes each new invoice, payment, and approved bank transaction
into ClickBooks automatically. Wave remains writable and primary the whole time.

1. With Claude: review the one "sales income" account new invoices should post to, and
   confirm every active bank account is mapped (both are scripted review steps).
2. In Vercel, edit `CLICKBOOKS_US_SHADOW_SYNC_ENABLED` from `false` to `true` → Redeploy
   (and Claude runs the enable-parallel operator script with you).

**Consistency across the two systems — checked, not assumed.** During the parallel
window (minimum 7 days, up to 31 — a full month is better):

- **Weekly:** open ClickBooks · Reports & Tax and compare, to the cent, against what you
  have today: ClickBooks P&L vs our Sales Report/P&L for the same period; ClickBooks
  open receivables vs our Open Balances; ClickBooks bank balances vs the actual bank
  statements (not vs another screen).
- The **Parallel & Cutover** tab has a readiness check that only goes green when: every
  new invoice/payment in the period made it into ClickBooks, nothing is stuck waiting
  for review, every bank account is mapped, history is certified, and the books balance.
- **Any unexplained difference = stop and investigate with Claude.** We never adjust a
  number to make the two systems agree; we find out which one is right and fix the cause.

**Undo:** edit the shadow variable back to `false` → Redeploy. Wave was never touched, so
turning the shadow off costs nothing.

You can stay in Phase 4 **as long as you like** — months, if that's comfortable. Two
systems, one habit, zero risk.

---

## Phase 5 — Choosing one (only when Phase 4 is boring and green)

When a full review window ends green and the reports have matched your bank statements
for weeks:

1. Stage the cutover in the hub (it freezes the review window and the evidence).
2. Approve and execute it through two separate trusted operator scripts, with Claude —
   it's deliberately not a button anyone can click.
3. What actually changes: the hub stops pushing invoices/payments to Wave. That's all.
   The bank feed stays connected, Egypt/Treasury are untouched, Wave's history remains.
4. **Undo exists even here:** the rollback script restores the exact Wave settings from
   before the cutover and puts the system in review mode. ClickBooks entries are kept as
   evidence, never erased.

Don't schedule Phase 5 yet. Decide after a clean parallel month.

---

## One-line summary per phase

| Phase | What turns on | Risk to today's system | Undo |
|---|---|---|---|
| 0 | Nothing — backup check + your Auth ID | none | — |
| 1 | OX code + security SQL + 2 settings | 5-min blink on bank screens during deploy | redeploy old build |
| 2 | ClickBooks tabs, read-only | none | flip 2 settings off |
| 3 | Opening balance loaded + certified | none (Wave untouched) | linked reversal script |
| 4 | Shadow posting — both systems live | none (Wave still primary) | flip shadow off |
| 5 | Wave pushes stop; ClickBooks primary | reversible | rollback script |

**Standing stop-conditions (any phase):** an unexplained money difference, a bank screen
visible to someone without the Banking permission, anything changing on the Egypt side,
or a step asking you to force numbers to balance. Stop, screenshot, tell Claude.
