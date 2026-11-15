var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var br=p('src/components/BankReviewTab.jsx');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/if \(t\.direction === 'out'\) \{ toast\.error\('This is an OUTGOING/.test(br),'applyToInvoice blocks money-out');
ok(/Split lines cannot be linked to a customer invoice on money-out/.test(br),'saveSplits blocks money-out invoice lines');
ok(/_orphan_bank: orphanBank/.test(wsc),'payment rows carry orphan-bank flag');
ok(/orphanBank = p\._orphan_bank === true/.test(wsc),'queue uses explicit orphan flag');
ok(/Bank deposit not found/.test(wsc),'orphaned payment blocked in queue');
ok(/sel\[q\.key\] && !q\.blocked/.test(wsc),'blocked rows still excluded from push');
ok(/version: 'v55\.83-FJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FJ');
console.log('\nv55.83-FJ match guards: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
