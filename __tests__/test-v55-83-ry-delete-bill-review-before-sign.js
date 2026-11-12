// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RY — Max, Nov 10 00:11:
//  "add delete bill"
//  "should be able to view when you are signing off on a wire. you should be able to view each bill and close the bill
//   as you check before you approve it and sign it"
// REAL bills + wire routes on an in-memory DB; the delete SQL ran twice on PG16 (no reason → refused; a deleted bill
// cannot be edited back).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var A1 = 'b9000000-0000-0000-0000-000000000001', A2 = 'b9000000-0000-0000-0000-000000000002', D1 = 'b9000000-0000-0000-0000-000000000003', D2 = 'b9000000-0000-0000-0000-000000000004', D3 = 'b9000000-0000-0000-0000-000000000005';
function nb(id, vendor, no, amt, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: no, bill_date: '2026-06-08', total_amount: amt, record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'REF-' + no, paid_via: 'RTM Capital' }, extra || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(A1, 'NexPac Corporation', '14353', 3471.76), nb(A2, 'NexPac Corporation', '14354', 2830.04),
    nb(D1, 'AMB Logistic', '36100', 2050, { paid_via: null, validation_status: 'pending' }), nb(D2, 'Paid Co', 'P-1', 10, { paid_via: null }), nb(D3, 'On Wire Co', 'W-1', 20)],
  vendor_bill_lines: [], vendor_bill_payments: [{ id: 'pay1', bill_id: D2, amount: 10, paid_date: '2026-07-01', voided: false }], vendor_bill_events: [], hub_audit_log: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], expense_rules: [], paid_through_parties: [{ name: 'RTM Capital', kind: 'service_provider', active: true }], bank_transactions: [],
  bill_commission_rules: [], bill_price_rules: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); }
var b = function (id) { return db.t.vendor_bills.filter(function (x) { return x.id === id; })[0]; };
var hist = function (a) { return db.t.hub_audit_log.filter(function (h) { return h.action === a; }); };
console.log('RY — delete a bill; open and check every bill before signing a wire');
(async function () {
  // ── 1. delete a bill
  var d0 = await call(bills, 'u1', { action: 'delete_bill', id: D1, reason: '' });
  check('1a: a reason is required', !d0.ok && /Say why/.test(d0.error) && b(D1).record_status === 'active', d0);
  var d1 = await call(bills, 'u1', { action: 'delete_bill', id: D1, reason: 'imported twice (36100_1.pdf)' });
  check('1b: the duplicate AMB 36100 is deleted; who / when / why are kept on it; the audit log keeps a full snapshot', d1.ok && b(D1).record_status === 'deleted' && b(D1).deleted_by === 'u1' && /imported twice/.test(b(D1).delete_reason) &&
    hist('bill_deleted').length === 1 && hist('bill_deleted')[0].details.bill.bill_number === '36100' && hist('bill_deleted')[0].details.bill.total_amount === 2050, d1);
  var lst = await call(bills, 'u1', { action: 'list' });
  check('1c: it is gone from the bills list (and every report built on it)', !(lst.bills || []).some(function (x) { return x.id === D1; }) && (lst.bills || []).length === 4, (lst.bills || []).map(function (x) { return x.bill_number; }));
  var e1 = await call(bills, 'u1', { action: 'save_bill', bill: { id: D1, vendor_name: 'AMB Logistic', bill_number: '36100', bill_date: '2026-11-03', total_amount: 2050 } });
  check('1d: a deleted bill cannot be edited back', !e1.ok && /deleted/.test(e1.error), e1);
  var d2 = await call(bills, 'u1', { action: 'delete_bill', id: D2, reason: 'mistake entry' });
  check('1e: a bill with money recorded on it cannot be deleted (void the payment first, or Void the bill)', !d2.ok && /Money is recorded/.test(d2.error) && b(D2).record_status === 'active', d2);
  var w0 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: D3, amount: 20 }] });
  var d3 = await call(bills, 'u1', { action: 'delete_bill', id: D3, reason: 'wrong vendor bill' });
  check('1f: a bill on a wire cannot be deleted (take it off the wire first)', w0.ok && !d3.ok && /is on wire WP-/.test(d3.error), { w0: w0, d3: d3 });
  await call(wires, 'u1', { action: 'delete_wire', id: w0.id, reason: 'test wire' });
  var BT = R('src/components/BillsTab.jsx');
  check('1g: on screen: 🗑 Delete on each bill, asked under the bill with the reason, explaining Delete vs Void', BT.indexOf("setRowAsk({ kind: 'delete', bill: b, text: '' })") > 0 && BT.indexOf("{ action: 'delete_bill', id: ra.bill.id, reason: ra.text || '' }") > 0 && BT.indexOf('For a real bill that was cancelled, use Void instead') > 0);
  // ── 2. open and check each bill before signing
  var sv = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: A1, amount: 3471.76 }, { bill_id: A2, amount: 2830.04 }] });
  var g = await call(wires, 'u1', { action: 'get', id: sv.id });
  check('2a: (setup) WP with the two NexPac bills, checked and ready for the 1st signature; nobody has checked a bill yet', sv.ok && g.package.status === 'awaiting_1st' && g.audit.my_reviewed.length === 0 && g.audit.reviews.length === 0, g.package);
  var s0 = await call(wires, 'u1', { action: 'signoff', id: sv.id, note: 'looks right' });
  check('2b: signing before opening the bills is refused — it names the bills not checked yet', !s0.ok && /Open and check every bill before you sign — 2 not checked yet/.test(s0.error) && /14353/.test(s0.error) && /14354/.test(s0.error), s0);
  var r1 = await call(wires, 'u1', { action: 'review_bill', id: sv.id, bill_id: A1 });
  var s1 = await call(wires, 'u1', { action: 'signoff', id: sv.id, note: 'looks right' });
  check('2c: one bill checked ("✓ I checked this bill — close") → still refused for the other', r1.ok && r1.left === 1 && !s1.ok && /1 not checked yet: NexPac Corporation 14354/.test(s1.error), { r1: r1, s1: s1 });
  await call(wires, 'u1', { action: 'review_bill', id: sv.id, bill_id: A2 });
  var s2 = await call(wires, 'u1', { action: 'signoff', id: sv.id, note: 'both bills match the NexPac orders' });
  check('2d: both checked → the 1st signature goes through; each check is on the wire’s history with the name', s2.ok && s2.slot === 1 && hist('wire_bill_reviewed').length === 2 && hist('wire_bill_reviewed')[0].actor_id === 'u1', s2);
  var s3 = await call(wires, 'u2', { action: 'signoff', id: sv.id, note: 'second check done' });
  check('2e: the 2nd signer must open and check the bills too (the 1st signer’s checks are not theirs)', !s3.ok && /2 not checked yet/.test(s3.error), s3);
  var g2 = await call(wires, 'u2', { action: 'get', id: sv.id });
  check('2f: the 2nd signer sees who already checked each bill', g2.audit.reviews.filter(function (r) { return r.by === 'Preparer'; }).length === 2 && g2.audit.my_reviewed.length === 0, g2.audit.reviews);
  var rbad = await call(wires, 'u2', { action: 'review_bill', id: sv.id, bill_id: D2 });
  check('2g: only bills that are on this wire can be checked for it', !rbad.ok && /not on this wire/.test(rbad.error), rbad);
  // change the wire → the checks no longer count
  await call(wires, 'u1', { action: 'save_draft', id: sv.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: A1, amount: 3471.76 }, { bill_id: A2, amount: 2800 }] });
  var g3 = await call(wires, 'u1', { action: 'get', id: sv.id });
  check('2h: change the wire (an amount) → the earlier checks do not count any more; the bills must be checked again', g3.audit.my_reviewed.length === 0 && g3.audit.reviews.length === 0, g3.audit);
  await call(wires, 'u1', { action: 'save_draft', id: sv.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: A1, amount: 3471.76 }, { bill_id: A2, amount: 2830.04 }] });
  var g4 = await call(wires, 'u2', { action: 'get', id: sv.id });
  check('2i: put back exactly as checked → the checks for THAT exact wire count again', g4.audit.reviews.length === 2, g4.audit.reviews);
  // screen
  var U = R('src/components/WirePackagesPanel.jsx');
  check('3a: each bill on the wire has "👁 Open & check" → the bill itself (its document, every fact, its lines + price check, who validated it) with "✓ I checked this bill — close"',
    U.indexOf("{mineRv ? '✓ Checked · view' : '👁 Open & check'}") > 0 && U.indexOf('function BillReviewModal(p)') > 0 && U.indexOf('<iframe title="bill" src={docUrl}') > 0 && U.indexOf("'✓ I checked this bill — close'") > 0 && U.indexOf('<BillLinesPanel bill={b} api={billsApi} toast={p.toast} canManage={false} />') > 0 && U.indexOf("fact('Validated',") > 0);
  check('3b: the sign box counts "You checked N of M bills" and the sign button says what is left instead of failing silently', U.indexOf("'👁 You checked ' + n + ' of ' + det.lines.length + ' bills") > 0 && U.indexOf("toast.error('Open and check every bill before you sign — '") > 0);
  check('3c: no document attached → it says so (check it against the vendor’s bill outside the Hub)', U.indexOf('No document is attached to this bill') > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
