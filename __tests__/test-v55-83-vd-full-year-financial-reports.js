// v55.83-VD (Max, Nov 19 2026): "for the 10th time the financa and tax reports DO NOT WORK OR LOAD ANY DATA" · "i need the full
// year in the financial reports" (he chose: from the Hub's own data). The ledger behind Financial Reports opens on 31 Oct 2026, so
// the full year is shown from the Hub's own records — the Stats income statement — opened from 1 January, inside that screen.
// Screen wiring (these are React screens; the numbers themselves come from the existing period_stats route, unchanged).
var fs = require('fs'); var path = require('path');
var root = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('VD — the full year inside Financial Reports');
var rep = read('src/components/ClickBooksUSReports.jsx'); var stats = read('src/components/PeriodStatsTab.jsx'); var acct = read('src/components/AccountingTab.jsx');
check('Financial Reports imports the Stats screen (runtime import present)', /import PeriodStatsTab from '\.\/PeriodStatsTab';/.test(rep));
check('it renders it with the signed-in person\'s props and the year start (1 January of this year)', rep.indexOf("<PeriodStatsTab {...props} initialFrom={new Date().getFullYear()+'-01-01'} />") > 0 && /export default function ClickBooksUSReports\(props\)\{/.test(rep));
check('the full-year section comes BEFORE the ledger section and says what it is built from', rep.indexOf('Full year · from the Hub') > 0 && rep.indexOf('Full year · from the Hub') < rep.indexOf('KTC U.S. / ClickBooks ledger reports') && /cash basis/.test(rep) && /not a balance sheet/i.test(rep));
check('the ledger section says plainly that it only holds entries after its opening date', /only hold entries dated after the ledger's opening date/.test(rep) && rep.indexOf('data.readiness.openingCutoff') > 0);
check('the permission gate of Financial Reports is unchanged and still comes before anything is shown', rep.indexOf("return <div className=\"p-5 text-slate-300\">Full dashboard permission is required for ClickBooks reports.</div>") > 0 && rep.indexOf('Full dashboard permission is required') < rep.indexOf('Full year · from the Hub'));
check('Accounting passes the signed-in person and the navigation to Financial Reports', acct.indexOf("<ClickBooksUSReports {...props} onGo={goFrom} />") > 0 && acct.indexOf("sub === 'clickbooks_reports' && reportsEnabled && canClickbooks &&") > 0);
check('Stats: opens from the date it is given ONLY when it is a real date; otherwise 1 June as before', stats.indexOf("useState(/^\\d{4}-\\d{2}-\\d{2}$/.test(String(props.initialFrom || '')) ? props.initialFrom : '2026-06-01')") > 0);
check('Stats keeps its own access check and loads the period it starts with', /var canView = VS\.access;/.test(stats) && /useEffect\(function \(\) \{ if \(canView\) \{ load\(from, to\); \} \}, \[\]\);/.test(stats));
check('Stats still asks the same route for the same thing (numbers unchanged)', stats.indexOf("action: 'period_stats', from: f, to: t") > 0);
// the date rule itself
var rx = /^\d{4}-\d{2}-\d{2}$/;
function start(v) { return rx.test(String(v || '')) ? v : '2026-06-01'; }
check('date rule: 2026-01-01 used; empty / null / junk / a script fall back to 1 June', start('2026-01-01') === '2026-01-01' && start('') === '2026-06-01' && start(null) === '2026-06-01' && start('Jan 1') === '2026-06-01' && start('2026-01-01<script>') === '2026-06-01');
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
