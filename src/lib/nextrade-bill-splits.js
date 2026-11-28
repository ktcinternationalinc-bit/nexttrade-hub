export const NEXTRADE_BILL_SPLITS = 'nextrade_bill_category_splits';

export function canSplitInto(category) {
  return category?.active === true && ['expense', 'other_expense', 'cogs'].includes(category.kind) &&
    category.direction !== 'in' && category.is_payroll !== true &&
    category.key !== 'sales_ktc_managed_income';
}

export function billSplitCents(value) {
  const text = String(value || '').trim();
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : 0;
}

export function activeSplit(line, split, linkedBillId) {
  if (!split || split.bill_id !== linkedBillId || !Array.isArray(split.allocations)) return [];
  return split.allocations.reduce((sum, part) => sum + part.cents, 0) === Math.round(Number(line.amount_abs) * 100)
    ? split.allocations : [];
}

export function expandNextradeSplit(line) {
  if (!line.category_split?.length) return [line];
  return line.category_split.map(part => ({ ...line, id: line.id + ':' + part.category,
    source_transaction_id: line.id, company_category: part.category, amount_abs: part.cents / 100,
    split_category: true, split_include_ktc: part.include_ktc !== false }));
}
