import { bucketOf, openTasks } from './pnl-period';

export const COST_FEED_KEYS = ['supplier_costs_missing', 'shipment_costs_missing'];

export function profitabilityWorkItems(cells) {
  const byMonth = new Map();
  for (const cell of cells) {
    const period = bucketOf(cell.invoice_date, 'month');
    if (period.key === 'zz') continue;
    if (!byMonth.has(period.key)) byMonth.set(period.key, { period, cells: [] });
    byMonth.get(period.key).cells.push(cell);
  }
  const grouped = new Map();
  const periods = Array.from(byMonth.values()).sort((a, b) => a.period.key.localeCompare(b.period.key));
  for (const { period, cells: monthCells } of periods) {
    const tasks = openTasks(monthCells, false).tasks;
    const taskKeys = new Set(tasks.map(task => task.key));
    const dependentShipping = task => ['transport_revenue', 'not_shared'].includes(task.kind) && !!task.blockers?.length && task.blockers.every(blocker => taskKeys.has(blocker.task));
    const alsoBlocksShipping = new Set(tasks.filter(dependentShipping).flatMap(task => task.blockers.map(blocker => blocker.task)));
    for (const task of tasks.filter(task => task.kind !== 'other' && !dependentShipping(task))) {
      const group = task.kind === 'base_cost' ? COST_FEED_KEYS[0] : COST_FEED_KEYS[1];
      const key = group + ':' + task.key;
      if (!grouped.has(key)) {
        grouped.set(key, { group, key, title: task.title, todo: task.todo || task.how, target: { kind: 'profitability', month: period.key, task: task.key }, months: [], lines: 0, blocksShipping: false });
      }
      const item = grouped.get(key);
      item.months.push(period.label);
      item.lines += task.lines;
      item.blocksShipping ||= alsoBlocksShipping.has(task.key);
    }
  }
  return Array.from(grouped.values()).map(({ months, lines, blocksShipping, ...item }) => {
    const detail = months.join(', ') + ' · ' + lines + (lines === 1 ? ' sale line' : ' sale lines');
    return { ...item, detail, issue: item.title + '. ' + detail + '.' + (blocksShipping ? ' This also blocks the shipping calculation.' : ''), steps: [item.todo] };
  });
}
