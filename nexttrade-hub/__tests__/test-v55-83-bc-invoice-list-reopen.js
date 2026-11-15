var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var t=p('src/components/AccountingInvoicesTab.jsx');
// reopen -> editable
ok(/var reopened = Object\.assign\(\{\}, row, \{ approval_status: 'internal_review'/.test(t),'reopen builds editable row');
ok(/setViewing\(null\);\n\s*startEdit\(reopened\);/.test(t),'reopen opens editor in editable mode');
ok(/waveTouch.*wave_sync_status = 'pending_sync'/s.test(t),'reopen marks wave invoices pending re-sync');
// search + sort + scroll + columns
ok(/var \[search, setSearch\] = useState\(''\)/.test(t),'search state');
ok(/numv \+ ' ' \+ cn \+ ' ' \+ stat \+ ' ' \+ srcv/.test(t),'search across number+customer+status+source');
ok(/if \(da < db\) return 1; if \(da > db\) return -1/.test(t),'sorted invoice_date descending');
ok(/maxHeight: '58vh', overflowY: 'auto'/.test(t)&&/position: 'sticky', top: 0/.test(t),'scrollable list + sticky header');
ok(/Inv date/.test(t)&&/Due date/.test(t)&&/>Paid</.test(t)&&/>Source</.test(t),'new columns: inv date, due date, paid, source');
ok(/row\.source === 'wave_import' \? 'Wave' : 'Hub'/.test(t),'source Wave/Hub badge');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page version stamp');
ok(/version: 'v55\.83-BC'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BC');
console.log('\nv55.83-BC invoice list + reopen: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
