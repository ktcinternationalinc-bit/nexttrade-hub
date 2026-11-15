// v55.83-A.6.14 (Max May 14 2026) — Cross-account duplicate detection at import time.
//
// Root cause of the ~100-row duplicate disaster:
//   EgyptBankTab.jsx doImport() filtered the duplicate check by account_id.
//   Importing the same statement to two different accounts bypassed dedup
//   entirely. This caused 6 invoices to silently inflate by ~163K EGP.
//
// This test enforces:
//   1. The .eq('account_id', accId) pattern is removed from import dedup
//   2. classifyDuplicates() exists and uses all-account scan
//   3. Three categories: clean / exact / possible
//   4. Review step renders before any insert when non-clean rows exist
//   5. Audit logging for override decisions
//   6. Bilingual EN+AR labels per Max's rule

var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'EgyptBankTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. OLD BUG IS DEAD — the per-account filter pattern is gone
ok('1: old per-account dedup filter is removed',
  !/select\('date, description, amount'\)\.eq\('account_id', accId\)/.test(src),
  'the .eq(account_id, accId) pattern caused the duplicate disaster');

// 2. classifyDuplicates function exists and is async
ok('2a: classifyDuplicates function defined',
  /const classifyDuplicates = async/.test(src));
ok('2b: scans across ALL accounts (no account_id filter on existing query)',
  /classifyDuplicates[\s\S]{0,2000}select\('id, date, description, amount, account_id'\)/.test(src)
  && !/classifyDuplicates[\s\S]{0,2000}\.eq\('account_id'/.test(src));

// 3. Three categories — clean / exact / possible
ok('3a: classifies as clean when no match',
  /status: 'clean'/.test(src));
ok('3b: classifies as exact when same date+amount+desc60',
  /status: 'exact'/.test(src));
ok('3c: classifies as possible for same-day-amount or adjacent-date match',
  /status: 'possible'/.test(src));

// 4. Review step exists and runs BEFORE insert
ok('4a: review step state defined',
  /const \[reviewClassified, setReviewClassified\] = useState/.test(src));
ok('4b: doImport routes to review step when non-clean rows found',
  /if \(exactCount > 0 \|\| possibleCount > 0\)[\s\S]{0,200}setImportStep\('review'\)/.test(src));
ok('4c: executeImport is a separate function called only after review',
  /const executeImport = async/.test(src));

// 5. Review UI renders with per-row decisions
ok('5a: review UI renders importStep === review',
  /importStep === 'review'/.test(src));
ok('5b: each row gets Skip and Import-anyway buttons',
  /setReviewDecision\(idx, 'skip'\)/.test(src) && /setReviewDecision\(idx, 'import'\)/.test(src));
ok('5c: "Skip all flagged" bulk action exists',
  /Skip all flagged \/ تخطى الكل/.test(src));
ok('5d: super-admin "Override: import ALL" exists',
  /Override: import ALL/.test(src) && /isAdmin && \(/.test(src));

// 6. Audit logging for override decisions
ok('6a: audit entries built for non-clean rows',
  /if \(c\.status !== 'clean'\) \{\s*auditEntries\.push/.test(src));
ok('6b: audit insert writes to bank_import_audit table (with audit_log fallback)',
  /from\('bank_import_audit'\)\.insert/.test(src) && /from\('audit_log'\)\.insert/.test(src));
ok('6c: audit captures user, decision, matched IDs, timestamp',
  /decided_by: myId/.test(src) && /decided_at:/.test(src) && /matched_ids:/.test(src));

// 7. Bilingual EN + AR throughout per Max's rule
ok('7a: review banner bilingual',
  /Duplicate review needed \/ مراجعة التكرارات/.test(src));
ok('7b: status pills bilingual',
  /🟢 Clean \/ نظيف/.test(src) && /🔴 Exact duplicate \/ مكرر/.test(src) && /🟡 Possible duplicate \/ محتمل/.test(src));
ok('7c: decision buttons bilingual',
  /Skip \/ تخطى/.test(src) && /Import anyway \/ استورد رغماً/.test(src));
ok('7d: completion message bilingual',
  /Import Complete! \/ اكتمل الاستيراد/.test(src));

// 8. Stats expose new fields
ok('8a: importStats includes exactSkipped, possibleSkipped, overridden',
  /exactSkipped: exactSkipped/.test(src) && /possibleSkipped: possibleSkipped/.test(src) && /overridden: overridden/.test(src));

// 9. Override-all requires explicit confirmation
ok('9: override-all triggers confirm dialog',
  /confirm\('You are about to import ALL flagged rows/.test(src));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.14 tests passed');
