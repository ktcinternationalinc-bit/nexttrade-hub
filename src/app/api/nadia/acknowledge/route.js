// ============================================================
// /api/nadia/acknowledge
//
// v55.45 — Mark a Nadia-surfaced item (cross-team message or team
// reminder) as acknowledged so Nadia stops mentioning it on every
// greeting. Once acknowledged, the item is filtered out of the surface
// query in /api/ask and the Nadia panel.
//
// If a NEW row is later inserted for the same user (e.g. the sender
// adds a follow-up), it has its own ack columns set to NULL — so it
// surfaces again, just like a fresh email.
//
// Body: { table: 'ai_memory' | 'team_reminders', id: '<uuid>', user_id: '<uuid>' }
//
// SWC/Vercel constraint: this file uses string concatenation and `var`
// (no template literals or let/const) per the project convention noted
// in HANDOVER docs. Template literals in API routes have caused
// mysterious build failures in this repo before.
// ============================================================

import { createClient } from '@supabase/supabase-js';

var ALLOWED_TABLES = ['ai_memory', 'team_reminders'];

export async function POST(req) {
  try {
    var body = await req.json();
    var table = body && body.table;
    var id = body && body.id;
    var userId = body && body.user_id;

    if (!table || !id || !userId) {
      return Response.json({ error: 'Missing required fields: table, id, user_id' }, { status: 400 });
    }
    if (ALLOWED_TABLES.indexOf(table) === -1) {
      return Response.json({ error: 'Invalid table — must be one of: ' + ALLOWED_TABLES.join(', ') }, { status: 400 });
    }

    var supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    var nowIso = new Date().toISOString();
    var updates = { acknowledged_at: nowIso, acknowledged_by: userId };

    var res = await supabase.from(table).update(updates).eq('id', id).select().maybeSingle();

    if (res.error) {
      try { console.warn('[nadia-ack] update failed:', res.error.message); } catch (_) {}
      return Response.json({ error: res.error.message }, { status: 500 });
    }
    if (!res.data) {
      return Response.json({ error: 'Row not found' }, { status: 404 });
    }

    return Response.json({ acknowledged: true, table: table, id: id, at: nowIso });
  } catch (err) {
    try { console.error('[nadia-ack] FATAL:', err && err.message); } catch (_) {}
    return Response.json({ error: (err && err.message) || 'Unknown error' }, { status: 500 });
  }
}

// GET — list a user's pending unacknowledged items so the dashboard
// panel can render them with Acknowledge buttons. Filters out:
//   - acknowledged items
//   - items older than 7 days (the auto-drop window)
export async function GET(req) {
  try {
    var url = new URL(req.url);
    var userId = url.searchParams.get('user_id');
    if (!userId) return Response.json({ error: 'Missing user_id query param' }, { status: 400 });

    var supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // Cross-team relay messages from ai_memory.
    // Filter: target = current user, not auto-captured, NOT acknowledged,
    // and inserted in the last 7 days.
    var memRes = await supabase.from('ai_memory')
      .select('id, content, type, created_at, created_by')
      .eq('target_user_id', userId)
      .eq('auto_captured', false)
      .is('acknowledged_at', null)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(20);

    var messages = (memRes && memRes.data) || [];

    // Team reminders sent to this user (or 'all').
    // Filter: assigned_to = user OR target_users contains user, NOT
    // acknowledged, and either no due date OR due date in last 7 days.
    var todayIso = new Date().toISOString().substring(0, 10);
    var sevenDaysAgoDate = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);

    var remRes = await supabase.from('team_reminders')
      .select('id, title, body, message, reminder_date, priority, target_users, created_by, created_at')
      .or('target_users.eq.all,target_users.eq.' + userId + ',assigned_to.eq.' + userId)
      .is('acknowledged_at', null)
      .order('reminder_date', { ascending: true })
      .limit(20);

    var remindersAll = (remRes && remRes.data) || [];
    var reminders = remindersAll.filter(function (r) {
      // Drop if reminder_date is in the future (don't surface yet)
      if (r.reminder_date && r.reminder_date > todayIso) return false;
      // Drop if older than 7 days (the auto-drop window — applied to
      // either the reminder_date if set, or created_at)
      var refDate = r.reminder_date || (r.created_at && r.created_at.substring(0, 10));
      if (refDate && refDate < sevenDaysAgoDate) return false;
      return true;
    });

    return Response.json({
      messages: messages,
      reminders: reminders,
      total: messages.length + reminders.length,
    });
  } catch (err) {
    try { console.error('[nadia-ack-list] FATAL:', err && err.message); } catch (_) {}
    return Response.json({ error: (err && err.message) || 'Unknown error' }, { status: 500 });
  }
}
