// v55.83-WF B2 — money with RTM / NextTrade pays bills the same way as every wire (Max, 20 Nov: "follow the same protocol as other
// wires"; Codex 21 Nov: enforced on the SERVER by the one identity rule). Real Bills + Wires handlers on an in-memory database.
//   • a transfer CONFIRMED as funds held: no direct bill payment (Bills → Pay, record a payment) — only a request (two signatures)
//   • NOT confirmed yet: linking the bills it paid (reconciling) — only with the 🔒 Advances: Manage switch
//   • ordinary bank lines, and everything before the database step: unchanged
//   • Wires → New: what a transfer can still pay is the database's figure; an unconfirmed one is shown, not usable
// Run: node __tests__/test-v55-83-wf-b2-pay-routing.js
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var B1 = 'b3000000-0000-0000-0000-000000000001', B2 = 'b3000000-0000-0000-0000-000000000002', B3 = 'b3000000-0000-0000-0000-000000000003';
var TC = 'c3000000-0000-0000-0000-000000000001'; // confirmed RTM transfer
var TU = 'c3000000-0000-0000-0000-000000000002'; // marked RTM, not confirmed
var TX = 'c3000000-0000-0000-0000-000000000003'; // recognised only from its bank text, not confirmed
var TO = 'c3000000-0000-0000-0000-000000000004'; // ordinary vendor payment line
function line(id, amt, payer, name) { return { id: id, wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: amt, date: '2026-11-10', posted_date: '2026-11-10', pending: false, third_party_payer: payer, name: name || 'WIRE OUT', merchant_name: null, review_status: null, transfer_group_id: null, iso_currency: 'USD' }; }
function seed() {
  return new MemDB({
    users: [{ id: 'u1', name: 'Clerk', role: 'staff', active: true }, { id: 'u2', name: 'Advances person', role: 'staff', active: true }],
    module_permissions: [].concat(
      ['accounting.clickbooks.access', 'accounting.view', 'bills.manage', 'bills.view', 'wires.prepare'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
      ['accounting.clickbooks.access', 'accounting.view', 'bills.manage', 'bills.view', 'wires.prepare', 'advances.manage'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
    vendor_bills: [
      { id: B1, vendor_name: 'Ocean Line', bill_number: 'O-1', total_amount: 300, record_status: 'active', paid_via: null, bill_date: '2026-11-01', shipment_direction: 'outbound', validation_status: 'validated', currency: 'USD' },
      { id: B2, vendor_name: 'Port Fees', bill_number: 'P-1', total_amount: 200, record_status: 'active', paid_via: null, bill_date: '2026-11-02', shipment_direction: 'outbound', validation_status: 'validated', currency: 'USD' },
      { id: B3, vendor_name: 'Dray Co', bill_number: 'D-1', total_amount: 400, record_status: 'active', paid_via: null, bill_date: '2026-11-03', shipment_direction: 'outbound', validation_status: 'validated', currency: 'USD' }],
    vendor_bill_payments: [], vendor_bill_events: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], hub_audit_log: [],
    paid_through_parties: [{ name: 'RTM Capital', kind: 'service_provider' }, { name: 'NextTrade Industries', kind: 'affiliate' }],
    bank_transactions: [line(TC, 1000, 'RTM Capital'), line(TU, 800, 'RTM Capital'), line(TX, 600, null, 'ONLINE TRANSFER TO CHK ...9909 TRANSACTION#: 1'), line(TO, 500, null, 'WIRE TO OCEAN LINE')],
    party_funding_transfers: [{ bank_transaction_id: TC, party: 'RTM Capital', state: 'confirmed' }],
  });
}
var db = seed();
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var caller = { id: 'u1' };
function stub(rel, ex) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: ex }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: caller.id }); } });
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
async function call(r, user, body) { caller.id = user; var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
var summaryCalls = [];
function setWf(on) {
  db.rpcs = db.rpcs || {};
  db.rpcs.hub_payment_guards_installed = function () { return true; };
  db.rpcs.hub_party_funds_installed = function () { return on; };
  db.rpcs.wire_funding_summary = function (a) {
    summaryCalls.push(a);
    var st = a.p_txn === TC ? 'confirmed' : 'needs_reconciliation';
    var t = db.t.bank_transactions.filter(function (x) { return x.id === a.p_txn; })[0];
    var held = Number(t.amount_abs) - (a.p_txn === TC ? 50 : 0); var resv = a.p_txn === TC && !a.p_except ? 100 : 0;
    return { found: true, party: t.third_party_payer, status: st, amount: Number(t.amount_abs), refunds: a.p_txn === TC ? 50 : 0, bills: 0, fees: 0, used: 0, held: held, reserved: resv, available: st === 'confirmed' ? held - resv : 0, remaining: st === 'confirmed' ? held - resv : 0 };
  };
}
function payBody(txn, bill, amt, rid) { return { action: 'pay_bills_from_bank', bank_transaction_id: txn, bills: [{ bill_id: bill, amount: amt }], request_id: rid }; }
function paysOn(txn) { return db.t.vendor_bill_payments.filter(function (p) { return p.bank_transaction_id === txn && p.voided !== true; }).length; }

console.log('WF B2 — bills from money held by a company go through a request');
(async function () {
  // ── before the database step: unchanged
  setWf(false);
  var p0 = await call(bills, 'u1', payBody(TC, B1, 100, 'r-0'));
  check('BEFORE the WF database step: Bills → Pay on an RTM transfer works as before', p0.ok === true && paysOn(TC) === 1, p0);
  db = seed(); global.__db = db; setWf(true);
  // ── confirmed transfer: refused for everyone, both direct paths
  var p1 = await call(bills, 'u2', payBody(TC, B1, 100, 'r-1'));
  check('WF on, CONFIRMED transfer: Bills → Pay is refused (409) even with Advances: Manage, nothing recorded, the answer says Wires → New', p1._status === 409 && /only through a request to RTM Capital/.test(p1.error || '') && /Wires → New/.test(p1.error || '') && paysOn(TC) === 0, p1);
  var p2 = await call(bills, 'u2', { action: 'record_payment', bill_id: B1, amount: 100, paid_date: '2026-11-11', bank_transaction_id: TC, method: 'bank' });
  check('WF on, CONFIRMED transfer: “record a payment” is refused the same way', p2._status === 409 && /only through a request/.test(p2.error || '') && paysOn(TC) === 0, p2);
  // ── not confirmed: reconciling needs the switch
  var p3 = await call(bills, 'u1', payBody(TU, B1, 100, 'r-3'));
  check('WF on, transfer NOT confirmed: linking a bill without 🔒 Advances: Manage is refused (403), nothing recorded', p3._status === 403 && /Advances: Manage/.test(p3.error || '') && paysOn(TU) === 0, p3);
  var p4 = await call(bills, 'u2', payBody(TU, B1, 100, 'r-4'));
  check('WF on, transfer NOT confirmed: the person with the switch links the bill it paid (reconciling)', p4.ok === true && paysOn(TU) === 1, p4);
  var p5 = await call(bills, 'u1', payBody(TX, B2, 50, 'r-5'));
  check('WF on, a transfer recognised ONLY from its bank text (to CHK ...9909) gets the same rule — not an escape route', p5._status === 403 && /recognised from its bank text/.test(p5.error || '') && paysOn(TX) === 0, p5);
  var p6 = await call(bills, 'u1', payBody(TO, B2, 200, 'r-6'));
  check('WF on, an ordinary bank line (a wire to a vendor): Bills → Pay unchanged', p6.ok === true && paysOn(TO) === 1, p6);
  // ── Wires → New: the database's figure
  summaryCalls = [];
  var fl = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital' });
  var fc = (fl.lines || []).filter(function (x) { return x.id === TC; })[0]; var fu = (fl.lines || []).filter(function (x) { return x.id === TU; })[0];
  check('Wires → New: the confirmed transfer shows the database figure — held 950 (50 came back), 100 reserved, 850 left to use', fl.ok && fl.wf === true && fc && fc.confirmed === true && fc.held === 950 && fc.reserved === 100 && fc.remaining === 850 && fc.available === 850, fl);
  check('Wires → New: the transfer not confirmed yet is SHOWN with nothing usable (left 0, not confirmed)', fu && fu.confirmed === false && fu.remaining === 0 && fu.held > 0, fu);
  var sd = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TU, lines: [{ bill_id: B3, amount: 100 }], fee_amount: 0 });
  check('Wires → New on the unconfirmed transfer: refused (409), nothing saved, the answer says confirm it first', sd._status === 409 && /not confirmed as funds held/.test(sd.error || '') && db.t.wire_packages.length === 0, sd);
  summaryCalls = [];
  await call(wires, 'u1', { action: 'save_draft', id: 'd3000000-0000-0000-0000-000000000009', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TC, lines: [{ bill_id: B3, amount: 100 }], fee_amount: 0 });
  check('editing a draft: the transfer figure leaves THAT draft’s own reservation out (p_except = the draft)', summaryCalls.some(function (a) { return a.p_txn === TC && a.p_except === 'd3000000-0000-0000-0000-000000000009'; }), summaryCalls);
  setWf(false); summaryCalls = [];
  var fl0 = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital' });
  check('BEFORE the WF database step: Wires → New lists transfers exactly as before (no database figure asked)', fl0.ok && fl0.wf === false && summaryCalls.length === 0 && (fl0.lines || []).every(function (x) { return x.status === undefined; }), fl0);
  // ── the screen
  var wp = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8');
  check('screen: a transfer not confirmed is drawn greyed with “confirm it in Bills → Funds with …”, not as a button to pick', /function fundWaiting\(x\)/.test(wp) && /not confirmed as funds held by ' \+ ed\.payee \+ ' yet/.test(wp));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED', e && e.stack); process.exit(1); });
