// v55.83-UD (Codex 12:30 P1) — the REAL P&L route handler, action list_costs, with a history window of 1 July 2026: a product on
// invoices AND a product never sold must both show only the cost changes inside the window (the cost in effect now stays).
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('UD — P&L typed-cost list inside the history window (real handler)');
var state = { db: null, floor: '2026-07-01', superAdmin: false };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: state.superAdmin } }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.superAdmin, mp: {} }); },
  userHasPermission: function () { return true; },
  revenueSwitchedOff: function () { return false; }, // v55.83-XK stand-in: nobody is a researcher here
});
stub('src/lib/visibility-window-server.js', { windowFloorFor: function () { return Promise.resolve({ floor: state.superAdmin ? null : state.floor }); }, clampFrom: function (d, f) { return !f ? d || null : (!d || d < f ? f : d); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var PNL = require(path.join(root, 'src/app/api/accounting/pnl/route.js'));
function call(body) { return PNL.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json', authorization: 'Bearer t' } })).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }); }
(async function () {
  var PC = require(path.join(root, 'src/lib/product-cost.js'));
  var kSold = PC.normalizeProductKey('Stock PVC Rolls'); var kNever = PC.normalizeProductKey('Never Sold Vinyl');
  state.db = new FakeDb({});
  state.db.t.accounting_invoice_items = [{ description: 'Stock PVC Rolls', wave_product_name: null }];
  state.db.t.product_costs = [
    { id: 'p1', product_key: kSold, product_label: 'Stock PVC Rolls', cost_per_unit: 0.11, effective_from: '2026-06-01', notes: 'June secret note', created_at: '2026-06-01' },
    { id: 'p2', product_key: kSold, product_label: 'Stock PVC Rolls', cost_per_unit: 0.13, effective_from: '2026-08-01', notes: 'August', created_at: '2026-08-01' },
    { id: 'p3', product_key: kNever, product_label: 'Never Sold Vinyl', cost_per_unit: 0.12, effective_from: '2026-06-01', notes: 'historical note', created_at: '2026-06-01' }];
  var r = await call({ action: 'list_costs' });
  var sold = (r.j.products || []).filter(function (p) { return p.product_key === kSold; })[0];
  var never = (r.j.products || []).filter(function (p) { return p.product_key === kNever; })[0];
  check('employee (window 1 Jul): a product on invoices shows the cost now (0.13) and only the August change', sold && sold.current_cost === 0.13 && sold.history.length === 1 && sold.history[0].effective_from === '2026-08-01', sold || r);
  check('… a product NEVER sold: cost now (0.12) kept, but NO June row, June date or June note anywhere', never && never.current_cost === 0.12 && never.history.length === 0 && never.current_since === 'before 2026-07-01' && never.not_on_invoices === true && JSON.stringify(r.j).indexOf('historical note') < 0 && JSON.stringify(r.j).indexOf('June secret note') < 0, never || r);
  state.superAdmin = true;
  var r2 = await call({ action: 'list_costs' });
  var never2 = (r2.j.products || []).filter(function (p) { return p.product_key === kNever; })[0];
  check('super admin: the full history (June row and its date)', never2 && never2.history.length === 1 && never2.current_since === '2026-06-01', never2);
  console.log('\nUD P&L window: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
