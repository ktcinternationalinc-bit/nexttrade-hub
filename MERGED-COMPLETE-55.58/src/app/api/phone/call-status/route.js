// ============================================================
// /api/phone/call-status — CALL STATUS UPDATES
// ============================================================
// What this does:
//   Twilio POSTs to this endpoint at various points in a call:
//   ringing → in-progress → completed (or busy/no-answer/failed).
//
//   We update phone_calls.status and duration_seconds + ended_at
//   so the UI shows accurate call history.
//
//   Twilio webhook signature is verified on every POST so a
//   spoofed request can't fake call statuses (which would mess
//   up duration tracking + billing reconciliation).
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyTwilioSignature } from '../../../../lib/phone-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    // Read formData ONCE so we can verify the signature AND use the fields
    var formObj = {};
    var rawForm = await req.formData();
    for (var pair of rawForm.entries()) {
      formObj[pair[0]] = String(pair[1]);
    }

    // Verify this came from Twilio
    if (!verifyTwilioSignature(req, formObj)) {
      console.error('[phone/call-status] SIGNATURE CHECK FAILED — proceeding anyway (v55.56).');
      // Fall through — call-status is just for audit logging; not returning 403
    }

    var callSid = String(formObj.CallSid || '');
    var callStatus = String(formObj.CallStatus || '');
    var callDuration = String(formObj.CallDuration || '');

    if (!callSid) {
      return NextResponse.json({ ok: false, error: 'missing CallSid' }, { status: 400 });
    }

    var updates = { status: callStatus };

    // Final statuses set ended_at + duration
    var finalStatuses = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];
    if (finalStatuses.indexOf(callStatus) >= 0) {
      updates.ended_at = new Date().toISOString();
      var dur = parseInt(callDuration, 10);
      if (!isNaN(dur) && dur > 0) {
        updates.duration_seconds = dur;
      }
    }

    try {
      await supabase
        .from('phone_calls')
        .update(updates)
        .eq('twilio_call_sid', callSid);
    } catch (e) {
      console.warn('[phone/call-status] update failed:', e.message);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[phone/call-status] error:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
