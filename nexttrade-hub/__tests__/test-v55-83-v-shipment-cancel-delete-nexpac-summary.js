// v55.83-V — inbound shipment cancel/delete + NEXPAC summary display guards.
const fs = require('fs');
const path = require('path');
const p = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const r = p('src/components/InventoryReceiving.jsx');

// --- Delete (hard, super_admin) ---
ok(/dbDelete/.test(r) && /from '\.\.\/lib\/supabase'/.test(r), 'dbDelete imported');
ok(/async function deleteShipment\(g\)/.test(r), 'deleteShipment function exists');
ok(/if \(!isSuperAdmin\)/.test(r) && /deleteShipment/.test(r), 'delete is super-admin gated');
ok(/shipmentDrawdown\(g\)/.test(r), 'delete guarded by drawdown check (v55.83-W superseded the finalized block)');
ok(/typed\.trim\(\) !== rn/.test(r), 'delete requires type-to-confirm receipt number');
ok(/dbDelete\('inventory_stock_receipts'/.test(r) && /dbDelete\('inventory_shipment_headers'/.test(r), 'delete removes lines + header');
ok(/inventory_receipt_rolls'\)\.delete\(\)/.test(r), 'delete removes rolls first (FK)');
ok(/\{isSuperAdmin && \(\n\s*<button\n\s*onClick=\{function \(\) \{ deleteShipment/.test(r), 'Delete button gated to super-admin (v55.83-W allows finalized)');
ok(/🗑 Delete/.test(r), 'Delete button rendered');

// --- Cancel/Restore now handle the header (shells) ---
ok(/inventory_shipment_headers', hdrCancel\.id, \{[\s\S]*?status: 'cancelled'/.test(r), 'cancel flips header status (shell support)');
ok(/inventory_shipment_headers', hdrRestore\.id/.test(r), 'restore flips header status back');

// --- NEXPAC summary display ---
ok(/var headerByNumber = \{\};/.test(r), 'headerByNumber lookup built');
ok(/header: headerByNumber\[rn\] \|\| null/.test(r), 'header attached to receipt-grouped rows');
ok(/var hasExpected = expRolls != null \|\| expGross != null \|\| expNet != null/.test(r), 'expected NEXPAC flag computed');
ok(/📋 NEXPAC expected/.test(r), 'shell row renders NEXPAC expected totals');
ok(/expNet\.toLocaleString/.test(r) && /expRolls\.toLocaleString/.test(r), 'expected net + rolls displayed');

// --- version ---
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')), 'page.jsx stamped (current v55.83 build)');
ok(/version: 'v55\.83-V'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew has v55.83-V');

console.log('\nv55.83-V cancel/delete + NEXPAC summary: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
