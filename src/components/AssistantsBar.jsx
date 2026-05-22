'use client';
// ============================================================
// AssistantsBar — v55.71
//
// THREE big animated avatar tiles that DOMINATE the dashboard.
// Per Max May 7 2026: "Three partners — Miss Nadia executive assistant,
// Miss Jenna HR representative, Miss Sara work/relationship coach.
// Three really big icons. You select them and it opens up what they
// do. Doesn't have to be open unless you click — except Nadia's
// morning brief which shows initially. They can close to just the
// icons. Three beautiful different women prevailing on the dashboard."
//
// Behavior:
//   - Three large avatar buttons side-by-side.
//   - Click an avatar → expands its panel below. Click the same one
//     again to close. Click a different one to switch.
//   - On first dashboard load, Nadia's panel auto-opens (morning
//     brief). Once user manually closes it, stays closed for the day.
//   - Each panel renders the relevant existing component:
//        Nadia → quick-stat morning brief + "Open Nadia chat" button
//                that scrolls to the existing AIGreeter
//        Jenna → MyHRDesk (file request/complaint, see responses)
//        Sara  → MyPerformance (scoring + AI coach feedback)
// ============================================================
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import MyHRDesk from './MyHRDesk';
import MyPerformance from './MyPerformance';
import { AGENT_PERSONALITIES } from '../lib/agent-personalities';
import { SafeSection } from './ErrorBoundary';
import { todayET, etDateStr } from '../lib/et-time';

var NADIA_AUTO_OPEN_KEY = 'ktc_nadia_morning_brief_dismissed_at';

export default function AssistantsBar({
  user, userProfile, users,
  tickets, checks,
  onTalkToNadia,
  // v55.75 — Build A item #1: SINGLE GUI SURFACE.
  // Per Max May 8 2026: "Do not send the user to another section when
  // clicking 'Open Nadia Chat.' The chat must open directly under the
  // avatars inside the same AI GUI." This slot accepts the AIGreeter
  // element from page.jsx and renders it INLINE below the active
  // assistant's panel. AIGreeter itself is unchanged — just relocated.
  chatSurface,
}) {
  var myId = (userProfile && userProfile.id) || (user && user.id);
  var firstName = ((userProfile && userProfile.name) || (user && user.email) || 'there').split(' ')[0].split('@')[0];

  // Expansion state
  // v55.73 — Per Max's spec: ONE ASSISTANT ALWAYS ACTIVE. Nadia is the
  // default. The dismissed-today flag is no longer used to close her —
  // it just informs whether her morning brief shows the auto-open badge.
  // v55.78 — Initial state hydrates from localStorage so persona persists
  // across reloads. page.jsx persists ktc.lastPersona; we read it here
  // so the unified module starts with the right tile glowing.
  // v55.80 BD-AUDIT FIX: per-user persona preference. Was 'ktc.lastPersona'
  // (global) — would carry one user's choice into the next user's session
  // on a shared browser. Now keyed per user id; falls back to 'nadia' if
  // user not yet known or no preference saved.
  var [openPanel, setOpenPanel] = useState('nadia');
  useEffect(function () {
    if (typeof window === 'undefined' || !myId) return;
    try {
      var saved = window.localStorage && window.localStorage.getItem('ktc.lastPersona.' + myId);
      if (saved === 'nadia' || saved === 'jenna' || saved === 'sara') setOpenPanel(saved);
    } catch (_) {}
  }, [myId]);

  // v55.73 — One assistant ALWAYS active. Per Max May 8 2026:
  //   "Only one assistant can be active at a time. Default: Nadia is
  //   active first. The user should clearly understand which assistant
  //   is currently in control."
  // togglePanel(which) now SELECTS that assistant. Clicking the already-
  // active tile is a no-op (instead of closing the panel) because we
  // want at least one always active.
  var togglePanel = function (which) {
    setOpenPanel(function (prev) {
      // No-op when clicking already-active
      if (prev === which) return prev;
      // Notify external listeners (e.g. AIGreeter) that the active
      // persona changed. Single source of truth lives in this component.
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktc:assistant-changed', { detail: { agent: which } }));
        }
      } catch (_) {}
      // Auto-talk to Nadia when she becomes active (preserves existing
      // scroll-to-greeter behavior from v55.70).
      if (which === 'nadia' && onTalkToNadia) {
        try { onTalkToNadia(); } catch (_) {}
      }
      return which;
    });
  };

  // v55.78 — Listen for EXTERNAL ktc:assistant-changed events (e.g. when
  // the user says "Hey Jenna" and the wake-word system dispatches a
  // persona swap). Without this, openPanel would stay on whichever tile
  // was clicked manually and the unified module's color wouldn't shift.
  // Guard: ignore events we dispatched ourselves (toggling) by comparing
  // the incoming agent to current openPanel — if same, no-op.
  useEffect(function () {
    if (typeof window === 'undefined') return;
    var handler = function (e) {
      var who = e && e.detail && e.detail.agent;
      if (who !== 'nadia' && who !== 'jenna' && who !== 'sara') return;
      setOpenPanel(function (prev) { return prev === who ? prev : who; });
    };
    window.addEventListener('ktc:assistant-changed', handler);
    return function () { window.removeEventListener('ktc:assistant-changed', handler); };
  }, []);

  // v55.75 — Build A item #2: HOVER/BLINK BUG FIX.
  // Per Max May 8 2026: "When hovering over the avatars, all three photos
  // blink together. That is wrong. Only the hovered avatar should have a
  // hover effect. Only the selected/active assistant should glow. Inactive
  // avatars should remain stable."
  //
  // Previously this useEffect had a periodic timer (1s/6s/11s offsets +
  // 16s loop) that auto-triggered waves on ALL THREE avatars in sequence,
  // creating the group-blinking effect. Removed entirely. Now wave state
  // ONLY responds to the user actually hovering over a specific avatar
  // (via the onMouseEnter/Leave handlers on each Tile).
  var [waveState, setWaveState] = useState({ nadia: false, jenna: false, sara: false });
  var setWave = function (who, val) { setWaveState(function (s) { var n = Object.assign({}, s); n[who] = val; return n; }); };
  // (no periodic timer here — hover-only animation)

  // v55.75 (A1) — Speaking state per assistant. The shared assistant module
  // below the photos dispatches a 'ktc:assistant-speaking' event with
  // { agent, speaking } whenever an AI starts/stops talking. We use this
  // to drive the speaking-only pulse animation on the active tile —
  // distinct from the calm idle glow.
  var [speakingState, setSpeakingState] = useState({ nadia: false, jenna: false, sara: false });
  useEffect(function () {
    var handler = function (e) {
      var who = e && e.detail && e.detail.agent;
      var speaking = !!(e && e.detail && e.detail.speaking);
      if (who === 'nadia' || who === 'jenna' || who === 'sara') {
        setSpeakingState(function (s) { var n = Object.assign({}, s); n[who] = speaking; return n; });
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('ktc:assistant-speaking', handler);
      return function () { window.removeEventListener('ktc:assistant-speaking', handler); };
    }
  }, []);

  // Summary counts
  var todayStr = todayET();
  var safeTickets = tickets || [];
  var safeChecks = checks || [];
  var myAck = safeTickets.filter(function (t) { return t.assigned_to === myId && t.status === 'New'; }).length;
  var myDueToday = safeTickets.filter(function (t) { return t.assigned_to === myId && t.due_date === todayStr && t.status !== 'Closed'; }).length;
  var myOverdue = safeTickets.filter(function (t) { return t.assigned_to === myId && t.due_date && t.due_date < todayStr && t.status !== 'Closed'; }).length;
  var checksDueToday = safeChecks.filter(function (c) { return c.collection_date === todayStr; }).length;
  var nadiaUrgentCount = myAck + myDueToday + myOverdue + checksDueToday;

  // Jenna fetches HR Desk pending counts
  var [jennaSummary, setJennaSummary] = useState({ pendingReq: 0, pendingCmp: 0, newResponses: 0, tableMissing: false });
  useEffect(function () {
    if (!myId) return;
    var cancelled = false;
    var loadJenna = async function () {
      try {
        var reqRes = await supabase.from('hr_requests').select('id,status,reviewed_at').eq('submitted_by', myId);
        var cmpRes = await supabase.from('hr_complaints').select('id,status,reviewed_at').eq('submitted_by', myId);
        if (cancelled) return;
        if ((reqRes.error && /does not exist/i.test(reqRes.error.message))
            || (cmpRes.error && /does not exist/i.test(cmpRes.error.message))) {
          setJennaSummary({ pendingReq: 0, pendingCmp: 0, newResponses: 0, tableMissing: true });
          return;
        }
        var reqs = reqRes.data || [];
        var cmps = cmpRes.data || [];
        var pendingReq = reqs.filter(function (r) { return ['submitted', 'under_review', 'more_info_needed'].indexOf(r.status) >= 0; }).length;
        var pendingCmp = cmps.filter(function (c) { return ['submitted', 'investigating', 'escalated'].indexOf(c.status) >= 0; }).length;
        var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        var newResponses = []
          .concat(reqs.filter(function (r) { return r.reviewed_at && r.reviewed_at > sevenDaysAgo; }))
          .concat(cmps.filter(function (c) { return c.reviewed_at && c.reviewed_at > sevenDaysAgo; }))
          .length;
        setJennaSummary({ pendingReq: pendingReq, pendingCmp: pendingCmp, newResponses: newResponses, tableMissing: false });
      } catch (e) {
        if (/does not exist/i.test((e && e.message) || '')) {
          setJennaSummary({ pendingReq: 0, pendingCmp: 0, newResponses: 0, tableMissing: true });
        }
      }
    };
    loadJenna();
    return function () { cancelled = true; };
  }, [myId]);

  // Sara — work-coach summary (lightweight: did the user open today?)
  var [saraSeenToday, setSaraSeenToday] = useState(true);
  useEffect(function () {
    try {
      if (typeof window === 'undefined' || !myId) return;
      // v55.80 BD-AUDIT FIX: per-user key (was global before, would
      // tell Omar "you saw Sara today" because Max opened her on this
      // browser yesterday).
      var sKey = 'ktc_sara_last_opened_' + myId;
      var lastSeen = window.localStorage.getItem(sKey);
      if (!lastSeen) { setSaraSeenToday(false); return; }
      var lastDate = etDateStr(new Date(lastSeen));
      setSaraSeenToday(lastDate === todayStr);
    } catch (_) {}
  }, [todayStr, myId]);
  useEffect(function () {
    if (openPanel === 'sara' && myId) {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('ktc_sara_last_opened_' + myId, new Date().toISOString());
        }
      } catch (_) {}
      setSaraSeenToday(true);
    }
  }, [openPanel, myId]);

  // Summary lines
  var greetTime = (function () { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();

  var nadiaLine = (function () {
    if (nadiaUrgentCount === 0) return greetTime + ', ' + firstName + ' — all caught up today.';
    var bits = [];
    if (myAck > 0) bits.push(myAck + ' need ack');
    if (myDueToday > 0) bits.push(myDueToday + ' due today');
    if (myOverdue > 0) bits.push(myOverdue + ' overdue');
    if (checksDueToday > 0) bits.push(checksDueToday + ' check' + (checksDueToday === 1 ? '' : 's'));
    return greetTime + ', ' + firstName + ' — ' + bits.slice(0, 3).join(' · ');
  })();

  var jennaLine = (function () {
    if (jennaSummary.tableMissing) return 'HR setup needed (run sql/s41).';
    if (jennaSummary.pendingReq === 0 && jennaSummary.pendingCmp === 0 && jennaSummary.newResponses === 0) return 'File a request, raise a concern, or just say hi.';
    var bits = [];
    if (jennaSummary.newResponses > 0) bits.push('✨ ' + jennaSummary.newResponses + ' response' + (jennaSummary.newResponses === 1 ? '' : 's'));
    if (jennaSummary.pendingReq > 0) bits.push(jennaSummary.pendingReq + ' request' + (jennaSummary.pendingReq === 1 ? '' : 's'));
    if (jennaSummary.pendingCmp > 0) bits.push(jennaSummary.pendingCmp + ' concern' + (jennaSummary.pendingCmp === 1 ? '' : 's'));
    return bits.slice(0, 2).join(' · ');
  })();

  var saraLine = saraSeenToday ? 'See your scoring + growth feedback.' : 'New coach feedback waiting for you.';

  // Tile component
  // v55.73 — Strong "active" visual feedback per Max's spec:
  //   "Soft glow around her photo, subtle pulsing light, active border,
  //   speaking animation, words/text appearing in her response area."
  // The active assistant gets:
  //   - A glowing colored shadow that pulses gently
  //   - A bold ring in their accent color
  //   - "▸ ACTIVE" badge instead of "▸ Open"
  //   - Slightly elevated scale
  // Inactive tiles look quieter so the active one clearly dominates.
  function Tile(props) {
    var who = props.who;
    var isActive = openPanel === who;
    // v55.75 (A1) — speaking state per assistant. The shared module below
    // dispatches 'ktc:assistant-speaking' events with { agent, speaking }
    // and we toggle the pulse class only on the active+speaking tile.
    var isSpeaking = isActive && (speakingState[who] === true);
    // v55.82-B (QA-23) — Active glow class wiring.
    // BEFORE: inline `boxShadow: isActive ? props.activeGlow : undefined`
    // ALWAYS won over the .ktc-assistant-speaking keyframe animation, so
    // the active tile NEVER pulsed (Problem 2). It also caused all three
    // tiles to flicker on every parent re-render because React removed
    // and re-added the inline style every time, and `transition-all`
    // animated the change → visible blink (Problem 3).
    // NOW: no inline boxShadow at all. Two CSS classes drive every state:
    //   .ktc-assistant-active           → idle active, slow soft breath
    //   .ktc-assistant-speaking         → talking, faster deep pulse
    // Both share the same --ktc-glow-color variable (per-persona color)
    // and only animate box-shadow. Transition list is narrowed to props
    // that CAN'T conflict (transform, opacity).
    var activeClass = isActive
      ? (isSpeaking ? 'ktc-assistant-speaking' : 'ktc-assistant-active')
      : '';
    return (
      <button
        onClick={function () { togglePanel(who); }}
        aria-pressed={isActive}
        aria-label={isActive ? props.name + ' is the active assistant' : 'Switch to ' + props.name}
        className={'group relative flex flex-col items-center text-center rounded-3xl p-4 sm:p-6 ' +
          // Narrowed transition — no longer 'transition-all'. Only the props
          // we WANT animated when isActive flips. box-shadow is intentionally
          // NOT in this list because the ktc-assistant-active class drives
          // it via keyframes, and the transition would fight the keyframes.
          'transition-[transform,opacity] duration-300 ' +
          (isActive
            ? 'shadow-2xl scale-[1.04] ring-4 ring-offset-2 ring-offset-white ' + props.ringColor + ' ' + activeClass
            : 'hover:shadow-2xl hover:-translate-y-1 ring-2 ring-transparent shadow-lg opacity-90')}
        style={Object.assign(
          {
            background: props.bg,
          },
          // CSS var consumed by .ktc-assistant-active / .ktc-assistant-speaking
          // keyframes so each persona pulses in its own color. Set ONLY when
          // active so inactive tiles don't carry an unused custom property.
          isActive ? { '--ktc-glow-color': props.glowColorVar } : {}
        )}>
        {/* v55.75 (A1) — Badge no longer animates by default. Only the
            active+speaking assistant's badge gets the gentle pulse. */}
        {props.notifCount > 0 && (
          <span className={'absolute top-3 right-3 px-2.5 min-w-[28px] h-7 rounded-full text-white text-sm font-extrabold flex items-center justify-center ring-2 ring-white z-10 ' + props.badgeColor + (isSpeaking ? ' animate-pulse' : '')}>
            {props.notifCount}
          </span>
        )}
        {/* v55.75 (A1) — Static "Active" indicator dot. Previously had
            animate-pulse which contributed to the synchronized-blinking
            effect. Now: solid colored dot, no animation. The ring + glow
            already communicate "active" clearly. */}
        {isActive && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/95 backdrop-blur shadow-md z-10">
            <span className="w-2 h-2 rounded-full" style={{ background: props.dotColor }} />
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: props.dotColor }}>Active</span>
          </span>
        )}
        {/* v55.71 PREVAILING — avatars sized to dominate the dashboard
            hero (Max May 7 2026: "icons have to be very prevailing").
            maxWidth bumped 200→320, padding bumped, text scaled up. */}
        <div className="relative mx-auto mb-3"
          style={{ width: '100%', maxWidth: 320, aspectRatio: '1 / 1' }}
          onMouseEnter={function () { setWave(who, true); }}
          onMouseLeave={function () { setWave(who, false); }}>
          {props.avatar(waveState[who])}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <h3 className="text-3xl sm:text-4xl font-extrabold text-white">{props.name}</h3>
          <span className="text-xs font-black uppercase tracking-wide px-2.5 py-1 rounded-full bg-white text-slate-900 shadow">{props.role}</span>
        </div>
        <p className="text-sm text-white font-semibold mt-2 px-2 leading-snug min-h-[2.5em]" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {props.line}
        </p>
        <div className={'mt-2 inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full ' +
          (isActive ? 'bg-white text-slate-900 shadow-md' : 'text-white bg-white/25 backdrop-blur')}
          style={isActive ? {} : { textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
          {isActive ? '▸ IN CONTROL' : '▸ Tap to activate'}
        </div>
      </button>
    );
  }

  // v55.71 PREVAILING — floating quick-access trio.
  // Max May 7 2026: "I should be in big icons. I can scroll all the way
  // up and I could see them and I can ask a question if she's not
  // appearing in the dashboard I can open her I can activate her."
  // Solution: a small floating bar in the corner with all three avatars
  // appears after the user scrolls past the hero. Click any one to
  // smooth-scroll back up + auto-expand that assistant's panel.
  var [showFloating, setShowFloating] = useState(false);
  useEffect(function () {
    if (typeof window === 'undefined') return;
    var onScroll = function () {
      // Show the floating bar once scrolled past ~400px (well past the hero tiles)
      setShowFloating(window.scrollY > 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return function () { window.removeEventListener('scroll', onScroll); };
  }, []);

  var jumpAndOpen = function (who) {
    // Scroll dashboard to top so the big tiles are in view, then expand
    try {
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {}
    setOpenPanel(who);
    if (who === 'nadia' && onTalkToNadia) {
      try { onTalkToNadia(); } catch (_) {}
    }
  };

  return (
    <div className="mb-4">
      {/* v55.71 — floating quick-access trio (small avatar circles in
          fixed bottom-right) appears only after scrolling past the hero.
          One tap → scroll back to top + open that assistant. */}
      {showFloating && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <FloatingMini who="nadia" label="Nadia" badge={nadiaUrgentCount} pulse={true} bg="linear-gradient(135deg, #6366f1, #ec4899)" badgeColor="bg-rose-500" onClick={function () { jumpAndOpen('nadia'); }} />
          <FloatingMini who="jenna" label="Jenna" badge={jennaSummary.newResponses + jennaSummary.pendingReq + jennaSummary.pendingCmp} pulse={jennaSummary.newResponses > 0} bg="linear-gradient(135deg, #f59e0b, #d946ef)" badgeColor={jennaSummary.newResponses > 0 ? 'bg-emerald-500' : 'bg-amber-500'} onClick={function () { jumpAndOpen('jenna'); }} />
          <FloatingMini who="sara" label="Sara" badge={saraSeenToday ? 0 : 1} pulse={false} bg="linear-gradient(135deg, #06b6d4, #6366f1)" badgeColor="bg-cyan-300" onClick={function () { jumpAndOpen('sara'); }} />
        </div>
      )}

      {/* THREE BIG TILES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          who="nadia" name="Nadia" role="Executive Asst"
          line={nadiaLine}
          notifCount={nadiaUrgentCount} notifPulse={true}
          bg="linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)"
          ringColor="ring-indigo-400" badgeColor="bg-rose-500"
          activeGlow="0 0 0 4px rgba(99,102,241,0.3), 0 8px 32px rgba(99,102,241,0.5)"
          // v55.82-I — glow alpha bumped 0.5 → 0.85 for visible halo.
          // 0.5 disappeared into the card's own gradient (Max May 11 photo).
          glowColorVar="rgba(99,102,241,0.85)"
          dotColor="#6366f1"
          avatar={NadiaAvatar}
        />
        <Tile
          who="jenna" name="Jenna" role="HR Rep"
          line={jennaLine}
          notifCount={jennaSummary.newResponses + jennaSummary.pendingReq + jennaSummary.pendingCmp}
          notifPulse={jennaSummary.newResponses > 0}
          bg="linear-gradient(135deg, #f59e0b 0%, #f43f5e 50%, #d946ef 100%)"
          ringColor="ring-rose-400"
          badgeColor={jennaSummary.newResponses > 0 ? 'bg-emerald-500' : 'bg-amber-500'}
          activeGlow="0 0 0 4px rgba(244,63,94,0.3), 0 8px 32px rgba(244,63,94,0.5)"
          glowColorVar="rgba(244,63,94,0.85)"
          dotColor="#f43f5e"
          avatar={JennaAvatar}
        />
        <Tile
          who="sara" name="Sara" role="Work Coach"
          line={saraLine}
          notifCount={saraSeenToday ? 0 : 1} notifPulse={false}
          bg="linear-gradient(135deg, #06b6d4 0%, #0ea5e9 50%, #6366f1 100%)"
          ringColor="ring-cyan-400" badgeColor="bg-cyan-300"
          activeGlow="0 0 0 4px rgba(6,182,212,0.3), 0 8px 32px rgba(6,182,212,0.5)"
          glowColorVar="rgba(6,182,212,0.85)"
          dotColor="#06b6d4"
          avatar={SaraAvatar}
        />
      </div>

      {/* ============================================================
          v55.76 (A5) — UNIFIED AI WORKFORCE MODULE
          ============================================================
          Per Max's spec: ONE shared module below the three avatars.
          Everything happens here — chat, forms, coaching, exec briefing.
          The three panels are NO LONGER separate cards. They are
          conditional content INSIDE one continuous shell that:
            - Shifts border + background color to match the active persona
            - Shows the active persona's TOOLS as a header section
            - Always renders the same chat surface as the body
          The user feels: "the same intelligent system is changing
          personality" — not "I opened a different page."
          ============================================================ */}
      <div
        id="ai-workforce-module"
        className={
          'mt-3 rounded-2xl border-2 transition-all duration-500 ' +
          (openPanel === 'nadia' ? 'border-indigo-200 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50' :
           openPanel === 'jenna' ? 'border-rose-200 bg-gradient-to-br from-amber-50 via-rose-50 to-fuchsia-50' :
           openPanel === 'sara'  ? 'border-cyan-200 bg-gradient-to-br from-cyan-50 via-sky-50 to-indigo-50' :
                                   'border-slate-200 bg-white')
        }>
        {/* PERSONA HEADER — greeting block per active persona. The header
            block is cosmetic, so conditional render is fine. The TOOLS
            below (MyHRDesk, MyPerformance) however are ALWAYS MOUNTED to
            preserve state across switches. v55.77 Fix #4 — Per Max's spec:
            "Shared module never breaks state." Form drafts in MyHRDesk
            and loaded performance data in MyPerformance must survive a
            persona switch. We hide inactive ones via display:none, which
            keeps React state intact (no unmount). */}
        <div className="p-4">
          {/* Persona greeting block — cosmetic, swap freely */}
          {openPanel === 'nadia' && (
            <>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <img
                    src={AGENT_PERSONALITIES.nadia.photo}
                    alt={AGENT_PERSONALITIES.nadia.name}
                    className="w-12 h-12 rounded-full ring-2 ring-white shadow flex-shrink-0"
                    style={{ objectFit: 'cover' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-base font-extrabold text-indigo-900">Hi, I'm {AGENT_PERSONALITIES.nadia.name}</h4>
                      <span className="text-[10px] font-bold bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded uppercase">{AGENT_PERSONALITIES.nadia.role}</span>
                      <span className="text-[10px] font-bold bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded uppercase">Auto-opens daily</span>
                    </div>
                    <p className="text-xs text-indigo-800 mt-1 leading-snug">{AGENT_PERSONALITIES.nadia.greeting}</p>
                    <p className="text-[11px] font-semibold text-indigo-900 mt-2">{nadiaLine}</p>
                  </div>
                </div>
              </div>
              {/* v55.81 #5 (Max May 9 2026): When ALL four stats are zero,
                  showing four "0" cards under "all caught up today" feels
                  empty and redundant. Replace with one friendly all-clear
                  panel that doubles as an explainer of what these cards
                  show when there IS something to act on. */}
              {nadiaUrgentCount > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard label="Need Ack" value={myAck} color="amber" />
                  <StatCard label="Due Today" value={myDueToday} color="blue" />
                  <StatCard label="Overdue" value={myOverdue} color="rose" />
                  <StatCard label="Checks Due" value={checksDueToday} color="violet" />
                </div>
              ) : (
                <div className="rounded-lg p-3 border border-emerald-200 bg-emerald-50/70 text-center">
                  <div className="text-xs font-bold text-emerald-800 mb-0.5">✅ Nothing needs action right now</div>
                  <div className="text-[10px] text-emerald-700 leading-snug">When you have tickets to acknowledge, items due today, overdue work, or checks due, they'll show up here as quick-action tiles.</div>
                </div>
              )}
            </>
          )}

          {openPanel === 'jenna' && (
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <img
                  src={AGENT_PERSONALITIES.jenna.photo}
                  alt={AGENT_PERSONALITIES.jenna.name}
                  className="w-12 h-12 rounded-full ring-2 ring-white shadow flex-shrink-0"
                  style={{ objectFit: 'cover' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-extrabold text-rose-900">Hi, I'm {AGENT_PERSONALITIES.jenna.name}</h4>
                    <span className="text-[10px] font-bold bg-rose-200 text-rose-800 px-1.5 py-0.5 rounded uppercase">{AGENT_PERSONALITIES.jenna.role}</span>
                  </div>
                  <p className="text-xs text-rose-800 mt-1 leading-snug">{AGENT_PERSONALITIES.jenna.greeting}</p>
                </div>
              </div>
            </div>
          )}

          {openPanel === 'sara' && (
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <img
                  src={AGENT_PERSONALITIES.sara.photo}
                  alt={AGENT_PERSONALITIES.sara.name}
                  className="w-12 h-12 rounded-full ring-2 ring-white shadow flex-shrink-0"
                  style={{ objectFit: 'cover' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-extrabold text-cyan-900">Hey, I'm {AGENT_PERSONALITIES.sara.name}</h4>
                    <span className="text-[10px] font-bold bg-cyan-200 text-cyan-800 px-1.5 py-0.5 rounded uppercase">{AGENT_PERSONALITIES.sara.role}</span>
                  </div>
                  <p className="text-xs text-cyan-800 mt-1 leading-snug">{AGENT_PERSONALITIES.sara.greeting}</p>
                </div>
              </div>
            </div>
          )}

          {/* TOOLS — ALWAYS MOUNTED. Hidden via display:none when inactive
              so React preserves component state (form drafts, fetched data,
              modal positions, etc.). Switching personas no longer wipes
              typed-but-unsubmitted concerns or makes Sara re-fetch metrics. */}
          <div style={{ display: openPanel === 'jenna' ? 'block' : 'none' }}
               aria-hidden={openPanel !== 'jenna'}>
            <SafeSection label="My HR Desk">
              <MyHRDesk user={user} userProfile={userProfile} users={users} active={openPanel === 'jenna'} />
            </SafeSection>
          </div>
          <div style={{ display: openPanel === 'sara' ? 'block' : 'none' }}
               aria-hidden={openPanel !== 'sara'}>
            <SafeSection label="My Performance">
              <MyPerformance user={user} userProfile={userProfile} active={openPanel === 'sara'} />
            </SafeSection>
          </div>
        </div>

        {/* SHARED CHAT SURFACE — same AIGreeter instance regardless of
            which persona is active. AIGreeter receives selectedAssistant
            prop from page.jsx and swaps its OWN header to match. The
            voice/listening/recording engine inside AIGreeter is unchanged.
            This is the conversation body of the unified module. */}
        {chatSurface ? (
          <div className="px-4 pb-4 pt-1" id="ktc-assistant-chat-surface">
            <div className={
              'rounded-xl border transition-colors duration-500 ' +
              (openPanel === 'nadia' ? 'border-indigo-100' :
               openPanel === 'jenna' ? 'border-rose-100' :
               openPanel === 'sara'  ? 'border-cyan-100' :
                                       'border-slate-100')
            }>
              {chatSurface}
            </div>
          </div>
        ) : (
          // v55.77 — When the chat surface is null (voice assistant disabled
          // in Settings), show a friendly placeholder inside the unified
          // module instead of just leaving it headless. The module always
          // has a body of some kind — keeps the visual promise of "one
          // shared interaction area" intact even when chat is off.
          <div className="px-4 pb-4 pt-1" id="ktc-assistant-chat-surface">
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white/60 p-4 text-center">
              <div className="text-xs text-slate-600 font-semibold mb-1">Voice assistant is turned off</div>
              <div className="text-[11px] text-slate-500">Turn it back on in Settings → AI Settings to chat with Nadia, Ms. Jenna, or Sara.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// FloatingMini — small circular avatar pill for the floating quick-access bar.
// Shows the assistant's gradient + first letter, a notification badge if any,
// and a tooltip-style label that slides in on hover.
function FloatingMini(props) {
  return (
    <button
      onClick={props.onClick}
      title={'Jump to ' + props.label}
      aria-label={'Jump to ' + props.label}
      className="group relative flex items-center gap-2"
      style={{ outline: 'none' }}>
      {/* Slide-in label on hover */}
      <span className="opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-200 bg-slate-900 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg whitespace-nowrap">
        Jump to {props.label}
      </span>
      <div
        className="relative w-14 h-14 rounded-full shadow-xl ring-4 ring-white flex items-center justify-center text-white text-lg font-extrabold transition-transform hover:scale-110"
        style={{ background: props.bg, textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
        {props.label.charAt(0)}
        {props.badge > 0 && (
          <span className={'absolute -top-1 -right-1 px-1.5 min-w-[20px] h-5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white ' + props.badgeColor + (props.pulse ? ' animate-pulse' : '')}>
            {props.badge}
          </span>
        )}
      </div>
    </button>
  );
}

function StatCard(props) {
  // v55.83-A.6.27.11 (Max May 15 2026) — Max's screenshot showed the labels
  // rendering near-invisible (looked white/washed-out) despite the -950 color.
  // Root cause: small uppercase text in a colored hue blends with the matching
  // pastel background at this font size. Fix: force label to slate-900 (almost
  // black) which gives high contrast on EVERY pastel tile bg. Only the big
  // numeric VALUE keeps the colored hue — that's what carries the
  // color-coding (amber=ack, sky=due, rose=overdue, violet=checks).
  // RULE per Max: "DO NOT USE WHITE FOR TEXT FONT".
  var valueColor = {
    amber: 'text-amber-900',
    blue: 'text-sky-900',
    rose: 'text-rose-900',
    violet: 'text-violet-900',
  };
  var bgClass = {
    amber: 'bg-amber-100 border-amber-400',
    blue: 'bg-sky-100 border-sky-400',
    rose: 'bg-rose-100 border-rose-400',
    violet: 'bg-violet-100 border-violet-400',
  };
  var bg = bgClass[props.color] || bgClass.blue;
  var vc = valueColor[props.color] || valueColor.blue;
  var hot = Number(props.value) > 0;
  return (
    <div className={'rounded-lg p-3 border-2 transition ' + bg + (hot ? ' shadow-md' : ' opacity-90')}>
      <div className="text-sm font-black uppercase tracking-wide text-slate-900">{props.label}</div>
      <div className={'text-4xl font-black mt-1 leading-none ' + vc}>{props.value}</div>
    </div>
  );
}


// ============================================================
// THREE PHOTO-BASED AVATARS — v55.72
// Real photographs of the three agents, supplied by Max May 7 2026.
// Each renders as a circular image with a soft ring matching the
// tile's gradient. Hover/wave triggers a subtle tilt + scale animation
// (was an arm/tablet wave in the SVG version; now it's a friendly
// micro-interaction on the photo itself).
//
// Photos live in /public/avatars/{nadia,jenna,sara}.png — 512x512
// each, ~120KB. They render crisply at the tile's display size
// (~280px on tablet, full-width on mobile).
// ============================================================

// NADIA — Executive Assistant
function NadiaAvatar(waving) {
  return <PhotoAvatar src="/avatars/nadia.png" alt="Nadia, Executive Assistant" waving={waving} />;
}

// JENNA — HR Representative
function JennaAvatar(waving) {
  return <PhotoAvatar src="/avatars/jenna.png" alt="Jenna, HR Representative" waving={waving} />;
}

// SARA — Work Coach
function SaraAvatar(waving) {
  return <PhotoAvatar src="/avatars/sara.png" alt="Sara, Work Coach" waving={waving} />;
}

// Shared photo-tile renderer. Renders the photo as a circle with a
// soft inner glow + drop shadow. Tilts ~3deg + scales to 1.04 when
// `waving` is true (hover OR periodic wave timer).
function PhotoAvatar(props) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <img
        src={props.src}
        alt={props.alt}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: '50%',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25), inset 0 0 0 4px rgba(255,255,255,0.4)',
          transform: props.waving ? 'scale(1.04) rotate(-3deg)' : 'scale(1) rotate(0deg)',
          transition: 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          // Prevents iOS Safari from showing the right-click long-press menu
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          // Prevents image dragging on desktop
          pointerEvents: 'none',
        }}
        draggable={false}
        loading="lazy"
      />
    </div>
  );
}
