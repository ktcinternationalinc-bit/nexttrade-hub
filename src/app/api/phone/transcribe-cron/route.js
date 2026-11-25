// ============================================================
// /api/phone/transcribe-cron — TRANSCRIPTION SAFETY NET
// ============================================================
// What this does:
//   The voicemail-record route fires-and-forgets the Whisper
//   transcription. On Vercel serverless, that fetch can be killed
//   when the function terminates, so transcription may never start.
//
//   When run (Vercel cron secret only), it picks up:
//     • Voicemails stuck in 'pending' or 'transcribing' for >2 min
//     • Recordings stuck similarly
//
//   For each one, it triggers /api/phone/transcribe-async (this time
//   via cron, not from a dying serverless function — the cron handler
//   stays alive long enough).
//
// Schedule: NOT scheduled. It was removed from vercel.json on 14 Jun 2026
// (c404f35) and v55.83-UF deliberately does not put it back: Codex QA
// (18 Nov) showed a Whisper failure marks the row 'failed', which this
// job never selects, and there is no attempt count / lease to stop two
// runs transcribing the same row. A real retry needs new columns — a
// separate, reviewed build.
//
// NOTE: rows marked 'failed' by transcribe-async are NOT picked up here.
// ============================================================

import { NextResponse } from 'next/server';
import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
export const dynamic = 'force-dynamic';
// v55.83-YY — this GET-only route never keeps its reads in Next's Data Cache (it would otherwise keep them forever, across deployments)
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function getPublicBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    var u = process.env.NEXT_PUBLIC_APP_URL;
    if (u.endsWith('/')) u = u.slice(0, -1);
    return u;
  }
  return 'https://nexttrade-hub.vercel.app';
}

export const runtime = 'nodejs';
export const maxDuration = 60;

// v55.83-UF (Codex QA 18 Nov, P1) — the ONLY way in is the Vercel cron
// secret: Authorization: Bearer <CRON_SECRET>, with CRON_SECRET non-empty.
// Removed: the "x-manual-trigger: yes" header (anyone could send it and make
// the server start transcription work) and the "not production → allow"
// shortcut. Nothing in the Hub called the manual header.
function isCronCall(req) {
  var secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  var authHeader = req.headers.get('authorization') || '';
  return authHeader === 'Bearer ' + secret;
}

export async function GET(req) {
  try {
    if (!isCronCall(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    var twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    var results = { voicemails: 0, recordings: 0, errors: [], read_errors: [] };

    var baseUrl = getPublicBaseUrl();

    // 1. Find voicemails needing transcription
    var vmQuery = await supabase
      .from('phone_voicemails')
      .select('id, recording_url, transcript_status, created_at')
      .in('transcript_status', ['pending', 'transcribing'])
      .lt('created_at', twoMinutesAgo)
      .not('recording_url', 'is', null)
      .limit(20);

    // v55.83-UF (Codex P2) — a failed read is NOT an empty queue.
    if (vmQuery.error || !Array.isArray(vmQuery.data)) {
      results.read_errors.push('phone_voicemails: ' + (vmQuery.error ? vmQuery.error.message : 'no rows returned'));
    } else {
      for (var i = 0; i < vmQuery.data.length; i++) {
        var vm = vmQuery.data[i];
        try {
          // v55.31 — must pass INTERNAL_SECRET so transcribe-async accepts
          // the call. (The previous same-origin shortcut was removed as a
          // security fix; all internal callers now use the secret.)
          var vmHeaders = { 'Content-Type': 'application/json' };
          if (process.env.INTERNAL_SECRET) vmHeaders['X-Internal-Trigger'] = process.env.INTERNAL_SECRET;
          var res = await fetch(baseUrl + '/api/phone/transcribe-async', {
            method: 'POST',
            headers: vmHeaders,
            body: JSON.stringify({ kind: 'voicemail', id: vm.id, recording_url: vm.recording_url }),
          });
          if (res.ok) {
            results.voicemails++;
          } else {
            results.errors.push('voicemail ' + vm.id + ' status ' + res.status);
          }
        } catch (e) {
          results.errors.push('voicemail ' + vm.id + ': ' + e.message);
        }
      }
    }

    // 2. Find recordings needing transcription
    var recQuery = await supabase
      .from('phone_recordings')
      .select('id, recording_url, transcript_status, created_at')
      .in('transcript_status', ['pending', 'transcribing'])
      .lt('created_at', twoMinutesAgo)
      .not('recording_url', 'is', null)
      .limit(20);

    if (recQuery.error || !Array.isArray(recQuery.data)) {
      results.read_errors.push('phone_recordings: ' + (recQuery.error ? recQuery.error.message : 'no rows returned'));
    } else {
      for (var j = 0; j < recQuery.data.length; j++) {
        var rec = recQuery.data[j];
        try {
          var recHeaders = { 'Content-Type': 'application/json' };
          if (process.env.INTERNAL_SECRET) recHeaders['X-Internal-Trigger'] = process.env.INTERNAL_SECRET;
          var res2 = await fetch(baseUrl + '/api/phone/transcribe-async', {
            method: 'POST',
            headers: recHeaders,
            body: JSON.stringify({ kind: 'recording', id: rec.id, recording_url: rec.recording_url }),
          });
          if (res2.ok) {
            results.recordings++;
          } else {
            results.errors.push('recording ' + rec.id + ' status ' + res2.status);
          }
        } catch (e) {
          results.errors.push('recording ' + rec.id + ': ' + e.message);
        }
      }
    }

    console.log('[transcribe-cron] processed', results.voicemails, 'voicemails,', results.recordings, 'recordings,', results.errors.length, 'errors,', results.read_errors.length, 'read errors');
    if (results.read_errors.length > 0) {
      return NextResponse.json({ ok: false, error: 'could not read the transcription queue', results: results }, { status: 500 });
    }
    return NextResponse.json({ ok: true, results: results });
  } catch (e) {
    console.error('[transcribe-cron] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
