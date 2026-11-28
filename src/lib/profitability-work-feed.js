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
  return Array.from(byMonth.values()).flatMap(({ period, cells: monthCells }) => {
    const tasks = openTasks(monthCells, false).tasks;
    const taskKeys = new Set(tasks.map(task => task.key));
    const dependentShipping = task => ['transport_revenue', 'not_shared'].includes(task.kind) && !!task.blockers?.length && task.blockers.every(blocker => taskKeys.has(blocker.task));
    const alsoBlocksShipping = new Set(tasks.filter(dependentShipping).flatMap(task => task.blockers.map(blocker => blocker.task)));
    return tasks.filter(task => task.kind !== 'other' && !dependentShipping(task)).map(task => {
      const group = task.kind === 'base_cost' ? COST_FEED_KEYS[0] : COST_FEED_KEYS[1];
      const detail = period.label + ' · ' + task.lines + (task.lines === 1 ? ' sale line' : ' sale lines');
      const shipping = alsoBlocksShipping.has(task.key) ? ' This also blocks the shipping calculation.' : '';
      return { group, key: group + ':' + period.key + ':' + task.key, title: task.title, detail, issue: task.title + '.' + shipping,
        todo: task.todo || task.how, steps: [task.todo || task.how], target: { kind: 'profitability', month: period.key, task: task.key } };
    });
  });
}
