// ============================================================
// MORNING BRIEFING ENGINE — Phase 2 / S13 (Apr 22 2026)
//
// What it does in plain English:
//   When you log in for the first time today, instead of dumping every
//   ticket and overdue invoice on you, this scans EVERYTHING and picks
//   the 3 most important things you should do FIRST.
//
//   Each item has a clear action you can do with one tap.
//
// Inputs (passed in from caller — server route or client builder):
//   - tickets, invoices, treasury, checks, customers, follow_ups,
//     calendar_events, login_events
//   - userId of the person logging in
//   - now timestamp (ET)
//
// Output:
//   {
//     top3: [
//       { id, title, why, urgency, action_label, action_type, action_payload },
//       ...
//     ],
//     deferred_count: 12,    // how many other things are stacked but not urgent
//     all_clear: false,      // true when nothing pressing
//     headline: "3 things need you today" // ready-to-display sentence
//   }
//
// Scoring philosophy:
//   - Money waiting to be collected from a customer >> all else (cash flow is king)
//   - A ticket flagged URGENT and overdue >> normal-priority overdue
//   - A meeting in the next 2 hours >> meeting later today
//   - A check bouncing risk >> general overdue invoice
//   - A customer who hasn't been contacted in 60+ days >> recent contact
//
// Each signal type has its own scorer that returns a score 0-100.
// The top 3 across ALL signal types is what makes it into the briefing.
// ============================================================

function dayDiff(a, b) {
  // Days between two dates (ignoring time)
  if (!a || !b) return 0;
  var ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400000);
}

function fmtDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return 'in ' + n + ' days';
  return Math.abs(n) + ' days ago';
}

function fmtMoney(n) {
  if (!n || isNaN(n)) return '0 EGP';
  return Math.round(n).toLocaleString() + ' EGP';
}

// ---------- SIGNAL SCORERS ----------
// Each scorer returns an array of candidate items. Each item has:
//   { score, title, why, urgency, action_label, action_type, action_payload }

function scoreOverdueInvoices(invoices, todayStr) {
  var items = [];
  (invoices || []).forEach(function(inv) {
    var owed = Number(inv.outstanding || 0);
    if (owed <= 0) return;
    var invDate = inv.invoice_date;
    if (!invDate) return;
    var daysOld = dayDiff(invDate, todayStr);
    if (daysOld < 30) return; // not overdue yet

    // Score = days overdue * money owed (logarithmic)
    var moneyFactor = Math.min(40, Math.log10(owed + 1) * 8); // 8 to 40 based on size
    var ageFactor = Math.min(40, (daysOld - 30) * 0.5); // ramps up after 30 days
    var score = 20 + moneyFactor + ageFactor; // base 20, max ~100

    var custName = inv.customer_name_en || inv.customer_name || 'Customer';
    items.push({
      score: score,
      kind: 'overdue_invoice',
      title: custName + ' owes ' + fmtMoney(owed),
      why: 'Invoice ' + (inv.order_number || inv.invoice_number || '') + ' is ' + daysOld + ' days old',
      urgency: daysOld > 90 ? 'critical' : daysOld > 60 ? 'high' : 'medium',
      action_label: 'Draft chase message',
      action_type: 'draft_collection_message',
      action_payload: { invoice_id: inv.id, customer_name: custName, owed: owed, days_old: daysOld, order_number: inv.order_number },
      ref_id: inv.id
    });
  });
  return items;
}

function scoreOverdueTickets(tickets, userId, todayStr) {
  var items = [];
  (tickets || []).forEach(function(t) {
    if (t.status === 'Closed') return;
    if (t.assigned_to !== userId) return;
    if (!t.due_date) return;
    var daysOverdue = dayDiff(t.due_date, todayStr);
    if (daysOverdue <= 0) return;

    // Priority weighting
    var prMul = (t.priority === 'high' || t.priority === 'urgent') ? 1.5
              : (t.priority === 'low') ? 0.6 : 1.0;
    var ageFactor = Math.min(50, daysOverdue * 4); // 1 day = +4, capped at 50
    var score = (40 + ageFactor) * prMul;

    items.push({
      score: score,
      kind: 'overdue_ticket',
      title: (t.ticket_number || '') + ' ' + (t.title || '').substring(0, 60),
      why: 'Was due ' + fmtDays(-daysOverdue) + ' (' + (t.priority || 'normal') + ' priority)',
      urgency: daysOverdue > 7 ? 'critical' : daysOverdue > 3 ? 'high' : 'medium',
      action_label: 'Open ticket',
      action_type: 'open_ticket',
      action_payload: { ticket_id: t.id, ticket_number: t.ticket_number },
      ref_id: t.id
    });
  });
  return items;
}

function scoreUnacknowledgedTickets(tickets, userId, todayStr) {
  var items = [];
  (tickets || []).forEach(function(t) {
    if (t.status !== 'New') return;
    if (t.assigned_to !== userId) return;
    var daysOld = dayDiff(t.created_at, todayStr);
    if (daysOld < 1) return; // assigned today, not yet stale

    var prMul = (t.priority === 'high' || t.priority === 'urgent') ? 1.4 : 1.0;
    var score = (25 + Math.min(30, daysOld * 5)) * prMul;

    items.push({
      score: score,
      kind: 'unacked_ticket',
      title: (t.ticket_number || '') + ' ' + (t.title || '').substring(0, 60),
      why: 'Assigned ' + daysOld + ' days ago — never opened',
      urgency: daysOld > 5 ? 'high' : 'medium',
      action_label: 'Acknowledge',
      action_type: 'open_ticket',
      action_payload: { ticket_id: t.id, ticket_number: t.ticket_number },
      ref_id: t.id
    });
  });
  return items;
}

function scoreImminentMeetings(events, userId, todayStr, nowMs) {
  var items = [];
  (events || []).forEach(function(e) {
    if (e.event_date !== todayStr) return;
    // Not assigned to this user (also covers unassigned)
    if (e.assigned_to && e.assigned_to !== userId) return;

    // How close is the meeting?
    var startMs = nowMs;
    if (e.event_time) {
      try {
        startMs = new Date(todayStr + 'T' + e.event_time).getTime();
      } catch (er) {}
    }
    var minsAway = Math.round((startMs - nowMs) / 60000);
    if (minsAway < -30) return; // happened over 30 min ago — past us

    var score;
    if (minsAway <= 30 && minsAway >= -10) score = 95; // happening NOW
    else if (minsAway <= 120) score = 80; // within 2 hours
    else if (minsAway <= 360) score = 55; // within 6 hours
    else score = 35; // later today

    var label = minsAway <= 0 ? 'happening now' : 'in ' + minsAway + ' min';

    items.push({
      score: score,
      kind: 'meeting',
      title: (e.title || 'Meeting') + (e.event_time ? ' @ ' + e.event_time : ''),
      why: 'Scheduled for ' + label + (e.description ? ' — ' + e.description.substring(0, 60) : ''),
      urgency: minsAway <= 30 ? 'critical' : minsAway <= 120 ? 'high' : 'medium',
      action_label: 'View calendar',
      action_type: 'open_calendar',
      action_payload: { event_id: e.id, event_date: e.event_date },
      ref_id: e.id
    });
  });
  return items;
}

function scorePendingChecks(checks, todayStr) {
  var items = [];
  (checks || []).forEach(function(c) {
    if (c.status !== 'pending') return;
    if (!c.due_date) return;
    var daysToClear = dayDiff(todayStr, c.due_date);
    if (daysToClear > 7) return; // not pressing

    var amt = Number(c.amount || 0);
    var moneyFactor = Math.min(30, Math.log10(amt + 1) * 6);
    var score;
    if (daysToClear < 0) score = 75 + moneyFactor; // overdue check
    else if (daysToClear === 0) score = 60 + moneyFactor; // due today
    else score = 40 + moneyFactor; // due this week

    items.push({
      score: score,
      kind: 'pending_check',
      title: 'Check ' + (c.check_number || '') + ' for ' + fmtMoney(amt),
      why: daysToClear < 0 ? 'Was due ' + fmtDays(daysToClear) + ' — needs follow-up' :
           daysToClear === 0 ? 'Due today — confirm clearance' :
           'Due ' + fmtDays(daysToClear),
      urgency: daysToClear < 0 ? 'critical' : daysToClear === 0 ? 'high' : 'medium',
      action_label: 'Open check',
      action_type: 'open_check',
      action_payload: { check_id: c.id, check_number: c.check_number },
      ref_id: c.id
    });
  });
  return items;
}

function scoreStaleFollowUps(followUps, userId, todayStr) {
  var items = [];
  (followUps || []).forEach(function(f) {
    if (f.completed) return;
    if (f.assigned_to && f.assigned_to !== userId) return;
    var daysOverdue = f.due_date ? dayDiff(f.due_date, todayStr) : 0;
    if (daysOverdue < 0) return; // not yet due

    var score = 30 + Math.min(35, daysOverdue * 3);
    items.push({
      score: score,
      kind: 'follow_up',
      title: (f.task || 'Follow-up').substring(0, 60),
      why: daysOverdue === 0 ? 'Due today' : 'Was due ' + fmtDays(-daysOverdue),
      urgency: daysOverdue > 7 ? 'high' : 'medium',
      action_label: 'Open CRM',
      action_type: 'open_crm',
      action_payload: { follow_up_id: f.id, customer_id: f.customer_id },
      ref_id: f.id
    });
  });
  return items;
}

function scoreColdCustomers(customers, invoices, userId, todayStr) {
  // VIP customers (had high revenue last 12 months) who haven't been contacted in 60+ days.
  // This is a "relationship maintenance" signal.
  var items = [];
  if (!customers || !invoices) return items;
  var custRevenue = {};
  var custLastContact = {};
  invoices.forEach(function(inv) {
    var cid = inv.customer_id || inv.customer_name;
    if (!cid) return;
    custRevenue[cid] = (custRevenue[cid] || 0) + Number(inv.total_collected || 0);
    var d = inv.invoice_date || '';
    if (d > (custLastContact[cid] || '')) custLastContact[cid] = d;
  });
  customers.forEach(function(c) {
    var cid = c.id || c.name;
    var rev = custRevenue[cid] || 0;
    if (rev < 100000) return; // not a VIP
    var lastContact = custLastContact[cid];
    if (!lastContact) return;
    var daysSilent = dayDiff(lastContact, todayStr);
    if (daysSilent < 60) return; // recent enough
    if (daysSilent > 365) return; // truly dormant — different conversation

    var score = 25 + Math.min(20, (daysSilent - 60) / 6);
    items.push({
      score: score,
      kind: 'cold_customer',
      title: (c.name_en || c.name || 'Customer') + ' — silent for ' + daysSilent + ' days',
      why: 'VIP customer (' + fmtMoney(rev) + ' revenue) with no activity in ' + daysSilent + ' days',
      urgency: 'medium',
      action_label: 'Open customer',
      action_type: 'open_customer',
      action_payload: { customer_id: c.id, customer_name: c.name },
      ref_id: c.id
    });
  });
  return items;
}

// ---------- MAIN ENGINE ----------

function buildBriefing(input) {
  var todayStr = input.todayStr;
  var nowMs = input.nowMs || Date.now();
  var userId = input.userId;

  var allItems = []
    .concat(scoreOverdueInvoices(input.invoices, todayStr))
    .concat(scoreOverdueTickets(input.tickets, userId, todayStr))
    .concat(scoreUnacknowledgedTickets(input.tickets, userId, todayStr))
    .concat(scoreImminentMeetings(input.calendar_events, userId, todayStr, nowMs))
    .concat(scorePendingChecks(input.checks, todayStr))
    .concat(scoreStaleFollowUps(input.follow_ups, userId, todayStr))
    .concat(scoreColdCustomers(input.customers, input.invoices, userId, todayStr));

  // Dedupe by ref_id+kind so the same ticket can't appear twice
  var seen = {};
  var unique = [];
  allItems.forEach(function(it) {
    var key = it.kind + ':' + (it.ref_id || it.title);
    if (seen[key]) return;
    seen[key] = true;
    unique.push(it);
  });

  // Sort by score descending
  unique.sort(function(a, b) { return b.score - a.score; });

  // Take top 3 — but only if their score is meaningful (>= 25)
  var top3 = unique.filter(function(it) { return it.score >= 25; }).slice(0, 3);

  var deferred = unique.length - top3.length;
  var allClear = top3.length === 0;

  var headline;
  if (allClear) {
    headline = "All clear — nothing urgent today.";
  } else if (top3.length === 1) {
    headline = "1 thing needs your attention today.";
  } else {
    headline = top3.length + " things need your attention today.";
  }
  if (deferred > 0 && !allClear) {
    headline += " (" + deferred + " others can wait.)";
  }

  return {
    top3: top3,
    deferred_count: deferred,
    all_clear: allClear,
    headline: headline,
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  buildBriefing: buildBriefing,
  // Exported for tests
  _scorers: {
    scoreOverdueInvoices: scoreOverdueInvoices,
    scoreOverdueTickets: scoreOverdueTickets,
    scoreUnacknowledgedTickets: scoreUnacknowledgedTickets,
    scoreImminentMeetings: scoreImminentMeetings,
    scorePendingChecks: scorePendingChecks,
    scoreStaleFollowUps: scoreStaleFollowUps,
    scoreColdCustomers: scoreColdCustomers
  }
};

// ESM compatibility — Next.js (webpack/SWC) uses ES module imports.
// `module.exports` works for the tests; named ESM exports work in Next.
module.exports.buildBriefing = buildBriefing;
