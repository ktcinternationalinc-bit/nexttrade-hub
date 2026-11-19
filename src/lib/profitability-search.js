// v55.83-VG — the search box on the Profitability page (Max, Nov 19 2026: "need a search on this page").
// Pure. It only decides which rows are SHOWN; totals, tiles and every calculation are untouched.
// A row matches when EVERY word typed is found somewhere in: its name, its invoice number, date, customer, release numbers
// (with or without the dash), the original descriptions merged into it, and its pricing basis.
function norm(s) { return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
export function rowSearchText(r) {
  if (!r) { return ''; }
  var parts = [r.label];
  var iv = r.invoice;
  if (iv) {
    parts.push(iv.number, iv.date, iv.customer, iv.basis);
    (iv.releases || []).forEach(function (x) { parts.push(x && x.raw, x && x.key); });
  }
  (r.release_list || []).forEach(function (k) { parts.push(k); var m = String(k).match(/^(100\d)(\d+)$/); if (m) { parts.push(m[1] + '-' + m[2]); } });
  (r.name_list || []).forEach(function (n) { parts.push(n); });
  return norm(parts.filter(function (p) { return p !== null && p !== undefined && p !== ''; }).join(' · '));
}
export function rowMatchesSearch(r, query) {
  var q = norm(query); if (!q) { return true; }
  var hay = rowSearchText(r);
  return q.split(' ').every(function (w) { return hay.indexOf(w) >= 0; });
}
export function filterRowsBySearch(rows, query) {
  if (!norm(query)) { return rows || []; }
  return (rows || []).filter(function (r) { return rowMatchesSearch(r, query); });
}
