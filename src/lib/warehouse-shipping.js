// v55.83-TG — SHIPPING COSTS FROM THE NEXTRADE WAREHOUSE (Max, Nov 16 2026).
//
// Pure rules, no database. Turns the warehouse feed (raw values exactly as stored in Nextrade) into one record per
// warehouse order with freight and trucking kept SEPARATE, each with its estimate (the quote in "Shipping In Process")
// and its final (the wire in "Closed"), which one is used, and why. Then matches each record to Hub invoices by
// RELEASE NUMBER ONLY and compares it with the Hub's own outbound bills.
//
// Rules (agreed in the plan posted to Codex, 16 Nov):
//   • Shipping expense = freight + trucking. A missing part stays MISSING (null) and is flagged — never zero.
//   • "0" in a wire field is the warehouse's default, so it means NOT RECORDED.
//   • A wire replaces the quote only when it looks like this order's payment: not more than 3× and not less than ⅓ of
//     the quote, and not paid before the load date. Otherwise the quote stays in use and the wire is flagged.
//   • Ship date = the order's shipped date; else the load date (labelled). The sailing date is never the ship date.
//   • The warehouse stores no currency: Max confirmed (16 Nov) every amount is US dollars, Canada orders included.
//   • Max 16 Nov: a SHIPPED Canada (1001-) order whose shipping boxes are all empty is usually a domestic customer
//     (e.g. Vinyl Trend) who arranges their own transport → KTC shipping cost 0, labelled "inferred", odd cases flagged.
//   • Max 16 Nov: one wire can pay several orders. The same wire amount + date on several orders is never taken as
//     any one order's final cost.
//   • Matching: release number only (relKey for comparison, raw text kept). Never by name, date or amount.
import { relKey, r2 } from './profitability';

// the same split as profitability-assemble's splitReleases (kept here so the two modules do not import each other)
export function splitReleases(text) {
  var out = []; var seen = {};
  String(text || '').split(/\s*(?:[,;&\/+]|\band\b)\s*/i).forEach(function (part) {
    var raw = part.trim(); var k = relKey(raw);
    if (k && !seen[k]) { seen[k] = true; out.push({ key: k, raw: raw }); }
  });
  return out;
}

export var WS_BUILD = 'v55.83-TG';
export var BACKFILL_FROM = '2026-06-01';
export var SUSPICIOUS_HIGH = 3; export var SUSPICIOUS_LOW = 1 / 3;
export var BILL_VARIANCE_PCT = 0.10; export var BILL_VARIANCE_ABS = 100;
export var SHIPPED_STATUSES = ['shipped', 'post_loading_documentation', 'end_stage', 'closed'];
var STATUS_WORDS = { pending: 'Pending', preload: 'Pre-load', shipping_in_process: 'Shipping in process', shipped: 'Shipped', post_loading_documentation: 'Post-load documentation', end_stage: 'End stage', closed: 'Closed', cancelled: 'Cancelled' };
export function statusWords(s) { return STATUS_WORDS[s] || (s || '(no status)'); }

// '3,475' / '$3475.00' / 'USD 3475' → 3475 · '0' → not recorded · 'NA' → missing · '1400+150' → not a plain number (never summed)
export function parseAmount(raw) {
  var s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!s || /^(n\/?a|none|nil|-+|tbd|tba)$/i.test(s)) { return { value: null, raw: s || null, problem: 'missing' }; }
  var t = s.replace(/^(usd|us\$|\$)\s*/i, '').replace(/\s*(usd)$/i, '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) { return { value: null, raw: s, problem: 'not_a_plain_number' }; }
  var v = Number(t);
  if (v === 0) { return { value: null, raw: s, problem: 'not_recorded' }; }
  if (v < 0) { return { value: null, raw: s, problem: 'negative' }; }
  if (v <= 1) { return { value: null, raw: s, problem: 'placeholder' }; }
  return { value: r2(v), raw: s, problem: null };
}
// 'YYYY-MM-DD…' → 'YYYY-MM-DD'; anything before 2015 or unreadable → null
export function dateOnly(raw) {
  var m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || Number(m[1]) < 2015) { return null; }
  return m[1] + '-' + m[2] + '-' + m[3];
}
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function yes(v) { return /^(yes|y|paid|1|true)$/i.test(String(v || '').trim()); }
// several rows for one stage: the latest one is used; differing rows are flagged
function latest(rows) { return rows.slice().sort(function (a, b) { return String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || (Number(a.id) - Number(b.id)); }).pop() || null; }
function rowsDiffer(rows, fields) { if (rows.length < 2) { return false; } var f = JSON.stringify(fields.map(function (k) { return rows[0][k]; })); return rows.some(function (r) { return JSON.stringify(fields.map(function (k) { return r[k]; })) !== f; }); }

// one component (freight or trucking): which number is used and why
export function decideComponent(c) {
  var est = parseAmount(c.estimate_raw); var fin = parseAmount(c.final_raw);
  var out = { estimate: est.value, estimate_raw: est.raw, estimate_problem: est.problem, final: fin.value, final_raw: fin.raw, final_problem: fin.problem,
    paid: c.paid_raw ? String(c.paid_raw) : null, paid_date: dateOnly(c.paid_date), invoice: c.invoice ? String(c.invoice).trim() : null, wire_bank: c.wire_bank || null,
    used: null, kind: 'missing', variance: null, flags: [] };
  if (est.problem === 'not_a_plain_number' || est.problem === 'negative' || est.problem === 'placeholder') { out.flags.push(c.name + '_quote_unreadable'); }
  if (fin.problem === 'not_a_plain_number' || fin.problem === 'negative' || fin.problem === 'placeholder') { out.flags.push(c.name + '_final_unreadable'); }
  if (fin.value !== null) {
    var why = [];
    if (est.value !== null && fin.value > est.value * SUSPICIOUS_HIGH) { why.push('more than ' + SUSPICIOUS_HIGH + '× the quote'); }
    if (est.value !== null && fin.value < est.value * SUSPICIOUS_LOW) { why.push('less than a third of the quote'); }
    if (out.paid_date && c.load_date && out.paid_date < c.load_date) { why.push('paid ' + out.paid_date + ', before the load date ' + c.load_date); }
    if (c.shared) { why.push('the same wire amount and date is on ' + c.shared + ' orders — one payment for several orders'); }
    if (est.value !== null) { out.variance = r2(fin.value - est.value); }
    if (c.shared && est.value === null) {
      // one wire for several orders and no quote: this order's share is unknown → stays missing (never the whole wire)
      out.suspicious = why; out.flags.push(c.name + '_wire_shared_by_several_orders', c.name + '_missing');
    } else if (c.shared) {
      out.used = est.value; out.kind = 'estimate'; out.suspicious = why; out.flags.push(c.name + '_wire_shared_by_several_orders');
    } else if (why.length && est.value !== null) {
      out.used = est.value; out.kind = 'estimate'; out.suspicious = why; out.flags.push(c.name + '_final_suspicious');
    } else if (!yes(c.paid_raw)) {
      // Codex 16 Nov: a wire becomes FINAL only when it is also marked paid. Until then the quote stays in use (or, with no
      // quote, the unpaid wire is used as a provisional figure) — never "final".
      out.used = est.value !== null ? est.value : fin.value; out.kind = 'estimate'; out.flags.push(c.name + '_wire_not_marked_paid');
      if (why.length) { out.suspicious = why; out.flags.push(c.name + '_final_suspicious_no_quote'); }
    } else {
      out.used = fin.value; out.kind = 'final';
      if (why.length) { out.suspicious = why; out.flags.push(c.name + '_final_suspicious_no_quote'); }
    }
  } else if (est.value !== null) {
    out.used = est.value; out.kind = 'estimate';
    if (c.closed) { out.flags.push(c.name + '_closed_final_missing'); }
  } else {
    out.flags.push(c.name + '_missing');
  }
  return out;
}

// feed → records. feed = { site, orders[], stages[], obsolete_orders[] }
export function buildRecords(feed, opts) {
  opts = opts || {};
  var source = opts.source || 'nextrade-staging';
  var site = String(feed.site || opts.site || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  var today = opts.today || new Date().toISOString().substring(0, 10);
  var stagesOf = {};
  (feed.stages || []).forEach(function (s) { var k = s.order_id + '|' + s.order_status; (stagesOf[k] = stagesOf[k] || []).push(s); });
  var out = [];
  // one wire paying several orders (Max 16 Nov): the same amount AND paid date on more than one order
  var wireCount = {};
  function wireKey(part, cl) {
    var v = parseAmount(part === 'freight' ? cl.ff_wire_amount : cl.trucker_wire_amount).value; var dt = dateOnly(part === 'freight' ? cl.ff_date_paid : cl.trucker_date);
    return v !== null && dt ? part + '|' + v + '|' + dt : null;
  }
  (feed.orders || []).forEach(function (o) {
    if (/^\s*test\b/i.test(String(o.customer_name || ''))) { return; }
    var cl0 = latest(stagesOf[o.id + '|closed'] || []); if (!cl0) { return; }
    ['freight', 'trucking'].forEach(function (p) { var k = wireKey(p, cl0); if (k) { wireCount[k] = (wireCount[k] || 0) + 1; } });
  });
  function sharedCount(part, cl) { var k = wireKey(part, cl); return k && wireCount[k] > 1 ? wireCount[k] : 0; }
  (feed.orders || []).forEach(function (o) {
    var flags = [];
    var sipRows = stagesOf[o.id + '|shipping_in_process'] || []; var clRows = stagesOf[o.id + '|closed'] || [];
    var sip = latest(sipRows) || {}; var cl = latest(clRows) || {};
    if (rowsDiffer(sipRows, ['best_rate_received', 'trucker_quote', 'load_date'])) { flags.push('two_shipping_in_process_rows_differ'); }
    if (rowsDiffer(clRows, ['ff_wire_amount', 'trucker_wire_amount'])) { flags.push('two_closed_rows_differ'); }
    var closed = o.status === 'closed';
    var loadDate = dateOnly(sip.load_date); var shippedDate = dateOnly(o.shipped_date);
    var shipDate = shippedDate || loadDate; var shipBasis = shippedDate ? 'shipped date' : (loadDate ? 'load date (no shipped date recorded)' : null);
    var shipped = SHIPPED_STATUSES.indexOf(o.status) >= 0;
    if (shipped && !shipDate) { flags.push('ship_date_unknown'); }
    if (shippedDate && loadDate && Math.abs(daysBetween(loadDate, shippedDate)) > 2) { flags.push('ship_date_far_from_load_date'); }
    if (shipDate && shipDate > today) { flags.push('ship_date_in_future'); }
    if (!shipped && shippedDate) { flags.push('shipped_date_on_unshipped_order'); }
    var freight = decideComponent({ name: 'freight', estimate_raw: sip.best_rate_received, final_raw: cl.ff_wire_amount, paid_raw: cl.ff_paid, paid_date: cl.ff_date_paid, invoice: cl.ff_invoivce, wire_bank: cl.ff_wire_bank, load_date: loadDate, closed: closed, shared: sharedCount('freight', cl) });
    // NB the warehouse column 'ff_invoice' holds the TRUCKER invoice number (the FF one is the misspelt 'ff_invoivce')
    var trucking = decideComponent({ name: 'trucking', estimate_raw: sip.trucker_quote, final_raw: cl.trucker_wire_amount, paid_raw: cl.trucker_paid, paid_date: cl.trucker_date, invoice: cl.ff_invoice, wire_bank: cl.trucker_wire_bank, load_date: loadDate, closed: closed, shared: sharedCount('trucking', cl) });
    var rel = String(o.release_number || '').trim();
    // Canada domestic customer arranging their own transport (Max 16 Nov): shipped 1001- order, every shipping box empty
    function blank(cmp) { return cmp.kind === 'missing' && (cmp.estimate_problem === 'missing' || cmp.estimate_problem === 'not_recorded') && (cmp.final_problem === 'missing' || cmp.final_problem === 'not_recorded'); }
    // Codex 16 Nov (P1): ANY sign of a paid shipment in ANY stage row (paid flag, paid date, invoice no., bank, amount,
    // forwarder, trucker, line, booking) → not "own transport": the cost stays unknown and is flagged instead.
    var EVIDENCE = ['freight_forwarder', 'best_rate_received', 'shipping_line', 'truker_name', 'trucker_quote', 'booking_number', 'ff_invoivce', 'ff_wire_bank', 'ff_wire_amount', 'ff_paid', 'ff_date_paid', 'ff_invoice', 'trucker_wire_bank', 'trucker_wire_amount', 'trucker_paid', 'trucker_date'];
    function hasEvidence(rows) { return rows.some(function (s) { return EVIDENCE.some(function (k) { var v = s[k]; if (v === null || v === undefined) { return false; } var t = String(v).trim(); return t !== '' && t !== '0' && !/^(no|n|na|n\/a|none|-+|0000-00-00.*)$/i.test(t); }); }); }
    var emptyBoxes = blank(freight) && blank(trucking);
    var evidence = hasEvidence(sipRows.concat(clRows));
    var ownTransport = shipped && /^1001-/.test(rel) && emptyBoxes && !evidence;
    if (shipped && /^1001-/.test(rel) && emptyBoxes && evidence) { flags.push('canada_shipping_recorded_but_no_amount'); }
    if (ownTransport) {
      [freight, trucking].forEach(function (cmp) { cmp.used = 0; cmp.kind = 'own_transport'; cmp.flags = cmp.flags.filter(function (f) { return !/_missing$/.test(f); }); });
      flags.push('canada_customer_own_transport_inferred');
    }
    // Max 16 Nov (workflow): ONLY a bill confirms a final cost. Until the bill is in the Hub the ESTIMATE (the quote) is used;
    // the warehouse's paid wire is kept for comparison (and checked against the bill when it comes), not used as final.
    [freight, trucking].forEach(function (cmp) {
      if (cmp.kind === 'own_transport') { return; }
      cmp.warehouse_kind = cmp.kind; // what the warehouse alone says: final (paid wire) / estimate / missing
      if (cmp.kind === 'final') {
        if (cmp.estimate !== null) { cmp.used = cmp.estimate; }
        cmp.kind = 'estimate'; cmp.wire_paid_no_bill = true;
      }
    });
    if (freight.wire_paid_no_bill) { freight.flags.push('freight_paid_waiting_for_bill'); }
    if (trucking.wire_paid_no_bill) { trucking.flags.push('trucking_paid_waiting_for_bill'); }
    flags = flags.concat(freight.flags, trucking.flags);
    var both = freight.used !== null && trucking.used !== null;
    var costStatus = ownTransport ? 'customer_own_transport' : (!both ? 'missing' : 'provisional');
    if (!relKey(rel)) { flags.push('no_release_number'); }
    // staging holds test orders (e.g. 1001-1675, customer "Test") whose release numbers live will later give to real shipments
    var isTest = /^\s*test\b/i.test(String(o.customer_name || ''));
    if (isTest) { flags.push('test_order_not_used'); }
    out.push({
      source: source, section: 'main', order_id: Number(o.id), release_number: rel || null, release_key: relKey(rel) || null,
      customer_name: o.customer_name || null, warehouse_name: o.warehouse_name || null, status: o.status || null, is_bonded: Number(o.is_bonded_order) === 1, country: o.country || null,
      order_created: dateOnly(o.created_at), shipped_date: shippedDate, load_date: loadDate, ship_date: shipDate, ship_date_basis: shipBasis,
      sailing_date: dateOnly(sip.sailing_date), arrival_date: dateOnly(sip.arrival_date), freight_forwarder: sip.freight_forwarder || null, shipping_line: sip.shipping_line || null,
      trucker_name: sip.truker_name || null, booking_number: sip.booking_number || null,
      freight: freight, trucking: trucking,
      combined_used: both ? r2(freight.used + trucking.used) : null,
      combined_estimate: freight.estimate !== null && trucking.estimate !== null ? r2(freight.estimate + trucking.estimate) : null,
      cost_status: costStatus, currency: 'USD', currency_confirmed: true, // Max 16 Nov: all USD, Canada included
      is_shipped: shipped, is_closed: closed, is_open: !closed && o.status !== 'cancelled',
      in_backfill: shipped && !!shipDate && shipDate >= BACKFILL_FROM,
      final_payment: cl.final_payment_closed || null,
      source_link: site ? 'https://' + site + '/admin/orders/edit-order/' + o.id : null,
      conflict: isTest ? true : undefined, // a test order never feeds the P&L
      flags: uniq(flags)
    });
  });
  (feed.obsolete_orders || []).forEach(function (o) {
    var rel = String(o.release_number || '').trim();
    out.push({ source: source, section: 'obsolete', order_id: Number(o.id), release_number: rel || null, release_key: relKey(rel) || null, customer_name: o.customer_name || null, warehouse_name: null,
      status: o.status || null, is_bonded: false, country: o.country || null, order_created: dateOnly(o.created_at), shipped_date: dateOnly(o.shiped_date), load_date: dateOnly(o.load_date),
      ship_date: dateOnly(o.shiped_date) || dateOnly(o.load_date), ship_date_basis: dateOnly(o.shiped_date) ? 'shipped date' : (dateOnly(o.load_date) ? 'load date' : null),
      freight: null, trucking: null, combined_used: null, combined_estimate: null, cost_status: 'not_applicable', currency: null, currency_confirmed: false,
      is_shipped: /shipped/i.test(String(o.status || '')), is_closed: false, is_open: false, in_backfill: false, source_link: null,
      flags: ['obsolete_section_costs_are_on_the_main_order'] });
  });
  // a release on two MAIN orders: neither is used in the P&L until a person decides
  var mainByRel = {};
  out.forEach(function (r) { if (r.section === 'main' && r.release_key) { (mainByRel[r.release_key] = mainByRel[r.release_key] || []).push(r); } });
  Object.keys(mainByRel).forEach(function (k) { if (mainByRel[k].length > 1) { mainByRel[k].forEach(function (r) { r.flags.push('release_on_two_warehouse_orders'); r.conflict = true; }); } });
  return out;
}
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

// records × Hub invoices (accounting_invoices rows with release_number / po_so_number) → invoice matches per record
// a staging test order (quarantined: never matched, never in any P&L calculation; shown only on the review list)
export function isWarehouseTestRow(r) { return !!r && (r.flags || []).indexOf('test_order_not_used') >= 0; }

// Customer names are NEVER used to match (Max 16 Nov: "important thing is that release numbers match") — they are only
// compared afterwards, and a difference is noted for review. Loose comparison: case, punctuation and Inc/LLC/Ltd ignored.
var NAME_NOISE = /\b(inc|llc|ltd|limited|co|corp|corporation|company|the|sa|sarl|srl|gmbh|international|intl)\b/g;
export function nameCore(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim(); }
export function namesAgree(a, b) {
  var x = nameCore(a); var y = nameCore(b);
  if (!x || !y) { return true; } // nothing to compare
  if (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0) { return true; }
  var ty = {}; y.split(' ').forEach(function (w) { if (w.length >= 4) { ty[w] = true; } });
  return x.split(' ').some(function (w) { return w.length >= 4 && ty[w]; });
}
export function matchInvoices(records, invoices, customerNames) {
  var byRel = {}; var byPo = {}; var names = customerNames || {};
  (invoices || []).forEach(function (i) {
    var st = i.record_status; if (st === 'void' || st === 'cancelled' || st === 'archived' || st === 'deleted') { return; }
    var info = { id: i.id, number: i.invoice_number, date: String(i.invoice_date || '').substring(0, 10), total: i.total_amount, currency: i.currency || 'USD', customer_id: i.accounting_customer_id || null, customer_name: names[i.accounting_customer_id] || null, status: i.wave_status || i.record_status || null };
    splitReleases(i.release_number).forEach(function (r) { (byRel[r.key] = byRel[r.key] || []).push(info); });
    splitReleases(i.po_so_number).forEach(function (r) { (byPo[r.key] = byPo[r.key] || []).push(info); });
  });
  records.forEach(function (r) {
    if (r.section !== 'main' || !r.release_key || isWarehouseTestRow(r)) { r.invoices = []; r.review_only_invoices = []; return; } // test orders are quarantined
    r.invoices = byRel[r.release_key] || [];
    var have = {}; r.invoices.forEach(function (x) { have[x.id] = true; });
    r.review_only_invoices = (byPo[r.release_key] || []).filter(function (x) { return !have[x.id]; }); // PO/SO field only — listed, never used
    if (!r.invoices.length) { r.flags.push(r.review_only_invoices.length ? 'invoice_only_by_po_so_field' : 'no_hub_invoice_for_release'); }
    if (r.invoices.length > 1) { r.flags.push('several_invoices_share_this_release'); }
    var cur = {}; r.invoices.forEach(function (x) { cur[x.currency] = true; });
    if (Object.keys(cur).length > 1 || (r.invoices.length && !cur.USD)) { r.flags.push('invoice_currency_not_usd'); }
    if (r.customer_name && r.invoices.some(function (x) { return x.customer_name && !namesAgree(r.customer_name, x.customer_name); })) { r.flags.push('customer_name_differs_from_hub_invoice'); }
    r.flags = uniq(r.flags);
  });
  return records;
}

// Hub outbound bills on the same release vs the warehouse quote (Max: "confirm if numbers are right as per initial quote
// and flag if they are not … it could be demurrage"). type 'shipping' ↔ freight, 'trucking' ↔ trucking.
export function compareBills(records, bills) {
  var byRel = {};
  (bills || []).forEach(function (b) {
    if (b.record_status !== 'active') { return; }
    if (b.bill_type !== 'trucking' && b.bill_type !== 'shipping') { return; }
    if (b.shipment_direction && b.shipment_direction !== 'outbound') { return; }
    var rels = splitReleases(b.release_number);
    rels.forEach(function (r) { (byRel[r.key] = byRel[r.key] || []).push({ id: b.id, number: b.bill_number, vendor: b.vendor_name, date: b.bill_date, amount: r2(b.total_amount), type: b.bill_type, releases_on_bill: rels.length }); });
  });
  records.forEach(function (r) {
    if (r.section !== 'main' || !r.release_key) { r.bill_checks = []; return; }
    var list = byRel[r.release_key] || [];
    r.hub_bills = list;
    r.bill_checks = ['freight', 'trucking'].map(function (part) {
      var type = part === 'freight' ? 'shipping' : 'trucking'; var mine = list.filter(function (b) { return b.type === type; });
      var comp = r[part]; var quote = comp ? comp.estimate : null;
      if (!mine.length) { return { part: part, bills: [], status: 'no_hub_bill' }; }
      var shared = mine.some(function (b) { return b.releases_on_bill > 1; });
      var total = r2(mine.reduce(function (t, b) { return t + (b.amount || 0); }, 0));
      if (shared) { return { part: part, bills: mine, bill_total: total, quote: quote, status: 'bill_covers_several_releases' }; }
      // Max 16 Nov: the warehouse's FINAL (wire) must equal what we were billed; the BILL is the value used, a difference is flagged
      var fin = comp ? comp.final : null;
      var wireCheck = fin === null || fin === undefined ? null : { warehouse_final: fin, bill_total: total, difference: r2(fin - total), matches: Math.abs(fin - total) <= 1 };
      if (quote === null) { return { part: part, bills: mine, bill_total: total, quote: null, status: 'no_quote_to_compare', final_check: wireCheck }; }
      var diff = r2(total - quote);
      var off = Math.abs(diff) > BILL_VARIANCE_ABS && Math.abs(diff) > quote * BILL_VARIANCE_PCT;
      return { part: part, bills: mine, bill_total: total, quote: quote, difference: diff, status: off ? (diff > 0 ? 'bill_above_quote' : 'bill_below_quote') : 'bill_matches_quote', final_check: wireCheck };
    });
    r.bill_checks.forEach(function (c) {
      if (c.status === 'bill_above_quote' || c.status === 'bill_below_quote') { r.flags.push(c.part + '_bill_differs_from_quote'); }
      if (c.final_check && !c.final_check.matches) { r.flags.push(c.part + '_warehouse_final_differs_from_bill'); }
      // Max 16 Nov: the BILL is the final cost → put it in the record with the right status (a bill shared by several
      // releases is split by pounds in the profit report, so here it stays an estimate)
      var comp = r[c.part];
      if (comp && c.bills && c.bills.length && c.status !== 'bill_covers_several_releases') {
        comp.bill = c.bill_total; comp.used = c.bill_total; comp.kind = 'bill';
        r.flags = r.flags.filter(function (f) { return f !== c.part + '_paid_waiting_for_bill' && f !== c.part + '_missing'; });
      }
    });
    if (r.freight && r.trucking && r.cost_status !== 'customer_own_transport') {
      var fb = r.freight.kind === 'bill'; var tb = r.trucking.kind === 'bill';
      if (r.freight.used !== null && r.trucking.used !== null) {
        r.combined_used = r2(r.freight.used + r.trucking.used);
        r.cost_status = fb && tb ? 'final' : (fb || tb ? 'partly_provisional' : 'provisional');
      }
    }
    r.flags = uniq(r.flags);
  });
  return records;
}

// The fields a sync compares to decide whether a record changed (and what goes into the history).
export function comparable(rec) {
  return {
    release_number: rec.release_number, customer_name: rec.customer_name, status: rec.status, ship_date: rec.ship_date, ship_date_basis: rec.ship_date_basis,
    freight_estimate: rec.freight ? rec.freight.estimate : null, freight_final: rec.freight ? rec.freight.final : null, freight_used: rec.freight ? rec.freight.used : null, freight_kind: rec.freight ? rec.freight.kind : null,
    trucking_estimate: rec.trucking ? rec.trucking.estimate : null, trucking_final: rec.trucking ? rec.trucking.final : null, trucking_used: rec.trucking ? rec.trucking.used : null, trucking_kind: rec.trucking ? rec.trucking.kind : null,
    combined_used: rec.combined_used, cost_status: rec.cost_status,
    invoice_ids: (rec.invoices || []).map(function (x) { return x.id; }).sort().join(','), flags: (rec.flags || []).slice().sort().join(',')
  };
}
// the same fields read back from a stored row (so a re-sync of unchanged data writes no history)
export function rowComparable(row) {
  return {
    release_number: row.release_number, customer_name: row.customer_name, status: row.status, ship_date: row.ship_date, ship_date_basis: row.ship_date_basis,
    freight_estimate: numOrNull(row.freight_estimate), freight_final: numOrNull(row.freight_final), freight_used: numOrNull(row.freight_used), freight_kind: row.freight_kind,
    trucking_estimate: numOrNull(row.trucking_estimate), trucking_final: numOrNull(row.trucking_final), trucking_used: numOrNull(row.trucking_used), trucking_kind: row.trucking_kind,
    combined_used: numOrNull(row.combined_used), cost_status: row.cost_status,
    invoice_ids: (row.invoice_matches || []).map(function (x) { return x.id; }).sort().join(','), flags: (row.flags || []).slice().sort().join(',')
  };
}
function numOrNull(v) { return v === null || v === undefined || v === '' ? null : r2(v); }
export function diffComparable(a, b) {
  var ch = {}; Object.keys(b).forEach(function (k) { var x = a ? a[k] : undefined; var y = b[k]; if (String(x === undefined || x === null ? '' : x) !== String(y === undefined || y === null ? '' : y)) { ch[k] = { from: x === undefined ? null : x, to: y }; } });
  return ch;
}
// record → the row stored in pl_warehouse_shipping (manual_* columns are never part of it, so a sync never touches them)
export function toRow(rec, nowIso, runId) {
  var f = rec.freight || {}; var t = rec.trucking || {};
  return {
    source: rec.source, section: rec.section, order_id: rec.order_id, release_number: rec.release_number, release_key: rec.release_key,
    customer_name: rec.customer_name, warehouse_name: rec.warehouse_name, status: rec.status, is_bonded: rec.is_bonded, country: rec.country,
    order_created: rec.order_created, shipped_date: rec.shipped_date, load_date: rec.load_date, ship_date: rec.ship_date, ship_date_basis: rec.ship_date_basis,
    sailing_date: rec.sailing_date || null, arrival_date: rec.arrival_date || null, freight_forwarder: rec.freight_forwarder || null, shipping_line: rec.shipping_line || null, trucker_name: rec.trucker_name || null, booking_number: rec.booking_number || null,
    freight_estimate: f.estimate === undefined ? null : f.estimate, freight_estimate_raw: f.estimate_raw || null, freight_final: f.final === undefined ? null : f.final, freight_final_raw: f.final_raw || null,
    freight_paid: f.paid || null, freight_paid_date: f.paid_date || null, freight_invoice: f.invoice || null, freight_used: f.used === undefined ? null : f.used, freight_kind: f.kind || null,
    trucking_estimate: t.estimate === undefined ? null : t.estimate, trucking_estimate_raw: t.estimate_raw || null, trucking_final: t.final === undefined ? null : t.final, trucking_final_raw: t.final_raw || null,
    trucking_paid: t.paid || null, trucking_paid_date: t.paid_date || null, trucking_invoice: t.invoice || null, trucking_used: t.used === undefined ? null : t.used, trucking_kind: t.kind || null,
    combined_used: rec.combined_used, combined_estimate: rec.combined_estimate, cost_status: rec.cost_status, currency: rec.currency, currency_confirmed: rec.currency_confirmed,
    is_shipped: rec.is_shipped, is_closed: rec.is_closed, is_open: rec.is_open, in_backfill: rec.in_backfill, conflict: !!rec.conflict,
    invoice_matches: rec.invoices || [], review_only_invoices: rec.review_only_invoices || [], bill_checks: rec.bill_checks || [], flags: rec.flags || [],
    detail: { freight: rec.freight, trucking: rec.trucking, final_payment: rec.final_payment || null },
    source_link: rec.source_link, last_checked_at: nowIso, last_run_id: runId || null
  };
}

// For the P&L: per release, what the warehouse says the outbound shipping cost is (null = not usable), honouring
// a person's corrections (manual_freight / manual_trucking) and skipping a part the Hub already has a bill for.
export function warehouseOutboundForRelease(rows, billTypesOnRelease) {
  var main = (rows || []).filter(function (r) { return r.section === 'main' && !r.superseded; });
  if (main.length !== 1) { return { usable: false, why: main.length ? 'release on several warehouse orders' : 'no warehouse order' }; }
  var r = main[0]; var has = billTypesOnRelease || {};
  if (r.conflict) { return { usable: false, why: 'test order or release on two warehouse orders', row: r }; }
  function part(name, billType) {
    if (has[billType]) { return { amount: 0, kind: 'bill', covered_by_bill: true }; } // the Hub bill is already in the P&L — not added again
    var man = r['manual_' + name]; if (man !== null && man !== undefined && man !== '') { return { amount: r2(man), kind: 'manual' }; }
    var u = r[name + '_used']; if (u === null || u === undefined) { return null; }
    var k = r[name + '_kind'];
    return { amount: r2(u), kind: k === 'own_transport' ? 'own_transport' : 'estimate' };
  }
  var f = part('freight', 'shipping'); var t = part('trucking', 'trucking');
  if (!f || !t) { return { usable: false, why: (!f ? 'freight' : 'trucking') + ' missing in the warehouse', row: r }; }
  var amount = r2(f.amount + t.amount);
  // Max 16 Nov (workflow): a cost is confirmed FINAL only by a bill in the Hub. Anything from the warehouse (quote, paid wire,
  // own-transport inference) or typed by a person stays an ESTIMATE until its bill is entered.
  var allFinal = f.kind === 'bill' && t.kind === 'bill';
  return { usable: true, amount: amount, final: allFinal, own_transport: f.kind === 'own_transport' && t.kind === 'own_transport', freight: f, trucking: t, row: r };
}

// CNF / EXW by Max's rule (Nov 16, refined the same day): the invoice should SAY CNF or EXW.
//   • says CNF → CNF. A shipping line may or may not be there; with none, the shipping is inside the price.
//   • says EXW → EXW. It should have a shipping-charge line; if it has none, that is flagged.
//   • says neither → the old rule as a labelled guess (shipping line with an amount → EXW; none + warehouse costs → CNF),
//     ALWAYS flagged "basis not stated on the invoice" for review.
export function statedBasis(text) {
  var t = String(text || '');
  var cnf = /\bcnf\b|\bc\s*&\s*f\b|\bc\s+and\s+f\b|\bcfr\b|\bcif\b/i.test(t); var exw = /\bexw\b|\bex[\s-]?works\b/i.test(t);
  if (cnf && exw) { return 'BOTH'; }
  return cnf ? 'CNF' : (exw ? 'EXW' : null);
}
export function inferBasis(hasChargedTransportLine, warehouseHasCost) {
  if (hasChargedTransportLine) { return 'EXW'; }
  if (warehouseHasCost) { return 'CNF'; }
  return null;
}

// the review queue: one line per problem a person must look at
export var FLAG_TEXT = {
  freight_missing: 'Freight: no quote and no final in the warehouse', trucking_missing: 'Trucking: no quote and no final in the warehouse',
  freight_final_suspicious: 'Freight wire does not look like this order’s payment — quote kept', trucking_final_suspicious: 'Trucking wire does not look like this order’s payment — quote kept',
  freight_final_suspicious_no_quote: 'Freight wire looks unusual and there is no quote to check it against', trucking_final_suspicious_no_quote: 'Trucking wire looks unusual and there is no quote to check it against',
  freight_closed_final_missing: 'Closed, but no freight wire recorded — quote kept', trucking_closed_final_missing: 'Closed, but no trucking wire recorded — quote kept',
  freight_wire_not_marked_paid: 'Freight wire recorded but not marked paid — quote kept until it is', trucking_wire_not_marked_paid: 'Trucking wire recorded but not marked paid — quote kept until it is',
  freight_quote_unreadable: 'Freight quote is not a plain number', trucking_quote_unreadable: 'Trucking quote is not a plain number (e.g. “1400+150”)',
  freight_final_unreadable: 'Freight wire is not a plain number', trucking_final_unreadable: 'Trucking wire is not a plain number',
  currency_not_recorded_assumed_usd: 'Warehouse does not record the currency — taken as USD, not confirmed',
  ship_date_unknown: 'Shipped, but no shipped date or load date', ship_date_far_from_load_date: 'Shipped date is more than 2 days from the load date', ship_date_in_future: 'Ship date is in the future', shipped_date_on_unshipped_order: 'Has a shipped date but the order is not at Shipped yet',
  two_shipping_in_process_rows_differ: 'Two different “Shipping In Process” entries — the latest is used', two_closed_rows_differ: 'Two different “Closed” entries — the latest is used',
  no_release_number: 'No release number on the warehouse order', release_on_two_warehouse_orders: 'This release number is on two warehouse orders — not used until decided',
  no_hub_invoice_for_release: 'No Hub invoice carries this release number', invoice_only_by_po_so_field: 'Only an invoice’s PO/SO field has this release — check it, not used automatically',
  several_invoices_share_this_release: 'Several invoices on this release — the cost is split by pounds and counted once', invoice_currency_not_usd: 'An invoice on this release is not in USD',
  freight_bill_differs_from_quote: 'The forwarder’s bill in the Hub differs from the quote (demurrage? extra charges?)', trucking_bill_differs_from_quote: 'The trucker’s bill in the Hub differs from the quote (waiting time? extra stop?)',
  test_order_not_used: 'Test order on the warehouse copy — never used in the P&L',
  freight_wire_shared_by_several_orders: 'The same freight wire (amount and date) is on several orders — one payment for several; quote kept', trucking_wire_shared_by_several_orders: 'The same trucking wire (amount and date) is on several orders — one payment for several; quote kept',
  freight_paid_waiting_for_bill: 'Freight paid in the warehouse, but the forwarder’s bill is not in the Hub yet — the estimate is used until the bill is entered',
  trucking_paid_waiting_for_bill: 'Trucking paid in the warehouse, but the trucker’s bill is not in the Hub yet — the estimate is used until the bill is entered',
  freight_warehouse_final_differs_from_bill:'The freight wire in the warehouse is not the amount the forwarder billed — the BILL is used; please correct one of them',
  trucking_warehouse_final_differs_from_bill: 'The trucking wire in the warehouse is not the amount the trucker billed — the BILL is used; please correct one of them',
  canada_shipping_recorded_but_no_amount:'Canada order: the warehouse shows a forwarder, trucker, payment, invoice or bank, but no amount — cost unknown, please fill it in',
  canada_customer_own_transport_inferred:'Canada order with every shipping box empty — taken as the customer’s own transport (cost 0, inferred). Check if wrong',
  customer_name_differs_from_hub_invoice: 'Customer name in the warehouse differs from the Hub invoice (release number still matches — note only)',
  obsolete_section_costs_are_on_the_main_order:'Obsolete-section order — its shipping cost is on the main order of the same release'
};
