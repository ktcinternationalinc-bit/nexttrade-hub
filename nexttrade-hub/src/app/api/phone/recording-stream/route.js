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
//     1. Verify the user is logged in
//     2. Verify the user OWNS the recording (or is an admin)
//     3. Look up the row in phone_voicemails or phone_recordings
//     4. Fetch the audio from Twilio with the right credentials
//     5. Stream it back to the browser
//
//   The browser sees a normal MP3 response from our domain. No
//   auth headers needed on its end.
//
// Query params:
//   • id   — voicemail OR recording UUID
//   • kind — 'voicemail' (default) or 'recording'
//
// v55.31 SECURITY FIX:
//   This route used to claim "gated by Supabase auth" in a comment
//   but never actually called requireUser(). It also uses the
//   service-role key which bypasses Row Level Security. So anyone
//   on the internet who guessed (or saw in a log) a recording UUID
//   could play any voicemail or call audio without authentication.
//
//   Fix: now we require an authenticated user AND verify they own
//   the recording. For voicemails, ownership = phone_voicemails.assigned_to.
//   For call recordings, ownership = phone_calls.user_id (joined via
//   recording.call_id). Admins and super_admins bypass the ownership
//   check (they can play anyone's audio for support and audit).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../lib/phone-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const runtime = 'nodejs';

// Helper: is the user an admin? (admins/super_admins can play any recording)
async function isAdmin(userId) {
  try {
    var roleRes = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
    var role = roleRes && roleRes.data ? roleRes.data.role : null;
    return role === 'admin' || role === 'super_admin';
  } catch (e) {
    return false;
  }
}

export async function GET(req) {
  try {
    // 1. Require an authenticated user
    var auth = await requireUser(req);
    if (!auth.user) {
      return new Response('Authentication required', { status: 401 });
    }

    var url = new URL(req.url);
    var id = url.searchParams.get('id');
    var kind = url.searchParams.get('kind') || 'voicemail';

    if (!id) {
      return new Response('Missing id parameter', { status: 400 });
    }

    // 2. Look up the row to get the Twilio recording URL AND owner info
    var tableName = kind === 'recording' ? 'phone_recordings' : 'phone_voicemails';
    var selectCols = kind === 'recording'
      ? 'id, recording_url, duration_seconds, call_id'
      : 'id, recording_url, duration_seconds, assigned_to';

    var lookup = await supabase
      .from(tableName)
      .select(selectCols)
      .eq('id', id)
      .maybeSingle();

    if (!lookup.data || !lookup.data.recording_url) {
      return new Response('Not found', { status: 404 });
    }

    // 3. Ownership check (admins bypass)
    var amAdmin = await isAdmin(auth.user.id);
    if (!amAdmin) {
      var ownerId = null;
      if (kind === 'recording') {
        // Recordings own through the parent call
        var callLookup = await supabase
          .from('phone_calls')
          .select('user_id')
          .eq('id', lookup.data.call_id)
          .maybeSingle();
        ownerId = callLookup && callLookup.data ? callLookup.data.user_id : null;
      } else {
        // Voicemails own directly
        ownerId = lookup.data.assigned_to;
      }

      if (ownerId !== auth.user.id) {
        return new Response('Not authorized to listen to this recording', { status: 403 });
      }
    }

    // 4. Fetch from Twilio with Basic Auth
    var twilioUrl = lookup.data.recording_url;
    if (!twilioUrl.endsWith('.mp3')) twilioUrl = twilioUrl + '.mp3';

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

    // 5. Stream the audio back. Pass through key headers so seeking works.
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
