export function settlementWarning(result) {
  if (!result) { return 'Bank transactions loaded, but pending reconciliation did not finish. Retry bank sync.'; }
  if (result.needs_sql) { return 'Pending reconciliation needs a database update. Ask the super admin to check Bank sync details.'; }
  if (result.errors) { return 'Bank transactions loaded, but pending reconciliation encountered an error. Retry bank sync.'; }
  if (result.incomplete) { return 'Bank transactions loaded; pending reconciliation has more records to check. Run bank sync again.'; }
  if (result.needs_person) { return 'Some pending records need review. Ask the super admin to open Review pending records in All Transactions.'; }
  return null;
}

// Only inspect connections represented by rows the caller is already allowed to see.
export async function visibleSyncWarning(db, transactions) {
  var ids = Array.from(new Set((transactions || []).map(function (t) { return t.account_id; }).filter(Boolean)));
  if (!ids.length) { return null; }
  try {
    var accounts = await db.from('plaid_accounts').select('connection_id').in('plaid_account_id', ids);
    if (accounts.error) { throw new Error('accounts'); }
    var connections = Array.from(new Set((accounts.data || []).map(function (a) { return a.connection_id; }).filter(Boolean)));
    if (!connections.length) { return null; }
    var states = await db.from('bank_connections').select('last_sync_status').in('id', connections);
    if (states.error) { throw new Error('connections'); }
    if ((states.data || []).some(function (s) { return s.last_sync_status === 'partial' || s.last_sync_status === 'error'; })) {
      return 'Bank sync needs attention for an account in this list. Check Bank sync details; some transactions may not be up to date.';
    }
    return null;
  } catch (e) { return 'Unable to verify bank sync status. Check Bank sync details.'; }
}
