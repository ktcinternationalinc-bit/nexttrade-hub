// v55.83-VH — Orders → Releases with no KTC invoice: split by warehouse status (Max 19 Nov: "separate the shipped from the
// pending status to other statuses in the comparison"). Runs the REAL reconcileReleases + static checks on the screen.
// Run: node __tests__/test-v55-83-vh-recon-shipped-split.js
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var L = require(path.join(root, 'src/lib/order-lifecycle.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

console.log('VH — warehouse phase');
check('Shipped and every later stage → shipped', ['shipped', 'post_loading_documentation', 'end_stage', 'closed'].every(function (s) { return L.warehousePhase({ status: s }) === 'shipped'; }));
check('Order created / Pre-load / Shipping In Process → not shipped yet', ['pending', 'preload', 'shipping_in_process'].every(function (s) { return L.warehousePhase({ status: s }) === 'not_shipped'; }));
check('a shipped date recorded on an early stage → shipped (the date wins)', L.warehousePhase({ status: 'preload', shipped_date: '2026-11-02 10:00:00' }) === 'shipped');
check('an unknown status with no shipped date → other', L.warehousePhase({ status: 'on_hold' }) === 'other' && L.warehousePhase({ status: '' }) === 'other' && L.warehousePhase(null) === 'other');
check('an unknown status WITH a shipped date → shipped', L.warehousePhase({ status: 'weird', shipped_date: '2026-10-01' }) === 'shipped');

console.log('VH — the comparison rows');
var orders = [
  { id: 1, release_number: '1002-1001', customer_name: 'A Co', status: 'shipped', shipped_date: '2026-10-05 08:00:00', created_at: '2026-09-01' },
  { id: 2, release_number: '1002-1002', customer_name: 'B Co', status: 'preload', load_date: '2026-11-25', created_at: '2026-11-01' },
  { id: 3, release_number: '1002-1003', customer_name: 'C Co', status: 'end_stage', shipped_date: '2026-09-10', created_at: '2026-08-01' },
  { id: 4, release_number: '1002-1004', customer_name: 'D Co', status: 'mystery', created_at: '2026-10-10' },
  { id: 5, release_number: '1002-1005', customer_name: 'E Co', status: 'shipped', shipped_date: '2026-10-06', created_at: '2026-09-01' },
  { id: 6, release_number: '1002-1006', customer_name: 'F Co', status: 'cancelled', created_at: '2026-10-01' }
];
var invoices = [{ id: 'i5', invoice_number: 'INV-5', release_number: '1002-1005', record_status: 'active', approval_status: 'approved', invoice_date: '2026-10-07' }];
var rows = L.reconcileReleases(orders, invoices, '2026-06-01');
function ph(id) { var r = rows.filter(function (x) { return x.order_id === id; })[0]; return r ? r.phase : null; }
check('every row carries its phase', rows.every(function (r) { return ['shipped', 'not_shipped', 'other'].indexOf(r.phase) >= 0; }), rows);
check('shipped with no invoice → shipped; preload → not shipped yet; end stage → shipped; unknown → other', ph(1) === 'shipped' && ph(2) === 'not_shipped' && ph(3) === 'shipped' && ph(4) === 'other', rows.map(function (r) { return [r.order_id, r.phase]; }));
check('an order WITH its invoice is still not listed; cancelled still left out (unchanged rules)', ph(5) === null && ph(6) === null);
check('the problem state is unchanged (all four: "No invoice at all")', rows.every(function (r) { return r.state === 'none'; }), rows.map(function (r) { return r.state; }));

console.log('VH — the screen');
var T = fs.readFileSync(path.join(root, 'src/components/OrderMonitorTab.jsx'), 'utf8');
check('a "Warehouse status" chip row: Shipped / Not shipped yet / Other statuses / All statuses, with counts', /Warehouse status:/.test(T) && /\['shipped', 'Shipped', 'blocked'\], \['not_shipped', 'Not shipped yet', 'wait'\], \['other', 'Other statuses', 'na'\], \['all', 'All statuses', 'na'\]/.test(T) && /x\[1\] \+ ' · ' \+ n/.test(T));
check('it opens on Shipped', /useState\('shipped'\); var ph = s6\[0\]/.test(T));
check('the problem groups and their counts follow the chosen status', /return ph === 'all' \|\| \(r.phase \|\| 'other'\) === ph/.test(T) && /var rows = tabRows\.filter\(inPhase\)/.test(T) && /var cnt = \{\}; rows\.forEach/.test(T));
check('the CSV says Shipped? for each row and includes its invoice review', /'Warehouse status', 'Shipped\?', 'Invoice review'/.test(T) && /\{ shipped: 'Shipped', not_shipped: 'Not shipped yet', other: 'Other status' \}\)\[r\.phase\]/.test(T));
check('the VH release remains in What\'s New', /version: 'v55\.83-VH'/.test(fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8')));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
