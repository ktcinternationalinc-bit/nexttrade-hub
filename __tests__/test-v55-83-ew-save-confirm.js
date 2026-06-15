var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ps=p('src/app/api/wave/product-setup/route.js');var v2=p('src/app/api/wave/push-invoice-v2/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/\.upsert\(row, \{ onConflict: 'wave_business_id' \}\)\.select\(\)/.test(ps),'save uses .select() to detect write result');
ok(/return \{ ok: false, error:/.test(ps) && /return \{ ok: true, row:/.test(ps),'saveDefault returns ok/error');
ok((ps.match(/if \(!saved\w*\.ok\)/g)||[]).length === 3,'all 3 callers check write success');
ok(/db_error: saved/.test(ps),'callers return db_error on failure');
ok(/settings_lookup: \{ row_found: !!cfg/.test(v2),'push reports settings lookup result');
ok(/settings_table_error: cfgErr/.test(v2),'push reports settings table error');
ok(/Database save FAILED/.test(wsc),'UI surfaces db save failure');
ok(/ADD COLUMN IF NOT EXISTS source/.test(wsc),'UI hints the source column fix');
ok(/version: 'v55\.83-EW'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EW');
console.log('\nv55.83-EW save confirm: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
