// v55.83-N — asserts the NEXPAC import is wired into the REAL Inbound Shipments
// component (InventoryReceiving.jsx, subtab 'receivestock'), auto-filling the
// Shipment Expected Totals from the report. Static-source assertions.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/components/InventoryReceiving.jsx'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }

ok(/import\s*\{\s*parseNexpac\s*,\s*NEXPAC_DEFAULTS\s*\}\s*from\s*'\.\.\/lib\/nexpac-parse'/.test(src), 'imports parseNexpac + NEXPAC_DEFAULTS');
ok(src.indexOf('NEXPAC_PDFJS_SRC') !== -1 && src.indexOf('NEXPAC_PDFJS_WORKER') !== -1, 'pdf.js CDN constants present');
ok(src.indexOf('handleNexpacImport') !== -1, 'handleNexpacImport handler present');
ok(/setHeader\(function \(prev\)/.test(src), 'auto-fill uses functional setHeader');
['container_number', 'shipment_reference', 'expected_total_rolls', 'expected_total_gross_kg', 'expected_total_net_kg']
  .forEach(function (f) { ok(src.indexOf(f + ':') !== -1 || src.indexOf(f) !== -1, 'auto-fills header.' + f); });
ok(src.indexOf('Import NEXPAC report') !== -1, 'Import button label present');
ok(src.indexOf('nexpacPreview &&') !== -1, 'breakdown preview gated on nexpacPreview');
ok(/ktcGrade/.test(src) && /finalNetWeightKg/.test(src), 'breakdown shows ktcGrade + net kg');
ok(src.indexOf('Inventory is not affected') !== -1, 'preview clarifies inventory not touched');
// only the empty-field guard for ref/container (do not overwrite typed values)
ok(/if \(!prev\.container_number\) patch\.container_number = hd\.containerNumber/.test(src), 'container only filled when empty');
ok(/if \(!prev\.shipment_reference\) patch\.shipment_reference = hd\.releaseNumber/.test(src), 'shipment ref only filled when empty');

console.log('\nv55.83-N receiving NEXPAC import: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
