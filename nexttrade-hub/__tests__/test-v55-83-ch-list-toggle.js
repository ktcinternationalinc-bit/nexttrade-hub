var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// behavioral: legacy belongs to production, never test
var src=p('src/lib/wave-business.js');
var ex={};(function(){eval(src.replace(/'use client';/,'').replace(/export function/g,'function'));ex={scopeIfRegistered:scopeIfRegistered};})();
var rows=[{id:1,wave_business_id:'REAL'},{id:2,wave_business_id:'TEST'},{id:3,wave_business_id:null}];
var reg=[{wave_business_id:'REAL',is_production:true},{wave_business_id:'TEST',is_production:false}];
ok(ex.scopeIfRegistered(rows,'TEST',reg).map(function(r){return r.id;}).join(',')==='2','pick TEST => only test record (no KTC bleed-through)');
ok(ex.scopeIfRegistered(rows,'REAL',reg).map(function(r){return r.id;}).join(',')==='1,3','pick REAL => real + untagged historical');
ok(ex.scopeIfRegistered(rows,'',reg).length===3,'All => everything');
ok(ex.scopeIfRegistered(rows,'UNREG',reg).length===3,'unregistered => show all (failsafe)');
// shared component
var wf=p('src/components/WaveBusinessFilter.jsx');
ok(/wave_business_registry/.test(wf) && /setActiveWaveBusiness/.test(wf),'filter loads registry + sets active business');
ok(/registry\.length === 0/.test(wf) && /return null/.test(wf),'no registry => renders nothing (lists show all)');
ok(/All businesses/.test(wf),'has All option');
// wired into both tabs
var inv=p('src/components/AccountingInvoicesTab.jsx');
ok(/scopeIfRegistered\(\(isInvoice\(\) \? invoices : proformas\)/.test(inv),'Invoices tab: list scoped to active business');
ok(/getActiveWaveBusiness\(\)/.test(inv),'Invoices tab reads the global active business (selector now in header)');
var cus=p('src/components/AccountingCustomersTab.jsx');
ok(/scopeIfRegistered\(rows, waveBiz, waveReg/.test(cus),'Customers tab: list scoped to active business');
ok(/getActiveWaveBusiness\(\)/.test(cus),'Customers tab reads the global active business (selector now in header)');
ok(/version: 'v55\.83-CH'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CH');
console.log('\nv55.83-CH list toggle: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
