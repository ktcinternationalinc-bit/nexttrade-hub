var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var lib=p('src/lib/wave-business.js');
ok(/export function getActiveWaveBusiness/.test(lib)&&/export function setActiveWaveBusiness/.test(lib),'active business get/set');
ok(/export function canWriteToWaveBusiness/.test(lib),'write-lock helper');
ok(/export function scopeToBusiness/.test(lib),'scope helper');
var led=p('src/components/CustomerLedger.jsx');
ok(/from '..\/lib\/wave-business'/.test(led),'ledger imports wave-business');
ok(/fetchAllRows\('wave_business_registry'/.test(led),'ledger loads registry');
ok(/scopeToBusiness\(mine, activeBiz, true\)/.test(led),'ledger scopes invoices to active business');
ok(/REAL KTC production . read-only/.test(led),'production read-only badge');
ok(/Test business . writes allowed/.test(led),'test badge');
var rec=p('src/app/api/wave/reconcile/route.js');
ok(/wave_invoice_id, wave_business_id,/.test(rec),'reconcile selects wave_business_id');
ok(/h\.wave_business_id === businessId \|\| h\.wave_business_id == null/.test(rec),'reconcile scoped to same business (+legacy)');
// BEHAVIORAL: load the lib in a fake window and check the safety rules
global.window = { localStorage: (function(){var m={};return {getItem:function(k){return m[k]||null;},setItem:function(k,v){m[k]=v;}};})() };
var ex={};(function(){var exports={};eval(lib.replace(/'use client';/,'').replace(/export function/g,'exports.X=function').replace(/exports\.X=function (\w+)/g,'exports.$1=function $1'));ex=exports;})();
ok(ex.canWriteToWaveBusiness({is_production:true})===false,'BEHAVIOR: production locked by default');
ok(ex.canWriteToWaveBusiness({is_production:true,writes_enabled:true})===true,'BEHAVIOR: production writable only when explicitly enabled');
ok(ex.canWriteToWaveBusiness({is_production:false})===true,'BEHAVIOR: test business writable');
ok(ex.canWriteToWaveBusiness(null)===false,'BEHAVIOR: no registry => locked');
var rows=[{id:1,wave_business_id:'A'},{id:2,wave_business_id:'B'},{id:3,wave_business_id:null}];
ok(ex.scopeToBusiness(rows,'A',false).map(function(r){return r.id;}).join(',')==='1','BEHAVIOR: scope excludes other business + legacy when includeLegacy=false');
ok(ex.scopeToBusiness(rows,'A',true).map(function(r){return r.id;}).join(',')==='1,3','BEHAVIOR: scope includes legacy null when includeLegacy=true');
ok(ex.scopeToBusiness(rows,'all',true).length===3,'BEHAVIOR: all => no filter');
ok(/version: 'v55\.83-BZ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BZ');
console.log('\nv55.83-BZ wave separation: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
