import { isExpenseKind, NEXTRADE_COMPANY_ID } from './companies';
import { NEXTRADE_BILL_CUTOFF, wantsBill } from './nextrade-bills-server';
import { dropPrivate } from './private-accounts-server';

// Read both the expense and its bill identity across periods. A later
// reimbursement can settle a charge even when the original month is closed.
export async function loadNextradeExpenses(db, fetchAll, privateAccounts) {
  const company = NEXTRADE_COMPANY_ID;
  const [transactions, categories, mappings, links] = await Promise.all([
    fetchAll(() => db.from('bank_transactions').select('id,date,posted_date,account_id,amount_abs,iso_currency,direction,name,merchant_name,company_category,transfer_group_id,review_status,pending')
      .eq('wave_business_id', company).eq('direction', 'out').gte('date', NEXTRADE_BILL_CUTOFF).order('id')),
    fetchAll(() => db.from('company_categories').select('key,label,kind,is_payroll,makes_ktc_bill').eq('company_id', company).order('key')),
    fetchAll(() => db.from('company_category_map').select('category_key,ktc_category').eq('company_id', company).order('category_key')),
    fetchAll(() => db.from('company_bill_links').select('source_bank_transaction_id,bill_id').eq('company_id', company).eq('status', 'active').order('id')),
  ]);
  const categoryByKey = new Map(categories.map(category => [category.key, category]));
  const ktcByKey = new Map(mappings.map(mapping => [mapping.category_key, mapping.ktc_category]));
  const billBySource = new Map(links.map(link => [link.source_bank_transaction_id, link.bill_id]));
  return dropPrivate(transactions, privateAccounts).flatMap(transaction => {
    const category = categoryByKey.get(transaction.company_category);
    if (!isExpenseKind(category?.kind) || !wantsBill(transaction, category) || transaction.transfer_group_id || transaction.pending === true
      || transaction.review_status === 'duplicate' || String(transaction.iso_currency || 'USD').toUpperCase() !== 'USD') return [];
    const cents = Math.round(Number(transaction.amount_abs) * 100);
    if (!(cents > 0)) return [];
    return [{ id: transaction.id, date: transaction.date, cents, who: transaction.merchant_name || transaction.name,
      category: ktcByKey.get(category.key) || category.key, label: category.label, kind: category.kind,
      payroll: category.is_payroll === true, bill_id: billBySource.get(transaction.id) }];
  });
}
