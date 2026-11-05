import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorizeBankIdentity, bankSuperAdminIds, readBankJson, BankVisibilityError, bankVisibilityErrorResponse } from '../src/lib/bank-visibility.js';
import { assertPermission } from '../src/lib/server-permissions.js';
import * as matching from '../src/lib/payment-matching.js';

var SUPER = '11111111-1111-4111-8111-111111111111';
var STAFF = '22222222-2222-4222-8222-222222222222';
var PROFILE = '33333333-3333-4333-8333-333333333333';
var TXN = '44444444-4444-4444-8444-444444444444';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://build-only.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
for (var key of Object.keys(ENV)) process.env[key] = ENV[key];

// Execute the real route with its imported dependencies injected. This avoids
// Next's server runtime and all live provider/database calls while preserving
// the route's actual authorization, action selection and write branches.
var source = readFileSync(new URL('../src/app/api/accounting/bank-write/route.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/export async function /g, 'async function ');
var build = new Function('NextResponse', 'createClient', 'assertPermission', 'authorizeBankIdentity', 'bankSuperAdminIds', 'readBankJson', 'BankVisibilityError', 'bankVisibilityErrorResponse',
  'classifyApplication', 'roundMoney', 'isPaymentVoid', 'bankAllocationStatus', 'summarizeBankAllocation', source + '\nreturn {POST,GET};');

function fixture(options = {}) {
  var writes = [], checks = [], authCalls = [];
  var db = {
    async rpc(name, args) {
      assert.equal(name, 'bank_visibility_profile_for_identity'); assert.equal(args.p_auth_user_id, options.super ? SUPER : STAFF);
      return { data: [{ profile_id: PROFILE, auth_user_id: args.p_auth_user_id }], error: null };
    },
    from(table) {
      checks.push(table);
      var filters = {}, patch = null;
      var query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; }, limit() { return query; },
        update(value) { patch = value; return query; },
        then(resolve, reject) {
          var data;
          if (table === 'users') { assert.equal(filters.id, PROFILE); data = [{ id: PROFILE, role: 'viewer' }]; }
          else if (table === 'module_permissions') { assert.equal(filters.user_id, PROFILE); data = (options.permissions || []).map(function (p) { return { module_name: p, has_access: true }; }); }
          else if (table === 'bank_transactions') {
            if (patch) { writes.push({ table, filters, patch }); data = [{ id: TXN, ...patch }]; }
            else data = [{ id: TXN, category_status: 'unreviewed', wave_transaction_id: null, wave_account_id: null }];
          } else throw new Error('Unexpected table ' + table);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  function createClient(url, key) {
    assert.equal(url, ENV.NEXT_PUBLIC_SUPABASE_URL);
    if (key === ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { auth: { async getUser(token) {
      authCalls.push(token);
      return { data: { user: token === 'valid-session' ? { id: options.super ? SUPER : STAFF } : null }, error: token === 'valid-session' ? null : { message: 'invalid' } };
    } } };
    assert.equal(key, ENV.SUPABASE_SERVICE_ROLE_KEY); return db;
  }
  var route = build({ json: function (body, init) { return Response.json(body, init); } }, createClient, assertPermission, authorizeBankIdentity, bankSuperAdminIds, readBankJson,
    BankVisibilityError, bankVisibilityErrorResponse, matching.classifyApplication, matching.roundMoney, matching.isPaymentVoid, matching.bankAllocationStatus, matching.summarizeBankAllocation);
  return { route, writes, checks, authCalls };
}
function request(body, headers = {}) {
  return new Request('https://hub.example/api/accounting/bank-write', { method: 'POST', headers: {
    Origin: 'https://hub.example', 'Content-Type': 'application/json', Authorization: 'Bearer valid-session', ...headers,
  }, body: JSON.stringify(body) });
}
function classify(actor = PROFILE) { return { action: 'classify', user_id: actor, bank_transaction_id: TXN, patch: { classification: 'other_expense' } }; }

test('bank writes reject an invalid login before reading or mutating banking records', async function () {
  var f = fixture({ permissions: ['bank.classify'] });
  assert.equal((await f.route.POST(request(classify(), { Authorization: 'Bearer forged' }))).status, 401);
  assert.deepEqual(f.checks, []); assert.deepEqual(f.writes, []);
});

test('a forged body actor is rejected before permission or transaction mutation', async function () {
  var f = fixture({ permissions: ['bank.classify'] });
  var response = await f.route.POST(request(classify(SUPER)));
  assert.equal(response.status, 403); assert.equal((await response.json()).ok, false);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.checks, []);
});

test('valid non-balance staff can classify with the existing classification grant', async function () {
  var f = fixture({ permissions: ['bank.classify'] });
  var response = await f.route.POST(request(classify()));
  assert.equal(response.status, 200); assert.equal((await response.json()).row.classification, 'other_expense');
  assert.deepEqual(f.writes, [{ table: 'bank_transactions', filters: { id: TXN }, patch: { classification: 'other_expense', updated_by: PROFILE } }]);
  assert.equal(f.checks.some(function (t) { return /visibility|balance_permissions/.test(t); }), false);
});

test('matching permission remains sufficient for operational review status without balance access', async function () {
  var f = fixture({ permissions: ['payments.match'] });
  var response = await f.route.POST(request({ action: 'set_status', user_id: PROFILE, bank_transaction_id: TXN, status: 'ignored' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.equal(f.writes[0].patch.review_status, 'ignored'); assert.equal(f.writes[0].patch.updated_by, PROFILE);
});

test('staff without the action permission cannot mutate, regardless of body identity', async function () {
  var f = fixture();
  assert.equal((await f.route.POST(request(classify()))).status, 403);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.checks, ['users', 'module_permissions']);
});

test('verified super-admin Auth ID authorizes operations even with a legacy viewer role', async function () {
  var f = fixture({ super: true });
  assert.equal((await f.route.POST(request(classify()))).status, 200);
  assert.equal(f.writes[0].patch.updated_by, PROFILE);
  assert.equal(f.checks.includes('users'), false); assert.equal(f.checks.includes('module_permissions'), false);
});

test('the Auth UUID may be supplied by legacy clients but audit still uses the mapped profile', async function () {
  var f = fixture({ permissions: ['bank.classify'] });
  assert.equal((await f.route.POST(request(classify(STAFF)))).status, 200);
  assert.equal(f.writes[0].patch.updated_by, PROFILE);
});

test('cross-site writes are rejected before verification or mutation', async function () {
  var f = fixture({ permissions: ['bank.classify'] });
  assert.equal((await f.route.POST(request(classify(), { Origin: 'https://attacker.example' }))).status, 403);
  assert.deepEqual(f.authCalls, []); assert.deepEqual(f.writes, []);
});
