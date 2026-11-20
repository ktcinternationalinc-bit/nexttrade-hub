// v55.83-UD — the ONE loader for the Profitability report AND the P&L (Max, Nov 18 2026: "why isn't the P&L typed costs
// working ... avg costs are all blank" → the P&L now uses the same cost engine as Profitability). Moved here unchanged from
// src/app/api/accounting/profitability/route.js ('report'), so both screens read exactly the same data the same way.
// Server only (service-role client passed in). SWC-safe: var + string concatenation only.
import { businessOfInvoice } from './business-of';

var PAGE = 1000; var MAX_ROWS = 40000;
export async function fetchAllRows(buildQ) {
  var out = []; var from = 0;
  while (out.length < MAX_ROWS) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}
export function missingPlTable(msg) { return /pl_[a-z_]+/.test(String(msg || '')) && /does not exist|schema cache|not find/i.test(String(msg || '')); }

// Returns { setup_needed: true } when the report set-up tables are not there yet; otherwise
// { input (ready for assembleProfitability, without dates), billsNote, whNote }.
export async function loadProfitabilityInput(db) {
  var fetchAll = fetchAllRows; var missingTable = missingPlTable;
  var setup;
  try {
    setup = {
      groups: await fetchAll(function () { return db.from('pl_product_groups').select('id, display_name, active, created_at'); }),
      groupNames: await fetchAll(function () { return db.from('pl_group_names').select('id, group_id, source, name_key, raw_name, active'); }),
      nameUnits: await fetchAll(function () { return db.from('pl_name_units').select('name_key, raw_name, unit'); }),
      lineUnits: await fetchAll(function () { return db.from('pl_line_units').select('invoice_item_id, unit'); }),
      factors: await fetchAll(function () { return db.from('pl_unit_factors').select('unit, pounds_per_unit, note'); }),
      terms: await fetchAll(function () { return db.from('pl_invoice_terms').select('invoice_id, basis, embedded_transport'); }),
      lineReleasePounds: await fetchAll(function () { return db.from('pl_line_release_pounds').select('invoice_item_id, release_key, pounds'); }),
      estimates: await fetchAll(function () { return db.from('pl_release_estimates').select('release_key, outbound_estimate, note'); })
    };
    // v55.83-VX — "keep in yards" per description, and typed costs per yard (the report still runs before the columns exist)
    try { setup.nameUnits = await fetchAll(function () { return db.from('pl_name_units').select('name_key, raw_name, unit, keep_unit'); }); setup.keep_unit_ready = true; }
    catch (eKU) { setup.keep_unit_ready = false; }
    // v55.83-TG — the shipping terms chosen on the invoice (same row; works before the new columns exist)
    try { setup.terms = await fetchAll(function () { return db.from('pl_invoice_terms').select('invoice_id, basis, embedded_transport, shipping_terms, shipping_cost_estimate'); }); setup.shipping_terms_ready = true; }
    catch (eST) { setup.shipping_terms_ready = false; }
    // v55.83-TD — a person's "shipping charge / product" marks (the report still runs before this table exists)
    try { setup.nameKinds = await fetchAll(function () { return db.from('pl_name_kinds').select('name_key, raw_name, kind'); }); setup.kinds_ready = true; }
    catch (eK) { if (!missingTable(eK && eK.message)) { throw eK; } setup.nameKinds = []; setup.kinds_ready = false; }
    // v55.83-TE — customers' usual pricing basis (the report still runs before this table exists)
    try { setup.customerTerms = await fetchAll(function () { return db.from('pl_customer_terms').select('customer_id, customer_name, basis'); }); setup.customer_terms_ready = true; }
    catch (eCT) { if (!missingTable(eCT && eCT.message)) { throw eCT; } setup.customerTerms = []; setup.customer_terms_ready = false; }
    // v55.83-TE — costs typed by hand (the report still runs before these tables exist)
    try { setup.lineCosts = await fetchAll(function () { return db.from('pl_line_costs').select('invoice_item_id, cost_per_lb, commission_per_lb, note'); }); setup.groupCosts = await fetchAll(function () { return db.from('pl_group_costs').select('group_id, cost_per_lb, commission_per_lb, note'); }); setup.manual_costs_ready = true;
      if (setup.keep_unit_ready) { try { setup.lineCosts = await fetchAll(function () { return db.from('pl_line_costs').select('invoice_item_id, cost_per_lb, commission_per_lb, note, cost_unit'); }); setup.groupCosts = await fetchAll(function () { return db.from('pl_group_costs').select('group_id, cost_per_lb, commission_per_lb, note, cost_unit'); }); } catch (eCU) { setup.keep_unit_ready = false; } } }
    catch (eMC) { if (!missingTable(eMC && eMC.message)) { throw eMC; } setup.lineCosts = []; setup.groupCosts = []; setup.manual_costs_ready = false; }
    // v55.83-TL — trucking / freight typed per release (the report still runs before this table exists)
    try { setup.partEstimates = await fetchAll(function () { return db.from('pl_release_part_estimates').select('release_key, part, amount, note'); }); setup.part_estimates_ready = true; }
    catch (ePE) { if (!missingTable(ePE && ePE.message)) { throw ePE; } setup.partEstimates = []; setup.part_estimates_ready = false; }
    // v55.83-UL — supplier descriptions that come free ($0 = a real zero cost); the report still runs before this table exists
    try { setup.freeBillNames = await fetchAll(function () { return db.from('pl_free_bill_names').select('name_key, raw_name, active'); }); setup.free_names_ready = true; }
    catch (eFN) { if (!missingTable(eFN && eFN.message)) { throw eFN; } setup.freeBillNames = []; setup.free_names_ready = false; }
  } catch (eS) {
    if (missingTable(eS && eS.message)) { return { setup_needed: true }; }
    throw eS;
  }
  var inv = await fetchAll(function () {
    return db.from('accounting_invoices').select('id, invoice_number, accounting_customer_id, invoice_date, total_amount, record_status, currency, source, wave_invoice_id, wave_business_id, release_number').order('invoice_date', { ascending: false });
  });
  var custNames = {}; var custTag = {};
  try {
    var cs = await fetchAll(function () { return db.from('accounting_customers').select('id, company_name, contact_name, business_tag'); });
    cs.forEach(function (c) { custNames[c.id] = c.company_name || c.contact_name || ''; if (c.business_tag) { custTag[c.id] = c.business_tag; } });
  } catch (eC) { /* names only */ }
  inv = inv.filter(function (i) { return businessOfInvoice(i, custTag) === 'US'; });
  var items = await fetchAll(function () { return db.from('accounting_invoice_items').select('id, invoice_id, description, quantity, unit_price, wave_product_name'); });
  var bills = []; var billLines = []; var billsNote = null;
  try {
    bills = await fetchAll(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, record_status, bill_type, shipment_direction, release_number'); });
    billLines = await fetchAll(function () { return db.from('vendor_bill_lines').select('id, bill_id, line_kind, description, qty, unit, unit_price, amount, cost_amount, commission_amount'); });
  } catch (eB) { billsNote = 'The bills could not be read (' + ((eB && eB.message) || 'error') + ') — every cost shows as missing.'; }
  // v55.83-TG — shipping costs synced from the Nextrade warehouse: always shown on Containers, used in the numbers only when the switch is on
  var whRows = []; var whOn = false; var whNote = null;
  try {
    // v55.83-TJ (Max, Nov 17: "use the estimate in the Nextrade warehouse system ... until we get the verified value from the actual
    // bill and flag if there are any differences") — always used; no switch. A Hub bill always replaces it; differences are flagged.
    whOn = true;
    var whA = await db.from('pl_warehouse_settings').select('value').eq('key', 'active_source').maybeSingle(); if (whA.error) { throw new Error(whA.error.message); }
    var whSource = whA.data ? whA.data.value : 'nextrade-staging';
    whRows = await fetchAll(function () { return db.from('pl_warehouse_shipping').select('id, section, order_id, release_number, release_key, status, superseded, conflict, cost_status, freight_used, freight_kind, trucking_used, trucking_kind, freight_estimate, freight_final, trucking_estimate, trucking_final, manual_freight, manual_trucking, combined_used, bill_checks, flags, source_link').eq('source', whSource).eq('superseded', false).eq('in_latest_feed', true); });
  } catch (eW) { whRows = []; whOn = false; whNote = /pl_warehouse/.test(String(eW && eW.message)) ? 'Warehouse shipping costs are not set up yet (sql/v55-83-TG-warehouse-shipping.sql).' : 'Warehouse shipping costs could not be read (' + ((eW && eW.message) || 'error') + ') — the report runs without them.'; }
  return { input: Object.assign({ invoices: inv, items: items, customerNames: custNames, bills: bills, billLines: billLines, windowDays: 90, warehouseRows: whRows, warehouseOn: whOn }, setup), billsNote: billsNote, whNote: whNote };
}
