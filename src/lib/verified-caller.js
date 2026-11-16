// v55.83-TG (Codex 16 Nov, P1): resolve WHO is calling from their verified sign-in token, never from the user_id in the request
// body. The bearer token is checked by Supabase (authorizeBankIdentity → getUser) and mapped to exactly one active Hub user.
// A body.user_id that is not that user is refused. Server-only. SWC-safe (var + concat).
import { authorizeBankIdentity } from './bank-visibility';

export async function verifiedCaller(req, body, createClient) {
  try {
    var who = await authorizeBankIdentity(req, createClient, process.env);
    if (body && body.user_id && String(body.user_id).toLowerCase() !== String(who.profileId).toLowerCase()) { return { error: 'The user in the request is not the signed-in user.', status: 403 }; }
    return { userId: who.profileId };
  } catch (e) {
    var st = (e && e.status) || 401;
    return { error: st === 401 ? 'Sign in again — your sign-in could not be verified.' : st === 403 ? 'Your sign-in does not resolve to one active Hub user.' : 'Your sign-in could not be checked right now.', status: st };
  }
}
