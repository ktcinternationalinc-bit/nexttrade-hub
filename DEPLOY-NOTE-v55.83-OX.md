# v55.83-OX — Deploy note (READ THIS BEFORE PUSHING)

This build merges the ClickBooks US P1–P8 package (the parallel ChatGPT session's work)
into our line. **It will not fully work until you do the 3 steps below.** Until then,
bank screens and team administration will show "needs configuration" errors — that is
the new security design failing closed, not a bug.

## Step 1 — Run ONE SQL file in Supabase (required)

Supabase → SQL Editor → paste and run the whole file:

    sql/bank-balance-visibility.sql

(It creates the protected financial-permission tables and locks bank-account
tables down to safe columns. It was tested 15/15 against a real Postgres.)

Only if you also want the Ledgerly mirror tab, additionally run:

    sql/ledgerly-automatic-sync.sql

## Step 2 — Find YOUR Supabase Auth ID (required)

This is NOT your normal Hub user id. In the Supabase SQL Editor run:

    select id, email from auth.users where lower(email) = lower('YOUR-LOGIN-EMAIL');

Copy the `id` it returns (a long uuid). Also sanity-check that your identity maps
cleanly (should return exactly 1 row):

    select * from public.bank_visibility_profile_for_identity(
      (select id from auth.users where lower(email) = lower('YOUR-LOGIN-EMAIL') limit 1)
    );

If that returns 0 rows or 2 rows, STOP and tell Claude — it means your email exists
twice and you would be locked out of banking screens.

## Step 3 — Add TWO settings in Vercel (required)

Vercel → the hub project → Settings → Environment Variables → add for Production:

    HUB_SUPER_ADMIN_AUTH_USER_IDS = <the uuid from Step 2>
    HUB_ADMIN_AUTH_USER_IDS       = <same uuid, or leave it out>

Then push this zip's code with GitHub Desktop as usual and redeploy.

## What you'll see after deploying

- Everything you had in OW works the same (reconciliation, US/Egypt split, P&L,
  release numbers, dashboard — all pinned by tests, 123/123 green).
- Settings → a new **Financial data access** panel: this is now the ONLY place that
  grants "Full dashboard" and "Banking information". Old role/module toggles can no
  longer reveal bank balances — that was a real security hole and is now closed.
- Staff WITHOUT "Full dashboard" no longer see the company-wide monthly sales
  widget or treasury totals; grant it per person in the new panel.
- ClickBooks tabs stay **hidden** (their switches are off). The ClickBooks ledger is
  installed in Supabase but empty, posting disabled, Wave remains the boss. Turning
  it on is a separate, deliberate project (see below).

## ClickBooks — do NOT turn on yet

The package is honest about this and I agree with it: before ClickBooks can hold your
books it needs an accountant-grade opening-balance migration, a 7–31 day parallel run
next to Wave, and reviewed account mappings. 1,142 old paid invoices have no detailed
payment rows, so history can only enter as a reconciled opening balance — never
guessed. When you want to start that, say so and we plan it properly.

If you want to peek at the (read-only) ClickBooks screens, add in Vercel:
CLICKBOOKS_US_ENABLED=true and NEXT_PUBLIC_CLICKBOOKS_US_ENABLED=true
(plus the WORKBENCH/REPORTS/CUTOVER pairs for those tabs). Keep every
*_WRITES/_SHADOW/_AUTO_STAGE flag false.

## Ledgerly — optional

The 📗 Ledgerly tab mirrors an outside accounting source read-only every 15 min.
It needs its own credentials (see LEDGERLY_AUTOMATIC_FEED.md). Without them the tab
stays hidden and its scheduled job just reports "not configured". If you don't use
Ledgerly at all, tell Claude and we'll remove its 15-minute schedule entry.
