# CLAUDE_HANDOFF

QA loop:
- Claude writes status here.
- Codex reads this file and the actual repo diff every 5 minutes.
- Codex writes QA findings to CODEX_QA_FEEDBACK.md and/or the chat.
- Claude reads CODEX_QA_FEEDBACK.md + this file before every change; fixes open FAILs before new features; never overwrites the Codex file.

---

## 🎯 STANDING TO-DO / PRIORITIES (heartbeat never idles; Claude + Codex are partners — consult him)
Main goal: polish & refine the KTC Hub. **Order of work (Max, explicit): (1) Wave↔Hub / Banking tab, (2) then Inventory. BUGS FIRST, enhancements only after bugs.** Never break employee-facing flows or touch real-money writes unsafely. Work closely with Codex as QA/BA consultant — read his findings every fire, fix his FAILs first, and route open questions to him here.

- **P0 — Bug triage (always first):** fix ANY Codex FAIL / real bug immediately; keep `npm run build` green; never weaken the production default-off invariant; no employee-facing crash/lockout.
- **P1 — WAVE↔HUB / BANKING (priority area #1): BUGS → then enhancements.**
  - Hunt + fix bugs across: Bank Review matching/unmatching, the 3 Wave push routes + shared guards (wave-silo-guard / wave-sync-eligibility), Wave Sync Center, push-payment, split categories, Open Accounts.
  - Then enhancements (only after the bug list is clear).
- **P1 — Production Wave push toggle:** code-ready as of HL (dry-run guard now honors production_push_unlocked too — fixed Codex's open FAIL). Gated on USER: run launch SQL → test silo → one real payment → verify `wave_payment_id` → flip real KTC. Claude must NOT flip it.
- **P0 — Migrations/config (USER):** run `sql/v55-83-LAUNCH-accounting-banking.sql`; assign employee permissions. (Claude: keep verifying + reminding.)
- **P2 — INVENTORY (priority area #2): BUGS → then enhancements** (gap list below; verify each vs live code first).
- **P2 — Post-launch cleanups (safe, do these while waiting):**
  - Narrow the HH split-save fallback to missing-column/schema errors only (Codex caution).
  - Clean the stale static tests Codex listed (fi-payment-queue-safety, fs-permission-model, fr-route-lockdown, a-6-27-52-open-accounts, aa-phase2-polish) so the suite reflects current routes/wording.
  - Keep Wave Sync Center split categories truthfully Hub-only (no generic push exists).
- **P2 — Stage B virtual-mix SELLING:** gated on allocation rule (user) + live-mirrored SQL + Codex review. Stage A preview stays read-only.
- **P2 — NEXT MAJOR FOCUS (after banking/accounting is stable): INVENTORY SYSTEM + REPORTS gap-hunt.** Systematically find and fix gaps across the inventory module (Overview, Report Center, Receiving, Stock Import, Adjustments, Cost Layers, Movements Ledger, Mix Composition, Master SKU, permissions, report defs). Categories to hunt: silent error-swallowing, missing empty/error states, permission key inconsistencies, data-source mismatches vs Overview, missing report columns/exports/totals, bilingual (EN/AR) gaps, valuation-permission leaks, N+1 / select(*) perf, UX. Maintain a prioritized GAP LIST (below) and fix the top safe item each heartbeat. Each fix: build→commit→deploy→badge+What's New+handoff; add a regression test where it makes sense.
- **P3 — Ongoing professional polish** of Accounting + Inventory tabs (loading/empty/error states, consistency, performance) — safe, concrete, one per fire.

### INVENTORY GAP LIST (living — from a code audit; fix top-safe each heartbeat)
NOTE: the audit had false positives — verify each before fixing (e.g. it claimed Adjustments/Movements/CostLayers swallow errors with empty catches; in fact they HAVE try/catch+toast — the real gap was unchecked `res.error` since Supabase doesn't throw on query errors).
- ✅ **HK (DONE, 5e?/this build):** InventoryAdjustments / InventoryMovementsLedger / InventoryCostLayers now check each `res.error` after Promise.all and toast the real per-table reason (was silent empty on RLS/missing-column). Matches the ReportCenter q() fix.
- [ ] P1: InventoryOverview.jsx layers/receipts load uses `safe()` — confirm it distinguishes load-failure from no-stock; surface error if `res.error`.
- [ ] P2: Extract shared VALID/INVALID receipt-status constants (Overview + ReportCenter both hardcode cancelled/pending_detail/merged/reversed) to prevent drift.
- [ ] P2: ReportTable empty state — distinguish error / filtered-out / truly-empty (partly done in ReportCenter; ReportTable itself still bare "No data").
- [ ] P2: UOM_RANK missing 'sqm' (sorts last) in InventoryOverview — add sqm rank.
- [ ] P3: select('*') → explicit columns on inventory_movements / inventory_layers / skus list (perf); add limit caps on layers/movements in ReportCenter.
- [ ] P3: InventoryReportCenter refresh button + last-updated (parity with Accounting dashboard); RTL column order in AR.
- [ ] P3: valuation double-gate — strip cost fields from rows when !showValuation (defense-in-depth; currently shown as "Restricted" text only).
- (Verify each against live code before fixing — audit line numbers are approximate.)

Heartbeat rule: each fire — (1) read Codex file via `cat`; (2) fix FAILs; (3) else pick the highest-priority UNBLOCKED item above and ship it (build→commit→deploy→bump badge+What's New+handoff); (4) only report a bare "hold" if EVERY item is genuinely blocked/gated, and even then re-verify + re-prioritize next fire. Never stop the loop.

---

## 📒 Progress & thinking (running log — newest context at top)

### Where we are (one line)
The whole **safe** Accounting/Bank/Open-Accounts/Inventory-report backlog is shipped and Codex-reviewed. The only big thing left is the **virtual-mix consuming engine (Stage B)**, which is deliberately gated on a business decision + a SQL migration the user must run.

### Build-by-build progress (this session)
| Build | Commit | What landed | QA |
|---|---|---|---|
| GU | f39eea1 | OA print/statement for view-only; Excel for export; neutered Bank quick-match | superseded |
| GV | f39eea1 | `/api/plaid/match` → 410; Bank unmatch disabled; customer-statement Excel | PASS |
| GW | 7b09b06 | Inventory report error surfacing + diagnostics + empty-state reasons; mix-edit perm key; report perms in Settings | PASS |
| GX | 2bb98a2 | Inventory Snapshot reconciles w/ Overview (valid-receipt logic); removed dead Bank modal; QA-loop files | PASS w/ cautions |
| GY | 432ae7d | Snapshot hide zero-stock+templates (later corrected in HD) | caution |
| GZ | 80ff065 | Removed dead Bank quick-match scaffolding | — |
| HA | dc0581f | **Stage A** read-only Stock-Mix Sale Preview (non-destructive) | PASS (preview only) |
| HB | 166cac8 | Accounting Dashboard live Refresh + last-updated; Stage B plan + draft SQL | FAILs found ↓ |
| HC | b0ac212 | Inventory report print/CSV totals row | — |
| HD | 34d5b47 | **Fixed all 3 Codex HB FAILs** (Excel note strip +test, split Wave fields, Stage B SQL gated) + 2 cautions | awaiting re-verify |

### Process note (important)
The `Read` tool de-dupes and once masked a whole Codex pass ("unchanged since last Read"). Heartbeat now reads the TRUE bytes via `cat CODEX_QA_FEEDBACK.md`. Do not trust the dedup.

### My honest thoughts / recommendations
1. **Launch-readiness:** Accounting + Bank + Open Accounts are in good shape — the dangerous accounting-bypass paths are closed (410 route, no quick match/unmatch), statements are clean, permissions are split sensibly. I'd call these launch-ready pending the user's own live spot-check.
2. **Inventory reports** now reconcile with Overview (numbers + default row visibility) and print/export are complete with totals. Good to launch.
3. **Stage B is the real frontier.** Two genuine blockers, neither of which I should guess: (a) the **allocation rule** (proportional vs fixed recipe vs manual — needs the El Sayad records), and (b) the **SQL RPC** must mirror the LIVE `consume_invoice_item_inventory` (locking, warehouse, FX/COGS) — I can't introspect Supabase from here. Until both are settled, the read-only Stage A preview is the safe stand-in. Recommend the user pick the allocation rule next; I'll then write the corrected RPC for Codex to review before anyone runs it.
4. **Wave generic transaction push** remains a true platform limitation (no money-transaction mutation). Truthfully labeled Hub-only. Don't reopen without a confirmed Wave mutation.
5. **Open small items** (not blocking): previewProportionalSplit DRY refactor, Wave Sync Center surfacing split lines, direct Bank-tab matching (only if the business actually wants staff matching from the raw Bank tab — Bank Review is the safe home).

### Open decisions I need from the user
- **Allocation rule for virtual-mix sales** (A proportional / B fixed recipe / C manual at sale time).
- Whether to build **direct Bank-tab matching** or keep matching solely in Bank Review (recommended).

---

## 🚀 LAUNCH — Accounting + Banking go-live + v55.83-HI production-push toggle
Build **v55.83-HI** (committing now). Max said: launch today + build a super-admin toggle to enable real KTC production Wave push AFTER he tests the test silo; authorized me to decide-with-Codex if he's away.

### HI — super-admin production Wave push unlock (DEFAULT OFF — no launch-day behavior change)
- New `wave_business_registry.production_push_unlocked` (sql/v55-83-HI-production-push-unlock.sql — **USER must run**; default false; if column absent code still treats as not-unlocked → locked).
- Server guards (push-customer / push-invoice-v2 / push-payment): production push allowed ONLY when `production_push_unlocked===true` **and** existing `writes_enabled` + `allow_<action>_push` + permission gate. Test (APPROVED) business path unchanged.
- UI (WaveSyncCenter): super-admin-only rose unlock checkbox (with confirm) in Settings; other flags stay locked until unlocked; Dry Run/Push buttons enable only when unlocked; banner shows LOCKED vs ENABLED.
- **Invariant:** OFF by default = today's exact behavior; flipping it is a deliberate super-admin action.

### HJ — fixed Codex's two HI FAILs (real-money path)
- **FAIL 1 (false-ready):** runDryRun()/pushSelected() still returned on any `isProd` → now `isProd && !productionUnlocked` (matches button-disable). Unlock now actually works.
- **FAIL 2 (too-broad guard):** push-customer/push-invoice-v2 APPROVED-bypass now requires `reg.is_production !== false && reg.production_push_unlocked === true` (matches push-payment); `production_push_unlocked` can't unlock a non-production silo.
- Default-off invariant intact. Build exit 0.
- Codex CAUTION (HH fallback catches all insert errors, not only missing-column) — noted for post-launch narrowing; acceptable as launch stability guard per Codex.
- ⮕ For Codex: please re-verify HJ closes both FAILs and the default-off invariant still holds.

### Pre-unlock checklist (from Codex — do before flipping real KTC/Kandil production)
1. Run `sql/v55-83-HE-...` and `sql/v55-83-HI-...` in Supabase.
2. Verify the approved Kandil registry row: writes_enabled + allow_customer_push + allow_invoice_push + allow_payment_push true; and `wave_business_settings` has default_payment_account_id + default_invoice_product_id.
3. Dry-run ONE clean payment → push ONE real payment → verify it appears in Wave + Hub stores real `wave_payment_id`. Only then open push to staff.

### ⮕ (earlier) For Codex — URGENT review of HI (real-money write path)
Please verify before Max flips it on: (1) with `production_push_unlocked` false/absent, all three routes still BLOCK production (default-off invariant holds); (2) the test/APPROVED business push path is unchanged; (3) the unlock requires super_admin + writes_enabled + allow_<action>_push, no weaker path; (4) the WaveSyncCenter JSX is correct (big edit). Recommend Max test one real payment on the test silo, then unlock + one real payment on KTC production verified in Wave, before opening push to staff.

---

## (earlier) LAUNCH GO/NO-GO — Accounting + Banking go live with KTC Hub employees
Build **v55.83-HH**.

### ✅ Codex verdict received (QA sha dba6fb3): CONDITIONAL GO
- **GO** for: Bank import/view, Bank Review match/unmatch (payment_matches + accounting_invoice_payments + recompute, silo + outgoing guards verified), invoice balance recompute, Open Accounts statements/Excel, Wave queue visibility, manual Wave workflow.
- **NOT GO unless decided/confirmed:** (1) automatic **production Wave push** is intentionally LOCKED (Sync Center + push routes block prod) — fine if launch is "Hub-safe + manual Wave"; (2) split Wave categories need the HE migration/preflight green (HH fallback prevents crashes either way); (3) don't claim generic bank category push syncs to Wave (it's Hub-only).
- Stale static tests are NOT blockers (build + focused current-path tests pass); clean post-launch.
- **Awaiting Max's decision on launch mode** (Hub-safe/manual-Wave = ready now vs production Wave push unlock = needs a build). Migration recommended either way.

### ⮕ For Codex — URGENT: please do a focused GO / NO-GO review of the Accounting + Banking tabs only
Confirm or refute these before go-live; write findings at top of your file:
1. Bank Review match/unmatch posts correctly (payment_matches + accounting_invoice_payments + recomputeInvoice) and nothing bypasses the ledger. (Legacy /api/plaid/match is 410; verified no live callers.)
2. The HH fallback makes split-save crash-proof if `bank_transaction_splits` lacks the Wave columns. Confirm the .catch retry is correct.
3. Run `/api/wave/preflight-schema` (or check) — does prod `bank_transaction_splits` already have the Wave columns? If yes, HH fallback never triggers and the migration is optional. If no, the user should run sql/v55-83-HE for full Wave metadata (but HH keeps it stable either way).
4. Any employee-facing crash/permission lockout risk on Accounting Dashboard / Bank Review / BankTab / Open Accounts.

### Claude's launch assessment (Accounting + Banking)
**READY for launch** with these facts:
- ✅ Dangerous accounting-bypass paths CLOSED: /api/plaid/match → 410, no live callers; BankTab match/unmatch route to Bank Review only.
- ✅ Bank Review = the real accounting flow (verified: payment_matches, accounting_invoice_payments, recomputeInvoice, void/unmatch).
- ✅ Open Accounts statements clean (no system notes; customer/internal print + Excel); print/export gated by view/export perms.
- ✅ Accounting Dashboard: permission-split AR/bank cards, live Refresh, silo-scoped.
- ✅ HH: split-save can't crash even if the HE migration isn't run.
- ✅ Build exit 0; OA-Excel + mix-split regression tests pass.

### USER pre-launch checklist (do these before employees log in)
1. **Assign permissions** to each employee in Settings → Roles & Permissions: Bank (`bank.view`, `bank.see_amounts`, `payments.match`/`payments.unmatch` as needed, `bank.classify`), AR (`ar.view_*`), `Open Accounts`/`Edit Open Accounts`, `Export Data`. Without these they'll see "Restricted"/no access.
2. **(Recommended, ~1 min) Run** `sql/v55-83-HE-bank-transaction-splits-wave-columns.sql` in Supabase so split Wave categories persist full metadata. NOT required for stability (HH fallback covers it).
3. Confirm the active Wave business/silo is selected so the dashboard scopes correctly.

### NOT part of this launch (future; their absence does NOT block go-live)
- Stage B virtual-mix SELLING (gated; Stage A preview is read-only and harmless).
- Generic Wave transaction/category PUSH (Wave platform limit; shown truthfully as Hub-only).
- Direct Bank-tab matching (Bank Review is the matching home).

---

## Current build/version
**v55.83-IE** (committing). History: … IB `d327fcb` → IC `61c4844` → ID `c5c14b6` → IE (this).

## IE — TWO fixes
1) **P0 (Max-reported): permission toggle was broken.** SettingsTab.togglePermission used `?? true` unconditionally while the grid shows ACTION_PERMS as `?? false` → clicking an OFF action perm re-saved it OFF → couldn't grant any action permission (incl. new ACCT-001..007). Fixed: default from TAB_PERMS membership. Test added (8 assertions).
2) **Codex FAIL: Wave-synced payment local-reverse guard.** BankReviewTab loads wave_payment_id into paysByTxn; unmatch() blocks when a payment row has wave_payment_id or sync_status synced/manual_done (reverse in Wave first). Test added (9 assertions).
Both build exit 0, tests pass.
⮕ For Codex: verify both. The permission-toggle fix is the unblocker for assigning ACCT-001..007 to staff.

## ID — closed Codex's orphan-payment caution
BankReviewTab loads accounting_invoice_payments → paysByTxn (non-voided). Detail surfaces an inline-styled orphan panel (payment rows but no active match) with a Reverse button; unmatch() guard relaxed to handle orphans (void-by-bank_txn + IB recompute + HO credit reversal cover it). Match/unmatch correctness cluster complete: HN (overpayment), HO (phantom credit), IB (recompute coverage), IC (voided-match filter), ID (orphan reverse). No SQL.
⮕ For Codex: verify orphan reverse path + that the new paysByTxn load doesn't mis-surface normally-matched txns (orphan panel only shows when NO active match). Next candidates: push-payment exchangeRate/multi-currency (gated, needs Wave-semantics confirmation — likely defer to live test), then Inventory bugs.

## IC — Codex FAIL fixed: voided matches treated as active
BankReviewTab matchesByTxn now filters payment_matches to voided !== true before grouping, so an unmatched txn no longer shows the Matched badge/panel/unmatch button. Test test-v55-83-ic-active-matches.js (6 assertions). No SQL.
⮕ Codex CAUTION still open (noted, not yet built): zero-payment_match orphan accounting_invoice_payments rows have no unmatch/repair path (rare — import-only payments). Candidate next fix or a Sync Center repair tool. Also BACKLOG (Codex, out of immediate Wave/Inventory scope): comms split across CRM vs accounting customers; CRM buttons bypass Hub inbox; phone webhook signature fail-open; AI cross-system assistant.
⮕ For Codex: verify IC. Next: continue Wave↔Hub (orphan payment repair, push-payment multi-currency) then Inventory.

## IB — Wave↔Hub money bug fixed (unmatch recompute coverage)
unmatch() recomputed only payment_matches invoices, but voids accounting_invoice_payments by bank_transaction_id → a payment row whose invoice had no match left a stale overstated balance. Fix: fetch payment-row accounting_invoice_id set and merge into invIds before recompute. Pairs with HN/HO. No SQL.
⮕ For Codex: verify unmatch now recomputes every affected invoice. Next: continue Wave↔Hub (Sync Center orphan/dedup, push-payment multi-currency) then Inventory.

## IA — ticket create-form file attach (Max #2 — complete)
Create form has a staged file input; createTicket captures newTkt = dbInsert('tickets') and uploads f.attachFile to ticket-attachments (<ticketNum>_<ts>.<ext>) + inserts ticket_comments row (non-fatal). Ticket attach now covered at: create (IA), detail header button (HY), comment paperclip (HX). Contrast/permission sweep complete (HZ).
⮕ For Codex: verify create-attach flow. KNOWN DEPENDENCY (flag to Max): ticket-attachments storage bucket + RLS need live verification (all 3 attach paths depend on it). ⮕ Next: resume Wave↔Hub bug hunt.

## HZ — closed Codex's repeated Open Accounts contrast FAIL
Converted OpenAccountsTab !canView permission gate to RestrictedNotice (only the gate; ledger/statement/print/Excel untouched). Contrast/permission-gate sweep now COMPLETE across Accounting, Wave, Inventory, Reports, Open Accounts. No SQL.
## Tickets attach (Max): HX labeled the composer paperclip; HY added a prominent '📎 Attach Document' button in the ticket detail header (shared attachFileToTicket helper). REMAINING: #2 file upload on the NEW-ticket create form (next fire) — stage file, upload-after-create. NOTE for Codex/Max: ticket-attachments storage bucket + RLS need live verification (or migrate to shared attachments table) before calling ticket attach launch-ready.
⮕ Open launch gates (USER/live): assign ACCT perms; run launch SQL + preflight; one real Kandil/KTC Wave payment verification; live visual check of restricted cards.

## HW — closed Codex HV FAIL (last 2 restricted gates)
Converted InventoryReportCenter !mayView + InventoryPnLReports !canSeePnL permission returns to RestrictedNotice. CONTRAST SWEEP FULLY COMPLETE across Accounting/Wave/Inventory/Reports — every permission/lock gate uses the inline readable component. No SQL.
⮕ For Codex: confirm no remaining dark-on-dark permission/error gate anywhere. Next: Wave↔Hub bug hunt resumes.

## HV — closed Codex HU FAIL + HT caution
Converted InventoryOverview's own !canView gate to RestrictedNotice (HU missed it). ASCII-ized the HT load-error separator (· → ;). Contrast sweep now truly complete: Accounting+Wave (HQ), Inventory sub-screens (HU), Inventory Overview (HV). No SQL.
⮕ For Codex: confirm Overview gate + no remaining dark-on-dark. Next: resume Wave↔Hub bug hunt.

## HU — contrast sweep COMPLETE (Inventory cluster)
Converted all 8 Inventory "Access restricted" early-return panels to RestrictedNotice (InventoryReceiving was genuinely dark-on-dark: text-amber-900 on bg-amber-500/15; rest were purge-prone bg-amber-50). Contrast sweep now covers Accounting+Wave (HQ) + Inventory (HU). No gate logic changed, no SQL.
⮕ For Codex: verify the inventory restricted panels + flag any remaining dark-on-dark anywhere. Remaining work: resume Wave↔Hub bug hunt (Sync Center dedup/orphan, push-payment edge cases, multi-currency recompute); legacy WhatsApp send (out-of-focus). USER: assign ACCT perms, live visual check, production-Wave live test.

## HT — Codex cross-area FAIL fixed: Inventory Overview error-surfacing
load() now checks res.error on products/lists/layers/receipts and setError()+toast (was silent empty stock on a failed query — Supabase doesn't throw). Sales optional → warn. Mirrors HK/ReportCenter. No SQL. Codex PASSED HS (P0 fully closed).
⮕ Remaining: Inventory restricted-card contrast conversion (bg-amber-50 ×8 → RestrictedNotice); legacy WhatsApp send contract (out-of-focus, lower priority); resume Wave↔Hub bug hunt; USER: assign ACCT perms + live visual check + production-Wave live test.

## HS — closed Codex's 3 HR cautions (Codex PASSED HR/P0)
SettingsTab only: ASCII " - " separators in ACCT labels; added assignable accounting.company_profile.edit (ACCT-001E); documented the PO←invoice back-compat bridge in ACCT-006/007 descriptions. No gate logic change, no SQL.
⮕ For Codex: confirm cautions closed. Remaining: real visual check of restricted cards on the live dark Accounting surface (USER); then continue — Inventory restricted-card contrast conversion, Codex cross-area FAILs (Inventory Overview res.error; legacy WhatsApp send contract), Wave↔Hub bug hunt.

## HR — Codex P0 FIXED: accounting doc tabs no longer gated by bank.view
Re-gated Invoices/Proformas, Accounting Customers, Company Profile, Customer AR History, Purchase Orders off canViewBank → explicit document helpers (canViewInvoices/canCreateInvoice, canViewAccountingCustomers/Edit, canViewCompanyProfile/Edit, canViewPurchaseOrders/Edit). BankReviewTab keeps canViewBank. Helpers role-aware + legacy fallbacks (no lockout); bank.view never a doc fallback. Added 7 assignable Settings keys ACCT-001..007 with codes+descriptions. Restricted notices name the exact key. Fixed RestrictedNotice mojibake icon. Test test-v55-83-hr-accounting-doc-permissions.js (20 assertions, passing) incl. acceptance: invoice.view-without-bank.view opens invoices; bank.view alone does not; Bank Review still needs bank.view.
⮕ For Codex: verify the P0 acceptance set + that no current staff are locked out by the new gates (legacy fallbacks). 
⮕ STILL OPEN: real visual check of restricted cards on the dark Accounting surface (user-side); Inventory restricted-card contrast conversion (queued); cross-area FAILs Codex logged earlier — Inventory Overview res.error surfacing + legacy WhatsApp send contract (next bug-hunt items).

## HQ — CONTRAST BUG fix (Max reported: unreadable dark-on-dark "Restricted" box on Invoices)
Root cause: bg-amber-100/text-amber-950 restricted panels get purged/overridden under the dark theme → dark-on-dark (the exact issue SiloBanner documents + solved with inline styles). Created src/components/RestrictedNotice.jsx (inline styles, guaranteed contrast: dark slate bg, gold/red bright border, bright text). Replaced the early-return restricted panels in AccountingDashboard, AccountingInvoicesTab (the screenshot), AccountingCustomerHistory, CustomerLedger, CompanyProfileTab, PurchaseOrdersTab, BankReviewTab, WaveConnectionTab, WaveImportTab.
⮕ STILL TO CONVERT next fire (use RestrictedNotice): Inventory "Access restricted" cluster (bg-amber-50 ×8: InventoryAdjustments/CostLayers/MovementsLedger/ProductMaster/Receiving/StockImport/ImportProducts/MasterAdmin), AccountingCustomersTab view-only banner, CRM/others. ⮕ For Codex: verify the inline-style approach renders readable + flag any remaining dark-on-dark panel anywhere.

## HP — closed Codex's HO test caution
Added __tests__/test-v55-83-ho-unmatch-credit-reversal.js (7 assertions; passing): locks unmatch→customer_credits void scoped by source_transaction_id+status=open (non-fatal), the source_transaction_id stamp on the credit insert, and documents the intentional non-reversal of unapplied_deposits. Per Codex's agreement, NOT adding an unapplied_deposits origin-tag schema change mid-launch — the rare overpayment-no-customer residual remains an unapplied_deposit (manual-review by nature).
Codex HO verdict: PASS. Open deferred cautions (post-launch, not blockers): (1) stamp bank-txn customer = mCustomerId||inv.accounting_customer_id||t.accounting_customer_id; (2) make the match/overpayment multi-write flow atomic (server RPC or repair path).
⮕ For Codex: HP is the requested HO test; please confirm it satisfies the caution.

## HO — Wave↔Hub money bug fixed (pairs with HN)
unmatch() didn't reverse the overpayment customer_credits row → phantom open credit after unmatch. Fixed: non-fatal void of customer_credits WHERE source_transaction_id=t.id AND status='open' (exact scope; source_transaction_id only set by the overpayment path).
⮕ For Codex: (1) verify HO credit reversal; (2) OPEN QUESTION — unapplied_deposits from the rare overpayment-no-customer fallback share bank_transaction_id with manual unapplied deposits, so I did NOT auto-void them on unmatch. Recommend adding a source/origin tag (e.g. source:'overpayment') to that insert so unmatch can reverse only the auto-created ones. Want your call before I add a column/tag.
Codex HN verdict: PASS with 2 cautions (bank-txn customer stamp should also fall back to inv.accounting_customer_id — safe polish; overpayment flow not atomic — needs an RPC/repair path post-launch). Both logged for later; not money-loss blockers.

## HN — Wave↔Hub money-integrity BUG fixed (found by my own code read, priority #1)
BankReviewTab.applyToInvoice recorded an overpayment as a customer credit ONLY when the form had mCustomerId; the payment row stores only applied_to_invoice (capped), so an overpayment matched without a picked customer was lost from the books. Fixed: credit defaults to inv.accounting_customer_id; if no customer, park residual as unapplied_deposit. Test added (8 assertions incl. money-conservation). Codex PASSED HM (production bypass closed); only leftover is a dead UNLOCK_PHRASE const (Codex says leave it until after live payment verification).
⮕ For Codex: please verify HN overpayment handling (and confirm no other place caps a payment without recording the residual).

## HM — Codex caution → hardening (Wave↔Hub safety, bug-class)
Codex PASSED HL (production dry-run guard now honors the flag — his sanity check confirmed). His remaining caution: the old typed-phrase fallback in assertCanPush was a latent production-write bypass. HM removes it (verified dead: only caller dryRunRecord passes blank; routes use production_push_unlocked). Production is now authorized SOLELY by production_push_unlocked (+ writes_enabled + per-action flag). Default-off intact.
⮕ For Codex: confirm the phrase-fallback removal closes the caution and nothing relied on it.

## HL — fixed Codex's open FAIL (Wave↔Hub bug, priority area #1)
Codex (QA sha d44f351): production toggle NOT code-ready — Dry Run path (wave-silo-guard.assertCanPush via wave-sync-eligibility.dryRunRecord) still required the typed UNLOCK_PHRASE and ignored production_push_unlocked, while the push routes already honored it (HI/HJ). FIXED: assertCanPush now honors production_push_unlocked in both the APPROVED-target check and the production block (writes_enabled + per-action flag still enforced; typed phrase kept as fallback; default still locked). Toggle now consistent across dry-run + all 3 push routes. ⮕ For Codex: re-verify dry-run unlock path + default-off invariant.

## Codex HE/HF review (QA sha 73ce64f) — READ
Codex passed everything with no FAILs:
- HE grouped Stock Mix totals → **PASS**.
- HE split Wave guard + SyncCenter surfacing → **PASS** (caution: still Hub-only — correct).
- HE split-Wave migration file → **PASS** (caution: **USER must run it in Supabase** / confirm preflight before split Wave saves are prod-safe).
- HF previewProportionalSplit refactor → **PASS** (caution: normalize rows for direct/test callers).
- Accounting/OA regression + build → **PASS**.

## HG (this build) — addressed the one concrete code caution
`lib/mix-composition.js` previewProportionalSplit now normalizes `rows` (Array.isArray guard) so non-array/null input can't crash; added `__tests__/test-v55-83-hg-preview-split.js` (10 assertions, passing). No SQL, no writes.

## Open (unchanged — all gated/user-side)
- **USER:** run `sql/v55-83-HE-bank-transaction-splits-wave-columns.sql` in Supabase (or confirm preflight) → makes split Wave saves prod-safe.
- Stage B virtual-mix selling — gated (allocation rule + live-mirrored SQL + Codex review).
- Direct Bank-tab matching — business decision.
- Live Wave payment verification + Snapshot real-product visual check — user-side.

⮕ For Codex: HG is a tiny robustness + test cleanup; please re-verify when convenient. (committing/deploying now). History: … HD `34d5b47` → `ecd6f58` → HE `b807cfa` → HF (this).

## HF — heartbeat (Codex QA file sha 69b5790 = unchanged; HE not yet re-reviewed, no new findings)
Addressed a standing Codex CAUTION: Stage A preview duplicated proportional math. `InventoryMixComposition.salePreview` now uses the shared `previewProportionalSplit()` (exact-sum remainder→last, per-line shortfall, clamped remaining). Output keys unchanged; Remaining cell now colors on per-line shortfall. Still read-only. No SQL.
NOTE: HD FAILs (grouped totals, split Wave) were fixed in **HE** (`b807cfa`); Codex hasn't re-reviewed HE/HF yet — awaiting its next pass. (committing/deploying now). History: … HC `b0ac212` → HD `34d5b47` → handoff `ecd6f58` → HE (this).

## Codex HC/HD-pass FAILs — READ + actioned in HE
Read true bytes of CODEX_QA_FEEDBACK.md (sha 69b5790) via `cat`.
- **FAIL — Stock Mix grouped print/export totals (HC, reasserted HD)** → FIXED. Grouped CSV gets a per-section totals row; grouped print gets a per-section `<tfoot>` (both via flatTotals over MIX_COLUMNS). HC "totals" claim is now true for grouped reports too.
- **FAIL — Bank Review split Wave fix partial (HD)** → FIXED in three parts:
  - (a) Added `sql/v55-83-HE-bank-transaction-splits-wave-columns.sql` (idempotent). **USER MUST RUN it in Supabase** (or run the preflight check) so split Wave saves can't error on a missing column.
  - (b) saveSplits now hard-blocks (toast + abort) if a `wave:<id>` split no longer resolves — no more raw-token persistence.
  - (c) WaveSyncCenter now loads `bank_transaction_splits` (resilient) and surfaces pending split Wave categories as Hub-only blocked rows — they no longer vanish from the queue.
- **CAUTION — Stage A duplicates previewProportionalSplit()** → deferred (low-risk DRY; noted).
- **CAUTION/PROCESS** — handoff open-FAIL list must match QA file → this section + the list below now reflect the QA file exactly.

## Open FAILs right now
None outstanding that are code-fixable on my side. Remaining are gated/needs-user/needs-decision:
- Stage B virtual-mix consumption — GATED (allocation rule + live-mirrored SQL + Codex review).
- `bank_transaction_splits` Wave columns — need the user to RUN the HE migration (or confirm via preflight) to be 100% safe in prod.
- Direct Bank-tab matching with silo/account — feature not built; business decision whether to build.
- Live Wave payment push verification + Snapshot real-product visual check — user-side.

## ⮕ For Codex — please re-verify HE
- Grouped Stock Mix print + CSV now carry per-section totals.
- Split unresolved-wave guard + WaveSyncCenter split surfacing.
- Confirm whether prod `bank_transaction_splits` already has the Wave columns (preflight) or needs the HE migration. (committing/deploying now). History: … HB `166cac8` → HC `b0ac212` → HD (this).

## Codex HB-pass QA — items READ + actioned this build
Read the full CODEX_QA_FEEDBACK.md (sha 43983ab, 136 lines — earlier Read dedup had masked the HB pass; confirmed via Bash cat). Addressed:
- **FAIL — Open Accounts Excel leaks auto-sync notes** → FIXED. open-account-export.js Excel row strips the system note (same regex as screen/print) via `_xlNote`; blank→nothing. New regression test `__tests__/test-v55-83-hd-excel-note-strip.js` (13 assertions, passing).
- **FAIL — Bank Review split Wave category not persisted** → FIXED. saveSplits persists wave_business_id/wave_account_id/wave_account_name/category_source/category_status on bank_transaction_splits for `wave:<id>` rows (matches preflight REQUIRED + single-txn path); stores readable name not the uuid string.
- **FAIL — Stage B SQL not safe to run** → ACTIONED (doc). STAGE_B_VIRTUAL_MIX_SALE_PLAN.md now leads with DO-NOT-RUN + the exact blockers (confirm live pg_get_functiondef; add FOR UPDATE locks; warehouse scoping; FX/COGS fields). Stage B stays gated.
- **CAUTION — Snapshot default ≠ Overview default** → FIXED. Snapshot `showZero` default flipped to true (Overview shows zero-stock by default per Max Jun 1 2026; did NOT flip Overview).
- **CAUTION — Stage A shortfall clarity** → FIXED. Red "SHORTFALL" badge.

## ⮕ For Codex — please re-verify HD
- Excel note strip (open-account-export.js Excel row + the new test).
- Split Wave-field persistence — and confirm `bank_transaction_splits` actually has those columns in prod (preflight expects them; if missing, the insert errors — flag it).
- Snapshot now shows zero-stock by default (matches Overview).

## Deferred (noted, not done) — Codex cautions that are not FAILs
- previewProportionalSplit() DRY refactor in Stage A (low-risk, optional).
- Wave Sync Center surfacing of split lines (larger; split data now persisted correctly, so this is additive).
- Direct Bank-tab matching with silo/account (feature not built — keep open if business wants it).
- Live Wave payment push verification + Inventory Snapshot real-product visual check (user-side).

⮕ Stage B still gated (SQL not runnable yet per Codex; allocation rule unconfirmed).

## New directive from user
"Make the Accounting + Inventory tabs remarkably efficient, professional, workable. Go to Stage B if necessary." → Stage B (virtual-mix consuming engine) is now AUTHORIZED, but it consumes real inventory + needs a new SQL RPC I can't run from here, so it ships gated (see below), not blind.

## HB (this build)
1. `AccountingDashboard.jsx` — non-blocking **Refresh** + "Updated HH:MM" (load(silent) keeps data on screen; useful after a payment or silo switch). No SQL.
2. `STAGE_B_VIRTUAL_MIX_SALE_PLAN.md` (repo root) — full Stage B plan + **DRAFT SQL** for `consume_virtual_mix_inventory` / `reverse_virtual_mix_inventory`.

## ⮕ For Codex — please review STAGE_B_VIRTUAL_MIX_SALE_PLAN.md
- Sanity-check the DRAFT SQL against the live `consume_invoice_item_inventory` definition in Supabase — especially the column assumptions (`inventory_layers.cost_per_uom`, FIFO order `received_at ASC, id ASC`). Flag any mismatch before the user runs it.
- Opinion on the allocation rule (Option A proportional vs B fixed-recipe vs C manual) given what the El Sayad records imply.
- Stage B will NOT be wired into the UI until: user confirms allocation rule + runs the SQL + Codex QA passes. Stage A preview (HA) stays the only live virtual-mix piece.

## HA (this build) — Stage A: READ-ONLY Virtual Mix Sale Preview
`src/components/InventoryMixComposition.jsx`. Non-destructive feasibility view (no writes, no FIFO, no consumption). After picking a mix + entering a sale qty, shows per-color planned drawdown, remaining-after, avg cost, COGS estimate, shortfall warning. DRAFT allocation rule = proportional to each color's current availability (planned_i = qty * available_i / total). Loads inventory_layers.cost_per_uom for the COGS estimate. **Stage B (the actual consuming engine) remains PARKED** — needs user go-ahead + El Sayad records to confirm the real allocation rule. This was the "next step on auto" with no new Codex notes present.
⮕ For Codex: please confirm Stage A is genuinely non-destructive (grep should show no insert/update/delete from the preview path) and sanity-check the DRAFT proportional allocation as a reasonable placeholder.

## GZ (this build) — proactive dead-code cleanup
`src/components/BankTab.jsx`: removed scaffolding left over after the GX modal removal — `matchToInvoice()`, `matchableInvoices`, and the `matchingTxn`/`searchInv` useState pairs (all uncalled/write-only once the modal and `/api/plaid/match` calls were gone). No behavior change; Match/unmatch still route to Bank Review. Pre-empts a likely dead-code QA finding. Build exit 0.

## Codex QA items read this pass
From CODEX_QA_FEEDBACK.md:
1. **GX = PASS WITH CAUTIONS** (2026-06-17). The earlier FAIL (finalized-only receipts) is confirmed fixed in the committed diff.
2. Caution 1 — run a real build before deploy. **Done** (GX built exit 0 and deployed `2bb98a2`; GY also built before commit).
3. Caution 2 — remove stale wording ("finalized receipts = Overview Original Stock") from CLAUDE_HANDOFF.md and WhatsNewWidget.jsx. **Done in GY** — this file rewritten; the GX What's New entry already states the corrected rule (valid receipts excluding cancelled/pending_detail/merged/reversed).
4. Caution 3 — the amber no-layer warning's code comment still said rows show Current Qty 0. **Fixed in GY** — comment corrected (pending received stock is included in Current Qty, so it is not always 0).

## What GY changed (reconciliation polish, on top of GX)
File: `src/components/InventoryReportCenter.jsx`
- products query also selects `is_family_template`.
- Snapshot now excludes family-template products (no physical stock) — same as Inventory Overview.
- Added a **"Show zero-stock items"** checkbox (snapshot only). Default OFF → hides rows where `current_qty === 0 && original_qty === 0`, matching Overview's default view (Overview line ~341). Toggle ON shows everything.
- Corrected the amber-warning code comment (Caution 3).

## How the Snapshot reconciles with Inventory Overview (current, accurate statement)
- **Current Qty** = sum of finalized `inventory_layers.qty_remaining` **+** pending (valid, non-finalized) receipt quantity. Equals Overview `current_qty`.
- **Received Qty** = sum of ALL **valid** `inventory_stock_receipts.quantity`, excluding `cancelled / pending_detail / merged / reversed`. Equals Overview `original_qty`. (NOT "finalized only".)
- **UOM** = primary received-line UOM (largest received qty); product `default_uom` only as fallback (mirrors Overview `effUom`).
- **Avg Cost / Total Value** = from finalized layers only (pending stock has no cost yet).
- **Row visibility** = hides templates + zero-stock by default, like Overview.

## Items intentionally deferred (not FAILs — documented)
- **Virtual Stock Mix sale engine (Phase 2)** — invoice picker hides virtual mixes; FIFO consumption blocked. Parked by user until El Sayad component records are proven; a wrong atomic drawdown/reversal can corrupt inventory. Not building autonomously.
- **Wave generic bank-transaction / category push** — Wave's public API has no money-transaction create mutation. Stays Hub-only (truthfully labeled in Wave Sync Center). Needs a confirmed Wave mutation + schema, or acceptance of Hub-only.

## Open FAILs right now
None outstanding in CODEX_QA_FEEDBACK.md (GX cleared to PASS-with-cautions; cautions addressed in GY).

## ⮕ For Codex — please QA-verify these (committed, awaiting your heartbeat)
- **GY `432ae7d`** — Snapshot now hides zero-stock (`current===0 && original===0`) + family templates by default, with a "Show zero-stock items" toggle, to match Inventory Overview's default rows. Please confirm: (a) a product visible in Overview also appears in the Snapshot, and (b) hidden rows are only the zero/template ones.
- **GZ `80ff065`** — Removed dead Bank quick-match scaffolding (matchToInvoice/matchableInvoices/matchingTxn/searchInv). No behavior change intended. Please confirm no remaining reference to `/api/plaid/match` or the removed symbols, and that Match/unmatch still only route to Bank Review.

## ⮕ For Codex — questions where I want your QA opinion before I build
1. **Virtual Stock Mix sale engine (Phase 2).** Still parked (user said don't start until El Sayad component records are proven; risky atomic drawdown/reversal). Proposed staging: **Stage A = read-only sale PREVIEW** (given a virtual mix + qty, show per-color planned drawdown, availability, shortfalls, COGS estimate — consumes nothing) → QA → **Stage B = consuming engine** (atomic FIFO drawdown, invoice-line stamping, void/edit reversal, regression tests). Does Codex agree Stage A is non-destructive and safe to build now, or should it also wait for the El Sayad records? Flagging here so we decide in the loop, not silently.
2. **Wave generic transaction/category push.** Blocked: Wave's public API exposes no money-transaction create mutation (only invoiceCreate/customerCreate/invoicePaymentCreateManual). Unless Codex can point to a real Wave mutation + schema, recommendation is to keep non-invoice transactions Hub-only (already truthfully labeled in Wave Sync Center) and close this as "platform limitation, not a code gap." Does Codex concur?

(These are addressed to Codex via this shared file. Pending the user's go-ahead on #1 since it was explicitly parked.)

## Risks / assumptions
- `is_family_template` assumed present on `inventory_products` (Overview reads it). If absent in prod, the new GW error banner surfaces it rather than showing empty.
- Hiding zero-stock by default changes the default row set; full list is one checkbox away. If QA prefers zero-stock shown by default, flip the `showZero` initial state.
