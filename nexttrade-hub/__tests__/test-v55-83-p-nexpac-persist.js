// v55.83-P — NEXPAC breakdown persistence (save + load-back) static assertions.
const fs = require('fs');
const p = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

const rc = p('src/components/InventoryReceiving.jsx');

// save: breakdown added to header payload, gated on nexpacPreview, in the shape the panel reads
ok(/if \(nexpacPreview\) \{\s*headerPayload\.nexpac_breakdown = \{/.test(rc), 'save: nexpac_breakdown set only when a report was imported');
ok(/header: \{ releaseNumber:.*containerNumber:/.test(rc), 'save: stored shape keeps header.releaseNumber/containerNumber');
ok(/lines: nexpacPreview\.lines \|\| \[\]/.test(rc), 'save: persists the per-line breakdown');
ok(/imported_at: new Date\(\)\.toISOString\(\)/.test(rc), 'save: stamps imported_at');
ok(rc.indexOf('headerPayload.nexpac_breakdown') < rc.indexOf("dbInsert('inventory_shipment_headers', headerPayload"), 'save: breakdown set before header insert');

// load-back: both edit paths
ok(/setNexpacPreview\(\(h && h\.nexpac_breakdown\) \|\| null\)/.test(rc), 'load: header-only edit restores breakdown');
ok(/from\('inventory_shipment_headers'\)\.select\('[^']*nexpac_breakdown'\)\.eq\('receipt_number', grouped\.receipt_number\)/.test(rc), 'load: normal edit fetches breakdown by receipt_number');
ok(/setNexpacPreview\(hRow\.nexpac_breakdown \|\| null\)/.test(rc), 'load: normal edit sets breakdown from fetched header');

// resets: new + close clear the preview so a stale breakdown never leaks across receipts
const clears = (rc.match(/setNexpacPreview\(null\)/g) || []).length;
ok(clears >= 2, 'reset: openNew + closeModal clear nexpacPreview (found ' + clears + ')');

// version stamps aligned
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')), 'page.jsx has a v55.83 build stamp');
ok(/version: 'v55\.83-P'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew still has the v55.83-P entry');

console.log('\nv55.83-P NEXPAC persistence: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
