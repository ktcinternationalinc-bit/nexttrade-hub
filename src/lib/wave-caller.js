// v55.83-XK (inventory 23 Nov) — the Wave import / reconcile / push routes took the acting person from body.userId / body.user_id
// WITHOUT checking the sign-in, so anyone could act (and read invoice money) as someone else, e.g. the super admin. From now on:
//   • a scheduled job that sends the CRON secret keeps working exactly as before (assertPermission still decides which actions a
//     job may run — only the import / category pull);
//   • everybody else is the VERIFIED signed-in person (bearer token, mapped to one Hub user); a different id in the request is
//     refused. The screens send the token through hubFetch. Server-only; SWC-safe: var + concatenation.
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from './verified-caller';

// → { userId, cron } | { error, status }
export async function waveCaller(req, claimedId) {
  var secret = process.env.CRON_SECRET; var auth = '';
  try { auth = (req && req.headers && req.headers.get && req.headers.get('authorization')) || ''; } catch (e) { auth = ''; }
  if (secret && auth === 'Bearer ' + secret) { return { userId: claimedId || null, cron: true }; }
  var who = await verifiedCaller(req, { user_id: claimedId || null }, createClient);
  if (who.error) { return { error: who.error, status: who.status || 401 }; }
  return { userId: who.userId, cron: false };
}
