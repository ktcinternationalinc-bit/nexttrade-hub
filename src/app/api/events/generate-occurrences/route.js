// ============================================================
// /api/events/generate-occurrences
// Materializes future recurring-event occurrences into calendar_events.
// Idempotent — safe to call repeatedly (unique index enforces dedup).
//
// Two invocation modes:
//   GET  — cron (daily at 02:00 UTC per vercel.json). Generates for ALL series.
//   POST — targeted. Body: { series_id: '...' } → generate just that series.
//          Used by CalendarTab right after creating a recurring event so the
//          user sees the next few occurrences immediately without waiting for cron.
//
// Horizon: 180 days forward from today. This keeps the table bounded for
// "every day" series (180 rows max) while still filling a useful lookahead.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { generateOccurrences } from '../../../../lib/recurrence';
import { computeReminderTimes } from '../../../../lib/recurrence';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

var HORIZON_DAYS = 180;

function todayISO() {
  return new Date().toISOString().substring(0, 10);
}

function horizonISO(days) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() + (days || HORIZON_DAYS));
  return d.toISOString().substring(0, 10);
}

// Process one series: read its master row + any existing occurrences, compute
// missing dates up to horizon, insert them (onConflict do nothing).
async function generateForSeries(seriesId) {
  var result = { series_id: seriesId, inserted: 0, skipped: 0, error: null };

  // Pull all rows in the series to find the master and the latest existing date.
  var seriesRes = await supabase
    .from('calendar_events')
    .select('*')
    .eq('series_id', seriesId)
    .order('event_date', { ascending: true });

  if (seriesRes.error) { result.error = seriesRes.error.message; return result; }
  var rows = seriesRes.data || [];
  if (rows.length === 0) { result.error = 'series not found'; return result; }

  var master = rows.find(function(r) { return r.is_series_master; }) || rows[0];
  if (!master.recurring || master.recurring === 'none') {
    result.error = 'master is not recurring';
    return result;
  }

  // Walk from the latest existing date (so we only add NEW dates).
  var latestDate = rows[rows.length - 1].event_date;
  var until = horizonISO(HORIZON_DAYS);

  var dates = generateOccurrences(master, latestDate, until, 400);
  if (dates.length === 0) {
    // Stamp horizon so we know we've already checked
    await supabase.from('calendar_events').update({ recurrence_horizon_until: until }).eq('id', master.id);
    return result;
  }

  // Build child rows — inherit everything from master that should carry forward,
  // but NOT the completion/check-in/meeting-notes fields.
  // v55.33 — also inherit attendees, description, location, join_link, all_day
  // from the master. Previously these were dropped, so each new occurrence
  // showed up with no attendees, no agenda, no Zoom link, etc. — the recurring
  // event was effectively broken from the second instance onward.
  var childRows = dates.map(function(d) {
    return {
      title: master.title,
      event_date: d,
      event_time: master.event_time,
      event_type: master.event_type,
      recurring: master.recurring,
      recurring_end: master.recurring_end,
      recurrence_interval: master.recurrence_interval,
      assigned_to: master.assigned_to,
      customer_id: master.customer_id,
      created_by: master.created_by,
      series_id: seriesId,
      is_series_master: false,
      // v55.33 — carry-forward fields
      attendees: master.attendees || [],
      description: master.description || null,
      location: master.location || null,
      join_link: master.join_link || null,
      all_day: !!master.all_day,
      // completed, event_status, meeting_notes, checked_in_* left null (fresh occurrence)
    };
  });

  // Insert with onConflict do-nothing on (series_id, event_date) — the unique
  // index means any already-materialized date is silently ignored.
  var insRes = await supabase
    .from('calendar_events')
    .upsert(childRows, { onConflict: 'series_id,event_date', ignoreDuplicates: true })
    .select('id, event_date, assigned_to, attendees');

  if (insRes.error) { result.error = insRes.error.message; return result; }
  var inserted = insRes.data || [];
  result.inserted = inserted.length;

  // v55.33 — schedule reminders for EVERY attendee on each new occurrence,
  // not just the primary assigned_to. Previously side-attendees on a
  // recurring meeting got reminders for the FIRST occurrence (set by
  // CalendarTab on creation) but nothing for any later occurrence — they
  // would silently miss every recurring meeting after the first one.
  for (var i = 0; i < inserted.length; i++) {
    var occ = inserted[i];
    // Build the recipient list: union of assigned_to + attendees from master.
    var recipients = [];
    if (Array.isArray(master.attendees) && master.attendees.length) {
      recipients = master.attendees.slice();
    }
    if (occ.assigned_to && recipients.indexOf(occ.assigned_to) === -1) {
      recipients.push(occ.assigned_to);
    }
    if (recipients.length === 0) continue;
    var times = computeReminderTimes(occ.event_date, master.event_time);
    var nowIso = new Date().toISOString();
    var fut = times.filter(function(t) { return t.scheduled_for > nowIso; });
    if (fut.length === 0) continue;
    var subject = 'Upcoming: ' + (master.title || 'Event');
    var body = '<p>Reminder: <strong>' + escapeHtml(master.title || '') + '</strong> on <strong>' + occ.event_date + '</strong>'
      + (master.event_time ? ' at <strong>' + master.event_time + '</strong>' : '') + '</p>';
    var remRows = [];
    for (var ri = 0; ri < recipients.length; ri++) {
      for (var ti = 0; ti < fut.length; ti++) {
        remRows.push({
          target_user_id: recipients[ri],
          target_kind: 'event',
          target_id: occ.id,
          scheduled_for: fut[ti].scheduled_for,
          remind_type: fut[ti].remind_type,
          subject_snapshot: subject,
          body_snapshot: body,
          created_by: master.created_by || null,
        });
      }
    }
    // Fire and forget — dedup unique index (target_kind, target_id, target_user_id, remind_type, scheduled_for)
    // protects against doubles. Includes scheduled_for so reschedule-to-new-time works across sent rows.
    try {
      await supabase.from('scheduled_reminders').upsert(remRows, {
        onConflict: 'target_kind,target_id,target_user_id,remind_type,scheduled_for',
        ignoreDuplicates: false,
      });
    } catch (e) { /* logged below if total fails */ }
  }

  // Mark horizon so the next run doesn't re-examine dates already covered
  await supabase.from('calendar_events').update({ recurrence_horizon_until: until }).eq('id', master.id);

  return result;
}

async function runAllSeries() {
  var summary = { series_processed: 0, total_inserted: 0, errors: [] };
  var mastersRes = await supabase
    .from('calendar_events')
    .select('series_id')
    .eq('is_series_master', true)
    .not('recurring', 'is', null)
    .neq('recurring', 'none');
  if (mastersRes.error) {
    summary.errors.push('master fetch: ' + mastersRes.error.message);
    return summary;
  }
  var masters = mastersRes.data || [];
  for (var i = 0; i < masters.length; i++) {
    if (!masters[i].series_id) continue;
    var r = await generateForSeries(masters[i].series_id);
    summary.series_processed++;
    summary.total_inserted += r.inserted;
    if (r.error) summary.errors.push(masters[i].series_id + ': ' + r.error);
  }
  return summary;
}

export async function GET(req) {
  try {
    var summary = await runAllSeries();
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
    if (body && body.series_id) {
      var r = await generateForSeries(body.series_id);
      return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // No series_id → run all
    var summary = await runAllSeries();
    return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
