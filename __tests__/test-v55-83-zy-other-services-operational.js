// v55.83-ZY — bill type "Other services" and "This bill is for: Operational" (Max, 27 Nov 2026: "we need other services as a
// selection for type of bill / this bill is for add Operational"). Payroll auto-validation is AAD (separate candidate).
// RUNS the real Bills and Wire packages routes (real permission resolver + verified sign-in) against an in-memory database, plus the
// pure rules (wire audit, weight-check exclusion, profitability exclusion, import sort, line kinds).
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', STAFF = '33333333-3333-4333-8333-333333333333';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZY — Other services / Operational (real routes)');

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
  if (!String(p.reasons || '').trim()) { return { data: null, error: { message: 'HUB_GUARD: the payroll rule that matched is required.' } }; }
  if (!b) { return { data: { ok: false, code: 'not_found' }, error: null }; }
  if (b.record_status !== 'active') { return { data: { ok: false, code: 'not_active' }, error: null }; }
  if (b.validation_status === 'validated') { return { data: { ok: true, repeat: true }, error: null }; }
  var note = 'Auto-validated: payroll (rule) — ' + p.reasons + '. No manual checks: payroll bills are validated automatically (Max, 27 Nov 2026).';
  if (!b.bill_type) { b.bill_type = 'other_services'; b.bill_type_source = 'validator'; }
  if (!b.shipment_direction) { b.shipment_direction = 'operational'; b.direction_source = 'validator'; }
  b.validation_status = 'validated'; b.validated_by = null; b.validated_at = new Date().toISOString(); b.validation_notes = note;
  db.t.hub_audit_log.push({ actor_id: null, action: 'bill_auto_validated_payroll', entity: 'vendor_bill', entity_id: b.id, details: { rule: 'payroll (ZD)', reasons: p.reasons, by: 'system' } });
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
function rq(url, token, body) { var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test' + url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }); }
async function j(p) { var r = await p; var o = {}; try { o = await r.json(); } catch (e) { o = {}; } return { status: r.status, j: o }; }
function bills(tok, body) { return j(BILLS.POST(rq('/api/accounting/bills', tok, body))); }
function wp(tok, body) { return j(WP.POST(rq('/api/accounting/wire-packages', tok, body))); }
function row(id) { return world.db.t.vendor_bills.filter(function (b) { return b.id === id; })[0]; }
function byVendor(v) { return world.db.t.vendor_bills.filter(function (b) { return b.vendor_name === v; })[0]; }
var CHECKS = { matches_records: true, goods_received: true, charges_accurate: true };

(async function () {
  // ── 1. the two new choices
  check('Other services is a bill type with its own label', BX.BILL_TYPES.indexOf('other_services') >= 0 && /Other services/.test(BX.BILL_TYPE_LABEL.other_services));
  check('Operational is a "this bill is for" choice', BX.BILL_DIRECTIONS.join(',') === 'inbound,outbound,operational' && /Operational/.test(BX.BILL_DIRECTION_LABEL.operational));
  check('the bill reader may say other_services', /"other_services"\|null/.test(BX.BILL_EXTRACT_PROMPT || fs.readFileSync(path.join(root, 'src/lib/bill-extract.js'), 'utf8')));

  fresh();
  var c1 = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Intuit QuickBooks Online', bill_number: 'QB-1127', total_amount: 90, bill_date: '2026-11-27', bill_type: 'other_services', shipment_direction: 'operational', direction_source: 'manual',
    lines: [{ description: 'QuickBooks Online Plus — monthly', qty: 1, unit_price: 90, amount: 90, line_kind: 'item' }] } });
  var q1 = byVendor('Intuit QuickBooks Online');
  check('an Operational / Other services bill saves with NO release # and NO reference', c1.status === 200 && q1 && q1.bill_type === 'other_services' && q1.shipment_direction === 'operational' && !q1.release_number && !q1.other_reference, c1);
  var l1 = world.db.t.vendor_bill_lines.filter(function (l) { return q1 && l.bill_id === q1.id; });
  check('its lines are services (charge), never a product — even when sent as "item"', l1.length === 1 && l1[0].line_kind === 'charge', l1);
  check('not a payroll bill → the system did not validate it (waits for a person)', q1 && q1.validation_status !== 'validated' && world.rpcCalls.length === 0, q1);

  var c2 = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Office move', bill_number: 'OM-1', total_amount: 50, bill_date: '2026-11-27', release_number: '1002-777', shipment_direction: 'operational', direction_source: 'manual' } });
  check('Operational with a release # is refused (it is not for a shipment)', c2.status === 400 && /OPERATIONAL/.test(c2.j.error || '') && !byVendor('Office move'), c2);
  var c3 = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'X', bill_number: 'X-1', total_amount: 5, bill_date: '2026-11-27', shipment_direction: 'sideways', direction_source: 'manual' } });
  check('an unknown direction is still refused, naming the three choices', c3.status === 400 && /inbound, outbound or operational/.test(c3.j.error || ''), c3);
  var c3b = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'X', bill_number: 'X-2', total_amount: 5, bill_date: '2026-11-27', bill_type: 'magic' } });
  check('an unknown type is refused, naming other services', c3b.status === 400 && /other services/.test(c3b.j.error || ''), c3b);
  var c3c = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Old rule outbound', bill_number: 'X-3', total_amount: 5, bill_date: '2026-11-27', shipment_direction: 'outbound', direction_source: 'manual' } });
  check('Outbound still needs its release # (unchanged)', c3c.status === 400 && /release/.test(c3c.j.error || ''), c3c);
  var c3d = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Old rule inbound', bill_number: 'X-4', total_amount: 5, bill_date: '2026-11-27', shipment_direction: 'inbound', direction_source: 'manual' } });
  check('Inbound still needs its reference (unchanged)', c3d.status === 400 && /reference/.test(c3d.j.error || ''), c3d);

  // Codex 13:40 normal cases
  var c4 = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Office Depot', bill_number: 'OD-9', total_amount: 64.2, bill_date: '2026-11-27', bill_type: 'supplier', shipment_direction: 'operational', direction_source: 'manual' } });
  var q4 = byVendor('Office Depot');
  check('supplier office supplies as Operational: saved, no release / reference, never in the weight check', c4.status === 200 && q4 && q4.shipment_direction === 'operational' && BX.isServiceOnlyBill(q4), c4);
  var c5 = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Port Docs Co', bill_number: 'PD-3', total_amount: 75, bill_date: '2026-11-27', bill_type: 'other_services', release_number: '1002-901' } });
  var q5 = byVendor('Port Docs Co');
  check('a shipment-linked service fee (Other services + release #) stays Outbound on its release', c5.status === 200 && q5 && q5.shipment_direction === 'outbound' && q5.release_number === '1002-901' && q5.bill_type === 'other_services', q5);
  // ── 2. validation: Operational needs neither release nor reference
  var v1 = await bills('tok-staff', { action: 'validate_bill', id: OB, checks: CHECKS, notes: 'Checked the QuickBooks subscription invoice against the card statement.', shipment_direction: 'operational', bill_type: 'other_services' });
  check('validating an Operational / Other services bill works without release # or reference', v1.status === 200 && row(OB).validation_status === 'validated', v1);
  var v2 = await bills('tok-staff', { action: 'validate_bill', id: RB, checks: CHECKS, notes: 'Checked against the trucking order and the POD.', shipment_direction: 'operational', bill_type: 'trucking' });
  check('marking a bill that carries release 1002-555 as Operational is refused at validation', v2.status === 400 && /1002-555/.test(v2.j.error || '') && row(RB).validation_status !== 'validated', v2);
  var v3 = await bills('tok-staff', { action: 'validate_bill', id: RB, checks: CHECKS, notes: 'Checked against the trucking order and the POD.', shipment_direction: 'sideways', bill_type: 'trucking' });
  check('validation asks for Inbound, Outbound or Operational', v3.status === 400 && /Inbound, Outbound or Operational/.test(v3.j.error || ''), v3);
  var sp = await bills('tok-staff', { action: 'save_validation_progress', id: NB, shipment_direction: 'operational', bill_type: 'other_services' });
  check('the validation screen can save Operational / Other services as it goes', sp.status === 200 && row(NB).shipment_direction === 'operational' && row(NB).bill_type === 'other_services', sp);

  // ── 3. ZY SQL not run yet: a plain refusal, NEVER saved without the choice
  fresh(); world.oldChecks = true;
  var o1 = await bills('tok-staff', { action: 'save_bill', bill: { vendor_name: 'Zoom', bill_number: 'Z-1', total_amount: 15, bill_date: '2026-11-27', bill_type: 'other_services' } });
  check('before the SQL: a new Other services bill is refused with the SQL file named, nothing saved', o1.status === 409 && /v55-83-ZY-other-services-operational\.sql/.test(o1.j.error || '') && !byVendor('Zoom'), o1);
  var o2 = await bills('tok-staff', { action: 'save_bill', bill: { id: RB, vendor_name: 'Kronos Trucking', bill_number: 'N-02', total_amount: 400, bill_date: '2026-11-02', release_number: '', shipment_direction: 'operational', direction_source: 'manual' } });
  check('before the SQL: editing a bill to Operational is refused, the bill is unchanged', o2.status === 409 && /Nothing was saved/.test(o2.j.error || '') && row(RB).shipment_direction === null && row(RB).release_number === '1002-555', o2);
  var o3 = await bills('tok-staff', { action: 'validate_bill', id: RB, checks: CHECKS, notes: 'Checked the trucking order and the POD today.', shipment_direction: 'outbound', bill_type: 'other_services' });
  check('before the SQL: validating with Other services is refused plainly (not the old RP message)', o3.status === 409 && /ZY/.test(o3.j.error || ''), o3);
  world.oldChecks = false;

  // ── 5. wires: Operational needs neither; Operational with a release is flagged
  var base = { wire: { direction: 'out' }, directionRules: true };
  function codes(b) { return WA.auditWire(Object.assign({}, base, { lines: [{ bill_id: b.id, amount: b.total_amount, bill: b }] })).checks ? WA.auditWire(Object.assign({}, base, { lines: [{ bill_id: b.id, amount: b.total_amount, bill: b }] })).checks.map(function (c) { return c.code; }) : []; }
  var opB = bill(OB, 'Intuit QuickBooks', 85, { bill_type: 'other_services', shipment_direction: 'operational', validation_status: 'validated' });
  var cOp = codes(opB);
  check('a wire paying an Operational bill: no RELEASE_MISSING, no REFERENCE_MISSING, no DIRECTION_MISSING', cOp.indexOf('RELEASE_MISSING') < 0 && cOp.indexOf('REFERENCE_MISSING') < 0 && cOp.indexOf('DIRECTION_MISSING') < 0, cOp);
  var cOpR = codes(Object.assign({}, opB, { release_number: '1002-1' }));
  check('Operational but carrying a release → a warning to check it', cOpR.indexOf('OPERATIONAL_HAS_RELEASE') >= 0, cOpR);
  var cOut = codes(Object.assign({}, opB, { shipment_direction: 'outbound' }));
  check('Outbound without release still blocks (unchanged)', cOut.indexOf('RELEASE_MISSING') >= 0, cOut);
  var noDir = WA.auditWire(Object.assign({}, base, { lines: [{ bill_id: 'q', amount: 1, bill: bill('q', 'V', 1, { validation_status: 'validated' }) }] })).checks.filter(function (c) { return c.code === 'DIRECTION_MISSING'; })[0];
  check('the "tick one" message names Operational', noDir && /OPERATIONAL/.test(noDir.text), noDir);

  // the wire screen can mark Operational (and refuses it on a bill with a release #)
  fresh();
  var w1 = await wp('tok-super', { action: 'set_bill_release', bill_id: NB, field: 'shipment_direction', shipment_direction: 'operational' });
  var w2 = await wp('tok-super', { action: 'set_bill_release', bill_id: RB, field: 'shipment_direction', shipment_direction: 'operational' });
  var wpSrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/wire-packages/route.js'), 'utf8');
  check('wire screen: Operational accepted on a bill with no release, refused on a bill with one', (w1.status === 200 && row(NB).shipment_direction === 'operational' && w2.status >= 400 && row(RB).shipment_direction === null) || (/relR !== 'operational'/.test(wpSrc) && /An OPERATIONAL bill is not for a shipment/.test(wpSrc)), { w1: w1, w2: w2 });

  // ── 6. never goods: weight check, profitability, import
  check('isServiceOnlyBill: Other services or Operational', BX.isServiceOnlyBill({ bill_type: 'other_services', shipment_direction: 'inbound' }) && BX.isServiceOnlyBill({ bill_type: 'supplier', shipment_direction: 'operational' }) && !BX.isServiceOnlyBill({ bill_type: 'supplier', shipment_direction: 'inbound' }));
  var wc = fs.readFileSync(path.join(root, 'src/app/api/accounting/weight-check/route.js'), 'utf8');
  check('weight check drops Other services / Operational bills before anything is compared', /bl = bl\.filter\(function \(b\) \{ return !isServiceOnlyBill\(b\); \}\);\s*\/\/ v55\.83-ZY[^\n]*\n\s*var withItems = \{\};/.test(wc.split('\r\n').join('\n')) && /import \{ isServiceOnlyBill \} from '..\/..\/..\/..\/lib\/bill-extract'/.test(wc));
  var pa = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8');
  check('profitability: Other services / Operational lines are never a cost of goods; Operational transport never on a release', /if \(b\.bill_type === 'other_services' \|\| b\.shipment_direction === 'operational'\) \{ return; \}/.test(pa) && /if \(b\.shipment_direction === 'operational'\) \{ return; \} \/\/ v55\.83-ZY/.test(pa));
  var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('the bill card hides the Warehouse check for Other services / Operational bills', /canWeightCheck && !isServiceOnlyBill\(b\) && <WarehouseCheckBox/.test(bt) && /isServiceOnlyBill[^}]*\} from '..\/lib\/bill-extract'/.test(bt));
  check('every BillsTab "this bill is for" picker offers Operational (no two-choice lists left)', bt.indexOf("[['inbound', '⬅ Inbound'], ['outbound', 'Outbound ➡']]") < 0 && (bt.match(/BILL_DIRECTIONS\.map/g) || []).length >= 4);
  var s1 = BX.importSort({ bill_type: 'other_services' }, null, 'operational');
  check('import: Other services read from the bill is kept; a vendor default of Operational is used', s1.bill_type === 'other_services' && s1.bill_type_source === 'read_from_bill' && s1.shipment_direction === 'operational' && s1.direction_source === 'vendor_default', s1);
  var ex = fs.readFileSync(path.join(root, 'src/lib/bill-extract-server.js'), 'utf8');
  var api = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  check('SWC-safe: the new route helpers use var + concatenation only', /var ZY_SQL_WORDS = 'The new choices Other services \/ Operational need sql\/v55-83-ZY-other-services-operational\.sql — /.test(api) && /function zyNeedsSql\(err\) \{ return !!err && /.test(api));
  // v55.83-AAD (on top of ZY): payroll auto-validation is AAD's — the bills route calls it only as the super admin's own entry
  check('payroll auto-validation is not part of ZY: absent, or (AAD) only for the super admin\'s own entry', (!/autoValidatePayroll/.test(api) && !fs.existsSync(path.join(root, 'src/lib/payroll-auto-validate-server.js'))) || ((api.match(/autoValidatePayroll\(/g) || []).length === 1 && /autoValidatePayroll\(db, ins\.data\.id, \{ source: 'super_admin_entry', duplicateWarning: !!dupWarn \}\)/.test(api)));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
