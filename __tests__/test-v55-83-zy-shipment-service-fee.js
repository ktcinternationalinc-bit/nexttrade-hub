// v55.83-ZY (Codex 27 Nov 14:03, HOLD ZY-01): a shipment-linked "Other services" bill (e.g. a $75 port-document fee on the release)
// must not silently disappear from shipment profitability. Runs the REAL assembler: the fee is listed under "Amounts NOT yet placed"
// with a flag naming the bill and release; an Operational bill on no shipment is never on a container; a trucking bill (control) is
// still counted as before.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var fs = require('fs');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('ZY-01 — a shipment-linked Other services fee is never silently dropped (real assembler)');
function bill(id, type, dir, rel, amt) { return { id: id, bill_number: 'B-' + id, vendor_name: 'Port Docs Co', bill_date: '2026-09-25', total_amount: amt, record_status: 'active', bill_type: type, shipment_direction: dir, release_number: rel }; }
function run(bills) {
  return A.assembleProfitability({ date_from: '', date_to: '', windowDays: 90, warehouseOn: false, customerNames: {}, bills: bills, billLines: [], warehouseRows: [],
    invoices: [{ id: 'i1', invoice_number: 'HOU 7', accounting_customer_id: 'x', invoice_date: '2026-09-22', record_status: 'active', currency: 'USD', release_number: '1002-901' }],
    items: [{ id: 'l1', invoice_id: 'i1', description: 'Paper per LBs', quantity: 10000, unit_price: 0.1 }],
    nameUnits: [{ name_key: 'paper per lbs', unit: 'lb' }] });
}
function row(r) { return r.by_invoice.filter(function (x) { return x.label === 'HOU 7'; })[0]; }
var none = run([]);
var svc = run([bill('s1', 'other_services', 'outbound', '1002-901', 75)]);
var u = (svc.unallocated || []).filter(function (x) { return x.what === 'other_services_on_release'; });
check('the $75 Other services fee on release 1002-901 is listed under amounts NOT yet placed, with bill and release', u.length === 1 && u[0].amount === 75 && u[0].bill === 'B-s1' && u[0].release === '1002-901' && /NOT counted/.test(u[0].why), svc.unallocated);
check('…and flagged so the margin does not look complete', (svc.flags || []).some(function (f) { return f.kind === 'service_bill_on_release_not_counted' && f.amount === 75 && f.releases.join() === '1002-901'; }), svc.flags);
check('the container figures themselves are unchanged (nothing invented or mislabelled as trucking)', JSON.stringify(row(svc).outbound_cost) === JSON.stringify(row(none).outbound_cost) && row(svc).profit === row(none).profit, [row(svc), row(none)]);
var svcIn = run([bill('s2', 'other_services', 'inbound', '1002-901', 40)]);
check('an Other services bill on the release but marked Inbound is listed the same way (never silently dropped)', (svcIn.unallocated || []).some(function (x) { return x.what === 'other_services_on_release' && x.amount === 40; }));
var op = run([bill('o1', 'other_services', 'operational', null, 90), bill('o2', 'supplier', 'operational', null, 64.2)]);
check('Operational bills (QuickBooks, office supplies) are never on a container, never unallocated, never flagged', !(op.unallocated || []).some(function (x) { return x.bill === 'B-o1' || x.bill === 'B-o2'; }) && !(op.flags || []).some(function (f) { return f.bill === 'B-o1' || f.bill === 'B-o2'; }) && row(op).profit === row(none).profit);
var other = run([bill('s3', 'other_services', 'outbound', '1001-55', 30)]);
check('an Other services bill on a release that is not in this report is not listed here', !(other.unallocated || []).some(function (x) { return x.bill === 'B-s3'; }));
var trk = run([bill('t1', 'trucking', 'outbound', '1002-901', 75)]);
check('control: the same $75 as a trucking bill is still counted on the container as before', row(trk).profit !== row(none).profit && !(trk.unallocated || []).some(function (x) { return x.bill === 'B-t1'; }), [row(trk).profit, row(none).profit]);
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('the screen words the flag and shows it with the bill warnings', /service_bill_on_release_not_counted: 'An Other services bill is tied to this shipment and is NOT in its profit yet'/.test(tab) && /f\.kind === 'service_bill_on_release_not_counted' \|\|/.test(tab));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
