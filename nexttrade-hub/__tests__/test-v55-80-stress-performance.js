// __tests__/test-v55-80-stress-performance.js
// =========================================
// QA Engineer 5: Performance & Scale Reviewer
//
// Looks at:
//   - explainScore is recomputed per render — is that expensive at scale?
//   - calcMetricsForUser performance with many sessions / many tickets
//   - userSessions fetch is bounded (limit 20000) — but enough?
//   - Pagination math is O(1) — confirmed in B10 test
//   - Heartbeat doesn't fire-storm if visibility flips fast
//   - Period boundary scans don't explode for "All time"
//   - et-time helper formatters are cached (one Intl.DateTimeFormat per kind)
//   - Phase A: assistant audio decoding doesn't block UI thread
//
// Run: node __tests__/test-v55-80-stress-performance.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

console.log('\n=== QA Engineer 5: Performance & Scale Reviewer ===');

// Load helpers for runtime perf tests
var hrSrc = load('src/lib/hr-metrics.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
hrSrc += '\n;return { calcMetricsForUser: calcMetricsForUser, calcScore: calcScore, explainScore: explainScore };\n';
var hr = (new Function(hrSrc))();

var etSrc = load('src/lib/et-time.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
etSrc += '\n;return { fmtET: fmtET, todayET: todayET, etDateStr: etDateStr };\n';
var et = (new Function(etSrc))();

// ---- ET helper formatters cached ----
var etCode = load('src/lib/et-time.js');
ok('PF1: et-time formatters are cached in _fmtCache', /_fmtCache/.test(etCode));
ok('PF2: et-time has cached etFormatter', /_etFormatter/.test(etCode));
ok('PF3: et-time has cached _etHourFormatter', /_etHourFormatter/.test(etCode));

// Runtime: calling fmtET 10000 times completes in <500ms (cache hit)
var t1 = Date.now();
for (var i = 0; i < 10000; i++) {
  et.fmtET('2026-05-08T18:14:00Z', 'datetime');
}
var t2 = Date.now();
ok('PF4: 10000 fmtET calls complete in <500ms (cached formatter)',
   t2 - t1 < 500, 'took: ' + (t2 - t1) + 'ms');

// Calling todayET 10000 times also fast
var t3 = Date.now();
for (var j = 0; j < 10000; j++) {
  et.todayET();
}
var t4 = Date.now();
ok('PF5: 10000 todayET calls complete in <500ms',
   t4 - t3 < 500, 'took: ' + (t4 - t3) + 'ms');

// ---- calcMetricsForUser with realistic load ----
// Simulate 1 year period with 250 working days × 4 sessions/day = 1000 sessions
// (Real KTC team may have much fewer, but this stress-tests upper bound.)
var bigSessions = [];
for (var d = 0; d < 365; d++) {
  var date = new Date(Date.UTC(2025, 0, 1) + d * 86400000).toISOString().substring(0, 10);
  // Skip weekends
  var dow = new Date(date + 'T12:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) continue;
  for (var k = 0; k < 4; k++) {
    bigSessions.push({
      user_id: 'u-perf',
      date: date,
      login_at: date + 'T' + (10 + k).toString().padStart(2, '0') + ':00:00Z',
      logout_at: date + 'T' + (12 + k).toString().padStart(2, '0') + ':00:00Z',
    });
  }
}
var bigPeriod = { from: '2025-01-01', to: '2025-12-31', days: 365 };

var t5 = Date.now();
var bigM = hr.calcMetricsForUser('u-perf', bigPeriod, {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [], customerQuotes: [], calendarEvents: [],
  customers: [], userSessions: bigSessions,
});
var t6 = Date.now();
ok('PF6: calcMetricsForUser with ~1000 sessions completes in <1000ms',
   t6 - t5 < 1000, 'took: ' + (t6 - t5) + 'ms');
// v55.80 PHASE-B+ INTERVAL MERGE: sessions 10-12, 11-13, 12-14, 13-15
// overlap into a single 10-15 = 5h block. (Old behavior summed flat = 8h.)
// This is the *correct* answer — two browser tabs at the same time
// shouldn't double-count.
ok('PF7: 1000 sessions × 4 overlapping per day → 5h avg/day (interval-merged)',
   bigM.avgHoursPerDay === 5,
   'got: ' + bigM.avgHoursPerDay);
ok('PF8: 1000 sessions across 1 year ~ 261 working days', bigM.presentDays >= 250 && bigM.presentDays <= 262,
   'presentDays: ' + bigM.presentDays);

// ---- explainScore performance ----
var t7 = Date.now();
for (var l = 0; l < 1000; l++) {
  hr.explainScore({score:80, productivity:75, quality:85, timeliness:80, engagement:70, reliability:90, presence:85}, bigM);
}
var t8 = Date.now();
ok('PF9: 1000 explainScore calls complete in <500ms',
   t8 - t7 < 500, 'took: ' + (t8 - t7) + 'ms');

// ---- AdminTab: data fetch query limits ----
var admin = load('src/components/AdminTab.jsx');
ok('PF10: daily_log fetch capped at limit(1000)', /\.from\('daily_log'\)[\s\S]+?\.limit\(1000\)/.test(admin));
ok('PF11: shipping_rates fetch capped at limit(500)', /\.from\('shipping_rates'\)[\s\S]+?\.limit\(500\)/.test(admin));
ok('PF12: audit_log fetch capped at limit(300)', /\.from\('audit_log'\)[\s\S]+?\.limit\(300\)/.test(admin));
ok('PF13: announcements fetch capped at limit(100)', /\.from\('announcements'\)[\s\S]+?\.limit\(100\)/.test(admin));
ok('PF14: user_sessions fetch capped at limit(500)', /\.from\('user_sessions'\)[\s\S]+?\.limit\(500\)/.test(admin));

// ---- HRReport: user_sessions fetch capped ----
var hrr = load('src/components/HRReport.jsx');
ok('PF15: HRReport user_sessions fetch capped at limit(20000)',
   /from\('user_sessions'\)[\s\S]+?\.limit\(20000\)/.test(hrr),
   '20k cap is generous for KTC team size — confirms upper bound exists');

// ---- HRReport: independent try/catch per query (no Promise.all bundling) ----
ok('PF16: HRReport uses safe() wrapper for each query independently',
   /const safe = async \(fn\) =>[\s\S]{0,200}try \{ return await fn\(\); \} catch/.test(hrr),
   'safe() wraps each query so one failure does not zero everything');

// ---- Pagination ACTIVITY_PAGE ----
ok('PF17: Activity pagination ACTIVITY_PAGE = 50 (sensible default)',
   /const ACTIVITY_PAGE = 50/.test(admin));

// ---- Heartbeat / visibility timing constants ----
var page = load('src/app/page.jsx');
ok('PF18: HIDDEN_TIMEOUT_MS = 3 minutes (not too aggressive)',
   /HIDDEN_TIMEOUT_MS = 3 \* 60 \* 1000/.test(page));
// Idle timeout (separate, fires after long inactivity even with tab visible)
ok('PF19: IDLE_TIMEOUT exists', /IDLE_TIMEOUT/.test(page));

// ---- Period boundary: working day count is bounded ----
// countWorkingDaysInPeriod loops day-by-day. On a 5-year period that's
// 1825 iterations — still fast. Verify via runtime.
var t9 = Date.now();
hr.calcMetricsForUser('u-perf', { from: '2020-01-01', to: '2025-12-31', days: 365 * 6 }, {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [], customerQuotes: [], calendarEvents: [],
  customers: [], userSessions: bigSessions,
});
var t10 = Date.now();
ok('PF20: calcMetricsForUser on 6-year period completes in <2000ms',
   t10 - t9 < 2000, 'took: ' + (t10 - t9) + 'ms');

// ---- AdminTab cache invalidation does NOT cause infinite re-fetch ----
// The useEffect that clears state is gated on `loaded` being true,
// preventing a fetch-clear-fetch loop.
ok('PF21: cache-invalidate effect gated on `loaded` flag',
   /useEffect\(\(\) => \{[\s\S]+?if \(loaded\) \{[\s\S]+?setLogs\(\[\]\)/.test(admin),
   'effect must check loaded to avoid infinite loop');

// ---- explainScore is pure / no side effects ----
var hrm = load('src/lib/hr-metrics.js');
// Within explainScore body, no setState / supabase / fetch / etc
var explainScoreBody = hrm.match(/function explainScore\([\s\S]+?(?=function |\nexport)/m)?.[0] || '';
ok('PF22: explainScore is pure — no DB calls, no setState',
   !/supabase\.|fetch\(|setState|setLogs|setData/.test(explainScoreBody));

// ---- calcMetricsForUser is pure ----
var metricsBody = hrm.match(/function calcMetricsForUser\([\s\S]+?(?=\nfunction )/m)?.[0] || '';
ok('PF23: calcMetricsForUser is pure',
   !/supabase\.|fetch\(|setState/.test(metricsBody));

// ---- Memoization in HRReport ----
ok('PF24: HRReport teamReport is memoized via useMemo',
   /const teamReport = useMemo\(/.test(hrr));
ok('PF25: HRReport teamAvg is memoized via useMemo',
   /const teamAvg = useMemo\(/.test(hrr));
ok('PF26: HRReport sortedReport is memoized',
   /const sortedReport = useMemo\(/.test(hrr));

console.log('\n=== Performance Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
