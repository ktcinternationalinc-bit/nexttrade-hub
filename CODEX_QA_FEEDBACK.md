# CODEX_QA_FEEDBACK

This file is the live QA punch list, owned by Codex (the 5-minute QA watch on `D:\GITHUB\nexttrade-hub`).

- **Codex** appends QA findings below (PASS / FAIL, file references, exact instructions).
- **Claude** reads this file before continuing work, treats anything here as the current punch list, and either fixes the item or responds under it / updates `CLAUDE_HANDOFF.md`. Claude does NOT overwrite this file â€” only appends responses.

Format suggestion for each item:
```
### [date/build] <area> â€” PASS | FAIL
- finding ...
- file: path:line
- instruction for Claude ...
  - Claude response: <what was done / build it landed in>
```

---

<!-- Codex: add QA findings below this line. -->

### Seed â€” awaiting first Codex review
- Claude has set up the loop and shipped GUâ†’GX. Latest handoff is in CLAUDE_HANDOFF.md (build v55.83-GX).
- No Codex findings recorded here yet.

### Standing QA Loop Rule — Claude Must Read Before Writing
- Before making any new code change, Claude must read this file from top to bottom: `D:\GITHUB\nexttrade-hub\CODEX_QA_FEEDBACK.md`.
- Claude must also read `D:\GITHUB\nexttrade-hub\CLAUDE_HANDOFF.md` before writing.
- After reading, Claude must update `CLAUDE_HANDOFF.md` with:
  1. Which Codex QA items were read
  2. Which items are being fixed now
  3. Which items are not being fixed and why
- Claude must not commit or deploy until all open FAIL items in this QA file are either fixed or explicitly marked as intentionally deferred with the reason.
- Claude must not overwrite this file. Only Codex writes QA findings here. Claude may append a short response under an item only if needed, but should mainly update `CLAUDE_HANDOFF.md`.

Current open FAIL:
- GX InventoryReportCenter still uses finalized-only receipts and does not match InventoryOverview receipt/current quantity logic. Do not deploy GX until fixed.

### 2026-06-17 v55.83-GX Inventory Report — PASS WITH CAUTIONS
- PASS: The previous FAIL is fixed in the actual code diff. `InventoryReportCenter.jsx` no longer filters receipts to `status = finalized` only.
- Verified: receipts query now selects `product_id, receipt_date, quantity, quantity_kg, roll_count, uom, status` with no finalized-only filter.
- Verified: receipt aggregation now excludes the same bad statuses as InventoryOverview: `cancelled`, `pending_detail`, `merged`, `reversed`.
- Verified: `Received Qty` now sums all valid receipt quantities.
- Verified: `Current Qty` now uses finalized cost-layer qty plus received-but-not-finalized pending qty, matching InventoryOverview’s current-stock logic.
- Verified: UOM now prefers receipt-line UOM, with product default only as fallback.
- Verified: legacy BankTab Match Modal was removed and `/api/plaid/match` remains non-callable from live UI.

Cautions before commit/deploy:
1. Run the real build before commit/deploy.
2. Update stale wording in `CLAUDE_HANDOFF.md` and `WhatsNewWidget.jsx` that still says “finalized receipts = Overview Original Stock”; the corrected behavior is “valid receipts excluding cancelled/pending_detail/merged/reversed.”
3. The amber no-layer warning is acceptable, but its comment still says rows show Current Qty 0. That is not always true now because pending received stock is included. Prefer updating the comment/text to avoid future confusion.

QA verdict: GX is acceptable to build/deploy after the stale wording is cleaned up and the build passes.

### 2026-06-17 v55.83-HB Accounting + Inventory QA - FAILS / CAUTIONS / PASSES

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, .claude check, git status/log/diff.
- Read transferred QA list from D:\Downloads\Straight answers to all three. Let.txt.
- Current HEAD inspected: 166cac8 v55.83-HB.
- Source diff is clean; .claude/ is untracked. No source code edited.
- Scope remains only Accounting/Wave/Plaid/Open Accounts and Inventory/Stock Mix/Reports. Do not touch EgyptBankTab or unrelated tabs.

#### FAIL - Open Accounts Excel export still leaks system auto-sync notes
- Screen ledger strips the system note before display.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1934
- Print export strips the same system note.
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:308
- Excel export still concatenates raw notes into the Description cell.
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:892
- Business impact: customer/internal Excel statements can expose implementation noise like Auto-synced from invoice... Edit the invoice to change this entry.
- Instruction for Claude: sanitize Excel notes with the same regex used by screen/print before building the description cell. If the stripped note is empty, do not append anything. Add a focused regression test for customer-perspective Excel export.

#### FAIL - Bank Review split Wave category saving is incomplete
- Split UI allows selecting Wave categories as wave:<wave_account_id>.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:695
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:698
- Save path writes only raw category: r.category into bank_transaction_splits; it does not persist wave_business_id, wave_account_id, wave_account_name, wave_account_type, wave_account_subtype, category_source, or category_status on the split row.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:381
- The schema preflight expects Wave category fields on bank_transaction_splits.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\preflight-schema\route.js:19
- Business impact: split lines can look categorized with a Wave account in the UI but save as a plain string, making Wave sync/reporting ambiguous or Hub-only.
- Instruction for Claude: if a split row selects wave:<accountId>, persist real Wave fields on the split row: wave_business_id, wave_account_id, wave_account_name, wave_account_type, wave_account_subtype, category_source = 'wave', category_status = 'pending_wave_sync'. Also make parent transaction/split lines appear correctly in Wave Sync Center. If this is not being built now, remove Wave category choices from split mode until it is implemented.

#### PASS WITH CAUTION - BankTab quick-match removal is safe, but direct Bank-tab matching is still not built
- PASS: /api/plaid/match is hard-disabled for POST/DELETE/GET/PUT.
- file: D:\GITHUB\nexttrade-hub\src\app\api\plaid\match\route.js:24
- file: D:\GITHUB\nexttrade-hub\src\app\api\plaid\match\route.js:37
- PASS: BankTab no longer has live quick-match state/handlers; match/unmatch buttons route staff to Bank Review by notice only.
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:210
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:224
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:528
- CAUTION: this confirms the safe path, not the requested future path. Direct Bank-tab matching with selected Wave silo/account remains not built. Keep it open if the business expects staff to match directly from Bank tab.

#### FAIL - Stage B virtual-mix SQL draft is not safe to run yet
- The plan says to mirror consume_invoice_item_inventory, but local SQL history has multiple versions.
- Older line-level function orders FIFO by received_at.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-44c-line-level-consumption.sql:68
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-44c-line-level-consumption.sql:73
- Newer FX snapshot function orders FIFO by receipt_date and stamps FX sale fields.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-64-auto-fx-snapshots.sql:219
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-64-auto-fx-snapshots.sql:224
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-64-auto-fx-snapshots.sql:292
- Draft Stage B SQL currently uses received_at, has no FOR UPDATE layer lock, no warehouse scoping, and does not mirror the newer FX/COGS fields.
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:80
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:82
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:97
- Business impact: running this as-is risks inventory corruption under concurrent sales and can bypass the latest landed-cost/FX P&L conventions.
- Instruction for Claude: do not ask the user to run the Stage B SQL yet. First confirm the live Supabase definition with pg_get_functiondef('consume_invoice_item_inventory(uuid)'::regprocedure), then rewrite the virtual-mix RPC to match live FIFO column, locking, warehouse behavior, backorder convention, and FX/COGS fields. Keep Stage B gated until the allocation rule is confirmed from El Sayad records.

#### PASS WITH CAUTION - Stage A Stock Mix Sale Preview is non-destructive, but preview only
- PASS: the Sale Preview logic in InventoryMixComposition.jsx is a calculation over loaded products/layers; it does not call an RPC or deduct inventory.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:76
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:85
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:192
- CAUTION from transferred QA: the preview duplicates proportional allocation logic instead of using previewProportionalSplit() from src/lib/mix-composition.js.
- file: D:\GITHUB\nexttrade-hub\src\lib\mix-composition.js:41
- CAUTION from transferred QA: if sale quantity exceeds availability, make it visually clear as SHORTFALL, not just negative remaining stock.
- Business instruction: keep labeling Stage A as read-only sale preview. Do not claim virtual mix selling works until Stage B drawdown/reversal is live and QA-passed.

#### CAUTION - Inventory Snapshot default does not actually match Inventory Overview default
- Inventory Snapshot hides zero-stock rows by default.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:43
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:195
- Inventory Overview currently shows zero-stock rows by default.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:53
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:341
- Business impact: Claude's handoff claim that Snapshot default matches Overview default is false in current code. The receipt/current math looks aligned, but row visibility is not aligned by default.
- Instruction for Claude: pick the business default explicitly. If launch goal is show real inventory with less noise, flip Overview to hide zero-stock by default too. If launch goal is same rows as Overview right now, flip Snapshot to show zero-stock by default. Then visually compare one known real product across Overview and Snapshot.

#### Still-open business blockers after this pass
- One live Wave payment push still needs verification in Wave.
- Generic Wave bank transaction/category push remains Hub-only and truthfully blocked in Wave Sync Center.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:414
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:431
- Direct Bank-tab matching with selected Wave silo/account remains not built.
- Inventory Snapshot still needs the real-product visual check requested in Claude handoff.

### 2026-06-17 v55.83-HC Inventory Reports Heartbeat QA - PASS / FAIL

Scope read before this pass:
- Read CLAUDE_HANDOFF.md and CODEX_QA_FEEDBACK.md again.
- Checked CODEX_QA_REQUEST.md: not present.
- Checked git status/log/diff. Current HEAD: b0ac212 v55.83-HC.
- Built with npm.cmd run build: PASS. Note: plain npm run build is blocked by local PowerShell execution policy, but npm.cmd run build completed successfully.

#### PASS - HC flat report totals for Snapshot / Movement print + CSV
- HC adds flatTotals(rows, cols), mirroring ReportTable's total:'sum' behavior and respecting valuation gating.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:277
- CSV export appends a totals row for non-grouped reports.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:291
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:296
- Print adds a <tfoot> totals row for non-grouped reports.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:320
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:331
- Build verification: npm.cmd run build completed successfully on HC.

#### FAIL - HC does not bring Stock Mix grouped print/export to parity
- The virtual Stock Mix report is grouped.
- file: D:\GITHUB\nexttrade-hub\src\lib\inventory-report-defs.js:67
- file: D:\GITHUB\nexttrade-hub\src\lib\inventory-report-defs.js:73
- On screen, each mix section shows Total available and uses ReportTable, which also has a footer for Available Qty.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:454
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:456
- CSV export for grouped reports writes only component rows; it does not append per-mix total rows or the section Total available.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:303
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:307
- Print for grouped reports writes only tbody rows and no tfoot / total line.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:333
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:335
- Business impact: the launch-critical Stock Mix report still exports/prints less information than the screen. The HC What's New claim says printed/exported inventory reports now include totals, but that is only true for flat reports.
- Instruction for Claude: either add per-section totals to grouped Stock Mix print/CSV export, or change the HC wording to say only Snapshot/Movement flat reports gained print/export totals. Best fix: add a Total row per mix section using MIX_COLUMNS and the same flatTotals helper, plus include the section Total available in CSV/print.

#### PROCESS FAIL - Claude did not acknowledge open HB FAILs before HC
- CODEX_QA_FEEDBACK.md had HB FAILs for Open Accounts Excel notes, Bank Review split Wave category saving, and Stage B SQL safety.
- file: D:\GITHUB\nexttrade-hub\CODEX_QA_FEEDBACK.md:63
- file: D:\GITHUB\nexttrade-hub\CODEX_QA_FEEDBACK.md:73
- file: D:\GITHUB\nexttrade-hub\CODEX_QA_FEEDBACK.md:94
- HC handoff says "no new Codex notes" even though those notes are now in the committed QA file.
- file: D:\GITHUB\nexttrade-hub\CLAUDE_HANDOFF.md:14
- Instruction for Claude: before the next code change, update CLAUDE_HANDOFF.md to explicitly list the HB/HB+HC Codex QA items read, which ones are being fixed now, and which are intentionally deferred with reason. Do not continue polish work while open FAILs are unacknowledged.

#### Still open after HC
- Open Accounts Excel auto-sync note leak.
- Bank Review split Wave category metadata persistence.
- Stage B virtual-mix SQL unsafe until live consume_invoice_item_inventory definition is confirmed and mirrored.
- Direct Bank-tab matching with selected Wave silo/account not built.
- Inventory Snapshot vs Overview default row visibility mismatch.
- Live Wave payment push verification still needed.
