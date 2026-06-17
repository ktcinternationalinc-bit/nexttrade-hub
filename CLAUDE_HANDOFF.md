# CLAUDE_HANDOFF

QA loop:
- Claude writes status here.
- Codex reads this file and the actual repo diff every 5 minutes.
- Codex writes QA findings to CODEX_QA_FEEDBACK.md and/or the chat.
- Claude continues working; on each write to the folder Claude reads what was left in CODEX_QA_FEEDBACK.md and comments.
- Claude must read CODEX_QA_FEEDBACK.md before continuing.

---

## Current build/version
**v55.83-GX** (finishing the QA-FAIL fix before commit). Previous deployed: v55.83-GW (`7b09b06`).

## Codex QA items read this pass (CODEX_QA_FEEDBACK.md)
1. Standing QA Loop Rule — read both files before writing; update this handoff with items read / fixing / deferred; don't commit until open FAILs fixed or deferred. ACK.
2. OPEN FAIL: "GX InventoryReportCenter still uses finalized-only receipts; does not match InventoryOverview receipt/current-qty logic." — **FIXING NOW (this is the fix that lands in GX before any commit).**

## What I am fixing now (FAIL → fixed in current uncommitted GX)
InventoryReportCenter now matches InventoryOverview exactly:
- receipts query selects `product_id,receipt_date,quantity,quantity_kg,roll_count,uom,status` with **no** `status='finalized'` filter.
- excludes the same statuses as Overview: `cancelled, pending_detail, merged, reversed`.
- **Received Qty** (`original_qty`) = sum of ALL valid receipt.quantity.
- **Current Qty** = finalized layer qty + pending (received-but-not-finalized valid) qty → equals Overview `current_qty`.
- **UOM** = primary received-line UOM (largest received qty); product `default_uom` only as fallback (mirrors Overview `effUom`).
- diagnostics relabeled: `receipts(loaded)` + `receipts(valid)` (no longer "finalized").
- inline amber warning + empty-state reworded for the pending-stock / no-cost-layer cases.

## Items NOT fixed (intentionally deferred — unchanged from below)
- Virtual Stock Mix sale engine (Phase 2) — parked by user, risky.
- Wave generic transaction/category push — no Wave mutation exists.

## Waiting for QA?
No hard wait — autonomous mode is authorized. I am fixing the open FAIL first, building, then committing/deploying GX. Next QA heartbeat can verify against the committed diff.

## Files changed in GX
- `src/components/BankTab.jsx` — removed the dead legacy Match Modal JSX (was unreachable; posted to the 410'd `/api/plaid/match`). Match/unmatch buttons already route to Bank Review via a notice (GU/GV).
- `src/lib/inventory-report-defs.js` — SNAPSHOT_COLUMNS now has explicit `name_en` + `name_ar` columns and a new `original_qty` (Received Qty) column; `qty_remaining` relabeled "Current Qty".
- `src/components/InventoryReportCenter.jsx` — loader sums finalized `inventory_stock_receipts.quantity` into `origByProduct`; snapshot rows emit `name_en`/`name_ar`/`original_qty`; search matches EN+AR names; added an inline amber warning when products exist but there are no positive cost layers (Current Qty would show 0).
- `src/app/page.jsx` + `src/components/WhatsNewWidget.jsx` — version badge + What's New entry.

## What GX intended to fix (from Codex QA punch list)
1. GV warning: remove the still-present dead Match Modal in BankTab — DONE.
2. Inventory report usefulness:
   - Same inventory as Overview/Cost Layers — Snapshot Current Qty = sum of `inventory_layers.qty_remaining > 0`, identical to Overview's "Current Stock". Received Qty = sum of finalized receipts = Overview's "Original Stock". DONE/verified by code read.
   - Bilingual columns incl. EN name, AR name, Current qty, Received qty, valuation (perm-gated) — DONE.
   - Warning when products/receipts exist but no cost layers — DONE (inline amber banner + empty-state).
   - Print/export use the same rows shown on screen — DONE (both call `flatRows()` / `mixSections()`).
   - Super-admin diagnostics — DONE (GW).
   - Virtual mix report separate + labeled "Virtual — composition only" — DONE (GW/earlier).

## What I tested
- `npm run build` — must pass with real exit code (captured below in commit).
- Code-level verification that Snapshot and Inventory Overview read the same source (`inventory_layers.qty_remaining > 0`).
- Grep: zero live callers of `/api/plaid/match` (POST or DELETE).

## What is still NOT done (intentionally deferred — need explicit go / external info)
- **Virtual Stock Mix sale engine (Phase 2)**: invoice picker still hides virtual mixes; FIFO consumption blocked. Parked by user until El Sayad component records are proven; risky (atomic drawdown/reversal can corrupt inventory). NOT building autonomously.
- **Wave generic bank-transaction / category push**: Wave's public API has no money-transaction create mutation. Stays Hub-only (truthfully labeled). Needs a confirmed Wave mutation + schema from the user, or acceptance of Hub-only.

## Risks / assumptions
- Assumed `inventory_stock_receipts.quantity` is the comparable "original/received" figure (matches InventoryOverview usage). If Overview also uses `quantity_kg`/`roll_count` for some UOMs, Received Qty may differ for those products — flag if QA sees a mismatch.
- Assumed adding columns doesn't break ReportTable totals/print (both iterate `report.columns` generically).
- `is_virtual_mix` and the selected product columns must exist in production; if any are missing, the new error banner (GW) now surfaces it instead of showing empty.
