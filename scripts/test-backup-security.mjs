import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupHandlers } from '../src/lib/backup-handlers.js';
import { createBusinessBackup } from '../src/lib/backup-snapshot.js';
import { backupDownload, redactBackupData } from '../src/lib/backup-security.js';
import { fetchBackup } from '../src/lib/backup-client.js';

const SUPER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROFILE = '33333333-3333-4333-8333-333333333333';
const BACKUP = '44444444-4444-4444-8444-444444444444';
const SECRET = 'access-production-fixture-credential';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-secret', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER, CRON_SECRET: 'fixture-cron-secret-long-enough' };
const legacyData = {
  bank_connections: [{ id: BACKUP, institution_name: 'Fixture Bank', access_token: SECRET, refreshToken: 'private-refresh-value', provider_blob: { key: 'must-not-export' }, status: 'active' }],
  egypt_bank_accounts: [{ id: BACKUP, name: 'Operations', current_balance: 25000.75 }],
  invoices: [{ id: BACKUP, amount: 120, customer_name: 'Customer', status: 'unpaid' }],
  app_settings: [{ key: 'office_hours', value: '9–5' }, { setting_key: 'PROVIDER_API_KEY', setting_value: 'private-setting-value' }],
  audit_log: [{ new_values: { access_token: SECRET, balance: 42 }, detail: 'Provider rejected ' + SECRET }],
  users: [{ id: SUPER, name: 'Super', password_hash: 'private-password-value' }],
  bank_items: [{ id: BACKUP, access_token_encrypted: 'private-ciphertext-value' }],
};

function fixture(options = {}) {
  const calls = [], mutations = [], snapshots = [];
  const configured = { ...env, ...options.env };
  const actor = { id: options.staff ? STAFF : SUPER, role: 'super_admin', user_metadata: { role: 'super_admin' }, ...options.actor };
  const backupRow = { id: BACKUP, kind: 'manual', created_at: '2026-10-24T00:00:00Z', notes: 'Old error ' + SECRET, data: structuredClone(legacyData), ...options.backupRow };
  function builder(table) {
    let operation = 'select', payload, columns;
    const chain = {
      select(value) { columns = value; calls.push(['select', table, value]); return chain; },
      eq() { return chain; }, order() { return chain; }, limit() { return chain; }, lt() { return chain; }, in() { return chain; },
      insert(value) { operation = 'insert'; payload = value; mutations.push([table, operation, value]); return chain; },
      update(value) { operation = 'update'; payload = value; mutations.push([table, operation, value]); return chain; },
      delete() { operation = 'delete'; mutations.push([table, operation]); return chain; },
      async maybeSingle() {
        if (options.storageError && table === 'backups') return { error: new Error('Provider rejected ' + SECRET) };
        if (table === 'financial_visibility_permissions') return { data: { can_view_bank_balances: !!options.balanceGrant, can_view_dashboard: !!options.dashboardGrant }, error: null };
        if (operation === 'insert') return { data: { id: BACKUP, created_at: backupRow.created_at, ...payload }, error: null };
        if (operation === 'delete') return { data: { id: BACKUP }, error: null };
        if (operation === 'update') return { data: { id: BACKUP, ...payload }, error: null };
        return { data: options.notFound ? null : backupRow, error: null };
      },
      then(resolve, reject) {
        let data;
        if (table === 'backups') data = options.realSnapshot ? [] : [{ id: BACKUP, notes: backupRow.notes, size_bytes: 123 }];
        else data = structuredClone(legacyData[table] || []);
        return Promise.resolve({ data, error: options.storageError && table === 'backups' ? new Error(SECRET) : null }).then(resolve, reject);
      },
    };
    return chain;
  }
  const service = { from(table) { calls.push(['table', table]); return builder(table); },
    async rpc(name, args) { calls.push(['rpc', name, args]); return { data: options.noProfile ? [] : [{ profile_id: PROFILE }], error: options.profileError ? new Error('missing migration') : null }; } };
  function createClient(url, key, settings) {
    calls.push(['client', key]);
    assert.equal(settings.auth.persistSession, false);
    if (key === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { auth: { async getUser(token) {
      calls.push(['verify', token]);
      return options.invalid ? { data: { user: null }, error: new Error('invalid') } : { data: { user: actor }, error: null };
    } } };
    assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY);
    return service;
  }
  const worker = options.realSnapshot ? undefined : async (db, opts) => { assert.equal(db, service); snapshots.push(opts); return { ok: true, backup_id: BACKUP, kind: opts.kind }; };
  return { calls, mutations, snapshots, service, backupRow, handlers: createBackupHandlers(createClient, configured, worker) };
}
function request(path, method = 'GET', body, headers = {}) {
  const allHeaders = { Authorization: 'Bearer verified-user-session', ...(method !== 'GET' ? { Origin: 'https://hub.example', 'Content-Type': 'application/json' } : {}), ...headers };
  for (const key of Object.keys(allHeaders)) if (allHeaders[key] === null) delete allHeaders[key];
  return new Request('https://hub.example/api/backup/' + path, { method, headers: allHeaders,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
const interactive = [
  ['list', 'list', 'GET'], ['download', 'download?id=' + BACKUP, 'GET'],
  ['manage', 'manage', 'POST', { id: BACKUP, pinned: true }], ['remove', 'manage?id=' + BACKUP, 'DELETE'],
  ['manualSnapshot', 'snapshot', 'POST', { kind: 'manual' }],
];
function noBackupAccess(m) {
  assert.equal(m.calls.some(call => call[0] === 'table' && call[1] === 'backups'), false);
  assert.equal(m.snapshots.length, 0); assert.equal(m.mutations.length, 0);
}

test('every interactive backup operation rejects absent sessions before service access', async () => {
  for (const [handler, path, method, body] of interactive) {
    const m = fixture();
    const response = await m.handlers[handler](request(path, method, body, { Authorization: null }));
    assert.equal(response.status, 401); noBackupAccess(m);
    assert.equal(m.calls.some(call => call[0] === 'client'), false);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('legacy super role, claimed actor and both special visibility grants cannot authorize backups', async () => {
  for (const [handler, path, method, body] of interactive) {
    const m = fixture({ staff: true, balanceGrant: true, dashboardGrant: true });
    const response = await m.handlers[handler](request(path, method, body === undefined ? undefined : { ...body, triggered_by: SUPER, role: 'super_admin' }));
    assert.equal(response.status, 403); noBackupAccess(m);
  }
});

test('invalid, anonymous, inactive and ambiguously mapped identities fail closed', async () => {
  for (const options of [{ invalid: true }, { actor: { is_anonymous: true } }, { actor: { banned_until: '2099-01-01T00:00:00Z' } }, { noProfile: true }, { profileError: true }]) {
    const m = fixture(options);
    const response = await m.handlers.download(request('download?id=' + BACKUP));
    assert.ok([401, 403, 503].includes(response.status)); noBackupAccess(m);
  }
});

test('missing or malformed super-admin configuration and missing service key fail closed', async () => {
  for (const overrides of [{ HUB_SUPER_ADMIN_AUTH_USER_IDS: '' }, { HUB_SUPER_ADMIN_AUTH_USER_IDS: 'super_admin' }, { HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER + ',' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    const m = fixture({ env: overrides });
    const response = await m.handlers.list(request('list'));
    assert.equal(response.status, 503); noBackupAccess(m);
  }
});

test('cron bearer authorizes scheduled snapshots only, never interactive access', async () => {
  for (const [handler, path, method, body] of interactive) {
    const m = fixture();
    const response = await m.handlers[handler](request(path, method, body, { Authorization: 'Bearer ' + env.CRON_SECRET }));
    assert.equal(response.status, 401); noBackupAccess(m); assert.equal(m.calls.length, 0);
  }
  const m = fixture();
  const response = await m.handlers.scheduledSnapshot(request('snapshot?kind=daily', 'GET', undefined, { Authorization: 'Bearer ' + env.CRON_SECRET }));
  assert.equal(response.status, 200);
  assert.deepEqual(m.snapshots, [{ kind: 'daily', triggered_by: null, triggered_by_name: 'Scheduled backup' }]);
  assert.equal(m.calls.some(call => call[0] === 'verify'), false);
});

test('scheduled snapshot rejects weak, wrong or browser-origin scheduler credentials', async () => {
  for (const options of [{ env: { CRON_SECRET: '' }, status: 503 }, { env: { CRON_SECRET: 'short' }, status: 503 }, { header: 'Bearer wrong-secret', status: 401 }, { origin: 'https://hub.example', status: 401 }]) {
    const m = fixture({ env: options.env });
    const response = await m.handlers.scheduledSnapshot(request('snapshot', 'GET', undefined, { Authorization: options.header || 'Bearer ' + env.CRON_SECRET, Origin: options.origin || null }));
    assert.equal(response.status, options.status); noBackupAccess(m); assert.equal(m.calls.length, 0);
  }
});

test('verified super admin can list and download historical backups without provider credentials', async () => {
  const m = fixture();
  const before = structuredClone(m.backupRow);
  const list = await m.handlers.list(request('list'));
  assert.equal(list.status, 200); assert.equal((await list.text()).includes(SECRET), false);
  const download = await m.handlers.download(request('download?id=' + BACKUP));
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.match(download.headers.get('cache-control'), /no-store/);
  const file = await download.json();
  assert.equal(JSON.stringify(file).includes(SECRET), false);
  assert.equal(file.data.egypt_bank_accounts[0].current_balance, 25000.75);
  assert.equal(file.data.invoices[0].amount, 120);
  assert.equal(file.data.bank_connections[0].institution_name, 'Fixture Bank');
  assert.equal(Object.hasOwn(file.data.bank_connections[0], 'access_token'), false);
  assert.equal(Object.hasOwn(file.data, 'bank_items'), false);
  assert.equal(file.security.credentials_excluded, true);
  assert.match(file.security.restore_policy, /Preserve existing server credentials/);
  assert.deepEqual(m.backupRow, before, 'Sanitizing a download must not modify the stored backup or live source');
});

test('redaction handles nested credentials, secret settings, aliases and environment secrets without wiping rows', () => {
  const before = structuredClone(legacyData);
  const file = backupDownload({ id: BACKUP, data: legacyData, notes: env.SUPABASE_SERVICE_ROLE_KEY }, env);
  const encoded = JSON.stringify(file);
  for (const secret of [SECRET, 'private-refresh-value', 'private-setting-value', 'private-password-value', 'private-ciphertext-value', 'must-not-export', env.SUPABASE_SERVICE_ROLE_KEY]) assert.equal(encoded.includes(secret), false, secret);
  assert.deepEqual(file.data.app_settings, [{ key: 'office_hours', value: '9–5' }]);
  assert.equal(file.row_counts.app_settings, 1);
  assert.deepEqual(file.data.audit_log[0].new_values, { balance: 42 });
  assert.deepEqual(legacyData, before);
  assert.throws(() => redactBackupData({ bank_connections: {} }, env), /valid table snapshot/);
});

test('new persisted snapshots exclude secrets and never mutate live credential tables', async () => {
  const m = fixture({ realSnapshot: true });
  const response = await m.handlers.manualSnapshot(request('snapshot', 'POST', { kind: 'manual', triggered_by: STAFF }));
  assert.equal(response.status, 200);
  const inserted = m.mutations.find(call => call[0] === 'backups' && call[1] === 'insert')[2];
  assert.equal(inserted.triggered_by, PROFILE);
  assert.equal(JSON.stringify(inserted).includes(SECRET), false);
  assert.equal(Object.hasOwn(inserted.data.bank_connections[0], 'access_token'), false);
  assert.equal(inserted.data.egypt_bank_accounts[0].current_balance, 25000.75);
  assert.equal(inserted.data.invoices[0].amount, 120);
  assert.ok(m.mutations.every(call => call[0] === 'backups'));
  assert.match(inserted.notes, /preserve live server credentials/);
});

test('manual snapshots use verified actor identity and cannot masquerade as a scheduled kind', async () => {
  const m = fixture();
  const result = await m.handlers.manualSnapshot(request('snapshot', 'POST', { kind: 'manual', triggered_by: STAFF, triggered_by_name: 'Forged actor', notes: 'Useful note' }));
  assert.equal(result.status, 200);
  assert.deepEqual(m.snapshots[0], { kind: 'manual', triggered_by: PROFILE, triggered_by_name: 'Verified super admin', notes: 'Useful note', pinned: false });
  const denied = await m.handlers.manualSnapshot(request('snapshot', 'POST', { kind: 'daily' }));
  assert.equal(denied.status, 400); assert.equal(m.snapshots.length, 1);
});

test('cross-site, malformed and oversized mutations never reach backup storage', async () => {
  for (const [body, headers, status] of [[{ id: BACKUP, pinned: true }, { Origin: 'https://evil.example' }, 403], [{ id: BACKUP, pinned: true }, { Origin: null }, 403], [{ id: BACKUP, pinned: true }, { 'Content-Type': 'text/plain' }, 415], ['invalid json', {}, 400], [{ id: BACKUP, pinned: 'yes' }, {}, 400], [{ id: BACKUP, notes: 'x'.repeat(2001) }, {}, 400], [' '.repeat(16385), {}, 413]]) {
    const m = fixture();
    const response = await m.handlers.manage(request('manage', 'POST', body, headers));
    assert.equal(response.status, status); noBackupAccess(m);
  }
});

test('raw storage errors and provider credentials are not returned to the browser', async () => {
  const m = fixture({ storageError: true });
  const response = await m.handlers.download(request('download?id=' + BACKUP));
  assert.equal(response.status, 500); assert.equal((await response.text()).includes(SECRET), false);
});

test('browser helper authenticates downloads and all actions without URL tokens or redirects', async () => {
  const previous = globalThis.fetch, observed = [];
  globalThis.fetch = async (url, options) => { observed.push({ url, options }); return Response.json({ ok: true }); };
  try {
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'actual-session-token' } } }) } };
    for (const [, path, method] of interactive) await fetchBackup(client, '/api/backup/' + path, { method, headers: { Authorization: 'Bearer forged' } });
    assert.equal(observed.length, 5);
    for (const call of observed) {
      assert.equal(call.options.headers.get('Authorization'), 'Bearer actual-session-token');
      assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.redirect, 'error');
      assert.equal(call.url.includes('token'), false);
      if (call.options.method !== 'GET') assert.equal(call.options.headers.get('Content-Type'), 'application/json');
    }
    await assert.rejects(fetchBackup(client, 'https://evil.example/api/backup/list'), /endpoint/);
    await assert.rejects(fetchBackup(client, '/api/backup/list/elsewhere'), /endpoint/);
    await assert.rejects(fetchBackup({ auth: { getSession: async () => ({ data: { session: null } }) } }, '/api/backup/list'), /Sign in/);
    assert.equal(observed.length, 5);
  } finally { globalThis.fetch = previous; }
});
