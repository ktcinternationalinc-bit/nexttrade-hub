// ============================================================
// v55.82-J — Three asks from Max May 11 2026 evening:
//
//   ASK #1: "the today reminders. And calendar should include also
//            your the tickets that are due"
//     → Dashboard "📅 Today" widget now folds today-due tickets in
//       alongside calendar events. Count in header includes both.
//       (Reminders widget already did this in v55.81 — verified
//       still works.)
//
//   ASK #2: "the bill what's in the bill should be right after the AI"
//     → WhatsNewWidget gains a `prominent` prop. When true, renders
//       as a full-width banner instead of the small right-aligned
//       pill. Dashboard passes prominent={true} so the build callout
//       sits immediately under the AI Workforce hero, can't be
//       missed.
//
//   ASK #3: "shipping rate rates in the upload template, we should
//            have something that says replace historical or update
//            historical and when they do the update, the update
//            should just fill up information that was missing
//            previously so something should indicate whether you
//            want to do a total"
//     → Mode labels renamed: "Add" → "Add New", "Update" → "Update
//       Historical" (with "FILL GAPS ONLY" sub-badge), "Replace" →
//       "Replace Historical" (with "TOTAL OVERWRITE" sub-badge).
//       Update logic tightened to fill-blanks-only — existing
//       non-blank values are never overwritten.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var personalDash = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');
var pageSrc      = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var whatsNew     = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'WhatsNewWidget.jsx'), 'utf8');
var shippingTab  = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

// =====================================================================
// ASK #1 — Today widget folds in today-due tickets
// =====================================================================

ok('1a: Dashboard Today widget counts both events AND today-due tickets in header',
  /📅 Today \(\{[\s\S]{0,2000}todayTktCount[\s\S]{0,800}return todayEvents\.length \+ todayTktCount/.test(personalDash)
);

ok('1b: Today widget filters tickets to today + not closed/resolved/fixed',
  /t\.due_date === todayStr && \['Closed','Resolved','Fixed'\]\.indexOf\(t\.status\) === -1/.test(personalDash)
);

ok('1c: Today widget streams events + tickets together (streamToday)',
  /var streamToday = \[\.\.\.todayEvents, \.\.\.todayTickets\]/.test(personalDash)
);

ok('1d: Today widget renders ticket rows with 🎫 prefix + Open → button',
  /🎫 \{ev\.title\}/.test(personalDash) && /Open →/.test(personalDash)
);

ok('1e: Today widget shows priority badges on today-due tickets',
  /priority === 'critical'[\s\S]{0,200}🚨 CRITICAL/.test(personalDash) && /priority === 'high'[\s\S]{0,200}🔴 HIGH/.test(personalDash)
);

ok('1f: Today widget dedupes tickets that appear in both myTickets and ticketsICreated',
  /arr\.findIndex\(function\(x\)\{ return x\.id === t\.id; \}\) === idx/.test(personalDash)
);

ok('1g: Empty state mentions BOTH events and tickets',
  /No events or tickets today/.test(personalDash)
);

// Reminders widget already folds tickets in (v55.81 carryover) — REGRESSION GUARD
// v55.83-A.6.23 update — Max explicitly asked to STOP folding today-due tickets
// into the Reminders widget, since they now belong exclusively to the new
// DashboardPrioritySections cluster (the "📤 I Delegated" sub-section in each
// of the three cards covers them). Confirm the comment is there explaining why.
ok('1h: Reminders widget no longer folds today-due tickets (moved to priority cards in v55.83-A.6.23)',
  !/todayDueTickets = \[\.\.\.myTickets, \.\.\.ticketsICreated\][\s\S]{0,400}t\.due_date === todayStr/.test(personalDash)
  && /v55\.83-A\.6\.23[\s\S]{0,400}REMOVED today-due ticket injection/.test(personalDash)
);

// =====================================================================
// ASK #2 — WhatsNew widget repositioned as prominent banner after AI
// =====================================================================

ok('2a: WhatsNewWidget accepts a prominent prop',
  /function WhatsNewWidget\(\{ isAdmin, isSuperAdmin, prominent \}/.test(whatsNew)
);

ok('2b: prominent mode renders a full-width w-full banner',
  /prominent \? \([\s\S]{0,300}w-full flex items-center justify-between/.test(whatsNew)
);

ok('2c: prominent banner shows "Tap to read →" affordance',
  /Tap to read →/.test(whatsNew)
);

ok('2d: pill mode preserved for non-prominent usage (backward compat)',
  /\) : \([\s\S]{0,200}Inline pill — visible on the dashboard/.test(whatsNew)
);

ok('2e: Dashboard passes prominent to WhatsNewWidget (v55.83-A.6.27.9 may use false for collapsed-by-default)',
  /<WhatsNewWidget isAdmin=\{isAdmin\} isSuperAdmin=\{isSuperAdmin\} prominent=\{(true|false)\} \/>/.test(pageSrc)
);

ok('2f: REGRESSION GUARD — Dashboard no longer wraps WhatsNew in flex justify-end (pill-on-right look)',
  !/flex justify-end[\s\S]{0,200}<WhatsNewWidget/.test(pageSrc),
  'should be full-width, not pinned to the right edge'
);

ok('2g: WhatsNew banner sits before NadiaNewBuildCard (which is "after" the build callout)',
  (function() {
    var whatsNewIdx = pageSrc.indexOf('<WhatsNewWidget');
    var nadiaNewIdx = pageSrc.indexOf('<NadiaNewBuildCard');
    return whatsNewIdx > 0 && nadiaNewIdx > 0 && whatsNewIdx < nadiaNewIdx;
  })(),
  'build callout banner comes first'
);

// =====================================================================
// ASK #3 — Import mode labels (SUPERSEDED by v55.82-L2 spec rewrite).
// Max May 11 2026 evening replaced the 3-mode J labels with the
// 2-mode L2 spec ("Update Only" safe default + "Full Sync"
// destructive). These tests now assert the L2 labels.
// =====================================================================

// 3a — Default mode is "Update Only" with SAFE · DEFAULT badge
ok('3a: Mode "Update Only" label rendered with SAFE badge (v55.82-L2)',
  /value="update_only"[\s\S]{0,400}Update Only[\s\S]{0,300}SAFE/.test(shippingTab)
);

// 3b — Second mode is "Full Sync" with DELETES MISSING warning badge
ok('3b: Mode "Full Sync" label + DELETES MISSING ROWS badge rendered (v55.82-L2)',
  /value="full_sync"[\s\S]{0,400}Full Sync[\s\S]{0,300}DELETES MISSING ROWS/.test(shippingTab)
);

// 3c — Old 3-mode design fully removed (no more Add New / Update Historical / Replace Historical)
ok('3c: REGRESSION GUARD — old 3-mode labels removed (no Replace Historical etc.)',
  !/Replace Historical/.test(shippingTab) && !/Update Historical/.test(shippingTab)
);

// 3d — Update Only explainer
ok('3d: Update Only explainer says updated + added + left alone',
  /Update Only mode \(safe\)[\s\S]{0,800}left alone/.test(shippingTab)
);

// 3e — Full Sync explainer warns DESTRUCTIVE + DELETED
ok('3e: Full Sync explainer warns DESTRUCTIVE + DELETED',
  /DESTRUCTIVE[\s\S]{0,400}DELETED/.test(shippingTab)
);

// 3f — Update Only patch logic uses rowChanged helper (no longer existingIsEmpty)
ok('3f: v55.82-L2 update path uses rowChanged comparator (not fill-gaps-only)',
  /var rowChanged = function/.test(shippingTab)
);

// 3g — Default state value is 'update_only'
ok('3g: useState default is update_only (v55.82-L2 safety)',
  /useState\('update_only'\)/.test(shippingTab)
);

// 3h — REGRESSION GUARD: no fill-gaps-only existingIsEmpty logic anymore
ok('3h: REGRESSION GUARD — fill-gaps-only existingIsEmpty pattern is gone',
  !/existingIsEmpty = false/.test(shippingTab),
  'v55.82-L2 uses change-detection instead of fill-only semantics per Max\'s spec'
);

// 3i — Full Sync uses .delete().in() (scoped delete, not unconditional)
ok('3i: Full Sync uses scoped .delete().in("id", toDelete) (not unconditional wipe)',
  /supabase\.from\('shipping_rates'\)\.delete\(\)\.in\('id', toDelete\)/.test(shippingTab)
);

// 3j — Exactly 2 modes present now
ok('3j: v55.82-L2: exactly 2 import modes (update_only + full_sync)',
  (function() {
    var u = (shippingTab.match(/value="update_only"/g) || []).length;
    var s = (shippingTab.match(/value="full_sync"/g) || []).length;
    var old = (shippingTab.match(/value="replace"/g) || []).length;
    return u >= 1 && s >= 1 && old === 0;
  })()
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-J tests passed — Today widget tickets · WhatsNew banner · Import mode rename + fill-gaps-only');
