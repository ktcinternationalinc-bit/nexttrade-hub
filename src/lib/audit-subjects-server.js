// v55.83-TH — gives each audit row a plain NAME for what it was done to (a bill, a payment, a wire, a bank line, an invoice) so the
// audit reads "Recorded a payment of $2,831.00 on NexPac Corporation bill 14481" instead of an id. Server-only, fail-soft:
// a lookup that fails leaves the row as it was. SWC-safe (var + concat).
// v55.83-YC (Max 23 Nov: "needs to be in layman terms") — also names people (permission changes), product groups, invoice lines,
// both lines of a paired transfer, the line of a one-line bulk pick, and returns the category labels and Wave account names
// (auditContext) so every sentence says "Utilities", not "utilities" or an account id.
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

// rows: [{ entity, entity_id, details }] → each gets subject (string|null) and refs ({ bank, bank2, invoice, person, group })
export async function addAuditSubjects(db, rows) {
  var need = { vendor_bill: [], vendor_bill_payment: [], wire_package: [], bank_transaction: [], accounting_invoice: [], user: [], pl_product_group: [], accounting_invoice_item: [] };
  function pairIds(r) { return String(r.entity_id || '').split('+').filter(function (x) { return UUID.test(x); }); }
  rows.forEach(function (r) {
    var ent = r.entity === 'accounting_invoices' ? 'accounting_invoice' : r.entity;
    if (need[ent]) { need[ent].push(r.entity_id); }
    var d = r.details || {};
    if (d.bank_transaction_id) { need.bank_transaction.push(d.bank_transaction_id); }
    if (d.invoice_id) { need.accounting_invoice.push(d.invoice_id); }
    if (d.bill_id) { need.vendor_bill.push(d.bill_id); }
    if (r.action === 'transfer_paired' || r.action === 'transfer_unpaired') { pairIds(r).forEach(function (x) { need.bank_transaction.push(x); }); }
    if (r.action === 'bulk_categorized' && Array.isArray(d.ids) && d.ids.length === 1) { need.bank_transaction.push(d.ids[0]); }
  });
  var pays = await byIds(db, 'vendor_bill_payments', 'id, bill_id, amount, paid_date, bank_transaction_id', need.vendor_bill_payment);
  Object.keys(pays).forEach(function (k) { need.vendor_bill.push(pays[k].bill_id); if (pays[k].bank_transaction_id) { need.bank_transaction.push(pays[k].bank_transaction_id); } });
  var items = await byIds(db, 'accounting_invoice_items', 'id, invoice_id, description', need.accounting_invoice_item);
  Object.keys(items).forEach(function (k) { if (items[k].invoice_id) { need.accounting_invoice.push(items[k].invoice_id); } });
  var bills = await byIds(db, 'vendor_bills', 'id, vendor_name, bill_number, total_amount', need.vendor_bill);
  var wires = await byIds(db, 'wire_packages', 'id, seq, payee_name', need.wire_package);
  var banks = await byIds(db, 'bank_transactions', 'id, date, posted_date, amount_abs, name, merchant_name', need.bank_transaction);
  var invs = await byIds(db, 'accounting_invoices', 'id, invoice_number', need.accounting_invoice);
  var users = await byIds(db, 'users', 'id, name, email', need.user);
  var groups = await byIds(db, 'pl_product_groups', 'id, display_name', need.pl_product_group);
  rows.forEach(function (r) {
    var d = r.details || {}; var refs = {}; var ent = r.entity === 'accounting_invoices' ? 'accounting_invoice' : r.entity;
    if (ent === 'vendor_bill' && bills[r.entity_id]) { r.subject = billName(bills[r.entity_id]); }
    else if (ent === 'vendor_bill_payment' && pays[r.entity_id]) {
      var p = pays[r.entity_id]; r.subject = billName(bills[p.bill_id]);
      r.details = Object.assign({ amount: p.amount, paid_date: p.paid_date }, d); // older rows recorded no amount
      if (p.bank_transaction_id && banks[p.bank_transaction_id]) { refs.bank = bankName(banks[p.bank_transaction_id]); }
    }
    else if (ent === 'wire_package' && wires[r.entity_id]) { var w = wires[r.entity_id]; r.subject = 'WP-' + String(w.seq || 0).padStart(4, '0') + (w.payee_name ? ' to ' + w.payee_name : ''); }
    else if (ent === 'bank_transaction' && banks[r.entity_id]) { r.subject = 'bank line ' + bankName(banks[r.entity_id]); }
    else if (ent === 'accounting_invoice' && invs[r.entity_id]) { r.subject = 'invoice ' + (invs[r.entity_id].invoice_number || ''); }
    else if (ent === 'accounting_invoice_item' && items[r.entity_id]) { var it = items[r.entity_id]; r.subject = 'the line "' + String(it.description || '').substring(0, 50) + '"' + (invs[it.invoice_id] ? ' of invoice ' + (invs[it.invoice_id].invoice_number || '') : ''); }
    else if (ent === 'user' && users[r.entity_id]) { refs.person = users[r.entity_id].name || users[r.entity_id].email || null; }
    else if (ent === 'pl_product_group' && groups[r.entity_id]) { refs.group = groups[r.entity_id].display_name || null; }
    if (r.action === 'transfer_paired' || r.action === 'transfer_unpaired') {
      var pr = pairIds(r); if (pr[0] && banks[pr[0]]) { r.subject = bankName(banks[pr[0]]); } if (pr[1] && banks[pr[1]]) { refs.bank2 = bankName(banks[pr[1]]); }
    }
    if (r.action === 'bulk_categorized' && Array.isArray(d.ids) && d.ids.length === 1 && banks[d.ids[0]]) { r.subject = 'bank line ' + bankName(banks[d.ids[0]]); }
    if (d.bank_transaction_id && banks[d.bank_transaction_id]) { refs.bank = bankName(banks[d.bank_transaction_id]); }
    if (d.invoice_id && invs[d.invoice_id]) { refs.invoice = invs[d.invoice_id].invoice_number || null; }
    if (!r.subject && d.bill_id && bills[d.bill_id]) { r.subject = billName(bills[d.bill_id]); }
    r.refs = refs;
  });
  return rows;
}

// the names the sentences need: category key → label (KTC and company books), Wave account id → name. Fail-soft: missing → {}.
export async function auditContext(db, rows) {
  var ctx = { cat: {}, wave: {} };
  try { var c = await db.from('expense_categories').select('key, label'); ((c && c.data) || []).forEach(function (x) { if (x.key) { ctx.cat[x.key] = x.label || x.key; } }); } catch (e1) { /* fail-soft */ }
  try { var cc = await db.from('company_categories').select('key, label'); ((cc && cc.data) || []).forEach(function (x) { if (x.key && !ctx.cat[x.key]) { ctx.cat[x.key] = x.label || x.key; } }); } catch (e2) { /* fail-soft */ }
  var wids = {};
  (rows || []).forEach(function (r) { var d = r.details || {}; ['wave_account_id', 'before_wave_account_id'].forEach(function (k) { if (d[k]) { wids[d[k]] = true; } }); if (d.before && d.before.wave_account_id) { wids[d.before.wave_account_id] = true; } });
  var wl = Object.keys(wids).slice(0, 300);
  if (wl.length) {
    try { var wc = await db.from('wave_categories').select('wave_account_id, wave_account_name').in('wave_account_id', wl); ((wc && wc.data) || []).forEach(function (x) { if (x.wave_account_id) { ctx.wave[x.wave_account_id] = x.wave_account_name || null; } }); } catch (e3) { /* fail-soft */ }
  }
  return ctx;
}
