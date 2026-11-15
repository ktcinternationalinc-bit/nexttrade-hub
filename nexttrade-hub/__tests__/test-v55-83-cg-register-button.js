var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var w=p('src/components/WaveImportTab.jsx');
ok(/import \{ supabase \} from '..\/lib\/supabase'/.test(w),'imports supabase client');
ok(/function registerBusiness\(isProd\)/.test(w),'registerBusiness defined');
ok(/Register as REAL \(read-only\)/.test(w) && /Register as TEST \(writes allowed\)/.test(w),'both register buttons present');
ok(/registerBusiness\(true\)/.test(w) && /registerBusiness\(false\)/.test(w),'buttons call registerBusiness with prod/test');
// REAL => read-only (writes_enabled false), TEST => writes_enabled true
ok(/is_production: isProd, writes_enabled: isProd \? false : true/.test(w),'REAL=read-only, TEST=writes enabled');
ok(/onConflict: 'wave_business_id'/.test(w),'upsert dedupes by wave_business_id (no duplicate registry rows)');
ok(/window\.confirm\(warn\)/.test(w),'confirm before registering');
ok(/NEVER for real accounting data/.test(w),'TEST warning protects real data');
ok(/isSuperAdmin \?/.test(w) && /Ask a super-admin to register/.test(w),'super-admin gated; others told to ask');
ok(/function loadRegistry\(\)/.test(w) && /loadRegistry\(\);/.test(w),'registry reloads after register (banner flips live)');
ok(/version: 'v55\.83-CG'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CG');
console.log('\nv55.83-CG register button: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
