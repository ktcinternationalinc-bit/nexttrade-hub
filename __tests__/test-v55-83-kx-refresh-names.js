// ============================================================
// v55.83-KX — Max renamed businesses in Wave; Hub kept the old labels. New "Refresh business names from
// Wave" action: read-only pull of current Wave names, update each bound silo's label to match, report
// every change. Placeholder (unbound) silos are skipped + flagged; super-admin + service-role (the
// registry UPDATE would be RLS-trapped from the browser).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/refresh-names/route.js');
var conn = rd('src/components/WaveConnectionTab.jsx');

ok('1: the route reads CURRENT Wave business names (id -> name) read-only',
  /query \{ businesses \{ edges \{ node \{ id name \} \} \} \}/.test(route) &&
  /nameById\[edges\[ei\]\.node\.id\] = edges\[ei\]\.node\.name/.test(route));
ok('2: it updates a silo label ONLY when the Wave name differs from the stored label',
  /if \(!waveName \|\| waveName === r\.label\) \{ unchanged = unchanged \+ 1; continue; \}/.test(route) &&
  /from\('wave_business_registry'\)\.update\(\{ label: waveName \}\)\.eq\('wave_business_id', r\.wave_business_id\)/.test(route));
ok('3: placeholder (unbound) silos are skipped and reported, not renamed',
  /if \(isPlaceholderWaveBusiness\(r\.wave_business_id\)\) \{ placeholders\.push/.test(route) &&
  /not bound to Wave yet/.test(route));
ok('4: a silo whose id the token can\'t see is reported (not silently skipped)',
  /if \(!Object\.prototype\.hasOwnProperty\.call\(nameById, r\.wave_business_id\)\) \{ notInWave\.push/.test(route) &&
  /not visible to this token/.test(route));
ok('5: super-admin gated + service-role + surfaces real Wave errors',
  /assertPermission\(db, \(body && body\.user_id\) \|\| null, 'wave\.settings\.manage', req\)/.test(route) &&
  /SUPABASE_SERVICE_ROLE_KEY/.test(route) &&
  /Wave rejected the request: '/.test(route) && /Wave API error: '/.test(route));
ok('6: Wave Connection has a "Refresh business names from Wave" button wired to the route + reloads',
  /function refreshNames\(\)/.test(conn) &&
  /\/api\/wave\/refresh-names/.test(conn) &&
  /Refresh business names from Wave/.test(conn) &&
  /reloadRegistry\(\)/.test(conn));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KX refresh-names tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
