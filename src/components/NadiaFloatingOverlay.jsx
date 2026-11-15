// ============================================================
// NadiaFloatingOverlay.jsx — S16 (Apr 22 2026)
//
// Makes Nadia available on EVERY screen, not just the dashboard.
//
// Three states:
//   1. EXPANDED  — full AIGreeter chat visible (bottom-right floating panel)
//   2. COLLAPSED — small pill with Nadia's face, click to expand
//   3. MUTED     — pill shows crossed-out voice icon, chat won't speak out loud
//                  even when the user types to her. User toggles with stop button.
//
// The MUTED state persists in localStorage so Nadia stays quiet across page
// navigations until the user explicitly unmutes.
//
// "Stop talking" button inside the chat pauses any current speech immediately
// AND sets muted=true so she won't auto-speak the next response. "Start talking
// again" button restores.
// ============================================================
'use client';
import React, { useState, useEffect, useRef } from 'react';
import AIGreeter from './AIGreeter';

var MUTED_STORAGE_KEY = 'nadia.muted';
var EXPANDED_STORAGE_KEY = 'nadia.expanded';

export default function NadiaFloatingOverlay(props) {
  // Expanded/collapsed state — restored from localStorage so it persists across pages.
  var [expanded, setExpanded] = useState(function() {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true'; } catch (e) { return false; }
  });

  // S17 — Muted state: if parent passes externalMuted + onMutedChange, use
  // those (lets the dashboard AIGreeter and the overlay share one source of
  // truth for mute via page-level nadiaMuted state). Otherwise fall back to
  // the overlay's own localStorage-backed state.
  var [internalMuted, setInternalMuted] = useState(function() {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(MUTED_STORAGE_KEY) === 'true'; } catch (e) { return false; }
  });
  var usingExternalMuted = typeof props.externalMuted === 'boolean' && typeof props.onMutedChange === 'function';
  var muted = usingExternalMuted ? props.externalMuted : internalMuted;
  var setMuted = function(next) {
    var resolved = typeof next === 'function' ? next(muted) : next;
    if (usingExternalMuted) {
      props.onMutedChange(resolved);
    } else {
      setInternalMuted(resolved);
    }
  };

  useEffect(function() {
    try { localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? 'true' : 'false'); } catch (e) {}
  }, [expanded]);

  // Only persist muted to localStorage if we own it — when parent owns it
  // via externalMuted, the parent does the persistence.
  useEffect(function() {
    if (usingExternalMuted) return;
    try { localStorage.setItem(MUTED_STORAGE_KEY, internalMuted ? 'true' : 'false'); } catch (e) {}
  }, [internalMuted, usingExternalMuted]);

  // When user mutes, immediately stop any current speech AND keep stopping
  // any NEW audio that starts playing while muted. Since we're using the
  // original unmodified AIGreeter now (which doesn't know about muted), the
  // overlay has to be the gatekeeper. A MutationObserver + periodic poller
  // catch any <audio> element that AIGreeter creates and keep it silenced
  // until the user unmutes.
  useEffect(function() {
    if (typeof window === 'undefined') return;
    if (!muted) return;
    // Immediately silence anything currently playing.
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    try {
      document.querySelectorAll('audio').forEach(function(a) {
        try { a.pause(); a.currentTime = 0; a.muted = true; } catch (er) {}
      });
    } catch (e) {}
    // Poll every 200ms — catches any new audio element AIGreeter spawns.
    // Stops when the user unmutes (this effect cleans up and re-runs).
    var iv = setInterval(function() {
      try { if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel(); } catch (e) {}
      try {
        document.querySelectorAll('audio').forEach(function(a) {
          if (!a.paused || !a.muted) {
            try { a.pause(); a.muted = true; } catch (er) {}
          }
        });
      } catch (e) {}
    }, 200);
    return function() {
      clearInterval(iv);
      // On unmute, unmute all audio elements so NEXT playback works.
      try {
        document.querySelectorAll('audio').forEach(function(a) {
          try { a.muted = false; } catch (er) {}
        });
      } catch (e) {}
    };
  }, [muted]);

  // Listen for cross-screen "stop Nadia" events — e.g. user clicks stop on
  // a dedicated button somewhere else on the page. Any component can fire
  // window.dispatchEvent(new CustomEvent('nadia-mute')) or nadia-unmute.
  useEffect(function() {
    if (typeof window === 'undefined') return;
    var handleMute = function() { setMuted(true); };
    var handleUnmute = function() { setMuted(false); };
    var handleToggle = function() { setMuted(function(m) { return !m; }); };
    var handleExpand = function() { setExpanded(true); setUserCollapsedAt(0); };
    var handleCollapse = function() { setExpanded(false); };
    window.addEventListener('nadia-mute', handleMute);
    window.addEventListener('nadia-unmute', handleUnmute);
    window.addEventListener('nadia-toggle-mute', handleToggle);
    window.addEventListener('nadia-expand', handleExpand);
    window.addEventListener('nadia-collapse', handleCollapse);
    return function() {
      window.removeEventListener('nadia-mute', handleMute);
      window.removeEventListener('nadia-unmute', handleUnmute);
      window.removeEventListener('nadia-toggle-mute', handleToggle);
      window.removeEventListener('nadia-expand', handleExpand);
      window.removeEventListener('nadia-collapse', handleCollapse);
    };
  }, []);

  // v55.83-A.4 (Max May 13 2026) — REACT HOOKS COMPLIANCE.
  // ALL hooks must run before ANY conditional return — including `if (!props.enabled)`
  // and `if (props.suppressed)`. Otherwise the hook count changes between renders,
  // triggering React error #310 ("Rendered more hooks than during the previous render").

  // S17.6 — Track when user last opened the overlay. Any assistant message
  // added after this timestamp is "unread". Used to show a pulsing badge on
  // the collapsed pill so user knows Nadia said something while closed.
  var [lastOpenedAt, setLastOpenedAt] = useState(function() { return Date.now(); });
  useEffect(function() {
    if (expanded) setLastOpenedAt(Date.now());
  }, [expanded]);

  // v55.83-A.6.27.11 (Max May 15 2026) — track user-initiated collapse so
  // auto-expand on new assistant messages doesn't override a fresh dismissal.
  // Per Max: "once i x her out she should not return unless i click back on
  // her to wake her". When user collapses, store timestamp. Auto-expand
  // only fires if the new message arrived AFTER this timestamp AND user
  // has since explicitly opened (which clears the timestamp).
  var [userCollapsedAt, setUserCollapsedAt] = useState(0);
  useEffect(function() {
    // When expanded transitions FROM true TO false via user action, mark.
    // Set in the same effect that already tracks expanded changes so we
    // don't add hook count.
  }, []);

  // S17.7 — AUTO-EXPAND on new assistant message. Tracks count of assistant
  // messages and opens the overlay when it increases. Hooks run on every
  // render regardless of enabled/suppressed state.
  // v55.83-A.6.27.11 — Gated by userCollapsedAt: if user collapsed and
  // hasn't reopened yet, don't auto-expand on new messages.
  var assistantCountRef = useRef(0);
  var sessionMsgsForCount = props.sessionMessages || [];
  useEffect(function() {
    if (props.suppressed) return; // skip side-effect; hook itself still ran
    var currentCount = sessionMsgsForCount.filter(function(m) { return m && m.role === 'assistant'; }).length;
    if (currentCount > assistantCountRef.current) {
      // Only auto-expand if user hasn't recently dismissed. userCollapsedAt
      // is cleared when user manually expands (see setExpanded usage below).
      if (!expanded && !userCollapsedAt) setExpanded(true);
    }
    assistantCountRef.current = currentCount;
  }, [sessionMsgsForCount.length, props.suppressed]);

  if (!props.enabled) return null;

  if (props.suppressed) {
    // One-shot effect: cancel any active speech and force collapse so the
    // next time suppression lifts, the user sees a calm collapsed pill.
    return <NadiaSuppressedKiller setExpanded={setExpanded} />;
  }

  // Count assistant messages newer than lastOpenedAt. These are "unread".
  var sessionMsgs = props.sessionMessages || [];
  var unreadCount = 0;
  if (!expanded) {
    for (var i = sessionMsgs.length - 1; i >= 0; i--) {
      var m = sessionMsgs[i];
      if (m && m.role === 'assistant') {
        unreadCount++;
      } else if (m && m.role === 'user') {
        break;
      }
    }
  }

  // COLLAPSED state — AIGreeter is still mounted (hidden offscreen) so its
  // tab-greeting effects still fire and Nadia still speaks proactively.
  if (!expanded) {
    return (
      <>
        {/* Hidden AIGreeter — rendered but visually invisible. Still runs
            its effects, still plays TTS audio. This is what makes Nadia
            "start talking" on a new tab even before user clicks the pill. */}
        <div style={{ position: 'fixed', left: -99999, top: -99999, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
          <AIGreeter {...props} muted={muted} />
        </div>
        <div
          style={{
            position: 'fixed',
            // v55.82-F (Max May 11 2026): MOVED FROM LEFT → RIGHT.
            // Max's explicit ask: "Nadia must stay all the way to the
            // right side of the screen and never cover the main Treasury
            // transaction form." The pill and the expanded panel both
            // anchor to the right now, leaving the entire left/center
            // of the viewport free for forms. Phone button still owns
            // the immediate bottom-right corner; we sit ABOVE it at
            // bottom: 76. (Previous v55.58 logic moved this to LEFT for
            // a different reason — that constraint no longer applies.)
            bottom: 76,
            right: 16,
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 999,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white',
            cursor: 'pointer',
            boxShadow: '0 10px 30px rgba(99, 102, 241, 0.4)',
            fontSize: 13,
            fontWeight: 700,
            border: '1px solid rgba(255,255,255,0.15)',
          }}
          onClick={function() { setExpanded(true); setUserCollapsedAt(0); }}
          title="Open Nadia"
        >
          <span style={{ fontSize: 18 }}>🤖</span>
          <span>Nadia</span>
          {muted && (
            <span title="Muted — click to open then click the speaker icon to unmute"
              style={{ fontSize: 12, opacity: 0.85 }}>🔇</span>
          )}
          {unreadCount > 0 && !muted && (
            <span
              style={{
                minWidth: 18, height: 18, padding: '0 6px', borderRadius: 10,
                background: '#f97316', color: 'white',
                fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 10px rgba(249,115,22,0.7)',
              }}
              title={unreadCount + ' new message' + (unreadCount > 1 ? 's' : '') + ' from Nadia'}
            >
              {unreadCount}
            </span>
          )}
        </div>
      </>
    );
  }

  // EXPANDED state — the full AIGreeter inside a floating panel
  return (
    // v55.82-F (Max May 11 2026): EXPANDED PANEL ALSO ANCHORED TO RIGHT.
    // Max's ask: "Nadia must stay all the way to the right side of the
    // screen and never cover the main Treasury transaction form." The
    // collapsed pill moved to right; the panel now matches.
    //
    // Width is also tightened. Was width: 'calc(100vw - 96px)' which on
    // a 360px phone was 264px — basically all the screen. Now max 360px
    // AND capped at 90vw on phones with min(...) so on a small screen
    // it's narrower, on a tablet it stays a comfortable 360. Either way,
    // form fields next to the panel remain visible/touchable.
    //
    // bottom: 76 still keeps us above the phone FAB. right: 16 mirrors
    // the collapsed pill exactly so opening/closing doesn't shift.
    <div style={{
      position: 'fixed',
      bottom: 76,
      right: 16,
      zIndex: 9998,
      width: 'min(360px, 90vw)',
    }}>
      {/* Floating control bar ABOVE the chat (collapse + mute toggle) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'rgba(15, 23, 42, 0.95)',
        borderTopLeftRadius: 12, borderTopRightRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        borderBottom: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>🤖</span>
          <span>Nadia</span>
          {muted && <span style={{ color: '#fb923c', fontWeight: 700 }}>· Muted</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={function() { setMuted(function(m) { return !m; }); }}
            title={muted ? 'Unmute — let Nadia speak' : 'Mute — stop Nadia from speaking'}
            style={{
              padding: '4px 10px', borderRadius: 6,
              background: muted ? 'rgba(249, 115, 22, 0.2)' : 'rgba(255,255,255,0.05)',
              color: muted ? '#fdba74' : '#cbd5e1',
              border: '1px solid ' + (muted ? 'rgba(249, 115, 22, 0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {muted ? <><span>🔇</span><span>Unmute</span></> : <><span>🔊</span><span>Mute</span></>}
          </button>
          <button
            onClick={function() { setExpanded(false); setUserCollapsedAt(Date.now()); }}
            title="Minimize"
            style={{
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(255,255,255,0.05)',
              color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>
      {/* The actual Nadia chat. muted flag is passed through so AIGreeter skips
          speech synthesis / TTS playback when true. */}
      <div style={{
        borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.1)',
        borderTop: 'none',
      }}>
        <AIGreeter {...props} muted={muted} />
      </div>
    </div>
  );
}

// v55.82-F — Helper rendered in place of the overlay when suppressed=true.
// Renders nothing visible. Does TWO things on mount:
//   1. Cancels any active speech / TTS audio so a Modal opening mid-word
//      doesn't leave Nadia talking over the form.
//   2. Calls setExpanded(false) once so when suppression is later lifted,
//      Nadia comes back as a calm collapsed pill, not whatever state she
//      was in (mid-sentence, mid-panel-open, etc.).
// Returning null after the effect means no DOM is rendered — guaranteed
// no overlay in the way. AIGreeter is not mounted at all, so no greet
// effects can fire, no tab-change side-effects, no audio.
function NadiaSuppressedKiller(props) {
  React.useEffect(function() {
    if (typeof window === 'undefined') return;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
    try {
      document.querySelectorAll('audio').forEach(function(a) {
        try { a.pause(); a.currentTime = 0; } catch (er) {}
      });
    } catch (_) {}
    try { props.setExpanded(false); } catch (_) {}
  }, []);
  return null;
}
