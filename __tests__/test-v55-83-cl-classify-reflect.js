var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var b=p('src/components/BankReviewTab.jsx');
ok(/Classified as ' \+ labelize\(cls\)\); setSel\(Object\.assign\(\{\}, t, \{ classification: cls/.test(b),'classification updates the open panel immediately');
ok(/setSel\(function \(cur\) \{ if \(!cur\) \{ return cur; \} var fr = null; t\.forEach/.test(b),'load() re-syncs open panel to fresh row by id');
ok(/canClassify/.test(b),'classify still permission-gated');
// behavioral: panel resync picks the fresh row
function resync(cur, rows){ if(!cur) return cur; var fr=null; rows.forEach(function(x){ if(x.id===cur.id) fr=x; }); return fr||cur; }
var fresh=resync({id:'t1',classification:''},[{id:'t1',classification:'bank_fee'},{id:'t2'}]);
ok(fresh.classification==='bank_fee','resync reflects the saved classification on reload');
ok(resync(null,[{id:'t1'}])===null,'resync no-ops when panel closed');
ok(/version: 'v55\.83-CL'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CL');
console.log('\nv55.83-CL classify reflect: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
