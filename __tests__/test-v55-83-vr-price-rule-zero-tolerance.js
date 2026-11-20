// v55.83-VR — Max, 20 Nov 2026: "allowed diff in price rule is 0%". A price rule with no figure allows NO difference; a new
// rule starts at 0 %. A rule that carries its own figure keeps it. The real price check, run on a made-up bill.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var B = require(path.join(root, 'src/lib/bill-lines.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('VR — price rule: allowed difference is 0 % unless the rule says otherwise');
function run(tol, price) {
  var rule = { id: 1, vendor_match: 'acme', bill_type: '', item_match: 'paper', unit: 'lbs', expected_unit_price: 0.10, expected_amount: null, applies_to: 'cost', active: true };
  if (tol !== undefined) { rule.tolerance_pct = tol; }
  var r = B.priceCheck({ vendor_name: 'Acme', total_amount: 1000 * price, bill_type: 'supplier' }, [{ line_no: 1, description: 'Paper', qty: 1000, unit: 'LBS', unit_price: price, amount: 1000 * price }], [rule], null);
  return r.flags.map(function (f) { return f.code; }).join(',') + '|' + r.checked;
}
check('the exact rule price passes', run(undefined, 0.10) === '|1' && run(0, 0.10) === '|1' && run(null, 0.10) === '|1');
check('a rule with no figure allows no difference: 1 % over is flagged (it used to pass under the old 2 %)', run(undefined, 0.101) === 'PRICE_HIGH|1' && run(null, 0.101) === 'PRICE_HIGH|1');
check('1 % under is flagged too', /PRICE_LOW\|1/.test(run(undefined, 0.099)), run(undefined, 0.099));
check('a rule that says 0 behaves the same', run(0, 0.101) === 'PRICE_HIGH|1');
check('a rule that carries its own figure keeps it: 2 % allows 1 % over, not 3 % over', run(2, 0.101) === '|1' && run(2, 0.103) === 'PRICE_HIGH|1');
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
var panel = fs.readFileSync(path.join(root, 'src/components/PriceRulesPanel.jsx'), 'utf8');
var lib = fs.readFileSync(path.join(root, 'src/lib/bill-lines.js'), 'utf8');
check('saving a rule without a figure stores 0, and a typed figure is kept', route.indexOf("ru.tolerance_pct === '' || ru.tolerance_pct == null ? 0 : Number(ru.tolerance_pct)") > 0 && route.indexOf("ru.tolerance_pct == null ? 2 :") < 0);
check('a new rule on screen starts at 0', panel.indexOf("tolerance_pct: '0', applies_to: 'cost'") > 0 && panel.indexOf("tolerance_pct: '2'") < 0);
check('no 2 % fallback is left in the price check or its wording', lib.indexOf('== null ? 2 :') < 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
if (failN > 0) { process.exit(1); }
