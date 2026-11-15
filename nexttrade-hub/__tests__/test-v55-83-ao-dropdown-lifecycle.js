const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const ui=p('src/components/WaveImportTab.jsx');
const sql=p('sql/v55-83-ao-lifecycle-foundation.sql');
// dropdown fix
ok(/function loadBusinesses\(\)/.test(ui)&&/setConn/.test(ui),'business loader stores full status');
ok(/Wave token missing/.test(ui)&&/Wave error/.test(ui)&&/Connected to Wave/.test(ui),'surfaces token-missing / error / connected');
ok(/Recheck/.test(ui),'Recheck button');
ok(!/\.catch\(function \(\) \{\}\)/.test(ui),'no longer swallows errors silently');
ok(/connected && businesses\.length === 0/.test(ui),'handles connected-but-empty case');
ok(!/\$\{/.test(ui),'no template-literal artifacts');
// lifecycle sql
ok(/accounting_invoices  ADD COLUMN IF NOT EXISTS record_status/.test(sql)&&/void_reason/.test(sql),'invoice lifecycle cols');
ok(/accounting_proformas ADD COLUMN IF NOT EXISTS record_status/.test(sql),'proforma lifecycle cols');
ok(/accounting_customers ADD COLUMN IF NOT EXISTS record_status/.test(sql),'customer lifecycle cols');
ok(/archived_at/.test(sql)&&/archived_by/.test(sql),'archive audit cols');
ok(/>v55\.83-AO</.test(p('src/app/page.jsx')),'page AO');
ok(/version: 'v55\.83-AO'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AO');
console.log('\nv55.83-AO dropdown+lifecycle: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
