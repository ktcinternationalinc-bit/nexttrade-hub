// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RE — Max, Nov 8 15:12, "Claude Implementation Instructions — KTC Hub
// & Wave Hub — Unified Accounting Permissions":
//   P1 Accounting Access (required before any other accounting permission)
//   P2 Bank & Financial Summary: Bank Balance, Came In, Went Out, Sales,
//      Net Moved, Projected Net
//   P3 Invoicing & Collections: Invoiced, Paid, Still Open, Collected
//   Always visible with P1: Expected (≤30 / 30–60 / 61–90 / 90+), Bills Due,
//      Late, Total Overdue
//   "Do not disable card navigation simply because a user lacks Permission 2"
//   "Do not treat dashboard visibility restrictions as blanket restrictions on
//    underlying accounting records."
//   "5. Required Validation — a user with Permission 1 + Permission 3 but
//    without Permission 2" — run below against the REAL masking code.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
function loadEsm(src) {
  var names = [];
  var cjs = src.replace(/^import[^\n]*\n/gm, '')
    .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; })
    .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; });
  cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
  var mod = { exports: {} };
  /* eslint-disable no-new-func */
  new Function('module', 'exports', cjs)(mod, mod.exports);
  return mod.exports;
}
console.log('RE — unified accounting permissions (KTC Hub + Wave Hub)');
var A = loadEsm(R('src/lib/accounting-access.js'));

// ── the permission model itself
var u13 = A.acctAccess(false, { 'accounting.view': true, 'accounting.view_invoicing': true }, 'staff');
var u3only = A.acctAccess(false, { 'accounting.view_invoicing': true, 'accounting.view_totals': true }, 'staff');
var sup = A.acctAccess(true, {}, 'super_admin');
ok('1a: P1 + P3 user → access yes, invoicing yes, bank/financial NO, operational yes', u13.access && u13.inv && !u13.fin && u13.ops);
ok('1b: P2/P3 WITHOUT P1 take no effect at all (P1 is required first)', !u3only.access && !u3only.inv && !u3only.fin);
ok('1c: super admin (and owner/admin roles) see everything', sup.access && sup.fin && sup.inv &&
  A.acctAccess(false, {}, 'owner').fin && A.acctAccess(false, {}, 'admin').inv);
ok('1d: card groups exactly as written — P2: bank balance, came in, went out, sales, net moved, projected net · P3: invoiced, paid, still open, collected · P1: expected, bills due, late, total overdue',
  ['bank_balance', 'came_in', 'went_out', 'sales', 'net_moved', 'projected_net'].every(function (k) { return A.CARD_GROUP[k] === 'fin'; }) &&
  ['invoiced', 'paid', 'still_open', 'collected'].every(function (k) { return A.CARD_GROUP[k] === 'inv'; }) &&
  ['expected', 'bills_due', 'late', 'total_overdue'].every(function (k) { return A.CARD_GROUP[k] === 'ops'; }));

// ── 5. REQUIRED VALIDATION — P1 + P3, no P2, on realistic payloads
var cf = { summary: { actual_in: 5000, actual_in_count: 3, actual_out: 2000, actual_out_count: 2, actual_net: 3000 },
  sales_in: 4000, sales_in_count: 2,
  ahead: { expected_in: 7000, expected_in_count: 4, due_out: 1500, due_out_count: 2, projected_net: 5500 },
  drills: { came_in: { count: 3, sum: 5000, rows: [{ amount: 5000 }] }, went_out: { count: 2, sum: 2000, rows: [{ amount: 2000 }] }, sales_in: { count: 2, sum: 4000, rows: [{ amount: 4000 }] },
    expected_in: { count: 4, sum: 7000, rows: [{ invoice_id: 'i1', amount: 7000 }] }, bills_due: { count: 2, sum: 1500, rows: [{ amount: 1500 }] } } };
var mcf = A.maskCashflow(cf, u13);
ok('5a: bank & financial summary HIDDEN — Came In, Went Out, Net Moved, Sales, Projected Net are null and their records do not open (no back door through rows)',
  mcf.summary.actual_in === null && mcf.summary.actual_out === null && mcf.summary.actual_net === null && mcf.sales_in === null &&
  mcf.ahead.projected_net === null && mcf.drills.came_in.rows.length === 0 && mcf.drills.went_out.rows.length === 0 && mcf.drills.sales_in.rows.length === 0);
ok('5b: expected receivables + bills due VISIBLE with their records (clickable)',
  mcf.ahead.expected_in === 7000 && mcf.ahead.due_out === 1500 && mcf.drills.expected_in.rows.length === 1 && mcf.drills.bills_due.rows.length === 1);
var ps = { invoices: { invoiced: 9000, count: 5, collected: 6000, collected_count: 4, collected_on_period: 3000, collected_on_period_count: 2, still_open_from_period: 6000 },
  bills: { billed: 2500, count: 3, paid: 1200, paid_count: 2, still_open_from_period: 1300 },
  months: [{ month: '2026-10', invoiced: 9000, invoiced_count: 5, collected: 6000, collected_count: 4, billed: 2500, billed_count: 3, bills_paid: 1200, net: 4800 }],
  spending: { total_out: 2000, categories: [] },
  drills: { invoiced: [{ invoice_id: 'i1', amount: 9000 }], collected: [{ amount: 6000 }], collected_on_period: [{ amount: 3000 }], open_invoices: [{ amount: 6000 }],
    billed: [{ amount: 2500 }], bills_paid: [{ amount: 1200 }], open_bills: [{ amount: 1300 }] } };
var mps = A.maskPeriodStats(ps, u13);
ok('5c: invoicing & collection summaries VISIBLE — Invoiced, Paid, Still Open, Collected — AND their underlying invoices/payments open',
  mps.invoices.invoiced === 9000 && mps.invoices.collected === 6000 && mps.invoices.collected_on_period === 3000 && mps.invoices.still_open_from_period === 6000 &&
  mps.drills.invoiced.length === 1 && mps.drills.collected.length === 1 && mps.drills.collected_on_period.length === 1 && mps.drills.open_invoices.length === 1 &&
  mps.months[0].invoiced === 9000 && mps.months[0].collected === 6000);
ok('5d: money-out analysis (bill payments, net cash, spending = Went Out) stays restricted without P2; bills OWED stay visible (Bills Due family)',
  mps.bills.paid === null && mps.drills.bills_paid.length === 0 && mps.months[0].net === null && mps.months[0].bills_paid === null && mps.spending === null &&
  mps.bills.billed === 2500 && mps.bills.still_open_from_period === 1300 && mps.drills.open_bills.length === 1);
var fc = { buckets: { 'L1-30': { ar: 800, ar_count: 1, ap: 0, ap_count: 0, net: 800, running: 800 }, 'D0-30': { ar: 7000, ar_count: 4, ap: 1500, ap_count: 2, net: 5500, running: 6300 } },
  rows: [{ kind: 'in', bucket: 'L1-30', amount: 800 }, { kind: 'in', bucket: 'D0-30', amount: 7000 }], bank_balance: { total: 120000 } };
var mfc = A.maskForecast(fc, u13);
ok('5e: late / overdue + expected buckets VISIBLE with their invoices; projected position (net/running) and BANK BALANCE remain inaccessible',
  mfc.buckets['L1-30'].ar === 800 && mfc.buckets['D0-30'].ar === 7000 && mfc.buckets['D0-30'].ap === 1500 && mfc.rows.length === 2 &&
  mfc.buckets['D0-30'].net === null && mfc.buckets['D0-30'].running === null && mfc.bank_balance === null);
var mps0 = A.maskPeriodStats(ps, A.acctAccess(false, { 'accounting.view': true }, 'staff'));
ok('5f: P1 only → invoicing figures restricted too (P3 decides them), operational still visible',
  mps0.invoices.invoiced === null && mps0.drills.invoiced.length === 0 && mps0.bills.billed === 2500);
ok('5g: P1+P2+P3 → nothing masked', A.maskCashflow(cf, sup) === cf && A.maskForecast(fc, sup) === fc && A.maskPeriodStats(ps, sup).invoices.invoiced === 9000);

// ── server wiring
var b = R('src/app/api/accounting/bills/route.js');
ok('6a: server — P1 required for every read (writes also need Bills: Manage); then the payloads are masked by the SAME library functions',
  /var gate = await assertPermission\(db, userId, 'accounting\.view', req\);/.test(b) &&
  /var visI = await assertPermission\(db, userId, 'accounting\.view_invoicing', req\);/.test(b) &&
  /cfPayload = maskCashflow\(cfPayload, vis\);/.test(b) && /psPayload = maskPeriodStats\(psPayload, vis\);/.test(b) && /fcPayload = maskForecast\(fcPayload, vis\);/.test(b));
// RF (Max, Nov 8 15:25: "2 switches with same permissioning for both" · "yes in settings bank balances") — realigned:
ok('6b (RE→RF): Bank Balance needs P2 AND the Bank Balances switch (super admin always) — never one alone',
  /var okBal = false;\n\s+if \(vis\.fin === true\) \{/.test(b) && /financial_visibility_permissions'\)\.select\('can_view_bank_balances'\)/.test(b) &&
  /if \(okBal\) \{/.test(b) && /fcPayload\.bank_balance = vis\.fin \? balF : null;/.test(b));
ok('6c: categories / All Transactions and the audit trail also need P1 first',
  /var gateP1 = await assertPermission\(db, userId, 'accounting\.view', req\);/.test(R('src/app/api/accounting/expense-rules/route.js')) &&
  /var gateP1 = await assertPermission\(d, userId, 'accounting\.view', req\);/.test(R('src/app/api/accounting/audit/route.js')));

// ── UI wiring — identical in both hubs
var page = R('src/app/page.jsx');
// RF (Max, Nov 8 15:25: "2 switches with same permissioning for both" · "yes in settings bank balances") — realigned:
ok('7a (RE→RF): the Accounting menu shows ONLY with a hub switch (ClickBooks or Wave Hub) — other permissions never open it on their own',
  /return modulePerms\['accounting\.clickbooks\.access'\] === true \|\| modulePerms\['accounting\.wavehub\.access'\] === true \|\|/.test(page));
var at = R('src/components/AccountingTab.jsx');
ok('7b: inside, the area gate is P1 (acctAccess) for KTC Hub and Wave Hub screens alike',
  /var acctV = acctAccess\(isSuper, mp, props\.userProfile && props\.userProfile\.role\);\n\s+var hasAnyAccounting = acctV\.access;/.test(at));
var bh = R('src/components/BooksHomeTab.jsx');
ok('7c: KTC Hub Books — P2 cards Restricted + not clickable without P2; P3 cards follow P3; Expected / Bills Due / Late / Total Overdue untouched and clickable',
  /value=\{gv\(V\.fin, '\$' \+ fmt\(sum\.actual_in\)\)\}/.test(bh) && /onClick=\{go\(V\.fin, function \(\) \{ setCfDrill\(\{ title: 'Came in/.test(bh) &&
  /value=\{gv\(V\.inv, '\$' \+ fmt\(ps\.invoices\.invoiced\)\)\}/.test(bh) && /onClick=\{go\(V\.inv, function \(\) \{ setCfDrill\(\{ src: 'ps', title: 'Collected/.test(bh) &&
  /label="PROJECTED NET \(30d\)" value=\{gv\(V\.fin,/.test(bh) &&
  /<Card label=\{'BILLS DUE \(' \+ cf\.ahead\.due_out_count \+ '\)'\} value=\{'\$' \+ fmt\(cf\.ahead\.due_out\)\}/.test(bh) &&
  /label="TOTAL OVERDUE"/.test(bh) && /\{V\.fin && <tr style=\{\{ borderTop/.test(bh));
var ad = R('src/components/AccountingDashboard.jsx');
ok('7d: Wave Hub dashboard — same definitions: Open AR/Paid/credits = P3, due windows + overdue (incl. the Overdue total) = P1 and clickable, money received = P2',
  /var AV = acctAccess\(isSuperAdmin, modulePerms, _role, 'wave'\); \/\/ RF — a Wave Hub screen\n\s+seeTotals = AV\.inv; seeCustBalances = AV\.inv;\n\s+seeUpcoming = AV\.ops; seeOverdue = AV\.ops; seeInvoiceBal = AV\.access;/.test(ad) &&
  /<Stat title="Overdue AR \(USD\)" big=\{tover\(overdueTotal\)\}/.test(ad) && /onClick=\{seeOverdue \? function/.test(ad) &&
  /return \(seeAmounts && AV\.fin\)/.test(ad));
var st = R('src/components/PeriodStatsTab.jsx');
ok('7e: Stats — Invoiced/Collected/Still open locked only without P3, Bills paid only without P2; restricted cards show "Restricted" and no number',
  /<Card locked=\{!dV\.inv\} why="needs P3 · Invoicing & Collections" onClick=\{function \(\) \{ openDrill\('invoiced'/.test(st) &&
  /<Card locked=\{!dV\.fin\} why="needs P2 · Bank & Financial Summary" onClick=\{function \(\) \{ openDrill\('bills_paid'/.test(st));
var settings = R('src/components/SettingsTab.jsx');
// RF (Max, Nov 8 15:25: "2 switches with same permissioning for both" · "yes in settings bank balances") — realigned:
ok('7f (RE→RF): Settings shows P1a · ClickBooks (KTC Hub) Access, P1b · Wave Hub Access, P2, P3; the single RE switch and rows-only are retired',
  /key: 'accounting\.clickbooks\.access', label: 'P1a · ClickBooks \(KTC Hub\) Access'/.test(settings) &&
  /key: 'accounting\.wavehub\.access',    label: 'P1b · Wave Hub Access'/.test(settings) &&
  /Accounting Access \(both hubs\) — RETIRED/.test(settings) &&
  /key: 'accounting\.view_totals',\s+label: 'P2 · Bank & Financial Summary'/.test(settings) &&
  /key: 'accounting\.view_invoicing',\s+label: 'P3 · Invoicing & Collections'/.test(settings) && /RETIRED/.test(settings));
ok('7g: All Invoices (Invoiced / Paid / Still Open and their invoices) is the P3 group — a Wave Hub screen', /var mayView = acctAccess\(isSuperAdmin, modulePerms, userProfile && userProfile\.role, 'wave'\)\.inv;/.test(R('src/components/BusinessBooksTab.jsx')));

// ── RF — two switches, same rules in both hubs
var k1 = A.acctAccess(false, { 'accounting.clickbooks.access': true, 'accounting.view_invoicing': true }, 'staff', 'ktc');
var w1 = A.acctAccess(false, { 'accounting.clickbooks.access': true, 'accounting.view_invoicing': true }, 'staff', 'wave');
var both = A.acctAccess(false, { 'accounting.wavehub.access': true, 'accounting.view_totals': true }, 'staff');
ok('8a (RF): a ClickBooks-only user opens ClickBooks with P3 working there, and does NOT get into Wave Hub screens (P3 does nothing without that hub\'s switch)',
  k1.access && k1.inv && !k1.fin && !w1.access && !w1.inv && k1.ktc && !k1.wave);
ok('8b (RF): the menu opens with EITHER switch; P2/P3 mean the same thing in both hubs',
  both.access && both.wave && !both.ktc && both.fin && A.acctAccess(false, { 'accounting.wavehub.access': true, 'accounting.view_totals': true }, 'staff', 'wave').fin);
ok('8c (RF): the retired RE switch still counts as BOTH hubs until the SQL moves people (nobody locked out on deploy)',
  A.acctAccess(false, { 'accounting.view': true }, 'staff', 'ktc').access && A.acctAccess(false, { 'accounting.view': true }, 'staff', 'wave').access);
ok('8d (RF): every accounting screen belongs to exactly one hub (audit serves both); the Accounting tab renders a screen only for its hub',
  A.screenHub('books_home') === 'ktc' && A.screenHub('all_txns') === 'ktc' && A.screenHub('clickbooks_reports') === 'ktc' &&
  A.screenHub('review') === 'wave' && A.screenHub('invoices') === 'wave' && A.screenHub('wavehub') === 'wave' && A.screenHub('audit') === 'both' &&
  /if \(!hubAllows\(sub\)\) \{ sub = acctV\.ktc \? 'books_home' : 'dashboard'; \}/.test(at) &&
  /tabs\.filter\(function \(t\) \{ return hubAllows\(t\[0\]\) &&/.test(at));
var sp = R('src/lib/server-permissions.js');
ok('8e (RF): server — "accounting.view" now means EITHER hub switch, so every P1 gate (Books, Stats, Forecast, categories, audit) accepts both',
  /'accounting\.view': \['accounting\.view', 'accounting\.clickbooks\.access', 'accounting\.wavehub\.access'\]/.test(sp));
ok('8f (RF): ClickBooks screens ask for the ClickBooks hub, Wave Hub screens for the Wave Hub',
  /acctAccess\(isSuperAdmin, modulePerms, userProfile && userProfile\.role, 'ktc'\)/.test(bh) &&
  /acctAccess\(isSuperAdmin, modulePerms, userProfile && userProfile\.role, 'ktc'\)\.access/.test(R('src/components/CashForecastTab.jsx')) &&
  /var VS = acctAccess\(isSuperAdmin, modulePerms, userProfile && userProfile\.role, 'ktc'\)/.test(st));
ok('8g (RF): Bank Balances switch is in Settings, labeled, super-admin grants only',
  /label: 'Bank Balances \(banking information\) — super admin grants only'/.test(R('src/components/BankBalancePermissions.jsx')) &&
  /var canManage = visibility\.isVerifiedSuperAdmin === true;/.test(R('src/components/BankBalancePermissions.jsx')));

console.log('');
console.log('RE: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
