'use client';
// MyPerformance.jsx — Self-view of HR scorecard
// =============================================
// What every team member sees about THEIR OWN performance.
// - Pure "what you did" metrics over a period
// - Period-over-period delta vs YOURSELF (not vs teammates)
// - AI coach button → encouraging, growth-oriented message
// - NO score, NO ranking, NO comparison to others
// - Tone is positive coach, never judgmental
//
// The same data is also visible to super_admin / privileged users via HRReport.jsx
// but THIS component never displays a numeric score or rank.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  resolvePeriod,
  resolvePriorPeriod,
  calcMetricsForUser,
  computeDeltas,
} from '../lib/hr-metrics';

const PERIOD_LABELS = [
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 Days'],
  ['30d', 'Last 30 Days'],
  ['3mo', 'Last 3 Months'],
  ['1y', 'Last Year'],
];

export default function MyPerformance({ user, userProfile, active }) {
  // v55.77 — `active` prop signals whether Sara's panel is the currently
  // open persona. Defaults to true for backward compat (older mounts).
  // When false on first render, the heavy 7-query Supabase fetch is
  // deferred until the user actually opens Sara. Once opened, data stays
  // loaded so re-opens don't re-fetch.
  const isActive = active === undefined ? true : !!active;
  const [hasBeenActive, setHasBeenActive] = useState(isActive);
  useEffect(() => {
    if (isActive && !hasBeenActive) setHasBeenActive(true);
  }, [isActive, hasBeenActive]);

  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coachMsg, setCoachMsg] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState('');
  // v55.64 — default to EXPANDED. Previously this defaulted to false so
  // the card on the dashboard looked like a tiny placeholder pill, and
  // people forgot the AI coach + scorecard even existed. Open by default
  // surfaces it for everyone. Users can still tap "Collapse" to hide it.
  const [expanded, setExpanded] = useState(true);
  // v55.54 — capture ANY load error so the user sees it instead of
  // a blank/disappearing card. Previously, errors silently produced an
  // empty data state and the component would render with zeros (which
  // looked like it disappeared on phones).
  const [loadError, setLoadError] = useState('');

  const myId = userProfile?.id || user?.id;
  const myName = userProfile?.name || user?.email || 'You';

  // Load all relevant tables for this user (self only — narrower than admin view)
  // v55.73 — fixed "stuck on Loading your activity..." hang reported by Max.
  // Three fixes combined:
  //   (1) If myId is undefined on first render (userProfile still hydrating),
  //       the effect was bailing out at line 54 and leaving loading=true
  //       forever. Now: also clear loading + show a soft "no data yet" state
  //       so the user never sees an infinite spinner.
  //   (2) Hard 8-second timeout. If the parallel fetches stall (network /
  //       Supabase blip), surface a clean professional error and let the
  //       user retry, rather than spin indefinitely.
  //   (3) Defensive: every safe() wrapper guarantees a return value, and the
  //       outer try/catch ALWAYS hits setLoading(false) via finally — so no
  //       error path leaves loading=true.
  useEffect(() => {
    if (!hasBeenActive) {
      // Sara hasn't been opened yet this session — skip the heavy fetch.
      // This avoids loading 7 Supabase queries for users who never click Sara.
      return;
    }
    if (!expanded) {
      // Component collapsed — leave whatever state we had
      return;
    }
    // v55.73 — myId not ready yet (userProfile still hydrating). Don't get
    // stuck on the spinner. Exit loading so the empty-state UI shows; when
    // myId arrives, the effect re-runs and we fetch then.
    if (!myId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId = null;

    const load = async () => {
      setLoading(true);
      setLoadError('');
      console.log('[my-perf] starting load for user', myId);

      // v55.73 — hard timeout. If something stalls, give the user a clean
      // out instead of an infinite spinner. 8 seconds is generous enough
      // for a slow Supabase round-trip but short enough to not feel broken.
      const TIMEOUT_MS = 8000;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        console.warn('[my-perf] load timeout — bailing to clean state');
        setLoadError('Sara is having trouble loading your activity right now. Please try again in a moment.');
        setLoading(false);
      }, TIMEOUT_MS);

      const period180 = resolvePeriod('1y'); // grab a year back so any selected period fits
      // Fetch in parallel; each query in its own try/catch so one failure doesn't kill all
      const safe = async (label, fn) => {
        try { return await fn(); }
        catch(e) {
          console.warn('[my-perf] query fail:', label, e?.message || e);
          return [];
        }
      };
      try {
        const [tickets, ticketComments, dailyLog, auditLog, customerQuotes, calendarEvents, systemTickets] = await Promise.all([
          safe('tickets', async () => (await supabase.from('tickets').select('*').or('assigned_to.eq.' + myId + ',created_by.eq.' + myId + ',closed_by.eq.' + myId)).data || []),
          safe('ticket_comments', async () => (await supabase.from('ticket_comments').select('*').eq('created_by', myId).gte('created_at', period180.from)).data || []),
          safe('daily_log', async () => (await supabase.from('daily_log').select('*').eq('user_id', myId).gte('log_date', period180.from)).data || []),
          safe('audit_log', async () => (await supabase.from('audit_log').select('*').eq('changed_by', myId).gte('created_at', period180.from + 'T00:00:00')).data || []),
          safe('customer_quotes', async () => (await supabase.from('customer_quotes').select('*').eq('created_by', myId).gte('created_at', period180.from)).data || []),
          safe('calendar_events', async () => (await supabase.from('calendar_events').select('*').gte('event_date', period180.from)).data || []),
          // v55.65 — fetch system tickets the user created or retested so the
          // scoring formula can credit bug-reporting + retest follow-through.
          safe('system_tickets', async () => (await supabase.from('system_tickets').select('*').or('created_by.eq.' + myId + ',retest_completed_by.eq.' + myId).gte('created_at', period180.from)).data || []),
        ]);
        if (cancelled) return;
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        console.log('[my-perf] load complete', {
          tickets: tickets.length,
          ticketComments: ticketComments.length,
          dailyLog: dailyLog.length,
          auditLog: auditLog.length,
          customerQuotes: customerQuotes.length,
          calendarEvents: calendarEvents.length,
          systemTickets: systemTickets.length,
        });
        setData({ tickets, ticketComments, dailyLog, auditLog, customerQuotes, calendarEvents, systemTickets });
        setLoading(false);
      } catch (e) {
        // Should rarely fire — safe() catches per-query errors. This is the
        // last line of defense for an unforeseen crash (e.g. Promise.all itself).
        console.error('[my-perf] LOAD CRASHED:', e);
        if (!cancelled) {
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
          // Sanitized message for the user; technical detail in console for debugging.
          setLoadError('Sara is having trouble loading your activity. Please refresh or try again later.');
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [myId, expanded, hasBeenActive]);

  // Compute metrics for current + prior period
  const { current, prior, deltas } = useMemo(() => {
    if (!data || !myId) return { current: null, prior: null, deltas: {} };
    const cur = resolvePeriod(period);
    const pri = resolvePriorPeriod(cur);
    const m1 = calcMetricsForUser(myId, cur, data);
    const m2 = calcMetricsForUser(myId, pri, data);
    return { current: m1, prior: m2, deltas: computeDeltas(m1, m2) };
  }, [data, myId, period]);

  const requestCoach = async () => {
    if (!current) return;
    setCoachLoading(true);
    setCoachError('');
    try {
      const res = await fetch('/api/hr-report/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: myName,
          period: period,
          metrics: current,
          deltas: deltas,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Coach unavailable');
      setCoachMsg(j.message || '');
    } catch (e) {
      setCoachError(e.message || 'Could not reach coach');
    } finally {
      setCoachLoading(false);
    }
  };

  if (!expanded) {
    return (
      <div className="bg-gradient-to-r from-violet-50 to-blue-50 rounded-xl p-4 border border-violet-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl">📊</div>
            <div>
              <div className="font-bold text-slate-800">My Performance</div>
              <div className="text-xs text-slate-600">See what you've accomplished and get coach feedback</div>
            </div>
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition shadow-sm"
          >
            Open
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      {/* Header — v55.65 added the logo (SVG inline so no asset file needed) */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Inline SVG logo: stylized rising bars + speech bubble = "performance + coach" */}
          <div className="relative flex-shrink-0" style={{ width: 44, height: 44 }}>
            <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="mp-grad-bg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
                <linearGradient id="mp-grad-bar" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#fde68a" />
                </linearGradient>
              </defs>
              {/* Rounded square background */}
              <rect x="1" y="1" width="42" height="42" rx="11" fill="url(#mp-grad-bg)" />
              {/* Three rising bars (performance metaphor) */}
              <rect x="9"  y="24" width="6" height="11" rx="1.5" fill="url(#mp-grad-bar)" />
              <rect x="18" y="18" width="6" height="17" rx="1.5" fill="url(#mp-grad-bar)" />
              <rect x="27" y="12" width="6" height="23" rx="1.5" fill="url(#mp-grad-bar)" />
              {/* Coach speech bubble dot top-right */}
              <circle cx="34" cy="11" r="5" fill="#ffffff" opacity="0.95" />
              <circle cx="32" cy="11" r="0.9" fill="#8b5cf6" />
              <circle cx="34" cy="11" r="0.9" fill="#8b5cf6" />
              <circle cx="36" cy="11" r="0.9" fill="#8b5cf6" />
            </svg>
            {/* Tiny notification pulse to signal "the coach has feedback for you" */}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse"></span>
          </div>
          <div>
            <div className="font-extrabold text-lg text-slate-800">My Performance · AI Coach</div>
            <div className="text-xs text-slate-500">Your activity, your trends, your growth — with an AI pep talk on demand</div>
          </div>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-xs px-3 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          Collapse
        </button>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-1 mb-4 rounded-lg border border-slate-200 p-1 bg-slate-50">
        {PERIOD_LABELS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => setPeriod(v)}
            className={'px-3 py-1.5 rounded text-xs font-semibold transition ' +
              (period === v ? 'bg-violet-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100')}
          >
            {l}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading your activity…</div>
      )}

      {/* v55.73 — clean professional error message instead of raw error
          text. Reported by Max May 8 2026: "user should not see strange
          technical errors. Show a clean professional message and log the
          real error in the backend." Real error stays in console for debug. */}
      {!loading && loadError && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-800">
          <div className="font-bold mb-1">👋 Sara here — couldn't load your activity</div>
          <div className="text-xs leading-relaxed">{loadError}</div>
          <button
            onClick={function () {
              setLoadError('');
              setData(null);
              setLoading(true);
              // Force re-trigger of the load effect
              setExpanded(false);
              setTimeout(function () { setExpanded(true); }, 50);
            }}
            className="mt-3 px-3 py-1.5 bg-rose-600 text-white text-xs font-bold rounded hover:bg-rose-700">
            Try again
          </button>
        </div>
      )}

      {/* v55.54 — Fallback when current metrics object is null (data
          loaded but couldn't compute). Catches any silent failure inside
          calcMetricsForUser. */}
      {!loading && !loadError && !current && data && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <div className="font-bold mb-1">No activity to show yet</div>
          <div className="text-xs">Once you've created a ticket, written a comment, or logged daily activity, your metrics will appear here.</div>
        </div>
      )}

      {/* v55.73 — Sara-voice empty state for when myId hasn't arrived yet
          OR when load completed but data state is null (rare — means the
          Promise.all returned but data wasn't set). Per Max's spec:
          "If no data exists, Sara shows a clean empty state." */}
      {!loading && !loadError && !data && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4 text-sm text-cyan-900">
          <div className="font-bold mb-1">👋 Hey, I'm Sara</div>
          <div className="text-xs leading-relaxed">
            I don't see enough activity data yet to score your performance, but I can still help you set goals and improve your workflow. Once you've worked through some tickets, written a few comments, or logged daily activity, your metrics will appear here automatically.
          </div>
        </div>
      )}

      {!loading && current && (
        <>
          {/* Wins highlights */}
          <Wins metrics={current} deltas={deltas} />

          {/* Activity grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <SelfStat label="Tickets You Closed" value={current.ticketsClosed} delta={deltas.ticketsClosed} suffix="closed" tone="green" />
            <SelfStat label="Tickets You Opened" value={current.ticketsCreated} delta={deltas.ticketsCreated} suffix="opened" tone="blue" />
            <SelfStat label="Comments You Wrote" value={current.ticketComments} delta={deltas.ticketComments} suffix="comments" tone="purple" hint="How often you check in on your tickets" />
            <SelfStat label="Shipping Rates Added" value={current.ratesAdded} delta={deltas.ratesAdded} suffix="rates" tone="cyan" />
            <SelfStat label="Bookings Made" value={current.bookings} delta={deltas.bookings} suffix="bookings" tone="emerald" />
            <SelfStat label="Quotes Created" value={current.quotesCreated} delta={deltas.quotesCreated} suffix="quotes" tone="amber" />
            <SelfStat label="Customer Touches" value={current.contactTouches + current.pipelineMoves} delta={null} suffix="touches" tone="rose" hint="Pipeline moves + contact updates" />
            {/* v55.65 — split "Meetings" into the three signals Max asked for:
                created (you organized), attended (you were invited & showed),
                checked-in (you actually signed in to confirm presence) */}
            <SelfStat label="Meetings You Set Up" value={current.meetingsCreated || 0} delta={deltas.meetingsCreated} suffix="meetings" tone="indigo" hint="Meetings you organized in this period" />
            <SelfStat label="Meetings Attended" value={current.attendedEvents} delta={deltas.attendedEvents} suffix="meetings" tone="indigo" hint="Meetings where you were on the invite list" />
            <SelfStat label="Meetings You Signed Into" value={current.meetingsCheckedIn || 0} delta={deltas.meetingsCheckedIn} suffix="check-ins" tone="emerald" hint="Meetings you actively checked into — the strongest 'I was there' signal" />
            {current.meetingShowUpPct != null && (
              <SelfStat label="Show-Up Rate" value={current.meetingShowUpPct + '%'} delta={null} suffix={'of ' + (current.meetingsHeldFromMine || 0) + ' you set up'} tone={current.meetingShowUpPct >= 80 ? 'emerald' : current.meetingShowUpPct >= 50 ? 'amber' : 'rose'} hint="Of the meetings you organized that have already happened, how many you actually showed up to" />
            )}
            {/* v55.65 — bug-reporting + retest follow-through */}
            {(current.systemTicketsCreated || 0) > 0 && (
              <SelfStat label="Bug Reports Filed" value={current.systemTicketsCreated} delta={deltas.systemTicketsCreated} suffix={current.systemTicketsFixed > 0 ? '· ' + current.systemTicketsFixed + ' already fixed' : 'reports'} tone="purple" hint="System tickets you've opened — your QA contribution to the team" />
            )}
            {(current.systemTicketsRetested || 0) > 0 && (
              <SelfStat label="Bugs You Retested" value={current.systemTicketsRetested} delta={deltas.systemTicketsRetested} suffix="closed loop" tone="teal" hint="Bugs you reported, then verified the fix on. Closing the loop matters." />
            )}
            <SelfStat label="Daily Log Streak" value={current.manualDays} delta={deltas.manualEntries} suffix={'/' + current.workingDays + ' work days'} tone="teal" hint="Days you wrote a manual entry" />
          </div>

          {/* Daily log fill bar */}
          <DailyLogBar metrics={current} />

          {/* Tickets-on-time mini-callout (positive only) */}
          {current.ticketsClosed > 0 && (
            <div className={'rounded-lg p-3 mb-4 text-xs ' +
              (current.onTimePct >= 80 ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
               current.onTimePct >= 50 ? 'bg-amber-50 border border-amber-200 text-amber-800' :
               'bg-blue-50 border border-blue-200 text-blue-800')}>
              {current.onTimePct >= 80 && (
                <span><strong>🎯 Strong on-time rate.</strong> {current.ticketsClosedOnTime} of your {current.ticketsClosed} closed tickets came in on or before deadline.</span>
              )}
              {current.onTimePct >= 50 && current.onTimePct < 80 && (
                <span><strong>👍 You closed {current.ticketsClosed} tickets.</strong> {current.ticketsClosedOnTime} on time, {current.ticketsClosedLate} after deadline. Worth a look at your scheduling.</span>
              )}
              {current.onTimePct < 50 && (
                <span><strong>You closed {current.ticketsClosed} tickets this period.</strong> Some came in late — check in on overdue items earlier and you'll see this rebound fast.</span>
              )}
            </div>
          )}

          {/* AI Coach */}
          <div className="bg-gradient-to-r from-violet-50 to-pink-50 rounded-lg p-4 border border-violet-200">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <div className="text-2xl">🌱</div>
                <div className="font-bold text-violet-800">Personal Coach</div>
              </div>
              <button
                onClick={requestCoach}
                disabled={coachLoading || !current}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {coachLoading ? 'Coach is thinking…' : (coachMsg ? '↻ Refresh' : 'Get Coach Feedback')}
              </button>
            </div>
            {coachError && (
              <div className="text-xs text-rose-700 bg-rose-50 rounded p-2 mt-2">{coachError}</div>
            )}
            {coachMsg && (
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap mt-2">{coachMsg}</div>
            )}
            {!coachMsg && !coachError && (
              <div className="text-xs text-slate-600 italic mt-2">
                Tap the button to get a personalized note from your coach. It'll highlight your wins and suggest one or two things you could focus on next.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- Subcomponent: positive wins highlights ---
function Wins({ metrics, deltas }) {
  const wins = [];
  if (metrics.ticketsClosed > 0 && (deltas?.ticketsClosed?.diff || 0) > 0) {
    wins.push('Closed ' + deltas.ticketsClosed.diff + ' more tickets than last period');
  }
  if (metrics.bookings > 0 && (deltas?.bookings?.diff || 0) > 0) {
    wins.push('Locked in ' + metrics.bookings + ' booking' + (metrics.bookings === 1 ? '' : 's'));
  }
  if (metrics.onTimePct != null && metrics.onTimePct >= 80) {
    wins.push(metrics.onTimePct + '% of your closes were on time');
  }
  if (metrics.manualFillRatePct >= 80) {
    wins.push('Daily log filled ' + metrics.manualFillRatePct + '% of working days');
  }
  if (metrics.ratesAdded > 0 && (deltas?.ratesAdded?.diff || 0) >= 0) {
    wins.push('Added ' + metrics.ratesAdded + ' shipping rate' + (metrics.ratesAdded === 1 ? '' : 's'));
  }
  if ((deltas?.totalActions?.diff || 0) > 0) {
    wins.push('Up ' + deltas.totalActions.diff + ' total actions vs last period');
  }
  if (wins.length === 0) return null;
  return (
    <div className="bg-emerald-50 rounded-lg p-3 mb-4 border border-emerald-200">
      <div className="text-xs font-bold text-emerald-800 mb-1">✨ Wins this period</div>
      <ul className="text-xs text-emerald-700 space-y-0.5">
        {wins.slice(0, 4).map((w, i) => <li key={i}>• {w}</li>)}
      </ul>
    </div>
  );
}

// --- Subcomponent: a single metric tile ---
function SelfStat({ label, value, delta, suffix, tone, hint }) {
  const toneClass = {
    green: 'bg-emerald-50 border-emerald-200',
    blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200',
    cyan: 'bg-cyan-50 border-cyan-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
    rose: 'bg-rose-50 border-rose-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    teal: 'bg-teal-50 border-teal-200',
  }[tone] || 'bg-slate-50 border-slate-200';
  const valueClass = {
    green: 'text-emerald-700',
    blue: 'text-blue-700',
    purple: 'text-purple-700',
    cyan: 'text-cyan-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
    teal: 'text-teal-700',
  }[tone] || 'text-slate-700';

  let deltaTxt = '';
  let deltaCls = '';
  if (delta && typeof delta.diff === 'number') {
    if (delta.diff > 0) { deltaTxt = '↑ ' + delta.diff; deltaCls = 'text-emerald-600'; }
    else if (delta.diff < 0) { deltaTxt = '↓ ' + Math.abs(delta.diff); deltaCls = 'text-slate-500'; }
    else { deltaTxt = '— same'; deltaCls = 'text-slate-400'; }
  }

  return (
    <div className={'rounded-lg p-3 border ' + toneClass}>
      <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className={'text-2xl font-extrabold ' + valueClass}>{value}</div>
        <div className="text-[10px] text-slate-500">{suffix}</div>
      </div>
      {deltaTxt && (
        <div className={'text-[10px] font-semibold mt-0.5 ' + deltaCls}>{deltaTxt} vs last period</div>
      )}
      {hint && (
        <div className="text-[10px] text-slate-500 italic mt-1">{hint}</div>
      )}
    </div>
  );
}

// --- Subcomponent: daily log fill bar ---
function DailyLogBar({ metrics }) {
  const pct = metrics.manualFillRatePct || 0;
  const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-slate-400';
  return (
    <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200">
      <div className="flex justify-between items-center mb-1.5">
        <div className="text-xs font-semibold text-slate-700">📝 Daily Log Consistency</div>
        <div className="text-xs font-bold text-slate-700">{pct}%</div>
      </div>
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className={'h-full ' + tone + ' transition-all'} style={{ width: pct + '%' }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-1">
        You wrote a manual entry on {metrics.manualDays} of {metrics.workingDays} working days. Auto-actions logged separately don't count here.
      </div>
    </div>
  );
}
