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
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  try {
    var url = new URL(req.url);
    return url.protocol + '//' + url.host;
  } catch (e) {
    return 'https://nexttrade-hub.vercel.app';
  }
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

    // If the call was actually answered, Twilio still hits this URL because
    // <Dial action=> always fires after <Dial> completes. In that case there
    // won't be a RecordingUrl since the user didn't leave a voicemail.
    if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
      // Call was answered — no voicemail to save
      var twiml = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response><Hangup /></Response>';
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    if (!recordingUrl) {
      // No voicemail recording — caller hung up before leaving a message
      console.log('[phone/voicemail-record] no recording (caller hung up)');
      var twiml2 = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response><Hangup /></Response>';
      return new Response(twiml2, { headers: { 'Content-Type': 'text/xml' } });
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
