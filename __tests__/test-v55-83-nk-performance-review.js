// v55.83-NK — Performance Review Center.
//
// Max (Aug 28 2026): "have the AI HR rep really have access to logs for
// previous year.. look at tickets and how they approach tickets, do they
// update them on time, stay on them consistently, closed before deadlines..
// full look at when they logged in and how long they lasted in the system and
// if they log in consistently at around 6 days a week. a professional review
// performance report I as a manager can create and then input my own data on
// this. make it really encompassing."
//
// THE THREE-LAYER RULE THIS FILE PROTECTS
// Measured data, Jenna's AI draft, and the manager's own input are three
// separate layers, separately stored and separately labelled. A review where
// the AI's words silently merge into the manager's — or where "measurements"
// are actually guesses — is worthless in a dispute. Every honesty rule below
// exists so this report can be put in front of the employee it describes.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var route = read('src/app/api/hr/performance-review/route.js');
var ui    = read('src/components/PerformanceReviewCenter.jsx');
var adm   = read('src/components/AdminTab.jsx');
var sql   = read('sql/v55-83-NK-performance-reviews.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Measurement honesty (the numbers must survive scrutiny)
// ══════════════════════════════════════════════════════════════════

ok('A1: sessions are capped at 16h so a forgotten tab cannot fake a work week',
  /SESSION_CAP_MIN = 16 \* 60/.test(route) && /Math\.min\(SESSION_CAP_MIN/.test(route));
ok('A2: a session without logout falls back to last_seen, then a 1-minute floor',
  /sx\.logout_at \? new Date\(sx\.logout_at\)\.getTime\(\) : \(sx\.last_seen \? new Date\(sx\.last_seen\)\.getTime\(\) : st \+ 60000\)/.test(route));
ok('A3: the 6-days-a-week expectation is measured per week, Monday-anchored',
  /weekDays\[wkey\]/.test(route) && /weekDays\[w\] >= 6/.test(route) &&
  /six_day_adherence_pct/.test(route));
ok('A4: login hour is reported in Cairo time (the team\'s working clock)',
  /timeZone: 'Africa\/Cairo'/.test(route));
ok('A5: ticket close moments come from the system status comment, not updated_at',
  /Status changed to Closed/.test(route) &&
  /far more reliable[\s\S]{0,60}than updated_at/.test(route));
ok('A6: closed tickets with NO recorded close moment are EXCLUDED from on-time maths, never guessed',
  /closedUnknownTime/.test(route) && /EXCLUDED from on-time maths/.test(route));
ok('A7: on-time means closed on or before the due DATE (end of day)',
  /String\(cAt\)\.substring\(0, 10\) <= tk\.due_date/.test(route));
ok('A8: tickets without due dates are reported separately, never blended into on-time %',
  /closed_with_due_date/.test(route) && /on_time_close_pct: pct\(onTime, closedWithDue\)/.test(route));
ok('A9: responsiveness = their own first HUMAN comment (system comments excluded)',
  /c2\.is_system === true \|\| c2\.created_by !== userId/.test(route));
ok('A10: additional_assignees count as assignment too',
  /extra\.indexOf\(userId\) > -1/.test(route));
ok('A11: reopen events are counted from status history',
  /Status changed to Reopened/.test(route));
ok('A12: the route never writes anything',
  route.indexOf('.insert(') === -1 && route.indexOf('.update(') === -1 && route.indexOf('.delete(') === -1);

// ══════════════════════════════════════════════════════════════════
// PART B — Access control
// ══════════════════════════════════════════════════════════════════

ok('B1: server verifies the REQUESTER is Owner/Admin before returning anyone\'s record',
  /reqProf\.role !== 'super_admin' && reqProf\.role !== 'admin'/.test(route) &&
  /manager-level \(Owner\/Admin\) only/.test(route));
ok('B2: the screen is behind the HR Report permission in Admin',
  /section === 'perf_review' && canSeeHR/.test(adm));
ok('B3: the component itself refuses non-admins (defense in depth)',
  /Performance reviews are for Owners\/Admins\./.test(ui));
ok('B4: AI personas are excluded from the reviewable list',
  /\.filter\(function \(u\) \{ return !u\.is_ai; \}\)/.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART C — Jenna's narrative: grounded, optional, editable
// ══════════════════════════════════════════════════════════════════

ok('C1: Jenna is instructed to base every claim strictly on the numbers, never invent incidents',
  /base every claim strictly on the numbers given — never invent incidents/.test(route));
ok('C2: unknown figures must be stated as unavailable, not guessed',
  /say the data is not available rather than guessing/.test(route));
ok('C3: the narrative addresses the 6-day expectation and deadline performance by instruction',
  /address the ~6-days-per-week expectation directly/.test(route) &&
  /closing before deadlines/.test(route));
ok('C4: AI failure still returns the full measurements (narrative is a convenience, not the data)',
  /ai_error: narrative \? null : aiError/.test(route) &&
  /metrics returned without a narrative/.test(route));
ok('C5: model fallback exists (sonnet then haiku, the ask-route pattern)',
  /\['claude-sonnet-4-6', 'claude-haiku-4-5'\]/.test(route));
ok('C6: the draft is fully editable in the UI and saved separately from the original',
  /setM\('narrative', e\.target\.value\)/.test(ui) &&
  /ai_narrative: report\.narrative \|\| null/.test(ui) &&
  /narrative_final: mgr\.narrative \|\| null/.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART D — The manager's own input + the saved record
// ══════════════════════════════════════════════════════════════════

ok('D1: manager fields exist — rating, strengths, improvements, goals, comments',
  /overall_rating/.test(ui) && /strengths/.test(ui) && /improvements/.test(ui) &&
  /goals/.test(ui) && /manager_comments/.test(ui));
ok('D2: finalizing requires a rating; drafts do not',
  /if \(finalize && \(!mgr\.overall_rating \|\| mgr\.overall_rating < 1\)\)/.test(ui));
ok('D3: the metrics snapshot is frozen into the saved review',
  /metrics: report\.metrics,/.test(ui) && /frozen/.test(sql.toLowerCase()) === false || /FROZEN IN/.test(sql));
ok('D4: past reviews are listable and reloadable per employee',
  /from\('hr_performance_reviews'\)[\s\S]{0,120}\.eq\('employee_id', empId\)/.test(ui) &&
  /function loadPast\(id\)/.test(ui));
ok('D5: saving and finalizing are activity-logged',
  /Finalized' : 'Saved draft'\) \+ ' performance review for/.test(ui));
ok('D6: the printable report labels the three layers (measured / narrative / manager)',
  /Attendance & Consistency \(measured\)/.test(ui) &&
  /Strengths \(manager\)/.test(ui) &&
  /drafted by Jenna \(AI HR\) from measurements and edited by the reviewer/.test(ui));
ok('D7: the on-screen layers are numbered and labelled the same way',
  /1 · Measured — attendance & consistency/.test(ui) &&
  /2 · Jenna's draft/.test(ui) && /3 · Your input as manager/.test(ui));
ok('D8: unknown close-moments are explained to the reader on screen',
  /excluded from the on-time percentage rather than guessed/.test(ui));
ok('D9: toast goes through the shared ToastContext (AdminTab passes no toast prop)',
  /useContext\(ToastContext\)/.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART E — SQL
// ══════════════════════════════════════════════════════════════════

ok('E1: hr_performance_reviews table with rating bounds and draft/final status',
  /CREATE TABLE IF NOT EXISTS hr_performance_reviews/.test(sql) &&
  /overall_rating {3}int CHECK \(overall_rating BETWEEN 1 AND 5\)/.test(sql) &&
  /CHECK \(status IN \('draft','final'\)\)/.test(sql));
ok('E2: RLS enabled with the 4-policy pattern (PERMANENT RULE 9)',
  /ENABLE ROW LEVEL SECURITY/.test(sql) &&
  (sql.match(/CREATE POLICY/g) || []).length === 4);
ok('E3: AI draft and final narrative are separate columns',
  /ai_narrative {5}text/.test(sql) && /narrative_final {2}text/.test(sql));
ok('E4: the file ends with a verification readout',
  /RLS policies \(need 4\)/.test(sql));
ok('E5: idempotent (safe to re-run)',
  /duplicate_object THEN NULL/.test(sql) && /IF NOT EXISTS/.test(sql));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NK performance review center');
}
