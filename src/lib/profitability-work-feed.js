import { bucketOf, openTasks } from './pnl-period';

export const COST_FEED_KEYS = ['supplier_costs_missing', 'shipment_costs_missing'];
export const COST_ENTRY_FROM = '2026-06-01';
export const COST_ENTRY_UNITS = [['lb', 'Pounds'], ['kg', 'Kilograms'], ['t', 'Metric tons'], ['yd', 'Yards'], ['lm', 'Linear metres']];

export function profitabilityWorkItems(cells) {
  const byMonth = new Map();
  for (const cell of cells) {
    const period = bucketOf(cell.invoice_date, 'month');
    if (period.key === 'zz') continue;
    if (!byMonth.has(period.key)) byMonth.set(period.key, { period, cells: [] });
    byMonth.get(period.key).cells.push(cell);
  }
  const grouped = new Map();
  for (const { period, cells: monthCells } of Array.from(byMonth.values()).sort((a, b) => a.period.key.localeCompare(b.period.key))) {
    const { tasks, by_line } = openTasks(monthCells, false);
    const blockers = new Set(tasks.filter(task => ['transport_revenue', 'not_shared'].includes(task.kind)).flatMap(task => (task.blockers || []).map(blocker => blocker.task)));
    for (const [index, cell] of monthCells.entries()) {
      for (const link of by_line[index] || []) {
        const task = tasks[link.n - 1];
        const supplier = task.kind === 'base_cost';
        const unit = task.kind === 'pounds';
        if (!supplier && !unit && task.kind !== 'trucking' && task.kind !== 'freight') continue;
        const group = COST_FEED_KEYS[supplier ? 0 : 1];
        const name = cell.description || task.product;
        const per = cell.keep_unit ? 'yard' : 'pound';
        const key = group + ':' + (unit ? 'pounds:' + name : task.key + (supplier ? ':' + per : ''));
        if (!grouped.has(key)) {
          const title = unit ? name + ' — missing unit' : task.title;
          const todo = supplier ? 'Enter the supplier cost in USD per ' + per + '. It applies to the missing lines shown here.'
            : unit ? 'Choose the unit for these product lines.' : 'Enter what we paid for ' + (task.part === 'freight' ? 'shipping' : 'trucking') + ' on this release. Enter zero if there was no charge.';
          const entry = supplier ? { kind: 'supplier', per } : unit ? { kind: 'unit' } : { kind: 'shipment', part: task.part, release: task.release };
          grouped.set(key, { group, key, title, todo, entry, months: new Set(), lineIds: new Set(), sourceLines: new Map(), lines: 0, blocksShipping: false });
        }
        const item = grouped.get(key);
        item.months.add(period.label);
        if (!cell.line_id || !item.lineIds.has(cell.line_id)) item.lines++;
        if (cell.line_id) item.lineIds.add(cell.line_id);
        if (supplier && cell.line_id) item.sourceLines.set(cell.line_id, { id: cell.line_id, date: cell.invoice_date, invoice: cell.invoice, release: cell.release_raw || cell.release || '', product: name });
        item.blocksShipping ||= blockers.has(task.key);
      }
    }
  }
  return Array.from(grouped.values()).map(({ months, lines, blocksShipping, lineIds, sourceLines, ...item }) => {
    const detail = Array.from(months).join(', ') + ' · ' + lines + (lines === 1 ? ' line' : ' lines');
    const entry = item.entry.kind === 'supplier' ? { ...item.entry, lines: Array.from(sourceLines.values()) } : item.entry;
    return { ...item, entry, lineIds: Array.from(lineIds), detail, issue: item.title + '. ' + detail + '.' + (blocksShipping ? ' This also blocks the shipping calculation.' : ''), steps: [item.todo], target: { kind: 'cost_entry' } };
  });
}
