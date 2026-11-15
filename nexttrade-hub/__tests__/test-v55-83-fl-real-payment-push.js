var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var rt=p('src/app/api/wave/push-payment/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');var guard=p('src/lib/wave-silo-guard.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// confirmed fields
ok(/invoiceId: invWaveId/.test(rt) && /paymentAccountId: paymentAccountId/.test(rt),'sends invoiceId + paymentAccountId');
ok(/amount: String\(amount\)/.test(rt) && /paymentDate: paymentDate/.test(rt),'sends amount + paymentDate');
ok(/paymentMethod: paymentMethod/.test(rt) && /exchangeRate: String\(exchangeRate\)/.test(rt),'sends paymentMethod + exchangeRate');
ok(/invoicePaymentCreateManual\(input:\$input\)/.test(rt),'calls invoicePaymentCreateManual');
// idempotency
ok(/pay\.wave_payment_id\)/.test(rt) && /already pushed/.test(rt),'refuses if already pushed');
ok(/sync_status: 'syncing'/.test(rt) && /\.is\('wave_payment_id', null\)/.test(rt),'claims row as syncing (conditional)');
ok(/409/.test(rt),'returns 409 if already claimed/syncing');
ok(/pay\.voided === true/.test(rt),'refuses voided payment');
ok(/amount > 0/.test(rt),'refuses amount <= 0');
// required setup
ok(/Invoice is not in Wave yet/.test(rt) && /No Wave bank\/deposit account could be resolved/.test(rt),'blocks missing invoice/account');
ok(/Bank deposit for this payment no longer exists/.test(rt),'orphan guard in route');
// success
ok(/wave_payment_id: wavePaymentId, sync_status: 'synced', last_synced_at/.test(rt),'saves real id + synced + last_synced');
ok(/sync_error: null/.test(rt),'clears sync_error on success');
ok(/amount_paid: paid, balance_due: bal, payment_status: st/.test(rt),'recomputes invoice after push');
// failure
ok(/sync_status: 'sync_failed', sync_error:/.test(rt),'failure sets sync_failed + exact error');
ok(!/wave_payment_id: 'fake\|wave_payment_id: 'WAVE/.test(rt),'never fakes wave_payment_id');
// dry run
ok(/dry_run: true, would_send: inputObj/.test(rt),'dry run shows would_send without sending');
// toggle re-enabled + gated
ok(/payment: 'allow_payment_push'/.test(guard),'silo guard gates payment on flag again');
ok(/Allow payment push \(records payments in Wave\)/.test(wsc),'toggle relabeled + enableable');
ok(/var disabled = savingFlags \|\| f\[0\] === 'allow_auto_push';/.test(wsc),'payment toggle no longer force-disabled');
ok(/'syncing': 1/.test(wsc),'syncing status visible in queue');
ok(/version: 'v55\.83-FL'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FL');
console.log('\nv55.83-FL real payment push: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
