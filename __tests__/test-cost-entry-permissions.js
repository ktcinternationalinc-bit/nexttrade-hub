const assert = require('node:assert/strict');
require('sucrase/register');
const { FakeDb } = require('./fake-supabase');
const { COST_ENTRY_PERMISSION, meetsTask, taskOf } = require('../src/lib/work-feed-tasks');
const { loadUserPermissions, userHasPermission } = require('../src/lib/server-permissions');

const db = new FakeDb();
db.t.users = [{ id: 'operator', role: 'team' }, { id: 'ungranted', role: 'team' }];
db.t.module_permissions = [
  { user_id: 'operator', module_name: COST_ENTRY_PERMISSION, has_access: true },
  { user_id: 'operator', module_name: 'pnl.view_revenue', has_access: false },
];
const from = db.from;
db.from = table => {
  const query = from(table);
  if (table.startsWith('pl_')) query.upsert = (rows, options) => ({ select: async () => {
    assert.equal(options.ignoreDuplicates, true);
    const saved = [];
    const keys = options.onConflict.split(',');
    const current = db.t[table] ||= [];
    for (const row of [].concat(rows)) {
      if (current.some(old => keys.every(key => old[key] === row[key]))) continue;
      current.push(row); saved.push(row);
    }
    return { data: saved };
  } });
  return query;
};
const cell = (line_id, extra) => ({
  line_id, invoice_date: '2026-06-20', invoice: 'INV-1', release: '1002-23', description: 'Product A',
  goods_revenue: 8124.93, transport_revenue: 743.12, goods_profit: null, profit: null,
  pounds: 100, base_cost: null, trucking_cost: 100, freight_cost: 100, ...extra,
});
let capturedDate;
function stub(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('@supabase/supabase-js', { createClient: () => db });
stub('../src/lib/verified-caller', { verifiedCaller: async req => ({ userId: req.headers.get('x-test-user') }) });
stub('../src/lib/payroll-bills', { payrollBillScope: async () => ({ isSuper: false }), payrollFilteredDb: d => d, requestNamesPayroll: () => false, pnlAccess: async () => false });
stub('../src/lib/visibility-window-server', { windowFloorFor: async () => ({ floor: '2026-06-15' }), clampFrom: (from, floor) => from > floor ? from : floor });
stub('../src/lib/profitability-load-server', { loadProfitabilityInput: async () => ({ input: { manual_costs_ready: true, keep_unit_ready: true, part_estimates_ready: true } }) });
stub('../src/lib/profitability-assemble', { assembleProfitability: opts => {
  capturedDate = opts.date_from;
  return { cells: [
    cell('supplier-1'), cell('supplier-2'),
    cell('unit-1', { description: 'Rolls BY KGs', pounds: null, transport_revenue: null }),
    cell('ship-1', { release: '1002-24', base_cost: 1, freight_cost: null }),
    cell('terms-only', { release: '1002-25', base_cost: 1, transport_revenue: null }),
  ] };
} });
const { POST } = require('../src/app/api/accounting/profitability/route');
const { feedAccess } = require('../src/components/WorkFeed.jsx');
const call = (action, values = {}, actor = 'operator') => POST(new Request('https://test.invalid/profitability', {
  method: 'POST', headers: { 'x-test-user': actor, 'content-type': 'application/json' }, body: JSON.stringify({ action, ...values }),
}));

(async () => {
  const ctx = await loadUserPermissions(db, 'operator');
  assert.equal(userHasPermission(ctx, COST_ENTRY_PERMISSION), true);
  assert.equal(userHasPermission(ctx, 'pnl.view'), false);
  assert.equal(userHasPermission(ctx, 'pnl.view_margin'), false);
  assert.equal(feedAccess(false, { [COST_ENTRY_PERMISSION]: true, 'pnl.view_revenue': false }, 'team').canCosts, true);
  assert.equal(feedAccess(false, { 'pnl.view': true, 'pnl.view_margin': true }, 'team').canCosts, false);
  assert.equal(meetsTask(taskOf('supplier_costs_missing'), key => userHasPermission(ctx, key)), true);
  assert.equal(meetsTask(taskOf('shipment_costs_missing'), key => userHasPermission(ctx, key)), true);
  assert.equal((await call('report')).status, 403);
  assert.equal((await call('set_manual_cost', { invoice_item_id: 'supplier-1', cost_per_lb: 20 })).status, 403);
  assert.equal((await call('cost_work_feed', {}, 'ungranted')).status, 403);
  assert.equal((await call('cost_work_save', {}, 'ungranted')).status, 403);

  const feed = await (await call('cost_work_feed', { date_from: '2025-01-01' })).json();
  assert.equal(capturedDate, '2026-06-15');
  assert.equal(feed.tasks.length, 3);
  assert.doesNotMatch(JSON.stringify(feed), /8124\.93|743\.12|revenue|profit|margin|customer|lineIds|terms-only/i);
  const supplier = feed.tasks.find(t => t.entry.kind === 'supplier');
  assert.deepEqual(supplier.entry.lines.map(line => line.id), ['supplier-1', 'supplier-2']);
  assert.equal((await call('cost_work_save', { task: supplier.key, amount: '1.25', line: 'outside' })).status, 400);
  assert.equal((await call('cost_work_save', { task: supplier.key, amount: '1.25', line: 'supplier-2' })).status, 200);
  assert.deepEqual(db.t.pl_line_costs.map(r => [r.invoice_item_id, r.cost_per_lb]), [['supplier-2', 1.25]]);
  assert.equal((await call('cost_work_save', { task: supplier.key, amount: '9.25', line: 'supplier-2' })).status, 409);
  const unit = feed.tasks.find(t => t.entry.kind === 'unit');
  assert.equal((await call('cost_work_save', { task: unit.key, unit: 'kg' })).status, 200);
  assert.deepEqual(db.t.pl_line_units.map(r => [r.invoice_item_id, r.unit]), [['unit-1', 'kg']]);
  const shipment = feed.tasks.find(t => t.entry.kind === 'shipment');
  assert.equal((await call('cost_work_save', { task: shipment.key, amount: 0, release: 'unrelated' })).status, 200);
  assert.deepEqual(db.t.pl_release_part_estimates.map(r => [r.release_key, r.part, r.amount]), [['100224', 'freight', 0]]);
  assert.equal(db.t.hub_audit_log.filter(row => row.action === 'cost_entry_saved' && row.actor_id === 'operator').length, 3);
  console.log('PASS: independent Cost Entry grants, task-only payload, scoped writes, no overwrites, no P&L access.');
})().catch(error => { console.error(error); process.exitCode = 1; });
