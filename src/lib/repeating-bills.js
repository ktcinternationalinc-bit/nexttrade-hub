// v55.83-TV — REPEATING BILLS (Max, Nov 17 2026): a bill that comes back every week / month / quarter / year
// (e.g. the fixed monthly "Warehouse staff" bill) is set up ONCE and the Hub creates each bill on schedule.
//
// Pure functions, no database — safe for the server, the screen and the tests.
//
// The schedule is always counted from the START date (never from the last bill), so a bill set up for the 31st
// lands on the last day of short months and goes back to the 31st afterwards (no drift: Jan 31 → Feb 28 → Mar 31).
// SWC-safe: var + string concatenation.

export var FREQUENCIES = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
export var DEFAULT_LEAD_DAYS = 7; // a bill is created this many days before its date (Max can change it per repeating bill)
export var MAX_LEAD_DAYS = 60;
export var MAX_PER_RUN = 24;      // never more than this many bills for one repeating bill in one run (catch-up safety)
var MAX_STEPS = 3000;             // weekly for ~57 years — the loop can never run away

function pad2(n) { return (n < 10 ? '0' : '') + n; }
export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) { return false; }
  var t = Date.parse(s + 'T00:00:00Z');
  if (isNaN(t)) { return false; }
  return new Date(t).toISOString().substring(0, 10) === s; // refuses 2026-02-30
}
function toDay(s) { return Math.round(Date.parse(s + 'T00:00:00Z') / 86400000); }
function fromDay(n) { return new Date(n * 86400000).toISOString().substring(0, 10); }
export function addDaysStr(s, n) { return fromDay(toDay(s) + n); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m 1..12

// The n-th date of the schedule (n = 0 is the start date itself).
export function occurrenceDate(start, freq, n) {
  if (!isDateStr(start) || !FREQUENCIES[freq] || !(n >= 0)) { return null; }
  if (freq === 'weekly') { return addDaysStr(start, 7 * n); }
  var months = freq === 'monthly' ? n : freq === 'quarterly' ? 3 * n : 12 * n;
  var y = Number(start.substring(0, 4)); var m = Number(start.substring(5, 7)); var d = Number(start.substring(8, 10));
  var total = (y * 12 + (m - 1)) + months;
  var ny = Math.floor(total / 12); var nm = (total % 12) + 1;
  var nd = Math.min(d, daysInMonth(ny, nm));
  return ny + '-' + pad2(nm) + '-' + pad2(nd);
}

// The dates whose bill should exist by `today`: start ≤ date ≤ end (if any), date − lead ≤ today, and date not already
// handled (made or skipped — `done` is { 'YYYY-MM-DD': true }). Dates before resume_from are never made (set when a
// paused repeating bill is resumed or its schedule edited — "changes future bills only"). Dates missed while the Hub was
// down ARE made (catch-up), one bill per date. Oldest first, at most `limit` of them.
export function dueDates(rb, today, done, limit) {
  var out = [];
  if (!rb || !isDateStr(rb.start_date) || !FREQUENCIES[rb.frequency] || !isDateStr(today)) { return out; }
  var lead = leadDaysOf(rb);
  var horizon = addDaysStr(today, lead);
  var cap = limit > 0 ? limit : MAX_PER_RUN;
  var seen = done || {};
  for (var n = 0; n < MAX_STEPS && out.length < cap; n++) {
    var d = occurrenceDate(rb.start_date, rb.frequency, n);
    if (!d || d > horizon) { break; }
    if (rb.end_date && isDateStr(rb.end_date) && d > rb.end_date) { break; }
    if (rb.resume_from && isDateStr(rb.resume_from) && d < rb.resume_from) { continue; } // nothing for the paused time
    if (!seen[d]) { out.push(d); }
  }
  return out;
}

// The next date that has no bill yet (for the list), or null when the schedule has ended.
export function nextDate(rb, done) {
  if (!rb || !isDateStr(rb.start_date) || !FREQUENCIES[rb.frequency]) { return null; }
  var seen = done || {};
  for (var n = 0; n < MAX_STEPS; n++) {
    var d = occurrenceDate(rb.start_date, rb.frequency, n);
    if (!d) { return null; }
    if (rb.end_date && isDateStr(rb.end_date) && d > rb.end_date) { return null; }
    if (rb.resume_from && isDateStr(rb.resume_from) && d < rb.resume_from) { continue; }
    if (!seen[d]) { return d; }
  }
  return null;
}

export function leadDaysOf(rb) {
  var l = rb && rb.lead_days != null && rb.lead_days !== '' ? Math.floor(Number(rb.lead_days)) : DEFAULT_LEAD_DAYS;
  if (!(l >= 0)) { l = DEFAULT_LEAD_DAYS; }
  return Math.min(l, MAX_LEAD_DAYS);
}

// "Warehouse staff" + 2026-12-01 → AUTO-WAREHOUSES-20261201 — unique per repeating bill and date, readable on the list.
export function autoBillNumber(vendor, date) {
  var key = String(vendor || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10) || 'BILL';
  return 'AUTO-' + key + '-' + String(date || '').replace(/-/g, '');
}

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Checks a repeating bill typed on the screen. Returns { ok, error, row } — row is what is stored.
// opts.keepStart: the first date already saved (an edit that keeps it is never refused by the 3-month rule).
export function validateRepeating(input, todayStr, opts) {
  var b = input || {};
  var keepStart = opts && opts.keepStart ? String(opts.keepStart).substring(0, 10) : null;
  var vendor = String(b.vendor_name || '').trim();
  if (!vendor) { return { ok: false, error: 'Type the vendor.' }; }
  var amt = r2(b.amount);
  if (!(amt > 0)) { return { ok: false, error: 'The amount must be above zero.' }; }
  if (amt > 10000000) { return { ok: false, error: 'That amount is too large.' }; }
  var freq = String(b.frequency || '').toLowerCase();
  if (!FREQUENCIES[freq]) { return { ok: false, error: 'Pick how often: every week, month, 3 months or year.' }; }
  if (!isDateStr(b.start_date)) { return { ok: false, error: 'Pick the first date (YYYY-MM-DD).' }; }
  var end = String(b.end_date || '').trim() || null;
  if (end && !isDateStr(end)) { return { ok: false, error: 'The end date must be a real date (YYYY-MM-DD), or leave it empty.' }; }
  if (end && end < b.start_date) { return { ok: false, error: 'The end date is before the first date.' }; }
  var lead = b.lead_days == null || b.lead_days === '' ? DEFAULT_LEAD_DAYS : Math.floor(Number(b.lead_days));
  if (!(lead >= 0) || lead > MAX_LEAD_DAYS) { return { ok: false, error: 'Create the bill 0 to ' + MAX_LEAD_DAYS + ' days before its date.' }; }
  // a first date far in the past would create a pile of old bills at once — refuse it, say why
  if (isDateStr(todayStr) && b.start_date !== keepStart && b.start_date < addDaysStr(todayStr, -92)) { return { ok: false, error: 'The first date is more than 3 months ago — that would create many old bills at once. Pick a first date from the last 3 months, or enter the old bills by hand.' }; }
  return { ok: true, row: {
    vendor_name: vendor.substring(0, 120), amount: amt,
    category: String(b.category || '').trim().substring(0, 120) || null,
    release_number: String(b.release_number || '').trim().toUpperCase().substring(0, 40) || null,
    frequency: freq, start_date: b.start_date, end_date: end, lead_days: lead,
    notes: String(b.notes || '').trim().substring(0, 500) || null,
  } };
}

// Plain words for the list: "Every month from 2026-12-01 (until 2027-11-30)".
export function scheduleWords(rb) {
  if (!rb) { return ''; }
  return (FREQUENCIES[rb.frequency] || rb.frequency) + ' from ' + rb.start_date + (rb.end_date ? ' until ' + rb.end_date : '');
}
