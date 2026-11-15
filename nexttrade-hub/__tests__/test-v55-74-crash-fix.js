// ============================================================
// v55.74 — CRITICAL CRASH FIX REGRESSION GUARD
//
// Bug: NadiaNewBuildCard was rendering BUILD_HISTORY items raw with {h}.
// In v55.73 we introduced { text, superAdminOnly } object items. Rendering
// objects directly throws React #31 ("object with keys {superAdminOnly,text}")
// and crashes the portal at startup — blocks ALL users.
//
// This test pins the safe-rendering pattern in BOTH consumer files so we
// never ship another build where items are rendered raw.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.74 — CRASH FIX REGRESSION GUARD');
console.log('============================================================');

var nbc = read('src/components/NadiaNewBuildCard.jsx');
var wnw = read('src/components/WhatsNewWidget.jsx');
var pg = read('src/app/page.jsx');

group('1. NadiaNewBuildCard never renders raw items again');

check('1.1 Render extracts .text from item before rendering (no raw {h})',
  /var itemText = typeof h === 'string' \? h : \(h && h\.text\) \|\| ''/.test(nbc));
check('1.2 Render uses {itemText}, not {h} directly',
  /<li[^>]*>\{itemText\}<\/li>/.test(nbc) && !/<li[^>]*>\{h\}<\/li>/.test(nbc));
check('1.3 Renders nothing if itemText is empty (defensive)',
  /if \(!itemText\) return null/.test(nbc));

group('2. NadiaNewBuildCard accepts admin props for filtering');

check('2.1 Component signature accepts isAdmin + isSuperAdmin',
  /export default function NadiaNewBuildCard\(\{ isAdmin, isSuperAdmin \}/.test(nbc));
check('2.2 Computes canSeeAdminInternals from props',
  /var canSeeAdminInternals = !!\(isAdmin \|\| isSuperAdmin\)/.test(nbc));
check('2.3 Computes canSeeAiConfidential from isSuperAdmin only',
  /var canSeeAiConfidential = !!isSuperAdmin/.test(nbc));

group('3. NadiaNewBuildCard filters items before showing highlights');

check('3.1 Filters out superAdminOnly items for non-super-admins',
  /it\.superAdminOnly && !canSeeAiConfidential/.test(nbc));
check('3.2 Filters out adminOnly items for non-admins',
  /it\.adminOnly && !canSeeAdminInternals/.test(nbc));
check('3.3 Plain strings always visible',
  /typeof it === 'string'\) return true/.test(nbc));
check('3.4 Filter applied BEFORE slice(0, 3)',
  /\.filter\(function \(it\)[\s\S]{0,400}\)\.slice\(0, 3\)/.test(nbc));

group('4. NadiaNewBuildCard mount passes admin props');

check('4.1 page.jsx passes isAdmin + isSuperAdmin to NadiaNewBuildCard',
  /<NadiaNewBuildCard isAdmin=\{isAdmin\} isSuperAdmin=\{isSuperAdmin\} \/>/.test(pg));
check('4.2 isSuperAdmin is computed at top-level scope (line ~1171)',
  /const isSuperAdmin = userProfile\?\.role === 'super_admin'/.test(pg));

group('5. WhatsNewWidget remains safe');

check('5.1 WhatsNewWidget items render extracts .text',
  /var itemText = typeof item === 'string' \? item : \(item && item\.text\) \|\| ''/.test(wnw));
check('5.2 WhatsNewWidget uses {itemText}, not {item}',
  /<span>\{itemText\}<\/span>/.test(wnw));

group('6. v55.74 entry exists at top of BUILD_HISTORY');

check('6.1 v55.74 entry still present in BUILD_HISTORY (now after v55.75)',
  /version: 'v55\.74'/.test(wnw));
check('6.2 v55.74 has a public-safe high-level bullet',
  /'Stability fix for the dashboard so the portal loads cleanly/.test(wnw));
check('6.3 v55.74 documents the crash root cause as superAdminOnly',
  /superAdminOnly: true, text: 'CRITICAL CRASH FIX/.test(wnw));

group('7. Type safety reminder — pattern for any future BUILD_HISTORY consumer');

check('7.1 Both consumer files use the same safe extraction pattern',
  // typeof X === 'string' ? X : (X && X.text) || ''
  (nbc.match(/typeof \w+ === 'string' \? \w+ : \(\w+ && \w+\.text\) \|\| ''/g) || []).length >= 1
  && (wnw.match(/typeof \w+ === 'string' \? \w+ : \(\w+ && \w+\.text\) \|\| ''/g) || []).length >= 1);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
