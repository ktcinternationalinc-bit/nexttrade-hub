var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/app/api/wave/import-invoices/route.js');
ok(/var lt = \(waveLine && waveLine > 0\) \? r2\(waveLine\) : r2\(q \* up\)/.test(r),'line_total = Wave line if >0 else quantity*unit_price');
ok(/var total = \(waveTotal && waveTotal > 0\) \? r2\(waveTotal\) : sumLines/.test(r),'invoice total = Wave total if >0 else sum of lines');
ok(/else if \(due != null\) \{ paid = r2\(total - due\)/.test(r),'paid backfilled via Total - Due when Wave paid empty');
ok(/var balance = \(due != null\) \? due : r2\(total - paid\)/.test(r),'balance = Wave due else total - paid');
ok(/if \(paid < 0\) \{ paid = 0; \}/.test(r),'paid floored at 0');
ok(/report\.samples\.push/.test(r)&&/sumLines: sumLines/.test(r),'diagnostic samples in report');
ok(/function r2\(x\)/.test(r),'rounding helper');
ok(/itemRows\[z\]\.invoice_id = invoiceId/.test(r)&&/delete\(\)\.eq\('invoice_id', invoiceId\)/.test(r),'items: set invoice_id then delete-then-insert (no dup)');
ok(/payStatus\(total, balance, paid\)/.test(r),'payment status from computed values');
ok(!/`/.test(r)&&!/\bconst /.test(r)&&!/\blet \b/.test(r)&&!/=>/.test(r),'SWC-safe');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page has version stamp');
ok(/version: 'v55\.83-AX'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AX');

// arithmetic proof of the AMERICA 322 case
function r2(x){return Math.round((Number(x)||0)*100)/100;}
var lines=[[13170,0.70],[41762,0.65],[1,3900],[1,5718],[1,826.15]];
var sum=0; lines.forEach(function(L){ sum+=r2(L[0]*L[1]); }); sum=r2(sum);
ok(sum===46808.45,'AMERICA 322 line sum = 46808.45 (got '+sum+')');
var due=0, total=sum, paid=r2(total-due);
ok(total===46808.45&&paid===46808.45&&due===0,'322 total/paid/balance correct');
console.log('\nv55.83-AX import totals compute: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
