// ════════════════════════════════════════════════════════════════════════════
// v55.83-TO — Codex QA 16 Nov P1s on bill payments. Runs the REAL bills route on an in-memory database:
//  • a failed read (bank line payments, bill payments, bills, wires) → NOTHING is written (fail closed)
//  • the payment buttons stay off until the database guards are installed
//  • money actions need a verified sign-in, not a user_id in the body
//  • the same click sent twice (lost answer) pays once
//  • the database guard's refusal comes back as a plain 409, nothing paid
//  • bill history keeps two real payments made in the same minute
// The SQL guard itself (locks + re-sum) is tested on a real Postgres engine in scratchpad PGlite (see handoff).
// ════════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var fs = require('fs');
var MemDB = require('./helpers/memdb-wires.js');
var US_BIZ = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }

var BANK = '70000000-0000-0000-0000-0000000000a1';
var B1 = 'b0000000-0000-0000-0000-0000000000a1', B2 = 'b0000000-0000-0000-0000-0000000000a2';
function freshDb() {
  var d = new MemDB({
    users: [{ id: 'u1', name: 'Payer', role: 'staff', active: true }],
    module_permissions: ['accounting.view', 'bills.manage'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    vendor_bills: [{ id: B1, vendor_name: 'AMB', bill_number: 'T-1', total_amount: 60, record_status: 'active' }, { id: B2, vendor_name: 'ONTREK', bill_number: 'F-1', total_amount: 80, record_status: 'active' }],
    vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], hub_audit_log: [], vendor_bill_events: [],
    bank_transactions: [{ id: BANK, date: '2026-11-10', amount_abs: 100, direction: 'out', pending: false, name: 'WIRE', wave_business_id: US_BIZ }]
  });
  d.rpcs = { hub_payment_guards_installed: function () { return true; } };
  return d;
}
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\\/]verified-caller(\.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
global.__db = freshDb();
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(body) { var res = await bills.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: { get: function () { return null; } } }); var j = await res.json(); j._status = res.status; return j; }
function paysIn(d) { return (d.t.vendor_bill_payments || []).length; }
// a table whose READS fail (the write path must not go on)
function failReads(d, table) {
  var realFrom = d.from.bind(d);
  d.from = function (t) {
    if (t !== table) { return realFrom(t); }
    var real = realFrom(t); var failing = false;
    var proxy = new Proxy(real, { get: function (o, k) {
      if (k === 'select') { return function () { failing = true; o.select.apply(o, arguments); return proxy; }; }
      if (k === 'then') { return failing ? function (res) { return Promise.resolve({ data: null, error: { message: 'simulated read failure' } }).then(res); } : (o.then ? o.then.bind(o) : undefined); }
      if (k === 'maybeSingle' || k === 'single') { return function () { return failing ? Promise.resolve({ data: null, error: { message: 'simulated read failure' } }) : o[k](); }; }
      var v = o[k]; return typeof v === 'function' ? function () { var r0 = v.apply(o, arguments); return r0 === o ? proxy : r0; } : v;
    } });
    return proxy;
  };
}
var pay = { action: 'pay_bills_from_bank', bank_transaction_id: BANK, bills: [{ bill_id: B1, amount: 60 }, { bill_id: B2, amount: 40 }] };

(async function () {
  console.log('TO — bill payments: fail closed, guarded, verified, once per click');

  global.__db = freshDb(); failReads(global.__db, 'vendor_bill_payments');
  var r1 = await call(pay);
  check('pay from bank: reading what is already paid FAILS → refused (503), nothing written', r1._status === 503 && /nothing was paid/.test(r1.error) && paysIn(global.__db) === 0, r1);

  global.__db = freshDb(); failReads(global.__db, 'vendor_bills');
  var r2 = await call(pay);
  check('pay from bank: reading the bills FAILS → refused, nothing written', r2._status === 503 && paysIn(global.__db) === 0, r2);

  global.__db = freshDb(); failReads(global.__db, 'bank_transactions');
  var r3 = await call(pay);
  check('pay from bank: reading the bank line FAILS → refused (not "not found"), nothing written', r3._status === 503 && paysIn(global.__db) === 0, r3);

  global.__db = freshDb(); failReads(global.__db, 'vendor_bill_payments');
  var r4 = await call({ action: 'record_payment', bill_id: B1, amount: 10, paid_date: '2026-11-10', bank_transaction_id: BANK });
  check('record one payment: a failed read → refused, nothing written', r4._status === 503 && paysIn(global.__db) === 0, r4);

  global.__db = freshDb(); failReads(global.__db, 'vendor_bill_payments');
  var r5 = await call({ action: 'bank_lines_for_bills' });
  check('bank lines to pay from: a failed read shows an error, never made-up free amounts', r5._status === 503 && !r5.lines, r5);

  global.__db = freshDb(); global.__db.rpcs = {};
  var r6 = await call(pay);
  check('the guards are NOT installed → paying is switched off with the instruction, nothing written', r6._status === 503 && /v55-83-TO-payment-guards\.sql/.test(r6.error) && paysIn(global.__db) === 0, r6);
  var r6b = await call({ action: 'record_payment', bill_id: B1, amount: 10, paid_date: '2026-11-10', bank_transaction_id: BANK });
  check('…the same for recording one payment', r6b._status === 503 && paysIn(global.__db) === 0, r6b);

  global.__db = freshDb();
  var r7 = await call(Object.assign({ _no_token: true }, pay));
  check('no verified sign-in → 401, nothing written (a user_id in the body is not enough)', r7._status === 401 && paysIn(global.__db) === 0, r7);

  global.__db = freshDb();
  var r8 = await call(Object.assign({ request_id: 'click-0000001' }, pay));
  var r8b = await call(Object.assign({ request_id: 'click-0000001' }, pay));
  check('a good payment goes through: 60 + 40 from the 100 bank line', r8.ok === true && r8.paid === 2 && paysIn(global.__db) === 2, r8);
  check('the SAME click sent again (lost answer) → "already recorded", still only 2 payments', r8b.ok === true && r8b.already_recorded === true && paysIn(global.__db) === 2, r8b);
  check('every payment carries its request id', global.__db.t.vendor_bill_payments.every(function (p) { return p.request_id === 'click-0000001'; }));

  global.__db = freshDb();
  var realFrom2 = global.__db.from.bind(global.__db);
  global.__db.from = function (t) { var q = realFrom2(t); if (t === 'vendor_bill_payments') { var ins = q.insert.bind(q); q.insert = function () { return { select: function () { return Promise.resolve({ data: null, error: { message: 'HUB_GUARD: that bank line is 100.00; bills paid from it would come to 160.00 — over by 60.00.' } }); } }; }; } return q; };
  var r9 = await call(pay);
  check('the DATABASE guard refuses (someone paid at the same moment) → plain 409, nothing written', r9._status === 409 && /over by 60\.00/.test(r9.error) && /Nothing was paid/.test(r9.error) && paysIn(global.__db) === 0, r9);

  global.__db = freshDb();
  global.__db.t.hub_audit_log = [
    { at: '2026-11-17T10:00:05Z', actor_id: 'u1', action: 'bill_payment_recorded', entity: 'vendor_bill', entity_id: B2, details: { payment_id: 'p1', amount: 20 } },
    { at: '2026-11-17T10:00:40Z', actor_id: 'u1', action: 'bill_payment_recorded', entity: 'vendor_bill', entity_id: B2, details: { payment_id: 'p2', amount: 20 } }];
  global.__db.t.vendor_bill_events = [{ created_at: '2026-11-17T10:00:06Z', actor_id: 'u1', kind: 'payment_recorded', bill_id: B2, details: { amount: 20 } }];
  var h = await call({ action: 'bill_history', id: B2 });
  var hp = (h.rows || []).filter(function (x) { return x.action === 'bill_payment_recorded'; });
  check('history: two REAL payments in the same minute both show; the copy of the same event in bill events does not', hp.length === 2, h.rows);

  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  check('static: every money action is behind verifiedCaller', /MONEY_ACTIONS = \{ record_payment: 1, void_payment: 1, pay_bills_from_bank: 1, bank_lines_for_bills: 1 \}/.test(src) && /verifiedCaller\(req, body, createClient\)/.test(src));
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-TO-payment-guards.sql'), 'utf8');
  check('static: the SQL locks the bank line and the bill, then re-adds under the lock, for every writer (trigger)', /pg_advisory_xact_lock\(hashtextextended\('hub-bank-line:'/.test(sql) && /pg_advisory_xact_lock\(hashtextextended\('hub-bill:'/.test(sql) && /CREATE TRIGGER hub_guard_bill_payment AFTER INSERT OR UPDATE/.test(sql) && /CREATE TRIGGER hub_guard_deposit_link AFTER INSERT OR UPDATE/.test(sql));
  var ui = ['BillsTab', 'AllTransactionsTab', 'BooksHomeTab'].map(function (n) { return fs.readFileSync(path.join(root, 'src/components/' + n + '.jsx'), 'utf8'); });
  check('static: the screens that pay bills send the verified sign-in (hubFetch) and never the plain fetch', ui.every(function (t) { return /hubFetch\('\/api\/accounting\/bills'/.test(t) && !/\bfetch\('\/api\/accounting\/bills'/.test(t); }));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
