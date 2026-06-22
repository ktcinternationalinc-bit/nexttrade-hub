// /api/wave/prefill-payment-links — v55.83-LM. PREFILL the deposit -> invoice links from Wave.
//
// Wave's invoice PAYMENTS are readable (unlike money transactions). This route reads each invoice's
// payments[] and, for a payment recorded directly in Wave (not already a Hub payment row), finds the ONE
// matching unlinked bank deposit (same direction + amount + date window) and links it to that invoice —
// so the blotter mirrors which deposit paid which invoice.
//
// SAFETY / why this can't corrupt balances (verified design wf_6bd10609):
//  - DISPLAY-LINK ONLY (v1): it writes a payment_matches row + stamps bank_transactions.matched_invoice_id,
//    EXACTLY like the Hub's match_invoice path — but it does NOT insert an accounting_invoice_payments row
//    and does NOT touch wave_imported_paid. The app derives paid = wave_imported_paid + SUM(payment rows);
//    Wave's paid is ALREADY fully inside wave_imported_paid, so adding no payment row + changing no
//    wave_imported_paid means every paid/balance number is provably unchanged. There is no money arithmetic
//    to get wrong. (Itemizing each payment as its own row is a later, separately-tested step.)
//  - dry_run is the DEFAULT — it reads + plans + writes NOTHING and returns the full per-payment plan.
//  - UNIQUE candidate only: if 0 or >1 deposits match, it links nothing (ambiguous -> manual).
//  - Idempotent: a deposit that already has matched_invoice_id is never a candidate, so re-running is safe.
//  - NO Wave writes (GraphQL read only). Gated wave.import.run. Placeholder silos rejected.
// SWC-safe: var + string concat only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business';
import { roundMoney } from '../../../../lib/payment-matching';

var API_BUILD_MARKER = 'v55.83-LM-prefill-payment-links';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function num(m) { if (!m || m.value == null) { return 0; } var v = Number(String(m.value).replace(/,/g, '')); return isNaN(v) ? 0 : v; }
function dayDiff(a, b) { var da = Date.parse(String(a) + 'T00:00:00Z'); var db2 = Date.parse(String(b) + 'T00:00:00Z'); if (!isFinite(da) || !isFinite(db2)) { return 9999; } return Math.abs(Math.round((da - db2) / 86400000)); }
async function gql(token, query, variables) {
  var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query, variables: variables }) });
  var data = null; try { data = await resp.json(); } catch (e) { data = null; }
  return { okHttp: resp.ok, status: resp.status, data: data };
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var waveBusinessId = body.wave_business_id || null;
    var isDry = body.dry_run !== false; // DEFAULT dry-run; must pass dry_run:false to write
    var windowDays = Number(body.date_window_days); if (!(windowDays >= 0)) { windowDays = 0; }
    var maxPages = Math.min(Number(body.max_pages) || 40, 200);
    var token = process.env.WAVE_ACCESS_TOKEN;

    var gate = await assertPermission(db, by, 'wave.import.run', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!token) { return NextResponse.json({ ok: false, error: 'No Wave token configured (WAVE_ACCESS_TOKEN).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!waveBusinessId) { return NextResponse.json({ ok: false, error: 'wave_business_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (isPlaceholderWaveBusiness(waveBusinessId)) { return NextResponse.json({ ok: false, error: 'This silo is not connected to a real Wave business yet (placeholder id).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // ── Hub state (read once) ───────────────────────────────────────────────
    // invoices in this silo, keyed by wave_invoice_id (paginate; never cap).
    var invByWave = {}; var from = 0; var pageSz = 1000; var ig = 0;
    while (ig < 100) {
      ig++;
      var ir = await db.from('accounting_invoices').select('id, total_amount, wave_imported_paid, accounting_customer_id, wave_invoice_id, business_id, invoice_number').eq('wave_business_id', waveBusinessId).not('wave_invoice_id', 'is', null).range(from, from + pageSz - 1);
      if (ir && ir.error) { return NextResponse.json({ ok: false, error: 'Invoice read failed: ' + ir.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var irows = (ir && ir.data) || [];
      var ii; for (ii = 0; ii < irows.length; ii++) { invByWave[irows[ii].wave_invoice_id] = irows[ii]; }
      if (irows.length < pageSz) { break; }
      from += pageSz;
    }

    // existing payment rows that already carry a wave_payment_id — skip those payments (already
    // materialized as a Hub row or a prior prefill). Presence is enough (even a voided row means it was
    // handled before), so we don't double-create.
    var paidWaveIds = {};
    var pr = await db.from('accounting_invoice_payments').select('wave_payment_id').eq('wave_business_id', waveBusinessId).not('wave_payment_id', 'is', null);
    if (pr && pr.error) { return NextResponse.json({ ok: false, error: 'Payment read failed: ' + pr.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    ((pr && pr.data) || []).forEach(function (p) { if (p.wave_payment_id) { paidWaveIds[p.wave_payment_id] = true; } });

    // candidate deposits in this silo (money-in, not yet linked, not Wave-pushed).
    var depRes = await db.from('bank_transactions').select('id, name, amount, amount_abs, posted_date, date, direction, matched_invoice_id, wave_transaction_id, accounting_customer_id, business_id, classification').eq('wave_business_id', waveBusinessId).eq('direction', 'in');
    if (depRes && depRes.error) { return NextResponse.json({ ok: false, error: 'Deposit read failed: ' + depRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var deposits = ((depRes && depRes.data) || []).filter(function (t) { return !t.matched_invoice_id && !t.wave_transaction_id; });

    // ── Wave invoice payments (read only) ────────────────────────────────────
    var query = 'query($bid: ID!, $page: Int!){ business(id:$bid){ invoices(page:$page, pageSize:25){ pageInfo{ totalPages } edges{ node{ id invoiceNumber payments{ id amount{ value } paymentDate account{ id name } } } } } } }';
    var page = 1; var totalPages = 1; var safety = 0; var firstError = null;
    var used = {}; var plan = []; var counts = { invoices_scanned: 0, payments_found: 0, already_materialized: 0, invoice_not_imported: 0, would_link: 0, ambiguous: 0, no_candidate: 0, applied: 0, apply_errors: 0 };

    while (page <= totalPages && safety < maxPages) {
      safety++;
      var resp = await gql(token, query, { bid: waveBusinessId, page: page });
      var data = resp.data;
      if (!resp.okHttp || (data && data.errors && data.errors.length)) { firstError = (data && data.errors && data.errors[0] && data.errors[0].message) ? data.errors[0].message : ('HTTP ' + resp.status); break; }
      var conn = data && data.data && data.data.business && data.data.business.invoices;
      if (!conn) { firstError = 'No invoices field returned (token may not access this business).'; break; }
      if (conn.pageInfo && conn.pageInfo.totalPages) { totalPages = conn.pageInfo.totalPages; }
      var edges = conn.edges || [];
      var e;
      for (e = 0; e < edges.length; e++) {
        var node = edges[e].node; counts.invoices_scanned++;
        var inv = invByWave[node.id] || null;
        var pays = (node && node.payments) || [];
        var pi;
        for (pi = 0; pi < pays.length; pi++) {
          var pay = pays[pi]; var amt = roundMoney(num(pay.amount));
          if (!(amt > 0)) { continue; }
          counts.payments_found++;
          if (paidWaveIds[pay.id]) { counts.already_materialized++; continue; }
          if (!inv) { counts.invoice_not_imported++; plan.push({ wave_payment_id: pay.id, invoice: node.invoiceNumber || node.id, amount: amt, action: 'invoice_not_imported' }); continue; }
          var pd = String(pay.paymentDate || '').slice(0, 10);
          // find unique candidate deposit
          var hits = []; var d;
          for (d = 0; d < deposits.length; d++) {
            var t = deposits[d]; if (used[t.id]) { continue; }
            var damt = roundMoney(t.amount_abs != null ? t.amount_abs : Math.abs(Number(t.amount) || 0));
            if (Math.abs(damt - amt) > 0.01) { continue; }
            var td = String(t.posted_date || t.date || '').slice(0, 10);
            if (pd && td && dayDiff(pd, td) > windowDays) { continue; }
            hits.push(t);
          }
          if (hits.length === 0) { counts.no_candidate++; plan.push({ wave_payment_id: pay.id, invoice: node.invoiceNumber || node.id, amount: amt, date: pd, action: 'no_candidate' }); continue; }
          if (hits.length > 1) { counts.ambiguous++; plan.push({ wave_payment_id: pay.id, invoice: node.invoiceNumber || node.id, amount: amt, date: pd, candidate_count: hits.length, action: 'ambiguous' }); continue; }
          var dep = hits[0];
          // Display match amount = the Wave payment's actual amount, capped at the deposit. We do NOT run
          // classifyApplication here: wave_imported_paid ALREADY includes this Wave payment, so feeding it
          // back would mis-classify it as a $0 overpayment. This is a display link, not a new application.
          var depAmt = roundMoney(dep.amount_abs != null ? dep.amount_abs : Math.abs(Number(dep.amount) || 0));
          var matchAmt = roundMoney(Math.min(amt, depAmt > 0 ? depAmt : amt));
          var matchType = (matchAmt >= depAmt - 0.01) ? 'full' : 'partial';
          counts.would_link++;
          var planRow = { wave_payment_id: pay.id, invoice: node.invoiceNumber || node.id, hub_invoice_id: inv.id, amount: amt, applied: matchAmt, deposit_id: dep.id, deposit_name: dep.name, date: pd, action: 'link' };
          if (isDry) { used[dep.id] = true; plan.push(planRow); continue; }

          // APPLY (display-link only): payment_matches row + stamp bank_transactions. NO payment row, NO
          // wave_imported_paid change, NO recompute -> paid invariant provably untouched.
          var mIns = await db.from('payment_matches').insert({ business_id: dep.business_id || inv.business_id || null, wave_business_id: waveBusinessId, bank_transaction_id: dep.id, invoice_id: inv.id, matched_amount: matchAmt, match_type: matchType, is_manual_override: false, notes: 'prefill: Wave payment ' + pay.id, matched_by: by, created_by: by }).select('id');
          if (mIns && mIns.error) { counts.apply_errors++; planRow.action = 'error'; planRow.error = mIns.error.message; plan.push(planRow); continue; }
          var txnRes = await db.from('bank_transactions').update({ linked_type: 'invoice', linked_id: inv.id, matched_invoice_id: inv.id, classification: dep.classification || 'customer_payment', accounting_customer_id: dep.accounting_customer_id || inv.accounting_customer_id || null, updated_by: by }).eq('id', dep.id).is('matched_invoice_id', null).select('id');
          if (txnRes && txnRes.error) { counts.apply_errors++; planRow.action = 'error'; planRow.error = txnRes.error.message; plan.push(planRow); continue; }
          used[dep.id] = true; counts.applied++; planRow.action = 'linked'; plan.push(planRow);
        }
      }
      page++;
    }

    try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'invoice_payment', action: 'prefill_links', dry_run: isDry, success: !firstError, error_message: firstError, response_payload: { mode: isDry ? 'dry_run' : 'apply', window_days: windowDays, counts: counts, plan_sample: plan.slice(0, 50) }, attempted_by: by }); } catch (eL) {}

    return NextResponse.json({ ok: !firstError || counts.payments_found > 0, dry_run: isDry, wave_business_id: waveBusinessId, window_days: windowDays, counts: counts, plan: plan.slice(0, 200), error: firstError || null, note: 'Display-link only: sets the deposit→invoice link for the blotter. Does NOT change any paid/balance amount (those already reflect Wave). Unique-match-only; ambiguous/none left for manual review.', api_build_marker: API_BUILD_MARKER }, { status: (firstError && counts.payments_found === 0) ? 400 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/prefill-payment-links', marker: API_BUILD_MARKER }); }
