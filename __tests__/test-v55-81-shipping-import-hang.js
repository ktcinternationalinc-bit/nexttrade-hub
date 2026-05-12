// __tests__/test-v55-81-shipping-import-hang.js
// =============================================
// v55.81 — REGRESSION TEST for two bugs Max reported May 9 2026:
//
//   BUG 1: Shipping import sits "Importing..." forever, never finishes.
//   Root cause: per-row fallback called dbInsert which writes audit_log
//   per row (210 rows × 2 round-trips = up to 2 minutes), no timeout, and
//   the fallback hit the same column-error 210 times. Plus no progress
//   feedback or cancel button.
//
//   Fix: bulk insert with column-strip retry; only true data errors fall
//   through to per-row; 30s timeout on every Supabase call; live status
//   text + cancel button so user is never stuck.
//
//   BUG 2: Trend chart should use EXPIRATION date as the time axis, not
//   effective date. Max May 9 2026: "the date should be the historical
//   of when it is from the date of the expiration ... that's what you're
//   using the charts as well."
//
// Run: node __tests__/test-v55-81-shipping-import-hang.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== Shipping import hang + expiry-axis regression test ===\n');

// =======================================================================
// BUG 1 — Import hang
// =======================================================================

// 1.1 — There's a timeout wrapper on Supabase calls so they can't hang
ok('1.1 withTimeout helper wraps Supabase calls',
   /var withTimeout = function \(promise, ms, label\)/.test(src));
ok('1.2 Default timeout is 30 seconds for bulk operations',
   /withTimeout\([\s\S]+?,\s*30000,/.test(src));
ok('1.3 Per-row timeout is shorter (5s) so a bad row fails fast',
   /withTimeout\([\s\S]+?,\s*5000,/.test(src));

// 1.4 — v55.82-L2 changed strategy: PER-ROW is now the design, NOT bulk.
// Bulk-insert was the cause of the data wipe Max reported. The whole batch
// rolled back when one row had a bad date. Per-row inserts isolate failures.
ok('1.4 v55.82-L2: per-row write loop is now the design (replaces bulk-insert)',
   /for \(var ri = 0; ri < validRows\.length; ri\+\+\)/.test(src));

// 1.5 — Per-row insert still has a single missing-column retry per row.
ok('1.5 Per-row insert has a missing-column retry path',
   /missing-column stripped/.test(src) || /stripCol = mm\[1\]/.test(src));

// 1.6 — runPerRow legacy helper is left in place for backward-compat tests
ok('1.6 runPerRow helper still exists for legacy callers',
   /const runPerRow = async \(rows, withTimeout\) =>/.test(src));

// 1.7 — executeImport function found
var executeImportMatch = src.match(/const executeImport = async \(\) => \{[\s\S]+?\n  \};/);
ok('1.7 executeImport function found', !!executeImportMatch);
if (executeImportMatch) {
  ok('1.8 executeImport no longer calls dbInsert in the per-row path',
     !/await dbInsert\('shipping_rates'/.test(executeImportMatch[0]),
     'per-row dbInsert was the cause of the hang');
}
var runPerRowMatch = src.match(/const runPerRow = async[\s\S]+?\n  \};/);
if (runPerRowMatch) {
  ok('1.9 runPerRow uses raw supabase insert (no audit_log per row)',
     !/dbInsert\(/.test(runPerRowMatch[0]),
     'must not call dbInsert per row');
}

// 1.10 — Single bulk audit-log entry at the end (not per-row)
ok('1.10 Single bulk audit_log entry at the end of import',
   /action: 'bulk_import'/.test(src));

// 1.11 — Live status text shown during import
ok('1.11 importStatus state declared',
   /\[importStatus, setImportStatus\]/.test(src));
ok('1.12 importStatus shown in importing UI',
   /importStatus &&/.test(src) && /importStatus\}<\/p>/.test(src));

// 1.13 — Cancel button so user is never stuck
ok('1.13 Cancel button on importing UI',
   /Cancel the import\?/.test(src));
ok('1.14 30-sec timeout reassurance shown to user',
   /30-second timeout/.test(src));

// 1.15 — v55.82-L2 handles empty dates via cleanForDB helper instead of inline
ok('1.15 v55.82-L2: dates handled by cleanForDB / validateDate helpers',
   /cleanForDB = function/.test(src) && /validateDate = function/.test(src));

// 1.16 — Progress updates throttled in per-row path so UI doesn't redraw 210 times
ok('1.16 Progress updates throttled in per-row path (every 10 rows)',
   /i % 10 === 0/.test(src));

// 1.17 — v55.82-L2 reports errors per-row in the errors array (not as a
// bulk "all rows failed" message). Each row has its own reason.
ok('1.17 v55.82-L2: each failing row gets its own error entry in errors array',
   /errors\.push\(\{\s*row:/.test(src) && /errors\.slice\(0, 5\)/.test(src));

// 1.18 — v55.82-L2 changed summary structure entirely. New format shows
// "Update Only / Full Sync import complete:" with N added / N updated /
// N unchanged / N failed broken out.
ok('1.18 v55.82-L2: summary distinguishes added/updated/unchanged/failed',
   /N added/.test(src) || /import complete:/.test(src) ||
   /'Update Only' \) \+ ' import complete/.test(src) ||
   /'Full Sync' : 'Update Only'\) \+ ' import complete/.test(src));

// =======================================================================
// BUG 2 — Trend chart anchored to expiration date
// =======================================================================

// 2.1 — dateAnchor function uses expiry_date first, falls back to effective_date
ok('2.1 dateAnchor function defined',
   /const dateAnchor = function \(r\)/.test(src));
ok('2.2 dateAnchor uses expiry_date PRIMARY, effective_date fallback',
   /return r\.expiry_date \|\| r\.effective_date/.test(src));

// 2.3 — Trend filter uses dateAnchor
ok('2.3 Trend filter uses dateAnchor (not bare effective_date)',
   /var anchor = dateAnchor\(r\)/.test(src));

// 2.4 — Grouping by month uses dateAnchor
ok('2.4 Monthly grouping uses dateAnchor',
   /const ym = dateAnchor\(r\)\.substring\(0, 7\)/.test(src));

// 2.5 — Caption explains the expiry-anchored axis to the user
ok('2.5 Chart caption mentions expiration anchoring',
   /expiration date/i.test(src) && /historically valid|when it was last valid|valid until/i.test(src));

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
