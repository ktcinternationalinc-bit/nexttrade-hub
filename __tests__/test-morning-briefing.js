// ============================================================
// Session 13 (Apr 22 2026) — Phase 2: Morning Briefing engine
//
// Validates the briefing engine scoring + the wiring through the ask route
// and AIGreeter. Engine is pure so we can run real scoring tests, not just
// regex checks.
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var engine = require(path.join(REPO, 'src/lib/briefing-engine'));
var askRoute = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var briefingComp = fs.readFileSync(path.join(REPO, 'src/components/MorningBriefing.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

var TODAY = '2026-04-22';
var NOW = new Date(TODAY + 'T10:00:00').getTime();
var USER = 'user-max-uuid';

// ===== ENGINE — SCORING TESTS =====

test('S13.E1 buildBriefing exists and returns expected shape', function() {
  var b = engine.buildBriefing({ todayStr: TODAY, nowMs: NOW, userId: USER });
  assert(b && typeof b === 'object', 'must return an object');
  assert(Array.isArray(b.top3), 'must have top3 array');
  assert(typeof b.headline === 'string', 'must have headline string');
  assert(typeof b.all_clear === 'boolean', 'must have all_clear boolean');
});

test('S13.E2 Empty input returns all_clear', function() {
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER });
  assert(b.all_clear === true, 'no signals = all clear');
  assert(b.top3.length === 0, 'no top3 items');
  assert(/all clear|nothing urgent/i.test(b.headline), 'headline should reflect all clear');
});

test('S13.E3 Overdue invoice is detected and scored', function() {
  var inv = { id: 'i1', customer_name: 'Ahmed', invoice_date: '2026-01-01',
              outstanding: 500000, total_collected: 0, order_number: 'ORD-100' };
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, invoices: [inv] });
  assert(b.top3.length >= 1, 'should surface overdue invoice');
  var t = b.top3[0];
  assert(/Ahmed/.test(t.title), 'title must mention customer');
  assert(/500/.test(t.title), 'title must mention amount');
  assert(t.action_type === 'draft_collection_message', 'action should be draft_collection_message');
});

test('S13.E4 Older invoices score higher than newer ones (same amount)', function() {
  var newer = { id: 'i1', customer_name: 'A', invoice_date: '2026-03-15', outstanding: 100000 };
  var older = { id: 'i2', customer_name: 'B', invoice_date: '2026-01-01', outstanding: 100000 };
  var rs = engine._scorers.scoreOverdueInvoices([newer, older], TODAY);
  var aScore = rs.find(function(r) { return r.title.indexOf('A ') === 0; }).score;
  var bScore = rs.find(function(r) { return r.title.indexOf('B ') === 0; }).score;
  assert(bScore > aScore, 'older invoice should score higher than newer one');
});

test('S13.E5 Larger amounts score higher than smaller (same age)', function() {
  var small = { id: 'i1', customer_name: 'A', invoice_date: '2026-01-01', outstanding: 5000 };
  var huge =  { id: 'i2', customer_name: 'B', invoice_date: '2026-01-01', outstanding: 5000000 };
  var rs = engine._scorers.scoreOverdueInvoices([small, huge], TODAY);
  var aScore = rs.find(function(r) { return r.title.indexOf('A ') === 0; }).score;
  var bScore = rs.find(function(r) { return r.title.indexOf('B ') === 0; }).score;
  assert(bScore > aScore, 'larger amount should score higher');
});

test('S13.E6 Overdue ticket assigned to user surfaces', function() {
  var t = { id: 't1', ticket_number: 'TKT-1', title: 'Fix bug', status: 'New',
            priority: 'high', due_date: '2026-04-15', assigned_to: USER, created_at: '2026-04-01' };
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, tickets: [t] });
  assert(b.top3.length >= 1, 'overdue ticket must surface');
  var found = b.top3.find(function(it) { return it.kind === 'overdue_ticket'; });
  assert(found, 'must include overdue_ticket kind');
  assert(/TKT-1/.test(found.title), 'title must include ticket number');
});

test('S13.E7 Tickets assigned to OTHER users do NOT surface', function() {
  var t = { id: 't1', ticket_number: 'TKT-X', title: 'Other', status: 'New',
            priority: 'high', due_date: '2026-04-15', assigned_to: 'someone-else', created_at: '2026-04-01' };
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, tickets: [t] });
  assert(b.all_clear, 'other-user tickets must not appear in MY briefing');
});

test('S13.E8 High-priority tickets score above low-priority (same overdue)', function() {
  var hi = { id: 't1', title: 'A', status: 'New', priority: 'high', due_date: '2026-04-19', assigned_to: USER };
  var lo = { id: 't2', title: 'B', status: 'New', priority: 'low',  due_date: '2026-04-19', assigned_to: USER };
  var rs = engine._scorers.scoreOverdueTickets([hi, lo], USER, TODAY);
  var hiScore = rs.find(function(r) { return r.title.indexOf('A') >= 0; }).score;
  var loScore = rs.find(function(r) { return r.title.indexOf('B') >= 0; }).score;
  assert(hiScore > loScore, 'high priority must outrank low priority');
});

test('S13.E9 Imminent meeting scores very high', function() {
  // Meeting in 30 min
  var meetingTime = new Date(NOW + 30 * 60000);
  var ev = { id: 'e1', title: 'Customer call', event_date: TODAY,
             event_time: meetingTime.toTimeString().substring(0, 5), assigned_to: USER };
  var b = engine.buildBriefing({ todayStr: TODAY, nowMs: NOW, userId: USER, calendar_events: [ev] });
  assert(b.top3.length >= 1, 'imminent meeting must surface');
  var meetingItem = b.top3.find(function(it) { return it.kind === 'meeting'; });
  assert(meetingItem, 'meeting item present');
  assert(meetingItem.score >= 80, 'imminent meeting should be high-scoring (>=80) — got ' + meetingItem.score);
});

test('S13.E10 Pending check due today flags as critical/high', function() {
  var c = { id: 'c1', check_number: '12345', amount: 250000, status: 'pending', due_date: TODAY };
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, checks: [c] });
  assert(b.top3.length >= 1, 'check due today must surface');
  var checkItem = b.top3.find(function(it) { return it.kind === 'pending_check'; });
  assert(checkItem, 'check item present');
  assert(['critical', 'high'].indexOf(checkItem.urgency) >= 0,
    'check due today should be critical or high — got ' + checkItem.urgency);
});

test('S13.E11 top3 is capped at 3 items even with many candidates', function() {
  var invoices = [];
  for (var i = 0; i < 20; i++) {
    invoices.push({ id: 'i' + i, customer_name: 'C' + i, invoice_date: '2026-01-01', outstanding: 100000 + i * 10000 });
  }
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, invoices: invoices });
  assert(b.top3.length === 3, 'top3 must cap at 3 items — got ' + b.top3.length);
  assert(b.deferred_count === 17, 'deferred_count = candidates - 3');
});

test('S13.E12 Top3 is sorted by score descending', function() {
  var invoices = [
    { id: 'small', customer_name: 'Small Cust', invoice_date: '2026-04-01', outstanding: 10000 }, // low score
    { id: 'huge', customer_name: 'Huge Cust', invoice_date: '2026-01-01', outstanding: 5000000 }, // high
    { id: 'mid', customer_name: 'Mid Cust', invoice_date: '2026-02-15', outstanding: 200000 },    // mid
  ];
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, invoices: invoices });
  for (var i = 1; i < b.top3.length; i++) {
    assert(b.top3[i-1].score >= b.top3[i].score, 'top3 must be sorted descending by score');
  }
});

test('S13.E13 Headline reflects count', function() {
  var inv = { id: 'i1', customer_name: 'A', invoice_date: '2026-01-01', outstanding: 500000 };
  var b1 = engine.buildBriefing({ todayStr: TODAY, userId: USER, invoices: [inv] });
  assert(/1 thing/.test(b1.headline), 'headline must say "1 thing" for single item');

  var inv2 = { id: 'i2', customer_name: 'B', invoice_date: '2026-01-01', outstanding: 300000 };
  var inv3 = { id: 'i3', customer_name: 'C', invoice_date: '2026-01-01', outstanding: 200000 };
  var b3 = engine.buildBriefing({ todayStr: TODAY, userId: USER, invoices: [inv, inv2, inv3] });
  assert(/3 things/.test(b3.headline), 'headline must say "3 things" for 3 items');
});

test('S13.E14 deferred_count exposed for cards-vs-rest narrative', function() {
  var invoices = [];
  for (var i = 0; i < 5; i++) invoices.push({ id: 'i'+i, customer_name: 'C'+i, invoice_date: '2026-01-01', outstanding: 100000 });
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER, invoices: invoices });
  assert(b.deferred_count === 2, 'should be 2 deferred (5 candidates - 3 top3) — got ' + b.deferred_count);
});

test('S13.E15 Cold customer detection requires VIP threshold (100k+ revenue)', function() {
  var smallCust = { id: 'c1', name: 'Small Co' };
  var vipCust = { id: 'c2', name: 'VIP Co' };
  var smallInv = { id: 'i1', customer_id: 'c1', invoice_date: '2025-01-01', total_collected: 5000 };
  var vipInv = { id: 'i2', customer_id: 'c2', invoice_date: '2025-01-01', total_collected: 200000 };
  var b = engine.buildBriefing({ todayStr: TODAY, userId: USER,
    customers: [smallCust, vipCust], invoices: [smallInv, vipInv] });
  var coldItems = b.top3.filter(function(it) { return it.kind === 'cold_customer'; });
  assert(!coldItems.find(function(it) { return /Small Co/.test(it.title); }), 'small customers should NOT be flagged as cold');
});

// ===== AIGREETER + ASK ROUTE WIRING =====

test('S13.W1 AIGreeter sends isGreeting flag in payload', function() {
  assert(/isGreeting: !!isGreeting/.test(greeter),
    'AIGreeter must include isGreeting in BOTH payload variants');
  // Verify both branches (v2 and legacy)
  var matches = (greeter.match(/isGreeting: !!isGreeting/g) || []).length;
  assert(matches >= 2, 'isGreeting must be in both v2 and legacy payload — found ' + matches);
});

test('S13.W2 Ask route imports briefing engine', function() {
  assert(/import \* as briefingEngine from '\.\.\/\.\.\/\.\.\/lib\/briefing-engine'/.test(askRoute),
    'ask/route.js must import the briefing-engine module');
});

test('S13.W3 Briefing computed only when isFirstGreeting AND userId present', function() {
  assert(/isFirstGreeting && userId/.test(askRoute),
    'briefing block must guard on isFirstGreeting && userId');
});

test('S13.W4 isFirstGreeting heuristic detects body.isGreeting=true', function() {
  assert(/body\.isGreeting === true/.test(askRoute),
    'isFirstGreeting must trust the explicit body.isGreeting flag');
});

test('S13.W5 Briefing data load uses Promise.all for concurrency', function() {
  assert(/await Promise\.all\(\[[\s\S]{0,500}from\('tickets'\)[\s\S]*?from\('invoices'\)/.test(askRoute),
    'must concurrently load tickets, invoices, etc. for briefing');
});

test('S13.W6 Briefing failure is non-fatal', function() {
  assert(/catch \(briefingErr\)[\s\S]*?briefing = null/.test(askRoute),
    'briefing errors must NOT block the greeting — set null and continue');
});

test('S13.W7 Briefing injected into system prompt for AI consistency', function() {
  assert(/TOP PRIORITIES \(will be shown to user as visual cards/.test(askRoute),
    'system prompt must tell Claude about the cards so chat answer matches');
});

test('S13.W8 Briefing returned in response JSON', function() {
  assert(/return Response\.json\(\{ answer: finalText, decision: decision, actions_executed: actionsExecuted, briefing: briefing \}\)/.test(askRoute),
    'response must include briefing field');
});

test('S13.W9 AIGreeter attaches briefing to assistant message', function() {
  assert(/data\.briefing && \(data\.briefing\.top3 \|\| data\.briefing\.all_clear\)/.test(greeter),
    'AIGreeter must check for valid briefing data before attaching');
  assert(/assistantMsg\.briefing = data\.briefing/.test(greeter),
    'briefing must be attached to the assistant message object');
});

test('S13.W10 AIGreeter has handleBriefingAction handler', function() {
  assert(/var handleBriefingAction = function\(item\)/.test(greeter),
    'handleBriefingAction must be defined');
  ['open_ticket', 'open_customer', 'open_check', 'open_calendar', 'open_crm', 'draft_collection_message']
    .forEach(function(a) {
      assert(greeter.indexOf("'" + a + "'") >= 0, 'must handle action: ' + a);
    });
});

test('S13.W11 page.jsx listens for briefing-* events', function() {
  ['briefing-open-ticket', 'briefing-open-customer', 'briefing-open-check', 'briefing-open-calendar', 'briefing-open-crm']
    .forEach(function(ev) {
      assert(page.indexOf("'" + ev + "'") >= 0, 'page.jsx must register listener for: ' + ev);
    });
});

test('S13.W12 page.jsx removes listeners on cleanup', function() {
  assert(/return \(\) => \{[\s\S]*?removeEventListener\('briefing-open-ticket'/.test(page),
    'useEffect cleanup must removeEventListener (no leaks)');
});

// ===== UI COMPONENT =====

test('S13.U1 MorningBriefing component renders top3 items', function() {
  assert(/visibleItems\.map/.test(briefingComp),
    'must iterate over visible items');
  assert(/onAction\(item\)/.test(briefingComp),
    'each card must call onAction with the item when clicked');
});

test('S13.U2 MorningBriefing supports dismiss per-item', function() {
  assert(/setDismissed/.test(briefingComp),
    'dismiss state must exist');
  assert(/var visibleItems = top3\.filter/.test(briefingComp),
    'dismissed items must be filtered out of visible');
});

test('S13.U3 All three urgency styles defined', function() {
  ['critical', 'high', 'medium'].forEach(function(u) {
    assert(briefingComp.indexOf(u + ':') >= 0, 'URGENCY_STYLES must include ' + u);
  });
});

test('S13.U4 Bilingual support — labels in both Arabic and English', function() {
  // English keywords
  assert(/Morning Briefing/.test(briefingComp), 'English label present');
  // Arabic equivalent
  assert(briefingComp.indexOf('موجز الصباح') >= 0, 'Arabic label present');
});

test('S13.U5 All-clear state shows celebratory card, not empty', function() {
  assert(/briefing\.all_clear/.test(briefingComp),
    'must check all_clear flag');
  assert(/All clear/.test(briefingComp) && briefingComp.indexOf('كل شيء على ما يرام') >= 0,
    'all-clear must have its own English + Arabic copy');
});

test('S13.U6 Deferred count footer shown when stack exists', function() {
  assert(/briefing\.deferred_count > 0/.test(briefingComp),
    'must conditionally show "+X more waiting" footer');
});

test('S13.U7 No template literals in the component (SWC-safe)', function() {
  // The component file uses JSX which uses backticks in className templates
  // is NOT allowed if we want SWC compatibility — count how many backticks exist
  var bt = (briefingComp.match(/`/g) || []).length;
  assert(bt === 0, 'no template literals allowed (SWC issue) — found ' + bt);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
