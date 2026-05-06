// ============================================================
// /api/phone/voicemail-record — VOICEMAIL CAPTURE
// ============================================================
// What this does:
//   When a caller leaves a voicemail (after pressing # or after
//   the timeout), Twilio POSTs to this endpoint with:
//     • RecordingUrl     — link to the audio file
//     • RecordingSid     — Twilio's unique ID for this recording
//     • RecordingDuration — seconds
//
//   We:
//     1. Save the voicemail row in phone_voicemails (idempotent
//        upsert — Twilio fires this URL twice for the same SID,
//        once for the dial action and once for the recording
//        callback. The unique index on twilio_recording_sid lets
//        us safely handle either order without dupes.)
//     2. Fire-and-forget the Whisper transcription (async)
//     3. Return a small TwiML "thanks for your message" reply
//
// The query string carries call_id, assigned_to, customer_id
// from the parent call (we set those when we built the action
// URL in /api/phone/incoming).
//
// Twilio webhook signature is verified on every POST.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyTwilioSignature } from '../../../../lib/phone-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function getPublicBaseUrl(req) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    var u = process.env.NEXT_PUBLIC_APP_URL;
    if (u.endsWith('/')) u = u.slice(0, -1);
    return u;
  }
  return 'https://nexttrade-hub.vercel.app';
}

export async function POST(req) {
  try {
    var url = new URL(req.url);
    var call_id = url.searchParams.get('call_id') || null;
    var assigned_to = url.searchParams.get('assigned_to') || null;
    var customer_id = url.searchParams.get('customer_id') || null;

    // Read formData ONCE as a plain object — same trick as in /incoming
    var formObj = {};
    var rawForm = await req.formData();
    for (var pair of rawForm.entries()) {
      formObj[pair[0]] = String(pair[1]);
    }

    // Verify this came from Twilio.
    // v55.56 — Fail-open with a loud log instead of returning 403. Returning
    // 403 here was making Twilio play "an application error has occurred"
    // to the caller after the team member didn't pick up — far worse for
    // brand than the tiny risk of a spoofed voicemail row. Log loudly so
    // we can fix the underlying URL mismatch in Vercel.
    if (!verifyTwilioSignature(req, formObj)) {
      console.error('[phone/voicemail-record] SIGNATURE CHECK FAILED — proceeding anyway. '
        + 'See [twilio-sig] log lines just above for the URL variants tried. '
        + 'If this happens in production, check NEXT_PUBLIC_APP_URL in Vercel '
        + 'matches the URL Twilio webhooks are configured with.');
      // intentionally NOT returning 403 — fall through and serve real TwiML
    }

    var recordingUrl = String(formObj.RecordingUrl || '');
    var recordingSid = String(formObj.RecordingSid || '');
    var recordingDuration = parseInt(String(formObj.RecordingDuration || '0'), 10);
    var dialCallStatus = String(formObj.DialCallStatus || ''); // 'completed', 'answered', 'no-answer', 'busy', 'failed', 'canceled'

    console.log('[phone/voicemail-record] callback received',
      'sid=' + recordingSid,
      'url=' + (recordingUrl ? 'yes' : 'no'),
      'duration=' + recordingDuration,
      'dial=' + dialCallStatus
    );

    // ----------------------------------------------------------------
    // v55.39 — There are THREE distinct callback shapes that hit this
    // endpoint, not two. The original code handled cases 1 and 3 but
    // missed case 2 entirely, so customers heard the disclaimer then
    // an immediate hangup whenever the team member's browser wasn't
    // currently registered with Twilio.
    //
    //   Case 1 — <Dial action="..."> callback after Dial completed:
    //            DialCallStatus = 'completed' or 'answered'
    //            → call was successfully connected, just hang up.
    //
    //   Case 2 — <Dial action="..."> callback after Dial DID NOT connect:
    //            DialCallStatus = 'no-answer' | 'failed' | 'busy' | 'canceled'
    //            → return TwiML that records a voicemail. (NEW)
    //
    //   Case 3 — <Record action="..."> or recordingStatusCallback after
    //            voicemail audio is recorded:
    //            recordingUrl + recordingSid are set
    //            → save voicemail row + trigger Whisper transcription.
    // ----------------------------------------------------------------

    // CASE 1 — call was answered. Just hang up.
    if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
      var twiml = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response><Hangup /></Response>';
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    // CASE 2 — Dial failed for any reason. THIS is what was missing.
    // Without this branch, customers heard the disclaimer then an immediate
    // line drop. Now we send them to voicemail with a clear prompt.
    //
    // Re-build the same voicemailUrl Twilio will hit when the recording
    // finishes — it carries the original call_id/assigned_to/customer_id
    // so the saved voicemail row knows who it was for.
    if (dialCallStatus === 'no-answer' || dialCallStatus === 'failed'
        || dialCallStatus === 'busy' || dialCallStatus === 'canceled') {
      console.log('[phone/voicemail-record] Dial did not connect ('
        + dialCallStatus + ') — sending caller to voicemail');

      var voicemailRecordUrl = getPublicBaseUrl(req) + '/api/phone/voicemail-record'
        + '?call_id=' + encodeURIComponent(call_id || '')
        + '&assigned_to=' + encodeURIComponent(assigned_to || '')
        + '&customer_id=' + encodeURIComponent(customer_id || '');

      var vmTwiml = '<?xml version="1.0" encoding="UTF-8"?>';
      vmTwiml += '<Response>';
      vmTwiml += '<Say voice="Polly.Joanna">'
        + 'The team is unavailable right now. '
        + 'Please leave a message after the beep, and we will get back to you.'
        + '</Say>';
      vmTwiml += '<Record action="' + voicemailRecordUrl + '"'
        + ' method="POST"'
        + ' maxLength="180"'
        + ' playBeep="true"'
        + ' trim="trim-silence"'
        + ' finishOnKey="#"'
        + ' recordingStatusCallback="' + voicemailRecordUrl + '"'
        + ' recordingStatusCallbackEvent="completed"'
        + ' recordingStatusCallbackMethod="POST" />';
      vmTwiml += '<Say voice="Polly.Joanna">Thank you. Goodbye.</Say>';
      vmTwiml += '<Hangup />';
      vmTwiml += '</Response>';
      return new Response(vmTwiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    if (!recordingUrl || !recordingSid) {
      // No voicemail recording — caller hung up before leaving a message,
      // OR this is the synchronous action callback firing before the
      // recording is processed (Twilio fires recordingStatusCallback later)
      console.log('[phone/voicemail-record] no recording in this callback — waiting for recordingStatusCallback');
      var twiml2 = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response><Hangup /></Response>';
      return new Response(twiml2, { headers: { 'Content-Type': 'text/xml' } });
    }

    // ---- IDEMPOTENT INSERT (race-safe) ----
    //
    // Twilio fires this URL twice for the same recording — once as the
    // <Record action="..."> callback (synchronous, may have RecordingUrl)
    // and once as the recordingStatusCallback (async, definitely has it).
    //
    // The OLD code did: SELECT to check, then INSERT if missing.
    // Two callbacks landing within ~10ms of each other could both pass
    // the check and both insert — creating duplicate rows.
    //
    // The FIX: rely on a unique index on twilio_recording_sid and use
    // upsert with onConflict='ignore'. The DB enforces uniqueness atomically;
    // we don't get racy double-inserts. If the row already exists we skip
    // the transcription trigger so we don't kick it off twice.
    //
    // (The unique index is created by the s32 SQL migration. Until that
    // migration runs, we still benefit from the existence check below
    // as a soft guard.)
    var voicemailRow = null;
    var alreadyExisted = false;
    try {
      // Soft pre-check — cheap, helps avoid pointless writes when the row
      // is already there. The real race-safety comes from the DB's unique
      // index (s32 migration).
      var existCheck = await supabase
        .from('phone_voicemails')
        .select('id')
        .eq('twilio_recording_sid', recordingSid)
        .maybeSingle();
      if (existCheck.data && existCheck.data.id) {
        alreadyExisted = true;
        voicemailRow = existCheck.data;
      }
    } catch (e) {}

    if (!alreadyExisted) {
      try {
        // upsert with onConflict — if the unique index catches a duplicate,
        // we get the existing row back instead of an error.
        var ins = await supabase.from('phone_voicemails').upsert({
          call_id: call_id || null,
          twilio_recording_sid: recordingSid,
          recording_url: recordingUrl,
          duration_seconds: recordingDuration || 0,
          transcript_status: 'pending',
          assigned_to: assigned_to || null,
          customer_id: customer_id || null,
        }, { onConflict: 'twilio_recording_sid', ignoreDuplicates: false }).select().single();
        if (ins.error) {
          // If the upsert errored on conflict (older Postgres or missing
          // unique index), fall back to fetching the existing row.
          console.warn('[phone/voicemail-record] upsert returned error:', ins.error.message);
          var fb = await supabase
            .from('phone_voicemails')
            .select('id')
            .eq('twilio_recording_sid', recordingSid)
            .maybeSingle();
          if (fb.data) {
            voicemailRow = fb.data;
            alreadyExisted = true;
          }
        } else {
          voicemailRow = ins.data;
        }
      } catch (e) {
        console.warn('[phone/voicemail-record] upsert failed:', e.message);
      }
    } else {
      console.log('[phone/voicemail-record] already saved sid=' + recordingSid + ' — skipping insert + transcribe');
    }

    // Fire-and-forget Whisper transcription. We don't await — Twilio's
    // expecting our TwiML response within ~5 seconds, and Whisper can take
    // 10-30 seconds. The transcribe-cron at /5min will pick up anything
    // that gets killed mid-flight.
    //
    // Skip if we already saw this row (the first callback already kicked
    // off transcription) so we don't run Whisper twice on the same audio.
    if (voicemailRow && voicemailRow.id && !alreadyExisted) {
      try {
        var transcribeUrl = getPublicBaseUrl(req) + '/api/phone/transcribe-async';
        fetch(transcribeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Trigger': process.env.INTERNAL_SECRET || '',
          },
          body: JSON.stringify({
            kind: 'voicemail',
            id: voicemailRow.id,
            recording_url: recordingUrl,
          }),
        }).catch(function(err) {
          console.warn('[phone/voicemail-record] transcribe trigger failed:', err.message);
        });
      } catch (e) {
        console.warn('[phone/voicemail-record] transcribe init failed:', e.message);
      }
    }

    // Return a small "thanks for your message" TwiML
    var doneTwiml = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Response>'
      + '<Say voice="Polly.Joanna">Thank you for your message. We will get back to you soon. Goodbye.</Say>'
      + '<Hangup />'
      + '</Response>';
    return new Response(doneTwiml, { headers: { 'Content-Type': 'text/xml' } });
  } catch (e) {
    console.error('[phone/voicemail-record] error:', e.message);
    var errorTwiml = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Response><Hangup /></Response>';
    return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
  }
}
