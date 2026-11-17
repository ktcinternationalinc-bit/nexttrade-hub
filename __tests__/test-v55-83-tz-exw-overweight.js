// v55.83-TZ — Yasmeen, Nov 17 14:43: "trying to create an invoice for Elite, which is originally FOB, but the system will not allow
// me to save". The invoice: EXW, "Stock Release Paper … per Ton" + "Overweight surcharge" $150, no shipping cost typed.
// Max: KTC pays nothing for that surcharge → it must save. Runs the REAL rule.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var ST = require(path.join(root, 'src/lib/shipping-terms.js'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var pass = 0, failN = 0;
function check(l, c, x) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x))); }
console.log('TZ — EXW invoice with only an overweight surcharge saves');
var lines = [{ description: 'Stock Release Paper(Various size and quality sold as is) per Ton', amount: 6274.80 }, { description: 'Overweight surcharge', amount: 150 }];
var r = ST.checkShippingTerms('EXW', '', lines, P.isTransportLine);
check('Yasmeen\'s Elite invoice (EXW + Overweight surcharge $150, no cost typed) → saves, no shipping cost stored', r.ok === true && r.value.shipping_terms === 'EXW' && r.value.shipping_cost_estimate === null, r);
check('the surcharge still counts as shipping charged in the profit report (TD rule unchanged)', P.isTransportLine('Overweight surcharge') === true);
var r2 = ST.checkShippingTerms('EXW', '', lines.concat([{ description: 'Trucking to port', amount: 900 }]), P.isTransportLine);
check('a REAL shipping line on EXW still needs our shipping cost (cost + 7% check kept)', r2.ok === false && /type the shipping cost/.test(r2.error), r2);
var r3 = ST.checkShippingTerms('EXW', '', [{ description: 'Trucking overweight surcharge', amount: 150 }], P.isTransportLine);
check('an overweight charge worded as TRUCKING is a trucking line → still needs the cost', r3.ok === false, r3);
var r4 = ST.checkShippingTerms('EXW', '120', lines, P.isTransportLine);
check('if someone does type a cost for it, the normal cost + 7% check runs ($150 ≥ $128.40 → no warning)', r4.ok === true && r4.value.shipping_cost_estimate === 120 && r4.warnings.length === 0, r4);
var r5 = ST.checkShippingTerms('CNF_INCLUDED', '', lines, P.isTransportLine);
check('CNF still needs the shipping cost (unchanged)', r5.ok === false, r5);
var ui = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
check('when Save is blocked, the reason also shows in red next to the Save button', /setSaveBlock\(shipCheck\.error\)/.test(ui) && /⛔ Not saved: \{saveBlock\}/.test(ui));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
