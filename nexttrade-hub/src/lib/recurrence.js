// ============================================================
// src/lib/recurrence.js
// Pure recurrence math + reminder-time computation.
// No Supabase, no React, no side effects — so the tests can
// call these functions directly with synthetic inputs.
//
// Calendar date strings everywhere are 'YYYY-MM-DD'.
// Times are 'HH:mm' or 'HH:mm:ss'.
// ============================================================

// ------------------------------------------------------------
// Date helpers
// ------------------------------------------------------------

// Parse 'YYYY-MM-DD' into numeric { y, m, d } — no Date object involved
// so we sidestep timezone-at-midnight ambiguity.
export function parseDateStr(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function formatDateStr(y, m, d) {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return y + '-' + mm + '-' + dd;
}

export function daysInMonth(y, m) {
  // m is 1-indexed (1=Jan, 12=Dec)
  return new Date(y, m, 0).getDate();
}

export function addDays(dateStr, n) {
  const p = parseDateStr(dateStr);
  if (!p) return null;
  // Use UTC Date arithmetic so we don't pick up timezone DST nonsense
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatDateStr(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Add N months, clamping the day to the last day of the target month.
// Example: addMonthsClamp('2026-01-31', 1) = '2026-02-28' (not 2026-03-03).
//          addMonthsClamp('2024-01-31', 1) = '2024-02-29' (leap year).
export function addMonthsClamp(dateStr, n) {
  const p = parseDateStr(dateStr);
  if (!p) return null;
  const totalMonths = (p.y * 12 + (p.m - 1)) + n;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(ny, nm);
  const nd = Math.min(p.d, maxDay);
  return formatDateStr(ny, nm, nd);
}

// Compare two 'YYYY-MM-DD' strings lexicographically — works correctly because
// the format is ISO-8601 zero-padded. Returns -1, 0, or 1.
export function cmpDate(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ------------------------------------------------------------
// Recurrence core
// ------------------------------------------------------------

// Valid patterns. 'custom' is reserved for future per-day-of-week rules.
export const VALID_PATTERNS = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'custom'];

// Given a current occurrence date and a recurrence spec, return the next date.
// Returns null if pattern is 'none' or 'custom' (custom has no default stepping).
// Interval defaults to 1 if missing/invalid. Biweekly is weekly×2 internally.
export function nextOccurrence(currentDateStr, pattern, interval) {
  const p = parseDateStr(currentDateStr);
  if (!p) return null;
  const iv = Number.isFinite(+interval) && +interval >= 1 ? Math.floor(+interval) : 1;
  if (pattern === 'daily')    return addDays(currentDateStr, iv);
  if (pattern === 'weekly')   return addDays(currentDateStr, iv * 7);
  if (pattern === 'biweekly') return addDays(currentDateStr, iv * 14);
  if (pattern === 'monthly')  return addMonthsClamp(currentDateStr, iv);
  // 'none' or 'custom' or unknown → no stepping
  return null;
}

// Generate dates strictly AFTER `fromDateStr`, up to AND INCLUDING `untilDateStr`
// (or the master's recurrence_end if earlier). Capped at maxN to prevent runaway.
// Returns string[] — dates in ascending order.
//
// The "master" object here is the calendar_events row: shape matters.
//   { event_date, recurring, recurrence_interval, recurring_end }
export function generateOccurrences(master, fromDateStr, untilDateStr, maxN) {
  if (!master) return [];
  const pattern = master.recurring;
  if (!pattern || pattern === 'none' || pattern === 'custom') return [];
  const interval = Number.isFinite(+master.recurrence_interval) && +master.recurrence_interval >= 1
    ? Math.floor(+master.recurrence_interval)
    : 1;

  // The walk starts from `fromDateStr` and produces `next, next+1, next+2, ...`
  // We only include dates > fromDateStr (strict) and <= min(untilDateStr, recurring_end).
  const seriesEnd = master.recurring_end || null;
  const hardCeiling = seriesEnd && seriesEnd < untilDateStr ? seriesEnd : untilDateStr;
  const cap = Number.isFinite(+maxN) && +maxN > 0 ? Math.floor(+maxN) : 366;

  const out = [];
  let cursor = fromDateStr;
  for (let i = 0; i < cap; i++) {
    const nxt = nextOccurrence(cursor, pattern, interval);
    if (!nxt) break;
    if (cmpDate(nxt, hardCeiling) > 0) break;
    out.push(nxt);
    cursor = nxt;
  }
  return out;
}

// ------------------------------------------------------------
// Cairo ⇄ UTC conversion
// ------------------------------------------------------------
// Egypt uses UTC+2 (EET). DST (EEST, UTC+3) reinstated 2023 — last Friday of
// April → last Thursday of October. V1 hardcodes UTC+2; on DST boundaries,
// reminders can fire 1 hour off. Acceptable for day_before/day_of. For
// 30min_before, document as a gap.
export const CAIRO_OFFSET_HOURS = 2;

// Given a Cairo local 'YYYY-MM-DD' + optional 'HH:mm', return the UTC ISO string.
// If time missing, uses 00:00 local.
export function cairoToUTC(dateStr, timeStr) {
  const p = parseDateStr(dateStr);
  if (!p) return null;
  let h = 0, mm = 0;
  if (timeStr) {
    const tm = String(timeStr).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (tm) { h = +tm[1]; mm = +tm[2]; }
  }
  // Cairo local wall-clock → UTC: subtract the offset.
  const utcMs = Date.UTC(p.y, p.m - 1, p.d, h - CAIRO_OFFSET_HOURS, mm, 0);
  return new Date(utcMs).toISOString();
}

// ------------------------------------------------------------
// Reminder time computation
// ------------------------------------------------------------
// For a given event, produce the 3 reminder timestamps. If the event has no
// time, `30min_before` is omitted (no precise moment to anchor to).
//
// Convention:
//   day_before    = (event_date - 1 day) at 18:00 Cairo  (evening "tomorrow..." ping)
//   day_of        =  event_date          at 08:00 Cairo  (morning "today..." ping)
//   30min_before  =  event_datetime - 30 minutes          (if event_time exists)
export function computeReminderTimes(eventDateStr, eventTimeStr) {
  if (!parseDateStr(eventDateStr)) return [];
  const result = [];

  // day_before at 18:00 Cairo
  const dayBeforeDate = addDays(eventDateStr, -1);
  if (dayBeforeDate) {
    result.push({
      remind_type: 'day_before',
      scheduled_for: cairoToUTC(dayBeforeDate, '18:00'),
    });
  }

  // day_of at 08:00 Cairo
  result.push({
    remind_type: 'day_of',
    scheduled_for: cairoToUTC(eventDateStr, '08:00'),
  });

  // 30min_before — only if event has a time
  if (eventTimeStr) {
    const eventUTC = cairoToUTC(eventDateStr, eventTimeStr);
    if (eventUTC) {
      const thirtyMinEarlier = new Date(new Date(eventUTC).getTime() - 30 * 60 * 1000).toISOString();
      result.push({
        remind_type: '30min_before',
        scheduled_for: thirtyMinEarlier,
      });
    }
  }

  return result;
}

// ------------------------------------------------------------
// UUID shim — use crypto.randomUUID() when available
// (Node 14.17+ and all modern browsers). Fallback is best-effort.
// ------------------------------------------------------------
export function newUUID() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  // RFC4122 v4 fallback — not cryptographically strong but fine for a series_id
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { s += '-'; continue; }
    if (i === 14) { s += '4'; continue; }
    if (i === 19) { s += hex[8 + Math.floor(Math.random() * 4)]; continue; }
    s += hex[Math.floor(Math.random() * 16)];
  }
  return s;
}
