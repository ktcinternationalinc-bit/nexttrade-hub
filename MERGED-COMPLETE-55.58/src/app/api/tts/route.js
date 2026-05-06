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
export async function POST(request) {
  try {
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
    var stability    = clamp(body.stability, 0, 1, 0.5);
    var similarity   = clamp(body.similarity, 0, 1, 0.75);
    var style        = clamp(body.style, 0, 1, 0.0);
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
        // v51.2 — multilingual model so Arabic input actually sounds Arabic.
        // The old mono model was pronouncing Arabic transliterated into English.
        model_id: 'eleven_multilingual_v2',
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
      return Response.json({ error: 'ElevenLabs error: ' + errText.substring(0, 200) }, { status: res.status });
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
    return Response.json({ error: err.message }, { status: 500 });
  }
}
