// Balance visibility is independent of document and bank-transaction access.
// This projection runs after verified viewer authorization on EVERY request.
// It never changes the complete server-only snapshot used by the automatic job.
var SUMMARY_WITHOUT_BALANCES = [
  'revenueCents', 'expenseCents', 'netProfitCents', 'receivablesCents',
  'payablesCents', 'salesTaxPayableCents', 'planningReserveCents',
  'openInvoiceCount', 'overdueInvoiceCount', 'balanced',
];
var ACCOUNT_WITHOUT_BALANCES = [
  'id', 'connectionId', 'institutionName', 'name', 'mask', 'subtype', 'currency',
  'ledgerAccountId', 'lastSyncedAt', 'active', 'environment', 'connectionStatus',
];

function pick(row, fields) {
  var result = {};
  for (var key of fields) if (Object.hasOwn(row || {}, key)) result[key] = row[key];
  return result;
}

export function ledgerlyVisibleResources(resources, capabilities) {
  // The complete journal includes opening balances and balance adjustments.
  // Ordinary bills, expenses, checks and individual bank transactions remain
  // available; only the complete general ledger needs the balance capability.
  return (resources || []).filter(function (resource) {
    if (resource === 'bank-accounts') return capabilities?.canViewBankAccounts === true || capabilities?.canViewBankBalances === true;
    if (resource === 'bank-transactions') return capabilities?.canViewBankTransactions === true || capabilities?.canViewBankBalances === true;
    if (capabilities?.canViewFullDashboard !== true) return false;
    return resource !== 'journal' || capabilities?.canViewBankBalances === true;
  });
}

export function projectLedgerlyForViewer(response, capabilities) {
  var canViewBankBalances = capabilities?.canViewBankBalances === true;
  var result = {
    ...response,
    resources: ledgerlyVisibleResources(response.resources, capabilities),
    capabilities: {
      canViewFullDashboard: capabilities?.canViewFullDashboard === true,
      canViewBankBalances: canViewBankBalances,
      canViewBankTransactionAmounts: canViewBankBalances || capabilities?.canViewBankTransactionAmounts === true,
    },
    snapshot: response.snapshot ? { ...response.snapshot } : null,
    status: response.status ? { ...response.status } : undefined,
    dataset: response.dataset ? { ...response.dataset } : null,
  };
  if (!result.dataset) return result;
  if (!result.resources.includes(result.dataset.resource)) {
    // Defense in depth: the route rejects this before reading the snapshot.
    result.dataset = null;
    result.snapshot = null;
    if (result.status) result.status.available = false;
    return result;
  }
  if (!canViewBankBalances && result.dataset.resource === 'summary') {
    result.dataset.data = pick(result.dataset.data, SUMMARY_WITHOUT_BALANCES);
  } else if (!canViewBankBalances && result.dataset.resource === 'bank-accounts') {
    result.dataset.data = (Array.isArray(result.dataset.data) ? result.dataset.data : []).map(function (row) {
      return pick(row, ACCOUNT_WITHOUT_BALANCES);
    });
  } else if (result.dataset.resource === 'bank-transactions' && result.capabilities.canViewBankTransactionAmounts !== true) {
    result.dataset.data = (Array.isArray(result.dataset.data) ? result.dataset.data : []).map(function (row) {
      var value = structuredClone(row);
      delete value.amountCents;
      return value;
    });
  } else {
    // Each response owns its data. Rendering or later projection cannot mutate
    // a snapshot another authorized viewer reads from the same process.
    result.dataset.data = structuredClone(result.dataset.data);
  }
  return result;
}
