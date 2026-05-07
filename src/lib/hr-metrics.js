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

function countWorkingDaysInPeriod(period) {
  // Mon-Fri counts as working days. Saturday-only weeks return 1 (minimum floor).
  // Timezone-immune: walks date strings via UTC anchors.
  if (!period || !period.from || !period.to) return 0;
  var cursor = period.from;
  var count = 0;
  while (cursor <= period.to) {
    var d = new Date(cursor + 'T12:00:00Z');
    var dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow >= 1 && dow <= 5) count++;
    cursor = shiftDateString(cursor, 1);
  }
  return Math.max(1, count);
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

  // ---- TICKETS ----
  // "Created" = ticket created in period BY this user
  var ticketsCreatedInPeriod = tickets.filter(function (t) {
    return t.created_by === userId && inPeriod(t.created_at, period);
  });
  // "Closed" = ticket closed in period BY this user (closed_by, closed_at)
  var ticketsClosedInPeriod = tickets.filter(function (t) {
    return t.closed_by === userId && t.closed_at && inPeriod(t.closed_at, period);
  });
  // Of those closed, how many were on-time?
  var closedOnTime = ticketsClosedInPeriod.filter(function (t) {
    if (!t.due_date) return true; // no deadline = counts as on time
    return new Date(t.closed_at) <= new Date(t.due_date + 'T23:59:59');
  });
  var closedLate = ticketsClosedInPeriod.length - closedOnTime.length;
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
  // Currently overdue (point-in-time)
  var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  var overdueNow = openTickets.filter(function (t) {
    return t.due_date && t.due_date < todayStr;
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
    avgDaysToClose: avgDaysToClose,
    openTickets: openTickets.length,
    overdueNow: overdueNow.length,
    ticketComments: commentsByThisUserInPeriod.length,
    commentsPerTicket: commentsPerAssignedTicket,
    lateEdits: lateEdits.length,
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
// SCORING — provisional formula. Tunable.
// ----------------------------------------------------------------------
//
// v55.65 — algorithm refresh based on what mature HR software (Lattice,
// 15Five, Culture Amp, Workday Talent) actually measures:
//
//   PRODUCTIVITY  (35%)   — output volume across all categories
//   QUALITY       (15%)   — your output is good (low rework, low overdue,
//                            tickets you file actually get fixed, you
//                            attend the meetings you organize, etc.)
//   TIMELINESS    (20%)   — closes things on time, low overdue, replies fast
//   ENGAGEMENT    (20%)   — variety + daily log + meetings attended
//   RELIABILITY   (10%)   — meeting show-up rate + retest follow-through
//
// Each sub-score is normalized 0–100 against the team where applicable
// (relative scoring) — except QUALITY/RELIABILITY which use absolute
// percentages because a 100% show-up rate should score 100 even on a
// small team.
//
// Coaching tone: the message you see on screen NEVER calls out a low
// score harshly. The MyPerformance UI deliberately keeps the score
// hidden from the self-view; only growth-oriented coach text is shown.
// The numeric score is admin-only via HRReport.

function calcScore(myMetrics, allTeamMetrics) {
  if (!myMetrics) return null;
  if (!Array.isArray(allTeamMetrics) || allTeamMetrics.length === 0) {
    return { score: null, productivity: null, quality: null, timeliness: null, engagement: null, reliability: null };
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

  // --- PRODUCTIVITY (volume across all categories, equal weight) ---
  // Includes meetings created (Max v55.65 request) + system tickets created.
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

  // --- QUALITY (v55.65 — new sub-score) ---
  // Signals: bugs you filed actually got fixed; quotes you sent got accepted;
  // tickets you closed weren't reopened; you ATTENDED meetings you organized.
  // Each of these is an absolute % so a small-team person isn't hurt.
  var quality_quoteAccept = (myMetrics.quotesSent > 0)
    ? Math.round((myMetrics.quotesAccepted / myMetrics.quotesSent) * 100)
    : null;
  var quality_bugFixRate = ((myMetrics.systemTicketsCreated || 0) > 0)
    ? Math.round(((myMetrics.systemTicketsFixed || 0) / myMetrics.systemTicketsCreated) * 100)
    : null;
  var quality_meetingShowup = (myMetrics.meetingShowUpPct == null) ? null : myMetrics.meetingShowUpPct;
  // overdue is bad — invert it
  var quality_lowOverdue = Math.max(0, 100 - 15 * (myMetrics.overdueNow || 0));
  // late-edits is bad — invert it (capped at 0)
  var quality_fewLateEdits = Math.max(0, 100 - 5 * (myMetrics.lateEdits || 0));
  var qualityInputs = [quality_quoteAccept, quality_bugFixRate, quality_meetingShowup, quality_lowOverdue, quality_fewLateEdits];
  var qualityValid = qualityInputs.filter(function (q) { return q != null; });
  var quality = qualityValid.length > 0
    ? Math.round(qualityValid.reduce(function (a, b) { return a + b; }, 0) / qualityValid.length)
    : 70; // baseline if no quality signals available yet

  // --- TIMELINESS (on-time closes %, low overdue, comments/ticket) ---
  var ot = myMetrics.onTimePct == null ? 70 : myMetrics.onTimePct;
  var overdueSig = Math.max(0, 100 - 10 * (myMetrics.overdueNow || 0));
  var commentsSig = Math.round(safeRatio(myMetrics.commentsPerTicket, maxOf('commentsPerTicket')) * 100);
  var timeliness = Math.round((ot + overdueSig + commentsSig) / 3);

  // --- ENGAGEMENT (daily log fill, meetings attended, variety of activity) ---
  var fillSig = myMetrics.manualFillRatePct || 0;  // already 0-100
  var meetingSig = Math.round(safeRatio(myMetrics.attendedEvents, maxOf('attendedEvents')) * 100);
  var checkInSig = Math.round(safeRatio(myMetrics.meetingsCheckedIn || 0, maxOf('meetingsCheckedIn')) * 100);
  var variety = 0; // count categories with non-zero activity
  if (myMetrics.ticketsClosed > 0) variety++;
  if (myMetrics.ratesAdded > 0) variety++;
  if (myMetrics.quotesCreated > 0) variety++;
  if (myMetrics.crmLogEntries > 0 || myMetrics.contactTouches > 0) variety++;
  if (myMetrics.attendedEvents > 0 || myMetrics.meetingsCheckedIn > 0) variety++;
  if (myMetrics.manualEntries > 0) variety++;
  if ((myMetrics.systemTicketsCreated || 0) > 0) variety++;
  var varietySig = Math.round((variety / 7) * 100);
  var engagement = Math.round((fillSig + meetingSig + checkInSig + varietySig) / 4);

  // --- RELIABILITY (v55.65 — new sub-score, absolute) ---
  // Meeting show-up rate + retesting bugs you reported. Pure follow-through.
  var reliability_show = (myMetrics.meetingShowUpPct == null) ? null : myMetrics.meetingShowUpPct;
  var reliability_retest = ((myMetrics.systemTicketsCreated || 0) > 0)
    ? Math.round(((myMetrics.systemTicketsRetested || 0) / Math.max(1, (myMetrics.systemTicketsFixed || 0))) * 100)
    : null;
  var reliabilityInputs = [reliability_show, reliability_retest];
  var reliabilityValid = reliabilityInputs.filter(function (q) { return q != null; });
  var reliability = reliabilityValid.length > 0
    ? Math.min(100, Math.round(reliabilityValid.reduce(function (a, b) { return a + b; }, 0) / reliabilityValid.length))
    : 70;

  // Weighted total — matches the % weights in the comment block above.
  var score = Math.round(
    productivity * 0.35
    + quality * 0.15
    + timeliness * 0.20
    + engagement * 0.20
    + reliability * 0.10
  );

  return {
    score: score,
    productivity: productivity,
    quality: quality,
    timeliness: timeliness,
    engagement: engagement,
    reliability: reliability,
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
};
