// v55.83-T — ONE inventory engine. System B (inv_sku_id/consumeFifo/inv_layers/inv_movements)
// retired from every LIVE path; System A (variant_id -> consume_invoice_item_inventory RPC)
// is the sole engine for sales, adjustments, and the dashboard.
const fs = require('fs');
const path = require('path');
const p = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

const page = p('src/app/page.jsx');
const tab = p('src/components/InventoryTab.jsx');
const wn = p('src/components/WhatsNewWidget.jsx');

// --- System B fully removed from the SALE path ---
ok(!/consumeFifo\(item\.inv_sku_id/.test(page), 'no consumeFifo on sale');
ok(!/from\('inv_movements'\)\s*\.insert\(/.test(page.replace(/\s+/g, ' ')), 'no inv_movements insert on sale');
ok(!/inv_sku_id: item\.inv_sku_id/.test(page), 'inv_sku_id no longer written to invoice_items payload');
ok(!/<select value=\{item\.inv_sku_id/.test(page), 'inv_sku_id picker <select> removed');
ok(!/📦 SKU \(optional\)/.test(page), 'SKU column header removed');

// --- System A is the SOLE sale engine ---
ok(/rpc\('consume_invoice_item_inventory'/.test(page), 'System A consume RPC still present');
ok((page.match(/consume_invoice_item_inventory/g) || []).length >= 1, 'System A RPC referenced');

// --- Adjustments: only System A renders now ---
ok(!/<AdjustmentsManager\b/.test(tab), 'System B AdjustmentsManager no longer rendered');
ok(/<InventoryAdjustments\b/.test(tab), 'System A InventoryAdjustments still rendered');
ok((tab.match(/subtab === 'adjustments' &&/g) || []).length === 1, 'exactly ONE adjustments render branch');

// --- backward-compat reverse paths kept (so old inv_movements still reverse) ---
ok(/reverseFifoConsumption/.test(page), 'reverseFifoConsumption kept for historical rows');

// --- version + whatsnew ---
ok(/>v55\.83-[A-Z]+</.test(page), 'page.jsx header stamped (current v55.83 build)');
ok(/version: 'v55\.83-T'/.test(wn), 'WhatsNew has v55.83-T entry');
ok(/UNREACHABLE/.test(wn), 'WhatsNew honestly notes dead legacy branches remain (super-admin)');

console.log('\nv55.83-T single-inventory-engine: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
