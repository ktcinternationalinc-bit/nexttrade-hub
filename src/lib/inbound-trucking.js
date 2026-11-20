// v55.83-VR — INBOUND TRUCKING TRACKER (Max, Nov 19 2026: "keep track of the real inbound trucking bills ... convert all to
// weight ... what ends up being the average price per lb" · "kronos is for inbound" · "now just track it and give us the
// generic .02 per LB costs").
// TRACKING ONLY: nothing here changes goods profit, which keeps the standard inbound allowance ($0.02 per pound).
// The rule, in one place:
//   - A Kronos freight line = a line on a live bill whose vendor is Kronos, or a charge line on another vendor's bill whose
//     description names Kronos (the supplier re-billing Kronos freight).
//   - Its LOAD NUMBER is the one 8-digit number in the line. None, or two different ones = not matched, and listed.
//   - The POUNDS of a load = the goods lines of the live supplier bills that carry the same load number as their
//     "other reference". Pounds stay pounds; yards and metres are turned into pounds with the same weight table as
//     Profitability (headliner 1.25 lb per yard, foam 3, otherwise the standard table). A line with an unknown unit makes the
//     load's pounds unknown: it is listed, never guessed.
//   - Average per pound = freight of the matched loads / pounds of the matched loads. Loads that are not matched are left
//     out of the average and shown with their money, so nothing disappears.
// Whole cents throughout. Pure functions, no database, no clock.
import { toPounds, billLineUnit, weightFactorsFor, DEFAULT_UNIT_FACTORS, INBOUND_ALLOWANCE_PER_LB } from './profitability';

export var INBOUND_TRUCKER_RX = /kronos/i;
function cents(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; }
function txt(v) { return String(v === null || v === undefined ? '' : v); }
export function isLiveBill(b) { return !!b && !b.deleted_at && txt(b.record_status || 'active') === 'active'; }
export function isKronosVendor(name) { return INBOUND_TRUCKER_RX.test(txt(name)); }
// every DIFFERENT 8-digit number standing on its own in the text (a date like 07/14/2026 is not one)
export function loadNumbersIn(text) {
  var m = txt(text).match(/(^|[^0-9\/.\-])(\d{8})(?![0-9\/.\-])/g) || []; var seen = {}; var out = [];
  m.forEach(function (x) { var d = x.replace(/[^0-9]/g, ''); if (!seen[d]) { seen[d] = true; out.push(d); } });
  return out;
}
// "Kronos Invoice # KLNX162" → KLNX162 (the trucker's own invoice number named on a re-billed line)
export function truckerInvoiceIn(text) { var m = txt(text).match(/invoice\s*#?\s*([a-z]{2,6}\d{2,7})\b/i); return m ? m[1].toUpperCase() : ''; }
export function isBondedLine(l) { return /bonded/i.test(txt(l && l.description)) || /bonded/i.test(txt(l && l.unit)); }

function inDates(day, from, to) { var d = txt(day).substring(0, 10); if (from && (!d || d < from)) { return false; } if (to && (!d || d > to)) { return false; } return true; }

// o = { bills, lines, factors, from, to }   (from / to = bill date of the freight bill, optional)
export function buildInboundTrucking(o) {
  var bills = (o && o.bills) || []; var lines = (o && o.lines) || []; var factors = (o && o.factors) || { units: DEFAULT_UNIT_FACTORS };
  var from = (o && o.from) || ''; var to = (o && o.to) || '';
  var billById = {}; bills.forEach(function (b) { if (isLiveBill(b)) { billById[b.id] = b; } });
  var linesByBill = {}; lines.forEach(function (l) { if (billById[l.bill_id]) { (linesByBill[l.bill_id] = linesByBill[l.bill_id] || []).push(l); } });

  // 1) the freight lines
  var freight = []; var rebilled = {}; // trucker invoice numbers named on another vendor's bill
  Object.keys(billById).forEach(function (id) {
    var b = billById[id]; var own = isKronosVendor(b.vendor_name);
    (linesByBill[id] || []).forEach(function (l) {
      if (txt(l.line_kind) === 'commission') { return; }
      var named = INBOUND_TRUCKER_RX.test(txt(l.description));
      if (!own && !(named && txt(l.line_kind) === 'charge')) { return; }
      var c = cents(l.amount); if (c === 0) { return; }
      var ti = own ? txt(b.bill_number).toUpperCase() : truckerInvoiceIn(l.description);
      if (!own && ti) { rebilled[ti] = txt(b.vendor_name) + ' bill ' + txt(b.bill_number); }
      freight.push({ line_id: l.id, bill_id: b.id, vendor: txt(b.vendor_name), bill_number: txt(b.bill_number), bill_date: txt(b.bill_date).substring(0, 10), description: txt(l.description), cents: c, own: own, trucker_invoice: ti, bonded: isBondedLine(l), loads: loadNumbersIn(l.description) });
    });
  });
  // the same Kronos invoice entered directly AND re-billed by a supplier is counted once (through the supplier's bill)
  var notCounted = []; var counted = [];
  freight.forEach(function (f) {
    if (!inDates(f.bill_date, from, to)) { return; }
    if (f.own && f.trucker_invoice && rebilled[f.trucker_invoice]) { f.why = 'already counted through ' + rebilled[f.trucker_invoice]; notCounted.push(f); return; }
    counted.push(f);
  });

  // 2) pounds received per load number
  var goodsByLoad = {};
  Object.keys(billById).forEach(function (id) {
    var b = billById[id]; if (txt(b.bill_type) !== 'supplier') { return; }
    loadNumbersIn(b.other_reference).forEach(function (ld) { (goodsByLoad[ld] = goodsByLoad[ld] || []).push(b); });
  });
  function poundsOf(load) {
    var gb = goodsByLoad[load] || []; var lb = 0; var unknown = 0; var itemLines = 0; var billsOut = [];
    gb.forEach(function (b) {
      var bl = 0; var bu = 0;
      (linesByBill[b.id] || []).forEach(function (l) {
        if (txt(l.line_kind) !== 'item') { return; }
        itemLines++;
        var p = toPounds(l.qty, billLineUnit(l), null, weightFactorsFor('', l.description, factors));
        if (p === null || !(Number(l.qty) > 0)) { unknown++; bu++; } else { lb += p; bl += p; }
      });
      billsOut.push({ bill_id: b.id, vendor: txt(b.vendor_name), bill_number: txt(b.bill_number), bill_date: txt(b.bill_date).substring(0, 10), pounds: Math.round(bl), unknown_lines: bu });
    });
    return { bills: billsOut, pounds: lb, unknown: unknown, item_lines: itemLines };
  }

  // 3) loads and the lines that cannot be matched
  var loadMap = {}; var order = []; var unmatched = [];
  counted.forEach(function (f) {
    if (f.loads.length !== 1) { f.why = f.loads.length === 0 ? 'no load number on the line' : 'more than one load number on the line'; unmatched.push(f); return; }
    var k = f.loads[0];
    if (!loadMap[k]) { loadMap[k] = { load: k, freight_cents: 0, bonded: false, lines: [] }; order.push(k); }
    loadMap[k].freight_cents += f.cents; loadMap[k].lines.push(f); if (f.bonded) { loadMap[k].bonded = true; }
  });
  var loads = order.map(function (k) {
    var L = loadMap[k]; var g = poundsOf(k);
    L.goods_bills = g.bills; L.first_date = L.lines.map(function (x) { return x.bill_date; }).sort()[0] || '';
    if (g.bills.length === 0) { L.status = 'no_goods_bill'; L.pounds = null; L.why = 'no supplier bill carries load number ' + k + ' as its other reference'; }
    else if (g.unknown > 0 || g.item_lines === 0 || !(g.pounds > 0)) { L.status = 'pounds_unknown'; L.pounds = null; L.why = g.item_lines === 0 ? 'the supplier bill has no goods lines' : g.unknown + ' goods line(s) have no unit or quantity that can be turned into pounds'; }
    else { L.status = 'matched'; L.pounds = Math.round(g.pounds); L.per_lb = L.freight_cents / 100 / L.pounds; L.why = ''; }
    return L;
  }).sort(function (a, b) { return a.first_date < b.first_date ? -1 : (a.first_date > b.first_date ? 1 : (a.load < b.load ? -1 : 1)); });

  function sum(list) {
    var c = 0; var p = 0; list.forEach(function (L) { c += L.freight_cents; p += L.pounds; });
    return { loads: list.length, freight_cents: c, pounds: p, per_lb: p > 0 ? c / 100 / p : null };
  }
  var matched = loads.filter(function (L) { return L.status === 'matched'; });
  var open = loads.filter(function (L) { return L.status !== 'matched'; });
  var all = sum(matched);
  var standardCents = Math.round(all.pounds * INBOUND_ALLOWANCE_PER_LB * 100);
  function total(list) { var c = 0; list.forEach(function (x) { c += (x.freight_cents !== undefined ? x.freight_cents : x.cents); }); return c; }
  return {
    loads: loads, unmatched_lines: unmatched, not_counted: notCounted,
    totals: {
      all: all, regular: sum(matched.filter(function (L) { return !L.bonded; })), bonded: sum(matched.filter(function (L) { return L.bonded; })),
      open_loads: open.length, open_cents: total(open), unmatched_cents: total(unmatched), not_counted_cents: total(notCounted),
      tracked_cents: all.freight_cents + total(open) + total(unmatched)
    },
    standard_per_lb: INBOUND_ALLOWANCE_PER_LB, standard_cents: standardCents, difference_cents: all.freight_cents - standardCents,
    used_in_profit: 'standard', from: from, to: to
  };
}
