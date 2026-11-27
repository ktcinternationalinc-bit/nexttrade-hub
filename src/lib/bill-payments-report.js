// v55.83-ZZ — Bills → Payments report (Max 27 Nov: "a bills Report on payments made and dates associated to payment and wire from
// actual wire swift received. soo by date or vendor or custom dates or monthly..to provide to vendor etc.").
// Max's choices: it lives in Bills as its own Payments tab; it shows REAL Hub payments only (a voided payment only when "show voided"
// is ticked, marked voided and never counted); bills paid through NextTrade / RTM are listed in their own section.
// Pure — no database, no network: the route loads the records, this shapes them. Client-safe. var + string concatenation only.

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function day(s) { return s ? String(s).substring(0, 10) : null; }
export function monthOf(d) { return d ? String(d).substring(0, 7) : null; }
// the payment's date: the day it was paid (the bank line's date when the payment has none)
export function paymentDate(p, bank) { return day(p && p.paid_date) || day(bank && (bank.posted_date || bank.date)) || null; }
export function wireLabel(w) { return w ? 'WP-' + String(w.seq || 0).padStart(4, '0') : null; }
export function vendorKeyOf(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// i = { pays, bills, wireLines, wires, wireFiles, bankLines, floor, from, to, vendor, showVoided, isVoid(p) }
// → { rows, paid_through, by_vendor, by_month, total, count, voided_shown, period: { from, to }, floor }
export function buildPaymentsReport(i) {
  var isVoid = i.isVoid || function (p) { return !p || p.voided === true; };
  var billById = {}; (i.bills || []).forEach(function (b) { billById[b.id] = b; });
  var bankById = {}; (i.bankLines || []).forEach(function (t) { bankById[t.id] = t; });
  var wireById = {}; (i.wires || []).forEach(function (w) { wireById[w.id] = w; });
  // a payment → the wire line that carries it (only a wire that was really attached to its bank line counts as "the wire that paid it")
  var wireOfPay = {}; (i.wireLines || []).forEach(function (l) { if (l.payment_id && !l.is_open) { var w = wireById[l.package_id]; if (w) { wireOfPay[l.payment_id] = w; } } });
  var proofOf = {}; (i.wireFiles || []).forEach(function (f) { if (f.kind === 'bank_confirmation') { (proofOf[f.package_id] = proofOf[f.package_id] || []).push({ id: f.id, file_name: f.file_name || 'bank confirmation', path: f.path, uploaded_at: f.uploaded_at || null }); } });
  // the window floor (employees see only the permitted window — every number, Max): the period never starts before it
  var from = day(i.from); var to = day(i.to); var floor = day(i.floor);
  if (floor && (!from || from < floor)) { from = floor; }
  var vk = i.vendor ? vendorKeyOf(i.vendor) : '';
  var rows = [];
  (i.pays || []).forEach(function (p) {
    var b = billById[p.bill_id]; if (!b) { return; } // a payment of a bill the person may not see (payroll scope, deleted) is not shown
    if (b.record_status === 'deleted') { return; }
    var bank = p.bank_transaction_id ? (bankById[p.bank_transaction_id] || null) : null;
    var d = paymentDate(p, bank);
    if (!d) { return; } // a payment with no date cannot be placed in a period
    if (floor && d < floor) { return; } // never before the window, whatever the filter says
    if (from && d < from) { return; }
    if (to && d > to) { return; }
    if (vk && vendorKeyOf(b.vendor_name) !== vk) { return; }
    var voided = !!isVoid(p);
    if (voided && !i.showVoided) { return; }
    var w = wireOfPay[p.id] || null;
    rows.push({
      payment_id: p.id, paid_date: d, month: monthOf(d), amount: r2(p.amount), method: p.method || null, voided: voided,
      bill: { id: b.id, vendor: b.vendor_name || '', number: b.bill_number || '', date: day(b.bill_date), release: b.release_number || null, total: r2(b.total_amount), currency: b.currency || 'USD', attachment_path: b.attachment_path || null },
      bank: bank ? { id: bank.id, date: day(bank.posted_date || bank.date), amount: r2(bank.amount_abs != null ? bank.amount_abs : Math.abs(Number(bank.amount) || 0)), name: bank.name || bank.merchant_name || '', account: bank.wave_account_name || bank.account_subtype || null } : null,
      wire: w ? { id: w.id, label: wireLabel(w), status: w.status, sent_date: day(w.sent_date), bank_reference: w.bank_reference || null, payee: w.payee_name || null, proofs: proofOf[w.id] || [] } : null
    });
  });
  rows.sort(function (a, b) { return a.paid_date < b.paid_date ? -1 : a.paid_date > b.paid_date ? 1 : (a.bill.vendor < b.bill.vendor ? -1 : a.bill.vendor > b.bill.vendor ? 1 : 0); });
  // totals count only live payments (a voided one shown for reference is never money paid)
  // Codex 13:52 ZZ-03: amounts in different currencies are NEVER added together — every total is per currency
  var byCur = {}; var byVendor = {}; var byMonth = {}; var count = 0;
  rows.forEach(function (r) {
    if (r.voided) { return; }
    var cur = r.bill.currency || 'USD'; count++;
    var c = byCur[cur] || (byCur[cur] = { currency: cur, count: 0, total: 0 }); c.count++; c.total = r2(c.total + r.amount);
    var vk2 = r.bill.vendor + '\u0001' + cur; var v = byVendor[vk2] || (byVendor[vk2] = { vendor: r.bill.vendor, currency: cur, count: 0, total: 0 }); v.count++; v.total = r2(v.total + r.amount);
    var mk = r.month + '\u0001' + cur; var m = byMonth[mk] || (byMonth[mk] = { month: r.month, currency: cur, count: 0, total: 0 }); m.count++; m.total = r2(m.total + r.amount);
  });
  function curOrder(a, b) { return a === b ? 0 : a === 'USD' ? -1 : b === 'USD' ? 1 : (a < b ? -1 : 1); }
  // bills paid THROUGH NextTrade / RTM: listed on their own, with no pay date invented (the date lives in the funding record)
  var paidThrough = (i.bills || []).filter(function (b) {
    if (!b.paid_via || b.record_status !== 'active') { return false; }
    if (vk && vendorKeyOf(b.vendor_name) !== vk) { return false; }
    var bd = day(b.bill_date); if (floor && bd && bd < floor) { return false; }
    if (from && bd && bd < from) { return false; } if (to && bd && bd > to) { return false; }
    return true;
  }).map(function (b) { return { id: b.id, vendor: b.vendor_name || '', number: b.bill_number || '', date: day(b.bill_date), release: b.release_number || null, total: r2(b.total_amount), currency: b.currency || 'USD', paid_via: b.paid_via }; })
    .sort(function (a, b) { return String(a.date || '') < String(b.date || '') ? -1 : 1; });
  return {
    rows: rows, paid_through: paidThrough, count: count, voided_shown: rows.filter(function (r) { return r.voided; }).length,
    totals: Object.keys(byCur).sort(curOrder).map(function (k) { return byCur[k]; }),
    by_vendor: Object.keys(byVendor).map(function (k) { return byVendor[k]; }).sort(function (a, b) { return a.vendor < b.vendor ? -1 : a.vendor > b.vendor ? 1 : curOrder(a.currency, b.currency); }),
    by_month: Object.keys(byMonth).map(function (k) { return byMonth[k]; }).sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : curOrder(a.currency, b.currency); }),
    totals_hidden: false, period: { from: from, to: to }, floor: floor || null
  };
}
// Codex 13:52 ZZ-02: a person without "See Money Totals" gets the rows but no totals — on screen, in the CSV and on the vendor page
export function hideTotals(rep) {
  if (!rep) { return rep; }
  rep.totals_hidden = true;
  (rep.totals || []).forEach(function (t) { t.total = null; }); (rep.by_vendor || []).forEach(function (v) { v.total = null; }); (rep.by_month || []).forEach(function (m) { m.total = null; });
  (rep.paid_through || []).forEach(function (b) { b.total = null; });
  return rep;
}
// an amount with its currency: "$1,234.50" for USD, "CAD 1,234.50" for anything else; ••• when hidden
export function moneyCur(n, cur) { if (n === null || n === undefined) { return '•••'; } var v = Number(n) || 0; var s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (v < 0 ? '−' : '') + (!cur || cur === 'USD' ? '$' + s : cur + ' ' + s); }

// CSV of what is shown (one line per payment), with an "as of" line on top — to send to a vendor
function csvCell(v) { var s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function paymentsCsv(rep, asOf, title) {
  var out = [csvCell((title || 'Bill payments') + ' — as of ' + asOf + (rep.period.from || rep.period.to ? ' — period ' + (rep.period.from || '…') + ' to ' + (rep.period.to || '…') : ''))];
  out.push(['Paid date', 'Vendor', 'Bill number', 'Bill date', 'Release', 'Amount', 'Currency', 'Wire', 'Wire sent', 'Bank reference', 'Bank line date', 'Bank line amount', 'Voided'].map(csvCell).join(','));
  rep.rows.forEach(function (r) {
    out.push([r.paid_date, r.bill.vendor, r.bill.number, r.bill.date, r.bill.release, r.amount.toFixed(2), r.bill.currency, r.wire ? r.wire.label : '', r.wire ? r.wire.sent_date : '', r.wire ? r.wire.bank_reference : '', r.bank ? r.bank.date : '', r.bank ? r.bank.amount.toFixed(2) : '', r.voided ? 'VOIDED — not paid' : ''].map(csvCell).join(','));
  });
  // one total line PER CURRENCY (never summed across currencies); hidden totals say so instead of a number
  if (rep.totals_hidden) { out.push(['Totals not shown (needs "See Money Totals")', '', '', '', '', '', '', '', '', '', '', '', ''].map(csvCell).join(',')); }
  else { (rep.totals || []).forEach(function (t) { out.push(['Total paid (' + t.currency + ')', '', '', '', '', t.total == null ? '' : Number(t.total).toFixed(2), t.currency, '', '', '', '', '', ''].map(csvCell).join(',')); }); }
  return out.join('\r\n');
}
