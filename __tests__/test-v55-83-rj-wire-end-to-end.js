// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RJ — Max, Nov 9 11:21: "how many times do we need to say to review the
// entire workflow and identify any gaps". This runs the REAL wire route and the
// REAL bills route end to end on an in-memory database, as two STAFF members
// with switches (not admins): prepare an RTM wire (old "RTM" spelling + an
// unassigned bill + fee) → automatic check → two different signers → send with
// the confirmation → bills locked → bank line attached → RTM proof → complete;
// then NextTrade (bills only, no release needed, no proof), bad amounts,
// permissions, cancel, setup.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY; // the AI step is "unavailable" here — the flow must still work (signers write notes)
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  // fixture realigned (v55.83-RL, Max 12:20): bills carry their date and inbound / outbound; the NextTrade overhead bill has neither release nor direction
  vendor_bills: [
    { id: 'b0000000-0000-0000-0000-000000000001', vendor_name: 'Fast Trucking', bill_number: 'T-100', release_number: '1003-021', total_amount: 1200, record_status: 'active', paid_via: 'RTM', validation_status: 'validated', bill_date: '2026-10-01', shipment_direction: 'outbound' },
    { id: 'b0000000-0000-0000-0000-000000000002', vendor_name: 'Port Customs', bill_number: 'C-55', release_number: '1003-021', total_amount: 800, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-10-02', shipment_direction: 'outbound' },
    { id: 'b0000000-0000-0000-0000-000000000003', vendor_name: 'TX Electric', bill_number: 'E-9', release_number: null, total_amount: 300, record_status: 'active', paid_via: 'NextTrade Industries', validation_status: 'validated', bill_date: '2026-10-03' },
  ],
  vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], hub_audit_log: [], paid_through_parties: [],
  bank_transactions: [{ id: '70000000-0000-0000-0000-000000000001', date: '2026-11-10', amount_abs: 2250, direction: 'out', pending: false, name: 'WIRE TO RTM CAPITAL', wave_business_id: 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk', review_status: 'needs_review' }],
});
// the database's own lock: once SENT, bill/amount changes are refused (like the RH trigger)
db.hooks = { wire_package_lines: { update: function (row, p) { var pk = db.t.wire_packages.filter(function (x) { return x.id === row.package_id; })[0]; if (pk && pk.status !== 'draft' && (p.amount !== undefined || p.bill_id !== undefined)) { return 'WIRE_PACKAGE_LOCKED'; } } } };
var orig = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  return orig.apply(this, arguments);
};
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
require('fs').writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
global.__db = db;
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
// superseded (v55.83-RY, Max Nov 10 00:11: "view each bill and close the bill as you check before you approve it and sign it"):
// a signer must open + check every bill of the wire first — the sign-off calls below do that, like a person would
async function call(r, user, body) {
  if (body && body.action === 'signoff' && r.POST) {
    var gq = await callRaw(r, user, { action: 'get', id: body.id });
    if (gq && gq.ok) { for (var qi = 0; qi < gq.lines.length; qi++) { await callRaw(r, user, { action: 'review_bill', id: body.id, bill_id: gq.lines[qi].bill_id }); } }
  }
  return callRaw(r, user, body);
}
async function callRaw(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); return j; }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 400))); if (!cond) { process.exitCode = 1; } }
(async function () {
  var p = await call(route, 'u1', { action: 'payees' });
  check('payees: RTM Capital + NextTrade (defaults)', p.ok && p.parties.length === 2, p);
  var ob = await call(route, 'u1', { action: 'open_bills', payee_kind: 'service_provider', payee_name: 'RTM Capital' });
  check('RTM wire lists the old-spelling "RTM" bill AND the unassigned bill (not the NextTrade one)', ob.ok && ob.bills.map(function (b) { return b.id; }).sort().join() === 'b0000000-0000-0000-0000-000000000001,b0000000-0000-0000-0000-000000000002', ob);
  var sv = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: '250', lines: [{ bill_id: 'b0000000-0000-0000-0000-000000000001', amount: 1200 }, { bill_id: 'b0000000-0000-0000-0000-000000000002', amount: '800' }] });
  check('save: wire created, total 2250 incl. fee, checked automatically (passes)', sv.ok && sv.total === 2250 && sv.audit && sv.audit.pass === true, sv);
  check('save did NOT mark the unassigned bill yet (still owed directly)', db.t.vendor_bills[1].paid_via === null);
  var id = sv.id;
  var g = await call(route, 'u1', { action: 'get', id: id });
  check('the wire page: awaiting the 1st signature', g.ok && g.package.status === 'awaiting_1st', g.package);
  var s1bad = await call(route, 'u2', { action: 'signoff', id: id, note: '' });
  check('AI off → signing without a note is refused', !s1bad.ok && /write what you verified/.test(s1bad.error), s1bad);
  var s1 = await call(route, 'u2', { action: 'signoff', id: id, note: 'checked both bills and releases' });
  check('1st signature (Checker)', s1.ok && s1.slot === 1, s1);
  var s2bad = await call(route, 'u2', { action: 'signoff', id: id, note: 'again from the same person' });
  check('the same person cannot sign twice', !s2bad.ok, s2bad);
  var s2 = await call(route, 'u1', { action: 'signoff', id: id, note: 'verified totals against RTM invoice' });
  check('2nd signature by a different person → approved', s2.ok && s2.approved === true, s2);
  var noProof = await call(route, 'u1', { action: 'mark_sent', id: id, sent_date: '2026-11-09', bank_reference: 'FED123' });
  check('sending without the bank confirmation file is refused', !noProof.ok, noProof);
  var sent = await call(route, 'u1', { action: 'mark_sent', id: id, sent_date: '2026-11-09', bank_reference: 'FED123', proof_path: 'pv/wire-x-1-conf.pdf', proof_name: 'conf.pdf' });
  check('marked SENT with the confirmation', sent.ok, sent);
  check('NOW the unassigned bill is "paid through RTM Capital"', db.t.vendor_bills[1].paid_via === 'RTM Capital');
  var edit = await call(bills, 'u1', { action: 'save_bill', bill: { id: 'b0000000-0000-0000-0000-000000000002', vendor_name: 'Port Customs', bill_number: 'C-55', total_amount: 900, bill_date: '2026-11-01' } });
  // superseded (v55.83-RV, review #1): the bill on a sent wire is also VALIDATED, and that lock now answers first — still refused
  check('editing a bill on a SENT wire is refused', edit.error && (/already SENT/.test(edit.error) || /VALIDATED — its .* cannot change/.test(edit.error)), edit);
  var vd = await call(bills, 'u1', { action: 'void_bill', id: 'b0000000-0000-0000-0000-000000000001' });
  check('voiding a bill on a wire is refused', vd.error && /on wire WP-/.test(vd.error), vd);
  var other = await call(bills, 'u1', { action: 'record_payment', bill_id: 'b0000000-0000-0000-0000-000000000003', amount: 300, paid_date: '2026-11-10', bank_transaction_id: '70000000-0000-0000-0000-000000000001', method: 'rtm' });
  check('the old 🏢 flow cannot use up the bank line the sent wire is waiting for', other.error && /attach it in 🏦 Wires/.test(other.error), other);
  var bc = await call(route, 'u1', { action: 'bank_candidates', id: id });
  check('the bank line is found, exact amount', bc.ok && bc.candidates.length === 1 && bc.candidates[0].exact, bc);
  var at = await call(route, 'u1', { action: 'attach', id: id, bank_transaction_id: '70000000-0000-0000-0000-000000000001' });
  check('attach: 2 bills recorded paid by the wire, method rtm, line marked RTM', at.ok && at.bills_paid === 2 && db.t.vendor_bill_payments.length === 2 && db.t.vendor_bill_payments.every(function (x) { return x.method === 'rtm'; }) && db.t.bank_transactions[0].third_party_payer === 'RTM Capital', at);
  var vp = await call(bills, 'u1', { action: 'void_payment', id: db.t.vendor_bill_payments[0].id });
  check('a payment the wire recorded cannot be voided in Bills', vp.error && /recorded by an approved wire/.test(vp.error), vp);
  var g2 = await call(route, 'u1', { action: 'get', id: id });
  check('status: in the bank, waiting for RTM proof', g2.package.status === 'awaiting_proof', g2.package);
  var pr = await call(route, 'u1', { action: 'rtm_proof', id: id, line_ids: g2.lines.map(function (l) { return l.line_id; }), paid_date: '2026-11-11', reference: 'RTM-77', proof_path: 'pv/wire-x-2-rtm.pdf' });
  var g3 = await call(route, 'u1', { action: 'get', id: id });
  check('RTM proof for both bills → complete', pr.ok && g3.package.status === 'complete', g3.package);
  // NextTrade: bills only, no release needed, no proof step
  // superseded pin (v55.83-SC, Max Nov 12 09:40: "user can put additional funds to pay a service fee for RTM or nextrade") — a NextTrade wire MAY carry a listed fee now; only a wire straight to a vendor may not
  var sv2 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: 'x', fee_amount: '50', lines: [{ bill_id: 'b0000000-0000-0000-0000-000000000003', amount: 300 }] });
  check('a wire straight to a vendor with a fee is refused', !sv2.ok && /bills only/.test(sv2.error), sv2);
  var sv3 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', lines: [{ bill_id: 'b0000000-0000-0000-0000-000000000003', amount: '300' }] });
  check('NextTrade wire of a bill WITHOUT a release passes the check (warning only)', sv3.ok && sv3.audit && sv3.audit.pass === true, sv3);
  var g4 = await call(route, 'u1', { action: 'get', id: sv3.id });
  check('NextTrade wire has no proof step', g4.package.paid_through === false, g4.package);
  // change the draft: amount with a comma, then a bad amount
  var ch = await call(route, 'u1', { action: 'save_draft', id: sv3.id, payee_kind: 'affiliate', payee_name: 'NextTrade Industries', lines: [{ bill_id: 'b0000000-0000-0000-0000-000000000003', amount: '1,00.00' }] });
  check('a garbled amount is refused with a message (nothing changed)', !ch.ok && /amount/.test(ch.error) && db.t.wire_package_lines.filter(function (l) { return l.package_id === sv3.id; }).length === 1, ch);
  var stuck = await call(route, 'u2', { action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', lines: [{ bill_id: 'b0000000-0000-0000-0000-000000000003', amount: 300 }] });
  check('someone without "Prepare wires" cannot prepare', !stuck.ok && /Prepare/.test(stuck.error), stuck);
  var cl = await call(route, 'u1', { action: 'cancel', id: sv3.id, note: 'test' });
  check('cancel a draft → its bills are free again', cl.ok && db.t.wire_package_lines.filter(function (l) { return l.package_id === sv3.id && l.is_open; }).length === 0, cl);
  var su = await call(route, 'u1', { action: 'setup' });
  check('setup answers (signers counted)', su.ok && su.people['wires.signoff'].length === 2, su);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN || pass < 27) { process.exit(1); }
})().catch(function (e) { console.log('CRASH', e.stack); process.exit(1); });
