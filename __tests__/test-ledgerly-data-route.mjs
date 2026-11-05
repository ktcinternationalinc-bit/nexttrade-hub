import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerlyDataHandler } from '../src/lib/ledgerly-data-handler.js';
import { readLedgerlyConfig } from '../src/lib/ledgerly-sync.js';

const SUPER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROFILE = '33333333-3333-4333-8333-333333333333';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER, LEDGERLY_READ_KEY: 'ldg_' + 'a'.repeat(64), LEDGERLY_SITE_ACCESS_TOKEN: 'fixture-private-site-token',
  CRON_SECRET: 'fixture-cron-secret-only', LEDGERLY_RESOURCES: 'summary,invoices,bills,expenses,checks,contacts,journal,bank-accounts,bank-transactions' };
const config = readLedgerlyConfig(env);
const dataset = (data) => ({ data, total: Array.isArray(data) ? data.length : 1, period: { from: '2026-01-01', to: '2026-10-24' } });
const snapshot = { configId: config.configId, sourceOrigin: config.origin, resources: config.resources, schemaVersion: '1', currency: 'USD', revision: 7, fetchedAt: '2026-10-24T12:00:00Z', datasets: {
  summary: dataset({ revenueCents: 10000, expenseCents: 3000, netProfitCents: 7000, cashCents: 991234567, receivablesCents: 200, payablesCents: 300 }),
  invoices: dataset([{ id: 'i', totalCents: 1200, outstandingCents: 400, lines: [{ description: 'Work' }] }]),
  bills: dataset([{ id: 'b', amountCents: 800 }]), expenses: dataset([{ id: 'e', amountCents: 300, payee: 'Vendor', memo: 'Office supply', categoryId: '6100' }]),
  checks: dataset([{ id: 'c', amountCents: 200 }]), contacts: dataset([{ id: 'p', name: 'Customer' }]),
  journal: dataset([{ id: 'j', sourceType: 'openingBalance', lines: [{ accountId: '1000', debit: 991234567, credit: 0 }] }]),
  'bank-accounts': dataset([{ id: 'a', name: 'Checking', mask: '1234', currentBalanceCents: 887654321, availableBalanceCents: 776543210 }]),
  'bank-transactions': dataset([{ id: 't', accountId: 'a', amountCents: -300, description: 'Office supply', status: 'review' }]),
} };

function fixture(options = {}) {
  const reads = [], writes = [];
  const actor = options.super ? SUPER : STAFF;
  const db = {
    async rpc(name) { reads.push(name); return { data: [{ profile_id: PROFILE, auth_user_id: actor }], error: null }; },
    from(table) {
      const chain = {
        select() { reads.push(table); return chain; }, eq() { return chain; },
        async maybeSingle() {
          if (table === 'financial_visibility_permissions') return { data: options.grants || {}, error: options.permissionError || null };
          return { data: { snapshot, sync_status: 'ready', last_success_at: snapshot.fetchedAt }, error: null };
        },
        then(resolve, reject) { return Promise.resolve({ data: options.modules || [], error: null }).then(resolve, reject); },
        update() { writes.push(table); throw new Error('No data writes belong in a dashboard read'); },
      };
      return chain;
    },
  };
  const createClient = (url, key) => key === env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? { auth: { async getUser(token) { reads.push('verify:' + token); return options.invalid ? { error: new Error('invalid') } : { data: { user: { id: actor } }, error: null }; } } }
    : db;
  const handle = createLedgerlyDataHandler(createClient, env);
  const request = (resource, query = '') => new Request('https://hub.example/api/ledgerly/data?resource=' + resource + query,
    { headers: options.noBearer ? {} : { Authorization: 'Bearer fixture-session' } });
  return { reads, writes, handle, request };
}

test('a full-dashboard reader gets every normal summary value but no bank balance in actual HTTP JSON', async () => {
  const f = fixture({ grants: { can_view_dashboard: true } });
  const response = await f.handle(f.request('summary'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dataset.data.netProfitCents, 7000);
  assert.equal('cashCents' in body.dataset.data, false);
  assert.equal(JSON.stringify(body).includes('991234567'), false);
  assert.equal(body.resources.includes('bank-accounts'), false);
  assert.equal(body.resources.includes('journal'), false);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(f.writes.length, 0);
});

test('direct bank or full-journal queries cannot bypass the separate permission', async () => {
  for (const resource of ['bank-accounts', 'bank-transactions', 'journal']) {
    const f = fixture({ grants: { can_view_dashboard: true } });
    const response = await f.handle(f.request(resource));
    assert.equal(response.status, 403);
    assert.equal(f.reads.includes('ledgerly_sync_state'), false, 'Denied resources must not read the private snapshot');
    const body = await response.json();
    assert.equal(body.resources.includes('journal'), false);
    assert.equal(body.resources.includes('bank-accounts'), false);
  }
});

test('bank-only permission exposes bank records without the full business dashboard or journal', async () => {
  const f = fixture({ grants: { can_view_bank_balances: true } });
  const response = await f.handle(f.request('bank-accounts'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dataset.data[0].currentBalanceCents, 887654321);
  assert.deepEqual(body.resources, ['bank-accounts', 'bank-transactions']);
  assert.equal((await f.handle(f.request('summary'))).status, 403);
  assert.equal((await f.handle(f.request('journal'))).status, 403);
});

test('ordinary bank work preserves individual rows and labels without unlocking balance totals', async () => {
  const f = fixture({ grants: { can_view_dashboard: true }, modules: [
    { module_name: 'Bank: View Transactions', has_access: true }, { module_name: 'Payments: Match', has_access: true },
  ] });
  const accounts = await (await f.handle(f.request('bank-accounts'))).json();
  assert.equal(accounts.dataset.data[0].mask, '1234');
  assert.equal('currentBalanceCents' in accounts.dataset.data[0], false);
  const transactions = await (await f.handle(f.request('bank-transactions'))).json();
  assert.equal(transactions.dataset.data[0].amountCents, -300);
  assert.equal(transactions.dataset.data[0].accountId, 'a');
  const expenses = await (await f.handle(f.request('expenses'))).json();
  assert.equal(expenses.dataset.data[0].payee, 'Vendor');
  assert.equal(expenses.dataset.data[0].memo, 'Office supply');
});

test('verified super administrators have full source access regardless of mutable roles and module grants', async () => {
  const f = fixture({ super: true });
  for (const resource of ['summary', 'journal', 'bank-accounts', 'invoices']) assert.equal((await f.handle(f.request(resource))).status, 200);
  const body = await (await f.handle(f.request('summary'))).json();
  assert.equal(body.dataset.data.cashCents, 991234567);
  assert.deepEqual(body.resources, config.resources);
});

test('missing, invalid and ungranted sessions cannot fetch cached financial data', async () => {
  for (const options of [{ noBearer: true }, { invalid: true }, {}, { grants: { can_view_dashboard: true }, permissionError: new Error('unavailable') }]) {
    const f = fixture(options), response = await f.handle(f.request('summary'));
    assert.ok([401, 403, 503].includes(response.status));
    assert.equal(f.reads.includes('ledgerly_sync_state'), false);
  }
});

test('query attempts to inject capabilities or a different actor are rejected', async () => {
  const f = fixture({ grants: { can_view_dashboard: true } });
  for (const query of ['&canViewBankBalances=true', '&user_id=' + SUPER, '&resource=bank-accounts'])
    assert.equal((await f.handle(f.request('summary', query))).status, 400);
});
