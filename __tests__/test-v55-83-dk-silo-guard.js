var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var src=p('src/lib/wave-silo-guard.js').replace(/export \{[\s\S]*?\};\s*$/,'').replace(/^import[^\n]*\n/gm,'');
var m={exports:{}};(new Function('module','exports',src+'\nmodule.exports={assertSiloSelected,assertRecordInSilo,assertMatchSameSilo,assertCanPush,assertCategoryNotErasing,buildSyncLogRow,UNLOCK_PHRASE};'))(m,m.exports);
var G=m.exports;var br=p('src/components/BankReviewTab.jsx');
var pass=0,fail=0;function ok(c,msg){if(c)pass++;else{fail++;console.log('  ✗ '+msg);}}
var reg=[
  {wave_business_id:'A',label:'KANDIL EGYPT (Test)',is_production:false,writes_enabled:true,allow_payment_push:true,allow_invoice_push:false},
  {wave_business_id:'B',label:'Real KTC',is_production:true,writes_enabled:false,allow_payment_push:false}
];
ok(G.assertSiloSelected('').code==='no_silo','no silo blocked');
ok(G.assertRecordInSilo({wave_business_id:'B'},'A').code==='cross_silo','cross-silo record blocked');
ok(G.assertRecordInSilo({wave_business_id:null},'A').code==='record_unassigned','unassigned record blocked');
var mr=G.assertMatchSameSilo({activeBusinessId:'A',bankTxn:{wave_business_id:'A'},invoice:{wave_business_id:'B'},labelFor:function(id){return id==='A'?'KANDIL EGYPT (Test)':'Real KTC';}});
ok(mr.code==='cross_silo'&&/Real KTC/.test(mr.message)&&/KANDIL EGYPT/.test(mr.message),'match cross-silo uses both labels');
ok(G.assertCanPush({waveBusinessId:'X',registry:reg,record:{wave_business_id:'X'},action:'payment'}).code==='not_registered','unregistered blocked');
ok(G.assertCanPush({waveBusinessId:'A',registry:reg,record:{wave_business_id:'B'},action:'payment'}).code==='cross_silo','push other-silo record blocked');
ok(G.assertCanPush({waveBusinessId:'A',registry:reg,record:{wave_business_id:'A'},action:'invoice'}).code==='push_type_disabled','disabled push-type blocked');
ok(G.assertCanPush({waveBusinessId:'A',registry:reg,record:{wave_business_id:'A'},action:'payment'}).ok===true,'test payment push allowed');
ok(G.assertCanPush({waveBusinessId:'A',registry:reg,record:{wave_business_id:'A',wave_invoice_id:'w1'},action:'invoice'}).code==='already_in_wave','no recreate existing Wave invoice');
ok(G.assertCanPush({waveBusinessId:'B',registry:reg,record:{wave_business_id:'B'},action:'payment'}).code==='writes_disabled','production writes-off blocked');
var reg2=[{wave_business_id:'B',label:'Real KTC',is_production:true,writes_enabled:true,allow_payment_push:true}];
ok(G.assertCanPush({waveBusinessId:'B',registry:reg2,record:{wave_business_id:'B'},action:'payment'}).code==='production_locked','production needs typed unlock');
ok(G.assertCanPush({waveBusinessId:'B',registry:reg2,record:{wave_business_id:'B'},action:'payment',unlockPhrase:'PUSH TO REAL KTC WAVE'}).ok===true,'production push ok with phrase');
ok(G.assertCategoryNotErasing({hubCategory:'',waveCategory:'Sales'}).code==='would_erase_category','blank hub cannot erase wave category');
ok(G.assertCategoryNotErasing({hubCategory:'',waveCategory:'Sales',adminOverride:true}).ok===true,'admin override ok');
ok(G.buildSyncLogRow({waveBusinessId:'A',result:{ok:false,code:'cross_silo'}}).outcome==='blocked','sync log logs blocked outcome');
ok(G.UNLOCK_PHRASE==='PUSH TO REAL KTC WAVE','unlock phrase exact');
// wired into match drawer
ok(/assertMatchSameSilo\(\{ activeBusinessId: activeBiz, bankTxn: t, invoice: inv/.test(br),'match drawer routes through shared guard');
ok(/import \{ assertMatchSameSilo \} from '\.\.\/lib\/wave-silo-guard'/.test(br),'guard imported in BankReviewTab');
ok(/version: 'v55\.83-DK'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DK');
console.log('\nv55.83-DK silo guard: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
