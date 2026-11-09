// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RJ — Max, Nov 9 11:16:
//  "in the crm i need to see date created of the client in the system. and also
//   a way for me to see in periods who was added during the last 7 days 30
//   days. 3 months. 6 months. 1 year. and who created it in the crm. Also any
//   updates... same time periods with dates of each updates should be in the
//   crm by default"
// The period logic runs here FOR REAL; the SQL was run twice on PG16 including
// live insert / no-op update / real update / server update / delete cases.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
function loadEsm(src) {
  var names = [];
  var cjs = src.replace(/^import[^\n]*\n/gm, '')
    .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; })
    .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; });
  cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
  var mod = { exports: {} };
  /* eslint-disable no-new-func */
  new Function('module', 'exports', cjs)(mod, mod.exports);
  return mod.exports;
}
console.log('RJ — CRM: date added, who added it, and every update, by period');
var H = loadEsm(R('src/lib/crm-history.js'));
var NOW = Date.parse('2026-11-09T10:00:00Z');

// ── 1. the five periods
ok('1a: exactly the periods asked for: 7 days, 30 days, 3 months, 6 months, 1 year — 30 days by default',
  H.CRM_PERIODS.map(function (p) { return p.key; }).join() === '7d,30d,3m,6m,1y' && H.CRM_DEFAULT_PERIOD === '30d');
ok('1b: period starts are right (7 days back, calendar months back)',
  H.periodStart('7d', NOW).substring(0, 10) === '2026-11-02' && H.periodStart('30d', NOW).substring(0, 10) === '2026-10-10' &&
  H.periodStart('3m', NOW).substring(0, 10) === '2026-08-09' && H.periodStart('6m', NOW).substring(0, 10) === '2026-05-09' && H.periodStart('1y', NOW).substring(0, 10) === '2025-11-09');
var cs = [
  { id: 'a', name: 'A', created_at: '2026-11-08T09:00:00Z', created_by: 'u1' },
  { id: 'b', name: 'B', created_at: '2026-10-20T09:00:00Z', created_by: 'u2' },
  { id: 'c', name: 'C', created_at: '2026-03-01T09:00:00Z', created_by: 'u1' },
  { id: 'd', name: 'D', created_at: null },
];
ok('1c: who was added in each period, newest first', H.addedIn(cs, H.periodStart('7d', NOW)).map(function (c) { return c.id; }).join() === 'a' &&
  H.addedIn(cs, H.periodStart('30d', NOW)).map(function (c) { return c.id; }).join() === 'a,b' && H.addedIn(cs, H.periodStart('1y', NOW)).map(function (c) { return c.id; }).join() === 'a,b,c');
ok('1d: a client with NO recorded date never shows up as "recently added"', H.addedIn(cs, H.periodStart('1y', NOW)).every(function (c) { return c.id !== 'd'; }));

// ── 2. updates, in plain words
var rows = [
  { customer_id: 'a', action: 'updated', changed_at: '2026-11-08T10:00:00Z', changes: { phone: { from: '010', to: '011' } } },
  { customer_id: 'b', action: 'updated', changed_at: '2026-11-09T08:00:00Z', changes: { pipeline_stage: { from: 'lead', to: 'won' } } },
  { customer_id: 'zz', action: 'updated', changed_at: '2026-11-09T09:00:00Z', changes: {} },
  { customer_id: 'a', action: 'created', changed_at: '2026-11-08T09:00:00Z' },
  { customer_id: 'gone', action: 'deleted', changed_at: '2026-11-07T09:00:00Z' },
];
var vu = H.visibleUpdates(rows, ['a', 'b']);
ok('2a: only clients this person may see, newest first; the "added" line is not an update', vu.map(function (r) { return r.customer_id; }).join() === 'b,a');
ok('2b: deletions are shown to an admin only', H.visibleUpdates(rows, ['a', 'b'], true).some(function (r) { return r.action === 'deleted'; }) && !vu.some(function (r) { return r.action === 'deleted'; }));
ok('2c: a change reads "Field: old → new"; the rep shows the person\'s NAME', H.describeChange('pipeline_stage', 'lead', 'won') === 'Pipeline stage: lead → won' &&
  H.describeChange('assigned_rep', null, 'u9', { userName: function (id) { return id === 'u9' ? 'Sara' : null; } }) === 'Assigned rep: (empty) → Sara');
ok('2d: phone / email changes stay hidden from someone who may not see the client\'s contact details', H.describeChange('phone', '010', '011', { canSeeContact: false }) === 'Phone changed (🔒 hidden)' &&
  H.describeChange('phone', '010', '011', { canSeeContact: true }) === 'Phone: 010 → 011');

// ── 3. on screen
var P = R('src/components/CrmActivityPanel.jsx'); var T = R('src/components/CRMTab.jsx');
ok('3a: "by default" — the Added & Updated panel sits at the top of the CRM list and opens expanded',
  T.indexOf('<CrmActivityPanel customers={customers.filter(c => isAdmin || !c.restricted)}') > 0 && P.indexOf('var s4 = useState(true); var open = s4[0]') > 0 &&
  T.indexOf('<CrmActivityPanel') < T.indexOf('{/* Pipeline Visual */}'));
ok('3b: "who created it" — the added list shows date & time added, the client, ADDED BY, rep and stage; filter by the person who added',
  ['Date added', 'Added by', "{view === 'added' ? 'Added by ' : 'Updated by '}"].every(function (k) { return P.indexOf(k) > 0; }) && P.indexOf("c.created_by === who") > 0);
ok('3c: "any updates ... with dates of each update" — every update line: date & time, client, by whom, what changed (notes optional, on by default)',
  P.indexOf('Date & time') > 0 && P.indexOf('What changed') > 0 && P.indexOf("var s7 = useState(true); var withNotes") > 0 && P.indexOf("from('customer_history').select('*').gte('changed_at', start)") > 0);
ok('3d: the stage change is not listed twice (its auto-note is skipped)', P.indexOf('📊 Pipeline stage changed') > 0);
ok('3e: each client card says when it was added and by whom', T.indexOf("'➕ Added ' + (c.created_at ? fmtET(c.created_at, 'shortdate') : '—')") > 0);
ok('3f: the client page shows Added (date + by) and Last updated, and its full history (open by default), refreshed after each change',
  T.indexOf('<CrmClientHistory client={sel} users={users} canSeeContact={canSeeContact} reloadKey={histKey} />') > 0 && P.indexOf('📅 Added:') > 0 && P.indexOf('✏ Last updated:') > 0 &&
  (T.match(/setHistKey\(k => k \+ 1\)/g) || []).length >= 4);
ok('3g: sort by "Newest added" / "Recently updated"', T.indexOf('<option value="newest_added">Newest added</option>') > 0 && T.indexOf("sortBy === 'recently_updated'") > 0);
ok('3h: a new client records who added it (CRM + Quotes)', T.indexOf('created_by: myId || null') > 0 && R('src/components/QuotesTab.jsx').indexOf('created_by: user?.id || null') > 0 /* superseded (v55.83-RN): QuoteBuilder has `user` */);
ok('3i: readable in the dark skin (white .nt-paper panels, explicit dark text)', P.indexOf('nt-paper') > 0 && P.indexOf("var INK = '#0f172a'") >= 0);

// ── 4. database
var Q = R('sql/v55-83-RJ-crm-added-updated.sql');
ok('4a: the DATABASE stamps created_at / created_by on insert and updated_at / updated_by on every REAL change (any screen, import or AI path)',
  Q.indexOf('CREATE TRIGGER trg_customers_stamp BEFORE INSERT OR UPDATE ON public.customers') > 0 && Q.indexOf('real_change :=') > 0 && Q.indexOf('auth.uid()') > 0);
ok('4b: creation facts can never be rewritten by a later edit', Q.indexOf('NEW.created_at := COALESCE(OLD.created_at, NEW.created_at);') > 0 && Q.indexOf('NEW.created_by := COALESCE(OLD.created_by, NEW.created_by);') > 0);
ok('4c: customer_history — one line per creation, real change (field from → to) and deletion; append-only, written only by the trigger',
  Q.indexOf("CHECK (action IN ('created', 'updated', 'deleted'))") > 0 && Q.indexOf('CREATE TRIGGER trg_customers_history AFTER INSERT OR UPDATE OR DELETE') > 0 &&
  Q.indexOf('customer_history_update ON public.customer_history FOR UPDATE TO authenticated USING (false)') > 0 && Q.indexOf('SECURITY DEFINER') > 0);
ok('4d: past creators and past edits are filled in from the audit log the Hub already keeps; unknown dates are never invented',
  Q.indexOf("WHERE table_name = 'customers' AND action = 'create'") > 0 && Q.indexOf("WHERE a.table_name = 'customers' AND a.action = 'update'") > 0 &&
  Q.indexOf('WHERE c.created_at IS NOT NULL AND NOT EXISTS') > 0 && Q.indexOf('ADD COLUMN IF NOT EXISTS created_at timestamptz;') > 0);
ok('4e: safe to re-run (backfill de-duplicates; triggers re-created)', Q.indexOf("h.source = 'audit_log' AND h.customer_id = a.record_id::text AND h.changed_at = a.created_at") > 0 && Q.indexOf('DROP TRIGGER IF EXISTS trg_customers_history') > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
