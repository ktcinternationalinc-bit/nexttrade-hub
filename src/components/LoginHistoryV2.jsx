// v55.83-A.6.13 (Max May 14 2026) — Login History 2.0
//
// Replaces the old AdminTab "Logins" section. Addresses every complaint:
//   - Three duplicate-looking Abdelrahman sessions on the same day were
//     OVERLAPPING events. Now: merged into a single "workday" record.
//   - Old "Logins (range)" column showed lifetime sessions ignoring filter.
//     Now: every count is bucket-explicit. Quick view = 4 standard buckets.
//     Detail view = custom date range that actually filters everything.
//   - Old single-page layout forced summary OFF when drilling into a user.
//     Now: side panel keeps summary visible while showing one user's detail.
//   - HR needs accurate stats. Now exposes:
//       * Workdays active (distinct ET days with login)
//       * Total active minutes (sum of merged session durations)
//       * Avg minutes/workday
//       * Longest workday
//       * Earliest typical login (median first-login-of-day across workdays)
//       * Auto-timeout rate (% of sessions ended by timeout vs manual logout)
//   - Bilingual EN + AR throughout per Max's rule.
//   - Inactive users (0 logins in range) shown at 50% opacity.

import React, { useState, useMemo } from 'react';
import { fmtET, todayET, yesterdayET } from '../lib/et-time';

// Merge overlapping or back-to-back sessions for one user on one ET day.
// Two sessions count as "overlapping" if either of these is true:
//   1. The intervals actually overlap (A starts before B ends, B starts before A ends)
//   2. Gap between A's end and B's start is < MERGE_GAP_MINUTES (default 15)
//      — covers refresh / tab-reopen / brief disconnect scenarios.
// Returns array of merged session intervals, each shaped like:
//   { start: Date, end: Date, mergedCount: number, autoTimeout: boolean, originals: [...] }
const MERGE_GAP_MINUTES = 15;
export function mergeOverlappingSessions(sessions) {
  if (!sessions || sessions.length === 0) return [];
  // Sort by start time
  var sorted = sessions.slice().filter(function (s) { return s.login_at; }).sort(function (a, b) {
    return new Date(a.login_at) - new Date(b.login_at);
  });
  var merged = [];
  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var startMs = new Date(s.login_at).getTime();
    // End time: explicit logout_at if present, else login_at + a heuristic
    // (use 1 minute "active" by default for sessions with no end recorded,
    // so an in-progress session shows as a tiny marker until heartbeat).
    var endMs = s.logout_at ? new Date(s.logout_at).getTime() : startMs + 60 * 1000;
    if (endMs < startMs) endMs = startMs;
    if (merged.length === 0) {
      merged.push({ start: startMs, end: endMs, mergedCount: 1, autoTimeout: s.logout_reason === 'auto_timeout', originals: [s] });
      continue;
    }
    var last = merged[merged.length - 1];
    var gap = (startMs - last.end) / 60000; // minutes
    if (gap <= MERGE_GAP_MINUTES) {
      // Merge: extend last interval if this one ends later
      if (endMs > last.end) last.end = endMs;
      last.mergedCount += 1;
      last.originals.push(s);
      // Keep auto_timeout flag if ANY merged piece was auto-timeout
      // (the user-perceived "what closed this workday" is whichever
      // was last; we approximate by 'any' so HR doesn't miss timeouts)
      if (s.logout_reason === 'auto_timeout') last.autoTimeout = true;
    } else {
      merged.push({ start: startMs, end: endMs, mergedCount: 1, autoTimeout: s.logout_reason === 'auto_timeout', originals: [s] });
    }
  }
  return merged;
}

// Aggregate a user's sessions into HR-grade per-user stats.
// dateFromStr / dateToStr (YYYY-MM-DD, inclusive) restrict to a date range.
// Returns: { workdaysActive, totalMinutes, avgMinutesPerDay, longestMinutes,
//            earliestTypicalLogin, autoTimeoutRate, mergedSessionCount,
//            firstLoginByDay, lastActivityByDay, durationsByDay }
export function computeUserStats(sessions, dateFromStr, dateToStr) {
  if (!sessions || sessions.length === 0) {
    return { workdaysActive: 0, totalMinutes: 0, avgMinutesPerDay: 0,
             longestMinutes: 0, earliestTypicalLogin: null,
             autoTimeoutRate: 0, mergedSessionCount: 0,
             firstLoginByDay: {}, lastActivityByDay: {}, durationsByDay: {} };
  }
  // Filter to range
  var inRange = sessions.filter(function (s) {
    if (!s.date) return false;
    if (dateFromStr && s.date < dateFromStr) return false;
    if (dateToStr && s.date > dateToStr) return false;
    return true;
  });
  // Group by ET day
  var byDay = {};
  inRange.forEach(function (s) {
    var d = s.date;
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(s);
  });
  var days = Object.keys(byDay).sort();
  var totalMinutes = 0;
  var longestMinutes = 0;
  var firstLoginByDay = {};
  var lastActivityByDay = {};
  var durationsByDay = {};
  var firstLoginHourMinutes = []; // for median "earliest typical login"
  var totalMergedSessions = 0;
  var totalAutoTimeouts = 0;

  days.forEach(function (d) {
    var dayMerged = mergeOverlappingSessions(byDay[d]);
    totalMergedSessions += dayMerged.length;
    var dayMin = 0;
    dayMerged.forEach(function (m) {
      dayMin += (m.end - m.start) / 60000;
      if (m.autoTimeout) totalAutoTimeouts += 1;
    });
    durationsByDay[d] = Math.round(dayMin);
    totalMinutes += dayMin;
    if (dayMin > longestMinutes) longestMinutes = dayMin;
    if (dayMerged.length > 0) {
      var first = dayMerged[0];
      var firstDate = new Date(first.start);
      firstLoginByDay[d] = firstDate;
      // Hour-of-day in ET for median
      var etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(firstDate));
      var etMin = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', minute: 'numeric' }).format(firstDate));
      firstLoginHourMinutes.push(etHour * 60 + etMin);
      lastActivityByDay[d] = new Date(dayMerged[dayMerged.length - 1].end);
    }
  });
  var workdaysActive = days.length;
  var avgMinutesPerDay = workdaysActive > 0 ? Math.round(totalMinutes / workdaysActive) : 0;
  // Median earliest login (ET minutes since midnight)
  var earliestTypicalLogin = null;
  if (firstLoginHourMinutes.length > 0) {
    var sortedMins = firstLoginHourMinutes.slice().sort(function (a, b) { return a - b; });
    var medMin = sortedMins[Math.floor(sortedMins.length / 2)];
    var hh = Math.floor(medMin / 60);
    var mm = medMin % 60;
    var ampm = hh >= 12 ? 'PM' : 'AM';
    var hh12 = hh % 12 === 0 ? 12 : hh % 12;
    earliestTypicalLogin = hh12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
  }
  var autoTimeoutRate = totalMergedSessions > 0 ? Math.round((totalAutoTimeouts / totalMergedSessions) * 100) : 0;
  return {
    workdaysActive: workdaysActive,
    totalMinutes: Math.round(totalMinutes),
    avgMinutesPerDay: avgMinutesPerDay,
    longestMinutes: Math.round(longestMinutes),
    earliestTypicalLogin: earliestTypicalLogin,
    autoTimeoutRate: autoTimeoutRate,
    mergedSessionCount: totalMergedSessions,
    firstLoginByDay: firstLoginByDay,
    lastActivityByDay: lastActivityByDay,
    durationsByDay: durationsByDay,
  };
}

// Format minutes → "Xh Ym" friendly
function fmtMin(minutes) {
  if (!minutes || minutes === 0) return '0m';
  var h = Math.floor(minutes / 60);
  var m = Math.round(minutes % 60);
  if (h === 0) return m + 'm';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'm';
}

export default function LoginHistoryV2({ users, sessions, sessionsWide, loginSummary, loginSummaryWarning, dateFrom, dateTo, isSuperAdmin }) {
  // v55.83-A.6.13 (Max May 13 2026) — three view modes:
  //   'quick'   = 4 fixed buckets (today / yesterday / 7d / 30d) for at-a-glance
  //   'detail'  = HR-grade per-user stats over the custom date range
  //   'sessions' = raw session log grouped by ET day (forensic / audit view)
  // Max requested both a Daily Summary and a Sessions Detail view as
  // separate tabs. 'quick' and 'detail' are both daily summaries (different
  // ranges); 'sessions' is the new forensic per-session view.
  var [viewMode, setViewMode] = useState('quick'); // 'quick' | 'detail' | 'sessions'
  // Side panel: user selected for drill-down. null = no drill, show summary only.
  var [drillUserId, setDrillUserId] = useState(null);
  // For Detail view: sort by which column
  var [sortBy, setSortBy] = useState('totalMinutes');
  var [sortDir, setSortDir] = useState('desc');
  // For Sessions view: filter to a single user (null = everyone)
  var [sessionsUserFilter, setSessionsUserFilter] = useState('');

  var etToday = todayET();
  var etYesterday = yesterdayET();
  // Compute the "7d" and "30d" lower bounds in ET
  function daysAgoET(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
  }
  var etSevenDaysAgo = daysAgoET(6);
  var etThirtyDaysAgo = daysAgoET(29);

  // Per-user stats for each bucket (quick view) — uses sessionsWide so the
  // 4 buckets always have 30 days of data regardless of the user's current
  // date filter. Falls back to `sessions` if sessionsWide not provided.
  var quickSrc = sessionsWide && sessionsWide.length > 0 ? sessionsWide : sessions;
  var perUserQuick = useMemo(function () {
    return (users || []).map(function (u) {
      var uSess = quickSrc.filter(function (s) { return s.user_id === u.id; });
      var today = computeUserStats(uSess, etToday, etToday);
      var yesterday = computeUserStats(uSess, etYesterday, etYesterday);
      var sevenD = computeUserStats(uSess, etSevenDaysAgo, etToday);
      var thirtyD = computeUserStats(uSess, etThirtyDaysAgo, etToday);
      var lsRow = (loginSummary || []).find(function (l) { return l.id === u.id; }) || {};
      return {
        user: u,
        isOnline: !!lsRow.is_online,
        lastLoginAt: lsRow.last_login_at || (uSess[0] && uSess[0].login_at) || null,
        today: today, yesterday: yesterday, sevenD: sevenD, thirtyD: thirtyD,
        anyLogin: uSess.length > 0,
      };
    });
  }, [users, quickSrc, loginSummary, etToday, etYesterday, etSevenDaysAgo, etThirtyDaysAgo]);

  // Per-user stats for the custom date range (detail view)
  var perUserDetail = useMemo(function () {
    return (users || []).map(function (u) {
      var uSess = sessions.filter(function (s) { return s.user_id === u.id; });
      var stats = computeUserStats(uSess, dateFrom, dateTo);
      var lsRow = (loginSummary || []).find(function (l) { return l.id === u.id; }) || {};
      return {
        user: u,
        isOnline: !!lsRow.is_online,
        lastLoginAt: lsRow.last_login_at || (uSess[0] && uSess[0].login_at) || null,
        stats: stats,
        anyLogin: stats.mergedSessionCount > 0,
      };
    }).sort(function (a, b) {
      var av = (a.stats && a.stats[sortBy]) != null ? a.stats[sortBy] : 0;
      var bv = (b.stats && b.stats[sortBy]) != null ? b.stats[sortBy] : 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [users, sessions, loginSummary, dateFrom, dateTo, sortBy, sortDir]);

  var drillUser = drillUserId ? (users || []).find(function (u) { return u.id === drillUserId; }) : null;
  var drillStats = drillUser ? computeUserStats(sessions.filter(function (s) { return s.user_id === drillUser.id; }), dateFrom, dateTo) : null;

  function HeaderClick(props) {
    return (
      <th className="px-3 py-2 text-[10px] text-center cursor-pointer hover:bg-slate-100 select-none"
        onClick={function () {
          if (sortBy === props.field) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
          else { setSortBy(props.field); setSortDir('desc'); }
        }}
        title={props.title}>
        {props.label}
        {sortBy === props.field && <span className="ml-1">{sortDir === 'desc' ? '▼' : '▲'}</span>}
      </th>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 mb-3">
      {/* v55.83-A.6.13 — Warning banner if login_events table not set up.
          Previously lived in AdminTab; now travels with the component
          so the warning appears alongside the table that depends on it. */}
      {loginSummaryWarning && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 mb-3">
          <div className="font-bold text-amber-900 text-xs mb-1">
            ⚠️ Online status not working — database setup needed / حالة الاتصال لا تعمل
          </div>
          <div className="text-[11px] text-amber-900 mb-2">
            Everyone shows as "Offline" because the login-events table doesn't exist in Supabase yet.
            To fix: open Supabase → SQL Editor → paste the SQL from
            <code className="bg-amber-100 px-1 rounded mx-1">supabase/login-events.sql</code>
            in the project repo → Run. Then refresh.
          </div>
          <div className="text-[10px] font-mono bg-amber-100 text-amber-900 p-2 rounded border border-amber-200 break-all">
            Server returned: {loginSummaryWarning}
          </div>
        </div>
      )}
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold">👥 Login History / سجل تسجيل الدخول</h3>
        <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 text-[11px] font-bold">
          <button onClick={function () { setViewMode('quick'); }}
            className={'px-3 py-1 ' + (viewMode === 'quick' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
            ⚡ Quick view / سريع
          </button>
          <button onClick={function () { setViewMode('detail'); }}
            className={'px-3 py-1 ' + (viewMode === 'detail' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
            📊 Detail (custom range) / تفصيلي
          </button>
          <button onClick={function () { setViewMode('sessions'); setDrillUserId(null); }}
            className={'px-3 py-1 ' + (viewMode === 'sessions' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
            🔬 Sessions / الجلسات
          </button>
        </div>
      </div>

      {viewMode === 'detail' && (
        <div className="bg-slate-50 rounded p-2 mb-2 text-[10px] text-slate-600">
          Range: <span className="font-bold">{dateFrom}</span> → <span className="font-bold">{dateTo}</span>
          {' '}({(new Date(dateTo) - new Date(dateFrom)) / 86400000 + 1} days / يوم)
          {' '}— change the date filter above to update.
        </div>
      )}

      {/* Two-pane layout when a user is drilled: summary on left, detail on right */}
      <div className={drillUserId && viewMode !== 'sessions' ? 'grid grid-cols-1 lg:grid-cols-2 gap-3' : ''}>
        {/* LEFT / FULL: summary table or sessions list */}
        <div className="overflow-auto max-h-[600px] rounded-lg border border-slate-200">
          {viewMode === 'quick' ? (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-[10px] text-left">Team Member / الموظف</th>
                  <th className="px-3 py-2 text-[10px] text-center" title="Currently logged in (heartbeat within last 10 minutes)">Status / الحالة</th>
                  <th className="px-3 py-2 text-[10px] text-center" title="Active time today (Eastern Time)">Today / اليوم</th>
                  <th className="px-3 py-2 text-[10px] text-center" title="Active time yesterday (ET)">Yesterday / أمس</th>
                  <th className="px-3 py-2 text-[10px] text-center" title="Workdays in the last 7 ET days · total active time">Last 7d / آخر 7 أيام</th>
                  <th className="px-3 py-2 text-[10px] text-center" title="Workdays in the last 30 ET days · total active time">Last 30d / آخر 30 يوم</th>
                  <th className="px-3 py-2 text-[10px] text-left" title="Most recent login">Last Login / آخر دخول</th>
                </tr>
              </thead>
              <tbody>
                {perUserQuick.map(function (row) {
                  var u = row.user;
                  // Faded if zero logins anywhere
                  var faded = !row.anyLogin;
                  return (
                    <tr key={u.id}
                      className={'border-b border-slate-50 cursor-pointer ' + (faded ? 'opacity-50 ' : '') + (drillUserId === u.id ? 'bg-indigo-50 ' : 'hover:bg-blue-50')}
                      onClick={function () { setDrillUserId(drillUserId === u.id ? null : u.id); }}>
                      <td className="px-3 py-2 font-semibold">{u.name || u.email}</td>
                      <td className="px-3 py-2 text-center">
                        {row.isOnline
                          ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">🟢 Online</span>
                          : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">⚪ Offline</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.today.totalMinutes > 0
                          ? <span className="font-bold text-blue-600">{fmtMin(row.today.totalMinutes)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.yesterday.totalMinutes > 0
                          ? <span className="text-slate-700">{fmtMin(row.yesterday.totalMinutes)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.sevenD.workdaysActive > 0 ? (
                          <span>
                            <span className="font-bold">{row.sevenD.workdaysActive}</span>
                            <span className="text-[9px] text-slate-500"> days · </span>
                            <span className="text-slate-600">{fmtMin(row.sevenD.totalMinutes)}</span>
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.thirtyD.workdaysActive > 0 ? (
                          <span>
                            <span className="font-bold">{row.thirtyD.workdaysActive}</span>
                            <span className="text-[9px] text-slate-500"> days · </span>
                            <span className="text-slate-600">{fmtMin(row.thirtyD.totalMinutes)}</span>
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-[10px]">
                        {row.lastLoginAt ? fmtET(row.lastLoginAt, 'datetime') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : viewMode === 'detail' ? (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-[10px] text-left">Team Member / الموظف</th>
                  <th className="px-3 py-2 text-[10px] text-center">Status / الحالة</th>
                  <HeaderClick field="workdaysActive" label="Workdays / أيام عمل" title="Distinct ET days with at least one login in the date range" />
                  <HeaderClick field="totalMinutes" label="Total / المجموع" title="Sum of active time across all merged sessions" />
                  <HeaderClick field="avgMinutesPerDay" label="Avg/Day / المتوسط" title="Average active time per workday" />
                  <HeaderClick field="longestMinutes" label="Longest / أطول" title="Longest single workday in the range" />
                  <th className="px-3 py-2 text-[10px] text-center" title="Median first-login hour across active workdays (ET)">Typical Start / بداية</th>
                  <HeaderClick field="autoTimeoutRate" label="Auto-out % / تلقائي" title="Percentage of sessions ended by auto-timeout (vs manual logout)" />
                </tr>
              </thead>
              <tbody>
                {perUserDetail.map(function (row) {
                  var u = row.user;
                  var faded = !row.anyLogin;
                  var s = row.stats;
                  return (
                    <tr key={u.id}
                      className={'border-b border-slate-50 cursor-pointer ' + (faded ? 'opacity-50 ' : '') + (drillUserId === u.id ? 'bg-indigo-50 ' : 'hover:bg-blue-50')}
                      onClick={function () { setDrillUserId(drillUserId === u.id ? null : u.id); }}>
                      <td className="px-3 py-2 font-semibold">{u.name || u.email}</td>
                      <td className="px-3 py-2 text-center">
                        {row.isOnline
                          ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">🟢</span>
                          : <span className="text-slate-300">⚪</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-bold">{s.workdaysActive}</td>
                      <td className="px-3 py-2 text-center font-bold text-blue-600">{fmtMin(s.totalMinutes)}</td>
                      <td className="px-3 py-2 text-center">{fmtMin(s.avgMinutesPerDay)}</td>
                      <td className="px-3 py-2 text-center">{fmtMin(s.longestMinutes)}</td>
                      <td className="px-3 py-2 text-center text-slate-600">{s.earliestTypicalLogin || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {s.mergedSessionCount > 0 ? (
                          <span className={s.autoTimeoutRate >= 80 ? 'text-red-600 font-bold' : s.autoTimeoutRate >= 50 ? 'text-amber-600 font-bold' : 'text-slate-500'}>
                            {s.autoTimeoutRate}%
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* SESSIONS VIEW — raw per-day session log (forensic). */
            <SessionsView
              users={users}
              sessions={sessions}
              dateFrom={dateFrom}
              dateTo={dateTo}
              filterUserId={sessionsUserFilter}
              setFilterUserId={setSessionsUserFilter}
            />
          )}
        </div>

        {/* RIGHT: drill-down panel when a user is selected */}
        {drillUserId && drillUser && drillStats && (
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 max-h-[420px] overflow-auto">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-sm font-bold">{drillUser.name || drillUser.email}</h4>
              <button onClick={function () { setDrillUserId(null); }}
                className="px-2 py-0.5 rounded text-[11px] bg-slate-200 hover:bg-slate-300">
                ✕ Close / إغلاق
              </button>
            </div>
            <div className="text-[10px] text-slate-500 mb-3">
              {dateFrom} → {dateTo}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
              <div className="bg-white rounded p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase">Workdays / أيام</div>
                <div className="text-lg font-extrabold">{drillStats.workdaysActive}</div>
              </div>
              <div className="bg-white rounded p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase">Total time / إجمالي</div>
                <div className="text-lg font-extrabold text-blue-600">{fmtMin(drillStats.totalMinutes)}</div>
              </div>
              <div className="bg-white rounded p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase">Avg/day / متوسط يومي</div>
                <div className="text-lg font-extrabold">{fmtMin(drillStats.avgMinutesPerDay)}</div>
              </div>
              <div className="bg-white rounded p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase">Longest / أطول يوم</div>
                <div className="text-lg font-extrabold">{fmtMin(drillStats.longestMinutes)}</div>
              </div>
              <div className="bg-white rounded p-2 border border-slate-200 col-span-2">
                <div className="text-[9px] text-slate-500 uppercase">Typical start time / موعد الدخول المعتاد</div>
                <div className="text-base font-bold">{drillStats.earliestTypicalLogin || '—'}</div>
              </div>
            </div>

            <div className="text-[11px] font-bold mb-2">Daily breakdown / تفصيل يومي</div>
            <div className="space-y-1">
              {Object.keys(drillStats.durationsByDay).sort().reverse().map(function (date) {
                var min = drillStats.durationsByDay[date];
                var first = drillStats.firstLoginByDay[date];
                var last = drillStats.lastActivityByDay[date];
                return (
                  <div key={date} className="bg-white rounded p-2 border border-slate-200 text-[10px] flex items-center justify-between">
                    <div>
                      <span className="font-bold">{date}</span>
                      <span className="text-slate-500 ml-2">
                        {first && fmtET(first, 'time')} → {last && fmtET(last, 'time')}
                      </span>
                    </div>
                    <span className={'font-bold ' + (min >= 480 ? 'text-emerald-600' : min >= 240 ? 'text-blue-600' : 'text-slate-600')}>
                      {fmtMin(min)}
                    </span>
                  </div>
                );
              })}
              {Object.keys(drillStats.durationsByDay).length === 0 && (
                <div className="text-[10px] text-slate-400 italic">No login activity in this date range / لا توجد بيانات في هذه الفترة</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="text-[9px] text-slate-400 mt-2 italic">
        💡 Overlapping sessions (e.g. multiple tabs, page refreshes) within {MERGE_GAP_MINUTES} min are merged into one workday for accurate stats.
        {' '}الجلسات المتداخلة (تبويبات متعددة، إعادة تحميل الصفحة) خلال {MERGE_GAP_MINUTES} دقيقة تُدمج في يوم عمل واحد.
      </div>
    </div>
  );
}

// =====================
// SESSIONS VIEW (v55.83-A.6.13)
// Raw per-day session log — forensic/audit view.
// Groups raw sessions by ET day, lists each as login → logout with badges
// for AUTO TIMEOUT / MANUAL. Optional per-user filter.
// =====================
function SessionsView({ users, sessions, dateFrom, dateTo, filterUserId, setFilterUserId }) {
  var rangeSessions = (sessions || []).filter(function (s) {
    var d = s.date || (s.login_at ? s.login_at.substring(0, 10) : '');
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    if (filterUserId && s.user_id !== filterUserId) return false;
    return true;
  });

  var byDate = {};
  rangeSessions.forEach(function (s) {
    var d = s.date || (s.login_at ? s.login_at.substring(0, 10) : 'unknown');
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  });
  var dates = Object.keys(byDate).sort(function (a, b) { return b.localeCompare(a); });

  function getUserName(uid) {
    var u = (users || []).find(function (x) { return x.id === uid; });
    return u ? (u.name || u.email || 'Unknown') : 'Unknown';
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="text-[10px] text-slate-500 m-0">
          Every raw session in the selected range. Use Daily Summary tabs for the de-duplicated workday view. /
          كل جلسة فردية. استخدم الملخصات اليومية للعرض المُدمج.
        </p>
        <select value={filterUserId} onChange={function (e) { setFilterUserId(e.target.value); }}
          className="px-2 py-1 rounded border border-slate-200 text-[11px]">
          <option value="">All team members / كل الفريق</option>
          {(users || []).map(function (u) {
            return <option key={u.id} value={u.id}>{u.name || u.email}</option>;
          })}
        </select>
      </div>

      {dates.length === 0 ? (
        <div className="text-center text-sm text-slate-500 py-6">
          No sessions in this date range / لا توجد جلسات في هذه الفترة
        </div>
      ) : (
        <div className="space-y-3">
          {dates.map(function (date) {
            var daySessions = byDate[date] || [];
            var autoCount = daySessions.filter(function (s) { return s.logout_reason === 'auto_timeout'; }).length;
            var manualCount = daySessions.filter(function (s) { return s.logout_reason === 'manual'; }).length;
            return (
              <div key={date} className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                <div className="flex justify-between items-center mb-1 px-1 flex-wrap">
                  <div className="text-xs font-bold text-slate-700">
                    📅 {fmtET(date + 'T12:00:00Z', 'longdate') || date}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {daySessions.length} session{daySessions.length !== 1 ? 's' : ''}
                    {autoCount > 0 && <span className="ml-2 text-red-500">· {autoCount} auto-timeout{autoCount !== 1 ? 's' : ''}</span>}
                    {manualCount > 0 && <span className="ml-2 text-blue-500">· {manualCount} manual</span>}
                  </div>
                </div>
                <div className="space-y-1">
                  {daySessions.sort(function (a, b) { return (a.login_at || '').localeCompare(b.login_at || ''); }).map(function (s) {
                    var start = s.login_at ? fmtET(s.login_at, 'time') : '—';
                    var endStr;
                    if (s.logout_at) endStr = fmtET(s.logout_at, 'time');
                    else if (s.last_seen) endStr = fmtET(s.last_seen, 'time') + ' (last activity)';
                    else endStr = 'still on';
                    var duration = (s.login_at && s.logout_at) ? Math.round((new Date(s.logout_at) - new Date(s.login_at)) / 60000) : null;
                    var endIcon = s.logout_reason === 'auto_timeout' ? '⏰' : (s.logout_reason === 'manual' ? '🔴' : '🟢');
                    var endColor = s.logout_reason === 'auto_timeout' ? 'text-red-500' : 'text-slate-600';
                    return (
                      <div key={s.id} className="flex items-center text-[11px] py-1 px-2 bg-white rounded border border-slate-100 flex-wrap gap-1">
                        <div className="flex-1 font-semibold text-slate-700 min-w-[100px]">{getUserName(s.user_id)}</div>
                        <div className="text-emerald-600 font-mono">🟢 {start}</div>
                        <span className="text-slate-400">→</span>
                        <div className={endColor + ' font-mono'}>
                          {endIcon} {endStr}
                        </div>
                        {duration !== null && (
                          <span className="text-slate-500 text-[10px]">({duration}m)</span>
                        )}
                        {s.logout_reason === 'auto_timeout' && (
                          <span className="px-1 py-0.5 rounded bg-red-50 text-red-700 text-[9px] font-bold">AUTO TIMEOUT / تلقائي</span>
                        )}
                        {s.logout_reason === 'manual' && (
                          <span className="px-1 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-bold">MANUAL / يدوي</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
