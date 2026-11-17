// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TW / TX — Codex QA 17 Nov P1-1 and P1-3, run against the REAL route handlers (company-books, advances) with an
// in-memory database and stand-in sign-in / permission modules. Sensitive permissions DENIED unless the case grants them.
//   P1-1: Nextrade view alone never returns account balances or month totals.
//   P1-3: an advance funded from a PRIVATE bank line is hidden (entry and any balance that includes it) from people who
//         may not see private accounts; they cannot move it either.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('TW / TX — route access (real handlers)');

var state = { perms: {}, db: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.perms[perm] ? { ok: true } : { ok: false, status: 403 }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: false, mp: state.perms }); },
  userHasPermission: function (ctx, perm) { return !!(ctx && ctx.mp && ctx.mp[perm]); },
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var CB = require(path.join(root, 'src/app/api/accounting/company-books/route.js'));
var AD = require(path.join(root, 'src/app/api/accounting/advances/route.js'));
function call(mod, body) { return mod.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;

function seed() {
  var db = new FakeDb({ company_bill_links: [['source_bank_transaction_id']] });
  db.t.plaid_accounts = [{ plaid_account_id: 'NXT-OPEN', name: 'Nextrade checking', mask: '1111', type: 'depository', wave_business_id: 'NEXTRADE_BOOKS', current_balance: 12345, is_private: false },
    { plaid_account_id: 'NXT-PRIV', name: 'Nextrade private', mask: '2222', type: 'depository', wave_business_id: 'NEXTRADE_BOOKS', current_balance: 999, is_private: true },
    { plaid_account_id: 'KTC-PRIV', name: 'KTC private', mask: '3333', type: 'depository', wave_business_id: US, is_private: true },
    { plaid_account_id: 'KTC-OPEN', name: 'KTC ops', mask: '4444', type: 'depository', wave_business_id: US, is_private: false }];
  db.t.company_categories = [{ id: 'c1', company_id: 'NEXTRADE_BOOKS', key: 'money_from_ktc', label: 'Money from KTC', kind: 'transfer', active: true, sort: 1 }, { id: 'c2', company_id: 'NEXTRADE_BOOKS', key: 'elec', label: 'Electricity', kind: 'expense', active: true, sort: 2 }];
  db.t.bank_transactions = [{ id: 'L-open', wave_business_id: 'NEXTRADE_BOOKS', account_id: 'NXT-OPEN', direction: 'in', amount_abs: 5000, date: '2026-11-05', name: 'FROM KTC', company_category: 'money_from_ktc' },
    { id: 'L-priv', wave_business_id: 'NEXTRADE_BOOKS', account_id: 'NXT-PRIV', direction: 'out', amount_abs: 77, date: '2026-11-06', name: 'SECRET', company_category: null },
    { id: 'W-priv', wave_business_id: US, account_id: 'KTC-PRIV', direction: 'out', amount_abs: 5000, date: '2026-11-10', name: 'PRIVATE WIRE', third_party_payer: 'NextTrade Industries' },
    { id: 'W-open', wave_business_id: US, account_id: 'KTC-OPEN', direction: 'out', amount_abs: 2000, date: '2026-11-11', name: 'WIRE', third_party_payer: 'RTM Capital' }];
  db.t.paid_through_parties = [{ name: 'NextTrade Industries', kind: 'affiliate' }, { name: 'RTM Capital', kind: 'service_provider' }];
  db.t.party_money_entries = [{ id: 'e1', party: 'NextTrade Industries', bucket: 'advance', amount: 5000, kind: 'payment_split', bank_transaction_id: 'W-priv', reason: 'private-wire', created_by: 'u9', created_at: '2026-11-10T00:00:00Z' },
    { id: 'e2', party: 'RTM Capital', bucket: 'advance', amount: 300, kind: 'payment_split', bank_transaction_id: 'W-open', reason: 'ok', created_by: 'u9', created_at: '2026-11-11T00:00:00Z' }];
  db.t.vendor_bills = []; db.t.vendor_bill_payments = []; db.t.wire_packages = []; db.t.users = [];
  db.rpcs.hub_company_books_installed = function () { return { data: true, error: null }; };
  db.rpcs.hub_party_money_installed = function () { return { data: true, error: null }; };
  // stand-ins that mirror the SQL (sql/v55-83-TX-advances-fees.sql; the real SQL runs in the real-Postgres tests): they read
  // the WHOLE table, with no row cap — exactly what a database function does
  function restricted(dbx, party, hidden) {
    var lines = {}; (dbx.t.bank_transactions || []).forEach(function (l) { lines[l.id] = l; });
    return (dbx.t.party_money_entries || []).some(function (e) { if (e.party !== party || !e.bank_transaction_id) { return false; } var l = lines[e.bank_transaction_id]; return !l || !l.account_id || (hidden || []).indexOf(l.account_id) >= 0; });
  }
  db.rpcs.hub_party_pool_status = function (args, dbx) {
    var by = {}; (dbx.t.party_money_entries || []).forEach(function (e) { var b = by[e.party] || (by[e.party] = { party: e.party, advance: 0, fee: 0, entries: 0 }); b[e.bucket] = Math.round((b[e.bucket] + Number(e.amount)) * 100) / 100; b.entries++; });
    return { data: Object.keys(by).map(function (k) { by[k].restricted = restricted(dbx, k, args.p_hidden_accounts); return by[k]; }), error: null };
  };
  db.rpcs.hub_party_money = function (args, dbx) {
    db.lastMoney = args;
    if (args.p_hidden_accounts && restricted(dbx, args.p_party, args.p_hidden_accounts)) { return { data: null, error: { message: 'HUB_GUARD: ' + args.p_party + '\'s advance includes money from a private account — only someone allowed to see private accounts can move it.' } }; }
    return { data: { ok: true }, error: null };
  };
  return db;
}

(async function () {
  // ── P1-1 ──
  state.db = seed(); state.perms = { 'company.nextrade.view': true };
  var a = await call(CB, { action: 'accounts', company: 'nextrade' });
  check('Nextrade view only: accounts listed WITHOUT balances', a.ok && a.accounts.length === 1 && a.accounts.every(function (x) { return x.current_balance === undefined; }), a);
  check('… and the private account is not listed', a.accounts.every(function (x) { return x.plaid_account_id !== 'NXT-PRIV'; }));
  var t = await call(CB, { action: 'totals', company: 'nextrade' });
  check('Nextrade view only: month totals refused (no transfersIn number leaks)', t._status === 403 && !t.totals, t);
  state.perms = { 'company.nextrade.view': true, 'bank_balances.view': true, 'accounting.view_totals': true };
  var a2 = await call(CB, { action: 'accounts', company: 'nextrade' });
  var t2 = await call(CB, { action: 'totals', company: 'nextrade' });
  check('with "Bank: View Account Balances": balance shown', a2.accounts[0].current_balance === 12345);
  check('with "Bank & Financial Summary": totals shown (5,000 transfer in), private line still left out', t2.ok && t2.totals.transfersIn === 5000 && t2.totals.outTotal === 0, t2.totals);
  var l = await call(CB, { action: 'lines', company: 'nextrade' });
  check('lines: private-account line not returned', l.ok && l.lines.length === 1 && l.lines[0].id === 'L-open');
  state.perms = { 'company.nextrade.manage': true };
  var sc = await call(CB, { action: 'set_category', company: 'nextrade', ids: ['L-priv'], category_key: 'elec' });
  check('a private-account line cannot be categorized by someone not allowed', sc._status === 409 && !sc.ok, sc);
  var none = await call(CB, { action: 'lines' });
  check('no company named → refused (never KTC by default)', none._status === 400);

  // ── P1-3 ──
  state.db = seed(); state.perms = { 'accounting.view': true, 'bills.view': true };
  var s = await call(AD, { action: 'summary' });
  var nt = s.parties.filter(function (p) { return p.name === 'NextTrade Industries'; })[0];
  var rtm = s.parties.filter(function (p) { return p.name === 'RTM Capital'; })[0];
  check('no private permission: the private-wire entry is NOT returned (amount, date, reason, creator)', nt.entries.length === 0 && JSON.stringify(s).indexOf('private-wire') < 0, nt.entries);
  check('… and no balance that includes it (null, with the reason), not a filtered subtotal', nt.advance === null && /private account/.test(nt.balance_hidden), nt);
  check('no totals permission: RTM balance hidden too (sensitive total)', rtm.advance === null && /Financial Summary/.test(rtm.balance_hidden), rtm);
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true };
  var s2 = await call(AD, { action: 'summary' });
  var rtm2 = s2.parties.filter(function (p) { return p.name === 'RTM Capital'; })[0];
  var nt2 = s2.parties.filter(function (p) { return p.name === 'NextTrade Industries'; })[0];
  check('with totals permission: RTM balance (no private money) shown; NextTrade still hidden', rtm2.advance === 300 && nt2.advance === null);
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'bank.view_private': true };
  var s3 = await call(AD, { action: 'summary' });
  var nt3 = s3.parties.filter(function (p) { return p.name === 'NextTrade Industries'; })[0];
  check('allowed to see private accounts: the full balance and the entry', nt3.advance === 5000 && nt3.entries.length === 1);
  state.perms = { 'accounting.view': true, 'advances.manage': true };
  var mv = await call(AD, { action: 'to_fee', party: 'NextTrade Industries', amount: 100, reason: 'x', request_id: 'req-12345678' });
  check('cannot move an advance that includes private money without the private permission', mv._status === 409 && /private account/.test(mv.error), mv);
  var mv2 = await call(AD, { action: 'to_fee', party: 'RTM Capital', amount: 100, reason: 'x', request_id: 'req-12345679' });
  check('… but can move one with no private money', mv2.ok === true, mv2);

  // ── Codex recheck 17 Nov: MIXED public + private funding, then moves with NO bank line (conversion, bill paid from the
  //    advance). Policy: once private money is in a company's advance pool, a person who may not see private accounts sees
  //    NONE of that company's advance history or balance — the later moves could reveal the private amount.
  state.db = seed();
  state.db.t.bank_transactions.push({ id: 'W-open2', wave_business_id: US, account_id: 'KTC-OPEN', direction: 'out', amount_abs: 1000, date: '2026-11-12', name: 'PUBLIC WIRE', third_party_payer: 'NextTrade Industries' });
  state.db.t.party_money_entries.push(
    { id: 'e3', party: 'NextTrade Industries', bucket: 'advance', amount: 1000, kind: 'payment_split', bank_transaction_id: 'W-open2', reason: 'public', created_by: 'u9', created_at: '2026-11-12T00:00:00Z' },
    { id: 'e4', party: 'NextTrade Industries', bucket: 'advance', amount: -300, kind: 'advance_to_fee', reason: 'conv-secret', created_by: 'u9', created_at: '2026-11-13T00:00:00Z' },
    { id: 'e5', party: 'NextTrade Industries', bucket: 'fee', amount: 300, kind: 'advance_to_fee', reason: 'conv-secret', created_by: 'u9', created_at: '2026-11-13T00:00:00Z' },
    { id: 'e6', party: 'NextTrade Industries', bucket: 'advance', amount: -4500, kind: 'apply_to_bill', bill_id: 'B1', reason: 'apply-secret', created_by: 'u9', created_at: '2026-11-14T00:00:00Z' });
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true };
  var m1 = await call(AD, { action: 'summary' });
  var ntM = m1.parties.filter(function (x) { return x.name === 'NextTrade Industries'; })[0];
  var rtmM = m1.parties.filter(function (x) { return x.name === 'RTM Capital'; })[0];
  check('mixed funding, no private permission: NONE of NextTrade\u2019s advance history is returned — not the public split, not the conversion, not the bill paid from the advance', ntM.entries.length === 0 && JSON.stringify(m1).indexOf('conv-secret') < 0 && JSON.stringify(m1).indexOf('apply-secret') < 0 && JSON.stringify(m1).indexOf('4500') < 0, ntM.entries);
  check('… balance and fees hidden with the reason (never 1,000 public − 4,500 applied shown as a balance)', ntM.advance === null && ntM.fee === null && /private account/.test(ntM.balance_hidden));
  check('… a company with no private funding (RTM) is still shown in full', rtmM.advance === 300 && rtmM.entries.length === 1);
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'bank.view_private': true };
  var m2 = await call(AD, { action: 'summary' });
  var ntM2 = m2.parties.filter(function (x) { return x.name === 'NextTrade Industries'; })[0];
  check('allowed to see private accounts: the whole history (5 entries) and the true balance 1,200, fees 300', ntM2.entries.length === 5 && ntM2.advance === 1200 && ntM2.fee === 300, ntM2);
  state.perms = { 'accounting.view': true, 'advances.manage': true };
  var m3 = await call(AD, { action: 'apply', party: 'NextTrade Industries', amount: 10, bill_id: 'B1', request_id: 'req-mixed-01' });
  check('mixed funding: a mover without the private permission cannot use the pool at all', m3._status === 409 && /private account/.test(m3.error));
  var PM = require(path.join(root, 'src/lib/party-money.js'));
  var unresolved = PM.entriesVisibility([{ party: 'X', bank_transaction_id: 'gone', amount: 1 }, { party: 'X', kind: 'advance_to_fee', amount: 1 }], { all: false, hidden: {} }, {});
  check('a bank line that cannot be found counts as private (fails closed) — the whole company is hidden', unresolved.visible.length === 0 && unresolved.hiddenParty.x === true);

  // ── Codex 17 Nov 19:50: COMPLETE ledger, never a capped list. Old private funding + 5,000 newer moves (API cap 1,000/request)
  state.db = seed();
  for (var ix = 0; ix < 5000; ix++) { state.db.t.party_money_entries.push({ id: 'n' + ix, party: 'NextTrade Industries', bucket: 'advance', amount: -1, kind: 'apply_to_bill', bill_id: 'B' + ix, reason: 'derived', created_by: 'u9', created_at: '2026-12-' + (10 + (ix % 18)) + 'T00:00:00Z' }); }
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true };
  var lh = await call(AD, { action: 'summary' });
  var ntL = lh.parties.filter(function (x) { return x.name === 'NextTrade Industries'; })[0];
  check('long history: old private funding still hides the WHOLE pool after 5,000 newer moves (no -5,000 balance, no derived entries)', ntL.advance === null && ntL.entries.length === 0 && /private account/.test(ntL.balance_hidden), { advance: ntL.advance, n: ntL.entries.length, why: ntL.balance_hidden });
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'bank.view_private': true };
  var lh2 = await call(AD, { action: 'summary' });
  var ntL2 = lh2.parties.filter(function (x) { return x.name === 'NextTrade Industries'; })[0];
  check('long history, allowed: balance over the COMPLETE ledger (5,000 − 5,000 = 0), history shown is only the latest 200 and says so', ntL2.advance === 0 && ntL2.entries.length === 200 && /latest 200 of 5001/.test(ntL2.history_note || ''), { advance: ntL2.advance, n: ntL2.entries.length, note: ntL2.history_note });
  check('… the 200 shown are the NEWEST ones (order honoured)', ntL2.entries.every(function (e) { return e.created_at >= '2026-12-1'; }));
  // money moves: the private-money rule is checked by the database itself, over the whole ledger, inside the move
  state.db = seed(); state.perms = { 'accounting.view': true, 'advances.manage': true };
  state.db.t.bank_transactions = state.db.t.bank_transactions.filter(function (l) { return l.id !== 'W-priv'; }); // the private source line is gone
  var mv0 = await call(AD, { action: 'to_fee', party: 'NextTrade Industries', amount: 100, reason: 'x', request_id: 'req-missing-01' });
  check('source line missing: the move is refused (fails closed), and the database was told which accounts this person may not see', mv0._status === 409 && /private account/.test(mv0.error) && Array.isArray(state.db.lastMoney.p_hidden_accounts), mv0);
  state.db = seed(); state.db.t.bank_transactions.forEach(function (l) { if (l.id === 'W-priv') { l.account_id = null; } });
  var mv1 = await call(AD, { action: 'to_fee', party: 'NextTrade Industries', amount: 100, reason: 'x', request_id: 'req-nullacct-1' });
  check('source line with no account: refused', mv1._status === 409);
  state.db = seed();
  for (var jx = 0; jx < 1500; jx++) { state.db.t.bank_transactions.push({ id: 'Wpub' + jx, wave_business_id: US, account_id: 'KTC-OPEN', direction: 'out', amount_abs: 1, date: '2026-11-01' }); state.db.t.party_money_entries.unshift({ id: 'p' + jx, party: 'NextTrade Industries', bucket: 'advance', amount: 1, kind: 'payment_split', bank_transaction_id: 'Wpub' + jx, created_by: 'u9', created_at: '2026-11-01T00:00:00Z' }); }
  var mv2 = await call(AD, { action: 'to_fee', party: 'NextTrade Industries', amount: 100, reason: 'x', request_id: 'req-beyond-1000' });
  check('private funding listed AFTER 1,500 public sources: still refused (no first-1,000 cut-off)', mv2._status === 409, mv2);
  state.perms = { 'accounting.view': true, 'advances.manage': true, 'bank.view_private': true };
  var mv3 = await call(AD, { action: 'to_fee', party: 'NextTrade Industries', amount: 100, reason: 'x', request_id: 'req-private-ok' });
  check('someone allowed to see private accounts: the database gets no restriction (null) and the move goes ahead', mv3.ok === true && state.db.lastMoney.p_hidden_accounts === null, mv3);
  var advSrc = require('fs').readFileSync(path.join(root, 'src/app/api/accounting/advances/route.js'), 'utf8');
  check('advances route: no capped ledger read (.limit(5000)) and no first-1,000 slice left', advSrc.indexOf('limit(5000)') < 0 && advSrc.indexOf('slice(0, 1000)') < 0 && advSrc.indexOf("db.rpc('hub_party_pool_status'") >= 0);
  var dbCap = new FakeDb(); dbCap.t.x = []; for (var cx = 0; cx < 1500; cx++) { dbCap.t.x.push({ id: cx }); }
  var capR = await dbCap.from('x').select('id'); var capP = await dbCap.from('x').select('id').order('id', { ascending: false }).range(1000, 1999);
  check('the test database honours the 1,000-row cap, order and pages (so a missed page shows up in tests)', capR.data.length === 1000 && capP.data.length === 500 && capP.data[0].id === 499);

  console.log('\nTW/TX route access: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
