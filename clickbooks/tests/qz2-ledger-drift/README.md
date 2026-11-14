# QZ2 ledger drift scenarios (local Postgres only — never run against Supabase)

Minimal stand-in tables + the real `clickbooks/sql/01_us_core.sql`, then the
real `sql/v55-83-QX-transfer-ledger.sql`, then scenarios S1–S11:
transfers via 1090 (unapproved 1090 must not abort), recategorize → reverse +
re-post, unmapped category → auto-create + re-post, duplicate → reverse,
unpaired leg → expense, payment void/revive, invoice total edit, invoice
delete (cascade), locked period (reported, never auto-reversed).

    createdb cb
    psql -d cb -f 00_pre.sql -f ../../sql/01_us_core.sql -f 01_min.sql
    psql -d cb -f ../../../sql/v55-83-QX-transfer-ledger.sql
    psql -d cb -At -f 10_scen.sql -f 12_inv.sql

Verified Nov 8 2026: every scenario balanced (1090 nets to 0 for paired legs,
AR/income/bank follow every hub change, re-runs are no-ops).

## RB (Nov 8 2026) — ledger completion
After the QX file, also run `../../../sql/v55-83-RB-ledger-completion.sql`, then
`13_rb.sql`: bank-account auto mapping + twin reuse, split deposit (payment +
parked), split change → reverse/re-post, money-out split (classified path does
not double-book), classified → split, NextTrade advance (Due from) + bill it
paid (real category) + void, opening balance once. Trial balance nets to 0.

## SJ / SK / SL (Nov 13 2026) — payables, month-end, journal entries
After `13_rb.sql`: add the columns the newer SQL expects, run RS, then the three files and their scenarios:

    psql -d cb -c "alter table public.expense_categories add column if not exists sort int, add column if not exists active boolean default true; create table if not exists public.vendor_bill_lines(id uuid primary key default gen_random_uuid(), bill_id uuid, line_kind text, commission_amount numeric);"
    psql -d cb -f ../../../sql/v55-83-RS-commission-ledger.sql -f ../../../sql/v55-83-SJ-bills-payable.sql -f ../../../sql/v55-83-SK-reconcile-close.sql -f ../../../sql/v55-83-SL-journal-entries.sql
    psql -d cb -At -f 14_sj.sql -f 15_sk.sql -f 16_sl.sql

No line may print FAIL; each file ends with "TRIAL BALANCE nets to zero: 0".
