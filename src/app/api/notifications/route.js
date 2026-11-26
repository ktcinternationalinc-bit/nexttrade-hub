// v55.83-ZM — the 🔔 bell's own server route. The bell used to read and mark its rows straight from the browser, which only worked
// because public.notifications had an allow_all policy (anyone could read or change anyone's notices). The bell now comes here:
// the signed-in person is verified (never a user id from the browser), and the route reads / marks ONLY that person's rows with the
// server key. sql/v55-83-ZE-notify-lock.sql then closes the table to the browser. SWC-safe (var + concat).
//   GET                                   -> { ok, notifications: [...30 newest of mine], unread }
//   POST { action: 'mark_read', ids: [] } -> { ok, marked }       (only my rows; others' ids change nothing)
//   POST { action: 'mark_all_read' }      -> { ok, marked }
import { createClient } from '@supabase/supabase-js';
import { notifySender, isUuid } from '../../../lib/notify-auth';

var NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization' };
function out(body, status) { return Response.json(body, { status: status || 200, headers: NO_STORE }); }

async function me(req) {
  var who = await notifySender(req, createClient, process.env);
  if (who.error) { return { res: out({ ok: false, error: who.error }, who.status) }; }
  if (who.internal || !who.userId) { return { res: out({ ok: false, error: 'The bell is for a signed-in person.' }, 403) }; }
  return { who: who };
}

export async function GET(req) {
  var g = await me(req); if (g.res) { return g.res; }
  try {
    var r = await g.who.db.from('notifications').select('id, user_id, type, title, body, read, created_at')
      .eq('user_id', g.who.userId).order('created_at', { ascending: false }).limit(30);
    if (r.error) { return out({ ok: false, error: 'The notices could not be loaded right now.' }, 503); }
    var rows = r.data || [];
    return out({ ok: true, notifications: rows, unread: rows.filter(function (n) { return n.read !== true; }).length });
  } catch (e) { return out({ ok: false, error: 'The notices could not be loaded right now.' }, 500); }
}

export async function POST(req) {
  var body = null;
  try { body = await req.json(); } catch (eJ) { return out({ ok: false, error: 'Send JSON.' }, 400); }
  var g = await me(req); if (g.res) { return g.res; }
  try {
    var q = g.who.db.from('notifications').update({ read: true }).eq('user_id', g.who.userId).eq('read', false);
    if (body && body.action === 'mark_read') {
      var ids = (Array.isArray(body.ids) ? body.ids : []).filter(isUuid).slice(0, 200);
      if (!ids.length) { return out({ ok: true, marked: 0 }); }
      q = q.in('id', ids);
    } else if (!(body && body.action === 'mark_all_read')) {
      return out({ ok: false, error: 'Unknown action.' }, 400);
    }
    var r = await q.select('id');
    if (r.error) { return out({ ok: false, error: 'The notice could not be marked read right now.' }, 503); }
    return out({ ok: true, marked: (r.data || []).length });
  } catch (e) { return out({ ok: false, error: 'The notice could not be marked read right now.' }, 500); }
}
