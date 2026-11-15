// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PB — Books home + vendor Bills (AP) + cash flow + tab cleanup
//
// Max (Nov 5): "i don't know what ledgerly is so hide it. add a vendors bill
// side and create a dashboard for that as well.. to see how money will move in
// and out for a period of time... compare what funds coming in to pay bills"
// and: "something useful where all of these things are being matched in the
// background for expenses and i am easily matching items to invoices".
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

console.log('PB — Books / Bills / cash flow / tab cleanup');

// ── 1. FUNCTIONAL: the real cash-flow math (import the actual module)
var cfSrc = R('src/lib/cashflow.js');
var mod = { exports: {} };
// strip ESM for require-less eval (pure functions, no imports)
var cjs = cfSrc.replace(/export function /g, 'module.exports.$F = function $F'.replace('$F', '') ? 'exports_fn ' : '');
// simpler: transform "export function name" -> "function name" and collect
var names = [];
cjs = cfSrc.replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
/* eslint-disable no-new-func */
var factory = new Function('module', 'exports', cjs);
factory(mod, mod.exports);
var billOpenBalance = mod.exports.billOpenBalance;
var billStatus = mod.exports.billStatus;
var cashflowSummary = mod.exports.cashflowSummary;

var bill = { id: 'b1', total_amount: 1000, record_status: 'active', due_date: '2026-11-10', bill_date: '2026-11-01' };
var pays = [
  { bill_id: 'b1', amount: 300, voided: false },
  { bill_id: 'b1', amount: 100, voided: true },   // voided never counts
  { bill_id: 'b2', amount: 999, voided: false },  // other bill never counts
];
var bal = billOpenBalance(bill, pays);
ok('1a: bill balance counts only its own non-void payments (paid 300, open 700)', bal.paid === 300 && bal.open === 700);
ok('1b: status PARTIAL when some is paid', billStatus(bill, pays) === 'PARTIAL');
ok('1c: status PAID at full payment (to the cent)', billStatus(bill, [{ bill_id: 'b1', amount: 1000, voided: false }]) === 'PAID');
ok('1d: status OPEN with no payments, VOID wins over everything',
  billStatus(bill, []) === 'OPEN' && billStatus(Object.assign({}, bill, { record_status: 'void' }), pays) === 'VOID');

var summary = cashflowSummary({
  from: '2026-11-01', to: '2026-11-30', today: '2026-11-15',
  bankTx: [
    { direction: 'in', amount_abs: 500, date: '2026-11-03', pending: false },
    { direction: 'in', amount_abs: 100, date: '2026-10-30', pending: false }, // outside period
    { direction: 'in', amount_abs: 77, date: '2026-11-04', pending: true },   // pending never counts
    { direction: 'out', amount_abs: 200, date: '2026-11-05', pending: false },
  ],
  invoices: [
    { open_balance: 1000, due_date: '2026-11-20' },
    { open_balance: 50, due_date: '2026-12-02' },       // due outside period
    { open_balance: 0, due_date: '2026-11-21' },        // nothing open
    { open_balance: 400, due_date: null, invoice_date: '2026-11-10' }, // falls back to invoice date
  ],
  openBills: [
    { open: 300, due_date: '2026-11-10', bill_date: '2026-11-01' },   // due in period AND overdue vs today
    { open: 120, due_date: '2026-12-09', bill_date: '2026-11-01' },   // outside
  ],
});
ok('2a: actual in/out from settled bank txns in period only (in 500, out 200, net 300)',
  summary.actual_in === 500 && summary.actual_out === 200 && summary.actual_net === 300);
ok('2b: expected-in = open invoices due in period, due-date falling back to invoice date (1400)',
  summary.expected_in === 1400 && summary.expected_in_count === 2);
ok('2c: bills due in period 300; overdue vs today 300; projected net 1100',
  summary.due_out === 300 && summary.overdue_out === 300 && summary.projected_net === 1100);

// ── 3. Ledgerly is HIDDEN (Max: "i don't know what ledgerly is so hide it")
var at = R('src/components/AccountingTab.jsx');
ok("3a: no 'ledgerly' tab entry and no LedgerlyHub import in AccountingTab",
  at.indexOf("['ledgerly'") < 0 && !/^import LedgerlyHub/m.test(at));
ok('3b: ledgerly 15-min schedule removed; ClickBooks shadow + rules schedules present',
  !/ledgerly\/sync/.test(R('vercel.json')) && /clickbooks-us\/shadow-job/.test(R('vercel.json')) && /clickbooks-us\/rules-job/.test(R('vercel.json')));

// ── 4. Tab cleanup: Books + Bills in; 4 ClickBooks tabs collapsed to 2
ok("4a: '🏦 Books' home and '💸 Bills' tabs wired",
  at.indexOf("['books_home', '🏦 Books']") >= 0 && at.indexOf("['bills', '💸 Bills']") >= 0 &&
  /sub === 'books_home' && <div className="p-3"><BooksHomeTab/.test(at) && /sub === 'bills' && <div className="p-3"><BillsTab/.test(at));
ok('4b: ClickBooks collapsed: Financial Reports tab + single admin tab hosting foundation/rules/cutover',
  at.indexOf("'📊 Financial Reports'") >= 0 && at.indexOf("'⚙️ ClickBooks Admin'") >= 0 &&
  at.indexOf("['clickbooks_us'") < 0 && at.indexOf("['clickbooks_workflows'") < 0 && at.indexOf("['clickbooks_cutover'") < 0 &&
  /function ClickBooksAdmin\(/.test(at));
ok('4c: admin tab only for verified super admin; reports gated by flag + capability',
  /clickbooks_admin' \|\| \(clickbooksEnabled && financialAccess\.isVerifiedSuperAdmin === true\)/.test(at));

// ── 5. Books home: queues + one-click categorize + background proposals
var bh = R('src/components/BooksHomeTab.jsx');
ok('5a: deposits-to-match queue counts unreviewed unlinked money-in and deep-links to Bank Review',
  /direction', 'in'\)\.eq\('review_status', 'unreviewed'\)/.test(bh.replace(/"/g, "'")) && bh.indexOf("onGo('review')") >= 0);
ok('5b: one-click categorize reuses the REAL classify action with the Wave-sync patch (not a parallel path)',
  /action: 'classify', bank_transaction_id: t\.id, patch: patch/.test(bh) && /category_status: 'pending_wave_sync'/.test(bh) &&
  /bankSessionHeaders\(supabase, true\)/.test(bh));
ok('5c: rule proposals accepted/dismissed through decide_proposal with a reason; stale proposals filtered out',
  /action: 'decide_proposal', payload: \{ id: p\.id, accept: accept/.test(bh) && /p\.stale !== true/.test(bh));
ok('5d: classifications come from the shared bank-permissions list (same choices as Bank Review)',
  /import \{ CLASSIFICATIONS \} from '\.\.\/lib\/bank-permissions'/.test(bh));

// ── 6. Bills API: permissions + honesty guards
var br = R('src/app/api/accounting/bills/route.js');
// RE (Max, Nov 8 15:12 — Unified Accounting Permissions): P1 first, then the bills keys — realigned
ok('6a (PW→RE): writes need P1 + bills.manage; reads need P1 (the Bills list also Bills: View/Manage)',
  /assertPermission\(db, userId, 'bills\.manage', req\)/.test(br) &&
  /var gate = await assertPermission\(db, userId, 'accounting\.view', req\);/.test(br) &&
  /gate2 = await assertPermission\(db, userId, 'bills\.view', req\);/.test(br));
ok('6b: overpaying a bill is rejected; bank-linked payment must be settled money OUT and never over-allocated',
  /overpays the bill/.test(br) && /direction !== 'out'/.test(br) && /pending === true/.test(br) && /already allocated to bills/.test(br));
ok('6c: bills are US-business records (verified Wave business constant), USD',
  /US_WAVE_BUSINESS_ID/.test(br) && /currency: 'USD'/.test(br));
ok('6d: open AR uses the canonical formula + shared eligibility/business rules (never stored balance_due)',
  /isArEligible/.test(br) && /businessOfInvoice/.test(br) && /wave_imported_paid/.test(br) && br.indexOf('balance_due') < 0);
ok('6e: nothing deletes — bills void, payments void',
  /record_status: 'void'/.test(br) && /voided: true/.test(br) && !/\.delete\(\)/.test(br));

// ── 7. Settings can grant the two bills permissions
var st = R('src/components/SettingsTab.jsx');
ok('7: bills.view / bills.manage grantable in Settings', st.indexOf("'bills.view'") >= 0 && st.indexOf("'bills.manage'") >= 0);

// ── 8. Cutover readiness window never reaches before the Oct-31 opening cutoff
ok('8: Parallel & Cutover default From = max(30d ago, 2026-11-01)',
  /Math\.max\(Date\.now\(\)-30\*864e5,Date\.parse\('2026-11-01'\)\)/.test(R('src/components/ClickBooksUSCutover.jsx')));

console.log('');
console.log('PB: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
