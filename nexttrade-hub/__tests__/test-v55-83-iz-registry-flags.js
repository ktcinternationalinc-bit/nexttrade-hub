// ============================================================
// v55.83-IZ — super-admin production unlock + push flags must SAVE through a service-role route
// (Codex P0: client toggle was RLS-filtered and ignored the error → unlock never persisted).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/registry-flags/route.js');
var wsc = rd('src/components/WaveSyncCenter.jsx');

ok('1: service-role route + permission gate', /SUPABASE_SERVICE_ROLE_KEY/.test(route) && /assertPermission\(db, by, 'wave\.settings\.manage', req\)/.test(route));
ok('2: field allowlist (no arbitrary column writes)', /var ALLOWED = \{ production_push_unlocked: 1/.test(route) && /if \(!ALLOWED\[field\]\)/.test(route));
ok('3: production_push_unlocked requires an actual super admin', /if \(field === 'production_push_unlocked'\)/.test(route) && /role === 'super_admin'/.test(route) && /Only a super admin can enable\/disable real production/.test(route));
ok('4: verifies the registry row exists before updating', /No registry row for that Wave business/.test(route));
ok('5: reports a 0-row update instead of pretending success', /Update affected 0 rows — flag not saved/.test(route));
ok('6: returns the read-back value', /value: row\[field\], row: row/.test(route));
ok('7: WaveSyncCenter.setFlag calls the route (not a direct client update)',
  /fetch\('\/api\/wave\/registry-flags'/.test(wsc) && wsc.indexOf("supabase.from('wave_business_registry').update(patch).eq('wave_business_id', active)") === -1);
ok('8: setFlag surfaces a real failure instead of blindly reloading', /Could not save "' \+ field \+ '": '/.test(wsc));

// --- v55.83-JN: the readback CONTRACT that fixes "unlock snaps back OFF after confirm" ---
ok('JN1: route REJECTS a readback mismatch (row[field] !== value → ok:false, not false success)',
  /if \(row\[field\] !== value\) \{/.test(route) && /Registry flag readback mismatch/.test(route));
ok('JN2: route returns diagnostic context (requested/saved/wave_business_id/registry_label) — no non-existent id column',
  /requested: value, saved: row\[field\], wave_business_id: waveBusinessId, registry_label: row\.label/.test(route) &&
  !/select\('id, wave_business_id/.test(route));
ok('JN3: setFlag treats success ONLY when the readback equals the requested value',
  /var readback = j && \(typeof j\.value !== 'undefined' \? j\.value : \(j\.row \? j\.row\[field\] : undefined\)\)/.test(wsc) &&
  /var saved = j && j\.ok === true && readback === val/.test(wsc));
ok('JN4: setFlag MERGES the verified server row into local registry (toggle reflects truth immediately)',
  /setRegistry\(function \(prev\) \{ return \(prev \|\| \[\]\)\.map\(function \(rr\) \{ return \(rr && rr\.wave_business_id === active\) \? Object\.assign\(\{\}, rr, j\.row\)/.test(wsc));
ok('JN5: a PERSISTENT inline status renders by the production-unlock box (not just a transient toast)',
  /flagStatus && flagStatus\.field === 'production_push_unlocked'/.test(wsc) && /setFlagStatus\(/.test(wsc));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IZ registry-flags tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
