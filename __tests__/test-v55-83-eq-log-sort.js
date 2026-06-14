var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var wsc=p('src/components/WaveSyncCenter.jsx');var v2=p('src/app/api/wave/push-invoice-v2/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/order\('attempted_at', \{ ascending: false \}\)\.order\('id', \{ ascending: false \}\)/.test(wsc),'Sync Log sorts by attempted_at then id');
ok(!/from\('wave_sync_log'\)\.select\('\*'\)\.order\('id', \{ ascending: false \}\)\.limit/.test(wsc),'old id-only sort removed');
ok(/stage: 'product_create'/.test(v2) && /stage: 'account_lookup'/.test(v2),'product failures tagged with stage');
ok(/wave: pcData/.test(v2) && /wave: acData/.test(v2),'raw Wave response nested under .wave');
ok(/if \(rp\.wave\) \{ roots\.push\(rp\.wave\); \}/.test(wsc),'waveErrText digs into nested wave payload');
ok(/parts\.unshift\('\(stage: ' \+ rp\.stage/.test(wsc),'waveErrText shows stage');
ok(/version: 'v55\.83-EQ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EQ');
console.log('\nv55.83-EQ log sort + product err: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
