// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SC — Max, Nov 12 09:40:
//  "the bankline is never less than the wire- but also remember that user can put additional funds to pay a service fee for
//   RTM or nextrade and they can list that while building the wire"
//  "i would like to have a feature where i can tell the system to build a wire for a certain amount and that it will select
//   from validated approved bills to create the wire for that amount including splitting to make partial payments to get to
//   the amount i want to wire."
// The chooser is pure (run for real); the fee on a NextTrade wire goes through the REAL route on an in-memory DB.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var F = require(path.join(root, 'src/lib/wire-fill.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
function b(id, vendor, open, due, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: id.toUpperCase(), open: open, due_date: due, bill_date: due, validation_status: 'validated' }, extra || {}); }
var bills = [b('c', 'NexPac', 4000, '2026-11-20'), b('a', 'NexPac', 3471.76, '2026-10-01'), b('b', 'Trinity', 2830.04, '2026-10-15'),
  b('x', 'AMB', 9000, '2026-09-01', { validation_status: 'pending' }), b('y', 'AMB', 9000, '2026-09-02', { on_package: 'WP-0004' }), b('z', 'AMB', 9000, '2026-09-03', { needs_mark: true })];
console.log('SC — build a wire for an amount; a service fee on RTM or NextTrade wires');
(async function () {
  var f1 = F.fillToAmount(bills, '8,000');
  check('1a: $8,000 → oldest due first: A in full, B in full, C in part — exactly $8,000', f1.ok && f1.picks.a === '3471.76' && f1.picks.b === '2830.04' && f1.picks.c === '1698.20' && f1.total === 8000 && f1.short === 0, f1);
  check('1b: it says which bill is paid in part ($1,698.20 of $4,000)', f1.partial && f1.partial.id === 'c' && f1.partial.paid === 1698.2 && f1.partial.of === 4000, f1.partial);
  check('1c: bills that are not validated, already on another wire, or not marked for this party are never chosen', !f1.picks.x && !f1.picks.y && !f1.picks.z);
  var f2 = F.fillToAmount(bills, 8000, { fee: 500 });
  check('2a: the service fee counts toward the amount: $7,500 of bills + $500 fee = $8,000', f2.ok && f2.bills_total === 7500 && f2.fee === 500 && f2.total === 8000 && f2.picks.c === '1198.20', f2);
  var f3 = F.fillToAmount(bills, 50000);
  check('3a: not enough validated bills → every one chosen in full and it says how much short', f3.ok && f3.count === 3 && f3.bills_total === 10301.8 && f3.short === 39698.2 && !f3.partial, f3);
  var f4 = F.fillToAmount(bills, 3471.76);
  check('4a: an amount that lands exactly on a bill → no part payment', f4.ok && f4.count === 1 && f4.picks.a === '3471.76' && !f4.partial, f4);
  var f5 = F.fillToAmount(bills, 5000, { vendor: 'NexPac' });
  check('5a: a wire straight to a vendor chooses only that vendor’s bills', f5.ok && f5.picks.a === '3471.76' && f5.picks.c === '1528.24' && !f5.picks.b, f5);
  check('6a: no amount / fee bigger than the wire / nothing to choose → a plain message, nothing ticked', !F.fillToAmount(bills, '').ok && /Type the amount/.test(F.fillToAmount(bills, 'abc').error) && /nothing is left for bills/.test(F.fillToAmount(bills, 100, { fee: 100 }).error) && /No validated open bills/.test(F.fillToAmount([bills[3]], 100).error));
  var f7 = F.fillToAmount([b('p', 'V', 0.1, '2026-01-01'), b('q', 'V', 0.2, '2026-01-02'), b('r', 'V', 5, '2026-01-03')], 0.35);
  check('7a: cents are exact (no floating-point drift): 0.10 + 0.20 + 0.05 = 0.35', f7.ok && f7.picks.r === '0.05' && f7.total === 0.35, f7);
  // ── the service fee on a NextTrade wire, through the real route
  var db = new MemDB({
    users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }],
    module_permissions: ['accounting.clickbooks.access', 'wires.prepare', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    vendor_bills: [{ id: 'bd200000-0000-0000-0000-000000000001', vendor_name: 'NexPac Corporation', bill_number: '14360', bill_date: '2026-11-01', total_amount: 1000, record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'R1', paid_via: 'NextTrade Industries' },
      { id: 'bd200000-0000-0000-0000-000000000002', vendor_name: 'Trinity Logistics', bill_number: 'T9', bill_date: '2026-11-01', total_amount: 500, record_status: 'active', validation_status: 'validated', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001', paid_via: null }],
    vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], expense_categories: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [],
    paid_through_parties: [{ name: 'NextTrade Industries', kind: 'affiliate', active: true }], bank_transactions: [], bill_commission_rules: [], bill_price_rules: [] });
  var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
  fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
  var orig = Module._resolveFilename;
  Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
  global.__db = db;
  var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
  async function call(body) { var res = await wires.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: new Map() }); return res.json(); }
  var s1 = await call({ action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', fee_amount: 150, fee_note: 'handling fee November', lines: [{ bill_id: 'bd200000-0000-0000-0000-000000000001', amount: 600 }] });
  var g1 = s1.ok ? await call({ action: 'get', id: s1.id }) : {};
  check('8a: a NextTrade wire can carry a listed service fee (and a part payment): bills $600 + fee $150 = $750', s1.ok && db.t.wire_packages[0].fee_amount === 150 && db.t.wire_package_lines[0].amount === 600 && g1.package && g1.package.fee_amount === 150, { s1: s1, p: g1.package && { fee: g1.package.fee_amount } });
  var s2 = await call({ action: 'save_draft', payee_kind: 'vendor', payee_name: 'Trinity Logistics', fee_amount: 20, lines: [{ bill_id: 'bd200000-0000-0000-0000-000000000002', amount: 500 }] });
  check('8b: a wire straight to a vendor still takes no fee', !s2.ok && /bills only — no fee/.test(s2.error), s2);
  var A = require(path.join(root, 'src/lib/wire-audit.js'));
  check('8c: the check no longer blocks a fee on a NextTrade wire (only on a vendor wire)', R('src/lib/wire-audit.js').indexOf("if (kind === 'vendor') { add('block', 'FEE_NOT_ALLOWED'") > 0 && !!A);
  var U = R('src/components/WirePackagesPanel.jsx');
  check('9a: the wire builder has "⚡ Build this wire for an amount" with "Choose the bills for me", and says what it chose', U.indexOf('⚡ Build this wire for an amount') > 0 && U.indexOf('Choose the bills for me') > 0 && U.indexOf("' is paid in part: $' + fmt(f.partial.paid)") > 0 && U.indexOf('Change any tick or amount below before saving.') > 0);
  check('9b: the service-fee box shows for RTM and NextTrade', U.indexOf("{ed.kind !== 'vendor' && <span className=\"flex gap-1 items-center\"><span className=\"text-[12px] font-bold\" style={{ color: SUB }}>+ {ed.payee} service fee (optional) $</span>") > 0);
  check('9c: SQL lets a NextTrade wire carry a fee', R('sql/v55-83-RZ-wire-ready-sent-paid.sql').indexOf("CHECK (payee_kind IN ('service_provider', 'affiliate') OR fee_amount = 0)") > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
