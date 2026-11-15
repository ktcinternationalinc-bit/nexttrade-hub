// src/lib/wave-route-auth.js — shared server-side authorization for Wave routes.
// A Wave route is allowed to run if EITHER:
//   (a) the request carries the CRON_SECRET as a bearer token (scheduled jobs), OR
//   (b) a user_id is provided that belongs to a super_admin in the users table.
// The frontend hiding buttons is NOT sufficient — these routes use the service role and
// must verify authorization themselves. SWC-safe: var + string concat, no arrows/const.
//
// Usage inside a route:
//   var gate = await assertWaveAuthorized(request, db, userId);
//   if (!gate.ok) { return Response.json({ ok:false, error: gate.error }, { status: gate.status }); }

export async function assertWaveAuthorized(request, db, userId) {
  var cronSecret = process.env.CRON_SECRET;
  var authHeader = '';
  try { authHeader = (request && request.headers && request.headers.get && request.headers.get('authorization')) || ''; } catch (eH) { authHeader = ''; }

  // (a) CRON bearer
  if (cronSecret && authHeader === ('Bearer ' + cronSecret)) {
    return { ok: true, via: 'cron' };
  }

  // (b) super_admin user_id
  if (userId) {
    try {
      var whoRes = await db.from('users').select('id, role').eq('id', userId).limit(1);
      var who = whoRes && whoRes.data && whoRes.data[0];
      if (who && who.role === 'super_admin') { return { ok: true, via: 'super_admin' }; }
    } catch (eU) {
      return { ok: false, status: 500, error: 'Authorization check failed: ' + ((eU && eU.message) || String(eU)) };
    }
  }

  return { ok: false, status: 403, error: 'Unauthorized — this Wave action requires a super admin.' };
}
