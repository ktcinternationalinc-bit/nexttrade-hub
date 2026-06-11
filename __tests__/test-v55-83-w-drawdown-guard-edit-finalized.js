// v55.83-W — delete/cancel clear overview entries unless sold; edit-after-finalize.
const fs = require('fs'); const path = require('path');
const p = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const r = p('src/components/InventoryReceiving.jsx');

ok(/async function shipmentDrawdown\(g\)/.test(r), 'shipmentDrawdown helper exists');
ok(/qty_received \|\| 0\) - Number\(l\.qty_remaining/.test(r), 'drawdown computes consumed = received - remaining');
// delete: guard + clears overview
ok(/if \(dd\.consumedQty > 0\)/.test(r), 'delete blocks when stock already sold');
ok(/from\('inventory_movements'\)\.delete\(\)\.in\('source_receipt_id'/.test(r), 'delete removes stock movements');
ok(/from\('inventory_layers'\)\.delete\(\)\.in\('source_receipt_id'/.test(r), 'delete removes cost layers (overview entries)');
ok(!/This shipment is FINALIZED and owns cost layers\. Reopen it first/.test(r), 'delete no longer hard-blocks finalized');
// cancel guard
ok(/ddC = await shipmentDrawdown\(cancelTarget\)/.test(r), 'cancel checks drawdown');
ok(/Cannot cancel ' \+ rn \+ ': ' \+ ddC\.consumedQty/.test(r), 'cancel blocks when sold');
// reopen / edit-after-finalize
ok(/if \(!isSuperAdmin && !canEdit\)/.test(r), 'reopen allowed for super-admin OR Edit Inventory');
ok(/ddR\.consumedQty > 0 && !isSuperAdmin/.test(r), 'reopen of sold stock limited to super-admin');
ok(/\(isSuperAdmin \|\| canEdit\) && isFinalized && \(/.test(r), 'Edit(reopen) button shows for privileged on finalized');
ok(/🔓 Edit \(reopen\)/.test(r), 'finalized Edit button labelled');
// delete button now allowed on finalized (super-admin)
ok(/\{isSuperAdmin && \(\n\s*<button\n\s*onClick=\{function \(\) \{ deleteShipment/.test(r), 'Delete button shows for super-admin incl. finalized');

ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')), 'page.jsx stamped (current v55.83 build)');
ok(/version: 'v55\.83-W'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew has v55.83-W');

console.log('\nv55.83-W drawdown guard + edit-finalized: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
