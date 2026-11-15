import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/login-event
// Body: { user_id, event_type: 'login' | 'logout' | 'heartbeat', user_agent?, session_id? }
export async function POST(request) {
  try {
    var body = await request.json();
    if (!body.user_id) return Response.json({ error: 'user_id required' }, { status: 400 });
    var et = body.event_type || 'login';
    if (['login', 'logout', 'heartbeat'].indexOf(et) < 0) {
      return Response.json({ error: 'invalid event_type' }, { status: 400 });
    }
    // De-dupe: don't write duplicate 'login' events within 60 seconds of the last one for this user
    if (et === 'login') {
      try {
        var recent = await supabase.from('login_events')
          .select('id, occurred_at')
          .eq('user_id', body.user_id)
          .eq('event_type', 'login')
          .order('occurred_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recent && recent.data && recent.data.occurred_at) {
          var last = new Date(recent.data.occurred_at).getTime();
          if (Date.now() - last < 60 * 1000) {
            return Response.json({ ok: true, deduped: true });
          }
        }
      } catch (e) { /* ignore */ }
    }
    var insert = await supabase.from('login_events').insert({
      user_id: body.user_id,
      event_type: et,
      user_agent: body.user_agent || null,
      session_id: body.session_id || null,
      notes: body.notes || null,
    }).select('id, occurred_at, et_date').maybeSingle();
    if (insert && insert.error) {
      var msg = String(insert.error.message || '');
      if (msg.toLowerCase().indexOf('does not exist') >= 0 || msg.toLowerCase().indexOf('relation') >= 0) {
        return Response.json({ ok: false, warning: 'login_events table not found — run supabase/login-events.sql' });
      }
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
    return Response.json({ ok: true, event: (insert && insert.data) || null });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET /api/login-event?summary=1   → returns user_login_summary view rows
export async function GET(request) {
  try {
    var url = new URL(request.url);
    if (url.searchParams.get('summary') === '1') {
      var sumRes = await supabase.from('user_login_summary').select('*');
      if (sumRes && sumRes.error) {
        var msg = String(sumRes.error.message || '');
        if (msg.toLowerCase().indexOf('does not exist') >= 0 || msg.toLowerCase().indexOf('relation') >= 0) {
          return Response.json({ summary: [], warning: 'user_login_summary view not found — run supabase/login-events.sql' });
        }
        return Response.json({ error: msg }, { status: 500 });
      }
      return Response.json({ summary: (sumRes && sumRes.data) || [] });
    }
    return Response.json({ error: 'specify ?summary=1' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
