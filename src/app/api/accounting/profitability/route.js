// v55.83-SY — PROFITABILITY by product, customer and invoice (Max, Nov 16 2026).
//
// THIS IS NOT THE CASH REPORT. It is dated by INVOICE date and includes unpaid invoices, unpaid bills, a standard
// inbound allowance and labelled estimates. The cash-basis income statement (Accounting → Stats) is the tax report.
//
// What this route does:
//   • 'report' — loads invoices, invoice lines, bills, bill lines and the report set-up, hands them to the engine
//     (lib/profitability.js through lib/profitability-assemble.js) and returns the three views with every warning.
//   • the set-up actions — a person's decisions FOR THE REPORT (group names, unit of a description, pricing basis of an
//     invoice, the transportation inside a price, pounds per release, an outbound estimate). Each is written to its own
//     pl_* table and to the audit trail with who and when.
// It NEVER writes to an invoice, a bill, inventory or the ledger.
// Permissions: pnl.view to see it, pnl.edit_costs to change the set-up (super admin passes both).
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { businessOfInvoice } from '../../../../lib/business-of';
import { audit } from '../../../../lib/audit-server';
import { termsOfBasis } from '../../../../lib/shipping-terms'; // v55.83-TG
import { verifiedCaller } from '../../../../lib/verified-caller'; // v55.83-TG
import { stripProfit, MARGIN_PERMISSION } from '../../../../lib/margin-visibility'; // v55.83-TG
import { nameKey, relKey, PRICING_BASES } from '../../../../lib/profitability';
import { assembleProfitability } from '../../../../lib/profitability-assemble';

var API_BUILD_MARKER = 'v55.83-SY-profitability';
var PAGE = 1000; var MAX_ROWS = 40000;
var SQL_HINT = 'Run sql/v55-83-SY-profitability.sql in Supabase once (it only adds the report set-up tables).';
export const maxDuration = 60;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
async function fetchAll(buildQ) {
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
function missingTable(msg) { return /pl_[a-z_]+/.test(String(msg || '')) && /does not exist|schema cache|not find/i.test(String(msg || '')); }
function bad(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 400 }); }
function unitOk(u) { return u === 'lb' || u === 'kg' || u === 't' || u === 'yd' || u === 'lm'; } // v55.83-SZ kilograms · v55.83-TA tons // v55.83-SZ — + kilograms

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var action = body.action || 'report';
    // v55.83-TG (Codex P1) — who is calling comes from the verified sign-in token; a different body.user_id is refused
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status); }
    var userId = who.userId;
    var pv = await assertPermission(db, userId, 'pnl.view', req);
    if (!pv || pv.ok !== true) { return bad('This needs the "P&L: View" permission — grant it in Settings → Module Access.', 403); }

    if (action === 'report') {
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
        try { setup.lineCosts = await fetchAll(function () { return db.from('pl_line_costs').select('invoice_item_id, cost_per_lb, commission_per_lb, note'); }); setup.groupCosts = await fetchAll(function () { return db.from('pl_group_costs').select('group_id, cost_per_lb, commission_per_lb, note'); }); setup.manual_costs_ready = true; }
        catch (eMC) { if (!missingTable(eMC && eMC.message)) { throw eMC; } setup.lineCosts = []; setup.groupCosts = []; setup.manual_costs_ready = false; }
        // v55.83-TL — trucking / freight typed per release (the report still runs before this table exists)
        try { setup.partEstimates = await fetchAll(function () { return db.from('pl_release_part_estimates').select('release_key, part, amount, note'); }); setup.part_estimates_ready = true; }
        catch (ePE) { if (!missingTable(ePE && ePE.message)) { throw ePE; } setup.partEstimates = []; setup.part_estimates_ready = false; }
      } catch (eS) {
        if (missingTable(eS && eS.message)) { return NextResponse.json({ ok: true, setup_needed: true, setup_message: SQL_HINT, api_build_marker: API_BUILD_MARKER }); }
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
      var out = assembleProfitability(Object.assign({ date_from: body.date_from || null, date_to: body.date_to || null, invoices: inv, items: items, customerNames: custNames, bills: bills, billLines: billLines, windowDays: 90, warehouseRows: whRows, warehouseOn: whOn }, setup));
      var canEdit = await assertPermission(db, userId, 'pnl.edit_costs', req);
      // v55.83-TG (Max) — profit / margin only for people with 'P&L: See profit & margin' (super admin always)
      var seeM = await assertPermission(db, userId, MARGIN_PERMISSION, req); var marginOk = !!(seeM && seeM.ok === true);
      return NextResponse.json(Object.assign({ ok: true, can_edit: !!(canEdit && canEdit.ok === true), can_see_margin: marginOk, bills_note: billsNote, warehouse_note: whNote, api_build_marker: API_BUILD_MARKER }, marginOk ? out : stripProfit(out)));
    }

    // ── everything below changes the REPORT SET-UP only ──
    var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);
    if (!pe || pe.ok !== true) { return bad('This needs the "P&L: Edit Product Costs" permission — grant it in Settings → Module Access.', 403); }
    var now = new Date().toISOString();
    function fail(e) {
      var m = String((e && e.message) || '');
      // v55.83-TB (Max: "selecting ton is not being saved") — the database still has the OLD unit list until the script is run again
      if (/violates check constraint/i.test(m) && /unit/i.test(m)) { return bad('NOT SAVED — the database does not accept this unit yet. Run sql/v55-83-SY-profitability.sql in Supabase once more (it now allows kilograms and tons), then choose the unit again.', 400); }
      return bad(missingTable(m) ? SQL_HINT : (m || 'Not saved.'), 400);
    }
    // v55.83-TB — every active group whose name is the same as nm (capitals, spaces and punctuation ignored), oldest first
    async function sameNameGroups(nm) {
      var k = nameKey(nm); if (!k) { return { list: [] }; }
      var r = await db.from('pl_product_groups').select('id, display_name, created_at').eq('active', true);
      if (r.error) { return { error: r.error }; }
      var list = (r.data || []).filter(function (g) { return nameKey(g.display_name) === k; }).sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)); });
      return { list: list };
    }
    // move every description and supplier link of the groups in fromIds into toId, then switch those groups off (nothing is erased)
    async function consolidate(fromIds, toId) {
      var moved = 0;
      for (var ci = 0; ci < fromIds.length; ci++) {
        var fid = fromIds[ci]; if (!fid || fid === toId) { continue; }
        var nr = await db.from('pl_group_names').select('id, source, name_key, raw_name').eq('group_id', fid).eq('active', true);
        if (nr.error) { return { error: nr.error }; }
        var rowsN = nr.data || [];
        for (var cj = 0; cj < rowsN.length; cj++) {
          var n0 = rowsN[cj];
          var offN = await db.from('pl_group_names').update({ active: false, removed_by: userId, removed_at: now }).eq('id', n0.id); // first, so an invoice name is never in two groups at once
          if (offN.error) { return { error: offN.error }; }
          var hasN = await db.from('pl_group_names').select('id').eq('group_id', toId).eq('source', n0.source).eq('name_key', n0.name_key).eq('active', true).limit(1);
          if (hasN.error) { return { error: hasN.error }; }
          if (!hasN.data || !hasN.data.length) {
            var insN = await db.from('pl_group_names').insert({ group_id: toId, source: n0.source, name_key: n0.name_key, raw_name: n0.raw_name, created_by: userId });
            if (insN.error) { return { error: insN.error }; }
            moved++;
          }
        }
        var offG = await db.from('pl_product_groups').update({ active: false, updated_by: userId, updated_at: now }).eq('id', fid);
        if (offG.error) { return { error: offG.error }; }
        await audit(db, userId, 'pl_group_merged_by_name', 'pl_product_group', fid, { into: toId, names_moved: moved });
      }
      return { moved: moved };
    }
    // all the group ids that share a group's name (so un-linking or un-grouping covers duplicates made before TB too)
    async function idsSharingName(groupId) {
      var g0 = await db.from('pl_product_groups').select('id, display_name').eq('id', groupId).maybeSingle();
      if (g0.error) { return { error: g0.error }; }
      if (!g0.data) { return { ids: [groupId] }; }
      var sn = await sameNameGroups(g0.data.display_name); if (sn.error) { return { error: sn.error }; }
      var ids = sn.list.map(function (x) { return x.id; }); if (ids.indexOf(groupId) < 0) { ids.push(groupId); }
      return { ids: ids };
    }

    // group_save: create a group or add names to one. An invoice description sits in ONE group, so it is moved, not copied.
    if (action === 'group_save') {
      var gName = String(body.display_name || '').trim();
      var invN = Array.isArray(body.invoice_names) ? body.invoice_names : [];
      var billN = Array.isArray(body.bill_names) ? body.bill_names : [];
      var gid = body.id || null;
      if (!gid && gName.length < 2) { return bad('Type the name to show for this product (at least 2 characters).'); }
      if (!gid && !invN.length) { return bad('Tick at least one sales description to put in the group.'); }
      var mergedMsg = null;
      if (!gid) {
        // a group with this name already exists → ADD to it (the oldest), and fold in any other same-name duplicates
        var same0 = await sameNameGroups(gName); if (same0.error) { return fail(same0.error); }
        if (same0.list.length) {
          gid = same0.list[0].id;
          var c0 = await consolidate(same0.list.slice(1).map(function (x) { return x.id; }), gid); if (c0.error) { return fail(c0.error); }
          mergedMsg = 'A product called “' + same0.list[0].display_name + '” already exists — the ticked descriptions were ADDED to it' + (same0.list.length > 1 ? ', and ' + (same0.list.length - 1) + ' other group(s) with the same name were merged into it' : '') + '.';
        }
      }
      if (gid) {
        var gCur = await db.from('pl_product_groups').select('id, display_name, active').eq('id', gid).maybeSingle();
        if (gCur.error) { return fail(gCur.error); }
        if (!gCur.data || gCur.data.active === false) { return bad('That group no longer exists.', 404); }
        var sameR = (gName && nameKey(gName) !== nameKey(gCur.data.display_name)) ? await sameNameGroups(gName) : { list: [] };
        if (sameR.error) { return fail(sameR.error); }
        if (sameR.list.length) {
          // renamed to a name another group already has → merge into that (older) group
          var cR = await consolidate([gid].concat(sameR.list.slice(1).map(function (x) { return x.id; })), sameR.list[0].id); if (cR.error) { return fail(cR.error); }
          mergedMsg = '“' + gCur.data.display_name + '” was merged into the existing product “' + sameR.list[0].display_name + '”.';
          gid = sameR.list[0].id;
        } else if (gName && gName !== gCur.data.display_name) {
          var gUp = await db.from('pl_product_groups').update({ display_name: gName.substring(0, 120), updated_by: userId, updated_at: now }).eq('id', gid).select('id');
          if (gUp.error) { return fail(gUp.error); }
          await audit(db, userId, 'pl_group_renamed', 'pl_product_group', gid, { from: gCur.data.display_name, to: gName });
        }
      } else {
        var gIns = await db.from('pl_product_groups').insert({ display_name: gName.substring(0, 120), created_by: userId, updated_by: userId }).select('id').maybeSingle();
        if (gIns.error) { return fail(gIns.error); }
        gid = gIns.data.id;
        await audit(db, userId, 'pl_group_created', 'pl_product_group', gid, { display_name: gName });
      }
      var added = { invoice: 0, bill: 0 };
      for (var a = 0; a < invN.length; a++) {
        var nmI = String(invN[a] || '').trim(); var kI = nameKey(nmI); if (!kI) { continue; }
        var off = await db.from('pl_group_names').update({ active: false, removed_by: userId, removed_at: now }).eq('source', 'invoice').eq('name_key', kI).eq('active', true).neq('group_id', gid).select('id, group_id');
        if (off.error) { return fail(off.error); }
        var has = await db.from('pl_group_names').select('id').eq('source', 'invoice').eq('name_key', kI).eq('active', true).eq('group_id', gid).limit(1);
        if (has.error) { return fail(has.error); }
        if (!has.data || !has.data.length) {
          var insI = await db.from('pl_group_names').insert({ group_id: gid, source: 'invoice', name_key: kI, raw_name: nmI.substring(0, 300), created_by: userId });
          if (insI.error) { return fail(insI.error); }
          added.invoice++;
        }
      }
      for (var b = 0; b < billN.length; b++) {
        var nmB = String(billN[b] || '').trim(); var kB = nameKey(nmB); if (!kB) { continue; }
        var hasB = await db.from('pl_group_names').select('id').eq('source', 'bill').eq('name_key', kB).eq('active', true).eq('group_id', gid).limit(1);
        if (hasB.error) { return fail(hasB.error); }
        if (!hasB.data || !hasB.data.length) {
          var insB = await db.from('pl_group_names').insert({ group_id: gid, source: 'bill', name_key: kB, raw_name: nmB.substring(0, 300), created_by: userId });
          if (insB.error) { return fail(insB.error); }
          added.bill++;
        }
      }
      await audit(db, userId, 'pl_group_names_added', 'pl_product_group', gid, { invoice_names: invN, bill_names: billN, added: added });
      return NextResponse.json({ ok: true, id: gid, added: added, message: mergedMsg || undefined, api_build_marker: API_BUILD_MARKER });
    }
    // group_remove_name / group_dissolve: links are switched off, never erased
    if (action === 'group_remove_name') {
      var src = body.source === 'bill' ? 'bill' : 'invoice';
      var shR = await idsSharingName(body.group_id); if (shR.error) { return fail(shR.error); }
      var rm = await db.from('pl_group_names').update({ active: false, removed_by: userId, removed_at: now }).in('group_id', shR.ids).eq('source', src).eq('name_key', String(body.name_key || '')).eq('active', true).select('id');
      if (rm.error) { return fail(rm.error); }
      await audit(db, userId, 'pl_group_name_removed', 'pl_product_group', body.group_id, { source: src, name_key: body.name_key });
      return NextResponse.json({ ok: true, removed: (rm.data || []).length, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'group_dissolve') {
      var shD = await idsSharingName(body.id); if (shD.error) { return fail(shD.error); }
      var ds = await db.from('pl_product_groups').update({ active: false, updated_by: userId, updated_at: now }).in('id', shD.ids).select('id, display_name');
      if (ds.error) { return fail(ds.error); }
      var dn = await db.from('pl_group_names').update({ active: false, removed_by: userId, removed_at: now }).in('group_id', shD.ids).eq('active', true).select('id');
      if (dn.error) { return fail(dn.error); }
      await audit(db, userId, 'pl_group_dissolved', 'pl_product_group', body.id, { names_released: (dn.data || []).length });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    // the unit of a sales description (applies to every line with that description) — or of one invoice line
    if (action === 'set_name_unit') {
      var names = Array.isArray(body.names) ? body.names : [body.name];
      if (!unitOk(body.unit)) { return bad('Pick the unit: pounds, kilograms, tons, yards or linear metres.'); }
      var rowsU = names.map(function (n) { return { name_key: nameKey(n), raw_name: String(n || '').trim().substring(0, 300), unit: body.unit, updated_by: userId, updated_at: now }; }).filter(function (r) { return !!r.name_key; });
      if (!rowsU.length) { return bad('No description given.'); }
      var upU = await db.from('pl_name_units').upsert(rowsU, { onConflict: 'name_key' });
      if (upU.error) { return fail(upU.error); }
      await audit(db, userId, 'pl_name_unit_set', 'pl_name_unit', rowsU.length === 1 ? rowsU[0].name_key : null, { unit: body.unit, names: names.slice(0, 100) });
      return NextResponse.json({ ok: true, set: rowsU.length, api_build_marker: API_BUILD_MARKER });
    }
    // v55.83-TD — mark descriptions as a shipping charge to the customer, as a product, or back to "decided by the name"
    // v55.83-TE — a customer's usual pricing basis ('' = none)
    // v55.83-TE — a goods cost typed by hand, per pound: for one sale ('line') or a product's default ('group'). Blank cost = remove.
    // It is used ONLY when no linked supplier bill gives a cost, and it is labelled "typed by hand" everywhere.
    if (action === 'set_manual_cost') {
      var lvl = body.level === 'group' ? 'group' : 'line';
      var ref = lvl === 'group' ? body.group_id : body.invoice_item_id;
      if (!ref) { return bad(lvl === 'group' ? 'The product group is required.' : 'The invoice line is required.'); }
      var tbl = lvl === 'group' ? 'pl_group_costs' : 'pl_line_costs'; var col = lvl === 'group' ? 'group_id' : 'invoice_item_id';
      var cpl = body.cost_per_lb === '' || body.cost_per_lb === null || body.cost_per_lb === undefined ? null : Number(String(body.cost_per_lb).replace(/[$,\s]/g, ''));
      var mpl = body.commission_per_lb === '' || body.commission_per_lb === null || body.commission_per_lb === undefined ? 0 : Number(String(body.commission_per_lb).replace(/[$,\s]/g, ''));
      if (cpl !== null && (isNaN(cpl) || !(cpl > 0) || cpl > 100)) { return bad('The cost must be dollars per POUND, above zero (for example 0.12).'); }
      if (isNaN(mpl) || mpl < 0 || mpl > 100) { return bad('The commission must be dollars per pound, zero or more.'); }
      var prevM = await db.from(tbl).select('cost_per_lb, commission_per_lb, note').eq(col, ref).maybeSingle();
      if (prevM.error) { return fail(prevM.error); }
      if (cpl === null) { var dlM = await db.from(tbl).delete().eq(col, ref); if (dlM.error) { return fail(dlM.error); } } // a report setting only
      else { var rowM = { cost_per_lb: cpl, commission_per_lb: mpl, note: String(body.note || '').substring(0, 300) || null, updated_by: userId, updated_at: now }; rowM[col] = ref;
        var upM = await db.from(tbl).upsert(rowM, { onConflict: col }); if (upM.error) { return fail(upM.error); } }
      await audit(db, userId, 'pl_manual_cost_set', lvl === 'group' ? 'pl_product_group' : 'accounting_invoice_item', ref, { level: lvl, from: prevM.data || null, to: cpl === null ? null : { cost_per_lb: cpl, commission_per_lb: mpl, note: body.note || null } });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_customer_basis') {
      if (!body.customer_id) { return bad('The customer is required.'); }
      var cb = body.basis || '';
      if (cb && PRICING_BASES.indexOf(cb) < 0) { return bad('Pick EXW, CNF or trucking included.'); }
      var prevC = await db.from('pl_customer_terms').select('basis').eq('customer_id', body.customer_id).maybeSingle();
      if (prevC.error) { return fail(prevC.error); }
      if (cb) { var upC = await db.from('pl_customer_terms').upsert({ customer_id: body.customer_id, customer_name: String(body.customer_name || '').substring(0, 200) || null, basis: cb, updated_by: userId, updated_at: now }, { onConflict: 'customer_id' }); if (upC.error) { return fail(upC.error); } }
      else { var dlC = await db.from('pl_customer_terms').delete().eq('customer_id', body.customer_id); if (dlC.error) { return fail(dlC.error); } } // a report setting only
      await audit(db, userId, 'pl_customer_basis_set', 'accounting_customer', body.customer_id, { from: prevC.data ? prevC.data.basis : null, to: cb || null, customer: body.customer_name || null });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_name_kind') {
      var kNames = Array.isArray(body.names) ? body.names : [body.name];
      var kind = body.kind || '';
      if (kind && kind !== 'transport' && kind !== 'goods') { return bad('Choose shipping charge or product.'); }
      var kRows = kNames.map(function (n) { return { name_key: nameKey(n), raw_name: String(n || '').trim().substring(0, 300), kind: kind, updated_by: userId, updated_at: now }; }).filter(function (r) { return !!r.name_key; });
      if (!kRows.length) { return bad('No description given.'); }
      if (kind) { var upK = await db.from('pl_name_kinds').upsert(kRows, { onConflict: 'name_key' }); if (upK.error) { return fail(upK.error); } }
      else { var dlK = await db.from('pl_name_kinds').delete().in('name_key', kRows.map(function (r) { return r.name_key; })); if (dlK.error) { return fail(dlK.error); } } // a report setting only; nothing on the invoice changes
      await audit(db, userId, 'pl_name_kind_set', 'pl_name_kind', kRows.length === 1 ? kRows[0].name_key : null, { kind: kind || 'by name', names: kNames.slice(0, 100) });
      return NextResponse.json({ ok: true, set: kRows.length, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_line_unit') {
      if (!body.invoice_item_id) { return bad('The invoice line is required.'); }
      if (!body.unit) {
        var dl = await db.from('pl_line_units').delete().eq('invoice_item_id', body.invoice_item_id); // a set-up override only; the invoice line itself is untouched
        if (dl.error) { return fail(dl.error); }
      } else {
        if (!unitOk(body.unit)) { return bad('Pick the unit: pounds, kilograms, tons, yards or linear metres.'); }
        var upL = await db.from('pl_line_units').upsert({ invoice_item_id: body.invoice_item_id, unit: body.unit, updated_by: userId, updated_at: now }, { onConflict: 'invoice_item_id' });
        if (upL.error) { return fail(upL.error); }
      }
      await audit(db, userId, 'pl_line_unit_set', 'accounting_invoice_item', body.invoice_item_id, { unit: body.unit || null });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_factor') {
      var fv = Number(body.pounds_per_unit);
      if (body.unit !== 'yd' && body.unit !== 'lm') { return bad('Only yards and linear metres have a weight to set. A kilogram is always 2.20462 lb and a ton is always 2,204.62 lb.'); }
      if (!(fv > 0) || fv > 1000) { return bad('Pounds per unit must be above zero.'); }
      var prevF = await db.from('pl_unit_factors').select('pounds_per_unit').eq('unit', body.unit).maybeSingle();
      var upF = await db.from('pl_unit_factors').upsert({ unit: body.unit, pounds_per_unit: fv, updated_by: userId, updated_at: now }, { onConflict: 'unit' });
      if (upF.error) { return fail(upF.error); }
      await audit(db, userId, 'pl_unit_factor_set', 'pl_unit_factor', body.unit, { from: prevF && prevF.data ? prevF.data.pounds_per_unit : null, to: fv });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    // pricing basis + the transportation inside the price — a note ABOUT the invoice for this report; the invoice is not changed
    if (action === 'set_terms') {
      if (!body.invoice_id) { return bad('The invoice is required.'); }
      var basis = body.basis || null;
      if (basis && PRICING_BASES.indexOf(basis) < 0) { return bad('Pick EXW, CNF or trucking included.'); }
      var emb = (body.embedded_transport === '' || body.embedded_transport === null || body.embedded_transport === undefined) ? null : Number(body.embedded_transport);
      if (emb !== null && (isNaN(emb) || emb < 0)) { return bad('The transportation amount must be a number, zero or more.'); }
      if (basis === 'EXW' && emb) { return bad('On EXW the transportation is the separate line on the invoice. A typed amount would add revenue the invoice does not carry.'); }
      var prevT = await db.from('pl_invoice_terms').select('*').eq('invoice_id', body.invoice_id).maybeSingle();
      if (prevT.error) { return fail(prevT.error); }
      var rowT = { invoice_id: body.invoice_id, basis: basis, embedded_transport: basis === 'EXW' ? null : emb, updated_by: userId, updated_at: now };
      // v55.83-TG — ONE value: a basis changed here keeps the invoice's shipping terms in step
      if (prevT.data && Object.prototype.hasOwnProperty.call(prevT.data, 'shipping_terms')) { rowT.shipping_terms = termsOfBasis(basis, prevT.data.shipping_terms); if (!rowT.shipping_terms) { rowT.shipping_cost_estimate = null; } }
      var upT = await db.from('pl_invoice_terms').upsert(rowT, { onConflict: 'invoice_id' });
      if (upT.error) { return fail(upT.error); }
      await audit(db, userId, 'pl_invoice_terms_set', 'accounting_invoice', body.invoice_id, { from: prevT.data || null, to: { basis: basis, embedded_transport: basis === 'EXW' ? null : emb }, changes: 'report only — the invoice is not altered' });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    // an invoice on two releases: pounds of one line on each release
    if (action === 'set_line_release_pounds') {
      if (!body.invoice_item_id || !body.pounds || typeof body.pounds !== 'object') { return bad('The invoice line and the pounds per release are required.'); }
      var rowsR = Object.keys(body.pounds).map(function (k) { return { invoice_item_id: body.invoice_item_id, release_key: relKey(k), pounds: Number(body.pounds[k]), updated_by: userId, updated_at: now }; }).filter(function (r) { return r.release_key && r.pounds > 0; });
      var delR = await db.from('pl_line_release_pounds').delete().eq('invoice_item_id', body.invoice_item_id); // replaced as one set; history is in the audit trail
      if (delR.error) { return fail(delR.error); }
      if (rowsR.length) { var insR = await db.from('pl_line_release_pounds').insert(rowsR); if (insR.error) { return fail(insR.error); } }
      await audit(db, userId, 'pl_line_release_pounds_set', 'accounting_invoice_item', body.invoice_item_id, { pounds: body.pounds });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    // v55.83-TL (Max, Nov 17) — trucking or freight typed for ONE release; a bill for that part on that release always overrides it.
    // Clearing keeps the row (amount empty) — nothing is deleted; every change is in the audit trail.
    if (action === 'set_part_estimate') {
      var pk = relKey(body.release); if (!pk) { return bad('The release number is required.'); }
      var part = body.part === 'trucking' || body.part === 'freight' ? body.part : null; if (!part) { return bad('Choose trucking or freight.'); }
      var pv = null;
      if (body.amount !== '' && body.amount !== null && body.amount !== undefined) { pv = Number(String(body.amount).replace(/[$,\s]/g, '')); if (isNaN(pv) || pv < 0) { return bad('The amount must be a number, zero or more.'); } }
      var upP = await db.from('pl_release_part_estimates').upsert({ release_key: pk, part: part, amount: pv, note: String(body.note || '').substring(0, 300) || null, updated_by: userId, updated_at: now }, { onConflict: 'release_key,part' });
      if (upP.error) { return /pl_release_part_estimates/.test(String(upP.error.message)) ? bad('Run sql/v55-83-TL-trucking-freight.sql in Supabase first.') : fail(upP.error); }
      await audit(db, userId, 'pl_part_estimate_set', 'release', pk, { part: part, amount: pv, note: body.note || null });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_estimate') {
      var rk = relKey(body.release); if (!rk) { return bad('The release number is required.'); }
      if (body.amount === '' || body.amount === null || body.amount === undefined) {
        var delE = await db.from('pl_release_estimates').delete().eq('release_key', rk);
        if (delE.error) { return fail(delE.error); }
      } else {
        var ev = Number(body.amount); if (isNaN(ev) || ev < 0) { return bad('The estimate must be a number, zero or more.'); }
        var upE = await db.from('pl_release_estimates').upsert({ release_key: rk, outbound_estimate: ev, note: String(body.note || '').substring(0, 300) || null, updated_by: userId, updated_at: now }, { onConflict: 'release_key' });
        if (upE.error) { return fail(upE.error); }
      }
      await audit(db, userId, 'pl_outbound_estimate_set', 'release', rk, { amount: body.amount === '' ? null : body.amount, note: body.note || null });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    return bad('Unknown action.', 400);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'profitability failed', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
