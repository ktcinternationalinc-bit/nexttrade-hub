const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const route=p('src/app/api/wave/check/route.js');
const ui=p('src/components/WaveConnectionTab.jsx');
const atab=p('src/components/AccountingTab.jsx');

ok(/process\.env\.WAVE_ACCESS_TOKEN/.test(route),'route reads token from env (not code)');
ok(/gql\.waveapps\.com\/graphql\/public/.test(route),'calls Wave GraphQL endpoint');
ok(/isClassicInvoicing/.test(route)&&/businesses/.test(route),'reads businesses + isClassicInvoicing');
ok(/'Bearer ' \+ token/.test(route),'Bearer auth header');
ok(!/`/.test(route)&&!/\bconst /.test(route)&&!/\blet \b/.test(route),'route is SWC-safe');
ok(!/return Response\.json\(\{[^}]*token/.test(route),'token never returned to client');

ok(/\/api\/wave\/check/.test(ui)&&/Test Wave connection/.test(ui),'screen calls the check route');
ok(/isClassicInvoicing/.test(ui)&&/New invoicing/.test(ui)&&/Classic invoicing/.test(ui),'shows new vs classic invoicing compatibility');
ok(/isSuperAdmin/.test(ui)&&/Owner only/.test(ui),'owner-only gate');
ok(/wave_sync_status|sync framework|Sync framework/i.test(ui),'sync framework status shown');

ok(/'wave', '🌊 Wave Connection'/.test(atab)&&/<WaveConnectionTab /.test(atab),'wave connection is an Accounting sub-tab');
ok(/>v55\.83-AI</.test(p('src/app/page.jsx')),'page stamped AI');
ok(/version: 'v55\.83-AI'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AI');
console.log('\nv55.83-AI wave connection: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
