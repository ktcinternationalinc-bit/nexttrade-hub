// POST /api/tts — Text to Speech via ElevenLabs
//
// v51.2 (Apr 24 2026) — Voice options. Request body may now include:
//   voiceId: string     — override the default voice (see ElevenLabs voice IDs)
//   stability: 0..1     — 0 = expressive/variable, 1 = very stable/monotone (default 0.5)
//   similarity: 0..1    — how closely to match the reference voice (default 0.75)
//   style: 0..1         — 0 = neutral, 1 = heavy style exaggeration (default 0)
//   speakerBoost: bool  — enhanced clarity (default true)
//
// Callers (AIGreeter) read these from per-user settings so Max can pick
// a voice he likes, and each team member can pick their own.
//
// v55.80 BD-AUDIT FIX:
//   - Auth check: require Supabase session cookie. ElevenLabs costs real
//     money — we don't expose anonymous TTS.
//   - Rate-limit: 60 req/hour/user via in-memory bucket. See rate-limit.js.
//   - Error sanitization: no raw err.message back to client (could leak
//     ElevenLabs API key embedded in error body).
import { createClient } from '@supabase/supabase-js';
import { sanitizeErr } from '../../../lib/sanitize-error';
import { checkRateLimit } from '../../../lib/rate-limit';

export async function POST(request) {
  try {
    // ---- Auth: require a Supabase session ----
    var authHeader = request.headers.get('authorization') || '';
    var jwt = authHeader.indexOf('Bearer ') === 0 ? authHeader.substring(7) : null;
    // Some clients send the cookie instead — try both
    if (!jwt) {
      var cookieHeader = request.headers.get('cookie') || '';
      // Extract sb-access-token cookie (Supabase v2 default name)
      var match = cookieHeader.match(/sb-[a-z0-9-]+-auth-token=([^;]+)/i);
      if (match) {
        try {
          var cookieVal = decodeURIComponent(match[1]);
          var cookieJson = JSON.parse(cookieVal);
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

    // ---- Rate-limit: 60 calls/hour/user ----
    var rl = checkRateLimit(userId, 'tts');
    if (!rl.allowed) {
      return Response.json({
        error: 'Rate limit exceeded — try again in a minute',
        resetAt: rl.resetAt,
      }, { status: 429 });
    }

    var body = await request.json();
    var text = body.text || '';
    if (!text) return Response.json({ error: 'No text provided' }, { status: 400 });

    var apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return Response.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });

    // Voice selection priority: request body → env default → Rachel
    var voiceId = (body.voiceId && String(body.voiceId)) || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

    // Clamp numeric settings to valid range; allow caller to tune them.
    var clamp = function(v, lo, hi, def) {
      if (v == null || isNaN(v)) return def;
      var n = Number(v);
      return Math.max(lo, Math.min(hi, n));
    };
    // v55.83-A.6.27.72 HOTFIX 13 — More natural prosody:
    // 1) Model: switched to eleven_turbo_v2_5 for English (much more natural human
    //    cadence than multilingual_v2 — breathing, micro-pauses, intonation rise/fall).
    //    Multilingual still used when the text contains Arabic so Arabic pronunciation
    //    stays correct.
    // 2) Default stability dropped from 0.5 → 0.35 — more expressive variation in tone,
    //    less monotone. Callers can still pass their own stability value.
    // 3) Default similarity raised from 0.75 → 0.82 — sticks closer to the reference
    //    voice's natural personality.
    // 4) Default style nudged from 0 → 0.15 — a tiny bit of speaking style energy
    //    (the difference between someone reading aloud and someone actually talking
    //    to you).
    var hasArabic = /[\u0600-\u06FF]/.test(text);
    var modelId = hasArabic ? 'eleven_multilingual_v2' : 'eleven_turbo_v2_5';

    var stability    = clamp(body.stability, 0, 1, 0.35);
    var similarity   = clamp(body.similarity, 0, 1, 0.82);
    var style        = clamp(body.style, 0, 1, 0.15);
    var speakerBoost = body.speakerBoost === undefined ? true : !!body.speakerBoost;

    var url = 'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId;

    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text.substring(0, 1000),
        // v55.83-A.6.27.72 HOTFIX 13 — Turbo v2.5 for English (more natural prosody),
        // Multilingual v2 for Arabic (correct pronunciation). See above for selection.
        model_id: modelId,
        voice_settings: {
          stability: stability,
          similarity_boost: similarity,
          style: style,
          use_speaker_boost: speakerBoost
        }
      })
    });

    if (!res.ok) {
      var errText = await res.text();
      // Sanitize before returning — error body might contain xi-api-key
      // header info or other secrets.
      return Response.json({ error: 'TTS service error: ' + sanitizeErr(errText.substring(0, 200)) }, { status: res.status });
    }

    // Return audio as MP3
    var audioBuffer = await res.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    console.error('[tts] error:', err);
    return Response.json({ error: sanitizeErr(err) }, { status: 500 });
  }
}
