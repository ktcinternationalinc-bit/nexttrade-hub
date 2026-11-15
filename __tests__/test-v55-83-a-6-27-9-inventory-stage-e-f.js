// v55.83-A.6.27.9 (Max May 15 2026) — Inventory Stages E + F final phase

var fs = require('fs');
var path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var adj = read('src/components/AdjustmentsManager.jsx');
var rep = read('src/components/InventoryReports.jsx');
var tab = read('src/components/InventoryTab.jsx');
var perms = read('src/lib/inventory-permissions.js');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── Stage E — AdjustmentsManager ──────────────────────────────────
ok('E-1: AdjustmentsManager imports consumeFifo + reverseFifoConsumption',
  /import \{ consumeFifo, reverseFifoConsumption \} from '\.\.\/lib\/inventory-cost-engine'/.test(adj));
ok('E-2: 6 adjustment types defined (damage, return, count, write_off, manual_add, manual_remove)',
  /value: 'damage'/.test(adj) && /value: 'return'/.test(adj) &&
  /value: 'count'/.test(adj) && /value: 'write_off'/.test(adj) &&
  /value: 'manual_add'/.test(adj) && /value: 'manual_remove'/.test(adj));
ok('E-3: auto-signs qty by direction (out → negative, in → positive)',
  /typeDef.direction === 'out' && q > 0/.test(adj) &&
  /typeDef.direction === 'in' && q < 0/.test(adj));
ok('E-4: createAdjustment writes status=pending',
  /status: 'pending'/.test(adj));
ok('E-5: approval flow uses canApproveAdjustments helper',
  /import \{ canApproveAdjustments \} from '\.\.\/lib\/inventory-permissions'/.test(adj) &&
  /canApprove = canApproveAdjustments\(userProfile, modulePerms\)/.test(adj));
ok('E-6: OUT approval drains FIFO via consumeFifo',
  /qty < 0[\s\S]{0,400}consumeFifo\(adj\.sku_id, adj\.warehouse_id, Math\.abs\(qty\)\)/.test(adj));
ok('E-7: IN approval creates a new layer at weighted-avg cost',
  /from\('inv_layers'\)\s*\n?\s*\.insert\(\{[\s\S]{0,500}qty_received: qty,\s*qty_remaining: qty,\s*landed_unit_cost_usd: avgUnitUsd/.test(adj));
ok('E-8: rollback on movement insert failure',
  /Best-effort rollback[\s\S]{0,400}reverseFifoConsumption\(consumed\)/.test(adj));
ok('E-9: approve sets approved_by + approved_at + movement_id',
  /status: 'approved'[\s\S]{0,200}approved_by: myId[\s\S]{0,200}approved_at: new Date\(\)\.toISOString\(\)[\s\S]{0,200}movement_id: mRes\.data\.id/.test(adj));
ok('E-10: reject captures rejected_reason',
  /status: 'rejected'[\s\S]{0,400}rejected_reason: reason/.test(adj));
ok('E-11: status filter has pending/approved/rejected/all',
  /\['pending', 'approved', 'rejected', 'all'\]/.test(adj));

// ── Stage F — InventoryReports ────────────────────────────────────
ok('F-1: 3 report views (value / aging / slow)',
  /v: 'value'/.test(rep) && /v: 'aging'/.test(rep) && /v: 'slow'/.test(rep));
ok('F-2: Stock Value aggregates qty × landed_unit_cost per SKU',
  /q \* Number\(L\.landed_unit_cost_usd \|\| 0\)/.test(rep) &&
  /q \* Number\(L\.landed_unit_cost_egp \|\| 0\)/.test(rep));
ok('F-3: Aging has 5 buckets (fresh / 1-3 / 3-6 / 6-12 / >12 months)',
  /fresh: 0, m1to3: 0, m3to6: 0, m6to12: 0, over12: 0/.test(rep) &&
  /days > 365/.test(rep) && /days > 180/.test(rep) &&
  /days > 90/.test(rep) && /days > 30/.test(rep));
ok('F-4: Slow-Moving has user-tunable threshold (30/60/90/180)',
  /<option value=\{30\}>30 days<\/option>/.test(rep) &&
  /<option value=\{60\}>60 days<\/option>/.test(rep) &&
  /<option value=\{90\}>90 days<\/option>/.test(rep) &&
  /<option value=\{180\}>180 days<\/option>/.test(rep));
ok('F-5: Slow-Moving joins stock + last sale movement',
  /movement_type !== 'sale'/.test(rep) &&
  /lastSaleBySku\[m\.sku_id\]/.test(rep));
ok('F-6: loads layers + movements (limited to last 365d)',
  /from\('inv_layers'\)\.select\('\*'\)/.test(rep) &&
  /from\('inv_movements'\)[\s\S]{0,200}\.gte\('occurred_at', new Date\(Date\.now\(\) - 365/.test(rep));

// ── InventoryTab wires both ───────────────────────────────────────
ok('T-1: InventoryTab imports AdjustmentsManager + InventoryReports',
  /import AdjustmentsManager from '\.\/AdjustmentsManager'/.test(tab) &&
  /import InventoryReports from '\.\/InventoryReports'/.test(tab));
ok('T-2: all stages now available',
  /var available = true/.test(tab));
ok('T-3: adjustments subtab renders AdjustmentsManager',
  /subtab === 'adjustments'[\s\S]{0,400}<AdjustmentsManager/.test(tab));
ok('T-4: reports subtab renders InventoryReports',
  /subtab === 'reports'[\s\S]{0,400}<InventoryReports/.test(tab));
ok('T-5: version stamp present (Stage 6 of 6 banner now removed in v.43)',
  /v55\.83-A\.6\.27\.\d+/.test(tab));
ok('T-6: no coming-soon placeholder for adjustments/reports anymore',
  !/Coming in Stage [EF]/.test(tab));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.9 Stage E + F tests passed');
