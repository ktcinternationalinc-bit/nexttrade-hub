export const MANAGED_SALES_OPENING_ID = '92d12430-84be-4281-a81b-2b06d7805fa2';
export const MANAGED_SALES_LABEL = 'NextTrade-managed sales';
export const MANAGED_REMITTANCE = 'sales_ktc_managed_income';

const cents = value => Math.round(Number(value || 0) * 100);

export function managedCashReceipts(lines, bankLines, receipts, from, to) {
  const outgoing = new Map();
  for (const line of lines) {
    if (line.category !== MANAGED_REMITTANCE) continue;
    const wire = /\bIMAD:\s*([A-Z0-9]{18,22})\b/i.exec(line.description || '')?.[1]?.slice(-18)?.toUpperCase();
    if (!wire) continue;
    const key = wire + '|' + cents(line.amount);
    outgoing.set(key, (outgoing.get(key) || 0) + 1);
  }
  const remitted = new Map();
  for (const line of bankLines) {
    if (line.direction !== 'in') continue;
    const wire = /\bREF:\s*([A-Z0-9]{18,22})\b/i.exec(line.name || '')?.[1]?.slice(-18)?.toUpperCase();
    const key = wire + '|' + cents(line.amount_abs);
    if (outgoing.get(key) !== 1) continue;
    remitted.set(key, (remitted.get(key) || []).concat(line.id));
  }
  const matched = new Set([...remitted.values()].filter(ids => ids.length === 1).map(ids => ids[0]));
  const sales = lines.filter(line => line.category === 'sales' && line.date >= from && line.date <= to).map(line => ({
    id: line.id, date: line.date, who: line.description, source_company: 'NextTrade',
    category: 'nextrade_managed_sales', label: MANAGED_SALES_LABEL, cents: cents(line.amount) * (line.direction === 'in' ? 1 : -1),
  }));
  return {
    sales,
    remittances: receipts.filter(row => matched.has(row.id)),
    receipts: receipts.filter(row => !matched.has(row.id)).concat(sales),
  };
}

export async function readManagedSalesPeriod(db, fetchAll, from, to, canSeeBalance) {
  const previousDay = new Date(from + 'T00:00:00Z');
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const laterPosting = new Date(to + 'T00:00:00Z');
  laterPosting.setUTCDate(laterPosting.getUTCDate() + 7);
  const [lines, prior, end] = await Promise.all([
    fetchAll(() => db.rpc('hub_nextrade_managed_sales_lines', { p_through: laterPosting.toISOString().slice(0, 10) }).order('date').order('id')),
    canSeeBalance ? db.rpc('hub_nextrade_managed_sales_state', { p_through: previousDay.toISOString().slice(0, 10) }) : null,
    canSeeBalance ? db.rpc('hub_nextrade_managed_sales_state', { p_through: to }) : null,
  ]);
  if (!canSeeBalance) return { lines, balance: null };
  if (prior.error || end.error || !prior.data || !end.data) throw new Error('Could not read the managed-sales balance.');
  return { lines, balance: {
    from, to, opening: cents(prior.data.held), closing: cents(end.data.held),
    receipts: cents(end.data.sales) - cents(prior.data.sales), remitted: cents(end.data.remitted) - cents(prior.data.remitted),
    reversed: cents(end.data.reversed) - cents(prior.data.reversed), paid: cents(end.data.used) - cents(prior.data.used),
  } };
}
