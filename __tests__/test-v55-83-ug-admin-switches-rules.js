// v55.83-UG (Max, Nov 18) — "the admin should not just have access, i need to give him access" + "why does this only work if i click on
// test? shouldn't it work automatically?" Runs the real permission rules, the real rules runner on an in-memory database, and the real
// timer route.
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(l, c, x) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x === undefined ? '' : x).substring(0, 600))); }
var SP = require(path.join(root, 'src/lib/server-permissions.js'));
var AA = require(path.join(root, 'src/lib/accounting-access.js'));
var BP = require(path.join(root, 'src/lib/bank-permissions.js'));
function ctx(role, mp) { return { role: role, isSuperAdmin: role === 'super_admin', mp: mp || {}, deny: {} }; }

console.log('UG — only the super admin has everything; admins / owners use their switches');
check('admin with no switches: NO bank, bills, wires, invoices, P&L, orders', ['bank.view', 'bills.manage', 'wires.signoff', 'invoice.create', 'payments.match', 'pnl.view', 'orders.manage', 'company.nextrade.manage', 'accounting.clickbooks.access'].every(function (p) { return !SP.userHasPermission(ctx('admin'), p); }));
check('owner with no switches: same — nothing in accounting / banking', !SP.userHasPermission(ctx('owner'), 'bills.view') && !SP.userHasPermission(ctx('owner'), 'bank.classify'));
check('admin WITH a switch turned on: that switch works', SP.userHasPermission(ctx('admin', { 'bills.manage': true }), 'bills.manage') && !SP.userHasPermission(ctx('admin', { 'bills.manage': true }), 'wires.send'));
check('super admin: everything, with no switches', SP.userHasPermission(ctx('super_admin'), 'bills.manage') && SP.userHasPermission(ctx('super_admin'), 'pnl.view_margin'));
check('outside accounting / banking an admin is unchanged (e.g. HR / CRM keys still come from the role)', SP.userHasPermission(ctx('admin'), 'hr.view') === true || SP.isAccountingPerm('hr.view') === false);
check('screens: accounting access for an admin with no switches is OFF; ON for the super admin', AA.acctAccess(false, {}, 'admin', 'ktc').access === false && AA.acctAccess(true, {}, 'super_admin', 'ktc').access === true);
check('invoice / customer helpers no longer pass an admin by role', !BP.canCreateInvoice(false, {}, 'admin') && !BP.canViewAccountingCustomers(false, {}, 'owner') && BP.canCreateInvoice(false, { 'invoice.create': true }, 'admin'));

var panel = fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8');
check('the Banking & Accounting Access page now has the newer switches (private accounts, add by hand, P&L, margin, invoices, orders, Nextrade / RTM, advances, Sourcing desk)',
  ['bank.view_private', 'bank.add_transactions', 'pnl.view', 'pnl.view_margin', 'invoice.create', 'payments.match', 'orders.manage', 'company.nextrade.manage', 'company.rtm.view', 'advances.manage', 'commercial.access'].every(function (k) { return panel.indexOf("key: '" + k + "'") >= 0; }));
check('…and says only the super admin has everything (old "admins always have everything" wording gone)', /Only the super admin has everything/.test(panel) && !/Owners, admins and super admins always have everything/.test(panel) && /u\.role === 'super_admin'\); \/\/ v55\.83-UG/.test(panel));
var st = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
check('Module Access hides every switch that is now on the Banking page (one place to set them)', /BANKING_KEYS\.indexOf\(p\.key\) < 0/.test(st));
var srcFiles = ['src/components/AccountingTab.jsx', 'src/components/AllTransactionsTab.jsx', 'src/components/BankTab.jsx', 'src/components/BillsTab.jsx', 'src/components/ExpenseRulesTab.jsx', 'src/components/PeriodStatsTab.jsx', 'src/components/WaitingTab.jsx', 'src/components/WiresTab.jsx'];
var left = srcFiles.filter(function (f) { return /role === 'owner' \|\| [a-zA-Z.]*role === 'admin'|role === 'admin' \|\| [a-zA-Z.]*role === 'owner'/.test(fs.readFileSync(path.join(root, f), 'utf8')); });
check('no accounting screen still lets an admin / owner in by role', left.length === 0, left);

(async function () {
  console.log('UG — category rules run by themselves');
  var ER = require(path.join(root, 'src/lib/expense-rules-server.js'));
  var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
  var db = new MemDB({ us_expense_rules: [{ id: 'r1', match_text: 'pseg', classification: 'utilities', auto_apply: true, active: true, hit_count: 0 }],
    bank_transactions: [{ id: 't1', name: 'PSEG ELECTRIC 1', merchant_name: null, classification: null, category_verified: false, wave_business_id: US, pending: false, review_status: 'unreviewed', direction: 'out' },
      { id: 't2', name: 'PSEG ELECTRIC 2', merchant_name: null, classification: 'rent', category_source: 'classification', category_verified: false, wave_business_id: US, pending: false, review_status: 'unreviewed', direction: 'out' }],
    app_settings: [] });
  var r = await ER.runRulesAndRecord(db, 'bank sync');
  var t1 = db.t.bank_transactions[0], t2 = db.t.bank_transactions[1];
  check('a blank line matching a rule is filled automatically', t1.classification === 'utilities', { r: r, t1: t1 });
  check('a line a person categorized is NOT changed', t2.classification === 'rent', t2);
  var last = await ER.readRulesLastRun(db);
  check('the run is recorded (when, from where, how many filled) for the rules screen', last && last.source === 'bank sync' && last.filled === 1 && !!last.at, last);

  var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
  var orig = Module._resolveFilename;
  Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
  global.__db = new MemDB({ us_expense_rules: [], bank_transactions: [], app_settings: [] });
  var job = require(path.join(root, 'src/app/api/accounting/expense-rules/job/route.js'));
  function req(auth) { return { headers: { get: function (h) { return h === 'authorization' ? auth : null; } } }; }
  delete process.env.CRON_SECRET;
  var a1 = await job.GET(req('')); check('timer refuses without CRON_SECRET set (503)', a1.status === 503);
  process.env.CRON_SECRET = 'test-secret-1234';
  var a2 = await job.GET(req('Bearer wrong')); check('timer refuses a wrong secret (401)', a2.status === 401);
  var a3 = await job.GET(req('Bearer test-secret-1234')); var j3 = await a3.json(); check('timer with the right secret runs the rules', a3.status === 200 && j3.ok === true, j3);
  Module._resolveFilename = orig;

  var V = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  check('the timer is scheduled every 15 minutes in vercel.json', V.crons.some(function (c) { return c.path === '/api/accounting/expense-rules/job' && c.schedule === '*/15 * * * *'; }));
  var T = fs.readFileSync(path.join(root, 'src/app/api/plaid/transactions/route.js'), 'utf8');
  check('every bank sync runs the rules right after new lines arrive (fail-soft)', /rulesRun = await runRulesAndRecord\(supabase, 'bank sync'\)/.test(T) && /rules_filled:/.test(T));
  var E = fs.readFileSync(path.join(root, 'src/components/ExpenseRulesTab.jsx'), 'utf8');
  check('the rules screen shows the last automatic run, in red when it failed or is late', /Last automatic run: /.test(E) && /not running on time/.test(E));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
