// v55.83-XT (Max 22 Nov: "WE NEED TO IGNORE PENDING TRANSACTIONS UNLESS WE HAVE A WAY TO REMOVE IT WHEN THE FINAL
// TRANSACTION HITS THE ACCOUNT.") — the missing case of the TU/WC settlement:
//   the bank names the final (posted) line Q that replaces pending line P (Q.pending_transaction_id = P's bank id, same
//   connection, account and company), but Q was itself archived as a copy because the SAME final line already came in
//   through a second connection of the same real bank account (K). Before XT the sync refused ("posted line is a
//   duplicate") and P stayed live next to K — the money counted twice.
// XT follows Q to the ONE live posted copy K on the same real account (same bank + last four, same company), with the same
// money as Q, the same posted day and the same description / cheque number (the rule the database used to archive Q).
// Exactly one K → P is settled into K by the existing guarded database step (restorable, audited). None or several → a
// person reviews. Q and K are never changed by this file. Never throws. Var + concat only.

import { realAccounts, realKeyOf } from './duplicate-detect';
import { sameMoney } from './pending-repair-server';

export function descKey(r) {
  var chk = String((r && r.check_number) || '').trim();
  if (chk) { return 'check' + chk.toLowerCase().replace(/[^a-z0-9]/g, ''); }
  return String((r && (r.name || r.merchant_name)) || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 80);
}
export function postedDay(r) { return String((r && (r.posted_date || r.date)) || '').substring(0, 10); }

// work a person put on the pending line that an automatic settlement must not file away
export function pendingWorkBlock(p) {
  if (!p) { return 'missing'; }
  if (p.matched_invoice_id || p.linked_id || p.linked_type || p.transfer_group_id) { return 'The pending line is linked to an invoice, bill or transfer.'; }
  if (p.notes && String(p.notes).trim()) { return 'The pending line has notes.'; }
  if (p.customer_id || p.third_party_payer) { return 'The pending line has a customer or paid-through company set.'; }
  return null;
}

// pure: q = archived final line; rows = live candidates; real = realAccounts(accounts)
export function pickLiveCopy(q, rows, real) {
  if (!q || !q.wave_business_id) { return { status: 'none' }; }
  var key = realKeyOf(q.account_id, real);
  if (key.indexOf('real:') !== 0) { return { status: 'none', why: 'The bank account is not verified (no bank name and last four).' }; }
  var d = postedDay(q); var dk = descKey(q);
  if (!d || !dk) { return { status: 'none' }; }
  var hits = (rows || []).filter(function (k) {
    return k && k.id !== q.id && k.pending === false && k.review_status !== 'duplicate' &&
      k.connection_id !== q.connection_id && realKeyOf(k.account_id, real) === key &&
      sameMoney(q, k) && postedDay(k) === d && descKey(k) === dk && (k.channel || '') === (q.channel || '');
  });
  if (hits.length === 1) { return { status: 'found', keeper: hits[0] }; }
  if (hits.length > 1) { return { status: 'ambiguous', why: 'More than one live final line matches; a person must choose.' }; }
  return { status: 'none', why: 'No live final line was found on the other connection.' };
}

// final lines the bank linked to these pending lines that were archived as copies (same connection, account, company)
export async function archivedReplacements(db, pendRows) {
  var out = {};
  var byId = {}; (pendRows || []).forEach(function (p) { if (p && p.plaid_transaction_id) { byId[p.plaid_transaction_id] = p; } });
  var ids = Object.keys(byId);
  for (var i = 0; i < ids.length; i += 100) {
    var q = await db.from('bank_transactions').select('*').in('pending_transaction_id', ids.slice(i, i + 100)).eq('pending', false).eq('review_status', 'duplicate').limit(2000);
    if (q.error) { throw new Error('Could not read archived final lines: ' + q.error.message); }
    (q.data || []).forEach(function (r) {
      var p = byId[r.pending_transaction_id];
      if (!p || r.account_id !== p.account_id || r.connection_id !== p.connection_id || r.wave_business_id !== p.wave_business_id) { return; }
      if (!out[r.pending_transaction_id]) { out[r.pending_transaction_id] = []; }
      out[r.pending_transaction_id].push(r);
    });
  }
  return out;
}

// ctx caches the account list for one sync run
export async function findLiveCopy(db, q, ctx) {
  try {
    if (!ctx.real) {
      var aq = await db.from('plaid_accounts').select('plaid_account_id, name, mask, connection_id');
      var cq = await db.from('bank_connections').select('id, institution_name, status');
      if (aq.error || cq.error) { return { status: 'error' }; }
      var by = {}; (cq.data || []).forEach(function (c) { by[c.id] = c; });
      ctx.real = realAccounts((aq.data || []).map(function (a) { var c = by[a.connection_id] || {}; return Object.assign({}, a, { institution_name: c.institution_name, connection_status: c.status }); }));
    }
    var d = postedDay(q);
    var t = Date.parse(d + 'T00:00:00Z');
    if (!Number.isFinite(t)) { return { status: 'none' }; }
    var from = new Date(t - 7 * 86400000).toISOString().substring(0, 10);
    var to = new Date(t + 7 * 86400000).toISOString().substring(0, 10);
    var rq = await db.from('bank_transactions').select('*').eq('pending', false).eq('wave_business_id', q.wave_business_id)
      .eq('amount_abs', q.amount_abs).eq('direction', q.direction).gte('date', from).lte('date', to).limit(500);
    if (rq.error) { return { status: 'error' }; }
    return pickLiveCopy(q, rq.data || [], ctx.real);
  } catch (e) { return { status: 'error' }; }
}
