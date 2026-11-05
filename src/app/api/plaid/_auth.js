import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { authorizeBankIdentity, bankSuperAdminIds, BankVisibilityError, bankVisibilityErrorResponse } from '../../../lib/bank-visibility.js';
import { assertPermission } from '../../../lib/server-permissions.js';

var headers = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' };
export function plaidJson(body, options) { return Response.json(body, Object.assign({}, options, { headers: headers })); }
export function plaidError(error) { return bankVisibilityErrorResponse(error); }
export function configuredPlaidCron(env) {
  var secret = env.CRON_SECRET || '';
  return secret.length >= 16 && secret.length <= 8192 && !/[\r\n]/.test(secret);
}
export function isPlaidCron(request, env) {
  if (!configuredPlaidCron(env)) return false;
  var actual = Buffer.from(request.headers.get('authorization') || '');
  var expected = Buffer.from('Bearer ' + env.CRON_SECRET);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createPlaidAuthorizer(clientFactory, env, permissionCheck) {
 return async function authorize(request, permission, allowCron) {
  if (allowCron && isPlaidCron(request, env)) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new BankVisibilityError('The hub server database connection needs configuration.', 503);
    return { db: clientFactory(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }), via: 'cron', profileId: null };
  }
  var access = await authorizeBankIdentity(request, clientFactory, env);
  var isSuper = false;
  try { isSuper = bankSuperAdminIds(env).includes(access.authUserId); } catch (_) { /* balance setup must not block operational work */ }
  if (!isSuper) {
    // Preserve the existing action-specific role/grant behavior, but resolve it
    // for the genuinely verified profile, never a body-supplied user_id.
    var gate = await permissionCheck(access.db, access.profileId, permission, request);
    if (!gate.ok) throw new BankVisibilityError(gate.error, gate.status || 403);
  }
  return Object.assign({}, access, { isVerifiedSuperAdmin: isSuper });
 };
}
export var authorizePlaidOperation = createPlaidAuthorizer(createClient, process.env, assertPermission);
