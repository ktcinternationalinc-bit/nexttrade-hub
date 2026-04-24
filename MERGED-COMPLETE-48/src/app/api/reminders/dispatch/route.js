// ============================================================
// /api/reminders/dispatch
// Scans scheduled_reminders for due rows (scheduled_for <= now, sent_at null)
// and fires them through notifyServer, then stamps sent_at.
//
// Idempotency: each row is re-fetched AND its sent_at set in the same
// conditional update (sent_at IS NULL) to protect against double-dispatch
// if two invocations race. If the UPDATE returns zero rows, another worker
// already claimed it.
//
// Invocation:
//   GET  — cron. Processes up to BATCH_LIMIT due rows.
//   POST — same. Accepts { limit: N } override for manual flush.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { notifyServer } from '../../../../lib/notify-server';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

var BATCH_LIMIT = 200;

async function dispatchOne(row) {
  // Claim the row: update sent_at IFF still null. If another worker grabbed
  // it, our update affects 0 rows and we bail.
  var claimRes = await supabase
    .from('scheduled_reminders')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('sent_at', null)
    .select('id')
    .single();

  if (claimRes.error || !claimRes.data) {
    // Either a concurrent worker beat us, or the row was deleted. Either way, skip.
    return { id: row.id, skipped: true, reason: 'already_claimed_or_gone' };
  }

  // Actually send. notifyServer writes notifications_log + tries Resend.
  var type = 'reminder';
  if (row.remind_type === 'day_before') type = 'reminder';
  if (row.remind_type === 'day_of') type = 'reminder';
  if (row.remind_type === '30min_before') type = 'reminder';

  var subj = row.subject_snapshot || 'Reminder';
  var body = row.body_snapshot || '<p>Reminder</p>';

  try {
    var res = await notifyServer(type, [row.target_user_id], subj, body, row.created_by);
    // Stamp the send result for the audit trail
    await supabase
      .from('scheduled_reminders')
      .update({ send_result: res })
      .eq('id', row.id);
    return { id: row.id, sent: true, result: res };
  } catch (e) {
    // Mark as sent (so we don't retry in a tight loop) but record the error
    await supabase
      .from('scheduled_reminders')
      .update({ send_result: { sent: false, reason: e.message } })
      .eq('id', row.id);
    return { id: row.id, sent: false, error: e.message };
  }
}

async function runDispatch(limit) {
  var cap = Number.isFinite(+limit) && +limit > 0 ? Math.min(Math.floor(+limit), BATCH_LIMIT) : BATCH_LIMIT;
  var nowIso = new Date().toISOString();

  var dueRes = await supabase
    .from('scheduled_reminders')
    .select('id, target_user_id, remind_type, subject_snapshot, body_snapshot, created_by')
    .is('sent_at', null)
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(cap);

  if (dueRes.error) return { processed: 0, error: dueRes.error.message };

  var due = dueRes.data || [];
  var sent = 0, skipped = 0, failed = 0, details = [];
  for (var i = 0; i < due.length; i++) {
    var r = await dispatchOne(due[i]);
    details.push(r);
    if (r.sent) sent++;
    else if (r.skipped) skipped++;
    else failed++;
  }

  return { processed: due.length, sent: sent, skipped: skipped, failed: failed };
}

export async function GET(req) {
  try {
    var summary = await runDispatch();
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export async function POST(req) {
  try {
    var body = await req.json().catch(function() { return {}; });
    var summary = await runDispatch(body && body.limit);
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
