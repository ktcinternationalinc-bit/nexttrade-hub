import { createHash, timingSafeEqual } from 'node:crypto';
import { authorizeBankVisibility, BankVisibilityError } from './bank-visibility.js';

var HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' };
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
var CONNECTION_FIELDS = ['id', 'plaid_item_id', 'institution_id', 'institution_name', 'status', 'last_synced', 'created_at', 'wave_business_id', 'last_sync_status', 'last_sync_error', 'initial_backfill_start_date', 'last_successful_posted_date', 'last_successful_plaid_sync_at', 'transactions_cursor'];

export class BackupError extends Error {
  constructor(message, status) { super(message); this.name = 'BackupError'; this.status = status; }
}
function reject(message, status) { throw new BackupError(message, status); }
function digest(value) { return createHash('sha256').update(value).digest(); }

export function backupJson(body, status, extraHeaders) {
  return Response.json(body, { status: status || 200, headers: Object.assign({}, HEADERS, extraHeaders) });
}
export function backupErrorResponse(error) {
  var known = error instanceof BackupError || error instanceof BankVisibilityError;
  return backupJson({ ok: false, error: known ? error.message : 'The backup request could not be completed. Refresh before retrying.' }, known ? error.status : 500);
}
function cronMatches(request, env) {
  var secret = env.CRON_SECRET || '';
  var header = request.headers.get('authorization') || '';
  return secret.length >= 16 && secret.length <= 8192 && !/[\r\n]/.test(secret) && header.length <= 8200 && timingSafeEqual(digest(header), digest('Bearer ' + secret));
}

export async function authorizeBackupAdmin(request, createClient, env) {
  // A scheduler credential is never an interactive download/manage credential.
  if (cronMatches(request, env)) reject('Sign in as an approved super admin to use backups.', 401);
  var access = await authorizeBankVisibility(request, createClient, env);
  if (access.isVerifiedSuperAdmin !== true) reject('Only a verified super admin can access business backups.', 403);
  return access;
}
export function authorizeBackupCron(request, createClient, env) {
  var secret = env.CRON_SECRET || '';
  if (secret.length < 16 || secret.length > 8192 || /[\r\n]/.test(secret)) reject('Scheduled backups need a strong server CRON_SECRET.', 503);
  if (request.method !== 'GET' || request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site' || !cronMatches(request, env))
    reject('This snapshot endpoint requires the configured scheduler credential.', 401);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) reject('Scheduled backups need the server database configuration.', 503);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, OPTIONS);
}
export function backupId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) reject('A valid backup ID is required.', 400);
  return value;
}
export function backupQuery(request, allowed) {
  var url = new URL(request.url);
  for (var key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) reject('Invalid backup query.', 400);
  return url.searchParams;
}
export async function readBackupJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) reject('Send backup changes as JSON.', 415);
  if (Number(request.headers.get('content-length') || 0) > 16384) reject('The backup request is too large.', 413);
  var text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16384) reject('The backup request is too large.', 413);
  try {
    var body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch (_) { reject('Provide a JSON object for this backup change.', 400); }
}
export function backupNotes(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 2000) reject('Backup notes must contain no more than 2,000 characters.', 400);
  return value;
}

function secretKey(key) {
  var name = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /token|secret|password|credential|apikey|privatekey|authorization|service(role)?key|cookie/.test(name);
}
function credentialTable(key) {
  return /(?:^|_)(?:tokens?|credentials?|secrets?|sessions?)(?:_|$)/i.test(key) || ['integration_keys', 'bank_items', 'bank_link_sessions'].includes(key);
}
function settingsSecret(row) {
  return row && typeof row === 'object' && ['key', 'setting_key'].some(function (key) { return typeof row[key] === 'string' && secretKey(row[key]); });
}
function collectSecrets(value, found, depth) {
  if (depth > 50) reject('The backup is too deeply nested to download safely.', 422);
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function (key) {
    var child = value[key];
    if (secretKey(key) && typeof child === 'string' && child.length >= 8) found.add(child);
    if (settingsSecret(value) && ['value', 'setting_value'].includes(key) && typeof child === 'string' && child.length >= 8) found.add(child);
    collectSecrets(child, found, depth + 1);
  });
}
function scrubText(text, secrets) {
  secrets.forEach(function (secret) { if (text.includes(secret)) text = text.split(secret).join('[redacted]'); });
  return text
    .replace(/\baccess-(?:sandbox|development|production)-[a-z0-9-]+/gi, '[redacted]')
    .replace(/\bBearer\s+[a-z0-9._~+\/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\beyJ[a-z0-9_=-]{10,}\.[a-z0-9_=-]{10,}\.[a-z0-9_.+\/-]{10,}/gi, '[redacted]')
    .replace(/\bldg_[a-f0-9]{64}\b/gi, '[redacted]')
    .replace(/\bsk-(?:ant-|proj-)?[a-z0-9_-]{16,}/gi, '[redacted]');
}
function scrubValue(value, secrets, depth) {
  if (depth > 50) reject('The backup is too deeply nested to download safely.', 422);
  if (typeof value === 'string') return scrubText(value, secrets);
  if (Array.isArray(value)) return value.map(function (entry) { return scrubValue(entry, secrets, depth + 1); });
  if (!value || typeof value !== 'object') return value;
  var safe = {};
  Object.keys(value).forEach(function (key) {
    if (!secretKey(key) && !['__proto__', 'prototype', 'constructor'].includes(key)) safe[key] = scrubValue(value[key], secrets, depth + 1);
  });
  return safe;
}

// New snapshots and old downloads share this exact projection. Never write
// null/empty placeholders for omitted credentials: a future restore must merge
// business metadata while preserving the live credential columns and stores.
export function redactBackupData(data, env) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) reject('This backup does not contain a valid table snapshot.', 422);
  var secrets = new Set();
  collectSecrets(data, secrets, 0);
  Object.keys(env || {}).forEach(function (key) { var value = env[key]; if (/key|token|secret|password|credential/i.test(key) && typeof value === 'string' && value.length >= 8) secrets.add(value); });
  var safe = {};
  Object.keys(data).forEach(function (table) {
    if (credentialTable(table) || ['__proto__', 'prototype', 'constructor'].includes(table)) return;
    if (!Array.isArray(data[table])) reject('This backup does not contain a valid table snapshot.', 422);
    var rows = data[table].filter(function (row) { return table !== 'app_settings' || !settingsSecret(row); });
    if (table === 'bank_connections') rows = rows.map(function (row) {
      var metadata = {};
      CONNECTION_FIELDS.forEach(function (key) { if (row && Object.hasOwn(row, key)) metadata[key] = row[key]; });
      return metadata;
    });
    safe[table] = scrubValue(rows, secrets, 0);
  });
  return { data: safe, scrub: function (value) { return scrubValue(value, secrets, 0); } };
}

export function backupDownload(row, env) {
  var redacted = redactBackupData(row.data, env), data = redacted.data;
  var counts = {};
  Object.keys(data).forEach(function (table) { counts[table] = data[table].length; });
  var metadata = redacted.scrub({ backup_id: row.id, created_at: row.created_at, kind: row.kind, triggered_by: row.triggered_by,
    triggered_by_name: row.triggered_by_name, duration_ms: row.duration_ms, notes: row.notes });
  return Object.assign({ version: 'v55.74' }, metadata, {
    tables_included: Object.keys(data), row_counts: counts, size_bytes: Buffer.byteLength(JSON.stringify(data), 'utf8'), data: data,
    security: { credentials_excluded: true, restore_policy: 'Merge business metadata only. Preserve existing server credentials and credential tables; do not truncate or overwrite them with this export. Reconnect providers if credentials are unavailable.' },
  });
}
