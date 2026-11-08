// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QT — Match popup readability (Max, Nov 8 11:09):
//  "when matching an item... on the top it should also show the description"
//  "i should be able to click on a matched item to see actually where it is
//   matched... currently i cannot click into something already with a match"
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QT — description on top + click into matched items');
var at = R('src/components/AllTransactionsTab.jsx');
ok('1: the popup shows the FULL bank description (merchant + bank text, de-duplicated, never truncated) with the account, right under the title',
  /📝 \{\[mPanel\.txn\.merchant_name, mPanel\.txn\.name\]\.filter/.test(at) &&
  /whiteSpace: 'pre-wrap', wordBreak: 'break-word'/.test(at));
ok('2: 🔗 matched / split full / ◐ partial chips are BUTTONS that open the popup on its "where this money went" ledger',
  (at.match(/<button onClick=\{function \(\) \{ openMatch\(t\); \}\} className="px-1 py-0\.5 rounded font-extrabold mr-1 underline decoration-dotted"/g) || []).length === 3);
ok('3: a fully placed transaction shows "✅ Fully placed" instead of a list of $0 apply rows, pointing at unmatch to change it',
  /✅ Fully placed — every dollar of this transaction is accounted for/.test(at));
console.log('');
console.log('QT: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
