// ============================================================
// /api/social/dispatch
// Scans scheduled_posts for due rows (scheduled_for <= now, claimed_at null).
// For each: if the platform is LIVE (approved + keys present) it auto-posts;
// otherwise it pings the assigned user ("ready to publish — tap to copy")
// and marks it awaiting manual posting.
//
// Mirrors /api/reminders/dispatch: claim-once via conditional update so two
// cron invocations can't double-fire the same row.
//
// Invocation:
//   GET  — Vercel cron. Processes up to BATCH_LIMIT due rows.
//   POST — same; accepts { limit: N } for a manual flush from the UI.
//
// Build rules: var + string concatenation only, no template literals,
// no let/const.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { notifyServer } from '../../../../lib/notify-server';
import { publish, labelFor } from '../../../../lib/social-providers';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

var BATCH_LIMIT = 100;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the "ready to publish" email body (manual mode).
function manualBody(platform, text) {
  var pretty = esc(text).replace(/\n/g, '<br>');
  return '<p>Your <strong>' + esc(labelFor(platform)) + '</strong> post is ready to publish.</p>'
    + '<p>Open the Hub &rarr; Social Studio &rarr; Calendar, copy the text below, post it, then tap <strong>Mark&nbsp;Posted</strong>.</p>'
    + '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;background:#f8fafc;'
    + 'font-family:Arial,sans-serif;font-size:14px;color:#0f172a;white-space:pre-wrap">' + pretty + '</div>';
}

async function dispatchOne(row) {
  // Claim the row: set claimed_at IFF still null. Lose the race -> skip.
  var claim = await supabase
    .from('scheduled_posts')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('claimed_at', null)
    .select('id')
    .single();

  if (claim.error || !claim.data) {
    return { id: row.id, skipped: true, reason: 'already_claimed_or_gone' };
  }

  var platform = row.platform || 'linkedin';
  var caption = row.caption_snapshot || '';
  var hashtags = row.hashtags_snapshot || [];

  var outcome = 'failed';
  var result = {};

  try {
    var out = await publish(platform, caption, hashtags);

    if (out && out.mode === 'auto' && out.ok) {
      // Truly auto-posted (platform approved).
      outcome = 'auto_posted';
      result = { mode: 'auto', result: out.result || null };
      await supabase.from('social_posts')
        .update({ status: 'posted', posted_at: new Date().toISOString(), publish_result: result })
        .eq('id', row.post_id);
    } else if (out && out.mode === 'auto' && !out.ok) {
      // Auto attempt failed — fall back to pinging the user so it still goes out.
      outcome = 'failed';
      result = { mode: 'auto', error: out.error || 'auto-post failed' };
      await notifyServer('social_ready', [row.target_user_id],
        labelFor(platform) + ' auto-post failed — publish manually',
        manualBody(platform, (out && out.text) || caption), row.created_by);
      await supabase.from('social_posts')
        .update({ status: 'awaiting_manual', publish_result: result })
        .eq('id', row.post_id);
    } else {
      // Manual mode (today): ping the user with the ready-to-paste text.
      outcome = 'notified_manual';
      result = { mode: 'manual' };
      await notifyServer('social_ready', [row.target_user_id],
        labelFor(platform) + ' post ready to publish',
        manualBody(platform, (out && out.text) || caption), row.created_by);
      await supabase.from('social_posts')
        .update({ status: 'awaiting_manual' })
        .eq('id', row.post_id);
    }
  } catch (e) {
    outcome = 'failed';
    result = { error: (e && e.message) || 'dispatch error' };
  }

  await supabase.from('scheduled_posts')
    .update({ dispatched_at: new Date().toISOString(), outcome: outcome, result: result })
    .eq('id', row.id);

  return { id: row.id, outcome: outcome };
}

async function run(limit) {
  var nowIso = new Date().toISOString();
  var dueRes = await supabase
    .from('scheduled_posts')
    .select('*')
    .is('claimed_at', null)
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit || BATCH_LIMIT);

  if (dueRes.error) {
    return { ok: false, error: dueRes.error.message };
  }
  var rows = dueRes.data || [];
  var results = [];
  for (var i = 0; i < rows.length; i++) {
    results.push(await dispatchOne(rows[i]));
  }
  return { ok: true, due: rows.length, processed: results };
}

export async function GET() {
  try {
    var r = await run(BATCH_LIMIT);
    return Response.json(r);
  } catch (e) {
    return Response.json({ ok: false, error: (e && e.message) || 'error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    var body = {};
    try { body = await req.json(); } catch (e2) { body = {}; }
    var limit = body && body.limit ? parseInt(body.limit, 10) : BATCH_LIMIT;
    var r = await run(limit);
    return Response.json(r);
  } catch (e) {
    return Response.json({ ok: false, error: (e && e.message) || 'error' }, { status: 500 });
  }
}
