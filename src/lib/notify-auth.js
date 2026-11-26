// v55.83-ZM (Codex 25 Nov: /api/notify must check who is sending before its bell insert may succeed; Max 26 Nov "close it").
// Who may send a notice through /api/notify, and who may read / mark their own bell rows through /api/notifications:
//   1. a signed-in Hub person — the bearer token is verified by Supabase and mapped to exactly ONE active Hub user
//      (authorizeBankIdentity, the same check as every money route); the sender is that person, never a user id in the body;
//   2. an internal server call — Authorization: Bearer CRON_SECRET (at least 16 characters), the secret the timers already use.
// Anything else is refused (401 / 403). Server-only. SWC-safe (var + concat).
import { authorizeBankIdentity } from './bank-visibility';

var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var ADMIN_ROLES = { super_admin: 1, admin: 1 };

export function isInternalCall(req, env) {
  var s = (env && env.CRON_SECRET) || '';
  var h = '';
  try { h = (req && req.headers && req.headers.get && req.headers.get('authorization')) || ''; } catch (e) { h = ''; }
  return s.length >= 16 && h === 'Bearer ' + s;
}

// -> { internal: true } | { userId, role, isAdmin, db } | { error, status }
export async function notifySender(req, createClient, env) {
  if (isInternalCall(req, env)) { return { internal: true, isAdmin: true }; }
  try {
    var who = await authorizeBankIdentity(req, createClient, env);
    var role = '';
    try {
      var r = await who.db.from('users').select('role').eq('id', who.profileId).maybeSingle();
      role = (r && !r.error && r.data && r.data.role) || '';
    } catch (eR) { role = ''; }
    return { userId: who.profileId, role: role, isAdmin: !!ADMIN_ROLES[role], db: who.db };
  } catch (e) {
    var st = (e && e.status) || 401;
    return { error: st === 401 ? 'Sign in again — your sign-in could not be verified, so the notice was not sent.' : st === 403 ? 'Your sign-in does not resolve to one active Hub user, so the notice was not sent.' : 'Your sign-in could not be checked right now — the notice was not sent.', status: st };
  }
}

// Recipient rules for a signed-in sender (internal calls skip them):
//   'all' (broadcast) — admins only; a list — at most 200 Hub user ids, each a real id.
export function recipientProblem(sender, recipientIds) {
  if (sender && sender.internal) { return null; }
  if (recipientIds === 'all') { return sender && sender.isAdmin ? null : 'Only an admin can send a notice to everyone.'; }
  var ids = Array.isArray(recipientIds) ? recipientIds : [recipientIds];
  if (!ids.length || ids.length > 200) { return 'A notice goes to 1 to 200 people.'; }
  for (var i = 0; i < ids.length; i++) { if (!UUID.test(String(ids[i] || ''))) { return 'A recipient is not a Hub user.'; } }
  return null;
}

export function isUuid(v) { return UUID.test(String(v || '')); }
