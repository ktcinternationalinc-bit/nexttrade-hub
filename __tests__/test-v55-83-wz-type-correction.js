// v55.83-WZ — Codex 21 Nov 10:52 P2: a credit memo whose type is corrected to a payable bill can become a SECOND copy of a bill
// (same company + vendor + number). The database refuses it (sql/v55-83-WZ-same-number-bills.sql, checked separately on real
// Postgres); here the REAL Bills route runs on an in-memory database whose vendor_bills update hook repeats that refusal, to prove
// both type-changing paths (Validate, Save validation progress) show the duplicate message and never claim the type was saved.
// All data made up.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var A = 'a3000000-0000-0000-0000-00000000000a', CM = 'c3000000-0000-0000-0000-00000000000c', CM2 = 'c3000000-0000-0000-0000-00000000000d';
function vb(id, o) { return Object.assign({ id: id, vendor_name: 'Example Supplier', bill_number: 'INV-1', release_number: '1003-021', total_amount: 100, record_status: 'active', paid_via: null, validation_status: null, bill_date: '2026-10-01', shipment_direction: 'outbound', wave_business_id: 'US', bill_type: 'supplier' }, o || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Clerk', role: 'staff', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [vb(A), vb(CM, { vendor_name: 'EXAMPLE SUPPLIER INC.', bill_number: 'inv 1', bill_date: '2026-10-05', total_amount: -20, bill_type: 'credit_memo' }),
    vb(CM2, { bill_number: 'CM-77', bill_date: '2026-10-06', total_amount: -15, bill_type: 'credit_memo' })],
  vendor_bill_payments: [], vendor_bill_events: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: []
});
var D = require(path.join(root, 'src/lib/bill-duplicates.js'));
// the database rule, repeated: a row turned from credit into a payable bill is refused when another active payable bill of the same
// company has the same vendor + number (the message format is the SQL's own)
db.hooks = Object.assign({}, db.hooks || {}, { vendor_bills: { update: function (row, payload) {
  if (!payload || payload.bill_type === undefined || !/^credit/i.test(String(row.bill_type || '')) || /^credit/i.test(String(payload.bill_type || ''))) { return null; }
  var next = Object.assign({}, row, payload); var k = D.billIdentity(next); if (!k) { return null; }
  var o = db.t.vendor_bills.filter(function (b) { return b.id !== row.id && b.record_status === 'active' && D.billIdentity(b) === k; })[0];
  return o ? 'HUB_EXACT_DUPLICATE: Bill #' + o.bill_number + ' from ' + o.vendor_name + ' is already in the Hub (dated ' + o.bill_date + ', $' + Number(o.total_amount).toFixed(2) + ', not disputed). A second bill with the same number from the same vendor is not allowed. It was NOT added again — open that bill and change it there.' : null;
} } });
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(body) { var res = await bills.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: new Map() }); var j = await res.json(); j.__status = res.status; return j; }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
function row(id) { return db.t.vendor_bills.filter(function (b) { return b.id === id; })[0]; }
function auditsFor(id) { return db.t.hub_audit_log.filter(function (h) { return h.entity_id === id || h.record_id === id || JSON.stringify(h).indexOf(id) >= 0; }); }
var CK = { matches_records: true, goods_received: true, charges_accurate: true };
console.log('WZ — a credit corrected to a payable bill cannot become a second copy');
(async function () {
  // hook sanity: the emulated rule refuses the direct write
  var hz = db.hooks.vendor_bills.update(row(CM), { bill_type: 'supplier' });
  check('hook sanity: the in-memory rule refuses CM → supplier (same vendor written differently + same number)', /HUB_EXACT_DUPLICATE/.test(hz || ''), hz);
  var v = await call({ action: 'validate_bill', id: CM, checks: CK, notes: 'checked against the supplier statement', shipment_direction: 'outbound', bill_type: 'supplier' });
  check('VALIDATE with type "supplier" on the credit → refused with the plain duplicate message (409), naming the existing bill', v.__status === 409 && v.duplicate === true && /Bill #INV-1 from Example Supplier is already in the Hub/.test(v.error || '') && /NOT saved/.test(v.error || ''), v);
  check('…the credit is unchanged: still a credit memo, not validated', row(CM).bill_type === 'credit_memo' && row(CM).validation_status !== 'validated', row(CM));
  check('…and nothing on the audit trail says its type was saved or that it was validated', auditsFor(CM).filter(function (h) { return h.action === 'bill_validation_progress_saved' || h.action === 'bill_validated'; }).length === 0, auditsFor(CM));
  var p = await call({ action: 'save_validation_progress', id: CM, bill_type: 'supplier' });
  check('SAVE PROGRESS with type "supplier" on the credit → refused with the duplicate message (409), not a server error', p.__status === 409 && p.duplicate === true && /already in the Hub/.test(p.error || ''), p);
  check('…the credit is still a credit memo and no "saved" entry was written', row(CM).bill_type === 'credit_memo' && auditsFor(CM).filter(function (h) { return h.action === 'bill_validation_progress_saved'; }).length === 0, { r: row(CM), a: auditsFor(CM) });
  var ok2 = await call({ action: 'save_validation_progress', id: CM2, bill_type: 'supplier' });
  check('CONTROL: a credit with a number nobody else has → the type change is saved', ok2.ok === true && row(CM2).bill_type === 'supplier', ok2);
  var okA = await call({ action: 'validate_bill', id: A, checks: CK, notes: 'checked against the supplier statement', shipment_direction: 'outbound', bill_type: 'trucking' });
  check('CONTROL: a payable bill changing between payable types validates normally', okA.ok === true && row(A).validation_status === 'validated' && row(A).bill_type === 'trucking', okA);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
