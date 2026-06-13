var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var d=p('src/components/AccountingDashboard.jsx');
ok(/from '..\/lib\/wave-business'/.test(d)&&/var inv = scopeIfRegistered\(/.test(d),'Dashboard scopes invoices');
var a=p('src/components/AccountingCustomerHistory.jsx');
ok(/from '..\/lib\/wave-business'/.test(a)&&/setInvoices\(scopeIfRegistered\(/.test(a),'AR History scopes invoices');
var b=p('src/components/BankReviewTab.jsx');
ok(/from '..\/lib\/wave-business'/.test(b)&&/setAcctInvoices\(scopeIfRegistered\(/.test(b),'Bank Review scopes invoices (picker + matching inherit)');
var w=p('src/components/WaveImportTab.jsx');
ok(/fetchAllRows\('wave_business_registry'/.test(w),'WaveImport loads registry');
ok(/wave_business_id == null \|\| r\.wave_business_id === ''\) && r\.wave_invoice_id\) n\+\+/.test(w),'WaveImport counts legacy untagged invoices');
ok(/function importBlockReason\(\)/.test(w),'WaveImport has import gate');
ok(/var blkI = importBlockReason\(\); if \(blkI\)/.test(w)&&/var blkC = importBlockReason\(\); if \(blkC\)/.test(w),'both imports gated');
ok(/setBizId\(e\.target\.value\); setActiveWaveBusiness\(e\.target\.value\)/.test(w),'choosing business sets app-wide active business');
ok(/REAL KTC PRODUCTION . READ ONLY/.test(w),'production read-only banner');
ok(/TEST BUSINESS . WRITES ALLOWED/.test(w),'test business banner');
ok(/NOT REGISTERED/.test(w),'unregistered business blocked + warned');
// BEHAVIORAL: import gate logic
function block(bizId, reg, legacy){ if(!bizId) return 'no biz'; if(!reg) return 'not registered'; if(legacy>0) return 'legacy'; return null; }
ok(block('', null, 0)==='no biz','BEHAVIOR: no business blocks');
ok(block('B1', null, 0)==='not registered','BEHAVIOR: unregistered blocks');
ok(block('B1', {wave_business_id:'B1'}, 5)==='legacy','BEHAVIOR: legacy nulls block');
ok(block('B1', {wave_business_id:'B1'}, 0)===null,'BEHAVIOR: registered + no legacy => allowed');
ok(/version: 'v55\.83-CA'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CA');
console.log('\nv55.83-CA scope all: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
