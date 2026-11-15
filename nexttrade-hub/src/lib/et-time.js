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
//
// v55.80 (Phase B / Section 8 — ET standardization):
//   * Added fmtET(date, kind, opts) — the single helper for ALL user-facing
//     date/time rendering. Always returns ET. Always tags 'ET' on times so the
//     viewer knows which clock they're reading.
//   * kinds:
//       'date'      → "May 8, 2026"
//       'shortdate' → "May 8"
//       'time'      → "2:14 PM ET"
//       'datetime'  → "May 8, 2:14 PM ET"
//       'longdate'  → "Friday, May 8, 2026"
//       'weekday'   → "Friday"
//       'iso'       → "2026-05-08"  (no tag — for query keys / filters)
//       'monthday'  → "5/8" (compact — for sparkline / chart axis labels)
//   * fmtET silently degrades on bad input — never throws, returns '—'.
//   * The 'ET' suffix is omitted on pure-date kinds (a date doesn't have a tz).
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

// N days ago in ET (positive N = past, negative = future, non-numeric = today).
// Always returns a valid YYYY-MM-DD; never throws.
export function daysAgoET(n) {
  var num = Number(n);
  if (!isFinite(num)) num = 0;
  var d = new Date();
  d.setUTCDate(d.getUTCDate() - num);
  return etDateStr(d);
}

// Difference in whole ET calendar days between two YYYY-MM-DD strings.
// cmpDays('2026-04-20', '2026-04-22') === 2
// Returns 0 on invalid/missing input — never NaN. Caller-safe.
export function cmpETDays(aStr, bStr) {
  if (!aStr || !bStr) return 0;
  var a = new Date(aStr + 'T12:00:00Z'); // noon UTC sidesteps DST edge cases
  var b = new Date(bStr + 'T12:00:00Z');
  var aMs = a.getTime();
  var bMs = b.getTime();
  if (isNaN(aMs) || isNaN(bMs)) return 0;
  return Math.round((bMs - aMs) / 86400000);
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

// ============================================================
// fmtET — the single user-facing date/time renderer (v55.80)
// ============================================================
//
// Cached formatters — one per kind. Each renders in America/New_York.
var _fmtCache = {};
function _getFmt(kind) {
  if (_fmtCache[kind]) return _fmtCache[kind];
  var opts = { timeZone: 'America/New_York' };
  if (kind === 'date')        { opts.month = 'short'; opts.day = 'numeric'; opts.year = 'numeric'; }
  else if (kind === 'shortdate') { opts.month = 'short'; opts.day = 'numeric'; }
  else if (kind === 'time')     { opts.hour = 'numeric'; opts.minute = '2-digit'; opts.hour12 = true; }
  else if (kind === 'datetime') { opts.month = 'short'; opts.day = 'numeric'; opts.hour = 'numeric'; opts.minute = '2-digit'; opts.hour12 = true; }
  else if (kind === 'longdate') { opts.weekday = 'long'; opts.month = 'long'; opts.day = 'numeric'; opts.year = 'numeric'; }
  else if (kind === 'weekday')  { opts.weekday = 'long'; }
  else if (kind === 'monthlong'){ opts.month = 'long'; }
  else if (kind === 'monthday') { opts.month = 'numeric'; opts.day = 'numeric'; }
  else if (kind === 'iso') {
    // 'iso' uses the en-CA YYYY-MM-DD trick (already cached as etFormatter).
    _fmtCache[kind] = etFormatter();
    return _fmtCache[kind];
  }
  _fmtCache[kind] = new Intl.DateTimeFormat('en-US', opts);
  return _fmtCache[kind];
}

// Coerce input → Date. Accepts:
//   - Date object
//   - ISO timestamp string ("2026-05-08T14:00:00Z" or "2026-05-08")
//   - epoch number (ms)
//   - falsy → null
function _toDate(input) {
  if (!input && input !== 0) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    var d1 = new Date(input);
    return isNaN(d1.getTime()) ? null : d1;
  }
  if (typeof input === 'string') {
    // Bare YYYY-MM-DD: anchor to noon UTC so the ET formatter always lands
    // on the intended calendar day regardless of host tz.
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      var d2 = new Date(input + 'T12:00:00Z');
      return isNaN(d2.getTime()) ? null : d2;
    }
    var d3 = new Date(input);
    return isNaN(d3.getTime()) ? null : d3;
  }
  return null;
}

/**
 * fmtET(input, kind, opts) — the single renderer for user-facing times.
 *
 * input  : Date | ISO string | epoch ms | YYYY-MM-DD
 * kind   : 'date' | 'shortdate' | 'time' | 'datetime' | 'longdate'
 *          | 'weekday' | 'iso' | 'monthday'  (default: 'datetime')
 * opts   : { tag: true|false }  — suppress the trailing " ET" tag.
 *          Defaults: tag is added on time/datetime; omitted on pure dates.
 *
 * Returns string. Returns '—' on bad input (never throws).
 */
export function fmtET(input, kind, opts) {
  var k = kind || 'datetime';
  var d = _toDate(input);
  if (!d) return '—';
  try {
    var s = _getFmt(k).format(d);
    var tagDefault = (k === 'time' || k === 'datetime');
    var tag = (opts && typeof opts.tag === 'boolean') ? opts.tag : tagDefault;
    return tag ? (s + ' ET') : s;
  } catch (e) {
    return '—';
  }
}

/**
 * fmtETRange(from, to, kind) — range renderer for filter chips.
 * If from === to (same ET day), renders just the one date.
 * If different, renders "May 1 → May 8".
 */
export function fmtETRange(from, to, kind) {
  var k = kind || 'shortdate';
  if (!from && !to) return '—';
  if (!to) return fmtET(from, k);
  if (!from) return fmtET(to, k);
  var fromIso = (typeof from === 'string' && /^\d{4}-\d{2}-\d{2}/.test(from)) ? from.substring(0, 10) : etDateStr(_toDate(from));
  var toIso = (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}/.test(to)) ? to.substring(0, 10) : etDateStr(_toDate(to));
  if (fromIso === toIso) return fmtET(from, k);
  return fmtET(from, k) + ' → ' + fmtET(to, k);
}

/**
 * relativeET(input) — "2 hours ago" / "Yesterday" / "May 3" style.
 * For times within the last 12 hours, returns "Xm ago" / "Xh ago".
 * For yesterday in ET, returns "Yesterday".
 * For older, returns the short ET date.
 */
export function relativeET(input) {
  var d = _toDate(input);
  if (!d) return '—';
  var nowMs = Date.now();
  var diffMs = nowMs - d.getTime();
  if (diffMs < 0) return fmtET(d, 'datetime');
  if (diffMs < 60 * 1000) return 'just now';
  if (diffMs < 60 * 60 * 1000) return Math.floor(diffMs / 60000) + 'm ago';
  if (diffMs < 12 * 60 * 60 * 1000) return Math.floor(diffMs / 3600000) + 'h ago';
  // Compare ET calendar days
  var inputET = etDateStr(d);
  var todayStr = todayET();
  if (inputET === todayStr) return fmtET(d, 'time');
  var yStr = yesterdayET();
  if (inputET === yStr) return 'Yesterday';
  return fmtET(d, 'shortdate');
}
