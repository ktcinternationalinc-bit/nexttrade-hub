// v55.83-S — Inbound Orders tab must source from stock receipts (so pending stock shows).
const fs = require('fs');
const p = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const ov = p('src/components/InventoryOverview.jsx');

ok(/var \[historyReceipts, setHistoryReceipts\] = useState\(\[\]\)/.test(ov), 'historyReceipts state added');
ok(/from\('inventory_stock_receipts'\)\s*\n?\s*\.select\('\*'\)\s*\n?\s*\.eq\('product_id', product\.id\)/.test(ov.replace(/\s+/g, ' ')) ||
   /from\('inventory_stock_receipts'\).select\('\*'\).eq\('product_id', product.id\)/.test(ov.replace(/\s+/g, ' ')), 'inbound loads stock receipts by product');
ok(/setHistoryReceipts\(\(inbRes\.data \|\| \[\]\)\.filter\(function \(r\) \{ return r\.status !== 'cancelled'/.test(ov), 'excludes cancelled receipts');
ok(/Inbound Orders \(' \+ historyReceipts\.length/.test(ov), 'tab count uses receipts');
ok(/historyReceipts\.map\(function \(r\)/.test(ov), 'inbound table renders receipts');
ok(/Received · awaiting cost/.test(ov) && /In stock · costed/.test(ov), 'status badges for finalized vs pending');
// the old layer-sourced inbound count must be gone
ok(!/Inbound Orders \(' \+ historyLayers\.length/.test(ov), 'inbound no longer counts cost layers');
ok(!/historyLayers\.map\(function \(layer\)/.test(ov), 'inbound table no longer renders cost layers');
// resets
const resets = (ov.match(/setHistoryReceipts\(\[\]\)/g) || []).length;
ok(resets >= 2, 'receipts reset on open + close (found ' + resets + ')');
// version
ok(/version: 'v55\.83-S'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew has v55.83-S entry');

console.log('\nv55.83-S inbound-from-receipts: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
