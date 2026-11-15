// ============================================================
// /api/claude-handoff
//
// The "next level" handoff pipeline. When Claude starts a new session,
// it calls this endpoint with a shared secret token. Gets back every
// open/reopened system_ticket in one pull. Can then POST back to update
// any of them. Zero copy-paste from Max.
//
// Security model:
//   - Bearer token in Authorization header (CLAUDE_HANDOFF_TOKEN env var).
//     Token is at least 32 chars, random, only known to Max and Claude.
//   - Every call logs to claude_handoff_log with session id + action.
//   - Rate limited: 500 reads / 200 writes per day via log-counting.
//   - CORS permissive (Claude calls from any origin).
//
// GET  /api/claude-handoff — pull handoff bundle (tickets + context)
// POST /api/claude-handoff — update a ticket
//     body: { ticket_id, action: 'fix'|'comment'|'reopen', notes, session_id }
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { sanitizeErr } from '../../../lib/sanitize-error';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ------------------------------------------------------------
// Auth — Bearer token
// ------------------------------------------------------------
function authOK(req) {
  var expected = process.env.CLAUDE_HANDOFF_TOKEN;
  if (!expected || expected.length < 24) return false;
  var auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  var token = auth.substring(7).trim();
  // Constant-time compare to prevent timing attacks
  if (token.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
  });
}

// ------------------------------------------------------------
// Rate limiting — counts today's handoff_log rows for this session
// ------------------------------------------------------------
var READ_LIMIT_PER_DAY  = 500;
var WRITE_LIMIT_PER_DAY = 200;

async function checkRateLimit(sessionId, actionKind) {
  try {
    // Count today's log entries for this session & kind
    var since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    var res = await supabase
      .from('claude_handoff_log')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('action', actionKind)
      .gte('created_at', since.toISOString());
    var cnt = res.count || 0;
    var limit = (actionKind === 'pull') ? READ_LIMIT_PER_DAY : WRITE_LIMIT_PER_DAY;
    if (cnt >= limit) return { ok: false, count: cnt, limit: limit };
    return { ok: true, count: cnt, limit: limit };
  } catch (e) {
    // If log table is missing, don't block — just skip rate limit
    return { ok: true, count: 0, limit: -1 };
  }
}

// ------------------------------------------------------------
// Logging
// ------------------------------------------------------------
async function logAction(sessionId, action, ticketId, payload, req) {
  try {
    await supabase.from('claude_handoff_log').insert({
      session_id: sessionId,
      action: action,
      ticket_id: ticketId || null,
      payload: payload || null,
      ip_address: req.headers.get('x-forwarded-for') || null,
      user_agent: req.headers.get('user-agent') || null,
    });
  } catch (e) { /* don't fail the request if logging fails */ }
}

// ------------------------------------------------------------
// GET — pull handoff bundle
// ------------------------------------------------------------
export async function GET(req) {
  if (!authOK(req)) return unauthorizedResponse();

  var url = new URL(req.url);
  var sessionId = url.searchParams.get('session') || ('sess-' + Date.now());

  var rl = await checkRateLimit(sessionId, 'pull');
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'rate_limit_exceeded', count: rl.count, limit: rl.limit }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }

  var bundle = {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    build_version: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    ok: true,
    tickets: [],
    warnings: [],
  };

  // ---------- pull system_tickets (internal bug queue) ----------
  try {
    // Prefer tickets flagged for Claude review OR open/reopened
    var tkRes = await supabase
      .from('system_tickets')
      .select('*')
      .or('status.eq.Open,status.eq.Reopened,claude_review_requested.eq.true')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(100);
    if (tkRes.error) {
      bundle.warnings.push('system_tickets read failed: ' + sanitizeErr(tkRes.error));
    } else {
      bundle.tickets = (tkRes.data || []).map(function(t) {
        return {
          id: t.id,
          ticket_number: t.ticket_number,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          reporter_id: t.reporter_id,
          assigned_to: t.assigned_to,
          claude_review_requested: !!t.claude_review_requested,
          claude_last_read_at: t.claude_last_read_at,
          claude_last_fixed_at: t.claude_last_fixed_at,
          created_at: t.created_at,
          updated_at: t.updated_at,
          due_date: t.due_date,
        };
      });
    }
  } catch (e) {
    bundle.warnings.push('system_tickets table not found — run session3 SQL');
  }

  // ---------- pull associated comments (last 5 per ticket) ----------
  if (bundle.tickets.length > 0) {
    try {
      var ticketIds = bundle.tickets.map(function(t) { return t.id; });
      var cmRes = await supabase
        .from('ticket_comments')
        .select('id, ticket_id, user_id, comment, created_at')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false })
        .limit(500);
      if (!cmRes.error && cmRes.data) {
        var byTicket = {};
        cmRes.data.forEach(function(c) {
          if (!byTicket[c.ticket_id]) byTicket[c.ticket_id] = [];
          if (byTicket[c.ticket_id].length < 5) byTicket[c.ticket_id].push(c);
        });
        bundle.tickets.forEach(function(t) { t.comments = byTicket[t.id] || []; });
      }
    } catch (e) { /* comments are optional — continue without */ }
  }

  // ---------- stamp claude_last_read_at on tickets we just pulled ----------
  if (bundle.tickets.length > 0) {
    try {
      var nowIso = new Date().toISOString();
      var idsToStamp = bundle.tickets.map(function(t) { return t.id; });
      await supabase
        .from('system_tickets')
        .update({ claude_last_read_at: nowIso })
        .in('id', idsToStamp);
    } catch (e) { /* swallow */ }
  }

  // ---------- pending ai_alerts (critical+high from last 7 days) ----------
  try {
    var since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    var aiRes = await supabase
      .from('ai_alerts')
      .select('id, alert_type, severity, subject, body, recommendation, created_at')
      .in('severity', ['critical', 'high'])
      .is('dismissed_at', null)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(50);
    if (!aiRes.error) bundle.pending_alerts = aiRes.data || [];
  } catch (e) { /* ai_alerts optional */ }

  // ---------- log the pull ----------
  await logAction(sessionId, 'pull', null, { ticket_count: bundle.tickets.length }, req);

  return new Response(JSON.stringify(bundle), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ------------------------------------------------------------
// POST — update a ticket
// body: {
//   ticket_id: uuid,
//   action: 'fix' | 'comment' | 'reopen' | 'assign',
//   notes: string (optional),
//   session_id: string (optional — groups updates),
//   new_status: string (optional, for 'fix'/'reopen')
// }
// ------------------------------------------------------------
export async function POST(req) {
  if (!authOK(req)) return unauthorizedResponse();

  var body;
  try { body = await req.json(); }
  catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  var ticketId = body && body.ticket_id;
  var action   = body && body.action;
  var notes    = (body && body.notes) || '';
  var sessionId = (body && body.session_id) || ('sess-' + Date.now());

  if (!ticketId || !action) {
    return new Response(JSON.stringify({ ok: false, error: 'missing ticket_id or action' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (['fix', 'comment', 'reopen', 'assign'].indexOf(action) === -1) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid action' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  var rl = await checkRateLimit(sessionId, 'update');
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'rate_limit_exceeded', count: rl.count, limit: rl.limit }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }

  var update = {};
  var nowIso = new Date().toISOString();

  if (action === 'fix') {
    update.status = (body && body.new_status) || 'Fixed';
    update.claude_last_fixed_at = nowIso;
    update.claude_session_id = sessionId;
    update.claude_review_requested = false; // clear flag after fixing
    if (notes) update.claude_fix_notes = notes;
  } else if (action === 'reopen') {
    update.status = 'Reopened';
    update.claude_session_id = sessionId;
    update.claude_review_requested = true; // re-flag for next handoff
    if (notes) update.claude_fix_notes = notes;
  } else if (action === 'assign') {
    if (body && body.assigned_to) update.assigned_to = body.assigned_to;
    if (body && body.priority) update.priority = body.priority;
  }

  // For all actions, write a comment row if we have notes
  try {
    if (notes && (action === 'comment' || action === 'fix' || action === 'reopen')) {
      await supabase.from('ticket_comments').insert({
        ticket_id: ticketId,
        user_id: null, // Claude doesn't have a user row
        comment: '🤖 Claude: ' + notes,
      });
    }

    // For non-comment actions, update the ticket
    if (action !== 'comment' && Object.keys(update).length > 0) {
      var upRes = await supabase.from('system_tickets').update(update).eq('id', ticketId).select().single();
      if (upRes.error) {
        return new Response(JSON.stringify({ ok: false, error: sanitizeErr(upRes.error) }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  await logAction(sessionId, action, ticketId, { notes: notes, update: update }, req);

  return new Response(JSON.stringify({ ok: true, ticket_id: ticketId, action: action, applied: update }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
