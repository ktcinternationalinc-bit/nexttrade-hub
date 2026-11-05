import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the server core as ESM without changing this existing CommonJS project's
// package type. It uses only Node built-ins; all network/DB calls are injected.
const loadModule = async (relative) => {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
};
const sync = await loadModule('../src/lib/ledgerly-sync.js');
const auth = await import('../src/lib/ledgerly-auth.js');
const { readLedgerlyConfig, verifyCronRequest, fetchLedgerlySnapshot, runLedgerlySync, cacheResponse, RESOURCE_FIELDS, LedgerlySyncError, safeSyncError } = sync;
const { authorizeLedgerlyViewer } = auth;
const ENV = {
  LEDGERLY_READ_KEY: 'ldg_' + 'a'.repeat(64),
  LEDGERLY_SITE_ACCESS_TOKEN: 'fake-site-service-token-for-offline-tests',
  CRON_SECRET: 'fake-cron-secret-for-offline-tests',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
  HUB_SUPER_ADMIN_AUTH_USER_IDS: '00000000-0000-4000-8000-000000000001',
};
const configFor = resources => readLedgerlyConfig({ ...ENV, LEDGERLY_RESOURCES: resources });
const fixedNow = new Date('2026-10-24T12:00:00Z');
const code = expected => error => error instanceof LedgerlySyncError && error.code === expected;
function rowFor(resource, id = 'row-1') {
  const row = Object.fromEntries(RESOURCE_FIELDS[resource].map(key => [key, null]));
  if (resource === 'summary') {
    for (const key of RESOURCE_FIELDS.summary) row[key] = key === 'balanced' ? true : 0;
    return { ...row, revenueCents: 20000, netProfitCents: 12000, cashCents: 150000 };
  }
  Object.assign(row, { id });
  if (resource === 'invoices') Object.assign(row, { number: 'INV-1001', contactId: 'customer', contactName: 'Customer', date: '2026-10-20', dueDate: '2026-10-30', memo: '', lines: [{ description: 'Service', quantity: 1, unitPriceCents: 10000, taxable: false }], taxRateBps: 0, taxLabel: 'Sales tax', subtotalCents: 10000, taxCents: 0, totalCents: 10000, paidCents: 0, outstandingCents: 10000, status: 'open' });
  if (resource === 'bank-accounts') Object.assign(row, { connectionId: 'connection', institutionName: 'Example Bank', name: 'Checking', mask: '1234', subtype: 'checking', currency: 'USD', currentBalanceCents: 20000, availableBalanceCents: null, ledgerAccountId: '1000', lastSyncedAt: fixedNow.toISOString(), active: true, environment: 'production', connectionStatus: 'connected' });
  if (resource === 'bank-transactions') Object.assign(row, { connectionId: 'connection', institutionName: 'Example Bank', accountId: 'account', accountName: 'Checking', accountMask: '1234', ledgerAccountId: '1000', date: '2026-10-21', description: 'Supplies', amountCents: -2500, currency: 'USD', pending: false, removed: false, status: 'review', journalId: null, changedSinceReview: false, environment: 'production', connectionStatus: 'connected', lastSyncedAt: fixedNow.toISOString() });
  return row;
}
function envelope(url, data, revision = 7, total, nextCursor = null) {
  const u = new URL(url), resource = u.pathname.split('/').at(-1);
  return { schemaVersion: '1', resource, revision, currency: 'USD', generatedAt: fixedNow.toISOString(), period: { from: u.searchParams.get('from'), to: u.searchParams.get('to') }, data, total: total ?? (Array.isArray(data) ? data.length : 1), nextCursor };
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const simpleFetch = async url => {
  const resource = new URL(url).pathname.split('/').at(-1);
  return json(envelope(url, resource === 'summary' ? rowFor(resource) : [rowFor(resource)]));
};

test('configuration pins HTTPS origin, validates secrets and allows only known selected resources', () => {
  const config = readLedgerlyConfig(ENV);
  assert.deepEqual(config.resources, ['summary', 'invoices', 'bank-accounts', 'bank-transactions']);
  assert.equal(config.origin, sync.LEDGERLY_ORIGIN);
  assert.match(config.configId, /^[a-f0-9]{64}$/);
  for (const base of ['http://ledger.example', 'https://localhost', 'https://127.0.0.1', 'https://evil.example', sync.LEDGERLY_ORIGIN + '/other', sync.LEDGERLY_ORIGIN + '/?token=x']) {
    assert.throws(() => readLedgerlyConfig({ ...ENV, LEDGERLY_BASE_URL: base }), code('configuration'));
  }
  assert.throws(() => readLedgerlyConfig({ ...ENV, LEDGERLY_RESOURCES: 'summary,write' }), code('configuration'));
  assert.throws(() => readLedgerlyConfig({ ...ENV, LEDGERLY_RESOURCES: '' }), code('configuration'));
  assert.throws(() => readLedgerlyConfig({ ...ENV, LEDGERLY_SITE_ACCESS_TOKEN: 'secret\r\nheader' }), code('configuration'));
  assert.deepEqual(configFor('bank-transactions,summary,summary').resources, ['summary', 'bank-transactions']);
  assert.equal(readLedgerlyConfig({ ...ENV, LEDGERLY_BASE_URL: 'https://custom.example', LEDGERLY_ALLOWED_ORIGIN: 'https://custom.example' }).origin, 'https://custom.example');
  assert.notEqual(config.configId, readLedgerlyConfig({ ...ENV, LEDGERLY_READ_KEY: 'ldg_' + 'b'.repeat(64) }).configId);
});

test('scheduler authentication fails closed when missing, weak or wrong, and accepts exact bearer only', () => {
  const request = value => new Request('https://hub.example/api/ledgerly/sync', { headers: value ? { Authorization: value } : {} });
  assert.throws(() => verifyCronRequest(request(), {}), code('cron_configuration'));
  assert.throws(() => verifyCronRequest(request('Bearer weak'), { CRON_SECRET: 'weak' }), code('cron_configuration'));
  assert.throws(() => verifyCronRequest(request(), ENV), code('unauthorized'));
  assert.throws(() => verifyCronRequest(request('Bearer wrong'), ENV), code('unauthorized'));
  assert.throws(() => verifyCronRequest(request('Basic ' + ENV.CRON_SECRET), ENV), code('unauthorized'));
  assert.doesNotThrow(() => verifyCronRequest(request('Bearer ' + ENV.CRON_SECRET), ENV));
});

test('complete paginated pulls use both private headers, fixed-origin GETs, and project away unknown fields', async () => {
  const calls = [], config = configFor('invoices');
  const snapshot = await fetchLedgerlySnapshot(config, { now: fixedNow, fetch: async (url, options) => {
    calls.push([new URL(url), options]);
    const second = new URL(url).searchParams.has('cursor');
    const rows = second ? [rowFor('invoices', '501')] : Array.from({ length: 500 }, (_, i) => ({ ...rowFor('invoices', String(i)), rawProviderSecret: 'never-cache-me' }));
    return json(envelope(url, rows, 8, 501, second ? null : 'cursor-one'));
  } });
  assert.equal(snapshot.datasets.invoices.data.length, 501);
  assert.equal(new Set(snapshot.datasets.invoices.data.map(row => row.id)).size, 501);
  assert.equal(calls.length, 2);
  for (const [url, options] of calls) {
    assert.equal(url.origin, config.origin); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + ENV.LEDGERLY_READ_KEY);
    assert.equal(options.headers['OAI-Sites-Authorization'], 'Bearer ' + ENV.LEDGERLY_SITE_ACCESS_TOKEN);
    assert.equal(url.searchParams.get('limit'), '500');
  }
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes('never-cache-me'), false); assert.equal(encoded.includes(ENV.LEDGERLY_READ_KEY), false); assert.equal(encoded.includes(ENV.LEDGERLY_SITE_ACCESS_TOKEN), false);
});

test('a changed resource revision discards and re-fetches the entire multi-resource snapshot', async () => {
  const calls = [];
  const snapshot = await fetchLedgerlySnapshot(configFor('summary,invoices'), { now: fixedNow, fetch: async url => {
    const resource = new URL(url).pathname.split('/').at(-1); calls.push(resource);
    const revision = calls.length === 1 ? 10 : 11;
    return json(envelope(url, resource === 'summary' ? rowFor(resource) : [rowFor(resource)], revision));
  } });
  assert.deepEqual(calls, ['summary', 'invoices', 'summary', 'invoices']);
  assert.equal(snapshot.revision, 11);
  assert.equal(snapshot.datasets.summary.period.from, '2026-01-01');
  assert.equal(snapshot.datasets.summary.period.to, '2026-10-24');
  assert.equal(snapshot.datasets.invoices.period.to, '2099-12-31');
});

test('a page conflict restarts earlier datasets as well, without appending stale rows', async () => {
  const calls = [];
  const snapshot = await fetchLedgerlySnapshot(configFor('summary,invoices'), { now: fixedNow, fetch: async url => {
    const u = new URL(url), resource = u.pathname.split('/').at(-1); calls.push(resource + (u.searchParams.has('cursor') ? ':page2' : ''));
    if (calls.length === 3) return new Response('', { status: 409 });
    if (calls.length === 2) return json(envelope(url, [rowFor('invoices', 'old-row')], 7, 2, 'next-page'));
    return json(envelope(url, resource === 'summary' ? rowFor(resource) : [rowFor(resource, 'new-row')], calls.length < 3 ? 7 : 8));
  } });
  assert.deepEqual(calls, ['summary', 'invoices', 'invoices:page2', 'summary', 'invoices']);
  assert.deepEqual(snapshot.datasets.invoices.data.map(row => row.id), ['new-row']);
});

test('redirects, sign-in HTML, missing scopes and malformed amounts cannot produce a snapshot', async () => {
  const config = configFor('summary');
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }) }), code('source_format'));
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async () => new Response('secret upstream details', { status: 403 }) }), code('source_access'));
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async url => {
    const response = json(envelope(url, rowFor('summary'))); Object.defineProperty(response, 'url', { value: 'https://other.example/data' }); return response;
  } }), code('source_format'));
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async url => json(envelope(url, { ...rowFor('summary'), revenueCents: 12.34 })) }), code('source_format'));
  assert.equal(safeSyncError(new Error(ENV.LEDGERLY_SITE_ACCESS_TOKEN)).message.includes(ENV.LEDGERLY_SITE_ACCESS_TOKEN), false);
});

test('bank snapshots retain currencies, null balances, signed amounts and sandbox labels', async () => {
  const snapshot = await fetchLedgerlySnapshot(configFor('bank-accounts,bank-transactions'), { fetch: async url => {
    const resource = new URL(url).pathname.split('/').at(-1);
    return json(envelope(url, [{ ...rowFor(resource), currency: 'CAD', environment: 'sandbox' }]));
  } });
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.datasets['bank-accounts'].data[0].currency, 'CAD');
  assert.equal(snapshot.datasets['bank-accounts'].data[0].availableBalanceCents, null);
  assert.equal(snapshot.datasets['bank-transactions'].data[0].amountCents, -2500);
  assert.equal(snapshot.datasets['bank-transactions'].data[0].environment, 'sandbox');
});

test('duplicate rows, inconsistent totals, excessive bytes and repeated conflicts fail with bounded work', async () => {
  const config = configFor('invoices');
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async url => json(envelope(url, [rowFor('invoices'), rowFor('invoices')])) }), code('source_format'));
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async url => json(envelope(url, [rowFor('invoices')], 1, 2, null)) }), code('source_format'));
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '3000000' } }) }), code('capacity'));
  let calls = 0;
  await assert.rejects(fetchLedgerlySnapshot(config, { fetch: async () => { calls++; return new Response('', { status: 409 }); } }), code('source_not_ready'));
  assert.equal(calls, 3);
});

test('a held sync lease skips upstream traffic; failed pull cannot commit or erase the previous snapshot', async () => {
  let calls = [], fetched = 0;
  const skipped = await runLedgerlySync({ rpc: async (name, input) => { calls.push([name, input]); return { data: false, error: null }; } }, configFor('summary'), { fetch: async () => { fetched++; } });
  assert.equal(skipped.skipped, true); assert.equal(fetched, 0); assert.equal(calls.length, 1);
  calls = [];
  const db = { rpc: async (name, input) => { calls.push([name, input]); return { data: true, error: null }; } };
  await assert.rejects(runLedgerlySync(db, configFor('summary'), { runId: 'test-run', fetch: async () => new Response('', { status: 500 }) }), code('source_unavailable'));
  assert.deepEqual(calls.map(call => call[0]), ['ledgerly_claim_sync', 'ledgerly_fail_sync']);
  assert.equal(calls[1][1].p_run_id, 'test-run');
  assert.equal(JSON.stringify(calls).includes(ENV.LEDGERLY_READ_KEY), false);
});

test('successful snapshots commit once, and a superseded run cannot report success', async () => {
  let calls = [];
  const db = { rpc: async (name, input) => { calls.push([name, input]); return { data: true, error: null }; } };
  const result = await runLedgerlySync(db, configFor('summary'), { runId: 'test-run', fetch: simpleFetch });
  assert.equal(result.ok, true); assert.equal(result.revision, 7);
  assert.deepEqual(calls.map(call => call[0]), ['ledgerly_claim_sync', 'ledgerly_commit_sync']);
  assert.equal(calls[1][1].p_run_id, 'test-run'); assert.ok(calls[1][1].p_snapshot.datasets.summary);
  calls = [];
  const replaced = { rpc: async (name, input) => { calls.push([name, input]); return { data: name !== 'ledgerly_commit_sync', error: null }; } };
  await assert.rejects(runLedgerlySync(replaced, configFor('summary'), { runId: 'older-run', fetch: simpleFetch }), code('lease_lost'));
  assert.equal(calls.at(-1)[1].p_run_id, 'older-run');
});

test('cache reads preserve stale snapshots and hide previous credentials/source selections after reconfiguration', async () => {
  const config = configFor('summary,invoices'), snapshot = await fetchLedgerlySnapshot(config, { fetch: simpleFetch });
  const row = { snapshot, sync_status: 'error', last_success_at: '2026-10-24T10:00:00Z', last_attempt_at: '2026-10-24T11:59:00Z', last_error_code: 'source_access' };
  const response = cacheResponse(row, config, 'invoices', 0, 50, fixedNow.getTime());
  assert.equal(response.status.available, true); assert.equal(response.status.stale, true); assert.equal(response.dataset.data.length, 1);
  assert.equal('configId' in response.snapshot, false); assert.equal(JSON.stringify(response).includes(config.configId), false);
  const changed = readLedgerlyConfig({ ...ENV, LEDGERLY_RESOURCES: 'summary,invoices', LEDGERLY_READ_KEY: 'ldg_' + 'b'.repeat(64) });
  const hidden = cacheResponse(row, changed, 'invoices', 0, 50, fixedNow.getTime());
  assert.equal(hidden.status.available, false); assert.equal(hidden.snapshot, null); assert.equal(hidden.dataset, null); assert.equal(hidden.status.lastSuccessAt, null);
});

const OWNER = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000002';
const PROFILE = '00000000-0000-4000-8000-000000000003';
function authFactory(options = {}) {
  const calls = [];
  const user = options.user || { id: OWNER, email: 'Owner@Example.com', email_confirmed_at: fixedNow.toISOString() };
  const profiles = options.profiles === undefined ? [{ profile_id: PROFILE, auth_user_id: user.id }] : options.profiles;
  const admin = {
    rpc: async (name, input) => { calls.push([name, input]); return { data: profiles, error: options.profileError || null }; },
    from: table => ({ select: () => ({ eq: () => {
      calls.push(['read', table]);
      if (table === 'module_permissions') return Promise.resolve({ data: options.permissions || [], error: null });
      return { maybeSingle: async () => ({ data: options.grants || null, error: options.grantError || null }) };
    } }) }),
  };
  const createClient = (url, key) => key === ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? { auth: { getUser: async token => { calls.push(['auth', token]); return options.invalid ? { error: new Error('invalid') } : { data: { user }, error: null }; } } }
    : admin;
  return { createClient, calls };
}
const viewerRequest = (token = 'verified-jwt') => new Request('https://hub.example/api/ledgerly/data', { headers: { Authorization: 'Bearer ' + token } });

test('shared-source reads verify the actual session; a configured super admin has both financial permissions', async () => {
  const f = authFactory();
  const result = await authorizeLedgerlyViewer(viewerRequest(), f.createClient, ENV);
  assert.equal(result.profileId, PROFILE);
  assert.equal(result.authUserId, OWNER);
  assert.equal(result.canViewFullDashboard, true);
  assert.equal(result.canViewBankBalances, true);
  assert.deepEqual(f.calls[1], ['bank_visibility_profile_for_identity', { p_auth_user_id: OWNER }]);
  const invalid = authFactory({ invalid: true });
  await assert.rejects(authorizeLedgerlyViewer(viewerRequest('forged-jwt'), invalid.createClient, ENV), error => error.status === 401);
  assert.deepEqual(invalid.calls, [['auth', 'forged-jwt']]);
  await assert.rejects(authorizeLedgerlyViewer(new Request('https://hub.example/api/ledgerly/data?user_id=' + OWNER), f.createClient, ENV), error => error.status === 401);
});

test('missing or ambiguous active identity mappings never reach financial data', async () => {
  for (const profiles of [[], [{ profile_id: PROFILE }, { profile_id: OWNER }], [{ profile_id: 'invalid-profile' }]]) {
    const f = authFactory({ profiles });
    await assert.rejects(authorizeLedgerlyViewer(viewerRequest(), f.createClient, ENV), error => error.status === 403);
  }
  const anonymous = authFactory({ user: { id: OWNER, is_anonymous: true } });
  await assert.rejects(authorizeLedgerlyViewer(viewerRequest(), anonymous.createClient, ENV), error => error.status === 401);
});

test('full dashboard and banking grants remain independent; legacy finance roles cannot grant either', async () => {
  const user = { id: STAFF, email: 'staff@example.com', role: 'super_admin' };
  const none = authFactory({ user, permissions: [{ module_name: 'Finance: Admin', has_access: true }, { module_name: 'Dashboard', has_access: true }] });
  await assert.rejects(authorizeLedgerlyViewer(viewerRequest(), none.createClient, ENV), error => error.status === 403);
  const dashboard = authFactory({ user, grants: { can_view_dashboard: true, can_view_bank_balances: false } });
  const regular = await authorizeLedgerlyViewer(viewerRequest(), dashboard.createClient, ENV);
  assert.equal(regular.canViewFullDashboard, true); assert.equal(regular.canViewBankBalances, false);
  assert.equal(regular.canViewBankAccounts, false); assert.equal(regular.canViewBankTransactions, false);
  const bank = authFactory({ user, grants: { can_view_dashboard: false, can_view_bank_balances: true } });
  const banking = await authorizeLedgerlyViewer(viewerRequest(), bank.createClient, ENV);
  assert.equal(banking.canViewFullDashboard, false); assert.equal(banking.canViewBankBalances, true);
});

test('regular matching and transaction permissions remain usable without granting balances', async () => {
  const f = authFactory({ user: { id: STAFF }, grants: { can_view_dashboard: true }, permissions: [{ module_name: 'Bank: View Transactions', has_access: true }, { module_name: 'Payments: Match', has_access: true }] });
  const access = await authorizeLedgerlyViewer(viewerRequest(), f.createClient, ENV);
  assert.equal(access.canViewBankBalances, false);
  assert.equal(access.canViewBankAccounts, true); assert.equal(access.canViewBankTransactions, true); assert.equal(access.canViewBankTransactionAmounts, true);
});

test('foreign-origin requests and unavailable trusted permission configuration fail closed', async () => {
  const f = authFactory();
  await assert.rejects(authorizeLedgerlyViewer(new Request('https://hub.example/api/ledgerly/data', { headers: { Authorization: 'Bearer verified-jwt', Origin: 'https://other.example' } }), f.createClient, ENV), error => error.status === 403);
  assert.equal(f.calls.length, 0);
  for (const value of ['', 'super_admin', OWNER + ',']) {
    await assert.rejects(authorizeLedgerlyViewer(viewerRequest(), authFactory().createClient, { ...ENV, HUB_SUPER_ADMIN_AUTH_USER_IDS: value }), error => error.status === 503);
  }
});

test('an exhausted overall time budget prevents further upstream requests', async () => {
  let clockCalls = 0, fetchCalls = 0;
  await assert.rejects(fetchLedgerlySnapshot(configFor('summary'), { clock: () => clockCalls++ === 0 ? 0 : 50000, fetch: async () => { fetchCalls++; throw new Error('should not fetch'); } }), code('timeout'));
  assert.equal(fetchCalls, 0);
});
