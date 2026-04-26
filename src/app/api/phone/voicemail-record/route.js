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
//     1. Save the voicemail row in phone_voicemails
//     2. Fire-and-forget the Whisper transcription (async)
//     3. Return a small TwiML "thanks for your message" reply
//
// The query string carries call_id, assigned_to, customer_id
// from the parent call (we set those when we built the action
// URL in /api/phone/incoming).
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    var formData = await req.formData();
    var recordingUrl = String(formData.get('RecordingUrl') || '');
    var recordingSid = String(formData.get('RecordingSid') || '');
    var recordingDuration = parseInt(String(formData.get('RecordingDuration') || '0'), 10);
    var dialCallStatus = String(formData.get('DialCallStatus') || ''); // 'answered', 'no-answer', 'busy', 'failed'

    console.log('[phone/voicemail-record] callback received',
      'sid=' + recordingSid,
      'url=' + (recordingUrl ? 'yes' : 'no'),
      'duration=' + recordingDuration,
      'dial=' + dialCallStatus
    );

    // If the call was actually answered (Dial action callback), no voicemail
    if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
      var twiml = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response><Hangup /></Response>';
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
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

    // Dedupe — both action and recordingStatusCallback hit this same URL.
    // Check if we already saved a row for this RecordingSid.
    var existing = null;
    try {
      var existCheck = await supabase
        .from('phone_voicemails')
        .select('id')
        .eq('twilio_recording_sid', recordingSid)
        .maybeSingle();
      existing = existCheck.data;
    } catch (e) {}

    if (existing) {
      console.log('[phone/voicemail-record] already saved sid=' + recordingSid + ' — skipping');
      var twimlDup = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response><Hangup /></Response>';
      return new Response(twimlDup, { headers: { 'Content-Type': 'text/xml' } });
    }

    // Save the voicemail row
    var voicemailRow = null;
    try {
      var ins = await supabase.from('phone_voicemails').insert({
        call_id: call_id || null,
        twilio_recording_sid: recordingSid,
        recording_url: recordingUrl,
        duration_seconds: recordingDuration || 0,
        transcript_status: 'pending',
        assigned_to: assigned_to || null,
        customer_id: customer_id || null,
      }).select().single();
      voicemailRow = ins.data;
    } catch (e) {
      console.warn('[phone/voicemail-record] insert failed:', e.message);
    }

    // Fire-and-forget Whisper transcription. We don't await — Twilio's
    // expecting our TwiML response within ~5 seconds, and Whisper can take
    // 10-30 seconds. The transcribe-async route does its own background work.
    if (voicemailRow && voicemailRow.id) {
      try {
        var transcribeUrl = getPublicBaseUrl(req) + '/api/phone/transcribe-async';
        // Don't await — fire and forget
        fetch(transcribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
