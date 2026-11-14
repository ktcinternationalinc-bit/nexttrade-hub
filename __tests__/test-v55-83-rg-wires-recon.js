// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RG — Max, Nov 8 15:32:
//   "we need a separate portal for wires sent. So when a wire is sent to a
//    vendor...yes we already link the bills to the wire..but there needs to be
//    a quick audit that they were not paid previously and that they all belong
//    to a release number- make sure there are no duplicated release numbers or
//    reference numbers. and then a manual signoff by 2 people who have verified
//    the wire. so an AI validation and then 2 further validations manually and
//    then clicking on wire will bring about all the bills paid with all of
//    their data."
//   "for order reconciliation needs to keep record of each one completed..
//    save it and it needs to be manually reconciled and approved."
// The audit rules and the reconciliation lifecycle run here FOR REAL.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
function loadEsm(src) {
  var names = [];
  var cjs = src.replace(/^import[^\n]*\n/gm, '')
    .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; })
    .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; });
  cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
  var mod = { exports: {} };
  /* eslint-disable no-new-func */
  new Function('module', 'exports', cjs)(mod, mod.exports);
  return mod.exports;
}
console.log('RG — wires portal (audit + AI + two-person sign-off) and saved order reconciliations');
var W = loadEsm(R('src/lib/wire-audit.js'));
var O = loadEsm(R('src/lib/order-recon.js'));
function codes(r) { return r.checks.map(function (c) { return c.code; }); }
function bill(id, vendor, num, rel, total, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: num, release_number: rel, total_amount: total, record_status: 'active', validation_status: 'validated' }, extra || {}); }
function line(pid, b, amt, others) { return { payment_id: pid, bill_id: b.id, amount: amt, bill: b, other_payments: others || [] }; }
var WIRE = { id: 'tx1', amount: 15000, direction: 'out', name: 'WIRE TO ACME' };

// ── 1. the audit rules
var b1 = bill('b1', 'Acme', 'INV-1', '1003-021', 10000); var b2 = bill('b2', 'Acme', 'INV-2', '1003-022', 5000);
var clean = W.auditWire({ wire: WIRE, lines: [line('p1', b1, 10000), line('p2', b2, 5000)], knownReleases: ['1003-021', '1003-022'] });
ok('1a: clean wire → passes, ALL_CLEAR, bills explain the whole wire', clean.pass && codes(clean).join() === 'ALL_CLEAR' && clean.placed === 15000);
var paid = W.auditWire({ wire: WIRE, lines: [line('p1', b1, 10000, [{ amount: 10000, paid_date: '2026-10-01', label: 'bank 2026-10-01 WIRE' }]), line('p2', b2, 5000)] });
ok('1b: "not paid previously" — a bill already paid in full BLOCKS (and the double payment is an OVERPAY block too)', !paid.pass && codes(paid).indexOf('PAID_BEFORE') >= 0 && codes(paid).indexOf('OVERPAID') >= 0);
var part = W.auditWire({ wire: { id: 'tx1', amount: 11000, direction: 'out' }, lines: [line('p1', b1, 6000, [{ amount: 4000, paid_date: '2026-10-01' }]), line('p2', b2, 5000)] });
ok('1c: a partly-paid bill whose balance this wire pays = WARN (signers see the earlier payment), not a block', part.pass && codes(part).indexOf('PART_PAID_BEFORE') >= 0 && codes(part).indexOf('OVERPAID') < 0);
var norel = W.auditWire({ wire: WIRE, lines: [line('p1', bill('b1', 'Acme', 'INV-1', '', 10000), 10000), line('p2', b2, 5000)] });
ok('1d: "they all belong to a release number" — a bill with NO release BLOCKS', !norel.pass && codes(norel).indexOf('RELEASE_MISSING') >= 0);
// superseded pin (v55.83-RJ, independent review gap 5): same vendor + same release + SAME amount = duplicate (block); a different amount (two trucks) = warning the signers confirm
// superseded again (v55.83-RK, Max Nov 9 11:38 "a unique release number and date"): duplicate = same vendor + same release + SAME DATE
var dupRelWire = W.auditWire({ wire: WIRE, lines: [line('p1', bill('b1', 'Acme', 'INV-1', '1003-021', 10000, { bill_date: '2026-11-01' }), 10000), line('p2', bill('b2', 'ACME ', 'INV-2', ' 1003-021', 5000, { bill_date: '2026-11-01' }), 5000)] });
var twoDays = W.auditWire({ wire: WIRE, lines: [line('p1', bill('b1', 'Acme', 'INV-1', '1003-021', 10000, { bill_date: '2026-11-01' }), 10000), line('p2', bill('b2', 'ACME ', 'INV-2', ' 1003-021', 5000, { bill_date: '2026-11-05' }), 5000)] });
ok('1e: "no duplicated release numbers" — same vendor, same release, same DATE twice on one wire BLOCKS (case/space-insensitive); different dates pass', !dupRelWire.pass && codes(dupRelWire).indexOf('DUP_RELEASE_IN_WIRE') >= 0 && twoDays.pass && codes(twoDays).indexOf('SAME_RELEASE_OTHER_DATE') >= 0);
var dupRelElse = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', b1, 10000)], sameRelease: { '1003-021': [{ bill_id: 'b1', vendor_name: 'Acme' }, { bill_id: 'b9', vendor_name: 'Acme', bill_number: 'INV-OLD' }] } });
ok('1f: the same vendor billed this release on ANOTHER bill → BLOCK (possible double charge)', !dupRelElse.pass && codes(dupRelElse).indexOf('DUP_RELEASE') >= 0);
var relOtherVendor = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', b1, 10000)], sameRelease: { '1003-021': [{ bill_id: 'b7', vendor_name: 'Trucking Co' }] } });
ok('1g: a DIFFERENT vendor on the same release (freight + product for one release) is normal → passes', relOtherVendor.pass && codes(relOtherVendor).indexOf('DUP_RELEASE') < 0);
var dupRefWire = W.auditWire({ wire: WIRE, lines: [line('p1', bill('b1', 'Acme', 'INV-1', '1003-021', 10000), 10000), line('p2', bill('b2', 'Acme', 'inv-1', '1003-022', 5000), 5000)] });
ok('1h: "no duplicated reference numbers" — two bills with the same reference on one wire BLOCK', !dupRefWire.pass && codes(dupRefWire).indexOf('DUP_REF_IN_WIRE') >= 0);
var dupRefSame = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', b1, 10000)], sameNumber: { 'INV-1': [{ bill_id: 'b5', vendor_name: 'acme' }] } });
var dupRefOther = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', b1, 10000)], sameNumber: { 'INV-1': [{ bill_id: 'b6', vendor_name: 'Other Ltd' }] } });
ok('1i: same reference on another bill — same vendor BLOCKS (duplicate bill), different vendor WARNS', !dupRefSame.pass && dupRefOther.pass && dupRefOther.warns === 1);
var voidB = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', bill('b1', 'Acme', 'X', '1003-021', 10000, { record_status: 'void' }), 10000)] });
var disp = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', bill('b1', 'Acme', 'X', '1003-021', 10000, { disputed: true }), 10000)] });
ok('1j: void or disputed bills BLOCK; money IN or no bills at all BLOCK', !voidB.pass && !disp.pass &&
  !W.auditWire({ wire: { id: 't', amount: 5, direction: 'in' }, lines: [line('p1', b1, 5)] }).pass && !W.auditWire({ wire: WIRE, lines: [] }).pass);
var under = W.auditWire({ wire: { id: 'tx1', amount: 20000, direction: 'out' }, lines: [line('p1', b1, 10000), line('p2', b2, 5000)] });
ok('1k: bills explaining only part of the wire → WARN with the gap', under.pass && codes(under).indexOf('NOT_FULLY_PLACED') >= 0);
var unk = W.auditWire({ wire: { id: 'tx1', amount: 10000, direction: 'out' }, lines: [line('p1', b1, 10000)], knownReleases: ['1003-999'] });
ok('1l: a release not found in the orders/invoices → WARN (never silently accepted)', unk.pass && codes(unk).indexOf('RELEASE_UNKNOWN') >= 0);

// ── 2. fingerprint + two-person status
var L = [line('p1', b1, 10000), line('p2', b2, 5000)];
var h = W.wireFingerprint(WIRE, L);
ok('2a: fingerprint is stable (order of lines does not matter) and changes when ANY release/amount/bill changes',
  h === W.wireFingerprint(WIRE, [L[1], L[0]]) && h !== W.wireFingerprint(WIRE, [line('p1', bill('b1', 'Acme', 'INV-1', '1003-099', 10000), 10000), L[1]]) &&
  h !== W.wireFingerprint(WIRE, [line('p1', b1, 9999), L[1]]) && h !== W.wireFingerprint(WIRE, [L[0]]));
ok('2b: status walks needs audit → flagged / awaiting 1st → awaiting 2nd → verified by 2',
  W.wireStatus(null, h) === 'needs_check' && W.wireStatus({ checked_at: 'x', check_hash: h, check_pass: false }, h) === 'flagged' &&
  W.wireStatus({ checked_at: 'x', check_hash: h, check_pass: true }, h) === 'awaiting_1st' &&
  W.wireStatus({ checked_at: 'x', check_hash: h, check_pass: true, signoff1_by: 'u1', signoff1_hash: h }, h) === 'awaiting_2nd' &&
  W.wireStatus({ checked_at: 'x', check_hash: h, check_pass: true, signoff1_by: 'u1', signoff1_hash: h, signoff2_by: 'u2', signoff2_hash: h }, h) === 'approved');
ok('2c: the bills change after signing → the audit AND both sign-offs stop counting (back to needs audit)',
  W.wireStatus({ checked_at: 'x', check_hash: h, check_pass: true, signoff1_by: 'u1', signoff1_hash: h, signoff2_by: 'u2', signoff2_hash: h }, 'wOTHER') === 'needs_check');

// ── 3. server: gates, AI step, two different people, all the bill data
var WR = R('src/app/api/accounting/wires/route.js');
ok('3a: route gated by ClickBooks access + Wires: View (a signer may view); signing needs Wires: Sign Off; release edit needs Bills: Manage',
  WR.indexOf("'accounting.clickbooks.access'") > 0 && WR.indexOf("'wires.view'") > 0 && WR.indexOf("assertPermission(db, userId, 'wires.signoff', req)") > 0 && WR.indexOf("'bills.manage'") > 0);
ok('3b: "AI validation" — the audit runs the rule checks AND an AI review, both saved against the fingerprint; no key → said plainly, never faked',
  WR.indexOf('aiReview(inpc, rc)') > 0 && WR.indexOf('ai_summary: ai.text') > 0 && WR.indexOf('ANTHROPIC_API_KEY is not set') > 0 && WR.indexOf('process.env.ANTHROPIC_API_KEY') > 0 && WR.indexOf('NEXT_PUBLIC_ANTHROPIC') < 0);
ok('3c: nobody signs before the audit passes on the CURRENT bills; AI concerns/unavailable → the signer must write what they verified',
  WR.indexOf('a0.check_hash !== hs') > 0 && WR.indexOf('a0.check_pass !== true') > 0 && WR.indexOf("a0.ai_ok !== true && note.length < 10") > 0);
ok('3d: "2 further validations manually" — the first signer cannot sign second; a new 1st sign-off clears the 2nd; simultaneous clicks cannot both win',
  WR.indexOf("a0.signoff1_by === userId") > 0 && WR.indexOf('signoff2_by: null') > 0 && WR.indexOf(".eq('updated_at', a0.updated_at)") > 0);
ok('3e: "not paid previously" — every OTHER payment ever made on each bill is gathered (any bank line, any recorded payment)',
  WR.indexOf("'vendor_bill_payments', 'id, bill_id, amount, paid_date, bank_transaction_id, method, voided', 'bill_id', billIds") > 0 && WR.indexOf('o.bank_transaction_id !== txId') > 0);
ok('3f: every step lands in the append-only audit trail', ['wire_audit_run', "'wire_signoff_1'", "'wire_signoff_2'", 'bill_release_set'].every(function (k) { return WR.indexOf(k) > 0; }));
var WT = R('src/components/WiresTab.jsx');
ok('3g: "clicking on wire will bring about all the bills paid with all of their data" — vendor, reference, release, dates, category, total, this wire, paid before, validation, notes + CSV',
  ['Bill / ref #', 'Release #', 'Bill date', 'Due', 'Category', 'Bill total', 'This wire', 'Paid before', 'Validated', 'Notes', 'CSV of the bills'].every(function (k) { return WT.indexOf(k) > 0; }) && WT.indexOf("action: 'detail'") > 0);
ok('3h: the portal shows the 3 steps (🤖 audit, 1st, 2nd verifier) and lets a missing release be filled right there',
  WT.indexOf('① 🤖 Audit') > 0 && WT.indexOf('②③ ✍ Sign-off by TWO different people') > 0 && WT.indexOf("action: 'set_release'") > 0);
var AT = R('src/components/AccountingTab.jsx'); var AX = R('src/lib/accounting-access.js'); var ST = R('src/components/SettingsTab.jsx');
ok('3i: 🏦 Wires is its own tab in BUYING, on the ClickBooks (KTC Hub) side, gated by Wires: View / Sign Off; Settings lists the 3 new switches',
  AT.indexOf("['wires', '🏦 Wires']") > 0 && /* superseded pin (v55.83-SI): 🔔 Waiting for me added in front, Bills / Wires / Purchase Orders unchanged */ AT.indexOf("['waiting', 'bills', 'wires', 'purchaseorders']") > 0 && AT.indexOf("<WiresTab {...props} />") > 0 && /KTC_SCREENS = \[[^\]]*'wires'/.test(AX) &&
  ["key: 'wires.view'", "key: 'wires.signoff'", "key: 'recon.signoff'"].every(function (k) { return ST.indexOf(k) > 0; }));
ok('3j: AccountingTab declares userProfile (the Audit Trail tab referenced it undeclared)', AT.indexOf('var userProfile = props.userProfile;') > 0);
var BT = R('src/components/BillsTab.jsx'); var BR = R('src/app/api/accounting/bills/route.js');
ok('3k: a bill carries its release number — entered on the bill, saved upper-case', BT.indexOf("placeholder={'Release #' + (editing.shipment_direction === 'outbound' ? ' *' : '')}") > 0 /* superseded (v55.83-RL): required mark for OUTBOUND bills */ && BR.indexOf('fields.release_number = String(bl.release_number') > 0);

// ── 4. saved order reconciliations — lifecycle run for real
var snap = { summary: { orders_in_scope: 3 }, orders_without_invoice: [{ release_number: '1003-050', customer: 'X' }, { release_number: '1003-050', customer: 'X' }],
  invoices_without_order: [{ system: 'accounting', ref: '1003-777', total_amount: 900 }], invoices_with_open_balance: [{ ref: 'A' }, { ref: 'B' }] };
var lines = O.reconLines(snap);
ok('4a: exception lines = orders without invoice + invoices without order (duplicates collapse; open balances kept for the record only)',
  lines.length === 2 && lines[0].key === 'noinv:1003-050' && lines[1].key === 'noorder:accounting:1003-777');
var run = { status: 'open', snapshot: snap, lines: {} };
ok('4b: cannot be marked reconciled while any line is unresolved', O.reconNext(run, 'u1').can_reconcile === false && /2 line/.test(O.reconNext(run, 'u1').why));
run.lines = { 'noinv:1003-050': { resolved: true, note: 'invoiced as INV-2231' }, 'noorder:accounting:1003-777': { resolved: true, note: '' } };
ok('4c: a line only counts as resolved WITH a note', O.reconProgress(snap, run.lines).resolved === 1 && !O.reconNext(run, 'u1').can_reconcile);
run.lines['noorder:accounting:1003-777'].note = 'sample order, no release';
ok('4d: all lines resolved → can be reconciled', O.reconNext(run, 'u1').can_reconcile === true);
var rec = { status: 'reconciled', reconciled_by: 'u1', snapshot: snap, lines: run.lines };
ok('4e: "manually reconciled and approved" — the reconciler cannot approve; a DIFFERENT person can', O.reconNext(rec, 'u1').can_approve === false && O.reconNext(rec, 'u2').can_approve === true);
ok('4f: once approved it is locked (no edits, no approve again)', (function () { var n = O.reconNext({ status: 'approved', snapshot: snap }, 'u3'); return !n.can_edit && !n.can_approve && !n.can_reconcile; })());
var NR = R('src/app/api/reconcile/nexttrade/route.js');
ok('4g: server — save / resolve / reconcile / approve / send back, all on the stored run, gated by Order Recon: Reconcile & Approve, every step audited',
  ['save_run', 'resolve_line', 'mark_reconciled', 'approve_run', 'send_back'].every(function (k) { return NR.indexOf("action === '" + k + "'") > 0; }) &&
  NR.indexOf("assertPermission(db, userId, 'recon.signoff', req)") > 0 && ['recon_run_saved', 'recon_line_resolved', 'recon_reconciled', 'recon_approved', 'recon_sent_back'].every(function (k) { return NR.indexOf("'" + k + "'") > 0; }));
ok('4h: state changes are conditional on the current status (two people clicking at once cannot skip a step)',
  NR.indexOf(".eq('status', 'open').select('id')") > 0 && NR.indexOf(".eq('status', 'reconciled').select('id')") > 0);
var NU = R('src/components/NexttradeReconciliation.jsx');
ok('4i: the screen saves runs and lists every one kept, with per-line notes, reconcile, approve and send-back',
  NU.indexOf('💾 Save this reconciliation') > 0 && NU.indexOf('<SavedReconciliations') > 0 && ["'mark_reconciled'", "'approve_run'", "'send_back'", "action: 'resolve_line'"].every(function (k) { return NU.indexOf(k) > 0; }));

// ── 5. database: the two-person rule and the lock are constraints, not just code
var SQ = R('sql/v55-83-RG-wires-recon.sql');
ok('5a: wire_audits — one row per wire, CHECK 2nd signer ≠ 1st (and needs a 1st); written only by the server',
  /bank_transaction_id uuid NOT NULL UNIQUE/.test(SQ) && SQ.indexOf('CHECK (signoff2_by IS NULL OR (signoff1_by IS NOT NULL AND signoff2_by <> signoff1_by))') > 0 && SQ.indexOf('wire_audits_update ON public.wire_audits FOR UPDATE TO authenticated USING (false)') > 0);
ok('5b: order_reconciliations — CHECK approver ≠ reconciler; an APPROVED run cannot be changed or deleted (trigger)',
  SQ.indexOf('CHECK (approved_by IS NULL OR (reconciled_by IS NOT NULL AND approved_by <> reconciled_by))') > 0 && SQ.indexOf('BEFORE UPDATE OR DELETE ON public.order_reconciliations') > 0 && SQ.indexOf("OLD.status = 'approved'") > 0);
ok('5c: safe to re-run', /ADD COLUMN IF NOT EXISTS release_number/.test(SQ) && /CREATE TABLE IF NOT EXISTS public\.wire_audits/.test(SQ) && /DROP TRIGGER IF EXISTS trg_order_recon_lock/.test(SQ));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
