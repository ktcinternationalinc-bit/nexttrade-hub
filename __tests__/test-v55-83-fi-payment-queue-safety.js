var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var wsc=p('src/components/WaveSyncCenter.jsx');var guard=p('src/lib/wave-silo-guard.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// Bug1: no vanishing
ok(/ACTIONABLE = \{ 'pending_wave_sync': 1, 'manual_wave_action_required': 1, 'payment_schema_pending': 1, 'sync_failed': 1, 'failed': 1 \}/.test(wsc),'queue shows all actionable statuses');
ok(!/if \(p\.sync_status !== 'pending_wave_sync'\) \{ return; \}/.test(wsc),'old pending-only filter removed');
// Bug2: no dead-end toggle
ok(/if \(action !== 'payment'\)/.test(guard),'payment not gated by allow_payment_push flag');
ok(!/payment: 'allow_payment_push'/.test(guard),'allow_payment_push removed from flag map');
ok(/schema verification pending \(not a blocker\)/.test(wsc),'toggle relabeled truthfully');
// Bug3: duplicate/split safety
ok(/byBankTxn\[p\.bank_transaction_id\]/.test(wsc),'groups payments by bank_transaction_id');
ok(/over-allocated/.test(wsc),'blocks over-allocated bank deposit');
ok(/Split: same bank deposit on/.test(wsc),'labels legitimate split');
ok(/fetchAllRows\('bank_transactions', 'id, amount_abs, name'\)/.test(wsc),'loads bank amount for comparison');
ok(/_bank_amount/.test(wsc),'attaches bank amount to payments');
ok(/bank txn ' \+ String\(p\.bank_transaction_id\)/.test(wsc),'shows bank txn identity in row');
ok(/sel\[q\.key\] && !q\.blocked/.test(wsc),'blocked rows excluded from selection (cannot push)');
ok(/version: 'v55\.83-FI'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FI');
console.log('\nv55.83-FI payment queue safety: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
