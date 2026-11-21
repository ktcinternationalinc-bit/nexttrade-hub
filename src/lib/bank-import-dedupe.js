// Pending holds cannot stand in for posted money. Nor may a removed copy suppress it.
export function countsAsImported(row) {
  return row.pending !== true && row.review_status !== 'duplicate';
}

export function dedupeImportedRows(rows, seen, aliases, existingIds) {
  var counts = {}; var skipped = 0;
  var holdCounts = {};
  function holdKey(row) {
    var text = String(row.name || row.merchant_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!text || !row.wave_business_id) { return null; }
    return key(row) + '|' + row.wave_business_id + '|' + (row.iso_currency || 'USD') + '|' + text;
  }
  function key(row) {
    return ((aliases || {})[row.account_id] || row.account_id) + '|' + (row.posted_date || row.date) + '|' +
      (Math.round((Number(row.amount_abs) || 0) * 100) / 100).toFixed(2) + '|' + row.direction;
  }
  (seen || []).filter(countsAsImported).forEach(function (row) { var k = key(row); counts[k] = (counts[k] || 0) + 1; });
  // Count per source account, then take the maximum: three connections are not three payments.
  var byAccount = {};
  (seen || []).forEach(function (row) {
    if (row.review_status === 'duplicate' || !(aliases || {})[row.account_id] || aliases[row.account_id] === row.account_id) { return; }
    var k = holdKey(row); if (!k) { return; }
    var bucket = byAccount[k] || (byAccount[k] = {});
    bucket[row.account_id] = (bucket[row.account_id] || 0) + 1;
    holdCounts[k] = Math.max(holdCounts[k] || 0, bucket[row.account_id]);
  });
  var kept = (rows || []).filter(function (row) {
    var k = key(row); var slot = (counts[k] || 0) > 0;
    if (row.pending === true) {
      var hk = holdKey(row); var holdSlot = hk && (holdCounts[hk] || 0) > 0;
      if (holdSlot) { holdCounts[hk]--; }
      if ((existingIds || {})[row.plaid_transaction_id]) { return true; }
      if (holdSlot) { skipped++; return false; }
      return true;
    }
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
