var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var src=p('src/lib/wave-business.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
global.window={localStorage:{getItem:function(){return null;},setItem:function(){}}};
var ex={};(function(){eval(src.replace(/'use client';/,'').replace(/export function/g,'function'));ex={scopeToBusiness:scopeToBusiness,scopeIfRegistered:scopeIfRegistered};})();
var rows=[{id:1,wave_business_id:'A'},{id:2,wave_business_id:'B'},{id:3,wave_business_id:null}];
var reg=[{wave_business_id:'A',is_production:true},{wave_business_id:'B',is_production:false}];  // A=real, B=test
// THE FIX: unregistered active business -> show all (no zeros)
ok(ex.scopeIfRegistered(rows,'UNREG',reg,true).length===3,'unregistered business => show ALL (no zeros)');
ok(ex.scopeIfRegistered(rows,'',reg,true).length===3,'no active business => show all');
ok(ex.scopeIfRegistered(rows,'A',[],true).length===3,'empty registry => show all (wall not configured)');
// registered business -> strict scope
ok(ex.scopeIfRegistered(rows,'A',reg,true).map(function(r){return r.id;}).join(',')==='1,3','registered PRODUCTION A => A + legacy null (untagged belongs to real)');
ok(ex.scopeIfRegistered(rows,'B',reg,false).map(function(r){return r.id;}).join(',')==='2','registered TEST B => ONLY B (untagged real-KTC NEVER bleeds into test)');
// usage in all views
['AccountingDashboard','AccountingCustomerHistory','BankReviewTab','BankTab','CustomerLedger'].forEach(function(c){
  ok(/scopeIfRegistered\(/.test(p('src/components/'+c+'.jsx')),c+' uses scopeIfRegistered');
});
ok(/wave_business_registry/.test(p('src/components/AccountingDashboard.jsx')),'Dashboard loads registry');
ok(/version: 'v55\.83-CE'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CE');
console.log('\nv55.83-CE failsafe scope: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
