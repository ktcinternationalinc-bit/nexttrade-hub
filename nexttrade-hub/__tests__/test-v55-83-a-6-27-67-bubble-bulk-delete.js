// v55.83-A.6.27.67 — Bubble bulk-delete
//
// Inside a shipping bubble (route detail page), super-admin gets a bulk-
// select toolbar + per-row checkboxes. Quick-select buttons: All Visible,
// Historical (Expired), Not Booked, Expired & Not Booked. Bulk delete
// runs sequential dbDelete with per-rate audit + first-fail abort.
//
// SCOPE:
//   PART A — state + lifecycle
//   PART B — handleBulkDeleteRates helper
//   PART C — toolbar render gates + quick-select buttons
//   PART D — per-row checkbox column
//   PART E — regression: .66 multi-currency banners still intact

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var srt  = read('src/components/ShippingRatesTab.jsx');
var page = read('src/app/page.jsx');
var wnw  = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — State + lifecycle
// ══════════════════════════════════════════════════════════════════
ok('A1: selectedRateIds state initialized as empty Set',
  /const \[selectedRateIds, setSelectedRateIds\] = useState\(new Set\(\)\)/.test(srt));
ok('A2: useEffect clears selection when selectedRoute OR view changes',
  /useEffect\(function \(\) \{\s+setSelectedRateIds\(new Set\(\)\);\s+\}, \[selectedRoute, view\]\)/.test(srt));

// ══════════════════════════════════════════════════════════════════
// PART B — handleBulkDeleteRates helper
// ══════════════════════════════════════════════════════════════════
ok('B1: handleBulkDeleteRates function exists',
  /const handleBulkDeleteRates = async \(ids, label\) =>/.test(srt));
ok('B2: rejects empty selection',
  /No rates selected/.test(srt));
ok('B3: confirms with friendly count + warning text',
  /'Delete ' \+ arr\.length \+ ' rate'/.test(srt) &&
  /Cannot be undone\. Each delete is logged to the audit trail/.test(srt));
ok('B4: SEQUENTIAL dbDelete loop (NOT Promise.all — per-rate audit + first-fail detection)',
  /for \(var i = 0; i < arr\.length; i\+\+\)/.test(srt) &&
  /await dbDelete\('shipping_rates', rateId, myId\)/.test(srt));
ok('B5: tracks succeeded + failed counts separately',
  /var succeeded = 0;\s+var failed = \[\]/.test(srt));
ok('B6: first-fail abort (don\'t spam audit log if permission denied)',
  /if \(succeeded === 0\) \{\s+alert\('Bulk delete aborted on first failure/.test(srt));
ok('B7: shows summary with first-5 failures + extras count',
  /Deleted ' \+ succeeded \+ ' of ' \+ arr\.length/.test(srt) &&
  /failed\.slice\(0, 5\)/.test(srt));
ok('B8: clears selection + refreshes data after bulk delete',
  /setSelectedRateIds\(new Set\(\)\);\s+await loadData\(\)/.test(srt));

// ══════════════════════════════════════════════════════════════════
// PART C — Toolbar render gates + quick-select buttons
// ══════════════════════════════════════════════════════════════════
ok('C1: bulk-action toolbar gated on canBulkDelete (v55.83-A.6.27.69 Phase 2 — was isAdmin, now respects Delete Shipping Bubbles permission with fallback to isAdmin)',
  /\{canBulkDelete && \(\(\) => \{\s+var visibleIds = filtered\.map/.test(srt) &&
  /const canBulkDelete = canBulkDeleteBubbles !== undefined \? !!canBulkDeleteBubbles : !!isAdmin/.test(srt));
ok('C2: All Visible button computes from `filtered` (respects current view filters)',
  /var visibleIds = filtered\.map\(function \(r\) \{ return r\.id; \}\)/.test(srt) &&
  /☑ All Visible/.test(srt));
ok('C3: Historical/Expired button computes from filtered.filter(isExpired)',
  /var expiredIds = filtered\.filter\(function \(r\) \{ return isExpired\(r\.expiry_date\); \}\)/.test(srt) &&
  /🗓️ Historical \/ Expired/.test(srt));
ok('C4: Not Booked button computes from !r.booked',
  /var notBookedIds = filtered\.filter\(function \(r\) \{ return !r\.booked; \}\)/.test(srt) &&
  /📭 Not Booked/.test(srt));
ok('C5: Expired & Not Booked (safest combo) button present',
  /var notBookedExpiredIds = filtered\.filter\(function \(r\) \{ return isExpired\(r\.expiry_date\) && !r\.booked; \}\)/.test(srt) &&
  /💡 Expired & Not Booked/.test(srt));
ok('C6: Clear button + count badge + Delete Selected only show when selection > 0',
  /\{selectedRateIds\.size > 0 && \(/.test(srt) &&
  /✗ Clear/.test(srt) &&
  /🗑️ Delete Selected/.test(srt));
ok('C7: Delete Selected uses red bg + extrabold for visual danger',
  /bg-red-600 hover:bg-red-700 text-white text-\[11px\] font-extrabold/.test(srt));
ok('C8: Delete Selected passes route label for confirm-dialog clarity',
  /handleBulkDeleteRates\(selectedRateIds, label\)/.test(srt) &&
  /selectedRoute && \(selectedRoute\.pol \|\| selectedRoute\.origin\)/.test(srt));

// ══════════════════════════════════════════════════════════════════
// PART D — Per-row checkbox column
// ══════════════════════════════════════════════════════════════════
ok('D1: header checkbox column rendered when canBulkDelete (Phase 2 permission upgrade)',
  /\{canBulkDelete && \(\s+<th className="px-2 py-2 text-\[10px\] text-center" style=\{\{ width: 28 \}\}>/.test(srt));
ok('D2: header checkbox toggles all visible (filtered)',
  /filtered\.length > 0 && filtered\.every\(function \(r\) \{ return selectedRateIds\.has\(r\.id\); \}\)/.test(srt));
ok('D3: per-row checkbox renders when canBulkDelete (Phase 2 permission upgrade)',
  /\{canBulkDelete && \(\s+<td className="px-2 py-1\.5 text-center">\s+<input\s+type="checkbox"/.test(srt));
ok('D4: per-row checkbox onChange adds/removes id from Set immutably',
  /var s = new Set\(selectedRateIds\);\s+if \(e\.target\.checked\) s\.add\(r\.id\); else s\.delete\(r\.id\);\s+setSelectedRateIds\(s\)/.test(srt));
ok('D5: selected row highlights yellow with ring',
  /selectedRateIds\.has\(r\.id\) \? ' bg-yellow-100 ring-1 ring-yellow-400'/.test(srt));

// ══════════════════════════════════════════════════════════════════
// PART E — Regression: .66 features still intact
// ══════════════════════════════════════════════════════════════════
ok('E1: .66 multi-currency totals card still in page.jsx',
  /totalsByCurrency/.test(page) && /By Currency \/ حسب العملة/.test(page));
ok('E2: .66 SalesRepDashboard per-currency buckets still intact',
  /perRepCurrency = useMemo/.test(read('src/components/SalesRepDashboard.jsx')));
ok('E3: .66 login isActiveUser still intact',
  /profile && !isActiveUser\(profile\)/.test(read('src/app/login/page.jsx')));
ok('E4: WhatsNewWidget has .67 + .66 entries',
  /version: 'v55\.83-A\.6\.27\.67'/.test(wnw) && /version: 'v55\.83-A\.6\.27\.66'/.test(wnw));

// ══════════════════════════════════════════════════════════════════
// PART V — Version stamp
// ══════════════════════════════════════════════════════════════════
ok('V1: page.jsx stamped v55.83-A.6.27.67 or later',
  /v55\.83-A\.6\.27\.(6[7-9]|[7-9][0-9])/.test(page));
ok('V2: WhatsNewWidget .67 entry has layman public bullets (Permanent Rule 1)',
  /Bulk select/.test(wnw) &&
  /Historical \/ Expired/.test(wnw) &&
  /Not Booked/.test(wnw) &&
  /safest bulk delete/.test(wnw));

// ══════════════════════════════════════════════════════════════════
// FINAL
// ══════════════════════════════════════════════════════════════════
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.67 (Bubble bulk-delete) tests passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
