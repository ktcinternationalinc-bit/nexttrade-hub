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
check('YP (Max, Nov 24: "if it is exw there should be NO shipping cost or 0"): a real shipping line on EXW saves with no shipping cost', r2.ok === true && r2.value.shipping_cost_estimate === null, r2);
var r3 = ST.checkShippingTerms('EXW', '', [{ description: 'Trucking overweight surcharge', amount: 150 }], P.isTransportLine);
check('YP: an overweight charge worded as TRUCKING on EXW also saves with no cost', r3.ok === true && r3.value.shipping_cost_estimate === null, r3);
var r4 = ST.checkShippingTerms('EXW', '120', lines, P.isTransportLine);
check('YP: a cost typed on EXW is dropped (saved as none), no warning', r4.ok === true && r4.value.shipping_cost_estimate === null && r4.warnings.length === 0, r4);
var r5 = ST.checkShippingTerms('CNF_INCLUDED', '', lines, P.isTransportLine);
check('CNF still needs the shipping cost (unchanged)', r5.ok === false, r5);
var ui = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
check('when Save is blocked, the reason also shows in red next to the Save button', /setSaveBlock\(shipCheck\.error\)/.test(ui) && /⛔ Not saved: \{saveBlock\}/.test(ui));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
