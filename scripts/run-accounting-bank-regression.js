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
  { f: 'test-v55-83-is-unmatch-and-plaid-scope.js', label: 'new', why: 'unmatch→service route; BankTab silo-scope-before-limit; Plaid requires service-role' },
  { f: 'test-v55-83-it-bank-consistency.js', label: 'new', why: 'Bank Review scope-before-limit; canonical posted_date on both screens; deep-link keeps account' },
  { f: 'test-v55-83-db-bank-assign.js', label: 'updated', why: 'ACCOUNT-level bank→silo mapping (6338/6353), ingestion stamps by account, assign+repair endpoint' },
  // Bank Review core writes (service-role, RLS-proof)
  { f: 'test-v55-83-ip-bank-write-serverside.js', label: 'new', why: 'categorize/status/match/unmatch via /api/accounting/bank-write' },
  { f: 'test-v55-83-im-accounting-qa-hardening.js', label: 'updated', why: 'res.error guards, over-apply cap, void handling, currency guard' },
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
  { f: 'test-v55-83-fj-match-guards.js', label: 'must-pass', why: 'match guards' },
  { f: 'test-v55-83-fm-wave-categories.js', label: 'updated', why: 'Wave categories in categorize dropdown, silo-scoped' },
  { f: 'test-v55-83-iq-estimates-proformas.js', label: 'new', why: 'Wave estimates → Hub proformas per silo' },
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
