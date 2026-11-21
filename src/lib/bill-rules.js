// v55.83-WX — bill category rules (Max, 21 Nov 2026: "i need to be able to create rules for bills as well to place categories. even
// using a certain amount ... to always be partner fees ... and this will be used in the pnl breakdowns").
// Pure: which rule fits a bill, and what applying a rule to the bills already on file would do. Used by the bills route (new bills,
// imports), repeating bills, the Bill rules screen and its preview / apply. Bank rules (us_expense_rules) are NOT touched.
//
// Codex plan review (21 Nov): rules are scoped to ONE company's books and ONE currency; every condition on a rule must match; the
// amount is the BILL TOTAL in whole cents; specificity first, then priority; a tie with different categories is left for a person
// (no category, flagged) and never falls through to the vendor memory; a category picked by a person, or one whose origin is unknown,
// is never overwritten; a bill already counted inside goods or transport profit is never moved into a deducted P&L column by a rule.
import { letterOf } from './pnl-expenses';

export function cents(x) { var n = Number(x); return isFinite(n) ? Math.round(n * 100) : null; }

// vendor names compared the forgiving way: case, punctuation and company endings (Inc, Corp, LLC...) ignored
var ENDINGS = ['INCORPORATED', 'CORPORATION', 'COMPANY', 'LIMITED', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LLP', 'LP', 'THE'];
export function vendorKey(s) {
  var v = ' ' + String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  ENDINGS.forEach(function (w) { v = v.split(' ' + w + ' ').join(' '); });
  return v.replace(/\s+/g, '');
}
function textOf(bill, lines) {
  var parts = [bill && bill.bill_number, bill && bill.notes, bill && bill.other_reference];
  (lines || []).forEach(function (l) { parts.push(l && l.description); });
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function currencyOf(x) { return String((x && x.currency) || 'USD').toUpperCase(); }

// Does this rule fit this bill? Every condition must match. Returns { ok, why } (why = the first condition that did not match).
export function ruleFits(rule, bill, lines) {
  var r = rule || {}; var b = bill || {};
  if (r.active === false) { return { ok: false, why: 'switched off' }; }
  if (!r.wave_business_id || String(r.wave_business_id) !== String(b.wave_business_id || '')) { return { ok: false, why: 'another company' }; }
  if (currencyOf(r) !== currencyOf(b)) { return { ok: false, why: 'another currency' }; }
  var rv = vendorKey(r.vendor_match); var bv = vendorKey(b.vendor_name);
  if (!rv || !bv || bv.indexOf(rv) < 0) { return { ok: false, why: 'another vendor' }; }
  var t = cents(b.total_amount);
  if (r.amount_exact !== null && r.amount_exact !== undefined && r.amount_exact !== '') { if (t !== cents(r.amount_exact)) { return { ok: false, why: 'another amount' }; } }
  var lo = (r.amount_min === null || r.amount_min === undefined || r.amount_min === '') ? null : cents(r.amount_min);
  var hi = (r.amount_max === null || r.amount_max === undefined || r.amount_max === '') ? null : cents(r.amount_max);
  if (lo !== null && !(t !== null && t >= lo)) { return { ok: false, why: 'below the range' }; }
  if (hi !== null && !(t !== null && t <= hi)) { return { ok: false, why: 'above the range' }; }
  var w = String(r.words || '').trim().toLowerCase();
  if (w && textOf(b, lines).indexOf(w) < 0) { return { ok: false, why: 'the words are not on the bill' }; }
  return { ok: true, why: null };
}

// Specificity: exact amount 4, a range 2, words +1. The vendor is always required.
export function specificity(rule) {
  var r = rule || {}; var s = 0;
  if (r.amount_exact !== null && r.amount_exact !== undefined && r.amount_exact !== '') { s += 4; }
  else if ((r.amount_min !== null && r.amount_min !== undefined && r.amount_min !== '') || (r.amount_max !== null && r.amount_max !== undefined && r.amount_max !== '')) { s += 2; }
  if (String(r.words || '').trim()) { s += 1; }
  return s;
}

// The rule for one bill: the most specific fitting rule; among equally specific ones the higher priority. When the best ones still
// disagree on the category → { rule: null, conflict: [those rules] } — no category, a person decides.
export function billRuleFor(bill, rules, lines) {
  var fits = (rules || []).filter(function (r) { return ruleFits(r, bill, lines).ok; });
  if (!fits.length) { return { rule: null, conflict: null }; }
  fits.sort(function (a, b) { return (specificity(b) - specificity(a)) || ((Number(b.priority) || 0) - (Number(a.priority) || 0)) || String(a.id).localeCompare(String(b.id)); });
  var top = fits[0];
  var tied = fits.filter(function (r) { return specificity(r) === specificity(top) && (Number(r.priority) || 0) === (Number(top.priority) || 0); });
  var cats = {}; tied.forEach(function (r) { cats[r.category] = true; });
  if (Object.keys(cats).length > 1) { return { rule: null, conflict: tied }; }
  return { rule: top, conflict: null };
}

// Is this bill already counted inside goods or transport profit? Then a rule must not move it into a deducted column (A / C / D / E),
// or the same money would be taken off twice. linkedNameKeys = supplier descriptions linked to a product (P&L set-up), as
// { key: true }; nameKeyFn turns a line description into that key (profitability.js nameKey).
export function countedInProfit(bill, lines, linkedNameKeys, nameKeyFn) {
  var b = bill || {}; var type = String(b.bill_type || '');
  if (type === 'bonded_brokerage') { return 'a bonded / brokerage bill is counted in the shipment costs'; }
  if ((type === 'trucking' || type === 'shipping') && String(b.release_number || '').trim()) { return 'a ' + type + ' bill with a release # is counted in transport profit'; }
  var keys = linkedNameKeys || {}; var nk = typeof nameKeyFn === 'function' ? nameKeyFn : null;
  if (nk && type !== 'trucking' && type !== 'shipping' && (lines || []).some(function (l) { return l && l.line_kind === 'item' && keys[nk(l.description)]; })) { return 'a line of this bill is a product cost in goods profit'; }
  return null;
}

// Would this category be TAKEN OFF the profit (an expense column)? cat = the expense_categories row ({ key, label, kind }).
export function isDeducted(cat) { var l = letterOf(cat || {}); return l === 'A' || l === 'C' || l === 'D' || l === 'E'; }

// The category for a NEW bill: { category, source, rule, conflict, blocked }. source: 'rule' | 'rule_conflict' | null (no rule fits —
// the caller may then use the vendor memory). A rule that would put a bill counted in profit into a deducted column is not used
// (blocked = why) and gives no category: the caller must not fall through to the vendor memory either.
export function categoryForNew(bill, rules, catByKey, lines, linkedNameKeys, nameKeyFn) {
  var m = billRuleFor(bill, rules, lines);
  if (m.conflict) { return { category: null, source: 'rule_conflict', rule: null, conflict: m.conflict, blocked: null }; }
  if (!m.rule) { return { category: null, source: null, rule: null, conflict: null, blocked: null }; }
  var why = countedInProfit(bill, lines, linkedNameKeys, nameKeyFn);
  if (why && isDeducted((catByKey || {})[m.rule.category] || { key: m.rule.category })) { return { category: null, source: 'rule_conflict', rule: m.rule, conflict: null, blocked: why }; }
  return { category: m.rule.category, source: 'rule', rule: m.rule, conflict: null, blocked: null };
}

// What applying ONE rule to the bills on file would do, bill by bill. ctx = { rules (all active), catByKey, linesOf (bill id → lines),
// linkedNameKeys, nameKeyFn, paidOf (bill id → money paid) }. status:
//   'will_set'          the rule's category will be written (blank category, or one set by a rule)
//   'already'           already this category from this rule version
//   'protected_manual'  a person picked the category — never changed
//   'protected_unknown' a category whose origin is unknown (entered before rules existed) — never changed
//   'other_rule_wins'   another rule fits this bill better
//   'conflict'          equally good rules disagree — left for a person
//   'counted_in_profit' the bill is already in goods / transport profit; this rule's category would be deducted again
// Only active bills of the rule's company and currency are looked at (ruleFits). paid = money already recorded on the bill: the change
// then moves an earlier period's P&L (the screen says so).
export function previewRule(rule, bills, ctx) {
  var c = ctx || {}; var out = [];
  (bills || []).forEach(function (b) {
    if (!b || b.record_status !== 'active') { return; }
    var lines = (c.linesOf || {})[b.id] || [];
    if (!ruleFits(rule, b, lines).ok) { return; }
    var row = { id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date, total_amount: b.total_amount,
      currency: currencyOf(b), category: b.category || null, category_source: b.category_source || null, paid: Number((c.paidOf || {})[b.id]) || 0, paid_via: b.paid_via || null, status: null, why: null };
    var best = billRuleFor(b, c.rules || [rule], lines);
    var src = b.category_source || null; var hasCat = !!String(b.category || '').trim();
    if (src === 'manual') { row.status = 'protected_manual'; row.why = 'a person picked this category'; }
    else if (hasCat && !src) { row.status = 'protected_unknown'; row.why = 'this category was set before rules existed — change it on the bill if it is wrong'; }
    else if (best.conflict) { row.status = 'conflict'; row.why = 'rules of equal weight disagree: ' + best.conflict.map(function (r) { return r.name || r.category; }).join(' / '); }
    else if (best.rule && String(best.rule.id) !== String(rule.id)) { row.status = 'other_rule_wins'; row.why = 'the rule "' + (best.rule.name || best.rule.category) + '" fits this bill better'; }
    else {
      var why = countedInProfit(b, lines, c.linkedNameKeys, c.nameKeyFn);
      if (why && isDeducted((c.catByKey || {})[rule.category] || { key: rule.category })) { row.status = 'counted_in_profit'; row.why = why + ' — it would be taken off twice'; }
      else if (b.category === rule.category && src === 'rule' && String(b.category_rule_id || '') === String(rule.id) && Number(b.category_rule_version || 0) === Number(rule.version || 1)) { row.status = 'already'; }
      else { row.status = 'will_set'; }
    }
    out.push(row);
  });
  return out;
}

// A rule typed on the screen, checked. Returns { ok, rule, errors }. cats = the category keys that exist.
export function cleanRule(input, catKeys) {
  var x = input || {}; var errs = [];
  var r = { name: String(x.name || '').trim().substring(0, 120), vendor_match: String(x.vendor_match || '').trim().substring(0, 120),
    words: String(x.words || '').trim().substring(0, 120) || null, category: String(x.category || '').trim(),
    currency: String(x.currency || 'USD').trim().toUpperCase().substring(0, 3), priority: parseInt(x.priority, 10) || 0, active: x.active !== false };
  function money(v) { if (v === null || v === undefined || String(v).trim() === '') { return null; } var n = Number(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; }
  r.amount_exact = money(x.amount_exact); r.amount_min = money(x.amount_min); r.amount_max = money(x.amount_max);
  if (!r.vendor_match || !vendorKey(r.vendor_match)) { errs.push('Type the vendor (e.g. part of its name).'); }
  if (!r.category) { errs.push('Pick the category.'); } else if (catKeys && catKeys.indexOf(r.category) < 0) { errs.push('Unknown category.'); }
  if (!/^[A-Z]{3}$/.test(r.currency)) { errs.push('The currency is 3 letters (e.g. USD).'); }
  [['amount_exact', 'The amount'], ['amount_min', 'The lowest amount'], ['amount_max', 'The highest amount']].forEach(function (p) { if (r[p[0]] !== null && !(r[p[0]] > 0)) { errs.push(p[1] + ' must be a number above zero.'); } });
  if (r.amount_exact !== null && (r.amount_min !== null || r.amount_max !== null)) { errs.push('Use either an exact amount or a range, not both.'); }
  if (r.amount_min !== null && r.amount_max !== null && r.amount_min > r.amount_max) { errs.push('The lowest amount is above the highest.'); }
  if (!r.name) { r.name = r.vendor_match + (r.amount_exact !== null ? ' ' + r.amount_exact.toFixed(2) : '') + (r.words ? ' "' + r.words + '"' : ''); }
  return { ok: errs.length === 0, rule: r, errors: errs };
}
