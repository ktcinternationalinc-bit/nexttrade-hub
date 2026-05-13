'use client';
// HRReport.jsx — Admin-view of HR scorecard
// =========================================
// Analytical view for super_admin and users with the view_hr_report permission.
// - Full metrics per person
// - Score with sub-breakdown (productivity / timeliness / engagement)
// - AI-generated review per person (formal tone)
// - Anti-gaming visibility:  privileged users see all EXCEPT their own scorecard
// - Super admin sees everyone including self.
//
// Mounts as a section inside AdminTab.

import { useState, useEffect, useMemo } from 'react';
import { filterActiveUsers } from '../lib/active-users';
import { supabase } from '../lib/supabase';
import {
  resolvePeriod,
  resolvePriorPeriod,
  calcMetricsForUser,
  calcScore,
  computeDeltas,
  explainScore,
} from '../lib/hr-metrics';

const PERIOD_LABELS = [
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 Days'],
  ['30d', 'Last 30 Days'],
  ['3mo', 'Last 3 Months'],
  ['1y', 'Last Year'],
];

export default function HRReport({ user, userProfile, users, customers }) {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('score'); // score | name | timeliness | productivity | engagement
  const [selectedUser, setSelectedUser] = useState(null);
  const [reviews, setReviews] = useState({}); // { userId: { message, loading, error } }
  const [showSubScores, setShowSubScores] = useState(true);

  const myId = userProfile?.id || user?.id;
  const isSuperAdmin = userProfile?.role === 'super_admin';

  // Visibility filter: super admin sees all, privileged sees all except self
  const visibleUsers = useMemo(() => {
    if (!users) return [];
    if (isSuperAdmin) return filterActiveUsers(users);
    return filterActiveUsers(users).filter(u => u.id !== myId);
  }, [users, myId, isSuperAdmin]);

  // Fetch underlying data tables, scoped to a year for max period flex
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const window = resolvePeriod('1y');
      const safe = async (fn) => { try { return await fn(); } catch(e) { console.warn('[hr] query fail', e); return []; } };
      const [tickets, ticketComments, dailyLog, auditLog, customerQuotes, calendarEvents, userSessions] = await Promise.all([
        safe(async () => (await supabase.from('tickets').select('*').gte('created_at', window.from + 'T00:00:00')).data || []),
        safe(async () => (await supabase.from('ticket_comments').select('*').gte('created_at', window.from + 'T00:00:00')).data || []),
        safe(async () => (await supabase.from('daily_log').select('*').gte('log_date', window.from)).data || []),
        safe(async () => (await supabase.from('audit_log').select('*').gte('created_at', window.from + 'T00:00:00').limit(20000)).data || []),
        safe(async () => (await supabase.from('customer_quotes').select('*').gte('created_at', window.from)).data || []),
        safe(async () => (await supabase.from('calendar_events').select('*').gte('event_date', window.from)).data || []),
        // v55.80 — Presence: per-day login sessions feed the "active days" +
        // "avg hours/day" sub-score. Independent try/catch (via `safe`) so
        // a missing table on older deployments doesn't zero everything else.
        safe(async () => (await supabase.from('user_sessions').select('user_id, date, login_at, logout_at, last_seen, logout_reason').gte('date', window.from).limit(20000)).data || []),
      ]);
      if (cancelled) return;
      // v55.82-Z QA — strip super_admin's private tickets out of the
      // HR data set unless the viewer is the super admin. Private tickets
      // are super admin's personal items and shouldn't drive other
      // people's HR scores. Confidential tickets DO count — they're
      // legitimate team workload signal — but the report only computes
      // aggregates, not displays titles, so no content leak.
      var visibleHRTickets = tickets;
      if (!isSuperAdmin) {
        var privateIds = {};
        (tickets || []).forEach(function (t) { if (t.is_private) privateIds[t.id] = 1; });
        visibleHRTickets = tickets.filter(function (t) { return !t.is_private; });
        ticketComments = (ticketComments || []).filter(function (c) { return !privateIds[c.ticket_id]; });
      }
      setData({ tickets: visibleHRTickets, ticketComments, dailyLog, auditLog, customerQuotes, calendarEvents, customers: customers || [], userSessions });
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [customers, isSuperAdmin]);

  // Compute metrics + scores for everyone visible
  const teamReport = useMemo(() => {
    if (!data || !visibleUsers.length) return [];
    const cur = resolvePeriod(period);
    const pri = resolvePriorPeriod(cur);
    const allCurrent = visibleUsers.map(u => ({
      user: u,
      current: calcMetricsForUser(u.id, cur, data),
      prior: calcMetricsForUser(u.id, pri, data),
    }));
    const currentMetrics = allCurrent.map(r => r.current);
    return allCurrent.map(r => {
      const score = calcScore(r.current, currentMetrics);
      const deltas = computeDeltas(r.current, r.prior);
      return { ...r, score, deltas };
    });
  }, [data, visibleUsers, period]);

  // Sort
  const sortedReport = useMemo(() => {
    const sorted = [...teamReport];
    if (sort === 'name') sorted.sort((a, b) => (a.user.name || '').localeCompare(b.user.name || ''));
    else if (sort === 'activity') sorted.sort((a, b) => (b.score?.activity || 0) - (a.score?.activity || 0));
    else if (sort === 'timeliness') sorted.sort((a, b) => (b.score?.timeliness || 0) - (a.score?.timeliness || 0));
    else if (sort === 'productivity') sorted.sort((a, b) => (b.score?.productivity || 0) - (a.score?.productivity || 0));
    else if (sort === 'engagement') sorted.sort((a, b) => (b.score?.engagement || 0) - (a.score?.engagement || 0));
    // v55.80 BUG-11 FIX: when sorting by presence, push null-presence rows
    // to the bottom (they're "no data", not "0 score"). Otherwise legacy
    // deployments without user_sessions look like everyone has 0% presence.
    else if (sort === 'presence') sorted.sort((a, b) => {
      var aP = a.score?.presence;
      var bP = b.score?.presence;
      if (aP == null && bP == null) return 0;
      if (aP == null) return 1;  // a goes to end
      if (bP == null) return -1; // b goes to end
      return bP - aP;
    });
    else sorted.sort((a, b) => (b.score?.score || 0) - (a.score?.score || 0));
    return sorted;
  }, [teamReport, sort]);

  // Team averages for comparison
  const teamAvg = useMemo(() => {
    if (!teamReport.length) return null;
    const avg = (key) => {
      const valid = teamReport.filter(r => r.current && typeof r.current[key] === 'number');
      if (!valid.length) return 0;
      return Math.round(valid.reduce((s, r) => s + r.current[key], 0) / valid.length * 10) / 10;
    };
    const scoreAvg = (key) => {
      const valid = teamReport.filter(r => r.score && typeof r.score[key] === 'number');
      if (!valid.length) return 0;
      return Math.round(valid.reduce((s, r) => s + r.score[key], 0) / valid.length);
    };
    return {
      ticketsClosed: avg('ticketsClosed'),
      ticketsCreated: avg('ticketsCreated'),
      ratesAdded: avg('ratesAdded'),
      bookings: avg('bookings'),
      quotesCreated: avg('quotesCreated'),
      manualFillRatePct: avg('manualFillRatePct'),
      ticketComments: avg('ticketComments'),
      // v55.80 — presence team averages
      presenceRatePct: avg('presenceRatePct'),
      avgHoursPerDay: avg('avgHoursPerDay'),
      score: scoreAvg('score'),
      activity: scoreAvg('activity'),
      productivity: scoreAvg('productivity'),
      timeliness: scoreAvg('timeliness'),
      engagement: scoreAvg('engagement'),
      presence: scoreAvg('presence'),
    };
  }, [teamReport]);

  const requestReview = async (row) => {
    setReviews(prev => ({ ...prev, [row.user.id]: { ...(prev[row.user.id] || {}), loading: true, error: '' } }));
    try {
      const res = await fetch('/api/hr-report/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: row.user.name,
          period: period,
          metrics: row.current,
          deltas: row.deltas,
          score: row.score,
          teamAverage: teamAvg,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Review unavailable');
      setReviews(prev => ({ ...prev, [row.user.id]: { message: j.message, loading: false, error: '' } }));
    } catch (e) {
      setReviews(prev => ({ ...prev, [row.user.id]: { ...(prev[row.user.id] || {}), loading: false, error: e.message || 'Review failed' } }));
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="font-extrabold text-lg text-slate-800">📋 HR Performance Report</div>
          <div className="text-xs text-slate-500">
            {isSuperAdmin
              ? 'Analytical view of every team member, including yourself.'
              : 'Analytical view of team members. Your own scorecard is hidden here — you can see it under My Performance on your dashboard.'}
          </div>
        </div>
        <div className="text-xs text-slate-500">
          {sortedReport.length} {sortedReport.length === 1 ? 'person' : 'people'}
        </div>
      </div>

      {/* Period buttons */}
      <div className="flex flex-wrap gap-1 mb-3 rounded-lg border border-slate-200 p-1 bg-slate-50">
        {PERIOD_LABELS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => setPeriod(v)}
            className={'px-3 py-1.5 rounded text-xs font-semibold transition ' +
              (period === v ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100')}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Sort + sub-score toggle */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <span className="text-xs text-slate-500">Sort by:</span>
        {[['score', 'Overall'], ['activity', 'Activity'], ['timeliness', 'Timeliness'], ['presence', 'Presence'], ['productivity', 'Productivity'], ['name', 'Name']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setSort(v)}
            className={'text-xs px-2 py-1 rounded ' + (sort === v ? 'bg-slate-800 text-white font-semibold' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            {l}
          </button>
        ))}
        <label className="flex items-center gap-1 ml-auto text-xs text-slate-600">
          <input type="checkbox" checked={showSubScores} onChange={e => setShowSubScores(e.target.checked)} className="w-3.5 h-3.5" />
          Show sub-scores
        </label>
      </div>

      {loading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading team activity…</div>
      )}

      {!loading && !sortedReport.length && (
        <div className="text-center py-12 text-slate-400 text-sm">No team members to display for this view.</div>
      )}

      {!loading && sortedReport.length > 0 && (
        <div className="space-y-3">
          {/* Team summary banner */}
          {teamAvg && (
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Team Avg Score</div>
                <div className="text-xl font-extrabold text-slate-700">{teamAvg.score}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Activity</div>
                <div className="text-xl font-extrabold text-purple-600">{teamAvg.activity}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Timeliness</div>
                <div className="text-xl font-extrabold text-emerald-600">{teamAvg.timeliness}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Presence</div>
                <div className="text-xl font-extrabold text-cyan-600">{teamAvg.presence != null ? teamAvg.presence : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Productivity</div>
                <div className="text-xl font-extrabold text-blue-600">{teamAvg.productivity}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Tickets Closed</div>
                <div className="text-xl font-extrabold text-slate-700">{teamAvg.ticketsClosed}</div>
              </div>
            </div>
          )}

          {/* Per-person rows */}
          {sortedReport.map(row => (
            <PersonRow
              key={row.user.id}
              row={row}
              showSubScores={showSubScores}
              expanded={selectedUser === row.user.id}
              onToggle={() => setSelectedUser(selectedUser === row.user.id ? null : row.user.id)}
              onRequestReview={() => requestReview(row)}
              reviewState={reviews[row.user.id]}
              teamAvg={teamAvg}
              isSelf={row.user.id === myId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Per-person row component ---
function PersonRow({ row, showSubScores, expanded, onToggle, onRequestReview, reviewState, teamAvg, isSelf }) {
  const m = row.current;
  const s = row.score;
  const d = row.deltas;
  if (!m) return null;

  // v55.80 (Phase B / Section 4) — score breakdown.
  // Computed once per row render. Pure function so no hooks needed.
  const breakdown = (s && s.score != null) ? explainScore(s, m) : null;

  const scoreColor = (n) => {
    if (n == null) return 'text-slate-400';
    if (n >= 75) return 'text-emerald-600';
    if (n >= 50) return 'text-blue-600';
    if (n >= 25) return 'text-amber-600';
    return 'text-rose-600';
  };
  const ringColor = (n) => {
    if (n == null) return 'border-slate-200';
    if (n >= 75) return 'border-emerald-300';
    if (n >= 50) return 'border-blue-300';
    if (n >= 25) return 'border-amber-300';
    return 'border-rose-300';
  };

  // v55.80 — tone → background+text classes for the driver pills
  // and the wins/concerns chips.
  const toneClasses = (t) => {
    if (t === 'good') return { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' };
    if (t === 'ok') return { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200' };
    if (t === 'low') return { bg: 'bg-amber-50', text: 'text-amber-900', ring: 'ring-amber-200' };
    if (t === 'poor') return { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' };
    return { bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-200' };
  };

  return (
    <div className={'bg-white rounded-xl p-4 border-2 transition ' + ringColor(s?.score)}>
      <div onClick={onToggle} className="cursor-pointer">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={'text-3xl font-extrabold ' + scoreColor(s?.score)}>
              {s?.score != null ? s.score : '—'}
            </div>
            <div>
              <div className="font-bold text-slate-800 flex items-center gap-2">
                {row.user.name || row.user.email}
                {isSelf && <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-semibold">YOU</span>}
              </div>
              <div className="text-[10px] text-slate-500">
                {row.user.role === 'super_admin' ? '🔴 Super Admin' : row.user.role === 'admin' ? '🟣 Admin' : '🔵 Team'}
                {' · '} {m.totalActions} total actions
              </div>
            </div>
          </div>

          {showSubScores && s?.score != null && (
            <div className="flex gap-3 text-center">
              <div>
                <div className="text-[9px] text-slate-500 uppercase">Activity</div>
                <div className={'text-base font-bold ' + scoreColor(s.activity)}>{s.activity}</div>
              </div>
              <div>
                <div className="text-[9px] text-slate-500 uppercase">Timeliness</div>
                <div className={'text-base font-bold ' + scoreColor(s.timeliness)}>{s.timeliness}</div>
              </div>
              <div>
                <div className="text-[9px] text-slate-500 uppercase">Presence</div>
                <div className={'text-base font-bold ' + scoreColor(s.presence)}>{s.presence != null ? s.presence : '—'}</div>
              </div>
            </div>
          )}

          <div className="text-xs text-slate-400">{expanded ? '▴ Hide' : '▾ Why this score?'}</div>
        </div>

        {/* v55.80 (Phase B / Section 4) — One-line explanation under the score
            so Max sees the WHY immediately without expanding. */}
        {breakdown && !expanded && (
          <div className="mt-2 text-[11px] text-slate-600 italic">
            {breakdown.summary}
          </div>
        )}

        {/* Compact metric line */}
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-slate-600">
          <Pill label="closed" value={m.ticketsClosed} delta={d?.ticketsClosed?.diff} />
          <Pill label="opened" value={m.ticketsCreated} delta={d?.ticketsCreated?.diff} />
          <Pill label="comments" value={m.ticketComments} delta={d?.ticketComments?.diff} />
          <Pill label="rates" value={m.ratesAdded} delta={d?.ratesAdded?.diff} />
          <Pill label="bookings" value={m.bookings} delta={d?.bookings?.diff} />
          <Pill label="quotes" value={m.quotesCreated} delta={d?.quotesCreated?.diff} />
          <Pill label="meetings" value={m.attendedEvents} delta={d?.attendedEvents?.diff} />
          {m.onTimePct != null && <Pill label="on-time" value={m.onTimePct + '%'} />}
          {m.overdueNow > 0 && <Pill label="overdue" value={m.overdueNow} tone="rose" />}
          {m.lateEdits > 0 && <Pill label="late edits" value={m.lateEdits} tone="amber" />}
          <Pill label="log fill" value={m.manualFillRatePct + '%'} />
          {/* v55.80 — Presence pills: present-day rate + avg hours/day */}
          {m.presenceRatePct != null && m.workingDays > 0 && <Pill label="present" value={m.presenceRatePct + '%'} />}
          {m.avgHoursPerDay != null && m.avgHoursPerDay > 0 && <Pill label="hrs/day" value={m.avgHoursPerDay + 'h'} />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          {/* v55.80 (Phase B / Section 4) — Why-this-score breakdown.
              Renders ABOVE the dense metric grid because the question
              "why is this number what it is?" is the first question
              someone asks when they expand the row. */}
          {breakdown && (
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-slate-800">📊 Why this score?</div>
                <div className="text-[10px] text-slate-500">
                  Scored {s.score} out of 100
                </div>
              </div>

              {/* Plain-English summary line */}
              <div className="text-xs text-slate-700 mb-3 leading-relaxed">
                {breakdown.summary}
              </div>

              {/* Wins + concerns row — green/red chips, scannable */}
              {(breakdown.wins.length > 0 || breakdown.concerns.length > 0) && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {breakdown.wins.map((w, i) => (
                    <span key={'w' + i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      ✓ {w}
                    </span>
                  ))}
                  {breakdown.concerns.map((c, i) => (
                    <span key={'c' + i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      ⚠ {c}
                    </span>
                  ))}
                </div>
              )}

              {/* Five drivers — each with weight, value, contribution, signals */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                {breakdown.drivers.map((dr, i) => {
                  const tc = toneClasses(dr.tone);
                  return (
                    <div key={i} className={'rounded-lg p-2 ring-1 ' + tc.bg + ' ' + tc.ring} title={dr.explainer}>
                      <div className="flex items-baseline justify-between mb-1">
                        <div className={'text-[10px] font-extrabold uppercase tracking-wide ' + tc.text}>{dr.label}</div>
                        <div className="text-[9px] text-slate-500 font-semibold">{Math.round(dr.weight * 100)}%</div>
                      </div>
                      <div className="flex items-baseline gap-1.5 mb-1.5">
                        <div className={'text-lg font-extrabold ' + tc.text}>{dr.value}</div>
                        <div className="text-[9px] text-slate-500">→ +{dr.contribution} pts</div>
                      </div>
                      <ul className="text-[10px] text-slate-700 space-y-0.5">
                        {dr.lines.slice(0, 4).map((line, j) => (
                          <li key={j} className="leading-snug">• {line}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="text-[9px] text-slate-500 mt-2 italic">
                Score = Productivity×30% + Timeliness×20% + Engagement×15% + Quality×15% + Reliability×10% + Presence×10%
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <DetailBlock title="Tickets" rows={[
              ['Created in period', m.ticketsCreated],
              ['Closed in period', m.ticketsClosed],
              ['Closed on time', m.ticketsClosedOnTime],
              ['Closed late', m.ticketsClosedLate],
              ['Avg days to close', m.avgDaysToClose],
              ['Currently open', m.openTickets],
              ['Currently overdue', m.overdueNow],
              ['Comments written', m.ticketComments],
              ['Comments per assigned', m.commentsPerTicket],
              ['Late edits (24h+)', m.lateEdits],
            ]} />
            <DetailBlock title="Shipping & Quotes" rows={[
              ['Rates added', m.ratesAdded],
              ['Bookings made', m.bookings],
              ['Quotes created', m.quotesCreated],
              ['Quotes sent', m.quotesSent],
              ['Quotes accepted', m.quotesAccepted],
            ]} />
            <DetailBlock title="CRM" rows={[
              ['Customers assigned', m.assignedCustomers],
              ['Pipeline moves', m.pipelineMoves],
              ['Contact touches', m.contactTouches],
              ['CRM log entries', m.crmLogEntries],
            ]} />
            <DetailBlock title="Daily Log" rows={[
              ['Manual entries', m.manualEntries],
              ['Auto entries', m.autoEntries],
              ['Active days', m.activeDays + ' / ' + m.workingDays + ' working'],
              ['Manual day rate', m.manualFillRatePct + '%'],
            ]} />
            <DetailBlock title="Presence" rows={[
              ['Working days', m.workingDays || 0],
              ['Days logged in', (m.presentDays != null ? m.presentDays : 0) + ' / ' + (m.workingDays || 0)],
              ['Presence rate', (m.presenceRatePct != null ? m.presenceRatePct : 0) + '%'],
              ['Avg hours/day', (m.avgHoursPerDay != null ? m.avgHoursPerDay : 0) + 'h'],
            ]} />
            <DetailBlock title="Calendar" rows={[
              ['Owned events', m.assignedEvents],
              ['Owned completed', m.completedEvents],
              ['Attended (any)', m.attendedEvents],
              ['Declined', m.declinedEvents],
            ]} />
            <DetailBlock title="vs Team Average" rows={teamAvg ? [
              ['Closed', m.ticketsClosed + ' vs ' + teamAvg.ticketsClosed],
              ['Created', m.ticketsCreated + ' vs ' + teamAvg.ticketsCreated],
              ['Rates', m.ratesAdded + ' vs ' + teamAvg.ratesAdded],
              ['Quotes', m.quotesCreated + ' vs ' + teamAvg.quotesCreated],
              ['Log fill', m.manualFillRatePct + '% vs ' + teamAvg.manualFillRatePct + '%'],
            ] : []} />
          </div>

          {/* AI Review */}
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold text-blue-800">📝 AI-Generated Review</div>
              <button
                onClick={(e) => { e.stopPropagation(); onRequestReview(); }}
                disabled={reviewState?.loading}
                className="text-xs px-3 py-1 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {reviewState?.loading ? 'Generating…' : (reviewState?.message ? '↻ Regenerate' : 'Generate Review')}
              </button>
            </div>
            {reviewState?.error && (
              <div className="text-xs text-rose-700 bg-rose-50 rounded p-2">{reviewState.error}</div>
            )}
            {reviewState?.message && (
              <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{reviewState.message}</div>
            )}
            {!reviewState?.message && !reviewState?.error && (
              <div className="text-[11px] text-slate-500 italic">Click "Generate Review" for an analytical written review with strengths, weaknesses, and recommended actions.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ label, value, delta, tone }) {
  let deltaTxt = '';
  let deltaCls = '';
  if (typeof delta === 'number') {
    if (delta > 0) { deltaTxt = ' ↑' + delta; deltaCls = 'text-emerald-600 font-semibold'; }
    else if (delta < 0) { deltaTxt = ' ↓' + Math.abs(delta); deltaCls = 'text-slate-500'; }
  }
  const toneCls = tone === 'rose' ? 'bg-rose-50 text-rose-700' : tone === 'amber' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700';
  return (
    <span className={'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] ' + toneCls}>
      <span className="font-bold">{value}</span>
      <span>{label}</span>
      {deltaTxt && <span className={deltaCls}>{deltaTxt}</span>}
    </span>
  );
}

function DetailBlock({ title, rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="bg-slate-50 rounded p-3 border border-slate-200">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">{title}</div>
      <div className="space-y-1">
        {rows.map(([label, value], i) => (
          <div key={i} className="flex justify-between text-[11px]">
            <span className="text-slate-600">{label}</span>
            <span className="font-semibold text-slate-800">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
