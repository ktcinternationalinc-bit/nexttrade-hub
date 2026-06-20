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
