// ============================================================
// SERVER-SIDE NOTIFY HELPER
// Callable from any /api/* route. Sends via Resend directly
// (no /api/notify round-trip — we are already on the server).
// Gracefully degrades when RESEND_API_KEY is missing: logs a
// warning and returns { skipped: true }, never throws.
//
// Also writes to notifications_log for an audit trail + lets
// the bell icon surface it regardless of whether email went out.
// ============================================================

import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Internal: actually send an email via Resend
async function sendResendEmail(to, subject, html) {
  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[notify-server] RESEND_API_KEY not set — email skipped for ' + to);
    return { sent: false, reason: 'RESEND_API_KEY not set' };
  }
  var fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ from: fromEmail, to: to, subject: subject, html: html }),
    });
    var data = await res.json();
    if (res.ok && data && data.id) return { sent: true, id: data.id };
    return { sent: false, reason: (data && data.message) || 'Resend error' };
  } catch (err) {
    console.log('[notify-server] Resend request failed: ' + err.message);
    return { sent: false, reason: err.message };
  }
}

// Internal: write an in-app notification row regardless of email status
async function writeNotificationRow(userId, type, subject, body, triggeredBy) {
  try {
    await supabase.from('notifications_log').insert({
      user_id: userId,
      type: type || 'general',
      subject: subject,
      body: body,
      triggered_by: triggeredBy || null,
      read: false,
    });
  } catch (e) {
    // Table may not exist yet — log warning but don't fail the notify call
    console.log('[notify-server] notifications_log insert skipped: ' + e.message);
  }
}

// Main entry — notify one or many users
// @param type         — 'ticket_assigned' | 'event_scheduled' | etc. (used for per-user filtering)
// @param recipientIds — array of user UUIDs (or single UUID)
// @param subject      — email subject line
// @param body         — HTML email body
// @param triggeredBy  — UUID of the user whose action caused this notification
// @returns { attempted, sent, skipped }
export async function notifyServer(type, recipientIds, subject, body, triggeredBy) {
  var ids = Array.isArray(recipientIds) ? recipientIds : (recipientIds ? [recipientIds] : []);
  if (ids.length === 0) return { attempted: 0, sent: 0, skipped: 0 };

  // Fetch recipient emails and honor notification_settings preferences
  var users = [];
  try {
    var usrRes = await supabase.from('users').select('id, email, name, active').in('id', ids);
    if (usrRes && usrRes.data) users = usrRes.data.filter(function(u) { return u.active !== false && u.email; });
  } catch (e) {
    console.log('[notify-server] user fetch failed: ' + e.message);
    return { attempted: ids.length, sent: 0, skipped: ids.length, error: e.message };
  }

  // Honor per-user notification preferences
  var prefs = {};
  try {
    var prefRes = await supabase.from('notification_settings').select('user_id, notification_type, email_enabled').in('user_id', ids);
    if (prefRes && prefRes.data) {
      prefRes.data.forEach(function(p) {
        if (!prefs[p.user_id]) prefs[p.user_id] = {};
        prefs[p.user_id][p.notification_type] = p.email_enabled;
      });
    }
  } catch (e) { /* table may be missing — default to enabled */ }

  var sent = 0, skipped = 0;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    // Write in-app notification regardless of email outcome
    await writeNotificationRow(u.id, type, subject, body, triggeredBy);
    // Check preference — default to enabled if no row
    var userPref = prefs[u.id] || {};
    var emailOk = (typeof userPref[type] === 'boolean') ? userPref[type] : true;
    if (!emailOk) { skipped++; continue; }
    var r = await sendResendEmail(u.email, subject, body);
    if (r.sent) sent++; else skipped++;
  }
  return { attempted: users.length, sent: sent, skipped: skipped };
}

// Convenience wrappers matching the client-side notify.js API
export function notifyTicketAssignedServer(ids, title, triggeredBy) {
  return notifyServer('ticket_assigned', ids, 'Ticket Assigned: ' + title,
    '<p>You have been assigned to ticket: <strong>' + escapeHtml(title) + '</strong></p>', triggeredBy);
}
export function notifyTicketReassignedServer(ids, title, triggeredBy) {
  return notifyServer('ticket_reassigned', ids, 'Ticket Reassigned: ' + title,
    '<p>You have been reassigned to ticket: <strong>' + escapeHtml(title) + '</strong></p>', triggeredBy);
}
export function notifyEventScheduledServer(ids, title, date, triggeredBy) {
  return notifyServer('event_scheduled', ids, 'Event: ' + title,
    '<p>You have been invited to: <strong>' + escapeHtml(title) + '</strong> on <strong>' + escapeHtml(date) + '</strong></p>', triggeredBy);
}
export function notifyReminderServer(ids, task, dueDate, triggeredBy) {
  return notifyServer('reminder', ids, 'Reminder: ' + task,
    '<p>You have a reminder: <strong>' + escapeHtml(task) + '</strong>' + (dueDate ? ' (due ' + escapeHtml(dueDate) + ')' : '') + '</p>', triggeredBy);
}
export function notifyTeamMessageServer(targetId, senderName, message, urgent, triggeredBy) {
  var urgentPrefix = urgent ? '[URGENT] ' : '';
  return notifyServer(urgent ? 'ticket_assigned' : 'reminder', [targetId], urgentPrefix + 'Message from ' + senderName,
    '<p><strong>' + escapeHtml(senderName) + '</strong> sent you a message via the AI assistant:</p><blockquote style="border-left:3px solid #3b82f6;padding-left:12px;color:#475569;">' + escapeHtml(message) + '</blockquote>', triggeredBy);
}
export function notifyShippingRateServer(ids, origin, dest, triggeredBy) {
  return notifyServer('shipping_rate_added', ids, 'New Shipping Rate: ' + origin + ' → ' + dest,
    '<p>A new shipping rate has been logged: <strong>' + escapeHtml(origin) + '</strong> → <strong>' + escapeHtml(dest) + '</strong></p>', triggeredBy);
}

// Minimal HTML escape to prevent injection in notification bodies
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
