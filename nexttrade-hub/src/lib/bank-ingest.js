// v55.83-X — Phase 1 bank ingestion mapping (pure, no DB, testable).
// Plaid amount sign convention for DEPOSITORY accounts:
//   positive amount  = money LEAVING the account (debit / out)
//   negative amount  = money ENTERING the account (credit / in)
// We normalize to an explicit `direction` + positive `amount_abs` so the rest
// of the app never has to remember Plaid's sign rule.
//
// IMPORTANT: this mapper returns ONLY bank-sourced fields. It deliberately does
// NOT emit review_status / classification / linked_* / customer_id / notes —
// those are user-owned and must never be clobbered when a sync re-upserts an
// existing row. New rows get review_status='unreviewed' from the column DEFAULT.

export function deriveDirection(amount) {
  return Number(amount) < 0 ? 'in' : 'out';
}

export function deriveChannel(t) {
  // Prefer Plaid's transaction_code (ach/wire/check/...) when present, then fall
  // back to payment_channel (online / in store / other).
  var code = t && t.transaction_code ? String(t.transaction_code).toLowerCase() : '';
  if (code) {
    if (code.indexOf('ach') >= 0) return 'ach';
    if (code.indexOf('wire') >= 0) return 'wire';
    if (code.indexOf('check') >= 0) return 'check';
    if (code.indexOf('card') >= 0 || code.indexOf('pos') >= 0) return 'card';
    return code;
  }
  var pc = t && t.payment_channel ? String(t.payment_channel).toLowerCase() : '';
  if (pc) return pc;
  return 'other';
}

export function deriveAccountInfo(t, accountsById) {
  var a = accountsById && t && t.account_id ? accountsById[t.account_id] : null;
  var type = a && a.type ? String(a.type).toLowerCase() : null;          // depository|credit|loan|investment
  var subtype = a && a.subtype ? String(a.subtype).toLowerCase() : null; // checking|savings|credit card|...
  // Phase 1 only verified the sign convention for DEPOSITORY (checking/savings)
  // accounts. Anything else is flagged so its direction is never silently trusted.
  var unsupported = type != null && type !== 'depository';
  return { account_type: type, account_subtype: subtype, unsupported_account: unsupported };
}

// v55.83-IV — acctSiloMap (optional 4th arg): { [plaid_account_id]: wave_business_id }. When the
// transaction's own account has an explicit silo assignment, that WINS over the connection default,
// so a connection holding accounts in different silos (6338 vs 6353) stamps each row correctly.
export function mapPlaidTransaction(t, conn, accountsById, acctSiloMap) {
  var amount = Number(t.amount);
  var acct = deriveAccountInfo(t, accountsById);
  var connBiz = conn ? (conn.wave_business_id || null) : null;
  var acctBiz = (acctSiloMap && t && t.account_id && acctSiloMap[t.account_id]) ? acctSiloMap[t.account_id] : null;
  return {
    connection_id: conn ? conn.id : null,
    business_id: conn ? (conn.business_id || null) : null,
    wave_business_id: acctBiz || connBiz,
    bank_source: conn ? (conn.institution_name || conn.bank_name || null) : null,
    plaid_transaction_id: t.transaction_id,
    account_id: t.account_id,
    date: t.date,
    posted_date: t.pending ? null : t.date,
    authorized_date: t.authorized_date || null,
    amount: amount,
    amount_abs: Math.abs(amount),
    direction: deriveDirection(amount),
    iso_currency: t.iso_currency_code || t.unofficial_currency_code || 'USD',
    name: t.name || t.merchant_name || 'Unknown',
    merchant_name: t.merchant_name || null,
    category: (t.category || []).join(' > '),
    channel: deriveChannel(t),
    transaction_code: t.transaction_code || null,
    check_number: t.check_number || null,
    pending: t.pending || false,
    pending_transaction_id: t.pending_transaction_id || null,
    account_type: acct.account_type,
    account_subtype: acct.account_subtype,
    unsupported_account: acct.unsupported_account,
    raw: t,
    updated_at: new Date().toISOString(),
  };
}

// When a pending transaction posts, Plaid issues a NEW transaction_id whose
// pending_transaction_id points back at the pending twin. Those pending rows
// must be removed so the same money isn't counted twice.
export function supersededPendingIds(txns) {
  var ids = [];
  (txns || []).forEach(function (t) {
    if (t && !t.pending && t.pending_transaction_id) ids.push(t.pending_transaction_id);
  });
  return ids;
}
