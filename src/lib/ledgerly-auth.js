import { authorizeBankVisibility, BankVisibilityError } from './bank-visibility.js';

// The two protected financial permissions are the authority for this shared
// company feed. Legacy roles/module grants cannot confer dashboard or balances.
export class LedgerlyAuthError extends Error {
  constructor(message, status) { super(message); this.name = 'LedgerlyAuthError'; this.status = status; }
}

export async function authorizeLedgerlyViewer(request, createClient, env) {
  var access;
  try { access = await authorizeBankVisibility(request, createClient, env); }
  catch (error) {
    if (error instanceof BankVisibilityError) throw new LedgerlyAuthError(error.message, error.status);
    throw new LedgerlyAuthError('Financial access could not be verified. Sign in again.', 503);
  }
  if (access.canViewFullDashboard !== true && access.canViewBankBalances !== true)
    throw new LedgerlyAuthError('This shared source requires Full dashboard access or Banking information access.', 403);

  var permissions = [];
  // A full-dashboard viewer may still do individually permitted bank work
  // without receiving account balances. These operational flags never grant
  // either protected financial permission.
  if (access.canViewFullDashboard === true && access.canViewBankBalances !== true) {
    var result = await access.db.from('module_permissions').select('module_name,has_access').eq('user_id', access.profileId);
    if (!result.error && Array.isArray(result.data)) permissions = result.data;
  }
  function has(keys) {
    return permissions.some(function (permission) { return permission.has_access === true && keys.includes(permission.module_name); });
  }
  var banking = access.canViewBankBalances === true;
  return {
    ...access,
    canViewBankAccounts: banking || has(['Bank', 'Bank: View', 'bank.view', 'Bank: View Transactions', 'bank.view_transactions', 'Payments: Match', 'payments.match', 'Bank: Classify', 'bank.classify']),
    canViewBankTransactions: banking || has(['Bank', 'Bank: View', 'bank.view', 'Bank: View Transactions', 'bank.view_transactions']),
    canViewBankTransactionAmounts: banking || has(['Bank: See Amounts', 'bank.see_amounts', 'Bank: View Transaction Amounts', 'bank.view_transaction_amounts', 'Payments: Match', 'payments.match', 'Bank: Classify', 'bank.classify']),
  };
}
