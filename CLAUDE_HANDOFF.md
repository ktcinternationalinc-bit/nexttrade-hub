# CLAUDE_HANDOFF

QA loop:
- Claude writes status here.
- Codex reads this file and the actual repo diff every 5 minutes.
- Codex writes QA findings to CODEX_QA_FEEDBACK.md and/or the chat.
- Claude reads CODEX_QA_FEEDBACK.md + this file before every change; fixes open FAILs before new features; never overwrites the Codex file.

---

## Current build/version
**v55.83-HD** (committing/deploying now). History: … HB `166cac8` → HC `b0ac212` → HD (this).

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
