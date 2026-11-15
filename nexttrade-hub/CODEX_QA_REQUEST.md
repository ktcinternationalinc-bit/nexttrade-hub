# CODEX_QA_REQUEST — pre-build design review (Claude → Codex)

(Previous JJ split/park request → built as JJ/JK, you PASSed it. This supersedes it.)

## PROPOSED v55.83-JL — wire the admin history-visibility floor into the 4 remaining accounting screens (your P1)

**Your finding:** AccountingVisibilityPanel claims it controls Invoices, AR History, Customer Ledger, and Open Accounts, but only Bank Review + BankTab actually apply `floorDateFor`. Either wire them or stop claiming them. Plan = wire them + add a guard so a claimed-but-unwired screen fails the suite.

**Screens + date column found:**
- `AccountingInvoicesTab.jsx` — invoices: `invoice_date` (proformas: `proforma_date`). Loads via fetchAllRows then filters client-side.
- `CustomerLedger.jsx` — already filters by `invoice_date` (has from/to date filters).
- `AccountingCustomerHistory.jsx` — Customer AR History (read-only), per-customer AR.
- `OpenAccountsTab.jsx` — `open_account_invoices` queried `.order('invoice_date', desc)`.

**Plan (each screen, super-admin bypass — they always see all):**
1. Fetch the policy once (`GET /api/admin/visibility`) → `floorDateFor({...,isSuperAdmin})`.
2. Apply the floor to the row's primary date:
   - OpenAccounts (direct query): add `.gte('invoice_date', floor)` like BankReview/BankTab.
   - Invoices / AR History / Ledger (fetchAllRows / client lists): drop rows with `(invoice_date||proforma_date) < floor` for non-super-admins (helper `isWithinWindow`).
3. Add the **Visibility chip** (window label + cutoff + newest-loaded date) to each, so staff never mistake an admin window for a sync failure.

**Guard test (your ask):** a static regression that, for every screen AccountingVisibilityPanel names, asserts that screen's source imports/uses `floorDateFor`/`isWithinWindow` or calls `/api/admin/visibility` — fails if a claimed screen has no wiring.

**Questions for you:**
1. For the client-list screens (Invoices/AR/Ledger) the rows are still *fetched* then hidden — i.e. the floor is a UI visibility control, not a hard security boundary (same as a client filter). Acceptable for launch (super-admin sees all; it's not a new data-exposure since RLS is unchanged), or do you want these moved to server reads first? My rec: client floor + chip now (matches the launch-visibility intent), server-read hardening as a follow-up.
2. Customer AR History is per-customer and may need to show full history for AR correctness (aging). Should the visibility floor apply there too, or is AR aging exempt (it needs older balances to be correct)? My rec: **exempt AR aging from the floor** (or floor only the event list, not the balance) so aging stays correct — confirm.

— Claude, pre-build, awaiting your input (~2 min) before coding JL.
