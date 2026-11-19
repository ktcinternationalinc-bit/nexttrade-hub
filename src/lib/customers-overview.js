// v55.83-VN — CUSTOMERS OVERVIEW (Max, Nov 19 2026): "all of my customers and their sales and how much they've paid, how much
// they still owe from certain periods ... we can show how much was invoiced during that period. and how much was paid. and how
// much was received.. and how much is owed on those invoiced during that period ... drill down and see the invoices that were
// paid or still not paid. also would like to see the arrival dates and that should be in red if they already arrived" —
// and "only unpaid ones stay red".
// PURE: no database, no clock of its own. Money is added in whole cents. Server-safe and client-safe (var + concatenation).
import { isArEligible, arCurrencyOf } from './ar-eligibility';
import { isPaymentVoid } from './payment-matching';
import { businessOfInvoice } from './business-of';
import { splitReleases, isWarehouseTestRow } from './warehouse-shipping';

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function day(s) { var t = String(s || '').substring(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''; }
function dayNo(s) { var t = Date.parse(s + 'T00:00:00Z'); return isNaN(t) ? null : Math.round(t / 86400000); }
function inRange(d, from, to) { if (!d) { return false; } if (from && d < from) { return false; } if (to && d > to) { return false; } return true; }

// release key → the arrival date the warehouse gives for it. Only the main section of the latest feed, never a test order,
// never a superseded row. Two live rows for one release → the LATER date (the goods are not all there before it).
export function arrivalByRelease(warehouseRows) {
  var out = {};
  (warehouseRows || []).forEach(function (r) {
    if (!r || r.superseded === true || r.in_latest_feed === false) { return; }
    if (r.section && r.section !== 'main') { return; }
    if (isWarehouseTestRow(r)) { return; }
    var d = day(r.arrival_date); if (!r.release_key || !d) { return; }
    if (!out[r.release_key] || d > out[r.release_key]) { out[r.release_key] = d; }
  });
  return out;
}

// the arrival of ONE invoice: every release written on it is looked up by its key (the po / so number is never used).
// Several releases → the latest arrival; `all` is true only when every release on the invoice has a date.
export function arrivalOfInvoice(inv, byRelease) {
  var rels = splitReleases(inv && inv.release_number); var best = ''; var found = 0;
  rels.forEach(function (r) { var d = byRelease ? byRelease[r.key] : ''; if (d) { found += 1; if (d > best) { best = d; } } });
  return { date: best || null, releases: rels.length, found: found, all: rels.length > 0 && found === rels.length };
}

// THE REPORT.
//   o.invoices   accounting_invoices rows            o.payments  accounting_invoice_payments rows
//   o.customers  accounting_customers rows            o.warehouse pl_warehouse_shipping rows of the active source
//   o.from / o.to  the period (yyyy-mm-dd, either may be empty = open)      o.today  yyyy-mm-dd
//   o.floor      the earliest date this person may see (null = everything): nothing dated before it is counted or listed
//   o.business   'US' (default) or 'EG'
// Figures are in the report currency only (US side: USD; Egypt side: EGP). Invoices in another currency are listed apart per
// currency and never added in.
export function buildCustomersOverview(o) {
  o = o || {};
  var biz = o.business === 'EG' ? 'EG' : 'US'; var cur = biz === 'EG' ? 'EGP' : 'USD';
  var today = day(o.today); var floor = day(o.floor) || '';
  var from = day(o.from); var to = day(o.to);
  if (floor && (!from || from < floor)) { from = floor; }
  var tagById = {}; var nameById = {};
  (o.customers || []).forEach(function (c) { tagById[c.id] = c.business_tag || null; nameById[c.id] = String(c.company_name || c.contact_name || '').trim(); });
  var arrivals = arrivalByRelease(o.warehouse);
  // every invoice that counts for this side, whatever its date (payments received in the period can sit on an older invoice)
  var invById = {}; var other = {};
  (o.invoices || []).forEach(function (inv) {
    if (!isArEligible(inv)) { return; }
    if (businessOfInvoice(inv, tagById) !== biz) { return; }
    var c0 = arCurrencyOf(inv);
    if (c0 !== cur) { // another currency: listed apart, only when dated in the period
      var d0 = day(inv.invoice_date); if (!inRange(d0, from, to)) { return; }
      var oc = other[c0] || (other[c0] = { currency: c0, count: 0, invoiced: 0 }); oc.count += 1; oc.invoiced += cents(inv.total_amount); return;
    }
    invById[inv.id] = inv;
  });
  // v55.83-VN (Codex 19 Nov 20:32 / 20:43) — THE HISTORY WINDOW AND PAYMENTS. A person limited to a window (floor) is never given a
  // payment dated before it, or a payment with no date, in ANY figure — not in "received" and not folded into an invoice's paid /
  // left-to-pay either. Such an invoice is NOT shown as unpaid (that would be false): it is marked `limited`, its paid and balance
  // are withheld (null) and it is left out of the customer's paid / owed / overdue sums, with a count so the gap is visible.
  // Money recorded in Wave before the Hub (wave_imported_paid) is a figure of the invoice itself with no date: it counts as paid
  // on the invoice it belongs to (which is inside the window) and is labelled "date not recorded"; it is never "received".
  var paidDated = {}; var received = {}; var hiddenPay = {}; // by invoice id: visible payments / those dated in the period / has a payment this person may not see
  (o.payments || []).forEach(function (p) {
    if (isPaymentVoid(p)) { return; }
    var inv = invById[p.accounting_invoice_id]; if (!inv) { return; }
    var a = cents(p.amount); var pd = day(p.payment_date);
    if (floor && (!pd || pd < floor)) { hiddenPay[inv.id] = true; return; }
    paidDated[inv.id] = (paidDated[inv.id] || 0) + a;
    if (inRange(pd, from, to)) { received[inv.id] = (received[inv.id] || 0) + a; }
  });
  var by = {}; var order = [];
  function row(inv) {
    var key = inv.accounting_customer_id || ('name:' + String(inv.customer_name || '').trim().toLowerCase());
    var r = by[key];
    if (!r) {
      r = by[key] = { customer_id: inv.accounting_customer_id || null, name: nameById[inv.accounting_customer_id] || String(inv.customer_name || '').trim() || '(no customer)',
        invoice_count: 0, open_count: 0, limited_count: 0, invoiced: 0, paid_on_those: 0, paid_in_wave_undated: 0, received: 0, received_on_older: 0, received_on_other: 0, owed: 0, overdue: 0, overdue_count: 0, arrived_unpaid: 0, invoices: [] };
      order.push(key);
    }
    return r;
  }
  Object.keys(invById).forEach(function (id) {
    var inv = invById[id]; var d = day(inv.invoice_date);
    var inPeriod = inRange(d, from, to);
    var rec = received[id] || 0;
    if (!inPeriod) { // not an invoice of the period: only what was received on it in the period counts — said apart as on an
      // OLDER invoice, or on another one (dated after the period = paid in advance, or with no date)
      if (rec) { var r0 = row(inv); r0.received += rec; if (d && from && d < from) { r0.received_on_older += rec; } else { r0.received_on_other += rec; } }
      return;
    }
    var total = cents(inv.total_amount); var wave = cents(inv.wave_imported_paid); var paid = wave + (paidDated[id] || 0);
    var bal = total - paid; var open = bal > 0;
    var status = !open ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
    var due = day(inv.due_date); var od = 0;
    if (open && due && today && due < today) { od = dayNo(today) - dayNo(due); }
    // arrived = EVERY release on the invoice has a date and the last of them is not after today. When only some releases have a
    // date, nothing is claimed for the whole invoice: it is "partly known" and never red.
    var arr = arrivalOfInvoice(inv, arrivals); var arrived = !!(arr.date && arr.all && today && arr.date <= today);
    var r = row(inv);
    if (hiddenPay[id]) {
      r.invoice_count += 1; r.limited_count += 1; r.invoiced += total; r.received += rec;
      r.invoices.push({ id: inv.id, number: inv.invoice_number || '', release: inv.release_number || '', invoice_date: d, due_date: due || null,
        total: total / 100, paid: null, balance: null, overpaid: 0, status: 'limited', days_overdue: 0, received_in_period: rec / 100, paid_in_wave_undated: null,
        arrival_date: arr.date, arrival_partial: arr.date ? !arr.all : false, arrived: arrived, arrival_red: false });
      return;
    }
    r.invoice_count += 1; r.invoiced += total; r.paid_on_those += paid; r.paid_in_wave_undated += wave; r.received += rec;
    if (open) { r.open_count += 1; r.owed += bal; if (od > 0) { r.overdue += bal; r.overdue_count += 1; } if (arrived) { r.arrived_unpaid += 1; } }
    r.invoices.push({ id: inv.id, number: inv.invoice_number || '', release: inv.release_number || '', invoice_date: d, due_date: due || null,
      total: total / 100, paid: paid / 100, balance: (open ? bal : 0) / 100, overpaid: (bal < 0 ? -bal : 0) / 100, status: status, days_overdue: od,
      received_in_period: rec / 100, paid_in_wave_undated: wave / 100,
      arrival_date: arr.date, arrival_partial: arr.date ? !arr.all : false, arrived: arrived, arrival_red: arrived && open });
  });
  var F = ['invoiced', 'paid_on_those', 'paid_in_wave_undated', 'received', 'received_on_older', 'received_on_other', 'owed', 'overdue'];
  var totals = { customers: 0, invoice_count: 0, open_count: 0, limited_count: 0, overdue_count: 0, arrived_unpaid: 0 }; F.forEach(function (f) { totals[f] = 0; });
  var rows = order.map(function (k) {
    var r = by[k];
    totals.customers += 1; totals.invoice_count += r.invoice_count; totals.open_count += r.open_count; totals.limited_count += r.limited_count; totals.overdue_count += r.overdue_count; totals.arrived_unpaid += r.arrived_unpaid;
    F.forEach(function (f) { totals[f] += r[f]; r[f] = r[f] / 100; });
    // v55.83-VN (Codex 21:03) — a balance that is withheld is NOT a zero. balance_incomplete: some invoices of this customer are
    // left out of paid / owed / overdue, so those are a KNOWN PART only. balance_unknown: every invoice is left out — then paid,
    // owed and overdue are null (not 0), so nothing downstream can read them as "owes nothing".
    r.balance_incomplete = r.limited_count > 0; r.balance_unknown = r.limited_count > 0 && r.limited_count === r.invoice_count;
    if (r.balance_unknown) { r.paid_on_those = null; r.owed = null; r.overdue = null; r.paid_in_wave_undated = null; }
    r.invoices.sort(function (a, b) { return a.invoice_date < b.invoice_date ? 1 : (a.invoice_date > b.invoice_date ? -1 : (String(a.number) < String(b.number) ? 1 : -1)); });
    return r;
  }).sort(function (a, b) { return ((b.owed || 0) - (a.owed || 0)) || ((b.limited_count > 0 ? 1 : 0) - (a.limited_count > 0 ? 1 : 0)) || (b.invoiced - a.invoiced) || (a.name < b.name ? -1 : 1); });
  F.forEach(function (f) { totals[f] = totals[f] / 100; });
  totals.balance_incomplete = totals.limited_count > 0; totals.balance_unknown = totals.limited_count > 0 && totals.limited_count === totals.invoice_count;
  if (totals.balance_unknown) { totals.paid_on_those = null; totals.owed = null; totals.overdue = null; totals.paid_in_wave_undated = null; }
  return { business: biz, currency: cur, from: from || null, to: to || null, today: today || null, window_floor: floor || null,
    rows: rows, totals: totals,
    other_currencies: Object.keys(other).sort().map(function (k) { return { currency: k, count: other[k].count, invoiced: other[k].invoiced / 100 }; }) };
}

// What a person without the totals switch receives: the same customers, and NO company-wide figure in any currency — not the
// grand totals, and not the per-currency summary of the invoices left out (its amounts and its counts are totals too). Only
// the fact that some invoices in another currency exist is kept, so the screen can say the list is not everything.
export function maskOverviewTotals(report, canSeeTotals) {
  if (canSeeTotals) { return Object.assign({}, report, { totals_masked: false }); }
  return Object.assign({}, report, { totals: null, other_currencies: [], other_currencies_exist: (report.other_currencies || []).length > 0, totals_masked: true });
}

// "Only customers who still owe" — a customer whose balance is withheld (in part or in full) STAYS in that list: an unknown
// balance is not a settled one.
export function owesOrUnknown(row) { return !!row && ((Number(row.owed) || 0) > 0 || (row.limited_count || 0) > 0); }

// the dates of a preset, from today (yyyy-mm-dd). 'all' = no dates.
export function presetRange(preset, today) {
  var t = day(today); if (!t) { return { from: '', to: '' }; }
  function back(days) { return new Date((dayNo(t) - days) * 86400000).toISOString().substring(0, 10); }
  if (preset === 'month') { return { from: back(30), to: t }; }
  if (preset === 'quarter') { return { from: back(90), to: t }; }
  if (preset === 'year') { return { from: t.substring(0, 4) + '-01-01', to: t }; }
  if (preset === 'all') { return { from: '', to: '' }; }
  return null; // custom: the dates typed by the person
}
