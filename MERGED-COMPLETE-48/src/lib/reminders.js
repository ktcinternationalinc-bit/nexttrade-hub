// ============================================================
// src/lib/reminders.js
// Helpers that write to and clear the scheduled_reminders table.
// Import from client components (uses the public supabase client).
// Server code should use the equivalent pattern inline with the
// service-role client — see /api/reminders/dispatch/route.js.
//
// KNOWN GAPS (documented here, locked by test assertions in Section 33):
//   - If a series master is deleted from the UI, children are not
//     cascade-deleted (no FK between series rows). Session 3 TODO.
//   - If `notifyServer` hangs mid-dispatch, the claim-stamp on sent_at
//     stays set; the row won't retry. Intentional (avoids duplicate sends)
//     but does mean hung sends are silently dropped. Document in send_result
//     if adding timeout handling later.
//   - DST: cairoToUTC hardcoded to UTC+2. On Egypt DST boundaries (last
//     Friday of April / last Thursday of October) reminders may fire 1 hour off.
// ============================================================

import { supabase } from './supabase';
import { computeReminderTimes } from './recurrence';

// ------------------------------------------------------------
// Event reminders
// ------------------------------------------------------------

// Schedule day_before / day_of / 30min_before reminders for one event,
// for one user (or fan out to many). Idempotent per (target, user, type)
// thanks to the unique index — subsequent calls on the same tuple silently
// upsert instead of duplicating.
//
// @param eventRow  — the calendar_events row (needs id, event_date, event_time, title, assigned_to)
// @param userIds   — array of user UUIDs who should receive these reminders
// @param createdBy — the UUID of the user creating/scheduling (audit)
// @returns { inserted: number }
export async function scheduleEventReminders(eventRow, userIds, createdBy) {
  if (!eventRow || !eventRow.id || !eventRow.event_date) return { inserted: 0 };
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : (userIds ? [userIds] : []);
  if (ids.length === 0) return { inserted: 0 };

  const times = computeReminderTimes(eventRow.event_date, eventRow.event_time);
  if (times.length === 0) return { inserted: 0 };

  // Skip reminders whose scheduled_for is already in the past — no point
  // queueing something that will fire instantly with no warning value.
  const nowIso = new Date().toISOString();
  const futureTimes = times.filter(t => t.scheduled_for > nowIso);

  if (futureTimes.length === 0) return { inserted: 0 };

  const subject = 'Upcoming: ' + (eventRow.title || 'Event');
  const body = eventRow.title ? ('<p>Reminder: <strong>' + escapeHtml(eventRow.title) + '</strong> on <strong>'
    + eventRow.event_date + '</strong>'
    + (eventRow.event_time ? ' at <strong>' + eventRow.event_time + '</strong>' : '')
    + '</p>') : '';

  const rows = [];
  for (const uid of ids) {
    for (const t of futureTimes) {
      rows.push({
        target_user_id: uid,
        target_kind: 'event',
        target_id: eventRow.id,
        scheduled_for: t.scheduled_for,
        remind_type: t.remind_type,
        subject_snapshot: subject,
        body_snapshot: body,
        created_by: createdBy || null,
      });
    }
  }

  if (rows.length === 0) return { inserted: 0 };

  // Upsert on the full (target_kind, target_id, target_user_id, remind_type, scheduled_for)
  // tuple. Supabase-js maps onConflict to INSERT ... ON CONFLICT (...) which requires
  // a COMPLETE (non-partial) unique index matching exactly those columns —
  // session2-recurring-reminders.sql defines idx_scheduled_reminders_unique that way.
  // Including scheduled_for means reschedule-to-new-time produces a new row
  // cleanly without colliding with an already-sent reminder for the old time.
  try {
    const { data, error } = await supabase
      .from('scheduled_reminders')
      .upsert(rows, { onConflict: 'target_kind,target_id,target_user_id,remind_type,scheduled_for', ignoreDuplicates: false })
      .select();
    if (error) throw error;
    return { inserted: (data && data.length) || rows.length };
  } catch (err) {
    console.log('[reminders] scheduleEventReminders failed: ' + err.message);
    return { inserted: 0, error: err.message };
  }
}

// Cancel all pending reminders for a given event. Used when the event is
// completed, cancelled, or deleted. Only clears UNSENT rows; sent rows are
// preserved for the audit trail.
export async function cancelEventReminders(eventId) {
  if (!eventId) return { deleted: 0 };
  try {
    const { error, count } = await supabase
      .from('scheduled_reminders')
      .delete({ count: 'exact' })
      .eq('target_kind', 'event')
      .eq('target_id', eventId)
      .is('sent_at', null);
    if (error) throw error;
    return { deleted: count || 0 };
  } catch (err) {
    console.log('[reminders] cancelEventReminders failed: ' + err.message);
    return { deleted: 0, error: err.message };
  }
}

// Rescheduling helper: wipes any pending reminders for the event then
// re-queues fresh ones. Use when event_date or event_time changes.
export async function rescheduleEventReminders(eventRow, userIds, createdBy) {
  await cancelEventReminders(eventRow && eventRow.id);
  return scheduleEventReminders(eventRow, userIds, createdBy);
}

// ------------------------------------------------------------
// Ticket reminders — STUBS for Session 3 (R6)
// The shape matches the API we'll wire TicketsTab against next session,
// so there's less churn when R6 lands.
// ------------------------------------------------------------

export async function scheduleTicketReminders(ticketRow, userIds, createdBy) {
  // Delegated to Session 3 (R6). Returning { inserted: 0 } is safe here —
  // callers can invoke this today without error; real work lands next session.
  return { inserted: 0, deferred: 'session-3-r6' };
}

export async function cancelTicketReminders(ticketId) {
  if (!ticketId) return { deleted: 0 };
  try {
    const { error, count } = await supabase
      .from('scheduled_reminders')
      .delete({ count: 'exact' })
      .eq('target_kind', 'ticket')
      .eq('target_id', ticketId)
      .is('sent_at', null);
    if (error) throw error;
    return { deleted: count || 0 };
  } catch (err) {
    console.log('[reminders] cancelTicketReminders failed: ' + err.message);
    return { deleted: 0, error: err.message };
  }
}

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
