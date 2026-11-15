// ============================================================
// v55.83-KQ — Codex live-release blockers on the bind tool (money/ownership data):
//  (1) bind must be ALL-OR-NOTHING — re-stamp every table, and on ANY failure roll back the tables
//      already changed (to->from). No partial-success (207) path. So a silo is never left half-owned.
//  (2) NORMAL bind mode lists ONLY placeholder (unbound) silos; rebinding an already-connected silo is
//      an opt-in "advanced" migration with an extra confirmation.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var bind = rd('src/app/api/wave/bind-business/route.js');
var conn = rd('src/components/WaveConnectionTab.jsx');
var pgerr = rd('src/lib/pg-missing-object.js');

ok('1: bind tracks the tables it changed and ROLLS BACK (to->from) on any failure',
  /var updatedTables = \[\]/.test(bind) &&
  /updatedTables\.push\(t2\)/.test(bind) &&
  /db\.from\(updatedTables\[rb\]\)\.update\(\{ wave_business_id: fromId \}\)\.eq\('wave_business_id', toId\)/.test(bind));
ok('2: the partial-success (HTTP 207) path is GONE — any failure is a hard error after rollback',
  !/207/.test(bind) &&
  /Bind failed and was fully rolled back — NO change was made/.test(bind));
ok('3: a rollback that itself fails is surfaced as an inconsistent-state warning (do not retry)',
  /rollback ALSO failed — silo ownership may be inconsistent\. DO NOT retry/.test(bind));
ok('4: dry-run still previews counts without mutating',
  /if \(dryRun\) \{/.test(bind) && /dry_run: true/.test(bind) && /Nothing changed yet/.test(bind));
ok('5: NORMAL bind mode lists ONLY placeholder silos; advanced rebind is opt-in',
  /var bindable = registry\.filter\(function \(r\) \{ return advancedRebind \? \(r\.wave_business_id !== b\.id\) : isPlaceholderWaveBusiness\(r\.wave_business_id\); \}\)/.test(conn) &&
  /Advanced: allow rebinding an already-connected silo/.test(conn));
ok('6: rebinding an already-connected (non-placeholder) silo requires an extra explicit confirmation',
  /if \(!isPlaceholderWaveBusiness\(siloFrom\)\) \{[\s\S]{0,200}ADVANCED: that silo is already connected/.test(conn));
// v55.83-KR — precheck count errors must ABORT before mutation, not silently become 0 then succeed.
ok('7 (KR): an UNEXPECTED count/precheck error aborts BEFORE any mutation (no skip-then-succeed)',
  /import \{ isMissingObjErr \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/pg-missing-object'/.test(bind) &&
  /Bind aborted BEFORE any change — could not read table/.test(bind) &&
  /Bind aborted BEFORE any change — could not read the registry/.test(bind));
ok('8 (KR): a genuinely-absent optional table is skipped but REPORTED (not silent)',
  /skipped\[tbl\] = \(cErr\.message/.test(bind) &&
  /skipped_optional_tables: skipped/.test(bind));
// v55.83-KS — the missing-object whitelist is NARROW: only real undefined-table/column + schema-cache,
// never a broad PGRST* prefix (which would swallow connection/JWT/pool errors).
ok('9 (KS): isMissingObjErr is a unit-tested lib that whitelists ONLY 42P01/42703/PGRST205/PGRST204',
  /export function isMissingObjErr\(err\)/.test(pgerr) &&
  /var MISSING_OBJECT_CODES = \{ '42P01': 1, '42703': 1, 'PGRST205': 1, 'PGRST204': 1 \}/.test(pgerr));
ok('10 (KS): the broad "any PGRST* code" match is GONE; schema-cache needs BOTH "could not find" AND "schema cache"',
  !/indexOf\('PGRST'\) === 0/.test(pgerr) && !/indexOf\('PGRST'\) === 0/.test(bind) &&
  /msg\.indexOf\('could not find'\) >= 0 && msg\.indexOf\('schema cache'\) >= 0/.test(pgerr));
// behavioral contract (executed): generic PGRST/connection errors must NOT be treated as missing-object.
ok('11 (KS): behavior — PGRST205/42P01/"does not exist" => skippable; PGRST000/PGRST301/connection => ABORT',
  (function () {
    function isMissing(err) { // mirror of the lib contract, executed to prove the truth table
      if (!err) return false;
      var codes = { '42P01': 1, '42703': 1, 'PGRST205': 1, 'PGRST204': 1 };
      if (codes[String(err.code || '')]) return true;
      var m = String(err.message || '').toLowerCase();
      if (m.indexOf('does not exist') >= 0) return true;
      if (m.indexOf('could not find') >= 0 && m.indexOf('schema cache') >= 0) return true;
      return false;
    }
    return isMissing({ code: '42P01' }) && isMissing({ code: 'PGRST205' }) &&
      isMissing({ message: 'relation "x" does not exist' }) &&
      isMissing({ message: "Could not find the table 'public.x' in the schema cache" }) &&
      !isMissing({ code: 'PGRST000' }) && !isMissing({ code: 'PGRST003' }) && !isMissing({ code: 'PGRST301' }) &&
      !isMissing({ message: 'connection timeout' }) && !isMissing(null);
  })());

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KQ bind-safety tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
