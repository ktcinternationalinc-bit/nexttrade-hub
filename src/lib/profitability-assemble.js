// v55.83-SY — turns the Hub's real rows (invoices, invoice lines, bills, bill lines, and the report set-up tables) into the
// input of the profitability engine, runs it, and returns the three views. Pure: it is handed rows and returns numbers.
// It reads invoices and bills; it never changes them.
//
// Order of work (it matters — Max: "Calculate them before report grouping or filtering so a filtered view cannot
// change a shipment's costs"):
//   1. every invoice that shares a release with an invoice in the chosen period is brought in, so a release's costs are
//      split across ALL of its goods, not only the ones inside the period;
//   2. pounds per release are worked out; 3. each transportation / brokerage / bonded bill is split between its releases;
//   4. the engine splits each release's share across its goods; 5. only THEN are the period's rows summed and grouped.
import { warehouseOutboundForRelease, inferBasis, statedBasis, isWarehouseTestRow } from './warehouse-shipping'; // v55.83-TG
import { basisOfTerms, invoiceEstimatesByRelease, minShippingCharge, isSurchargeOnlyLine } from './shipping-terms'; // v55.83-TG (+ UE surcharge rule)
import { billLineUnit, BONDED_PER_HOUSTON_RELEASE, nameKey, relKey, unitKey, buildCells, summarize, reconcile, resolveCost, splitBillAcrossReleases, releaseOrigin, isTransportLine, suggestBasis, DEFAULT_UNIT_FACTORS, r2, isFoamName, foamFactors } from './profitability';

// "1001-1567 / 1001-1570", "1002-88 & 1002-89", "1001-1, 1001-2" → the separate release numbers on one invoice or bill
export function splitReleases(text) {
  var out = []; var seen = {};
  String(text || '').split(/\s*(?:[,;&\/+]|\band\b)\s*/i).forEach(function (part) {
    var raw = part.trim(); var k = relKey(raw);
    if (k && !seen[k]) { seen[k] = true; out.push({ key: k, raw: raw }); }
  });
  return out;
}
// v55.83-TL — paper / foil goods carry no bond charge (Max, Nov 17)
export function isPaperOrFoil(text) { return /\bpapers?\b|\bfoils?\b/i.test(String(text || '')); }
function isLive(i) { var st = i.record_status; return st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'; }
function lineName(it) { return String(it.wave_product_name || it.description || '').trim() || '(no description)'; }

export function assembleProfitability(d) {
  var from = d.date_from || ''; var to = d.date_to || '';
  var flags = []; var unallocated = [];

  // ── the set-up a person made ──
  var factors = { units: Object.assign({}, DEFAULT_UNIT_FACTORS) };
  (d.factors || []).forEach(function (f) { var u = unitKey(f.unit); if (u && Number(f.pounds_per_unit) > 0) { factors.units[u] = Number(f.pounds_per_unit); } });
  // v55.83-TB (Max, Nov 16: "if we merge later with the same name to a group that we forgot to add in the first place, just merge
  // any and all with the same Name") — groups whose names are the same (ignoring capitals, spaces and punctuation) are ONE product.
  // The OLDEST group is the one shown; the others' descriptions and supplier links are added to it.
  var groupById = {}; var canonOf = {}; var canonByName = {};
  (d.groups || []).filter(function (g) { return g.active !== false; }).sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)); }).forEach(function (g) {
    var k = nameKey(g.display_name) || ('id:' + g.id);
    if (!canonByName[k]) { canonByName[k] = g.id; groupById[g.id] = { id: g.id, name: g.display_name, invoice_names: [], bill_names: [], merged_group_ids: [] }; }
    else { groupById[canonByName[k]].merged_group_ids.push(g.id); }
    canonOf[g.id] = canonByName[k];
  });
  var groupOfInvoiceName = {}; var billKeysOfGroup = {}; var seenName = {};
  (d.groupNames || []).forEach(function (n) {
    var gid = canonOf[n.group_id];
    if (n.active === false || !gid || !groupById[gid]) { return; }
    var sk = gid + '|' + n.source + '|' + n.name_key; if (seenName[sk]) { return; } seenName[sk] = true; // the same name in two same-name groups counts once
    if (n.source === 'invoice') { groupOfInvoiceName[n.name_key] = groupById[gid]; groupById[gid].invoice_names.push({ key: n.name_key, name: n.raw_name }); }
    else { (billKeysOfGroup[gid] = billKeysOfGroup[gid] || []).push(n.name_key); groupById[gid].bill_names.push({ key: n.name_key, name: n.raw_name }); }
  });
  var unitOfName = {}; (d.nameUnits || []).forEach(function (u) { unitOfName[u.name_key] = u.unit; });
  var unitOfLine = {}; (d.lineUnits || []).forEach(function (u) { unitOfLine[u.invoice_item_id] = u.unit; });
  var kindOf = {}; (d.nameKinds || []).forEach(function (k) { kindOf[k.name_key] = k.kind; }); // v55.83-TD
  var custBasis = {}; (d.customerTerms || []).forEach(function (t) { custBasis[t.customer_id] = t.basis; }); // v55.83-TE
  var lineCost = {}; (d.lineCosts || []).forEach(function (x) { lineCost[x.invoice_item_id] = x; }); var groupCost = {}; (d.groupCosts || []).forEach(function (x) { groupCost[x.group_id] = x; }); // TE — typed by hand
  var termsOf = {}; (d.terms || []).forEach(function (t) { termsOf[t.invoice_id] = t; });
  var relPoundsOfLine = {}; (d.lineReleasePounds || []).forEach(function (x) { (relPoundsOfLine[x.invoice_item_id] = relPoundsOfLine[x.invoice_item_id] || {})[x.release_key] = Number(x.pounds) || 0; });
  var estimateOf = {}; (d.estimates || []).forEach(function (e) { estimateOf[e.release_key] = Number(e.outbound_estimate); });
  // v55.83-TG — the warehouse's shipping costs per release (shown always; USED only when Max's switch is on)
  var warehouseOn = d.warehouseOn === true; var whByRel = {};
  // Codex 16 Nov (P1): a TEST order is quarantined — it never reaches basis inference, cost status, the split or totals
  (d.warehouseRows || []).forEach(function (w) { if (w.release_key && !w.superseded && !isWarehouseTestRow(w)) { (whByRel[w.release_key] = whByRel[w.release_key] || []).push(w); } });
  function whHasCost(keys) { return keys.some(function (k) { return (whByRel[k] || []).some(function (w) { return w.section === 'main' && !w.conflict && ((Number(w.freight_used) || 0) > 0 || (Number(w.trucking_used) || 0) > 0 || (Number(w.manual_freight) || 0) > 0 || (Number(w.manual_trucking) || 0) > 0); }); }); }

  // ── invoices ──
  var live = (d.invoices || []).filter(isLive).filter(function (i) { return (i.currency || 'USD') === 'USD'; });
  var relRaw = {}; var relsOfInv = {};
  live.forEach(function (i) { relsOfInv[i.id] = splitReleases(i.release_number); relsOfInv[i.id].forEach(function (r) { relRaw[r.key] = r.raw; }); });
  function inPeriod(i) { var dt = String(i.invoice_date || '').substring(0, 10); return (!from || dt >= from) && (!to || dt <= to); }
  var periodIds = {}; var periodRels = {};
  live.forEach(function (i) { if (inPeriod(i)) { periodIds[i.id] = true; relsOfInv[i.id].forEach(function (r) { periodRels[r.key] = true; }); } });
  var scope = live.filter(function (i) { return periodIds[i.id] || relsOfInv[i.id].some(function (r) { return periodRels[r.key]; }); });
  var scopeIds = {}; scope.forEach(function (i) { scopeIds[i.id] = true; });
  var itemsOf = {};
  (d.items || []).forEach(function (it) { if (scopeIds[it.invoice_id]) { (itemsOf[it.invoice_id] = itemsOf[it.invoice_id] || []).push(it); } });

  var engineInvoices = scope.map(function (i) {
    var t = termsOf[i.id] || {};
    var lines = (itemsOf[i.id] || []).filter(function (it) { return (Number(it.quantity) || 0) !== 0 || (Number(it.unit_price) || 0) !== 0; }).map(function (it) {
      var nm = lineName(it);
      return { id: it.id, description: nm, qty: Number(it.quantity) || 0, unit: unitOfLine[it.id] || unitOfName[nameKey(nm)] || '', unit_price: Number(it.unit_price) || 0,
        amount: r2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)), release_pounds: relPoundsOfLine[it.id] || null,
        foam: isFoamName(it.wave_product_name) || isFoamName(it.description), // v55.83-UZ — "anything with foam": product name or description
        transport: kindOf[nameKey(nm)] === 'transport' ? true : (kindOf[nameKey(nm)] === 'goods' ? false : undefined) };
    });
    var text = lines.map(function (l) { return l.description; }).join(' · ');
    // v55.83-TG (Max, Nov 16) — CNF / Ex Works by the rule: a shipping-charge LINE with an amount = Ex Works; no such line and the
    // warehouse order has shipping costs = CNF. Used only when nothing was set by a person; labelled 'inferred'; conflicts flagged.
    // Refined by Max the same day: the invoice should SAY CNF or EXW; CNF may or may not have a shipping line (none = in the
    // price); EXW should have one; saying neither is always flagged for review. Later: learn each customer's history.
    var tBasis = t.basis || custBasis[i.accounting_customer_id] || null; var tSource = t.basis ? 'invoice' : (custBasis[i.accounting_customer_id] ? 'customer' : null);
    // v55.83-TG — the shipping terms chosen ON THE INVOICE are the one value (same row); they decide the basis
    if (t.shipping_terms && basisOfTerms(t.shipping_terms)) { tBasis = basisOfTerms(t.shipping_terms); tSource = 'invoice_form'; }
    // v55.83-TJ (Max, Nov 17: "if there is a shipping line then assume it is exw or cnf with shipping NOT included in the price and
    // cost of the goods") — an invoice with a shipping line that carries an amount: the goods price is goods only and the shipping is
    // charged on that line. Not set by anyone → EXW, or CNF when the invoice text says CNF. Only "CNF included" chosen on the form
    // overrides it. Noted on the invoice, so a person can still set it differently.
    var hasShipLine = lines.some(function (l) { return (l.transport === true || (l.transport !== false && isTransportLine(l.description))) && l.amount > 0; });
    var saidText = statedBasis(text); var effTerms = t.shipping_terms || null;
    // v55.83-UE (Max, Nov 18) — CNF with the shipping INSIDE the price (e.g. Maa Kirpa) plus a SURCHARGE line: the surcharge is extra
    // transport income; the invoice stays "CNF, shipping included" and the container's shipping cost still comes out of the goods price.
    // Only a line that names freight / trucking / shipping / delivery counts as the shipping being charged separately.
    var hasFreightLine = lines.some(function (l) { return (l.transport === true || (l.transport !== false && isTransportLine(l.description))) && l.amount > 0 && !(l.transport !== true && isSurchargeOnlyLine(l.description)); });
    var surchargeOnCnf = hasShipLine && !hasFreightLine && t.shipping_terms !== 'CNF_SEPARATE' && t.shipping_terms !== 'EXW' && (tBasis === 'CNF' || (!tBasis && saidText === 'CNF'));
    if (surchargeOnCnf) { if (!tBasis) { tBasis = 'CNF'; tSource = 'invoice_text'; } effTerms = 'CNF_INCLUDED'; }
    if (hasShipLine && t.shipping_terms !== 'CNF_INCLUDED' && !surchargeOnCnf) {
      if (!tBasis) { tBasis = saidText === 'CNF' ? 'CNF' : 'EXW'; tSource = 'shipping_line_rule'; flags.push({ kind: 'basis_assumed_from_shipping_line', invoice: i.invoice_number, invoice_id: i.id, basis: tBasis }); }
      if (!effTerms) { effTerms = tBasis === 'EXW' ? 'EXW' : ((tBasis === 'CNF' || tBasis === 'TRUCKING_INCLUDED') ? 'CNF_SEPARATE' : null); }
    }
    var charged = false;
    if (warehouseOn) {
      charged = surchargeOnCnf ? false : lines.some(function (l) { return (l.transport === true || (l.transport !== false && isTransportLine(l.description))) && l.amount > 0; }); // UE: a surcharge on CNF-included is not 'shipping charged on a line'
      var relKeys = relsOfInv[i.id].map(function (r) { return r.key; });
      var whCost = whHasCost(relKeys);
      var said = statedBasis(text);
      var fl = function (kind) { flags.push({ kind: kind, invoice: i.invoice_number, invoice_id: i.id, basis_source: tSource }); };
      if (said === 'BOTH') { fl('basis_invoice_says_both_cnf_and_exw'); }
      if (tBasis) { if ((said === 'CNF' || said === 'EXW') && said !== tBasis && (tBasis === 'CNF' || tBasis === 'EXW')) { fl('basis_set_differs_from_invoice_text'); } }
      else if (said === 'CNF' || said === 'EXW') { tBasis = said; tSource = 'invoice_text'; }
      else if (relKeys.length) { var inf = inferBasis(charged, whCost); if (inf) { tBasis = inf; tSource = 'inferred'; } fl('basis_not_stated_on_invoice'); }
      if (tBasis === 'EXW' && !charged && whCost) { fl('basis_exw_without_shipping_line'); }
      if (charged && relKeys.some(function (k) { return (whByRel[k] || []).some(function (w) { return w.section === 'main' && w.cost_status === 'customer_own_transport'; }); })) { fl('own_transport_but_invoice_charges_shipping'); }
    }
    return { id: i.id, number: i.invoice_number, date: String(i.invoice_date || '').substring(0, 10), customer: (d.customerNames || {})[i.accounting_customer_id] || '(unknown customer)',
      customer_id: i.accounting_customer_id || null, basis: tBasis, basis_source: tSource, charged_transport: charged,
      shipping_terms: t.shipping_terms || null, effective_terms: effTerms, has_shipping_line: hasShipLine, surcharge_on_cnf: surchargeOnCnf, shipping_cost_estimate: t.shipping_cost_estimate === undefined || t.shipping_cost_estimate === null ? null : Number(t.shipping_cost_estimate),
      embedded_transport: t.embedded_transport === undefined ? null : t.embedded_transport, manual_embedded: t.embedded_transport !== undefined && t.embedded_transport !== null && t.embedded_transport !== '', releases: relsOfInv[i.id].map(function (r) { return r.key; }), lines: lines,
      _suggest: suggestBasis(text, lines.some(function (l) { return isTransportLine(l.description); })) };
  });

  // ── bills ──
  var billById = {}; (d.bills || []).forEach(function (b) { if (b.record_status === 'active') { billById[b.id] = b; } });
  var costLines = []; var badUnitLines = 0;
  (d.billLines || []).forEach(function (l) {
    var b = billById[l.bill_id];
    if (!b || l.line_kind !== 'item') { return; }
    if (b.bill_type === 'trucking' || b.bill_type === 'shipping' || b.bill_type === 'bonded_brokerage') { return; } // those are services, not goods
    costLines.push({ bill_id: b.id, bill_number: b.bill_number, vendor: b.vendor_name, bill_date: b.bill_date, release: b.release_number, description: l.description, qty: l.qty, unit: l.unit, cost_amount: l.cost_amount, amount: l.amount, commission_amount: l.commission_amount });
  });
  var linkedBillKeys = {}; Object.keys(billKeysOfGroup).forEach(function (g) { billKeysOfGroup[g].forEach(function (k) { linkedBillKeys[k] = true; }); });
  costLines.forEach(function (l) { if (linkedBillKeys[nameKey(l.description)] && !billLineUnit(l)) { badUnitLines++; flags.push({ kind: 'bill_line_unit_unknown', bill: l.bill_number, vendor: l.vendor, line: l.description, unit: l.unit || null }); } });

  var linkStats = {}; // v55.83-TE — per product group: linked supplier lines found / with a usable unit / earliest date
  Object.keys(billKeysOfGroup).forEach(function (g) { var want = {}; billKeysOfGroup[g].forEach(function (k) { want[k] = true; }); var st = { lines: 0, usable: 0, first: '' };
    costLines.forEach(function (l) { if (!want[nameKey(l.description)]) { return; } st.lines++; if (billLineUnit(l)) { st.usable++; var dt = String(l.bill_date || '').substring(0, 10); if (dt && (!st.first || dt < st.first)) { st.first = dt; } } });
    linkStats[g] = st; });
  function groupOf(desc) { return groupOfInvoiceName[nameKey(desc)] || null; }
  // v55.83-UL — supplier descriptions that come FREE (Max: Texas Cardboard): their $0 is a real zero cost
  var freeNameKeys = {}; (d.freeBillNames || []).forEach(function (f) { if (f && f.name_key && f.active !== false) { freeNameKeys[f.name_key] = true; } });
  function costOf(inv, cell) {
    var keys = cell.group_id ? (billKeysOfGroup[cell.group_id] || []) : [];
    // nothing linked on purpose = no cost from bills; similar names are never assumed to be the same product
    var fromBills = keys.length ? resolveCost({ billNameKeys: keys, invoiceDate: inv.date, releases: inv.releases, productKey: cell.product_key }, costLines, { windowDays: d.windowDays > 0 ? d.windowDays : 90, factors: cell.foam === true ? foamFactors(factors) : factors, freeNameKeys: freeNameKeys }) : null; // v55.83-UZ — a foam sale's purchases in yards weigh 3 lb per yard too, so cost per yard is unchanged
    // v55.83-TE — only now a cost typed by hand: this sale's own, else the product's default
    var m = (cell.line_id && lineCost[cell.line_id]) ? { x: lineCost[cell.line_id], level: 'sale' } : ((cell.group_id && groupCost[cell.group_id]) ? { x: groupCost[cell.group_id], level: 'product default' } : null);
    // v55.83-TJ — a cost a person typed wins over the "bought before our first bill" assumption
    if (fromBills && !fromBills.cost_unknown && fromBills.base_per_lb !== null && !(fromBills.method === 'assumed_earliest' && m && Number(m.x.cost_per_lb) > 0)) { return fromBills; }
    m =(cell.line_id && lineCost[cell.line_id]) ? { x: lineCost[cell.line_id], level: 'sale' } : ((cell.group_id && groupCost[cell.group_id]) ? { x: groupCost[cell.group_id], level: 'product default' } : null);
    if (m && Number(m.x.cost_per_lb) > 0) { return { base_per_lb: Number(m.x.cost_per_lb), commission_per_lb: Number(m.x.commission_per_lb) || 0, method: 'manual', level: m.level, note: m.x.note || null, sources: [] }; }
    return fromBills;
  }

  // pass 1 — pounds per release (a release is usable for a split only when every goods line on it has its pounds)
  var p1 = buildCells({ invoices: engineInvoices, groupOf: groupOf, factors: factors });
  var relPounds = {}; var relBad = {};
  p1.cells.forEach(function (c) { if (!c.release) { return; } if (c.pounds === null || !(c.pounds > 0)) { relBad[c.release] = true; } else { relPounds[c.release] = (relPounds[c.release] || 0) + c.pounds; } });
  Object.keys(relBad).forEach(function (k) { delete relPounds[k]; });
  var relKnown = {}; p1.cells.forEach(function (c) { if (c.release) { relKnown[c.release] = true; } });

  var outbound = {}; var brokerage = {}; var bonded = {}; var bondBill = {}; var bondBillInfo = {}; var bondedFrom = {}; var truckCount = {}; var actualBonded = [];
  function addShare(map, rel, amount, bill, field) {
    if (field) { var o = map[rel] || (map[rel] = { actual: null, estimate: null, bills: [] }); o.actual = r2((o.actual || 0) + amount); o.bills.push(bill); }
    else { map[rel] = r2((map[rel] || 0) + amount); }
  }
  Object.keys(billById).forEach(function (id) {
    var b = billById[id]; var type = b.bill_type;
    if (type !== 'trucking' && type !== 'shipping' && type !== 'bonded_brokerage') { return; }
    var rels = splitReleases(b.release_number);
    var mineRels = rels.filter(function (r) { return relKnown[r.key]; });
    var amount = r2(b.total_amount);
    var info = { bill_id: b.id, bill_number: b.bill_number, vendor: b.vendor_name, bill_date: b.bill_date, amount: amount, type: type };
    if (type === 'bonded_brokerage') {
      var isBonded = /bond/i.test(String(b.vendor_name || ''));
      // v55.83-TC — bonded is the standard $200 per Houston shipment; actual bonded bills are listed for comparison, never added on top
      // v55.83-TN (Max, Nov 17: 'no need for brokerage column as bonded are the same thing') — a brokerage bill IS the bond cost, so it is
      // listed for comparison only, like a bonded bill; the standard $200 per Houston container is what goes into the P&L (never both).
      // v55.83-TN (Max, Nov 17: "the actual brokerage bills for a specific release can override the $200, but only if sure; otherwise keep
      // 200") — SURE = the bill names exactly ONE release, it is a Houston (1002-) release, and that release is in this report. Then the
      // bill amount REPLACES the $200 for that container. A bill with no release, several releases or a non-Houston release is listed for
      // comparison only and the $200 stays.
      if (rels.length === 1 && mineRels.length === 1 && releaseOrigin(rels[0].raw, '').origin === 'HOUSTON') {
        var bk = rels[0].key; bondBill[bk] = r2((bondBill[bk] || 0) + amount); (bondBillInfo[bk] = bondBillInfo[bk] || []).push(info);
        return;
      }
      if (inPeriod({ invoice_date: b.bill_date })) { actualBonded.push(Object.assign({ why_not_used: !rels.length ? 'no release number' : (rels.length > 1 ? 'covers several releases' : 'not a Houston release') }, info)); }
      return;
      if (!rels.length) { if (inPeriod({ invoice_date: b.bill_date })) { unallocated.push({ what: isBonded ? 'bonded_pool' : 'brokerage_pool', bill: b.bill_number, vendor: b.vendor_name, bill_date: b.bill_date, amount: amount, why: 'no release number on this bill — it must be assigned to Houston releases by a person' }); } return; }
      if (!mineRels.length) { return; }
      var notHouston = rels.filter(function (r) { return releaseOrigin(r.raw, '').origin !== 'HOUSTON'; });
      if (notHouston.length) { flags.push({ kind: 'brokerage_bill_on_non_houston_release', bill: b.bill_number, vendor: b.vendor_name, releases: notHouston.map(function (r) { return r.raw; }), amount: amount }); unallocated.push({ what: isBonded ? 'bonded' : 'brokerage', bill: b.bill_number, vendor: b.vendor_name, amount: amount, why: 'its release is not a Houston release (or its origin is unknown)' }); return; }
      var sB = splitBillAcrossReleases({ amount: amount, releases: rels.map(function (r) { return { release: r.raw }; }) }, relPounds);
      if (sB.problem && sB.problem !== 'duplicate_release_link') { flags.push({ kind: 'bill_split_unresolved', bill: b.bill_number, vendor: b.vendor_name, why: sB.problem, amount: amount }); unallocated.push({ what: isBonded ? 'bonded' : 'brokerage', bill: b.bill_number, amount: amount, why: sB.problem }); return; }
      Object.keys(sB.shares).forEach(function (rel) { addShare(isBonded ? bonded : brokerage, rel, sB.shares[rel], info, false); });
      return;
    }
    // trucking / shipping: only OUTBOUND bills are our outbound transportation expense
    if (!mineRels.length) { return; }
    if (b.shipment_direction !== 'outbound') { flags.push({ kind: 'transport_bill_not_marked_outbound', bill: b.bill_number, vendor: b.vendor_name, releases: rels.map(function (r) { return r.raw; }), direction: b.shipment_direction || null, amount: amount }); return; }
    var sT = splitBillAcrossReleases({ amount: amount, releases: rels.map(function (r) { return { release: r.raw }; }) }, relPounds);
    if (sT.problem && sT.problem !== 'duplicate_release_link') { flags.push({ kind: 'bill_split_unresolved', bill: b.bill_number, vendor: b.vendor_name, why: sT.problem, amount: amount }); unallocated.push({ what: 'outbound_cost', bill: b.bill_number, amount: amount, why: sT.problem }); return; }
    Object.keys(sT.shares).forEach(function (rel) {
      addShare(outbound, rel, sT.shares[rel], Object.assign({ share: sT.shares[rel] }, info), true);
      if (type === 'trucking') { truckCount[rel] = (truckCount[rel] || 0) + 1; }
    });
  });
  Object.keys(truckCount).forEach(function (rel) { if (truckCount[rel] > 1) { flags.push({ kind: 'two_trucking_bills_on_one_release', release: relRaw[rel] || rel, count: truckCount[rel], bills: (outbound[rel].bills || []).filter(function (x) { return x.type === 'trucking'; }).map(function (x) { return x.bill_number; }) }); } });
  // v55.83-TC — $200 bonded per Houston (1002-) shipment. v55.83-TL (Max, Nov 17: "anything coming out of the USA that's not paper or
  // [foil] should have a $200 bond charge on that container") — a container carrying only paper / foil has no bond charge.
  var noBondRel = {};
  p1.cells.forEach(function (c) { if (!c.release) { return; } if (!isPaperOrFoil(c.description) && !isPaperOrFoil(c.product)) { noBondRel[c.release] = false; } else if (noBondRel[c.release] === undefined) { noBondRel[c.release] = true; } });
  Object.keys(relKnown).forEach(function (rel) {
    if (bondBill[rel] !== undefined) { bonded[rel] = bondBill[rel]; bondedFrom[rel] = 'bill ' + bondBillInfo[rel].map(function (x) { return x.bill_number; }).join(', '); return; } // a bill for this one container wins
    if (releaseOrigin(relRaw[rel] || rel, '').origin === 'HOUSTON') { bonded[rel] = noBondRel[rel] === true ? 0 : BONDED_PER_HOUSTON_RELEASE; bondedFrom[rel] = noBondRel[rel] === true ? 'none — paper / foil' : 'standard $200'; }
  });
  // v55.83-TL (Max, Nov 17: "trucking is its own type of business ... add columns for the trucking and the freight forwarding or
  // shipping, two different columns. So when you have one number, you can show it ... we should manually be able to enter it, and
  // then it gets overridden if you have a bill ... for that specific release number") — per release, EACH PART on its own:
  //   1 the Hub bill for that part (trucking bill / shipping bill) = final
  //   2 a figure typed in the Hub for that part (this release)
  //   3 Nextrade "Shipping In Progress" (estimate)
  // A part with nothing stays empty; the other part is still shown and used. Older typed totals are used only when no part is known.
  function numOrNull(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : r2(v); }
  var typedPart = {}; (d.partEstimates || []).forEach(function (e) { var o = typedPart[e.release_key] || (typedPart[e.release_key] = {}); var v = numOrNull(e.amount); if (v !== null && (e.part === 'trucking' || e.part === 'freight')) { o[e.part] = { amount: v, note: e.note || null }; } });
  var whUsed = {}; var partsUsed = {};
  Object.keys(relKnown).forEach(function (rel) {
    var o = outbound[rel] || { actual: null, estimate: null, bills: [] };
    var wRows = warehouseOn ? (whByRel[rel] || []).filter(function (w) { return w.section === 'main' && !w.superseded; }) : [];
    if (wRows.length > 1) { flags.push({ kind: 'warehouse_cost_not_usable', release: relRaw[rel] || rel, why: 'release on several warehouse orders' }); }
    var wRow = wRows.length === 1 && !wRows[0].conflict ? wRows[0] : null;
    if (wRows.length === 1 && wRows[0].conflict) { flags.push({ kind: 'warehouse_cost_not_usable', release: relRaw[rel] || rel, why: 'test order or release on two warehouse orders' }); }
    function part(name, billType) {
      var bl = (o.bills || []).filter(function (b) { return b.type === billType; });
      if (bl.length) { return { amount: r2(bl.reduce(function (s0, b) { return s0 + (b.share !== undefined ? b.share : b.amount); }, 0)), kind: 'bill', from: 'bill ' + bl.map(function (b) { return b.bill_number; }).join(', ') }; }
      var tp = typedPart[rel] && typedPart[rel][name]; if (tp) { return { amount: tp.amount, kind: 'manual', from: 'typed in the Hub' + (tp.note ? ' — ' + tp.note : '') }; }
      if (wRow) {
        var wm = numOrNull(wRow['manual_' + name]); if (wm !== null) { return { amount: wm, kind: 'manual', from: 'typed correction (warehouse)' }; }
        var u = numOrNull(wRow[name + '_used']); if (u !== null) { return { amount: u, kind: wRow[name + '_kind'] === 'own_transport' ? 'own_transport' : 'estimate', from: wRow[name + '_kind'] === 'own_transport' ? 'customer’s own transport (Nextrade)' : 'Nextrade Shipping In Progress' }; }
      }
      return null;
    }
    var t = part('trucking', 'trucking'); var f = part('freight', 'shipping');
    var pu = { trucking: t, freight: f, legacy_total: null };
    partsUsed[rel] = pu;
    if (!t && !f) {
      if (estimateOf[rel] !== undefined && !isNaN(Number(estimateOf[rel]))) { var lo = outbound[rel] || (outbound[rel] = o); lo.actual = null; lo.estimate = r2(estimateOf[rel]); pu.legacy_total = lo.estimate; }
      return;
    }
    var oo = outbound[rel] || (outbound[rel] = o);
    var amt = r2((t ? t.amount : 0) + (f ? f.amount : 0));
    var known = [t, f].filter(function (x) { return !!x; });
    var allBill = known.every(function (x) { return x.kind === 'bill'; });
    // Codex 16 Nov (P1) kept: when Nextrade has the order and says a part is still missing, a bill for the other part is not "complete"
    var partial = !!wRow && (!t || !f);
    if (allBill && !partial) { oo.actual = amt; oo.estimate = null; } else { oo.actual = null; oo.estimate = amt; }
    oo.partial = partial;
    if (wRow && known.some(function (x) { return x.kind !== 'bill' && x.from.indexOf('Nextrade') >= 0; })) { whUsed[rel] = { final: false, amount: amt, row: wRow }; oo.warehouse = { amount: amt, final: false, order_id: wRow.order_id, link: wRow.source_link }; }
    if (partial) { flags.push({ kind: 'warehouse_cost_not_usable', release: relRaw[rel] || rel, why: (!t ? 'trucking' : 'freight') + ' missing in the warehouse — the other part is used' }); }
  });

  // v55.83-TG — the shipping cost typed ON THE INVOICE: an ESTIMATE, used only when the release has no bill, no typed release
  // estimate and no warehouse figure. A bill always replaces it (Max: "Final confirmed value is based on bill").
  var invEst = invoiceEstimatesByRelease(engineInvoices.map(function (iv) { return { invoice_id: iv.id, invoice_number: iv.number, shipping_terms: iv.shipping_terms, shipping_cost_estimate: iv.shipping_cost_estimate, releases: iv.releases }; }), relPounds);
  (invEst.__unresolved || []).forEach(function (u) { flags.push({ kind: 'invoice_shipping_estimate_split_unresolved', invoice: u.invoice, releases: u.releases.map(function (k) { return relRaw[k] || k; }), amount: u.amount }); });
  delete invEst.__unresolved;
  Object.keys(invEst).forEach(function (rel) {
    if (!relKnown[rel]) { return; }
    var o = outbound[rel];
    if (o && ((o.actual !== null && o.actual !== undefined) || (o.estimate !== null && o.estimate !== undefined))) { return; }
    o = outbound[rel] || (outbound[rel] = { actual: null, estimate: null, bills: [] });
    o.estimate = invEst[rel].amount; o.from_invoice_form = true;
    if (invEst[rel].differ) { flags.push({ kind: 'invoice_shipping_estimates_differ', release: relRaw[rel] || rel, invoices: invEst[rel].invoices, used: invEst[rel].amount }); }
  });

  // pass 2 — everything
  var full = buildCells({ invoices: engineInvoices, groupOf: groupOf, costOf: costOf, outbound: outbound, brokerage: brokerage, bonded: bonded, factors: factors });
  // v55.83-TE (Max, Nov 16, option A) — a CNF / trucking-included invoice with NO amount typed for the transportation inside its price:
  // use what shipping that invoice's goods actually cost (its share of its container's shipping bill, or of the estimate). Labelled
  // 'container cost'. A typed amount always wins. If the container's cost is not known, nothing is taken out ("not separated").
  var shareOf = {}; var shareKind = {}; var shareBad = {};
  full.cells.forEach(function (c) {
    if (c.outbound_cost === null || c.outbound_cost === undefined) { shareBad[c.invoice_id] = true; return; }
    shareOf[c.invoice_id] = r2((shareOf[c.invoice_id] || 0) + c.outbound_cost);
    if (c.outbound_kind === 'estimate') { shareKind[c.invoice_id] = 'estimate'; }
  });
  var usedContainerCost = 0;
  engineInvoices.forEach(function (iv) {
    if ((iv.basis !== 'CNF' && iv.basis !== 'TRUCKING_INCLUDED') || iv.manual_embedded) { return; }
    if (shareBad[iv.id] || !(shareOf[iv.id] > 0)) { return; }
    if (iv.releases.some(function (k) { return outbound[k] && outbound[k].partial; })) { return; } // v55.83-TG — a part of the shipping cost is missing: not separated
    if (warehouseOn && iv.charged_transport) { return; } // v55.83-TG — CNF WITH a shipping line: the shipping is charged on that line, not inside the price
    if (iv.effective_terms === 'CNF_SEPARATE') { return; } // v55.83-TG/TJ — chosen on the invoice, or a shipping line is on it: shipping is on its own line, the price is goods only
    iv.embedded_transport = shareOf[iv.id]; iv.embedded_source = (shareKind[iv.id] === 'estimate' ? 'container cost (estimate)' : 'container cost') + (iv.basis_source === 'inferred' ? ' — CNF inferred by rule, estimated' : ''); // v55.83-TG
    usedContainerCost++;
  });
  // v55.83-TG (Max, Nov 16) — what we CHARGE for shipping must be at least our shipping cost + 7% on "CNF with a separate shipping
  // line", and on EXW when a shipping line was added. EXW with no shipping line must have no shipping cost of ours.
  engineInvoices.forEach(function (iv) {
    var t2 = iv.effective_terms; if (t2 !== 'CNF_SEPARATE' && t2 !== 'EXW') { return; }
    var chargedAmt = r2(iv.lines.reduce(function (s, l) { return s + ((l.transport === true || (l.transport !== false && isTransportLine(l.description))) ? (Number(l.amount) || 0) : 0); }, 0));
    var cost = shareBad[iv.id] ? null : (shareOf[iv.id] || 0);
    var kindC = shareKind[iv.id] === 'estimate' ? 'estimate' : 'bill';
    if (t2 === 'EXW' && !(chargedAmt > 0)) { if (cost > 0) { flags.push({ kind: 'exw_but_shipping_cost_on_release', invoice: iv.number, invoice_id: iv.id, cost: cost, cost_kind: kindC }); } return; }
    if (t2 === 'CNF_SEPARATE' && !(chargedAmt > 0)) { flags.push({ kind: 'cnf_separate_without_shipping_line', invoice: iv.number, invoice_id: iv.id }); return; }
    if (cost === null) { flags.push({ kind: 'shipping_markup_not_checkable', invoice: iv.number, invoice_id: iv.id, charged: chargedAmt }); return; }
    var need = minShippingCharge(cost);
    if (chargedAmt < need - 0.005) { flags.push({ kind: 'shipping_charged_below_cost_plus_7pct', invoice: iv.number, invoice_id: iv.id, charged: chargedAmt, cost: cost, cost_kind: kindC, minimum: need, short_by: r2(need - chargedAmt) }); }
  });
  if (usedContainerCost) { full = buildCells({ invoices: engineInvoices, groupOf: groupOf, costOf: costOf, outbound: outbound, brokerage: brokerage, bonded: bonded, factors: factors }); }
  var suggestOf = {}; engineInvoices.forEach(function (i) { suggestOf[i.id] = i._suggest; });
  full.cells.forEach(function (c) {
    var ro = c.release ? releaseOrigin(relRaw[c.release] || c.release, '') : { origin: '', source: 'no release' };
    c.release_raw = c.release ? (relRaw[c.release] || c.release) : ''; c.origin = ro.origin; c.origin_source = ro.source;
    c.outbound_bills = c.release && outbound[c.release] ? outbound[c.release].bills : [];
    // v55.83-TL — this sale's share of the release's TRUCKING and FREIGHT, each on its own (same pounds share as the outbound total).
    // freight = outbound − trucking, so the two always add up to the outbound column exactly.
    c.bonded_from = c.release ? (bondedFrom[c.release] || null) : null; // v55.83-TN — standard $200, none (paper / foil) or the bill
    var pu = c.release ? partsUsed[c.release] : null; var ob0 = c.release ? outbound[c.release] : null;
    var relTot = ob0 ? (ob0.actual !== null && ob0.actual !== undefined ? ob0.actual : ob0.estimate) : null;
    c.trucking_cost = null; c.freight_cost = null; c.trucking_kind = pu && pu.trucking ? pu.trucking.kind : null; c.freight_kind = pu && pu.freight ? pu.freight.kind : null;
    c.trucking_from = pu && pu.trucking ? pu.trucking.from : null; c.freight_from = pu && pu.freight ? pu.freight.from : null;
    if (pu && c.outbound_cost !== null && c.outbound_cost !== undefined && relTot > 0) {
      var tAmt = pu.trucking ? pu.trucking.amount : 0;
      if (pu.trucking) { c.trucking_cost = r2(c.outbound_cost * tAmt / relTot); }
      if (pu.freight) { c.freight_cost = r2(c.outbound_cost - (c.trucking_cost || 0)); }
    } else if (pu && relTot === 0 && c.outbound_cost === 0) { if (pu.trucking) { c.trucking_cost = 0; } if (pu.freight) { c.freight_cost = 0; } }
    if (c.group_id && !(billKeysOfGroup[c.group_id] || []).length) { c.flags.push('no_bill_description_linked'); }
    if (!c.group_id && c.base_cost === null) { c.flags.push('not_grouped_no_cost_source'); }
    // v55.83-TE (Max, Nov 16: "why does the second not have an avg cost") — say WHY a cost is missing, one reason per sale
    if (c.base_cost === null) {
      c.cost_missing_reason = c.pounds === null ? 'unit not set'
        : !c.group_id ? 'not in a product group'
        : !(billKeysOfGroup[c.group_id] || []).length ? 'no supplier description linked'
        : c.flags.indexOf('purchase_line_without_cost') >= 0 ? 'a linked supplier bill line has no cost'
        : c.flags.indexOf('allocation_unresolved_missing_weight') >= 0 ? 'a weight on the invoice is missing'
        : !(linkStats[c.group_id] || {}).lines ? 'the linked supplier descriptions have no bill lines in the Hub'
        : !(linkStats[c.group_id] || {}).usable ? 'the linked supplier bill lines have no unit (lb / kg / ton …)'
        : 'no linked purchase dated on or before this sale (first one: ' + linkStats[c.group_id].first + ')';
    }
  });
  var cells = full.cells.filter(function (c) { return periodIds[c.invoice_id]; });
  cells.forEach(function (c) { c.name_key = nameKey(c.description); });
  var inPeriodFlag = function (f) { return !f.invoice_id || periodIds[f.invoice_id]; };
  flags = flags.concat(full.flags.filter(inPeriodFlag));
  unallocated = unallocated.concat(full.unallocated.filter(function (u) { return !u.invoice_id || periodIds[u.invoice_id]; }));

  var byProduct = summarize(cells, function (c) { return c.product_key; }, function (c) { return c.product; });
  byProduct.forEach(function (r) { r.grouped = r.key.indexOf('g:') === 0; });
  // v55.83-TA (Max, Nov 16: "merged with all numbers aggregated as one line with the averages showing on top line and underlying
  // values below it") — the same cells summed per ORIGINAL description inside each merged product. The lines underneath always
  // add up to the top line, because both are sums of the very same cells.
  var byProductName = summarize(cells.filter(function (c) { return c.product_key.indexOf('g:') === 0; }), function (c) { return c.product_key + '||' + c.name_key; }, function (c) { return String(c.description || '').trim(); });
  byProductName.forEach(function (r) { var ix = r.key.indexOf('||'); r.parent = r.key.substring(0, ix); r.name_key = r.key.substring(ix + 2); });
  byProductName.sort(function (a, b) { return b.goods_revenue - a.goods_revenue; });
  var byCustomer = summarize(cells, function (c) { return c.customer; });
  var byInvoice = summarize(cells, function (c) { return c.invoice_id; }, function (c) { return c.invoice; });
  // count the reasons behind every row's missing cost (same keys as the rows themselves)
  function whyMissing(rows, keyFn) {
    // v55.83-TJ (Max, Nov 17: "messages need to be more meaningful and link us directly to where we make the change") — each reason
    // also carries the product group it is about (when it is one group), the earliest sale date and the description, so the screen can
    // say it in plain words and open the exact place to fix it
    var m = {}; cells.forEach(function (c) { if (!c.cost_missing_reason) { return; } var k = keyFn(c); var o = m[k] || (m[k] = {});
      var e = o[c.cost_missing_reason] || (o[c.cost_missing_reason] = { sales: 0, groups: {}, first_sale: '', names: {} });
      e.sales++; if (c.group_id) { e.groups[c.group_id] = true; } e.names[String(c.description || '').trim()] = true;
      var dt = String(c.invoice_date || '').substring(0, 10); if (dt && (!e.first_sale || dt < e.first_sale)) { e.first_sale = dt; } });
    rows.forEach(function (r) { var o = m[r.key]; r.cost_missing_why = o ? Object.keys(o).map(function (w) { var e = o[w]; var gs = Object.keys(e.groups);
      return { why: w, sales: e.sales, group_id: gs.length === 1 ? gs[0] : null, first_sale: e.first_sale || null, names: Object.keys(e.names).slice(0, 5) }; }).sort(function (a, b) { return b.sales - a.sales; }) : []; });
  }
  whyMissing(byProduct, function (c) { return c.product_key; }); whyMissing(byProductName, function (c) { return c.product_key + '||' + c.name_key; });
  whyMissing(byCustomer, function (c) { return c.customer; }); whyMissing(byInvoice, function (c) { return c.invoice_id; });
  var invMeta = {}; engineInvoices.forEach(function (i) { invMeta[i.id] = { id: i.id, number: i.number, date: i.date, customer: i.customer, customer_id: i.customer_id, basis: i.basis, basis_source: i.basis_source, suggested_basis: i._suggest, shipping_terms: i.shipping_terms || null, shipping_cost_estimate: i.shipping_cost_estimate, embedded_transport: i.manual_embedded ? i.embedded_transport : null, embedded_used: i.embedded_transport, embedded_source: i.manual_embedded ? 'manual' : (i.embedded_source || null), releases: i.releases.map(function (k) { return { key: k, raw: relRaw[k] || k }; }) }; });
  byInvoice.forEach(function (r) { r.invoice = invMeta[r.key] || null; });
  var totals = summarize(cells, function () { return 'all'; })[0] || null;
  var sortRev = function (a, b) { return b.goods_revenue - a.goods_revenue; };

  // ── the lists a person works from to set things up ──
  var invNames = {}; cells.forEach(function (c) { var k = nameKey(c.description); var o = invNames[k] || (invNames[k] = { key: k, name: String(c.description).trim(), lines: 0, qty: 0, invoiced: 0, unit: unitOfName[k] || '', group_id: c.group_id, group: c.group_id ? c.product : null }); o.lines++; o.qty += c.orig_qty; o.invoiced = r2(o.invoiced + c.invoiced); });
  var billNames = {}; costLines.forEach(function (l) { var k = nameKey(l.description); if (!k) { return; } var o = billNames[k] || (billNames[k] = { key: k, name: String(l.description).trim(), lines: 0, qty: 0, cost: 0, units: {}, vendors: {}, last_date: '' }); o.lines++; o.qty += Number(l.qty) || 0; var cst = Number(l.cost_amount != null && l.cost_amount !== '' ? l.cost_amount : l.amount); if (cst > 0) { o.cost = r2(o.cost + cst); } o.units[billLineUnit(l) || '?'] = true; if (!unitKey(l.unit) && billLineUnit(l)) { o.unit_from_name = true; } if (billLineUnit(l)) { o.usable = (o.usable || 0) + 1; } o.vendors[l.vendor || '?'] = true; if (String(l.bill_date || '') > o.last_date) { o.last_date = String(l.bill_date || ''); } });

  return {
    period: { from: from || null, to: to || null }, totals: totals,
    by_product: byProduct.sort(sortRev), by_product_names: byProductName, by_customer: byCustomer.sort(sortRev), by_invoice: byInvoice.sort(function (a, b) { return String((b.invoice && b.invoice.date) || '').localeCompare(String((a.invoice && a.invoice.date) || '')); }),
    cells: cells, flags: flags, unallocated: unallocated,
    reconciled: { product: reconcile(cells, byProduct).ok, product_names: reconcile(cells.filter(function (c) { return c.product_key.indexOf('g:') === 0; }), byProductName).ok, customer: reconcile(cells, byCustomer).ok, invoice: reconcile(cells, byInvoice).ok },
    groups: Object.keys(groupById).map(function (k) { var g0 = groupById[k]; g0.link_stats = linkStats[k] || { lines: 0, usable: 0, first: '' }; return g0; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }),
    invoice_names: Object.keys(invNames).map(function (k) { return invNames[k]; }).sort(function (a, b) { return b.invoiced - a.invoiced; }),
    transport_names: (function () { // v55.83-TD — the descriptions counted as shipping charged to the customer
      var t = {};
      engineInvoices.forEach(function (iv) { if (!periodIds[iv.id]) { return; } iv.lines.forEach(function (l) {
        var isT = l.transport === true || (l.transport !== false && isTransportLine(l.description)); if (!isT) { return; }
        var k = nameKey(l.description); var o = t[k] || (t[k] = { key: k, name: String(l.description).trim(), lines: 0, invoiced: 0, how: kindOf[k] === 'transport' ? 'marked by you' : 'recognised by its name' });
        o.lines++; o.invoiced = r2(o.invoiced + l.amount); }); });
      return Object.keys(t).map(function (k) { return t[k]; }).sort(function (a, b) { return b.invoiced - a.invoiced; });
    })(),
    kinds_ready: d.kinds_ready !== false, customer_terms_ready: d.customer_terms_ready !== false, manual_costs_ready: d.manual_costs_ready !== false, part_estimates_ready: d.part_estimates_ready === true, group_costs: d.groupCosts || [],
    customer_basis: d.customerTerms || [],
    // v55.83-TE — every container (release) in the period with its shipping cost, so a missing one can be filled in one place
    containers: (function () {
      var m = {};
      cells.forEach(function (c) {
        if (!c.release) { return; }
        var o = m[c.release] || (m[c.release] = { key: c.release, raw: c.release_raw, origin: c.origin, pounds: 0, invoices: {}, customers: {} });
        if (c.pounds > 0) { o.pounds += c.pounds; } o.invoices[c.invoice] = true; o.customers[c.customer] = true;
      });
      return Object.keys(m).map(function (k) {
        var o = m[k]; var ob = outbound[k] || { actual: null, estimate: null, bills: [] };
        // v55.83-TG (Max, Nov 16 workflow) — freight and trucking SEPARATELY: the first estimate, the billed amount (final), the
        // difference (flagged when not equal). Final is confirmed only by a bill; with no bill the estimate is what is used.
        var wRow = (whByRel[k] || []).filter(function (w) { return w.section === 'main' && !w.conflict; });
        wRow = wRow.length === 1 ? wRow[0] : null;
        function partOf(name, billType) {
          var bl = (ob.bills || []).filter(function (b) { return b.type === billType; });
          var bill = bl.length ? r2(bl.reduce(function (s, b) { return s + (b.share !== undefined ? b.share : b.amount); }, 0)) : null;
          var est = null; var from = null;
          var typed = typedPart[k] && typedPart[k][name] ? typedPart[k][name].amount : null; // v55.83-TL — typed in the Hub for this part
          if (typed !== null) { est = typed; from = 'typed in the Hub'; }
          else if (wRow) {
            var man = wRow['manual_' + name];
            if (man !== null && man !== undefined && man !== '') { est = r2(man); from = 'typed correction'; }
            else if (wRow[name + '_estimate'] !== null && wRow[name + '_estimate'] !== undefined) { est = r2(wRow[name + '_estimate']); from = 'warehouse quote'; }
            else if (wRow[name + '_final'] !== null && wRow[name + '_final'] !== undefined) { est = r2(wRow[name + '_final']); from = 'warehouse payment (no quote)'; }
            else if (wRow[name + '_kind'] === 'own_transport') { est = 0; from = 'customer’s own transport (inferred)'; }
            else if (wRow[name + '_used'] !== null && wRow[name + '_used'] !== undefined && wRow[name + '_kind'] !== 'bill') { est = r2(wRow[name + '_used']); from = 'warehouse'; }
          }
          var wire = wRow && wRow[name + '_final'] !== null && wRow[name + '_final'] !== undefined ? r2(wRow[name + '_final']) : null;
          var diff = bill !== null && est !== null ? r2(bill - est) : null;
          return { estimate: est, estimate_from: from, typed: typed, bill: bill, bills: bl.map(function (b) { return { bill_number: b.bill_number, vendor: b.vendor, date: b.bill_date, amount: b.share !== undefined ? b.share : b.amount }; }),
            used: bill !== null ? bill : est, status: bill !== null ? 'final_billed' : (est !== null ? 'estimate' : 'missing'),
            difference: diff, differs: diff !== null && Math.abs(diff) > 1, warehouse_payment: wire, payment_differs_from_bill: wire !== null && bill !== null && Math.abs(wire - bill) > 1 };
        }
        var pF = partOf('freight', 'shipping'); var pT = partOf('trucking', 'trucking');
        var combEst = pF.estimate !== null && pT.estimate !== null ? r2(pF.estimate + pT.estimate) : (ob.from_invoice_form || estimateOf[k] !== undefined ? ob.estimate : null);
        var parts = { freight: pF, trucking: pT, estimate_total: combEst, bill_total: pF.bill !== null || pT.bill !== null ? r2((pF.bill || 0) + (pT.bill || 0)) : null,
          final_confirmed: pF.bill !== null && pT.bill !== null, combined_estimate_from: pF.estimate !== null && pT.estimate !== null ? 'warehouse' : (ob.from_invoice_form ? 'invoice form' : (estimateOf[k] !== undefined ? 'typed release estimate' : null)) };
        parts.total_difference = parts.final_confirmed && combEst !== null ? r2(parts.bill_total - combEst) : null;
        parts.total_differs = parts.total_difference !== null && Math.abs(parts.total_difference) > 1;
        return { key: k, raw: o.raw, origin: o.origin, pounds: Math.round(o.pounds), invoices: Object.keys(o.invoices), customers: Object.keys(o.customers), parts: parts,
          shipping_actual: ob.actual, shipping_estimate: ob.estimate === undefined ? null : ob.estimate, bills: (ob.bills || []).map(function (b) { return { bill_number: b.bill_number, vendor: b.vendor, amount: b.share !== undefined ? b.share : b.amount, type: b.type }; }),
          status: whUsed[k] ? (whUsed[k].final ? 'warehouse_final' : 'warehouse_estimate') : (ob.actual !== null && ob.actual !== undefined ? 'bill' : (ob.estimate !== null && ob.estimate !== undefined ? 'estimate' : 'missing')),
          warehouse_used: whUsed[k] ? ob.warehouse : null, warehouse: (whByRel[k] || []).filter(function (w) { return w.section === 'main'; }).map(function (w) { return { id: w.id, order_id: w.order_id, release_number: w.release_number, status: w.status, cost_status: w.cost_status, freight_used: w.freight_used, freight_kind: w.freight_kind, trucking_used: w.trucking_used, trucking_kind: w.trucking_kind, manual_freight: w.manual_freight, manual_trucking: w.manual_trucking, combined_used: w.combined_used, bill_checks: w.bill_checks || [], flags: w.flags || [], link: w.source_link }; }) };
      }).sort(function (a, b) { var r = { missing: 0, estimate: 1, warehouse_estimate: 1, warehouse_final: 2, bill: 2 }; return r[a.status] - r[b.status] || String(a.raw).localeCompare(String(b.raw)); });
    })(),
    counts_container_cost_used: usedContainerCost, warehouse_on: warehouseOn, warehouse_releases_used: Object.keys(whUsed).length,
    bill_names: Object.keys(billNames).map(function (k) { var o = billNames[k]; return { key: o.key, name: o.name, lines: o.lines, usable_lines: o.usable || 0, unit_from_name: !!o.unit_from_name, qty: o.qty, cost: o.cost, units: Object.keys(o.units), vendors: Object.keys(o.vendors), last_date: o.last_date }; }).sort(function (a, b) { return b.cost - a.cost; }),
    factors: factors.units, window_days: d.windowDays > 0 ? d.windowDays : 90,
    bonded_per_houston_release: BONDED_PER_HOUSTON_RELEASE, actual_bonded_bills: actualBonded, actual_bonded_total: r2(actualBonded.reduce(function (t, x) { return t + (Number(x.amount) || 0); }, 0)),
    counts: { invoices_in_period: Object.keys(periodIds).length, invoices_brought_in_for_shared_releases: scope.length - Object.keys(periodIds).length, cells: cells.length, bill_lines_with_unknown_unit: badUnitLines }
  };
}
