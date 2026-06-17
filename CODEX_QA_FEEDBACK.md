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
### 2026-06-17 v55.83-HM Heartbeat QA - PASS / LIVE GATE REMAINS

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 394975d v55.83-HM.
- No source code edited by Codex. Only this QA file was appended.
- Verification: npm.cmd run build PASS; real payment-push static test PASS; Open Accounts Excel note-strip test PASS; direct assertCanPush production-lock sanity check PASS.

#### PASS - HM closes the old typed-phrase production bypass caution
- HM removes the old typed-phrase fallback from the shared production block. Production now fails unless production_push_unlocked === true after writes_enabled and the per-action allow flag pass.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:108
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:124
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:133
- Direct sanity check results: production locked with no phrase failed; production locked with old phrase still failed; production unlocked passed dry run; production unlocked passed real-write guard; unlocked with writes_enabled=false failed; unlocked with allow_payment_push=false failed; non-approved non-production with unlock flag still failed real-write target guard.
- Business impact: this is the correct launch safety model. The super-admin production_push_unlocked switch is now the single production authorization path in the shared guard, with default-off intact.

#### CAUTION - Live Kandil/KTC launch verification is still the remaining gate
- HM makes the code path ready for controlled production dry-run/push, but it does not prove live data/configuration.
- Required before staff production push: run sql/v55-83-LAUNCH-accounting-banking.sql, confirm Kandil/KTC wave_business_registry row, confirm wave_business_settings default_payment_account_id and default_invoice_product_id, dry-run one clean production payment, push one real payment, verify it in Wave, and confirm Hub stores wave_payment_id.
- Instruction for Claude: do not mark production Wave push staff-ready until that exact live sequence is recorded in handoff. Hub-safe Bank Review/manual Wave workflow remains GO.

#### MINOR CLEANUP - Dead constant remains but is not launch-blocking
- UNLOCK_PHRASE is still defined/exported but no longer used as an authorization path.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:11
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:167
- Instruction for Claude: optional post-launch cleanup only. Do not touch it ahead of the live payment verification unless there is a real warning/failure.
### 2026-06-17 v55.83-HN Heartbeat QA - PASS WITH CAUTIONS

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: ca1d1d1 v55.83-HN.
- No source code edited by Codex. Only this QA file was appended.
- Verification: npm.cmd run build PASS; HN overpayment-credit test PASS; real payment-push static test PASS; Open Accounts Excel note-strip test PASS.

#### PASS - HN closes the Bank Review overpayment residual-loss bug
- applyToInvoice() no longer gates overpayment recording on mCustomerId alone. It now defaults the residual credit customer to inv.accounting_customer_id, which is the correct accounting source if the matcher did not manually pick a customer.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:481
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:482
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:485
- If an invoice truly has no accounting customer, the residual is parked as an unapplied deposit instead of being silently dropped.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:487
- Test coverage: __tests__/test-v55-83-hn-overpayment-credit.js passed. It covers partial/full/overpayment math, money-conservation math, removal of the old mCustomerId-only gate, invoice-customer fallback, and unapplied-deposit fallback.
- Business impact: this is a real launch-quality accounting fix. Overpaid bank deposits matched to invoices should no longer lose the residual just because the user did not select a customer in the match form.

#### CAUTION - Bank transaction customer stamp still does not use the invoice customer fallback
- HN records the overpayment credit against creditCustId = mCustomerId || inv.accounting_customer_id, but the final bank transaction patch still writes accounting_customer_id: mCustomerId || t.accounting_customer_id.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:482
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:493
- Business impact: when staff match an invoice without manually picking a customer, the payment row and credit can point to the invoice customer, but the bank transaction can remain customer-blank. That is not a money-loss blocker, but it can make customer filtering/review less clear.
- Instruction for Claude: in the next safe banking polish pass, consider stamping the bank transaction with mCustomerId || inv.accounting_customer_id || t.accounting_customer_id so the bank row, payment row, and credit/deposit agree on customer identity. Verify this does not override an intentionally different existing transaction customer.

#### CAUTION - Overpayment flow is still multi-write, not atomic
- The flow inserts payment_matches, then accounting_invoice_payments, then recomputes the invoice, then inserts customer_credits/unapplied_deposits, then patches the bank transaction.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:466
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:472
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:475
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:485
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:493
- Business impact: if the credit/deposit insert fails after the payment row is inserted, the UI shows an error but the invoice payment may already exist. This is an existing architecture limitation, now more visible because HN added a residual write. Not a reason to reject HN, but do not overstate "money is never dropped" until this is either RPC-atomic or has a repair/retry path.
- Instruction for Claude: launch can proceed with HN plus operator caution, but the professional fix is an atomic server-side RPC for Bank Review match/apply/overpayment, or at minimum a detectable retry/repair path for matches where applied_to_invoice + residual does not equal the bank amount.

#### Current launch verdict after HN
- GO: Hub-safe Bank Review/manual Wave workflow, with HN improving overpayment correctness.
- CODE-READY: production Dry Run/Push guards after HM/HN remain ready for controlled testing.
- NOT STAFF-READY for production Wave push until live launch SQL/config is verified and one real Kandil/KTC payment push is confirmed in Wave with Hub wave_payment_id stored.
### 2026-06-17 v55.83-HO Heartbeat QA - PASS WITH CAUTIONS

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 43de37b v55.83-HO.
- Working tree has no source diff; only .claude/ is untracked.
- No source code edited by Codex. Only this QA file was appended.
- Verification: npm.cmd run build PASS; HN overpayment-credit test PASS; real payment-push static test PASS; Open Accounts Excel note-strip test PASS.

#### PASS - HO reverses the phantom overpayment customer credit on unmatch
- unmatch() now voids open customer_credits rows tied to the bank transaction by source_transaction_id after voiding accounting_invoice_payments and payment_matches.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:352
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:353
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:358
- The overpayment credit path stamps source_transaction_id: t.id, so the reversal scope matches the rows created by the overpayment flow.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:490
- Business impact: this closes the bad accounting state where unmatching restored the invoice balance but left a customer's overpayment credit open.

#### CAUTION - No-customer overpayment fallback deposits still cannot be safely auto-reversed
- HN's fallback creates unapplied_deposits with bank_transaction_id: t.id when an overpaid invoice has no accounting customer, but there is no origin/source tag proving that row was auto-created by the overpayment branch.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:492
- Manual Create Unapplied uses the same bank_transaction_id pattern, so auto-voiding all unapplied_deposits for the bank transaction would risk reversing a real manual deposit.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:515
- Instruction for Claude: I agree with not auto-voiding unapplied_deposits by bank_transaction_id alone. Add a durable source/origin discriminator for auto-created overpayment fallback deposits before trying to reverse them on unmatch. If that cannot land before launch, surface this rare fallback as an operator/manual-review item rather than claiming unmatch fully reverses every residual case.

#### CAUTION - Add a targeted HO regression test
- I found HN overpayment coverage, but no HO-specific test locking the customer_credits void-on-unmatch behavior.
- Instruction for Claude: add a small static or unit-style regression test proving unmatch voids customer_credits by source_transaction_id/status=open, and separately documenting that unapplied_deposits are intentionally not auto-voided until a safe source/origin tag exists.

#### Current launch verdict after HO
- GO: Hub-safe Bank Review/manual Wave workflow, with HO improving unmatch correctness.
- CODE-READY: production Dry Run/Push guard path remains green under focused tests and build.
- NOT STAFF-READY for production Wave push until live Kandil/KTC launch SQL/config is verified, one production dry run succeeds, one real payment is pushed and verified in Wave, and Hub stores the real wave_payment_id.
### 2026-06-17 Cross-Area Gap Hunt - Inventory / WhatsApp / Open Accounts - FAILS / R&D CAUTION

Scope read before this gap pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Inspected Inventory Overview, Inventory Report Center, ReportTable, Open Accounts, Communications/WhatsApp routes, and WhatsApp Inbox only. No source files edited by Codex.
- Context: user asked Codex to keep wearing QA engineer + business analyst + R&D consultant hats while Claude executes.

#### FAIL - Inventory Overview can still show false partial/empty inventory when Supabase returns res.error
- InventoryOverview load defines safe(q), but safe only catches thrown promise failures. Supabase query failures usually resolve as { data, error }, so layRes/recRes/soldRes errors are kept but then ignored.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:186
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:196
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:197
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:198
- The loader then sets layers/receipts/salesItems from .data without checking .error, so a missing column/RLS/query failure can become [] and the user may see no stock or understated stock instead of a load failure.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:202
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:204
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:205
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:206
- Business impact: Inventory Overview is the screen staff will trust most. If it silently drops layers/receipts, Inventory Snapshot may be more truthful than Overview, which breaks launch priority #2: reports must show real inventory.
- Instruction for Claude: mirror InventoryReportCenter's q(source, builder) pattern here, or explicitly throw/surface each res.error. Core inventory_products and inventory_lists errors should also be checked. If invoice_items sold data is optional, mark only the sales/profit strip partial; do not let stock quantities render as complete when layers/receipts failed.

#### FAIL - Legacy WhatsApp send paths call the new /api/whatsapp/send contract with the old payload
- /api/whatsapp/send now requires conversation_id and returns { ok: true, ... } on success.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:50
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:52
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:183
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:187
- The legacy Communications composer still sends { to, body, userId, triggeredBy } and checks data2.success, so it will fail even before Meta send, and success would not be recognized under the new response shape.
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:98
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:101
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:104
- The team reminder WhatsApp path also sends { to, body } to /api/whatsapp/send and swallows errors, so staff may believe urgent reminders went out when the route rejected them.
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:10696
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:10698
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:10699
- Business impact: this is exactly the kind of integration gap that makes the hub feel unprofessional: one WhatsApp inbox works, but older send buttons/reminders hit the wrong API contract.
- Instruction for Claude: either remove/disable the legacy one-shot WhatsApp compose/reminder paths, or adapt them to the current model: find/create a conversation by phone, respect the 24-hour window, use /api/whatsapp/start for template/outbound-first sends, and check ok instead of success. Do not silently swallow reminder send failures; surface a count of sent/failed recipients.

#### R&D CAUTION - Open Accounts has phone data but no WhatsApp statement/invoice workflow yet
- Open Account invoices store counterparty_phone.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1035
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1155
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:2456
- WhatsApp Inbox can start a template by raw phone and optionally link to a CRM customer, but it is not linked to open_accounts/open_account_invoices/accounting_customers or to statement/invoice sharing.
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsAppInbox.jsx:513
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsAppInbox.jsx:519
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsAppInbox.jsx:553
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsAppInbox.jsx:560
- Business/R&D recommendation: after the accounting launch path is stable, design a first-class "Send statement/invoice via WhatsApp" flow from Open Accounts. It should generate the same clean customer-perspective statement/invoice already used for print/export, send via approved Meta template outside the 24-hour window, and log the conversation/message back to the Open Account. This is not a 3-hour launch blocker; it is the right professional integration direction.
### 2026-06-17 v55.83-HP Working-Tree QA - PASS WITH BUILD CAUTION

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md after Claude's HP working-tree update.
- Inspected working-tree diff for CLAUDE_HANDOFF.md, src/app/page.jsx, src/components/WhatsNewWidget.jsx, and __tests__/test-v55-83-ho-unmatch-credit-reversal.js.
- No source code edited by Codex. Only this QA file was appended.
- Verification: HO unmatch credit-reversal test PASS; HN overpayment-credit test PASS; real payment-push static test PASS; npm.cmd run build FAILED twice in local generated .next/export/prerender artifact stage after compilation succeeded.

#### PASS - HP satisfies the requested HO regression-test caution
- New test locks the customer_credits void-on-unmatch behavior by checking the unmatch source for customer_credits update, status:void, source_transaction_id=t.id, status=open, and non-fatal handling.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ho-unmatch-credit-reversal.js:31
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ho-unmatch-credit-reversal.js:39
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ho-unmatch-credit-reversal.js:41
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ho-unmatch-credit-reversal.js:43
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ho-unmatch-credit-reversal.js:45
- Test also documents the intentional decision not to blanket-void unapplied_deposits by bank_transaction_id until an origin/source tag exists.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ho-unmatch-credit-reversal.js:51
- Verification: node __tests__\test-v55-83-ho-unmatch-credit-reversal.js passed.

#### CAUTION - HP build was not green in my local pass; run a clean build before commit/deploy
- First npm.cmd run build compiled successfully but then failed during prerender/export with many Cannot find module errors under .next/server/app.
- Second npm.cmd run build compiled successfully but failed with ENOENT opening D:\GITHUB\nexttrade-hub\.next\export-detail.json.
- This looks like a local generated .next artifact/race failure rather than an obvious HP source failure, because HP only adds a static test plus badge/What's New text and focused tests passed. Still, do not mark HP deploy-ready until Claude gets a clean build in his run.
- Instruction for Claude: run a clean build before commit/deploy. If the same .next artifact failure repeats, clean the generated build output and rebuild; do not change app source to chase a generated-output problem unless a real source stack appears.

#### PROCESS / PRIORITY NOTE - new cross-area FAILs were appended after HP started
- The Inventory Overview false-empty/error-surfacing FAIL and legacy WhatsApp send contract FAIL are now in this QA file immediately above this HP note. They were appended while Claude was already working on HP, so HP's handoff may not mention them yet.
- Instruction for Claude: before the next source change, re-read CODEX_QA_FEEDBACK.md and treat those new FAILs as the next queue items after the accounting launch gate. Accounting/Kandil live payment verification still stays the top launch gate.
### 2026-06-17 P0 UX/PERMISSION FAIL - Accounting document tabs are wrongly blocked by Bank View

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md tail, CODEX_QA_REQUEST.md check, git status/log/diff.
- Inspected the screenshot-proven restricted card and the relevant Accounting/Wave/Open Accounts permission code only.
- No source code edited by Codex. Only this QA file was appended.

#### P0 FAIL - Invoices / Proformas / Accounting Customers / Company Profile are gated by bank.view
- Current permission source of truth says bank.view is Bank: View Transactions: see bank transactions in Bank Review & Matching, names/dates only; account balances are a separate permission.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:474
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:8
- AccountingCustomersTab imports canViewBank and uses it as mayView, then tells the user to grant Bank: View to see accounting customers.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:22
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:97
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:102
- AccountingInvoicesTab uses canViewBank for both Invoices and Proformas, so customer invoicing/proformas are blocked unless staff can view bank transactions.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:8
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:54
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:412
- CompanyProfileTab, which drives printed invoice/proforma branding, is also gated by canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:5
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:18
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:79
- AccountingCustomerHistory also uses canViewBank even though there are AR-specific permissions already available.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:8
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:22
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:85
- PurchaseOrdersTab partially uses canViewBank too. It can also allow canCreateInvoice, but the view/edit model is still not explicit to purchase orders.
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:18
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:19
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:124
- Business impact: this forces Max to grant bank-transaction visibility just so staff can work with customer invoices, proformas, customers, company profile, or purchase orders. That is backwards for launch: staff should work inside Hub accounting without necessarily seeing raw bank transactions.
- Instruction for Claude: fix now. Do not tell Max to grant Bank View as a workaround. Replace canViewBank gates on non-bank document screens with explicit accounting/document permissions. At minimum, use existing helper intent where present: canViewInvoices for Invoices/Proformas, canViewCustomerAr or AR-specific helpers for customer AR/history, and add explicit purchase-order view/edit permissions instead of piggybacking on bank.view or invoice.create.

#### P0 UX FAIL - Restricted/error card text is unreadable on the dark Accounting screen
- Screenshot shows the Restricted card text is effectively invisible. The current Invoices restricted card is the source for the exact message: "Restricted / Requires the Bank: View permission."
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:412
- The same light amber restricted-card pattern appears in other accounting screens and must be visually verified on the actual dark Accounting background, not assumed from Tailwind names.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:100
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:79
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:85
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:525
- Instruction for Claude: create/use one shared high-contrast RestrictedNotice/ErrorNotice pattern for the dark Accounting surface. Either use a dark panel with white/amber text or a true light panel with dark text that is not dimmed by parent styles. It must pass a visual check in the actual Accounting tab. No more unreadable dark-on-dark or dark-on-amber-overlay cards.

#### P0 REQUIREMENT - Permissions must have stable visible IDs and exact descriptions
- Current Settings shows permission labels/descriptions, but not a stable admin-facing number/code. Max needs a precise permission ID he can tell staff/admins to toggle.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:379
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:421
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:464
- Instruction for Claude: add stable visible permission codes to Settings and restricted messages for this Accounting area. Suggested launch catalog:
  - ACCT-001 / accounting.company_profile.view: view company profile used on printed invoices/proformas.
  - ACCT-002 / accounting.customers.view: view Hub accounting customers, separate from Egypt CRM and separate from bank transactions.
  - ACCT-003 / accounting.customers.edit: create/edit/archive Hub accounting customers.
  - ACCT-004 / invoice.view: view Hub invoices and proformas.
  - ACCT-005 / invoice.create or invoice.edit: create/edit Hub invoices and proformas.
  - ACCT-006 / purchase_orders.view: view internal purchase orders.
  - ACCT-007 / purchase_orders.edit: create/edit/delete internal purchase orders.
  - BANK-001 / bank.view: view bank transactions in Bank Review & Matching only; does not grant balances and must not be required for invoices/customers/proformas/POs.
- Exact naming can differ if Claude prefers existing helpers, but the UI must show a stable code + key + plain-English description, and restricted cards must name the exact code/key required.

#### Acceptance test for Claude
- A user with Accounting tab access + invoice.view but WITHOUT bank.view can open Accounting > Invoices and Accounting > Proformas in read-only mode.
- A user with accounting.customers.view but WITHOUT bank.view can open Accounting > Customers.
- A user with purchase_orders.view but WITHOUT bank.view can open Accounting > Purchase Orders.
- A user without bank.view cannot open Bank Review & Matching.
- Restricted notices are readable in the actual dark Accounting UI and name the exact permission code/key required.
### 2026-06-17 P0 PERMISSION ADDENDUM - Do not swap to unassignable helper keys

Scope read before this addendum:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Inspected Settings permission catalog plus the Accounting document permission helpers only.
- No source code edited by Codex. Only this QA file was appended.

#### P0 FAIL - Settings does not expose the invoice/customer document keys needed to fix the Bank View lockout
- bank-permissions already has helper keys for invoice/customer AR work, including `invoice.view`, `invoice.create`, `invoice.view_balance`, `payments.view`, and `customer.view_ar`.
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:15
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:16
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:17
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:18
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:19
- Settings ACTION_PERMS exposes Wave, AR, payments.match/unmatch, and bank.view, but it does not expose `invoice.view`, `invoice.create`, `invoice.view_balance`, `payments.view`, `customer.view_ar`, `accounting.customers.view`, `accounting.customers.edit`, `purchase_orders.view`, or `purchase_orders.edit`.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:421
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:452
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:464
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:471
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:474
- Business impact: if Claude only changes AccountingInvoicesTab from canViewBank() to canViewInvoices(), staff can still be locked out because admins have no visible checkbox/code to grant `invoice.view`. The launch fix must include both the gates and the Settings catalog.
- Instruction for Claude: in the same P0 fix, add the explicit document/accounting permissions to Settings with stable visible codes and plain-English descriptions. Backfill compatibility intentionally: legacy `Edit Invoices` may imply `invoice.create` if needed, but `bank.view` must not imply any document access. Add/read a focused permission test or static regression so `invoice.view` without `bank.view` opens invoices/proformas, and no-bank users can still be granted customer/PO access.

### 2026-06-17 v55.83-HQ WORKING-TREE QA - FAIL P0 permission fix is incomplete

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Inspected Claude's current working-tree changes only in Accounting/Wave restricted notices and document permission gates.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL - HQ improves some restricted-card contrast but does not fix the Bank View lockout
- PASS portion: new shared RestrictedNotice uses inline dark background, bright border, and light text, which is the right direction for readability on the dark Accounting surface.
- file: D:\GITHUB\nexttrade-hub\src\components\RestrictedNotice.jsx:8
- However, Invoices/Proformas still import canViewBank and still set mayView from bank.view.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:9
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:55
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:413
- Accounting Customers is not updated at all: still canViewBank, still says Bank: View permission.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:22
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:102
- Company Profile still uses bank.view as its view gate.
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:19
- Accounting Customer History still uses bank.view as its view gate.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:9
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:23
- Purchase Orders still allows view through bank.view or invoice.create, not an explicit purchase_orders.view permission.
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:7
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:19
- Business impact: this working tree would still force staff to have bank transaction visibility to use core accounting documents, and it still does not satisfy Max's request for exact permission numbers/keys.
- Instruction for Claude: do not commit HQ as a P0 fix yet. Replace the actual gates, not only the restricted-card component. Invoices/Proformas must use invoice.view for read and invoice.create/edit for writes. Customers must use accounting.customers.view/edit or an explicit equivalent. Company Profile must use accounting.company_profile.view/edit. Customer History/Customer Ledger should use AR/customer permissions, not bank.view. Purchase Orders must use purchase_orders.view/edit, not bank.view.

#### FAIL - Settings still does not expose the needed assignable permission keys/codes
- bank-permissions defines invoice/customer helpers, but Settings ACTION_PERMS still does not expose invoice.view, invoice.create, invoice.view_balance, payments.view, customer.view_ar, accounting.customers.view/edit, accounting.company_profile.view/edit, or purchase_orders.view/edit.
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:15
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:16
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:17
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:18
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:19
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:421
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:474
- Instruction for Claude: add stable visible permission codes/keys/descriptions in Settings in the same build as the gate fix. A hidden helper key is not a usable permission model for launch.

#### CAUTION - New RestrictedNotice default icon appears mojibake in source
- RestrictedNotice default icon appears as `ðŸ”’` in the file, not a clean lock glyph. This may render as mojibake for users depending on encoding.
- file: D:\GITHUB\nexttrade-hub\src\components\RestrictedNotice.jsx:11
- Instruction for Claude: use plain ASCII text/icon fallback such as "LOCKED" or pass a known-good rendered icon from the existing icon library. Do not ship mojibake in permission/error UI.

### 2026-06-17 v55.83-HQ COMMITTED QA - CONTRAST PARTIAL PASS / PERMISSION P0 STILL FAIL

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: fd0526e v55.83-HQ.
- Inspected only committed Accounting/Wave restricted-notice and permission-gate files. No source code edited by Codex. Only this QA file was appended.

#### PARTIAL PASS - HQ addresses the unreadable restricted-card symptom in several Accounting/Wave screens
- New RestrictedNotice uses inline dark slate background, bright border, and light text. This is a reasonable fix path for the screenshot complaint because it avoids the amber Tailwind classes that were rendering dark-on-dark.
- file: D:\GITHUB\nexttrade-hub\src\components\RestrictedNotice.jsx:8
- HQ wires RestrictedNotice into several relevant screens, including Invoices, Customer History, Customer Ledger, Company Profile, Purchase Orders, Bank Review, Wave Connection, and Wave Import.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:413
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:86
- file: D:\GITHUB\nexttrade-hub\src\components\CustomerLedger.jsx:219
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:80
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:125
- Instruction for Claude: still do a real visual check on the Accounting dark surface. Static CSS intent is good, but this was originally a visual bug.

#### P0 FAIL - HQ is NOT the Accounting permission fix; Bank View lockout remains in committed code
- Invoices/Proformas still import canViewBank, set mayView from bank.view, and still tell the user Bank View is required.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:9
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:55
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:413
- Accounting Customers still uses canViewBank and still displays the old Bank View requirement.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:22
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:102
- Company Profile still uses canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:19
- Accounting Customer History still uses canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:9
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:23
- Purchase Orders still uses bank.view or invoice.create instead of explicit purchase_orders.view/edit.
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:7
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:19
- Settings still has no visible assignable document permission codes/keys for invoice.view, accounting.customers.view/edit, accounting.company_profile.view/edit, purchase_orders.view/edit, or customer.view_ar.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:421
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:474
- Business verdict: HQ is acceptable only as a contrast bug patch. Accounting/banking is still NOT staff-ready for non-bank accounting users because core document tabs still require Bank View.
- Instruction for Claude: next build must be the actual permission-model fix. Do not spend another heartbeat converting unrelated restricted banners before replacing these gates and adding visible Settings permission codes. Acceptance remains: invoice.view without bank.view opens Invoices/Proformas; accounting.customers.view without bank.view opens Customers; purchase_orders.view without bank.view opens POs; no bank.view still blocks Bank Review.

#### CAUTION - RestrictedNotice default icon still appears as mojibake in source
- The default icon string appears as mojibake, not a reliable lock symbol.
- file: D:\GITHUB\nexttrade-hub\src\components\RestrictedNotice.jsx:11
- Instruction for Claude: use ASCII fallback text or a reliable icon component. Permission/error UI must not show corrupted characters.

### 2026-06-17 v55.83-HR WORKING-TREE QA - PASS WITH CAUTIONS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Inspected HR working-tree changes for Accounting document permissions, Settings permission catalog, RestrictedNotice, and the new permission regression test.
- Ran focused test: node __tests__\test-v55-83-hr-accounting-doc-permissions.js - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HR fixes the P0 Bank View lockout for Accounting document tabs
- Invoices/Proformas now use canViewInvoices/canCreateInvoice instead of canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:9
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:58
- Accounting Customers now uses canViewAccountingCustomers/canEditAccountingCustomers instead of canViewBank/canEditMappings.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:26
- Company Profile now uses canViewCompanyProfile/canEditCompanyProfile instead of canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:6
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:21
- Accounting Customer History now uses Accounting Customer / Customer AR permissions instead of canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:9
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:25
- Purchase Orders now uses canViewPurchaseOrders/canEditPurchaseOrders instead of canViewBank.
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:7
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:20
- Settings now exposes stable admin-facing Accounting permission codes ACCT-001 through ACCT-007.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:493
- Focused regression confirms: invoice.view without bank.view opens invoices; bank.view alone does not grant invoice/customer/PO docs; Bank Review still needs bank.view.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hr-accounting-doc-permissions.js:31
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hr-accounting-doc-permissions.js:45
- Verification: node __tests__\test-v55-83-hr-accounting-doc-permissions.js passed.
- QA verdict: this satisfies the core P0 acceptance path in working tree. Build still needs a clean run before commit/deploy if Claude has not run it.

#### CAUTION - Purchase Order permissions still fall back to invoice permissions
- canViewPurchaseOrders grants PO view from Invoice: View / invoice.view / Invoices, and canEditPurchaseOrders grants PO edit from Invoice: Create / invoice.create.
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:25
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:26
- Business impact: this prevents lockout, but it blurs the exact ACCT-006/ACCT-007 model Max asked for. A staff member granted invoice.view may also see purchase orders.
- Instruction for Claude: if this is a short-term legacy compatibility bridge, document it in the Settings descriptions or handoff and plan to remove it after roles are assigned. If Max wants exact permission separation now, remove invoice.* fallbacks from PO helpers before commit.

#### CAUTION - Company Profile edit helper is not assignable in Settings
- canEditCompanyProfile checks accounting.company_profile.edit, but Settings exposes only accounting.company_profile.view under ACCT-001.
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:24
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- Business impact: non-admin staff can be granted view but not edit from Settings. That may be intentional for launch, but then the edit helper should be admin-only or the missing edit key should be exposed.
- Instruction for Claude: either add a visible Company Profile edit permission code or explicitly keep Company Profile edit admin/super-admin only and remove the hidden unassignable key from the helper.

#### CAUTION - Settings permission labels appear to contain a non-ASCII separator
- The ACCT labels display in this terminal as `ACCT-001 Â· ...`, which may be an encoding/display artifact, but permission UI already had a mojibake issue this pass.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:493
- Instruction for Claude: use plain ASCII in permission labels, e.g. `ACCT-001 - Company Profile: View`, so Max can read and quote the codes reliably across browsers/exports/logs.

### 2026-06-17 v55.83-HR COMMITTED QA - PASS WITH CAUTIONS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 642bb7c v55.83-HR.
- Inspected committed Accounting document permission gates, Settings ACCT permission catalog, RestrictedNotice icon fallback, and Bank Review gate.
- Ran focused test: node __tests__\test-v55-83-hr-accounting-doc-permissions.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HR closes the P0 Accounting document lockout caused by Bank View
- Invoices/Proformas, Accounting Customers, Company Profile, Customer AR History, and Purchase Orders no longer use canViewBank as their document view gate.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingInvoicesTab.jsx:58
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:26
- file: D:\GITHUB\nexttrade-hub\src\components\CompanyProfileTab.jsx:21
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomerHistory.jsx:25
- file: D:\GITHUB\nexttrade-hub\src\components\PurchaseOrdersTab.jsx:20
- Bank Review still uses canViewBank, which is correct for raw bank transaction access.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:152
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:523
- Settings exposes ACCT-001 through ACCT-007 so admins have visible permission codes to assign.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:493
- Regression test confirms the acceptance set: invoice.view without bank.view works; bank.view alone does not grant invoice/customer/PO access; Bank Review still requires bank.view.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hr-accounting-doc-permissions.js:31
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-hr-accounting-doc-permissions.js:45
- Verification: focused test PASS; production build PASS.
- Business verdict: HR is launch-acceptable for the P0 permission/readability complaint, pending actual role assignment and one visual check in the live dark Accounting UI.

#### CAUTION - Purchase Order permission fallbacks still blur exact ACCT-006/ACCT-007 separation
- PO view/edit helpers still accept invoice permissions as legacy fallbacks.
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:25
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:26
- This is not a launch blocker if intended to avoid staff lockout, but it means invoice.view may also reveal Purchase Orders. If Max wants exact PO separation now, remove those invoice fallbacks and rely on ACCT-006/ACCT-007.

#### CAUTION - Company Profile edit remains a hidden/unassignable helper key
- canEditCompanyProfile checks accounting.company_profile.edit, but Settings exposes only ACCT-001 view.
- file: D:\GITHUB\nexttrade-hub\src\lib\bank-permissions.js:24
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- Not a blocker if Company Profile editing is owner/admin-only for launch. If non-admin staff should edit profile branding, expose an edit permission code.

#### CAUTION - Permission labels still use a non-ASCII middle-dot separator
- ACCT labels use a middle dot. It may render fine in browser, but this project just hit mojibake in permission UI, and the terminal has shown these as garbled before.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:493
- Recommendation: switch labels to plain ASCII hyphen format (`ACCT-001 - Company Profile: View`) when convenient. Do not block launch on this if the browser visual check is clean.

### 2026-06-17 v55.83-HS COMMITTED QA - PASS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 81ae9eb v55.83-HS.
- Inspected committed Settings permission catalog and bank-permissions helpers only, per HR caution closure.
- Ran focused test: node __tests__\test-v55-83-hr-accounting-doc-permissions.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HS closes the HR permission-catalog cautions
- ACCT permission labels now use ASCII hyphen separators, e.g. `ACCT-001 - ...`, avoiding the middle-dot/mojibake risk in the permission catalog.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:494
- Company Profile edit is now assignable as `accounting.company_profile.edit` / ACCT-001E.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:488
- The PO invoice-permission back-compat bridge is now explicitly documented in ACCT-006/ACCT-007 descriptions, so the temporary broader access is visible to admins rather than hidden.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:493
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:494
- Regression still passes after HS.
- Verification: node __tests__\test-v55-83-hr-accounting-doc-permissions.js passed. npm.cmd run build passed.
- QA verdict: HR/HS together close the P0 permission/readability blocker for Accounting document tabs in committed code.

#### Remaining launch checks after HS
- Assign the new ACCT permissions to staff roles in Settings; code is ready, but users still need grants.
- Do a real visual check of RestrictedNotice on the live dark Accounting screen.
- For production Wave push, still complete the live path: run/verify launch SQL + preflight, dry-run one clean Kandil/KTC payment, push one real payment, verify in Wave, and confirm Hub stores `wave_payment_id`.
- HE split Wave-category columns still depend on the user running the launch SQL or confirming preflight green in the target Supabase environment.

### 2026-06-17 v55.83-HT INVENTORY OVERVIEW ERROR-SURFACING QA - PASS WITH CAUTION

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 6a5b2b1 v55.83-HT.
- Inspected committed Inventory Overview error-surfacing change and production build output.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - Inventory Overview no longer silently converts core load failures into false empty stock
- HT now inspects Supabase response .error after the overview Promise.all, covering products, classifications, stock layers, and receipts.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:207
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:211
- If any core inventory query fails, the screen sets error and raises a toast instead of quietly showing []/empty inventory.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:213
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:215
- The existing render path suppresses the "No inventory to show" empty state whenever error is present, which is the correct business behavior.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:799
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:804
- Sales/invoice item load failure is treated as optional and warned only, which is acceptable because it affects profit/sold strip completeness, not the physical inventory truth.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:212
- Verification: npm.cmd run build passed on HT.

#### CAUTION - New user-facing error separator uses a middle dot
- The new error banner/toast joins multiple failures with a middle dot. That will likely render fine in the browser, but this same project already had mojibake/readability issues around permission UI and ACCT labels.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:214
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:215
- Instruction for Claude: not a blocker, but prefer plain ASCII in user-facing error strings, e.g. semicolon or pipe separators, especially for operational screens staff may screenshot or paste into support notes.

#### Remaining launch checks after HT
- Accounting/banking launch still depends on live environment work: assign ACCT permissions, visual-check RestrictedNotice on the dark Accounting screen, run/verify launch SQL + Wave preflight, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores wave_payment_id.
- Inventory still needs the user-requested real-product visual comparison between Overview and Inventory Snapshot.

### 2026-06-17 v55.83-HU WORKING-TREE INVENTORY RESTRICTED-CONTRAST QA - PASS WITH ONE FAIL

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current committed HEAD remains 6a5b2b1 v55.83-HT; HU is working-tree only at time of QA.
- Inspected only launch-relevant Inventory restricted/access panels and HU version/What's New edits.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HU converts the named Inventory restricted-card cluster to RestrictedNotice
- Adjustments now uses RestrictedNotice for the no-Inventory access gate.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryAdjustments.jsx:240
- Cost Layers now uses RestrictedNotice for the no-Inventory access gate.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryCostLayers.jsx:143
- Movements Ledger now uses RestrictedNotice for the no-Inventory access gate.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMovementsLedger.jsx:112
- Product List now uses RestrictedNotice and ASCII Settings wording.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryProductMaster.jsx:1031
- Receiving now uses RestrictedNotice, replacing the genuinely dangerous dark-on-dark amber overlay path.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReceiving.jsx:1780
- Stock Import now uses RestrictedNotice and ASCII Settings wording.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryStockImport.jsx:556
- Import Products now uses RestrictedNotice and ASCII Settings wording.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryImportProducts.jsx:764
- Inventory Master Admin now uses RestrictedNotice and ASCII Settings wording.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryMasterAdmin.jsx:307
- The badge is bumped to v55.83-HU and What's New documents the contrast sweep.
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:5385
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsNewWidget.jsx:36
- Verification: npm.cmd run build passed after the latest HU working-tree updates.

#### FAIL - Inventory Overview access gate still uses the old amber restricted panel
- The Inventory Overview no-permission return still uses bg-amber-50 / text-amber-900 instead of RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:586
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:588
- Business impact: a user without the Inventory permission can still hit an old restricted/error visual pattern in Inventory. Given Max's repeated contrast complaint, the HU claim that the contrast sweep is complete is too broad unless this panel is converted too.
- Instruction for Claude: convert the Inventory Overview no-permission return to RestrictedNotice, or narrow the HU What's New language to say the eight named sub-screens were converted but Overview's gate remains. Preferred fix: convert Overview as well so Inventory has one consistent readable restricted pattern.

#### Remaining launch checks after HU working tree
- Accounting/banking is still waiting on live environment confirmation: assign ACCT permissions, visual-check Accounting RestrictedNotice, run/verify launch SQL + Wave preflight, dry-run one clean Kandil/KTC payment, push one real payment, verify in Wave, and confirm Hub stores wave_payment_id.
- Inventory still needs the requested real-product visual comparison between Overview and Inventory Snapshot.

### 2026-06-17 v55.83-HU COMMITTED ADDENDUM - INVENTORY OVERVIEW RESTRICTED GATE STILL OPEN

Scope update:
- HU is now committed at 84db879 after the working-tree QA above.
- Re-checked HEAD and InventoryOverview after the commit.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL REMAINS - HU commit did not convert the Inventory Overview permission gate
- The committed HU code still leaves the Inventory Overview no-permission return on the old amber panel instead of RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:586
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:588
- HU's commit message / What's New says the contrast sweep is complete for the eight named Inventory access-restricted panels, but the Inventory module still has at least this one user-facing permission gate on the old pattern.
- Instruction for Claude: next safe fix should convert InventoryOverview's no-permission return to RestrictedNotice too. This is a small UX consistency fix, not an accounting launch blocker, but it is exactly the class of readability bug Max is calling out.

#### Verification note
- npm.cmd run build passed after HU source changes. The first run failed at a transient Next export file rename, then a rerun completed successfully.

### 2026-06-17 v55.83-HV WORKING-TREE QA - OVERVIEW PASS / REPORTS CONTRAST FAIL

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current committed HEAD at start: 84db879 v55.83-HU; HV is working-tree only at time of QA.
- Inspected launch-relevant Inventory Overview and Inventory report permission panels only.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HV closes the HU Inventory Overview restricted-gate FAIL
- InventoryOverview now imports RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:18
- The no-Inventory permission return now uses RestrictedNotice instead of the old bg-amber-50/text-amber-900 panel.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:587
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:590
- HT's user-facing load-error separator is now ASCII semicolon-space instead of a middle dot.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:215
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:216
- Badge/What's New are bumped to HV and correctly describe the Overview fix.
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:5385
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsNewWidget.jsx:36
- Verification: npm.cmd run build passed on the HV working tree.

#### FAIL - Inventory Reports still have old restricted/error permission panels
- InventoryReportCenter still returns an old amber permission panel for users without inventory.reports.view.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:355
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:356
- InventoryPnLReports still returns an old amber permission panel for users without See Inventory P&L.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryPnLReports.jsx:317
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryPnLReports.jsx:320
- Business impact: Reports are in this QA scope, and staff without report/P&L permission can still hit the old restricted-message style. That means the HV claim that the contrast sweep is truly complete is still too broad.
- Instruction for Claude: convert these two report permission returns to RestrictedNotice as the next tiny safe fix, or narrow the HV release text to Inventory Overview only. Preferred fix: import/use RestrictedNotice in both report files so all Inventory/Reports permission gates share the same readable pattern.

#### Remaining launch checks after HV working tree
- Accounting/banking still depends on live environment confirmation: assign ACCT permissions, visual-check Accounting RestrictedNotice, run/verify launch SQL + Wave preflight, dry-run one clean Kandil/KTC payment, push one real payment, verify in Wave, and confirm Hub stores wave_payment_id.
- Inventory still needs the requested real-product visual comparison between Overview and Inventory Snapshot.

### 2026-06-17 v55.83-HV COMMITTED ADDENDUM - REPORT RESTRICTED PANELS STILL OPEN

Scope update:
- HV is now committed at 7ea1048 after the working-tree QA above.
- Re-checked committed InventoryReportCenter and InventoryPnLReports.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL REMAINS - HV commit did not convert Inventory report permission gates
- InventoryReportCenter still uses the old amber permission panel for users without inventory.reports.view.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:355
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:356
- InventoryPnLReports still uses the old amber permission panel for users without See Inventory P&L, and the lock glyph appears mojibake in this terminal.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryPnLReports.jsx:317
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryPnLReports.jsx:321
- Instruction for Claude: convert both report permission returns to RestrictedNotice. This is not a Kandil accounting launch blocker, but it is inside Inventory/Reports scope and directly matches Max's contrast/readability complaint.

### 2026-06-17 v55.83-HW COMMITTED QA - REPORTS PASS / OPEN ACCOUNTS CONTRAST FAIL

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: b5d59a0 v55.83-HW.
- Inspected launch-relevant Inventory/Reports restricted gates and Open Accounts permission gate.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HW closes the Inventory Reports restricted-panel FAIL
- InventoryReportCenter now imports RestrictedNotice and uses it for the no inventory.reports.view permission return.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:8
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:357
- InventoryPnLReports now imports RestrictedNotice and uses it for the no See Inventory P&L permission return.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryPnLReports.jsx:20
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryPnLReports.jsx:321
- Badge/What's New are bumped to HW and describe the two report permission gates fixed.
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:5385
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsNewWidget.jsx:36
- Verification: npm.cmd run build passed on HW.

#### FAIL - Open Accounts still has an old amber permission gate
- OpenAccountsTab still uses bg-amber-50 / text-amber-900 for the no Open Accounts permission return instead of RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1328
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1330
- Business impact: Open Accounts is launch scope and staff without the permission can still see the old restricted-message styling. This is the same readability class Max complained about, just outside the Inventory report files.
- Instruction for Claude: convert this Open Accounts no-permission return to RestrictedNotice. This is a small UI-only fix; do not touch ledger/export logic.

#### CAUTION - Open Accounts empty state also uses old amber styling, but it is not a permission gate
- The no-accounts/filtered-empty state is still an amber card.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1505
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1506
- Instruction for Claude: do not block launch on the empty state, but consider dark-theme readability if touching the Open Accounts restricted panel anyway.

#### Remaining launch checks after HW
- Accounting/banking still depends on live environment confirmation: assign ACCT/Open Accounts permissions, visual-check Accounting/Open Accounts RestrictedNotice, run/verify launch SQL + Wave preflight, dry-run one clean Kandil/KTC payment, push one real payment, verify in Wave, and confirm Hub stores wave_payment_id.
- Inventory still needs the requested real-product visual comparison between Overview and Inventory Snapshot.

### 2026-06-17 v55.83-HX TICKETS ATTACHMENTS QUICK QA - PASS / CAUTION

Scope read before this pass:
- User explicitly asked where the ticket document attachment functionality went.
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 95d482f v55.83-HX.
- Inspected only ticket attachment flow: TicketsTab, RichCommentComposer, DashboardTicketModalOverlay, AttachmentManager, and attachment SQL references.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - The ticket attachment control still exists and HX makes it discoverable
- HX relabels the ticket comment composer file control from icon-only to `Attach`, with a tooltip and visible blue styling.
- file: D:\GITHUB\nexttrade-hub\src\components\RichCommentComposer.jsx:167
- file: D:\GITHUB\nexttrade-hub\src\components\RichCommentComposer.jsx:168
- TicketsTab still passes an onAttach handler into RichCommentComposer in ticket detail view.
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1255
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1261
- Existing attachments still render as clickable links inside ticket comments.
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1236
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1240
- Business verdict: the feature was not fully removed; it was effectively hidden behind a tiny icon in the ticket detail comment box. HX improves that discoverability.

#### CAUTION - Users still cannot attach a document while creating a new ticket
- The New Ticket form has title/description/priority/due date/assignee/order/client/privacy fields, but no document/file picker.
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1415
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1523
- Business impact: a staff member who expects to add the supporting document at ticket creation will still think the ticket document feature disappeared. Current workflow is create ticket first, open ticket detail, then attach inside Comments & Attachments.
- Instruction for Claude: decide and document the intended workflow. Best product fix: support attachments during ticket creation by staging the selected file until the ticket row exists, then upload/insert the attachment comment after create succeeds. If not building now, make the post-create attachment path obvious in the UI.

#### CAUTION - Ticket attachment storage bucket/schema needs live verification
- Ticket uploads go to Supabase Storage bucket `ticket-attachments`.
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1268
- file: D:\GITHUB\nexttrade-hub\src\components\TicketsTab.jsx:1270
- The reusable AttachmentManager and repo SQL document a different shared bucket/table named `attachments`.
- file: D:\GITHUB\nexttrade-hub\src\components\AttachmentManager.jsx:28
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-61-attachments.sql:23
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-61-attachments.sql:31
- I did not find repo SQL that creates/verifies the `ticket-attachments` bucket or its storage policies.
- Business impact: HX can make the button visible, but upload can still fail in production if `ticket-attachments` is missing or lacks policies.
- Instruction for Claude: before calling ticket attachments launch-ready, verify the live Supabase bucket/policies for `ticket-attachments`, or migrate Tickets to the shared `AttachmentManager` / `attachments` table path. If keeping `ticket-attachments`, add a documented migration/preflight so this does not depend on tribal memory.

### 2026-06-17 v55.83-HX HEARTBEAT ADDENDUM - OPEN ACCOUNTS FAIL STILL OPEN

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 95d482f v55.83-HX.
- Inspected launch-relevant Open Accounts restricted gate plus Wave push/split-preflight references.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL REMAINS - HX did not close the Open Accounts restricted-panel launch bug
- OpenAccountsTab still uses the old bg-amber-50 / text-amber-900 permission panel for users without Open Accounts permission.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1328
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1330
- Business impact: Open Accounts is in launch scope and Max's live complaint was exactly unreadable permission/error text on the dark Accounting surface. This remains a user-facing contrast risk for staff who lack the Open Accounts permission.
- Instruction for Claude: fix this before more polish/features. Convert only this no-permission return to RestrictedNotice; do not touch ledger, statement, print, or Excel logic.

#### PASS WITH USER-GATED CAUTION - Wave push and split metadata wiring remain code-ready but not live-proven
- Production Wave push remains guarded by production_push_unlocked plus writes_enabled plus per-action flags in the shared guard/routes.
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:109
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:119
- file: D:\GITHUB\nexttrade-hub\src\lib\wave-silo-guard.js:133
- Split Wave-category columns are represented in the launch SQL and preflight expectations.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-LAUNCH-accounting-banking.sql:16
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\preflight-schema\route.js:19
- Caution: this is still not launch-complete until the target Supabase has the launch SQL/preflight green and one real Kandil/KTC payment is dry-run, pushed, verified in Wave, and verified in Hub with a real wave_payment_id.

### 2026-06-17 v55.83-HY HEARTBEAT ADDENDUM - LAUNCH FAIL STILL OPEN

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 8eb4f34 v55.83-HY.
- HY touched Tickets/WhatsNew/badge and committed the prior Codex QA notes; it did not touch Open Accounts or Wave launch code.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL REMAINS - Latest HEAD still has the Open Accounts old restricted panel
- The Open Accounts no-permission return is still bg-amber-50 / text-amber-900 instead of RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1328
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1330
- Business impact: this is the active launch-scope UI/readability defect. It is small, but it is exactly the class of issue Max reported on the dark Accounting surface.
- Instruction for Claude: before any more ticket/UI polish, convert only this Open Accounts permission gate to RestrictedNotice. Do not touch Open Accounts ledger, statement, print, or Excel behavior.

#### CAUTION - Handoff is stale versus HEAD
- CLAUDE_HANDOFF.md still says Current build/version v55.83-HW while git HEAD is v55.83-HY.
- Business impact: not a code blocker, but it can mislead the QA/coding loop about what has actually shipped.
- Instruction for Claude: update CLAUDE_HANDOFF.md after closing the Open Accounts FAIL so it reflects the current build and open launch gates: launch SQL/preflight plus one real Kandil/KTC Wave payment verification.

### 2026-06-17 v55.83-HY WORKING-TREE QA - OPEN ACCOUNTS RESTRICTED PANEL PASS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current committed HEAD inspected: 8eb4f34 v55.83-HY.
- Working tree has an uncommitted OpenAccountsTab.jsx change from Claude; Codex did not edit source code.
- Inspected only the Open Accounts no-permission gate and build result.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - Open Accounts no-permission gate is converted to RestrictedNotice in the working tree
- OpenAccountsTab now imports RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:20
- The no Open Accounts permission return now uses RestrictedNotice instead of the old bg-amber-50 / text-amber-900 panel.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1329
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1332
- The diff is correctly scoped to the permission gate only; ledger, statement, print, and Excel logic were not touched.
- Verification: npm.cmd run build passed on rerun. First build attempt hit the recurring transient .next missing route/font-manifest export failure after compile/static generation; the immediate rerun completed successfully.

#### CAUTION - Not committed yet and launch still requires live Wave verification
- This PASS is for the working tree only until Claude commits it.
- After commit, remaining accounting/banking launch gates are still user/live-environment gates: run/confirm launch SQL + /api/wave/preflight-schema, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores the real wave_payment_id.

### 2026-06-17 v55.83-HZ COMMITTED QA - OPEN ACCOUNTS CONTRAST PASS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 1ee8f5c v55.83-HZ.
- Inspected committed OpenAccountsTab no-permission gate and HZ touched files.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - HZ closes the repeated Open Accounts restricted-panel FAIL
- OpenAccountsTab now imports RestrictedNotice.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:20
- The no Open Accounts permission return now uses RestrictedNotice instead of the old bg-amber-50 / text-amber-900 panel.
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1329
- file: D:\GITHUB\nexttrade-hub\src\components\OpenAccountsTab.jsx:1332
- The committed diff is scoped to the permission gate plus badge/What's New/handoff. Open Accounts ledger, statement, print, and Excel logic remain untouched.
- Verification carried forward from the HZ working-tree QA: npm.cmd run build passed on rerun after one transient .next export/cache failure.

#### Remaining launch gates
- No code-fixable contrast/permission-gate FAIL remains in the scoped Accounting/Wave/Open Accounts/Inventory reports path from this pass.
- Accounting/banking still requires live environment proof before staff launch: run/confirm launch SQL + /api/wave/preflight-schema, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores the real wave_payment_id.

### 2026-06-17 v55.83-IB WORKING-TREE QA - BANK REVIEW UNMATCH RECOMPUTE PASS / ACTIVE-MATCH FAIL

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 988d807 v55.83-IA; IB is working-tree only at time of QA.
- Inspected only launch-critical BankReviewTab unmatch/match display path plus IB badge/What's New/handoff diff.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - IB improves unmatch invoice recompute coverage for mixed match/payment-row cases
- IB fetches accounting_invoice_payments.accounting_invoice_id for the bank transaction before voiding rows, then merges those invoice ids into the existing recompute set.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:357
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:358
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:367
- Business impact: if a bank transaction has at least one payment_match plus additional accounting_invoice_payments rows, unmatch is less likely to leave a paid/balance_due stale after voiding the payment rows.

#### FAIL - Bank Review still treats voided payment_matches as active matches
- Bank Review loads all payment_matches without filtering voided rows.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:102
- It groups every returned row into matchesByTxn with no voided check.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:111
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:113
- The transaction list and detail panel treat matchesByTxn[t.id].length > 0 as currently matched, again with no voided check.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:624
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:703
- Business impact: after unmatch soft-voids payment_matches, the reload can still show the transaction as Matched using the historical void row. Staff may think the payment is still matched, may see another Unmatch button against already-voided history, and the launch accounting state becomes visually untrustworthy.
- Instruction for Claude: build matchesByTxn from ACTIVE matches only, e.g. filter payment_matches where voided !== true before grouping and before rendering. Keep the voided rows in the database for audit, but never let them drive the active Matched badge/panel/button. Add a focused regression/static test that BankReviewTab skips voided payment_matches in matchesByTxn/render logic.

#### CAUTION - IB does not fully cover payment rows with zero payment_match rows
- unmatch() still exits immediately when matchesByTxn[t.id] is empty.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:346
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:347
- Business impact: IB's handoff says it fixes a payment row whose invoice lacks a match, but a transaction with accounting_invoice_payments rows and no payment_matches row at all still has no visible Matched panel and unmatch refuses to run. If those orphan payment rows can exist from import/backfill/partial failure, staff still need a repair/unmatch path or an explicit Sync Center orphan queue.
- Instruction for Claude: either add a safe Bank Review/Sync Center repair path for orphan accounting_invoice_payments rows, or narrow the IB claim to the mixed case where at least one active payment_match exists. Do not call orphan payment-row unmatch solved until a zero-payment_match case is handled.

#### Remaining launch gates after IB working tree
- Fix the active-match filtering FAIL before calling Bank Review launch-ready.
- Accounting/banking still requires live environment proof: run/confirm launch SQL + /api/wave/preflight-schema, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores the real wave_payment_id.

### 2026-06-17 STRATEGIC BACKLOG - COMMUNICATIONS / AI / CUSTOMER TIMELINE (NOT A BANKING LAUNCH BLOCKER)

Scope note:
- User asked Codex to keep scanning the broader Hub while the heartbeat continues: WhatsApp, phone, AI, workflow gaps, and future professional-hub improvements.
- This section is intentionally NOT a request to pause current launch fixes. Claude must still fix the open Bank Review active-match FAIL first.
- No source code edited by Codex. Only this QA/backlog note was appended.

#### BACKLOG P1 - Communications are split between CRM customers and accounting customers
- WhatsApp inbound conversation matching only looks in the legacy CRM customers table by phone/whatsapp.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\webhook\route.js:281
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\webhook\route.js:284
- Phone inbound/outbound customer matching also only looks in customers, not accounting_customers.
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\incoming\route.js:179
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\incoming\route.js:182
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\outbound\route.js:187
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\outbound\route.js:190
- Accounting customer master has phone/email, but no communications timeline linkage.
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:10
- file: D:\GITHUB\nexttrade-hub\src\components\AccountingCustomersTab.jsx:78
- Business impact: the accounting side can create KTC/Wave customers and invoices, but calls/WhatsApp may attach only to the old CRM customer record or remain unlinked. Staff will not get one professional customer timeline across invoice, payment, call, voicemail, WhatsApp, ticket, and follow-up.
- R&D instruction for Claude later: design a unified contact identity layer or dual-link fields so WhatsApp/phone rows can resolve to accounting_customers as well as CRM customers. Then surface the timeline in Accounting Customer History / Customer Ledger, not only CRM.

#### BACKLOG P1 - CRM contact buttons bypass the Hub communication inbox
- CRM WhatsApp button opens wa.me in a new tab and logs only a generic contact note.
- file: D:\GITHUB\nexttrade-hub\src\components\CRMTab.jsx:144
- file: D:\GITHUB\nexttrade-hub\src\components\CRMTab.jsx:150
- file: D:\GITHUB\nexttrade-hub\src\components\CRMTab.jsx:151
- CRM Call button uses tel: instead of the Hub PhoneWidget/Twilio flow.
- file: D:\GITHUB\nexttrade-hub\src\components\CRMTab.jsx:673
- file: D:\GITHUB\nexttrade-hub\src\components\CRMTab.jsx:674
- Business impact: staff can leave the Hub for communication, which weakens the operating-layer vision. Conversations may not be captured in the WhatsApp inbox/phone logs/transcripts, so AI and managers lose context.
- R&D instruction for Claude later: replace external-only actions with Hub-native actions where configured: open/start WhatsAppInbox conversation, place call via PhoneWidget/Twilio, then log/link the result to the customer timeline. Keep external fallback only when Hub comms are not configured.

#### BACKLOG P2 - Phone webhooks intentionally fail open on bad Twilio signatures
- Inbound call, call-status, recording-callback, and voicemail-record routes log signature failure but continue processing.
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\incoming\route.js:132
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\incoming\route.js:138
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\call-status\route.js:35
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\recording-callback\route.js:44
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\voicemail-record\route.js:65
- Business impact: this was likely done to prevent Twilio caller-facing failures, and security is not today's accounting launch priority. But for a professional communications hub, public webhook spoofing can pollute call logs, voicemail rows, recording rows, and transcripts.
- R&D instruction for Claude later: move to fail-closed in production after fixing URL/env mismatch, with an explicit dev/test bypass only. If fail-open must remain temporarily, add rate limiting and a visible diagnostics panel so operators know signatures are failing.

#### BACKLOG P1 - AI should become the cross-system work assistant, not just a chat surface
- AI assistant/memory exists, and phone/WhatsApp/tickets/invoices all produce useful signals, but there is no obvious shared action queue tying them together.
- file: D:\GITHUB\nexttrade-hub\src\components\AIAssistant.jsx:30
- file: D:\GITHUB\nexttrade-hub\src\components\AssistantsBar.jsx:149
- Business impact: the Hub can become much more valuable if AI summarizes the day by customer/account: overdue invoice + recent WhatsApp + missed call + open ticket + promised follow-up. Right now those signals are scattered.
- R&D instruction for Claude later: after banking launch, define an AI context contract: customer timeline summaries, invoice/payment status, open tickets, recent communications, and suggested next action. Start read-only, then add draft actions requiring human approval.

### 2026-06-17 v55.83-IC COMMITTED QA - BANK REVIEW ACTIVE MATCH FILTER PASS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 61c4844 v55.83-IC.
- Inspected only launch-critical BankReviewTab active-match display/unmatch path plus the new focused regression test.
- Ran focused test: node __tests__\test-v55-83-ic-active-matches.js - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - IC closes the Bank Review voided payment_matches display/counting FAIL
- BankReviewTab still reads payment_matches for the audit-backed match map, but now filters rows to active matches only before grouping into matchesByTxn.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:102
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:114
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:116
- The existing transaction-list matched badge and detail Matched panel continue to key off matchesByTxn, so voided payment_matches no longer make an unmatched transaction look matched.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:627
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:706
- Regression test covers active kept, voided excluded, txn with only voided matches not shown as matched, legacy rows with undefined voided treated as active, and unmatch still soft-voids payment_matches for audit.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ic-active-matches.js
- Verification: node __tests__\test-v55-83-ic-active-matches.js passed.

#### CAUTION STILL OPEN - orphan payment rows with zero payment_match rows need a repair path
- IC closes the active-match UI bug. It does not add a path for a bank transaction that has accounting_invoice_payments rows but no payment_matches row at all.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:346
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:347
- Business instruction for Claude: keep this as a next Wave?Hub hardening item or Sync Center repair tool. It is separate from the IC FAIL fix and should not block the active-match PASS, but do not claim zero-match orphan payment repair is done.

#### Remaining launch gates after IC
- Accounting/banking still requires live environment proof: run/confirm launch SQL + /api/wave/preflight-schema, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores the real wave_payment_id.
- Split Wave-category production safety still depends on the target Supabase launch SQL/preflight being green.

### 2026-06-17 v55.83-ID COMMITTED QA - ORPHAN PAYMENT REVERSE PASS / WAVE-SYNCED REVERSAL FAIL

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: c5c14b6 v55.83-ID.
- Inspected only launch-critical BankReviewTab payment match/unmatch/orphan path plus Wave payment push status handling.
- Ran focused tests: node __tests__\test-v55-83-ic-active-matches.js - PASS; node __tests__\test-v55-83-ho-unmatch-credit-reversal.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- Note: node __tests__\test-v55-83-fi-payment-queue-safety.js still fails 1 stale static assertion; this matches the known stale-test cleanup bucket and did not block build.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - ID closes the zero-payment_match orphan visibility/reverse path
- BankReviewTab now loads accounting_invoice_payments into paysByTxn and filters out void/reversed rows with the shared isPaymentVoid helper.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:110
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:122
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:123
- The orphan panel only renders when there are payment rows but no active matchesByTxn rows, so normally matched transactions should not get the orphan warning.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:721
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:737
- unmatch() now permits the orphan case where ms.length === 0 but paysByTxn[t.id] has rows, then uses the existing void-by-bank_transaction_id and invoice recompute path.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:358
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:362
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:375
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:385
- Business verdict: PASS for Hub-only orphan repair. This is a useful safety valve for half-created/backfilled payment rows that have not been pushed to Wave.

#### FAIL - Bank Review can locally reverse a payment that has already been pushed to Wave
- Wave payment push marks a successful Hub payment row with wave_payment_id and sync_status = synced.
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:235
- file: D:\GITHUB\nexttrade-hub\src\app\api\wave\push-payment\route.js:236
- Wave Sync Center correctly excludes already-pushed payments from the push queue.
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:361
- file: D:\GITHUB\nexttrade-hub\src\components\WaveSyncCenter.jsx:362
- BankReviewTab's new paysByTxn select does not load wave_payment_id/source, and the orphan panel/unmatch button does not distinguish pending Hub-only payments from Wave-synced payments.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:110
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:737
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:741
- unmatch() updates every accounting_invoice_payments row for the bank_transaction_id to void/sync_status void, with no guard for wave_payment_id or sync_status synced/manual_done.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:377
- Business impact: after the live Kandil/KTC payment push is enabled, staff could unmatch/reverse a payment in Hub while the real Wave payment remains applied in Wave. Hub invoice balance would be restored, but Wave would still show the payment unless there is a separate Wave reversal/manual process. That breaks the launch promise that Hub and Wave remain accounting-correct.
- Instruction for Claude: before production Wave payment push is unlocked for staff, add a hard guard in BankReviewTab unmatch/reverse. If any payment row for the bank_transaction_id has wave_payment_id or sync_status in synced/manual_done, do not auto-void it locally. Show a clear message such as: "Payment already pushed to Wave. Reverse/remove it in Wave first, then run Wave import/reconcile or use a supervised repair." If a real Wave payment reversal API exists, build that as a separate explicit flow with confirmation and audit. Also include wave_payment_id and source/sync_status in the paysByTxn/payment-row fetch and add a focused regression/static test.

#### Remaining launch gates after ID
- Do not treat production Wave payment push as fully staff-ready until the already-synced unmatch/reverse guard above is fixed or the business explicitly restricts unmatch/reopen permissions to a supervised admin process.
- Still requires live environment proof: run/confirm launch SQL + /api/wave/preflight-schema, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores the real wave_payment_id.

### 2026-06-17 SETTINGS PERMISSION TOGGLE QA - LAUNCH-BLOCKING FAIL + IE WORKING-TREE PASS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- User reported live Settings > Module Access OFF buttons cannot be clicked on to turn permissions ON.
- This is technically outside the narrow Accounting tab code, but it directly blocks launch because staff cannot be granted Bank/AR/Wave/Open Accounts permissions.
- Inspected SettingsTab permission render/save logic and Claude's current BankReviewTab IE working-tree fix.
- Ran focused tests: node __tests__\test-v55-83-ie-no-local-reverse-of-synced.js - PASS; node __tests__\test-v55-83-ic-active-matches.js - PASS; node __tests__\test-v55-83-ho-unmatch-credit-reversal.js - PASS; node __tests__\test-v55-83-fl-real-payment-push.js - PASS.
- Ran production build after the BankReviewTab change: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - IE working-tree fix blocks local reversal of Wave-synced payments
- BankReviewTab now loads wave_payment_id with payment rows used for paysByTxn.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:110
- unmatch() now blocks local reverse if any non-voided payment row for that bank transaction has wave_payment_id, sync_status synced, or sync_status manual_done.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:363
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:366
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:367
- Focused regression test exists and passes.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ie-no-local-reverse-of-synced.js
- Verdict: this closes the v55.83-ID Wave-synced local reversal FAIL once Claude commits it. Remaining live gate is still the actual one-payment Wave verification.

#### FAIL - Settings Module Access OFF buttons cannot reliably turn action permissions ON
- The permission table correctly renders TAB permissions with default ON and ACTION permissions with default OFF.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:373
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:375
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1608
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1643
- The toggle save function ignores which section the permission came from and always treats a missing row as current=true.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1070
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1071
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1072
- Result: for any ACTION permission with no existing module_permissions row, the UI shows OFF because default is false, but togglePermission computes current=true and writes has_access=false again. The button appears not to work. This matches Max's live report.
- Affected launch permissions include payments.match, payments.unmatch, bank.see_amounts, wave.payments.push, wave.sync.view, ar.view_* and the ACCT-00x invoice/customer permissions.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:455
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:471
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:474
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:487
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:491
- Business impact: launch permission assignment is blocked. Staff can be locked out of invoices/customers/proformas/purchase orders/Bank Review/Wave Sync even though the code underneath is ready.
- Instruction for Claude: fix immediately before more accounting/inventory work. The safest UI fix is to pass the displayed hasAccess into togglePermission, e.g. togglePermission(userId, key, hasAccess), and save !hasAccess. Do not recompute missing rows with a hard-coded default true. Keep the Open Accounts legacy fallback behavior for display, but ensure clicking the displayed state flips the displayed state. Also check Supabase update/insert error objects and toast failures; current code awaits update/insert without checking .error, so RLS/schema failures can silently fail.
- Add a focused regression/static test: ACTION permission missing row displays OFF and first click inserts has_access=true; TAB permission missing row displays ON and first click inserts has_access=false; Edit Open Accounts legacy fallback flips from the displayed state; Supabase insert/update errors surface to the user.

#### Launch call after this pass
- Accounting/banking is NOT staff-launch-ready until the Settings permission toggle bug is fixed, because Max cannot assign the exact Bank/AR/Wave/ACCT permissions needed for Kandil users.
- After this fix commits, re-test by turning ON at least: bank.view, bank.see_amounts, payments.match, payments.unmatch, wave.sync.view, wave.sync.dry_run, wave.payments.push, ar.view_invoice_balances, invoice.view, invoice.create, accounting.customers.view, accounting.customers.edit, purchase_orders.view, purchase_orders.edit for a non-super user, then reload and confirm the states persist.

### 2026-06-17 SETTINGS PERMISSION TOGGLE WORKING-TREE QA - PARTIAL FIX / STILL FAIL

Scope note:
- Follow-up after Claude began editing SettingsTab.jsx in the working tree in response to the launch-blocking permission toggle FAIL.
- No source code edited by Codex. Only this QA file was appended.

#### PARTIAL PASS - Normal missing-row ACTION permissions should now flip ON
- Claude changed togglePermission to derive the default from TAB_PERMS vs ACTION_PERMS instead of always assuming missing permission rows are current=true.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1070
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1076
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1078
- This should fix the reported ordinary case: an ACTION permission showing OFF because no row exists should now save has_access=true on first click.

#### FAIL REMAINS - Toggle still does not use the displayed state and save errors are still silent
- The render path has special display logic for Edit Open Accounts: if Edit Open Accounts has no explicit row but legacy Open Accounts is true, it displays ON.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1568
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1643
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1644
- The click handler still calls togglePermission(u.id, p.key) without passing the displayed hasAccess value.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1620
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1655
- Because togglePermission still recomputes current from raw permissions[userId]?.[module], the Edit Open Accounts legacy-display case can show ON but first click inserts true again instead of turning OFF. This is the same class of bug in the opposite direction.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1078
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1080
- The Supabase update/insert calls still do not inspect returned error objects, so RLS/schema/network failures can silently fail while the UI does not explain what happened.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1083
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1085
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1088
- Instruction for Claude: finish the fix by passing the displayed hasAccess into togglePermission from BOTH table sections and saving newVal = !displayedHasAccess. Then check { error } from maybeSingle/update/insert and toast + do not optimistically update state when save fails. Add the static regression requested above.

#### BUILD NOT GREEN AFTER SETTINGS CHANGE
- npm.cmd run build was run twice after the SettingsTab working-tree change. Both attempts compiled successfully but failed in Next export/finalization with missing generated .next artifacts.
- First failure: missing .next server route files during prerender/export.
- Second failure: ENOENT renaming .next\export\500.html to .next\server\pages\500.html.
- This looks like the recurring generated-build-artifact problem, not a direct Settings syntax error, but the working tree cannot be called build-green from this pass.
- Instruction for Claude: after finishing the Settings toggle fix, run a clean build to completion before commit/deploy. If the .next artifact failure repeats, clean the generated build output safely and rerun; do not commit with a failed build.

#### Launch call after this working-tree check
- Still NOT staff-launch-ready. Permission assignment must be fully reliable because the Kandil launch depends on granting exact Bank/AR/Wave/ACCT permissions to non-super users.

### 2026-06-17 v55.83-IF COMMITTED QA - SETTINGS PERMISSION TOGGLE PASS WITH CAUTION

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD inspected: 5452969 v55.83-IF.
- Inspected committed SettingsTab permission toggle path, BankReviewTab Wave-synced reverse guard, tests, badge/What's New/handoff.
- Ran focused tests: node __tests__\test-v55-83-ie-permission-toggle-default.js - PASS; node __tests__\test-v55-83-ie-no-local-reverse-of-synced.js - PASS; node __tests__\test-v55-83-ic-active-matches.js - PASS; node __tests__\test-v55-83-fl-real-payment-push.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - The reported OFF action-permission grant bug is fixed enough to retest live
- togglePermission now derives missing-row default from TAB_PERMS membership: tab permissions default ON, action permissions default OFF.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1076
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1077
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1078
- Result: a missing-row ACTION permission that displays OFF now computes newVal=true on first click instead of re-saving false. This directly addresses Max's report that clicking OFF would not turn permissions ON.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ie-permission-toggle-default.js
- IF also updates the UI optimistically before the DB await, so the button should visibly flip immediately.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1080
- IF checks maybeSingle/update/insert error objects, reverts on failure, and shows a loud toast with the DB error instead of silently doing nothing.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1082
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1090
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1094
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1095
- Business verdict: PASS for the launch-critical ability to grant normal Bank/AR/Wave/ACCT action permissions, pending live browser retest on the deployed IF build.

#### PASS - Wave-synced local payment reverse guard remains fixed
- BankReviewTab loads wave_payment_id into paysByTxn and blocks local reverse when a payment row has wave_payment_id or sync_status synced/manual_done.
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:110
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:366
- file: D:\GITHUB\nexttrade-hub\src\components\BankReviewTab.jsx:367
- Regression test passes.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ie-no-local-reverse-of-synced.js

#### CAUTION - One display-state edge remains in Settings
- The click handlers still call togglePermission(u.id, p.key) without passing the rendered hasAccess value.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1627
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1662
- For ordinary Bank/AR/Wave/ACCT action grants this is now OK because the display default and toggle default match. However, Edit Open Accounts has special legacy display fallback: it can display ON because legacy Open Accounts is true while no explicit Edit Open Accounts row exists.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1657
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1658
- In that legacy case, first click may still insert has_access=true instead of flipping the displayed ON to OFF. This is not the specific launch blocker Max reported, but it is the same design weakness and should be cleaned up.
- Instruction for Claude: post-launch or next permissions hardening, pass displayed hasAccess into togglePermission for both table sections and save !displayedHasAccess. Add a regression for the Edit Open Accounts legacy fallback toggling OFF on first click.

#### Live retest instruction for Max / Claude
- Hard-refresh and confirm the visible badge is v55.83-IF.
- In Settings > Module Access, for a non-super user turn ON: bank.view, bank.see_amounts, payments.match, payments.unmatch, wave.sync.view, wave.sync.dry_run, wave.payments.push, ar.view_invoice_balances, invoice.view, invoice.create, accounting.customers.view, accounting.customers.edit, purchase_orders.view, purchase_orders.edit.
- If the button flips ON and stays after reload: permission assignment gate is cleared.
- If the button flips back with a red error toast: capture the exact error text; likely Supabase policy/RLS on module_permissions needs a targeted SQL/policy fix.
- If the badge is not IF or there is no error toast/no visible flip: stale deployed app/browser cache, hard refresh or redeploy IF before judging.

#### Remaining launch gates after IF
- Run/confirm launch SQL + /api/wave/preflight-schema.
- Dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores the real wave_payment_id.

### 2026-06-17 v55.83-IG WORKING-TREE QA - SETTINGS TOGGLE PASS / LIVE RETEST REQUIRED

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD is still 5452969 v55.83-IF. IG is present as uncommitted working-tree changes in SettingsTab, the permission test, badge/What's New, and handoff.
- Ran focused tests: node __tests__\test-v55-83-ie-permission-toggle-default.js - PASS; node __tests__\test-v55-83-ie-no-local-reverse-of-synced.js - PASS.
- Ran production build: npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - IG closes the IF display-state edge in Settings Module Access
- togglePermission now accepts displayedHasAccess and computes newVal from the exact ON/OFF state rendered to the user.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1070
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1077
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1080
- The TAB permission grid now passes hasAccess into togglePermission.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1623
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1628
- The ACTION permission grid now passes hasAccess into togglePermission, including the legacy Edit Open Accounts fallback case.
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1658
- file: D:\GITHUB\nexttrade-hub\src\components\SettingsTab.jsx:1663
- Regression test now covers visible-state flipping, including legacy-fallback ON -> OFF.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ie-permission-toggle-default.js
- Verdict: PASS in code/build. This is the permissioning fix Max asked for: clicking a visible OFF should turn it ON, clicking a visible ON should turn it OFF, and failed DB saves should revert with a clear red error.

#### CAUTION - IG is not committed/deployed yet in this QA pass
- git status shows IG source changes are still working-tree changes, not a committed build.
- Instruction for Claude: commit/deploy IG only after keeping the build green. Then Max must hard-refresh and confirm the badge reads v55.83-IG or later before judging Settings again.
- Live retest: for one non-super user, toggle ON bank.view, bank.see_amounts, payments.match, payments.unmatch, wave.sync.view, wave.sync.dry_run, wave.payments.push, ar.view_invoice_balances, invoice.view, invoice.create, accounting.customers.view, accounting.customers.edit, purchase_orders.view, purchase_orders.edit. Reload and confirm states persist.
- If any toggle flips back with a red error, capture the exact toast. That becomes a targeted Supabase module_permissions policy/RLS fix, not a UI mystery.

### 2026-06-17 BROADER HUB QA/RD IDLE-LANE - COMMS / CALENDAR / ADMIN / TICKETS / AI

Scope note:
- Max explicitly broadened the idle QA lane beyond accounting/inventory: Calendar, communications, WhatsApp, email, phone, admin, settings, system tickets, dashboard, and AI/persona.
- These are not all launch blockers for today's Kandil accounting go-live, but they are real gaps for a professional operating hub. Bugs first, then polish.

#### FAIL - Legacy Communications WhatsApp compose calls the wrong API contract
- The legacy Communications compose sends WhatsApp with { to, body, userId, triggeredBy }.
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:98
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:101
- The current /api/whatsapp/send route requires conversation_id and returns 400 when it is missing.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:49
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:52
- Business impact: staff can try to send a WhatsApp from Communications and it will fail even though WhatsApp Inbox has a valid send path.
- Instruction for Claude: either remove/disable legacy WhatsApp compose and route users to WhatsApp Inbox/Start Conversation, or update it to create/find a conversation then call /api/whatsapp/send with conversation_id. Do not leave a visible send button wired to a guaranteed 400.

#### FAIL - Gmail inbox/send trusts userId without route authentication
- Gmail inbox reads userId from the query string and uses a service-role Supabase client to pick the active email account.
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\inbox\route.js:57
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\inbox\route.js:61
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\inbox\route.js:67
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\inbox\route.js:68
- Gmail send also trusts body.userId and uses it to choose the sender account.
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\send\route.js:31
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\send\route.js:39
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\send\route.js:47
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\send\route.js:48
- Business/security impact: a caller who can hit these routes can request another user's mailbox or send using another active Gmail account by changing userId. This is too loose for professional email integration.
- Instruction for Claude: add requireUser to Gmail inbox/send, derive userId from session for normal staff, and allow cross-user mailbox access only to an explicit admin/comms permission. Log all sends to comms_audit with the authenticated actor.

#### CAUTION - WhatsApp routes are authenticated but not permission/ownership gated
- WhatsApp conversation list returns all non-archived conversations to any authenticated user by default.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\conversations\route.js:37
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\conversations\route.js:39
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\conversations\route.js:51
- Single-conversation route returns any conversation/messages by id to any authenticated user.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\conversations\[id]\route.js:27
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\conversations\[id]\route.js:44
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\conversations\[id]\route.js:70
- Send route authenticates but does not enforce comms permission or assignment/claim ownership before sending.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:44
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\send\route.js:56
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsAppInbox.jsx:178
- file: D:\GITHUB\nexttrade-hub\src\components\WhatsAppInbox.jsx:180
- Business impact: okay for a tiny trusted team, not okay for staff-wide rollout. Customer conversations need a clear view all / assigned only / send permission model.
- Instruction for Claude: after accounting launch, add comms.whatsapp.view_all, comms.whatsapp.view_assigned, comms.whatsapp.send, and optionally enforce assigned_to ownership unless user has view_all/send_all. The UI claim model should mean something operationally.

#### CAUTION - WhatsApp unread count can lose increments under concurrent inbound messages
- Webhook dedupes by wa_message_id, and SQL has wa_message_id UNIQUE, which is good.
- file: D:\GITHUB\nexttrade-hub\sql\s35_whatsapp_tables.sql:72
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\webhook\route.js:147
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\webhook\route.js:150
- However unread_count is updated from a stale conv.unread_count value in application code.
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\webhook\route.js:244
- file: D:\GITHUB\nexttrade-hub\src\app\api\whatsapp\webhook\route.js:250
- Business impact: two messages arriving together can both write the same unread_count + 1, causing the inbox badge to undercount.
- Instruction for Claude: replace with an atomic SQL RPC/increment or recompute unread count from unread inbound messages.

#### CAUTION - Phone incoming webhook intentionally fails open in production paths
- Missing TWILIO_AUTH_TOKEN makes verifyTwilioSignature return true.
- file: D:\GITHUB\nexttrade-hub\src\lib\phone-auth.js:176
- file: D:\GITHUB\nexttrade-hub\src\lib\phone-auth.js:179
- Even when signature verification returns false, incoming route logs and proceeds.
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\incoming\route.js:132
- file: D:\GITHUB\nexttrade-hub\src\app\api\phone\incoming\route.js:138
- Business/security impact: this prevents callers hearing a Twilio app error, but it also allows spoofed inbound call logs/voicemail flow pollution if exposed. That is not acceptable as a permanent professional phone-system posture.
- Instruction for Claude: keep launch continuity, but make fail-open explicit and environment-gated, e.g. PHONE_WEBHOOK_FAIL_OPEN=true. In production, missing token should raise a loud health alert, and signature failures should use a controlled fallback TwiML path plus admin alert.

#### CAUTION - Calendar can silently show an empty schedule on load failure
- loadEvents ignores Supabase error and sets data || [].
- file: D:\GITHUB\nexttrade-hub\src\components\CalendarTab.jsx:110
- file: D:\GITHUB\nexttrade-hub\src\components\CalendarTab.jsx:112
- It also still uses browser alert/confirm for important flows.
- file: D:\GITHUB\nexttrade-hub\src\components\CalendarTab.jsx:271
- file: D:\GITHUB\nexttrade-hub\src\components\CalendarTab.jsx:277
- file: D:\GITHUB\nexttrade-hub\src\components\CalendarTab.jsx:412
- Business impact: staff may think the day is clear when the calendar failed to load. Browser dialogs also make the app feel unfinished.
- Instruction for Claude: add a visible calendar load-error state and replace alert/confirm with app modal/toast patterns.

#### CAUTION - Admin dashboard swallows core data errors and can show false zeroes
- Admin loadData catches independent query failures but only logs console warnings, then marks loaded true.
- file: D:\GITHUB\nexttrade-hub\src\components\AdminTab.jsx:165
- file: D:\GITHUB\nexttrade-hub\src\components\AdminTab.jsx:168
- file: D:\GITHUB\nexttrade-hub\src\components\AdminTab.jsx:170
- file: D:\GITHUB\nexttrade-hub\src\components\AdminTab.jsx:214
- Business impact: management scorecards can look empty/healthy because data failed, not because work is clean.
- Instruction for Claude: add per-widget data health banners or a top "some admin data failed to load" banner listing the failed datasets. Admin should never make decisions from silent blanks.

#### FAIL - System ticket attachments use public URLs; private toggle gate is ambiguous
- System ticket file upload stores attachments in ticket-attachments and saves public URLs.
- file: D:\GITHUB\nexttrade-hub\src\components\SystemTicketsPanel.jsx:118
- file: D:\GITHUB\nexttrade-hub\src\components\SystemTicketsPanel.jsx:123
- The private toggle comment says super-admin only, but the component gates with generic isAdmin.
- file: D:\GITHUB\nexttrade-hub\src\components\SystemTicketsPanel.jsx:222
- file: D:\GITHUB\nexttrade-hub\src\components\SystemTicketsPanel.jsx:227
- page.jsx passes isAdmin, not an explicit isSuperAdmin flag.
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:14248
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:14250
- Business/security impact: system tickets often contain screenshots, internal bugs, customer data, or credentials. Public attachment URLs and ambiguous privacy controls are not good enough.
- Instruction for Claude: move sensitive ticket attachments to a private bucket with signed URLs, or add a clear "public attachment" warning until fixed. Pass an explicit isSuperAdmin prop for private/public ticket toggles if the intended gate is truly super-admin only.

#### CAUTION - AI quote request flows bypass Hub comms audit in some UI paths
- AIAssistant opens mailto: and wa.me directly for quote requests in at least two flows.
- file: D:\GITHUB\nexttrade-hub\src\components\AIAssistant.jsx:549
- file: D:\GITHUB\nexttrade-hub\src\components\AIAssistant.jsx:554
- file: D:\GITHUB\nexttrade-hub\src\components\AIAssistant.jsx:665
- file: D:\GITHUB\nexttrade-hub\src\components\AIAssistant.jsx:672
- /api/ask has audited send_email/send_whatsapp action paths, so the app already has a better pattern.
- file: D:\GITHUB\nexttrade-hub\src\app\api\ask\route.js:1262
- file: D:\GITHUB\nexttrade-hub\src\app\api\ask\route.js:1269
- Business impact: AI should make the Hub smarter, not push staff out into unaudited browser actions. External customer/vendor communication needs approval, actor, channel, status, and audit trail.
- Instruction for Claude: turn AI external actions into in-Hub approval cards. Draft first, user approves, route sends through the Hub email/WhatsApp endpoints, then write comms_audit. Keep mailto/wa.me only as a fallback clearly marked "not tracked."

#### PRODUCT NORTH STAR - Backlog after today's accounting launch
- Build an Operations Command Center, not another pile of tabs: unified inbox (WhatsApp/email/phone), customer timeline, pending staff actions, aging SLA, unassigned work, today's calendar, and AI-suggested next best actions.
- Dashboard should answer: who is stuck, what customer is waiting, what money/inventory risk exists today, and what should Max inspect first.
- AI should be an operator with guardrails: briefing, draft, approve, execute, audit. No silent external sends. No mystery permissions.

### 2026-06-17 v55.83-IG COMMIT STATUS CORRECTION
- Correction to the IG working-tree note immediately above: Claude committed IG after the QA verification was run.
- Current HEAD verified after append: b95db84 v55.83-IG: permission toggle flips the DISPLAYED state.
- PASS still stands: focused permission tests passed and npm.cmd run build passed before this note.
- Updated instruction for Claude/Max: deploy/hard-refresh v55.83-IG, then live-test one non-super user permission set. If toggles fail with a red toast, capture the DB/RLS error text. If badge is not v55.83-IG or later, do not judge the fix yet.

### 2026-06-17 v55.83-IH WORKING-TREE QA - INVENTORY RECEIPT STATUS FILTER PASS

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD at start of pass: b95db84 v55.83-IG. IH is present as working-tree changes in inventory files, badge/What's New, and handoff.
- Ran focused test: node __tests__\test-v55-83-ih-receipt-status.js - PASS.
- Ran production build: first attempt hit the recurring .next missing trace artifact after successful compile/page generation; immediate retry npm.cmd run build - PASS.
- No source code edited by Codex. Only this QA file was appended.

#### PASS - Shared receipt-status helper prevents Overview vs Report Center drift
- New shared helper defines the four excluded receipt statuses in one place: cancelled, pending_detail, merged, reversed.
- file: D:\GITHUB\nexttrade-hub\src\lib\inventory-receipts.js:12
- file: D:\GITHUB\nexttrade-hub\src\lib\inventory-receipts.js:16
- Inventory Overview now imports and uses isCountableReceipt in the stock/received aggregation path.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:19
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryOverview.jsx:295
- Inventory Report Center now imports and uses the same helper in its receipt loop.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:12
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryReportCenter.jsx:114
- Behavior is intentionally unchanged from the current good logic: finalized/active/received/missing legacy status count; cancelled/pending_detail/merged/reversed do not count.
- Regression test covers predicate behavior and verifies both screens use the shared helper.
- file: D:\GITHUB\nexttrade-hub\__tests__\test-v55-83-ih-receipt-status.js
- Business verdict: PASS. This is a good low-risk inventory hardening item because it prevents another Overview-vs-Snapshot mismatch without changing launch math.

#### CAUTION - IH is not committed at the time of this QA append
- git status still shows IH source files modified/untracked while HEAD remains v55.83-IG.
- Instruction for Claude: commit/deploy IH only after keeping the build green. If the first build repeats the .next trace artifact failure, rerun once or clean generated build output safely; do not claim build-green unless a full npm.cmd run build exits 0.

#### Launch reminder unchanged
- Accounting/banking launch still depends on live items outside local code review: run/confirm launch SQL + /api/wave/preflight-schema, live non-super Settings permission retest on v55.83-IG or later, dry-run one clean Kandil/KTC payment, push one real payment, verify it in Wave, and confirm Hub stores real wave_payment_id.

### 2026-06-17 INVENTORY PRODUCT PHOTOS QA - GAP / FEATURE NOT BUILT

Scope read before this pass:
- User asked whether inventory can add/show product photos.
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Inspected Inventory Product Master, inventory product schema, generic AttachmentManager, and attachment SQL.
- No source code edited by Codex. Only this QA file was appended.

#### FAIL / GAP - Inventory products do not have a first-class photo/gallery workflow
- InventoryProductMaster loads and saves inventory_products rows, but there is no photo upload field, gallery section, or AttachmentManager mounted for each product.
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryProductMaster.jsx:19
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryProductMaster.jsx:244
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryProductMaster.jsx:518
- file: D:\GITHUB\nexttrade-hub\src\components\InventoryProductMaster.jsx:871
- The inventory_products base schema has identity/classification/spec/default fields, but no image_url/photo_url/primary_photo_id/gallery metadata.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-23-inventory-product-master.sql:11
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-23-inventory-product-master.sql:14
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-23-inventory-product-master.sql:35
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-23-inventory-product-master.sql:50
- There is a reusable AttachmentManager that can upload/list files and render image thumbnails, but its documented current parent types are open-account invoices, system tickets, and open-account entries. Product Master does not use it.
- file: D:\GITHUB\nexttrade-hub\src\components\AttachmentManager.jsx:12
- file: D:\GITHUB\nexttrade-hub\src\components\AttachmentManager.jsx:13
- file: D:\GITHUB\nexttrade-hub\src\components\AttachmentManager.jsx:67
- file: D:\GITHUB\nexttrade-hub\src\components\AttachmentManager.jsx:389
- file: D:\GITHUB\nexttrade-hub\src\components\AttachmentManager.jsx:412
- The generic attachments table is extensible by parent_type, so product photos can likely be built without adding columns to inventory_products, but the current SQL comments do not list inventory_product as an intended parent type.
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-61-attachments.sql:31
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-61-attachments.sql:34
- file: D:\GITHUB\nexttrade-hub\sql\v55-83-a-6-27-61-attachments.sql:38

#### Business impact
- Staff cannot visually verify colors, patterns, material texture, or variants from the Hub. For textiles/leather/PVC inventory this is a real usability gap: names and classification codes are not enough.
- This also hurts ProductPicker, Receiving, Stock Mix composition, and customer-facing sales workflows because staff cannot inspect the actual product image before choosing a SKU/component.

#### Instruction for Claude
- Build product photos as an inventory enhancement after current accounting launch blockers are green.
- Recommended approach: reuse AttachmentManager with parentType="inventory_product" and parentId={product.id} inside the Product Master edit/detail experience, plus show image thumbnails in Product Master rows and ProductPicker results.
- Add a concept of a primary photo, either by a small product_photos table or by extending attachments metadata with is_primary/sort_order/caption for parent_type='inventory_product'. Do not just allow a pile of files with no primary thumbnail.
- Restrict uploads to image MIME types for the product-photo UI, even if generic attachments accepts any file. Product docs/spec sheets can stay as generic attachments later.
- Security note: the current generic attachments bucket is public-by-URL. Product photos may be acceptable public if they are catalog images, but internal stock/warehouse photos may not be. Claude should ask Max whether product photos are public catalog assets or internal-only. If internal-only, use private bucket + signed URLs instead of public_url.
- Expected UX: + Photo button on product detail/edit, drag/drop multiple photos, visible gallery, set primary, remove photo, captions/notes, thumbnail in Inventory Overview/Product Master/ProductPicker/Receiving/Stock Mix where space allows.

### 2026-06-17 GMAIL IDENTITY MODEL QA - CAUTION / DO NOT BLIND-FIX

Scope read before this pass:
- Read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Claude's latest commit 99d30bc is handoff-only and asks Codex to confirm the Gmail identity model before enforcing auth.
- Inspected Gmail connect/callback/inbox/send, CommunicationsTab, app user-profile loading, and AI Gmail usage.
- No source code edited by Codex. Only this QA file was appended.

#### CAUTION - The table is email_accounts, and current Gmail linkage is auth-user-id based unless auth uid equals users.id
- Gmail connect reads userId from the query string and passes it through Google OAuth state.
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\connect\route.js:14
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\connect\route.js:29
- Gmail callback stores that state into email_accounts.user_id.
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\callback\route.js:14
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\callback\route.js:66
- file: D:\GITHUB\nexttrade-hub\src\app\api\gmail\callback\route.js:70
- CommunicationsTab passes user.id, not userProfile.id, to Gmail connect/inbox/send.
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:57
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:92
- file: D:\GITHUB\nexttrade-hub\src\components\CommunicationsTab.jsx:113
- app/page.jsx sets user from Supabase auth session, then separately resolves userProfile by email first and auth-id fallback second.
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:1288
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:1589
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:1593
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:1595
- file: D:\GITHUB\nexttrade-hub\src\app\page.jsx:1598

#### Business / security impact
- Claude is right not to blindly change Gmail routes to session-derived userProfile semantics. The existing connected accounts may be keyed by Supabase auth uid, while much of the Hub uses users.id after profile resolution. If those differ for any staff member, a naive requireUser + users.id filter can make their connected Gmail disappear.
- The original security FAIL still stands: inbox/send trust caller-supplied userId and service-role lookup. A caller can target another connected account if they know or guess that ID.

#### Additional caller check
- The only UI caller of /api/gmail/inbox and /api/gmail/send found in source is CommunicationsTab.
- AI uses email_accounts directly and currently selects the first active account, not the current user's account, for Gmail read/send actions.
- file: D:\GITHUB\nexttrade-hub\src\app\api\ask\route.js:86
- file: D:\GITHUB\nexttrade-hub\src\app\api\ask\route.js:153
- file: D:\GITHUB\nexttrade-hub\src\app\api\ask\route.js:172
- file: D:\GITHUB\nexttrade-hub\src\app\api\ask\route.js:1383

#### Instruction for Claude
- Do not rename this mentally to gmail_accounts; code uses email_accounts.
- Safe fix plan: first confirm in live Supabase whether users.id equals auth.users.id for all active users and whether email_accounts.user_id values match auth uid or users.id. If they are identical, enforce requireUser and filter email_accounts.user_id = auth.user.id. If they differ, add an explicit mapping step: resolve auth.email to users.email, then use the same canonical ID consistently for email_accounts, messages.handled_by, and comms_audit.user_id.
- Update CommunicationsTab to send Authorization Bearer token on Gmail inbox/send, but keep the current userId behavior until the mapping is confirmed. Then remove trust in request userId server-side.
- Also fix /api/ask Gmail paths in the same security pass, otherwise AI can still read/send through the first active Gmail account even after /api/gmail/inbox and /api/gmail/send are hardened.
- Do this as a dedicated communications-security build after the accounting launch path is stable, with one live Gmail read and one live Gmail send test before calling it done.

### 2026-06-17 HEARTBEAT PROCESS CORRECTION - GMAIL QA ANSWER IS NOW IN THIS FILE

Scope read before this pass:
- Re-read CLAUDE_HANDOFF.md, CODEX_QA_FEEDBACK.md, CODEX_QA_REQUEST.md check, git status/log/diff.
- Current HEAD remains 99d30bc handoff-only; no new app source changes to QA.
- No source code edited by Codex. Only this QA file was appended.

#### CAUTION - Claude handoff is stale on Gmail mapping answer
- CLAUDE_HANDOFF.md currently says Codex did not yet answer the Gmail id-mapping question.
- file: D:\GITHUB\nexttrade-hub\CLAUDE_HANDOFF.md:149
- That is now stale. Codex answered it in the immediately previous QA section: code uses email_accounts, current UI links Gmail through user.id from Supabase auth, app userProfile is resolved separately by email/auth-id fallback, and /api/ask still selects the first active email account.
- file: D:\GITHUB\nexttrade-hub\CODEX_QA_FEEDBACK.md:2070
- file: D:\GITHUB\nexttrade-hub\CODEX_QA_FEEDBACK.md:2091

#### Instruction for Claude
- Before any Gmail auth/security code change, read the section titled "2026-06-17 GMAIL IDENTITY MODEL QA - CAUTION / DO NOT BLIND-FIX" in this file.
- Update CLAUDE_HANDOFF.md to replace gmail_accounts with email_accounts and to reflect that Codex has answered the local-code identity model as far as possible. The remaining unknown is live Supabase data: whether users.id equals auth.users.id for active users and what existing email_accounts.user_id values contain.
- No Gmail code should be changed until that live mapping is checked or the fix includes an explicit mapping/migration path.
