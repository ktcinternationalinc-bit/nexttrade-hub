// /api/wave/push-payment — invoice payment push. Wave DOES support recording a payment
// against an invoice via invoicePaymentCreateManual (confirmed by live schema check). The
// exact required input fields are still being verified via a safe validation probe, so this
// route does NOT yet send a real payment. It returns a TRUTHFUL "schema pending" blocker
// (NOT the old, wrong "Wave does not support payments" message), marks the payment row as
// needing a manual Wave entry for now, and records the reason. When the field schema is
// confirmed, replace the blocker block with the real invoicePaymentCreateManual call:
//   invoiceId   = accounting_invoices.wave_invoice_id
//   paymentAccountId = per-business setting (wave_business_settings.default_payment_account_id)
//   amount      = payment row amount
//   paymentDate = payment row payment_date
//   plus paymentMethod / exchangeRate / memo per confirmed schema
//   -> save real wave_payment_id, sync_status='synced', last_synced_at
// SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    var by = body.user_id || null;
    var isDry = body.dry_run === true;

    var msg = 'Invoice payment push is not enabled yet: Wave supports recording invoice payments (invoicePaymentCreateManual), but the exact required input fields are still being verified. For now, enter this payment in Wave manually; Hub will keep it queued. No payment was sent.';

    try {
      await db.from('wave_sync_log').insert({
        wave_business_id: waveBusinessId || null, entity_type: 'payment', hub_record_id: hubId || null,
        action: 'payment_schema_pending', dry_run: isDry, success: false,
        error_message: msg, attempted_by: by
      });
    } catch (eLog) {}

    // On a real push attempt (not dry run), flag the row truthfully so it surfaces as a
    // "Needs Wave entry" item, not a generic failure, and record the reason.
    if (hubId && !isDry) {
      try {
        await db.from('accounting_invoice_payments').update({
          sync_status: 'manual_wave_action_required',
          sync_error: msg
        }).eq('id', hubId);
      } catch (eUpd) {}
    }

    return NextResponse.json({ ok: false, schema_pending: true, manual_wave_action_required: true, error: msg }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}
