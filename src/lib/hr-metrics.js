// HR Metrics Engine — v55.33 → v55.34
// =====================================
// Pure-function library that calculates per-person performance metrics.
// Used by BOTH the self-view (MyPerformance.jsx) and admin-view (HRReport.jsx)
// so the numbers always match across both screens.
//
// No React, no Supabase calls — just data in, metrics out.
// All callers must pre-fetch the relevant tables and pass them in.
//
// Periods: 'yesterday' | '7d' | '30d' | '3mo' | '1y' | 'custom'

// ----------------------------------------------------------------------
// PERIOD HELPERS
// ----------------------------------------------------------------------

/**
 * Resolve a period name to {from, to} ISO date strings (YYYY-MM-DD), ET-aware.
 * 'yesterday' = the single day before today
 * '7d' = the 7 days ending today (inclusive)
 * '30d' = the 30 days ending today
 * '3mo' = the ~90 days ending today
 * '1y' = the ~365 days ending today
 * 'custom' = pass {from, to} explicitly via the customRange arg
 */
function resolvePeriod(period, customRange) {
  var fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  var todayET = fmt.format(new Date());
  var shiftDays = function (n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return fmt.format(d);
  };

  if (period === 'yesterday') {
    var y = shiftDays(1);
    return { from: y, to: y, days: 1 };
  }
  if (period === '7d') return { from: shiftDays(6), to: todayET, days: 7 };
  if (period === '30d') return { from: shiftDays(29), to: todayET, days: 30 };
  if (period === '3mo') return { from: shiftDays(89), to: todayET, days: 90 };
  if (period === '1y') return { from: shiftDays(364), to: todayET, days: 365 };
  if (period === 'custom' && customRange && customRange.from && customRange.to) {
    var d1 = new Date(customRange.from);
    var d2 = new Date(customRange.to);
    var ms = d2.getTime() - d1.getTime();
    var days = Math.max(1, Math.round(ms / 86400000) + 1);
    return { from: customRange.from, to: customRange.to, days: days };
  }
  // default fallback: today
  return { from: todayET, to: todayET, days: 1 };
}

/**
 * Shift a YYYY-MM-DD date string by N days (positive or negative).
 * Timezone-immune: uses UTC noon as anchor so DST never bites us.
 */
function shiftDateString(dateStr, deltaDays) {
  var d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().substring(0, 10);
}

/**
 * Resolve the PRIOR matching period (for period-over-period comparisons).
 * E.g. for period='30d' returns the 30 days ending the day before period.from.
 */
function resolvePriorPeriod(currentPeriod) {
  if (!currentPeriod || !currentPeriod.from) return null;
  var days = currentPeriod.days || 1;
  var priorTo = shiftDateString(currentPeriod.from, -1);
  var priorFrom = shiftDateString(priorTo, -(days - 1));
  return { from: priorFrom, to: priorTo, days: days };
}

// ----------------------------------------------------------------------
// FILTER HELPERS — narrow a dataset to "rows in this period"
// ----------------------------------------------------------------------

function inPeriod(value, period) {
  if (!value) return false;
  var d = typeof value === 'string' ? value.substring(0, 10) : new Date(value).toISOString().substring(0, 10);
  return d >= period.from && d <= period.to;
}

// v55.80 (Phase B+ feedback from Max May 8 2026):
//   The team works 6 days a week. NOT Mon-Fri. NOT Sun-Thu. Just SIX days,
//   any six. So a "full work week" = 6 calendar days in a 7-day window.
//   workingDays for the period = floor((period_days * 6) / 7) — minimum 1.
//   This way:
//     - 7-day period → 6 working days
//     - 14-day period → 12 working days
//     - 30-day period → 26 working days
//   We never penalize a Sunday absence. We never reward a Saturday extra.
//   The bar is just: showed up 6 days a week.
function countWorkingDaysInPeriod(period) {
  if (!period || !period.from || !period.to) return 0;
  var cursor = period.from;
  var totalDays = 0;
  while (cursor <= period.to) {
    totalDays++;
    cursor = shiftDateString(cursor, 1);
  }
  // 6 of every 7 calendar days are "expected work" days.
  // Use Math.round so a 4-day period = 3, a 30-day period = 26 (not 25).
  return Math.max(1, Math.round((totalDays * 6) / 7));
}

// ----------------------------------------------------------------------
// CORE METRIC CALCULATION
// ----------------------------------------------------------------------

/**
 * Calculate ALL metrics for a single user in a given period.
 *
 * INPUTS (datasets — caller fetches and passes raw rows):
 *   userId          — UUID of the person being scored
 *   period          — {from, to, days}  (use resolvePeriod() to build)
 *   data            — { tickets, ticketComments, dailyLog, auditLog,
 *                       shippingRates, shippingBookings, customerQuotes,
 *                       calendarEvents, crmLeads, customers }
 *
 * OUTPUT: a flat metrics object — see end of function for all keys.
 */
function calcMetricsForUser(userId, period, data) {
  data = data || {};
  var tickets = data.tickets || [];
  var ticketComments = data.ticketComments || [];
  var dailyLog = data.dailyLog || [];
  var auditLog = data.auditLog || [];
  var shippingRates = data.shippingRates || [];
  var shippingBookings = data.shippingBookings || [];
  var customerQuotes = data.customerQuotes || [];
  var calendarEvents = data.calendarEvents || [];
  var customers = data.customers || []; // CRM uses customers table with assigned_rep
  // v55.80 — login sessions for the Presence sub-score (active days + avg
  // hours per day). Optional: older builds didn't pass this in; calc still
  // produces other metrics correctly with an empty array.
  var userSessions = data.userSessions || [];

  // ---- TICKETS ----
  // "Created" = ticket created in period BY this user
  var ticketsCreatedInPeriod = tickets.filter(function (t) {
    return t.created_by === userId && inPeriod(t.created_at, period);
  });
  // "Closed" = ticket closed in period BY this user (closed_by, closed_at)
  var ticketsClosedInPeriod = tickets.filter(function (t) {
    return t.closed_by === userId && t.closed_at && inPeriod(t.closed_at, period);
  });
  // v55.80 PHASE-B+ feedback (Max May 8 2026):
  //   "those priority list items have more power and then give more credit
  //    to when you don't finish it then the things are lowering your priority"
  //
  // Each priority level gets a weight. Closing on time = +weight. Closing
  // late = +0 (but still counts toward "closed"). Missing the deadline
  // (still open + overdue) = -0.5 × weight (penalty for letting high-priority
  // work rot).
  //
  // The bare on-time count (closedOnTime / closed) is preserved for back-compat.
  // The priority-weighted version is exposed as `priorityWeightedOnTimePct`
  // and used by the score formula's Timeliness component.
  var PRIORITY_WEIGHT = {
    urgent: 3.0,
    high:   2.0,
    medium: 1.0,
    low:    0.5,
    // No priority = treat as medium so untagged tickets aren't dropped.
    '': 1.0,
    null: 1.0,
    undefined: 1.0,
  };
  function getPriorityWeight(t) {
    var p = (t && t.priority) ? String(t.priority).toLowerCase() : '';
    return (PRIORITY_WEIGHT[p] != null) ? PRIORITY_WEIGHT[p] : 1.0;
  }
  // Of those closed, how many were on-time?
  var closedOnTime = ticketsClosedInPeriod.filter(function (t) {
    if (!t.due_date) return true; // no deadline = counts as on time
    return new Date(t.closed_at) <= new Date(t.due_date + 'T23:59:59');
  });
  var closedLate = ticketsClosedInPeriod.length - closedOnTime.length;

  // Priority-weighted on-time scoring
  var weightedEarned = 0;
  var weightedPossible = 0;
  ticketsClosedInPeriod.forEach(function (t) {
    var w = getPriorityWeight(t);
    weightedPossible += w;
    if (closedOnTime.indexOf(t) !== -1) weightedEarned += w;
    // late closures earn 0 weight but still count toward possible
  });
  var priorityWeightedOnTimePct = weightedPossible > 0
    ? Math.round((weightedEarned / weightedPossible) * 100)
    : null;

  // Per-priority closure breakdown (for explainScore)
  var closedByPriority = { urgent: 0, high: 0, medium: 0, low: 0 };
  var closedOnTimeByPriority = { urgent: 0, high: 0, medium: 0, low: 0 };
  ticketsClosedInPeriod.forEach(function (t) {
    var p = (t.priority || 'medium').toLowerCase();
    if (closedByPriority[p] === undefined) p = 'medium';
    closedByPriority[p]++;
    if (closedOnTime.indexOf(t) !== -1) closedOnTimeByPriority[p]++;
  });

  // Average days to close (closed in period)
  var avgDaysToClose = 0;
  if (ticketsClosedInPeriod.length > 0) {
    var totalDays = 0;
    ticketsClosedInPeriod.forEach(function (t) {
      var open = new Date(t.created_at).getTime();
      var close = new Date(t.closed_at).getTime();
      totalDays += Math.max(0, (close - open) / 86400000);
    });
    avgDaysToClose = Math.round((totalDays / ticketsClosedInPeriod.length) * 10) / 10;
  }
  // Currently open AND assigned to this user (point-in-time, not period-bound)
  var openTickets = tickets.filter(function (t) {
    return t.assigned_to === userId && t.status !== 'Closed';
  });
  // Currently overdue (point-in-time) — uses ET formatter inline since
  // this lib doesn't import et-time (kept self-contained for testability).
  var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  var overdueNow = openTickets.filter(function (t) {
    return t.due_date && t.due_date < todayStr;
  });
  // Priority-weighted overdue penalty signal — high-priority overdue tickets
  // hurt more than low-priority overdue. Used by Timeliness sub-score.
  var overdueWeightSum = overdueNow.reduce(function (sum, t) {
    return sum + getPriorityWeight(t);
  }, 0);
  var overdueByPriority = { urgent: 0, high: 0, medium: 0, low: 0 };
  overdueNow.forEach(function (t) {
    var p = (t.priority || 'medium').toLowerCase();
    if (overdueByPriority[p] === undefined) p = 'medium';
    overdueByPriority[p]++;
  });

  // ---- TICKET COMMENTS (frequency of updates — Max specifically asked) ----
  var commentsByThisUserInPeriod = ticketComments.filter(function (c) {
    return c.created_by === userId && inPeriod(c.created_at, period);
  });
  // Comments-per-assigned-ticket — engagement signal
  var assignedTickets = tickets.filter(function (t) {
    return t.assigned_to === userId;
  });
  var commentsPerAssignedTicket = assignedTickets.length > 0
    ? Math.round((commentsByThisUserInPeriod.length / assignedTickets.length) * 10) / 10
    : 0;

  // v55.82-W (Max May 12 2026 — "If something is on your priority board
  // and there has been no movement or comments on it. this should effect
  // negatively on you"): count OPEN priority-starred tickets assigned to
  // this user where neither the ticket nor its comments have moved in 24h.
  // Stagnant = no status change, no comment, no due-date change since
  // either starred_at (when they pinned it) or updated_at — whichever is
  // newer. A stagnant priority is a negative signal: it was important
  // enough to star, but nothing has happened with it.
  var STAGNANT_HOURS = 24;
  var stagnantPriorityTickets = assignedTickets.filter(function (t) {
    if (!t.starred_today) return false;
    if (t.status === 'Closed') return false;
    // Reference point: when did movement last happen on this ticket?
    var starredAt = t.starred_at || t.updated_at || t.created_at;
    if (!starredAt) return false;
    // Look for comments by this user on this ticket since starredAt.
    var hasRecentComment = (ticketComments || []).some(function (c) {
      if (c.ticket_id !== t.id) return false;
      if (!c.created_at) return false;
      return c.created_at > starredAt;
    });
    if (hasRecentComment) return false;
    // Look for an audit_log entry on this ticket since starredAt.
    var hasRecentMovement = (auditLog || []).some(function (a) {
      if (a.table_name !== 'tickets') return false;
      if (a.record_id !== t.id) return false;
      if (!a.created_at) return false;
      // Skip the very entry that recorded the star itself.
      if (a.action === 'star' || a.action === 'unstar') return false;
      return a.created_at > starredAt;
    });
    if (hasRecentMovement) return false;
    // Finally, has the ticket itself been updated since starredAt?
    // (updated_at is usually bumped on any field change.)
    if (t.updated_at && t.updated_at > starredAt) return false;
    // Now: is starredAt itself older than STAGNANT_HOURS? If they JUST
    // starred it 10 minutes ago, no penalty yet.
    var hoursSinceStar = (Date.now() - new Date(starredAt).getTime()) / 36e5;
    return hoursSinceStar >= STAGNANT_HOURS;
  });

  // ---- SHIPPING RATES ----
  // Use audit_log: 'shipping_rates' + 'create' by this user in period
  var ratesAddedInPeriod = auditLog.filter(function (a) {
    return a.table_name === 'shipping_rates'
      && a.action === 'create'
      && a.changed_by === userId
      && inPeriod(a.created_at, period);
  });
  // Bookings (separate count): use audit 'update' events with new_values.booked === true
  var bookingsInPeriod = auditLog.filter(function (a) {
    if (a.table_name !== 'shipping_rates' || a.action !== 'update') return false;
    if (a.changed_by !== userId) return false;
    if (!inPeriod(a.created_at, period)) return false;
    var nv = a.new_values || {};
    return nv.booked === true;
  });

  // ---- QUOTES ----
  var quotesCreatedInPeriod = customerQuotes.filter(function (q) {
    return q.created_by === userId && inPeriod(q.created_at, period);
  });
  var quotesSent = quotesCreatedInPeriod.filter(function (q) {
    return q.status === 'sent' || q.status === 'accepted';
  });
  var quotesAccepted = quotesCreatedInPeriod.filter(function (q) {
    return q.status === 'accepted';
  });

  // ---- CRM ----
  // Customers assigned to this user (point-in-time)
  var assignedCustomers = customers.filter(function (c) {
    return c.assigned_rep === userId;
  });
  // Pipeline-stage moves attributed to this user via audit_log (table=customers, action=update)
  var pipelineMovesInPeriod = auditLog.filter(function (a) {
    if (a.table_name !== 'customers' || a.action !== 'update') return false;
    if (a.changed_by !== userId) return false;
    if (!inPeriod(a.created_at, period)) return false;
    var ov = a.old_values || {};
    var nv = a.new_values || {};
    return nv.pipeline_stage && nv.pipeline_stage !== ov.pipeline_stage;
  });
  // CRM logs: any daily_log entry with category='crm' for this user in period
  var crmLogEntries = dailyLog.filter(function (l) {
    return l.user_id === userId
      && (l.log_category === 'crm' || (l.entry_text && l.entry_text.toLowerCase().indexOf('crm') >= 0))
      && inPeriod(l.log_date, period);
  });
  // Last-contact updates on customers (touched the last_contact_date in period)
  var contactTouches = auditLog.filter(function (a) {
    if (a.table_name !== 'customers' || a.action !== 'update') return false;
    if (a.changed_by !== userId) return false;
    if (!inPeriod(a.created_at, period)) return false;
    var nv = a.new_values || {};
    return nv.last_contact_date != null;
  });

  // ---- DAILY LOG ----
  var userLogsInPeriod = dailyLog.filter(function (l) {
    return l.user_id === userId && inPeriod(l.log_date, period);
  });
  var manualEntries = userLogsInPeriod.filter(function (l) {
    return !l.auto_generated;
  });
  var autoEntries = userLogsInPeriod.filter(function (l) {
    return l.auto_generated;
  });
  // Days they had ANY entry (manual OR auto — they at least did something)
  var activeDays = [].concat([...new Set(userLogsInPeriod.map(function (l) {
    return l.log_date;
  }))]).length;
  // Days they wrote a MANUAL entry (the spec: "daily log fill rate")
  var manualDays = [].concat([...new Set(manualEntries.map(function (l) {
    return l.log_date;
  }))]).length;
  var workingDays = countWorkingDaysInPeriod(period);
  var manualFillRatePct = workingDays > 0 ? Math.round((manualDays / workingDays) * 100) : 0;

  // ---- PRESENCE (v55.80 PHASE-B+ refactor — May 8 2026) ----
  //
  // Per Max May 8 2026, three things matter for "presence":
  //
  //   1. WORK WEEK = 6 of 7 days, any 6. (Already wired in
  //      countWorkingDaysInPeriod — no Mon-Fri assumption.)
  //
  //   2. TWO TABS = ONE SESSION. If a user has two browser tabs open
  //      from 10am-12pm and another tab from 11am-1pm, the unique
  //      time logged in is 10am-1pm = 3 hours, NOT 4. We MERGE
  //      overlapping intervals before counting hours.
  //
  //   3. TIME-ON-SYSTEM vs TIME-ACTIVE. "Tab open all night" should
  //      NOT count as 8 hours of work. We track:
  //         - openMinutes   = login_at → max(logout_at, last_seen)
  //         - activeMinutes = login_at → max(logout_at, last_active)
  //      The score uses ACTIVE minutes (capped at 12h/day). Open
  //      minutes show up as a comparison line on the breakdown so
  //      Max can see "tab was open 9h but only active 3h."
  //
  //   Login frequency is also tracked: loginCount = total valid
  //   sessions in period. Daily check-ins matter — "logging in
  //   throughout the day" beats "logging in once and leaving the
  //   tab open."
  var sessionsInPeriod = userSessions.filter(function (s) {
    if (!s || s.user_id !== userId) return false;
    var d = s.date || (s.login_at ? String(s.login_at).substring(0, 10) : null);
    if (!d) return false;
    return d >= period.from && d <= period.to;
  });
  // A session must have a valid login_at to count.
  var validSessions = sessionsInPeriod.filter(function (s) {
    if (!s.login_at) return false;
    var loginMs = new Date(s.login_at).getTime();
    if (isNaN(loginMs)) return false;
    return true;
  });
  var presentDateSet = new Set(validSessions.map(function (s) {
    return s.date || String(s.login_at || '').substring(0, 10);
  }));
  var presentDays = presentDateSet.size;

  // ----- INTERVAL MERGE per day (dedup overlapping tabs) -----
  // For each present day, build the list of (start, end-active, end-open)
  // intervals across all this user's sessions on that day, then MERGE
  // overlapping ones so we count each minute once.
  //
  // Helper: merge intervals using the classic "sort-by-start + sweep"
  // algorithm. O(n log n). Returns total minutes of UNION coverage.
  function mergeIntervalsTotalMinutes(intervals) {
    if (intervals.length === 0) return 0;
    var sorted = intervals.slice().sort(function (a, b) { return a[0] - b[0]; });
    var totalMs = 0;
    var curStart = sorted[0][0];
    var curEnd = sorted[0][1];
    for (var i = 1; i < sorted.length; i++) {
      var s = sorted[i][0];
      var e = sorted[i][1];
      if (s <= curEnd) {
        // overlap — extend current interval
        if (e > curEnd) curEnd = e;
      } else {
        // gap — commit current and start a new one
        totalMs += (curEnd - curStart);
        curStart = s;
        curEnd = e;
      }
    }
    totalMs += (curEnd - curStart);
    return totalMs / 60000;
  }
  // Build per-day buckets for both kinds of intervals.
  var openIntervalsByDay = {};   // (start, max(logout_at, last_seen))
  var activeIntervalsByDay = {}; // (start, max(logout_at, last_active))
  validSessions.forEach(function (s) {
    var startMs = new Date(s.login_at).getTime();
    if (!startMs || isNaN(startMs)) return;
    var d = s.date || String(s.login_at).substring(0, 10);
    // OPEN end = max(logout_at, last_seen)
    var openEndCandidates = [];
    if (s.logout_at) { var x = new Date(s.logout_at).getTime(); if (x && !isNaN(x)) openEndCandidates.push(x); }
    if (s.last_seen) { var y = new Date(s.last_seen).getTime(); if (y && !isNaN(y)) openEndCandidates.push(y); }
    if (openEndCandidates.length > 0) {
      var openEndMs = Math.max.apply(null, openEndCandidates);
      if (openEndMs > startMs) {
        if (!openIntervalsByDay[d]) openIntervalsByDay[d] = [];
        openIntervalsByDay[d].push([startMs, openEndMs]);
      }
    }
    // ACTIVE end = max(logout_at, last_active). If last_active is null
    // (legacy sessions, pre-migration), fall back to last_seen so we
    // don't zero-out historical data.
    var activeEndCandidates = [];
    if (s.logout_at) { var a = new Date(s.logout_at).getTime(); if (a && !isNaN(a)) activeEndCandidates.push(a); }
    if (s.last_active) {
      var b = new Date(s.last_active).getTime();
      if (b && !isNaN(b)) activeEndCandidates.push(b);
    } else if (s.last_seen) {
      // Legacy fallback when last_active wasn't tracked yet
      var c = new Date(s.last_seen).getTime();
      if (c && !isNaN(c)) activeEndCandidates.push(c);
    }
    if (activeEndCandidates.length > 0) {
      var activeEndMs = Math.max.apply(null, activeEndCandidates);
      if (activeEndMs > startMs) {
        if (!activeIntervalsByDay[d]) activeIntervalsByDay[d] = [];
        activeIntervalsByDay[d].push([startMs, activeEndMs]);
      }
    }
  });
  // Merge per day, cap each day at 12h, accumulate.
  var openMinutesByDay = {};
  var activeMinutesByDay = {};
  Object.keys(openIntervalsByDay).forEach(function (d) {
    var mins = mergeIntervalsTotalMinutes(openIntervalsByDay[d]);
    if (mins > 720) mins = 720;
    openMinutesByDay[d] = mins;
  });
  Object.keys(activeIntervalsByDay).forEach(function (d) {
    var mins = mergeIntervalsTotalMinutes(activeIntervalsByDay[d]);
    if (mins > 720) mins = 720;
    activeMinutesByDay[d] = mins;
  });
  var totalOpenMinutes = Object.keys(openMinutesByDay).reduce(function (a, d) {
    return a + openMinutesByDay[d];
  }, 0);
  var totalActiveMinutes = Object.keys(activeMinutesByDay).reduce(function (a, d) {
    return a + activeMinutesByDay[d];
  }, 0);
  var daysWithDuration = Object.keys(activeMinutesByDay).length;
  // avgActiveHoursPerDay averages over days WITH duration data only.
  // (If user logs in 5 days but only 3 have duration, average over 3.)
  var avgActiveHoursPerDay = daysWithDuration > 0
    ? Math.round((totalActiveMinutes / daysWithDuration / 60) * 10) / 10
    : 0;
  var avgOpenHoursPerDay = daysWithDuration > 0
    ? Math.round((totalOpenMinutes / daysWithDuration / 60) * 10) / 10
    : 0;
  // For backward compatibility — code/tests expect avgHoursPerDay name.
  // We map this to ACTIVE hours, since that's what actually matters now.
  var avgHoursPerDay = avgActiveHoursPerDay;
  var totalPresentMinutes = Math.round(totalActiveMinutes);

  // Presence rate: actual days here / expected work days in period.
  var presenceRatePct = workingDays > 0
    ? Math.min(100, Math.round((presentDays / workingDays) * 100))
    : 0;
  // Login frequency — total sessions, target = 6 per 7 days (workingDays).
  // Per Max May 8 2026: "they have to login at least 6 times a week."
  // Note: this is RAW session count (each open of a new tab/browser), so
  // someone with 2 tabs at once has 2 sessions but they get deduped in
  // the hours calc. The login count IS still 2 — we want to reward
  // checking back in, not punish having two tabs.
  var loginCount = validSessions.length;
  var expectedLogins = workingDays;
  var loginRatePct = expectedLogins > 0
    ? Math.min(100, Math.round((loginCount / expectedLogins) * 100))
    : 0;

  // ---- CALENDAR ----
  // Events the user CREATED in period (request from Max v55.65: count meetings
  // they organized as a productivity signal)
  var createdEvents = calendarEvents.filter(function (e) {
    if (e.created_by !== userId) return false;
    if (!inPeriod(e.event_date, period)) return false;
    return e.status !== 'cancelled';
  });
  // Events the user was assigned to (primary owner) in period
  var assignedEvents = calendarEvents.filter(function (e) {
    if (e.assigned_to !== userId) return false;
    if (!inPeriod(e.event_date, period)) return false;
    return e.status !== 'cancelled';
  });
  var completedEvents = assignedEvents.filter(function (e) {
    return e.completed === true;
  });
  // v55.65 — Meetings the user actually CHECKED IN to (sign-in proof of
  // attendance). The schema stores one checked_in_by UUID per event row,
  // so this counts meetings where THIS user was the one who checked in.
  // For recurring meetings each occurrence is its own row, so this works
  // for both one-off and series events.
  var checkedInEvents = calendarEvents.filter(function (e) {
    if (e.checked_in_by !== userId) return false;
    if (!inPeriod(e.event_date, period)) return false;
    return true;
  });
  // Of meetings the user CREATED, how many did they actually show up to?
  // This is the "meeting reliability" or show-up rate.
  var createdAndAttended = createdEvents.filter(function (e) {
    return e.checked_in_by === userId
      || (e.checked_in_at != null && e.assigned_to === userId)
      || e.event_status === 'attended';
  });
  var createdEventsThatHaveOccurred = createdEvents.filter(function (e) {
    // Only count toward show-up rate if the meeting date is on/before today.
    var todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    return (e.event_date || '') <= todayLocal;
  });
  var meetingShowUpPct = createdEventsThatHaveOccurred.length > 0
    ? Math.round((createdAndAttended.length / createdEventsThatHaveOccurred.length) * 100)
    : null; // null = no meetings yet held → don't penalize
  // Events the user was an ATTENDEE of (broader meeting attendance)
  var attendedEvents = calendarEvents.filter(function (e) {
    if (!Array.isArray(e.attendees) || e.attendees.indexOf(userId) < 0) return false;
    if (!inPeriod(e.event_date, period)) return false;
    return e.status !== 'cancelled';
  });
  var declinedEvents = attendedEvents.filter(function (e) {
    return Array.isArray(e.declined_by) && e.declined_by.indexOf(userId) >= 0;
  });

  // ---- SYSTEM TICKETS ----
  // v55.65 — bug-reports the user filed factor into the score. People who
  // surface issues that get fixed are doing valuable QA work for the team.
  // Pulled from data.systemTickets if the caller provided it (caller is
  // optional — older HR reports won't pass it, in which case we treat as 0).
  var systemTicketsAll = data.systemTickets || [];
  var systemTicketsCreated = systemTicketsAll.filter(function (t) {
    return t.created_by === userId && inPeriod(t.created_at, period);
  });
  // Of those, how many were actually fixed (a quality signal — not just
  // dumping noise into the queue, but reporting real reproducible bugs).
  var systemTicketsFixed = systemTicketsCreated.filter(function (t) {
    return t.claude_fixed_in_build_version || t.status === 'Resolved' || t.status === 'Closed' || t.status === 'Fixed';
  });
  // Tickets they retested in period — closes the loop, also a quality signal.
  var systemTicketsRetested = systemTicketsAll.filter(function (t) {
    return t.retest_completed_by === userId && t.retest_completed_at && inPeriod(t.retest_completed_at, period);
  });

  // ---- TOTAL ACTIVITY (umbrella signal) ----
  var totalActions = userLogsInPeriod.length;

  // ---- LATE EDITS (audit signal — number of edits 24h+ after creation) ----
  // We mark edits flagged with old_values + a 24h+ delta.  We compute it from the
  // raw audit_log rows since we don't have a flag column.  Skipping if old_values
  // missing.
  var lateEdits = auditLog.filter(function (a) {
    if (a.changed_by !== userId) return false;
    if (a.action !== 'update') return false;
    if (!inPeriod(a.created_at, period)) return false;
    if (!a.old_values || !a.old_values.created_at) return false;
    var orig = new Date(a.old_values.created_at).getTime();
    var edit = new Date(a.created_at).getTime();
    return (edit - orig) > 24 * 3600 * 1000;
  });

  // ---- ON-TIME % (composite) ----
  var onTimePct = ticketsClosedInPeriod.length > 0
    ? Math.round((closedOnTime.length / ticketsClosedInPeriod.length) * 100)
    : null; // null = no closures in period (don't penalize)

  return {
    userId: userId,
    period: period,
    // Tickets
    ticketsCreated: ticketsCreatedInPeriod.length,
    ticketsClosed: ticketsClosedInPeriod.length,
    ticketsClosedOnTime: closedOnTime.length,
    ticketsClosedLate: closedLate,
    onTimePct: onTimePct,
    // v55.80 PHASE-B+ — priority-weighted on-time (high-pri counts more)
    priorityWeightedOnTimePct: priorityWeightedOnTimePct,
    closedByPriority: closedByPriority,
    closedOnTimeByPriority: closedOnTimeByPriority,
    overdueByPriority: overdueByPriority,
    overdueWeightSum: Math.round(overdueWeightSum * 10) / 10,
    avgDaysToClose: avgDaysToClose,
    openTickets: openTickets.length,
    overdueNow: overdueNow.length,
    ticketComments: commentsByThisUserInPeriod.length,
    commentsPerTicket: commentsPerAssignedTicket,
    lateEdits: lateEdits.length,
    // v55.82-W — Priority-board stagnation count. Tickets starred for
    // today's focus that have had zero movement (no comment, no status
    // change, no due-date change) in 24+ hours. Counted as a negative
    // signal in the activity score below.
    stagnantPriorityCount: stagnantPriorityTickets.length,
    // Shipping
    ratesAdded: ratesAddedInPeriod.length,
    bookings: bookingsInPeriod.length,
    // Quotes
    quotesCreated: quotesCreatedInPeriod.length,
    quotesSent: quotesSent.length,
    quotesAccepted: quotesAccepted.length,
    // CRM
    assignedCustomers: assignedCustomers.length,
    pipelineMoves: pipelineMovesInPeriod.length,
    crmLogEntries: crmLogEntries.length,
    contactTouches: contactTouches.length,
    // Daily Log
    manualEntries: manualEntries.length,
    autoEntries: autoEntries.length,
    activeDays: activeDays,
    manualDays: manualDays,
    workingDays: workingDays,
    manualFillRatePct: manualFillRatePct,
    // Presence (v55.80 PHASE-B+ — interval-merged, active-time aware)
    presentDays: presentDays,
    presenceRatePct: presenceRatePct,
    avgHoursPerDay: avgHoursPerDay,            // = avg ACTIVE hours/day (back-compat name)
    avgActiveHoursPerDay: avgActiveHoursPerDay, // explicit "real working time"
    avgOpenHoursPerDay: avgOpenHoursPerDay,    // "tab was open" — for comparison
    totalPresentMinutes: Math.round(totalActiveMinutes),
    totalActiveMinutes: Math.round(totalActiveMinutes),
    totalOpenMinutes: Math.round(totalOpenMinutes),
    // v55.80 (Max May 8 feedback) — login frequency.
    // "they have to login at least six times a week"
    loginCount: loginCount,
    expectedLogins: expectedLogins,
    loginRatePct: loginRatePct,
    // Calendar
    meetingsCreated: createdEvents.length,
    meetingsCreatedAndAttended: createdAndAttended.length,
    meetingsHeldFromMine: createdEventsThatHaveOccurred.length,
    meetingShowUpPct: meetingShowUpPct,
    meetingsCheckedIn: checkedInEvents.length,
    assignedEvents: assignedEvents.length,
    completedEvents: completedEvents.length,
    attendedEvents: attendedEvents.length,
    declinedEvents: declinedEvents.length,
    // System Tickets (v55.65)
    systemTicketsCreated: systemTicketsCreated.length,
    systemTicketsFixed: systemTicketsFixed.length,
    systemTicketsRetested: systemTicketsRetested.length,
    // Umbrella
    totalActions: totalActions,
  };
}

// ----------------------------------------------------------------------
// SCORING — v55.80 PHASE-B refactor (May 8 2026, per Max's feedback)
// ----------------------------------------------------------------------
//
// PHILOSOPHY (Max's words):
//   "Productivity relative" was confusing. The old formula divided each
//   person's count by the team's max — so if Omar's job isn't quotes,
//   he scored 0 on quotes even though he was busy doing invoicing.
//
//   The new heart of the score is ACTIVITY. Active people get rewarded.
//   The system measures: are they logging in regularly, creating meetings,
//   checking in to meetings, updating tickets, adding CRM notes, writing
//   in daily log? Each input is graded against a personal weekly target,
//   NOT against the team max. So a specialist who does 5 things in their
//   lane and 10 daily-log entries scores well.
//
//   This works on a 3-person team and a 30-person team because nothing
//   is graded against teammates anymore (except the small 5% productivity
//   tiebreaker, kept for the high-volume specialists).
//
// WEIGHT TABLE:
//   ACTIVITY      35%  — threshold-based, the heart of the score
//   TIMELINESS    20%  — on-time ticket closes, low overdue, comments
//   PRESENCE      15%  — showed up 6 of 7 days (Max's working-week rule)
//   QUALITY       15%  — quotes accepted, bugs fixed, low rework
//   RELIABILITY   10%  — meeting show-up + retest bugs you filed
//   PRODUCTIVITY   5%  — volume tiebreaker (relative, intentionally tiny)
//
// Total = 100. Activity + Presence + Reliability + Quality (75% of score)
// are all ABSOLUTE — same standard for everyone. Productivity is the
// only relative component, kept at 5% so the high-volume person gets a
// small bump but a specialist isn't punished.
//
// Coaching tone: the message you see on screen NEVER calls out a low
// score harshly. The MyPerformance UI deliberately keeps the score
// hidden from the self-view; only growth-oriented coach text is shown.
// The numeric score is admin-only via HRReport.

function calcScore(myMetrics, allTeamMetrics) {
  if (!myMetrics) return null;
  if (!Array.isArray(allTeamMetrics) || allTeamMetrics.length === 0) {
    return { score: null, activity: null, productivity: null, quality: null, timeliness: null, engagement: null, reliability: null, presence: null };
  }

  var maxOf = function (key) {
    var max = 0;
    allTeamMetrics.forEach(function (m) {
      if (m && typeof m[key] === 'number' && m[key] > max) max = m[key];
    });
    return max;
  };

  var safeRatio = function (val, max) {
    if (!max || max <= 0) return 0;
    return Math.min(1, Math.max(0, val / max));
  };

  // ---- ACTIVITY (35%) — the heart of the score ----------------------
  // Each input gets a personal-target threshold (per workingDay or per
  // period). Hitting target = 100. Doing nothing = 0. Doing more than
  // target = capped at 100 (don't double-count workhorses; that's what
  // Productivity below is for).
  //
  // The targets are set against a STANDARD WEEK. They scale with the
  // period — a 30-day period expects ~26 working days, so the target is
  // ~26/6 = 4.3x the weekly target. Period scale = workingDays / 6.
  //
  // Why these specific targets? They're calibrated to mid-tier
  // expectations for KTC's actual workflow: someone who's "doing their
  // job consistently" hits 80-100% activity. Slacking off shows up
  // immediately. Tunable in one place if Max says they're too lax/strict.
  var workingDays = myMetrics.workingDays || 1;
  var periodScale = workingDays / 6; // 6-day week as the baseline unit

  // Target: 6 logins per week (Max's rule — "they have to login at least
  // six times a week"). loginRatePct is already pct-of-target in v55.80.
  var activity_logins = myMetrics.loginRatePct == null ? 0 : myMetrics.loginRatePct;

  // Target: 1 meeting CREATED per week (organizing meetings = leadership)
  var activity_meetingsCreated = Math.min(100, Math.round(
    ((myMetrics.meetingsCreated || 0) / Math.max(1, periodScale)) * 100
  ));

  // Target: 3 meeting check-ins per week (showing up to scheduled work)
  var activity_meetingsCheckedIn = Math.min(100, Math.round(
    ((myMetrics.meetingsCheckedIn || 0) / Math.max(1, 3 * periodScale)) * 100
  ));

  // Target: 5 daily-log manual entries per week
  // (auto-entries don't count — must be intentional notes)
  var activity_dailyLog = Math.min(100, Math.round(
    ((myMetrics.manualEntries || 0) / Math.max(1, 5 * periodScale)) * 100
  ));

  // Target: 10 ticket comments per week (active ticket maintenance)
  var activity_ticketComments = Math.min(100, Math.round(
    ((myMetrics.ticketComments || 0) / Math.max(1, 10 * periodScale)) * 100
  ));

  // Target: 5 CRM touches OR log entries per week
  // (sales rep / account person being active with customers)
  var crmCombined = (myMetrics.contactTouches || 0) + (myMetrics.crmLogEntries || 0);
  var activity_crm = Math.min(100, Math.round(
    (crmCombined / Math.max(1, 5 * periodScale)) * 100
  ));

  // Target: 1 pipeline move per week (advancing deals, not letting them rot)
  var activity_pipeline = Math.min(100, Math.round(
    ((myMetrics.pipelineMoves || 0) / Math.max(1, periodScale)) * 100
  ));

  // Average all 7 activity inputs equally. Each is 0-100 already.
  var activityInputs = [
    activity_logins,
    activity_meetingsCreated,
    activity_meetingsCheckedIn,
    activity_dailyLog,
    activity_ticketComments,
    activity_crm,
    activity_pipeline,
  ];
  var activity = Math.round(
    activityInputs.reduce(function (a, b) { return a + b; }, 0) / activityInputs.length
  );

  // ---- PRODUCTIVITY (5%) — small relative tiebreaker -------------------
  // Kept at 5% so high-volume specialists get a small bump. NOT used to
  // punish people who don't do specialty work — that's why it's only 5%.
  // Inputs same as before.
  var prodInputs = [
    safeRatio(myMetrics.ticketsClosed, maxOf('ticketsClosed')),
    safeRatio(myMetrics.ratesAdded, maxOf('ratesAdded')),
    safeRatio(myMetrics.quotesCreated, maxOf('quotesCreated')),
    safeRatio(myMetrics.bookings, maxOf('bookings')),
    safeRatio(myMetrics.ticketsCreated, maxOf('ticketsCreated')),
    safeRatio(myMetrics.meetingsCreated || 0, maxOf('meetingsCreated')),
    safeRatio(myMetrics.systemTicketsCreated || 0, maxOf('systemTicketsCreated')),
  ];
  var productivity = Math.round((prodInputs.reduce(function (a, b) { return a + b; }, 0) / prodInputs.length) * 100);

  // ---- QUALITY (15%) — work quality, absolute ----
  // Signals: bugs you filed actually got fixed; quotes you sent got accepted;
  // tickets you closed weren't reopened; you ATTENDED meetings you organized.
  // Each of these is an absolute % so a small-team person isn't hurt.
  // BUG-7 FIX: cap at 100 in case data shows quotesAccepted > quotesSent.
  var quality_quoteAccept = (myMetrics.quotesSent > 0)
    ? Math.min(100, Math.round((myMetrics.quotesAccepted / myMetrics.quotesSent) * 100))
    : null;
  var quality_bugFixRate = ((myMetrics.systemTicketsCreated || 0) > 0)
    ? Math.min(100, Math.round(((myMetrics.systemTicketsFixed || 0) / myMetrics.systemTicketsCreated) * 100))
    : null;
  var quality_meetingShowup = (myMetrics.meetingShowUpPct == null) ? null : myMetrics.meetingShowUpPct;
  var quality_lowOverdue = Math.max(0, 100 - 15 * (myMetrics.overdueNow || 0));
  var quality_fewLateEdits = Math.max(0, 100 - 5 * (myMetrics.lateEdits || 0));
  var qualityInputs = [quality_quoteAccept, quality_bugFixRate, quality_meetingShowup, quality_lowOverdue, quality_fewLateEdits];
  var qualityValid = qualityInputs.filter(function (q) { return q != null; });
  var quality = qualityValid.length > 0
    ? Math.round(qualityValid.reduce(function (a, b) { return a + b; }, 0) / qualityValid.length)
    : 70;

  // ---- TIMELINESS (20%) — priority-aware on-time + low overdue + comments ----
  // v55.80 PHASE-B+ feedback (Max May 8 2026):
  //   "those priority list items have more power and then give more credit
  //    to when you don't finish it then the things are lowering your priority"
  //
  // Use priority-weighted on-time % when available (rewards finishing
  // high-priority work). Fall back to bare on-time % if no closures.
  // Overdue penalty uses priority-weighted sum: each high-pri overdue
  // ticket hurts more than a low-pri overdue one.
  var ot = myMetrics.priorityWeightedOnTimePct != null
    ? myMetrics.priorityWeightedOnTimePct
    : (myMetrics.onTimePct == null ? 70 : myMetrics.onTimePct);
  // Overdue penalty: 10 points per priority-unit (urgent=3, high=2, medium=1, low=0.5).
  // Three overdue urgent tickets = -90, three overdue lows = -15.
  var overduePenalty = 10 * (myMetrics.overdueWeightSum || (myMetrics.overdueNow || 0));
  var overdueSig = Math.max(0, 100 - overduePenalty);
  // Ticket comments per ticket — threshold is 1.5 comments/ticket (active)
  var commentsSig = Math.min(100, Math.round(((myMetrics.commentsPerTicket || 0) / 1.5) * 100));
  var timeliness = Math.round((ot + overdueSig + commentsSig) / 3);

  // ---- ENGAGEMENT (kept for back-compat, no longer in score) ---------
  // Old formula had Engagement at 15-20%. The new Activity sub-score
  // absorbs all of Engagement's signals. We still compute Engagement so
  // existing UI components that read it don't break, but it doesn't
  // contribute to `score` anymore. Will be removed in v55.81.
  var fillSig = myMetrics.manualFillRatePct || 0;
  var meetingSig = Math.round(safeRatio(myMetrics.attendedEvents, maxOf('attendedEvents')) * 100);
  var checkInSig = Math.round(safeRatio(myMetrics.meetingsCheckedIn || 0, maxOf('meetingsCheckedIn')) * 100);
  var variety = 0;
  if (myMetrics.ticketsClosed > 0) variety++;
  if (myMetrics.ratesAdded > 0) variety++;
  if (myMetrics.quotesCreated > 0) variety++;
  if (myMetrics.crmLogEntries > 0 || myMetrics.contactTouches > 0) variety++;
  if (myMetrics.attendedEvents > 0 || myMetrics.meetingsCheckedIn > 0) variety++;
  if (myMetrics.manualEntries > 0) variety++;
  if ((myMetrics.systemTicketsCreated || 0) > 0) variety++;
  var varietySig = Math.round((variety / 7) * 100);
  var engagement = Math.round((fillSig + meetingSig + checkInSig + varietySig) / 4);

  // v55.82-W (Max May 12 2026 — "If something is on your priority board
  // and there has been no movement or comments on it. this should effect
  // negatively on you"): subtract 5 points per stagnant priority,
  // capped at 25 points off engagement. Stagnant = starred for today's
  // focus, no comment/status change/audit movement in 24+ hours.
  var stagnantPenalty = Math.min(25, (myMetrics.stagnantPriorityCount || 0) * 5);
  engagement = Math.max(0, engagement - stagnantPenalty);

  // ---- RELIABILITY (10%) — meeting show-up + retest follow-through ----
  var reliability_show = (myMetrics.meetingShowUpPct == null) ? null : myMetrics.meetingShowUpPct;
  var reliability_retest = ((myMetrics.systemTicketsFixed || 0) > 0)
    ? Math.min(100, Math.round(((myMetrics.systemTicketsRetested || 0) / myMetrics.systemTicketsFixed) * 100))
    : null;
  var reliabilityInputs = [reliability_show, reliability_retest];
  var reliabilityValid = reliabilityInputs.filter(function (q) { return q != null; });
  var reliability = reliabilityValid.length > 0
    ? Math.min(100, Math.round(reliabilityValid.reduce(function (a, b) { return a + b; }, 0) / reliabilityValid.length))
    : 70;

  // ---- PRESENCE (15%) — three signals balanced ----
  // Per Max May 8 2026 (PHASE-B+ feedback):
  //   "How long you've actually spent time on the system, how long you've
  //    been logged in, how long you've been actually active... how many
  //    times you've logged in during the day, how much is your active
  //    session that you are from a day-to-day basis."
  //
  // Three signals, weighted:
  //   ATTENDANCE  (40%) — % of working days they showed up at all
  //   ACTIVE HOURS (40%) — avg active hours/day vs 8h target. INTERVAL-
  //                       MERGED (two tabs at once = one session) and
  //                       computed from last_active not last_seen, so
  //                       "tab open all night" doesn't inflate.
  //   LOGIN FREQUENCY (20%) — total logins in period vs target (6/week).
  //                           Rewards "checking in throughout the day"
  //                           over "logged in once and forgot."
  //
  // If we have no presence data at all, return null and the formula
  // renormalizes around the other 5 components.
  var presence = null;
  if (myMetrics.workingDays > 0 && (myMetrics.presentDays != null || myMetrics.avgHoursPerDay != null || myMetrics.loginCount != null)) {
    var presence_attendance = myMetrics.presenceRatePct == null ? 0 : myMetrics.presenceRatePct;
    // Active-hours: 8h/day = 100, capped. Falls back to avgHoursPerDay
    // for old data where the explicit avgActiveHoursPerDay isn't set.
    var activeH = (myMetrics.avgActiveHoursPerDay != null)
      ? myMetrics.avgActiveHoursPerDay
      : (myMetrics.avgHoursPerDay || 0);
    var presence_hours = Math.round(Math.min(100, (activeH / 8) * 100));
    // Login frequency: rate-pct against target (6/week)
    var presence_logins = myMetrics.loginRatePct == null ? 0 : myMetrics.loginRatePct;
    presence = Math.round(
      presence_attendance * 0.40
      + presence_hours    * 0.40
      + presence_logins   * 0.20
    );
  }

  // ---- WEIGHTED TOTAL ----
  //   ACTIVITY 35%  +  TIMELINESS 20%  +  PRESENCE 15%
  // + QUALITY  15%  +  RELIABILITY 10% +  PRODUCTIVITY 5%   = 100%
  //
  // If Presence is null (older deployment without user_sessions data),
  // its 15% redistributes proportionally to the other 5 components.
  var weightedSum = activity * 0.35
    + timeliness * 0.20
    + quality * 0.15
    + reliability * 0.10
    + productivity * 0.05;
  var totalWeight = 0.85;
  if (presence != null) {
    weightedSum += presence * 0.15;
    totalWeight = 1.00;
  }
  var score = Math.round(weightedSum / totalWeight);
  return {
    score: score,
    activity: activity,
    productivity: productivity,
    quality: quality,
    timeliness: timeliness,
    engagement: engagement,  // back-compat only
    reliability: reliability,
    presence: presence,
  };
}


// ----------------------------------------------------------------------
// PERIOD-OVER-PERIOD DELTAS (for self view "you vs you")
// ----------------------------------------------------------------------

function computeDeltas(currentMetrics, priorMetrics) {
  if (!currentMetrics || !priorMetrics) return {};
  var keys = ['ticketsClosed', 'ticketsCreated', 'ratesAdded', 'bookings',
    'quotesCreated', 'ticketComments', 'manualEntries', 'pipelineMoves',
    'attendedEvents',
    // v55.65 — new metrics in delta view
    'meetingsCreated', 'meetingsCheckedIn', 'systemTicketsCreated', 'systemTicketsRetested',
    'totalActions'];
  var out = {};
  keys.forEach(function (k) {
    var cur = currentMetrics[k] || 0;
    var prev = priorMetrics[k] || 0;
    var diff = cur - prev;
    var pct = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);
    out[k] = { current: cur, prior: prev, diff: diff, pct: pct };
  });
  return out;
}

// ----------------------------------------------------------------------
// SCORE BREAKDOWN — "Why this score?" plain-English explanation (v55.80)
// ----------------------------------------------------------------------
//
// Phase B / Section 4: takes the raw metrics + the calculated score
// object and returns a structured breakdown that the UI can render
// without any LLM call. Deterministic. Cheap. Trustworthy.
//
// Returns:
//   {
//     summary: "84 because tickets closed strong, 2 follow-ups missed",
//     drivers: [
//       { label: 'Productivity', value: 72, weight: 0.35,
//         contribution: 25.2, tone: 'good',
//         lines: ['12 tickets closed', '5 quotes created', ...] },
//       ...
//     ],
//     wins: ['Closed 12 tickets — 8 on time'],
//     concerns: ['3 tickets closed late', '2 follow-ups missed']
//   }
function explainScore(score, metrics) {
  if (!score || !metrics || score.score == null) {
    return { summary: 'Not enough data yet.', drivers: [], wins: [], concerns: [] };
  }

  var m = metrics;
  var s = score;

  // Tone classifier — same thresholds the score-color code uses.
  var tone = function (n) {
    if (n == null) return 'neutral';
    if (n >= 75) return 'good';
    if (n >= 50) return 'ok';
    if (n >= 25) return 'low';
    return 'poor';
  };

  // Drivers: each sub-score with its weight + a short list of the
  // underlying signals. Lines are the raw observed values, not
  // re-derived numbers — that way the user can verify them against
  // the metrics list shown elsewhere on the same card.
  var drivers = [];

  // ----- ACTIVITY (35%) — the lead driver, the heart of the score -----
  // Per Max May 8 2026: "the more active you are, that takes more
  // precedence to me." Activity is graded against personal-target
  // thresholds (logins per week, meetings per week, etc.) — NOT against
  // teammates. Specialists aren't punished for not doing other people's
  // work, and on a 3-person team the math doesn't go wild.
  var actLines = [];
  if (m.loginCount != null && m.loginCount > 0) {
    actLines.push('Logged in ' + m.loginCount + (m.expectedLogins ? ' of ' + m.expectedLogins + ' expected' : '') + ' (' + (m.loginRatePct || 0) + '%)');
  }
  if (m.meetingsCreated > 0) actLines.push('Organized ' + m.meetingsCreated + ' meeting' + (m.meetingsCreated === 1 ? '' : 's'));
  if (m.meetingsCheckedIn > 0) actLines.push('Checked into ' + m.meetingsCheckedIn + ' meeting' + (m.meetingsCheckedIn === 1 ? '' : 's'));
  if (m.manualEntries > 0) actLines.push(m.manualEntries + ' daily-log entr' + (m.manualEntries === 1 ? 'y' : 'ies'));
  if (m.ticketComments > 0) actLines.push(m.ticketComments + ' ticket comment' + (m.ticketComments === 1 ? '' : 's'));
  if (m.contactTouches > 0) actLines.push(m.contactTouches + ' customer touch' + (m.contactTouches === 1 ? 'point' : 'points'));
  if (m.crmLogEntries > 0) actLines.push(m.crmLogEntries + ' CRM log entr' + (m.crmLogEntries === 1 ? 'y' : 'ies'));
  if (m.pipelineMoves > 0) actLines.push(m.pipelineMoves + ' pipeline move' + (m.pipelineMoves === 1 ? '' : 's'));
  if (actLines.length === 0) actLines.push('No activity yet — start by logging in regularly and writing in your daily log');
  drivers.push({
    label: 'Activity', value: s.activity, weight: 0.35,
    contribution: Math.round(s.activity * 0.35 * 10) / 10,
    tone: tone(s.activity), lines: actLines,
    explainer: 'How active you are — logins, meetings created and checked into, daily log, ticket comments, CRM notes, pipeline moves. Each measured against a personal target so specialists aren\'t punished.',
  });

  // ----- TIMELINESS (20%) — priority-weighted -----
  var timeLines = [];
  if (m.ticketsClosed > 0) {
    var onTime = m.ticketsClosedOnTime || 0;
    var late = m.ticketsClosedLate || 0;
    timeLines.push(onTime + ' closed on time, ' + late + ' closed late');
    // Surface priority-weighted on-time if it differs from bare %
    if (m.priorityWeightedOnTimePct != null && m.onTimePct != null
        && Math.abs(m.priorityWeightedOnTimePct - m.onTimePct) >= 5) {
      timeLines.push('Priority-weighted on-time: ' + m.priorityWeightedOnTimePct + '% (high-priority tickets count more)');
    }
    // Show breakdown if there are closures across multiple priorities
    if (m.closedByPriority) {
      var pBreakdown = [];
      ['urgent', 'high', 'medium', 'low'].forEach(function (p) {
        var total = m.closedByPriority[p] || 0;
        var ontime = (m.closedOnTimeByPriority || {})[p] || 0;
        if (total > 0) pBreakdown.push(p + ': ' + ontime + '/' + total);
      });
      if (pBreakdown.length > 1) timeLines.push('By priority — ' + pBreakdown.join(', '));
    }
  }
  if (m.avgDaysToClose != null && m.ticketsClosed > 0) {
    timeLines.push('Avg ' + m.avgDaysToClose + ' day' + (m.avgDaysToClose === 1 ? '' : 's') + ' to close a ticket');
  }
  if (m.commentsPerTicket > 0) timeLines.push(m.commentsPerTicket + ' comment' + (m.commentsPerTicket === 1 ? '' : 's') + ' per assigned ticket');
  if (m.overdueNow > 0) {
    var overdueText = m.overdueNow + ' currently overdue';
    // Call out if any high-pri are overdue (the worst kind)
    var highPriOverdue = ((m.overdueByPriority || {}).urgent || 0) + ((m.overdueByPriority || {}).high || 0);
    if (highPriOverdue > 0) {
      overdueText += ' (' + highPriOverdue + ' high-priority — drags this down hard)';
    }
    timeLines.push(overdueText);
  }
  if (timeLines.length === 0) timeLines.push('No closed tickets in this period yet');
  drivers.push({
    label: 'Timeliness', value: s.timeliness, weight: 0.20,
    contribution: Math.round(s.timeliness * 0.20 * 10) / 10,
    tone: tone(s.timeliness), lines: timeLines,
    explainer: 'Closing things on time. High-priority tickets count more — finishing a high-pri on time is worth more than finishing a low-pri, and missing a high-pri hurts more.',
  });

  // ----- PRESENCE (15%) — three signals: attendance + active-time + logins -----
  if (s.presence != null) {
    var presLines = [];
    if (m.presentDays != null && m.workingDays > 0) {
      presLines.push('Showed up on ' + m.presentDays + ' of ' + m.workingDays + ' expected day' + (m.workingDays === 1 ? '' : 's') + ' (' + (m.presenceRatePct || 0) + '%)');
    }
    // Show ACTIVE hours (real working time) AND open hours (tab-was-up
    // time) when both differ — gives Max the "tab open all night" insight.
    var active = (m.avgActiveHoursPerDay != null) ? m.avgActiveHoursPerDay : m.avgHoursPerDay;
    if (active != null && active > 0) {
      var activeText = 'Averaged ' + active + 'h/day actively working';
      if (m.avgOpenHoursPerDay != null && m.avgOpenHoursPerDay > active + 1) {
        activeText += ' (tab was open ' + m.avgOpenHoursPerDay + 'h/day)';
      }
      presLines.push(activeText);
    }
    // Login frequency line — Max's #1 rule
    if (m.loginCount != null && m.expectedLogins > 0) {
      presLines.push('Logged in ' + m.loginCount + ' time' + (m.loginCount === 1 ? '' : 's') + ' (target ' + m.expectedLogins + ', ' + (m.loginRatePct || 0) + '%)');
    }
    if (presLines.length === 0) presLines.push('No login sessions recorded yet in this period');
    drivers.push({
      label: 'Presence', value: s.presence, weight: 0.15,
      contribution: Math.round(s.presence * 0.15 * 10) / 10,
      tone: tone(s.presence), lines: presLines,
      explainer: 'Showing up + actually working + checking in. 40% attendance (6 of 7 days), 40% active hours (real working time, not just tab-open), 20% login frequency.',
    });
  }

  // ----- QUALITY (15%) -----
  var qualLines = [];
  if (m.quotesSent > 0) {
    var pct = Math.min(100, Math.round((m.quotesAccepted / m.quotesSent) * 100));
    qualLines.push(m.quotesAccepted + ' of ' + m.quotesSent + ' quotes accepted (' + pct + '%)');
  }
  if (m.systemTicketsCreated > 0) {
    qualLines.push(m.systemTicketsFixed + ' of ' + m.systemTicketsCreated + ' filed bugs fixed');
  }
  if (m.meetingShowUpPct != null) qualLines.push('Showed up to ' + m.meetingShowUpPct + '% of meetings');
  if (m.overdueNow > 0) qualLines.push(m.overdueNow + ' ticket' + (m.overdueNow === 1 ? '' : 's') + ' currently overdue');
  if (m.lateEdits > 0) qualLines.push(m.lateEdits + ' late edit' + (m.lateEdits === 1 ? '' : 's') + ' (changed >24h after creation)');
  if (qualLines.length === 0) qualLines.push('No quality signals yet — once quotes get sent or meetings get booked, this fills in');
  drivers.push({
    label: 'Quality', value: s.quality, weight: 0.15,
    contribution: Math.round(s.quality * 0.15 * 10) / 10,
    tone: tone(s.quality), lines: qualLines,
    explainer: 'Did the work hold up — quotes accepted, bugs really fixed, low overdue count, few late edits.',
  });

  // ----- RELIABILITY (10%) -----
  var relLines = [];
  if (m.meetingShowUpPct != null) relLines.push(m.meetingShowUpPct + '% meeting show-up rate');
  if (m.systemTicketsFixed > 0) {
    relLines.push(m.systemTicketsRetested + ' of ' + m.systemTicketsFixed + ' fixed bugs retested');
  }
  if (relLines.length === 0) relLines.push('No reliability signals yet — once meetings happen or filed bugs get fixed, this fills in');
  drivers.push({
    label: 'Reliability', value: s.reliability, weight: 0.10,
    contribution: Math.round(s.reliability * 0.10 * 10) / 10,
    tone: tone(s.reliability), lines: relLines,
    explainer: 'Following through — showing up to meetings you said yes to, retesting bugs you reported.',
  });

  // ----- PRODUCTIVITY (5%) — small relative tiebreaker -----
  // Down-weighted from 30% in v55.80 PHASE-B refactor. Per Max May 8 2026:
  // a specialist who doesn't do quotes shouldn't score 0 on quotes —
  // their daily log + CRM activity is what matters. Productivity stays
  // for the high-volume workhorses to get a small bump.
  var prodLines = [];
  if (m.ticketsClosed > 0) prodLines.push(m.ticketsClosed + ' ticket' + (m.ticketsClosed === 1 ? '' : 's') + ' closed');
  if (m.ticketsCreated > 0) prodLines.push(m.ticketsCreated + ' ticket' + (m.ticketsCreated === 1 ? '' : 's') + ' opened');
  if (m.quotesCreated > 0) prodLines.push(m.quotesCreated + ' quote' + (m.quotesCreated === 1 ? '' : 's') + ' created');
  if (m.ratesAdded > 0) prodLines.push(m.ratesAdded + ' shipping rate' + (m.ratesAdded === 1 ? '' : 's') + ' added');
  if (m.bookings > 0) prodLines.push(m.bookings + ' booking' + (m.bookings === 1 ? '' : 's') + ' made');
  if (prodLines.length === 0) prodLines.push('No volume metrics in this period — that\'s OK if it\'s not your role');
  drivers.push({
    label: 'Productivity', value: s.productivity, weight: 0.05,
    contribution: Math.round(s.productivity * 0.05 * 10) / 10,
    tone: tone(s.productivity), lines: prodLines,
    explainer: 'Volume tiebreaker — small weight (5%) because specialists who do other things shouldn\'t be punished. Activity is what really matters.',
  });

  // ---- WINS / CONCERNS ----
  // Pulled from the most striking signals across the metrics. Wins shown
  // first (build people up), then concerns. Three of each at most so it
  // stays scannable.
  var wins = [];
  var concerns = [];

  if (m.ticketsClosedOnTime > 0 && m.ticketsClosedLate === 0) {
    wins.push('Closed ' + m.ticketsClosedOnTime + ' ticket' + (m.ticketsClosedOnTime === 1 ? '' : 's') + ' — all on time');
  } else if (m.ticketsClosedOnTime > m.ticketsClosedLate && m.ticketsClosedOnTime > 0) {
    wins.push('Closed ' + m.ticketsClosed + ' tickets (' + m.ticketsClosedOnTime + ' on time, ' + m.ticketsClosedLate + ' late)');
  }
  // v55.80 PHASE-B+ — high-priority on-time win
  if (m.closedByPriority) {
    var hiClosed = (m.closedByPriority.urgent || 0) + (m.closedByPriority.high || 0);
    var hiOnTime = ((m.closedOnTimeByPriority || {}).urgent || 0) + ((m.closedOnTimeByPriority || {}).high || 0);
    if (hiClosed >= 2 && hiOnTime === hiClosed) {
      wins.push('Closed ' + hiClosed + ' high-priority ticket' + (hiClosed === 1 ? '' : 's') + ' on time');
    }
  }
  if (m.quotesAccepted > 0) wins.push(m.quotesAccepted + ' quote' + (m.quotesAccepted === 1 ? '' : 's') + ' accepted by customers');
  if (m.manualFillRatePct >= 80) wins.push('Daily log fill rate ' + m.manualFillRatePct + '% — consistent');
  if (m.meetingShowUpPct != null && m.meetingShowUpPct >= 90) wins.push('Showed up to ' + m.meetingShowUpPct + '% of meetings');
  if (m.systemTicketsRetested > 0) wins.push('Retested ' + m.systemTicketsRetested + ' fixed bug' + (m.systemTicketsRetested === 1 ? '' : 's'));
  // Presence wins
  if (m.presenceRatePct != null && m.presenceRatePct >= 90 && m.workingDays >= 3) {
    wins.push('Showed up ' + m.presentDays + ' of ' + m.workingDays + ' expected days (' + m.presenceRatePct + '%)');
  }
  // Active hours win — uses ACTIVE not just OPEN time
  var winActive = (m.avgActiveHoursPerDay != null) ? m.avgActiveHoursPerDay : m.avgHoursPerDay;
  if (winActive != null && winActive >= 7) {
    wins.push('Averaged ' + winActive + 'h/day actively working');
  }
  // Login-frequency win — Max's "6 logins per week" rule
  if (m.loginRatePct != null && m.loginRatePct >= 90 && m.expectedLogins >= 3) {
    wins.push('Logged in ' + m.loginCount + ' time' + (m.loginCount === 1 ? '' : 's') + ' (target: ' + m.expectedLogins + ')');
  }

  // ----- CONCERNS — ordered by Max's priority -----
  // 1. Login frequency (Max's #1 rule)
  if (m.loginRatePct != null && m.loginRatePct < 50 && m.expectedLogins >= 3) {
    concerns.push('Only logged in ' + m.loginCount + ' time' + (m.loginCount === 1 ? '' : 's') + ' (expected at least ' + m.expectedLogins + ')');
  }
  // 2. High-priority overdue (drags Timeliness hard)
  if (m.overdueByPriority) {
    var hiOverdue = (m.overdueByPriority.urgent || 0) + (m.overdueByPriority.high || 0);
    if (hiOverdue > 0) {
      concerns.push(hiOverdue + ' high-priority ticket' + (hiOverdue === 1 ? '' : 's') + ' overdue right now');
    }
  }
  // 3. Presence (showed up < half the expected days)
  if (m.presenceRatePct != null && m.presenceRatePct < 50 && m.workingDays >= 3) {
    concerns.push('Only showed up ' + m.presentDays + ' of ' + m.workingDays + ' expected days');
  }
  // 4. Tab-open-but-idle — flag if open hours WAY exceed active hours
  if (m.avgOpenHoursPerDay != null && m.avgActiveHoursPerDay != null
      && m.avgOpenHoursPerDay >= 4 && m.avgOpenHoursPerDay - m.avgActiveHoursPerDay >= 4) {
    concerns.push('Tab open ' + m.avgOpenHoursPerDay + 'h/day but only active ' + m.avgActiveHoursPerDay + 'h');
  }
  // 5. Other timeliness/quality concerns (less urgent than the above)
  if (m.overdueNow > 0 && (!m.overdueByPriority || ((m.overdueByPriority.urgent || 0) + (m.overdueByPriority.high || 0)) === 0)) {
    concerns.push(m.overdueNow + ' ticket' + (m.overdueNow === 1 ? '' : 's') + ' currently overdue');
  }
  if (m.ticketsClosedLate > 0) concerns.push(m.ticketsClosedLate + ' ticket' + (m.ticketsClosedLate === 1 ? '' : 's') + ' closed past the due date');
  if (m.lateEdits > 0) concerns.push(m.lateEdits + ' late edit' + (m.lateEdits === 1 ? '' : 's') + ' — values changed >24h after creation');
  if (m.manualFillRatePct != null && m.manualFillRatePct < 40) concerns.push('Daily log only filled ' + m.manualFillRatePct + '% of working days');
  if (m.meetingShowUpPct != null && m.meetingShowUpPct < 60) concerns.push('Meeting show-up rate ' + m.meetingShowUpPct + '%');
  if (m.systemTicketsCreated > 0 && m.systemTicketsFixed === 0) concerns.push('Filed ' + m.systemTicketsCreated + ' bug' + (m.systemTicketsCreated === 1 ? '' : 's') + ' — none fixed yet');
  var concernActive = (m.avgActiveHoursPerDay != null) ? m.avgActiveHoursPerDay : m.avgHoursPerDay;
  if (concernActive != null && concernActive > 0 && concernActive < 3) {
    concerns.push('Averaged only ' + concernActive + 'h/day actively working');
  }

  // ---- SUMMARY LINE ----
  // Picked from the strongest driver + the top concern (if any).
  // Reads like Max's own internal thought: "84 because [strongest], but [concern]".
  var top = drivers.slice().sort(function (a, b) { return b.contribution - a.contribution; })[0];
  var summary = s.score + ' — ';
  if (top && top.tone === 'good') summary += top.label.toLowerCase() + ' is the strongest factor';
  else if (top) summary += top.label.toLowerCase() + ' is dragging this down (' + top.value + ')';
  else summary += 'mixed signals across the board';

  if (concerns.length > 0) {
    summary += '. ' + concerns[0];
  } else if (wins.length > 0) {
    summary += '. ' + wins[0];
  }

  return {
    summary: summary,
    drivers: drivers,
    wins: wins.slice(0, 3),
    concerns: concerns.slice(0, 3),
  };
}

// ----------------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------------

export {
  resolvePeriod,
  resolvePriorPeriod,
  inPeriod,
  countWorkingDaysInPeriod,
  calcMetricsForUser,
  calcScore,
  computeDeltas,
  explainScore,
};
