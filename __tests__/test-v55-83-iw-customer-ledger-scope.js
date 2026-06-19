// ============================================================
// v55.83-IW — Customer Ledger picker must be SILO-SCOPED (Codex P0): Real KTC must not show Kandil/
// other-silo customers, and the list must not silently cap at 40. (Matches Max's screenshot.)
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'CustomerLedger.jsx'), 'utf8');

ok('1: scopedCustomers memo exists', /var scopedCustomers = useMemo\(function \(\) \{/.test(src));
ok('2: EXCLUDES customers explicitly assigned to a different silo',
  /if \(c\.wave_business_id && c\.wave_business_id !== activeBiz\) \{ return; \}/.test(src));
ok('3: INCLUDES customers assigned to the active silo', /if \(c\.wave_business_id === activeBiz\) \{ keep\[c\.id\] = c; \}/.test(src));
ok('4: INCLUDES legacy/untagged customers that have activity (invoices/payments) in this silo',
  /i\.wave_business_id === activeBiz/.test(src) && /p\.wave_business_id === activeBiz/.test(src) && /if \(actIds\[c\.id\]\) \{ keep\[c\.id\] = c; \}/.test(src));
ok('5: picker searches the SCOPED list (not raw customers)', /var allScoped = scopedCustomers\.filter\(/.test(src));
ok('6: no silent 40-cap of the raw customer list', src.indexOf('customers.filter(function (c) {\n    if (!search) return true;') === -1 && src.indexOf('.slice(0, 40)') === -1);
ok('7: shows a count instead of hiding rows', /Showing ' \+ matches\.length \+ ' of ' \+ allScoped\.length/.test(src) && /pickerCountLabel/.test(src));
ok('8: clears the selected customer when it falls out of the active silo scope',
  /if \(selectedId && scopedCustomers\.length && !scopedCustomers\.some\(function \(c\) \{ return c\.id === selectedId; \}\)\) \{ setSelectedId\(''\); \}/.test(src));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IW customer-ledger scope tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
