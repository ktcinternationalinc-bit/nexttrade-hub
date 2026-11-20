// Pending holds cannot stand in for posted money. Nor may a removed copy suppress it.
export function countsAsImported(row) {
  return row.pending !== true && row.review_status !== 'duplicate';
}

export function dedupeImportedRows(rows, seen, aliases, existingIds) {
  var counts = {}; var skipped = 0;
  function key(row) {
    return ((aliases || {})[row.account_id] || row.account_id) + '|' + (row.posted_date || row.date) + '|' +
      (Math.round((Number(row.amount_abs) || 0) * 100) / 100).toFixed(2) + '|' + row.direction;
  }
  (seen || []).filter(countsAsImported).forEach(function (row) { var k = key(row); counts[k] = (counts[k] || 0) + 1; });
  var kept = (rows || []).filter(function (row) {
    var k = key(row); var slot = (counts[k] || 0) > 0;
    // A known id needs its bank fields refreshed, and an explicit replacement must reach settlement.
    if ((existingIds || {})[row.plaid_transaction_id] || (!row.pending && row.pending_transaction_id)) {
      if (slot) { counts[k]--; }
      return true;
    }
    if (slot && !row.pending) { counts[k]--; skipped++; return false; }
    return true;
  });
  return { rows: kept, skipped: skipped };
}
