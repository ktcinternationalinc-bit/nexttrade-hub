// /api/ai/reports — v55.83-NL (Max Sep 7 2026): "list all of the opened
// shipments or invoices created in the last months or 3 months or custom
// period.. list me all of the outstanding balances for each and or list also
// the payments for each.. a summary for a customer.. it must be able to create
// the report for me and/or actually answer specific questions.. it needs
// permissioning."
//
// ARCHITECTURE — the AI orders reports; it never cooks the numbers.
// The model's ONLY jobs are (1) understanding the question (EN/AR, voice-to-
// text) into a tool call with filters, and (2) presenting what the tool
// returned. Every figure the user sees was computed by the DATABASE over the
// COMPLETE filtered set (paginated reads, server-side sums) — never by the
// model, never over a truncated context dump. If a tool returns nothing, the
// honest answer is "nothing found", not an invention.
//
// PERMISSIONING — every tool call is asserted server-side against the ASKING
// user via the same assertPermission ladder the rest of the Hub uses (super
// admin passes everything; others need the module grant). A denied tool
// returns a denial AS the tool result, so the model tells the user plainly
// which permission is missing instead of pretending the data is empty.
//
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-NL-ai-reports';
var MAX_ROWS = 20000;   // absolute safety cap per tool call
var PAGE = 1000;
var MAX_ROUNDS = 4;     // model <-> tools round trips

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Read ALL rows matching a query builder factory, page by page. buildQ must
// return a fresh builder each call (Supabase builders are single-use).
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

// ── TOOL DEFINITIONS (what the model sees) ─────────────────────────────────
var TOOLS = [
  {
    name: 'list_invoices',
    description: 'List sales invoices with amounts, collected and outstanding balance. Filter by date range, payment state and/or customer. Totals are computed by the database over the full filtered set.',
    input_schema: { type: 'object', properties: {
      date_from: { type: 'string', description: 'YYYY-MM-DD inclusive (invoice_date)' },
      date_to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
      state: { type: 'string', enum: ['all', 'open', 'paid'], description: 'open = outstanding > 0' },
      customer_name: { type: 'string', description: 'Match on customer name (Arabic or English), partial ok' }
    } }
  },
  {
    name: 'list_payments',
    description: 'List customer payments received (treasury cash-in rows linked to orders/customers). Filter by date range, customer and/or order number. Totals computed by the database.',
    input_schema: { type: 'object', properties: {
      date_from: { type: 'string' }, date_to: { type: 'string' },
      customer_name: { type: 'string' }, order_number: { type: 'string' }
    } }
  },
  {
    name: 'customer_statement',
    description: 'Full statement for ONE customer: their invoices (with outstanding), their payments, pending checks, and totals. Use for "summary for customer X" / "balance of X".',
    input_schema: { type: 'object', properties: {
      customer_name: { type: 'string', description: 'Required. Arabic or English, partial ok.' }
    }, required: ['customer_name'] }
  },
  {
    name: 'list_checks',
    description: 'List checks by status (pending/collected/bounced/all), optionally by customer or date range.',
    input_schema: { type: 'object', properties: {
      status: { type: 'string', description: 'pending | collected | bounced | all' },
      customer_name: { type: 'string' }, date_from: { type: 'string' }, date_to: { type: 'string' }
    } }
  },
  {
    name: 'reconcile_orders',
    description: 'Reconcile NextTrade warehouse orders (imported from NextTradeIndustries.com) against Hub invoices. Returns orders WITHOUT an invoice, invoices without an order, and shipped-with-zero-quantity flags. Use when asked about order/invoice mismatches or missing invoices for warehouse orders.',
    input_schema: { type: 'object', properties: {
      date_from: { type: 'string' }, date_to: { type: 'string' }
    } }
  },
  {
    name: 'list_shipments',
    description: 'List shipments/customs files, optionally filtered by status text and/or date range.',
    input_schema: { type: 'object', properties: {
      status: { type: 'string', description: 'Filter by status text, e.g. draft, paid, reconciled, cancelled; omit for all' },
      date_from: { type: 'string' }, date_to: { type: 'string' }
    } }
  }
];

// Tool -> permission key (server-permissions canonical keys). One key per
// tool: coarse on purpose — an answer that mixes balances must clear the
// balance bar, and "SEE ALL accounting reports" is granted by giving the user
// these AR permissions in Settings like anywhere else in the Hub.
var TOOL_PERMISSION = {
  list_invoices: 'ar.view_invoice_balances',
  list_payments: 'ar.view_customer_balances',
  customer_statement: 'ar.view_customer_balances',
  list_checks: 'ar.view_invoice_balances',
  list_shipments: 'invoices.view',
  reconcile_orders: 'invoices.view'
};

// ── TOOL EXECUTORS (the kitchen) ───────────────────────────────────────────
async function execTool(db, name, input, userId, req) {
  var permKey = TOOL_PERMISSION[name];
  var gate = await assertPermission(db, userId, permKey, req);
  if (!gate.ok) {
    return { permission_denied: true, needed: permKey, message: 'The asking user does not have the "' + permKey + '" permission. Tell them plainly that this report needs that permission (granted in Settings > Permissions) and do NOT guess any figures.' };
  }
  input = input || {};
  var df = input.date_from || null; var dt = input.date_to || null;

  if (name === 'list_invoices') {
    var rows = await fetchAll(function () {
      var q = db.from('invoices').select('order_number, release_number, customer_name, customer_name_en, invoice_date, total_amount, total_collected, outstanding, sales_rep').order('invoice_date', { ascending: false }); // NW: invoices has no invoice_number
      if (df) { q = q.gte('invoice_date', df); }
      if (dt) { q = q.lte('invoice_date', dt); }
      if (input.customer_name) { q = q.or('customer_name.ilike.%' + input.customer_name + '%,customer_name_en.ilike.%' + input.customer_name + '%'); }
      return q;
    });
    if (input.state === 'open') { rows = rows.filter(function (r) { return Number(r.outstanding || 0) > 0.009; }); }
    if (input.state === 'paid') { rows = rows.filter(function (r) { return Number(r.outstanding || 0) <= 0.009; }); }
    var tA = 0, tC = 0, tO = 0;
    rows.forEach(function (r) { tA += Number(r.total_amount || 0); tC += Number(r.total_collected || 0); tO += Number(r.outstanding || 0); });
    return { count: rows.length, totals: { total_amount: r2(tA), total_collected: r2(tC), total_outstanding: r2(tO) }, rows: rows.slice(0, 400), rows_truncated_for_display: rows.length > 400, source: 'invoices' + (df || dt ? (' ' + (df || 'start') + ' → ' + (dt || 'today')) : ' (all dates)') + ', ' + rows.length + ' rows, totals computed in database' };
  }

  if (name === 'list_payments') {
    var prow = await fetchAll(function () {
      var q = db.from('treasury').select('transaction_date, description, cash_in, order_number, category, subcategory').gt('cash_in', 0).order('transaction_date', { ascending: false });
      if (df) { q = q.gte('transaction_date', df); }
      if (dt) { q = q.lte('transaction_date', dt); }
      if (input.order_number) { q = q.ilike('order_number', '%' + input.order_number + '%'); }
      if (input.customer_name) { q = q.ilike('description', '%' + input.customer_name + '%'); }
      return q;
    });
    var tP = 0; prow.forEach(function (r) { tP += Number(r.cash_in || 0); });
    return { count: prow.length, totals: { total_received: r2(tP) }, rows: prow.slice(0, 400), rows_truncated_for_display: prow.length > 400, note: 'Payments are treasury cash-in rows; customer filter matches the description text.', source: 'treasury cash-in' + (df || dt ? (' ' + (df || 'start') + ' → ' + (dt || 'today')) : '') + ', ' + prow.length + ' rows' };
  }

  if (name === 'customer_statement') {
    var cn = input.customer_name;
    var inv = await fetchAll(function () {
      return db.from('invoices').select('order_number, customer_name, invoice_date, total_amount, total_collected, outstanding').or('customer_name.ilike.%' + cn + '%,customer_name_en.ilike.%' + cn + '%').order('invoice_date', { ascending: true });
    });
    var pays = await fetchAll(function () {
      return db.from('treasury').select('transaction_date, description, cash_in, order_number').gt('cash_in', 0).ilike('description', '%' + cn + '%').order('transaction_date', { ascending: true });
    });
    var chks = await fetchAll(function () {
      return db.from('checks').select('check_number, customer_name, amount, check_date, status, bank_name, order_number').ilike('customer_name', '%' + cn + '%').order('check_date', { ascending: true });
    });
    var sA = 0, sC = 0, sO = 0; inv.forEach(function (r) { sA += Number(r.total_amount || 0); sC += Number(r.total_collected || 0); sO += Number(r.outstanding || 0); });
    var sP = 0; pays.forEach(function (r) { sP += Number(r.cash_in || 0); });
    var pend = 0; chks.forEach(function (r) { if (String(r.status || '').toLowerCase() === 'pending') { pend += Number(r.amount || 0); } });
    return {
      customer_match: cn, invoice_count: inv.length,
      totals: { invoiced: r2(sA), collected: r2(sC), outstanding_balance: r2(sO), treasury_payments_matching_name: r2(sP), pending_checks: r2(pend) },
      invoices: inv.slice(0, 300), payments: pays.slice(0, 300), checks: chks.slice(0, 100),
      source: 'invoices+treasury+checks for name ~"' + cn + '", ' + inv.length + '/' + pays.length + '/' + chks.length + ' rows, totals computed in database'
    };
  }

  if (name === 'list_checks') {
    var crow = await fetchAll(function () {
      var q = db.from('checks').select('check_number, customer_name, amount, check_date, collection_date, status, bank_name, order_number').order('check_date', { ascending: false });
      if (input.status && input.status !== 'all') { q = q.ilike('status', input.status); }
      if (input.customer_name) { q = q.ilike('customer_name', '%' + input.customer_name + '%'); }
      if (df) { q = q.gte('check_date', df); }
      if (dt) { q = q.lte('check_date', dt); }
      return q;
    });
    var tK = 0; crow.forEach(function (r) { tK += Number(r.amount || 0); });
    return { count: crow.length, totals: { total_amount: r2(tK) }, rows: crow.slice(0, 400), rows_truncated_for_display: crow.length > 400, source: 'checks' + (input.status && input.status !== 'all' ? ' status~' + input.status : '') + ', ' + crow.length + ' rows' };
  }

  if (name === 'reconcile_orders') {
    // Delegate to the reconciliation engine's logic inline: orders vs both invoice systems.
    var ords = await fetchAll(function () {
      var q = db.from('nexttrade_orders').select('release_number, customer_name, warehouse, container, order_date, status, country, qty_seconds, qty_thirds, qty_paper').order('order_date', { ascending: false });
      if (df) { q = q.gte('order_date', df); }
      if (dt) { q = q.lte('order_date', dt); }
      return q;
    });
    if (!ords.length) { return { count: 0, note: 'No NextTrade orders imported yet (or none in this period). Orders are imported in Admin > Order Reconciliation.', source: 'nexttrade_orders, 0 rows' }; }
    var sInv = await fetchAll(function () { return db.from('invoices').select('order_number, release_number'); });
    var aInv = await fetchAll(function () { return db.from('accounting_invoices').select('invoice_number, release_number, po_so_number'); });
    var keys = {};
    function nrm(x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ''); }
    sInv.forEach(function (v) { if (v.release_number) { keys[nrm(v.release_number)] = true; } if (v.order_number) { keys[nrm(v.order_number)] = true; } });
    aInv.forEach(function (v) { if (v.release_number) { keys[nrm(v.release_number)] = true; } if (v.po_so_number) { keys[nrm(v.po_so_number)] = true; } if (v.invoice_number) { keys[nrm(v.invoice_number)] = true; } });
    var allKeys = Object.keys(keys);
    var miss = []; var okC = 0;
    ords.forEach(function (o) {
      var rel = nrm(o.release_number);
      var hit = keys[rel] === true;
      if (!hit) { var kk; for (kk = 0; kk < allKeys.length; kk++) { if (allKeys[kk].length > rel.length && allKeys[kk].indexOf(rel) > -1) { hit = true; break; } } }
      if (!hit) { // NY: release serial IS the invoice number (1001-1640 -> "AMERICA 1640")
        var sfx = String(o.release_number || '').split('-')[1] || ''; sfx = sfx.replace(/^0+/, '');
        if (sfx.length >= 3) { var sr = new RegExp('(^|[^0-9])' + sfx + '($|[^0-9])'); var kz; for (kz = 0; kz < allKeys.length; kz++) { if (sr.test(allKeys[kz])) { hit = true; break; } } }
      }
      if (hit) { okC += 1; } else { miss.push({ release_number: o.release_number, customer: o.customer_name, warehouse: o.warehouse, order_date: o.order_date, status: o.status, country: o.country }); }
    });
    return { count: ords.length, totals: { matched: okC, orders_without_invoice: miss.length }, rows: miss.slice(0, 400), note: 'rows = orders WITHOUT any matching invoice (release number checked against sales order/invoice numbers and accounting invoice numbers, exact + contains).', source: 'nexttrade_orders ' + ords.length + ' vs invoices ' + sInv.length + ' + accounting ' + aInv.length + ', matched server-side' };
  }

  if (name === 'list_shipments') {
    var srow = await fetchAll(function () {
      var q = db.from('shipments').select('*').order('created_at', { ascending: false });
      if (input.status) { q = q.ilike('status', '%' + input.status + '%'); }
      if (df) { q = q.gte('created_at', df + 'T00:00:00Z'); }
      if (dt) { q = q.lte('created_at', dt + 'T23:59:59Z'); }
      return q;
    });
    return { count: srow.length, rows: srow.slice(0, 300), rows_truncated_for_display: srow.length > 300, source: 'shipments, ' + srow.length + ' rows' };
  }

  return { error: 'Unknown tool: ' + name };
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var userId = body.user_id;
    var question = String(body.question || '').trim();
    var history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }
    if (!question) { return NextResponse.json({ error: 'Ask a question.' }, { status: 400 }); }

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { return NextResponse.json({ error: 'AI key not configured.' }, { status: 400 }); }

    var todayStr = new Date().toISOString().substring(0, 10);
    var sys = 'You are the Reports assistant inside KTC NextTrade Hub. You answer business-data questions using ONLY the provided tools.'
      + ' Today is ' + todayStr + '. Resolve relative periods yourself: "last month" = the previous calendar month; "last 3 months" = the 90 days ending today unless the user clearly means calendar months; pass explicit date_from/date_to.'
      + ' The user may write in English or Arabic, often via voice-to-text — interpret charitably, and answer in the language they asked in.'
      + ' HARD RULES: 1) Every number you state must come from a tool result in this conversation — never from memory, never computed by you across rows; use the totals fields, they are computed by the database over the FULL set. 2) If a tool result says permission_denied, tell the user which permission is missing and stop — do not guess. 3) If a result is empty, say so. 4) End every data answer with a one-line Source citing what the tool reported. 5) Keep answers concise: a short sentence of interpretation, then the key figures; the app renders the full table separately, so do NOT reproduce whole tables in text — mention at most the top handful of rows if useful.';

    var msgs = [];
    for (var h = 0; h < history.length; h++) {
      if (history[h] && history[h].role && history[h].content) { msgs.push({ role: history[h].role, content: String(history[h].content).substring(0, 4000) }); }
    }
    msgs.push({ role: 'user', content: question });

    var tables = []; var sources = []; var toolTrace = [];
    var models = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
    var finalText = null; var lastErr = null;

    var mi;
    for (mi = 0; mi < models.length && finalText == null; mi++) {
      var convo = msgs.slice();
      var round;
      try {
        for (round = 0; round < MAX_ROUNDS; round++) {
          var resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: models[mi], max_tokens: 1600, system: sys, tools: TOOLS, messages: convo })
          });
          var aj = await resp.json();
          if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
          var content = (aj && aj.content) || [];
          var toolUses = []; var textParts = []; var ci;
          for (ci = 0; ci < content.length; ci++) {
            if (content[ci].type === 'tool_use') { toolUses.push(content[ci]); }
            if (content[ci].type === 'text' && content[ci].text) { textParts.push(content[ci].text); }
          }
          if (toolUses.length === 0) { finalText = textParts.join('\n').trim(); break; }
          convo.push({ role: 'assistant', content: content });
          var resultsBlock = []; var ti;
          for (ti = 0; ti < toolUses.length; ti++) {
            var tu = toolUses[ti];
            var out;
            try { out = await execTool(db, tu.name, tu.input, userId, req); }
            catch (eT) { out = { error: (eT && eT.message) || 'tool failed' }; }
            toolTrace.push({ tool: tu.name, input: tu.input, count: out && (out.count != null ? out.count : (out.invoice_count != null ? out.invoice_count : null)), denied: !!(out && out.permission_denied) });
            if (out && out.source) { sources.push(out.source); }
            // Structured tables for the UI (full display slice, CSV-able)
            if (out && !out.permission_denied && !out.error) {
              if (out.rows && out.rows.length) { tables.push({ title: tu.name, rows: out.rows, totals: out.totals || null, truncated: !!out.rows_truncated_for_display }); }
              if (out.invoices && out.invoices.length) { tables.push({ title: 'invoices', rows: out.invoices, totals: out.totals || null }); }
              if (out.payments && out.payments.length) { tables.push({ title: 'payments', rows: out.payments }); }
              if (out.checks && out.checks.length) { tables.push({ title: 'checks', rows: out.checks }); }
            }
            resultsBlock.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).substring(0, 60000) });
          }
          convo.push({ role: 'user', content: resultsBlock });
        }
        if (finalText == null && round >= MAX_ROUNDS) { finalText = 'I hit the safety limit on data lookups for one question — ask it in smaller pieces.'; }
      } catch (eM) { lastErr = (eM && eM.message) || 'model call failed'; finalText = null; tables = []; sources = []; toolTrace = []; }
    }

    if (finalText == null) { return NextResponse.json({ error: 'AI unavailable: ' + (lastErr || 'unknown') }, { status: 502 }); }
    return NextResponse.json({ ok: true, answer: finalText, tables: tables, sources: sources, tool_trace: toolTrace, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'ai-reports failed', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
