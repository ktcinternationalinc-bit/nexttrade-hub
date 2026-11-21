// v55.83-WY — CUSTOMER BALANCES TODAY: money held for a customer (overpaid) and money a customer still owes (underpaid).
// Max, 21 Nov 2026: "Certain invoices are overpaid or underpaid so i need a running report for each customer ... it is not in
// the pnl calculation but to make note of it". Underpaid = "invoices that don't have the full balance paid. Track it by customer".
// Codex plan feedback 21 Nov 09:15 — the rules this follows:
//   • two separate amounts per customer: "held for the customer" and "still owed by the customer"; a credit is never netted
//     against another invoice until a person applies it;
//   • every remainder counted ONCE: held = the open customer-credit rows (each made from one bank deposit when it was matched);
//     an invoice whose own figures say "paid more than its total" is listed apart as NEEDS RECONCILIATION, never added;
//   • money with no confirmed customer (an open unapplied deposit without a customer) is its own list, never put on a customer;
//   • the basis is TODAY's balance, said so everywhere; it is not this month's activity and not a past month's balance;
//   • business, currency, private bank accounts and the person's history window are respected.
// Pure: whole cents in, whole cents out. var + concat (also used by an API route).

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function live(i) { var s = i && i.record_status; return s !== 'void' && s !== 'cancelled' && s !== 'archived' && s !== 'deleted'; }
function day(x) { return String(x || '').substring(0, 10); }

// input = {
//   invoices: [{ id, invoice_number, accounting_customer_id, invoice_date, total_amount, amount_paid, balance_due, record_status, currency, business }],
//             (business = 'US' or not, decided by the caller with the shared businessOfInvoice rule)
//   credits:  [{ id, accounting_customer_id, amount, status, source_transaction_id, created_at, wave_business_id }],
//   unapplied:[{ id, accounting_customer_id, amount, status, bank_transaction_id, created_at, wave_business_id }],
//   customerNames: { id: name }, business: the company id, floor: the person's history start (YYYY-MM-DD) or null,
//   priv: privateScope() result ({ all, hidden: { account_id: true } }), accountOf: { bank_transaction_id: account_id },
//   today: 'YYYY-MM-DD' }
export function customerBalances(input) {
  var d = input || {}; var names = d.customerNames || {}; var floor = d.floor || null; var priv = d.priv || { all: true, hidden: {} };
  var today = d.today || new Date().toISOString().substring(0, 10);
  var by = {};
  function cust(id) {
    var k = id || '';
    if (!by[k]) { by[k] = { customer_id: id || null, customer: id ? (names[id] || '(customer without a name)') : '(no customer on the invoice)', held_cents: 0, held: [], owed_cents: 0, owed_partly_cents: 0, owed_unpaid_cents: 0, owed: [], recon: [], other_currency: {} }; }
    return by[k];
  }
  function hiddenBank(txId) { if (!txId || priv.all) { return false; } var acc = (d.accountOf || {})[txId]; return !!(acc && priv.hidden && priv.hidden[acc]); }
  function inWindow(dt) { return !floor || !dt || day(dt) >= floor; }
  var skipped = { private_bank: 0, outside_window: 0, other_business: 0 };

  (d.invoices || []).forEach(function (i) {
    if (!live(i)) { return; }
    if (i.business && i.business !== 'US') { skipped.other_business++; return; }
    if (!inWindow(i.invoice_date)) { skipped.outside_window++; return; }
    var tot = cents(i.total_amount); var paid = cents(i.amount_paid);
    var bal = (i.balance_due === null || i.balance_due === undefined) ? tot - paid : cents(i.balance_due);
    var cur = String(i.currency || 'USD').toUpperCase();
    var c = cust(i.accounting_customer_id);
    var row = { invoice_id: i.id, number: i.invoice_number || '', date: day(i.invoice_date), currency: cur, total_cents: tot, paid_cents: paid, balance_cents: bal };
    if (bal < 0 || paid > tot) { row.over_cents = Math.max(-bal, paid - tot); c.recon.push(row); return; } // listed, never added
    if (bal <= 0) { return; }
    if (cur !== 'USD') { c.other_currency[cur] = (c.other_currency[cur] || 0) + bal; return; } // never summed into dollars
    row.partly = paid > 0;
    row.age_days = row.date ? Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(row.date + 'T00:00:00Z')) / 86400000)) : null;
    c.owed.push(row); c.owed_cents += bal;
    if (row.partly) { c.owed_partly_cents += bal; } else { c.owed_unpaid_cents += bal; }
  });

  var unidentified = []; var unidentifiedCents = 0;
  function held(r, txId, kind) {
    if (String(r.status || '') !== 'open') { return; }
    if (d.business && r.wave_business_id && r.wave_business_id !== d.business) { skipped.other_business++; return; }
    if (hiddenBank(txId)) { skipped.private_bank++; return; }
    if (!inWindow(r.created_at)) { skipped.outside_window++; return; }
    var v = cents(r.amount); if (!(v > 0)) { return; }
    var item = { id: r.id, kind: kind, cents: v, bank_transaction_id: txId || null, date: day(r.created_at) };
    if (!r.accounting_customer_id) { unidentified.push(item); unidentifiedCents += v; return; }
    var c = cust(r.accounting_customer_id); c.held.push(item); c.held_cents += v;
  }
  (d.credits || []).forEach(function (r) { held(r, r.source_transaction_id, 'credit'); });
  (d.unapplied || []).forEach(function (r) { held(r, r.bank_transaction_id, 'unapplied'); });

  var list = Object.keys(by).map(function (k) { return by[k]; }).filter(function (c) { return c.held_cents || c.owed_cents || c.recon.length || Object.keys(c.other_currency).length; });
  list.forEach(function (c) { c.owed.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }); });
  list.sort(function (a, b) { return (b.held_cents + b.owed_cents) - (a.held_cents + a.owed_cents) || String(a.customer).localeCompare(String(b.customer)); });
  var tot = { held_cents: 0, owed_cents: 0, owed_partly_cents: 0, owed_unpaid_cents: 0, recon_count: 0 };
  list.forEach(function (c) { tot.held_cents += c.held_cents; tot.owed_cents += c.owed_cents; tot.owed_partly_cents += c.owed_partly_cents; tot.owed_unpaid_cents += c.owed_unpaid_cents; tot.recon_count += c.recon.length; });
  tot.unidentified_cents = unidentifiedCents;
  return { basis: 'today', as_of: today, customers: list, unidentified: unidentified, totals: tot, skipped: skipped };
}

// the row of one customer by NAME (P&L by customer is grouped by the customer's name), or null
export function balanceOfCustomer(bal, name) {
  var hit = null; ((bal && bal.customers) || []).forEach(function (c) { if (c.customer === name) { hit = c; } });
  return hit;
}
