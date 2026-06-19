// visibility-window.js — v55.83-JE. ADMIN HISTORY-VISIBILITY WINDOW.
// One source of truth for "how far back may a normal user see" across Bank Review, BankTab, Invoices,
// AR, Customer Ledger, and Open Accounts. A super-admin always sees ALL stored history (no floor).
// Pure functions only (no DB, no React) so they are testable and reusable on client + server.
// SWC-safe: var + string concat, no template literals/arrows/optional-chaining.

// Allowed window keys. 'custom' carries a customDays integer or an explicit fromDate.
var WINDOW_OPTIONS = [
  { key: '1m', label: 'Last 1 month', days: 30 },
  { key: '3m', label: 'Last 3 months', days: 91 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: '1y', label: 'Last 1 year', days: 365 },
  { key: 'cy', label: 'Current year (Jan 1 →)', days: null },
  { key: 'all', label: 'All history', days: null },
  { key: 'custom', label: 'Custom…', days: null }
];

function isValidWindowKey(k) {
  var i;
  for (i = 0; i < WINDOW_OPTIONS.length; i++) { if (WINDOW_OPTIONS[i].key === k) { return true; } }
  return false;
}

function labelForWindow(key, customDays) {
  var i;
  for (i = 0; i < WINDOW_OPTIONS.length; i++) {
    if (WINDOW_OPTIONS[i].key === key) {
      if (key === 'custom' && customDays) { return 'Last ' + customDays + ' days (custom)'; }
      return WINDOW_OPTIONS[i].label;
    }
  }
  return 'All history';
}

// Pad a number to 2 digits.
function p2(n) { return (n < 10 ? '0' : '') + n; }

// YYYY-MM-DD floor date for a window. Returns null when the window means "no floor" (all history,
// or a super-admin who always sees everything). `now` is injected for testability.
//   opts: { window, customDays, customFrom, isSuperAdmin }
function floorDateFor(opts, now) {
  opts = opts || {};
  now = now || new Date();
  if (opts.isSuperAdmin === true) { return null; }            // super-admin: all history
  var key = isValidWindowKey(opts.window) ? opts.window : 'all';
  if (key === 'all') { return null; }
  if (key === 'cy') { return now.getFullYear() + '-01-01'; }
  if (key === 'custom') {
    if (opts.customFrom) { return String(opts.customFrom).substring(0, 10); }
    var cd = parseInt(opts.customDays, 10);
    if (!(cd > 0)) { return null; }
    return isoMinusDays(now, cd);
  }
  // fixed-day windows (1m/3m/6m/1y)
  var i;
  for (i = 0; i < WINDOW_OPTIONS.length; i++) {
    if (WINDOW_OPTIONS[i].key === key && WINDOW_OPTIONS[i].days) { return isoMinusDays(now, WINDOW_OPTIONS[i].days); }
  }
  return null;
}

function isoMinusDays(now, days) {
  var d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

// True when a transaction/record dated `rowDate` (YYYY-MM-DD or ISO) is INSIDE the window.
// A null floor (all/super-admin) always passes.
function isWithinWindow(rowDate, floor) {
  if (!floor) { return true; }
  if (!rowDate) { return false; }            // undated rows are hidden under a finite window (conservative)
  return String(rowDate).substring(0, 10) >= floor;
}

export {
  WINDOW_OPTIONS,
  isValidWindowKey,
  labelForWindow,
  floorDateFor,
  isWithinWindow
};
