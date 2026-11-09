// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RH — Max, Nov 8:
//  16:04 "the wire should be set up before a wire is actually sent ...then
//        later when the wire is sent than we attach that whole audit to that
//        wire with the attached bills etc.. does that make sense"
//  16:12 "wirepreparation is a permissioning. not all of wire will be to one
//        vendor-- BECASUE most of the wires would be going out of RTM..but
//        preparation should be before we send the payment to RTM..so that
//        professionoal fee wire will be where we do the approvals?"
//  16:14 "rtm fee is optional ... i like the rtm proof...attach a wire proof
//        that attaches to wires as part of the approgal. nextrade --not
//        necessary but can be only with bills...either or"
// The package rules run here FOR REAL; the database locks were run on PG16.
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
console.log('RH — wires prepared and approved BEFORE they are sent (RTM / NextTrade / vendor)');
var W = loadEsm(R('src/lib/wire-audit.js'));
function codes(r) { return r.checks.map(function (c) { return c.code; }); }
function bill(id, vendor, num, rel, total, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: num, release_number: rel, total_amount: total, record_status: 'active', validation_status: 'validated' }, extra || {}); }
function line(b, amt, others) { return { line_id: 'l' + b.id, bill_id: b.id, amount: amt, bill: b, other_payments: others || [] }; }
var RTM = { id: 'p1', seq: 7, payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 250 };
var truck = bill('b1', 'Fast Trucking', 'T-100', '1003-021', 1200, { paid_via: 'RTM Capital' });
var customs = bill('b2', 'Port Customs Broker', 'C-55', '1003-021', 800, { paid_via: 'RTM Capital' });

// ── 1. many vendors, one wire to RTM, optional fee
var r1 = W.auditPackage({ pkg: RTM, lines: [line(truck, 1200), line(customs, 800)], knownReleases: ['1003-021'] });
ok('1a: "not all of wire will be to one vendor" — one RTM wire carries bills of several vendors (two vendors on the SAME release is normal) and passes', r1.pass && r1.blocks === 0 && r1.warns === 0);
ok('1b: "rtm fee is optional" — the fee rides on top of the bills, shown to the signers (info, not a block); total = bills + fee', codes(r1).indexOf('FEE') >= 0 && r1.checks.filter(function (c) { return c.code === 'FEE'; })[0].level === 'info' && r1.bills === 2000 && r1.fee === 250 && r1.total === 2250);
var r1b = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(truck, 1200)] });
ok('1c: no fee → no fee line; ALL_CLEAR', r1b.pass && codes(r1b).indexOf('FEE') < 0 && codes(r1b).indexOf('ALL_CLEAR') >= 0 && r1b.total === 1200);
ok('1d: package label WP-0007', W.packageLabel(RTM) === 'WP-0007');

// ── 2. every bill must belong on THIS wire
var direct = bill('b3', 'Fast Trucking', 'T-101', '1003-022', 500);
var r2a = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(direct, 500)] });
ok('2a: a bill NOT marked "paid through RTM" cannot ride on the RTM wire', !r2a.pass && codes(r2a).indexOf('PAYEE_MISMATCH') >= 0);
var r2b = W.auditPackage({ pkg: { id: 'p2', payee_kind: 'vendor', payee_name: 'Fast Trucking', fee_amount: 0 }, lines: [line(truck, 1200)] });
ok('2b: an RTM-paid bill cannot be wired straight to the vendor (it would be paid twice: by us and by RTM)', !r2b.pass && codes(r2b).indexOf('PAYEE_MISMATCH') >= 0);
var r2c = W.auditPackage({ pkg: { id: 'p2', payee_kind: 'vendor', payee_name: 'Other Vendor', fee_amount: 0 }, lines: [line(direct, 500)] });
ok('2c: a direct vendor wire only carries THAT vendor\'s bills', !r2c.pass && codes(r2c).indexOf('PAYEE_MISMATCH') >= 0 &&
  W.auditPackage({ pkg: { id: 'p2', payee_kind: 'vendor', payee_name: 'fast trucking ', fee_amount: 0 }, lines: [line(direct, 500)] }).pass);
var nt = bill('b4', 'Texas Electric', 'E-9', '1003-030', 300, { paid_via: 'NextTrade Industries' });
var r2d = W.auditPackage({ pkg: { id: 'p3', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', fee_amount: 0 }, lines: [line(nt, 300)] });
var r2e = W.auditPackage({ pkg: { id: 'p3', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', fee_amount: 50 }, lines: [line(nt, 300)] });
ok('2d: "nextrade -- can be only with bills" — a NextTrade wire of its bills passes; any fee on it BLOCKS', r2d.pass && !r2e.pass && codes(r2e).indexOf('FEE_NOT_ALLOWED') >= 0);
var r2f = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(truck, 1200)], otherOpen: { b1: 'WP-0003' } });
ok('2e: the same bill already on another open wire BLOCKS (one bill, one wire)', !r2f.pass && codes(r2f).indexOf('IN_OTHER_PACKAGE') >= 0);

// ── 3. the RG rules still run on every bill of the package
var r3 = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(bill('b5', 'Fast Trucking', 'T-100', '', 1200, { paid_via: 'RTM Capital' }), 1200, [{ amount: 1200, paid_date: '2026-10-02' }])] });
ok('3a: not paid before + release required + no duplicates — all still enforced per bill on a package', !r3.pass && codes(r3).indexOf('PAID_BEFORE') >= 0 && codes(r3).indexOf('RELEASE_MISSING') >= 0);
var r3b = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(truck, 1200), line(bill('b6', 'fast trucking', 'T-200', '1003-021', 900, { paid_via: 'RTM Capital' }), 900)] });
// superseded pin (v55.83-RJ, independent review gap 5): different amounts on the same release = warning; the same amount = block
// superseded again (v55.83-RK, Max 11:38 "unique release number and date"): same date = block, different date = fine, missing date = warning
var d1 = Object.assign({}, truck, { bill_date: '2026-11-01' });
var r3c = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(d1, 1200), line(bill('b7', 'fast trucking', 'T-201', '1003-021', 900, { paid_via: 'RTM Capital', bill_date: '2026-11-01' }), 900)] });
var r3d = W.auditPackage({ pkg: Object.assign({}, RTM, { fee_amount: 0 }), lines: [line(d1, 1200), line(bill('b8', 'fast trucking', 'T-202', '1003-021', 900, { paid_via: 'RTM Capital', bill_date: '2026-11-04' }), 900)] });
ok('3b: the same vendor on the same release twice on one RTM wire: same DATE blocks, a different date passes, no date warns', !r3c.pass && r3d.pass && r3b.pass && r3b.warns > 0);

// ── 4. fingerprint + status walk (prepare → audit → 2 signers → ready → sent → attached → proof → complete)
var L = [line(truck, 1200), line(customs, 800)];
var h = W.packageFingerprint(RTM, L);
ok('4a: fingerprint changes when the fee, the payee, any bill or amount changes — earlier audit and signatures stop counting',
  h !== W.packageFingerprint(Object.assign({}, RTM, { fee_amount: 300 }), L) && h !== W.packageFingerprint(Object.assign({}, RTM, { payee_name: 'NextTrade Industries' }), L) &&
  h !== W.packageFingerprint(RTM, [line(truck, 1100), L[1]]) && h === W.packageFingerprint(RTM, [L[1], L[0]]));
var base = { status: 'draft', checked_at: 'x', check_hash: h, check_pass: true };
ok('4b: draft walks needs audit → awaiting 1st → awaiting 2nd → APPROVED, READY TO SEND (only after two people)',
  W.packageStatus({ status: 'draft' }, h, 0) === 'needs_check' && W.packageStatus(base, h, 0) === 'awaiting_1st' &&
  W.packageStatus(Object.assign({}, base, { signoff1_by: 'u1', signoff1_hash: h }), h, 0) === 'awaiting_2nd' &&
  W.packageStatus(Object.assign({}, base, { signoff1_by: 'u1', signoff1_hash: h, signoff2_by: 'u2', signoff2_hash: h }), h, 0) === 'ready_to_send' &&
  W.packageStatus(Object.assign({}, base, { signoff1_by: 'u1', signoff1_hash: h, signoff2_by: 'u2', signoff2_hash: h }), 'changed', 0) === 'needs_check');
ok('4c: sent → waiting for the bank line; attached → waiting for RTM proof until every bill has it → complete; cancelled stays cancelled',
  W.packageStatus({ status: 'sent' }, h, 2) === 'sent' && W.packageStatus({ status: 'attached' }, h, 2) === 'awaiting_proof' &&
  W.packageStatus({ status: 'attached' }, h, 0) === 'complete' && W.packageStatus({ status: 'cancelled' }, h, 0) === 'cancelled');

// ── 5. server
var S = R('src/app/api/accounting/wire-packages/route.js');
ok('5a: "wire preparation is a permissioning" — Wires: Prepare to prepare/cancel, Sign Off to sign, Send to mark sent + attach; all behind ClickBooks access',
  S.indexOf("perm(db, userId, ['wires.prepare'], req)") > 0 && S.indexOf("perm(db, userId, ['wires.signoff'], req)") > 0 && S.indexOf("perm(db, userId, ['wires.send'], req)") > 0 && S.indexOf("'accounting.clickbooks.access'") > 0);
ok('5b: two DIFFERENT people sign the exact audited wire; simultaneous clicks cannot both win',
  S.indexOf("pkg.signoff1_by === userId") > 0 && S.indexOf("pkg.check_hash !== P.hash") > 0 && S.indexOf(".eq('updated_at', pkg.updated_at)") > 0 && S.indexOf("pkg.ai_ok !== true && noteS.length < 10") > 0);
ok('5c: "attach a wire proof ... as part of the approval" — marking sent REQUIRES the bank confirmation file + reference, and only an approved wire can be sent; the approved total is frozen',
  S.indexOf("P.status !== 'ready_to_send'") > 0 && S.indexOf("kind: 'bank_confirmation'") > 0 && S.indexOf("pathT.indexOf('pv/wire-') !== 0") > 0 && S.indexOf('approved_total: P.live.total') > 0);
ok('5d: "then later when the wire is sent ... attach that whole audit to that wire" — the bank line is attached and the bills are recorded paid THEN (not before), with the overpay guard; failures roll back',
  S.indexOf("action === 'attach'") > 0 && S.indexOf("db.from('vendor_bill_payments').insert({ bill_id: lb.bill_id") > 0 && S.indexOf('would overpay it. Nothing was recorded.') > 0 && S.indexOf('were voided again; nothing changed') > 0);
ok('5e: a bank amount different from the approved wire is refused — only a super admin, with the reason, may accept it',
  // superseded pin (v55.83-RJ, independent review gap 14): the owner may accept it too
  S.indexOf('Only a super admin or the owner can accept a different amount') > 0 && S.indexOf("g1.ctx.isSuperAdmin || g1.ctx.role === 'owner'") > 0);
ok('5f: RTM / NextTrade wires book exactly like the 🏦 paid-through flow (method rtm + the company on the bank line; NextTrade = advance, auto-reviewed)',
  S.indexOf("pkg.payee_kind === 'vendor' ? 'wire' : 'rtm'") > 0 && S.indexOf('third_party_payer: pkg.payee_name') > 0 && S.indexOf("pkg.payee_kind === 'affiliate'") > 0);
ok('5g: "i like the rtm proof" — RTM\'s proof file covers ticked bills, with the date and reference; only for paid-through wires, after sending',
  // superseded pin (v55.83-RJ, independent review gap 6 / Max 16:14 "nextrade ... only with bills"): proof is asked from RTM-type companies only
  S.indexOf("action === 'rtm_proof'") > 0 && S.indexOf("kind: 'rtm_proof'") > 0 && S.indexOf('Proof of vendor payments is for wires through RTM (NextTrade wires have no proof step).') > 0);
ok('5h: a NextTrade or vendor wire with a fee is refused at save; amounts never above a bill\'s open balance; one bill one open wire checked before writing',
  // superseded pin (v55.83-RJ): plainer words ("what is still owed", "untick it")
  S.indexOf("NextTrade wires are bills only — no fee.") > 0 && S.indexOf('is more than what is still owed') > 0 && S.indexOf('one bill, one wire. Untick it here') > 0);
ok('5i: only a wire not yet sent can be cancelled (the money is gone otherwise)', S.indexOf("Only a wire that was not sent yet can be cancelled.") > 0);
ok('5j: every step in the append-only audit trail', ['wire_package_prepared', 'wire_package_audit_run', 'wire_package_signoff_1', 'wire_package_signoff_2', 'wire_package_sent', 'wire_package_attached', 'wire_package_rtm_proof', 'wire_package_cancelled'].every(function (k) { return S.indexOf("'" + k + "'") > 0; }));
var BR = R('src/app/api/accounting/bills/route.js');
ok('5k: a bill sitting on a prepared wire cannot be paid by hand in 💸 Bills (it is paid by that wire)', BR.indexOf("from('wire_package_lines').select('package_id').eq('bill_id', billId).eq('is_open', true)") > 0);
var WR = R('src/app/api/accounting/wires/route.js');
ok('5l: the bank view marks lines that came from an approved wire, and flags the rest "sent without an approved wire"',
  WR.indexOf("'wire_packages', 'id, seq, bank_transaction_id, status', 'bank_transaction_id'") > 0 && R('src/components/WiresTab.jsx').indexOf('⚠ sent without an approved wire') > 0);
var LS = R('src/lib/wire-package-server.js');
ok('5m: AI review runs BEFORE sending with the server-side key only; unavailable is said plainly', LS.indexOf('ABOUT TO SEND') > 0 && LS.indexOf('process.env.ANTHROPIC_API_KEY') > 0 && LS.indexOf('ANTHROPIC_API_KEY is not set') > 0 && LS.indexOf('NEXT_PUBLIC_ANTHROPIC') < 0);

// ── 6. screen + settings
var U = R('src/components/WirePackagesPanel.jsx'); var T = R('src/components/WiresTab.jsx'); var ST = R('src/components/SettingsTab.jsx');
// superseded pins 6a–6c (v55.83-RI, Max Nov 9 10:37 "very USER UNFRIENDLY ... make it simple"): the screen became a guided flow — wording realigned, same steps
ok('6a: 🏦 Wires opens on the prepared wires ("📤 Wires"); the after-the-fact bank view is the second switch', T.indexOf("useState('prepared')") > 0 && T.indexOf("['prepared', '📤 Wires']") > 0 && T.indexOf('<WirePackagesPanel') > 0);
ok('6b: prepare form: pay to RTM / NextTrade (bills only) / a vendor, tick bills of any vendor, optional fee, live total',
  U.indexOf('1 · Who receives the money?') > 0 && U.indexOf('🧾 A vendor directly') > 0 && U.indexOf('fee (optional) $') > 0 && U.indexOf('Total to wire: $') > 0);
ok('6c: the wire page: audit, two signers, send with confirmation, attach bank line, RTM proof, every bill with all its data, the proofs',
  ["'🤖 Checks'", '✍ I verified it — sign as ', '📤 Mark as sent', '🔗 This is it', "proof that it paid the vendors", 'Paid before', "'🏦 Bank confirmation'"].every(function (k) { return U.indexOf(k) > 0; }));
ok('6d: Settings lists Wires: Prepare and Wires: Send', ST.indexOf("key: 'wires.prepare'") > 0 && ST.indexOf("key: 'wires.send'") > 0);
ok('6e: proofs live in the PRIVATE bucket and open by signed link only', U.indexOf("from('bills-private').upload(path") > 0 && U.indexOf('createSignedUrl(path, 3600)') > 0 && U.indexOf('getPublicUrl') < 0);

// ── 7. database locks (run on PG16 in the session; pinned here)
var Q = R('sql/v55-83-RH-wire-packages.sql');
ok('7a: one bill, one OPEN wire — a unique index', Q.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_wpkg_line_open_bill ON public.wire_package_lines (bill_id) WHERE is_open') > 0);
ok('7b: 2nd signer ≠ 1st; NextTrade/vendor = no fee; cannot be SENT without both signatures and a sender', Q.indexOf('wpkg_two_different_people') > 0 && Q.indexOf("CHECK (payee_kind = 'service_provider' OR fee_amount = 0)") > 0 && Q.indexOf('wpkg_sent_complete') > 0);
ok('7c: once SENT nothing that was approved can change, no bills added/removed, no cancel, no delete; the bank line attaches once',
  Q.indexOf('WIRE_PACKAGE_LOCKED: a sent wire cannot be changed') > 0 && Q.indexOf('bills can only be added to a draft package') > 0 && Q.indexOf('a sent wire cannot be cancelled or reopened') > 0 &&
  Q.indexOf('only a draft package can be deleted') > 0 && /bank_transaction_id uuid UNIQUE/.test(Q));
ok('7d: safe to re-run + reads open, writes server-only', /CREATE TABLE IF NOT EXISTS public\.wire_packages/.test(Q) && /DROP TRIGGER IF EXISTS trg_wpkg_lock/.test(Q) && Q.indexOf('FOR INSERT TO authenticated WITH CHECK (false)') > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
