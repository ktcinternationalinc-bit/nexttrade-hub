// ============================================================
// v55.83-MB — two live P0s the user hit on the LY deploy:
//  CRASH: clicking "Dry Run" on a TRANSACTION crashed the Accounting page with React #31 ("objects are not
//    valid as a React child"). The dry-run result stored wouldDo = d.would_send (an OBJECT) and the renderer
//    did {r.wouldDo} directly. Now any non-string wouldDo is JSON.stringified before render.
//  STATUS (Codex FAIL): the failed bank-txn row set q.retry, but the renderer reads q.retryable, so a failed
//    push fell through to "not synced". Now the row sets q.retryable (matches the renderer).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: the dry-run "Would:" line never renders a raw object (stringifies non-strings) — fixes the React #31 crash',
  /Would: \{typeof r\.wouldDo === 'string' \? r\.wouldDo : JSON\.stringify\(r\.wouldDo, null, 2\)\}/.test(sync) &&
  // the old direct-object render is gone
  !/Would: \{r\.wouldDo\}<\/div>/.test(sync));
ok('2: the failed bank-txn row sets the SAME property the renderer reads (retryable), so it shows "failed · retry" not "not synced"',
  /retryable: btFailed,/.test(sync) &&
  /q\.retryable \? 'failed · retry' : 'not synced'/.test(sync) &&
  !/\bretry: btFailed/.test(sync));
ok('3: the transaction dry-run message surfaces the resolved bank account + how it was resolved (anchor_via) and the debit/credit journal',
  /d\.anchor_via \? \(' \[' \+ d\.anchor_via \+ '\]'\)/.test(sync) &&
  /if \(d\.debit && d\.credit\) \{ jrn =/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MB dry-run-crash + retry-status tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
