import { isExpenseKind, NEXTRADE_COMPANY_ID } from './companies';
import { wantsBill } from './nextrade-bills-server';
import { dropPrivate } from './private-accounts-server';

export const NEXTRADE_KTC_PNL_FROM = '2026-06-01';
export const NEXTRADE_KTC_PNL_EXCLUSIONS = 'nextrade_ktc_pnl_exclusions';

export function isNextradeKtcExpense(line, category) {
  return isExpenseKind(category?.kind) && wantsBill(line, category) && !!line.date && line.date >= NEXTRADE_KTC_PNL_FROM
    && !line.transfer_group_id && line.pending !== true && line.review_status !== 'duplicate'
    && String(line.iso_currency || 'USD').toUpperCase() === 'USD' && Math.round(Number(line.amount_abs) * 100) > 0;
}

const fallbackCategories = new Map([
  ['internet', 'utilities'],
  ['shipping', 'shipping_charges'],
  ['warehouse_insurance', 'insurance'],
]);

function normalizeLabel(label) { return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }

export function nextradeExpenseCategory(category, mappings, ktcCategories) {
  const mapped = mappings.get(category.key);
  if (mapped) return ktcCategories.get(mapped) || { key: mapped, label: category.label, kind: category.kind };
  if (ktcCategories.has(category.key)) return ktcCategories.get(category.key);
  const matches = [...ktcCategories.values()].filter(item => normalizeLabel(item.label) === normalizeLabel(category.label));
  if (matches.length === 1) return matches[0];
  return ktcCategories.get(fallbackCategories.get(category.key)) || category;
}

// Read both the expense and its bill identity across periods. A later
// reimbursement can settle a charge even when the original month is closed.
export async function loadNextradeExpenses(db, fetchAll, privateAccounts) {
  const company = NEXTRADE_COMPANY_ID;
  const [transactions, categories, mappings, links, classification, exclusions] = await Promise.all([
    fetchAll(() => db.from('bank_transactions').select('id,date,posted_date,account_id,account_subtype,amount_abs,iso_currency,direction,name,merchant_name,company_category,transfer_group_id,review_status,pending')
      .eq('wave_business_id', company).eq('direction', 'out').gte('date', NEXTRADE_KTC_PNL_FROM).order('id')),
    fetchAll(() => db.from('company_categories').select('key,label,kind,is_payroll,makes_ktc_bill').eq('company_id', company).order('key')),
    fetchAll(() => db.from('company_category_map').select('category_key,ktc_category').eq('company_id', company).order('category_key')),
    fetchAll(() => db.from('company_bill_links').select('source_bank_transaction_id,bill_id').eq('company_id', company).eq('status', 'active').order('id')),
    fetchAll(() => db.from('expense_categories').select('key,label,kind').in('kind', ['expense', 'other_expense', 'cogs']).order('key')),
    fetchAll(() => db.from(NEXTRADE_KTC_PNL_EXCLUSIONS).select('transaction_id').eq('excluded', true).order('transaction_id')),
  ]);
  const categoryByKey = new Map(categories.map(category => [category.key, category]));
  const ktcByKey = new Map(mappings.map(mapping => [mapping.category_key, mapping.ktc_category]));
  const billBySource = new Map(links.map(link => [link.source_bank_transaction_id, link.bill_id]));
  const ktcCategories = new Map(classification.map(category => [category.key, category]));
  const excluded = new Set(exclusions.map(row => row.transaction_id));
  return dropPrivate(transactions, privateAccounts).flatMap(transaction => {
    const category = categoryByKey.get(transaction.company_category);
    if (!isNextradeKtcExpense(transaction, category)) return [];
    const expenseCategory = nextradeExpenseCategory(category, ktcByKey, ktcCategories);
    const cents = Math.round(Number(transaction.amount_abs) * 100);
    return [{ id: transaction.id, date: transaction.date, cents, who: transaction.merchant_name || transaction.name,
      category: expenseCategory.key, nextrade_category: category.key, label: expenseCategory.label, kind: expenseCategory.kind,
      ktc_pnl_excluded: excluded.has(transaction.id), payroll: category.is_payroll === true,
      credit_card: transaction.account_subtype === 'credit card', bill_id: billBySource.get(transaction.id) }];
  });
}
