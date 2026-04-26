// ============================================================
// /api/phone/recording-callback — FULL CALL RECORDING READY
// ============================================================
// What this does:
//   When a call is set to record-from-answer (the default for
//   recording-enabled numbers in our config), Twilio records the
//   audio and POSTs the URL here when the recording is finalized.
//
//   We:
//     1. Look up the parent call by CallSid
//     2. Save the recording in phone_recordings
//     3. Fire-and-forget Whisper transcription
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
    var formData = await req.formData();
    var callSid = String(formData.get('CallSid') || '');
    var recordingSid = String(formData.get('RecordingSid') || '');
    var recordingUrl = String(formData.get('RecordingUrl') || '');
    var recordingDuration = parseInt(String(formData.get('RecordingDuration') || '0'), 10);

    if (!recordingUrl || !recordingSid) {
      return NextResponse.json({ ok: false, error: 'missing recording data' }, { status: 400 });
    }

    // Find the parent call
    var callRow = null;
    try {
      var lookup = await supabase
        .from('phone_calls')
        .select('id')
        .eq('twilio_call_sid', callSid)
        .maybeSingle();
      callRow = lookup.data;
    } catch (e) {
      console.warn('[phone/recording-callback] call lookup failed:', e.message);
    }

    // Insert the recording row
    var recRow = null;
    try {
      var ins = await supabase.from('phone_recordings').insert({
        call_id: callRow ? callRow.id : null,
        twilio_recording_sid: recordingSid,
        recording_url: recordingUrl,
        duration_seconds: recordingDuration,
        transcript_status: 'pending',
      }).select().single();
      recRow = ins.data;
    } catch (e) {
      console.warn('[phone/recording-callback] insert failed:', e.message);
    }

    // Fire transcription async
    if (recRow && recRow.id) {
      try {
        var transcribeUrl = getPublicBaseUrl(req) + '/api/phone/transcribe-async';
        fetch(transcribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'recording',
            id: recRow.id,
            recording_url: recordingUrl,
          }),
        }).catch(function(err) {
          console.warn('[phone/recording-callback] transcribe trigger failed:', err.message);
        });
      } catch (e) {
        console.warn('[phone/recording-callback] transcribe init failed:', e.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[phone/recording-callback] error:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
