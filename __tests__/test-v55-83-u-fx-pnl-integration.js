// v55.83-U — FX P&L integration guards (SQL + report + model).
const fs = require('fs');
const path = require('path');
const p = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

const sql = p('sql/v55-83-u-fx-pnl-integration.sql');
const rep = p('src/components/FxPnLReport.jsx');

// --- SQL: columns + entry-EGP accumulation + correct stamps ---
ok(/ADD COLUMN IF NOT EXISTS cogs_egp_at_receipt/.test(sql), 'SQL adds cogs_egp_at_receipt');
ok(/ADD COLUMN IF NOT EXISTS gross_profit_egp/.test(sql), 'SQL adds gross_profit_egp');
ok(/ADD COLUMN IF NOT EXISTS realized_fx_egp/.test(sql), 'SQL adds realized_fx_egp');
ok(/COALESCE\(v_layer\.cost_egp_at_receipt, v_layer\.cost_per_uom\)/.test(sql), 'SQL accumulates entry-rate EGP COGS from layer (with native fallback)');
ok(/gross_profit_egp\s*=\s*v_line_total - v_cost_egp_at_receipt/.test(sql), 'SQL: real margin = revenue - EGP COGS@receipt');
ok(/realized_fx_egp\s*=\s*v_cost_egp_at_receipt - v_cost_egp_at_sale/.test(sql), 'SQL: realized FX = receipt - sale (neg=devaluation)');
ok(/cost_egp_at_receipt\b/.test(sql) && /ORDER BY receipt_date ASC/.test(sql), 'SQL FIFO selects cost_egp_at_receipt');

// --- Report: reads invoice_items (sales), correct signs ---
ok(/from\('invoice_items'\)/.test(rep), 'report loads invoice_items as the sale source');
ok(/saleItems\.forEach/.test(rep), 'realized section iterates consumed invoice lines');
ok(/var realizedFx = costAtReceipt - costAtSale;/.test(rep), 'report realized FX sign = receipt - sale (fixed)');
ok(/var unrealizedFx = costAtReceipt - todayValue;/.test(rep), 'report unrealized FX sign fixed');
ok(!/var realizedFx = costAtSale - costAtReceipt;/.test(rep), 'old (wrong) realized FX sign removed');
ok(/cogs_egp_at_receipt/.test(rep) && /cost_egp_at_sale/.test(rep), 'report uses both EGP cost snapshots');

// --- version ---
ok(/>v55\.83-U</.test(p('src/app/page.jsx')), 'page.jsx stamped v55.83-U');
ok(/version: 'v55\.83-U'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew has v55.83-U');

console.log('\nv55.83-U FX P&L integration: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
