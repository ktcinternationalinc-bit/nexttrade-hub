// ============================================================
// S20 (Apr 23 2026) — Three-field inventory flow + super-admin
// adjustment journal + breakdown/filter UI
// ============================================================
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var imp = fs.readFileSync(path.join(REPO, 'src/components/InventoryImport.jsx'), 'utf8');

// ==== SQL ====
test('S20.1 inventory_adjustments SQL file exists', function() {
  var p = path.join(REPO, 'sql/s20_inventory_adjustments.sql');
  assert(fs.existsSync(p), 'SQL file exists');
  var sql = fs.readFileSync(p, 'utf8');
  assert(/CREATE TABLE IF NOT EXISTS inventory_adjustments/.test(sql), 'creates table');
  assert(/product_id TEXT NOT NULL/.test(sql), 'product_id col');
  assert(/field TEXT NOT NULL/.test(sql), 'field col');
  assert(/old_value NUMERIC/.test(sql), 'old_value col');
  assert(/new_value NUMERIC/.test(sql), 'new_value col');
  assert(/reason TEXT/.test(sql), 'reason col');
  assert(/source TEXT/.test(sql), 'source col');
  assert(/adjusted_by UUID/.test(sql), 'adjusted_by col');
  assert(/adjusted_at TIMESTAMPTZ DEFAULT now\(\)/.test(sql), 'adjusted_at col');
});

// ==== Page.jsx — three-field form ====
test('S20.2 Three quantity fields in Add Product form', function() {
  assert(/prodInboundQty/.test(page), 'inbound quantity state present');
  assert(/Inbound Quantity \{isFirstTime \? '\(this first batch\)' : '\(add to existing\)'\}/.test(page),
    'inbound qty label adapts to new-vs-existing');
  assert(/Original Quantity \{qtyLocked && <span className="text-red-600">🔒<\/span>\}/.test(page),
    'Original has lock indicator');
  assert(/Current Quantity \{qtyLocked && <span className="text-red-600">🔒<\/span>\}/.test(page),
    'Current has lock indicator');
});

test('S20.3 Inbound field is always editable', function() {
  var m = page.match(/Inbound Quantity[\s\S]{0,1200}?disabled=/);
  assert(!m || /disabled=\{false\}/.test(m[0]) || !/disabled=\{qtyLocked\}/.test(m[0]),
    'Inbound input is not locked by qtyLocked');
});

test('S20.4 Super-admin reason field appears when changing Orig/Current', function() {
  assert(/🧾 Reason for adjustment \(journal entry\)/.test(page),
    'reason prompt shown for super-admin edits');
  assert(/prodAdjReason/.test(page), 'reason state field');
});

// ==== Save handler — adjustment writes to journal ====
test('S20.5 Save handler requires reason for super-admin adjustment', function() {
  assert(/Please provide a reason for the adjustment/.test(page),
    'blocks save if super-admin changed value without reason');
});

test('S20.6 Save handler writes inventory_adjustments on super-admin override', function() {
  assert(/dbInsert\('inventory_adjustments'/.test(page),
    'adjustment journal insert present');
  assert(/source: 'manual'/.test(page),
    'manual source set for in-app adjustments');
});

test('S20.7 Save handler adds inbound to existing + inbound_quantity > 0 logs inbound', function() {
  assert(/if \(inboundQty > 0\) \{[\s\S]{0,200}dbInsert\('inventory_inbounds'/.test(page),
    'inbound row created only when inboundQty > 0');
});

// ==== page.jsx — invAdjustments state + loader ====
test('S20.8 invAdjustments state present', function() {
  assert(/const \[invAdjustments, setInvAdjustments\] = useState\(\[\]\)/.test(page),
    'state hook exists');
  assert(/from\('inventory_adjustments'\)\.select\('\*'\)/.test(page),
    'loader pulls data from the table');
});

// ==== Adjustment Journal section in Product Detail ====
test('S20.9 Adjustment Journal section exists in product detail', function() {
  assert(/🧾 Adjustment Journal/.test(page), 'section header');
  assert(/const adjForProd = \(invAdjustments \|\| \[\]\)\.filter\(a => a\.product_id === p\.product_id\)/.test(page),
    'filters adjustments by product_id');
});

test('S20.10 Adjustment Journal renders columns for when/who/field/from/to/delta/source/reason', function() {
  // Look at only the Adjustment Journal's table head, not other tables in the file.
  var i = page.indexOf('🧾 Adjustment Journal');
  assert(i > 0, 'section anchor found');
  var block = page.substring(i, i + 2500);
  ['When','Who','Field','From','To','Source','Reason'].forEach(function(col) {
    assert(block.indexOf('>' + col + '<') > 0, 'column header ' + col + ' present');
  });
});

// ==== Import — three-field in template ====
test('S20.11 Import template has Inbound Quantity column', function() {
  assert(/'Inbound Quantity'/.test(imp), 'Inbound Quantity in columns list');
});

test('S20.12 Import template examples demonstrate the three modes', function() {
  // One first-time row, one existing-inbound-only row, one with expected qty
  var ex = imp.match(/TEMPLATE_EXAMPLES = \[[\s\S]*?\];/)[0];
  assert(/Restock — inbound only/.test(ex), 'existing-product example row present');
  assert(/First batch — opening balance/.test(ex), 'first-time example row present');
  assert(/Expected 60, got 50/.test(ex), 'expected-qty example present');
});

test('S20.13 Instructions sheet explains the three-field flow and journaling', function() {
  assert(/THE THREE QUANTITY COLUMNS/.test(imp), 'three-qty section');
  assert(/Inbound Quantity — ALWAYS the primary input/.test(imp), 'inbound explanation');
  assert(/SUPER-ADMIN OVERRIDE/.test(imp), 'super-admin section');
  assert(/inventory_adjustments table/.test(imp), 'references journal table');
});

// ==== Import — parse + run logic ====
test('S20.14 parseRows reads Inbound Quantity column', function() {
  assert(/var inboundQty = parseNumber\(getCell\(raw, 'Inbound Quantity'\)\)/.test(imp),
    'reads Inbound Quantity from sheet');
  assert(/inbound_quantity: inboundQty/.test(imp),
    'stores as inbound_quantity on the parsed row');
});

test('S20.15 parseRows flags Original/Current provided on existing products', function() {
  assert(/origWillBeIgnored = !!existing && origProvided/.test(imp),
    'origWillBeIgnored flag computed');
  assert(/currWillBeIgnored = !!existing && currProvided/.test(imp),
    'currWillBeIgnored flag computed');
});

test('S20.16 runImport skips locked cells unless super-admin override on', function() {
  // For existing products: inbound adds to both; orig/curr adjustments gated by
  // isSuperAdmin && overrideLock
  assert(/if \(r\.original_quantity_provided\) \{[\s\S]{0,300}if \(isSuperAdmin && overrideLock\)/.test(imp),
    'original override requires super-admin override');
  assert(/if \(r\.current_quantity_provided\) \{[\s\S]{0,300}if \(isSuperAdmin && overrideLock\)/.test(imp),
    'current override requires super-admin override');
});

test('S20.17 runImport writes journal rows on import overrides', function() {
  assert(/dbInsert\('inventory_adjustments'/.test(imp),
    'journal insert present in import');
  assert(/source: 'import'/.test(imp),
    'source = import on journal entries');
});

test('S20.18 runImport reports adjustmentsLogged count on done screen', function() {
  assert(/adjustmentsLogged: adjustmentsLogged/.test(imp),
    'result payload has adjustmentsLogged');
  assert(/super-admin adjustment\{result\.adjustmentsLogged === 1 \? '' : 's'\} logged/.test(imp),
    'done screen shows message');
});

// ==== Preview UI ====
test('S20.19 Preview UI shows Inbound Qty column in emerald', function() {
  assert(/<th className="px-2 py-1\.5 text-right text-emerald-700">Inbound Qty<\/th>/.test(imp),
    'Inbound Qty header is styled to stand out');
});

test('S20.20 Preview UI marks ignored cells with line-through', function() {
  assert(/line-through/.test(imp),
    'ignored values shown with line-through');
});

test('S20.21 Preview UI marks override cells with *', function() {
  assert(/\{r\.original_quantity_requested\}\*/.test(imp),
    'override original marked with *');
  assert(/\{r\.current_quantity_requested\}\*/.test(imp),
    'override current marked with *');
});

// ==== Filters (color + breakdown) ====
test('S20.22 Inventory tab has a Color filter', function() {
  assert(/invColorFilter/.test(page), 'color filter state');
  assert(/All Colors/.test(page), 'color dropdown has default option');
});

test('S20.23 Color filter applied to filtered list', function() {
  assert(/formData\.invColorFilter && formData\.invColorFilter !== 'all' && \(p\.color_en \|\| p\.color\) !== formData\.invColorFilter/.test(page),
    'filter predicate uses color_en/color fallback');
});

test('S20.24 Breakdown toggle button exists', function() {
  assert(/showInvBreakdown/.test(page), 'breakdown state');
  assert(/📊 Breakdown/.test(page), 'button label');
});

test('S20.25 Breakdown panel groups by type, subcategory, color', function() {
  assert(/const byType = groupBy\(p => p\.product_type, 'Product Type'\)/.test(page),
    'groups by type');
  assert(/const bySub = groupBy\(p => p\.subcategory, 'Subcategory'\)/.test(page),
    'groups by subcategory');
  assert(/const byColor = groupBy\(p => p\.color_en \|\| p\.color, 'Color'\)/.test(page),
    'groups by color');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
