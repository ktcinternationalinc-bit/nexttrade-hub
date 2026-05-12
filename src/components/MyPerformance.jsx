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

import { useState, useEffect, useMemo, useRef } from 'react';
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
  // v55.82-S — Per-user language toggle for the Personal Coach feedback.
  // Independent of the global app language so a user can flip the coach
  // output to Arabic without changing the rest of the UI. Default 'en'.
  const [coachLang, setCoachLang] = useState('en');
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

  // v55.81 QA-9 (Max May 9 2026): single source of truth for "does this
  // user have any activity in the selected period?". Used to decide
  // whether to show Sara's empty-state card OR the activity grid + coach.
  // Previously this 14-field sum was computed twice — once per branch.
  const hasAnyActivity = useMemo(function () {
    if (!current) return false;
    var sum = (current.ticketsClosed || 0) + (current.ticketsCreated || 0) +
              (current.ticketComments || 0) + (current.manualEntries || 0) +
              (current.autoEntries || 0) + (current.ratesAdded || 0) +
              (current.bookings || 0) + (current.quotesCreated || 0) +
              (current.contactTouches || 0) + (current.pipelineMoves || 0) +
              (current.assignedEvents || 0) + (current.attendedEvents || 0) +
              (current.meetingsCreated || 0) + (current.meetingsCheckedIn || 0) +
              (current.systemTicketsCreated || 0) + (current.systemTicketsRetested || 0);
    return sum > 0;
  }, [current]);

  const requestCoach = async () => {
    // v55.82-L — DON'T bail if `current` is null. Previously this silently
    // returned, so a user with slow metrics fetch would click the button
    // and see nothing happen. Now we send whatever we have (possibly empty
    // metrics) and let the API produce a graceful "I don't have your data
    // yet" coach message. Better than a silent dead click.
    setCoachLoading(true);
    setCoachError('');
    setCoachMsg('');
    try {
      const res = await fetch('/api/hr-report/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: myName,
          period: period,
          metrics: current || {},
          deltas: deltas || {},
          // v55.82-S — language toggle independent of global app lang
          lang: coachLang,
        }),
      });
      // v55.81 — robust response handling. If the route returns HTML (e.g.
      // Vercel error page) or empty body, .json() throws; catch and surface
      // a usable message instead of a silent empty result.
      var rawText = '';
      try { rawText = await res.text(); } catch (_) { rawText = ''; }
      var j = {};
      try { j = rawText ? JSON.parse(rawText) : {}; } catch (_) { j = { error: 'Coach returned unexpected response' }; }
      if (!res.ok) {
        throw new Error((j && j.error) || ('Coach unavailable (HTTP ' + res.status + ')'));
      }
      var msg = (j && j.message) || '';
      if (!msg) {
        throw new Error('Coach returned no feedback this time. Try again or pick a different period.');
      }
      setCoachMsg(msg);
    } catch (e) {
      setCoachError((e && e.message) || 'Could not reach coach');
    } finally {
      setCoachLoading(false);
    }
  };

  // v55.82-L — AUTO-FETCH coach feedback on first show. Max May 11 2026
  // (10th time he's reported this!) — photo evidence kept showing blank
  // Personal Coach panel. Root causes were:
  //   (a) the entire coach card was nested INSIDE the `hasAnyActivity`
  //       branch — so users with zero activity never even saw the card,
  //   (b) the auto-fetch effect had `if (!hasAnyActivity) return;` which
  //       silently bailed for low-activity users,
  //   (c) the button was disabled when `!current` so users with slow
  //       network couldn't even try.
  // v55.82-L removes all three of those gates. The coach card always
  // mounts and the auto-fetch always runs as long as the panel is open
  // and we have any user identity. Even a zero-activity period gets a
  // coach message (the API has a no-activity branch that produces
  // encouragement).
  // v55.82-T (Max May 12 2026 — "Sarah saying no data when data exists"):
  // Two NEW guards on top of the v55.82-L logic:
  //   (a) DO NOT auto-fetch until the metrics calculation actually
  //       finished (loading === false). Previously the effect fired on
  //       first render while current was still null, sending metrics:{}
  //       to the API. The AI then correctly responded "no recorded
  //       activity" — based on the empty payload it received.
  //   (b) The de-dup key now includes a small fingerprint of the metrics
  //       payload (totalActions). So when current goes from {} (initial)
  //       → {ticketsClosed: 5, totalActions: 396, …} (after data loads),
  //       the key changes and the auto-fetch fires again with the REAL
  //       data, overwriting the stale "no activity" message.
  const autoFetchedRef = useRef('');
  useEffect(function () {
    if (!expanded) return;
    if (!myId) return;
    // v55.82-T (a) — wait for metrics to finish loading. Sending empty
    // {} to the coach API was the root cause of the "no recorded
    // activity" message Max saw despite real metrics on screen.
    if (loading) return;
    if (coachLoading) return;
    // v55.82-T (b) — fingerprint includes a few key numbers from current
    // so we re-fetch when stale-empty data is replaced by real data.
    // totalActions is the umbrella metric — when it goes from undefined
    // to a real number, that's the signal to redo the request.
    var fp = current
      ? ((current.totalActions || 0) + ':' + (current.ticketsClosed || 0) + ':' + (current.manualEntries || 0))
      : 'empty';
    var key = (myId || 'anon') + ':' + period + ':' + fp;
    if (autoFetchedRef.current === key) return;
    autoFetchedRef.current = key;
    // Clear any prior stale message before refetching with the new key.
    // Without this, the second fetch would no-op because the early-return
    // checks coachMsg / coachError.
    if (coachMsg) setCoachMsg('');
    if (coachError) setCoachError('');
    requestCoach();
  }, [expanded, myId, period, current, loading]);

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
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
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

      {/* v55.81 #5 (Max May 9 2026): When `current` exists but the user has
          literally no activity in this period, the activity grid was a wall
          of zero tiles ("0 closed · 0 opened · 0 comments · 0 touches…")
          which felt like an empty white block.
          v55.81 QA-3 (May 9): added meetingsCreated + meetingsCheckedIn to
          the activity sum — without them, a user who only set up meetings
          this period would falsely see the empty state.
          v55.81 QA-9 (May 9): both branches now use hasAnyActivity (a
          single useMemo) — no more duplicated 14-field sum. */}
      {!loading && current && !hasAnyActivity && (function () {
        var periodLabel = (PERIOD_LABELS.find(function(p){return p[0]===period;}) || [null, 'this period'])[1];
        return (
          <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4 text-sm text-cyan-900 mb-3">
            <div className="font-bold mb-1">👋 No activity in {periodLabel}</div>
            <div className="text-xs leading-relaxed">
              I don't see any tickets, comments, daily log entries, customer touches, or meetings yet. Try a longer period above, or once you've logged some activity I'll show your wins and trends here.
            </div>
          </div>
        );
      })()}

      {!loading && current && hasAnyActivity && (
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
            <SelfStat label="Customer Touches" value={(current.contactTouches || 0) + (current.pipelineMoves || 0)} delta={null} suffix="touches" tone="rose" hint="Pipeline moves + contact updates" />
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
              // v55.82-I — Max May 11 2026: middle band was amber-50 bg +
              // amber-900 text which read as a dim yellow wash on a light
              // screen — basically invisible. Photo evidence showed the
              // "You closed 5 tickets" line unreadable. Replaced with a
              // white surface + slate-900 text + amber-500 LEFT border so
              // the warning hue stays without burying the words.
              (current.onTimePct >= 80 ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
               current.onTimePct >= 50 ? 'bg-white border-2 border-amber-500 text-slate-900' :
               'bg-blue-50 border border-blue-200 text-blue-800')}
              style={current.onTimePct >= 50 && current.onTimePct < 80 ? { borderLeftWidth: '6px' } : undefined}>
              {current.onTimePct >= 80 && (
                <span><strong>🎯 Strong on-time rate.</strong> {current.ticketsClosedOnTime} of your {current.ticketsClosed} closed tickets came in on or before deadline.</span>
              )}
              {current.onTimePct >= 50 && current.onTimePct < 80 && (
                <span className="font-semibold"><strong className="text-amber-700">👍 You closed {current.ticketsClosed} tickets.</strong> {current.ticketsClosedOnTime} on time, {current.ticketsClosedLate} after deadline. Worth a look at your scheduling.</span>
              )}
              {current.onTimePct < 50 && (
                <span><strong>You closed {current.ticketsClosed} tickets this period.</strong> Some came in late — check in on overdue items earlier and you'll see this rebound fast.</span>
              )}
            </div>
          )}
        </>
      )}

      {/* AI Coach card — v55.82-L (Max May 11 2026 — 10th report of blank
          coach panel). MOVED OUT of the `hasAnyActivity &&` branch so it
          ALWAYS renders, even for users with zero activity in this period.
          Previously, when hasAnyActivity was false, this card was skipped
          entirely and Max saw a blank spot. Now the card always shows; the
          coach copy adapts to what data is available. */}
      {!loading && (function () {
        // v55.82-S — All card labels translated based on coachLang. The
        // body text (coachMsg) comes from the API already-translated.
        var isAr = coachLang === 'ar';
        var tLabel = {
          title:           isAr ? 'المدرّب الشخصي' : 'Personal Coach',
          thinking:        isAr ? 'المدرّب يفكّر…' : 'Coach is thinking…',
          refresh:         isAr ? '↻ تحديث' : '↻ Refresh',
          getFeedback:     isAr ? 'احصل على تقييم المدرّب' : 'Get Coach Feedback',
          tryAgain:        isAr ? 'حاول مرة أخرى' : 'Try again',
          cantRespond:     isAr ? '⚠️ المدرّب لا يستطيع الرد الآن' : "⚠️ Coach can't respond right now",
          yourFeedback:    isAr ? 'تقييم المدرّب الخاص بك' : 'Your coach feedback',
          writing:         isAr ? 'المدرّب يكتب تقييمك…' : 'Coach is writing your feedback…',
          writingSub:      isAr ? 'ملاحظة مخصّصة عن إنجازاتك في هذه الفترة.' : 'A personalized note about your wins this period.',
          noFeedback:      isAr ? 'لا يوجد تقييم بعد' : 'No feedback yet',
          tapToGet:        isAr
            ? 'اضغط على '
            : 'Tap ',
          tapToGetSuffix:  isAr
            ? ' للحصول على ملاحظة مخصّصة عن إنجازاتك في هذه الفترة وشيء أو اثنين للتركيز عليه بعد ذلك.'
            : ' above for a personalized note about your wins this period and one or two things to focus on next.',
          langToggleToAr:  'العربية',
          langToggleToEn:  'English',
        };
        // Direction control: when the response is Arabic, the body should
        // render RTL so it reads correctly. Card chrome stays LTR so
        // numbers/badges keep their layout.
        var bodyDir = isAr ? 'rtl' : 'ltr';
        return (
        <div className="bg-gradient-to-r from-violet-50 to-pink-50 rounded-lg p-4 border border-violet-200">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="text-2xl">🌱</div>
              <div className="font-bold text-violet-900">{tLabel.title}</div>
            </div>
            <div className="flex items-center gap-2">
              {/* v55.82-S — Language toggle. Two pill buttons (EN / AR).
                  Switching language clears any cached feedback so the
                  user sees a fresh request in the new language. */}
              <div className="inline-flex rounded-lg overflow-hidden border border-violet-300 text-[10px] font-bold">
                <button
                  onClick={function () {
                    if (coachLang === 'en') return;
                    setCoachLang('en');
                    setCoachMsg('');
                    setCoachError('');
                  }}
                  className={'px-2 py-1 ' + (coachLang === 'en' ? 'bg-violet-700 text-white' : 'bg-white text-violet-800 hover:bg-violet-50')}
                  title="Show coach feedback in English"
                  aria-label="Switch coach feedback to English"
                >EN</button>
                <button
                  onClick={function () {
                    if (coachLang === 'ar') return;
                    setCoachLang('ar');
                    setCoachMsg('');
                    setCoachError('');
                  }}
                  className={'px-2 py-1 ' + (coachLang === 'ar' ? 'bg-violet-700 text-white' : 'bg-white text-violet-800 hover:bg-violet-50')}
                  title="إظهار تقييم المدرّب بالعربية"
                  aria-label="Switch coach feedback to Arabic"
                >AR</button>
              </div>
              <button
                onClick={requestCoach}
                disabled={coachLoading}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-700 text-white font-semibold hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {coachLoading ? tLabel.thinking : (coachMsg ? tLabel.refresh : tLabel.getFeedback)}
              </button>
            </div>
          </div>
          {coachError && (
            <div className="mt-2 p-3 rounded-lg bg-rose-100 border-2 border-rose-400 text-sm text-rose-950" dir={bodyDir}>
              <div className="font-extrabold mb-1">{tLabel.cantRespond}</div>
              <div className="text-xs text-rose-900 font-medium">{coachError}</div>
              <button
                onClick={requestCoach}
                disabled={coachLoading}
                className="mt-2 text-xs px-2 py-1 rounded bg-rose-200 hover:bg-rose-300 text-rose-950 font-bold disabled:opacity-50"
              >
                {tLabel.tryAgain}
              </button>
            </div>
          )}
          {coachMsg && (
            <div className="mt-2 p-4 rounded-lg bg-white border border-violet-200 shadow-sm" dir={bodyDir}>
              <div className="text-[10px] uppercase tracking-wide font-extrabold text-violet-800 mb-2">{tLabel.yourFeedback}</div>
              <div className="text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-wrap">{coachMsg}</div>
            </div>
          )}
          {coachLoading && !coachMsg && (
            <div className="mt-3 p-4 rounded-lg bg-white border-2 border-dashed border-violet-400 text-center" dir={bodyDir}>
              <div className="text-sm font-extrabold text-violet-900 mb-1">{tLabel.writing}</div>
              <div className="text-xs text-slate-700 font-medium">{tLabel.writingSub}</div>
            </div>
          )}
          {!coachMsg && !coachError && !coachLoading && (
            <div className="mt-3 p-4 rounded-lg bg-white border-2 border-dashed border-violet-400" dir={bodyDir}>
              <div className="text-sm font-extrabold text-slate-900 mb-1">{tLabel.noFeedback}</div>
              <div className="text-xs text-slate-800 font-medium">
                {tLabel.tapToGet}<strong className="text-violet-800">{tLabel.getFeedback}</strong>{tLabel.tapToGetSuffix}
              </div>
            </div>
          )}
        </div>
        );
      })()}
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
    <div className="bg-emerald-100 rounded-lg p-3 mb-4 border border-emerald-300">
      <div className="text-xs font-extrabold text-emerald-900 mb-1">✨ Wins this period</div>
      <ul className="text-xs text-emerald-900 font-medium space-y-0.5">
        {wins.slice(0, 4).map((w, i) => <li key={i}>• {w}</li>)}
      </ul>
    </div>
  );
}

// --- Subcomponent: a single metric tile ---
function SelfStat({ label, value, delta, suffix, tone, hint }) {
  // v55.82-I (Max May 11 2026): the dashboard runs on a dark canvas.
  // The previous SelfStat used pastel light backgrounds (bg-rose-50,
  // bg-teal-50, etc.) which rendered as glaring pink/teal islands on
  // the dark theme AND made the slate-500/600 supporting text muted
  // to the point of invisibility. Rose/teal cards in particular had
  // unreadable numbers (Max's May 11 photo).
  //
  // New design: every tone uses the SAME dark-glass card surface used
  // by the rest of the dashboard, with the tone driving ONLY the
  // accent color of the big number + a thin left border. Labels and
  // hints render in light slate text that's readable against dark
  // backgrounds. Result: visual rhythm matches the rest of the
  // dashboard, and every number is high-contrast.
  const accentColor = {
    green: '#34d399',     // emerald-400
    blue: '#38bdf8',      // sky-400
    purple: '#a78bfa',    // violet-400
    cyan: '#22d3ee',      // cyan-400
    emerald: '#34d399',
    amber: '#fbbf24',     // amber-400
    rose: '#fb7185',      // rose-400
    indigo: '#818cf8',    // indigo-400
    teal: '#2dd4bf',      // teal-400
  }[tone] || '#cbd5e1';   // slate-300 fallback

  let deltaTxt = '';
  let deltaCls = '';
  if (delta && typeof delta.diff === 'number') {
    if (delta.diff > 0) { deltaTxt = '↑ ' + delta.diff; deltaCls = 'text-emerald-400'; }
    else if (delta.diff < 0) { deltaTxt = '↓ ' + Math.abs(delta.diff); deltaCls = 'text-slate-400'; }
    else { deltaTxt = '— same'; deltaCls = 'text-slate-500'; }
  }

  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeft: '3px solid ' + accentColor,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'rgba(203,213,225,0.85)' }}>{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-2xl font-extrabold" style={{ color: accentColor }}>{value}</div>
        <div className="text-[10px]" style={{ color: 'rgba(148,163,184,0.9)' }}>{suffix}</div>
      </div>
      {deltaTxt && (
        <div className={'text-[10px] font-semibold mt-0.5 ' + deltaCls}>{deltaTxt} vs last period</div>
      )}
      {hint && (
        <div className="text-[10px] italic mt-1" style={{ color: 'rgba(148,163,184,0.8)' }}>{hint}</div>
      )}
    </div>
  );
}

// --- Subcomponent: daily log fill bar ---
function DailyLogBar({ metrics }) {
  // v55.81 #5 (Max May 9 2026): If the period has zero working days
  // (e.g., user just joined, or it's a leave-only period), the original
  // bar showed "0 of 0 working days" with an empty grey progress strip
  // — feels broken. Render a friendly explainer instead.
  if (!metrics.workingDays || metrics.workingDays === 0) {
    return (
      <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200">
        <div className="flex justify-between items-center mb-1">
          <div className="text-xs font-semibold text-slate-700">📝 Daily Log Consistency</div>
          <div className="text-[10px] text-slate-500">no working days in this period</div>
        </div>
        <div className="text-[10px] text-slate-500 leading-snug">
          Once you have working days in this period, this shows what % of them you wrote a manual log entry for. Streaks build credibility.
        </div>
      </div>
    );
  }
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
