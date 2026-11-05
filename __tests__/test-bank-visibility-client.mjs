import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function sourceModule(path) {
  return import('data:text/javascript;base64,' + Buffer.from(await fs.readFile(new URL(path, import.meta.url), 'utf8')).toString('base64'));
}
const { createBankVisibilityStore, bankSessionHeaders } = await sourceModule('../src/lib/bank-visibility-client.js');
const { canViewBankBalances, canViewFullDashboard, canMatchPayments, canClassify, canViewInvoices } = await sourceModule('../src/lib/bank-permissions.js');
const { dashboardCashFlow, dashboardCurrencyRows } = await sourceModule('../src/lib/dashboard-financial-data.js');

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 14; i += 1) await Promise.resolve(); };
function response(caps, status = 200, type = 'application/json') {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => type }, json: async () => ({ ok: true, capabilities: caps }) };
}
const allowed = { canViewFullDashboard: true, canViewBankBalances: true, isVerifiedSuperAdmin: true };
const denied = { canViewFullDashboard: false, canViewBankBalances: false, isVerifiedSuperAdmin: false };

function events() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name) { for (const fn of listeners.get(name) || []) fn(); },
    count(name) { return listeners.get(name)?.size || 0; },
  };
}
function fixture(initial = () => Promise.resolve(response(denied))) {
  const win = events(), doc = events(), timers = new Map(), intervals = new Map(), requests = [];
  let authCallback, nextTimer = 1, token = 'actual-session-token', getSessionCalls = 0;
  let fetchImpl = initial;
  const client = { auth: {
    async getSession() { getSessionCalls += 1; return { data: { session: token ? { access_token: token } : null } }; },
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() { authCallback = null; } } } }; },
  } };
  const store = createBankVisibilityStore({ client, window: win, document: doc,
    fetch(url, options) { requests.push({ url, options }); return fetchImpl(url, options); },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = nextTimer++; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  return { store, client, win, doc, timers, intervals, requests,
    setFetch(fn) { fetchImpl = fn; }, setToken(value) { token = value; },
    auth(event) { authCallback?.(event); }, sessionCalls() { return getSessionCalls; },
    runTimeout(delay) { for (const [id, item] of [...timers]) if (item.delay === delay) { timers.delete(id); item.fn(); } },
  };
}

let count = 0;
async function test(name, fn) { await fn(); count += 1; console.log('PASS ' + name); }

await test('separate balance capability never inherits admin, finance or transaction grants', async () => {
  for (const role of ['super_admin', 'admin', 'owner', 'accounting_manager', 'staff']) {
    assert.equal(canViewBankBalances(false, { 'finance.admin': true, 'bank.view_account_balances': true }, role), false);
  }
  assert.equal(canViewBankBalances(true), false);
  assert.equal(canViewBankBalances({ canViewBankBalances: true }), true);
  assert.equal(canViewBankBalances({ canViewBankBalances: false, isVerifiedSuperAdmin: true }), false);
  assert.equal(canViewFullDashboard({ canViewBankBalances: true }), false);
  assert.equal(canViewFullDashboard({ canViewFullDashboard: true }), true);
  assert.equal(canViewFullDashboard(false, { 'finance.admin': true }, 'super_admin'), false);
  assert.equal(canMatchPayments(false, { 'payments.match': true }), true);
  assert.equal(canClassify(false, { 'bank.classify': true }), true);
  assert.equal(canViewInvoices(false, { 'invoice.view': true }, 'staff'), true);
});

await test('full dashboard and banking grants stay independent in both directions', async () => {
  const f = fixture(() => Promise.resolve(response({ ...denied, canViewFullDashboard: true })));
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  assert.equal(f.store.getSnapshot().canViewFullDashboard, true);
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  f.setFetch(() => Promise.resolve(response({ ...denied, canViewBankBalances: true })));
  await f.store.refresh();
  assert.equal(f.store.getSnapshot().canViewFullDashboard, false);
  assert.equal(f.store.getSnapshot().canViewBankBalances, true);
  f.setFetch(() => Promise.resolve(response(allowed))); await f.store.refresh();
  assert.equal(f.store.getSnapshot().canViewFullDashboard, true);
  assert.equal(f.store.getSnapshot().canViewBankBalances, true);
  f.auth('SIGNED_OUT');
  assert.equal(f.store.getSnapshot().canViewFullDashboard, false);
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  unsubscribe();
});

await test('dashboard cash-flow excludes bank totals without the independent banking grant', async () => {
  const rows = [
    { id: 'old', transaction_date: '2026-09-30', cash_in: 9999, bank_in: 99999 },
    { id: 'cash', transaction_date: '2026-10-20', cash_in: 100, cash_out: 25 },
    { id: 'bank', transaction_date: '2026-10-21', bank_in: 4000, bank_out: 700 },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(dashboardCashFlow(rows, '2026-10-01', false), { incoming: 100, outgoing: 25, net: 75 });
  assert.deepEqual(dashboardCashFlow(rows, '2026-10-01', true), { incoming: 4100, outgoing: 725, net: 3375 });
  assert.deepEqual(dashboardCashFlow(rows, '2026-10-01', { canViewFullDashboard: true }), { incoming: 100, outgoing: 25, net: 75 });
  assert.deepEqual(rows, before);
});

await test('foreign-currency dashboard summaries cannot expose bank rows through alternate fields', async () => {
  const rows = [
    { id: 'usd-cash', usd_in: 30 },
    { id: 'eur-cash', foreign_currency: 'EUR', foreign_amount: 80, foreign_direction: 'in' },
    { id: 'bank-amount', bank_in: 500, usd_in: 500 },
    { id: 'bank-match', matched_bank_txn_id: 'bank-1', usd_out: 100 },
    { id: 'bank-account', bank_account_id: 'account-1', foreign_currency: 'EUR', foreign_amount: 900 },
    { id: 'bank-pending', is_bank_placeholder: true, usd_in: 700 },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(dashboardCurrencyRows(rows, false).map(row => row.id), ['usd-cash', 'eur-cash']);
  assert.equal(dashboardCurrencyRows(rows, false)[1].foreign_currency, 'EUR');
  assert.equal(dashboardCurrencyRows(rows, true).length, rows.length);
  assert.deepEqual(rows, before);
});

await test('starts denied and sends real session bearer with no-store and no redirects', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const unsubscribe = f.store.subscribe(() => {});
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  await flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/bank-visibility');
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer actual-session-token');
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal(f.requests[0].options.redirect, 'error');
  pending.resolve(response(allowed)); await flush();
  assert.equal(f.store.getSnapshot().canViewBankBalances, true);
  unsubscribe();
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
});

await test('shared subscriptions use one poll and clear their in-memory capability after last unmount', async () => {
  const f = fixture(() => Promise.resolve(response(allowed)));
  const first = f.store.subscribe(() => {}), second = f.store.subscribe(() => {});
  await flush();
  assert.equal(f.requests.length, 1); assert.equal(f.intervals.size, 1);
  assert.equal([...f.intervals.values()][0].delay, 60000);
  first(); assert.equal(f.store.getSnapshot().canViewBankBalances, true);
  second(); assert.equal(f.intervals.size, 0); assert.equal(f.win.count('focus'), 0);
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
});

await test('signout immediately clears permission and an in-flight old response cannot restore it', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  f.setToken(null); f.auth('SIGNED_OUT');
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  assert.equal(f.requests[0].options.signal.aborted, true);
  pending.resolve(response(allowed)); await flush();
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  f.win.fire('focus'); await flush(); assert.equal(f.requests.length, 1);
  unsubscribe();
});

await test('sign-in refresh happens after the auth callback and cannot reuse another user permission', async () => {
  const f = fixture(() => Promise.resolve(response(allowed)));
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  assert.equal(f.store.getSnapshot().canViewBankBalances, true);
  const before = f.sessionCalls();
  f.setToken('new-session-token'); f.setFetch(() => Promise.resolve(response(denied))); f.auth('SIGNED_IN');
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  assert.equal(f.sessionCalls(), before);
  f.runTimeout(0); await flush();
  assert.equal(f.requests.at(-1).options.headers.Authorization, 'Bearer new-session-token');
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  unsubscribe();
});

await test('newer denial wins over a delayed prior permission response', async () => {
  const older = deferred(), f = fixture(() => older.promise);
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  f.setFetch(() => Promise.resolve(response(denied)));
  await f.store.refresh();
  older.resolve(response(allowed)); await flush();
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  unsubscribe();
});

await test('permission-change event immediately clears old access and rechecks server', async () => {
  const f = fixture(() => Promise.resolve(response(allowed)));
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  const pending = deferred(); f.setFetch(() => pending.promise);
  f.win.fire('bank-visibility-changed');
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  await flush(); pending.resolve(response(denied)); await flush();
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  unsubscribe();
});

await test('automatic interval, focus and visibility recheck permissions without a manual refresh', async () => {
  const f = fixture(() => Promise.resolve(response(allowed)));
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  f.setFetch(() => Promise.resolve(response(denied)));
  [...f.intervals.values()][0].fn(); await flush();
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  f.doc.visibilityState = 'hidden'; const countBefore = f.requests.length;
  f.win.fire('focus'); await flush(); assert.equal(f.requests.length, countBefore);
  f.doc.visibilityState = 'visible'; f.doc.fire('visibilitychange'); await flush();
  assert.equal(f.requests.length, countBefore + 1);
  f.win.fire('focus'); await flush(); assert.equal(f.requests.length, countBefore + 2);
  unsubscribe();
});

await test('missing session, HTTP failures, HTML and malformed capability payloads all fail closed', async () => {
  const f = fixture(() => Promise.resolve(response(allowed)));
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  for (const bad of [response(allowed, 403), response(allowed, 503), response(allowed, 200, 'text/html'), response({ role: 'super_admin', 'finance.admin': true }), response({ canViewBankBalances: 'true', isVerifiedSuperAdmin: false }), response({ canViewBankBalances: true, isVerifiedSuperAdmin: true })]) {
    f.setFetch(() => Promise.resolve(bad)); await f.store.refresh();
    assert.equal(f.store.getSnapshot().canViewBankBalances, false);
    assert.equal(f.store.getSnapshot().canViewFullDashboard, false);
    assert.equal(f.store.getSnapshot().isVerifiedSuperAdmin, false);
  }
  f.setToken(null); const countBefore = f.requests.length;
  await f.store.refresh(); assert.equal(f.requests.length, countBefore);
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  unsubscribe();
});

await test('verification timeout revokes cached access and session headers never fabricate identity', async () => {
  const f = fixture(() => Promise.resolve(response(allowed)));
  const unsubscribe = f.store.subscribe(() => {}); await flush();
  f.setFetch((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })))));
  const pending = f.store.refresh(); await flush(); f.runTimeout(10000); await pending;
  assert.equal(f.store.getSnapshot().canViewBankBalances, false);
  assert.deepEqual(await bankSessionHeaders(f.client, true), { Authorization: 'Bearer actual-session-token', 'Content-Type': 'application/json' });
  f.setToken(null); await assert.rejects(bankSessionHeaders(f.client, true), /Sign in/);
  unsubscribe();
});

console.log(count + ' bank visibility client tests passed.');
