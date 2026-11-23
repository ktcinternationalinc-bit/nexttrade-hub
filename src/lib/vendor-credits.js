// v55.83-YD — vendor credit memos (Max, 23 Nov 2026: "credit memo for bills"). Pure helpers, safe on server and browser. SWC-safe.
// A credit memo is money KTC no longer owes a vendor. It is used by APPLYING it to that vendor's bills (lowers what a bill owes — not a
// payment, no money moved) or by the vendor REFUNDING it as money (a money-in bank line). The database (sql/v55-83-YD-vendor-credits.sql)
// is the authority; these helpers only show the same arithmetic.
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// { billId: credited amount } from the applications (only live, bill-kind ones)
export function creditsByBill(apps) {
  var o = {};
  (apps || []).forEach(function (a) { if (a && a.voided !== true && (a.kind || 'bill') === 'bill' && a.bill_id) { o[a.bill_id] = r2((o[a.bill_id] || 0) + r2(a.amount)); } });
  return o;
}
// what is left of a credit memo: total − applied to bills − refunded as money (live applications only)
export function creditLeft(credit, apps) {
  var used = 0; var applied = 0; var refunded = 0;
  (apps || []).forEach(function (a) { if (a && a.voided !== true && a.credit_id === credit.id) { var v = r2(a.amount); used = r2(used + v); if (a.kind === 'refund') { refunded = r2(refunded + v); } else { applied = r2(applied + v); } } });
  return { total: r2(credit.total_amount), applied: applied, refunded: refunded, left: r2(r2(credit.total_amount) - used) };
}
// what a bill still owes: total − live payments − credits applied (− what open wires hold, when asked)
export function billOwed(bill, paid, credited, onWires) {
  return r2(r2(bill && bill.total_amount) - r2(paid) - r2(credited) - r2(onWires));
}
// the same vendor, as the database decides it (WZ: case, punctuation, Inc / LLC / Corp / Co / The ignored)
export function vendorKeyOf(name) {
  var v = ' ' + String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  ['INCORPORATED', 'CORPORATION', 'COMPANY', 'LIMITED', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LLP', 'LP', 'THE'].forEach(function (w) { v = v.split(' ' + w + ' ').join(' '); });
  return v.replace(/\s+/g, '');
}
// suggested split of a credit over the chosen bills, oldest first: never more than the credit left or what each bill owes
export function suggestApplication(left, bills) {
  var rest = r2(left); var out = [];
  (bills || []).slice().sort(function (a, b) { return String(a.bill_date || '') < String(b.bill_date || '') ? -1 : String(a.bill_date || '') > String(b.bill_date || '') ? 1 : String(a.id) < String(b.id) ? -1 : 1; })
    .forEach(function (b) { var take = r2(Math.min(rest, Math.max(0, r2(b.owed)))); if (take > 0.004) { out.push({ bill_id: b.id, amount: take }); rest = r2(rest - take); } });
  return out;
}
