// POST /api/tts — Text to Speech via ElevenLabs
export async function POST(request) {
  try {
    var body = await request.json();
    var text = body.text || '';
    if (!text) return Response.json({ error: 'No text provided' }, { status: 400 });

    var apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return Response.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });

    // Use custom voice ID or default to a good ElevenLabs voice
    var voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel (professional female)

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
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
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
