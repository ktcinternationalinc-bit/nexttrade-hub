// v55.83-WZ — Codex 21 Nov 10:22 P1: "existing duplicate bills still pass the wire audit". The REAL wire route and the REAL wire
// check on an in-memory database: a copy of a bill with ANOTHER date (and the vendor / number written differently) is a duplicate;
// a wire approved BEFORE the copy was noticed is re-checked live — flagged, and refused at send time, even with an override saved
// for it. Controls: another vendor, another company, a credit memo, a void copy. All data made up.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
function vb(id, o) { return Object.assign({ id: id, vendor_name: 'Example Supplier', bill_number: 'INV-1', release_number: '1003-021', total_amount: 100, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-10-01', shipment_direction: 'inbound', other_reference: 'BOL-' + id.substring(0, 4), wave_business_id: US, bill_type: 'supplier' }, o || {}); }
var A = 'a0000000-0000-0000-0000-00000000000a';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'wires.override', 'bills.manage'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [vb(A)],
  vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: []
});
var orig = Module._resolveFilename;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
global.__db = db;
db.rpcs = Object.assign({}, db.rpcs || {}, { hub_payment_guards_installed: function () { return true; } });
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var W = require(path.join(root, 'src/lib/wire-audit.js')); var D = require(path.join(root, 'src/lib/bill-duplicates.js'));
async function callRaw(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
async function call(user, body) {
  if (body && body.action === 'signoff') { var gq = await callRaw(user, { action: 'get', id: body.id }); if (gq && gq.ok) { for (var i = 0; i < gq.lines.length; i++) { await callRaw(user, { action: 'review_bill', id: body.id, bill_id: gq.lines[i].bill_id }); } } }
  return callRaw(user, body);
}
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('WZ — duplicate bills on wires, re-checked live');
function aw(lineBills, others) { return W.auditWire({ wire: { id: 'w', amount: lineBills.reduce(function (s, b) { return s + b.total_amount; }, 0), direction: 'out' }, lines: lineBills.map(function (b) { return { bill_id: b.id, amount: b.total_amount, bill: b, other_payments: [] }; }), sameRelease: {}, sameNumber: {}, sameIdentity: others || {}, knownReleases: ['1003-021'] }); }
function idx(bills) { var m = {}; bills.forEach(function (b) { var k = W.billIdentity(b); if (k) { (m[k] = m[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date, total_amount: b.total_amount }); } }); return m; }
function codes(r, lvl) { return r.checks.filter(function (c) { return c.level === lvl; }).map(function (c) { return c.code; }); }
(async function () {
  // ── the real check, Codex's two cases
  var a = vb(A); var b = vb('b0000000-0000-0000-0000-00000000000b', { bill_date: '2026-10-02', other_reference: 'BOL-other' });
  var r1 = aw([a], idx([a, b]));
  check('CODEX case 1: A on the wire, B (same vendor + number, dated a day later) in the Hub → BLOCK, not "all clear"', r1.pass === false && codes(r1, 'block').indexOf('DUP_REF') >= 0 && codes(r1, 'info').indexOf('ALL_CLEAR') < 0, r1.checks);
  var r2 = aw([a, b], idx([a, b]));
  check('CODEX case 2: A and B both on the wire for 200 → BLOCK (the same bill twice)', r2.pass === false && codes(r2, 'block').indexOf('DUP_REF_IN_WIRE') >= 0, r2.checks);
  var v = vb('c0000000-0000-0000-0000-00000000000c', { vendor_name: 'EXAMPLE SUPPLIER INC.', bill_number: 'inv 1', bill_date: '2026-12-25', total_amount: 140 });
  var r3 = aw([a], idx([a, v]));
  check('SPELLING: "EXAMPLE SUPPLIER INC." + "inv 1" + another date and amount is the same bill → BLOCK', r3.pass === false && codes(r3, 'block').indexOf('DUP_REF') >= 0);
  check('identity agrees with the Bills screen’s rule (wire-audit keeps its own copy, import-free)', [a, b, v, vb('z', { vendor_name: 'A & B Co', bill_number: 'X/9' }), vb('y', { bill_type: 'credit_memo' }), vb('x', { record_status: 'void' })].every(function (q) { return W.billIdentity(q) === D.billIdentity(q); }));
  var other = vb('d0000000-0000-0000-0000-00000000000d', { vendor_name: 'Kronos Logistics' }); var eg = vb('e0000000-0000-0000-0000-00000000000e', { wave_business_id: 'EGYPT' });
  var cm = vb('f0000000-0000-0000-0000-00000000000f', { bill_type: 'credit_memo', total_amount: -20 }); var vd = vb('10000000-0000-0000-0000-000000000010', { record_status: 'void' });
  var rc = aw([a], idx([a, other, eg, cm, vd]));
  check('CONTROLS: another vendor, another company, a credit memo and a void copy with the same number → no duplicate block', codes(rc, 'block').indexOf('DUP_REF') < 0 && codes(rc, 'block').indexOf('DUP_REF_IN_WIRE') < 0, rc.checks);
  var ovr = W.applyOverrides(r1, r1.checks.map(function (c) { return { check_key: W.checkKey(c), fingerprint: 'H', reason: 'I voided one of them', overridden_by: 'u1', overridden_at: 't' }; }), 'H');
  check('an override saved for the duplicate does not count — still a block', ovr.pass === false && codes(ovr, 'block').indexOf('DUP_REF') >= 0);

  // ── the REAL route: approved before the copy is noticed, then re-checked live
  var sv = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: 'Example Supplier', lines: [{ bill_id: A, amount: 100 }] });
  check('ROUTE: a wire with A alone is saved and passes its check', sv.ok && sv.audit && sv.audit.pass === true, sv);
  var id = sv.id;
  var s1 = await call('u2', { action: 'signoff', id: id, note: 'checked the bill and release' });
  var s2 = await call('u1', { action: 'signoff', id: id, note: 'verified the amount and vendor' });
  check('ROUTE: two signatures → approved, ready to send', s1.ok && s2.ok && s2.approved === true, [s1, s2]);
  db.t.vendor_bills.push(vb('b0000000-0000-0000-0000-00000000000b', { vendor_name: 'Example Supplier Co', bill_number: 'INV 1', bill_date: '2026-10-02', other_reference: 'BOL-late' }));
  var pk = db.t.wire_packages.filter(function (x) { return x.id === id; })[0];
  db.t.wire_package_overrides.push({ package_id: id, check_key: W.checkKey({ code: 'DUP_REF', bill_id: A, text: '' }), fingerprint: pk.check_hash, reason: 'I voided one of them', overridden_by: 'u1', overridden_at: '2026-11-18T00:00:00Z', code: 'DUP_REF', bill_id: A });
  var g = await call('u1', { action: 'get', id: id });
  check('ROUTE: the same approved wire, with a duplicate of its bill now in the Hub (another date, spelt differently) → shown FLAGGED, not ready to send', g.ok && g.package.status === 'flagged', g.package && g.package.status);
  var ms = await call('u1', { action: 'mark_sent', id: id, sent_date: '2026-11-20', bank_reference: 'FED1', proof_path: 'pv/x.pdf', proof_name: 'x.pdf' });
  check('ROUTE: sending it is REFUSED, with the reason, even though it was signed and an override was saved; nothing is marked sent', !ms.ok && /no longer passes its checks/.test(ms.error) && /another copy of this bill/.test(ms.error) && db.t.wire_packages.filter(function (x) { return x.id === id; })[0].status === 'draft', ms);
  var vdBill = db.t.vendor_bills.filter(function (x) { return x.id === 'b0000000-0000-0000-0000-00000000000b'; })[0]; vdBill.record_status = 'void';
  var g2 = await call('u1', { action: 'get', id: id });
  check('ROUTE: once the extra copy is voided, the wire is ready to send again (no new signatures needed: its bills did not change)', g2.ok && g2.package.status === 'ready_to_send', g2.package && g2.package.status);
  var srcR = fs.readFileSync(path.join(root, 'src/app/api/accounting/wire-packages/route.js'), 'utf8'); var srcW = fs.readFileSync(path.join(root, 'src/app/api/accounting/wires/route.js'), 'utf8'); var srcS = fs.readFileSync(path.join(root, 'src/lib/wire-package-server.js'), 'utf8');
  check('WIRING: both servers build the identity candidates and the wire route passes them to the check', srcR.indexOf('sameIdentity: ctx.sameIdentity') > 0 && srcS.indexOf('var sameIdentity = await sameIdentityFor(db, bills);') > 0 && srcW.indexOf('var sameIdentity = await sameIdentityFor(db, bills);') > 0 && srcW.indexOf('sameIdentity: sameIdentity, knownReleases: known') > 0);
  console.log('\nWZ wire re-check: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: threw ' + ((err && err.stack) || err)); process.exit(1); });
