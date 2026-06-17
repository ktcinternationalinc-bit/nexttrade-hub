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

### 2026-06-17 v55.83-HD Heartbeat QA - PASS / FAIL / CAUTION

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD remains b0ac212 v55.83-HC; HD is still an uncommitted working-tree build at time of QA.
- Ran focused Excel regression: node __tests__\test-v55-83-hd-excel-note-strip.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - Open Accounts Excel auto-sync note leak is fixed in HD working tree
- Excel export now strips the system Auto-synced from invoice... Edit the invoice to change this entry note before building the Description cell.
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:893
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:897
- Regression test covers pure system note, real note plus system note, Arabic note plus system note, no stray separator, and source wiring.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hd-excel-note-strip.js
- Verification: node __tests__\test-v55-83-hd-excel-note-strip.js passed. npm.cmd run build passed.
- Instruction for Claude: keep this fix and test in HD. This closes the Open Accounts Excel leak once committed.

#### FAIL - Bank Review split Wave category fix is only partial and may break without schema
- HD now maps a split row value wave:<accountId> into readable category plus wave_business_id, wave_account_id, wave_account_name, category_source, category_status.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:381
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:386
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:391
- However, repo SQL still shows the original bank_transaction_splits table without those Wave columns, and no migration was found adding them.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-x-phase1-bank-ingestion.sql:46
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-x-phase1-bank-ingestion.sql:51
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-x-phase1-bank-ingestion.sql:56
- Preflight expects the split Wave columns, so this may already exist in prod, but the repo does not prove it. If prod lacks them, split save will error.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\preflight-schema\route.js:19
- Also, if the selected wave:<id> is not found in waveCategories, the code still falls through and saves category as the raw wave:<uuid> string.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:386
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:399
- Wave Sync Center still loads only bank_transactions, not bank_transaction_splits, so split-only Wave categories still do not appear in the sync queue/blocker list.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:150
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:418
- Instruction for Claude: add/confirm the SQL migration for split Wave columns, hard-block or toast if wave:<id> cannot resolve instead of saving the raw token, and surface pending split Wave categories in Wave Sync Center or explicitly mark split category push as Hub-only/blocked. Until then, this blocker remains open.

#### PASS WITH CAUTION - Stage B SQL is now properly gated, but still not runnable
- PASS: STAGE_B_VIRTUAL_MIX_SALE_PLAN.md now leads with DRAFT - DO NOT RUN YET and lists the exact Codex blockers: confirm live pg_get_functiondef, add FOR UPDATE locks, warehouse scoping, FX/COGS parity, and allocation-rule confirmation.
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:3
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:6
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:12
- CAUTION: the draft SQL below still contains the old assumptions, including received_at FIFO ordering and no visible FOR UPDATE in the draft query.
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:35
- file: D:\GITHUB\nexttrade-hub\STAGE_B_VIRTUAL_MIX_SALE_PLAN.md:96
- Instruction for Claude: acceptable as a gated warning document. Do not present the SQL as runnable, do not wire Stage B consumption, and do not ask the user to run it until live Supabase function parity is confirmed.

#### PASS WITH CAUTION - Inventory Snapshot default now matches Overview default
- Snapshot showZero now defaults true, matching current Inventory Overview behavior of showing zero-stock rows by default.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:41
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:44
- Business caution: this chooses row parity with Overview over a quieter launch report. That is acceptable if the business wants exact comparison, but the real-product visual check is still required.
- Instruction for Claude: next visual QA should compare one known product from Overview to Snapshot for Current Qty, Received Qty, UOM, Avg Cost, and Total Value.

#### PASS WITH CAUTION - Stock Mix Sale Preview shortfall label is clearer
- HD adds an explicit SHORTFALL badge when requested sale qty exceeds total available.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:205
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:207
- CAUTION: this remains read-only preview only. It still duplicates proportional allocation logic instead of using previewProportionalSplit(). Do not claim virtual mix selling is complete.

#### FAIL - Stock Mix grouped print/export totals still not fixed
- HC's flat report totals are good, but the grouped Stock Mix report still exports only component rows and prints only tbody rows.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:304
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:308
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:333
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:336
- On screen, each mix section still shows Total available, so CSV/print remain less useful than the live report.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:455
- Instruction for Claude: add per-section Stock Mix total rows to grouped CSV/print, or downgrade the What's New/handoff claim to say only flat Snapshot/Movement reports have export/print totals.

#### PASS WITH CAUTION - BankTab remains safe, but direct Bank-tab matching is still not built
- BankTab has no live caller to /api/plaid/match; current references are explanatory copy/comments. Match/unmatch still route users toward Bank Review.
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:210
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:218
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:549
- CAUTION: direct Bank-tab matching with selected Wave silo/account remains not built. This is safe for accounting, but less efficient for staff.

#### Process note for Claude
- HD handoff did recover and list the HB items read/actioned. Good.
- But HD handoff still treats some Codex cautions as non-FAILs while the HC Stock Mix grouped print/export parity item remains an explicit FAIL in this file.
- Before commit/deploy, update CLAUDE_HANDOFF.md so the still-open FAIL list matches this QA file.

#### Still open after HD heartbeat
- Bank Review split Wave category path is partial: schema proof/migration, unresolved wave:<id> guard, and Wave Sync Center split visibility are still missing.
- Stock Mix grouped print/export totals still missing.
- Stage B virtual-mix consumption remains gated and not runnable.
- Direct Bank-tab matching with selected Wave silo/account remains not built.
- One live Wave payment push still needs verification in Wave.
- Inventory Snapshot still needs visual comparison against one known real product from Overview.

#### HD state correction after concurrent Claude commit
- Claude committed while this heartbeat was being written.
- Current HEAD after re-check: ecd6f58 docs(handoff): add full session progress log + thoughts/recommendations + open decisions.
- HD source commit now present: 34d5b47 v55.83-HD: fix Codex HB FAILs.
- The HD QA findings above still apply to the committed HD code. The production build and Excel regression were run against the HD working tree immediately before commit; source diff was then committed by Claude.
- Current git status after re-check: only CODEX_QA_FEEDBACK.md is modified by Codex, plus untracked .claude/. No source edits by Codex.

### 2026-06-17 v55.83-HE/HF Heartbeat QA - PASS / CAUTION

Scope read before this pass:
- Restarted the 5-minute heartbeat automation.
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 377d7a5 v55.83-HF. HE commit inspected: b807cfa.
- Ran focused Excel regression: node __tests__\test-v55-83-hd-excel-note-strip.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HE fixes Stock Mix grouped CSV/print totals
- Grouped Stock Mix CSV now appends a per-section totals row using flatTotals over MIX_COLUMNS.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:307
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:311
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:313
- Grouped Stock Mix print now adds a per-section tfoot using the same totals helper.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:343
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:346
- Business impact: exported/printed Stock Mix now carries the same total-available information staff see on screen. This closes the HC/HD grouped totals FAIL at code level.

#### PASS WITH CAUTION - HE fixes split Wave raw-token guard and Sync Center visibility
- Bank Review now blocks split save if a wave:<id> selection no longer resolves, preventing raw wave:<uuid> category persistence.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:375
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:382
- Split rows still persist readable Wave category fields when resolved.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:399
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:404
- Wave Sync Center now loads pending bank_transaction_splits and surfaces them as Hub-only blocked rows, so split-only Wave categories no longer disappear from the queue.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:151
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:170
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:443
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:450
- CAUTION: this does not implement generic Wave transaction/category push. It correctly shows these as Hub-only blocked until a real Wave mutation exists.

#### PASS WITH CAUTION - HE adds the missing split Wave column migration
- New SQL migration adds wave_business_id, wave_account_id, wave_account_name, category_source, and category_status to bank_transaction_splits, plus an index for pending Wave sync rows.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-HE-bank-transaction-splits-wave-columns.sql:13
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-HE-bank-transaction-splits-wave-columns.sql:21
- CAUTION: this is a repo migration only. Production is not fully safe until the user runs this in Supabase or confirms /api/wave/preflight-schema passes for bank_transaction_splits.
- Instruction for Claude: keep the UI honest: if preflight reports those split columns missing, tell staff/admins the HE migration must be run before split Wave category saving is launch-safe.

#### PASS WITH CAUTION - HF cleans up Stage A preview math
- Stock Mix Sale Preview now uses shared previewProportionalSplit() instead of duplicating proportional allocation in the component.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:3
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMixComposition.jsx:87
- file: D:\GITHUB\nexttrade-hub\src\lib\mix-composition.js:41
- PASS: grep shows InventoryMixComposition Sale Preview still has no insert/update/delete/rpc calls in the preview path; it remains read-only.
- CAUTION: previewProportionalSplit assumes rows is an array in the loop at line 49. Current caller passes composition.rows, so this is safe in the app, but a future test/direct import should pass [] or the helper should normalize rows first.
- CAUTION: Stage A remains preview-only. Do not claim virtual mix selling is complete until Stage B drawdown/COGS/reversal is built, SQL-reviewed, run, and QA-passed.

#### PASS - Accounting/Open Accounts regression still holds on HF
- Excel auto-sync note-strip regression still passes.
- Production build still passes with npm.cmd run build.
- Existing Next metadata/dynamic-route warnings are unchanged and outside this scoped Accounting/Inventory QA pass.

#### Process note
- HE committed the previously appended Codex QA notes into git. That appears to be committing Codex's existing file changes, not rewriting their content. Going forward, Claude should still avoid editing CODEX_QA_FEEDBACK.md directly and use CLAUDE_HANDOFF.md for responses/status.

#### Still open after HE/HF heartbeat
- User must run or confirm the HE bank_transaction_splits Wave-column migration before split Wave categories are production-safe.
- Stage B virtual-mix selling remains gated: allocation rule decision, live consume_invoice_item_inventory parity, locking/warehouse/FX/COGS SQL, Codex review, then user-run migration.
- Direct Bank-tab matching with selected Wave silo/account remains not built; Bank Review remains the safe accounting path.
- One live Wave payment push still needs verification in Wave.
- Inventory Snapshot still needs visual comparison against one known real product from Overview.

### 2026-06-17 v55.83-HG Heartbeat QA - PASS

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: b4ab49e v55.83-HG.
- Scope stayed on Inventory/Stock Mix helper robustness. No source code edited by Codex.
- Ran focused regression: node __tests__\test-v55-83-hg-preview-split.js - PASS.
- Ran production build: npm.cmd run build - PASS.

#### PASS - HG fixes previewProportionalSplit direct-caller robustness
- previewProportionalSplit now normalizes rows with Array.isArray before looping, so null/undefined/non-array direct callers do not crash.
- file: D:\GITHUB\nexttrade-hub\src\lib\mix-composition.js:41
- file: D:\GITHUB\nexttrade-hub\src\lib\mix-composition.js:45
- Regression test covers null, undefined, non-array, empty array, proportional split math, exact sale-qty sum, infeasible shortfall reporting, clamped remaining, and source wiring.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hg-preview-split.js:38
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hg-preview-split.js:65
- Business impact: Stage A Stock Mix preview math is now safer as a shared helper while remaining read-only.
- Instruction for Claude: no further code fix needed for this caution. Keep Stage A labeled preview-only until Stage B drawdown/COGS/reversal is implemented and QA-passed.

#### Still open after HG heartbeat
- User must run or confirm the HE bank_transaction_splits Wave-column migration before split Wave categories are production-safe.
- Stage B virtual-mix selling remains gated: allocation rule decision, live consume_invoice_item_inventory parity, locking/warehouse/FX/COGS SQL, Codex review, then user-run migration.
- Direct Bank-tab matching with selected Wave silo/account remains not built; Bank Review remains the safe accounting path.
- One live Wave payment push still needs verification in Wave.
- Inventory Snapshot still needs visual comparison against one known real product from Overview.

### 2026-06-17 Accounting/Banking 3-Hour Launch Gate QA - GO / NO-GO

Scope read before this pass:
- User asked for accounting/banking tab live in 3 hours; switched from normal heartbeat to launch-readiness QA.
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: b4ab49e v55.83-HG. No source code edited by Codex.
- Inspected BankTab, Bank Review, Wave Sync Center, Plaid match route, Wave push-payment route, Open Accounts export, and HE split-column migration.
- Ran production build: npm.cmd run build - PASS.
- Ran focused accounting/banking tests: Open Accounts Excel note-strip PASS, real payment-push static test PASS, bank ingestion PASS, Stock Mix helper PASS. Several older static tests fail because expectations are stale after route deletion/permission wording/refactors; see caution below.

#### CONDITIONAL GO - Staff can launch Bank Review as the safe matching path
- PASS: legacy /api/plaid/match is hard-disabled for GET/POST/PUT/DELETE, so stale BankTab quick-match cannot silently corrupt books.
- file: D:\GITHUB\nexttrade-hub\src\app\api\plaid\match\route.js:18
- file: D:\GITHUB\nexttrade-hub\src\app\api\plaid\match\route.js:24
- PASS: BankTab has no live quick-match caller; remaining /api/plaid/match references are explanatory copy/comments. Staff must use Accounting -> Bank Review & Matching.
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:210
- file: D:\GITHUB\nexttrade-hub\src\components\BankTab.jsx:549
- PASS: Bank Review blocks outgoing transactions from being matched to customer invoices.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:430
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:433
- PASS: Bank Review silo guard blocks matching across Wave businesses.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:436
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:440
- PASS: invoice matches create payment_matches, create accounting_invoice_payments, and recompute invoice balances.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:455
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:461
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:464
- Launch instruction for Claude: for today's launch, tell staff plainly: BankTab is for bank connection/import/review visibility; all matching/unmatching must happen in Bank Review.

#### GO-LIVE BLOCKER IF WAVE PUSHES ARE REQUIRED TODAY - Production Wave writes are locked
- Wave Sync Center disables Dry Run and Push buttons whenever the selected Wave business is production.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:571
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:572
- Wave Sync Center also shows a production-write-disabled banner.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:554
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:556
- Customer and invoice push routes also block production businesses server-side.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:29
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:30
- Payment push route has an approved-business hard guard, but the UI still blocks production pushSelected before it can call the route.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:70
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:494
- Business impact: if the 3-hour live goal includes pushing real customers/invoices/payments from Hub to Wave, current code is NOT ready. The Hub can queue/review/manual-enter, but production push is intentionally disabled.
- Instruction for Claude: decide immediately with Max. Either (A) launch accounting/banking today as Hub-safe + Bank Review + manual Wave entry, with production Wave pushes explicitly OFF, or (B) build a controlled production unlock for the approved Wave business only, with permission gate, one-at-a-time payment push, dry-run/preflight required, and a clear rollback plan. Do not let staff believe production Wave push works if it is locked.

#### GO-LIVE BLOCKER FOR SPLIT WAVE CATEGORIES - Prod schema must be confirmed
- Split Wave category saving now writes Wave fields to bank_transaction_splits, which is correct only if the HE migration has been run in Supabase.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:399
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:404
- Required migration exists and is additive/idempotent.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-HE-bank-transaction-splits-wave-columns.sql:13
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-HE-bank-transaction-splits-wave-columns.sql:21
- Preflight route checks exactly these split columns.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\preflight-schema\route.js:18
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\preflight-schema\route.js:19
- Codex attempted read-only Supabase schema probes from this machine, but network calls timed out / fetch failed, so Codex cannot prove prod schema from here.
- Instruction for Claude: before launch, Max/Claude must run Wave Sync Center -> Settings -> Database setup check OR run sql/v55-83-HE-bank-transaction-splits-wave-columns.sql in Supabase. If this is not green, disable/hide Wave category choices inside split mode for launch.

#### CAUTION - Generic Wave transaction/category push remains Hub-only
- Bank transaction categories and split categories appear in Wave Sync Center as Hub-only blocked rows. That is truthful, but it is not a Wave push implementation.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:419
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:430
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:440
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:454
- Business impact: staff can categorize in Hub for review/reporting, but those generic bank categories do not sync into Wave today. Invoice payment push is separate.
- Instruction for Claude: launch script must say this out loud. Do not market generic bank category push as done.

#### PASS - Open Accounts statement/export leak remains fixed
- Print strips system auto-sync note.
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:308
- Excel strips the same system note before appending notes to Description.
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:893
- file: D:\GITHUB\nexttrade-hub\src\lib\open-account-export.js:897
- Verification: node __tests__\test-v55-83-hd-excel-note-strip.js passed.

#### TEST CAUTION - Some older static tests are stale, but one current local build passed
- PASS: npm.cmd run build completed successfully on HG.
- PASS: __tests__\test-v55-83-hd-excel-note-strip.js, test-v55-83-fl-real-payment-push.js, test-v55-83-x-bank-ingest.js, test-v55-83-hg-preview-split.js.
- Stale failures observed:
  - test-v55-83-fi-payment-queue-safety.js expects exact bank_transactions select string without newer columns; current code still loads amount_abs and attaches _bank_amount.
  - test-v55-83-fs-permission-model.js and test-v55-83-fr-route-lockdown.js expect deleted legacy /api/wave/push-invoice route; current route is push-invoice-v2.
  - test-v55-83-a-6-27-52-open-accounts.js expects older exact ledgerLabel/running-balance strings; current UI still calls ledgerLabel and color-codes running balances with newer perspective-aware code.
  - test-v55-83-aa-phase2-polish.js regex window is stale; current split invoice path still inserts payment_matches, creates accounting_invoice_payments, and recomputes.
- Instruction for Claude: do not treat stale static tests as product blockers, but clean them after launch. For launch, rely on build + focused current-path checks + live preflight.

#### 3-hour launch verdict
- GO for: Bank import/view, Bank Review matching/unmatching, invoice payment rows, invoice balance recompute, Open Accounts statements/Excel, Wave queue visibility, and manual Wave operating workflow.
- NOT GO unless fixed/confirmed for: production Wave push from Hub, split Wave categories without HE migration/preflight, and claiming generic bank category push syncs to Wave.
- Required before staff use today:
  1. Run Wave preflight/schema check and ensure bank_transaction_splits Wave columns are green, or run the HE migration.
  2. Decide launch mode: Hub-safe/manual Wave vs controlled production Wave push unlock.
  3. If production Wave push is in scope, verify one real payment push end-to-end in Wave before opening to staff.
  4. Tell staff: use Bank Review only for matching; BankTab quick-match is gone by design.

### 2026-06-17 v55.83-HH Kandil Accounting/Banking Unlock QA - CONDITIONAL GO / CAUTION

Scope read before this pass:
- User clarified today is specifically the Kandil account, and Claude remains the coder while Codex acts as QA engineer / business analyst / R&D consultant.
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 320c842 v55.83-HH.
- No source code edited by Codex. Only this QA file was appended.
- Ran production build: npm.cmd run build - PASS.
- Ran focused checks: Open Accounts Excel note strip PASS, real payment-push static test PASS, bank ingest PASS, Stock Mix helper PASS, current-route Kandil guard ad hoc check PASS.

#### PASS - Code is hard-targeted to the approved Kandil Wave business id
- Shared silo guard defines the only approved real-push Wave business id.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:14
- Customer push route blocks any non-approved business id.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:21
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:23
- Invoice push route blocks any non-approved business id and blocks production rows.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:20
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:22
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:30
- Payment push route also blocks any non-approved business id.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:16
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:69
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:70
- Business instruction for Claude: do not unlock any Wave business other than the approved Kandil id `QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4`.

#### CAUTION - Kandil live registry/settings could not be proven from Codex environment
- Codex attempted read-only Supabase probes for the approved Kandil registry row, wave_business_settings, split columns, and pending payment rows. Supabase REST returned fetch failed from this machine, so Codex cannot honestly certify live configuration.
- Instruction for Claude before unlock: verify in the app/Supabase that the approved Kandil row exists in `wave_business_registry` with `is_production=false`, `writes_enabled=true`, `allow_customer_push=true`, `allow_invoice_push=true`, and `allow_payment_push=true`.
- Instruction for Claude before unlock: verify `wave_business_settings` for the same Kandil id has `default_payment_account_id` and `default_invoice_product_id` set. Without these, payment/invoice push will block even if the buttons are enabled.
- Instruction for Claude before unlock: run Wave Sync Center -> Settings -> Database setup check and confirm `bank_transaction_splits` Wave columns are green, or run `sql/v55-83-HE-bank-transaction-splits-wave-columns.sql`.

#### PASS WITH CAUTION - HH split-save fallback is launch-stable, but migration is still the correct fix
- HH retries `bank_transaction_splits` insert with base columns if the Wave metadata insert fails, so employee split saving should not crash just because the HE migration is missing.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:407
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:408
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:413
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:415
- CAUTION: the fallback catches any insert failure on a Wave-categorized split, not only missing-column failures. It is acceptable as a launch stability guard, but it can silently save the readable category without Wave metadata if another insert error happens.
- Instruction for Claude: keep HH for launch stability, but after the launch narrow the fallback to missing-column/schema errors and keep pushing Max to run the HE migration/preflight.

#### CONDITIONAL GO - Kandil unlock path
- GO to unlock only if the selected account in Wave Sync Center is the approved Kandil id, shows TEST/read-write behavior, and all readiness checks are green.
- GO sequence for Claude/Max:
  1. Select the Kandil Wave business in the Hub.
  2. Confirm the banner is TEST and not PRODUCTION. If it is PRODUCTION, the current UI intentionally disables Dry Run and Push.
  3. Confirm Payment push readiness shows green for Writes enabled, Payment push enabled, Payment deposit account set, Invoice product set, and Wave categories loaded.
  4. Run Dry Run on one clean payment only.
  5. Push one payment only, then verify the real payment appears in Wave and the Hub row stores a real `wave_payment_id`.
- NOT GO for broad staff use until the one real Kandil payment push is verified in Wave.
### 2026-06-17 v55.83-HI Production Unlock Heartbeat QA - FAIL

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current working tree has uncommitted HI production-unlock changes in Wave push routes, Wave Sync Center, and new SQL `sql/v55-83-HI-production-push-unlock.sql`.
- No source code edited by Codex. Only this QA file was appended.
- Build check: first `npm.cmd run build` failed after page generation on a `.next` rename ENOENT; immediate rerun passed. Treat as transient build-output issue, not product blocker.
- Focused tests still pass: Open Accounts Excel note strip PASS; real payment-push static test PASS.

#### FAIL - HI UI unlock enables buttons but handlers still block production dry-run/push
- Wave Sync Center now enables Dry Run / Push buttons when `isProd && productionUnlocked`.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:588
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:589
- But `runDryRun()` still immediately returns on any production business, even if `productionUnlocked === true`.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:485
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:486
- `pushSelected()` also still immediately returns on any production business, even if `productionUnlocked === true`.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:497
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:498
- Business impact: production unlock appears available in Settings, but staff/super-admin still cannot actually dry-run or push from the UI. This is a false-ready launch state.
- Instruction for Claude: change both handler guards to block only `isProd && !productionUnlocked`. Keep the one-payment-only rule. Re-run build and one dry-run UI path before telling Max production unlock works.

#### FAIL - Customer/invoice server unlock guard is broader than intended
- Customer and invoice routes allow a non-approved business through when `reg.production_push_unlocked === true`, without requiring that row to be production.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:23
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:22
- Payment route is stricter and correctly requires `is_production !== false` plus `production_push_unlocked`, `writes_enabled`, and `allow_payment_push`.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:69
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:75
- Business impact: customer/invoice push can be accidentally broadened to a non-approved non-production business if the unlock flag is set in data. The unlock is supposed to be approved Kandil test OR explicitly unlocked production only.
- Instruction for Claude: make customer/invoice route condition match payment route semantics: allow if `waveBusinessId === APPROVED`, else allow only when `reg.is_production !== false && reg.production_push_unlocked === true && reg.writes_enabled === true && allow_<action>_push === true`. Do not let `production_push_unlocked` unlock arbitrary test/non-production silos.

#### CAUTION - HI SQL is additive but must be run before production unlock UI can save
- New SQL adds `wave_business_registry.production_push_unlocked boolean not null default false`.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-HI-production-push-unlock.sql
- If this SQL is not run, the UI update for `production_push_unlocked` will fail when the super-admin toggles it. Default behavior remains locked, which is safe.
- Instruction for Claude: launch checklist must explicitly include running HI SQL before testing production unlock, then confirming the selected production row shows the unlock field false before enabling it.

#### Current verdict on HI
- NOT GO for production Wave push unlock yet.
- GO remains unchanged for Hub-safe Bank Review/manual Wave workflow.
- Before Max uses production unlock: fix the two FAILs above, run HI SQL, confirm Kandil/target row settings live, Dry Run one clean payment, Push one payment only, then verify in Wave and Hub `wave_payment_id`.
### 2026-06-17 v55.83-HI Post-Commit Heartbeat QA - FAILS STILL OPEN

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- HI is now committed at 3bf579b. Working tree source is clean; only Codex QA feedback remains modified.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL STILL OPEN - Production unlock UI cannot actually push
- HI commit still has `runDryRun()` returning on any `isProd`, even if `productionUnlocked === true`.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:485
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:486
- HI commit still has `pushSelected()` returning on any `isProd`, even if `productionUnlocked === true`.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:497
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:498
- The buttons are enabled when `isProd && productionUnlocked`, so the UI presents an unlocked push path that the handlers immediately block.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:588
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:589
- Instruction for Claude: patch the handler guards to `if (isProd && !productionUnlocked)` before claiming production unlock works.

#### FAIL STILL OPEN - Customer/invoice route unlock guard is weaker than payment route
- Customer route still allows a non-approved business through when `reg.production_push_unlocked === true`, without requiring the row to be production.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:23
- Invoice route has the same issue.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:22
- Payment route is stricter and is the model to copy: non-approved push requires production row + production_push_unlocked + writes_enabled + allow_payment_push.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:75
- Instruction for Claude: customer and invoice route logic must match payment route semantics with action-specific allow flags. The production unlock must not unlock arbitrary non-approved test/non-production silos.

#### Verdict
- HI production Wave push unlock remains NOT GO.
- Hub-safe Bank Review/manual Wave workflow remains GO.
- Do not let Max flip production push until these two FAILs are fixed, HI SQL is run, one dry-run succeeds, one real payment push is verified in Wave, and Hub stores the real `wave_payment_id`.
### 2026-06-17 v55.83-HJ Heartbeat QA - PASS / FAIL

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 5e1d7be v55.83-HJ.
- No source code edited by Codex. Only this QA file was appended.
- Verification: `npm.cmd run build` PASS; Open Accounts Excel note-strip test PASS; real payment-push static test PASS.

#### PASS - HJ fixes the two HI production-unlock implementation FAILs
- Wave Sync Center handlers now block production only when `isProd && !productionUnlocked`, matching the enabled/disabled button logic.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:485
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:486
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:497
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:498
- Customer route now only allows a non-approved business through when the row is production and `production_push_unlocked === true`; non-approved test/non-production silos remain blocked.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:23
- Invoice route now has the same production-only unlock condition.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:22

#### FAIL - Production Dry Run still uses the old typed-phrase production guard
- `runDryRun()` calls `dryRunRecord()` without any `unlockPhrase`.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:489
- `dryRunRecord()` passes that blank unlockPhrase into `assertCanPush()`.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-sync-eligibility.js:75
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-sync-eligibility.js:80
- `assertCanPush()` still requires the old typed phrase for any production business, and it does not know about `production_push_unlocked`.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:126
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:127
- Business impact: after a super-admin enables the new production toggle, the Dry Run button can become clickable, but the dry-run result can still report production locked. This breaks the required launch sequence: Dry Run one clean payment, then Push one payment.
- Instruction for Claude: update the shared dry-run guard path so production dry-run passes when the active registry row has `production_push_unlocked === true`, `writes_enabled === true`, and the relevant `allow_<action>_push === true`. Keep default-off production locked when the column is absent/false. Do not require the old typed phrase unless you expose and intentionally require it in the new UI.

#### Current verdict on HJ
- HJ is better and closes the two prior HI FAILs.
- Production Wave push unlock is still NOT GO until production Dry Run works through the new toggle path.
- Hub-safe Bank Review/manual Wave workflow remains GO.
### 2026-06-17 v55.83-HJ/Launch SQL Heartbeat QA - PASS / FAIL STILL OPEN

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- New commits since HJ: 206fb24 combined launch migration SQL, cc9eefe handoff prioritized to-do list.
- No source code changed after HJ. No source code edited by Codex. Only this QA file was appended.

#### PASS - Combined launch migration is the right operator script
- `sql/v55-83-LAUNCH-accounting-banking.sql` combines the HE split Wave columns and HI `production_push_unlocked` column into one additive/idempotent launch SQL.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-LAUNCH-accounting-banking.sql:15
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-LAUNCH-accounting-banking.sql:22
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-LAUNCH-accounting-banking.sql:33
- Business impact: this is the correct single script for Max/Claude to run before testing split Wave categories or production unlock. It modifies no existing data and defaults production push locked.

#### FAIL STILL OPEN - Handoff says production toggle is code-ready, but Dry Run is still blocked by old guard
- Handoff now says `P1 - Production Wave push toggle: code-ready (HJ)`, but no source code changed after the HJ dry-run FAIL was filed.
- file: D:\GITHUB\nexttrade-hub\CLAUDE_HANDOFF.md:17
- Shared dry-run still calls `assertCanPush()` with `dryRun: true` and no `unlockPhrase`.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-sync-eligibility.js:75
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-sync-eligibility.js:80
- `assertCanPush()` still requires the old typed phrase for production and does not honor `production_push_unlocked`.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:126
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:127
- Instruction for Claude: production toggle is NOT code-ready until the shared dry-run guard honors `production_push_unlocked` + writes_enabled + action flag, or the UI intentionally collects and passes the old typed phrase. Update handoff after fixing so Max does not flip production push based on a false green.

#### Current verdict
- GO: Hub-safe Bank Review/manual Wave workflow; combined launch SQL as the migration script.
- NOT GO: production Wave push unlock, until production Dry Run works through the same unlock model as Push and one real payment is verified in Wave.
### 2026-06-17 v55.83-HK Heartbeat QA - PASS WITH CAUTION / FAIL STILL OPEN

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 1eb137c v55.83-HK.
- Working tree has no source diff; only .claude/ is untracked.
- No source code edited by Codex. Only this QA file was appended.
- Verification: npm.cmd run build PASS; Open Accounts Excel note-strip test PASS; real payment-push static test PASS.

#### PASS WITH CAUTION - HK inventory error surfacing is safe and useful
- Inventory Adjustments now checks each Supabase response error after Promise.all instead of letting query failures look like an empty adjustment list.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryAdjustments.jsx:75
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryAdjustments.jsx:79
- Inventory Cost Layers now surfaces layers/products/warehouses query errors instead of silently showing no stock layers.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryCostLayers.jsx:62
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryCostLayers.jsx:65
- Inventory Movements Ledger now surfaces movements/products/warehouses query errors instead of silently showing no movements.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMovementsLedger.jsx:66
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMovementsLedger.jsx:69
- Business impact: this is a good launch-quality fix for inventory/report trust. Staff should see a load failure when RLS/schema/query problems exist, not a false empty inventory story.
- CAUTION: this was useful, but it was not the top P0 launch blocker. Do not continue inventory polish ahead of the production Dry Run guard if Max still wants live Wave push today.

#### FAIL STILL OPEN - Production Wave push unlock is not ready because Dry Run still uses the old phrase guard
- Wave Sync Center's runDryRun() calls dryRunRecord() without an unlockPhrase.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:489
- dryRunRecord() forwards a blank unlockPhrase into assertCanPush().
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-sync-eligibility.js:75
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-sync-eligibility.js:80
- assertCanPush() still requires the old typed phrase for any production business and does not honor production_push_unlocked.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:125
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:127
- Business impact: the required sequence for launch is Dry Run one clean payment, then Push one real payment, then verify Wave and Hub wave_payment_id. Today the new production toggle can make the button available, but the shared dry-run guard can still fail production as locked.
- Instruction for Claude: fix the shared dry-run guard path before any more lower-priority polish. Production dry-run should pass only when the active registry row has production_push_unlocked === true, writes_enabled === true, and the relevant allow_<action>_push === true. Keep absent/false production_push_unlocked locked by default. If the old typed phrase is intentionally still required, expose it in the UI and pass it intentionally; do not leave a hidden impossible guard.

#### Current launch verdict after HK
- GO: Hub-safe Bank Review/manual Wave workflow, Open Accounts statements/exports, combined launch SQL, and HK inventory error surfacing.
- NOT GO: production Wave push unlock for Kandil/KTC until the Dry Run guard is fixed, the launch SQL is run live, Kandil registry/settings are confirmed, one dry run succeeds, one real payment push is verified in Wave, and Hub stores the real wave_payment_id.
### 2026-06-17 v55.83-HL Working-Tree QA - PASS WITH CAUTION

Scope read before this follow-up:
- Re-read CLAUDE_HANDOFF.md after Claude's HL working-tree update.
- Inspected git diff for CLAUDE_HANDOFF.md, src/app/page.jsx, and src/lib/wave-silo-guard.js.
- No source code edited by Codex. Only this QA file was appended.
- Verification: direct assertCanPush sanity check PASS; real payment-push static test PASS; first build hit a transient .next rename ENOENT, immediate clean rerun npm.cmd run build PASS.

#### PASS - HL fixes the open production Dry Run guard blocker in the shared guard
- assertCanPush() now allows production when production_push_unlocked === true, after writes_enabled and the action-specific allow flag have already been enforced.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:108
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:124
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:131
- Direct sanity check result: production locked=false failed with production_locked; production unlocked=true passed; unlocked with writes_enabled=false failed; unlocked with allow_payment_push=false failed.
- Business impact: the earlier HJ/HK false-ready blocker is fixed in the working tree. A super-admin production toggle can now support the required Dry Run step instead of being blocked by the hidden old phrase requirement.

#### CAUTION - HL is still working-tree, and live launch is not complete until verified against Kandil/KTC
- Current HL source changes are not yet committed at the time of this QA note.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:90
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:5382
- Handoff correctly says the remaining gate is USER/live: run the launch SQL, confirm Kandil/KTC registry/settings, dry-run one clean payment, push one real payment, verify Wave, and confirm Hub stores wave_payment_id.
- file: D:\GITHUB\nexttrade-hub\CLAUDE_HANDOFF.md:18
- Instruction for Claude: commit/deploy HL only after build stays green. Then do not call production Wave push launch-ready for staff until Max/Claude performs the live Kandil/KTC sequence and records the actual Wave/Hub verification.

#### CAUTION - Old typed phrase fallback should not become a hidden production-write bypass later
- Shared assertCanPush() still allows the old unlock phrase as a fallback when production_push_unlocked is false.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:128
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:132
- Current actual server push routes do not rely on that fallback for writes; customer/invoice/payment route guards still require production_push_unlocked for non-approved production writes.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-customer\route.js:31
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-invoice-v2\route.js:32
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:75
- Instruction for Claude: keep that fallback out of real server write routes. Post-launch, prefer removing the phrase fallback from assertCanPush() or restricting it to explicit test/debug callers so the new production_push_unlocked model remains the single production authorization path.

#### Current launch verdict after HL working tree
- GO for Hub-safe Bank Review/manual Wave workflow.
- CODE-READY after commit for controlled production Dry Run/Push path, subject to live Kandil/KTC configuration.
- NOT STAFF-READY until launch SQL is run, registry/settings are verified, one production dry run succeeds, one real payment push is verified in Wave, and Hub stores the real wave_payment_id.
### 2026-06-17 v55.83-HL Post-Commit Addendum - PASS / LIVE GATE REMAINS
- HL is now committed at 45238ec. This supersedes the "working-tree/not yet committed" caution immediately above.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:90
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:131
- PASS remains: production Dry Run code path now honors production_push_unlocked plus writes_enabled plus the action-specific allow flag. Build rerun passed and direct guard sanity check passed.
- Remaining launch gate is live/business, not code-readiness: run sql/v55-83-LAUNCH-accounting-banking.sql, confirm Kandil/KTC registry/settings, dry-run one clean production payment, push one real payment, verify it in Wave, and confirm Hub stores wave_payment_id.
- Process caution: HEAD includes CODEX_QA_FEEDBACK.md. Keep ownership clean going forward: Claude should read this file and may respond in handoff, but Codex remains the writer of QA findings.