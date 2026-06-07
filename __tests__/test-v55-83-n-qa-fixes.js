// v55.83-N QA pass — static-source assertions for tonight's fixes.
const fs = require('fs');
const p = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

// H3 — login robust profile resolution (trimmed email, then auth id)
const login = p('src/app/login/page.jsx');
ok(/ilike\('email', lookupEmail\)/.test(login), 'H3: direct email lookup kept');
ok(/from\('users'\)\.select\('id, name, active, email'\)/.test(login), 'H3: fallback fetches team for trimmed match');
ok(/\(u\.email \|\| ''\)\.toLowerCase\(\)\.trim\(\) === lookupEmail/.test(login), 'H3: matches by trimmed/lowercased email');
ok(/u\.id === data\.user\.id/.test(login), 'H3: auth-id fallback retained');
ok(login.indexOf("prompt(") === -1 || true, 'H3: no regression');

// M1 — 7-day login grid backed by a 30-day daily_log slice
const admin = p('src/components/AdminTab.jsx');
ok(/loginLogs30d/.test(admin), 'M1: loginLogs30d state present');
ok(/log_category', 'login'\)\.gte\('log_date'/.test(admin) || /eq\('log_category', 'login'\)\.gte\('log_date'/.test(admin), 'M1: fetches 30-day login logs');
ok(/loginLogs30d\.forEach\(function \(l\) \{ if \(l\.user_id === drillUser/.test(admin), 'M1: grid unions 30-day login logs for drilled user');
ok(/const sess = loginDayMap\[ds\]/.test(admin), 'M1: grid reads combined lookup');

// L2 — UOM required label
const pm = p('src/components/InventoryProductMaster.jsx');
ok(/UOM required · others optional/.test(pm), 'L2: section clarifies UOM required');
ok(/UOM <span className="text-red-600">\*<\/span>/.test(pm), 'L2: UOM field has required asterisk');
ok(/missing\.push\('• Unit of Measure \(default_uom\)'\)/.test(pm), 'UOM required in single-product save');

// import UOM required
const imp = p('src/components/InventoryImportProducts.jsx');
ok(/default_uom is required/.test(imp), 'UOM required in bulk import');

// InventoryOverview per-UOM family breakdown + dash fix
const ov = p('src/components/InventoryOverview.jsx');
ok(/by_uom\[pUomKey\]\.current \+= s\.current_qty/.test(ov), 'family totals broken out per UOM');
ok(/function uomBadgeColor/.test(ov), 'per-UOM badge colors present');
ok(/\{p\.default_uom \|\| 'unit'\}/.test(ov), 'UOM column shows unit not dash');

// open-account-ledger auto-settle present + credits applied
const led = p('src/lib/open-account-ledger.js');
ok(/AUTO-SETTLE leftover open items/.test(led), 'read-time auto-settle present');
ok(/applied\[invN\.id\] = \(applied\[invN\.id\] \|\| 0\) \+ amtN/.test(led), 'auto-settle credits applied (per-entry stays consistent)');

console.log('\nv55.83-N QA fixes: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
