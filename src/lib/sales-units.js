// v55.83-WL — Sales Report: goods kept in yards stay in yards here too (Max, Nov 20 2026: "everything dealing with PVC leather ...
// even yards convert to pounds. But when it deals with other stuff like headliner and other fabrics ... in yards, how do we
// implement the yardage in this and dealing with our P&L reports and all that stuff").
// The SAME rule as Profitability: a line is kept in yards when its description is marked "keep in yards" or says headliner, and
// it is sold in yards / linear metres. Such a line is counted in YARDS (1 linear metre = 1.09361 yd) and never in the Pounds
// total; every other line is converted to pounds exactly as before. Pure. var + concat (used by an API route).
import { toPounds, unitKey, weightFactorsFor, isHeadlinerLine, yardsPerSoldUnit } from './profitability';

// it = { wave_product_name, description }, unit = the line's unit, keep = { marked: bool (the description's own switch), ready: bool
// (the keep-in-yards columns exist) }, factors = the pounds table. Returns { kept, lb (pounds or null), yd (yards or null), known }.
export function lineQuantity(it, qty, unit, keep, factors) {
  var k = unitKey(unit); var byLength = k === 'yd' || k === 'lm';
  var kept = !!(keep && keep.ready === true) && byLength && (keep.marked === true || isHeadlinerLine(it.wave_product_name, it.description));
  if (kept) { var yd = (Number(qty) || 0) * (yardsPerSoldUnit(k) || 1); return { kept: true, lb: null, yd: yd, known: true }; }
  var lb = toPounds(qty, unit, null, weightFactorsFor(it.wave_product_name, it.description, factors)); // headliner 1.25 lb per yard, then foam 3, else standard
  return { kept: false, lb: lb, yd: null, known: lb !== null };
}

// One aggregate (a product, a description, a customer × product, an invoice): pounds and yards apart, with the revenue behind each.
export function blankQty() { return { pounds: 0, yards: 0, rev_lb: 0, rev_yd: 0, lb_missing: false }; }
export function addQuantity(agg, q, amount) {
  var a = Number(amount) || 0;
  if (q.kept) { agg.yards += q.yd; agg.rev_yd += a; }
  else if (q.lb === null) { agg.lb_missing = true; }
  else { agg.pounds += q.lb; agg.rev_lb += a; }
  return agg;
}
// The figures a row shows: whole pounds, whole yards, $ per pound over its pound lines, $ per yard over its yard lines. A per-pound
// average needs every pound line to have its unit (pounds are never guessed); the two averages are never blended.
export function finishQuantity(agg) {
  var lb = Math.round(agg.pounds); var yd = Math.round(agg.yards);
  return { pounds: lb, yards: yd, pounds_incomplete: agg.lb_missing === true,
    avg_price_per_lb: agg.pounds > 0 && !agg.lb_missing ? Math.round(agg.rev_lb / agg.pounds * 10000) / 10000 : null,
    avg_price_per_yd: agg.yards > 0 ? Math.round(agg.rev_yd / agg.yards * 10000) / 10000 : null };
}

// Words for the screen (pure, so they are tested without a browser).
function n0(v) { return Number(v || 0).toLocaleString('en-US'); }
function d4(v) { return '$' + Number(v).toFixed(4); }
// one row in words: "1,000 lb · avg $1.0000 / lb · 500 yd · avg $2.0000 / yd" (the yard part only when the row has yard goods)
export function qtyAvgText(r) {
  var row = r || {}; var yd = Number(row.yards) > 0; var out = [];
  if (Number(row.pounds) > 0 || !yd) { out.push(n0(row.pounds) + ' lb · avg ' + (row.avg_price_per_lb != null ? d4(row.avg_price_per_lb) + ' / lb' : '—')); }
  if (yd) { out.push(n0(row.yards) + ' yd · avg ' + (row.avg_price_per_yd != null ? d4(row.avg_price_per_yd) + ' / yd' : '—')); }
  return out.join(' · ');
}
// the top tile: { big, small, yards } from the report totals. The per-pound average divides the revenue of the POUND goods only.
export function totalsText(tt) {
  var t = tt || {}; var yd = Number(t.yards) > 0; var lbRev = t.pounds_revenue != null ? Number(t.pounds_revenue) : Number(t.product_revenue) || 0;
  var small = t.lines_without_unit ? t.lines_without_unit + ' line(s) have no unit set — no average per lb' : (Number(t.pounds) > 0 ? 'avg $' + (lbRev / t.pounds).toFixed(4) + ' / lb' : '');
  return { big: n0(t.pounds) + ' lb', small: small,
    yards: yd ? n0(t.yards) + ' yd kept in yards · avg $' + ((Number(t.yards_revenue) || 0) / t.yards).toFixed(4) + ' / yd' : '' };
}
