// Server-only integration core. Dependency injection keeps tests offline and makes
// a full snapshot, rather than an individual page, the unit of publication.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export var LEDGERLY_ORIGIN = 'https://ledgerly-business-books.easyibex128.chatgpt.site';
export var RESOURCE_FIELDS = {
  summary: ['revenueCents', 'expenseCents', 'netProfitCents', 'cashCents', 'receivablesCents', 'payablesCents', 'salesTaxPayableCents', 'planningReserveCents', 'openInvoiceCount', 'overdueInvoiceCount', 'balanced'],
  invoices: ['id', 'number', 'contactId', 'contactName', 'date', 'dueDate', 'memo', 'lines', 'taxRateBps', 'taxLabel', 'subtotalCents', 'taxCents', 'totalCents', 'paidCents', 'outstandingCents', 'status'],
  bills: ['id', 'number', 'contactId', 'contactName', 'date', 'dueDate', 'categoryId', 'amountCents', 'paidCents', 'outstandingCents', 'memo', 'status'],
  expenses: ['id', 'payee', 'date', 'categoryId', 'accountId', 'amountCents', 'memo', 'status'],
  checks: ['id', 'number', 'payee', 'date', 'categoryId', 'accountId', 'amountCents', 'memo', 'billId', 'status'],
  contacts: ['id', 'type', 'name', 'email', 'address'],
  journal: ['id', 'date', 'description', 'sourceType', 'sourceId', 'lines', 'reverses', 'createdAt'],
  'bank-accounts': ['id', 'connectionId', 'institutionName', 'name', 'mask', 'subtype', 'currency', 'currentBalanceCents', 'availableBalanceCents', 'ledgerAccountId', 'lastSyncedAt', 'active', 'environment', 'connectionStatus'],
  'bank-transactions': ['id', 'connectionId', 'institutionName', 'accountId', 'accountName', 'accountMask', 'ledgerAccountId', 'date', 'description', 'amountCents', 'currency', 'pending', 'removed', 'status', 'journalId', 'changedSinceReview', 'environment', 'connectionStatus', 'lastSyncedAt'],
};
var DEFAULT_RESOURCES = ['summary', 'invoices', 'bank-accounts', 'bank-transactions'];
var MAX_PAGE_BYTES = 2_000_000;
var MAX_SNAPSHOT_BYTES = 8_000_000;
var MAX_ROWS = 10_000;
var MAX_PAGES = 20;
var MAX_REQUESTS = 90;
var TIME_BUDGET_MS = 45_000;
export var STALE_AFTER_MS = 30 * 60 * 1000;

var MESSAGES = {
  configuration: 'Automatic Ledgerly sync needs valid server connection settings.',
  cron_configuration: 'Automatic sync is disabled until a strong CRON_SECRET is configured.',
  unauthorized: 'This endpoint requires the configured scheduler credential.',
  source_access: 'Ledgerly access was rejected. Check both server credentials, key expiry, and dataset scopes.',
  source_unavailable: 'Ledgerly could not be reached. The last complete snapshot has been preserved.',
  source_not_ready: 'Ledgerly has no ready company snapshot, or its books changed repeatedly. The next scheduled run will retry.',
  source_format: 'Ledgerly returned an unexpected response. Check private Site access and the deployed API version.',
  capacity: 'The Ledgerly snapshot exceeds the configured sync limit. The previous complete snapshot is still available.',
  timeout: 'The Ledgerly pull exceeded its time limit. The next scheduled run will retry.',
  storage: 'Ledgerly snapshot storage is unavailable. Apply the integration migration and check the server database configuration.',
  lease_lost: 'Another sync superseded this run. Its result was not published.',
};

export class LedgerlySyncError extends Error {
  constructor(code, status) {
    super(MESSAGES[code] || MESSAGES.source_unavailable);
    this.name = 'LedgerlySyncError'; this.code = code; this.status = status || 502;
  }
}
class SnapshotChanged extends Error {}
function fail(code, status) { throw new LedgerlySyncError(code, status); }
export function safeSyncError(error) {
  return error instanceof LedgerlySyncError
    ? { code: error.code, message: error.message, status: error.status }
    : { code: 'source_unavailable', message: MESSAGES.source_unavailable, status: 502 };
}
function digest(value) { return createHash('sha256').update(value).digest(); }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function int(value) { return typeof value === 'number' && Number.isSafeInteger(value); }
function date(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value)) return false;
  var d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function isoTime(value) { return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
function currency(value) { return typeof value === 'string' && /^[A-Z]{3}$/.test(value); }

function httpsOrigin(value) {
  try {
    var url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') fail('configuration', 503);
    if (url.hostname === 'localhost' || !url.hostname.includes('.') || /[\[\]:]/.test(url.hostname) || /^\d+(\.\d+){3}$/.test(url.hostname)) fail('configuration', 503);
    return url.origin;
  } catch (e) { if (e instanceof LedgerlySyncError) throw e; fail('configuration', 503); }
}

export function readLedgerlyConfig(env) {
  var origin = httpsOrigin(env.LEDGERLY_BASE_URL || LEDGERLY_ORIGIN);
  // A custom origin requires a second explicit pin, preventing an accidental
  // base-URL edit from sending the existing private credentials to another host.
  var pinned = env.LEDGERLY_ALLOWED_ORIGIN ? httpsOrigin(env.LEDGERLY_ALLOWED_ORIGIN) : LEDGERLY_ORIGIN;
  if (origin !== pinned) fail('configuration', 503);
  var readKey = env.LEDGERLY_READ_KEY || '';
  var siteKey = env.LEDGERLY_SITE_ACCESS_TOKEN || '';
  if (!/^ldg_[a-f0-9]{64}$/.test(readKey) || siteKey.length < 16 || siteKey.length > 8192 || /[^\x21-\x7e]/.test(siteKey)) fail('configuration', 503);
  var requested = env.LEDGERLY_RESOURCES === undefined ? DEFAULT_RESOURCES : String(env.LEDGERLY_RESOURCES).split(',').map(function (s) { return s.trim(); });
  if (!requested.length || requested.some(function (r) { return !Object.hasOwn(RESOURCE_FIELDS, r); })) fail('configuration', 503);
  var resources = Object.keys(RESOURCE_FIELDS).filter(function (r) { return requested.includes(r); });
  var configId = digest(JSON.stringify([origin, readKey, siteKey, resources])).toString('hex');
  return { origin: origin, readKey: readKey, siteKey: siteKey, resources: resources, configId: configId };
}

export function cronConfigured(env) {
  var secret = env.CRON_SECRET || '';
  return secret.length >= 16 && secret.length <= 8192 && !/[\r\n]/.test(secret);
}
export function verifyCronRequest(request, env) {
  var secret = env.CRON_SECRET || '';
  if (!cronConfigured(env)) fail('cron_configuration', 503);
  var authorization = request.headers.get('authorization') || '';
  if (authorization.length > 8200 || !timingSafeEqual(digest(authorization), digest('Bearer ' + secret))) fail('unauthorized', 401);
}

function validateNestedLines(value, resource) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail('source_format');
  return value.map(function (line) {
    if (!plainObject(line)) fail('source_format');
    if (resource === 'invoices') {
      if (typeof line.description !== 'string' || line.description.length > 2000 || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0 || !int(line.unitPriceCents) || line.unitPriceCents < 0 || typeof line.taxable !== 'boolean') fail('source_format');
      return { description: line.description, quantity: line.quantity, unitPriceCents: line.unitPriceCents, taxable: line.taxable };
    }
    if (typeof line.accountId !== 'string' || line.accountId.length > 50 || !int(line.debit) || line.debit < 0 || !int(line.credit) || line.credit < 0) fail('source_format');
    return { accountId: line.accountId, debit: line.debit, credit: line.credit };
  });
}

function validateRow(row, resource) {
  if (!plainObject(row)) fail('source_format');
  if (resource !== 'summary' && (typeof row.id !== 'string' || !row.id || row.id.length > 700)) fail('source_format');
  var bank = resource.startsWith('bank-');
  var result = {};
  RESOURCE_FIELDS[resource].forEach(function (key) {
    if (!Object.hasOwn(row, key)) fail('source_format');
    var value = row[key];
    if (key === 'lines') { result[key] = validateNestedLines(value, resource); return; }
    if (key.endsWith('Cents') || key.endsWith('Count') || key === 'taxRateBps') {
      if (bank && ['currentBalanceCents', 'availableBalanceCents'].includes(key) && value === null) { result[key] = null; return; }
      if (!int(value)) fail('source_format');
    } else if (['balanced', 'pending', 'removed', 'active', 'changedSinceReview'].includes(key)) {
      if (typeof value !== 'boolean') fail('source_format');
    } else if (key === 'date' || key === 'dueDate') {
      if (!date(value)) fail('source_format');
    } else if (key === 'createdAt' || key === 'lastSyncedAt') {
      if (!(value === null && key === 'lastSyncedAt') && !isoTime(value)) fail('source_format');
    } else if (key === 'currency') {
      if (value !== null && !currency(value)) fail('source_format');
    } else if (key === 'environment') {
      if (![null, 'production', 'sandbox'].includes(value)) fail('source_format');
    } else if (value !== null && (typeof value !== 'string' || value.length > 10_000)) {
      fail('source_format');
    }
    result[key] = value;
  });
  return result;
}

async function readJsonBounded(response, budget) {
  var length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_PAGE_BYTES) fail('capacity');
  if (!response.body) fail('source_format');
  var reader = response.body.getReader(), decoder = new TextDecoder(), text = '', bytes = 0;
  try {
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength; budget.bytes += chunk.value.byteLength;
      if (bytes > MAX_PAGE_BYTES || budget.bytes > MAX_SNAPSHOT_BYTES * 3) fail('capacity');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch (_) { fail('source_format'); }
  } finally { await reader.cancel().catch(function () {}); reader.releaseLock(); }
}

async function sourcePage(config, resource, period, cursor, context) {
  var remaining = context.deadline - context.clock();
  if (remaining <= 0) fail('timeout');
  context.requests += 1;
  if (context.requests > MAX_REQUESTS) fail('capacity');
  var url = new URL('/api/v1/' + resource, config.origin);
  url.search = new URLSearchParams({ from: period.from, to: period.to, limit: '500', fields: RESOURCE_FIELDS[resource].join(','), ...(cursor ? { cursor: cursor } : {}) }).toString();
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, Math.min(8000, remaining));
  try {
    var response = await context.fetch(url.href, {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + config.readKey, 'OAI-Sites-Authorization': 'Bearer ' + config.siteKey },
    });
    if (response.redirected || (response.url && new URL(response.url).origin !== config.origin)) fail('source_format');
    if (response.status === 409) throw new SnapshotChanged();
    if (response.status === 401 || response.status === 403) fail('source_access');
    if (!response.ok) fail('source_unavailable');
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail('source_format');
    var body = await readJsonBounded(response, context);
    if (context.clock() > context.deadline) fail('timeout');
    if (!plainObject(body) || body.schemaVersion !== '1' || body.resource !== resource || !currency(body.currency) || !int(body.revision) || body.revision < 0 || !isoTime(body.generatedAt) || !plainObject(body.period) || body.period.from !== period.from || body.period.to !== period.to || !int(body.total) || body.total < 0 || body.total > MAX_ROWS) fail('source_format');
    if (!(body.nextCursor === null || (typeof body.nextCursor === 'string' && body.nextCursor.length > 0 && body.nextCursor.length <= 4096))) fail('source_format');
    if (resource === 'summary') {
      if (body.total !== 1 || body.nextCursor !== null || !plainObject(body.data)) fail('source_format');
      body.data = validateRow(body.data, resource);
    } else {
      if (!Array.isArray(body.data) || body.data.length > 500) fail('source_format');
      body.data = body.data.map(function (row) { return validateRow(row, resource); });
    }
    return body;
  } catch (error) {
    if (error instanceof LedgerlySyncError || error instanceof SnapshotChanged) throw error;
    if (controller.signal.aborted) fail('timeout');
    fail('source_unavailable');
  } finally { clearTimeout(timer); }
}

export async function fetchLedgerlySnapshot(config, options) {
  options = options || {};
  var clock = options.clock || Date.now, now = options.now || new Date();
  var today = now.toISOString().slice(0, 10);
  var context = { fetch: options.fetch || fetch, clock: clock, deadline: clock() + TIME_BUDGET_MS, requests: 0, bytes: 0 };
  for (var attempt = 0; attempt < 3; attempt += 1) {
    var revision = null, baseCurrency = null, datasets = {};
    try {
      for (var resource of config.resources) {
        var period = resource === 'summary' ? { from: today.slice(0, 4) + '-01-01', to: today } : { from: '2000-01-01', to: '2099-12-31' };
        var cursor = null, seenCursors = new Set(), ids = new Set(), rows = [], total = null, generatedAt = null;
        for (var page = 0; page < MAX_PAGES; page += 1) {
          var body = await sourcePage(config, resource, period, cursor, context);
          if (revision === null) { revision = body.revision; baseCurrency = body.currency; }
          if (body.revision !== revision || body.currency !== baseCurrency) throw new SnapshotChanged();
          if (total !== null && body.total !== total) throw new SnapshotChanged();
          total = body.total; generatedAt = body.generatedAt;
          if (resource === 'summary') {
            datasets[resource] = { period: period, generatedAt: generatedAt, total: 1, data: body.data }; break;
          }
          for (var row of body.data) {
            if (ids.has(row.id)) fail('source_format');
            ids.add(row.id); rows.push(row);
          }
          if (rows.length > total || (body.nextCursor !== null && (!body.data.length || rows.length >= total))) fail('source_format');
          cursor = body.nextCursor;
          if (cursor === null) {
            if (rows.length !== total) fail('source_format');
            datasets[resource] = { period: period, generatedAt: generatedAt, total: total, data: rows }; break;
          }
          if (seenCursors.has(cursor)) fail('source_format');
          seenCursors.add(cursor);
        }
        if (!Object.hasOwn(datasets, resource)) fail('capacity');
      }
      var snapshot = { schemaVersion: '1', configId: config.configId, sourceOrigin: config.origin, currency: baseCurrency, revision: revision, fetchedAt: new Date().toISOString(), resources: [...config.resources], datasets: datasets };
      if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) fail('capacity');
      return snapshot;
    } catch (error) {
      if (!(error instanceof SnapshotChanged)) throw error;
      // Discard ALL resources and pages from this attempt, including resources
      // that succeeded before the changed page. Never publish mixed revisions.
    }
  }
  fail('source_not_ready', 409);
}

export async function runLedgerlySync(db, config, options) {
  var runId = (options && options.runId) || randomUUID();
  var claim = await db.rpc('ledgerly_claim_sync', { p_run_id: runId });
  if (claim.error) fail('storage', 503);
  if (claim.data !== true) return { ok: true, skipped: true, reason: 'sync_in_progress' };
  try {
    var snapshot = await fetchLedgerlySnapshot(config, options);
    var saved = await db.rpc('ledgerly_commit_sync', { p_run_id: runId, p_snapshot: snapshot });
    if (saved.error) fail('storage', 503);
    if (saved.data !== true) fail('lease_lost', 409);
    return { ok: true, revision: snapshot.revision, resources: snapshot.resources, syncedAt: snapshot.fetchedAt };
  } catch (error) {
    var safe = safeSyncError(error);
    // This RPC only releases OUR lease. A replaced run can neither overwrite the
    // newer snapshot nor erase the newer run's lease/status.
    try { await db.rpc('ledgerly_fail_sync', { p_run_id: runId, p_error_code: safe.code, p_error: safe.message }); } catch (_) {}
    throw new LedgerlySyncError(safe.code, safe.status);
  }
}

export function cacheResponse(row, config, resource, offset, limit, now) {
  now = now === undefined ? Date.now() : now;
  if (!config.resources.includes(resource)) throw new LedgerlySyncError('configuration', 400);
  if (!int(offset) || offset < 0 || offset > MAX_ROWS || !int(limit) || limit < 1 || limit > 100) throw new LedgerlySyncError('configuration', 400);
  var snapshot = row?.snapshot;
  var usable = !!(snapshot && snapshot.configId === config.configId && snapshot.sourceOrigin === config.origin && Array.isArray(snapshot.resources) && snapshot.resources.join(',') === config.resources.join(',') && snapshot.datasets && snapshot.datasets[resource]);
  var lastSuccess = usable ? row.last_success_at : null;
  var stale = !!(usable && (!lastSuccess || !Number.isFinite(Date.parse(lastSuccess)) || now - Date.parse(lastSuccess) > STALE_AFTER_MS));
  var response = {
    ok: true, configured: true, sourceOrigin: config.origin, resources: config.resources,
    status: { available: usable, state: row?.sync_status || 'waiting', stale: stale, lastAttemptAt: row?.last_attempt_at || null, lastSuccessAt: lastSuccess,
      error: row?.last_error_code && MESSAGES[row.last_error_code] ? MESSAGES[row.last_error_code] : null, intervalMinutes: 15, displayRefreshSeconds: 60 },
    snapshot: null, dataset: null,
  };
  if (!usable) return response;
  var set = snapshot.datasets[resource];
  var data = Array.isArray(set.data) ? set.data.slice(offset, offset + limit) : set.data;
  response.snapshot = { schemaVersion: snapshot.schemaVersion, currency: snapshot.currency, revision: snapshot.revision, fetchedAt: snapshot.fetchedAt };
  response.dataset = { resource: resource, period: set.period, total: set.total, data: data, offset: offset, limit: limit, nextOffset: Array.isArray(set.data) && offset + limit < set.total ? offset + limit : null };
  return response;
}
