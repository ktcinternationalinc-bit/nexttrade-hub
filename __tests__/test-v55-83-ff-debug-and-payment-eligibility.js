var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ai=p('src/components/AccountingInvoicesTab.jsx');var el=p('src/lib/wave-sync-eligibility.js');
var rt=p('src/app/api/wave/push-payment/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// DBG removed
ok(!/DBG raw=/.test(ai),'DBG debug text removed from invoice tab');
// eligibility uses invoice wave id fallback
ok(/invWaveId = \(invoice && invoice\.wave_invoice_id\) \|\| pay\.wave_invoice_id/.test(el),'payment eligibility falls back to invoice wave id');
ok(/eligible: true, reason: 'Ready for payment push/.test(el),'payment now eligible (not unsupported)');
ok(!/Wave public API does not support creating payments/.test(el),'unsupported verdict removed from eligibility');
ok(/invoicePaymentCreateManual/.test(el),'dry-run references invoicePaymentCreateManual');
// push-payment route truthful
ok(!/does not support creating payments/.test(rt),'push-payment stub message removed');
ok(/manual_wave_action_required/.test(rt),'push-payment marks manual_wave_action_required');
ok(/payment_schema_pending/.test(rt),'push-payment logs truthful action');
ok(/sync_error: msg/.test(rt),'push-payment saves sync_error');
// settings label
ok(!/Wave does not support — stays off/.test(wsc),'settings toggle no longer says unsupported');
ok(/schema verification pending/.test(wsc),'settings toggle truthful label (FI relabel)');
ok(/version: 'v55\.83-FF'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FF');
console.log('\nv55.83-FF debug + payment eligibility: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
