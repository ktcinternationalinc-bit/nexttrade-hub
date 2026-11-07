// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PI — Expense categories + self-learning rules + verified stamp
//
// Max (Nov 6): "we need to be able to create categories to mark expenses..
// and should automatically remember previous selections for the future and
// use them and have a verified tab.. but verified will not prevent it from
// being counted against the expense and rules automatically saved and
// updated if i manually change something. and have a rules tab to create
// new rules for expenses."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PI — expense categories + rules + verified');

// ── 1. FUNCTIONAL: the real matching math ──
var src = R('src/lib/expense-rules.js');
var names = [];
var cjs = src
  .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; })
  .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
/* eslint-disable no-new-func */
var mod = { exports: {} };
new Function('module', 'exports', cjs)(mod, mod.exports);
var merchantKey = mod.exports.merchantKey;
var bestRule = mod.exports.bestRule;

ok('1a: merchantKey strips refs/card numbers/dates so the SAME merchant always maps to the SAME rule',
  merchantKey('SHELL OIL 57444 #8821 11/02') === 'shell oil' &&
  merchantKey('shell oil 91230 *4411') === 'shell oil' &&
  merchantKey('ACH PAYMENT AMAZON MKTPL*2231') === 'ach payment amazon mktpl');
ok('1b: too-short / all-numeric descriptions make NO rule (never a junk rule)',
  merchantKey('12345 6789') === null && merchantKey('') === null && merchantKey(null) === null && merchantKey('A1') === null);
var rules = [
  { id: 'r1', match_text: 'shell', classification: 'fuel', active: true },
  { id: 'r2', match_text: 'shell oil', classification: 'vehicle_fuel', active: true },
  { id: 'r3', match_text: 'shell oil 5', classification: 'wrong', active: false },
];
var b = bestRule(rules, 'SHELL OIL 57444 POS');
ok('1c: most-specific ACTIVE rule wins (longest match), inactive rules never fire',
  b && b.id === 'r2' && bestRule(rules, 'chevron 123') === null);

// ── 2. SQL: categories, rules, verified stamp ──
var sql = R('sql/v55-83-PI-expense-categories-rules.sql');
ok('2a: expense_categories table + the 11 built-ins seeded idempotently (ON CONFLICT DO NOTHING)',
  /CREATE TABLE IF NOT EXISTS expense_categories/.test(sql) && /ON CONFLICT \(key\) DO NOTHING/.test(sql) &&
  /'vendor_payment'/.test(sql) && /'needs_clarification'/.test(sql));
ok('2b: ONE rule per match text ("updated if i manually change something") — unique lower(match_text)',
  /CREATE UNIQUE INDEX IF NOT EXISTS us_expense_rules_match_uq ON us_expense_rules \(lower\(match_text\)\)/.test(sql) &&
  /CHECK \(source IN \('manual','learned'\)\)/.test(sql));
ok('2c: category_verified + who/when on bank_transactions; a FLAG only',
  /ADD COLUMN IF NOT EXISTS category_verified\s+boolean NOT NULL DEFAULT false/.test(sql) &&
  /category_verified_by uuid/.test(sql) && /category_verified_at timestamptz/.test(sql));
ok('2d: RLS open-authenticated (email auth pattern), NO delete policy — deactivate, never erase',
  /ecat_upd ON expense_categories FOR UPDATE/.test(sql) && /erul_upd ON us_expense_rules FOR UPDATE/.test(sql) &&
  !/FOR DELETE/.test(sql));

// ── 3. Learning: every human pick is remembered ──
var srv = R('src/lib/expense-rules-server.js');
ok('3a: learnRule upserts by merchant key — same classification kept, changed mind UPDATES the learned rule',
  /ilike\('match_text', key\)/.test(srv) && /row\.classification === classification\) \{ return \{ kept: row\.id \};/.test(srv) &&
  /\{ updated: row\.id \}/.test(srv) && /source: 'learned'/.test(srv));
ok('3b: a MANUAL rule is never silently retargeted by the learner; needs_clarification is never learned',
  /row\.source === 'manual'\) \{ return \{ kept_manual: row\.id \};/.test(srv) &&
  /classification === 'needs_clarification'\) \{ return \{ skipped: 'no_classification' \};/.test(srv));
var bw = R('src/app/api/accounting/bank-write/route.js');
ok('3c: bank-write classify LEARNS on every human expense categorization, fail-soft, out-direction only',
  /import \{ learnRule \}/.test(bw) && /cRes\.data\[0\]\.direction === 'out'/.test(bw) &&
  /learnRule\(db, \(cRes\.data\[0\]\.merchant_name \|\| ''\) \+ ' ' \+ \(cRes\.data\[0\]\.name \|\| ''\), cPatch\.classification, by\)/.test(bw));

// ── 4. Applying: rules only ever FILL BLANKS ──
ok('4a: applyExpenseRules targets unreviewed + classification IS NULL + settled + out + US only',
  /eq\('review_status', 'unreviewed'\)\.is\('classification', null\)/.test(srv) &&
  /eq\('direction', 'out'\)/.test(srv) && /neq\('pending', true\)/.test(srv));
ok('4b: the update RE-CHECKS unreviewed+unclassified (never races a human) and marks category_source rule',
  /\.eq\('id', t\.id\)\.eq\('review_status', 'unreviewed'\)\.is\('classification', null\)/.test(srv) &&
  /category_source: 'rule'/.test(srv));
ok('4c: applying a rule NEVER reviews or verifies for the human',
  !/review_status: 'reviewed'/.test(srv) && !/category_verified/.test(srv));
var job = R('src/app/api/accounting/clickbooks-us/shadow-job/route.js');
ok('4d: the 15-minute tick runs hub rules too, failing soft until the PI SQL is run',
  /applyExpenseRules\(db, 500\)/.test(job) && /hub_rules: hubRules/.test(job) && /hubRules = \{ error:/.test(job));

// ── 5. The route: verify is a stamp, never an exclusion ──
var rt = R('src/app/api/accounting/expense-rules/route.js');
ok('5a: everything gated on bank.classify (same permission as Bank Review categorization)',
  /assertPermission\(db, userId, 'bank\.classify', req\)/.test(rt));
ok('5b: verify REQUIRES a category first; expense verify advances unreviewed→reviewed only for OUT + unmatched',
  /Pick a category first/.test(rt) &&
  /prow\.direction === 'out' && prow\.review_status === 'unreviewed' && !prow\.matched_invoice_id/.test(rt));
ok('5c: rules/categories are deactivated, never hard-deleted (no .delete() anywhere in the route)',
  /action === 'deactivate_rule'/.test(rt) && rt.indexOf('.delete(') < 0);
ok('5d: missing SQL comes back as a NAMED instruction, not a mystery error',
  /run sql\/v55-83-PI-expense-categories-rules\.sql first/.test(rt) && /needs_sql: true/.test(rt));

// ── 6. "verified will not prevent it from being counted against the expense" —
//        NOTHING in the money math filters on category_verified ──
var moneyFiles = [
  'src/app/api/accounting/bills/route.js',
  'src/app/api/pnl/route.js',
  'src/lib/cashflow.js',
  'src/lib/aging.js',
];
var leaks = [];
moneyFiles.forEach(function (f) {
  var t = '';
  try { t = R(f); } catch (e) { return; }
  if (/category_verified/.test(t)) { leaks.push(f); }
});
ok('6: category_verified appears in ZERO money-math files (never excludes an expense from any total): ' + (leaks.length ? leaks.join(',') : 'clean'),
  leaks.length === 0);

// ── 7. UI ──
var ui = R('src/components/ExpenseRulesTab.jsx');
ok('7a: 🏷 tab has add-category, new-rule form, ▶ apply now, learned/manual chips, hit counts',
  /new category…/.test(ui) && /\+ new rule/.test(ui) && /▶ Apply rules now/.test(ui) &&
  /🧠 learned/.test(ui) && /✍ manual/.test(ui));
ok('7b: Verified view = To verify / ✓ Verified / All, stamp wording explicit, verify disabled without a category',
  /'unverified', 'verified', 'all'/.test(ui) && /it never removes the expense from any total/.test(ui) &&
  /disabled=\{busy \|\| !t\.classification\}/.test(ui));
ok('7c: recategorizing from the tab goes through the SAME classify action (so the rule learns the change)',
  /action: 'classify', bank_transaction_id: t\.id/.test(ui));
var at = R('src/components/AccountingTab.jsx');
ok('7d: 🏷 Categories & Rules wired into Accounting behind bank.classify',
  at.indexOf("['categories', '🏷 Categories & Rules']") >= 0 &&
  /t\[0\] !== 'categories' \|\| isSuper \|\| mp\['bank\.classify'\] === true/.test(at) &&
  /sub === 'categories' && <div className="p-3"><ExpenseRulesTab/.test(at));
var bh = R('src/components/BooksHomeTab.jsx');
ok('7e: Books-home dropdown uses YOUR categories (fallback to built-ins) and PREFILLS the rule suggestion',
  /from\('expense_categories'\)/.test(bh) && /dynCats \|\| CLASSIFICATIONS\.map/.test(bh) &&
  /prefillSuggestions\(outQueue, hubRules\)/.test(bh) && /never stomp a human's draft/.test(bh));

console.log('');
console.log('PI: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
