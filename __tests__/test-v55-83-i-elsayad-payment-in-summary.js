// v55.83-I — El Sayad: a standalone EGP payment (SAIB 500,000) MUST reduce the
// summary net, not just the running-balance column. Cards + summary read
// simulate().byCurrency, so this guards the exact "−998,354.50 vs −498,354.50" bug.
var path = require('path');
(async function () {
  var mod = await import('file://' + path.join(__dirname, '..', 'src/lib/open-account-ledger.js'));
  var simulate = mod.simulate;
  var fails = 0;
  function ok(n, c) { if (c) console.log('\u2713 ' + n); else { console.log('\u2717 ' + n); fails++; } }
  function vbill(id, amt, d){ return { id, account_id:'A', currency:'EGP', transaction_type:'vendor_bill', debit_amount:amt, credit_amount:0, entry_date:d }; }
  function paysent(id, amt, d, field){ var e={ id, account_id:'A', currency:'EGP', transaction_type:'payment_sent', debit_amount:0, credit_amount:0, entry_date:d }; e[field||'debit_amount']=amt; return e; }

  var scenarios = {
    'bill then payment':     [ vbill('b1', 998354.50, '2025-12-01'), paysent('p1', 500000, '2026-05-10') ],
    'payment then bill':     [ paysent('p1', 500000, '2026-03-14'), vbill('b1', 998354.50, '2026-05-13') ],
    'two bills + payment':   [ vbill('b1', 483654, '2025-12-01'), paysent('p1', 500000, '2026-05-10'), vbill('b2', 514700.50, '2026-05-13') ],
    'payment in credit fld': [ vbill('b1', 998354.50, '2025-12-01'), paysent('p1', 500000, '2026-05-10', 'credit_amount') ],
  };
  Object.keys(scenarios).forEach(function (name) {
    var b = simulate(scenarios[name]).byCurrency.EGP;
    ok(name + ' → net = -498,354.50', Math.abs(b.netBalance - (-498354.50)) < 0.01);
    ok(name + ' → payment counted (open bills + prepaid net to 498,354.50)', Math.abs((b.ourOpenBills - b.ourPrepaid) - 498354.50) < 0.01);
  });
  // money is never silently dropped
  var r = simulate(scenarios['bill then payment']);
  ok('no money-dropping warnings on clean payment_sent', r.warnings.length === 0);

  console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
  process.exit(fails === 0 ? 0 : 1);
})();
