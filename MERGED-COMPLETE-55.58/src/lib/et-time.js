// ============================================================
// src/lib/et-time.js
// Eastern-time-aware "today / yesterday / now" helpers.
//
// The problem this solves, in one line:
//   new Date().toISOString().substring(0,10) returns UTC.
//   Max logs in at 10pm ET → UTC says tomorrow → "you weren't here yesterday" bug.
//
// These helpers use the Intl API (built into every modern browser + Node 12+)
// to compute the calendar date in America/New_York specifically. They replace
// every place the app was using toISOString().substring(0,10) for a user-facing
// "today" value.
// ============================================================

// Cached formatter — creating one per call is slow.
var _etFormatter = null;
function etFormatter() {
  if (!_etFormatter) {
    _etFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  }
  return _etFormatter;
}

// Return YYYY-MM-DD for the given Date in ET. Default: now.
// en-CA locale formats as YYYY-MM-DD natively (Canadian English uses ISO), so
// we don't have to parse m/d/y back out.
export function etDateStr(d) {
  var dt = d || new Date();
  return etFormatter().format(dt);
}

// Shorthand for "what day is it right now in New York?"
export function todayET() {
  return etDateStr(new Date());
}

// Yesterday in ET.
export function yesterdayET() {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return etDateStr(d);
}

// N days ago in ET (positive N = past).
export function daysAgoET(n) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() - (n || 0));
  return etDateStr(d);
}

// Difference in whole ET calendar days between two YYYY-MM-DD strings.
// cmpDays('2026-04-20', '2026-04-22') === 2
export function cmpETDays(aStr, bStr) {
  if (!aStr || !bStr) return 0;
  var a = new Date(aStr + 'T12:00:00Z'); // noon UTC sidesteps DST edge cases
  var b = new Date(bStr + 'T12:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Hour in ET (0-23) for greeting tone (morning/afternoon/evening).
var _etHourFormatter = null;
export function etHour(d) {
  if (!_etHourFormatter) {
    _etHourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    });
  }
  var s = _etHourFormatter.format(d || new Date());
  // en-US with hour12:false returns like '14' or '24' (24 means midnight)
  var h = parseInt(s, 10);
  if (h === 24) h = 0;
  return h;
}

// Greeting word for the current ET hour
export function etGreetingWord() {
  var h = etHour();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
