// v55.83-IS — Accounting + Banking regression runner (Codex/Max launch requirement).
// Single command: `node scripts/run-accounting-bank-regression.js`  (or `npm run test:accounting-bank`).
// Runs the curated Accounting/Bank suite, prints a labeled manifest, and EXITS NONZERO if any
// required test fails. No silent skips. Inventory is intentionally NOT in this runner yet.
//
// Labels:
//   must-pass        — previously-working behavior that must not regress
//   updated          — intentional behavior change; test was updated to prove the new behavior
//   new              — new coverage added for a launch fix
//   stale-excluded   — known-obsolete test, NOT required to pass; tracked for rewrite (does not gate)
var cp = require('child_process');
var path = require('path');

var MANIFEST = [
  // Bank/Plaid ingestion + display
  { f: 'test-v55-83-x-bank-ingest.js', label: 'must-pass', why: 'Plaid transaction mapping/ingest' },
  { f: 'test-v55-83-fg-plaid-sync-defensive.js', label: 'must-pass', why: 'Plaid sync defensive handling' },
  { f: 'test-v55-83-jr-plaid-incremental-sync.js', label: 'new', why: 'Plaid gap-free incremental sync: pages past 500, pulls forward from last_successful_posted_date (not UI window), backfill date on connect, markers stored' },
  { f: 'test-v55-83-is-unmatch-and-plaid-scope.js', label: 'new', why: 'unmatch→service route; BankTab silo-scope-before-limit; Plaid requires service-role' },
  { f: 'test-v55-83-it-bank-consistency.js', label: 'new', why: 'Bank Review scope-before-limit; canonical posted_date on both screens; deep-link keeps account' },
  { f: 'test-v55-83-db-bank-assign.js', label: 'updated', why: 'ACCOUNT-level bank→silo mapping (6338/6353), ingestion stamps by account, assign+repair endpoint' },
  { f: 'test-v55-83-jx-bank-connect-silo.js', label: 'new', why: 'assign schema-safe (assigned_at column gone), exchange stamps new accounts to chosen silo, connection assign+archive actions for one-group-per-silo cleanup' },
  { f: 'test-v55-83-jy-banktab-silo-organization.js', label: 'new', why: 'Bank tab silo-centric: active-silo primary, other silos collapsed (admin diagnostics), business-language buttons, connect surfaces failed account-stamp' },
  // Bank Review core writes (service-role, RLS-proof)
  { f: 'test-v55-83-ip-bank-write-serverside.js', label: 'new', why: 'categorize/status/match/unmatch via /api/accounting/bank-write' },
  { f: 'test-v55-83-im-accounting-qa-hardening.js', label: 'updated', why: 'res.error guards, over-apply cap, void handling, currency guard' },
  { f: 'test-v55-83-jc-allocation-completeness.js', label: 'new', why: 'money conservation — partial bank allocation cannot be reviewed/approved; split must fully allocate; server flips reviewed only when deposit fully allocated' },
  { f: 'test-v55-83-jj-split-park-serverside.js', label: 'new', why: 'split-save + park-unapplied moved to service route (RLS-proof); full-allocation enforced server-side; reviewed only when complete' },
  { f: 'test-v55-83-cj-unmatch.js', label: 'updated', why: 'unmatch now server-route contract' },
  { f: 'test-v55-83-ho-unmatch-credit-reversal.js', label: 'updated', why: 'overpayment credit reversal now server-side' },
  { f: 'test-v55-83-ic-active-matches.js', label: 'updated', why: 'only active matches; server-side void' },
  { f: 'test-v55-83-ie-no-local-reverse-of-synced.js', label: 'must-pass', why: 'block local reverse of Wave-synced payments' },
  { f: 'test-v55-83-hn-overpayment-credit.js', label: 'must-pass', why: 'overpayment → customer credit' },
  { f: 'test-v55-83-hr-accounting-doc-permissions.js', label: 'must-pass', why: 'accounting doc permissions not gated by bank.view' },
  { f: 'test-v55-83-kc-customer-wave-linkage.js', label: 'new', why: 'AL MOUSTAFA undercount — AR History + Customer Ledger match invoices by accounting_customer_id OR wave_customer_id (Wave-imported)' },
  { f: 'test-v55-83-jz-ar-count-and-preview.js', label: 'new', why: 'AR count breakdown + visibility employee-preview' },
  { f: 'test-v55-83-ke-update-match-atomic.js', label: 'new', why: 'atomic update_match server action: reverse old + apply new, recompute both invoices, block Wave-synced; client + sync-state display' },
  { f: 'test-v55-83-kj-match-edit-rollback-hardening.js', label: 'new', why: 'update_match money-safety: overpayment-insert rollback, old credit/unapplied void errors trigger restore, restore re-opens old credits/unapplied, recompute/restamp surfaced as warning' },
  { f: 'test-v55-83-lj-csv-invoice-and-audit.js', label: 'new', why: 'CSV import: invoice-referenced rows routed to needs_manual_invoice_link (not mis-applied as categories); conflict guard catches label-only existing categories; full before/after + raw-row + matched-id + who/when audit (Codex LI review)' },
  { f: 'test-v55-83-li-csv-hardening.js', label: 'new', why: 'CSV import money-safety (Codex 7 items): ambiguous>1 not auto-applied, IN/OUT direction must match, separate debit/credit columns, existing-category conflict needs override, pushed/synced guard widened to wave_transaction_id, unresolved name -> local_only (never fake-synced), full batch+per-row audit' },
  { f: 'test-v55-83-mf-settings-declutter.js', label: 'new', why: 'MF (Codex: inner Wave settings too confusing): push-permission checklists + production toggles + database-setup diagnostic collapsed by default; operator essentials (who-feeds-each-account + setup status) stay visible up top' },
  { f: 'test-v55-83-mg-payment-push-feedback.js', label: 'new', why: 'MG: payment push/move cannot fail silently; every blocked/failed payment push logs to wave_sync_log and crash-after-claim marks the payment sync_failed' },
  { f: 'test-v55-83-mh-product-setup-cleanup.js', label: 'new', why: 'MH: Wave Settings product setup no longer sends Wave-rejected isSold/isBought and no longer dumps raw JSON into the operator page' },
  { f: 'test-v55-83-me-deeplink-and-owner-persistence.js', label: 'new', why: 'ME (Codex MD cautions): legacy Wave deep-links land on the intended WaveHub step (not stranded on Connect); a Wave category pull preserves the per-account feed-owner choice (update of a fixed rowPayload that omits wave_feed_owner)' },
  { f: 'test-v55-83-md-wave-hub-consolidation.js', label: 'new', why: 'MD: the 3 scattered Wave tabs (Connection/Import/Sync Center) are now ONE guided Wave tab (WaveHub) with a Connect-Import-ReviewPush step flow; legacy deep-links normalize to it; existing components re-parented unchanged' },
  { f: 'test-v55-83-mc-category-classifier.js', label: 'new', why: 'MC: category-type safety classifier blocks bank/cash, A/R, A/P, system as a money-txn category; allows income/expense (behavior test)' },
  { f: 'test-v55-83-mc-shared-bank-resolver.js', label: 'new', why: 'MC: ONE shared bank-account resolver used by push-transaction/push-payment/prefill; suffix-tolerant mask (6338 to (338)); silo-default carries feed owner; firewall blocks UNSET+WAVE_FEED (behavior test)' },
  { f: 'test-v55-83-mc-wave-read-update-proof.js', label: 'new', why: 'MC: committed live-introspection proof + evidence doc + design contract + ownership migration/setter exist; no UI claims API read/update of existing Wave txns' },
  { f: 'test-v55-83-mc-feed-owner-ui.js', label: 'new', why: 'MC: per-account Hub/Wave-feed control surface in Settings with the real Wave step + migration warning + dark theme' },
  { f: 'test-v55-83-mb-dryrun-crash-and-retry-status.js', label: 'new', why: 'P0 live: Dry Run on a transaction crashed the Accounting page (React #31 — would_send object rendered as a child); now stringified. Failed-row status used q.retry but the renderer reads q.retryable, so failures showed as not-synced; row now sets retryable.' },
  { f: 'test-v55-83-ma-failed-retry-and-mask-tolerance.js', label: 'new', why: 'Codex P0 deep-wiring: (P0#1) moneyTransactionCreate payload now sends a balanced DEBIT+CREDIT lineItems pair (Wave rejected the single-INCREASE line live); (P0#2) Wave-failed bank txns stay RETRYABLE in Pending Sync with the exact error inline instead of vanishing; prefill account match is suffix-tolerant (Wave 338 = Plaid 6338) + scans the full invoice book' },
  { f: 'test-v55-83-lz-per-account-anchor.js', label: 'new', why: 'PER-ACCOUNT anchor resolution (Codex architecture): a transaction anchors to ITS OWN bank account-s Wave bank account by mask (suffix-tolerant 338 vs 6338), single-account auto-pick, silo-default fallback; removed the blanket multi-account block so multi-bank silos can push' },
  { f: 'test-v55-83-ly-push-feedback-routing-and-block.js', label: 'new', why: 'Codex hard-FAIL fixes: push errors no longer leak into the Invoice Product box (dedicated pushMsg in Pending Sync); Pending Sync blocks a categorized txn client-side when the Wave deposit account is missing, with the exact reason + a jump to Settings' },
  { f: 'test-v55-83-lx-settings-clarity.js', label: 'new', why: 'Wave-UI consolidation Build 1: renamed the two look-alike account settings so the Wave Deposit Account (push-required) vs Bank Review default (display-only, never sent to Wave) are unmistakable' },
  { f: 'test-v55-83-lw-deposit-anchor-diagnosis.js', label: 'new', why: 'transaction push self-diagnoses WHY the deposit account is missing (column-missing read error vs no settings row vs empty value) instead of the same generic failure 20x; + canonical SQL migration for the payment-account columns; + bank txn details logged on blocked push' },
  { f: 'test-v55-83-lu-deposit-account-override.js', label: 'new', why: 'deposit-account escape hatch: Show all accounts + Use anyway (allow_any) so a bank/cash account auto-detection missed can still be set; A/R-A/P hard-blocked even on override' },
  { f: 'test-v55-83-lt-invoice-payment-amount-scalar.js', label: 'new', why: 'LIVE: Check Wave payments + prefill errored "Field amount must not have a selection since type String" — InvoicePayment.amount is a String scalar; both queries asked amount{value}. Select amount scalar + parse string-tolerant; guard both routes' },
  { f: 'test-v55-83-ls-deposit-picker-usable-only.js', label: 'new', why: 'deposit-account picker shows ONLY usable bank/cash accounts (hide the Accounts-Payable flood / can-t-use rows); one clear create-Cash-and-Bank message when 0 usable' },
  { f: 'test-v55-83-lr-deposit-account-listing.js', label: 'new', why: 'deposit-account picker showed 200 accounts/0 usable (push blocked): listAccounts now paginates ALL pages (was page-1/200) + broadened cash-bank detection (subtype OR asset+name, skip archived) + UI reports usable count' },
  { f: 'test-v55-83-lq-server-import-safety.js', label: 'new', why: 'LIVE P0: every gated Wave server route crashed with "(0,x) is not a function" because 10 routes imported isPlaceholderWaveBusiness from the use-client lib/wave-business (client-ref proxy server-side). Fixed to lib/wave-business-shared; this guard scans ALL api routes so the class cant return' },
  { f: 'test-v55-83-lp-guided-prefill.js', label: 'new', why: 'guided Prefill-from-Wave flow: one ordered panel (Step 1 import invoices+customers, Step 2 categories CSV, Step 3 prefill invoice links Preview-first) in the Wave Sync Center Import tab; UI orchestration of existing tested routes, nothing writes to Wave' },
  { f: 'test-v55-83-lm-prefill-payment-links.js', label: 'new', why: 'PREFILL deposit->invoice links from Waves invoice payments (Max: prefill existing transactions + links). Display-link only (payment_matches + matched_invoice_id, NO payment row, NO wave_imported_paid change => paid invariant untouched); dry-run-first, unique-match-only, idempotent, no Wave writes' },
  { f: 'test-v55-83-lg-payment-readback.js', label: 'new', why: 'Wave PAYMENT mirror gate: read-only payment-readback probe (invoice.payments + payment.account ARE Wave-readable) so Wave-native payments can be confirmed/linked to deposits before writing; + Codex semantic fix so only wave_csv/wave_import (not Hub-picked wave categories) show as from-Wave' },
  { f: 'test-v55-83-lf-blotter-mirror.js', label: 'new', why: 'Wave MIRROR view on the blotter: each txn shows its Wave category + origin (⇐ Wave vs Hub), and a split-aware sync badge — matched deposits show the linked INV# + status as an invoice payment, categorized txns show money-txn sync, Wave-imported categories show ⇐ from Wave. + wave_transaction_id column migration' },
  { f: 'test-v55-83-le-category-and-push-unblock.js', label: 'new', why: 'Max: category list capped at ~10 + txn sync wont go. Fix: Typeahead 50+more-hint (full chart reachable), categories route hides only true SYSTEM rows (keeps real Payable/Receivable) + no name-collapse, push counts DISTINCT CANONICAL accounts (single-bank silo no longer wrongly blocked by reconnect aliases), syncing-row reset on crash, auto-pull categories after real bind' },
  { f: 'test-v55-83-ld-import-wave-csv.js', label: 'new', why: 'PULL existing Wave categorizations (Max item 2): ingest Waves CSV export (API cant read txns back), match to Hub txns by date+amount+description, resolve category name->id, reflect as already-in-Wave; dry-run default + Import-from-Wave tab' },
  { f: 'test-v55-83-lc-push-money-safety.js', label: 'new', why: 'KZ money-safety (Codex): Dry Run previews transactions + shows Wave anchor; multi-account silo anchor BLOCK (no wrong-account posting); logFail awaited; edit-after-push blocked (Wave has no update/delete); read-back impossibility evidence saved' },
  { f: 'test-v55-83-lq-server-safe-wave-business.js', label: 'new', why: 'server API routes import the server-safe Wave placeholder helper, never the client/localStorage wave-business module (prevents deployed minified not-a-function push crash)' },
  { f: 'test-v55-83-lb-push-feedback.js', label: 'new', why: 'push-transaction logs every blocked/failed push to wave_sync_log + returns specific reason; pushSelected surfaces it (no silent nothing-happened); transaction gate uses master switches not payment sub-toggle' },
  { f: 'test-v55-83-kz-push-transaction.js', label: 'new', why: 'PUSH categorized bank transactions to Wave via moneyTransactionCreate (live-verified mutation; overturns old can-not-push belief); gated+dry-run+idempotent; Sync Center lists categorized txns as pushable + message corrected' },
  { f: 'test-v55-83-ky-category-and-account-dedup.js', label: 'new', why: 'Bank Review: hide Wave SYSTEM/AP/AR category flood + dedupe names + searchable category picker; account filter keyed by mask (reconnected duplicate account shows once)' },
  { f: 'test-v55-83-kx-refresh-names.js', label: 'new', why: 'Refresh business names from Wave: read-only pull of current Wave names -> update Hub silo labels (service-role, super-admin), skip+flag placeholders/not-visible' },
  { f: 'test-v55-83-kt-connect-to-wave.js', label: 'new', why: 'one-click Connect-to-Wave (check token -> match silo -> bind) + kill placeholder-state UI contradiction (banner/badge/settings show NOT CONNECTED, moot toggles hidden)' },
  { f: 'test-v55-83-kq-bind-safety.js', label: 'new', why: 'bind tool live-safety: all-or-nothing re-stamp with rollback (no partial silo ownership), normal mode binds placeholder silos only, advanced rebind opt-in' },
  { f: 'test-v55-83-kp-readiness-summary.js', label: 'new', why: 'top-of-Settings one-glance Wave readiness summary (Production writes/Payment/Invoice/Category READY-BLOCKED) with next-action per blocked item' },
  { f: 'test-v55-83-ko-wave-truth-audit-fixes.js', label: 'new', why: 'multi-agent Wave truth-audit fixes: bind re-stamps wave_products+splits (P0), payment vs invoice readiness split, real Wave error surfacing, placeholder guards on all push/sync/setup routes' },
  { f: 'test-v55-83-kn-wave-bind-and-readiness.js', label: 'new', why: 'ROOT CAUSE: placeholder Wave business id. Bind tool (re-stamp registry+data to real GUID w/ dry-run), read-only/write badge fix, categories not a payment-push gate, placeholder surfaced loudly' },
  { f: 'test-v55-83-km-active-accounts-only-picker.js', label: 'new', why: 'VIEW account picker lists ACTIVE (non-archived) accounts only; archived/superseded selection falls back to All' },
  { f: 'test-v55-83-kl-alias-reconciliation.js', label: 'new', why: 'reconnect alias txns RECONCILED not dropped: drop only unmatched same-fingerprint duplicates, keep unique/matched (re-stamp to canonical), surface counts' },
  { f: 'test-v55-83-kk-canonical-account-identity.js', label: 'new', why: 'ONE LINE PER REAL ACCOUNT: canonical identity=institution+mask, newest link wins, older aliases superseded; a different account in an older link is NOT hidden' },
  { f: 'test-v55-83-ki-auto-supersede-relink.js', label: 'new', why: 'reconnect leaves a stale old link; auto-supersede older relink (hide account + exclude its txns), fall back filter to All, flag stale account' },
  { f: 'test-v55-83-kh-bank-dedup.js', label: 'new', why: 'one line per bank (dedup duplicate re-link connections, archive in one click), per-account newest-txn date, exclude archived-connection txns from totals' },
  { f: 'test-v55-83-kg-match-safety-and-silo-toggle.js', label: 'new', why: 'update_match apply-new-first + restore-on-failure (money-safety); Bank-page silo switcher' },
  { f: 'test-v55-83-kf-live-fixes.js', label: 'new', why: 'live P0 batch: ledger crash import, AR date sort+pill contrast, bank account-silo grouping, deposit-remaining warning, Wave category pull diagnostic' },
  { f: 'test-v55-83-kd-match-edit-and-ledger-window.js', label: 'new', why: 'edit existing match amount (reverse+re-apply); Customer Ledger list+payment history windowed' },
  { f: 'test-v55-83-iw-customer-ledger-scope.js', label: 'new', why: 'Customer Ledger picker silo-scoped (no cross-silo bleed), no silent 40-cap, clears selection on silo switch' },
  // Wave push + import + categories + estimates
  { f: 'test-v55-83-fq-launch-critical.js', label: 'must-pass', why: 'launch-critical accounting invariants' },
  { f: 'test-v55-83-fl-real-payment-push.js', label: 'must-pass', why: 'real Wave payment push guards' },
  { f: 'test-v55-83-jb-draft-invoice-payment-block.js', label: 'new', why: 'matched payment to a DRAFT Wave invoice is blocked (not retryable) + Approve-invoice-in-Wave on the payment row; eligibility/dry-run reports DRAFT as blocked' },
  { f: 'test-v55-83-iz-registry-flags.js', label: 'new', why: 'production unlock + push flags save via service-role route (super-admin gated)' },
  { f: 'test-v55-83-jd-invoice-approval-serverside.js', label: 'new', why: 'invoice approve/submit/reopen persist via service-role route (was RLS-trapped browser dbUpdate)' },
  { f: 'test-v55-83-je-visibility-window.js', label: 'new', why: 'admin history-visibility window: pure floor math + super-admin route + Bank Review/BankTab query clamp + settings UI' },
  { f: 'test-v55-83-jl-visibility-wiring.js', label: 'new', why: 'visibility floor wired into Invoices + Open Accounts at the query; panel claim-matches-reality guard' },
  { f: 'test-v55-83-fj-match-guards.js', label: 'must-pass', why: 'match guards' },
  { f: 'test-v55-83-fm-wave-categories.js', label: 'updated', why: 'Wave categories in categorize dropdown, silo-scoped' },
  { f: 'test-v55-83-ja-category-dropdown.js', label: 'new', why: 'categories load via service-role route (RLS-proof) + reason-specific empty state' },
  { f: 'test-v55-83-jo-category-pull-truth-and-relink.js', label: 'new', why: 'category pull surfaces per-silo failure/0-accounts (not false success); Plaid needs_relink CTA for stale connections' },
  { f: 'test-v55-83-jp-audit-fixes.js', label: 'new', why: '3-agent audit fixes: cross-silo match/unmatch guards, recompute non-fatal+silo-scoped, auto-review reviewer, hidden-overpayment block, proforma wave_product carry, stale modal, unlock missing-column hint' },
  { f: 'test-v55-83-iq-estimates-proformas.js', label: 'new', why: 'Wave estimates → Hub proformas per silo' },
  { f: 'test-v55-83-iy-perline-wave-product.js', label: 'new', why: 'per-line Wave product selection on invoices + read-only product catalog pull' },
  { f: 'test-v55-83-at-invoice-import.js', label: 'updated', why: 'invoice import anti-double-count invariant' },
  { f: 'test-v55-83-av-import-lineitems-fix.js', label: 'updated', why: 'invoice import line items' },
  { f: 'test-v55-83-es-combined.js', label: 'updated', why: 'productCreate isSold + sync log ordering' },
  // Known-stale, NOT gating (tracked for rewrite per Codex)
  { f: 'test-v55-83-dl-wave-sync.js', label: 'stale-excluded', why: 'asserts pre-implementation "push unsupported" era; superseded by dl-libs+fl+fj+ip — needs rewrite' },
];

var results = [];
var requiredFail = 0;
MANIFEST.forEach(function (t) {
  var status;
  try {
    cp.execSync('node ' + JSON.stringify(path.join(__dirname, '..', '__tests__', t.f)), { stdio: 'pipe' });
    status = 'PASS';
  } catch (e) { status = 'FAIL'; }
  if (status === 'FAIL' && t.label !== 'stale-excluded') { requiredFail++; }
  results.push({ f: t.f, label: t.label, status: status, why: t.why });
});

console.log('\n=== Accounting + Bank regression ===');
results.forEach(function (r) {
  var mark = r.status === 'PASS' ? '✓' : (r.label === 'stale-excluded' ? '∅' : '✗');
  console.log(' ' + mark + ' [' + r.label + '] ' + r.f + (r.status === 'FAIL' ? '  <-- ' + (r.label === 'stale-excluded' ? 'known stale (not gating)' : 'REQUIRED FAIL') : ''));
});
var req = results.filter(function (r) { return r.label !== 'stale-excluded'; });
var reqPass = req.filter(function (r) { return r.status === 'PASS'; }).length;
console.log('\nRequired: ' + reqPass + '/' + req.length + ' passed · stale-excluded: ' + results.filter(function (r) { return r.label === 'stale-excluded'; }).length);
if (requiredFail > 0) { console.log('❌ ' + requiredFail + ' REQUIRED test(s) failed — not launch-clean.'); process.exit(1); }
console.log('✅ All required Accounting/Bank regression tests passed.');
