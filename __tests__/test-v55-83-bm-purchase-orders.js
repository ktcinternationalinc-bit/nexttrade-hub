var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var po=p('src/components/PurchaseOrdersTab.jsx');var sql=p('sql/v55-83-bm-purchase-orders.sql');var at=p('src/components/AccountingTab.jsx');
ok(/function startNew/.test(po)&&/function startEdit/.test(po)&&/function save/.test(po),'PO create + edit + save');
ok(/function printPo/.test(po)&&/window\.print/.test(po),'PO print/Save PDF');
ok(/function removePo/.test(po),'PO delete');
ok(/line_total: lineTotal\(l\)/.test(po)&&/grandTotal/.test(po),'PO line items + total');
ok(!/accounting_invoice_payments|payment_matches|wave_invoice_id|wave_sync_status|wave_payment_id|balance_due|amount_paid/.test(po),'PO writes nothing to Wave/AR/payments (only disclaimer mentions Wave)');
ok(/Internal create/.test(po)&&/does not affect Wave, AR/.test(po),'PO labeled internal-only');
ok(/CREATE TABLE IF NOT EXISTS purchase_orders/.test(sql)&&/CREATE TABLE IF NOT EXISTS purchase_order_items/.test(sql),'SQL creates both PO tables');
ok(/ENABLE ROW LEVEL SECURITY/.test(sql)&&(sql.match(/CREATE POLICY/g)||[]).length>=8,'SQL has RLS + 4 policies per table');
ok(/import PurchaseOrdersTab/.test(at)&&/'purchaseorders'/.test(at)&&/<PurchaseOrdersTab/.test(at),'PO wired into AccountingTab');
ok(/version: 'v55\.83-BM'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BM');
console.log('\nv55.83-BM purchase orders: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
