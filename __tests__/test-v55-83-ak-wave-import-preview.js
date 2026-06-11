const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const route=p('src/app/api/wave/import-preview/route.js');
const ui=p('src/components/WaveImportTab.jsx');
const atab=p('src/components/AccountingTab.jsx');

ok(/process\.env\.WAVE_ACCESS_TOKEN/.test(route),'reads env token');
ok(/businessId/.test(route)&&/type/.test(route)&&/page/.test(route),'accepts businessId/type/page');
ok(/customers\(page:\$page/.test(route)&&/invoices\(page:\$page/.test(route),'paginated customers + invoices queries');
ok(/totalCount/.test(route)&&/totalPages/.test(route),'returns counts + pagination');
ok(!/`/.test(route)&&!/\bconst /.test(route)&&!/\blet \b/.test(route),'route SWC-safe');
ok(!/mutation/.test(route),'READ ONLY — no mutations');

ok(/\/api\/wave\/import-preview/.test(ui)&&/Preview customers/.test(ui)&&/Preview invoices/.test(ui),'preview buttons');
ok(/<select/.test(ui)&&/b\.id/.test(ui),'business picker shows ids (disambiguate duplicate KTC)');
ok(/Prev/.test(ui)&&/Next/.test(ui),'pagination controls');
ok(/nothing is saved|preview only|Nothing is saved/i.test(ui),'clearly states no writes yet');

ok(/'waveimport', '⬇️ Wave Import'/.test(atab)&&/<WaveImportTab /.test(atab),'wired as Accounting sub-tab');
ok(/>v55\.83-AK</.test(p('src/app/page.jsx')),'page stamped AK');
ok(/version: 'v55\.83-AK'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AK');
console.log('\nv55.83-AK wave import preview: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
