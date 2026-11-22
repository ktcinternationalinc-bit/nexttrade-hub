// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XR (Codex 22 Nov 09:01 point 5) — WAVE: a confirmed MONEY BACK deposit (RTM / NextTrade returned unused funds) is never sent
// to Wave as Sales or any other category while the Hub counts it as a reduction of Professional fees. The REAL push-transaction route
// with an in-memory database; Wave itself is never called (fetch is a counting stub). Fabricated fixtures only.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 800))); }
console.log('XR — Wave push holds a money-back deposit unless it uses the Professional fees category');

var state = { db: null, fetches: 0 };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/server-permissions.js', { assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: true, mp: {}, deny: {} } }); }, loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true, mp: {}, deny: {} }); }, userHasPermission: function () { return true; }, SENSITIVE_PERMS: {} });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.WAVE_ACCESS_TOKEN = 'test-token';
global.fetch = function () { state.fetches++; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ data: { moneyTransactionCreate: { didSucceed: true, inputErrors: [], transaction: { id: 'w1' } } } }); } }); };
var R = require(path.join(root, 'src/app/api/wave/push-transaction/route.js'));
var BIZ = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4'; // the approved test business of the route
function call(body) { return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1', wave_business_id: BIZ }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }

function world(o) {
  o = o || {};
  var db = new FakeDb({});
  db.t.wave_business_registry = [{ wave_business_id: BIZ, is_production: false, writes_enabled: true, allow_payment_push: true, production_push_unlocked: false, label: 'test' }];
  db.t.wave_business_settings = [{ wave_business_id: BIZ, default_payment_account_id: 'BANK1', default_payment_account_name: 'Chase Checking' }];
  db.t.wave_categories = [
    { wave_business_id: BIZ, wave_account_id: 'BANK1', wave_account_name: 'Chase Checking', type: 'ASSET', subtype: 'CASH_AND_BANK' },
    { wave_business_id: BIZ, wave_account_id: 'SALES', wave_account_name: 'Sales', type: 'INCOME', subtype: 'INCOME' },
    { wave_business_id: BIZ, wave_account_id: 'PROF', wave_account_name: 'Professional Fees', type: 'EXPENSE', subtype: 'OPERATING_EXPENSE' }];
  db.t.plaid_accounts = [{ plaid_account_id: 'A1', mask: '6338' }];
  db.t.bank_transactions = [{ id: 'B1', wave_business_id: BIZ, account_id: 'A1', direction: 'in', amount: -200, amount_abs: 200, date: '2026-04-08', posted_date: '2026-04-08', name: 'DEPOSIT FROM NEXTTRADE', wave_account_id: o.cat || 'SALES', wave_account_name: o.cat === 'PROF' ? 'Professional Fees' : 'Sales', matched_invoice_id: null, category_status: 'pending_wave_sync' },
    { id: 'B9', wave_business_id: BIZ, account_id: 'A1', direction: 'in', amount: -90, amount_abs: 90, date: '2026-04-09', posted_date: '2026-04-09', name: 'ORDINARY DEPOSIT', wave_account_id: 'SALES', wave_account_name: 'Sales', matched_invoice_id: null, category_status: 'pending_wave_sync' }];
  db.t.party_money_entries = o.noRefund ? [] : [{ id: 'r1', party: 'NextTrade Industries', bucket: 'refund', kind: 'refund', amount: 200, source_bank_transaction_id: 'T1', bank_transaction_id: 'B1', entry_date: '2026-04-08' }];
  db.t.wave_sync_log = [];
  if (o.readError) { db.fail.party_money_entries = { select: 'permission denied for table party_money_entries' }; }
  state.db = db; state.fetches = 0; return db;
}

(async function () {
  world();
  var a = await call({ hub_record_id: 'B1' });
  check('a money-back deposit categorized as Sales is HELD (409) with a plain message naming the company and Professional fees; Wave is not called', a._status === 409 && /money back from NextTrade Industries/.test(a.error || '') && /Professional fees/.test(a.error || '') && state.fetches === 0, a);
  check('… the line is not marked as syncing or synced (nothing changed on it) and the hold is in the Sync Log', state.db.t.bank_transactions[0].category_status === 'pending_wave_sync' && state.db.t.wave_sync_log.length === 1 && /money back/.test(state.db.t.wave_sync_log[0].error_message || ''), [state.db.t.bank_transactions[0], state.db.t.wave_sync_log]);
  world();
  var b = await call({ hub_record_id: 'B9', dry_run: true });
  check('an ORDINARY deposit (no refund recorded) is not held by this rule (dry run goes ahead)', b.ok === true && b.dry_run === true && state.fetches === 0, b);
  world({ cat: 'PROF' });
  var c = await call({ hub_record_id: 'B1', dry_run: true });
  check('the same money-back deposit with the Professional fees Wave category passes this rule (dry run goes ahead)', c.ok === true && c.dry_run === true, c);
  world({ readError: true });
  var d = await call({ hub_record_id: 'B1' });
  check('when the refund records cannot be read the line is held (503), never pushed on a guess; Wave not called', d._status === 503 && /could not check/.test(d.error || '') && state.fetches === 0, d);
  var fs = require('fs');
  var src = fs.readFileSync(path.join(root, 'src/app/api/wave/push-transaction/route.js'), 'utf8');
  var at = src.indexOf('v55.83-XR (Codex 09:01 point 5)'); var blk = at > 0 ? src.substring(at, src.indexOf('BANK-SIDE ANCHOR', at)) : '';
  check('the hold sits BEFORE anything is claimed or sent, and keeps the route style (no arrows / template strings / const / let)', at > 0 && at < src.indexOf("update({ category_status: 'syncing' })") && !/=>/.test(blk) && !/`/.test(blk) && !/\b(const|let)\s/.test(blk));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
