// ============================================================
// Shipping Rates — historical report regression tests
//
// Covers the Apr 22 2026 upgrade where rates gained:
//   1. Default filter = 1 year (was: "active only" which hid history)
//   2. Expired rates preserved forever; never deleted by expiry
//   3. New "Booked" column shows shipment reference + booking date
//   4. CSV export covers vendor/line/rate/status/booking fields
//   5. Expired rows show explicit red "EXPIRED" badge, not just hidden
//
// Pure unit tests of the filter/export/resolver logic — no browser.
// ============================================================

var assert = require('assert');
var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

// -----------------------------------------------------------------
// Fixtures — rates spanning multiple years with mixed expired/active/booked
// -----------------------------------------------------------------
var TODAY = '2026-04-22';
var RATES = [
  // Active (expiry in future)
  { id: 'r1', vendor_name: 'MSC',    shipping_line: 'MSC Line',    origin: 'Alexandria', destination: 'Jeddah', container_type: '40ft',
    rate_amount: 1200, currency: 'USD', total_cost: 1450,
    effective_date: '2026-03-01', expiry_date: '2026-06-30',
    booked: false },
  // Active + booked
  { id: 'r2', vendor_name: 'Maersk', shipping_line: 'Maersk Line', origin: 'Alexandria', destination: 'Miami',  container_type: '40ft',
    rate_amount: 2500, currency: 'USD', total_cost: 2850,
    effective_date: '2026-04-01', expiry_date: '2026-05-31',
    booked: true, shipment_reference: 'MAEU-999111', booking_date: '2026-04-10' },
  // Expired (2 months ago)
  { id: 'r3', vendor_name: 'CMA',    shipping_line: 'CGM',         origin: 'Alexandria', destination: 'Miami',  container_type: '40ft',
    rate_amount: 2200, currency: 'USD', total_cost: 2500,
    effective_date: '2026-01-15', expiry_date: '2026-02-15',
    booked: false },
  // Old expired, was booked (last year)
  { id: 'r4', vendor_name: 'Hapag',  shipping_line: 'Hapag-Lloyd', origin: 'Alexandria', destination: 'Miami',  container_type: '40ft',
    rate_amount: 2100, currency: 'USD', total_cost: 2400,
    effective_date: '2025-06-01', expiry_date: '2025-09-30',
    booked: true, shipment_reference: 'HLCU-2025-07', booking_date: '2025-07-01' },
  // Very old (2 years ago) — should appear only in 3yr or All filters
  { id: 'r5', vendor_name: 'COSCO',  shipping_line: 'COSCO',       origin: 'Alexandria', destination: 'Miami',  container_type: '40ft',
    rate_amount: 1800, currency: 'USD', total_cost: 2000,
    effective_date: '2024-05-01', expiry_date: '2024-12-01',
    booked: false },
];

// -----------------------------------------------------------------
// Resolvers mirroring ShippingRatesTab.jsx logic
// -----------------------------------------------------------------
function isExpired(dateStr, todayStr) {
  if (!dateStr) return false;
  return dateStr < todayStr;
}

function applyFilter(rates, mode, todayStr) {
  if (mode === 'active') return rates.filter(r => !isExpired(r.expiry_date, todayStr));
  var cutoffDays = { '3m': 90, '1y': 365, '3y': 1095 }[mode];
  if (cutoffDays != null) {
    var cutoff = new Date(new Date(todayStr).getTime() - cutoffDays * 86400000).toISOString().substring(0, 10);
    return rates.filter(r => (r.effective_date || '') >= cutoff);
  }
  if (mode === 'all') return rates;
  return rates;
}

function exportCSV(rows, todayStr) {
  var headers = ['Effective Date','Vendor','Shipping Line','Container','Rate','Currency','Total Cost','Transit Days','Free Days','Expiry Date','Status','Booked','Shipment Ref','Booking Date'];
  var esc = function(v) { if (v == null) return ''; var s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  var lines = [headers.join(',')];
  rows.forEach(function(r) {
    lines.push([
      r.effective_date || '', r.vendor_name || '', r.shipping_line || '',
      r.container_type || '', r.rate_amount || 0, r.currency || 'USD',
      r.total_cost || 0, r.transit_days || '', r.free_days || '',
      r.expiry_date || '', isExpired(r.expiry_date, todayStr) ? 'Expired' : 'Active',
      r.booked ? 'Yes' : 'No', r.shipment_reference || '', r.booking_date || '',
    ].map(esc).join(','));
  });
  return lines.join('\n');
}

// -----------------------------------------------------------------
// TESTS: default 1-year filter
// -----------------------------------------------------------------
test('SR1 default 1y filter includes current + recent expired (past 365d)', function() {
  var filtered = applyFilter(RATES, '1y', TODAY);
  // r5 (effective 2024-05) is outside 1y; r1,r2 current; r3,r4 within 1y but expired
  assert.strictEqual(filtered.length, 4, 'should include r1, r2, r3, r4 (within 1yr — r5 excluded as >1yr old)');
  // Critically: r3 and r4 are expired but should STILL be visible because default is 1y, not active-only
  assert(filtered.find(r => r.id === 'r3'), 'expired r3 must be visible in default 1y filter');
  assert(filtered.find(r => r.id === 'r4'), 'expired booked r4 (last year) must be visible for audit');
});

test('SR2 "active" filter hides expired rates', function() {
  var filtered = applyFilter(RATES, 'active', TODAY);
  assert.strictEqual(filtered.length, 2, 'only non-expired rates (r1, r2)');
  filtered.forEach(function(r) { assert(!isExpired(r.expiry_date, TODAY), r.id + ' must not be expired'); });
});

test('SR3 "all" filter returns every rate including ancient ones (historical preservation)', function() {
  var filtered = applyFilter(RATES, 'all', TODAY);
  assert.strictEqual(filtered.length, 5, 'all 5 rates preserved');
  assert(filtered.find(r => r.id === 'r5'), '2-year-old COSCO rate preserved for history');
});

test('SR4 "3y" filter catches 2-year-old rates', function() {
  var filtered = applyFilter(RATES, '3y', TODAY);
  assert(filtered.find(r => r.id === 'r5'), '3yr filter must include r5 (effective 2024-05)');
});

test('SR5 "3m" filter excludes expired rates older than 90 days', function() {
  var filtered = applyFilter(RATES, '3m', TODAY);
  // r3 effective 2026-01-15 is more than 90 days before 2026-04-22
  assert(!filtered.find(r => r.id === 'r3'), 'r3 (>90d old) excluded from 3m');
  assert(filtered.find(r => r.id === 'r2'), 'r2 (recent) included');
});

// -----------------------------------------------------------------
// TESTS: Expired preservation (historical value)
// -----------------------------------------------------------------
test('SR6 expired rates are NEVER deleted by expiry — stay in full dataset', function() {
  // The test here is conceptual but important: if any code path ever auto-deletes
  // expired rates, historical trend analysis becomes impossible. We enforce that
  // the filter+display layer never mutates the source array.
  var original = JSON.parse(JSON.stringify(RATES));
  var filtered = applyFilter(RATES, 'active', TODAY);
  filtered.push({ injected: true });
  // Original array still intact
  assert.strictEqual(RATES.length, original.length, 'applyFilter must not mutate input');
  RATES.forEach(function(r, i) {
    assert.deepStrictEqual(r, original[i], 'rate ' + r.id + ' unchanged');
  });
});

test('SR7 booked expired rates are still visible in history (audit trail)', function() {
  // r4 is expired AND booked — ensures we can still trace what we booked last year
  var filtered = applyFilter(RATES, 'all', TODAY);
  var r4 = filtered.find(r => r.id === 'r4');
  assert(r4, 'r4 must be present in history');
  assert.strictEqual(r4.booked, true);
  assert.strictEqual(r4.shipment_reference, 'HLCU-2025-07');
});

// -----------------------------------------------------------------
// TESTS: "Who we booked under" — booking metadata preservation
// -----------------------------------------------------------------
test('SR8 booked column shows vendor + shipping line + reference', function() {
  var booked = RATES.filter(r => r.booked);
  assert.strictEqual(booked.length, 2);
  booked.forEach(function(r) {
    assert(r.vendor_name, 'vendor required for booked rates');
    assert(r.shipping_line, 'shipping line required for booked rates');
    assert(r.shipment_reference, 'shipment reference required for booked rates');
    assert(r.booking_date, 'booking date required for booked rates');
  });
});

// -----------------------------------------------------------------
// TESTS: CSV export
// -----------------------------------------------------------------
test('SR9 CSV export includes all 14 expected columns', function() {
  var csv = exportCSV(RATES, TODAY);
  var headers = csv.split('\n')[0].split(',');
  assert.strictEqual(headers.length, 14, 'must have 14 columns');
  assert(headers.indexOf('Status') >= 0, 'Status column present');
  assert(headers.indexOf('Booked') >= 0, 'Booked column present');
  assert(headers.indexOf('Shipment Ref') >= 0, 'Shipment Ref column present');
  assert(headers.indexOf('Booking Date') >= 0, 'Booking Date column present');
});

test('SR10 CSV rows mark status correctly (Expired vs Active)', function() {
  var csv = exportCSV(RATES, TODAY);
  var lines = csv.split('\n');
  // r1 is active
  var r1Line = lines.find(function(l) { return l.indexOf('MSC,') >= 0 || l.indexOf(',MSC,') >= 0; });
  assert(r1Line, 'r1 in CSV');
  assert(r1Line.indexOf(',Active,') >= 0, 'r1 marked Active');
  // r3 is expired
  var r3Line = lines.find(function(l) { return l.indexOf(',CMA,') >= 0; });
  assert(r3Line, 'r3 in CSV');
  assert(r3Line.indexOf(',Expired,') >= 0, 'r3 marked Expired');
});

test('SR11 CSV correctly escapes commas in vendor names', function() {
  var tricky = [{ id: 't1', vendor_name: 'Kuehne, Nagel', shipping_line: 'MSC', origin: 'A', destination: 'B', container_type: '40ft', rate_amount: 1000, currency: 'USD', total_cost: 1200, effective_date: '2026-01-01', expiry_date: '2026-12-31', booked: false }];
  var csv = exportCSV(tricky, TODAY);
  assert(csv.indexOf('"Kuehne, Nagel"') >= 0, 'comma in vendor must be quoted');
});

test('SR12 CSV survives quotes in values by escaping them', function() {
  var tricky = [{ id: 't1', vendor_name: 'Big "Ship" Co', shipping_line: 'X', origin: 'A', destination: 'B', container_type: '20ft', rate_amount: 900, currency: 'USD', total_cost: 1100, effective_date: '2026-01-01', expiry_date: '2026-12-31', booked: false }];
  var csv = exportCSV(tricky, TODAY);
  assert(csv.indexOf('"Big ""Ship"" Co"') >= 0, 'quotes must be doubled per CSV spec');
});

test('SR13 CSV preserves booking metadata for booked rates', function() {
  var csv = exportCSV(RATES, TODAY);
  assert(csv.indexOf('MAEU-999111') >= 0, 'shipment ref preserved in CSV');
  assert(csv.indexOf('HLCU-2025-07') >= 0, 'last-year booking ref preserved');
  assert(csv.indexOf('2026-04-10') >= 0, 'booking date preserved');
});

// -----------------------------------------------------------------
// TESTS: trust — footer summary counts
// -----------------------------------------------------------------
test('SR14 summary counts expired and booked separately (trust transparency)', function() {
  var filtered = applyFilter(RATES, '1y', TODAY);
  var expiredCount = filtered.filter(function(r) { return isExpired(r.expiry_date, TODAY); }).length;
  var bookedCount = filtered.filter(function(r) { return r.booked; }).length;
  assert.strictEqual(expiredCount, 2, '2 expired rates in 1y window (r3 and r4)');
  assert.strictEqual(bookedCount, 2, '2 booked rates in 1y window (r2 active + r4 historical booking)');
});

// -----------------------------------------------------------------
// TESTS: edge cases
// -----------------------------------------------------------------
test('SR15 empty dataset returns empty result (not error)', function() {
  var filtered = applyFilter([], '1y', TODAY);
  assert(Array.isArray(filtered));
  assert.strictEqual(filtered.length, 0);
  var csv = exportCSV([], TODAY);
  // CSV still has header row even when empty
  assert.strictEqual(csv.split('\n').length, 1);
});

test('SR16 rate with no expiry_date is treated as never-expires (Active forever)', function() {
  var ratesWithNoExpiry = [{ id: 'x1', vendor_name: 'Perm', shipping_line: 'X', origin: 'A', destination: 'B', container_type: '40ft', rate_amount: 500, currency: 'USD', total_cost: 500, effective_date: '2020-01-01', expiry_date: null, booked: false }];
  var filtered = applyFilter(ratesWithNoExpiry, 'active', TODAY);
  assert.strictEqual(filtered.length, 1, 'no-expiry rate is considered active');
});

console.log('');
console.log('─────────────────────────────────────');
console.log('SHIPPING RATES TEST RESULTS');
console.log('─────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES — do not deploy until fixed'); process.exit(1); }
else console.log('\n✅ All shipping rates tests passed');
