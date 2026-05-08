// =============================================================
// /api/transcribe — server-side Whisper transcription
//
// Accepts an audio blob (webm/mp4/ogg — whatever MediaRecorder produced
// in the user's browser) and forwards it to OpenAI's Whisper API.
// Returns { text } on success or { error } on failure.
//
// Why server-side: the OpenAI key must never ship to the browser.
// Why Whisper: the Web Speech API is fundamentally unreliable — dies
// after ~10 seconds on Chromium, misses words, and some users can't
// even click the mic. MediaRecorder + Whisper = predictable,
// record-as-long-as-you-want, works identically across browsers.
//
// Environment variable required:
//   OPENAI_API_KEY — get one at platform.openai.com/api-keys
//   Whisper costs ~$0.006/minute of audio. Set a billing cap.
//
// v55.80 BD-AUDIT FIX:
//   - Auth check: require Supabase session (Whisper costs real money).
//   - Rate-limit: 30 req/hour/user.
//   - File-size cap: 25 MB (Whisper API max is 25 MB anyway, but we
//     reject before calling OpenAI to save the round-trip).
//   - Error sanitization on all responses.
// =============================================================

import { createClient } from '@supabase/supabase-js';
import { sanitizeErr } from '../../../lib/sanitize-error';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
// Accept larger audio files than the default 4.5 MB — long dictation
// can easily be 10–20 MB.
export const maxDuration = 60;

// Whisper API maximum is 25 MB. We reject anything larger early.
var MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'Transcription not configured. Add OPENAI_API_KEY to Vercel env vars (get one at platform.openai.com/api-keys).' },
      { status: 500 }
    );
  }

  // ---- Auth: require a Supabase session ----
  var authHeader = request.headers.get('authorization') || '';
  var jwt = authHeader.indexOf('Bearer ') === 0 ? authHeader.substring(7) : null;
  if (!jwt) {
    var cookieHeader = request.headers.get('cookie') || '';
    var match = cookieHeader.match(/sb-[a-z0-9-]+-auth-token=([^;]+)/i);
    if (match) {
      try {
        var cookieJson = JSON.parse(decodeURIComponent(match[1]));
        jwt = cookieJson && cookieJson.access_token;
      } catch (_) {}
    }
  }
  var userId = null;
  if (jwt) {
    try {
      var supa = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      var ures = await supa.auth.getUser(jwt);
      userId = ures && ures.data && ures.data.user && ures.data.user.id;
    } catch (_) {}
  }
  if (!userId) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // ---- Rate-limit: 30 calls/hour/user ----
  var rl = checkRateLimit(userId, 'transcribe');
  if (!rl.allowed) {
    return Response.json({
      error: 'Rate limit exceeded — try again in a few minutes',
      resetAt: rl.resetAt,
    }, { status: 429 });
  }

  try {
    // Browsers upload this as multipart/form-data with an "audio" field.
    // We forward it to OpenAI basically unchanged — just renaming the form
    // field to "file" which is what OpenAI's API expects.
    var incoming = await request.formData();
    var audio = incoming.get('audio');
    if (!audio) {
      return Response.json({ error: 'No audio file in request (expected form field "audio").' }, { status: 400 });
    }

    // ---- File-size cap ----
    // audio is a Blob/File — has .size. Reject early to save the OpenAI round-trip.
    if (audio.size && audio.size > MAX_AUDIO_BYTES) {
      return Response.json({
        error: 'Audio file too large (max 25 MB).',
        size: audio.size,
        max: MAX_AUDIO_BYTES,
      }, { status: 413 });
    }

    // Optional language hint ('en' / 'ar') — lets Whisper avoid guessing
    // and improves accuracy on short clips.
    var lang = incoming.get('language');

    // Build the multipart body for OpenAI. We keep the original filename/type
    // so Whisper sniffs the format correctly.
    var fd = new FormData();
    fd.append('file', audio, (typeof audio.name === 'string' && audio.name) || 'recording.webm');
    fd.append('model', 'whisper-1');
    if (lang && (lang === 'en' || lang === 'ar')) fd.append('language', String(lang));
    // 'text' response_format returns a plain string — we wrap it in JSON below.
    fd.append('response_format', 'text');

    var r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: fd,
    });

    if (!r.ok) {
      var errTxt = '';
      try { errTxt = await r.text(); } catch (e) {}
      console.warn('[transcribe] OpenAI non-OK', r.status, errTxt.substring(0, 400));
      // Sanitize before returning — error body might contain Authorization header
      return Response.json({ error: 'Transcription failed: ' + sanitizeErr(errTxt.substring(0, 300)) }, { status: 502 });
    }

    var text = (await r.text()).trim();
    return Response.json({ text: text });
  } catch (e) {
    console.warn('[transcribe] exception', e && e.message);
    return Response.json({ error: sanitizeErr(e) }, { status: 500 });
  }
}
