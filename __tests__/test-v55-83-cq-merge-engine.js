var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var src=p('src/lib/shipment-merge.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var ex={};(function(){eval(src.replace(/'use client';/,'').replace(/export function/g,'function'));ex={productIdentityKey:productIdentityKey,aggregateLines:aggregateLines,mergeWarnings:mergeWarnings,mergeHeaderTotals:mergeHeaderTotals,mergePlan:mergePlan};})();

// QA3/QA1: Stock|Black received in shipment A and B (same product, same UOM) -> one line
var linesAB=[
  { id:'a1', receipt_number:'SHP-A', product_id:'STOCK_BLACK', uom:'kg', roll_count:100, quantity:4000, quantity_kg:4000, status:'finalized' },
  { id:'b1', receipt_number:'SHP-B', product_id:'STOCK_BLACK', uom:'kg', roll_count:157, quantity:6958.62, quantity_kg:6958.62, status:'finalized' }
];
var agg=ex.aggregateLines(linesAB);
ok(agg.length===1,'QA: same product in 2 shipments => 1 line');
ok(agg[0].roll_count===257,'QA: rolls 100+157 = 257');
ok(Math.round(agg[0].quantity_kg*100)===1095862,'QA: kg 4000+6958.62 = 10,958.62');
ok(agg[0].sources.length===2,'QA: source breakdown preserved (2 sources)');
ok(agg[0].sources[0].receipt_number==='SHP-A' && agg[0].sources[1].receipt_number==='SHP-B','QA: source shipment refs kept');

// QA4: same product in 3 shipments
var lines3=linesAB.concat([{ id:'c1', receipt_number:'SHP-C', product_id:'STOCK_BLACK', uom:'kg', roll_count:43, quantity:1000, quantity_kg:1000 }]);
var agg3=ex.aggregateLines(lines3);
ok(agg3.length===1 && agg3[0].roll_count===300 && agg3[0].sources.length===3,'QA: same product in 3 shipments => 1 line, 3 sources, rolls 300');

// QA6: different UOM stays separate + warning
var linesUom=[
  { id:'a', receipt_number:'A', product_id:'X', uom:'kg', quantity:100, roll_count:5 },
  { id:'b', receipt_number:'B', product_id:'X', uom:'meter', quantity:200, roll_count:3 }
];
ok(ex.aggregateLines(linesUom).length===2,'QA: same product, different UOM => stays separate');
var w=ex.mergeWarnings(linesUom);
ok(w.length===1 && w[0].type==='uom_conflict' && w[0].product_id==='X','QA: UOM conflict warning raised');

// QA7: different color/grade = different product_id => separate
var linesColor=[
  { id:'a', product_id:'STOCK_BLACK', uom:'kg', quantity:100 },
  { id:'b', product_id:'STOCK_WHITE', uom:'kg', quantity:50 }
];
ok(ex.aggregateLines(linesColor).length===2,'QA: different color/grade (diff product) => separate lines');

// QA5/QA12: totals sum correctly + NO double counting (conservation)
var plan=ex.mergePlan(lines3, [
  { expected_total_rolls:200, expected_total_gross_kg:11000, expected_total_net_kg:10500 },
  { expected_total_rolls:50, expected_total_gross_kg:1000, expected_total_net_kg:950 }
]);
ok(plan.balanced===true,'QA: no double count — aggregated totals equal source totals');
ok(plan.totals_before.quantity_kg===plan.totals_after.quantity_kg,'QA: kg conserved before==after');
ok(plan.header_totals.expected_total_rolls===250,'QA: combined expected shell rolls 200+50=250');
ok(plan.totals_after.line_count===1 && plan.totals_before.line_count===3,'QA: 3 source lines collapse to 1 aggregated line');

// identity key
ok(ex.productIdentityKey({product_id:'X',uom:'KG'})==='X|kg','identity key normalizes UOM case');
ok(ex.productIdentityKey({id:'l1',uom:'kg'})==='noid:l1|kg','identity key falls back to line id when no product');

console.log('\nv55.83-CQ merge engine: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
