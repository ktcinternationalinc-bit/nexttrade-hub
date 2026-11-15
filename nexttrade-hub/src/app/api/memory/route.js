import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function defaultSettings() {
  return {
    id: 1,
    auto_capture_enabled: true,
    capture_urgent: true,
    capture_meetings: true,
    capture_reminders: true,
    capture_notes: true,
    capture_follow_ups: true,
    default_note_retention_days: 30,
    cross_user_read: 'team_only',
    morning_briefing_enabled: true,
    briefing_hour_local: 8,
    max_memory_items_per_user: 500,
  };
}

async function isSuperAdmin(userId) {
  if (!userId) return false;
  try {
    var r = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
    if (!r || !r.data) return false;
    var role = String(r.data.role || '').toLowerCase().replace(/[\s_-]/g, '');
    // matches: super_admin, super admin, superadmin, SuperAdmin, owner
    return role === 'superadmin' || role === 'owner';
  } catch (e) {}
  return false;
}

// GET /api/memory?userId=... — returns this user's items + items targeted at them
// GET /api/memory?settings=1 — returns super-admin settings (super-admin only)
// GET /api/memory?briefing=1&userId=... — returns morning briefing JSON
export async function GET(request) {
  try {
    var url = new URL(request.url);
    var userId = url.searchParams.get('userId');
    var wantSettings = url.searchParams.get('settings') === '1';
    var wantBriefing = url.searchParams.get('briefing') === '1';
    var allUsers = url.searchParams.get('all') === '1';  // super-admin only

    if (wantSettings) {
      var admin = await isSuperAdmin(userId);
      if (!admin) return Response.json({ error: 'Forbidden — super admin only' }, { status: 403 });
      // Try to load; if the table doesn't exist yet, return defaults so the UI works.
      try {
        var s = await supabase.from('ai_memory_settings').select('*').eq('id', 1).maybeSingle();
        if (s.error) {
          var code = s.error.code || '';
          var msg = String(s.error.message || '');
          var tableMissing = code === '42P01' || msg.toLowerCase().indexOf('does not exist') >= 0 || msg.toLowerCase().indexOf('relation') >= 0;
          if (tableMissing) {
            return Response.json({
              settings: defaultSettings(),
              warning: 'ai_memory_settings table not found — returning defaults. Run supabase/ai-memory.sql in Supabase SQL editor.'
            });
          }
          return Response.json({ error: 'DB error: ' + msg }, { status: 500 });
        }
        if (!s.data) {
          // Seed the singleton row
          var seed = await supabase.from('ai_memory_settings').insert(Object.assign({ id: 1 }, defaultSettings())).select().maybeSingle();
          return Response.json({ settings: (seed && seed.data) || defaultSettings() });
        }
        return Response.json({ settings: s.data });
      } catch (eInner) {
        return Response.json({ error: 'DB exception: ' + eInner.message, settings: defaultSettings() }, { status: 200 });
      }
    }

    if (allUsers) {
      var admin2 = await isSuperAdmin(userId);
      if (!admin2) return Response.json({ error: 'Forbidden' }, { status: 403 });
      var r = await supabase.from('ai_memory').select('*').is('dismissed_at', null).order('created_at', { ascending: false }).limit(500);
      return Response.json({ items: r.data || [] });
    }

    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

    var nowIso = new Date().toISOString();
    var own = await supabase.from('ai_memory').select('*').eq('user_id', userId).is('dismissed_at', null).order('created_at', { ascending: false }).limit(300);
    var targeted = await supabase.from('ai_memory').select('*').eq('target_user_id', userId).is('dismissed_at', null).order('created_at', { ascending: false }).limit(100);
    var filter = function (m) {
      if (m.type === 'urgent') return true;
      if (!m.expires_at) return true;
      return m.expires_at > nowIso;
    };
    var ownItems = (own.data || []).filter(filter);
    var targetedItems = (targeted.data || []).filter(function (m) { return m.user_id !== userId && filter(m); });

    if (wantBriefing) {
      var urgent = ownItems.filter(function (m) { return m.type === 'urgent'; });
      var meetings = ownItems.filter(function (m) { return m.type === 'meeting'; });
      var reminders = ownItems.filter(function (m) { return m.type === 'reminder' || m.type === 'follow_up'; });
      var fromOthers = targetedItems;
      return Response.json({
        briefing: {
          urgent: urgent,
          meetings: meetings,
          reminders: reminders,
          from_others: fromOthers,
          counts: {
            urgent: urgent.length,
            meetings: meetings.length,
            reminders: reminders.length,
            from_others: fromOthers.length,
          },
        },
      });
    }

    return Response.json({ own: ownItems, targeted: targetedItems });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}


// POST /api/memory
// body: { op: 'create' | 'update' | 'dismiss' | 'acknowledge' | 'save_settings', userId, ...payload }
export async function POST(request) {
  try {
    var body = await request.json();
    var op = body.op;
    var userId = body.userId;

    if (op === 'save_settings') {
      if (!(await isSuperAdmin(userId))) return Response.json({ error: 'Forbidden — super admin only' }, { status: 403 });
      var upd = {
        auto_capture_enabled:        body.settings.auto_capture_enabled !== undefined ? body.settings.auto_capture_enabled : true,
        capture_urgent:              body.settings.capture_urgent !== undefined ? body.settings.capture_urgent : true,
        capture_meetings:            body.settings.capture_meetings !== undefined ? body.settings.capture_meetings : true,
        capture_reminders:           body.settings.capture_reminders !== undefined ? body.settings.capture_reminders : true,
        capture_notes:               body.settings.capture_notes !== undefined ? body.settings.capture_notes : true,
        capture_follow_ups:          body.settings.capture_follow_ups !== undefined ? body.settings.capture_follow_ups : true,
        default_note_retention_days: Number(body.settings.default_note_retention_days) || 30,
        cross_user_read:             body.settings.cross_user_read || 'team_only',
        morning_briefing_enabled:    body.settings.morning_briefing_enabled !== undefined ? body.settings.morning_briefing_enabled : true,
        briefing_hour_local:         Number(body.settings.briefing_hour_local) || 8,
        max_memory_items_per_user:   Number(body.settings.max_memory_items_per_user) || 500,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      };
      var r = await supabase.from('ai_memory_settings').upsert(Object.assign({ id: 1 }, upd)).select().maybeSingle();
      return Response.json({ ok: true, settings: r.data });
    }

    if (op === 'create') {
      if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });
      var row = {
        user_id: body.owner_user_id || userId,
        content: String(body.content || '').substring(0, 500),
        type: body.type || 'note',
        scope: body.scope || 'private',
        target_user_id: body.target_user_id || null,
        source_table: body.source_table || 'manual',
        expires_at: body.expires_at || null,
        auto_captured: false,
        created_by: userId,
      };
      var ins = await supabase.from('ai_memory').insert(row).select().maybeSingle();
      return Response.json({ ok: true, item: ins.data });
    }

    if (op === 'update') {
      if (!body.id) return Response.json({ error: 'id required' }, { status: 400 });
      var updates = {};
      ['content', 'type', 'scope', 'target_user_id', 'expires_at', 'notes'].forEach(function (k) {
        if (body[k] !== undefined) updates[k] = body[k];
      });
      var upr = await supabase.from('ai_memory').update(updates).eq('id', body.id).select().maybeSingle();
      return Response.json({ ok: true, item: upr.data });
    }

    if (op === 'dismiss') {
      if (!body.id) return Response.json({ error: 'id required' }, { status: 400 });
      await supabase.from('ai_memory').update({ dismissed_at: new Date().toISOString(), dismissed_by: userId }).eq('id', body.id);
      return Response.json({ ok: true });
    }

    if (op === 'acknowledge') {
      if (!body.id) return Response.json({ error: 'id required' }, { status: 400 });
      await supabase.from('ai_memory').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId }).eq('id', body.id);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Unknown op' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
