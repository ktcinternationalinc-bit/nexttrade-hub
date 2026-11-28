import { audit } from './audit-server';
import { payrollBillScope, payrollFilteredDb } from './payroll-bills';
import { assembleProfitability } from './profitability-assemble';
import { loadProfitabilityInput } from './profitability-load-server';
import { relKey } from './profitability';
import { COST_ENTRY_FROM, COST_ENTRY_UNITS, profitabilityWorkItems } from './profitability-work-feed';
import { assertPermission } from './server-permissions';
import { clampFrom, windowFloorFor } from './visibility-window-server';
import { COST_ENTRY_PERMISSION } from './work-feed-tasks';

const error = (message, status) => Response.json({ ok: false, error: message }, { status });

export async function costEntry(db, req, userId, body) {
  const grant = await assertPermission(db, userId, COST_ENTRY_PERMISSION, req);
  if (!grant.ok) return error(grant.status === 503 ? grant.error : 'Cost Entry access is required.', grant.status || 403);
  const scope = await payrollBillScope(db, userId);
  if (scope.error) return error('Cost sources could not be verified.', scope.status || 503);
  const window = await windowFloorFor(db, grant.ctx);
  if (window.error) return error(window.error, 503);
  const readDb = payrollFilteredDb(db, scope);
  let loaded;
  try {
    loaded = await loadProfitabilityInput(readDb);
  } catch {
    return error('Cost sources could not be loaded. Try again.', 503);
  }
  if (loaded.setup_needed || loaded.billsNote || loaded.whNote) return error('Cost sources could not be loaded. Try again.', 503);
  const { cells } = assembleProfitability({ ...loaded.input, date_from: clampFrom(COST_ENTRY_FROM, window.floor) });
  const tasks = profitabilityWorkItems(cells || []);
  if (body.action === 'cost_work_feed') {
    return Response.json({ ok: true, tasks: tasks.map(({ lineIds, ...task }) => task) });
  }

  // Resolve the editable records again on the server. The client supplies only a task key and the new value.
  const task = tasks.find(item => item.key === body.task);
  if (!task) return error('This task has changed or is already resolved. Refresh your feed.', 409);
  const { entry, lineIds } = task;
  const stamp = { updated_by: userId, updated_at: new Date().toISOString() };
  const note = String(body.note || '').trim().slice(0, 300) || null;
  let result;
  if (entry.kind === 'unit') {
    if (!lineIds.length || !COST_ENTRY_UNITS.some(([key]) => key === body.unit)) return error('Choose a valid unit for these lines.', 400);
    result = await db.from('pl_line_units').upsert(lineIds.map(invoice_item_id => ({ invoice_item_id, unit: body.unit, ...stamp })),
      { onConflict: 'invoice_item_id', ignoreDuplicates: true }).select('invoice_item_id');
  } else {
    const amount = typeof body.amount === 'string' || typeof body.amount === 'number' ? String(body.amount).trim().replace(/[$,]/g, '') : '';
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value < 0) return error('Enter a valid cost in USD.', 400);
    if (entry.kind === 'supplier') {
      const selected = body.line === 'all' ? lineIds : lineIds.filter(id => id === body.line);
      if (!selected.length) return error('Choose which lines the cost applies to.', 400);
      if (value <= 0 || value > (entry.per === 'yard' ? 1000 : 100)) return error('Enter a valid cost per ' + entry.per + ' above zero.', 400);
      if (!loaded.input.manual_costs_ready || !loaded.input.keep_unit_ready) return error('Supplier cost entry is unavailable right now.', 503);
      result = await db.from('pl_line_costs').upsert(selected.map(invoice_item_id => ({
        invoice_item_id, cost_per_lb: value, commission_per_lb: 0, cost_unit: entry.per === 'yard' ? 'sold_unit' : 'lb', note, ...stamp,
      })), { onConflict: 'invoice_item_id', ignoreDuplicates: true }).select('invoice_item_id');
    } else {
      if (!loaded.input.part_estimates_ready) return error('Shipment cost entry is unavailable right now.', 503);
      const release = relKey(entry.release);
      if (!release) return error('This shipment has no usable release number.', 409);
      const fields = { amount: value, note, ...stamp };
      // Clearing an estimate in Profitability leaves a row with a null amount. Fill that row or insert a new one.
      result = await db.from('pl_release_part_estimates').update(fields).eq('release_key', release).eq('part', entry.part).is('amount', null).select('release_key');
      if (!result.error && !result.data?.length) {
        result = await db.from('pl_release_part_estimates').upsert({ release_key: release, part: entry.part, ...fields },
          { onConflict: 'release_key,part', ignoreDuplicates: true }).select('release_key');
      }
    }
  }
  if (result.error) return error('The cost entry could not be saved. Try again.', 503);
  if (!result.data?.length) return error('Those records already have an entry. Refresh your feed.', 409);
  await audit(db, userId, 'cost_entry_saved', 'cost_entry_task', null, { task: task.key, entry, records: result.data, value: body.unit || body.amount, note });
  return Response.json({ ok: true, saved: result.data.length });
}
