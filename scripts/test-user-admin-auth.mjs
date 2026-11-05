import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserAdminHandlers } from '../src/lib/user-admin-handlers.js';
import { fetchUserAdmin } from '../src/lib/user-admin-client.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';
const LEGACY = '44444444-4444-4444-8444-444444444444';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', HUB_ADMIN_AUTH_USER_IDS: ADMIN, HUB_SUPER_ADMIN_AUTH_USER_IDS: ADMIN };

function mock(options = {}) {
  const calls = [];
  const actor = options.actor || { id: ADMIN, email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
  const directProfile = options.legacy ? null : { id: actor.id, email: actor.email, active: options.active === undefined ? true : options.active, role: 'team' };
  function builder(table) {
    let op = 'select', value, filters = {};
    const chain = {
      select(columns) { calls.push(['read', table, columns]); return chain; },
      eq(key, v) { filters[key] = v; return chain; },
      ilike(key, v) { calls.push(['ilike', table, key, v]); return chain; },
      limit() { return Promise.resolve({ data: options.legacyRows || [{ id: LEGACY, email: actor.email, active: true }], error: null }); },
      insert(v) { op = 'insert'; value = v; calls.push(['mutation', table, op, v]); return chain; },
      update(v) { op = 'update'; value = v; calls.push(['mutation', table, op, v]); return chain; },
      delete() { op = 'delete'; calls.push(['mutation', table, op]); return chain; },
      maybeSingle() { return Promise.resolve({ data: table === 'financial_visibility_permissions' ? (options.targetPermissions || null) : directProfile, error: options.profileError || null }); },
      single() {
        if (op === 'insert') return Promise.resolve({ data: { id: TARGET, ...value }, error: null });
        if (filters.id === TARGET) return Promise.resolve({ data: { id: TARGET, email: 'target@example.com', ...value }, error: null });
        return Promise.resolve({ data: directProfile, error: null });
      },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
    };
    return chain;
  }
  const service = { from: builder, async rpc(name, input) { calls.push(['rpc', name, input]); return { data: options.targetMapping || [{ auth_user_id: TARGET }], error: options.mappingError || null }; }, auth: { admin: {
    async createUser(payload) { calls.push(['admin', 'createUser', payload]); return { data: { user: { id: TARGET } }, error: null }; },
    async listUsers() { calls.push(['admin', 'listUsers']); return { data: { users: [{ id: TARGET, email: 'target@example.com' }] }, error: null }; },
    async updateUserById(id, payload) { calls.push(['admin', 'updateUserById', id, payload]); return { data: {}, error: null }; },
    async deleteUser(id) { calls.push(['admin', 'deleteUser', id]); return { data: {}, error: null }; },
  } } };
  function createClient(url, key, clientOptions) {
    calls.push(['client', key]);
    assert.equal(clientOptions.auth.persistSession, false);
    if (key === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { auth: { async getUser(token) {
      calls.push(['verify', token]);
      if (options.throwAuth) throw new Error('network');
      return options.invalid ? { data: { user: null }, error: new Error('expired') } : { data: { user: actor }, error: null };
    } } };
    assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY);
    return service;
  }
  return { calls, handlers: createUserAdminHandlers(createClient, { ...env, ...options.env }) };
}
function request(method, body = {}, overrides = {}) {
  const headers = { Origin: 'https://hub.example', 'Content-Type': 'application/json', Authorization: 'Bearer fixture-user-session', ...overrides.headers };
  for (const [key, value] of Object.entries(headers)) if (value === null) delete headers[key];
  return new Request('https://hub.example/api/users' + (method === 'DELETE' ? '?id=' + TARGET + (overrides.permanent ? '&permanent=true' : '') : ''),
    { method, headers, ...(method === 'DELETE' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
function assertNoMutation(calls) {
  assert.equal(calls.some(call => call[0] === 'admin' || call[0] === 'mutation'), false, 'No admin API or data mutation may run before authorization');
}

test('all account mutation methods reject missing bearer before service-client creation', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const m = mock();
    const response = await m.handlers[method](request(method, { id: ADMIN, user_id: ADMIN, role: 'super_admin', new_password: 'attacker-value' }, { headers: { Authorization: null }, permanent: true }));
    assert.equal(response.status, 401); assertNoMutation(m.calls);
    assert.equal(m.calls.some(call => call[0] === 'client' && call[1] === env.SUPABASE_SERVICE_ROLE_KEY), false);
  }
});

test('forged browser actor IDs, roles and permissions cannot impersonate an approved Auth UUID', async () => {
  const m = mock({ actor: { id: STAFF, email: 'staff@example.com', role: 'super_admin', app_metadata: { role: 'owner' } } });
  const response = await m.handlers.PUT(request('PUT', { id: ADMIN, user_id: ADMIN, role: 'super_admin', module_permissions: ['Admin'], new_password: 'attacker-value' }));
  assert.equal(response.status, 403); assertNoMutation(m.calls);
  assert.deepEqual(m.calls.filter(call => call[0] === 'verify'), [['verify', 'fixture-user-session']]);
  assert.equal(m.calls.some(call => call[0] === 'client' && call[1] === env.SUPABASE_SERVICE_ROLE_KEY), false);
});

test('missing or malformed independent admin allowlist fails closed with a clear 503', async () => {
  for (const value of ['', 'super_admin', ADMIN + ',']) {
    const m = mock({ env: { HUB_ADMIN_AUTH_USER_IDS: value, HUB_SUPER_ADMIN_AUTH_USER_IDS: '' } });
    const response = await m.handlers.POST(request('POST', { email: 'new@example.com', name: 'New user', password: 'fixture-password' }));
    assert.equal(response.status, 503); assert.match((await response.json()).error, /HUB_ADMIN_AUTH_USER_IDS/); assertNoMutation(m.calls);
    assert.equal(m.calls.length, 0);
  }
});

test('invalid, anonymous and unverifiable sessions are rejected', async () => {
  for (const options of [{ invalid: true }, { throwAuth: true }, { actor: { id: ADMIN, is_anonymous: true } }, { actor: { id: 'forged-admin' } }]) {
    const m = mock(options), response = await m.handlers.DELETE(request('DELETE'));
    assert.equal(response.status, 401); assertNoMutation(m.calls);
  }
});

test('inactive, null-active and banned approved administrators cannot change accounts', async () => {
  for (const options of [{ active: false }, { active: null }, { actor: { id: ADMIN, banned_until: '2099-01-01T00:00:00Z' } }]) {
    const m = mock(options), response = await m.handlers.PUT(request('PUT', { id: TARGET, new_password: 'fixture-password' }));
    assert.equal(response.status, 403); assertNoMutation(m.calls);
  }
});

test('cross-site and non-JSON writes are rejected before identity or service calls', async () => {
  for (const [headers, status] of [[{ Origin: 'https://attacker.example' }, 403], [{ Origin: null }, 403], [{ 'Sec-Fetch-Site': 'cross-site' }, 403], [{ 'Content-Type': 'text/plain' }, 415]]) {
    const m = mock(), response = await m.handlers.POST(request('POST', {}, { headers }));
    assert.equal(response.status, status); assert.equal(m.calls.length, 0);
  }
});

test('approved active Auth identity can create a member despite an unprivileged legacy role', async () => {
  const m = mock(), response = await m.handlers.POST(request('POST', { name: 'New member', email: 'new@example.com', password: 'fixture-password', role: 'team', modules: ['Dashboard'], user_id: STAFF }));
  assert.equal(response.status, 200); assert.equal((await response.json()).success, true);
  assert.equal(m.calls.filter(call => call[0] === 'admin' && call[1] === 'createUser').length, 1);
  assert.ok(m.calls.findIndex(call => call[0] === 'verify') < m.calls.findIndex(call => call[0] === 'admin'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('approved administrator can still reset a selected existing member password', async () => {
  const m = mock(), response = await m.handlers.PUT(request('PUT', { id: TARGET, new_password: 'fixture-new-password' }));
  assert.equal(response.status, 200);
  assert.deepEqual(m.calls.find(call => call[0] === 'admin' && call[1] === 'updateUserById'), ['admin', 'updateUserById', TARGET, { password: 'fixture-new-password' }]);
});

test('legacy profile mapping uses confirmed verified email and rejects ambiguity', async () => {
  const actor = { id: ADMIN, email: 'Admin_Name%tag@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
  const m = mock({ actor, legacy: true });
  assert.equal((await m.handlers.PUT(request('PUT', { id: TARGET, name: 'Renamed' }))).status, 200);
  assert.deepEqual(m.calls.find(call => call[0] === 'ilike'), ['ilike', 'users', 'email', 'admin\\_name\\%tag@example.com']);
  const duplicate = mock({ actor, legacy: true, legacyRows: [{ id: STAFF, email: actor.email, active: true }, { id: LEGACY, email: actor.email, active: true }] });
  assert.equal((await duplicate.handlers.DELETE(request('DELETE'))).status, 403); assertNoMutation(duplicate.calls);
  const unconfirmed = mock({ actor: { id: ADMIN, email: 'admin@example.com' }, legacy: true });
  assert.equal((await unconfirmed.handlers.DELETE(request('DELETE'))).status, 403); assertNoMutation(unconfirmed.calls);
});

test('client helper attaches the actual session for all four Settings actions and never falls back', async () => {
  const priorFetch = globalThis.fetch, observed = [];
  globalThis.fetch = async (url, options) => { observed.push({ url, options }); return Response.json({ success: true }); };
  try {
    const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'actual-session-token' } }, error: null }) } };
    for (const [method, url] of [['POST', '/api/users'], ['PUT', '/api/users'], ['DELETE', '/api/users?id=' + TARGET], ['DELETE', '/api/users?id=' + TARGET + '&permanent=true']])
      await fetchUserAdmin(supabase, url, { method, headers: { Authorization: 'Bearer forged-token' } });
    assert.equal(observed.length, 4);
    for (const call of observed) { assert.equal(call.options.headers.get('Authorization'), 'Bearer actual-session-token'); assert.equal(call.options.headers.get('Content-Type'), 'application/json'); assert.equal(call.options.credentials, 'same-origin'); }
    await assert.rejects(fetchUserAdmin({ auth: { getSession: async () => ({ data: { session: null } }) } }, '/api/users', { method: 'POST' }), /Sign in/);
    await assert.rejects(fetchUserAdmin(supabase, 'https://attacker.example/api/users', { method: 'POST' }), /endpoint/);
    assert.equal(observed.length, 4);
  } finally { globalThis.fetch = priorFetch; }
});

test('a verified super administrator retains team access without a separate delegated-admin grant', async () => {
  const m = mock({ env: { HUB_ADMIN_AUTH_USER_IDS: '' } });
  const response = await m.handlers.POST(request('POST', { name: 'Member', email: 'member@example.com', password: 'fixture-password' }));
  assert.equal(response.status, 200);
});

test('a delegated administrator cannot reset, deactivate or delete a protected financial viewer', async () => {
  for (const targetPermissions of [{ can_view_dashboard: true }, { can_view_bank_balances: true }]) {
    for (const method of ['PUT', 'DELETE']) {
      const m = mock({ env: { HUB_SUPER_ADMIN_AUTH_USER_IDS: STAFF }, targetPermissions });
      const response = await m.handlers[method](request(method, { id: TARGET, new_password: 'takeover', active: true, role: 'super_admin' }, { permanent: true }));
      assert.equal(response.status, 403); assertNoMutation(m.calls);
    }
  }
});

test('a delegated administrator cannot reset a configured super administrator through a target profile', async () => {
  const m = mock({ env: { HUB_SUPER_ADMIN_AUTH_USER_IDS: TARGET } });
  const response = await m.handlers.PUT(request('PUT', { id: TARGET, new_password: 'takeover' }));
  assert.equal(response.status, 403); assertNoMutation(m.calls);
});

test('ordinary team administration continues for targets without protected financial access', async () => {
  const m = mock({ env: { HUB_SUPER_ADMIN_AUTH_USER_IDS: STAFF }, targetPermissions: { can_view_dashboard: false, can_view_bank_balances: false } });
  const response = await m.handlers.PUT(request('PUT', { id: TARGET, name: 'Updated', new_password: 'fixture-password' }));
  assert.equal(response.status, 200);
  assert.deepEqual(m.calls.find(call => call[0] === 'admin' && call[1] === 'updateUserById'), ['admin', 'updateUserById', TARGET, { password: 'fixture-password' }]);
  assert.equal(m.calls.some(call => call[0] === 'admin' && call[1] === 'listUsers'), false, 'Target identity is exact and does not depend on the first Auth user page');
});

test('ambiguous and missing target identities cannot silently reset the wrong sign-in', async () => {
  for (const targetMapping of [[], [{ auth_user_id: TARGET }, { auth_user_id: STAFF }]]) {
    const m = mock({ targetMapping });
    const response = await m.handlers.PUT(request('PUT', { id: TARGET, new_password: 'fixture-password' }));
    assert.equal(response.status, 409); assertNoMutation(m.calls);
  }
  const unavailable = mock({ mappingError: new Error('missing migration') });
  assert.equal((await unavailable.handlers.PUT(request('PUT', { id: TARGET, name: 'Updated' }))).status, 503);
  assertNoMutation(unavailable.calls);
});
