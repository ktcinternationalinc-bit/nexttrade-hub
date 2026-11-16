// /api/accounting/invoice-write — v55.83-JD.
// CRITICAL: invoice approval (and submit-for-review / reopen) were done DIRECTLY from the browser via
// the Supabase client (dbUpdate). That client runs as the "authenticated" role under RLS. This app
// authenticates by EMAIL (users.id != auth.uid()), so any RLS policy keyed to auth.uid() silently
// filters the UPDATE to ZERO rows — the toast says "Invoice approved" but nothing persists, so the
// invoice stays DRAFT and can never be pushed to Wave. This endpoint does the SAME writes with the
// SERVICE-ROLE key (bypasses RLS) + assertPermission + readback + 0-row = explicit error.
// SWC-safe: var + string concat, no template literals/arrows/optional-chaining.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { readInvoiceFromBase64 } from '../../../../lib/invoice-extract-server'; // v55.83-PQ
import { SHIPPING_TERMS, basisOfTerms } from '../../../../lib/shipping-terms'; // v55.83-TG
import { audit } from '../../../../lib/audit-server'; // v55.83-TG

// v55.83-QO — AI document reads need more than Vercel's default 10s.
export const maxDuration = 60;

var API_BUILD_MARKER = 'v55.83-JD-invoice-write';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

var ALLOWED_STATUS = { 'draft': 1, 'internal_review': 1, 'approved': 1 };

export async function POST(req) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var action = body.action || 'set_approval';
    // v55.83-PQ (Max, 05:13): "upload invoices and from invoices it will
    // create the invoice based on data and show on both systems" — the reader
    // PROPOSES a draft (null, never a guess), the human confirms it in the
    // normal editor, and the SAVED invoice flows to Wave + ClickBooks exactly
    // like a hand-entered one. Customer is MATCHED against existing customers,
    // never auto-created.
    if (action === 'extract_invoice') {
      var gX = await assertPermission(db, by, 'invoice.create', req);
      if (!gX.ok) { return NextResponse.json({ ok: false, error: gX.error, api_build_marker: API_BUILD_MARKER }, { status: gX.status || 403 }); }
      var rdI = await readInvoiceFromBase64(String(body.file_base64 || ''), String(body.media_type || ''));
      if (rdI.error) { return NextResponse.json({ ok: false, error: rdI.error, api_build_marker: API_BUILD_MARKER }, { status: rdI.status || 500 }); }
      var candI = [];
      if (rdI.draft && rdI.draft.customer_name) {
        var toks = String(rdI.draft.customer_name).toLowerCase().split(/[^a-z0-9&]+/).filter(function (t9) { return t9.length >= 3; }).slice(0, 3);
        var custAll = await db.from('accounting_customers').select('id, company_name, contact_name, business_tag').limit(3000);
        (custAll.data || []).forEach(function (c9) {
          var nm = ((c9.company_name || '') + ' ' + (c9.contact_name || '')).toLowerCase();
          var hits = 0; toks.forEach(function (t10) { if (nm.indexOf(t10) >= 0) { hits++; } });
          if (hits > 0 && toks.length > 0) { candI.push({ id: c9.id, name: c9.company_name || c9.contact_name || '', score: hits / toks.length }); }
        });
        candI.sort(function (a9, b9) { return b9.score - a9.score; });
        candI = candI.slice(0, 6);
      }
      return NextResponse.json({ ok: true, draft: rdI.draft, problems: rdI.problems, customer_candidates: candI, api_build_marker: API_BUILD_MARKER });
    }

    var invoiceId = body.invoice_id || null;
    if (!invoiceId) { return NextResponse.json({ ok: false, error: 'invoice_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // ── set_approval: draft -> internal_review -> approved ──
    if (action === 'set_approval') {
      var status = String(body.status || '').trim().toLowerCase();
      if (!ALLOWED_STATUS[status]) { return NextResponse.json({ ok: false, error: 'Invalid status "' + status + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      // Approving is gated on invoices.approve; submit-for-review / back-to-draft on invoices.edit.
      var permKey = (status === 'approved') ? 'invoices.approve' : 'invoices.edit';
      var gate = await assertPermission(db, by, permKey, req);
      if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }

      var patch = { approval_status: status, updated_by: by };
      if (status === 'approved') { patch.approved_by = by; patch.approved_at = new Date().toISOString(); patch.ready_for_wave = true; }
      else { patch.ready_for_wave = false; }

      var res = await db.from('accounting_invoices').update(patch).eq('id', invoiceId).select();
      if (res && res.error) { return NextResponse.json({ ok: false, error: 'Approval write failed: ' + res.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(res && res.data && res.data.length)) { return NextResponse.json({ ok: false, error: 'No invoice row updated (not found, or it was filtered out). Refresh and try again.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      var row = res.data[0];
      if (row.approval_status !== status) { return NextResponse.json({ ok: false, error: 'Saved but did not read back as ' + status + ' (got ' + row.approval_status + ').', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
      return NextResponse.json({ ok: true, row: row, api_build_marker: API_BUILD_MARKER });
    }

    // ── reopen: approved -> internal_review (Owner/Admin/Accounting Mgr), with audit reason ──
    if (action === 'reopen') {
      var rgate = await assertPermission(db, by, 'invoices.approve', req);
      if (!rgate.ok) { return NextResponse.json({ ok: false, error: rgate.error, api_build_marker: API_BUILD_MARKER }, { status: rgate.status }); }
      var rpatch = { approval_status: 'internal_review', ready_for_wave: false, updated_by: by };
      if (body.wave_touch === true) { rpatch.wave_sync_status = 'pending_sync'; }
      var rres = await db.from('accounting_invoices').update(rpatch).eq('id', invoiceId).select();
      if (rres && rres.error) { return NextResponse.json({ ok: false, error: 'Reopen write failed: ' + rres.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(rres && rres.data && rres.data.length)) { return NextResponse.json({ ok: false, error: 'No invoice row updated (not found / filtered).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, row: rres.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── set_line_product: map a Wave product onto ONE invoice line as sync METADATA ONLY (no financial edit).
    // v55.83-MS (Codex QA #1) — lets an approved/pending invoice get a per-line Wave product mapping without
    // reopening it; this NEVER touches description, quantity, unit price, totals, approval, or payment state.
    if (action === 'set_line_product') {
      var lgate = await assertPermission(db, by, 'invoices.edit', req);
      if (!lgate.ok) { return NextResponse.json({ ok: false, error: lgate.error, api_build_marker: API_BUILD_MARKER }, { status: lgate.status }); }
      var itemId = body.item_id || null;
      if (!itemId) { return NextResponse.json({ ok: false, error: 'item_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var lpatch = { wave_product_id: body.wave_product_id || null, wave_product_name: body.wave_product_name || null };
      var lres = await db.from('accounting_invoice_items').update(lpatch).eq('id', itemId).eq('invoice_id', invoiceId).select('id, wave_product_id, wave_product_name');
      if (lres && lres.error) { return NextResponse.json({ ok: false, error: 'Product mapping write failed: ' + lres.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(lres && lres.data && lres.data.length)) { return NextResponse.json({ ok: false, error: 'No invoice line updated (not found, or it belongs to a different invoice).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, item: lres.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── v55.83-TG (Max, Nov 16): the invoice's SHIPPING TERMS — one value per invoice, kept in pl_invoice_terms (the row the
    // profit report reads), with who/when and an audit entry. The invoice itself (amounts, lines, Wave) is not changed.
    if (action === 'get_shipping_terms') {
      var gg = await assertPermission(db, by, 'invoices.view', req);
      if (!gg.ok) { return NextResponse.json({ ok: false, error: gg.error, api_build_marker: API_BUILD_MARKER }, { status: gg.status }); }
      var gt = await db.from('pl_invoice_terms').select('*').eq('invoice_id', invoiceId).maybeSingle();
      if (gt.error) { return NextResponse.json({ ok: false, error: gt.error.message, api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
      var d0 = gt.data || {};
      return NextResponse.json({ ok: true, shipping_terms: d0.shipping_terms || null, shipping_cost_estimate: d0.shipping_cost_estimate === undefined ? null : d0.shipping_cost_estimate, ready: !gt.data || Object.prototype.hasOwnProperty.call(gt.data, 'shipping_terms'), api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_shipping_terms') {
      var sg = await assertPermission(db, by, 'invoices.edit', req);
      if (!sg.ok) { return NextResponse.json({ ok: false, error: sg.error, api_build_marker: API_BUILD_MARKER }, { status: sg.status }); }
      var stt = String(body.shipping_terms || '');
      if (SHIPPING_TERMS.indexOf(stt) < 0) { return NextResponse.json({ ok: false, error: 'Pick the shipping terms: EXW, CNF in the price, or CNF with a separate shipping line.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var sc = body.shipping_cost_estimate === null || body.shipping_cost_estimate === undefined || body.shipping_cost_estimate === '' ? null : Number(body.shipping_cost_estimate);
      if (sc !== null && (isNaN(sc) || sc < 0)) { return NextResponse.json({ ok: false, error: 'The shipping cost must be a number, zero or more.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (stt !== 'EXW' && !(sc > 0)) { return NextResponse.json({ ok: false, error: 'CNF needs the shipping cost we expect to pay.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var inv0 = await db.from('accounting_invoices').select('id').eq('id', invoiceId).maybeSingle();
      if (inv0.error || !inv0.data) { return NextResponse.json({ ok: false, error: 'Invoice not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      var prevS = await db.from('pl_invoice_terms').select('*').eq('invoice_id', invoiceId).maybeSingle();
      var nowS = new Date().toISOString();
      var rowS = { invoice_id: invoiceId, basis: basisOfTerms(stt), shipping_terms: stt, shipping_cost_estimate: sc, updated_by: by, updated_at: nowS };
      if (stt === 'EXW') { rowS.embedded_transport = null; } // EXW never has shipping inside the price
      var upS = await db.from('pl_invoice_terms').upsert(rowS, { onConflict: 'invoice_id' }).select('invoice_id, shipping_terms, shipping_cost_estimate');
      if (upS.error) {
        var msgS = /shipping_terms|shipping_cost_estimate|column/i.test(upS.error.message) ? 'The shipping-terms columns are not in the database yet — run sql/v55-83-TG2-invoice-shipping-terms.sql in Supabase.' : upS.error.message;
        return NextResponse.json({ ok: false, error: msgS, api_build_marker: API_BUILD_MARKER }, { status: 400 });
      }
      if (!(upS.data && upS.data.length && upS.data[0].shipping_terms === stt)) { return NextResponse.json({ ok: false, error: 'Shipping terms did not read back — not saved.', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
      try { await audit(db, by, 'invoice_shipping_terms_set', 'accounting_invoice', invoiceId, { from: prevS && prevS.data ? { shipping_terms: prevS.data.shipping_terms || null, shipping_cost_estimate: prevS.data.shipping_cost_estimate === undefined ? null : prevS.data.shipping_cost_estimate, basis: prevS.data.basis || null } : null, to: { shipping_terms: stt, shipping_cost_estimate: sc, basis: rowS.basis } }); } catch (eA) {}
      return NextResponse.json({ ok: true, saved: upS.data[0], api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/accounting/invoice-write', marker: API_BUILD_MARKER }); }
