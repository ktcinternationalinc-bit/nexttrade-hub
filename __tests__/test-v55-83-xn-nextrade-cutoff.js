// v55.83-XN — Max, 21 Nov 2026: "JUST ONE BUTTON TO IGNORE ALL OF THEM FROM CREATING KTC BILLS PRIOR TO JUNE 1 2026".
// The pure helpers (real code) + the wiring of the route and the screen. The database rule itself is proven on real Postgres in
// test-v55-83-xn-nextrade-cutoff-sql.mjs (PGlite).
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var N = require(path.join(root, 'src/lib/nextrade-bills-server.js'));
var pass = 0, failN = 0;
function check(label, cond) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label); }
console.log('XN — no KTC bills from Nextrade lines before 1 June 2026');
var ON = { on: true, date: '2026-06-01' }; var OFF = { on: false, date: '2026-06-01' };
check('the cut-off date is 1 June 2026', N.NEXTRADE_BILL_CUTOFF === '2026-06-01');
check('ON: 31 May is before the cut-off; 1 June and later are not', N.beforeCutoff({ date: '2026-05-31' }, ON) === true && N.beforeCutoff({ date: '2026-06-01' }, ON) === false && N.beforeCutoff({ date: '2026-07-02' }, ON) === false);
check('ON: a 2024 line is before the cut-off (timestamps are cut to the day)', N.beforeCutoff({ date: '2024-12-27T00:00:00Z' }, ON) === true);
check('OFF, no cut-off row, or a failed read: nothing is treated as before the cut-off', N.beforeCutoff({ date: '2026-05-31' }, OFF) === false && N.beforeCutoff({ date: '2026-05-31' }, null) === false && N.beforeCutoff({ date: '2026-05-31' }, { error: 'x' }) === false);

var lib = fs.readFileSync(path.join(root, 'src/lib/nextrade-bills-server.js'), 'utf8');
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/company-books/route.js'), 'utf8');
var ui = fs.readFileSync(path.join(root, 'src/components/CompanyBooksTab.jsx'), 'utf8');
var sql = fs.readFileSync(path.join(root, 'sql/v55-83-XN-nextrade-june-cutoff.sql'), 'utf8');
check('prepareCategorize proposes no KTC bill (and runs no duplicate check) for a line before the cut-off', /var co = c\.cutoff \|\| await loadBillCutoff\(db\);\s+if \(!co\.error && beforeCutoff\(line, co\)\) \{ return \{ ok: true, payload: payload \}; \}/.test(lib));
var seg = route.slice(route.indexOf("if (action === 'bill_cutoff' || action === 'set_bill_cutoff')"), route.indexOf("if (action === 'accounts')"));
check('route: set_bill_cutoff is a WRITE (the Nextrade Manage permission) AND super admin only', /set_bill_cutoff: 1 \}/.test(route) && seg.indexOf("if (!isSuperCB) { return fail('Only the super admin can turn this on or off.', 403); }") > 0);
check('route: ON / OFF must be said exactly; the date is the fixed 1 June 2026, never taken from the browser', seg.indexOf("if (body.on !== true && body.on !== false) { return fail('Say ON or OFF.'); }") > 0 && seg.indexOf('cutoff_date: NEXTRADE_BILL_CUTOFF') > 0 && seg.indexOf('body.cutoff_date') < 0);
check('route: the change is ONE database function (hub_company_bill_cutoff); a missing SQL says which script to run', seg.indexOf("db.rpc('hub_company_bill_cutoff'") > 0 && seg.indexOf('SQL_MISSING_XN') > 0 && /v55-83-XN-nextrade-june-cutoff\.sql/.test(route));
check('route: the status shows the dollar total only with the totals permission', seg.indexOf("assertPermission(db, userId, 'accounting.view_totals', req)") > 0 && /would_stop_total: gTotC && gTotC\.ok === true \?/.test(seg));
check('route: "Make the missing KTC bills" and the rule preview leave lines before the cut-off out', /!beforeCutoff\(l, coM\)/.test(route) && /!beforeCutoff\(ln, coA\)/.test(route));
check('screen: the button shows only for the super admin (can_set) on Nextrade, asks first, and names what is left alone', /comp\.key === 'nextrade' && cutoff && cutoff\.can_set && <button onClick=\{pressCutoff\}/.test(ui) && /if \(!window\.confirm\(q\)\) \{ return; \}/.test(ui) && /Left as they are: /.test(ui));
check('SQL: nothing is deleted anywhere in the script', !/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bTRUNCATE\b/i.test(sql));
check('SQL: the button and the table are for the server only (revoked from anon / authenticated)', /REVOKE ALL ON FUNCTION public\.hub_company_bill_cutoff\(jsonb\) FROM PUBLIC, anon, authenticated;/.test(sql) && /REVOKE ALL ON public\.company_ktc_bill_cutoff FROM PUBLIC, anon, authenticated;/.test(sql));
check('SQL: hub_company_categorize keeps its original grants (service role only)', /REVOKE ALL ON FUNCTION public\.hub_company_categorize\(jsonb\) FROM PUBLIC, anon, authenticated;/.test(sql));
console.log('\nXN: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
