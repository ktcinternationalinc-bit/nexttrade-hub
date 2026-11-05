// US Accounting only. Inject the existing verified-identity authorization helper.
// No browser-supplied business ID, banking permission, or posting operation is accepted.
var HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' };
function json(body, status) { return Response.json(body, { status: status || 200, headers: HEADERS }); }
function pick(source, keys) {
  var out = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return out;
  for (var key of keys) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  return out;
}
export function projectClickbooksRead(data, bank) {
  if (!data || data.book?.code !== 'KTC_US' || data.book?.currency !== 'USD' || !Array.isArray(data.accounts))
    throw new Error('Invalid ClickBooks US snapshot');
  var counts = ['usd_invoices', 'foreign_currency_invoices', 'customers', 'active_payment_rows', 'void_payment_rows', 'source_accounts'];
  var checks = ['duplicate_wave_invoice_ids', 'invoice_arithmetic_mismatches', 'missing_invoice_items', 'payment_missing_us_invoice', 'historical_paid_without_local_payment_rows'];
  if (bank) {
    counts.push('bank_rows', 'pending_bank_rows');
    checks.push('duplicate_bank_source_ids', 'payment_missing_us_bank_row', 'unreviewed_bank_rows', 'bank_missing_legacy_business_uuid', 'bank_missing_wave_account_mapping', 'us_scheduled_sync_log_rows');
  }
  var audit = data.audit ? {
    scope: 'KTC_US_ACCOUNTING_ONLY', checked_at: data.audit.checked_at,
    counts: pick(data.audit.counts, counts), checks: pick(data.audit.checks, checks),
    verification_limit: data.audit.verification_limit,
  } : null;
  return {
    book: pick(data.book, ['code', 'name', 'currency', 'postingEnabled', 'historyReady', 'hasPostedEntries']),
    accounts: data.accounts.filter(function (a) { return bank || a.bankSensitive === false; })
      .map(function (a) { return pick(a, ['id', 'code', 'name', 'type', 'normalSide', 'contra', 'active', 'needsReview', 'bankSensitive']); }),
    audit: audit, asOf: data.asOf,
    trialBalanceAvailable: bank && data.trialBalanceAvailable === true,
    trialBalance: bank && data.trialBalanceAvailable === true && Array.isArray(data.trialBalance)
      ? data.trialBalance.map(function (r) { return pick(r, ['code', 'name', 'type', 'debitCents', 'creditCents', 'netDebitCents']); }) : null,
    bankingIncluded: bank,
  };
}
export function createClickbooksReadHandler(authorize, env) {
  return async function GET(request) {
    if (request.method !== 'GET') return json({ ok: false, error: 'Read-only endpoint.' }, 405);
    if (env.CLICKBOOKS_US_ENABLED !== 'true') return json({ ok: false, error: 'ClickBooks US preview has not been activated.' }, 503);
    try {
      if (new URL(request.url).search) return json({ ok: false, error: 'This endpoint is fixed to the approved US book and accepts no query parameters.' }, 400);
      var access = await authorize(request);
      if (!access || (access.canViewFullDashboard !== true && access.isVerifiedSuperAdmin !== true))
        return json({ ok: false, error: 'Full dashboard permission is required.' }, 403);
      var bank = access.isVerifiedSuperAdmin === true || access.canViewBankBalances === true;
      var result = await access.db.rpc('clickbooks_us_read', { p_with_bank: bank });
      if (result.error) return json({ ok: false, error: 'The ClickBooks US database read could not be completed. Check the migration and permissions.' }, 503);
      return json({ ok: true, data: projectClickbooksRead(result.data, bank) });
    } catch (error) {
      var status = [401, 403, 503].includes(error?.status) ? error.status : 500;
      return json({ ok: false, error: status === 401 ? 'Sign in again to verify access.' : status === 403 ? 'You do not have access to this view.' : 'ClickBooks US access could not be verified. No financial data was returned.' }, status);
    }
  };
}
