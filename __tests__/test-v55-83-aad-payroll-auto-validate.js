// v55.83-AAD — payroll bills validate themselves (Max, 27 Nov 2026: "payroll is automatically validated"), ONLY from a trusted source
// (Codex 27 Nov 13:40): entered by the super admin, a repeating payroll bill, a KTC bill made from a Nextrade payroll line. E-mailed /
// imported bills wait for validation as before; a possible-duplicate warning stops it. RUNS the real Bills route (real permission
// resolver + verified sign-in) against an in-memory database; the SQL function itself is proven in sql-v55-83-aad-payroll-auto-validate.mjs.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', STAFF = '33333333-3333-4333-8333-333333333333';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('AAD — payroll bills validate themselves, trusted sources only (real routes)');

var TOK = { 'tok-super': SUPER, 'tok-staff': STAFF };
var world = { db: null, oldChecks: false, noRpc: false, rpcCalls: [] };
function g(uid, names) { return names.map(function (n, i) { return { id: uid + '-' + i, user_id: uid, module_name: n, has_access: true }; }); }
var NB = 'ab000000-0000-4000-8000-000000000004', OB = 'ab000000-0000-4000-8000-000000000001', RB = 'ab000000-0000-4000-8000-000000000002', PB = 'ab000000-0000-4000-8000-000000000003';
function bill(id, vendor, amount, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: 'N-' + id.substring(34), bill_date: '2026-11-02', due_date: '2026-11-30', currency: 'USD', total_amount: amount, record_status: 'active', validation_status: 'pending', wave_business_id: null, release_number: null, other_reference: null, bill_type: null, shipment_direction: null }, extra || {}); }
// the payroll SQL function, as written in sql/v55-83-ZY-other-services-operational.sql (the PGlite test runs the real one)
function fakeAutoValidate(a, db) {
  world.rpcCalls.push(a);
  if (world.noRpc) { return { data: null, error: { message: 'Could not find the function public.hub_bill_auto_validate_payroll(p) in the schema cache', code: 'PGRST202' } }; }
  var p = a.p; var b = db.t.vendor_bills.filter(function (x) { return x.id === p.bill_id; })[0];
  if (!String(p.reasons || '').trim() || !String(p.source || '').trim()) { return { data: null, error: { message: 'HUB_GUARD: the payroll rule that matched is required.' } }; }
  if (!b) { return { data: { ok: false, code: 'not_found' }, error: null }; }
  if (b.record_status !== 'active') { return { data: { ok: false, code: 'not_active' }, error: null }; }
  if (b.validation_status === 'validated') { return { data: { ok: true, repeat: true }, error: null }; }
  var note = 'Auto-validated: payroll (rule) — ' + p.reasons + ' · ' + p.source + '. No manual checks: payroll bills are validated automatically (Max, 27 Nov 2026).';
  if (!b.bill_type) { b.bill_type = 'other_services'; b.bill_type_source = 'validator'; }
  if (!b.shipment_direction) { b.shipment_direction = 'operational'; b.direction_source = 'validator'; }
  b.validation_status = 'validated'; b.validated_by = null; b.validated_at = new Date().toISOString(); b.validation_notes = note;
  db.t.hub_audit_log.push({ actor_id: null, action: 'bill_auto_validated_payroll', entity: 'vendor_bill', entity_id: b.id, details: { rule: 'payroll (ZD)', reasons: p.reasons, source: p.source, by: 'system' } });
  return { data: { ok: true, validated: true, note: note }, error: null };
}
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true, email: 's@x', name: 'Max' }, { id: STAFF, role: 'team', active: true, email: 't@x', name: 'Staff' }];
  var ALLSW = ['accounting.view', 'accounting.clickbooks.access', 'bills.view', 'bills.manage', 'wires.view', 'wires.prepare', 'accounting.view_totals'];
  db.t.module_permissions = g(STAFF, ALLSW);
  db.t.hub_audit_log = []; db.t.financial_visibility_permissions = [];
  db.t.expense_categories = [{ key: 'software', label: 'Software & subscriptions' }, { key: 'wages_k', label: 'Payroll taxes' }];
  db.t.company_categories = []; db.t.company_bill_links = []; db.t.recurring_bills = []; db.t.wire_packages = []; db.t.wire_package_lines = []; db.t.wire_package_files = [];
  db.t.vendor_bills = [bill(OB, 'Intuit QuickBooks', 85, { bill_type: 'other_services', shipment_direction: 'operational' }), bill(RB, 'Kronos Trucking', 400, { release_number: '1002-555', bill_type: 'trucking' }), bill(PB, 'Gusto Payroll', 9100, {}), bill(NB, 'Acme Office Services', 120, {})];
  db.t.vendor_bill_lines = []; db.t.vendor_bill_payments = []; db.t.vendor_bill_events = []; db.t.bill_commission_rules = []; db.t.bill_price_rules = [];
  db.t.bank_transactions = [];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { return { data: [{ profile_id: a.p_auth_user_id }], error: null }; };
  db.rpcs.bank_visibility_auth_ids_for_profile = function (a) { return { data: [{ auth_user_id: a.p_profile_id }], error: null }; };
  db.rpcs.hub_bill_auto_validate_payroll = fakeAutoValidate;
  // the database's OLD checks (ZY SQL not run yet): refuse the two new values with the real constraint names
  var origFrom = db.from.bind(db);
  db.from = function (t) {
    var q = origFrom(t);
    if (t === 'vendor_bills') {
      var ex = q.exec.bind(q);
      q.exec = function () {
        var row = this.op === 'insert' ? this.row : this.op === 'update' ? this.patch : null;
        if (this.op === 'insert' && row && !Array.isArray(row)) { this.row = Object.assign({ record_status: 'active', validation_status: 'pending' }, row); } // the live column defaults
        if (world.oldChecks && row && !Array.isArray(row)) {
          if (row.bill_type === 'other_services') { return { data: null, error: { code: '23514', message: 'new row for relation "vendor_bills" violates check constraint "vendor_bills_bill_type_check"' } }; }
          if (row.shipment_direction === 'operational') { return { data: null, error: { code: '23514', message: 'new row for relation "vendor_bills" violates check constraint "vendor_bills_shipment_direction_check"' } }; }
        }
        return ex();
      };
    }
    return q;
  };
  world.db = db; world.rpcCalls = []; return db;
}
var authClient = { auth: { getUser: function (tok) { var id = TOK[tok]; return Promise.resolve(id ? { data: { user: { id: id, email_confirmed_at: 'x' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
function createClient(url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); }
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { createClient: createClient } };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };
var BILLS = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var WP = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var BX = require(path.join(root, 'src/lib/bill-extract.js'));
var WA = require(path.join(root, 'src/lib/wire-audit.js'));
var PAV = require(path.join(root, 'src/lib/payroll-auto-validate-server.js'));
function rq(url, token, body) { var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test' + url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }); }
async function j(p) { var r = await p; var o = {}; try { o = await r.json(); } catch (e) { o = {}; } return { status: r.status, j: o }; }
function bills(tok, body) { return j(BILLS.POST(rq('/api/accounting/bills', tok, body))); }
function wp(tok, body) { return j(WP.POST(rq('/api/accounting/wire-packages', tok, body))); }
function row(id) { return world.db.t.vendor_bills.filter(function (b) { return b.id === id; })[0]; }
function byVendor(v) { return world.db.t.vendor_bills.filter(function (b) { return b.vendor_name === v; })[0]; }
var CHECKS = { matches_records: true, goods_received: true, charges_accurate: true };

(async function () {
  fresh();
  var p1 = await bills('tok-super', { action: 'save_bill', bill: { vendor_name: 'ADP Payroll', bill_number: 'ADP-1127', total_amount: 4321.17, bill_date: '2026-11-27' } });
  var a1 = byVendor('ADP Payroll');
  check('a payroll bill the super admin enters is validated by the system at once', p1.status === 200 && p1.j.auto_validated_payroll === true && a1 && a1.validation_status === 'validated', p1);
  check('…no person as validator; the note says "Auto-validated: payroll (rule)", the rule and the source', a1 && !a1.validated_by && /^Auto-validated: payroll \(rule\) — vendor name contains “payroll” · entered by the super admin\./.test(a1.validation_notes || ''), a1);
  check('…type / direction filled as Other services / Operational (no ticks, no "how verified")', a1 && a1.bill_type === 'other_services' && a1.shipment_direction === 'operational', a1);
  check('…one audit row: system, rule, source', world.db.t.hub_audit_log.filter(function (x) { return x.action === 'bill_auto_validated_payroll' && x.actor_id === null && x.details.by === 'system' && x.details.source === 'entered by the super admin'; }).length === 1);
  check('the screen reads it as auto-validated (payroll rule)', BX.isPayrollAutoValidated(a1) && !BX.isPayrollAutoValidated(Object.assign({}, a1, { validated_by: SUPER })));
  var p2 = await bills('tok-super', { action: 'save_bill', bill: { vendor_name: 'Adecco', bill_number: 'AD-1', total_amount: 777, bill_date: '2026-11-27', category: 'wages_k' } });
  var a2 = byVendor('Adecco');
  check('payroll by CATEGORY (Payroll taxes) also validates itself', p2.status === 200 && a2 && a2.validation_status === 'validated' && /category “Payroll taxes”/.test(a2.validation_notes || ''), a2);
  var p3 = await bills('tok-super', { action: 'save_bill', bill: { vendor_name: 'Temp Agency', bill_number: 'TA-1', total_amount: 600, bill_date: '2026-11-27', lines: [{ description: 'Payroll week 47', qty: 1, unit_price: 600, amount: 600 }] } });
  var a3 = byVendor('Temp Agency');
  check('payroll by a LINE also validates itself (checked after the lines are saved)', p3.status === 200 && a3 && a3.validation_status === 'validated' && /a line on the bill says “payroll”/.test(a3.validation_notes || ''), a3);
  var lst = (await bills('tok-super', { action: 'list' })).j;
  var wl = ((lst && lst.bills) || []).filter(function (b) { return b.validation_status !== 'validated'; }).map(function (b) { return b.vendor_name; });
  check('auto-validated payroll bills are NOT in "waiting for validation"', wl.indexOf('ADP Payroll') < 0 && wl.indexOf('Adecco') < 0 && wl.indexOf('Temp Agency') < 0, wl);
  var st = (await bills('tok-staff', { action: 'list' })).j;
  var leak = JSON.stringify(st).match(/ADP Payroll|Adecco|Temp Agency|4321\.17/);
  check('ZD stays: staff see none of the payroll bills after auto-validation', !leak, leak);
  var sCreate = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Sneaky Payroll', bill_number: 'SP-1', total_amount: 10, bill_date: '2026-11-27' } });
  check('staff still cannot create a payroll bill at all (ZD unchanged)', sCreate.status >= 400 && !byVendor('Sneaky Payroll'), sCreate);
  var before = world.rpcCalls.length;
  await bills('tok-super', { action: 'save_bill', bill: { vendor_name: 'Staples', bill_number: 'S-1', total_amount: 30, bill_date: '2026-11-27' } });
  check('a normal bill never calls the payroll auto-validation', world.rpcCalls.length === before && byVendor('Staples').validation_status !== 'validated');
  // a possible duplicate waits
  var d1 = await bills('tok-super', { action: 'save_bill', confirm_duplicate: true, bill: { vendor_name: 'ADP Payroll', bill_number: 'ADP-1127B', total_amount: 4321.17, bill_date: '2026-11-27' } });
  var dRow = world.db.t.vendor_bills.filter(function (b) { return b.bill_number === 'ADP-1127B'; })[0];
  check('a likely duplicate is refused; saved anyway it is NOT auto-validated and says why', d1.status === 200 && dRow && dRow.validation_status !== 'validated' && /possible copy/.test(d1.j.payroll_warning || ''), d1);
  // untrusted sources: the helper refuses without a trusted source; the import doors never call it
  var bx = world.db.t.vendor_bills.filter(function (b) { return b.vendor_name === 'Staples'; })[0];
  world.db.t.vendor_bills.push({ id: 'imp-1', vendor_name: 'Intuit Payroll (emailed)', bill_number: 'E-1', total_amount: 99, record_status: 'active', validation_status: 'pending' }); void bx;
  var u0 = await PAV.autoValidatePayroll(world.db, 'imp-1', {});
  var u1 = await PAV.autoValidatePayroll(world.db, 'imp-1', { source: 'email_inbound' });
  check('no trusted source → never auto-validated (e-mail / import)', u0.validated === false && u0.untrusted === true && u1.untrusted === true && world.db.t.vendor_bills.filter(function (b) { return b.id === 'imp-1'; })[0].validation_status === 'pending');
  var ex = fs.readFileSync(path.join(root, 'src/lib/bill-extract-server.js'), 'utf8');
  var inb = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/inbound/route.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/email-scan/route.js'), 'utf8');
  check('the import / e-mail doors do not auto-validate (insertImportedBill, inbound, mailbox scan)', !/autoValidatePayroll/.test(ex) && !/autoValidatePayroll/.test(inb));
  check('repeating payroll bills and Nextrade payroll lines are trusted sources (a forced duplicate waits)', /await autoValidatePayroll\(db, billId, \{ source: 'repeating_bill', duplicateWarning: !!forced \}\);/.test(fs.readFileSync(path.join(root, 'src/lib/repeating-bills-server.js'), 'utf8')) && /if \(d\.action === 'created' && d\.bill_id\) \{ await autoValidatePayroll\(db, d\.bill_id, \{ source: 'nextrade_payroll_line' \}\); \}/.test(fs.readFileSync(path.join(root, 'src/lib/nextrade-bills-server.js'), 'utf8')));
  // the SQL function missing → the bill waits, plain warning naming the file
  world.noRpc = true;
  var p4 = await bills('tok-super', { action: 'save_bill', bill: { vendor_name: 'Paychex payroll', bill_number: 'PX-1', total_amount: 100, bill_date: '2026-11-27' } });
  check('before the AAD SQL: the payroll bill is still created, waits, and says why', p4.status === 200 && byVendor('Paychex payroll').validation_status !== 'validated' && /v55-83-AAD-payroll-auto-validate\.sql/.test(p4.j.payroll_warning || ''), p4);
  world.noRpc = false;
  var rv = await PAV.autoValidatePayroll(world.db, a1.id, { source: 'super_admin_entry' });
  check('a second call on an already validated payroll bill changes nothing', rv.payroll === true && rv.validated === true && world.db.t.hub_audit_log.filter(function (x) { return x.action === 'bill_auto_validated_payroll' && x.entity_id === a1.id; }).length === 1, rv);
  var pav = fs.readFileSync(path.join(root, 'src/lib/payroll-auto-validate-server.js'), 'utf8');
  check('SWC-safe helper (var + concatenation only)', !/`/.test(pav) && !/=>|\bconst\b|\blet\b/.test(pav));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
