// ============================================================
// v55 Stage 1 — Calendar data fields (location, join_link, all_day)
//
// What this stage adds for the user:
//   • Location field on every event (free text)
//   • Join meeting link (clickable URL)
//   • All-day toggle (no clock time, shows "🌅 All day")
//
// These tests cover:
//   1. Pure-logic behavior of the form payload + edit-form diff
//      (no React, no Supabase — fast unit tests of the contracts)
//   2. String-presence checks on CalendarTab.jsx + the SQL
//      migration to lock in that the wiring is actually in place
//      (so a future refactor can't silently strip the fields out)
//
// These three fields each touch FIVE places in the file:
//   - Add Event form (input)
//   - handleAddEvent payload (insert)
//   - openEditEvent (preload editForm)
//   - saveEditEvent (diff + update)
//   - Edit modal form (input)
//   - Day-view event card (display)
//   - Month-view event card (display)
//   - Month-grid tile (mini display)
//
// If ANY one of those sites loses the field, that field stops
// working end-to-end. The string-presence tests below catch that.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) {
    console.log('✓ ' + label);
  } else {
    failures.push(label + (hint ? ' — ' + hint : ''));
    console.log('✗ ' + label + (hint ? ' — ' + hint : ''));
  }
}

// ---------- Pure-logic helpers (mirrors of the code in CalendarTab.jsx) ----------

// Mirrors handleAddEvent's payload-building rules for the 3 new fields
function buildPayloadFields(f) {
  return {
    event_time: f.allDay ? null : (f.eventTime || null),
    location: (f.location && f.location.trim()) ? f.location.trim() : null,
    join_link: (f.joinLink && f.joinLink.trim()) ? f.joinLink.trim() : null,
    all_day: !!f.allDay,
  };
}

// Mirrors saveEditEvent's diff logic for the 3 new fields
function diffEditForm(editForm, editEvent) {
  var newLoc = (editForm.location || '').trim();
  var oldLoc = (editEvent.location || '').trim();
  var newLink = (editForm.joinLink || '').trim();
  var oldLink = (editEvent.join_link || '').trim();
  var newAllDay = !!editForm.allDay;
  var oldAllDay = !!editEvent.all_day;
  var update = {};
  if (newLoc !== oldLoc) update.location = newLoc || null;
  if (newLink !== oldLink) update.join_link = newLink || null;
  if (newAllDay !== oldAllDay) {
    update.all_day = newAllDay;
    if (newAllDay) update.event_time = null;
  }
  return {
    hasLocationChange: newLoc !== oldLoc,
    hasJoinLinkChange: newLink !== oldLink,
    hasAllDayChange: newAllDay !== oldAllDay,
    update: update,
  };
}

// ---------- 1. Form payload (handleAddEvent) ----------

ok('1a: empty form → all three fields null/false',
  (function() {
    var p = buildPayloadFields({});
    return p.location === null && p.join_link === null && p.all_day === false;
  })()
);

ok('1b: location with surrounding whitespace → trimmed',
  buildPayloadFields({ location: '   KTC office  ' }).location === 'KTC office'
);

ok('1c: location of all whitespace → null (not empty string)',
  buildPayloadFields({ location: '   ' }).location === null
);

ok('1d: join link trimmed and stored',
  buildPayloadFields({ joinLink: ' https://zoom.us/j/123  ' }).join_link === 'https://zoom.us/j/123'
);

ok('1e: all_day=true forces event_time=null even if eventTime was set',
  (function() {
    var p = buildPayloadFields({ allDay: true, eventTime: '14:30' });
    return p.event_time === null && p.all_day === true;
  })()
);

ok('1f: all_day=false preserves user-entered eventTime',
  (function() {
    var p = buildPayloadFields({ allDay: false, eventTime: '14:30' });
    return p.event_time === '14:30';
  })()
);

ok('1g: all_day=false with no eventTime → null',
  buildPayloadFields({ allDay: false }).event_time === null
);

ok('1h: all three fields together — happy path',
  (function() {
    var p = buildPayloadFields({
      location: 'Cairo Marriott',
      joinLink: 'https://meet.google.com/abc-defg-hij',
      allDay: false,
      eventTime: '10:00',
    });
    return p.location === 'Cairo Marriott'
      && p.join_link === 'https://meet.google.com/abc-defg-hij'
      && p.all_day === false
      && p.event_time === '10:00';
  })()
);

// ---------- 2. Edit-form diff (saveEditEvent) ----------

ok('2a: no field changes → no update',
  (function() {
    var d = diffEditForm(
      { location: 'Office', joinLink: 'https://x', allDay: false },
      { location: 'Office', join_link: 'https://x', all_day: false }
    );
    return !d.hasLocationChange && !d.hasJoinLinkChange && !d.hasAllDayChange
      && Object.keys(d.update).length === 0;
  })()
);

ok('2b: location changed → only location in update',
  (function() {
    var d = diffEditForm(
      { location: 'New office', joinLink: '', allDay: false },
      { location: 'Old office', join_link: '', all_day: false }
    );
    return d.hasLocationChange && d.update.location === 'New office'
      && d.update.join_link === undefined
      && d.update.all_day === undefined;
  })()
);

ok('2c: location cleared → location: null in update',
  (function() {
    var d = diffEditForm(
      { location: '', joinLink: '', allDay: false },
      { location: 'Old office', join_link: '', all_day: false }
    );
    return d.update.location === null;
  })()
);

ok('2d: only whitespace differences → NO change detected',
  (function() {
    var d = diffEditForm(
      { location: '  Office  ', joinLink: '', allDay: false },
      { location: 'Office', join_link: '', all_day: false }
    );
    return !d.hasLocationChange && Object.keys(d.update).length === 0;
  })()
);

ok('2e: join link changed → only join_link in update',
  (function() {
    var d = diffEditForm(
      { location: 'X', joinLink: 'https://new', allDay: false },
      { location: 'X', join_link: 'https://old', all_day: false }
    );
    return d.hasJoinLinkChange && d.update.join_link === 'https://new';
  })()
);

ok('2f: toggle all_day ON → update has all_day=true AND event_time=null',
  (function() {
    var d = diffEditForm(
      { location: 'X', joinLink: '', allDay: true },
      { location: 'X', join_link: '', all_day: false }
    );
    return d.hasAllDayChange
      && d.update.all_day === true
      && d.update.event_time === null;
  })()
);

ok('2g: toggle all_day OFF → update has all_day=false (no event_time clear)',
  (function() {
    var d = diffEditForm(
      { location: 'X', joinLink: '', allDay: false },
      { location: 'X', join_link: '', all_day: true }
    );
    return d.hasAllDayChange
      && d.update.all_day === false
      && !('event_time' in d.update);
  })()
);

ok('2h: all three fields changed at once',
  (function() {
    var d = diffEditForm(
      { location: 'New', joinLink: 'https://new', allDay: true },
      { location: 'Old', join_link: 'https://old', all_day: false }
    );
    return d.update.location === 'New'
      && d.update.join_link === 'https://new'
      && d.update.all_day === true
      && d.update.event_time === null;
  })()
);

// ---------- 3. SQL migration sanity ----------

var sqlPath = path.join(__dirname, '..', 'sql', 's26_calendar_data_fields.sql');
var sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';

ok('3a: SQL migration file exists',
  sql.length > 0,
  'expected sql/s26_calendar_data_fields.sql'
);

ok('3b: backup table created BEFORE column changes',
  sql.indexOf('CREATE TABLE IF NOT EXISTS calendar_events_backup_s26_20260425') > -1
);

ok('3c: location column added (idempotent)',
  /ADD COLUMN IF NOT EXISTS\s+location\s+TEXT/.test(sql)
);

ok('3d: join_link column added (idempotent)',
  /ADD COLUMN IF NOT EXISTS\s+join_link\s+TEXT/.test(sql)
);

ok('3e: all_day column added with NOT NULL DEFAULT FALSE',
  /ADD COLUMN IF NOT EXISTS\s+all_day\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i.test(sql)
);

ok('3f: backup table comes BEFORE the column ALTERs (order matters)',
  (function() {
    // Strip comments so casual mentions of "ADD COLUMN" in the header
    // don't confuse the order check. Then compare positions of the
    // actual SQL statements.
    var bare = sql.replace(/--[^\n]*\n/g, '\n');
    var backupIdx = bare.indexOf('CREATE TABLE IF NOT EXISTS calendar_events_backup_s26');
    var alterIdx = bare.indexOf('ALTER TABLE calendar_events ADD COLUMN');
    return backupIdx > -1 && alterIdx > -1 && backupIdx < alterIdx;
  })()
);

// ---------- 4. CalendarTab.jsx wiring ----------

var calPath = path.join(__dirname, '..', 'src', 'components', 'CalendarTab.jsx');
var cal = fs.readFileSync(calPath, 'utf8');

// 4a. Add-event form has the three new inputs
ok('4a: Add form has location input bound to f.location',
  /value=\{f\.location\|\|''\}/.test(cal) && /onChange=\{e=>setF\(\{\.\.\.f,location:e\.target\.value\}\)\}/.test(cal)
);

ok('4b: Add form has join link input bound to f.joinLink',
  /value=\{f\.joinLink\|\|''\}/.test(cal)
);

ok('4c: Add form has all-day checkbox bound to f.allDay',
  /checked=\{!!f\.allDay\}/.test(cal)
);

// 4d-f. handleAddEvent payload includes the three fields
ok('4d: handleAddEvent payload writes location',
  /location:\s*\(f\.location && f\.location\.trim\(\)\) \? f\.location\.trim\(\) : null/.test(cal)
);

ok('4e: handleAddEvent payload writes join_link',
  /join_link:\s*\(f\.joinLink && f\.joinLink\.trim\(\)\) \? f\.joinLink\.trim\(\) : null/.test(cal)
);

ok('4f: handleAddEvent payload writes all_day',
  /all_day:\s*!!f\.allDay/.test(cal)
);

ok('4g: handleAddEvent payload nulls event_time when all-day',
  /event_time:\s*f\.allDay \? null/.test(cal)
);

// 4h-j. openEditEvent preloads the three fields
ok('4h: openEditEvent preloads location into editForm',
  /location:\s*ev\.location \|\| ''/.test(cal)
);

ok('4i: openEditEvent preloads joinLink from ev.join_link',
  /joinLink:\s*ev\.join_link \|\| ''/.test(cal)
);

ok('4j: openEditEvent preloads allDay from ev.all_day',
  /allDay:\s*!!ev\.all_day/.test(cal)
);

// 4k-m. Edit modal has the three new inputs
ok('4k: Edit modal has location input bound to editForm.location',
  /value=\{editForm\.location\|\|''\}/.test(cal)
);

ok('4l: Edit modal has joinLink input bound to editForm.joinLink',
  /value=\{editForm\.joinLink\|\|''\}/.test(cal)
);

ok('4m: Edit modal has all-day checkbox bound to editForm.allDay',
  /checked=\{!!editForm\.allDay\}/.test(cal)
);

// 4n-p. saveEditEvent detects and persists the three fields
ok('4n: saveEditEvent detects hasLocationChange',
  /hasLocationChange/.test(cal)
);

ok('4o: saveEditEvent detects hasJoinLinkChange',
  /hasJoinLinkChange/.test(cal)
);

ok('4p: saveEditEvent detects hasAllDayChange',
  /hasAllDayChange/.test(cal)
);

ok('4q: saveEditEvent persists location field',
  // v55.83-A.5 — variable renamed update → fieldUpdate (for clarity that
  // there's also a parallel singleUpdate). Same business behavior.
  /update\.location\s*=\s*newLoc \|\| null/.test(cal) ||
  /fieldUpdate\.location\s*=\s*newLoc \|\| null/.test(cal)
);

ok('4r: saveEditEvent persists join_link field',
  // v55.83-A.5 — see 4q note re: fieldUpdate rename
  /update\.join_link\s*=\s*newLink \|\| null/.test(cal) ||
  /fieldUpdate\.join_link\s*=\s*newLink \|\| null/.test(cal)
);

ok('4s: saveEditEvent forces event_time=null when toggling all_day ON',
  // v55.83-A.5 — see 4q note re: fieldUpdate rename
  /if \(newAllDay\) update\.event_time = null/.test(cal) ||
  /if \(newAllDay\) fieldUpdate\.event_time = null/.test(cal)
);

// 4t-w. Display: all-day badge, location pin, join link
ok('4t: All-day badge "🌅 All day" rendered when ev.all_day',
  cal.indexOf('🌅 All day') > -1
);

ok('4u: Location rendered with 📍 icon on event cards',
  cal.indexOf('📍') > -1 && /ev\.location/.test(cal)
);

ok('4v: Join link rendered as <a> with stopPropagation',
  /href=\{ev\.join_link\}/.test(cal)
    && /onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(cal)
);

ok('4w: Month-grid tile shows 📍 prefix when location set',
  /ev\.location \? '📍 ' : ''/.test(cal)
);

ok('4x: Month-grid tile shows 🌅 prefix when all_day',
  /ev\.all_day \? '🌅 ' : ''/.test(cal)
);

// ---------- 5. Regression — existing fields still work ----------

ok('5a: Title input still wired',
  /value=\{f\.title\|\|''\}/.test(cal)
);

ok('5b: Date input still wired',
  /value=\{f\.eventDate\|\|''\}/.test(cal)
);

ok('5c: Time input still wired (now with all-day disable)',
  /value=\{f\.eventTime\|\|''\}/.test(cal)
    && /disabled=\{!!f\.allDay\}/.test(cal)
);

ok('5d: handleAddEvent still writes assigned_to + attendees',
  /assigned_to:\s*ownerUid/.test(cal) && /attendees:\s*attendees/.test(cal)
);

ok('5e: saveEditEvent still detects title/date/time changes',
  /hasTitleChange/.test(cal) && /hasDateChange/.test(cal) && /hasTimeChange/.test(cal)
);

// ---------- Summary ----------

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55 Stage 1 (calendar data fields) tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
