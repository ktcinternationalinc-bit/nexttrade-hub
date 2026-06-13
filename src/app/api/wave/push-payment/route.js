// /api/wave/push-payment — payment push. Wave's public GraphQL API does NOT reliably
// support creating money transactions ("not available for public use"), so this route
// does NOT fake a push. It validates the request, logs the attempt as unsupported, and
// returns a clear message so the queue can mark the payment sync_failed/unsupported.
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
    var msg = 'Wave\u2019s public API does not support creating payments (money transactions), so Hub cannot push this payment. The invoice balance must be reconciled in Wave directly, or wait for a future build if Wave enables payment creation. No payment was sent.';

    try {
      await db.from('wave_sync_log').insert({
        wave_business_id: waveBusinessId || null, entity_type: 'payment', hub_record_id: hubId || null,
        action: 'push', dry_run: body.dry_run === true, success: false,
        error_message: 'unsupported: ' + msg, attempted_by: by
      });
    } catch (eLog) {}

    if (hubId) {
      try { await db.from('accounting_invoice_payments').update({ sync_status: 'sync_failed' }).eq('id', hubId); } catch (eUpd) {}
    }

    return NextResponse.json({ unsupported: true, error: msg }, { status: 422 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}
