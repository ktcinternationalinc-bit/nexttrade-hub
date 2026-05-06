// ============================================================
// S20.1 / S20.2 (Apr 23 2026) — Calendar save robustness +
// per-shipment original quantity tracking on inventory.
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

var cal = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

// ====== S20.1 CALENDAR SAVE HARDENING ======

test('S20.1.1 Calendar save shows visible alert when title missing', function() {
  assert(/Please enter a title for the event\./.test(cal),
    'alert for missing title instead of silent return');
});

test('S20.1.2 Calendar save shows visible alert when date missing', function() {
  assert(/Please pick a date for the event\./.test(cal),
    'alert for missing date instead of silent return');
});

test('S20.1.3 Recurring event with no end date prompts confirmation', function() {
  assert(/This event is set to repeat but has no end date — it will go on forever\. Continue\?/.test(cal),
    'explicit confirm for open-ended recurring');
});

test('S20.1.4 "saving" state prevents double-click', function() {
  assert(/const \[saving, setSaving\] = useState\(false\)/.test(cal), 'saving state');
  assert(/if \(saving\) return;/.test(cal), 'guards re-entry');
  assert(/setSaving\(true\)/.test(cal), 'flips true on entry');
  assert(/finally \{\s*setSaving\(false\);\s*\}/.test(cal), 'always clears on exit');
});

test('S20.1.5 Save button shows "Saving..." while working', function() {
  assert(/\{saving \? 'Saving\.\.\.' : 'Save \/ حفظ'\}/.test(cal),
    'button label toggles on saving');
  assert(/disabled=\{saving\}/.test(cal), 'button disabled while saving');
});

test('S20.1.6 Occurrence generator is AWAITED for recurring events', function() {
  // The old code used fire-and-forget fetch(). New code must await the response.
  assert(/const r = await fetch\('\/api\/events\/generate-occurrences'/.test(cal),
    'awaits the generator call');
});

test('S20.1.7 Save success surfaces a confirmation with occurrence count', function() {
  assert(/✅ Saved "/.test(cal), 'success prefix');
  assert(/occurrencesGenerated/.test(cal), 'tracks count of occurrences');
  assert(/occurrences created/.test(cal), 'mentions count in confirmation');
});

test('S20.1.8 Generator failure still confirms save but flags the warning', function() {
  assert(/scheduler will create them overnight/.test(cal),
    'graceful fallback message when generator fails');
  assert(/generatorFailed/.test(cal),
    'tracks generator failure flag');
});

test('S20.1.9 loadEvents is awaited after save (not setTimeout)', function() {
  // Old version used setTimeout(() => loadEvents(), 500) which raced the
  // fire-and-forget generator. New version awaits both.
  assert(/await loadEvents\(\);/.test(cal), 'awaits reload');
});

// ====== S20.2 PER-SHIPMENT ORIGINAL QUANTITY ======

test('S20.2.1 Product detail has a Per-Shipment section', function() {
  assert(/📦 Per-Shipment Original Quantity/.test(page),
    'section header');
});

test('S20.2.2 Per-shipment groups inbounds by shipment_reference', function() {
  assert(/const key = ib\.shipment_reference \|\| '\(no shipment ref\)';/.test(page),
    'groups by shipment_reference');
});

test('S20.2.3 Per-shipment original comes from inventory_inbounds.quantity (immutable)', function() {
  // The source of truth must be the per-inbound quantity column, not a
  // recomputed or mutable product-level value.
  assert(/groups\[key\]\.originalQty \+= Number\(ib\.quantity \|\| 0\)/.test(page),
    'sums ib.quantity into per-shipment originalQty');
});

test('S20.2.4 FIFO estimate of remaining stock per shipment', function() {
  assert(/let remainingBudget = Number\(p\.current_quantity \|\| 0\);/.test(page),
    'allocates from current_quantity');
  assert(/Allocate newest-first/.test(page),
    'newest-first allocation comment present');
});

test('S20.2.5 Table shows Original Qty, Est. Remaining, Est. Sold, % left', function() {
  var i = page.indexOf('📦 Per-Shipment Original Quantity');
  assert(i > 0);
  var block = page.substring(i, i + 4000);
  ['Original Qty', 'Est. Remaining', 'Est. Sold', '% left'].forEach(function(col) {
    assert(block.indexOf('>' + col + '<') > 0, 'column ' + col + ' in per-shipment table');
  });
});

test('S20.2.6 By-Shipment report button on Inventory header', function() {
  assert(/showInvByShipment: true/.test(page), 'button wires state');
  assert(/📦 By Shipment/.test(page), 'button label');
});

test('S20.2.7 By-Shipment modal lists products in a chosen shipment', function() {
  assert(/formData\.showInvByShipment && \(\(\) => \{/.test(page),
    'modal IIFE present');
  assert(/📦 By Shipment — Original Quantities/.test(page),
    'modal title');
  assert(/Original in Shipment/.test(page),
    'column for per-shipment original');
});

test('S20.2.8 By-Shipment modal includes product descriptions/color/type', function() {
  var i = page.indexOf('📦 By Shipment — Original Quantities');
  assert(i > 0);
  var block = page.substring(i, i + 6000);
  ['Description', 'Color', 'Type', 'Product Current'].forEach(function(col) {
    assert(block.indexOf('>' + col + '<') > 0, 'column ' + col + ' in by-shipment modal');
  });
});

test('S20.2.9 By-Shipment report supports CSV export', function() {
  var i = page.indexOf('📦 By Shipment — Original Quantities');
  var block = page.substring(i, i + 6000);
  assert(/📥 CSV/.test(block), 'CSV export button');
  assert(/'shipment_' \+ chosen \+ '\.csv'/.test(block), 'filename uses shipment ref');
});

test('S20.2.10 Per-shipment and by-shipment use immutable inbound data — never mutate', function() {
  // Guard: no writes to inventory_inbounds in either report. If Max ever
  // edits the original in the UI, it should not be in these sections —
  // editing originals is a separate super-admin journaled action.
  var per = page.indexOf('📦 Per-Shipment Original Quantity');
  var perEnd = page.indexOf('/* Inbound History */');
  var perBlock = page.substring(per, perEnd);
  assert(!/dbInsert\(/.test(perBlock) && !/dbUpdate\(/.test(perBlock),
    'per-shipment block does not write to DB');
  var by = page.indexOf('📦 By Shipment — Original Quantities');
  // The by-shipment modal ends with its closing tag; we just verify no
  // db writes appear for ~6000 chars after the title.
  var byBlock = page.substring(by, by + 6000);
  assert(!/dbInsert\(/.test(byBlock) && !/dbUpdate\(/.test(byBlock),
    'by-shipment modal does not write to DB');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
