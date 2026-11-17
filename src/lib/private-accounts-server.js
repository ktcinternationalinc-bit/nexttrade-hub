// v55.83-TP (Max, Nov 17: "if I mark an account private, it should not be shown ... only the super admin or the ones I permission
// can see") — server-side half of PRIVATE bank accounts. The database half is the RLS policy in sql/v55-83-TP-permissions.sql
// (screens that read bank_transactions directly); this file protects the API routes that read with the service key.
// A person sees a private account's transactions only when they are the super admin or have 'bank.view_private'.
// Fails CLOSED: if the private list cannot be read, the caller is treated as not allowed and the read is refused.
// SWC-safe: var + concatenation.
import { loadUserPermissions, userHasPermission } from './server-permissions';

export var PRIVATE_PERMISSION = 'bank.view_private';

// → { all: true } (may see everything) | { all: false, hidden: { plaid_account_id: true } } | { error }
export async function privateScope(db, userId) {
  try {
    var ctx = await loadUserPermissions(db, userId);
    if (ctx.isSuperAdmin === true || userHasPermission(ctx, PRIVATE_PERMISSION)) { return { all: true, hidden: {} }; }
    var r = await db.from('plaid_accounts').select('plaid_account_id, is_private').eq('is_private', true);
    if (r.error) {
      if (/is_private/.test(String(r.error.message || '')) && /does not exist|schema cache/i.test(String(r.error.message || ''))) { return { all: false, hidden: {} }; } // TP SQL not run yet: nothing is private
      return { error: 'Could not check private accounts (' + r.error.message + ')' };
    }
    var hidden = {}; (r.data || []).forEach(function (a) { if (a.plaid_account_id) { hidden[a.plaid_account_id] = true; } });
    return { all: false, hidden: hidden };
  } catch (e) { return { error: 'Could not check private accounts (' + ((e && e.message) || 'error') + ')' }; }
}

// keep only the rows this person may see (rows need their account_id)
export function dropPrivate(rows, scope, key) {
  if (!scope || scope.all) { return rows || []; }
  var k = key || 'account_id';
  return (rows || []).filter(function (t) { return !(t && t[k] && scope.hidden[t[k]]); });
}
export function isPrivateRow(row, scope, key) { return !!(scope && !scope.all && row && row[key || 'account_id'] && scope.hidden[row[key || 'account_id']]); }
