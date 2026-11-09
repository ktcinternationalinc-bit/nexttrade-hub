// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RN — Max, Nov 9 20:18: "I tried selecting a category from the all
// transactions sections and nothing updated after I selected from the drop down"
// The REAL route runs on an in-memory database: pick a category for one bank
// line → saved, rule learned, reviewed when fully accounted for; the list
// reloads WITH the new category and the wire tags. On screen: the pick shows at
// once ("saving…" → "✓ saved"), only that row waits, a failure puts the old
// value back WITH the reason — never a silent nothing.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Staff', role: 'staff', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'bank.classify'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  expense_categories: [{ key: 'bank_fees', label: 'Bank fees', kind: 'expense', active: true }, { key: 'freight', label: 'Freight', kind: 'expense', active: true }],
  bank_transactions: [
    { id: 'a1000000-0000-0000-0000-000000000001', date: '2026-11-05', amount_abs: 35, direction: 'out', name: 'WIRE FEE', merchant_name: null, wave_business_id: US, review_status: 'needs_review', classification: null, account_id: 'acc1', pending: false },
    { id: 'a1000000-0000-0000-0000-000000000002', date: '2026-11-06', amount_abs: 900, direction: 'out', name: 'WIRE TO RTM', merchant_name: null, wave_business_id: US, review_status: 'reviewed', classification: null, account_id: 'acc1', pending: false },
  ],
  plaid_accounts: [{ plaid_account_id: 'acc1', name: 'Checking', mask: '1234', wave_business_id: US }],
  wire_packages: [{ id: 'p1', seq: 7, status: 'attached', payee_name: 'RTM Capital', bank_transaction_id: 'a1000000-0000-0000-0000-000000000002' }],
  us_expense_rules: [], vendor_bill_payments: [], accounting_invoice_payments: [], unapplied_deposits: [], hub_audit_log: [], audit_log: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var route = require(path.join(root, 'src/app/api/accounting/expense-rules/route.js'));
async function call(body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name + '  ' + JSON.stringify(extra || '').substring(0, 500)); } }
console.log('RN — picking a category in All Transactions');
(async function () {
  var r = await call({ action: 'bulk_classify', payload: { ids: ['a1000000-0000-0000-0000-000000000001'], classification: 'bank_fees', single_pick: true } });
  ok('1: the pick is SAVED on the bank line (1 row updated)', r.ok && r.updated === 1 && db.t.bank_transactions[0].classification === 'bank_fees', r);
  var bad = await call({ action: 'bulk_classify', payload: { ids: ['a1000000-0000-0000-0000-000000000001'], classification: 'no_such_cat', single_pick: true } });
  ok('2: an unknown category is refused with the reason (and nothing changes)', !bad.ok && /Unknown category/.test(bad.error) && db.t.bank_transactions[0].classification === 'bank_fees', bad);
  var ghost = await call({ action: 'bulk_classify', payload: { ids: ['a1000000-0000-0000-0000-00000000dead'], classification: 'freight', single_pick: true } });
  ok('3: a line that no longer exists → updated 0 (the screen then says "Nothing was saved")', ghost.ok && ghost.updated === 0, ghost);
  var list = await call({ action: 'all_transactions', payload: { from: '2026-11-01', to: '2026-11-09' } });
  var l1 = list.ok && list.transactions.filter(function (t) { return t.id === 'a1000000-0000-0000-0000-000000000001'; })[0];
  var l2 = list.ok && list.transactions.filter(function (t) { return t.id === 'a1000000-0000-0000-0000-000000000002'; })[0];
  ok('4: the reloaded list shows the NEW category', l1 && l1.classification === 'bank_fees', list.error || l1);
  ok('5: …and the wire line carries its WP- tag (RM)', l2 && l2.wire && l2.wire.label === 'WP-0007', l2);
  var T = R('src/components/AllTransactionsTab.jsx');
  ok('6: on screen the pick shows AT ONCE, "saving…" then "✓ saved"; only that row waits (the rest stay usable)', T.indexOf("patchRow(t.id, { classification: key, _saving: true })") > 0 && T.indexOf('✓ saved') > 0 && T.indexOf('disabled={!!rowBusy[t.id] || t.pending}') > 0);
  ok('7: a failure puts the old category back AND says why; a timeout / bad reply is a message, never silence', T.indexOf("patchRow(t.id, { classification: before, _saving: false }); toast.error(") > 0 && T.indexOf('The server did not answer properly (HTTP ') > 0 && T.indexOf("j = { ok: false, error: 'Nothing was saved") > 0);
  ok('8: the list refreshes quietly behind the pick (no full-screen lock)', T.indexOf('quietReload();') > 0);
  ok('9: a pending line says why it cannot be picked yet', T.indexOf('pending — pick after it settles') > 0);
  ok('10: "➕ create the bill from this transaction" still works now that a bill # is required (numbered from the bank line)', T.indexOf("bill_number: 'BANK-' + String(t.posted_date || t.date || '')") > 0);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { process.exit(1); }
})().catch(function (e) { console.log('CRASH', e.stack); process.exit(1); });
