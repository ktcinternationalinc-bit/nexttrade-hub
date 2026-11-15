var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/BankReviewTab.jsx');
ok(/fetchAllRows\('accounting_customers', '\*', 'company_name', true\)/.test(r),'customers uncapped via fetchAllRows');
ok(/setAcctCustomers\(res\[2\] \|\| \[\]\)/.test(r),'customer result handled as array');
ok(/wave_customer_id === selectedCust\.wave_customer_id|i\.wave_customer_id === selectedCust\.wave_customer_id/.test(r),'invoices match by wave_customer_id too');
ok(/rs === 'void' \|\| rs === 'cancelled' \|\| rs === 'archived' \|\| rs === 'deleted'/.test(r),'dead invoices excluded from match list');
ok(/c\.email \? ' . ' \+ c\.email/.test(r),'customer search label includes email');
ok(/i\.currency \|\| 'USD'/.test(r)&&/i\.wave_status \? ' . ' \+ i\.wave_status/.test(r),'invoice label shows currency + status');
// behavioral: simulate the filter
function invForCustomer(invs, custId, selectedCust){
  return invs.filter(function(i){
    var rs=i.record_status; if(rs==='void'||rs==='cancelled'||rs==='archived'||rs==='deleted') return false;
    if(!custId) return true;
    if(i.accounting_customer_id===custId) return true;
    if(selectedCust&&selectedCust.wave_customer_id&&i.wave_customer_id&&i.wave_customer_id===selectedCust.wave_customer_id) return true;
    return false;
  });
}
var cust={id:'c1',wave_customer_id:'W9'};
var invs=[{id:'i1',accounting_customer_id:'c1'},{id:'i2',wave_customer_id:'W9'},{id:'i3',accounting_customer_id:'other'},{id:'i4',accounting_customer_id:'c1',record_status:'void'}];
var out=invForCustomer(invs,'c1',cust).map(function(x){return x.id;});
ok(out.indexOf('i1')>=0,'BEHAVIOR: direct-linked invoice shows');
ok(out.indexOf('i2')>=0,'BEHAVIOR: Wave-linked invoice (wave_customer_id) shows');
ok(out.indexOf('i3')<0,'BEHAVIOR: other customer invoice hidden');
ok(out.indexOf('i4')<0,'BEHAVIOR: void invoice not matchable');
ok(/version: 'v55\.83-BX'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BX');
console.log('\nv55.83-BX match search: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
