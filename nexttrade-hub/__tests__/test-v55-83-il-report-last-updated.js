// ============================================================
// v55.83-IL — "last updated" timestamp on the Inventory Report Center.
// The Refresh button already existed; IL adds a loadedAt stamp (set only on a
// successful load) and renders an "Updated: …" label next to Refresh.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var rc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryReportCenter.jsx'), 'utf8');

ok('1: loadedAt state exists', /var \[loadedAt, setLoadedAt\] = useState\(null\)/.test(rc));
ok('2: stamped after a successful setRaw (inside load)',
  /setRaw\(\{[\s\S]*?\}\);\s*setLoadedAt\(new Date\(\)\);/.test(rc));
ok('3: NOT stamped in the catch/error path (only the success stamp exists)',
  (rc.match(/setLoadedAt\(/g) || []).length === 1);
ok('4: renders an Updated/آخر تحديث label using toLocaleTimeString',
  /loadedAt && \(/.test(rc) && /'آخر تحديث: ' : 'Updated: '/.test(rc) && /loadedAt\.toLocaleTimeString\(/.test(rc));
ok('5: Refresh button still wired to load', /onClick=\{load\}[^\n]*'تحديث' : 'Refresh'/.test(rc));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IL last-updated tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
