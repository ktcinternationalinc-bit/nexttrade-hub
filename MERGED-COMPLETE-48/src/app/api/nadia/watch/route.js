// ============================================================
// /api/nadia/watch
//
// Proactive intelligence — the AI watches the business in the background
// and writes ai_alerts rows for things you should know about.
//
// Two scanners run in parallel:
//   1. scanForAlerts() — original decision-engine alerts (overdue invoices,
//                        checks clearing soon, etc.)
//   2. buildBriefing() — Phase 2 priority engine. The top 3 items each
//                        run become candidate alerts if they aren't
//                        already in ai_alerts for today.
//
// Invocation:
//   GET  — cron (every 30 min per vercel.json)
//   POST — manual flush, optional body { user_id }
//
// Idempotency:
//   - ai_alerts has a unique index on (user, type, related_entity, day)
//     so re-running the scan in the same day never duplicates.
//   - upsert with ignoreDuplicates:true = "insert new only".
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { scanForAlerts } from '../../../../lib/decision-engine';
import * as briefingEngine from '../../../../lib/briefing-engine';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Load the user's view of the world (same data the greeter loads). Used
// by the briefing engine to compute their top 3 priorities.
async function loadUserBusinessContext(userId) {
  var today = new Date().toISOString().substring(0, 10);
  var results = await Promise.all([
    supabase.from('tickets').select('id, ticket_number, title, status, priority, due_date, assigned_to, created_at, updated_at').neq('status', 'Closed').limit(500),
    supabase.from('invoices').select('id, customer_name, customer_name_en, customer_id, invoice_date, total_collected, outstanding, order_number, invoice_number').limit(2000),
    supabase.from('checks').select('id, check_number, amount, status, due_date').eq('status', 'pending').limit(200),
    supabase.from('calendar_events').select('id, title, event_date, event_time, assigned_to, description').eq('event_date', today).limit(50),
    supabase.from('follow_ups').select('id, task, due_date, completed, customer_id, assigned_to').eq('completed', false).limit(200),
    supabase.from('customers').select('id, name, name_en').limit(500),
  ]);
  return {
    todayStr: today,
    nowMs: Date.now(),
    userId: userId,
    tickets: (results[0] && results[0].data) || [],
    invoices: (results[1] && results[1].data) || [],
    checks: (results[2] && results[2].data) || [],
    calendar_events: (results[3] && results[3].data) || [],
    follow_ups: (results[4] && results[4].data) || [],
    customers: (results[5] && results[5].data) || [],
  };
}

// Convert a briefing item into an ai_alerts row shape.
function briefingItemToAlert(item, userId) {
  return {
    target_user_id: userId,
    alert_type: 'briefing_' + (item.kind || 'generic'),
    severity: item.urgency === 'critical' ? 'critical' : item.urgency === 'high' ? 'high' : 'medium',
    subject: item.title,
    body: item.why,
    recommendation: item.action_label,
    related_entity_id: item.ref_id || null,
    // extras stored as JSON if the column exists — the db rejects keys it doesn't know about,
    // so only pack what we're sure exists
  };
}

async function runWatch(specificUserId) {
  var summary = { users_scanned: 0, alerts_written: 0, briefing_alerts_written: 0, errors: [] };

  // Find which users to scan. For cron with no body → all super_admins
  // (owners) get proactive alerts. For POST with user_id → just that user.
  var userIds = [];
  if (specificUserId) {
    userIds = [specificUserId];
  } else {
    try {
      var uRes = await supabase.from('users').select('id, role').eq('active', true);
      if (!uRes.error && uRes.data) {
        userIds = uRes.data
          .filter(function(u) { return u.role === 'super_admin' || u.role === 'admin'; })
          .map(function(u) { return u.id; });
      }
    } catch (e) { summary.errors.push('user lookup: ' + e.message); }
  }

  for (var i = 0; i < userIds.length; i++) {
    summary.users_scanned++;
    var uid = userIds[i];

    // SCAN 1 — original decision engine alerts
    try {
      var alerts = await scanForAlerts(uid);
      if (alerts && alerts.length > 0) {
        var insRes = await supabase.from('ai_alerts')
          .upsert(alerts, {
            onConflict: 'target_user_id,alert_type,related_entity_id',
            ignoreDuplicates: true
          })
          .select('id');
        if (insRes.error) {
          summary.errors.push('scan-alerts upsert ' + uid + ': ' + insRes.error.message);
        } else {
          summary.alerts_written += (insRes.data && insRes.data.length) || 0;
        }
      }
    } catch (e) { summary.errors.push('scanForAlerts ' + uid + ': ' + e.message); }

    // SCAN 2 — Phase 2 briefing engine. Top 3 become alerts.
    try {
      var ctx = await loadUserBusinessContext(uid);
      var briefing = briefingEngine.buildBriefing(ctx);
      if (briefing && briefing.top3 && briefing.top3.length > 0) {
        var briefingRows = briefing.top3.map(function(it) { return briefingItemToAlert(it, uid); });
        var bIns = await supabase.from('ai_alerts')
          .upsert(briefingRows, {
            onConflict: 'target_user_id,alert_type,related_entity_id',
            ignoreDuplicates: true
          })
          .select('id');
        if (bIns.error) {
          summary.errors.push('briefing upsert ' + uid + ': ' + bIns.error.message);
        } else {
          summary.briefing_alerts_written += (bIns.data && bIns.data.length) || 0;
        }
      }
    } catch (e) { summary.errors.push('briefing ' + uid + ': ' + e.message); }
  }
  return summary;
}

export async function GET(req) {
  try {
    var summary = await runWatch(null);
    return new Response(JSON.stringify(summary), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export async function POST(req) {
  try {
    var body = await req.json().catch(function() { return {}; });
    var summary = await runWatch(body && body.user_id);
    return new Response(JSON.stringify(summary), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
