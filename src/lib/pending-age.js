// v55.83-XT — a pending bank line is never counted; one still pending after PENDING_STALE_DAYS is flagged so a person checks
// it with the bank (the hold may have been cancelled, or the final line came in under another reference). Nothing is removed
// automatically because of age. Pure, safe on the screen and the server. Var + concat only.
export var PENDING_STALE_DAYS = 10;

export function pendingAgeDays(row, todayIso) {
  if (!row || row.pending !== true) { return null; }
  var d = Date.parse(String(row.date || '').substring(0, 10) + 'T00:00:00Z');
  var t = Date.parse(String(todayIso || new Date().toISOString()).substring(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(d) || !Number.isFinite(t)) { return null; }
  return Math.max(0, Math.round((t - d) / 86400000));
}

export function isStalePending(row, todayIso) {
  var a = pendingAgeDays(row, todayIso);
  return a !== null && a > PENDING_STALE_DAYS;
}

export function pendingLabel(row, todayIso) {
  if (!row || row.pending !== true) { return ''; }
  var a = pendingAgeDays(row, todayIso);
  if (a !== null && a > PENDING_STALE_DAYS) { return 'Pending ' + a + ' days, not counted. Check with the bank'; }
  return 'Pending, not counted';
}
