// Dashboard-only projections. Operational Treasury rows are never modified.
export function dashboardCashFlow(rows, fromDate, includeBank) {
  var incoming = 0, outgoing = 0;
  (rows || []).forEach(function (row) {
    if ((row.transaction_date || '') < fromDate) return;
    incoming += Number(row.cash_in) || 0;
    outgoing += Number(row.cash_out) || 0;
    if (includeBank === true) {
      incoming += Number(row.bank_in) || 0;
      outgoing += Number(row.bank_out) || 0;
    }
  });
  return { incoming: incoming, outgoing: outgoing, net: incoming - outgoing };
}

export function dashboardCurrencyRows(rows, includeBank) {
  if (includeBank === true) return rows || [];
  return (rows || []).filter(function (row) {
    // Use the Treasury screen's bank-row classification so USD / other
    // currency summaries cannot reveal a bank total through a second view.
    return !row.is_bank_placeholder && !row.matched_bank_txn_id && !row.bank_account_id &&
      !(Number(row.bank_in) || 0) && !(Number(row.bank_out) || 0);
  });
}
