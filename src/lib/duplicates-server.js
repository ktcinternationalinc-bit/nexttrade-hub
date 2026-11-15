// v55.83-SO — server helpers for the duplicate check. Var + concat only.
// Every query is on its own try/catch: one missing table never breaks the check.

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
