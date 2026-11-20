// v55.83-VU — Max, 20 Nov 2026: "In the billing section, we should be able to group under every different vendor. They should be
// grouped, and then you can drill down so it's easier to manage. You should be able to filter, search. You should be able to sort
// by the invoice date, by the invoice number for each grouping ... show all and also filter it and sort by the date and the number."
// Real functions; made-up vendors and amounts.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var G = require(path.join(root, 'src/lib/bill-groups.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VU — Bills grouped by vendor, search, sort');
var bills = [
  { id: 'b1', vendor_name: 'Road Trucker', bill_number: 'INV-10', bill_date: '2026-06-05', due_date: '2026-07-05', total_amount: 1500, paid: 0, open: 1500, record_status: 'active', bill_type: 'trucking', release_number: '1002-1161' },
  { id: 'b2', vendor_name: 'road trucker ', bill_number: 'INV-9', bill_date: '2026-06-20', due_date: '2026-06-25', total_amount: 800.5, paid: 300, open: 500.5, record_status: 'active', bill_type: 'trucking' },
  { id: 'b3', vendor_name: 'Mill Co', bill_number: 'M-100', bill_date: '2026-05-01', due_date: '2026-05-31', total_amount: 40000, paid: 40000, open: 0, record_status: 'active', bill_type: 'supplier', category: 'goods' },
  { id: 'b4', vendor_name: 'Mill Co', bill_number: '', bill_date: '2026-06-11', due_date: '', total_amount: 250, paid: 0, open: 250, record_status: 'active', bill_type: 'supplier', dup_flag: { level: 'possible', reasons: ['x'] } },
  { id: 'b5', vendor_name: 'Road Trucker', bill_number: 'INV-2', bill_date: '2026-04-02', due_date: '2026-04-30', total_amount: 999, paid: 0, open: 999, record_status: 'void', bill_type: 'trucking' },
  { id: 'b6', vendor_name: '', bill_number: 'X1', bill_date: '', due_date: '2026-08-01', total_amount: 10, paid: 0, open: 10, record_status: 'active' }
];
function ids(l) { return l.map(function (b) { return b.id; }).join(','); }
// ── grouping
var g = G.groupByVendor(bills, '2026-07-01');
check('one group per vendor, A → Z; the same vendor typed with other capitals / a trailing space is ONE group; a bill with no vendor has its own group', g.map(function (x) { return x.key; }).join('|') === '(no vendor)|mill co|road trucker' && g[2].count === 3 && g[2].vendor === 'Road Trucker');
check('every bill is in exactly one group — none lost, none twice', g.reduce(function (a, x) { return a + x.bills.length; }, 0) === bills.length && ids(g.reduce(function (a, x) { return a.concat(x.bills); }, [])).split(',').sort().join(',') === 'b1,b2,b3,b4,b5,b6');
check('a group’s totals are the plain sums of its ACTIVE bills, to the cent (the voided 999 is listed but adds nothing)', g[2].total_cents === 230050 && g[2].paid_cents === 30000 && g[2].open_cents === 200050 && g[1].total_cents === 4025000 && g[1].open_cents === 25000);
check('late = open and past its due date; next due = the earliest due date still open; duplicates counted', g[2].late === 1 && g[2].earliest_due === '2026-06-25' && g[1].late === 0 && g[1].earliest_due === '' && g[1].duplicates === 1);
check('the group totals add up to the whole list’s totals', g.reduce(function (a, x) { return a + x.open_cents; }, 0) === 200050 + 25000 + 1000);
// ── sorting
check('bill date, oldest first and newest first; a bill with no date is last both ways', ids(G.sortBills(bills, 'bill_date', 'asc')) === 'b5,b3,b1,b4,b2,b6' && ids(G.sortBills(bills, 'bill_date', 'desc')) === 'b2,b4,b1,b3,b5,b6');
check('bill number the way a person reads it: INV-2, INV-9, INV-10 (not INV-10 before INV-9); no number is last both ways', ids(G.sortBills(bills, 'bill_number', 'asc')) === 'b5,b2,b1,b3,b6,b4' && ids(G.sortBills(bills, 'bill_number', 'desc')) === 'b6,b3,b1,b2,b5,b4');
check('amount and open balance, both directions', ids(G.sortBills(bills, 'amount', 'desc')).indexOf('b3,b1') === 0 && ids(G.sortBills(bills, 'open', 'desc')).indexOf('b1,b5') === 0 && ids(G.sortBills(bills, 'amount', 'asc')).indexOf('b6,b4') === 0);
check('due date (the default): earliest first, no due date last', ids(G.sortBills(bills, 'due', 'asc')) === 'b5,b3,b2,b1,b6,b4');
check('sorting never changes the list it was given, and keeps every bill', ids(bills) === 'b1,b2,b3,b4,b5,b6' && G.sortBills(bills, 'vendor', 'asc').length === 6);
var gs = G.groupByVendor(G.sortBills(bills, 'bill_number', 'asc'), '2026-07-01');
check('“sort by the invoice number for each grouping”: sort, then group → inside Road Trucker the bills are INV-2, INV-9, INV-10', ids(gs[2].bills) === 'b5,b2,b1' && ids(G.groupByVendor(G.sortBills(bills, 'bill_date', 'desc'), '2026-07-01')[2].bills) === 'b2,b1,b5');
// ── search
check('search by vendor (any capitals), bill number, release number', ids(G.searchBills(bills, 'ROAD')) === 'b1,b2,b5' && ids(G.searchBills(bills, 'inv-9')) === 'b2' && ids(G.searchBills(bills, '1161')) === 'b1');
check('search by amount, with or without $ and commas', ids(G.searchBills(bills, '40,000')) === 'b3' && ids(G.searchBills(bills, '$1500')) === 'b1' && ids(G.searchBills(bills, '800.50')) === 'b2');
check('several words must ALL match; the category’s label is searched too; a date works', ids(G.searchBills(bills, 'mill m-100')) === 'b3' && ids(G.searchBills(bills, 'mill trucker')) === '' && ids(G.searchBills(bills, 'purchased', { goods: 'Goods purchased' })) === 'b3' && ids(G.searchBills(bills, '2026-06-11')) === 'b4');
check('an empty search keeps everything; nothing found → an empty list (no crash)', G.searchBills(bills, '   ').length === 6 && G.searchBills(bills, 'zzz').length === 0 && G.groupByVendor([], '2026-07-01').length === 0);
check('search then group: only the vendors with a match remain, with totals of the matching bills only', (function () { var r = G.groupByVendor(G.searchBills(bills, 'inv-9'), '2026-07-01'); return r.length === 1 && r[0].count === 1 && r[0].open_cents === 50050; })());
// ── the screen
var src = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
check('Bills screen: search box, Grouped by vendor / All bills switch, open all / close all, and the list goes through search → sort → group', src.indexOf('placeholder="🔎 Search bills: vendor, bill number, release, amount…"') > 0 && src.indexOf("['grouped', '🗂 Grouped by vendor'], ['all', '☰ All bills in one list']") > 0 && src.indexOf('shown = sortBills(searchBills(shown, billQ, catLabelOf), sortBy, sortDir);') > 0 && src.indexOf('var vendorGroups = groupByVendor(shown, TODAY);') > 0 && src.indexOf('>open all</button>') > 0);
check('the column headers Vendor / Bill # / Bill date / Due / Amount / Open sort on click and reverse on a second click', src.indexOf("{th('Vendor', 'vendor')}{th('Bill #', 'bill_number')}") > 0 && src.indexOf("{th('Bill date', 'bill_date')}{th('Due', 'due')}") > 0 && src.indexOf("if (sortBy === k) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }") > 0);
check('the same bill row (with all its buttons) is used in both views; the existing Open / Paid / type / direction filters still run first', src.indexOf('{renderBillList(function (b) {') > 0 && src.indexOf("if (listView === 'all') { return shown.map(billRow); }") > 0 && src.indexOf("if (filter === 'open') { return b.record_status === 'active' && b.disputed !== true && b.open > 0.005; }") > 0 && src.indexOf('if (typeF && (typeF ===') > 0);
check('while searching, every vendor with a match is opened by itself', src.indexOf("function vendorOpen(g) { return searching || vendorGroups.length === 1 || openVendors[g.key] === true; }") > 0);
console.log('\nVU: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
