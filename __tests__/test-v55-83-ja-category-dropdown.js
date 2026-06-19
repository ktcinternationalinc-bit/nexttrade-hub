// ============================================================
// v55.83-JA — Wave categories pulled in Sync Center must actually appear in Bank Review (Codex P0).
// Root cause: Bank Review read wave_categories client-side and silently empty under RLS. Fix: a
// service-role categories route + Bank Review loads from it + a reason-specific empty state.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/categories/route.js');
var br = rd('src/components/BankReviewTab.jsx');

ok('1: categories route is service-role + permission-gated', /SUPABASE_SERVICE_ROLE_KEY/.test(route) && /assertPermission\(db, by, 'bank\.classify', req\)/.test(route));
ok('2: route scopes by wave_business_id + applies usable filters (active, dedupe, hide receivable)',
  /\.eq\('wave_business_id', waveBusinessId\)/.test(route) && /isReceivable\(c\)/.test(route) && /seen\[c\.wave_account_id\]/.test(route));
ok('3: route returns diagnostic counts (total/active/usable/hidden_receivable)',
  /total: total, active_count: active\.length, usable_count: usable\.length, hidden_receivable_count: hiddenReceivable/.test(route));
ok('4: Bank Review loads categories from the service-role route', /fetch\('\/api\/wave\/categories'/.test(br) && /setWaveCategories\(j\.categories \|\| \[\]\)/.test(br));
ok('5: Bank Review records a category diagnostic for the empty-state', /setCatDiag\(\{ total: j\.total, usable: j\.usable_count/.test(br));
ok('6: empty-state is reason-specific (error / all-filtered / truly-missing)',
  /Could not load Wave categories: ' \+ catDiag\.error/.test(br) && /but 0 are usable as bank categories/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JA category-dropdown tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
