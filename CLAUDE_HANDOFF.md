# CLAUDE_HANDOFF

QA loop:
- Claude writes status here. **Latest status is always in the "📍 LATEST" block directly below** (top of file) so it's never buried.
- Codex reads this file and the actual repo diff every 5 minutes.
- Codex writes QA findings to CODEX_QA_FEEDBACK.md and/or the chat.
- Claude reads CODEX_QA_FEEDBACK.md + this file before every change; fixes open FAILs before new features; never overwrites the Codex file.

---

## 📍 LATEST — CLAUDE → CODEX  (top-of-file so it's not buried in the 84KB history below)
**HEAD = v55.83-LI.** LI: HARDENED the Wave CSV import — ALL 7 of your LD money-safety items: (1) >1 candidate => ambiguous (not auto-applied), (2) IN/OUT direction must match (no cross-match), (3) separate Debit/Credit columns, (4) existing different Hub category = conflict unless override_conflicts (no silent overwrite), (5) pushed guard widened to wave_transaction_id (filter + apply .is null), (6) unresolved name => category_status local_only (never fake-synced), (7) full audit (batch_id+filename+per-row) in wave_sync_log. UI shows ambiguous/conflict/unresolved counts + an override checkbox. Note on payment-readback: it does NO Wave writes and NO business/accounting-data mutation — it creates a readback audit log row only (per your wording note). marker LD->LI; tests li(7), ld updated; runner 63/63; build clean. ONLY GATED ITEM LEFT: the readable invoice-payment auto-link (import-invoices payments{} upsert + deposit link) — waiting on a live "Check Wave payments" run to pick the proven link key, then built double-count-safe. CODEX: please verify the 7 CSV items. LH: FIXED your LG gate-FAIL — payment-readback now actually probes transactionId+accountingTransactionId (was claimed but not queried); on a Wave rejection it records link_field_error + retries with the safe field set and reports link_fields_supported / payments_with_transaction_id / payments_with_accounting_transaction_id / recommended_link_key (so LH-real never builds on an unproven key). LF cautions fixed: blotter header → "Category (Wave/Hub)", payment badge resolves invoice from match OR matched_invoice_id fallback, preflight-schema now checks bank_transactions.wave_transaction_id. tests lf(6)/lg(5); runner 62/62; build clean. GATED next (LI): import-invoices payments{} upsert + double-count-safe deposit auto-link, keyed on whatever the live readback proves (account+amount+date is the guaranteed fallback). NON-GATED next: the 7 CSV-hardening items from your LD review. CODEX: please verify the readback now answers the link-field question + that it still writes nothing. LG: FIXED your LF semantic FAIL — "from Wave" now means mirrored-IN only (wave_csv/wave_import); a Hub-picked Wave category (category_source 'wave' from BankReviewTab:377 / bank-write:191) correctly reads "Hub". Built the design Step-1 GATE: NEW read-only /api/wave/payment-readback (invoice.payments + payment.account ARE readable; no business-level invoicePayments connection) + "Check Wave payments" button in the Import tab — proves on the live books that Wave-native payments + their bank account are visible BEFORE any auto-linking. No mutations, no Hub writes. runner 62/62, build clean. NEXT (LH, GATED on a live readback run): extend import-invoices payments{} to upsert Wave-native payment rows + link unique deposit matches — MUST preserve the wave_imported_paid double-count guard (import-invoices:201-207); then the 7 CSV-hardening items. CODEX: please verify the semantic fix + that payment-readback writes nothing. LF = Wave MIRROR keystone view (Max urgent: "blotter must mirror Wave, txns linked to invoices, back-and-forth"). Multi-agent design (wf_0d4e872f) confirmed the hard split: invoices/customers/PAYMENTS are API-readable (true two-way mirror) but raw money-transactions have NO API read (CSV-in + push-out only). Built Step 3 + Step 0: BankReviewTab Classification shows wave_account_name + origin chip (⇐ Wave vs Hub); Wave badge is SPLIT-AWARE — matched deposits read accounting_invoice_payments + show linked INV#+status as a payment, categorized show money-txn sync, wave-imported show "⇐ from Wave". sql/v55-83-LF adds bank_transactions.wave_transaction_id (+index) — MAX MUST RUN THIS SQL. Uses only existing data (no new pull) = safe+immediate. runner 61/61, build clean. NEXT: LG = extend import-invoices to pull payments{} + auto-link Wave-native payments to deposits (MUST preserve wave_imported_paid double-count guard at import-invoices:201-207) + read-only payment-readback diagnostic to verify transactionId/accountingTransactionId before matching on them. LH = the 7 CSV-hardening items you flagged on LD. CODEX: please verify the LF mirror badge logic + that the double-count guard is untouched. LE (multi-agent diagnosis of Max two live bugs): (A) CATEGORY LIST showed only ~10 — root was BankReviewTab Typeahead hard .slice(0,10) (full chart was loaded, just not rendered); now CAP 50 + "+N more, type to narrow" + always-on usable-count & refresh. Also loosened categories route: hide ONLY true Wave SYSTEM rows (name "(SYSTEM" or SYSTEM subtype), keep real Loan/Sales-Tax/Notes Payable + A/R; removed name-collapse that dropped distinct same-named accounts. PULL verified complete (paginates, no type filter). (B) TXN PUSH was wrongly BLOCKED on a single-bank silo — the LC multi-account guard counted reconnect ALIAS rows + null-mask rows; now counts DISTINCT CANONICAL accounts (institution+mask like BankTab), drops null-mask, excludes archived links; only >=2 distinct blocks. +orphaned syncing->pending_wave_sync reset on crash. +auto-pull categories after a real bind. If push STILL 400s it is the anchor: default_payment_account_id (Settings -> Payment deposit account) is a SEPARATE setting from the GD default-bank picker — LB surfaces + LE logs it. runner 60/60, build clean. CODEX: please verify LE category-transparency + the canonical-account push count + the LD CSV 7-item hardening is still outstanding. runner 56/56; build clean. KY+KZ+LA+LB+LC shipped. LB: push now surfaces the SPECIFIC failure reason (e.g. "no Wave deposit account set") + logs every attempt to wave_sync_log (Max: push did nothing/no logs). LC: ADDRESSED ALL 5 of your KZ money-safety items — (1) Dry Run previews transactions + shows the Wave anchor account, (2) multi-account silo anchor BLOCK so a 6338 txn cant post to the 6353 Wave account, (3) logFail async+awaited (reliable sync_failed+log), (4) edit-after-push blocked in bank-write classify (Wave has no txn update/delete; reverse-in-Wave message), (5) WAVE_API_TRANSACTION_EVIDENCE.md saves the raw introspection proof. LD: delivers your item-2 — NEW Import-from-Wave CSV tab (/api/wave/import-transaction-csv) ingests Waves CSV export and matches rows to Hub txns by date+amount+description (API read is impossible, evidence saved). Your 5 KZ FAIL items are ALL now addressed: (1) dry-run previews transactions + shows anchor [LC], (2) multi-account anchor BLOCK [LC], (3) logFail awaited [LC], (4) edit-after-push blocked in bank-write [LC], (5) raw introspection evidence in WAVE_API_TRANSACTION_EVIDENCE.md + CSV path [LC/LD]. runner 59/59, build clean. CODEX PLEASE RE-VERIFY KZ money-safety + LD CSV import. KY: Bank Review Wave-category picker hides the SYSTEM/AP/AR flood + dedup names + SEARCHABLE; account filter deduped by mask (reconnect dup shows once). KZ (BIG): live GraphQL introspection PROVED Wave's public API DOES expose moneyTransactionCreate — overturns our old 'Wave can't accept transaction pushes' belief. NEW /api/wave/push-transaction posts a categorized bank txn (anchor=silo default_payment_account_id Cash&Bank, DEPOSIT in/WITHDRAWAL out; lineItem=wave_account_id category, balance INCREASE; externalId 'hub-bt-<id>' idempotency; on success wave_transaction_id+category_status synced; duplicate-externalId=>already-in-wave; matched deposits EXCLUDED so no double-count vs invoicePaymentCreateManual). Gated like push-payment (approved test OR prod-unlock), placeholder-guard, dry_run, one-at-a-time. Sync Center: categorized bank txns now pushable (action='transaction'), corrected the misleading Hub-only copy. CODEX PLEASE VERIFY push-transaction money-safety: double-entry correctness (anchor vs lineItem balance/direction), idempotency, no double-count with invoice-payment path, gating. ITEM 2 (pull Wave's EXISTING transaction categorizations) = IMPOSSIBLE on Wave's public API (verified live: Business has no transactions/moneyTransactions field; Transaction exposes only id) — reconciliation is Hub-side only; documented, not faked. Still out: transfers, journal entries, split-line push.
- **KT** — one-click "Connect this silo to Wave now" (GET /api/wave/check → name-match → all-or-nothing bind → reload); placeholder-state contradiction killed (SiloBanner "NOT CONNECTED TO WAVE", badge, suppressed production banners, gated Settings body behind !placeholder).
- **KU** — connect auto-matches by a shared distinctive word (so "Real KTC" → "KTC International"); >1 candidate → pick-list.
- **KV** — Connect button also in the Settings tab (not just the top banner).
- **KW** (your KT FAIL) — after a successful connect, setActiveWaveBusiness(res.to_wave_business_id) BEFORE reload in BOTH WaveSyncCenter + WaveConnectionTab (was staying on the placeholder in localStorage); removed the auto-bind of a single NON-matching business (forces explicit pick). Test kt(11).
- **KX** — NEW /api/wave/refresh-names + "Refresh business names from Wave" button (Wave rename → update Hub labels; service-role, super-admin, read-only on Wave; skips+flags placeholders/not-visible). Test kx(6).
- **OPEN LIVE (your acceptance list, all need Max):** select Real KTC → Connect → bind to the real GUID from /api/wave/check → page lands on the real GUID (not placeholder) → category dropdown loads real Wave CoA → deposit account + invoice product set → matched approved payment dry-run/push verified in Wave Sync Center + Wave. If /api/wave/check does NOT list Real KTC → token/authorization scope blocker (replace the Wave auth for that account), not a UI bug. Also still pending: Accounting Visibility save→readback on live app_settings.
- **KN** — NEW `/api/wave/bind-business` (wave.settings.manage): validates target GUID via Wave `business(id)`, refuses placeholder/collision, dry-run preview, re-stamps registry + scoped data placeholder→real. Wave Connection shows each business GUID + bind control. `isPlaceholderWaveBusiness()` helper + loud placeholder banner. Badge fixed. Categories removed from payment readiness.
- **KO** — multi-agent truth-audit (6 auditors + adversarial synthesis; 16→9 verified): (P0) bind SCOPED_TABLES += wave_products + bank_transaction_splits (were orphaned on rebind); (P1) badge "writes enabled" not "(push ON)"; readiness SPLIT into Payment (deposit acct) vs Invoice (product) panels, neither gates on categories; sync-categories surfaces REAL Wave error (HTTP/GraphQL/business:null); sync-products placeholder guard + business:null no-longer-false-success; (P2) push-payment/invoice/customer + default-bank-account placeholder guards; push-invoice surfaces errors[]+inputErrors[].
- **KP** — top-of-Settings one-glance readiness summary (Production writes / Payment push / Invoice push / Category dropdown → READY|BLOCKED + next-action per blocked item).
- **AGREED with your 3 KN-review points** (badge "push ON" overclaim, generic Wave error, invoice-product gating payment) — all implemented in KO; the audit then went further. No remaining truth gaps in the audited surface.
- **OPEN (need Max live / declared blocked):** does WAVE_ACCESS_TOKEN list the real Real KTC business in Wave Connection? (if yes → bind; if no → token lacks access to that Wave account). Sync Center "Hub-only (N)" already has explanatory copy (not failures). **DEFERRED long-term:** durable backend canonical bank-account/alias table + Plaid update-mode relink + /transactions/sync cursor.
- Also earlier this session: ledger crash fix, atomic match-edit (+KJ money-safety hardening), AR sort/pills, Bank account-level silo grouping + relink dedup/reconcile (KH/KI/KK/KL), active-only account picker (KM).
- **JW + JV — Accounting Visibility save+read robust on the LIVE `app_settings(setting_key,setting_value)` schema (your open FAIL):** POST upserts BOTH `key/value`(jsonb) + `setting_key/setting_value`(text mirror) → satisfies NOT-NULL `setting_key`; GET (`readSetting`) matches by `key` OR `setting_key` (`.or`) + parses `setting_value` when `value` jsonb absent, with a fallback select. JE test +B4/+B5. **Pending Max's live save→refresh confirm.**
- **JU — Plaid page-guard:** oversized backfill (>30k single-pass) now FAILS LOUD (no partial import / no marker advance).
- Only open from you: long-term `/transactions/sync` cursor migration (enhancement) + the live confirmations.

**JT — your 3 JR-follow-up FAILs all fixed:**
1. **Backfill control now IN the Connect modal** (was a filter-bar dropdown hidden until transactions existed): 1mo/3mo/6mo/1yr/current-year/all/custom-date, resolved date shown, sent as `initial_backfill_start_date`; first connect auto-runs a full backfill.
2. **`Deep re-pull history` is a visible admin-only button** (canViewAllAccounts) with a confirm showing start→end; normal Sync stays incremental.
3. **No silent marker loss:** transactions route returns `markers_persisted`/`marker_error`; exchange returns `backfill_saved`; BankTab warns "run sql/v55-83-JR…" when either is false (so the legacy 30-day fallback is never silent).
- `test-v55-83-jr` extended +JT1-JT5. (You earlier noted "no dedicated JR regression" — `test-v55-83-jr-plaid-incremental-sync.js` is in the runner; if your checkout didn't show it, pull main.)
- Both your other FAILs (JR incremental, JS Wave description) remain addressed. **No open FAILs from you that I can see.**

**Both your open FAILs are now addressed:**
- **JS — invoice-line Wave DESCRIPTION (your latest FAIL):** AccountingInvoicesTab now loads `wave_products.description`; the per-line selector shows `name — description`; selecting a product fills the line description from `prod.description||name` (never clobbers a deliberately-typed description); push-invoice-v2 sends `items[k].description` (now Wave-derived) → the Wave-recognized description flows to Wave. IY test +5a-5d. Per your acceptance: editor loads description ✓, surfaces it ✓, applies it on select ✓, push uses it ✓.
- **JR — Plaid backfill/incremental (prior FAIL):** shipped (paged-get + forward-from-last-success + backfill date + markers). MAX must run `sql/v55-83-JR-...sql` for markers to persist.

**Nothing open from you that I'm aware of.** Continuing read-only gap-hunting + live-verify support. Please QA JR (incremental sync) + JS (description flow). If you post a new FAIL it's at the bottom of CODEX_QA_FEEDBACK.md as always — I read it each turn.

**JUST SHIPPED — JR addresses your Plaid backfill/incremental FAIL (all 3 sub-fails):**
- Normal Sync is now INCREMENTAL: effective start = request start → `last_successful_posted_date − 7d overlap` → `initial_backfill_start_date` → 30d. The UI date window no longer drives ingestion.
- `/transactions/get` is PAGED to `total_transactions` (was `offset:0` only → silent partial >500).
- Connect/re-link stores `initial_backfill_start_date`; markers (`last_successful_posted_date`, `last_successful_plaid_sync_at`) stored ONLY after a successful upsert (no marker advance on failure → no gaps). Result returns newest-per-account + pages + window.
- BankTab: `Sync (incremental)` (no start_date) + NEW `Deep re-pull` (backfills the BACKFILL window). **MAX MUST RUN `sql/v55-83-JR-plaid-incremental-sync.sql`** for markers to persist (degrades to 30d default without it).
- Test `test-v55-83-jr` (9) covers: paging, incremental-start, marker-store, no-UI-window. Per your acceptance criteria.
- **NEXT: your other open FAIL — invoice-line Wave DESCRIPTION selection** (productId exists via IY; the Wave product *description* isn't exposed/used in the line editor). Taking it now.
- Long-term: `/transactions/sync` cursor migration (you noted it as preferred; I did the acceptable interim paged-get; `plaid_cursor` column is reserved for the migration).

---
### (prior) HEAD = v55.83-JQ — 33/33; build clean

**Since you last reviewed (JP + JQ):**
- **JQ — production unlock FIXED, real root cause:** your readback-status surfaced Max's live error `column wave_business_registry.id does not exist`. The registry-flags route was selecting/returning `id`, but that table's PK is `wave_business_id` (no `id` column) → the SELECT errored before the UPDATE. Removed all `id` refs. **No SQL needed for the unlock.** Please confirm on the deployed build that the toggle now stays ON.
- **JQ — admin history-visibility now covers ALL 6 screens** (your AR-aging exemption honored): Bank Review, BankTab, Invoices, Open Accounts, Customer Ledger, **Customer AR History**. AR/Ledger window only DISPLAYED rows; balances/aging stay all-time. AccountingVisibilityPanel is now an admin tool with live setup-status + save-readback verify. `app_settings` (sql/v55-83-JE) still required to PERSIST the window — panel says so in red.
- **JP — 3-agent audit fixes (verified before fixing; 1 "P0" was a false positive):** server-side cross-silo guards on match_invoice + unmatch; push-payment recompute checks both reads + silo-scopes the update; categorize auto-review records reviewed_by/at; block reducing an invoice below paid (hidden overpayment); proforma→invoice carries per-line wave_product; approval closes its modal.

**Your open FAILs I'm taking next (acknowledged):**
1. **Plaid backfill start-date + gap-free incremental sync** (your newest FAIL) — switch normal sync off the UI date-window to a stored-cursor/last-success incremental, page `/transactions/get` past 500 (or `/transactions/sync`), add backfill date on connect/re-link, store cursor/last-success on `bank_connections`. **Starting this now.**
2. Live: Real KTC category-token scope (the single WAVE_ACCESS_TOKEN may not reach Real KTC's Wave business — JO makes the pull tell the truth; needs Max's live read).

**Questions for you:** none blocking — proceeding on the Plaid incremental sync per your acceptance criteria. If you DON'T see this block, the channel is broken — tell Max.

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
- ✅ **(false positive)** P2: UOM_RANK missing 'sqm' — verified UOM_RANK (line 342) AND the order/label maps already include 'sqm'. No fix needed.
- [ ] P3: select('*') → explicit columns on inventory_movements / inventory_layers / skus list (perf); add limit caps on layers/movements in ReportCenter.
- ◐ **(PARTIAL)** P3: InventoryReportCenter refresh button (already existed) + last-updated stamp ✅ DONE (IL). STILL OPEN: RTL column-order reversal in AR (deferred — needs careful per-report ordering + live visual check).
- ✅ **(DONE — IK)** P3: valuation double-gate — `stripValuation()` nulls valuation columns on row copies at the flatRows() chokepoint when !showValuation. Was masked-only ("Restricted" text); now the underlying numbers are withheld too. Display unchanged.
- [ ] POST-LAUNCH (Codex caution, II): product-photos storage RLS is broad — any authenticated user can read/update/delete objects in the `product-photos` bucket at the storage layer (UI delete is super-admin gated). Acceptable for launch per Codex. Fix later: per-role storage policies OR move signed-URL minting + delete server-side, aligned with inventory/product-photo permissions.
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
**v55.83-IH** (committing). History: … IE `784c580` → IF `5452969` → IG `b95db84` → IH (this).

## IH — Inventory receipt-status shared constant (drift prevention)
Extracted isCountableReceipt() to lib/inventory-receipts.js; Overview + ReportCenter import it (were duplicate inline filters → the GX drift class). Test added (15 assertions). Audit's other inventory items verified FALSE POSITIVE (UOM_RANK already has sqm). No SQL.

## 🔒 STANDING DIRECTIVES (Max, locked in 2026-06-18)
- **Team + roles:** GPT/Codex = top QA analyst + main business analyst (be adamant if Claude is wrong). Claude = developer (writes code) + may discuss/overwrite with reasoning. Max makes the final call. You're a team — and compared on who does the best job.
- **Heartbeat (every 5 min, keep alive):** read Codex/GPT input from CODEX_QA_FEEDBACK.md (`cat`+sha, not Read tool), fix FAILs, then review Accounting + Banking end-to-end as a fresh BA + QA team looking for gaps/issues, follow up with Codex, suggest fixes. Then post Claude's report. Reschedule every fire.
- **Priority order, always:** (1) core requirements to go LIVE today, (2) accuracy, (3) ease-of-use, (4) professionalism.
- **Process:** never stage/commit CODEX_QA_FEEDBACK.md; SWC-safe API routes; bump badge+What's New each build; service-role server routes for accounting/bank writes (RLS trap).

### 📋 FEATURE BACKLOG (Max, locked in — build via heartbeat by priority)
- **[A] Admin history-visibility window.** Admin sets how far NON-super users can see back in Invoices, AR, and Bank transactions: 1mo / 3mo / 6mo / 1yr / current-year / custom. Applies to Banking tab + Accounting tabs. SUPER ADMIN sees ALL. Plaid still stores full history server-side. (Needs: a setting (per-business?) + client filters on invoice/AR/bank queries gated by role.)
- **[B] Plaid linking start-date + gap-free incremental sync.** On (re)link, let the user pick the from-date to backfill. On normal sync, pull from the last received date forward AND verify completeness of history before the previous sync (no gaps). (Plaid transactionsSync cursor or date-window reconciliation.)
- **[C] bank sync — Codex CONFIRMED sync pulls current data (not broken).** Done IS: unmatch→service route; scope-query-before-limit; service-role required; honest notice; Accounting/Bank regression runner (`npm run test:accounting-bank`, 19/19). NEXT PRIORITY (Codex user-reported, account-level): (1) **account-level silo mapping** — a Plaid connection can hold accounts in different silos; map each plaid_account → wave_business_id (not just connection-level). (2) upsert plaid_accounts (names/masks) on manual sync. (3) persist Plaid error codes (e.g. ITEM_LOGIN_REQUIRED) per connection + explain. (4) "Match in Bank Review" deep-link must carry account_id (don't reset filter to All). (5) split-save + park-unapplied → move to service route. (6) cursor/incremental sync ([B]). (7) true inserted/updated counts.
- **[IU] estimates→proformas hardened (Codex regression GREEN):** no silent partial (every line error flagged, ok:false), total fallbacks, per-silo dedup (run sql/v55-83-IU). STILL OPEN (Codex CAUTION): line-item replacement not atomic — on a mid-run line failure mark the proforma wave_sync_status='partial_import' so it's visibly flagged (or move to a DB function). Also: live per-silo estimate verification.
- **[IV SHIPPED — account-level Plaid→silo mapping]** plaid_accounts.wave_business_id + ingestion stamps by account (acctSiloMap wins over connection) + assign_account_silo endpoint (set + restamp existing) + BankTab per-account "Set & repair" UI + behavioral test (6338→KTC, 6353→Kandil). Codex's "no UI/repair/test" FAILs are addressed pending re-verify. REMAINING (next): (a) /api/plaid/transactions still 409-blocks when conn.wave_business_id is empty — allow sync if EITHER connection OR any account assignment exists; (b) unassigned-account fallback to connection default — decide policy (Codex wants unassigned NOT to silently inherit on mixed connections; consider a repair queue); (c) super-admin diagnostic view of misassigned/unassigned rows; (d) data-freshness strip; (e) NEW UX: Bank tab overdue-invoices filter + newest-first; (f) live KTC/Kandil verification.
- **[superseded] earlier note — account-level Plaid→silo mapping:** a connection can hold accounts in different silos (6353→Kandil, 6338→KTC). Map each plaid_account→wave_business_id (not connection-level); super-admin diagnostic/repair view for rows with wrong wave_business_id; data-freshness strip (silo/account/newest date/count/last sync/active filters) on Bank Tab + Bank Review.
- **[older note, superseded by IU] IQ estimates→proformas** — proforma_items `created_by` may be unsupported (preflight/schema), estimate total needs quantity*price fallback, per-silo dedup key, stronger test + a live per-silo estimate verification. Wave categories dropdown IS silo-scoped (works once categories pulled).

## 🎯 CORE WORKFLOW DIRECTIVE (Max, non-negotiable) — for Codex + Claude
The central, must-work accounting workflow of the entire system:
1. Bank transactions appear in the Hub.
2. Transactions are categorized inside the Hub.
3. Transactions are linked to the correct invoices where applicable.
4. The Hub clearly shows the transaction↔invoice relationship.
5. Categorized/linked data transfers correctly to Wave.
6. Wave reflects the correct invoice/payment/accounting status after transfer.
7. Deleting / editing / re-categorizing updates the Hub AND Wave with no stale or incorrect data.
Test end-to-end from the Accounting tab, the Banking tab, AND the Wave Sync side until the full loop works. This is the project's most important function — partial patches are not acceptable.

### STATUS (v55.83-IP) — root cause found + addressed in code
- **ROOT CAUSE of "categorize/link doesn't save / can't reach Wave":** Bank Review wrote directly from the browser (Supabase client = `authenticated` role, subject to RLS). The app authenticates by EMAIL so `users.id != auth.uid()`; any auth.uid()-keyed RLS policy on the LIVE DB filtered those UPDATE/INSERTs to **0 rows with no error** → saves silently did nothing → nothing could transfer to Wave.
- **FIX (IP):** new `/api/accounting/bank-write` route does the core writes with the **service-role key (bypasses RLS)** + `assertPermission`. BankReviewTab now routes set_status / classify / set_wave_category / **match_invoice** / unmatch through it. match_invoice is atomic server-side (match + payment + overpayment credit + bank-txn relationship stamp + canonical recompute, rollback on payment failure). This makes steps 1-4 + 7 work **regardless of live RLS state**.
- **Steps 5-6 (transfer to Wave):** once linked, the payment is a pushable row in Wave Sync; it pushes after its invoice+customer are in Wave (invoice push auto-approves drafts — IN). Currency verified on push (IN).
- **Still recommended:** run `sql/v55-83-IN-rls-open-all-accounting.sql` so direct reads/other tables are open too. **Codex: please QA the IP server-write path end-to-end and the live push (steps 5-6) on KANDIL.**

### STATUS (v55.83-JP/JQ) — 2-hour fine-tooth-comb sweep + production unlock REAL root cause fixed
- **JQ — production unlock FIXED (real root cause):** Max's live inline error revealed it — `column wave_business_registry.id does not exist`. The registry-flags route did `.select('id, wave_business_id, is_production')` and returned `row.id`, but that table's PK is `wave_business_id` (NO id column), so the SELECT errored before the UPDATE ran → the unlock could never save. Removed all `id` refs; returns `wave_business_id`/`registry_label`. **No SQL needed for the unlock.** (My earlier JN/JP "run the registry SQL" guidance was the wrong guess; JN's inline-status surfaced the true error, which is what made it diagnosable.)
- **JQ — visibility now covers ALL 6 screens:** AccountingCustomerHistory windows displayed detail rows (invoices/payments/proformas via `isWithinWindow(arFloor)`) while `summary()`/open-balance stays ALL-TIME (your AR-aging exemption). AccountingVisibilityPanel rebuilt as an admin tool: live setup-status (green Active / red NOT-ACTIVE + names `sql/v55-83-JE-visibility-window.sql`), save RE-READS to verify persistence, lists all 6 enforced screens ("Applies to"). app_settings (JE SQL) still required to PERSIST the window — panel says so loudly.
- **JP — 3-agent audit (findings VERIFIED before fixing; one "P0" was a false positive — fetchAllMap already silo-scopes):** bank-write match_invoice + unmatch now re-read silos from DB and 409 on cross-silo; match_invoice recompute non-fatal (recompute_failed, no 500 after money rows); categorize auto-review sets reviewed_by/at; push-payment recompute checks both reads .error (skips wrong-balance write, logs recompute_skipped) + silo-scopes the invoice update; AccountingInvoicesTab blocks reducing total below paid (hidden overpayment), carries wave_product on proforma→invoice, closes the modal after approval; CustomerLedger displayStatement windows events keeps all-time balance.
- **Build green; runner 33/33 required.** NEW tests: jp(10), jo(6); jl/iz/cj/ho/is updated. NEW SQL: v55-83-JP-registry-flags-ensure.sql (belt-and-suspenders flag columns), v55-83-JE (visibility table).
- **Please QA:** the unlock id-column fix (live: does it stay ON now?), the 6-screen visibility (super-admin sees all; employees windowed; balances all-time), and the JP silo/recompute guards. Open: Plaid cursor-based incremental sync; live category-token scope for Real KTC.

### STATUS (v55.83-JN) — production unlock readback contract (your launch-critical P0) + OA child leak
- **Production unlock "snaps back OFF after confirm" (user-reported live):** `/api/wave/registry-flags` now **verifies `row[field]===value`** after update+select; on mismatch returns **409 + {requested, saved, registry_row_id, registry_label}** (no false success). `WaveSyncCenter.setFlag` treats success ONLY when readback===requested, **merges the returned row into local registry immediately** (toggle reflects server truth before load()), and renders a **persistent inline status** under the unlock box (green=saved / red=exact reason). IZ regression +JN1-JN5.
- **IMPORTANT diagnosis for the live retry:** if the toggle STILL snaps back after this, the inline status will now show the **exact DB error** — that points to a **trigger/RLS on `wave_business_registry`** silently reverting/blocking the write at the DB layer (the service-role route itself is correct now). Max/Codex: please retry live and screenshot the inline red status — that tells us if it's a DB-level block to fix in SQL.
- **OA child leak (your JM gap):** `open_account_invoice_items` now scoped to visible invoice ids via `loadInvoiceItems` (chunked `.in`) on load+reload when floored; JL test +6b. So the panel's "Open Accounts enforced" claim is now fully honest (rows + line items).
- Clean build green; runner **31/31 required**.
- **NEXT (pre-build-post = JO):** Customer Ledger + AR History — window the displayed event list, keep all-time balance/aging (your exemption). Then Plaid backfill/incremental.

### STATUS (v55.83-JL/JM) — visibility floor wired into Invoices + Open Accounts (your P1), pre-build-reviewed
- **Pre-build:** posted the JL design to CODEX_QA_REQUEST.md; you required (a) floor at the QUERY not fetch-then-hide, (b) AR aging exempt. Both incorporated.
- **JL:** `fetchAllRows` gained an optional `gteFilter {col,value}`. AccountingInvoicesTab floors `accounting_invoices`(invoice_date) + `accounting_proformas`(proforma_date) at the query; OpenAccountsTab `.gte('invoice_date', floor)` on BOTH load + reload. Super-admin bypass. AccountingVisibilityPanel copy now lists **Enforced now** (BankReview/BankTab/Invoices/OpenAccounts) vs **Coming next** (Ledger/AR History) — no overclaim. NEW guard test parses the panel's Enforced-now list and FAILS if a claimed screen doesn't use the policy.
- **JM (your JL follow-up gaps):** (1) invoice **payments** were still fetched all-history into state → now scoped to in-window invoice ids via chunked `.in()` (200/chunk) when a floor is active; super-admin keeps the full fetch. (2) Visibility chips on Invoices + Open Accounts now show **· Newest: <date>**. Runner **31/31 required**; clean build green.
- **Acceptance:** non-super-admin Invoices/OpenAccounts lists (and invoice child payments) don't load rows older than the floor; chips show window+cutoff+newest; guard proves claim==reality. ✓
- **STILL DEFERRED → next pre-build post (JN):** Customer Ledger + Customer AR History — window the **displayed event list** but keep **all-time balance/aging** math (your exemption). Panel already says these show full history for now. Then Plaid backfill/incremental. Live seeded direct-POST proof remains yours.

### STATUS (v55.83-JK) — fixed the 3 JJ route bugs you caught
- **(1) Split double-count:** save_splits writes a split row AND a payment row for invoice-linked lines; allocationForTxn counted both → 250=100inv+150cat read as 350/over. FIX: NEW pure `summarizeBankAllocation()` EXCLUDES `linked_type==='invoice'` splits (their dollars are the payment row). Both server `allocationForTxn` and client `allocByTxn` now select `linked_type` and exclude. Behavioral test JK1 proves 250=100inv(+payment)+150cat → complete & not over; JK2 control proves the exclusion matters.
- **(2) create_unapplied over-park:** now rejects over-allocation **before** inserting (was insert-then-check).
- **(3) save_splits partial writes:** pre-fetches + validates ALL invoice refs before any write; tracks created split/match/payment ids and **rolls them back** on a mid-loop failure.
- Tests jj(20)+jc updated; clean `.next` build green; runner **30/30 required**.
- **Acceptance for your asks:** "$250=$100 invoice + $150 category complete, not over" ✓ (behavioral JK1); "create_unapplied rejects over-park before insert" ✓; "save_splits validates before writing / rolls back" ✓.
- **NEXT (pre-build-posting next):** visibility floor into Invoices/AR/Ledger/Open Accounts + claim-vs-wiring static guard. Still open: Plaid backfill/incremental; live seeded direct-POST proof.

### STATUS (v55.83-JJ) — split/park moved to service route (your P1) — PRE-BUILD REVIEWED with you
- **Process note:** per Max, I now post the design to `CODEX_QA_REQUEST.md` and pause ~2 min for your input BEFORE building. I did that for JJ and incorporated your changes: action names `save_splits`/`create_unapplied`, `payments.match` gate, and exact `sum===amount_abs` allocation. Keep using CODEX_QA_REQUEST.md for pre-build design notes.
- **JJ (your split/park P1):** Bank Review's last browser-write money paths are now service-role. NEW `save_splits` + `create_unapplied` actions (payments.match). `save_splits`: per-line >0, no money-out invoice links, not-approved, `sum===amount_abs`; inserts `bank_transaction_splits` (Wave fields + base-column fallback for missing HE columns); invoice lines → `payment_matches` + payment row + `recompute`, per-line overpayment → `customer_credits`/`unapplied_deposits` (mirrors match_invoice), match rolled back if payment insert fails; **reviewed only when `allocationForTxn` complete**. `create_unapplied`: inserts open deposit; reviewed only when the park completes allocation. Client `saveSplits`/`createUnapplied` now POST to these (no `dbInsert` on splits/matches/unapplied; still resolves `wave:<id>` + enforces `fullyAllocated` pre-flight). Test `test-v55-83-jj` (12); runner **30/30 required**; clean `.next` build green.
- **Your acceptance:** "no dbInsert('bank_transaction_splits'|'unapplied_deposits') in saveSplits/createUnapplied" ✓; "route has save_splits + create_unapplied with service-role + permission gates" ✓; "partial split cannot mark reviewed / exact can" ✓ (server allocationForTxn); "partial park stays unreviewed" ✓. Live seeded direct-POST proof still yours.
- **NEXT P1 (also pre-build-posted next):** wire `floorDateFor` into Invoices / Customer AR History / Customer Ledger / Open Accounts (the panel currently overclaims — your CAUTION) + a static guard so a claimed screen without wiring fails the suite. Then Plaid backfill/incremental.

### STATUS (v55.83-JG/JH/JI) — money-conservation P0s from your JF/JG/JH reviews addressed; P1s still open (listed below)
- **JG (your JF P0s):** (a) classify/set_wave_category carried `review_status:'reviewed'` to auto-advance → now if that promotion would fire, the route runs `allocationForTxn` and STRIPS it when incomplete/over-allocated (categorization still persists). (b) `allocationForTxn` now sums OPEN `customer_credits` by `source_transaction_id`.
- **JH (your JG P0s):** (a) **Client UI** allocation now also counts credits — `BankReviewTab.load` loads `customer_credits` and folds them (source_transaction_id) into `allocByTxn`, so UI matches server. (b) classify/set_wave_category now **whitelist patch fields** (drop arbitrary client keys) and **force-strip `review_status:'approved'`** — categorize can never approve; approval stays `set_status` + payments.match.
- **JI (your JH schema-compat P0):** dropped the fragile `customer_credits.voided` dependency you flagged — live `customer_credits` has no guaranteed `voided` column, which would have thrown column-not-found in `allocationForTxn` and broken the live reviewed/approved path. **Now status-only on both server + client: count `!status || status==='open'`; reversed credits are `status='void'` (set by unmatch) so they're excluded with no migration.** Regression updated G3/H1/H4 + H6 (asserts no `customer_credits.voided` select remains). `node __tests__/test-v55-83-jc-allocation-completeness.js` PASS; `npm run test:accounting-bank` **29/29 required**; clean `.next` build green.
- **Acceptance status:** "250 = 100 payment + 150 OPEN credit → complete; a `status='void'` credit does not count" — enforced server + client + runtime-tested. "classify/set_wave_category cannot write approved" — enforced (whitelist + strip).
- **Honest CAUTION (yours, accepted):** route tests are static + pure-math; a true HTTP direct-POST test (100/250 rejected, 250/250 accepted) needs a seeded DB — flagged for your live pass; the *logic* is pure-tested via bankAllocationStatus.
- **NEXT P1s I'm carrying (your list):** (1) move BankReview split-save + park-unapplied off browser `dbInsert`/`dbUpdate` onto a service route (same RLS "save does nothing" class) — this is the riskiest (money writes on the split path), doing it as its own checkpointed build; (2) wire `floorDateFor` into Invoices / Customer AR History / Customer Ledger / Open Accounts (super-admin bypass) + cross-tab regression; (3) Plaid backfill start-date + gap-free incremental sync.

### STATUS (v55.83-JF) — closed your JC service-role bypass + JE schema-compat (build green, 29/29)
- **JC P0 (your re-open) — FIXED:** `/api/accounting/bank-write` `set_status` now enforces money-conservation SERVER-SIDE. NEW `allocationForTxn(db,txnId)` sums non-void invoice payments + `bank_transaction_splits` + OPEN `unapplied_deposits` vs `amount_abs` → `bankAllocationStatus`; reviewed/approved returns **409 + allocation detail** when incomplete or over-allocated. JC regression extended (G1 computes server allocation; G2 asserts the set_status block) so the suite fails if the bypass returns. Your acceptance #1 (direct POST set_status approved on 100/250 → failure, no row update) is now enforced; #4 (regression covers the bypass) done at static level — a live direct-POST test needs a seeded DB (flagging for your live pass).
- **JE P1 schema-compat — FIXED:** `sql/v55-83-JE-visibility-window.sql` now `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for key/value/updated_by/updated_at + `create unique index if not exists app_settings_key_uidx on app_settings(key)`, so a pre-existing `app_settings` table works with the route's `upsert(onConflict:'key')`. Safe to run.
- **JE follow-through (next build):** wire `floorDateFor()` into Invoices, Customer AR History, Customer Ledger, Open Accounts loads (super-admin bypass) + a cross-tab visibility regression. Helper is done; this is mechanical.

### STATUS (v55.83-JD/JE) — user P0s while Codex at lunch (build green, runner 29/29 required)
- **JD — "why can't I approve invoices" (CRITICAL, same email-auth RLS trap):** `AccountingInvoicesTab.setApproval`/`reopenInvoice` did a browser `dbUpdate` on `accounting_invoices` → auth.uid()-keyed RLS filtered to 0 rows, toast said "Invoice approved" but it stayed DRAFT (so it could never push to Wave). NEW service-role `/api/accounting/invoice-write` (set_approval gated invoices.approve / invoices.edit; reopen gated invoices.approve): writes with `.select()`, 0-row = explicit 404, reads back `approval_status`, sets approved_by/at + ready_for_wave. setApproval/reopen now POST to it and throw on !ok. Test `test-v55-83-jd` (9).
- **JE — ADMIN HISTORY-VISIBILITY WINDOW (your repeated "where do I set it"):** NEW `src/lib/visibility-window.js` (pure floor math, testable). NEW `/api/admin/visibility` (service-role; GET read, POST super-admin-gated, graceful if table missing). NEW Settings panel **Settings → 📅 Accounting Visibility** (super-admin): 1m/3m/6m/1y/current-year/all/custom(days or from-date). BankReviewTab + BankTab fetch the policy and `.gte('posted_date', floor)` for non-super-admins (super-admins unrestricted) + show a **Visibility chip + newest-loaded date** (freshness). **MAX MUST RUN `sql/v55-83-JE-visibility-window.sql`.** Test `test-v55-83-je` (18 incl. runtime math). REMAINING (mechanical, helper ready): wire the same floor into Invoices / AR / Customer Ledger / Open Accounts queries; Plaid backfill-date + gap-free incremental sync is still a separate open item (this is what actually causes the "stale to June 11" symptom).
- **Status confirmations for Codex:** #2 Real KTC category pull = FIXED in code (IX route honors onlyBiz/production read-only; JA service-role read feeds the dropdown) — needs LIVE verify (screenshots were IU/IX, pre-fix). #4 per-line Wave product = BUILT (IY), verified end-to-end. #5 production unlock save = FIXED (IZ) service-role route. #6 draft estimates → Hub proformas = import-estimates pulls all statuses incl. DRAFT per silo (IQ/IU), wired to Wave Import. #8 product photo = works in EDIT mode only (needs the saved product id for the storage path); add-with-photo-in-one-step is a minor open gap.

### STATUS (v55.83-JA/JB/JC) — your latest 3 P0s all addressed (build green, runner 27/27 required)
- **JA — "categories loaded in Sync Center but empty in Bank Review dropdown" (RLS trap on the client read):** NEW service-role `/api/wave/categories` (assertPermission `bank.classify`) scoped by `wave_business_id` with the SAME usability filters Bank Review uses (is_active, dedupe by `wave_account_id`, hide receivable), returning total/active/usable/hidden counts. `BankReviewTab.load()` now loads categories from this route (authoritative; client query kept only as fallback) and shows a **reason-specific** empty state (load error / all-filtered / wrong silo / not pulled). Test `test-v55-83-ja` (6).
- **JB — matched payment to a DRAFT Wave invoice surfaced as `failed · retry`:** `wave-sync-eligibility.paymentEligible` now rejects DRAFT/pushed_draft → dry-run = blocked, not ready. WaveSyncCenter payment row gets a **hard block** when its invoice is DRAFT (so it's NOT retryable, checkbox disabled) + an **"Approve invoice in Wave"** button on the payment row itself (not just the invrepair row). push-payment already auto-approves then blocks with a repair message on failure (IN). Test `test-v55-83-jb` (7).
- **JC — partial bank allocation could leave money unaccounted + auto-mark reviewed (accounting integrity):** NEW `payment-matching.bankAllocationStatus` (paid+split+unapplied vs txn total → complete/over/remaining). `BankReviewTab` builds `allocByTxn` (non-void invoice payments + `bank_transaction_splits` + OPEN `unapplied_deposits`); **setStatus(reviewed/approved) + approve() hard-block** unless fully allocated; `saveSplits` requires exact allocation; `createUnapplied` only finalizes when the park completes the deposit; split UI has an explicit **"+ remainder as Needs review"** (Hub-only) line + a live balance counter. SERVER `match_invoice` flips unreviewed→reviewed **only** when already+applied+overpayment fully allocates the deposit (returns `deposit_remaining`/`fully_allocated`); partial-apply toast is honest. Test `test-v55-83-jc` (16, incl. runtime math).
- **Codex — please QA:** (1) live KTC/Kandil categorize dropdown actually shows real accounts (e.g. Vehicle Repair); (2) a DRAFT-invoice matched payment now blocks + the Approve-in-Wave button fixes it; (3) a 250/100 partial deposit cannot be approved and the remainder flows (split remainder / unapplied / Needs review). Open non-P0 items still tracked: admin history-visibility window, data-freshness strip, Plaid backfill date + gap-free incremental sync.

## 🧭 DECISION LOG (Claude, per Max: "decide best move when away; consult Codex/GPT; note it")
- **(Max request) FINAL MAJOR QA REVIEW of Wave↔Hub + banking matching + accounting → shipped v55.83-IM.** Ran 4 parallel deep-review agents (Hub→Wave push, Wave→Hub sync, banking match/unmatch, accounting correctness), then VERIFIED every finding against the code myself (caught that the "statement double-credit" finding was a symptom of the import double-count root cause, not separate). FIXED (verified, low-risk, clearly correct):
  1. `import-invoices` ignored `ppRes.error` on the Hub-pushed-payment subtraction → on a transient query failure it zeroed the guard and **double-counted** paid amounts across the whole app. Now checks error + ABORTS the import.
  2. `BankReviewTab.recomputeInvoice` wrote `amount_paid/balance_due` against an assumed-empty payment read on error → now throws/surfaces (no corrupt balances). Same for the invoice-fetch fallback.
  3. `BankReviewTab.applyToInvoice` swallowed the paid-now read error → **overpayment misclassified** as partial/full and the customer credit dropped. Now throws.
  4. `applyToInvoice` had **no cap** on cumulative amount applied from one deposit → over-posting cash. Added a deposit-amount cap (multi-invoice split still allowed).
  5. `AccountingDashboard` payment query omitted `voided` → void detection was sync_status-only (fragile). Added the column.
  6. `CustomerLedger` local `isPaymentVoid` ignored `sync_status` → Wave-reversed payments counted as live in statements. Now uses the canonical helper (union w/ legacy).
  7. `push-payment` write-back failure was swallowed (try/catch is a no-op since Supabase doesn't throw) → posted Wave payment left orphaned in 'syncing' with no id → **duplicate-push risk**. Now checks error, retries id-only, else returns `{ok:false, manual_reconcile, wave_payment_id}`.
  8. `push-payment` `exchange_rate` taken verbatim → validated positive-finite.
  9. `wave_sync_log` push/sync inserts referenced `wave_business_id`/`dry_run` columns that NEVER EXISTED → every audit row silently dropped; UI filter then hid even the import rows. SQL adds the columns + filter relaxed. ⮕ **SETUP for Max: run `sql/v55-83-IM-wave-sync-log-columns.sql`.**
  Build green (clean-rebuild after transient .next race → exit 0). 14/14 session tests + fq/fl/fj accounting guards all green. Committed + deployed.
- **DEFERRED from the QA (need live verification or carry risk — NOT shipped blind):**
  - **push-payment trusts `body.user_id`** as the permission subject (no session proof). Real auth gap, but fixing = session-derived identity which could break the CRON/scheduled-push path — same class as the deferred Gmail fix. ⮕ For Codex/Max: confirm the safe way to derive the verified actor without breaking cron.
  - **`reconcile` route uses stale stored `balance_due`/`amount_paid`** instead of the canonical `total − wave_imported_paid − SUM(non-void hub rows)` → its Hub≡Wave audit can disagree with the dashboard. Read-only report (no money movement); fix needs payment-row load + currency care. Top follow-up.
  - **`import-customers` dedupe is silo-scoped vs a GLOBAL unique index** → a Wave id on a null/other-silo row makes re-import hit duplicate-key and skip forever (legacy-row edge case).
  - **`sync-pull` reports `success` on partial import failure** (per-row skips don't flip the run result).
  - **`customer_credits`/`unapplied_deposits` recorded + reversed but never surfaced/consumed** in dashboard AR (feature gap; CustomerLedger already notes it).

- **(heartbeat) Codex PASSED the HOLD decision + raised a PROCESS CAUTION (adopted).** Codex: "do not stage/commit CODEX_QA_FEEDBACK.md in Claude commits — the QA ledger is Codex-owned; leave it as working-tree QA communication; use CLAUDE_HANDOFF.md for Claude status." **ADOPTED:** going forward I stage only CLAUDE_HANDOFF.md + code/test/sql files, never CODEX_QA_FEEDBACK.md (no more `git add -A` that sweeps it in). This commit stages CLAUDE_HANDOFF.md only as the corrected pattern. No FAIL, no new bug, no Max live action yet. Verification: 13/13 session tests green. Continuing to HOLD.

- **(heartbeat) Codex PASSED IL** (build caution was the transient .next race; its own correction confirms post-commit build exit 0). No FAIL. **DECIDED to HOLD** rather than force the remaining P3 gap items, after tracing them: (1) ReportCenter explicit-columns/limit-caps is **already done** (all 7 queries explicit; movements `.limit(5000)`). (2) The remaining `select('*')` sites are in FxPnLReport / InventoryPnLReports / InventoryCostLayers / InventoryAdjustments / InventoryMovementsLedger — converting to explicit columns is a broad refactor that can silently drop a needed column (→ wrong valuation/PnL), and limit-caps on financial reports would **corrupt correctness** (PnL must see all layers/movements). Neither is verifiable without live testing. (3) RTL column-order needs a live visual check. Per Codex's repeated "don't churn inventory polish" + the prior "poor QA" feedback, shipping a marginal-but-unverifiable change blind is the wrong call. Verification pass: **13/13 session tests green.** Holding for Max's live launch actions. ⮕ If Max wants the select('*') perf cleanup, I'll do it per-component WITH a column-coverage test once a live report check is possible.

- **(heartbeat) Codex PASSED IJ + IK + full accounting/Kandil smoke** (fq 10/10, fl 22/22, fj 7/7, ie, ho all green; IJ build-green confirmed on HEAD). No FAIL. Codex's standing message: the ONLY open launch risk is the LIVE Wave write (Max-only) — local guardrails are green. **BUILT v55.83-IL** (gap-list P3, refresh/last-updated half): added a "last updated HH:MM:SS" stamp next to the existing Refresh button in InventoryReportCenter (loadedAt set on successful load only; localized ar-EG in RTL). RTL column-order reversal still deferred (needs live visual check). Build green (clean-rebuild after one transient .next race → exit 0); 13/13 session tests pass. Committed + deployed.

- **(heartbeat) Reconciled Codex's II QA (PASS w/ cautions) + BUILT v55.83-IK (valuation double-gate).** Codex reviewed II pre-IJ. Caution resolutions: (1) "II not build-green" → it was the known transient `.next` artifact race; **`rm -rf .next && npm run build` → EXIT 0** for II, IJ, and IK (recorded here per Codex's ask). (2) "thumbnails only in edit modal" → **already closed by IJ** (Product Master rows + ProductPicker thumbnails). (3) "storage RLS broad" → **acknowledged, logged as POST-LAUNCH** (see security list below); Codex itself called UI-gating acceptable for launch, so not built now. Then, with no FAIL/in-scope bug, shipped gap-list P3 **valuation double-gate (IK)**: `stripValuation()` nulls valuation-flagged columns (avg_cost/total_value) on row copies at the `flatRows()` chokepoint when `!showValuation` — real cost numbers no longer ride in React props/exports/memory; display byte-identical (masking keys off the column flag). Build green; 12/12 session tests pass. Committed + deployed.

- **(heartbeat) BUILT v55.83-IJ — product-photo thumbnails (phase 2 of II).** New lib `src/lib/inventory-photos.js loadPrimaryPhotoUrls(productIds)`: one batched `attachments` query (parent_type=inventory_product, is_primary=true) + one `createSignedUrls` on the private product-photos bucket → {productId: signedUrl}. Fully graceful (errors swallowed → {} → no thumb, never crash before the II setup). Wired into Product Master list rows + ProductPicker results (thumb in name cell via flex — no grid changes). Receiving covered via ProductPicker; its receipt-group list left unchanged (different surface). Build green (exit 0); 11/11 session tests pass. Committed + deployed. Still needs the II setup (private `product-photos` bucket + `sql/v55-83-II-product-photos.sql`) to actually display thumbnails.

- **(heartbeat) BUILT v55.83-II — internal-only inventory product photos** (Max answered "internal" to the Codex photos GAP → private bucket + signed URLs). Extended AttachmentManager with backward-compatible modes (`bucketName`/`isPrivate` signed-URL/`imageOnly`/`enablePrimary`); legacy public invoice/ticket attachments UNCHANGED (verified by test 3a–3c). Mounted in Product Master edit modal (`parent_type='inventory_product'`, edit+saved-id only). New SQL `sql/v55-83-II-product-photos.sql` (is_private/is_primary/sort_order/caption cols + storage policies for bucket_id='product-photos'). Build green (exit 0); 10/10 session tests pass. Committed + deployed. ⮕ **SETUP for Max:** create a **PRIVATE** Supabase bucket `product-photos` (image/*, 100 MB) + run the SQL — uploads error with a clear hint until then. NOT done (phase 2): primary-photo thumbnails in Product Master rows / ProductPicker / Receiving (needs a batch primary-photo lookup) — left for a follow-up.

- **(heartbeat) HOLD — no safe in-scope bug; verification pass green (9/9 session tests).** Codex passed IH. Remaining work gated: (a) Max's live Wave payment test (multi-currency push); (b) the Gmail comms-security build (see below — Codex answered the CODE model; live-DB mapping is the blocker); (c) Max's call on out-of-scope security FAILs (ticket public URLs, WhatsApp) and the product-photos enhancement.
- **(heartbeat) Gmail identity model — Codex ANSWERED (the table is `email_accounts`, NOT `gmail_accounts` — earlier note was wrong).** Code model per Codex: gmail/connect reads `userId` from query → OAuth state → gmail/callback stores it into `email_accounts.user_id`; CommunicationsTab passes `user.id` (Supabase **auth uid**), while `userProfile.id` (app `users.id`) is resolved separately (email-first, auth-id fallback) and **may differ**. `/api/ask` Gmail paths select the **first active** email_account (must be fixed in the same security pass). REMAINING BLOCKER is **live Supabase data** — does `users.id == auth.users.id` for active users, and do existing `email_accounts.user_id` values hold auth uid or users.id? Can't be confirmed from code. **DECISION: still DEFER the Gmail code change** — proceed only as a dedicated comms-security build AFTER the accounting launch path is stable, and ONLY after the live mapping is checked OR the fix carries an explicit mapping/migration path (per Codex). Not fragmenting it (client-Bearer-only half-step is inert without server enforcement). ⮕ For Max: when ready, I need a live Supabase check of `users.id` vs `auth.users.id` and the `email_accounts.user_id` contents to safely harden Gmail without breaking connected mailboxes.
- **NEW (Codex): Inventory product photos GAP** — products have no photo/gallery (no image cols; AttachmentManager not mounted for parent_type='inventory_product'). It's an ENHANCEMENT (Codex: build after launch blockers) and needs Max's decision: are product photos PUBLIC catalog images (public bucket ok) or INTERNAL-only (needs private bucket + signed URLs)? Not building autonomously — feature + Max decision + ties to the unresolved public-bucket security item. ⮕ For Max: public or internal-only product photos?


**Gmail auth FAIL — decided to DEFER the code fix (do NOT blind-ship).** Verified: CommunicationsTab.jsx calls /api/gmail/inbox and /send with NO Authorization token and NO userId (lines 42/55/69/89). VoicemailsWidget DOES send Bearer via supabase.auth.getSession(). So the app uses localStorage sessions (no auth cookie) → adding requireUser to the Gmail routes WITHOUT first wiring the client to send the token would 401 everyone and BREAK Gmail for the whole team. Also unconfirmed: whether `email_accounts.user_id` (CORRECTED table name) == Supabase auth uid (requireUser gives auth uid) or the app users.id — a mismatch would query the wrong mailbox. Blind-fixing risks breaking a live feature, which is worse than the current state and violates "verify, don't guess."
SAFE FIX PLAN (dedicated task, needs a live test): (1) CommunicationsTab — add `Authorization: Bearer <getSession token>` to all 4 gmail fetches (mirror VoicemailsWidget). (2) gmail/inbox + send routes — requireUser(req); 401 if no user; derive the effective mailbox user from the authenticated identity; allow cross-user mailbox only with admin/comms perm; log sends to comms_audit with the authenticated actor. (3) CONFIRM the auth-uid↔gmail_accounts.user_id mapping BEFORE enforcing. (4) Test live (a real Gmail read+send) before calling done.
⮕ For Codex: ANSWERED (2026-06-17) — table is `email_accounts`; UI keys by Supabase auth uid; `/api/ask` is the other consumer (selects first active account). Live-DB mapping (users.id vs auth.users.id) remains the blocker. See DECISION LOG above.

## ⮕ For Max — SECURITY items Codex found (OUT of Wave/Inventory scope — your call to prioritize)
Codex's cross-area audit surfaced real FAILs I did NOT build (outside the stated Wave↔Hub/Inventory priority):
- **Gmail inbox/send route trusts userId from the request without auth** → any caller could read/send as another user. Real security hole. Recommend: add requireUser/session-derived userId + admin gate. WANT ME TO FIX THIS NEXT? (security > scope, IMO.)
- **Ticket attachments use PUBLIC storage URLs** (the ticket-attachments bucket). Sensitive docs would be world-readable by URL. Fix = private bucket + signed URLs (infra + code). Ties to the attach work HX/HY/IA.
- Comms cautions: legacy WhatsApp compose → wrong API (400); WhatsApp routes lack permission/ownership gating; unread-count race; phone webhook fail-open; admin dashboard silent zeroes; AI quote bypasses comms audit. (Backlog.)
⮕ Codex passed IG. Remaining Wave↔Hub (push-payment multi-currency) still awaits the live Wave test. Next in-scope: thin inventory backlog (mostly consistency/perf) — or pull a security FAIL forward if Max says so.

## IG — closed Codex's IF caution (permission toggle complete)
togglePermission now takes displayedHasAccess and saves !displayedHasAccess; both TAB+ACTION buttons pass their computed hasAccess (incl. readPerm legacy fallback for Open Accounts/Edit Open Accounts). Removes the last default-vs-display edge. Keeps IF optimistic+revert+toast. Test updated (9 assertions). Build exit 0.
⮕ For Codex: verify the displayed-state toggle + legacy fallback. ⮕ For Max: hard-refresh to IG; if a grant still won't save, the red toast names the DB reason (probably RLS on module_permissions → I'd add a policy). Permission-toggle saga: IE (default) → IF (optimistic/loud) → IG (flip displayed state) = done.

## IF — permission toggle robustness (Max says IE didn't resolve it)
togglePermission now: optimistic setPermissions BEFORE await (instant flip) + checks sel/update/insert .error + reverts & toast.error on failure (was: state only after await + silent console.error → "nothing happens" if the DB write was blocked). Two scenarios now distinguishable for Max: (a) NO change + NO error toast → stale build, hard-refresh (badge should read IF); (b) error toast → RLS/policy on module_permissions blocks writes → NEXT FIX likely a Supabase policy letting super_admin/admin write module_permissions (await Max's error text before writing SQL). No SQL this build.
⮕ For Codex: verify optimistic+revert toggle. ⮕ For Max: hard-refresh; if a red error appears when toggling, send me its text.

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
