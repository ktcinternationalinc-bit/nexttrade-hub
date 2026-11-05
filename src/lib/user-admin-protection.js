import { bankSuperAdminIds } from './bank-visibility.js';
import { UserAdminError } from './user-admin-auth.js';

// A delegated team administrator must not gain protected financial access by
// resetting a super admin's or financial viewer's password. Resolve targets
// from Auth UUIDs, including inactive identities, before any profile mutation.
export async function authorizeUserAdminTarget(access, profileId, env) {
  var supers;
  try { supers = bankSuperAdminIds(env); }
  catch (_) { throw new UserAdminError('Team changes require the verified super-administrator setup before protected identities can be checked.', 503); }
  var mapping = await access.db.rpc('bank_visibility_auth_ids_for_profile', { p_profile_id: profileId });
  if (mapping.error || !Array.isArray(mapping.data)) throw new UserAdminError('The target account could not be checked. Apply the financial access migration before changing team accounts.', 503);
  if (mapping.data.length > 1) throw new UserAdminError('This profile matches more than one sign-in. Resolve its identity before changing the account.', 409);
  var target = mapping.data[0]?.auth_user_id || null;
  if (target && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target))
    throw new UserAdminError('The target account identity is invalid.', 503);
  if (!target || supers.includes(access.authUserId.toLowerCase())) return { authUserId: target };
  var permissions = await access.db.from('financial_visibility_permissions').select('can_view_dashboard,can_view_bank_balances').eq('auth_user_id', target).maybeSingle();
  if (permissions.error) throw new UserAdminError('The target account permissions could not be verified.', 503);
  if (supers.includes(target.toLowerCase()) || permissions.data?.can_view_dashboard === true || permissions.data?.can_view_bank_balances === true)
    throw new UserAdminError('Only a verified super administrator can change an account with protected financial access.', 403);
  return { authUserId: target };
}
