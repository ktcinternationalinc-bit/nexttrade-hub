var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function ex(f){try{fs.accessSync(path.join(__dirname,'..',f));return true;}catch(e){return false;}}
var rt=p('src/app/api/wave/payment-account-setup/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(ex('src/app/api/wave/payment-account-setup/route.js'),'payment-account-setup route exists');
ok(/mode === 'list'/.test(rt) && /mode === 'select'/.test(rt),'route supports list + select');
ok(/default_payment_account_id: accId, default_payment_account_name: accName/.test(rt),'saves account id + name');
ok(/That account does not belong to the selected Wave business/.test(rt),'verifies account belongs to business');
ok(/BAD_BIDS\[bid\]/.test(rt),'rejects placeholder business ids');
ok(/payment_capable/.test(rt),'flags bank/cash/credit accounts');
ok(!/\bconst \b/.test(rt) && !/=>/.test(rt),'route SWC-safe');
ok(/runPaymentAccountSetup/.test(wsc),'UI handler present');
ok(/Wave Payment Account/.test(wsc),'payment account settings card present');
ok(/markManualDone/.test(wsc) && /sync_status: 'manual_done'/.test(wsc),'mark-manual-done sets manual_done');
ok(/Mark manual done/.test(wsc),'manual-done button on payment rows');
ok(/Push permissions for:/.test(wsc),'push permissions section intact');
ok(/version: 'v55\.83-FH'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FH');
console.log('\nv55.83-FH payment account setup: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
