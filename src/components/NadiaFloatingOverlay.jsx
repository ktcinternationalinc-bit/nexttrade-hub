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
import React, { useState, useEffect } from 'react';
import AIGreeter from './AIGreeter';

var MUTED_STORAGE_KEY = 'nadia.muted';
var EXPANDED_STORAGE_KEY = 'nadia.expanded';

export default function NadiaFloatingOverlay(props) {
  // Expanded/collapsed state — restored from localStorage so it persists across pages.
  var [expanded, setExpanded] = useState(function() {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true'; } catch (e) { return false; }
  });

  // Muted state — persists too.
  var [muted, setMuted] = useState(function() {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(MUTED_STORAGE_KEY) === 'true'; } catch (e) { return false; }
  });

  useEffect(function() {
    try { localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? 'true' : 'false'); } catch (e) {}
  }, [expanded]);

  useEffect(function() {
    try { localStorage.setItem(MUTED_STORAGE_KEY, muted ? 'true' : 'false'); } catch (e) {}
  }, [muted]);

  // When user mutes, immediately stop any current speech.
  useEffect(function() {
    if (muted && typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
      // Also stop any <audio> elements (ElevenLabs TTS uses these)
      try {
        var audios = document.querySelectorAll('audio');
        audios.forEach(function(a) { try { a.pause(); } catch (er) {} });
      } catch (e) {}
    }
  }, [muted]);

  // Listen for cross-screen "stop Nadia" events — e.g. user clicks stop on
  // a dedicated button somewhere else on the page. Any component can fire
  // window.dispatchEvent(new CustomEvent('nadia-mute')) or nadia-unmute.
  useEffect(function() {
    if (typeof window === 'undefined') return;
    var handleMute = function() { setMuted(true); };
    var handleUnmute = function() { setMuted(false); };
    var handleToggle = function() { setMuted(function(m) { return !m; }); };
    var handleExpand = function() { setExpanded(true); };
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

  if (!props.enabled) return null;

  // COLLAPSED state — just a small floating pill
  if (!expanded) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
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
        onClick={function() { setExpanded(true); }}
        title="Open Nadia"
      >
        <span style={{ fontSize: 18 }}>🤖</span>
        <span>Nadia</span>
        {muted && (
          <span title="Muted — click to open then click the speaker icon to unmute"
            style={{ fontSize: 12, opacity: 0.85 }}>🔇</span>
        )}
        {props.hasUnreadBriefing && !muted && (
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#f97316', boxShadow: '0 0 8px #f97316',
              animation: 'pulse 1.5s infinite',
            }}
            title="New alerts"
          />
        )}
      </div>
    );
  }

  // EXPANDED state — the full AIGreeter inside a floating panel
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9998, maxWidth: 400, width: 'calc(100vw - 40px)' }}>
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
            onClick={function() { setExpanded(false); }}
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
