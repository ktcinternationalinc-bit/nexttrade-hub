// v55.83-SO — server helpers for the duplicate check. Var + concat only.
// Every query is on its own try/catch: one missing table never breaks the check.

import { findDuplicates, realAccounts, twinAutoPicks } from './duplicate-detect'; // v55.83-SU
import { audit } from './audit-server';
export var DUP_COLS = 'id, wave_business_id, bank_source, account_id, posted_date, date, direction, amount, amount_abs, iso_currency, name, merchant_name, check_number, pending, review_status, matched_invoice_id, linked_id, transfer_group_id, classification, category_verified, plaid_transaction_id, created_at';

// → [{ plaid_account_id, name, mask, connection_id, institution_name, connection_status }]
export async function loadBankAccounts(db) {
  var out = [];
  try {
    var pa = await db.from('plaid_accounts').select('plaid_account_id, name, mask, connection_id');
    var conns = {};
    try {
      var bc = await db.from('bank_connections').select('id, institution_name, status');
      ((bc && bc.data) || []).forEach(function (c) { conns[c.id] = c; });
    } catch (e1) { /* names only */ }
    ((pa && pa.data) || []).forEach(function (a) {
      var c = conns[a.connection_id] || {};
      out.push({ plaid_account_id: a.plaid_account_id, name: a.name, mask: a.mask, connection_id: a.connection_id, institution_name: c.institution_name || '', connection_status: c.status || '' });
    });
  } catch (e) { /* no accounts → each account id stands alone */ }
  return out;
}

export async function loadBankRows(db, since, max) {
  var rows = []; var from = 0; var page = 1000; var cap = max || 20000;
  while (rows.length < cap) {
    var q = db.from('bank_transactions').select(DUP_COLS).order('date', { ascending: false }).order('id', { ascending: true }).range(from, from + page - 1);
    if (since) { q = q.gte('date', since); }
    var r = await q;
    if (r.error) { throw new Error(r.error.message); }
    var got = r.data || [];
    rows = rows.concat(got);
    if (got.length < page) { break; }
    from += page;
  }
  return rows;
}

// Transactions that carry accounting work can be KEPT but never removed.
// → { [id]: 'what protects it' }
export async function protectedReasons(db, rows) {
  var out = {}; var ids = [];
  (rows || []).forEach(function (t) {
    if (!t || !t.id) { return; }
    ids.push(t.id);
    if (t.matched_invoice_id) { out[t.id] = 'matched to an invoice'; }
    else if (t.transfer_group_id) { out[t.id] = 'linked as a transfer'; }
    else if (t.linked_id) { out[t.id] = 'linked to another record'; }
  });
  if (!ids.length) { return out; }
  async function look(table, col, label, liveFn) {
    try {
      for (var i = 0; i < ids.length; i += 200) {
        var r = await db.from(table).select('*').in(col, ids.slice(i, i + 200));
        if (r.error) { return; }
        (r.data || []).forEach(function (x) { if (x && x[col] && (!liveFn || liveFn(x)) && !out[x[col]]) { out[x[col]] = label; } });
      }
    } catch (e) { /* table not there */ }
  }
  await look('payment_matches', 'bank_transaction_id', 'has a payment match', function (x) { return x.voided !== true; });
  await look('accounting_invoice_payments', 'bank_transaction_id', 'an invoice payment was recorded from it', function (x) { return x.voided !== true; });
  await look('bank_transaction_splits', 'bank_transaction_id', 'split into lines', null);
  await look('unapplied_deposits', 'bank_transaction_id', 'held as unapplied money', function (x) { return !x.status || x.status === 'open'; });
  await look('customer_credits', 'source_transaction_id', 'a customer credit came from it', function (x) { return !x.status || x.status === 'open'; });
  await look('vendor_bill_payments', 'bank_transaction_id', 'a bill was paid from it', function (x) { return x.voided !== true; });
  await look('wire_packages', 'bank_transaction_id', 'a wire is attached to it', function (x) { return x.status !== 'cancelled'; });
  return out;
}

export async function loadDismissed(db) {
  var out = {};
  try {
    var r = await db.from('bank_duplicate_dismissals').select('pair_key').limit(5000);
    ((r && r.data) || []).forEach(function (d) { out[d.pair_key] = true; });
  } catch (e) { /* SQL not run yet → nothing dismissed */ }
  return out;
}

// v55.83-SU — the duplicate check, run by itself after a bank sync or a statement upload.
// Clears only what twinAutoPicks allows (the same line through a second connection of the same account); everything else
// is counted and left for a person in "Check for duplicates". Never throws; never blocks the sync.
// → { ran, removed, to_review, needs_sql, errors }
export async function autoTwinCheck(db, opts) {
  var o = opts || {}; var res = { ran: false, removed: 0, to_review: 0, needs_sql: false, errors: 0 };
  try {
    var days = o.days || 45;
    var since = new Date(Date.now() - days * 86400000).toISOString().substring(0, 10);
    var rows = await loadBankRows(db, since, 20000);
    var real = realAccounts(await loadBankAccounts(db));
    var dismissed = await loadDismissed(db);
    var first = findDuplicates(rows, { real: real, dismissed: dismissed });
    var byId = {}; rows.forEach(function (t) { byId[t.id] = t; });
    var ids = []; first.groups.forEach(function (g) { g.rows.forEach(function (x) { ids.push(x.id); }); });
    var prot = await protectedReasons(db, ids.map(function (id) { return byId[id]; }));
    var found = findDuplicates(rows, { real: real, dismissed: dismissed, protectedIds: prot });
    var picks = twinAutoPicks(found.groups, byId);
    res.ran = true; res.to_review = found.groups.length;
    var started = Date.now(); var budget = o.budgetMs || 6000;
    for (var i = 0; i < picks.length; i++) {
      if (Date.now() - started > budget) { break; }
      var p = picks[i];
      var r = await db.rpc('bank_duplicate_remove', { p_dup: p.remove_id, p_keep: p.keep_id, p_actor: o.actorId || null, p_reason: 'Automatic check after a bank sync: the same bank line arrived through a second connection of the same account.' });
      if (r.error) { if (/bank_duplicate_|bank_transaction_duplicates|schema cache|does not exist/i.test(String(r.error.message || ''))) { res.needs_sql = true; break; } res.errors++; continue; }
      if (r.data && r.data.ok === true) {
        res.removed++; res.to_review--;
        try { await audit(db, o.actorId || null, 'bank_duplicate_auto_removed', 'bank_transaction', p.remove_id, { kept: p.keep_id, amount: p.amount, date: p.date, by: 'automatic check after sync', can_restore: true }); } catch (eA) { /* the removal record itself is kept by the database */ }
      } else { res.errors++; }
    }
  } catch (e) { res.errors++; }
  return res;
}
