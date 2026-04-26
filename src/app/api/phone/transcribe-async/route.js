// ============================================================
// /api/phone/transcribe-async — WHISPER TRANSCRIPTION
// ============================================================
// What this does:
//   Called by /api/phone/voicemail-record and
//   /api/phone/recording-callback after a recording is saved
//   to the DB. We:
//
//     1. Fetch the audio file from Twilio (auth required)
//     2. Send it to OpenAI Whisper for transcription
//     3. Save the transcript back to the DB
//
//   Whisper is much better than Twilio's transcription for
//   AR/EN code-switching (KTC team often mixes both).
//
// Why async?
//   Twilio expects TwiML responses within ~5 seconds. Whisper
//   takes 10-30 seconds for a typical voicemail. So we save
//   the recording first, return TwiML immediately, and process
//   transcription in the background.
//
// Maximum duration:
//   This route runs as a serverless function. On Vercel
//   hobby/pro tiers, function timeout is 60-300 seconds. 3-min
//   voicemails (180s) transcribed in <30s is well within budget.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Run as Node runtime (we need fetch with FormData and longer timeout)
export const runtime = 'nodejs';
export const maxDuration = 60; // seconds

export async function POST(req) {
  try {
    var body = await req.json();
    var kind = body.kind;             // 'voicemail' or 'recording'
    var id = body.id;                 // primary key in respective table
    var recordingUrl = body.recording_url;

    if (!kind || !id || !recordingUrl) {
      return NextResponse.json({ ok: false, error: 'missing kind, id, or recording_url' }, { status: 400 });
    }

    var tableName;
    if (kind === 'voicemail') tableName = 'phone_voicemails';
    else if (kind === 'recording') tableName = 'phone_recordings';
    else return NextResponse.json({ ok: false, error: 'invalid kind' }, { status: 400 });

    // Mark as transcribing so the UI can show a spinner
    try {
      await supabase.from(tableName).update({ transcript_status: 'transcribing' }).eq('id', id);
    } catch (e) { /* non-fatal */ }

    var openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.warn('[transcribe] OPENAI_API_KEY not set — skipping transcription');
      try {
        await supabase.from(tableName).update({ transcript_status: 'failed', transcript: '(OPENAI_API_KEY not configured)' }).eq('id', id);
      } catch (e) {}
      return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY not configured' }, { status: 400 });
    }

    var twilioSid = process.env.TWILIO_ACCOUNT_SID;
    var twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (!twilioSid || !twilioToken) {
      try {
        await supabase.from(tableName).update({ transcript_status: 'failed', transcript: '(Twilio credentials missing)' }).eq('id', id);
      } catch (e) {}
      return NextResponse.json({ ok: false, error: 'Twilio credentials missing' }, { status: 400 });
    }

    // 1. Fetch the audio from Twilio. Twilio requires Basic Auth using
    //    Account SID + Auth Token. The URL Twilio gives us doesn't
    //    include a file extension — we add .mp3 to make it work in
    //    OpenAI's multipart upload.
    var audioUrl = recordingUrl;
    if (!audioUrl.endsWith('.mp3')) audioUrl = audioUrl + '.mp3';

    var basicAuth = 'Basic ' + Buffer.from(twilioSid + ':' + twilioToken).toString('base64');
    var audioRes = await fetch(audioUrl, {
      headers: { 'Authorization': basicAuth },
    });
    if (!audioRes.ok) {
      console.error('[transcribe] failed to fetch audio:', audioRes.status, audioUrl);
      try {
        await supabase.from(tableName).update({ transcript_status: 'failed', transcript: '(audio fetch failed: ' + audioRes.status + ')' }).eq('id', id);
      } catch (e) {}
      return NextResponse.json({ ok: false, error: 'audio fetch failed' }, { status: 500 });
    }
    var audioBlob = await audioRes.blob();

    // 2. Send to Whisper. Use multipart/form-data.
    var whisperForm = new FormData();
    whisperForm.append('file', audioBlob, 'recording.mp3');
    whisperForm.append('model', 'whisper-1');
    // Whisper auto-detects language. For AR/EN code-switching we don't
    // pin a language — Whisper does well with mixed.
    whisperForm.append('response_format', 'text');

    var whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + openaiKey },
      body: whisperForm,
    });
    if (!whisperRes.ok) {
      var errText = await whisperRes.text().catch(function() { return ''; });
      console.error('[transcribe] Whisper failed:', whisperRes.status, errText);
      try {
        await supabase.from(tableName).update({ transcript_status: 'failed', transcript: '(Whisper failed: ' + whisperRes.status + ')' }).eq('id', id);
      } catch (e) {}
      return NextResponse.json({ ok: false, error: 'Whisper failed' }, { status: 500 });
    }

    var transcriptText = await whisperRes.text();
    transcriptText = String(transcriptText || '').trim();

    // 3. Save the transcript
    try {
      await supabase.from(tableName).update({
        transcript: transcriptText,
        transcript_status: 'completed',
      }).eq('id', id);
    } catch (e) {
      console.warn('[transcribe] DB update failed:', e.message);
    }

    console.log('[transcribe] done — ' + kind + ' #' + id + ' (' + transcriptText.length + ' chars)');
    return NextResponse.json({ ok: true, transcript: transcriptText });
  } catch (e) {
    console.error('[transcribe] error:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
