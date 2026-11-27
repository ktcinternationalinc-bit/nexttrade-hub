// ═══════════════════════════════════════════════════════════════════════════
// v55.83-ST — Max, Nov 15 2026 09:54: "The late cards aren't working. Did you fix those in this builds"
// Found: (1) the rows behind a late card open far down the page inside the "Late & upcoming" strip — on a phone a tap
// looked like nothing happened (the scroll added in SS takes you there); (2) TOTAL OVERDUE opened only the "1–30 days late"
// invoices, not all of them. The row picking is RUN here against the card numbers.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var V = require(path.join(root, 'src/lib/books-home-view.js'));
var AG = require(path.join(root, 'src/lib/aging.js'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
var today = '2026-11-15';
function inv(n, due, open) { return { id: 'i' + n, invoice_number: 'AMERICA ' + n, customer: 'Customer ' + n, invoice_date: '2026-06-01', due_date: due, total: open + 100, paid: 100, open_balance: open }; }
var invs = [inv(1, '2026-11-05', 1000.10), inv(2, '2026-10-01', 2000.20), inv(3, '2026-09-01', 3000.30), inv(4, '2026-06-15', 4000.40), inv(5, '2026-07-01', 500.05), inv(6, '2026-12-01', 9999), inv(7, '2026-11-01', 0)];
var bills = [{ id: 'b1', bill_number: 'B-1', vendor_name: 'Vendor', bill_date: '2026-10-01', due_date: '2026-10-20', total_amount: 700, paid: 0, open: 700 }];
var buckets = AG.forecastBuckets(invs, bills, today); var rows = AG.tagRows(invs, bills, today);
var order = ['L90+', 'L61-90', 'L31-60', 'L1-30', 'D0-30', 'D31-60', 'D61-90', 'D90+'];
var LATE = ['L1-30', 'L31-60', 'L61-90', 'L90+'];
check('A1: each late card opens exactly its own invoices and the Σ equals the card to the cent', LATE.every(function (b) { var d = V.agingDrillRows(rows, { bucket: b, kind: 'in' }, order); return d.rows.length === buckets[b].ar_count && Math.round(d.sum * 100) === Math.round(buckets[b].ar * 100) && d.rows.every(function (r) { return r.kind === 'in' && r.bucket === b; }); }), LATE.map(function (b) { return [b, buckets[b].ar, V.agingDrillRows(rows, { bucket: b, kind: 'in' }, order).sum]; }));
var tot = 0, cnt = 0; LATE.forEach(function (b) { tot += Math.round(buckets[b].ar * 100); cnt += buckets[b].ar_count; });
var all = V.agingDrillRows(rows, { buckets: LATE, kind: 'in', label: 'All overdue invoices' }, order);
check('A2: TOTAL OVERDUE opens ALL late invoices (5, $10,501.05) — before it opened only the 1–30 days ones', all.rows.length === cnt && cnt === 5 && Math.round(all.sum * 100) === tot && tot === 1050105, { n: all.rows.length, sum: all.sum, cnt: cnt, tot: tot });
check('A3: not-yet-due invoices, paid invoices and bills are never in the late list', all.rows.every(function (r) { return r.kind === 'in' && LATE.indexOf(r.bucket) >= 0; }) && !all.rows.some(function (r) { return r.ref === 'AMERICA 6' || r.ref === 'AMERICA 7' || r.ref === 'B-1'; }));
check('A4: biggest first; every row carries the invoice to open, its due date and what is still owed', all.rows[0].amount === 4000.4 && all.rows.every(function (r) { return r.invoice_id && r.due && r.open === r.amount; }));
var cum = V.agingDrillRows(rows, { bucket: 'L31-60', kind: 'cum' }, order);
check('A5: the running-position drill is unchanged: invoices in (+) and bills out (−) up to that window', cum.rows.length === 4 && Math.round(cum.sum * 100) === Math.round((4000.4 + 500.05 + 3000.3 + 2000.2) * 100) - 0 && V.agingDrillRows(rows, { bucket: 'L1-30', kind: 'cum' }, order).sum === Math.round((10501.05 - 700) * 100) / 100, { n: cum.rows.length, sum: cum.sum });
var BH = R('src/components/BooksHomeTab.jsx');
check('B1 (pin): the screen uses that helper; TOTAL OVERDUE asks for all four late windows', /agingDrillRows\(fc\.rows \|\| \[\], fcDrill, fc\.bucket_order \|\| \[\]\)/.test(BH) && /setFcDrill\(\{ buckets: \['L1-30', 'L31-60', 'L61-90', 'L90\+'\], kind: 'in', label: 'All overdue invoices' \}\)/.test(BH) && !/onClick=\{function \(\) \{ setFcDrill\(\{ bucket: 'L1-30', kind: 'in' \}\); \}\} \/>\n            <\/div>/.test(BH));
check('B2 (pin): a tap on a late card scrolls to its rows (they open inside the “Late & upcoming” strip further down)', /fcRef\.current\.scrollIntoView/.test(BH) && /ref=\{fcRef\}/.test(BH));
check('B3 (pin): up to 300 rows shown, and it says the Σ still covers all of them', /var shown = all\.slice\(0, 300\);/.test(BH) && /the Σ above still covers all of them/.test(BH));
var wn = R('src/components/WhatsNewWidget.jsx');
check('B4 (pin): What’s New has v55.83-ST with one technical line; badge at ST', /version: 'v55\.83-ST'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-ST'"), wn.indexOf("version: 'v55.83-SS'"))) && />v55\.83-(?:S[T-Z]|[T-Z][A-Z]|AA[A-Z])<\/span>/.test(R('src/app/page.jsx'))); // v55.83-SU realign: ST or later
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
