var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var br=p('src/components/BankReviewTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/if \(!inv\) \{ return Promise\.resolve\(\); \}/.test(br),'recompute no-ops when invoice unknown (no corruption)');
ok(/from\('accounting_invoices'\)\.select\('\*'\)\.eq\('id', invId\)/.test(br),'recompute fetches invoice from DB if not in memory');
ok(/if \(balanceDue < 0\) \{ balanceDue = 0; \}/.test(br),'balance_due clamped to >= 0');
ok(/matched_invoice_id: inv\.id/.test(br),'match sets matched_invoice_id (Plaid view consistency)');
ok(/matched_invoice_id: null/.test(br),'unmatch clears matched_invoice_id');
ok(/wave_imported_paid/.test(br) && /isPaymentVoid\(p\)/.test(br),'still uses wave_imported + non-void (isPaymentVoid) hub sum (no double count)');
ok(/version: 'v55\.83-FB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FB');
console.log('\nv55.83-FB match reliability: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
