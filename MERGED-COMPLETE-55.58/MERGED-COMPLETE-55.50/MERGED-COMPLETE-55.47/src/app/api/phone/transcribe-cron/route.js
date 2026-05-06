// ============================================================
// /api/phone/transcribe-cron — TRANSCRIPTION SAFETY NET
// ============================================================
// What this does:
//   The voicemail-record route fires-and-forgets the Whisper
//   transcription. On Vercel serverless, that fetch can be killed
//   when the function terminates, so transcription may never start.
//
//   This cron runs every 5 minutes and picks up:
//     • Voicemails stuck in 'pending' or 'transcribing' for >2 min
//     • Recordings stuck similarly
//
//   For each one, it triggers /api/phone/transcribe-async (this time
//   via cron, not from a dying serverless function — the cron handler
//   stays alive long enough).
//
// Schedule: */5 * * * * (configured in vercel.json)
//
// Idempotent: runs are safe to repeat. The transcribe-async route
// only updates status if it succeeds; failed runs leave status='pending'
// so the next cron picks them up.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function GET(req) {
  try {
    var twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    var results = { voicemails: 0, recordings: 0, errors: [] };

    // Check Vercel cron auth (Vercel sets this header on cron-triggered hits)
    var authHeader = req.headers.get('authorization');
    var isVercelCron = authHeader === 'Bearer ' + (process.env.CRON_SECRET || '');
    var isManual = req.headers.get('x-manual-trigger') === 'yes';
    if (!isVercelCron && !isManual && process.env.NODE_ENV === 'production') {
      // Allow either Vercel cron (with secret) or explicit manual trigger
      // In dev, allow always for testing
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    var baseUrl = getPublicBaseUrl();

    // 1. Find voicemails needing transcription
    var vmQuery = await supabase
      .from('phone_voicemails')
      .select('id, recording_url, transcript_status, created_at')
      .in('transcript_status', ['pending', 'transcribing'])
      .lt('created_at', twoMinutesAgo)
      .not('recording_url', 'is', null)
      .limit(20);

    if (vmQuery.data) {
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

    if (recQuery.data) {
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

    console.log('[transcribe-cron] processed', results.voicemails, 'voicemails,', results.recordings, 'recordings,', results.errors.length, 'errors');
    return NextResponse.json({ ok: true, results: results });
  } catch (e) {
    console.error('[transcribe-cron] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
