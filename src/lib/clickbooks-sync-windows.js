// v55.83-QZ2 (review of Nov 8, Max 12:00: "look for any logical gaps") — the
// 15-minute ClickBooks job used to look at ONE rolling day (yesterday→today).
// Anything categorized, reviewed or matched later than the day after its own
// date (the normal case: bookkeeping happens days later) never reached the
// ledger. Windows now cover the last 31 days on EVERY tick, and once a day the
// whole open period since the floor (opening cutoff / locked-through date) in
// 31-day slices — the database functions refuse longer windows by design.
// Pure date math (UTC, ISO yyyy-mm-dd) so it is unit-testable.

function addDays(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// floorIso: the last date that must NOT be posted into (opening cutoff, or
// the locked-through date when later). todayIso: the job's "to" date.
// Returns [[from, to], ...] — the FIRST window is always the recent one.
export function syncWindows(floorIso, todayIso, fullCatchUp) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(floorIso || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || ''))) { return null; }
  var first = addDays(floorIso, 1);
  if (first > todayIso) { return []; } // everything up to today is closed — nothing to post
  var recentFrom = addDays(todayIso, -30);
  if (recentFrom < first) { recentFrom = first; }
  var out = [[recentFrom, todayIso]];
  if (fullCatchUp) {
    var from = first;
    while (from < recentFrom) {
      var to = addDays(from, 30);
      var lastBefore = addDays(recentFrom, -1);
      if (to > lastBefore) { to = lastBefore; }
      out.push([from, to]);
      from = addDays(to, 1);
    }
  }
  return out;
}

// One tick a day (the first one after 04:00 UTC) also walks the whole open
// period; every other tick covers the last 31 days only.
export function isDailyCatchUpTick(now) {
  var d = now instanceof Date ? now : new Date();
  return d.getUTCHours() === 4 && d.getUTCMinutes() < 15;
}
