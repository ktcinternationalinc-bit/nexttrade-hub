// v55.83-ND — Wave ↔ Hub Reconciliation with a per-line Match Hub / Match Wave
// queue and one SUBMIT.
//
// Max (Aug 12 2026): "comparing wave to our hub ... monthly reconciliation ...
// for each item this difference ... either sync it to wave or sync it to hub"
// and "each issue will have a button match Hub or Match Wave to select and at
// the end of the list you would SUBMIT at anytime (like it goes in a queue and
// then when you submit your process and match to the appropriate selections)"
//
// THE ARCHITECTURE RULE THIS FILE PROTECTS
// The diff route is READ-ONLY, and the executor writes NOTHING directly except
// payment voids — every action calls an existing, individually-guarded route.
// Reconciliation must never become a second write-path with its own (weaker)
// locks. Also: some directions are legally impossible and must stay blocked
// with a reason, not hidden.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var route = read('src/app/api/wave/reconcile-detail/route.js');
var ui    = read('src/components/WaveReconciliationCenter.jsx');
var hub   = read('src/components/WaveHub.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — The diff route is read-only and complete
// ══════════════════════════════════════════════════════════════════

ok('A1: the detail route performs NO writes (no insert/update/delete/mutation)',
  route.indexOf('.insert(') === -1 && route.indexOf('.update(') === -1 &&
  route.indexOf('.delete(') === -1 && route.indexOf('mutation') === -1);
ok('A2: it paginates ALL Wave invoices, not one page',
  /totalPages/.test(route) && /for \(p = 2; p <= totalPages; p\+\+\)/.test(route));
ok('A3: it paginates ALL Hub invoices for the silo',
  /fetchAllHub/.test(route) && /\.eq\('wave_business_id', businessId\)/.test(route));
ok('A4: payments are loaded in chunks (thousands of invoices survive .in())',
  /invoiceIds\.slice\(i, i \+ 200\)/.test(route));
ok('A5: voided payments are excluded from the paid comparison',
  /if \(pr\.voided === true\) \{ continue; \}/.test(route));
ok('A6: parked rows (archived/void/cancelled) are not reported as discrepancies',
  /rsts === 'archived' \|\| rsts === 'void' \|\| rsts === 'cancelled'/.test(route));
ok('A7: all four diff types are produced',
  /type: 'wave_only'/.test(route) && /type: 'hub_only'/.test(route) &&
  /type: 'total_mismatch'/.test(route) && /type: 'paid_mismatch'/.test(route));
ok('A8: a Hub link pointing at a deleted Wave invoice is caught and explained',
  /no longer exists \(deleted in Wave\)/.test(route));
ok('A9: worst money gaps sort first',
  /Worst money gaps first/.test(route) && /return gap\(b\) - gap\(a\);/.test(route));
ok('A10: permission gate on the route',
  /assertPermission\(admin, userId, 'wave\.import\.run', request\)/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART B — Impossible directions are BLOCKED with reasons, never hidden
// ══════════════════════════════════════════════════════════════════

ok('B1: wave_only match_hub is blocked — Hub never deletes Wave-authored invoices',
  /match_hub: \{ blocked: 'The Hub never deletes a Wave-authored invoice/.test(route));
ok('B2: paid_mismatch where Wave has more is blocked toward match_hub',
  /the Hub will never delete a Wave payment/.test(route));
ok('B3: total_mismatch on an imported invoice cannot replace TOWARD Wave',
  /imported FROM Wave — Wave is its author/.test(route));
ok('B4: hub-ahead paid gap with no unpushed rows is flagged for hand inspection',
  /no unpushed payment rows to send — inspect this invoice by hand/.test(route));
ok('B5: the UI renders blocked directions with the reason, greyed not hidden',
  /act\.blocked/.test(ui) && /🚫 \{side === 'match_hub'/.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART C — The queue model Max described
// ══════════════════════════════════════════════════════════════════

ok('C1: choices accumulate per row (Match Hub / Match Wave toggle)',
  /next\[k\] === side\) \{ delete next\[k\]; \} else \{ next\[k\] = side; \}/.test(ui));
ok('C2: a SUBMIT button processes the whole queue at once',
  /SUBMIT ' \+ queuedCount\(\)/.test(ui));
ok('C3: partial queues are allowed — unqueued lines stay untouched',
  /unqueued lines are left untouched; you can submit in batches/.test(ui));
ok('C4: submit asks for confirmation with the count',
  /Process ' \+ keys\.length \+ ' queued reconciliation action\(s\)\?/.test(ui));
ok('C5: processing is sequential with a visible per-row outcome',
  /setRowResult\(k, 'running', act\.label\);/.test(ui));
ok('C6: one failed row does not strand the rest',
  /catch \(e\) \{\s*setRowResult\(k, 'error'/.test(ui));
ok('C7: after submit the compare re-runs to PROVE the list shrank',
  /runCompare\(\); \/\/ the proof/.test(ui));
ok('C8: the run is written to the activity log',
  /Ran Wave reconciliation: processed/.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART D — Every action reuses the guarded machinery
// ══════════════════════════════════════════════════════════════════

ok('D1: push goes through set_approval then push-invoice-v2',
  /action: 'set_approval'[\s\S]{0,400}push-invoice-v2/.test(ui));
ok('D2: replace goes through replace-invoice then push-invoice-v2',
  /replace-invoice[\s\S]{0,700}push-invoice-v2/.test(ui));
ok('D3: hub deletion goes through delete-invoice incl. the payment-ack round-trip',
  /delete-invoice/.test(ui) && /hub_payments_need_ack/.test(ui) &&
  /acknowledge_hub_payments: true/.test(ui));
ok('D4: payment pushes go one-by-one through push-payment',
  /push-payment/.test(ui) && /d\.unpushed_payments\[pi2\]/.test(ui));
ok('D5: match-Wave voids payments — never deletes them',
  /voided: true, sync_status: 'voided_reconcile'/.test(ui) &&
  !/from\('accounting_invoice_payments'\)\.delete/.test(ui));
ok('D6: ALL import-type selections are covered by ONE idempotent import run',
  /needsImport/.test(ui) && /import-invoices/.test(ui) &&
  /queued_import/.test(ui));
ok('D7: a replace whose re-push fails names the Pending Sync recovery',
  /invoice is in Pending Sync, push it from the Sync Center/.test(ui));
ok('D8: the no-second-write-path rule is stated in the component',
  /nothing here writes directly/i.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART E — Mounting and access
// ══════════════════════════════════════════════════════════════════

ok('E1: Reconcile is Step 4 in the Wave hub',
  /\['reconcile', '4 - Reconcile'/.test(hub));
ok('E2: it is gated behind Wave sync access like Step 3',
  /if \(canWaveSync\) \{ steps\.push\(\['reconcile'/.test(hub) &&
  /\(step === 'sync' \|\| step === 'reconcile'\) && !canWaveSync/.test(hub));
ok('E3: the component itself refuses without sync access (defense in depth)',
  /Reconciliation needs Wave sync access/.test(ui));
ok('E4: a clean compare is celebrated, not silent',
  /Wave and the Hub match — nothing to reconcile/.test(ui));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-ND reconciliation center');
}
