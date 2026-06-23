// ============================================================
// v55.83-MC — proof + honesty (Codex). The committed introspection script must exist; the evidence doc must
// state the create-only reality; and no code/UI may claim the app can read/update existing Wave money
// transactions via API (it cannot — proven). Also: the per-account ownership migration + setter must exist.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function exists(p) { try { fs.accessSync(path.join(__dirname, '..', p)); return true; } catch (e) { return false; } }

ok('1: the committed live-introspection proof script exists',
  exists('scripts/introspect-wave-read-update.mjs') &&
  /__schema\{ types/.test(rd('scripts/introspect-wave-read-update.mjs')) &&
  /ROOT MUTATION fields/.test(rd('scripts/introspect-wave-read-update.mjs')));
var ev = rd('WAVE_API_TRANSACTION_EVIDENCE.md');
ok('2: the evidence doc states the create-only reality (no read, no update for money txns)',
  /create[- ]only/i.test(ev) &&
  /moneyTransactionUpdate\/Patch/i.test(ev) &&
  /no.*read|cannot read|unreadable/i.test(ev));
ok('3: the design contract exists and frames the two lanes + per-account single-writer',
  exists('WAVE_MIRROR_ARCHITECTURE.md') &&
  /single-writer/i.test(rd('WAVE_MIRROR_ARCHITECTURE.md')) &&
  /CREATE-ONLY|create-only/i.test(rd('WAVE_MIRROR_ARCHITECTURE.md')));
ok('4: the ownership migration + setter route exist',
  exists('sql/v55-83-MC-wave-feed-owner.sql') &&
  /wave_feed_owner/.test(rd('sql/v55-83-MC-wave-feed-owner.sql')) &&
  exists('src/app/api/wave/account-feed-owner/route.js'));
// honesty: the UI must NOT claim it finds/updates an existing Wave transaction's category via API.
var sync = rd('src/components/WaveSyncCenter.jsx');
ok('5: no UI copy claims the app updates/categorizes an EXISTING Wave transaction via API',
  !/update the existing Wave transaction's category/i.test(sync) &&
  !/find it in Wave and categorize/i.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MC read-update-proof tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
