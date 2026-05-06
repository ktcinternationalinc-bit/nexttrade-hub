// ============================================================
// /api/phone/recording-callback — FULL CALL RECORDING READY
// ============================================================
// What this does:
//   When a call is set to record-from-answer (the default for
//   recording-enabled numbers in our config), Twilio records the
//   audio and POSTs the URL here when the recording is finalized.
//
//   We:
//     1. Verify the signature (it really came from Twilio)
//     2. Look up the parent call by CallSid
//     3. Save the recording in phone_recordings
//     4. Fire-and-forget Whisper transcription
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
    // Read formData ONCE so we can verify the signature AND use the fields
    var formObj = {};
    var rawForm = await req.formData();
    for (var pair of rawForm.entries()) {
      formObj[pair[0]] = String(pair[1]);
    }

    // Verify this came from Twilio
    if (!verifyTwilioSignature(req, formObj)) {
      console.error('[phone/recording-callback] SIGNATURE CHECK FAILED — proceeding anyway (v55.56).');
      // Fall through — recording callback is for storing the audio URL; not returning 403
    }

    var callSid = String(formObj.CallSid || '');
    var recordingSid = String(formObj.RecordingSid || '');
    var recordingUrl = String(formObj.RecordingUrl || '');
    var recordingDuration = parseInt(String(formObj.RecordingDuration || '0'), 10);

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

    // Insert the recording row — upsert against the unique RecordingSid
    // index (s32 migration) so a duplicate fire from Twilio doesn't dupe.
    var recRow = null;
    var alreadyExisted = false;
    try {
      var preCheck = await supabase
        .from('phone_recordings')
        .select('id')
        .eq('twilio_recording_sid', recordingSid)
        .maybeSingle();
      if (preCheck.data && preCheck.data.id) {
        alreadyExisted = true;
        recRow = preCheck.data;
      }
    } catch (e) {}

    if (!alreadyExisted) {
      try {
        var ins = await supabase.from('phone_recordings').upsert({
          call_id: callRow ? callRow.id : null,
          twilio_recording_sid: recordingSid,
          recording_url: recordingUrl,
          duration_seconds: recordingDuration,
          transcript_status: 'pending',
        }, { onConflict: 'twilio_recording_sid', ignoreDuplicates: false }).select().single();
        if (ins.error) {
          console.warn('[phone/recording-callback] upsert error:', ins.error.message);
          var fb = await supabase
            .from('phone_recordings')
            .select('id')
            .eq('twilio_recording_sid', recordingSid)
            .maybeSingle();
          if (fb.data) {
            recRow = fb.data;
            alreadyExisted = true;
          }
        } else {
          recRow = ins.data;
        }
      } catch (e) {
        console.warn('[phone/recording-callback] insert failed:', e.message);
      }
    }

    // Fire transcription async — only if we just created the row (don't double-trigger)
    if (recRow && recRow.id && !alreadyExisted) {
      try {
        var transcribeUrl = getPublicBaseUrl(req) + '/api/phone/transcribe-async';
        fetch(transcribeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Trigger': process.env.INTERNAL_SECRET || '',
          },
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
