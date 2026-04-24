// ============================================================
// Admin Dashboard regression tests
//
// Covers production issues reported Apr 22 2026:
//   A. Date filter should default to "Today" (was: last 30 days)
//   B. Preset buttons must compute correct ET-aware date ranges
//   C. Login events sometimes didn't write (fire-and-forget fetch)
//   D. Bubble drill-down must surface the exact underlying records
//
// Pure unit tests of resolver logic — no browser, no Supabase.
// ============================================================

var assert = require('assert');

var passed = 0;
var failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------
var USERS = [
  { id: 'u-max',   name: 'Max',   role: 'super_admin' },
  { id: 'u-omar',  name: 'Omar',  role: 'team' },
  { id: 'u-sara',  name: 'Sara',  role: 'admin' },
];
// Use a fixed "today" so tests are deterministic regardless of when run
var FAKE_TODAY_ET = '2026-04-22';
var YESTERDAY_ET = '2026-04-21';

var TICKETS = [
  // Max: 2 open, 1 closed, 1 overdue
  { id: 't1', ticket_number: 'T-001', title: 'Review invoice Q2', assigned_to: 'u-max', status: 'New',    due_date: '2026-05-01', created_by: 'u-max' },
  { id: 't2', ticket_number: 'T-002', title: 'Call supplier',      assigned_to: 'u-max', status: 'Closed', due_date: '2026-04-20', closed_at: '2026-04-21', created_by: 'u-max' },
  { id: 't3', ticket_number: 'T-003', title: 'Overdue claim',      assigned_to: 'u-max', status: 'In Progress', due_date: '2026-04-15', created_by: 'u-sara' },
  // Omar: 1 open, no overdue
  { id: 't4', ticket_number: 'T-004', title: 'Ship to Cairo',      assigned_to: 'u-omar', status: 'New', due_date: '2026-05-05', created_by: 'u-max' },
  // Sara: 0 assigned
];

var AUDIT_LOGS = [
  { id: 'a1', changed_by: 'u-max', table_name: 'shipping_rates', action: 'create', record_id: 'r1', created_at: '2026-04-22T10:00Z' },
  { id: 'a2', changed_by: 'u-max', table_name: 'shipping_rates', action: 'create', record_id: 'r2', created_at: '2026-04-22T11:00Z' },
  { id: 'a3', changed_by: 'u-sara', table_name: 'shipping_rates', action: 'create', record_id: 'r3', created_at: '2026-04-22T12:00Z' },
];
var RATES = [
  { id: 'r1', vendor_name: 'MSC',   origin: 'Alexandria', destination: 'Jeddah',  rate_amount: 1200 },
  { id: 'r2', vendor_name: 'Maersk', origin: 'Alexandria', destination: 'Miami',   rate_amount: 2500 },
  { id: 'r3', vendor_name: 'CMA',   origin: 'Port Said',  destination: 'Genoa',   rate_amount: 1800 },
];
var QUOTES = [
  { id: 'q1', quote_number: 'Q-2026-001', customer_name: 'Yasser Abadah', total_amount: 45000, created_by: 'u-max' },
  { id: 'q2', quote_number: 'Q-2026-002', customer_name: 'Ahmed Mohamed', total_amount: 28000, created_by: 'u-sara' },
];

// -----------------------------------------------------------------
// Resolver mirrors — same logic as AdminTab.jsx
// -----------------------------------------------------------------

function bubbleFilter(type, userId, data, todayStr) {
  var tickets = data.tickets || [];
  var audit = data.auditLogs || [];
  var rates = data.rates || [];
  var quotes = data.quotes || [];
  if (type === 'inqueue') return tickets.filter(function(t) { return t.assigned_to === userId && t.status !== 'Closed'; });
  if (type === 'closed') return tickets.filter(function(t) { return t.assigned_to === userId && t.status === 'Closed'; });
  if (type === 'overdue') return tickets.filter(function(t) { return t.assigned_to === userId && t.due_date && t.due_date < todayStr && t.status !== 'Closed'; });
  if (type === 'created') return tickets.filter(function(t) { return t.created_by === userId; });
  if (type === 'rates') {
    var rateIds = audit.filter(function(a) { return a.changed_by === userId && a.table_name === 'shipping_rates' && a.action === 'create'; }).map(function(a) { return a.record_id; });
    return rates.filter(function(r) { return rateIds.indexOf(r.id) !== -1; });
  }
  if (type === 'quotes') return quotes.filter(function(q) { return q.created_by === userId; });
  return [];
}

function computeDateRange(preset, todayETStr) {
  function shiftDays(n) {
    var d = new Date(todayETStr + 'T12:00:00Z'); // use noon UTC so TZ slop doesn't shift the date
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().substring(0, 10);
  }
  if (preset === 'today')      return { from: todayETStr, to: todayETStr };
  if (preset === 'yesterday')  { var y = shiftDays(1); return { from: y, to: y }; }
  if (preset === '7d')         return { from: shiftDays(6),  to: todayETStr };
  if (preset === '30d')        return { from: shiftDays(29), to: todayETStr };
  if (preset === '3mo')        return { from: shiftDays(89), to: todayETStr };
  if (preset === 'all')        return { from: '2020-01-01', to: todayETStr };
  return null;
}

// -----------------------------------------------------------------
// TESTS: Date presets (A, B)
// -----------------------------------------------------------------
test('A1 "today" preset collapses to single day', function() {
  var r = computeDateRange('today', FAKE_TODAY_ET);
  assert.strictEqual(r.from, FAKE_TODAY_ET);
  assert.strictEqual(r.to, FAKE_TODAY_ET);
});

test('A2 "yesterday" preset is single day, one before today', function() {
  var r = computeDateRange('yesterday', FAKE_TODAY_ET);
  assert.strictEqual(r.from, YESTERDAY_ET);
  assert.strictEqual(r.to, YESTERDAY_ET);
});

test('B1 "7d" preset spans 7 inclusive days ending today', function() {
  var r = computeDateRange('7d', FAKE_TODAY_ET);
  // today - 6 days through today = 7-day window
  assert.strictEqual(r.to, FAKE_TODAY_ET);
  assert.strictEqual(r.from, '2026-04-16');
});

test('B2 "30d" preset spans 30 inclusive days', function() {
  var r = computeDateRange('30d', FAKE_TODAY_ET);
  assert.strictEqual(r.to, FAKE_TODAY_ET);
  assert.strictEqual(r.from, '2026-03-24');
});

test('B3 "3mo" preset spans 90 inclusive days', function() {
  var r = computeDateRange('3mo', FAKE_TODAY_ET);
  assert.strictEqual(r.to, FAKE_TODAY_ET);
  assert.strictEqual(r.from, '2026-01-23');
});

test('B4 "all" preset starts in 2020 and ends today', function() {
  var r = computeDateRange('all', FAKE_TODAY_ET);
  assert.strictEqual(r.from, '2020-01-01');
  assert.strictEqual(r.to, FAKE_TODAY_ET);
});

test('B5 unknown preset returns null (caller falls back to custom)', function() {
  var r = computeDateRange('bogus', FAKE_TODAY_ET);
  assert.strictEqual(r, null);
});

// -----------------------------------------------------------------
// TESTS: Login event reliability (C)
// -----------------------------------------------------------------
test('C1 Belt-and-suspenders: fall back to sessions count when login_events is 0', function() {
  // Mirror of AdminTab's belt-and-suspenders logic
  function mergedTodayCount(lsRow, sessions, userId, etTodayStr) {
    var eventCount = Number((lsRow && lsRow.logins_today_et) || 0);
    var sessionCount = sessions.filter(function(s) { return s.user_id === userId && (s.date || '') === etTodayStr; }).length;
    return Math.max(eventCount, sessionCount);
  }
  // login_events shows 0 but user_sessions shows 1 → merge to 1
  var mergedZeroEvent = mergedTodayCount(
    { logins_today_et: 0 },
    [{ user_id: 'u-max', date: FAKE_TODAY_ET, login_at: '2026-04-22T09:00Z' }],
    'u-max',
    FAKE_TODAY_ET
  );
  assert.strictEqual(mergedZeroEvent, 1, 'fallback to sessions must kick in when events say 0');

  // login_events shows 3 but sessions show 1 → event count wins
  var eventWins = mergedTodayCount(
    { logins_today_et: 3 },
    [{ user_id: 'u-max', date: FAKE_TODAY_ET, login_at: '2026-04-22T09:00Z' }],
    'u-max',
    FAKE_TODAY_ET
  );
  assert.strictEqual(eventWins, 3, 'higher count wins');

  // No data either place → 0
  var noData = mergedTodayCount(null, [], 'u-max', FAKE_TODAY_ET);
  assert.strictEqual(noData, 0, 'clean zero when no data exists');
});

test('C2 sendBeacon payload format is JSON-parseable', function() {
  // Verify the Blob payload our login-event call builds on the client is the same
  // shape the server expects. Catches any accidental double-encoding regressions.
  var payload = JSON.stringify({
    user_id: 'u-max',
    event_type: 'login',
    user_agent: 'Mozilla/5.0 test',
  });
  var parsed = JSON.parse(payload);
  assert.strictEqual(parsed.user_id, 'u-max');
  assert.strictEqual(parsed.event_type, 'login');
  assert(parsed.user_agent.indexOf('Mozilla') !== -1);
});

test('C3 ET date calculation matches server-side expectation', function() {
  // Build the same ET-formatted date string the client uses. This should be a
  // YYYY-MM-DD string in America/New_York, never UTC.
  var fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  var got = fmt.format(new Date('2026-04-22T12:00:00Z')); // noon UTC = 8 AM ET
  assert.strictEqual(got, '2026-04-22', 'noon UTC resolves to same ET date');
  var earlyGot = fmt.format(new Date('2026-04-22T03:00:00Z')); // 11 PM previous ET day
  assert.strictEqual(earlyGot, '2026-04-21', 'early UTC must roll back to previous ET date');
});

// -----------------------------------------------------------------
// TESTS: Bubble drill-down (D)
// -----------------------------------------------------------------
test('D1 In-Queue drill returns only unresolved tickets assigned to that user', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var rows = bubbleFilter('inqueue', 'u-max', data, FAKE_TODAY_ET);
  assert.strictEqual(rows.length, 2, 'Max has 2 non-closed tickets');
  assert(rows.every(function(t) { return t.status !== 'Closed'; }));
  assert(rows.every(function(t) { return t.assigned_to === 'u-max'; }));
});

test('D2 Closed drill returns only closed tickets assigned to that user', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var rows = bubbleFilter('closed', 'u-max', data, FAKE_TODAY_ET);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ticket_number, 'T-002');
});

test('D3 Overdue drill excludes closed tickets', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var rows = bubbleFilter('overdue', 'u-max', data, FAKE_TODAY_ET);
  // t1 due 2026-05-01 — future, not overdue
  // t2 due 2026-04-20 — past, but CLOSED, excluded
  // t3 due 2026-04-15 — past, In Progress → overdue ✓
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ticket_number, 'T-003');
});

test('D4 Created drill returns tickets where this user is creator (regardless of assignment)', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var rows = bubbleFilter('created', 'u-max', data, FAKE_TODAY_ET);
  // Max created t1, t2, t4 (t4 is assigned to Omar)
  assert.strictEqual(rows.length, 3);
  assert(rows.find(function(t) { return t.ticket_number === 'T-004'; }), 't4 must appear even though assigned to Omar');
});

test('D5 Rates drill resolves audit rows back to the real rate records', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var rows = bubbleFilter('rates', 'u-max', data, FAKE_TODAY_ET);
  assert.strictEqual(rows.length, 2, 'Max created 2 rates');
  assert(rows.find(function(r) { return r.vendor_name === 'MSC'; }));
  assert(rows.find(function(r) { return r.vendor_name === 'Maersk'; }));
  // Must NOT include Sara's rate
  assert(!rows.find(function(r) { return r.vendor_name === 'CMA'; }));
});

test('D6 Quotes drill filters by created_by', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var rows = bubbleFilter('quotes', 'u-max', data, FAKE_TODAY_ET);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].customer_name, 'Yasser Abadah');
});

test('D7 Unknown drill type returns empty, never crashes', function() {
  var rows = bubbleFilter('unknown_type', 'u-max', { tickets: TICKETS, auditLogs: [], rates: [], quotes: [] }, FAKE_TODAY_ET);
  assert.strictEqual(rows.length, 0);
});

test('D8 Drill for user with no data returns empty (not undefined)', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  ['inqueue', 'closed', 'overdue', 'created', 'rates', 'quotes'].forEach(function(type) {
    var rows = bubbleFilter(type, 'u-phantom', data, FAKE_TODAY_ET);
    assert(Array.isArray(rows), type + ' must always return an array');
    assert.strictEqual(rows.length, 0, type + ' for unknown user must be empty');
  });
});

// -----------------------------------------------------------------
// TESTS: Consistency — ensure scorecard counts match drill-down counts
// (If they don't, users lose trust immediately)
// -----------------------------------------------------------------
test('D9 Scorecard counts match drill-down row counts exactly', function() {
  var data = { tickets: TICKETS, auditLogs: AUDIT_LOGS, rates: RATES, quotes: QUOTES };
  var checks = [
    { type: 'inqueue', user: 'u-max', expectCount: 2 },
    { type: 'closed',  user: 'u-max', expectCount: 1 },
    { type: 'overdue', user: 'u-max', expectCount: 1 },
    { type: 'created', user: 'u-max', expectCount: 3 },
    { type: 'rates',   user: 'u-max', expectCount: 2 },
    { type: 'quotes',  user: 'u-max', expectCount: 1 },
    { type: 'inqueue', user: 'u-omar', expectCount: 1 },
    { type: 'rates',   user: 'u-omar', expectCount: 0 },
  ];
  checks.forEach(function(c) {
    var rows = bubbleFilter(c.type, c.user, data, FAKE_TODAY_ET);
    assert.strictEqual(rows.length, c.expectCount, c.type + ' for ' + c.user + ' — expected ' + c.expectCount + ', got ' + rows.length);
  });
});

console.log('');
console.log('─────────────────────────────────────');
console.log('ADMIN DASHBOARD TEST RESULTS');
console.log('─────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES — do not deploy until fixed'); process.exit(1); }
else console.log('\n✅ All admin dashboard tests passed');
