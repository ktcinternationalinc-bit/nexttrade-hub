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
