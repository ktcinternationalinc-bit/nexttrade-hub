const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const route=p('src/app/api/wave/audit/route.js');
const ui=p('src/components/WaveConnectionTab.jsx');

ok(/process\.env\.WAVE_ACCESS_TOKEN/.test(route),'audit reads env token');
ok(/gql\.waveapps\.com\/graphql\/public/.test(route),'audit hits Wave GraphQL');
ok(/customers/.test(route)&&/invoices/.test(route)&&/products/.test(route)&&/totalCount/.test(route),'audit queries customers/invoices/products counts');
ok(!/`/.test(route)&&!/\bconst /.test(route)&&!/\blet \b/.test(route),'audit route SWC-safe');
ok(!/return Response\.json\(\{[^}]*token/.test(route),'token never returned');

ok(/\/api\/wave\/audit/.test(ui)&&/Run capability audit/.test(ui),'screen has capability-audit button');
ok(/Customers/.test(ui)&&/Invoices/.test(ui)&&/Products/.test(ui),'per-business counts table');
ok(/read and import/.test(ui)||/historical/.test(ui),'explains importable historical data');

ok(/>v55\.83-AJ</.test(p('src/app/page.jsx')),'page stamped AJ');
ok(/version: 'v55\.83-AJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AJ');
console.log('\nv55.83-AJ wave audit: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
