// v55.83-OO — P&L: effective-dated product costs. Max: "if we change the cost
// at a given time, you need to know from what starting date that price changed
// ... the P&L for those invoices after that date will use the new cost" and
// "make sure you test it correctly" — so the date logic runs FUNCTIONALLY here
// against the real resolver, not just regex.
var fs = require('fs');
var path = require('path');
function rd(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
var rt = rd('src/app/api/accounting/pnl/route.js');
var ui = rd('src/components/PnLTab.jsx');
var at = rd('src/components/AccountingTab.jsx');
var st = rd('src/components/SettingsTab.jsx');
var sq = rd('sql/v55-83-OO-product-costs.sql');
var failed = [];
function ok(l, c) { if (c) console.log('✓ ' + l); else { failed.push(l); console.log('✗ ' + l); } }

// ── FUNCTIONAL: the real resolver, loaded from the real lib (ESM -> quick transform)
var libSrc = rd('src/lib/product-cost.js').replace(/export function/g, 'function');
libSrc += '\nmodule.exports = { normalizeProductKey: normalizeProductKey, pickCost: pickCost, groupCosts: groupCosts };';
var tmp = path.join(__dirname, '.tmp-product-cost.cjs');
fs.writeFileSync(tmp, libSrc);
var lib = require(tmp);
fs.unlinkSync(tmp);

var costs = [
  { cost_per_unit: 10, effective_from: '2026-01-01' },
  { cost_per_unit: 12, effective_from: '2026-07-01' },
  { cost_per_unit: 11, effective_from: '2026-03-15' }
];
ok('F1: invoice dated 2026-06-15 uses the cost effective 2026-03-15 (11) — not the later 12, not the older 10',
  lib.pickCost(costs, '2026-06-15').cost_per_unit === 11);
ok('F2: invoice dated 2026-07-01 (the change date itself) uses the NEW cost (12)',
  lib.pickCost(costs, '2026-07-01').cost_per_unit === 12);
ok('F3: invoice dated 2026-12-31 uses the latest cost (12)',
  lib.pickCost(costs, '2026-12-31').cost_per_unit === 12);
ok('F4: invoice dated BEFORE any cost existed (2025-05-01) resolves to NULL — uncosted, never guessed',
  lib.pickCost(costs, '2025-05-01') === null);
ok('F5: no invoice date -> null; empty cost list -> null',
  lib.pickCost(costs, '') === null && lib.pickCost([], '2026-06-15') === null);
ok('F6: product keys normalize (case + whitespace) so "Grade A  Black" and "grade a black" are ONE product',
  lib.normalizeProductKey('  Grade A   Black ') === 'grade a black' &&
  Object.keys(lib.groupCosts([{ product_key: 'Grade A Black', effective_from: '2026-01-01' }, { product_key: 'grade a  black', effective_from: '2026-02-01' }])).length === 1);

// ── Route behavior
ok('OO1: TWO separate permissions — pnl.edit_costs for entering costs, pnl.view for seeing the P&L — each named on refusal',
  /assertPermission\(db, userId, 'pnl\.edit_costs', req\)/.test(rt) &&
  /assertPermission\(db, userId, 'pnl\.view', req\)/.test(rt) &&
  /"P&L: Edit Product Costs" permission/.test(rt) && /"P&L: View" permission/.test(rt));
ok('OO2: changing a cost ADDS a dated row (upsert on product_key+effective_from) — history never overwritten',
  /onConflict: 'product_key,effective_from'/.test(rt) && /UNIQUE \(product_key, effective_from\)/.test(sq));
ok('OO3: the report uses pickCost per invoice DATE and splits costed vs uncosted revenue honestly',
  /pickCost\(costsByKey\[k\], parent\.invoice_date\)/.test(rt) && /uncostedRevenue/.test(rt) &&
  /margin computed on COSTED revenue only/.test(rt));
ok('OO4: uncosted products are reported with the REASON (no cost yet vs none effective on those dates)',
  /no cost entered yet/.test(rt) && /none effective on these invoice dates/.test(rt));
ok('OO5: shipping stays out of COGS and product P&L; non-USD stays out of the USD P&L',
  /isShippingLine\(name\)\) \{ shippingRevenue/.test(rt) && /usdIds\[it\.invoice_id\] !== true\) \{ return; \}/.test(rt));
ok('OO6: live invoices only, period on invoice_date',
  /st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'/.test(rt) &&
  /gte\('invoice_date', df\)/.test(rt));

// ── UI + catalog
ok('OO7: UI gates — view needs pnl.view, the cost editor appears only with pnl.edit_costs; super admin passes',
  /modulePerms\['pnl\.view'\] === true/.test(ui) && /modulePerms\['pnl\.edit_costs'\] === true/.test(ui) &&
  /canEditCosts && showCosts/.test(ui));
ok('OO8: cost entry = cost per unit + EFFECTIVE-FROM date, with per-product history expandable',
  /effective_from: eff,/.test(rt) && /cost history/.test(ui) && /Effective from/.test(ui));
ok('OO9: P&L periods — default Jun 1 2026 →, Last month, 3 months, 6 months, This year, 2025, All + custom',
  /useState\('2026-06-01'\)/.test(ui) && /'Last month'/.test(ui) && /'Last 3 months'/.test(ui) &&
  /'Last 6 months'/.test(ui) && /'2025', '2025-01-01', '2025-12-31'/.test(ui) && /'All history'/.test(ui));
ok('OO10: P&L by product (avg price, avg cost, profit, margin) AND by invoice; uncosted rows tinted amber',
  /P&L by product/.test(ui.replace(/&amp;/g, '&')) && /P&L by invoice/.test(ui.replace(/&amp;/g, '&')) &&
  /avg_cost/.test(ui) && /#fff7ed/.test(ui));
ok('OO11: both permissions are grantable in Settings → Permissions (catalog entries exist)',
  /key: 'pnl\.view',/.test(st) && /key: 'pnl\.edit_costs',/.test(st) &&
  /P&L: Edit Product Costs/.test(st));
ok('OO12: the tab lives under Accounting; SQL is idempotent with 4 RLS policies',
  /\['pnl', '📊 P&L'\]/.test(at) && /CREATE TABLE IF NOT EXISTS product_costs/.test(sq) &&
  (sq.match(/CREATE POLICY/g) || []).length === 4);

if (failed.length) { console.log('FAILED (' + failed.length + '):'); failed.forEach(function (x) { console.log('  - ' + x); }); process.exit(1); }
else { console.log('ALL CHECKS PASSED — v55.83-OO P&L (6 functional + 12 structural)'); }
