// /api/hr/performance-review — v55.83-NK (Max Aug 28 2026):
// "have the AI HR rep really have access to logs for previous year.. look at
// tickets and how they approach tickets, do they update them on time, stay on
// them consistently, closed before deadlines.. full look at when they logged
// in and how long they lasted in the system and if they log in consistently
// at around 6 days a week. a professional review performance report I as a
// manager can create and then input my own data on this."
//
// This route is the DATA half: it measures, from real records, and (optionally)
// has Jenna the HR rep draft a professional narrative from those measurements.
// It never writes anything — saving the review (with the manager's own input)
// is the screen's job, into hr_performance_reviews.
//
// MEASUREMENT HONESTY RULES
// - Attendance comes from user_sessions (login_at / logout_at / last_seen).
//   Sessions without a logout use last_seen; missing both counts 1 minute, and
//   every session is capped at 16h so a forgotten tab cannot fake a work week.
// - A ticket's close moment comes from the system comment "Status changed to
//   Closed" (written by the app on every status change) — far more reliable
//   than updated_at, which moves on any edit. No close comment = close time
//   unknown; the ticket counts as closed but is EXCLUDED from on-time maths
//   rather than guessed.
// - "On time" = closed on or before 23:59 of the due date. Tickets with no due
//   date cannot be early or late; they are reported separately, never blended.
// - The AI writes from the measurements ONLY; if the AI is unavailable the
//   metrics still return in full — the narrative is a convenience, not the data.
//
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var API_BUILD_MARKER = 'v55.83-NK-performance-review';
var SESSION_CAP_MIN = 16 * 60;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }
function pct(a, b) { return b > 0 ? Math.round(a / b * 1000) / 10 : null; }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var userId = body.user_id;
    var start = body.period_start;
    var end = body.period_end;
    var by = body.requester_id || null;
    var wantAi = body.want_ai !== false;
    if (!userId || !start || !end) { return NextResponse.json({ error: 'user_id, period_start and period_end are required.' }, { status: 400 }); }

    // Manager-level access only: the review reads a person's full activity record.
    var reqRes = await db.from('profiles').select('id, role, name').eq('id', by).single();
    var reqProf = reqRes && reqRes.data;
    if (!reqProf || (reqProf.role !== 'super_admin' && reqProf.role !== 'admin')) {
      return NextResponse.json({ error: 'Performance reviews are manager-level (Owner/Admin) only.' }, { status: 403 });
    }

    var empRes = await db.from('profiles').select('id, name, email, role, job_title').eq('id', userId).single();
    var emp = empRes && empRes.data;
    if (!emp) { return NextResponse.json({ error: 'Employee not found.' }, { status: 404 }); }

    // ── ATTENDANCE ────────────────────────────────────────────────
    var sesRes = await db.from('user_sessions')
      .select('date, login_at, logout_at, last_seen')
      .eq('user_id', userId).gte('date', start).lte('date', end)
      .order('login_at', { ascending: true });
    var sessions = (sesRes && sesRes.data) || [];

    var dayMinutes = {}; var loginHours = []; var i;
    for (i = 0; i < sessions.length; i++) {
      var sx = sessions[i];
      if (!sx.login_at) { continue; }
      var st = new Date(sx.login_at).getTime();
      var en = sx.logout_at ? new Date(sx.logout_at).getTime() : (sx.last_seen ? new Date(sx.last_seen).getTime() : st + 60000);
      var mins = Math.max(1, Math.min(SESSION_CAP_MIN, Math.round((en - st) / 60000)));
      var dkey = sx.date || String(sx.login_at).substring(0, 10);
      dayMinutes[dkey] = (dayMinutes[dkey] || 0) + mins;
      // Login hour in Egypt time (the team's working clock)
      try {
        var hCairo = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Cairo' }).format(new Date(sx.login_at)));
        if (!isNaN(hCairo)) { loginHours.push(hCairo); }
      } catch (eTz) {}
    }
    var activeDays = Object.keys(dayMinutes).sort();
    var totalMinutes = 0; activeDays.forEach(function (d) { totalMinutes += dayMinutes[d]; });

    // Weekly consistency vs the ~6-days-a-week expectation
    var weekDays = {};
    activeDays.forEach(function (d) {
      var dt = new Date(d + 'T12:00:00Z');
      var wk = new Date(dt); wk.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // Monday
      var wkey = wk.toISOString().substring(0, 10);
      weekDays[wkey] = (weekDays[wkey] || 0) + 1;
    });
    var weekKeys = Object.keys(weekDays);
    var weeks6plus = 0; var daySum = 0;
    weekKeys.forEach(function (w) { daySum += weekDays[w]; if (weekDays[w] >= 6) { weeks6plus += 1; } });

    // Longest consecutive-day streak
    var streak = 0; var best = 0; var prev = null;
    activeDays.forEach(function (d) {
      if (prev && (new Date(d) - new Date(prev)) === 86400000) { streak += 1; } else { streak = 1; }
      if (streak > best) { best = streak; }
      prev = d;
    });

    // Monthly breakdown
    var monthly = {};
    activeDays.forEach(function (d) {
      var mk = d.substring(0, 7);
      if (!monthly[mk]) { monthly[mk] = { month: mk, days: 0, hours: 0 }; }
      monthly[mk].days += 1;
      monthly[mk].hours += dayMinutes[d] / 60;
    });
    var monthlyArr = Object.keys(monthly).sort().map(function (k) { return { month: k, days: monthly[k].days, hours: r1(monthly[k].hours) }; });

    var avgLoginHour = null;
    if (loginHours.length) { var hs = 0; loginHours.forEach(function (h) { hs += h; }); avgLoginHour = r1(hs / loginHours.length); }

    var attendance = {
      total_sessions: sessions.length,
      active_days: activeDays.length,
      weeks_observed: weekKeys.length,
      avg_days_per_week: weekKeys.length ? r1(daySum / weekKeys.length) : 0,
      weeks_meeting_6_days: weeks6plus,
      six_day_adherence_pct: pct(weeks6plus, weekKeys.length),
      total_hours: r1(totalMinutes / 60),
      avg_hours_per_active_day: activeDays.length ? r1(totalMinutes / 60 / activeDays.length) : 0,
      avg_first_login_hour_cairo: avgLoginHour,
      longest_daily_streak: best,
      monthly: monthlyArr
    };

    // ── TICKETS ───────────────────────────────────────────────────
    var tixRes = await db.from('tickets')
      .select('id, ticket_number, title, status, priority, due_date, created_at, created_by, assigned_to, additional_assignees')
      .gte('created_at', start + 'T00:00:00Z').lte('created_at', end + 'T23:59:59Z');
    var allTix = (tixRes && tixRes.data) || [];
    var mine = [];
    for (i = 0; i < allTix.length; i++) {
      var t = allTix[i];
      var extra = String(t.additional_assignees || '');
      if (t.assigned_to === userId || extra.indexOf(userId) > -1) { mine.push(t); }
    }
    var mineIds = mine.map(function (t) { return t.id; });

    // Comments on their tickets + everything they wrote anywhere (chunked)
    var cRows = [];
    var chunks = []; for (i = 0; i < mineIds.length; i += 100) { chunks.push(mineIds.slice(i, i + 100)); }
    var ci;
    for (ci = 0; ci < chunks.length; ci++) {
      var cr = await db.from('ticket_comments').select('ticket_id, created_by, created_at, is_system, comment_text').in('ticket_id', chunks[ci]);
      var cd = (cr && cr.data) || [];
      for (i = 0; i < cd.length; i++) { cRows.push(cd[i]); }
    }
    var authoredRes = await db.from('ticket_comments')
      .select('ticket_id, created_at')
      .eq('created_by', userId).eq('is_system', false)
      .gte('created_at', start + 'T00:00:00Z').lte('created_at', end + 'T23:59:59Z');
    var authoredAll = (authoredRes && authoredRes.data) || [];

    // Close moments from system status comments
    var closedAt = {}; var reopens = {};
    for (i = 0; i < cRows.length; i++) {
      var c = cRows[i];
      if (c.is_system !== true) { continue; }
      var txt = String(c.comment_text || '');
      if (txt.indexOf('Status changed to Closed') > -1) {
        if (!closedAt[c.ticket_id] || c.created_at > closedAt[c.ticket_id]) { closedAt[c.ticket_id] = c.created_at; }
      }
      if (txt.indexOf('Status changed to Reopened') > -1) { reopens[c.ticket_id] = (reopens[c.ticket_id] || 0) + 1; }
    }
    // Their first human comment per ticket (responsiveness)
    var firstOwn = {};
    for (i = 0; i < cRows.length; i++) {
      var c2 = cRows[i];
      if (c2.is_system === true || c2.created_by !== userId) { continue; }
      if (!firstOwn[c2.ticket_id] || c2.created_at < firstOwn[c2.ticket_id]) { firstOwn[c2.ticket_id] = c2.created_at; }
    }

    var closed = 0, openNow = 0, overdueNow = 0, reopenedTotal = 0;
    var withDue = 0, closedWithDue = 0, onTime = 0, closedUnknownTime = 0;
    var closeDaysSum = 0, closeDaysN = 0, respHoursSum = 0, respN = 0, touched = 0;
    var todayStr = new Date().toISOString().substring(0, 10);
    for (i = 0; i < mine.length; i++) {
      var tk = mine[i];
      var isClosed = tk.status === 'Closed';
      if (tk.due_date) { withDue += 1; }
      reopenedTotal += (reopens[tk.id] || 0);
      if (firstOwn[tk.id]) {
        touched += 1;
        var rh = (new Date(firstOwn[tk.id]) - new Date(tk.created_at)) / 3600000;
        if (rh >= 0 && rh < 24 * 60) { respHoursSum += rh; respN += 1; }
      }
      if (isClosed) {
        closed += 1;
        var cAt = closedAt[tk.id] || null;
        if (cAt) {
          var cd2 = (new Date(cAt) - new Date(tk.created_at)) / 86400000;
          if (cd2 >= 0) { closeDaysSum += cd2; closeDaysN += 1; }
          if (tk.due_date) {
            closedWithDue += 1;
            if (String(cAt).substring(0, 10) <= tk.due_date) { onTime += 1; }
          }
        } else { closedUnknownTime += 1; }
      } else {
        openNow += 1;
        if (tk.due_date && tk.due_date < todayStr) { overdueNow += 1; }
      }
    }

    var ticketsM = {
      assigned_in_period: mine.length,
      closed: closed,
      open_now: openNow,
      overdue_open_now: overdueNow,
      with_due_date: withDue,
      closed_with_due_date: closedWithDue,
      closed_on_or_before_due: onTime,
      on_time_close_pct: pct(onTime, closedWithDue),
      closed_close_time_unknown: closedUnknownTime,
      avg_days_to_close: closeDaysN ? r1(closeDaysSum / closeDaysN) : null,
      reopened_events: reopenedTotal,
      tickets_they_commented_on: touched,
      engagement_pct: pct(touched, mine.length),
      avg_first_response_hours: respN ? r1(respHoursSum / respN) : null,
      comments_written_in_period: authoredAll.length
    };

    var metrics = {
      employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, job_title: emp.job_title || null },
      period: { start: start, end: end },
      attendance: attendance,
      tickets: ticketsM,
      generated_at: new Date().toISOString(),
      api_build_marker: API_BUILD_MARKER
    };

    // ── JENNA'S NARRATIVE (optional, measurements-only) ──────────
    var narrative = null; var aiError = null;
    if (wantAi) {
      var apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { aiError = 'AI key not configured — metrics returned without a narrative.'; }
      else {
        var sys = 'You are Jenna, the professional HR representative at KTC International. Write a formal but human performance review NARRATIVE from the measured data provided. Rules: base every claim strictly on the numbers given — never invent incidents, quotes, or reasons; where a figure is null or unknown, say the data is not available rather than guessing. Structure: 1) Summary (2-3 sentences), 2) Attendance & Consistency (address the ~6-days-per-week expectation directly), 3) Ticket Handling (responsiveness, staying on tickets, closing before deadlines), 4) Strengths (bullet list), 5) Areas to Improve (bullet list, specific and fair), 6) Suggested Goals for Next Period (bullet list, measurable). Neutral-to-warm professional tone; no scores out of 10; no markdown headers beyond simple numbered section titles.';
        var models = ['claude-sonnet-4-6', 'claude-haiku-4-5']; var mi;
        for (mi = 0; mi < models.length && !narrative; mi++) {
          try {
            var aresp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model: models[mi], max_tokens: 1800, system: sys, messages: [{ role: 'user', content: 'Measured performance data (JSON):\n' + JSON.stringify(metrics, null, 2) + '\n\nWrite the review narrative.' }] })
            });
            var aj = await aresp.json();
            var atext = aj && aj.content && aj.content[0] && aj.content[0].text;
            if (atext) { narrative = atext; }
            else if (aj && aj.error && aj.error.message) { aiError = aj.error.message; }
          } catch (eA) { aiError = (eA && eA.message) || 'AI call failed'; }
        }
      }
    }

    return NextResponse.json({ ok: true, metrics: metrics, narrative: narrative, ai_error: narrative ? null : aiError, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'performance-review failed', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
