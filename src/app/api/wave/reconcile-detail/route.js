// /api/wave/reconcile-detail — v55.83-ND (Max Aug 12 2026): the actionable half
// of reconciliation. The existing /api/wave/reconcile proves THAT Wave and the
// Hub disagree; this route returns each disagreement as a row the accountant
// can act on, with a "Match Hub" / "Match Wave" choice per row (Max: "either
// can be right - it just needs investigation").
//
// READ-ONLY. This route changes nothing. Execution happens client-side by
// reusing the existing, individually-guarded routes (push-invoice-v2,
// replace-invoice, delete-invoice, import-invoices, push-payment) so every
// money guard those routes carry applies unchanged to reconciliation. A
// second write-path here would be a second set of locks to keep in sync.
//
// Diff types and their legal actions (blocked directions carry the reason):
//   hub_only       Hub invoice with no Wave copy.
//                    match_hub  -> push to Wave
//                    match_wave -> delete the Hub invoice (Wave is right that
//                                  it shouldn't exist)
//   wave_only      Wave invoice with no Hub row.
//                    match_wave -> import to Hub
//                    match_hub  -> BLOCKED: the Hub never deletes a
//                                  Wave-authored invoice; delete inside Wave.
//   total_mismatch Both exist, totals differ.
//                    match_hub  -> replace in Wave (delete+recreate; payment
//                                  guard applies server-side)
//                    match_wave -> re-import (idempotent update by wave id)
//   paid_mismatch  Totals equal, paid differs.
//                    Hub has unpushed payment rows -> match_hub pushes them;
//                                  match_wave voids them.
//                    Wave has more paid than Hub knows -> match_wave
//                                  re-imports (refreshes paid fields);
//                                  match_hub BLOCKED: removing money recorded
//                                  in Wave is manual, in Wave, always.
//
// SWC-safe: var + string concatenation only.
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-ND-reconcile-detail';

function num(m) { if (!m || m.value == null) { return 0; } var v = Number(String(m.value).replace(/,/g, '')); return isNaN(v) ? 0 : v; }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

var PAGE_Q = 'query($businessId: ID!, $page: Int!) { business(id: $businessId) { id invoices(page: $page, pageSize: 100) { pageInfo { totalPages currentPage } edges { node { id invoiceNumber status invoiceDate dueDate customer { id name } total { value currency { code } } amountPaid { value } amountDue { value } } } } } }';

function gqlPage(token, businessId, page) {
  return fetch('https://gql.waveapps.com/graphql/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ query: PAGE_Q, variables: { businessId: businessId, page: page } })
  }).then(function (r) { return r.json().then(function (j) { return { json: j }; }); });
}

function fetchAllHub(admin, businessId) {
  var rows = []; var from = 0; var pageSize = 1000; var guard = 0;
  function loop() {
    guard++;
    if (guard > 100) { return Promise.resolve(rows); }
    return admin.from('accounting_invoices')
      .select('id, wave_invoice_id, wave_business_id, invoice_number, invoice_date, customer_id, total_amount, amount_paid, wave_imported_paid, balance_due, record_status, approval_status, source, is_historical, wave_sync_status, currency')
      .eq('wave_business_id', businessId)
      .range(from, from + pageSize - 1)
      .then(function (res) {
        if (res.error || !res.data || res.data.length === 0) { return rows; }
        for (var i = 0; i < res.data.length; i++) { rows.push(res.data[i]); }
        if (res.data.length < pageSize) { return rows; }
        from += pageSize;
        return loop();
      });
  }
  return loop();
}

function fetchAllPayments(admin, invoiceIds) {
  // Chunked .in() — invoiceIds can be thousands.
  var out = []; var chunks = []; var i;
  for (i = 0; i < invoiceIds.length; i += 200) { chunks.push(invoiceIds.slice(i, i + 200)); }
  function loop(idx) {
    if (idx >= chunks.length) { return Promise.resolve(out); }
    return admin.from('accounting_invoice_payments')
      .select('id, accounting_invoice_id, amount, payment_date, wave_payment_id, voided, sync_status')
      .in('accounting_invoice_id', chunks[idx])
      .then(function (res) {
        if (!res.error && res.data) { for (var j = 0; j < res.data.length; j++) { out.push(res.data[j]); } }
        return loop(idx + 1);
      });
  }
  return loop(0);
}

export async function POST(request) {
  var waveToken = process.env.WAVE_ACCESS_TOKEN;
  var supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!waveToken) { return Response.json({ ok: false, error: 'No Wave token configured.' }); }
  if (!supaUrl || !serviceKey) { return Response.json({ ok: false, error: 'Server database key missing.' }); }

  var body = null;
  try { body = await request.json(); } catch (e) { body = {}; }
  var businessId = body && body.businessId;
  if (!businessId) { return Response.json({ ok: false, error: 'Missing businessId.' }); }

  var admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  var userId = (body && body.userId) || (body && body.user_id) || null;
  var _gate = await assertPermission(admin, userId, 'wave.import.run', request);
  if (!_gate.ok) { return Response.json({ ok: false, error: _gate.error }, { status: _gate.status }); }

  try {
    // 1) All Wave invoices
    var waveList = [];
    var first = await gqlPage(waveToken, businessId, 1);
    if (first.json && first.json.errors) { return Response.json({ ok: false, error: 'Wave API error: ' + JSON.stringify(first.json.errors).substring(0, 300) }); }
    var biz = first.json && first.json.data && first.json.data.business;
    if (!biz || !biz.invoices) { return Response.json({ ok: false, error: 'Wave returned no business/invoices for that ID.' }); }
    var totalPages = biz.invoices.pageInfo.totalPages;
    var edges = biz.invoices.edges || []; var i;
    for (i = 0; i < edges.length; i++) { waveList.push(edges[i].node); }
    var p;
    for (p = 2; p <= totalPages; p++) {
      var pg = await gqlPage(waveToken, businessId, p);
      var b2 = pg.json && pg.json.data && pg.json.data.business;
      var e2 = (b2 && b2.invoices && b2.invoices.edges) || [];
      for (i = 0; i < e2.length; i++) { waveList.push(e2[i].node); }
    }

    // 2) All Hub invoices for this silo + their payments
    var hub = await fetchAllHub(admin, businessId);
    var liveHub = [];
    for (i = 0; i < hub.length; i++) {
      var rsts = hub[i].record_status;
      if (rsts === 'archived' || rsts === 'void' || rsts === 'cancelled') { continue; } // deliberately parked rows are not discrepancies
      liveHub.push(hub[i]);
    }
    var hubIds = []; for (i = 0; i < liveHub.length; i++) { hubIds.push(liveHub[i].id); }
    var pays = await fetchAllPayments(admin, hubIds);
    var paysByInv = {};
    for (i = 0; i < pays.length; i++) {
      var pr = pays[i];
      if (pr.voided === true) { continue; }
      if (!paysByInv[pr.accounting_invoice_id]) { paysByInv[pr.accounting_invoice_id] = { total: 0, pushed: 0, unpushed: [] }; }
      var amt = Number(pr.amount) || 0;
      paysByInv[pr.accounting_invoice_id].total += amt;
      if (pr.wave_payment_id) { paysByInv[pr.accounting_invoice_id].pushed += amt; }
      else { paysByInv[pr.accounting_invoice_id].unpushed.push({ id: pr.id, amount: amt, date: pr.payment_date }); }
    }

    // 3) Join + diff
    var hubByWaveId = {};
    for (i = 0; i < liveHub.length; i++) { if (liveHub[i].wave_invoice_id) { hubByWaveId[liveHub[i].wave_invoice_id] = liveHub[i]; } }
    var waveById = {};
    for (i = 0; i < waveList.length; i++) { waveById[waveList[i].id] = waveList[i]; }

    var TOL = 0.01;
    var diffs = [];
    var matched = 0;

    // Wave-side walk: wave_only + mismatches
    for (i = 0; i < waveList.length; i++) {
      var n = waveList[i];
      var wTotal = r2(num(n.total));
      var wPaid = r2(num(n.amountPaid));
      var wCur = (n.total && n.total.currency && n.total.currency.code) || '';
      var h = hubByWaveId[n.id];
      if (!h) {
        diffs.push({
          type: 'wave_only',
          wave_invoice_id: n.id, invoice_number: n.invoiceNumber, customer: (n.customer && n.customer.name) || '',
          date: n.invoiceDate || '', currency: wCur,
          wave_total: wTotal, hub_total: null, wave_paid: wPaid, hub_paid: null,
          actions: {
            match_wave: { kind: 'import', label: 'Import to Hub' },
            match_hub: { blocked: 'The Hub never deletes a Wave-authored invoice. If this invoice should not exist, delete it inside Wave, then re-run.' }
          }
        });
        continue;
      }
      var hTotal = r2(Number(h.total_amount) || 0);
      var payAgg = paysByInv[h.id] || { total: 0, pushed: 0, unpushed: [] };
      // Hub "paid" for comparison: what Wave should know about = pushed hub
      // payments + what was imported from Wave. Unpushed hub payments are
      // exactly the gap match_hub would close.
      var hPaidKnownToWave = r2(payAgg.pushed + (Number(h.wave_imported_paid) || 0));
      var hPaidAll = r2(payAgg.total + (Number(h.wave_imported_paid) || 0));

      if (Math.abs(wTotal - hTotal) > TOL) {
        diffs.push({
          type: 'total_mismatch',
          wave_invoice_id: n.id, hub_id: h.id, invoice_number: n.invoiceNumber || h.invoice_number, customer: (n.customer && n.customer.name) || '',
          date: n.invoiceDate || h.invoice_date || '', currency: wCur || h.currency || '',
          wave_total: wTotal, hub_total: hTotal, wave_paid: wPaid, hub_paid: hPaidAll,
          hub_source: h.source || '',
          actions: (h.source === 'wave_import' || h.is_historical === true)
            ? { match_wave: { kind: 'import', label: 'Re-import from Wave' },
                match_hub: { blocked: 'This invoice was imported FROM Wave — Wave is its author. Fix it inside Wave, or edit the Hub copy knowing the next import may overwrite it.' } }
            : { match_hub: { kind: 'replace_push', label: 'Replace in Wave with the Hub version' },
                match_wave: { kind: 'import', label: 'Overwrite Hub with the Wave version' } }
        });
        continue;
      }

      if (Math.abs(wPaid - hPaidAll) > TOL) {
        var unpushedSum = 0; var j;
        for (j = 0; j < payAgg.unpushed.length; j++) { unpushedSum += payAgg.unpushed[j].amount; }
        var hubAhead = hPaidAll > wPaid;
        diffs.push({
          type: 'paid_mismatch',
          wave_invoice_id: n.id, hub_id: h.id, invoice_number: n.invoiceNumber || h.invoice_number, customer: (n.customer && n.customer.name) || '',
          date: n.invoiceDate || h.invoice_date || '', currency: wCur || h.currency || '',
          wave_total: wTotal, hub_total: hTotal, wave_paid: wPaid, hub_paid: hPaidAll,
          unpushed_payments: payAgg.unpushed, unpushed_sum: r2(unpushedSum),
          actions: hubAhead
            ? { match_hub: (payAgg.unpushed.length > 0
                  ? { kind: 'push_payments', label: 'Push ' + payAgg.unpushed.length + ' Hub payment(s) to Wave' }
                  : { blocked: 'Hub shows more paid but has no unpushed payment rows to send — inspect this invoice by hand.' }),
                match_wave: (payAgg.unpushed.length > 0
                  ? { kind: 'void_payments', label: 'Void the ' + payAgg.unpushed.length + ' unpushed Hub payment(s)' }
                  : { kind: 'import', label: 'Refresh Hub paid figures from Wave' }) }
            : { match_wave: { kind: 'import', label: 'Refresh Hub paid figures from Wave' },
                match_hub: { blocked: 'Wave shows more paid than the Hub. Removing money recorded in Wave is manual, inside Wave, always — the Hub will never delete a Wave payment.' } }
        });
        continue;
      }
      matched += 1;
    }

    // Hub-side walk: hub_only
    for (i = 0; i < liveHub.length; i++) {
      var hh = liveHub[i];
      if (hh.wave_invoice_id && waveById[hh.wave_invoice_id]) { continue; }
      if (hh.wave_invoice_id && !waveById[hh.wave_invoice_id]) {
        // Link points at a Wave invoice that no longer exists (deleted in Wave).
        diffs.push({
          type: 'hub_only',
          hub_id: hh.id, invoice_number: hh.invoice_number, customer: '', date: hh.invoice_date || '',
          currency: hh.currency || '', wave_total: null, hub_total: r2(Number(hh.total_amount) || 0),
          wave_paid: null, hub_paid: r2(Number(hh.amount_paid) || 0),
          note: 'Hub link points to a Wave invoice that no longer exists (deleted in Wave).',
          actions: {
            match_hub: { kind: 'push', label: 'Push to Wave (re-create it)' },
            match_wave: { kind: 'delete_hub', label: 'Delete the Hub invoice' }
          }
        });
        continue;
      }
      if (!hh.wave_invoice_id) {
        if (hh.source === 'wave_import' || hh.is_historical === true) { continue; } // historical rows without links are not Wave discrepancies
        diffs.push({
          type: 'hub_only',
          hub_id: hh.id, invoice_number: hh.invoice_number, customer: '', date: hh.invoice_date || '',
          currency: hh.currency || '', wave_total: null, hub_total: r2(Number(hh.total_amount) || 0),
          wave_paid: null, hub_paid: r2(Number(hh.amount_paid) || 0),
          actions: {
            match_hub: { kind: 'push', label: 'Push to Wave' },
            match_wave: { kind: 'delete_hub', label: 'Delete the Hub invoice' }
          }
        });
      }
    }

    // Worst money gaps first, so the accountant's attention lands where it matters.
    diffs.sort(function (a, b) {
      function gap(d) {
        var t = Math.abs((d.wave_total == null ? 0 : d.wave_total) - (d.hub_total == null ? 0 : d.hub_total));
        var pdd = Math.abs((d.wave_paid == null ? 0 : d.wave_paid) - (d.hub_paid == null ? 0 : d.hub_paid));
        return Math.max(t, pdd, d.hub_total || 0, d.wave_total || 0);
      }
      return gap(b) - gap(a);
    });

    return Response.json({
      ok: true, api_build_marker: API_BUILD_MARKER,
      wave_count: waveList.length, hub_count: liveHub.length,
      matched: matched, diff_count: diffs.length,
      diffs: diffs
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e && e.message) || 'reconcile-detail failed', api_build_marker: API_BUILD_MARKER });
  }
}
