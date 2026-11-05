import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorizeBankVisibility, authorizeBankIdentity, readBankVisibilityForIdentity, createBankVisibilityHandlers, projectPlaidAccountMetadata, bankSuperAdminIds } from '../src/lib/bank-visibility.js';
import { userHasPermission } from '../src/lib/server-permissions.js';
import { createPlaidAuthorizer, configuredPlaidCron, isPlaidCron } from '../src/app/api/plaid/_auth.js';

var SUPER = '11111111-1111-4111-8111-111111111111';
var STAFF = '22222222-2222-4222-8222-222222222222';
var PROFILE = '33333333-3333-4333-8333-333333333333';
var TARGET = '44444444-4444-4444-8444-444444444444';
var TARGET_PROFILE = '55555555-5555-4555-8555-555555555555';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://build-only.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER, CRON_SECRET: 'test-cron-secret-at-least-16' };

function request(method = 'GET', options = {}) {
  var headers = { Authorization: 'Bearer valid-session', ...options.headers };
  if (method !== 'GET') { headers.Origin ??= 'https://hub.example'; headers['Content-Type'] ??= 'application/json'; }
  if (options.noBearer) delete headers.Authorization;
  return new Request('https://hub.example/api/bank-visibility' + (options.query || ''), {
    method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(options.body || {}) }),
  });
}

function fixture(options = {}) {
  var id = options.authId || STAFF;
  var calls = { clients: [], getUser: [], rpc: [], tables: [], audits: [] };
  var grants = new Map((options.grants || []).map(function (row) { return [row.auth_user_id, { can_view_dashboard: row.can_view_dashboard === true, can_view_bank_balances: row.can_view_bank_balances === true }]; }));
  var profiles = options.profiles || [
    { profile_id: PROFILE, auth_user_id: id, name: 'Current user', email: 'current@example.test' },
    { profile_id: TARGET_PROFILE, auth_user_id: TARGET, name: 'Target user', email: 'target@example.test' },
  ];
  var db = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (options.rpcError) return { data: null, error: { message: 'not migrated' } };
      if (name === 'bank_visibility_profile_for_identity') return { data: options.mapping ?? profiles.filter(function (p) { return p.auth_user_id === args.p_auth_user_id; }), error: null };
      if (name === 'bank_visibility_list_profiles') return { data: profiles, error: null };
      if (name === 'bank_visibility_set_grant') {
        if (options.saveFailure) return { data: false, error: null };
        var old = grants.get(args.p_auth_user_id) || { can_view_dashboard: false, can_view_bank_balances: false };
        var next = { can_view_dashboard: args.p_can_view_dashboard ?? old.can_view_dashboard, can_view_bank_balances: args.p_can_view_bank_balances ?? old.can_view_bank_balances };
        grants.set(args.p_auth_user_id, next);
        calls.audits.push({ actor: args.p_actor_auth_user_id, target: args.p_auth_user_id, before: old, after: next });
        return { data: next, error: null };
      }
      throw new Error('Unexpected RPC ' + name);
    },
    from(table) {
      calls.tables.push(table);
      assert.equal(table, 'financial_visibility_permissions');
      var selectedId;
      function result(single) {
        if (options.grantError) return { data: null, error: { message: 'missing table' } };
        return { data: single ? (grants.get(selectedId) || null) : Array.from(grants, function ([auth_user_id, flags]) { return { auth_user_id, ...flags }; }), error: null };
      }
      var query = {
        select() { return query; }, eq(key, value) { assert.equal(key, 'auth_user_id'); selectedId = value; return query; },
        maybeSingle() { return Promise.resolve(result(true)); },
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
      };
      return query;
    },
  };
  function createClient(url, key) {
    assert.equal(url, ENV.NEXT_PUBLIC_SUPABASE_URL); calls.clients.push(key);
    if (key === ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { auth: { async getUser(token) {
      calls.getUser.push(token);
      if (token !== 'valid-session' || options.invalidToken) return { data: { user: null }, error: { message: 'invalid' } };
      return { data: { user: { id, email: 'current@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', ...options.authFields } }, error: null };
    } } };
    assert.equal(key, ENV.SUPABASE_SERVICE_ROLE_KEY); return db;
  }
  return { db, createClient, calls, grants, handlers: createBankVisibilityHandlers(createClient, { ...ENV, ...options.env }) };
}

test('missing bearer never constructs a privileged client', async function () {
  var f = fixture(), response = await f.handlers.GET(request('GET', { noBearer: true }));
  assert.equal(response.status, 401); assert.deepEqual(f.calls.clients, []); assert.deepEqual(f.calls.rpc, []);
});

test('invalid and anonymous tokens cannot reach profile or grant reads', async function () {
  for (var options of [{ invalidToken: true }, { authFields: { is_anonymous: true } }]) {
    var f = fixture(options), response = await f.handlers.GET(request());
    assert.equal(response.status, 401); assert.equal(f.calls.clients.length, 1); assert.deepEqual(f.calls.rpc, []);
  }
});

test('banned, inactive and ambiguous profiles fail closed', async function () {
  var banned = fixture({ authFields: { banned_until: '2999-01-01T00:00:00Z' } });
  assert.equal((await banned.handlers.GET(request())).status, 403);
  assert.equal(banned.calls.clients.length, 1);
  for (var mapping of [[], [{ profile_id: PROFILE }, { profile_id: TARGET_PROFILE }]]) {
    var f = fixture({ mapping });
    assert.equal((await f.handlers.GET(request())).status, 403); assert.deepEqual(f.calls.tables, []);
  }
});

test('legacy super/admin/owner/finance flags do not confer balances', async function () {
  for (var role of ['super_admin', 'admin', 'owner', 'accounting_manager']) {
    var f = fixture({ mapping: [{ profile_id: PROFILE, role, active: true, module_permissions: { 'finance.admin': true, 'bank.view_account_balances': true } }] });
    var response = await f.handlers.GET(request());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).capabilities, { canViewFullDashboard: false, canViewBankBalances: false, isVerifiedSuperAdmin: false });
  }
});

test('only the independently configured Auth UUID is a verified super admin', async function () {
  var f = fixture({ authId: SUPER });
  var access = await authorizeBankVisibility(request(), f.createClient, ENV);
  assert.equal(access.authUserId, SUPER); assert.equal(access.profileId, PROFILE);
  assert.equal(access.canViewFullDashboard, true); assert.equal(access.canViewBankBalances, true); assert.equal(access.isVerifiedSuperAdmin, true);
  assert.deepEqual(f.calls.tables, []);
});

test('explicit grant allows only balances and revocation takes effect on the next read', async function () {
  var f = fixture({ grants: [{ auth_user_id: STAFF, can_view_bank_balances: true }] });
  assert.deepEqual(await readBankVisibilityForIdentity(f.db, STAFF, ENV), { canViewFullDashboard: false, canViewBankBalances: true, isVerifiedSuperAdmin: false });
  f.grants.set(STAFF, { can_view_dashboard: false, can_view_bank_balances: false });
  assert.deepEqual(await readBankVisibilityForIdentity(f.db, STAFF, ENV), { canViewFullDashboard: false, canViewBankBalances: false, isVerifiedSuperAdmin: false });
});

test('full dashboard and bank balances have four independent grant combinations', async function () {
  for (var dashboard of [false, true]) for (var banking of [false, true]) {
    var f = fixture({ grants: [{ auth_user_id: STAFF, can_view_dashboard: dashboard, can_view_bank_balances: banking }] });
    assert.deepEqual(await readBankVisibilityForIdentity(f.db, STAFF, ENV), {
      canViewFullDashboard: dashboard, canViewBankBalances: banking, isVerifiedSuperAdmin: false,
    });
  }
});

test('missing/malformed independent authority and unavailable permission storage fail closed', async function () {
  for (var env of [{ HUB_SUPER_ADMIN_AUTH_USER_IDS: '' }, { HUB_SUPER_ADMIN_AUTH_USER_IDS: 'admin' }, { HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER + ',' }]) {
    var f = fixture({ env }); assert.equal((await f.handlers.GET(request())).status, 503);
  }
  for (var options of [{ grantError: true }, { rpcError: true }]) {
    var f = fixture(options); assert.equal((await f.handlers.GET(request())).status, 503);
  }
  assert.deepEqual(bankSuperAdminIds({ HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER.toUpperCase() }), [SUPER]);
});

test('GET access responses are private and cannot be read cross-site', async function () {
  var f = fixture(), response = await f.handlers.GET(request());
  assert.match(response.headers.get('cache-control'), /no-store/); assert.match(response.headers.get('vary'), /Authorization/);
  assert.equal((await f.handlers.GET(request('GET', { headers: { Origin: 'https://elsewhere.example' } }))).status, 403);
});

test('grantees and ordinary admins cannot enumerate or edit permission grants', async function () {
  var f = fixture({ grants: [{ auth_user_id: STAFF, can_view_bank_balances: true }] });
  assert.equal((await f.handlers.GET(request('GET', { query: '?scope=grants' }))).status, 403);
  assert.equal((await f.handlers.PUT(request('PUT', { body: { profileId: TARGET_PROFILE, canViewBankBalances: true, user_id: SUPER } }))).status, 403);
  assert.equal(f.calls.rpc.some(function (c) { return c.name === 'bank_visibility_set_grant'; }), false);
});

test('verified super admin lists mapped identities with effective balance permission', async function () {
  var f = fixture({ authId: SUPER, grants: [{ auth_user_id: TARGET, can_view_bank_balances: true }] });
  var response = await f.handlers.GET(request('GET', { query: '?scope=grants' }));
  assert.equal(response.status, 200); var data = await response.json();
  assert.equal(data.grants[0].authUserId, SUPER); assert.equal(data.grants[0].isVerifiedSuperAdmin, true);
  assert.equal(data.grants[1].authUserId, TARGET); assert.equal(data.grants[1].canViewBankBalances, true);
  assert.equal(data.grants[1].canViewFullDashboard, false); assert.equal(data.grants[1].isVerifiedSuperAdmin, false);
});

test('grant and revoke send the genuine actor to one atomic audit RPC', async function () {
  var f = fixture({ authId: SUPER });
  for (var enabled of [true, false]) {
    var response = await f.handlers.PUT(request('PUT', { body: { profileId: TARGET_PROFILE, canViewBankBalances: enabled } }));
    assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  }
  assert.deepEqual(f.calls.audits, [
    { actor: SUPER, target: TARGET, before: { can_view_dashboard: false, can_view_bank_balances: false }, after: { can_view_dashboard: false, can_view_bank_balances: true } },
    { actor: SUPER, target: TARGET, before: { can_view_dashboard: false, can_view_bank_balances: true }, after: { can_view_dashboard: false, can_view_bank_balances: false } },
  ]);
});

test('a partial dashboard or bank grant preserves the other independent flag', async function () {
  var f = fixture({ authId: SUPER, grants: [{ auth_user_id: TARGET, can_view_bank_balances: true }] });
  var dashboard = await f.handlers.PUT(request('PUT', { body: { profileId: TARGET_PROFILE, canViewFullDashboard: true } }));
  assert.equal(dashboard.status, 200);
  assert.deepEqual((await dashboard.json()).grant, { profileId: TARGET_PROFILE, authUserId: TARGET, canViewFullDashboard: true, canViewBankBalances: true, isVerifiedSuperAdmin: false });
  var rpc = f.calls.rpc.find(function (call) { return call.name === 'bank_visibility_set_grant'; });
  assert.equal(rpc.args.p_can_view_bank_balances, null);
  var revokeBank = await f.handlers.PUT(request('PUT', { body: { profileId: TARGET_PROFILE, canViewBankBalances: false } }));
  assert.equal(revokeBank.status, 200);
  assert.deepEqual((await revokeBank.json()).grant, { profileId: TARGET_PROFILE, authUserId: TARGET, canViewFullDashboard: true, canViewBankBalances: false, isVerifiedSuperAdmin: false });
  var both = await f.handlers.PUT(request('PUT', { body: { profileId: TARGET_PROFILE, canViewFullDashboard: false, canViewBankBalances: true } }));
  assert.equal(both.status, 200);
  assert.deepEqual((await both.json()).grant, { profileId: TARGET_PROFILE, authUserId: TARGET, canViewFullDashboard: false, canViewBankBalances: true, isVerifiedSuperAdmin: false });
});

test('grant writes reject cross-site, non-JSON, forged identity keys and unverified targets', async function () {
  var f = fixture({ authId: SUPER });
  for (var [options, status] of [
    [{ headers: { Origin: 'https://attacker.example' } }, 403],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ body: { profileId: TARGET_PROFILE, canViewBankBalances: true, authUserId: SUPER } }, 400],
    [{ body: { profileId: TARGET_PROFILE, canViewBankBalances: 'true' } }, 400],
    [{ body: { profileId: STAFF, canViewBankBalances: true } }, 409],
    [{ body: { profileId: PROFILE, canViewBankBalances: false } }, 409],
  ]) assert.equal((await f.handlers.PUT(request('PUT', options))).status, status);
  assert.deepEqual(f.calls.audits, []);
});

test('identity changes or audit/write failure cannot be reported as a saved grant', async function () {
  var f = fixture({ authId: SUPER, saveFailure: true });
  var response = await f.handlers.PUT(request('PUT', { body: { profileId: TARGET_PROFILE, canViewBankBalances: true } }));
  assert.equal(response.status, 409); assert.equal((await response.json()).ok, false); assert.deepEqual(f.calls.audits, []);
});

test('metadata projection removes balances, account numbers and provider secrets for every caller', function () {
  var input = [{ account_id: 'account', name: 'Checking', official_name: 'Business Checking', mask: '1234', type: 'depository', subtype: 'checking',
    balances: { current: 99999, available: 88888, limit: 100000, iso_currency_code: 'USD' },
    access_token: 'never-return', account_number: '123456789', current_balance: 99999, future_secret: 'never-return' }];
  assert.deepEqual(projectPlaidAccountMetadata(input), [{ account_id: 'account', name: 'Checking', official_name: 'Business Checking', mask: '1234', type: 'depository', subtype: 'checking', iso_currency: 'USD' }]);
  assert.equal(input[0].balances.current, 99999); // no mutation of ingestion data
});

test('ordinary transaction, invoice and matching permissions remain separate from balances', function () {
  var admin = { role: 'admin', isSuperAdmin: false, mp: {} };
  assert.equal(userHasPermission(admin, 'bank_transactions.view'), true);
  assert.equal(userHasPermission(admin, 'payments.match'), true);
  assert.equal(userHasPermission(admin, 'invoices.create'), true);
  assert.equal(userHasPermission(admin, 'bank_balances.view'), false);
  assert.equal(userHasPermission({ isSuperAdmin: true, mp: { 'bank.view_account_balances': true, 'finance.admin': true } }, 'bank_balances.view'), false);
  assert.equal(userHasPermission({ bankVisibility: { canViewBankBalances: true } }, 'bank_balances.view'), true);
  assert.equal(userHasPermission({ role: 'viewer', bankVisibility: { canViewBankBalances: true } }, 'payments.match'), false);
});

test('Plaid operations use the verified profile, ignoring a forged body actor', async function () {
  var f = fixture(), checks = [];
  var authorize = createPlaidAuthorizer(f.createClient, ENV, async function (db, profileId, permission) {
    checks.push({ profileId, permission }); return { ok: true };
  });
  var result = await authorize(request('POST', { body: { user_id: SUPER } }), 'payments.match', false);
  assert.equal(result.authUserId, STAFF);
  assert.deepEqual(checks, [{ profileId: PROFILE, permission: 'payments.match' }]);
  assert.deepEqual(f.calls.tables, []); // no balance grant is required for operational work
});

test('verified super admins retain operational access even without a legacy role', async function () {
  var f = fixture({ authId: SUPER }), checks = 0;
  var authorize = createPlaidAuthorizer(f.createClient, ENV, async function () { checks++; return { ok: false, status: 403 }; });
  assert.equal((await authorize(request('POST'), 'categories.apply', false)).isVerifiedSuperAdmin, true);
  assert.equal(checks, 0);
});

test('a balance grant never bypasses an operational denial and balance setup cannot block valid operations', async function () {
  var f = fixture({ grants: [{ auth_user_id: STAFF, can_view_bank_balances: true }] });
  var deny = createPlaidAuthorizer(f.createClient, ENV, async function () { return { ok: false, status: 403, error: 'No classify permission' }; });
  await assert.rejects(deny(request('POST'), 'categories.apply', false), function (e) { return e.status === 403; });
  var allow = createPlaidAuthorizer(f.createClient, { ...ENV, HUB_SUPER_ADMIN_AUTH_USER_IDS: '' }, async function () { return { ok: true }; });
  assert.equal((await allow(request('POST'), 'payments.match', false)).authUserId, STAFF);
  assert.deepEqual(f.calls.tables, []);
});

test('cron is explicitly configured and bypasses only an opted-in ingestion call', async function () {
  assert.equal(configuredPlaidCron({}), false); assert.equal(configuredPlaidCron({ CRON_SECRET: 'short' }), false);
  var f = fixture(), authorize = createPlaidAuthorizer(f.createClient, ENV, async function () { throw new Error('not a human request'); });
  var cron = request('POST', { headers: { Authorization: 'Bearer ' + ENV.CRON_SECRET }, body: {} });
  assert.equal(isPlaidCron(cron, ENV), true);
  assert.equal((await authorize(cron, 'bank_transactions.view', true)).via, 'cron');
  assert.deepEqual(f.calls.getUser, []);
  await assert.rejects(authorize(request('POST', { headers: { Authorization: 'Bearer ' + ENV.CRON_SECRET } }), 'categories.apply', false), function (e) { return e.status === 401; });
});

test('SQL boundary revokes table and pre-existing column grants without locking operational tables', function () {
  var sql = readFileSync(new URL('../sql/bank-balance-visibility.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /revoke all \(%s\) on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /'bank_connections', 'plaid_accounts', 'backups'/);
  assert.match(sql, /revoke all on function public\.bank_visibility_set_grant\(uuid, uuid, uuid, boolean, boolean\) from public, anon, authenticated/);
  assert.match(sql, /bank_visibility_auth_ids_for_profile/);
  assert.match(sql, /count\(\*\) over \(partition by p\.id\)/);
  assert.match(sql, /count\(\*\) over \(partition by a\.id\)/);
  assert.equal(/alter table (?:if exists )?public\.(?:bank_transactions|bank_transaction_splits|accounting_invoices|accounting_bills)/i.test(sql), false);
  var selects = Array.from(sql.matchAll(/grant select \(([^)]+)\) on public\.(bank_connections|plaid_accounts)/g));
  assert.equal(selects.length, 2);
  for (var match of selects) assert.doesNotMatch(match[1], /access_token|sync_cursor|balance/);
  assert.match(sql, /set response_payload = pg_temp\.bank_scrub_provider_log/);
});

test('the production ingestion response uses the tested safe projection', function () {
  var route = readFileSync(new URL('../src/app/api/plaid/transactions/route.js', import.meta.url), 'utf8');
  assert.match(route, /accounts: projectPlaidAccountMetadata\(acctsFromPlaid\)/);
  assert.doesNotMatch(route, /accounts: acctsFromPlaid/);
  assert.match(route, /authorizePlaidOperation\(req, 'bank_transactions.view', true\)/);
  assert.match(route, /authorizePlaidOperation\(req, 'bank_transactions.view', false\)/);
});
