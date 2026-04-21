// ============================================================
// /api/nadia/watch
//
// Proactive intelligence — the AI watches the business in the background
// and writes ai_alerts rows for things you should know about:
//   - overdue invoices
//   - checks clearing soon
//   - (future: silent customers, shipment risk, unusual patterns)
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

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function runWatch(specificUserId) {
  var summary = { users_scanned: 0, alerts_written: 0, errors: [] };

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
    try {
      var alerts = await scanForAlerts(userIds[i]);
      if (!alerts || alerts.length === 0) continue;

      // upsert — the unique index on
      // (target_user_id, alert_type, related_entity_id, day) dedups us
      var rows = alerts.map(function(a) { return a; });
      var insRes = await supabase.from('ai_alerts')
        .upsert(rows, {
          onConflict: 'target_user_id,alert_type,related_entity_id',
          ignoreDuplicates: true
        })
        .select('id');
      if (insRes.error) {
        summary.errors.push('upsert for ' + userIds[i] + ': ' + insRes.error.message);
        continue;
      }
      summary.alerts_written += (insRes.data && insRes.data.length) || 0;
    } catch (e) { summary.errors.push('scan ' + userIds[i] + ': ' + e.message); }
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
