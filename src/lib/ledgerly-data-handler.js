import { authorizeLedgerlyViewer, LedgerlyAuthError } from './ledgerly-auth.js';
import { readLedgerlyConfig, cronConfigured, cacheResponse, safeSyncError, LedgerlySyncError } from './ledgerly-sync.js';
import { ledgerlyVisibleResources, projectLedgerlyForViewer } from './ledgerly-visibility.js';

var headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache', 'Vary': 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' };
var json = function (body, status) { return Response.json(body, { status: status || 200, headers: headers }); };

export function createLedgerlyDataHandler(createClient, env) {
return async function GET(request) {
  try {
    var access = await authorizeLedgerlyViewer(request, createClient, env);
    var capabilities = access;
    var config;
    try { config = readLedgerlyConfig(env); if (!cronConfigured(env)) throw new LedgerlySyncError('cron_configuration', 503); }
    catch (_) { return json({ ok: true, configured: false, capabilities: { canViewFullDashboard: capabilities.canViewFullDashboard === true, canViewBankBalances: capabilities.canViewBankBalances === true }, status: { available: false, state: 'setup_required', stale: false, intervalMinutes: 15, displayRefreshSeconds: 60 }, error: 'The automatic Ledgerly connection needs its server settings. No import or refresh is required after setup.' }); }
    var url = new URL(request.url), allowed = ['resource', 'offset', 'limit', 'revision'];
    for (var key of url.searchParams.keys()) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return json({ ok: false, error: 'Invalid data query.' }, 400);
    }
    var resources = ledgerlyVisibleResources(config.resources, capabilities);
    var resource = url.searchParams.get('resource') || resources[0];
    if (resource === 'journal' && capabilities.canViewBankBalances !== true) return json({ ok: false, code: 'bank_balances_required', error: 'The complete journal includes opening bank balances and requires Bank account balances permission.', resources: resources }, 403);
    if (!resources.length) return json({ ok: false, code: 'dataset_permission', error: 'Your financial permissions do not include any dataset selected for this source.', resources: [] }, 403);
    if (!config.resources.includes(resource)) return json({ ok: false, error: 'This dataset is not selected for automatic sync.', resources: resources }, 400);
    if (!resources.includes(resource)) return json({ ok: false, code: 'dataset_permission', error: 'This dataset requires its separate dashboard or bank permission.', resources: resources }, 403);
    var offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0;
    var limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
    var requestedRevision = url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : null;
    if (requestedRevision !== null && (!Number.isSafeInteger(requestedRevision) || requestedRevision < 0)) return json({ ok: false, error: 'Invalid snapshot revision.' }, 400);
    var result = await access.db.from('ledgerly_sync_state').select('snapshot,sync_status,last_attempt_at,last_success_at,last_error_code').eq('id', 'primary').maybeSingle();
    if (result.error) throw new LedgerlySyncError('storage', 503);
    var data = cacheResponse(result.data, config, resource, offset, limit);
    if (requestedRevision !== null && data.snapshot && data.snapshot.revision !== requestedRevision) return json({ ok: false, error: 'A newer automatic snapshot is available.', code: 'snapshot_changed' }, 409);
    return json(projectLedgerlyForViewer(data, capabilities));
  } catch (error) {
    if (error instanceof LedgerlyAuthError) return json({ ok: false, code: 'viewer_auth', error: error.message }, error.status);
    var safe = safeSyncError(error);
    return json({ ok: false, code: safe.code, error: safe.message }, safe.status);
  }
}

}
