var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var cl=p('src/components/CustomerLedger.jsx');
ok(/function safe\(p\) \{ return p\.then\(function \(r\) \{ return r && r\.data \? r\.data : \[\]; \}\)/.test(cl),'CustomerLedger safe() unwraps .data');
var w=p('src/components/WaveImportTab.jsx');
ok(/setRegistry\(\(rows && rows\.data\) \|\| \[\]\)/.test(w),'WaveImport registry unwraps .data');
ok(/var arr = \(rows && rows\.data\) \|\| \[\]; var n = 0; arr\.forEach/.test(w),'WaveImport legacy-null unwraps before forEach');
var b=p('src/components/BankTab.jsx');
ok(/setBizRegistry\(\(r && r\.data\) \|\| \[\]\)/.test(b),'BankTab registry unwraps .data');
// guard: none of the three still call setRegistry/forEach on a raw {data}
ok(!/setRegistry\(rows \|\| \[\]\)/.test(w),'no raw setRegistry(rows||[]) left');
ok(!/setBizRegistry\(r \|\| \[\]\)/.test(b),'no raw setBizRegistry(r||[]) left');
ok(/version: 'v55\.83-CD'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CD');
console.log('\nv55.83-CD unwrap hotfix: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
