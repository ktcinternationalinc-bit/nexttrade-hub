var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/function waveErrText\(rp\)/.test(r),'waveErrText helper present');
ok(/node\.inputErrors/.test(r),'extracts Wave inputErrors');
ok(/root\.errors/.test(r) || /rp\.errors/.test(r),'extracts GraphQL errors (top-level or nested)');
ok(/setOpenLog\(openLog === l\.id \? null : l\.id\)/.test(r),'per-row expand toggle');
ok(/waveErrText\(l\.response_payload\)/.test(r),'shows Wave error in row');
ok(/JSON\.stringify\(l\.request_payload/.test(r) && /JSON\.stringify\(l\.response_payload/.test(r),'shows full request+response');
ok(/version: 'v55\.83-EM'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EM');
console.log('\nv55.83-EM synclog viewer: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
