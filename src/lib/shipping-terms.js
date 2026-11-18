// v55.83-TG — SHIPPING TERMS ON THE INVOICE (Max, Nov 16 2026):
//   "always have a value and only one value. Final confirmed value is based on bill. Give user ability to enter clearly
//    if exw or cnf and shipping cost — EXW (no shipping handled by us) · CNF (shipping handled by us and included in the
//    price) · CNF (shipping handled by us and we charge a separate line item in the invoice for it, outside of the price)"
//
// Pure rules, no database. ONE value per invoice, stored in pl_invoice_terms (the same row the profit report reads), so
// the invoice form and Profitability can never disagree. The shipping cost typed on the invoice is an ESTIMATE; the
// Hub's outbound bills (forwarder + trucker) on the release are the FINAL figure and replace it automatically.

export var SHIPPING_TERMS = ['EXW', 'CNF_INCLUDED', 'CNF_SEPARATE'];
export var SHIPPING_TERMS_WORDS = {
  EXW: 'EXW — no shipping handled by us',
  CNF_INCLUDED: 'CNF — shipping by us, included in the price',
  CNF_SEPARATE: 'CNF — shipping by us, charged on a separate invoice line'
};
export var SHIPPING_TERMS_SHORT = { EXW: 'EXW', CNF_INCLUDED: 'CNF (in price)', CNF_SEPARATE: 'CNF (separate line)' };

// the pricing basis the profit report uses for each choice
export function basisOfTerms(t) { return t === 'EXW' ? 'EXW' : (t === 'CNF_INCLUDED' || t === 'CNF_SEPARATE' ? 'CNF' : null); }

// a basis set in Profitability → the invoice's terms (keeps the ONE value in step). TRUCKING_INCLUDED has no invoice-form
// equivalent, so the terms are cleared and the invoice shows "not set" until someone picks one on the invoice.
export function termsOfBasis(basis, currentTerms) {
  if (basis === 'EXW') { return 'EXW'; }
  if (basis === 'CNF') { return currentTerms === 'CNF_SEPARATE' || currentTerms === 'CNF_INCLUDED' ? currentTerms : 'CNF_INCLUDED'; }
  return null;
}

function num(v) { if (v === null || v === undefined || String(v).trim() === '') { return null; } var n = Number(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; } // Codex: 'Infinity' / 1e309 refused

// What the invoice form must hold before it can be saved. lines = [{ description, amount }]; isShippingLine(desc) = the
// report's own shipping-line test. Returns { ok, error, warnings[], value: { shipping_terms, shipping_cost_estimate } }.
// v55.83-TZ (Yasmeen, Nov 17: EXW invoice for Elite with an "Overweight surcharge" line would not save; Max: "KTC does not pay
// anything" for it) — an overweight charge is still counted as shipping charged in the profit report, but on EXW a line that is
// ONLY an overweight charge (no freight / trucking / shipping / delivery words) does not mean we ship, so it needs no shipping cost.
var FREIGHT_WORDS = /ship|freight|forward|truck|deliver|courier|cartage|drayage|شحن|توصيل/i;
// v55.83-UE (Max, Nov 18: "maa kirpa ... is a CNF where the shipping is included in the price. but we have a surcharge which should just be
// an additional income to the transport") — a SURCHARGE line (overweight, fuel surcharge…) that names no freight / trucking / shipping /
// delivery is an extra charge on top, not the shipping itself. On CNF-included it does not turn the invoice into "shipping on a separate line".
// v55.83-UE (Max, Nov 18: "any word that says surcharge is just shipping income and it is still considered cnf and the transportation
// cost is to be removed from price of goods") — ANY line with the word surcharge ("Freight surcharge", "Shipping surcharge" too) is extra
// transport income; the invoice stays CNF with the shipping inside the price. An overweight line with no freight words counts the same.
export function isSurchargeOnlyLine(description) { var d = String(description || ''); return /surcharge/i.test(d) || (/over[\s-]?weight/i.test(d) && !FREIGHT_WORDS.test(d)); }
export function isOverweightOnlyLine(description) { var d = String(description || ''); return /over[\s-]?weight/i.test(d) && !FREIGHT_WORDS.test(d); }

export function checkShippingTerms(terms, cost, lines, isShippingLine) {
  var warnings = [];
  if (SHIPPING_TERMS.indexOf(terms) < 0) { return { ok: false, error: 'Pick the shipping terms: EXW, CNF in the price, or CNF with a separate shipping line.' }; }
  var c = num(cost);
  if (c !== null && (isNaN(c) || c < 0 || c > 10000000)) { return { ok: false, error: 'The shipping cost must be a number, zero or more.' }; }
  var shipLines = (lines || []).filter(function (l) { return isShippingLine && isShippingLine(l.description) && (Number(l.amount) || 0) > 0; });
  var charged = Math.round(shipLines.reduce(function (t, l) { return t + (Number(l.amount) || 0); }, 0) * 100) / 100;
  function markupWarn() {
    var need = minShippingCharge(c);
    if (c > 0 && charged < need - 0.005) { warnings.push('The shipping line(s) total $' + charged.toFixed(2) + ', but must be at least $' + need.toFixed(2) + ' (our shipping cost $' + c.toFixed(2) + ' + 7%).'); }
  }
  if (terms === 'EXW') {
    // Max: EXW = no shipping by us, so no shipping included — or, if we DO add a separate shipping line, it must cover cost + 7%
    // TZ: overweight-only lines are a charge KTC does not pay for — they never require a shipping cost on EXW
    var realShip = shipLines.filter(function (l) { return !isOverweightOnlyLine(l.description); });
    if (!realShip.length && shipLines.length && (c === null || c === 0)) {
      return { ok: true, warnings: warnings, value: { shipping_terms: 'EXW', shipping_cost_estimate: null } };
    }
    if (!shipLines.length) {
      if (c) { return { ok: false, error: 'EXW with no shipping line means we do not handle shipping, so there is no shipping cost. Clear the cost, add the shipping line, or pick CNF.' }; }
      return { ok: true, warnings: warnings, value: { shipping_terms: 'EXW', shipping_cost_estimate: null } };
    }
    if (c === null || !(c > 0)) { return { ok: false, error: 'EXW with a separate shipping line: type the shipping cost we expect to pay, so the line can be checked (cost + 7% at least).' }; }
    markupWarn();
    return { ok: true, warnings: warnings, value: { shipping_terms: 'EXW', shipping_cost_estimate: c } };
  }
  if (c === null || !(c > 0)) { return { ok: false, error: 'CNF: type the shipping cost (freight + trucking) we expect to pay. It is an estimate; the bills replace it when they arrive.' }; }
  if (terms === 'CNF_SEPARATE') {
    if (!shipLines.length) { warnings.push('CNF with a separate shipping line, but no line looks like a shipping charge. Add the shipping line (cost + 7% at least).'); }
    else { markupWarn(); }
  }
  if (terms === 'CNF_INCLUDED' && shipLines.some(function (l) { return !isSurchargeOnlyLine(l.description); })) { /* UE: a surcharge on CNF-included is extra transport income, no warning */ warnings.push('CNF in the price, but a line looks like a separate shipping charge (“' + shipLines[0].description + '”). Should it be “CNF with a separate line”?'); }
  return { ok: true, warnings: warnings, value: { shipping_terms: terms, shipping_cost_estimate: c } };
}

// Max 16 Nov: on CNF with a separate shipping line (and on EXW when we add a shipping line) the customer pays at least
// our shipping cost + 7%.
export var SHIPPING_MARKUP_MIN = 0.07;
export function minShippingCharge(cost) { return Math.round((Number(cost) || 0) * (1 + SHIPPING_MARKUP_MIN) * 100) / 100; }

// For the profit report: per release, the shipping-cost estimate typed on its invoices (used only when there is no bill,
// no typed release estimate and no warehouse figure). Several invoices on one release with different estimates → the
// largest is used and a flag says so.
// Codex 16 Nov: an invoice on SEVERAL releases has its estimate split ONCE across them by pounds (the total is kept); if a
// release has no pounds the split is unresolved and nothing is used (flagged). EXW with a shipping line carries an estimate too.
// Several invoices on ONE release: the same figure = one shared container estimate (used once); different figures = the
// largest is used as the estimate and flagged for a person (each invoice usually states the whole container's cost).
export function invoiceEstimatesByRelease(invoiceTerms, poundsOfRelease) {
  var out = {}; var unresolved = [];
  (invoiceTerms || []).forEach(function (t) {
    if (SHIPPING_TERMS.indexOf(t.shipping_terms) < 0) { return; }
    var c = Number(t.shipping_cost_estimate); if (!(c > 0) || !isFinite(c)) { return; }
    var rels = (t.releases || []).filter(function (r, i, a) { return r && a.indexOf(r) === i; }); if (!rels.length) { return; }
    var shares = {};
    if (rels.length === 1) { shares[rels[0]] = c; }
    else {
      var lbs = rels.map(function (r) { return poundsOfRelease ? Number(poundsOfRelease[r]) || 0 : 0; });
      if (lbs.some(function (x) { return !(x > 0); })) { unresolved.push({ invoice: t.invoice_number || t.invoice_id, releases: rels, amount: c }); return; }
      var tot = lbs.reduce(function (a, b) { return a + b; }, 0); var cents = Math.round(c * 100); var given = 0;
      rels.forEach(function (r, i) { var part = i === rels.length - 1 ? cents - given : Math.round(cents * lbs[i] / tot); given += part; shares[r] = part / 100; });
    }
    Object.keys(shares).forEach(function (rel) {
      var amt = shares[rel]; var o = out[rel] || (out[rel] = { amount: 0, invoices: [], differ: false });
      if (o.invoices.length && Math.abs(o.amount - amt) > 0.005) { o.differ = true; }
      if (amt > o.amount) { o.amount = amt; }
      o.invoices.push(t.invoice_number || t.invoice_id);
    });
  });
  out.__unresolved = unresolved;
  return out;
}
