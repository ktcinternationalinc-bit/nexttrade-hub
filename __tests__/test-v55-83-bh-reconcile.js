var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/app/api/wave/reconcile/route.js');var ui=p('src/components/WaveImportTab.jsx');
ok(!/`|\blet \b|\bconst |=>/.test(r),'reconcile route SWC-safe (no let/const/template/arrow)');
ok(/replace\(\/,\/g, ''\)/.test(r),'reconcile uses comma-stripped num()');
ok(/wave_invoice_id/.test(r)&&/hubByWave\[n\.id\]/.test(r),'joins Wave to Hub on wave_invoice_id');
ok(/Math\.abs\(wTotal - hTotal\) < 0\.01/.test(r)&&/Math\.abs\(wDue - hBal\) < 0\.01/.test(r)&&/Math\.abs\(wPaid - hPaid\) < 0\.01/.test(r),'match = total+due+paid within $0.01');
ok(/waveAR_nonDraft/.test(r)&&/status !== 'DRAFT' && n\.status !== 'SAVED'/.test(r),'computes Wave AR excluding draft/unsent');
ok(/byYear/.test(r)&&/statusWave/.test(r)&&/topMismatches/.test(r)&&/missingInHub/.test(r)&&/missingInWave/.test(r),'reports by-year, status, mismatches, missing both ways');
ok(/arDifference: r2\(hubAR - waveAR\)/.test(r),'reports Hub-Wave AR difference');
ok(/return Response\.json\(report\)/.test(r)&&!/\.insert\(|\.update\(|\.delete\(/.test(r),'read-only: returns report, writes nothing');
ok(/function runReconcile/.test(ui)&&/api\/wave\/reconcile/.test(ui),'WaveImportTab calls reconcile route');
ok(/Reconcile Wave vs Hub/.test(ui)&&/downloadReconCsv/.test(ui),'Step 4 button + CSV download present');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page stamp');
ok(/version: 'v55\.83-BH'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BH');
console.log('\nv55.83-BH reconcile: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
