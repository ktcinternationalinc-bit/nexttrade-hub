// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SD — Max, Nov 12 09:44: "also make sure that after creating the wire from bills it is seen as a prewire status
//  that can be cancelled or modified by the user."
// A wire is a PRE-WIRE until both signatures are in: the preparer can change it (a signature already given is cleared) or
// delete it (the bills go back to open). REAL routes on an in-memory DB.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var B1 = 'bd300000-0000-0000-0000-000000000001', B2 = 'bd300000-0000-0000-0000-000000000002';
function nb(i, no, amt) { return { id: i, vendor_name: 'Trinity Logistics', bill_number: no, bill_date: '2026-11-01', total_amount: amt, record_status: 'active', validation_status: 'validated', bill_type: 'trucking', shipment_direction: 'inbound', other_reference: 'REF-' + no, paid_via: null }; }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(B1, 'T1', 1000), nb(B2, 'T2', 600)], vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], expense_categories: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [], paid_through_parties: [], bank_transactions: [], bill_commission_rules: [], bill_price_rules: [] });
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
console.log('SD — a new wire is a PRE-WIRE: the preparer can change it or delete it');
(async function () {
  var s = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: 'Trinity Logistics', lines: [{ bill_id: B1, amount: 1000 }] });
  var g0 = await call(wires, 'u1', { action: 'get', id: s.id });
  check('1: a wire just created is a draft waiting for signatures (the screen calls it PRE-WIRE)', s.ok && g0.package.raw_status === 'draft' && ['needs_check', 'awaiting_1st'].indexOf(g0.package.status) >= 0, g0.package && g0.package.status);
  var row = ((await call(bills, 'u1', { action: 'list' })).bills || []).filter(function (x) { return x.id === B1; })[0] || {};
  check('2: its bill says OPEN · on WP-… (pre-wire — can still change)', /^OPEN · on WP-\d+ \(pre-wire — can still change\)/.test(row.wire_state_words || ''), row.wire_state_words);
  await call(wires, 'u1', { action: 'review_bill', id: s.id, bill_id: B1 });
  var so = await call(wires, 'u1', { action: 'signoff', id: s.id, note: 'checked every bill against the orders' });
  var c = await call(wires, 'u1', { action: 'save_draft', id: s.id, payee_kind: 'vendor', payee_name: 'Trinity Logistics', lines: [{ bill_id: B1, amount: 400 }, { bill_id: B2, amount: 600 }] });
  var g1 = await call(wires, 'u1', { action: 'get', id: s.id });
  check('3: after the first signature the preparer can still CHANGE it (add a bill, make one a part payment) — and that signature no longer counts', so.ok && c.ok && g1.lines.length === 2 && g1.package.status !== 'awaiting_2nd' && g1.package.status !== 'ready_to_send', { so: so, c: c, st: g1.package && g1.package.status });
  var d0 = await call(wires, 'u1', { action: 'delete_wire', id: s.id, reason: '' });
  var d = await call(wires, 'u1', { action: 'delete_wire', id: s.id, reason: 'built it for the wrong amount' });
  var row2 = ((await call(bills, 'u1', { action: 'list' })).bills || []).filter(function (x) { return x.id === B1; })[0] || {};
  check('4: the preparer can DELETE it (with a reason) — the bills are open again with no wire on them', !d0.ok && d.ok && !row2.wire_state && row2.status === 'OPEN' && !db.t.wire_package_lines.some(function (l) { return l.is_open; }), { d0: d0, d: d, w: row2.wire_state });
  var U = R('src/components/WirePackagesPanel.jsx');
  check('5: the wire screen: PRE-WIRE badge, a plain line saying it can be changed or deleted, and PRE-WIRE in the list', U.indexOf('var PRE_WIRE = { needs_check: 1, flagged: 1, awaiting_1st: 1, awaiting_2nd: 1 };') > 0 && U.indexOf('This is a PRE-WIRE — nothing has been approved or sent.') > 0 && U.indexOf("(PRE_WIRE[p.status] ? 'PRE-WIRE · ' : '')") > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
