// v55.83-TH — gives each audit row a plain NAME for what it was done to (a bill, a payment, a wire, a bank line, an invoice) so the
// audit reads "Recorded a payment of $2,831.00 on NexPac Corporation bill 14481" instead of an id. Server-only, fail-soft:
// a lookup that fails leaves the row as it was. SWC-safe (var + concat).
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nd(d) { var x = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return x ? MON[Number(x[2]) - 1] + ' ' + Number(x[3]) + ', ' + x[1] : ''; }
function money(v) { var n = Number(v) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function billName(b) { return b ? ((b.vendor_name || 'Unknown vendor') + ' bill ' + (b.bill_number || '(no number)')) : null; }
export function bankName(t) { return t ? (nd(t.posted_date || t.date) + ' · ' + money(t.amount_abs) + ' · ' + String(t.merchant_name || t.name || '').substring(0, 40)).replace(/ · $/, '') : null; }

async function byIds(db, table, cols, ids) {
  var out = {}; var list = ids.filter(function (x, i, a) { return x && UUID.test(String(x)) && a.indexOf(x) === i; });
  for (var i = 0; i < list.length; i += 200) {
    try { var r = await db.from(table).select(cols).in('id', list.slice(i, i + 200)); ((r && r.data) || []).forEach(function (x) { out[x.id] = x; }); } catch (e) { /* fail-soft */ }
  }
  return out;
}

// rows: [{ entity, entity_id, details }] → each gets subject (string|null) and refs ({ bank, invoice })
export async function addAuditSubjects(db, rows) {
  var need = { vendor_bill: [], vendor_bill_payment: [], wire_package: [], bank_transaction: [], accounting_invoice: [] };
  rows.forEach(function (r) {
    if (need[r.entity]) { need[r.entity].push(r.entity_id); }
    var d = r.details || {};
    if (d.bank_transaction_id) { need.bank_transaction.push(d.bank_transaction_id); }
    if (d.invoice_id) { need.accounting_invoice.push(d.invoice_id); }
    if (d.bill_id) { need.vendor_bill.push(d.bill_id); }
  });
  var pays = await byIds(db, 'vendor_bill_payments', 'id, bill_id, amount, paid_date, bank_transaction_id', need.vendor_bill_payment);
  Object.keys(pays).forEach(function (k) { need.vendor_bill.push(pays[k].bill_id); if (pays[k].bank_transaction_id) { need.bank_transaction.push(pays[k].bank_transaction_id); } });
  var bills = await byIds(db, 'vendor_bills', 'id, vendor_name, bill_number, total_amount', need.vendor_bill);
  var wires = await byIds(db, 'wire_packages', 'id, seq, payee_name', need.wire_package);
  var banks = await byIds(db, 'bank_transactions', 'id, date, posted_date, amount_abs, name, merchant_name', need.bank_transaction);
  var invs = await byIds(db, 'accounting_invoices', 'id, invoice_number', need.accounting_invoice);
  rows.forEach(function (r) {
    var d = r.details || {}; var refs = {};
    if (r.entity === 'vendor_bill' && bills[r.entity_id]) { r.subject = billName(bills[r.entity_id]); }
    else if (r.entity === 'vendor_bill_payment' && pays[r.entity_id]) {
      var p = pays[r.entity_id]; r.subject = billName(bills[p.bill_id]);
      r.details = Object.assign({ amount: p.amount, paid_date: p.paid_date }, d); // older rows recorded no amount
      if (p.bank_transaction_id && banks[p.bank_transaction_id]) { refs.bank = bankName(banks[p.bank_transaction_id]); }
    }
    else if (r.entity === 'wire_package' && wires[r.entity_id]) { var w = wires[r.entity_id]; r.subject = 'WP-' + String(w.seq || 0).padStart(4, '0') + (w.payee_name ? ' to ' + w.payee_name : ''); }
    else if (r.entity === 'bank_transaction' && banks[r.entity_id]) { r.subject = 'bank line ' + bankName(banks[r.entity_id]); }
    else if (r.entity === 'accounting_invoice' && invs[r.entity_id]) { r.subject = 'invoice ' + (invs[r.entity_id].invoice_number || ''); }
    if (d.bank_transaction_id && banks[d.bank_transaction_id]) { refs.bank = bankName(banks[d.bank_transaction_id]); }
    if (d.invoice_id && invs[d.invoice_id]) { refs.invoice = invs[d.invoice_id].invoice_number || null; }
    if (!r.subject && d.bill_id && bills[d.bill_id]) { r.subject = billName(bills[d.bill_id]); }
    r.refs = refs;
  });
  return rows;
}
