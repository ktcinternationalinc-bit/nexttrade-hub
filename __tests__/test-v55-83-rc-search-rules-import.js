// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RC — Max, Nov 8 13:59:
//   "the search in all transactions is not working
//    the category testing and applying is not working. it should automatically
//    apply regardless..but clicking on apply is not working.
//    when you do an import for a bank you need to include the transaction
//    description. if i import the same file again. you need to update it to
//    include the description without creating duplicates.
//    Also the imported files for the money market is not showing up when
//    looking at all transactions in clickbooks"
// Root causes found: (1) the database returns at most 1,000 rows per request —
// All Transactions asked for 5,000 and silently got the newest 1,000, so older
// lines (a money-market statement) never loaded and search could not find
// them; (2) the Apply button was DISABLED whenever every match already had a
// person's category, and big applies timed out with no message; rules only
// looked at money OUT, the first 500 blanks, raw text; (3) the importer took
// the first header containing any candidate word — a Chase file's "Details"
// (DEBIT/CREDIT) beat "Description".
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function loadEsm(src, extra) {
  var names = [];
  var cjs = src.replace(/^import[^\n]*\n/gm, '').replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
  cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
  var mod = { exports: {} };
  /* eslint-disable no-new-func */
  new Function('module', 'exports', cjs + (extra || ''))(mod, mod.exports);
  return mod.exports;
}
console.log('RC — search, rules, statement import');

// ── rules: real matcher
var M = loadEsm(R('src/lib/expense-rules.js'));
ok('1a: "Public Service" matches however the bank spaces or punctuates it',
  M.ruleMatches({ match_text: 'Public Service' }, 'PUBLIC  SERVICE ELEC & GAS') &&
  M.ruleMatches({ match_text: 'public service' }, 'PUBLIC-SERVICE*PYMT 0042') &&
  M.ruleMatches({ match_text: 'pse&g' }, 'Pse&g Bill Pay') &&
  !M.ruleMatches({ match_text: 'public service' }, 'PUBLICSTORAGE 1234'));
ok('1b: too-short rule text never matches (no accidental 2-letter rules)', !M.ruleMatches({ match_text: 'a ' }, 'anything at all'));
var srv = R('src/lib/expense-rules-server.js');
ok('1c: ONE engine — money in AND out, every date, paged past 1,000, never a duplicate copy, never pending',
  /for \(var pg = 0; pg < 40; pg\+\+\)/.test(srv) && /\.not\('pending', 'is', true\)/.test(srv) &&
  /\.or\('review_status\.is\.null,review_status\.neq\.duplicate'\)/.test(srv) &&
  !/\.eq\('direction', 'out'\)/.test(srv.split('async function pageBankRows')[1]));
ok('1d: fills every blank (any review status), re-targets earlier rule fills, replaces people\'s picks ONLY when asked; a VERIFIED row is never touched',
  /var a1 = await batchSet\(db, ids\(pv\.buckets\.blank\), rule\.classification, 'blank'\);/.test(srv) &&
  /var a2 = await batchSet\(db, ids\(pv\.buckets\.rule\), rule\.classification, 'rule'\);/.test(srv) &&
  /var a3 = o\.overwrite_people === true \? await batchSet/.test(srv) &&
  /\.not\('category_verified', 'is', true\); \/\/ a verified row is never touched/.test(srv));
ok('1e: batched writes (200 per call) — a big apply finishes instead of timing out silently; route budget 60s',
  /for \(var i = 0; i < ids\.length; i \+= 200\)/.test(srv) && /export const maxDuration = 60;/.test(R('src/app/api/accounting/expense-rules/route.js')));
var er = R('src/app/api/accounting/expense-rules/route.js');
ok('1f: saving or editing a rule APPLIES it immediately ("it should automatically apply regardless"); the 15-minute job keeps applying it',
  /var apI = \(patch\.active && patch\.auto_apply && insr\.data && insr\.data\[0\]\) \? await applyRuleToAll\(db, insr\.data\[0\], \{\}\) : null;/.test(er) &&
  /var apU = \(patch\.active && patch\.auto_apply && updr\.data && updr\.data\[0\]\) \? await applyRuleToAll\(db, updr\.data\[0\], \{\}\) : null;/.test(er) &&
  /var got = await pageBankRows\(db, 'id, name, merchant_name, classification, category_verified', function \(q\) \{ return q\.is\('classification', null\); \}\);/.test(srv));
var ert = R('src/components/ExpenseRulesTab.jsx');
ok('1g: the Apply button is ALWAYS clickable, always answers (incl. timeouts), and offers "apply to ALL matches" with a confirm',
  /<button onClick=\{function \(\) \{ applyOne\(preview\.rule, false\); \}\} disabled=\{busy\}/.test(ert) &&
  /\.catch\(function \(\) \{ toast\.error\('The apply did not answer/.test(ert) &&
  /Apply to ALL \{preview\.fillable \+ preview\.human_picked\} matches/.test(ert) &&
  /window\.confirm\('Apply "' \+ r\.match_text \+ '" to EVERY matching line/.test(ert));

// ── All Transactions
ok('2a: All Transactions PAGED (up to 30,000 lines) — not the silent newest-1,000; payments/bills/parked money paged too; rows without a review status kept',
  /for \(var pgT = 0; pgT < 30; pgT\+\+\)/.test(er) && /\.range\(pgT \* 1000, pgT \* 1000 \+ 999\)/.test(er) &&
  /var payWinA = await pageAny\(/.test(er) && /var billWinA = await pageAny\(/.test(er) && /var unWinA = await pageAny\(/.test(er) &&
  !/\)\.limit\(5000\)/.test(er.split("action === 'all_transactions'")[1].split("action === 'transfer_candidates'")[0]));
ok('2b: lines outside the dates shown are REPORTED per account (the money-market import is never invisible) + "All dates" button',
  /outside_dates: Object\.keys\(outsideBy\)/.test(er) &&
  /Not in these dates: /.test(R('src/components/AllTransactionsTab.jsx')) &&
  /load\('2000-01-01', new Date\(\)\.toISOString\(\)\.substring\(0, 10\)\)/.test(R('src/components/AllTransactionsTab.jsx')));
var at = R('src/components/AllTransactionsTab.jsx');
ok('2c: search — every word in any order; amounts with/without $ and commas; US dates; deposit/payment words',
  /var words = q\.trim\(\)\.toLowerCase\(\)\.replace\(\/\[\$\]\/g, ''\)\.split/.test(at) &&
  /if \(hayN\.indexOf\(w0\) < 0\) \{ return false; \}/.test(at) && /toLocaleString\('en-US', \{ minimumFractionDigits: 2 \}\)/.test(at) &&
  /'deposit money in ' : 'payment money out '/.test(at));
// simulate the search on a row
(function () {
  var body = at.split('if (q.trim()) {')[1].split('return true;')[0];
  var fn = new Function('t', 'q', 'labelOf', 'if (q.trim()) {' + body + ' return true;');
  var t = { who: 'PSEG', who_full: 'PUBLIC SERVICE ELEC', date: '2026-03-04', account: 'Money Market •4411', amount: 1250, direction: 'out', classification: 'utilities', review_status: 'reviewed' };
  var L = { utilities: 'Utilities' };
  ok('2d: real search — "public elec", "1,250", "$1250.00", "03/04/2026", "money market utilities" all find the line; "rent" does not',
    fn(t, 'public elec', L) === true && fn(t, '1,250', L) === true && fn(t, '$1250.00', L) === true &&
    fn(t, '03/04/2026', L) === true && fn(t, 'money market utilities', L) === true && fn(t, 'rent', L) === false);
})();

// ── importer
var si = R('src/components/StatementImport.jsx');
var guessSrc = si.split('function guessCol')[1].split('\nexport default')[0];
var guessCol = new Function('return function guessCol' + guessSrc)();
var chase = ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance', 'Check or Slip #'];
var dcands = si.match(/var descCol = guessCol\(headers, (\[[^\]]+\])\);/);
ok('3a: a Chase file picks "Description", not "Details" (DEBIT/CREDIT) — candidate order decides',
  dcands && guessCol(chase, JSON.parse(dcands[1].replace(/'/g, '"'))) === 2);
ok('3b: a separate memo column rides along; the line\'s other cells go up so a re-import can recognise its own line',
  /var memo = map\.memoCol >= 0 && map\.memoCol !== map\.descCol/.test(si) && /alts: alts,/.test(si) &&
  /dateCol < 0 && String\(h1 \|\| ''\)\.toLowerCase\(\)\.indexOf\('date'\) >= 0/.test(si));
var imp = R('src/app/api/accounting/statement-import/route.js');
ok('3c: re-import — same line same words: kept; same line stored earlier with a type word ("DEBIT") or another cell of the SAME line: description REPAIRED in place; never a new copy, never a different payee',
  /good\.forEach\(function \(g\) \{ \/\/ pass 1 — same line, same words/.test(imp) &&
  /return GENERIC_DESC\.test\(nd\.replace/.test(imp) && /\(g\.alts \|\| \[\]\)\.indexOf\(nd\) >= 0/.test(imp) &&
  /\.eq\('id', toRename\[rn\]\.id\)\.like\('plaid_transaction_id', 'manual-%'\)/.test(imp) &&
  /descriptions_updated: renamed/.test(imp));
ok('3d: the dedupe reads ALL earlier lines (paged) — a big re-import can no longer slip duplicates past the 1,000 cap',
  /for \(var pgE = 0; pgE < 40; pgE\+\+\)/.test(imp) && !/\.limit\(20000\)/.test(imp));
var GEN = new Function('return ' + imp.match(/var GENERIC_DESC = (\/.*\/);/)[1])();
ok('3e: generic words recognised (DEBIT, ACH_DEBIT, (no description), digits) — real payees are not',
  GEN.test('debit') && GEN.test('ach debit') && GEN.test('no description') && GEN.test('12345') && !GEN.test('pseg bill pay') && !GEN.test('amazon'));
ok('3f: the import tells you when an account is in a NON-US silo (ClickBooks USA lists US accounts only) or dated before the default view',
  /us_books: silo === US_WAVE_BUSINESS_ID/.test(imp) && /assigned to a NON-US silo/.test(si) && /press "All dates" to see them/.test(si));

console.log('');
console.log('RC: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
