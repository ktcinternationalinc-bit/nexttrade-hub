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

var NADIA_AUTO_OPEN_KEY = 'ktc_nadia_morning_brief_dismissed_at';

export default function AssistantsBar({
  user, userProfile, users,
  tickets, checks,
  onTalkToNadia,
}) {
  var myId = (userProfile && userProfile.id) || (user && user.id);
  var firstName = ((userProfile && userProfile.name) || (user && user.email) || 'there').split(' ')[0].split('@')[0];

  // Expansion state
  // v55.73 — Per Max's spec: ONE ASSISTANT ALWAYS ACTIVE. Nadia is the
  // default. The dismissed-today flag is no longer used to close her —
  // it just informs whether her morning brief shows the auto-open badge.
  // Initial state is always 'nadia' on first render.
  var [openPanel, setOpenPanel] = useState('nadia');

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

  // Per-avatar wave animation
  var [waveState, setWaveState] = useState({ nadia: false, jenna: false, sara: false });
  var setWave = function (who, val) { setWaveState(function (s) { var n = Object.assign({}, s); n[who] = val; return n; }); };
  useEffect(function () {
    var triggers = [];
    var schedule = function (who, offset) {
      triggers.push(setTimeout(function () {
        setWave(who, true);
        setTimeout(function () { setWave(who, false); }, 1800);
      }, offset));
    };
    schedule('nadia', 1000);
    schedule('jenna', 6000);
    schedule('sara', 11000);
    var loop = setInterval(function () {
      schedule('nadia', 0);
      schedule('jenna', 5000);
      schedule('sara', 10000);
    }, 16000);
    return function () { clearInterval(loop); triggers.forEach(function (t) { clearTimeout(t); }); };
  }, []);

  // Summary counts
  var todayStr = new Date().toISOString().substring(0, 10);
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
      if (typeof window === 'undefined') return;
      var lastSeen = window.localStorage.getItem('ktc_sara_last_opened');
      if (!lastSeen) { setSaraSeenToday(false); return; }
      var lastDate = new Date(lastSeen).toISOString().substring(0, 10);
      setSaraSeenToday(lastDate === todayStr);
    } catch (_) {}
  }, [todayStr]);
  useEffect(function () {
    if (openPanel === 'sara') {
      try { if (typeof window !== 'undefined') window.localStorage.setItem('ktc_sara_last_opened', new Date().toISOString()); } catch (_) {}
      setSaraSeenToday(true);
    }
  }, [openPanel]);

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
    return (
      <button
        onClick={function () { togglePanel(who); }}
        aria-pressed={isActive}
        aria-label={isActive ? props.name + ' is the active assistant' : 'Switch to ' + props.name}
        className={'group relative flex flex-col items-center text-center rounded-3xl p-4 sm:p-6 transition-all duration-300 ' +
          (isActive
            ? 'shadow-2xl scale-[1.04] ring-4 ring-offset-2 ring-offset-white ' + props.ringColor + ' ktc-assistant-active-pulse'
            : 'hover:shadow-2xl hover:-translate-y-1 ring-2 ring-transparent shadow-lg opacity-90')}
        style={{
          background: props.bg,
          // v55.73 — gentle glow on active assistant. The keyframes are
          // declared inline below the bar so they're scoped to this component.
          boxShadow: isActive ? props.activeGlow : undefined,
        }}>
        {props.notifCount > 0 && (
          <span className={'absolute top-3 right-3 px-2.5 min-w-[28px] h-7 rounded-full text-white text-sm font-extrabold flex items-center justify-center ring-2 ring-white z-10 ' + props.badgeColor + (props.notifPulse ? ' animate-pulse' : '')}>
            {props.notifCount}
          </span>
        )}
        {/* Active indicator dot — subtle pulsing dot top-left so the user
            sees at a glance which assistant is "in control" without having
            to look for the ring. */}
        {isActive && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/95 backdrop-blur shadow-md z-10">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: props.dotColor }} />
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
          <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-white/30 backdrop-blur text-white">{props.role}</span>
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
          dotColor="#06b6d4"
          avatar={SaraAvatar}
        />
      </div>

      {/* EXPANDED PANEL */}
      {openPanel === 'nadia' && (
        <div className="mt-3 rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-4">
          {/* v55.73 — Nadia personality greeting at top of expanded panel.
              Photo + name + warm intro so the user sees WHO is helping them. */}
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <StatCard label="Need Ack" value={myAck} color="amber" />
            <StatCard label="Due Today" value={myDueToday} color="blue" />
            <StatCard label="Overdue" value={myOverdue} color="rose" />
            <StatCard label="Checks Due" value={checksDueToday} color="violet" />
          </div>
          <div className="bg-white/70 backdrop-blur rounded-lg p-3 border border-indigo-100">
            <p className="text-xs text-slate-700 italic">
              💬 For full chat with Nadia, voice mode, and to ask anything — scroll down to her chat surface or click below.
            </p>
            <button
              onClick={function () { if (onTalkToNadia) onTalkToNadia(); }}
              className="mt-2 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition">
              💬 Open Nadia Chat
            </button>
          </div>
        </div>
      )}

      {openPanel === 'jenna' && (
        <div className="mt-3 rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-amber-50 via-rose-50 to-fuchsia-50 p-4">
          {/* v55.73 — Jenna personality greeting at top of expanded panel. */}
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
          <MyHRDesk user={user} userProfile={userProfile} users={users} />
        </div>
      )}

      {openPanel === 'sara' && (
        <div className="mt-3 rounded-2xl border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 via-sky-50 to-indigo-50 p-4">
          {/* v55.73 — Sara personality greeting at top of expanded panel. */}
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
          <MyPerformance user={user} userProfile={userProfile} />
        </div>
      )}
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
  var colorClasses = {
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    rose: 'bg-rose-100 text-rose-800 border-rose-200',
    violet: 'bg-violet-100 text-violet-800 border-violet-200',
  };
  var c = colorClasses[props.color] || colorClasses.blue;
  return (
    <div className={'rounded-lg p-2 border ' + c}>
      <div className="text-[9px] font-bold uppercase tracking-wide opacity-70">{props.label}</div>
      <div className="text-2xl font-extrabold mt-0.5">{props.value}</div>
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
