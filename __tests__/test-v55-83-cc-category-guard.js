var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var src=p('src/lib/wave-category-guard.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// load the pure module
var ex={};(function(){eval(src.replace(/'use client';/,'').replace(/export function/g,'function'));ex={findMapping:findMapping,buildWaveCategoryPayload:buildWaveCategoryPayload,categoryConflict:categoryConflict,defaultConflictResolution:defaultConflictResolution,canPushCategory:canPushCategory,waveCategoryLabel:waveCategoryLabel,categorySyncLogEntry:categorySyncLogEntry};})();
var maps=[{hub_category:'Bank Fee',wave_account_id:'acct_fee',wave_account_name:'Bank Fees',is_active:true},{hub_category:'Office',wave_account_id:'acct_office',is_active:true}];
// QA1: blank Hub -> skip, never touches Wave
var r1=ex.buildWaveCategoryPayload('', maps); ok(r1.skip===true && r1.reason==='hub_blank','QA1: blank Hub category => skip (Wave untouched)');
var r1b=ex.buildWaveCategoryPayload(null, maps); ok(r1b.skip===true,'QA1: null Hub category => skip');
// never emits null fields
ok(!r1.fields,'blank payload has NO fields object (never sends accountId:null)');
// QA4: unmapped -> blocked
var r4=ex.buildWaveCategoryPayload('Mystery', maps); ok(r4.skip===true && r4.reason==='hub_unmapped','QA4: unmapped Hub category => push blocked');
// valid mapping -> only accountId, nothing null
var r3=ex.buildWaveCategoryPayload('Bank Fee', maps); ok(r3.skip===false && r3.fields.accountId==='acct_fee','QA3: mapped category => payload with accountId');
ok(Object.keys(r3.fields).join(',')==='accountId','payload contains ONLY accountId (no null category)');
// QA2: conflict
ok(ex.categoryConflict('acct_other','Bank Fee',maps)==='conflict','QA2: Wave has cat + Hub different => conflict');
ok(ex.categoryConflict('acct_fee','Bank Fee',maps)==='match','match when same');
ok(ex.categoryConflict('acct_other','',maps)==='hub_missing','Wave has cat + Hub blank => hub_missing (keep Wave)');
ok(ex.categoryConflict('','Bank Fee',maps)==='wave_missing','Hub knows + Wave blank => wave_missing');
ok(ex.defaultConflictResolution()==='keep_wave','default resolution = keep Wave');
// QA8: production push blocked unless writes_enabled
ok(ex.canPushCategory({is_production:true,writes_enabled:false},'Bank Fee',maps,{allowProductionPush:true}).ok===false,'QA8: production read-only blocks category push');
ok(ex.canPushCategory({is_production:true,writes_enabled:true},'Bank Fee',maps,{allowProductionPush:false}).reason==='production_push_flag_off','production needs push flag too');
ok(ex.canPushCategory({is_production:true,writes_enabled:true},'Bank Fee',maps,{allowProductionPush:true}).ok===true,'production push allowed when fully enabled');
ok(ex.canPushCategory({is_production:false},'Bank Fee',maps,{}).ok===true,'test business push allowed');
ok(ex.canPushCategory({is_production:false},'',maps,{}).ok===false,'blank category never pushed even on test');
// QA5: wave_locked needs override
ok(ex.canPushCategory({is_production:false},'Bank Fee',maps,{waveLocked:true}).reason==='wave_locked','QA5: locked historical needs override');
ok(ex.canPushCategory({is_production:false},'Bank Fee',maps,{waveLocked:true,override:true}).ok===true,'override unlocks');
// QA7: label never invents Uncategorized
ok(ex.waveCategoryLabel({})==='Not imported from Wave','QA7: unknown shows Not imported, NOT Uncategorized');
ok(ex.waveCategoryLabel({category_source:'wave',wave_category_is_uncategorized:true})==='Uncategorized (in Wave)','Uncategorized only when Wave says so');
// QA9: sync log entry
var log=ex.categorySyncLogEntry({hubRecordId:'h1',action:'skip',hubCategory:''});
ok(log.entity_type==='bank_transaction_category' && log.action==='skip' && !!log.attempted_at,'QA9: sync log entry shape');
ok(/version: 'v55\.83-CC'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CC');
console.log('\nv55.83-CC category guard: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
