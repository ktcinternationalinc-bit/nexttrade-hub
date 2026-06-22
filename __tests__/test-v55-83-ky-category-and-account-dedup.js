// ============================================================
// v55.83-KY — Bank Review cleanup from live use:
//  (1) Wave Category dropdown flooded with dozens of identical "Accounts Payable (System Payable Bill)"
//      system sub-accounts (Wave auto-creates one per bill) — hide SYSTEM/PAYABLE/RECEIVABLE + collapse
//      duplicate names + sort, and make the picker SEARCHABLE (was a scroll-only native <select>).
//  (2) The account filter showed the SAME real account twice after a reconnect — dedup by mask so one
//      entry shows that account's transactions across both ids.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/categories/route.js');
var br = rd('src/components/BankReviewTab.jsx');

ok('1: categories route hides SYSTEM / PAYABLE / RECEIVABLE in EITHER subtype OR name (no name-only leak — Codex LA)',
  /function isHiddenForCategorize\(c\)/.test(route) &&
  /function hit\(s\) \{ return s\.indexOf\('SYSTEM'\) >= 0 \|\| s\.indexOf\('PAYABLE'\) >= 0 \|\| s\.indexOf\('RECEIVABLE'\) >= 0; \}/.test(route) &&
  /return hit\(sub\) \|\| hit\(nm\);/.test(route));
ok('2: categories route collapses duplicate NAMES and sorts by name',
  /if \(nmKey && seenName\[nmKey\]\) \{ hiddenDupName\+\+; return; \}/.test(route) &&
  /usable\.sort\(function \(a, b\)/.test(route));
ok('3: the Wave Category picker is a SEARCHABLE Typeahead (not a scroll-only select)',
  /Search Wave categories…/.test(br) &&
  /onPick=\{function \(id\) \{ setWaveCategory\(sel, id\); \}\}/.test(br));
ok('4: a locked/no-permission txn shows the category read-only (no editable picker)',
  /\(!mayClassify \|\| isLocked\(sel\)\) \? \(/.test(br) &&
  /\(reopen to change\)/.test(br));
ok('5: Bank Review account filter is keyed by MASK so a reconnected duplicate account shows once',
  /function maskKeyOf\(accountId, mapOverride\) \{ var a = \(mapOverride \|\| plaidAccts\)\[accountId\]; return \(a && a\.mask\) \? \('mask:' \+ a\.mask\) : \('acct:' \+ accountId\); \}/.test(br) &&
  /var k = maskKeyOf\(t\.account_id\); if \(!s\[k\]\)/.test(br));
ok('6: the account filter + default + deep-link all use the mask key (consistent)',
  /list = list\.filter\(function \(t\) \{ return maskKeyOf\(t\.account_id\) === fAccount; \}\)/.test(br) &&
  /setFAccount\(maskKeyOf\(defAcct, pa\)\)/.test(br) &&
  /setFAccount\(deepHit\.account_id \? maskKeyOf\(deepHit\.account_id, pa\) : 'all'\)/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KY category + account-dedup tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
