// Execute the actual Plaid routes. Bank HTTP, auth, DB and downstream matchers are isolated stand-ins.
const assert = require('assert/strict');
const path = require('path');
require('sucrase/register');
const { FakeDb } = require('./fake-supabase');
const root = path.resolve(__dirname, '..');
const state = { db: null, raw: [], wireRuns: 0, settle: {}, reply: null };
function stub(file, exports) { const id = require.resolve(path.join(root, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('src/app/api/plaid/_auth.js', {
  authorizePlaidOperation: async () => ({ db: state.db, via: 'cron' }),
  plaidJson: (body, options) => Response.json(body, options),
  plaidError: e => { console.error(e.stack); return Response.json({ error: e.message }, { status: 500 }); },
  configuredPlaidCron: () => true, isPlaidCron: () => true
});
stub('src/lib/bank-visibility.js', { readBankJson: r => r.json(), projectPlaidAccountMetadata: x => x });
stub('src/lib/account-twins-server.js', { accountTwins: async () => ({ new: ['new', 'old'] }) });
stub('src/lib/bank-continue.js', { hubNewestForConnection: async () => ({ others: ['old'] }) });
stub('src/lib/wire-auto-match.js', { autoMatchSentWires: async () => { state.wireRuns++; return { matched: [] }; } });
stub('src/lib/duplicates-server.js', { autoTwinCheck: async () => ({}) });
stub('src/lib/private-accounts-server.js', { privateScope: async () => ({}), dropPrivate: x => x });
stub('src/lib/expense-rules-server.js', { runRulesAndRecord: async () => ({ applied: 0 }) });
stub('src/lib/pending-settle-server.js', { oldestPendingDate: async () => null, settlePendingLines: async () => state.settle });
const client = require.resolve('@supabase/supabase-js');
require.cache[client] = { id: client, filename: client, loaded: true, exports: { createClient: () => state.db } };
const route = require('../src/app/api/plaid/transactions/route');
const scheduled = require('../src/app/api/plaid/sync/route');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.PLAID_CLIENT_ID = 'fixture'; process.env.PLAID_SECRET = 'fixture';
process.env.NEXT_PUBLIC_APP_URL = 'http://fixture.invalid';
global.fetch = async url => {
  if (String(url).endsWith('/api/plaid/transactions')) return Response.json(state.reply);
  if (!String(url).endsWith('/transactions/get')) throw new Error('Unexpected external request: ' + url);
  return Response.json({ transactions: state.raw, accounts: [{ account_id: 'new', type: 'depository' }], total_transactions: state.raw.length });
};
function fresh() {
  const db = new FakeDb();
  db.t.bank_connections = [{ id: 'conn', wave_business_id: 'biz', access_token: 'fixture', last_successful_posted_date: '2026-11-17' }];
  db.t.plaid_accounts = [{ connection_id: 'conn', plaid_account_id: 'new', wave_business_id: 'biz' }];
  db.t.wave_business_registry = [{ wave_business_id: 'biz', label: 'fixture', is_production: false }];
  db.t.bank_transactions = [];
  const from = db.from;
  db.from = table => {
    const q = from(table);
    q.like = (key, pattern) => { q.filters.push(r => String(r[key] || '').startsWith(pattern.replace(/%$/, ''))); return q; };
    const upsert = q.upsert;
    q.upsert = (rows, options) => {
      if (!Array.isArray(rows)) return upsert.call(q, rows, options);
      return { then(resolve, reject) { return (async () => {
        for (const row of rows) { const r = await from(table).upsert(row, options); if (r.error) return r; }
        return { error: null };
      })().then(resolve, reject); } };
    };
    return q;
  };
  state.db = db; state.settle = {}; state.wireRuns = 0;
  state.raw = [{ transaction_id: 'posted', account_id: 'new', date: '2026-11-17', amount: -8000, pending: false }];
  return db;
}
const call = () => route.POST(new Request('http://fixture/api', { method: 'POST', body: JSON.stringify({ connection_id: 'conn' }) })).then(r => r.json());
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
(async () => {
  let db = fresh();
  db.t.bank_transactions.push({ id: 'old-hold', account_id: 'old', plaid_transaction_id: 'hold', date: '2026-11-17', amount_abs: 8000, direction: 'in', pending: true });
  let result = await call();
  check('Actual ingestion does not discard posted money because of old pending twin', () => assert.equal(result.synced, 1, JSON.stringify(result)));
  check('Posted row saved and existing wire matcher runs afterwards', () => { assert(db.t.bank_transactions.some(t => t.plaid_transaction_id === 'posted' && t.pending === false)); assert.equal(state.wireRuns, 1); });
  db = fresh();
  db.t.bank_transactions.push({ id: 'same', account_id: 'new', plaid_transaction_id: 'posted', date: '2026-11-17', amount_abs: 8000, direction: 'in', pending: true, classification: 'customer_payment', linked_id: 'existing-payment' }, { id: 'import', account_id: 'old', plaid_transaction_id: 'manual-a', date: '2026-11-17', amount_abs: 8000, direction: 'in', pending: false });
  await call();
  check('Actual same-ID posting updates status and preserves accounting fields', () => { const row = db.t.bank_transactions.find(t => t.id === 'same'); assert.equal(row.pending, false); assert.equal(row.linked_id, 'existing-payment'); assert.equal(row.classification, 'customer_payment'); });
  await call();
  check('Repeat ingestion creates no additional transaction', () => assert.equal(db.t.bank_transactions.length, 2));
  state.settle = { errors: 1 };
  result = await call();
  check('Settlement failure persisted as partial, not healthy sync', () => { assert.equal(db.t.bank_connections[0].last_sync_status, 'partial'); assert(result.settlement_warning); });
  state.reply = result;
  let summary = await scheduled.GET(new Request('http://fixture/api/plaid/sync')).then(r => r.json());
  check('Scheduled route reports partial failure and logs unsuccessful reconciliation', () => { assert.equal(summary.ok, false); assert.equal(summary.results[0].ok, false); assert.equal(db.t.wave_sync_log[0].success, false); });
  state.settle = {};
  state.reply = await call();
  summary = await scheduled.GET(new Request('http://fixture/api/plaid/sync')).then(r => r.json());
  check('Healthy retry clears connection warning and scheduled result', () => { assert.equal(summary.ok, true); assert.equal(db.t.bank_connections[0].last_sync_error, null); });
  db = fresh();
  state.raw=[{transaction_id:'hold-new',account_id:'new',date:'2026-11-19',amount:-4321,pending:true,name:'Wire TRN: FIXTURE0001AB',iso_currency_code:'USD'}];
  db.t.bank_transactions.push({id:'hold-old',plaid_transaction_id:'hold-old',account_id:'old',date:'2026-11-19',amount_abs:4321,direction:'in',pending:true,name:'Wire TRN: FIXTURE0001AB',iso_currency:'USD',wave_business_id:'biz'});
  result=await call();
  check('actual route suppresses duplicate pending from second active connection',()=>{assert.equal(result.synced,0);assert.equal(result.manual_deduped,1);assert.equal(db.t.bank_transactions.length,1);});
  state.raw[0].pending=false;
  result=await call();
  check('actual route imports final posted money despite pending twin',()=>{assert.equal(result.synced,1);assert(db.t.bank_transactions.some(t=>t.plaid_transaction_id==='hold-new'&&t.pending===false));});
  console.log(passed + ' passed, 0 failed');
})().catch(e => { console.error(e); process.exitCode = 1; });
