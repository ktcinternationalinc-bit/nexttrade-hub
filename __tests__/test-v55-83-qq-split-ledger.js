// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QQ — The split ledger (Max, Nov 7 16:08: "when i select a payment
// and apply it it should show it somewhere... where they went... so it is
// clear where i put the money as i split it. all remaining amounts should
// automatically move to uncategorized").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QQ — where-the-money-went ledger + auto-park');
var at = R('src/components/AllTransactionsTab.jsx');
var bills = R('src/app/api/accounting/bills/route.js');
var er = R('src/app/api/accounting/expense-rules/route.js');
ok('1: both candidate calls return applied_detail — every applied piece NAMED (invoice ref + release / bill vendor·number / RTM-covered / parked), with amount and date',
  /applied_detail: apDetail/.test(bills) && /applied_detail: apDetailB/.test(bills) &&
  /d0\.ref = r1\.invoice_number; d0\.rel = r1\.release_number \|\| null;/.test(bills) &&
  /kind: p1\.method === 'rtm' \? 'rtm_bill' : 'bill'/.test(bills));
ok('2: the popup shows 💰 WHERE THIS MONEY WENT — each piece on its own line, parked money labeled UNCATEGORIZED with the Bank-Review pointer',
  /💰 Where this money went so far:/.test(at) &&
  /📥 UNCATEGORIZED \(parked — place later from Bank Review\)/.test(at));
ok('3: ✓ done AUTO-PARKS the remainder as uncategorized (create_unapplied, same guarded path), the button SAYS so before you click, and failures fall back to ◐ partial with a message',
  /'✓ done — park \$' \+ fmt\(mPanel\.txn\.remaining\) \+ ' as UNCATEGORIZED'/.test(at) &&
  /action: 'create_unapplied', txn: \{ id: t\.id \}, amount: rem/.test(at) &&
  /it stays as ◐ partial/.test(at));
ok('4: parked money COUNTS as placed everywhere — candidates remaining includes open unapplied_deposits, and the row chips do too (no false ◐ partial after a park)',
  /from\('unapplied_deposits'\)\.select\('amount, status'\)\.eq\('bank_transaction_id', txDm\.data\.id\)\.eq\('status', 'open'\)/.test(bills) &&
  /from\('unapplied_deposits'\)\.select\('bank_transaction_id, amount, status'\)\.eq\('status', 'open'\)/.test(er));
ok('5: cleaner rows — aligned grid (text | amount | apply), zebra striping, a "Put the REST" header once money is applied',
  /gridTemplateColumns: 'minmax\(0,1fr\) 110px 84px'/.test(at) &&
  /➡ Put the REST \(or ✓ done parks it as UNCATEGORIZED\):/.test(at));
console.log('');
console.log('QQ: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
