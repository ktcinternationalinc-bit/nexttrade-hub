import { vendorKeyOf } from './bill-payments-report';
import { isPartnerFeeCategory } from './partner-fee';
import { NEXPAC_FEE_CENTS, identifyNexPacFeeLines, nexPacFeeSchedule } from './partner-fee-months';
import { billIdentity } from './bill-duplicates';

const cents = amount => Math.round((Number(amount) || 0) * 100);
const sum = rows => rows.reduce((total, row) => total + row.cents, 0);
const isUSD = currency => String(currency || 'USD').toUpperCase() === 'USD';
const isActive = bill => bill && (bill.record_status || 'active') === 'active';
const reviewCategory = key => !key || ['uncategorized', 'needs_clarification'].includes(key);

export function buildPaidComparison({ bills, payments, customerPayments = [], partnerFeeLines = [], nextradeExpenses = [], spendingRows, incomeRows, bankLines, funds, labels, kinds, from, to, billBusinessId, privateBills = {}, showRows = true, showPayrollDetails = true }) {
  if (!Array.isArray(funds)) return { unavailable: 'Vendor payments through RTM and NextTrade could not be verified.' };
  const inPeriod = date => date && date >= from && date <= to;
  const paid = [];
  const receipts = [];
  const funding = [];
  const review = [];
  const bankReview = [];
  const unclassifiedReceipts = [];
  const otherDeposits = [];
  const bankExpenses = [];
  const banks = new Map(bankLines.map(line => [line.id, line]));
  const partnerPatterns = new Set(Object.values(bills).filter(b => isActive(b) && isUSD(b.currency) && isPartnerFeeCategory(b.category)).map(b => vendorKeyOf(b.vendor_name) + '|' + cents(b.total_amount)));
  function partnerMatch(bill) {
    const vendor = vendorKeyOf(bill.vendor_name);
    const total = cents(bill.total_amount);
    if (vendor === 'nexpac corporation' && total === NEXPAC_FEE_CENTS) return false;
    return !String(bill.category || '').trim() && !!vendor && partnerPatterns.has(vendor + '|' + total);
  }
  const feeLinesByBill = identifyNexPacFeeLines(bills, partnerFeeLines);
  const monthlySchedule = nexPacFeeSchedule(feeLinesByBill, from, to);
  const categoryOf = b => isPartnerFeeCategory(b.category) || isPartnerFeeCategory(labels[b.category]) || partnerMatch(b) || sum(feeLinesByBill.get(b.id) || []) === cents(b.total_amount) && feeLinesByBill.has(b.id) ? 'partner_fees' : b.category;
  const labelFor = key => labels[key] || key || 'Uncategorized';
  const nextradeByBill = new Map(nextradeExpenses.filter(row => row.bill_id).map(row => [row.bill_id, row]));
  const nextradeBills = new Set(nextradeByBill.keys());
  const charges = nextradeExpenses.filter(row => inPeriod(row.date)).map(row => {
    const bill = bills[row.bill_id];
    const category = row.category;
    const label = labels[category] || row.label;
    const source = 'NextTrade expense · transaction date';
    if (privateBills[row.bill_id] || row.payroll && !showPayrollDetails) return { date: row.date, cents: row.cents, category, label, kind: row.kind, source, source_company: 'NextTrade' };
    return { ...row, category, label, source, source_company: 'NextTrade', nextrade_transaction_id: row.id, ...(isActive(bill) ? { ref: bill.bill_number, bill_date: bill.bill_date,
      bill_total_cents: cents(bill.total_amount), attachment_path: bill.attachment_path } : { bill_id: undefined }) };
  });

  function billRow(bill, date, amount, source, id, bank) {
    const category = categoryOf(bill);
    const row = { id, date, cents: amount, category, label: labelFor(category), source, bank_ref: bank ? bank.name || bank.merchant_name : null };
    if (privateBills[bill.id]) return { ...row, label: 'Payroll', who: 'Payroll bill · details restricted', bank_ref: null };
    const nexttrade = nextradeByBill.get(bill.id);
    return { ...row, who: bill.vendor_name, ref: bill.bill_number, bill_id: bill.id, bill_category: bill.category || null, bill_date: bill.bill_date,
      ...(nexttrade && (showPayrollDetails || !nexttrade.payroll) ? { nextrade_transaction_id: nexttrade.id, nextrade_category: nexttrade.nextrade_category } : {}),
      release: bill.release_number, bill_total_cents: cents(bill.total_amount), attachment_path: bill.attachment_path };
  }

  function recordBillPayment(bill, date, amount, source, id, bank, party, funding) {
    const row = { ...billRow(bill, date, amount, source, id, bank), party,
      nexttrade_reimbursement: nextradeBills.has(bill.id), bank_id: bank?.id, bank_category: bank?.classification,
      transfer_id: funding?.transfer_id, transfer_date: funding?.transfer_date };
    const fees = feeLinesByBill.get(bill.id) || [];
    const feeAmount = sum(fees);
    const total = cents(bill.total_amount);
    if (!feeAmount || feeAmount >= total) { paid.push(row); return; }
    const remainderCategory = row.category === 'partner_fees' || !row.category ? 'other_bill_charges' : row.category;
    const remainder = { ...row, category: remainderCategory, label: remainderCategory === 'other_bill_charges' ? 'Other bill charges' : row.label };
    if (amount !== total) { paid.push({ ...remainder, source: source + ' · Partner fee portion needs a payment breakdown' }); return; }
    fees.forEach(fee => paid.push({ ...row, id: id + '|' + fee.id, cents: fee.cents, category: 'partner_fees', label: 'Partner Fees', source: source + ' · ' + fee.description }));
    paid.push({ ...remainder, cents: amount - feeAmount });
  }

  const partnerBilled = [];
  function billKey(bill) {
    return bill.bill_number && [vendorKeyOf(bill.vendor_name), String(bill.bill_number).trim().toLowerCase(), cents(bill.total_amount)].join('|');
  }
  const references = new Set(monthlySchedule.flatMap(month => month.sources.map(fee => billKey(bills[fee.bill_id])).filter(Boolean)));
  Object.values(bills).filter(bill => isActive(bill) && isUSD(bill.currency) && inPeriod(bill.bill_date))
    .sort((a, b) => Number(isPartnerFeeCategory(b.category)) - Number(isPartnerFeeCategory(a.category)))
    .forEach(bill => {
      if (categoryOf(bill) !== 'partner_fees' || privateBills[bill.id] || feeLinesByBill.has(bill.id)) return;
      const ref = billKey(bill);
      if (ref && references.has(ref)) return;
      if (ref) references.add(ref);
      partnerBilled.push(billRow(bill, bill.bill_date, cents(bill.total_amount), partnerMatch(bill) ? 'Recurring vendor and amount match' : 'Partner fee bill', bill.id));
    });
  const expectedPartnerFees = monthlySchedule.flatMap(month => {
    const choices = month.sources.filter(fee => !privateBills[fee.bill_id]);
    if (choices.length === 1) {
      const fee = choices[0];
      const row = billRow(bills[fee.bill_id], month.date, fee.cents, fee.description, fee.id);
      partnerBilled.push(row);
      return [];
    }
    return [{ id: month.id, date: month.date, cents: month.cents, who: 'NexPac Corporation', source: choices.length > 1 ? 'Multiple bills reference this month. Please reconcile them.' : 'Expected month-end fee · source bill missing' }];
  });

  const billed = [];
  const seenBills = new Set();
  const seenPartnerMonths = new Set();
  const nextradeBillIdentities = new Set(Array.from(nextradeBills, id => bills[id]).filter(isActive).map(billIdentity).filter(Boolean));
  Object.values(bills).filter(bill => isActive(bill) && isUSD(bill.currency) && bill.bill_date && cents(bill.total_amount) > 0
    && !/^credit/i.test(bill.bill_type || '') && (!billBusinessId || !bill.wave_business_id || bill.wave_business_id === billBusinessId))
    .sort((a, b) => a.bill_date.localeCompare(b.bill_date) || Number(!!b.category) - Number(!!a.category) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id))
    .forEach(bill => {
      if (nextradeBills.has(bill.id)) return;
      const identity = billIdentity(bill);
      if (identity && (seenBills.has(identity) || nextradeBillIdentities.has(identity))) return;
      if (identity) seenBills.add(identity);
      const source = bill.disputed ? 'Disputed vendor bill' : 'Vendor bill by invoice date';
      const fees = feeLinesByBill.get(bill.id) || [];
      let remaining = cents(bill.total_amount);
      for (const fee of fees) {
        if (fee.cents > remaining) break;
        remaining -= fee.cents;
        if (seenPartnerMonths.has(fee.month)) continue;
        seenPartnerMonths.add(fee.month);
        if (inPeriod(bill.bill_date)) {
          billed.push({ ...billRow(bill, bill.bill_date, fee.cents, source, fee.id), category: 'partner_fees', label: 'Partner Fees' });
        }
      }
      if (!inPeriod(bill.bill_date) || !remaining) return;
      const base = billRow(bill, bill.bill_date, remaining, source, bill.id);
      billed.push(fees.length && base.category === 'partner_fees' ? { ...base, category: 'other_bill_charges', label: 'Other bill charges' } : base);
    });

  const bankPayments = new Map();
  const recorded = new Set();
  const partnerFunding = new Set();
  const paymentById = new Map(payments.map(p => [p.id, p]));
  function markPartnerPayment(row) {
    const bill = bills[row.bill_id];
    if (row.transfer_id && isActive(bill) && isUSD(bill.currency) && categoryOf(bill) === 'partner_fees') {
      partnerFunding.add([row.transfer_id, cents(row.portion)].join('|'));
    }
    if (row.transfer_id && bill && cents(row.portion) === cents(bill.total_amount)) {
      (feeLinesByBill.get(bill.id) || []).forEach(fee => partnerFunding.add([row.transfer_id, fee.cents].join('|')));
    }
  }
  funds.forEach(company => {
    const period = company.period || {};
    const companyRows = (period.applied_rows || []).concat(period.from_starting_balance_rows || [], company.paid_without_a_transfer?.period_rows || []);
    (company.transfers || []).forEach(transfer => (transfer.lifetime_rows || []).forEach(markPartnerPayment));
    companyRows.forEach(markPartnerPayment);
    companyRows.forEach(row => {
      if (row.payment_id && recorded.has(row.payment_id)) return;
      const bill = bills[row.bill_id];
      if (!isActive(bill) || !isUSD(bill.currency)) return;
      const amount = cents(row.portion);
      const directBank = paymentById.get(row.payment_id)?.bank_transaction_id;
      // An ordinary bank line may also be named in the “paid through, source unknown” list. Use its bank payment once.
      if (directBank && row.on_bank_line === directBank) return;
      if (row.payment_id) recorded.add(row.payment_id);
      const payment = paymentById.get(row.payment_id);
      const evidence = payment?.vendor_payment_proof ? ' · vendor payment confirmation' : payment?.method === 'historical_reconciliation' ? ' · historical reconciliation' : ' paid';
      recordBillPayment(bill, row.paid_date, amount, company.party + evidence, row.payment_id, null, company.party, row);
    });
    (period.fee_rows || []).concat(period.loose_fee_rows || []).forEach(fee => {
      const amount = cents(fee.amount);
      const row = { id: fee.id, date: fee.date, cents: amount, who: company.party, category: 'professional_fees', label: 'Professional Fees', source: 'Recorded service fee', transfer_id: fee.transfer_id };
      if (partnerFunding.has([fee.transfer_id, Math.abs(amount)].join('|'))) {
        review.push({ ...row, source: 'Fee overlaps a partner bill on the same funding transfer' });
      } else if (fee.bank_transaction_id && !fee.transfer_id) {
        review.push({ ...row, source: 'Fee needs a link to its funding transfer' });
      } else if (amount) {
        paid.push({ ...row, party: company.party });
      }
    });
  });

  payments.forEach(payment => {
    const bill = bills[payment.bill_id];
    if (payment.voided || recorded.has(payment.id) || !isActive(bill) || !isUSD(bill.currency)) return;
    if (payment.bank_transaction_id) {
      const key = payment.bank_transaction_id;
      if (!bankPayments.has(key)) bankPayments.set(key, []);
      bankPayments.get(key).push(payment);
    } else if (inPeriod(payment.paid_date)) {
      review.push(billRow(bill, payment.paid_date, cents(payment.amount), 'Recorded payment needs its bank or funding link', payment.id));
    }
  });

  const eligibleBankIds = new Set();
  spendingRows.forEach(row => {
    const bank = banks.get(row.id);
    if (!bank || !isUSD(bank.iso_currency) || row.paired) return;
    const amount = cents(row.amount);
    const base = { id: row.id, date: row.date, cents: amount, who: row.who, category: row.category, label: labelFor(row.category), source: 'Bank transaction' };
    if (row.funds_sent_to || row.money_back_from) {
      funding.push({ ...base, label: row.funds_sent_to || row.money_back_from, source: row.money_back_from ? 'Funding returned' : 'Funds sent' });
      eligibleBankIds.add(row.id);
      return;
    }
    const kind = kinds[row.category];
    if (kind === 'transfer' || row.category === 'transfer' || kind === 'not_pnl') return;
    const needsCategory = reviewCategory(row.category);
    const incomeCategory = kind === 'income' || kind === 'other_income';
    const reviewReason = needsCategory ? 'Needs an expense category' : incomeCategory ? 'Money out is categorized as ' + base.label : null;
    const bankExpense = { ...base, bank_category: bank.classification ?? row.category ?? '', bank_edit: !row.money_in, credit_card: bank.account_subtype === 'credit card' };
    // Cash uses the posting and saved bank category once. Bill allocations are used only for Vendor payments.
    bankExpenses.push(reviewReason ? { ...bankExpense, category: 'uncategorized', label: 'Uncategorized / needs review', review_reason: reviewReason } : bankExpense);
    eligibleBankIds.add(row.id);
    let remaining = amount;
    const allocations = bankPayments.get(row.id) || [];
    const allocationsFit = allocations.reduce((total, payment) => total + cents(payment.amount), 0) <= amount;
    allocations.forEach(payment => {
      const portion = cents(payment.amount);
      const bill = bills[payment.bill_id];
      if (portion <= 0) return;
      if (!allocationsFit) {
        review.push(billRow(bill, row.date, portion, 'Bill allocations exceed the bank transaction', payment.id));
        return;
      }
      recordBillPayment(bill, row.date, portion, 'Bill matched to bank payment', payment.id, { ...bank, classification: row.category });
      remaining -= portion;
    });
    if (!remaining) return;
    const remainder = { ...bankExpense, cents: remaining };
    if (reviewReason) bankReview.push({ ...remainder, review_reason: reviewReason });
    else paid.push(remainder);
  });

  bankPayments.forEach((allocations, bankId) => {
    if (eligibleBankIds.has(bankId)) return;
    allocations.filter(p => inPeriod(p.paid_date)).forEach(p => {
      review.push(billRow(bills[p.bill_id], p.paid_date, cents(p.amount), 'Bank link could not be reconciled in this period', p.id));
    });
  });

  const recordedReceipts = new Map();
  customerPayments.forEach(payment => {
    if (!payment.bank_transaction_id || cents(payment.amount) <= 0) return;
    const key = payment.bank_transaction_id;
    if (!recordedReceipts.has(key)) recordedReceipts.set(key, { cents: 0, invoices: new Set() });
    const record = recordedReceipts.get(key);
    record.cents += cents(payment.amount);
    record.invoices.add(payment.accounting_invoice_id);
  });
  incomeRows.forEach(row => {
    const bank = banks.get(row.id);
    if (!bank || !isUSD(bank.iso_currency) || row.paired || row.returned_deposit || row.money_back_from || row.category === 'transfer') return;
    const linked = recordedReceipts.get(row.id);
    const record = { id: row.id, date: row.date, who: row.who, cents: cents(row.amount), category: row.category, label: labelFor(row.category),
      bank_category: bank.classification || '', bank_edit: !bank.matched_invoice_id && !linked, direction: 'in',
      invoice_id: bank.matched_invoice_id || (linked?.invoices.size === 1 ? Array.from(linked.invoices)[0] : null) };
    if (row.category === 'customer_payment') {
      receipts.push(record);
    } else if (linked) {
      const proven = Math.min(record.cents, linked.cents);
      receipts.push({ ...record, cents: proven, source: 'Amount matched to customer invoices' });
      if (proven < record.cents) unclassifiedReceipts.push({ ...record, cents: record.cents - proven, invoice_id: null, source: 'Unmatched remainder of deposit' });
    } else if (!row.category) {
      unclassifiedReceipts.push(record);
    } else {
      otherDeposits.push(record);
    }
  });

  const group = rows => ({ cents: sum(rows), count: rows.length, rows: showRows ? rows : [] });
  const reimbursements = paid.filter(row => row.nexttrade_reimbursement);
  const chargeCategories = new Map();
  charges.forEach(row => {
    const old = chargeCategories.get(row.category) || { key: row.category, label: row.label, kind: kinds[row.category] || row.kind, total: 0, count: 0, rows: [] };
    old.total = (cents(old.total) + row.cents) / 100;
    old.count++;
    if (showRows) old.rows.push(row);
    chargeCategories.set(row.category, old);
  });
  const directReimbursements = reimbursements.filter(row => row.bank_id);
  const reimbursementByBank = new Map();
  const directCategoryCents = Object.create(null);
  directReimbursements.forEach(row => {
    if (row.bill_id) reimbursementByBank.set(row.bank_id, (reimbursementByBank.get(row.bank_id) || 0) + row.cents);
    const key = row.bank_category || 'uncategorized';
    directCategoryCents[key] = (directCategoryCents[key] || 0) + row.cents;
  });
  const rtmTransfers = funds.filter(company => String(company.party || '').trim().toLowerCase() === 'rtm capital')
    .flatMap(company => company.transfers || []).filter(transfer => inPeriod(transfer.date) && transfer.as_of);
  const rtmReconciliation = rtmTransfers.length ? rtmTransfers.reduce((totals, transfer) => ({
    sent: totals.sent + cents(transfer.sent),
    bills: totals.bills + cents(transfer.as_of.applied_to_bills),
    fees: totals.fees + cents(transfer.as_of.services_rendered),
    refunded: totals.refunded + cents(transfer.as_of.refunds),
    left: totals.left + cents(transfer.as_of.held),
  }), { sent: 0, bills: 0, fees: 0, refunded: 0, left: 0 }) : null;
  const allocationByTransfer = new Map(rtmTransfers.map(transfer => [transfer.id, {
    linked_cents: cents(transfer.as_of.applied_to_bills), unallocated_cents: cents(transfer.as_of.held),
  }]));
  const fundingRows = funding.map(row => row.source === 'Funds sent' ? { ...row, allocation: allocationByTransfer.get(row.id) } : row);
  const cashRows = bankExpenses.map(row => reimbursementByBank.has(row.id) ? { ...row, reimbursement_cents: reimbursementByBank.get(row.id) } : row);
  const bankCash = group(cashRows.concat(fundingRows.map(row => ({ ...row, category: 'company_funding', label: 'RTM / NextTrade funding', who: row.who || row.label }))));
  const netPayments = paid.filter(row => !row.nexttrade_reimbursement);
  return { rows_visible: showRows, paid: group(netPayments.concat(charges)), receipts: group(receipts),
    funding: group(fundingRows),
    funded_paid: group(paid.filter(row => row.party).map(row => row.nexttrade_reimbursement ? { ...row, source: row.source + ' · reimburses a recorded NextTrade charge' } : row)),
    nextrade_charges: group(charges), nextrade_reimbursements: group(reimbursements),
    rtm_reconciliation: rtmReconciliation,
    nextrade_operating: { charges_by_category: Array.from(chargeCategories.values()), direct_by_category: directCategoryCents,
      direct_rows: showRows ? directReimbursements.map(({ bank_id, cents: amount }) => ({ bank_id, cents: amount })) : [] },
    review: group(review.concat(bankReview)), bank_review: group(bankReview), other_review: group(review),
    bank_cash: bankCash,
    billed: group(billed.concat(charges)),
    unclassified_receipts: group(unclassifiedReceipts), other_deposits: group(otherDeposits), partner_billed: group(partnerBilled), partner_schedule: group(expectedPartnerFees), partner_paid_cents: sum(paid.filter(row => row.category === 'partner_fees')) };
}

export function combinePaidComparisons(parts) {
  if (!parts.length || parts.some(part => !part || part.unavailable)) return null;
  const totals = { rows_visible: parts.every(part => part.rows_visible), partner_paid_cents: parts.reduce((total, part) => total + part.partner_paid_cents, 0) };
  totals.notice = parts.find(part => part.notice)?.notice;
  function combineGroups(groupOf) {
    return parts.reduce((total, part) => {
      const group = groupOf(part);
      return group ? { cents: total.cents + group.cents, count: total.count + group.count, rows: total.rows.concat(group.rows) } : total;
    }, { cents: 0, count: 0, rows: [] });
  }
  for (const key of ['paid', 'receipts', 'funding', 'funded_paid', 'bank_cash', 'billed', 'nextrade_charges', 'nextrade_reimbursements', 'review', 'unclassified_receipts', 'other_deposits', 'partner_billed', 'partner_schedule']) {
    totals[key] = combineGroups(part => part[key]);
  }
  if (parts.every(part => part.bank_review && part.other_review)) {
    totals.bank_review = combineGroups(part => part.bank_review);
    totals.other_review = combineGroups(part => part.other_review);
  }
  return totals;
}
