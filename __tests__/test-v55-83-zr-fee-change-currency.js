// ═══════════════════════════════════════════════════════════════════════════
// v55.83-ZR — Codex 27 Nov P2 on ZP rev2 (live): changing the service fee of a request drawn from a transfer must READ that transfer
// and its currency first. A failed read, a missing transfer or one outside KTC's books refuses with NOTHING posted (zero calls to the
// fee-change database step); a read bank line without a currency code is USD (the documented default); a non-USD transfer is checked
// against bills in ITS currency. Runs the REAL wire-packages route on the in-memory database; the fee RPC is a recorder. Made-up data.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var PKG = 'c0000000-0000-0000-0000-0000000000a1'; var TX = 't0000000-0000-0000-0000-0000000000a1';
var FB = 'b0000000-0000-0000-0000-0000000000a1'; // the freight bill on the request
function bill(id, num, total, cat, cur) { return { id: id, vendor_name: 'NexPac Corporation', bill_number: num, release_number: '1002-' + num, total_amount: total, record_status: 'active', paid_via: 'RTM Capital', validation_status: 'validated', bill_date: '2026-10-01', shipment_direction: 'outbound', category: cat, wave_business_id: US, currency: cur || 'USD' }; }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Sender', role: 'staff', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [bill(FB, 'F-1', 2000, 'freight'), bill('b0000000-0000-0000-0000-0000000000e8', 'EUR-PF', 888, 'partner_fees', 'EUR'), bill('b0000000-0000-0000-0000-0000000000u7', 'USD-PF', 777, 'partner_fees', 'USD')],
  vendor_bill_payments: [], wire_packages: [{ id: PKG, seq: 41, status: 'attached', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 100, funding_txn_id: TX, created_at: '2026-10-02T12:00:00Z' }],
  wire_package_lines: [{ id: 'l0000000-0000-0000-0000-0000000000a1', package_id: PKG, bill_id: FB, amount: 2000, is_open: true }],
  wire_package_files: [], hub_audit_log: [], paid_through_parties: [],
  bank_transactions: [{ id: TX, date: '2026-10-02', amount: -10000, amount_abs: 10000, direction: 'out', wave_business_id: US, iso_currency: 'EUR', third_party_payer: 'RTM Capital' }],
});
var orig = Module._resolveFilename;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
global.__db = db;
var rpcCalls = [];
db.rpcs = Object.assign({}, db.rpcs || {}, {
  hub_payment_guards_installed: function () { return true; },
  wire_request_fee_change: function (a) { rpcCalls.push(a); return { ok: true, from: 100, to: a.p_fee, total: 2000 + a.p_fee, remaining_after: 1000 }; },
});
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
async function call(body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
function feeChange(fee) { return call({ action: 'change_fee', id: PKG, fee_amount: String(fee), reason: 'October handling fee per RTM invoice' }); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; process.exitCode = 1; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
function tx() { return db.t.bank_transactions.filter(function (t) { return t.id === TX; })[0]; }

console.log('ZR — a transfer-backed fee change reads the transfer and its currency first');
(async function () {
  // 1. the transfer's bank line cannot be read → 503, zero fee RPC calls
  var realFrom = db.from.bind(db);
  db.from = function (name) { var q = realFrom(name); if (name === 'bank_transactions') { var r0 = q.run; q.run = function () { if (this.filters.some(function (f) { return f[0] === 'eq' && f[1] === 'id' && f[2] === TX; })) { return { data: null, error: { message: 'statement timeout' } }; } return r0.call(this); }; } return q; }; // only the read of THIS transfer fails
  var r1 = await feeChange(500); db.from = realFrom;
  check('the transfer cannot be read → 503 "the service fee was not changed", and the fee step was NOT called', !r1.ok && r1._status === 503 && /was not changed/.test(r1.error) && rpcCalls.length === 0, [r1, rpcCalls.length]);
  // 2. the transfer is missing → 409, zero calls
  var saved = db.t.bank_transactions; db.t.bank_transactions = [];
  var r2 = await feeChange(500); db.t.bank_transactions = saved;
  check('the transfer is not found → 409, and the fee step was NOT called', !r2.ok && r2._status === 409 && /not found/.test(r2.error) && rpcCalls.length === 0, [r2, rpcCalls.length]);
  // 3. the transfer is in other books → 409, zero calls
  tx().wave_business_id = 'OTHER-BOOKS'; var r3 = await feeChange(500); tx().wave_business_id = US;
  check('the transfer is not in KTC’s books → 409, and the fee step was NOT called', !r3.ok && r3._status === 409 && /not in KTC/.test(r3.error) && rpcCalls.length === 0, [r3, rpcCalls.length]);
  // 4. a currency that is not a code → 409, zero calls
  tx().iso_currency = 'EURO$'; var r4 = await feeChange(500); tx().iso_currency = 'EUR';
  check('a transfer currency that is not a 3-letter code → 409, and the fee step was NOT called', !r4.ok && r4._status === 409 && /not a currency code/.test(r4.error) && rpcCalls.length === 0, [r4, rpcCalls.length]);
  // 5. an EUR transfer + a fee equal to the open EUR partner-fee bill → refused in EUR (not checked as USD), zero calls
  var r5 = await feeChange(888);
  check('EUR transfer + fee 888 = the open EUR partner-fee bill → 409 partner_fee_as_fee (checked in EUR), and the fee step was NOT called', !r5.ok && r5._status === 409 && r5.code === 'partner_fee_as_fee' && r5.partner_fee_bill && r5.partner_fee_bill.bill_number === 'EUR-PF' && rpcCalls.length === 0, [r5, rpcCalls.length]);
  // … and the USD partner-fee bill of 777 does not count for an EUR fee
  var r5b = await feeChange(777);
  check('EUR transfer + fee 777 (a USD partner-fee bill has that amount) → not matched, the fee change goes through ONCE', r5b.ok && rpcCalls.length === 1 && rpcCalls[0].p_fee === 777 && rpcCalls[0].p_pkg === PKG, [r5b, rpcCalls]);
  // 6. a successful non-USD change: an ordinary fee
  var r6 = await feeChange(500);
  check('EUR transfer + an ordinary fee → saved, the fee step called exactly once more, audited', r6.ok && rpcCalls.length === 2 && rpcCalls[1].p_fee === 500 && db.t.hub_audit_log.some(function (a) { return a.action === 'wire_request_fee_changed'; }), [r6, rpcCalls.length]);
  // 7. a bank line READ with no currency code → USD (the documented default), so the USD bill now matches
  tx().iso_currency = null; var r7 = await feeChange(777);
  check('a transfer read with no currency code is USD → fee 777 = the open USD partner-fee bill → 409, the fee step NOT called', !r7.ok && r7._status === 409 && r7.code === 'partner_fee_as_fee' && r7.partner_fee_bill.bill_number === 'USD-PF' && rpcCalls.length === 2, [r7, rpcCalls.length]);
  // the old silent fallback is gone
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/wire-packages/route.js'), 'utf8');
  check('the route no longer swallows the funding lookup into "USD" (no fxC fallback)', !/var fxC = null; try/.test(src) && /var txC = await db\.from\('bank_transactions'\)\.select\('id, iso_currency, wave_business_id'\)/.test(src), null);
  console.log('ZR fee change currency: ' + pass + ' passed, ' + failN + ' failed');
})().catch(function (e) { console.log('  ✗ CRASH ' + (e && e.stack)); failN++; process.exitCode = 1; console.log('ZR fee change currency: ' + pass + ' passed, ' + failN + ' failed'); });
