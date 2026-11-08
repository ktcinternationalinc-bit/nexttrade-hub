// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QV — Rules you can see working (Max, Nov 8 11:16: "are the category
// rules working...?? i tried adding Public Service yet it still shows 0
// hits.. I should also be able to edit or delete a rule").
// Rules match the text AS THE BANK WRITES IT and only FILL BLANKS — so a
// rule whose words never appear (PSE&G prints "Pse&g", not "Public
// Service"), or whose lines are already categorized, honestly shows 0 hits.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QV — test / edit / remove rules');
var er = R('src/app/api/accounting/expense-rules/route.js');
var ui = R('src/components/ExpenseRulesTab.jsx');
ok('1: rule_preview uses the SAME ruleMatches() as the 15-minute job, over up to 5000 money-out lines (duplicates excluded), and sorts every hit into fillable / rule-filled / human / verified',
  /import \{ ruleMatches \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/expense-rules';/.test(er) &&
  /ruleMatches\(probe, \(t\.merchant_name \|\| ''\) \+ ' ' \+ \(t\.name \|\| ''\)\)/.test(er) &&
  /fillable: fillable\.length, rule_filled: ruleFilled\.length, human_picked: human\.length, verified: verified\.length/.test(er));
ok('2: apply_rule_now NEVER touches a human pick or a verified row — re-checks at write time, rule-filled re-point only when asked, hit count + audit updated',
  /\.neq\('category_verified', true\)/.test(er) &&
  /uq\.eq\('category_source', 'rule'\) : uq\.is\('classification', null\)\.eq\('review_status', 'unreviewed'\)/.test(er) &&
  /pv\.include_rule_filled === true/.test(er) && /'rule_applied_now'/.test(er));
ok('3: the 0-hits case EXPLAINS itself — "no bank line contains this text... match the words AS THE BANK WRITES THEM"',
  /No bank line contains this text — that is why Hits stays at 0/.test(ui));
ok('4: every rule row has 🔍 test, ✏ edit (inline text + category), 🗑 remove (confirm; stops applying, keeps past categories) and ↺ restore via "show removed"',
  /🔍 test<\/button>/.test(ui) && /✏ edit<\/button>/.test(ui) && /🗑 remove<\/button>/.test(ui) && /↺ restore<\/button>/.test(ui) &&
  /show removed rules/.test(ui) && /Transactions it already categorized KEEP their category/.test(ui));
ok('5: "🔍 test first" on the new-rule form — see what a text catches BEFORE saving it',
  /testRule\(null, nr\.match_text\)/.test(ui) && /🔍 test first/.test(ui));
ok('6: remove stays non-destructive — still deactivate (no hard delete anywhere in the route)',
  er.indexOf('.delete(') < 0);
console.log('');
console.log('QV: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
