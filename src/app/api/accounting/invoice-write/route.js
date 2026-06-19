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

    return NextResponse.json({ ok: false, error: 'Unknown action "' + action + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/accounting/invoice-write', marker: API_BUILD_MARKER }); }
