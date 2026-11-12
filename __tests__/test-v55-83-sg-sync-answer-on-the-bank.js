// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SG — Max, Nov 12 10:09 (screenshot of the bank list after clicking Sync: nothing visible, "Last synced Nov 6 / Nov 7"):
//  "this is what i get after i click on sync transactions"
// The sync DID answer — at the top of the page, far above the button, out of sight. Now the answer (done / failed and why) is
// printed on the bank that was synced, and a bank whose last sync failed says so on its own card. Source pins.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var S = fs.readFileSync(path.join(__dirname, '..', 'src/components/BankTab.jsx'), 'utf8');
var pass = 0, failN = 0;
function check(l, c) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l); }
console.log('SG — the sync answer is shown on the bank that was synced');
check('1: the bank being synced is remembered', S.indexOf('setSyncing(true); setSyncConn(connId);') > 0);
check('2: a failure is printed on that bank, under the button', S.indexOf('{syncConn === c.id && !syncing && error && (') > 0);
check('3: a success ("Sync done — N transactions…") is printed there too', S.indexOf('{syncConn === c.id && !syncing && !error && notice && (') > 0);
check('4: a bank whose LAST sync failed says so on its card, with the reason, and tells you to reconnect when the login expired', S.indexOf("c.last_sync_status === 'error' && c.last_sync_error") > 0 && S.indexOf('The last sync of this bank failed: ') > 0 && S.indexOf('sign in to this bank again') > 0);
check('5: a server that answers with no JSON (timeout) gives a plain message, not a parse error', S.indexOf("'the server did not answer properly (HTTP ' + res.status + ')'") > 0);
check('6: readable in both skins — explicit colours on every new message', (S.match(/background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5', order: 3/g) || []).length === 2 && S.indexOf("background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7', order: 3") > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
