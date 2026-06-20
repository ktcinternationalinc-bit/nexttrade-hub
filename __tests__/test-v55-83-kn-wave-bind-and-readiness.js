// ============================================================
// v55.83-KN — the screenshots' tangle, fixed at the root:
//  ROOT CAUSE: a silo bound to a placeholder Wave id (REAL_KTC_WAVE_BUSINESS_ID) → every Wave call fails.
//  (1) read-only/read-write badge now reflects the real write state (was hardcoded read-only).
//  (2) Wave categories no longer block PAYMENT push readiness (categorize ≠ pay an invoice).
//  (3) placeholder silo is surfaced loudly + the category pull returns the real reason.
//  (4) NEW /api/wave/bind-business + Wave Connection UI to bind a silo to its real Wave business GUID.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var filter = rd('src/components/WaveBusinessFilter.jsx');
var sync = rd('src/components/WaveSyncCenter.jsx');
var lib = rd('src/lib/wave-business.js');
var cat = rd('src/app/api/wave/sync-categories/route.js');
var bind = rd('src/app/api/wave/bind-business/route.js');
var conn = rd('src/components/WaveConnectionTab.jsx');

ok('1: the business badge reflects the real write state (writes enabled, NOT "push ON"), not hardcoded read-only',
  /var canWrite = canWriteToWaveBusiness\(sel\)/.test(filter) &&
  /Real — writes enabled/.test(filter) && /Real — read-only/.test(filter) && !/read-write \(push ON\)/.test(filter));
ok('2: payment-push readiness no longer includes "Wave categories loaded" or invoice product as a gate',
  !/\['Wave categories loaded', catCount > 0\]/.test(sync) &&
  /Wave categories are <b>not<\/b> needed for payments/.test(sync));
ok('3: shared placeholder-detection helper exists',
  /export function isPlaceholderWaveBusiness\(id\)/.test(lib) &&
  /export var PLACEHOLDER_WAVE_BUSINESS_IDS = \{ 'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1 \}/.test(lib));
ok('4: a placeholder silo is surfaced loudly in Wave Sync Center with the bind instruction',
  /isPlaceholderWaveBusiness\(active\)/.test(sync) &&
  /NOT connected to a real Wave business yet/.test(sync) &&
  /Wave Connection/.test(sync));
ok('5: the category pull returns the REAL reason for a placeholder silo (not the misleading token error)',
  /if \(onlyBiz && PLACEHOLDER_BIDS\[String\(onlyBiz\)\]\)/.test(cat) &&
  /its ID \(' \+ onlyBiz \+ '\) is a placeholder/.test(cat));
ok('6: bind route validates the target is a REAL Wave business the token can read, then re-stamps registry + scoped data',
  /var vQuery = 'query\(\$bid: ID!\)\{ business\(id:\$bid\)\{ id name \} \}'/.test(bind) &&
  /Wave does not recognize that business id/.test(bind) &&
  /var SCOPED_TABLES = \[/.test(bind) &&
  /\.update\(\{ wave_business_id: toId \}\)\.eq\('wave_business_id', fromId\)/.test(bind) &&
  /from\('wave_business_registry'\)\.update\(regPatch\)\.eq\('wave_business_id', fromId\)/.test(bind));
ok('7: bind route supports a dry-run preview (counts before committing) + super-admin gate',
  /var dryRun = body\.dry_run === true;/.test(bind) &&
  /assertPermission\(db, by, 'wave\.settings\.manage', req\)/.test(bind) &&
  /if \(PLACEHOLDER_BIDS\[toId\]\)/.test(bind));
ok('8: Wave Connection shows each business GUID + a bind control wired to dry-run then confirm',
  /Wave id: \{b\.id\}/.test(conn) &&
  /function bindBusiness\(realId, realName\)/.test(conn) &&
  /\/api\/wave\/bind-business/.test(conn) &&
  /dry_run: true/.test(conn));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KN wave-bind + readiness tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
