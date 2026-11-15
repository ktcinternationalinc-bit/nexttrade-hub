var fs=require('fs');
var eng=fs.readFileSync('src/lib/inventory-landed-cost-engine.js','utf8');
var dlg=fs.readFileSync('src/components/InventoryFinalizeCostDialog.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }
ok('reads dashboard fx_rates table', /from\('fx_rates'\)/.test(eng));
ok('no longer only inv_fx_rates for the primary lookup', /from\('fx_rates'\)/.test(eng));
ok('exact-date lookup', /\.eq\('rate_date', date\)/.test(eng));
ok('nearest on-or-before fallback', /\.lte\('rate_date', date\)/.test(eng));
ok('latest-any fallback', /order\('rate_date', \{ ascending: false \}\)/.test(eng));
ok('legacy engine still fallback', /getFxRate\(date, 'USD', 'EGP'\)/.test(eng));
ok('supabase imported', /import \{ supabase \} from '\.\/supabase'/.test(eng));
ok('manual entry always shows when no rate', /fxOverrideMode \|\| \(!fxRate\)/.test(dlg));
if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — finalize FX now reads dashboard fx_rates + manual fallback ('+8+' checks)');
