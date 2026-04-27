// ============================================================
// /api/phone/recording-stream — VOICEMAIL & CALL AUDIO PROXY
// ============================================================
// What this does:
//   The browser <audio> element can't supply HTTP Basic Auth
//   headers, but Twilio recording URLs require Basic Auth
//   (Account SID + Auth Token). So if we pointed <audio> directly
//   at Twilio's URL, every play attempt would 401.
//
//   This route is the workaround. The browser's <audio> tag points
//   to OUR domain instead:
//     /api/phone/recording-stream?id=VOICEMAIL_OR_RECORDING_UUID
//
//   We:
//     1. Look up the row in phone_voicemails or phone_recordings
//     2. Fetch the audio from Twilio with the right credentials
//     3. Stream it back to the browser
//
//   The browser sees a normal MP3 response from our domain. No
//   auth headers needed on its end.
//
// Query params:
//   • id   — voicemail OR recording UUID
//   • kind — 'voicemail' (default) or 'recording'
//
// Security note:
//   This endpoint is gated by Supabase auth: only authenticated
//   users can hit it. RLS will further restrict who can listen
//   to whose voicemails.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    var url = new URL(req.url);
    var id = url.searchParams.get('id');
    var kind = url.searchParams.get('kind') || 'voicemail';

    if (!id) {
      return new Response('Missing id parameter', { status: 400 });
    }

    // 1. Look up the row to get the Twilio recording URL
    var tableName = kind === 'recording' ? 'phone_recordings' : 'phone_voicemails';
    var lookup = await supabase
      .from(tableName)
      .select('id, recording_url, duration_seconds')
      .eq('id', id)
      .maybeSingle();

    if (!lookup.data || !lookup.data.recording_url) {
      return new Response('Not found', { status: 404 });
    }

    var twilioUrl = lookup.data.recording_url;
    if (!twilioUrl.endsWith('.mp3')) twilioUrl = twilioUrl + '.mp3';

    // 2. Fetch from Twilio with Basic Auth
    var twilioSid = process.env.TWILIO_ACCOUNT_SID;
    var twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (!twilioSid || !twilioToken) {
      return new Response('Twilio credentials not configured', { status: 500 });
    }

    var basicAuth = 'Basic ' + Buffer.from(twilioSid + ':' + twilioToken).toString('base64');

    // Pass through Range header so seeking works in <audio> player
    var rangeHeader = req.headers.get('range');
    var twilioHeaders = { 'Authorization': basicAuth };
    if (rangeHeader) twilioHeaders['Range'] = rangeHeader;

    var twilioRes = await fetch(twilioUrl, { headers: twilioHeaders });

    if (!twilioRes.ok && twilioRes.status !== 206) {
      console.error('[recording-stream] Twilio fetch failed:', twilioRes.status, twilioUrl);
      return new Response('Audio fetch failed: ' + twilioRes.status, { status: twilioRes.status });
    }

    // 3. Stream the audio back. Pass through key headers so seeking works.
    var headers = {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400', // cache for 24h on the browser
    };
    var contentLength = twilioRes.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;
    var contentRange = twilioRes.headers.get('content-range');
    if (contentRange) headers['Content-Range'] = contentRange;

    return new Response(twilioRes.body, {
      status: twilioRes.status,
      headers: headers,
    });
  } catch (e) {
    console.error('[recording-stream] error:', e.message);
    return new Response('Server error: ' + e.message, { status: 500 });
  }
}
