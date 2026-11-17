// ════════════════════════════════════════════════════════════════════════════
// v55.83-TP — team permissions (Max, Nov 17 2026 + Codex QA): only the SUPER ADMIN bypasses; admins / owners never get the
// sensitive things (profit & margin, money totals, bank balances, private accounts) from their role; a switch turned OFF
// always means off; "match" no longer grants "unmatch"; private bank accounts hidden from everyone not allowed.
// Real permission resolver + private-account filter on an in-memory database. The SQL (RLS + triggers) is tested in PGlite.
// ════════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var SP = require(path.join(root, 'src/lib/server-permissions.js'));
var AA = require(path.join(root, 'src/lib/accounting-access.js'));
var PA = require(path.join(root, 'src/lib/private-accounts-server.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }

var db = new MemDB({
  users: [{ id: 'sup', role: 'super_admin' }, { id: 'adm', role: 'admin' }, { id: 'own', role: 'owner' }, { id: 'stf', role: 'team' }, { id: 'acm', role: 'accounting_manager' }, { id: 'adm2', role: 'admin' }, { id: 'stf2', role: 'team' }],
  module_permissions: [
    { user_id: 'adm2', module_name: 'pnl.view_margin', has_access: true },        // Max switched it on for this admin
    { user_id: 'adm2', module_name: 'invoices.edit', has_access: false },        // and switched this one OFF
    { user_id: 'stf', module_name: 'payments.match', has_access: true },
    { user_id: 'acm', module_name: 'payments.unmatch', has_access: false },      // OFF beats the accounting_manager default
    { user_id: 'stf2', module_name: 'bank.view_private', has_access: true }
  ],
  plaid_accounts: [{ plaid_account_id: 'acc-open', is_private: false }, { plaid_account_id: 'acc-priv', is_private: true }]
});
async function can(u, perm) { var ctx = await SP.loadUserPermissions(db, u); return SP.userHasPermission(ctx, perm); }

(async function () {
  console.log('TP — who sees what');
  check('super admin: profit & margin, money totals, private accounts — all yes', (await can('sup', 'pnl.view_margin')) && (await can('sup', 'accounting.view_totals')) && (await can('sup', 'bank.view_private')));
  check('ADMIN: NO profit & margin, NO money totals, NO private accounts (role no longer implies them)', !(await can('adm', 'pnl.view_margin')) && !(await can('adm', 'accounting.view_totals')) && !(await can('adm', 'bank.view_private')));
  check('OWNER role: the same — no sensitive access from the role', !(await can('own', 'pnl.view_margin')) && !(await can('own', 'accounting.view_totals')));
  check('admin still does the work: invoices, bills, matching, wires', (await can('adm', 'invoices.edit')) && (await can('adm', 'bills.manage')) && (await can('adm', 'payments.match')) && (await can('adm', 'wires.prepare')));
  check('an admin Max switched ON for profit & margin → sees it', await can('adm2', 'pnl.view_margin'));
  check('a switch turned OFF means off, even for an admin (invoices.edit off)', !(await can('adm2', 'invoices.edit')));
  check('…and even against a role default (accounting manager, unmatch off)', !(await can('acm', 'payments.unmatch')) && (await can('acm', 'payments.match')));
  check('"Match" no longer grants "Unmatch"', (await can('stf', 'payments.match')) && !(await can('stf', 'payments.unmatch')));
  check('staff with nothing switched on: no money access at all', !(await can('stf', 'accounting.view_totals')) && !(await can('stf', 'bills.manage')));
  check('the sensitive list', SP.isSensitivePerm('pnl.view_margin') && SP.isSensitivePerm('accounting.view_totals') && SP.isSensitivePerm('bank.view_private') && !SP.isSensitivePerm('invoices.edit'));

  console.log('TP — money totals on the accounting screens');
  check('admin role: screens open, but money totals hidden', AA.acctAccess(false, {}, 'admin', 'ktc').access === true && AA.acctAccess(false, {}, 'admin', 'ktc').fin === false);
  check('super admin: totals shown', AA.acctAccess(true, {}, 'super_admin', 'ktc').fin === true);
  check('someone Max granted P2: totals shown', AA.acctAccess(false, { 'accounting.clickbooks.access': true, 'accounting.view_totals': true }, 'team', 'ktc').fin === true);

  console.log('TP — private bank accounts');
  var sS = await PA.privateScope(db, 'sup'); var sA = await PA.privateScope(db, 'adm'); var sG = await PA.privateScope(db, 'stf2');
  var rows = [{ id: 1, account_id: 'acc-open' }, { id: 2, account_id: 'acc-priv' }, { id: 3, account_id: null }];
  check('super admin sees the private account’s lines', PA.dropPrivate(rows, sS).length === 3);
  check('admin does NOT', PA.dropPrivate(rows, sA).map(function (r) { return r.id; }).join() === '1,3', PA.dropPrivate(rows, sA));
  check('a staff member Max granted "see private accounts" does', PA.dropPrivate(rows, sG).length === 3);
  var dbErr = new MemDB({ users: [{ id: 'x', role: 'team' }], module_permissions: [] });
  dbErr.from = (function (orig) { return function (t) { if (t === 'plaid_accounts') { return { select: function () { return { eq: function () { return Promise.resolve({ data: null, error: { message: 'simulated failure' } }); } }; } }; } return orig(t); }; })(dbErr.from.bind(dbErr));
  var sE = await PA.privateScope(dbErr, 'x');
  check('if the private list cannot be read → error (the routes refuse instead of showing everything)', !!sE.error, sE);

  console.log('TP — wiring');
  var read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); };
  check('All Transactions, bank lines to pay from, deposit candidates and the bank list all drop private lines', /dropPrivate\(txA\.data, scopeA\)/.test(read('src/app/api/accounting/expense-rules/route.js')) && /dropPrivate\(lb\.data, scopeB\)/.test(read('src/app/api/accounting/bills/route.js')) && /dropPrivate\(lr\.data, scopeD\)/.test(read('src/app/api/accounting/order-monitor/route.js')) && /dropPrivate\(r\.data, scopeP\)/.test(read('src/app/api/plaid/transactions/route.js')));
  var sql = read('sql/v55-83-TP-permissions.sql');
  check('SQL: restrictive rule on bank_transactions + super-admin-only sensitive grants + private mark', /AS RESTRICTIVE FOR SELECT TO authenticated/.test(sql) && /hub_guard_sensitive_grant/.test(sql) && /hub_guard_private_mark/.test(sql));
  var st = read('src/components/SettingsTab.jsx');
  check('Settings: "Bank: See private accounts" switch, super-admin-only sensitive switches, Accounting Staff preset without any sensitive key', /'bank\.view_private'/.test(st) && /SENSITIVE_PERMS_UI\[module\] && !isSuperAdmin/.test(st) && /ACCOUNTING_STAFF_PRESET/.test(st) && !/ACCOUNTING_STAFF_PRESET = \[[^\]]*(pnl\.view_margin|accounting\.view_totals|bank\.view_private)/.test(st));
  var pr = read('src/app/api/accounting/private-accounts/route.js');
  check('the private mark is changed only by the verified super admin', /verifiedCaller/.test(pr) && /ctx\.isSuperAdmin !== true/.test(pr));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
