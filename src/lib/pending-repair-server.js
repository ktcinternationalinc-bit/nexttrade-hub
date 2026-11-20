export function sameMoney(pend, post) {
  if (!pend || !post) { return false; }
  var cents = function (r) { return Math.round(Math.abs(Number(r.amount_abs != null ? r.amount_abs : r.amount) || 0) * 100); };
  return cents(pend) === cents(post) && (pend.direction || '') === (post.direction || '') &&
    (pend.iso_currency || 'USD') === (post.iso_currency || 'USD') && (pend.wave_business_id || '') === (post.wave_business_id || '');
}

// Read-only evidence for old records, including replacements imported before the current sync window.
export async function storedPendingReplacements(db, pendingRows) {
  var ids = (pendingRows || []).map(function (p) { return p.plaid_transaction_id; }).filter(Boolean);
  var byPending = {};
  for (var i = 0; i < ids.length; i += 100) {
    var q = await db.from('bank_transactions').select('*').in('pending_transaction_id', ids.slice(i, i + 100)).eq('pending', false).limit(2000);
    if (q.error) { throw new Error('Could not read posted replacements: ' + q.error.message); }
    if ((q.data || []).length >= 2000) { throw new Error('Too many posted replacements to verify in one pass.'); }
    (q.data || []).forEach(function (r) {
      if (r.review_status === 'duplicate') { return; }
      var k = r.pending_transaction_id;
      if (!byPending[k]) { byPending[k] = []; }
      if (!byPending[k].some(function (x) { return x.id === r.id; })) { byPending[k].push(r); }
    });
  }
  return byPending;
}

export function pendingRepairRow(p, candidates) {
  var matches = (candidates || []).filter(function (q) {
    return q.pending === false && q.review_status !== 'duplicate' && q.account_id === p.account_id &&
      q.connection_id === p.connection_id && q.wave_business_id === p.wave_business_id &&
      q.pending_transaction_id === p.plaid_transaction_id;
  });
  var post = matches.length === 1 ? matches[0] : null;
  var status = post ? (sameMoney(p, post) ? 'replacement_found' : 'changed_amount') : (matches.length > 1 ? 'ambiguous' : 'no_replacement');
  return {
    pending_id: p.id, posted_id: post ? post.id : null, date: p.date, description: p.name || p.merchant_name || '',
    amount: p.amount_abs, currency: p.iso_currency || 'USD', direction: p.direction,
    posted_date: post ? post.posted_date || post.date : null, posted_amount: post ? post.amount_abs : null,
    status: status,
    explanation: status === 'replacement_found' ? 'Bank-linked posted record found. Repair checks existing payments and closed periods before changing anything.' :
      status === 'changed_amount' ? 'Posted amount or currency differs. Review the existing payment before repair.' :
      status === 'ambiguous' ? 'More than one posted replacement found. Review required.' :
      'No confirmed posted replacement in the Hub. Sync the bank first; this record will not be marked posted by guessing.'
  };
}
