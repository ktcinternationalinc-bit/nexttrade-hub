'use client';
// ============================================================
// src/components/VoiceController.jsx
//
// The global voice system. Mounts ONCE at the root of the app. Handles:
//   - continuous listening for "Hey Bob" wake phrase
//   - command extraction + dispatch to the AI
//   - barge-in (cancel AI audio when user starts talking)
//   - cross-browser quirks (Safari auto-restart, Chrome continuous, Firefox fallback)
//   - per-user on/off toggle (reads users.voice_enabled)
//   - visible indicator that's always onscreen (fixed position, dismissible)
//
// Architecture:
//   - Event-driven: when wake + command captured, we dispatch a
//     CustomEvent('hey-bob-command', { detail: { command } }) on window.
//     Any page can listen. AIGreeter listens and handles the command.
//   - TTS state is global too: when audio plays we set window.__nadiaSpeaking=true
//     so we can barge-in from any component.
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { createWakeEngine, isBargeInCandidate } from '../lib/voice/wake-word';

// Browser capability detection — done ONCE at module load
var _caps = null;
function getCaps() {
  if (_caps) return _caps;
  if (typeof window === 'undefined') return { supported: false };
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var ua = (navigator.userAgent || '').toLowerCase();
  var isSafari = /safari/.test(ua) && !/chrome|chromium|crios|edg/.test(ua);
  var isFirefox = /firefox|fxios/.test(ua);
  _caps = {
    supported: !!SR,
    SR: SR,
    isSafari: isSafari,
    isFirefox: isFirefox,
    // Firefox at time of writing has no SpeechRecognition. We treat
    // voice as unsupported there and show a push-to-talk fallback hint.
    needsRestart: isSafari, // Safari's "continuous" mode isn't actually continuous
  };
  return _caps;
}

export default function VoiceController({ userId, userProfile, enabled, onCommand }) {
  var [status, setStatus] = useState('idle');
    // 'idle' | 'listening' | 'hearing' | 'command' | 'disabled' | 'unsupported' | 'denied'
  var [lastTranscript, setLastTranscript] = useState('');
  var [visible, setVisible] = useState(true);
  var recognitionRef = useRef(null);
  var engineRef = useRef(null);
  var restartTimerRef = useRef(null);
  var mountedRef = useRef(true);
  // Track user-initiated stop so we don't auto-restart after toggle-off
  var userStoppedRef = useRef(false);
  // Track AI speaking so we can barge-in
  var aiSpeakingRef = useRef(false);

  // Initialize engine once
  if (!engineRef.current) engineRef.current = createWakeEngine();

  // ---------- Stop recognition (clean) ----------
  var stop = useCallback(function() {
    userStoppedRef.current = true;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }
    engineRef.current && engineRef.current.reset();
    setStatus('idle');
  }, []);

  // ---------- Start recognition ----------
  var start = useCallback(function() {
    var caps = getCaps();
    if (!caps.supported) { setStatus('unsupported'); return; }
    if (!enabled)         { setStatus('disabled'); return; }
    userStoppedRef.current = false;

    // Clean up any previous instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }

    var rec;
    try { rec = new caps.SR(); }
    catch (e) { setStatus('unsupported'); return; }

    rec.continuous = !caps.needsRestart; // Safari lies about supporting this
    rec.interimResults = true;
    rec.lang = (userProfile && userProfile.ai_language === 'ar') ? 'ar-EG' : 'en-US';
    rec.maxAlternatives = 1;

    rec.onstart = function() {
      if (mountedRef.current) setStatus('listening');
    };

    rec.onresult = function(ev) {
      if (!mountedRef.current) return;
      // Concatenate all results into one transcript + detect final state
      var transcript = '';
      var isFinal = false;
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        transcript += (res[0] && res[0].transcript) || '';
        if (res.isFinal) isFinal = true;
      }
      transcript = transcript.trim();
      if (!transcript) return;

      setLastTranscript(transcript);

      // S17.10 (Apr 23 2026) — BUG FIX: Nadia was cutting off after 2-3 words.
      // Root cause: the VoiceController mic is always hot listening for
      // "Hey Bob". When Nadia speaks, her voice comes out the speakers and
      // into the mic. The mic transcribes it ("Good morning Mohamed"), sees
      // 2+ meaningful words, thinks the user is speaking, and fires a
      // barge-in event. Nadia stops herself.
      //
      // Fix: NEVER fire barge-in while Nadia is speaking. Accept user
      // barge-in ONLY through the explicit wake-word ("Hey Bob") path OR
      // when the user presses the mic button. If the user wants to
      // interrupt, they say "hey bob" — the wake-word detector catches
      // that as a command, which handles the stop correctly downstream.
      //
      // The aiSpeakingRef flag is still flipped by nadia-tts-start/stop,
      // so this doesn't break other places that check it.
      // if (aiSpeakingRef.current && !engineRef.current.isCollecting() && isBargeInCandidate(transcript)) {
      //   try { window.dispatchEvent(new CustomEvent('hey-bob-bargein')); } catch (e) {}
      //   aiSpeakingRef.current = false;
      // }

      // Show "hearing you" state during collection
      if (engineRef.current.isCollecting()) setStatus('hearing');

      var out = engineRef.current.process(transcript, isFinal);
      if (out.trigger && out.command) {
        setStatus('command');
        try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: out.command, at: Date.now() } })); } catch (e) {}
        if (onCommand) { try { onCommand(out.command); } catch (e) {} }
        // Brief visual feedback, then return to listening
        setTimeout(function() { if (mountedRef.current) setStatus('listening'); }, 800);
      }
    };

    rec.onerror = function(ev) {
      if (!mountedRef.current) return;
      var err = (ev && ev.error) || '';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setStatus('denied');
        userStoppedRef.current = true; // Don't auto-retry — would prompt repeatedly
      } else if (err === 'no-speech' || err === 'audio-capture') {
        // Common on Safari silences. Restart path below will pick it up.
      } else if (err === 'aborted') {
        // Expected on clean stop
      } else {
        // Network / language-not-supported / etc — soft fail
        setStatus('listening');
      }
    };

    rec.onend = function() {
      if (!mountedRef.current) return;
      recognitionRef.current = null;
      // Auto-restart on Safari OR if continuous mode dropped unexpectedly.
      // Skipped when user explicitly stopped or denied permission.
      if (userStoppedRef.current) return;
      if (status === 'denied' || status === 'unsupported' || status === 'disabled') return;
      // Small delay prevents tight-loop on some browsers' rate-limiter
      restartTimerRef.current = setTimeout(function() {
        if (mountedRef.current && !userStoppedRef.current) start();
      }, 250);
    };

    try { rec.start(); recognitionRef.current = rec; }
    catch (e) {
      // "already started" sometimes — treat as OK
      if (!/already/.test(String(e.message || ''))) setStatus('idle');
    }
  }, [enabled, onCommand, userProfile]);

  // ---------- React to enabled changes ----------
  useEffect(function() {
    mountedRef.current = true;
    if (enabled) start(); else stop();
    return function() {
      mountedRef.current = false;
      stop();
    };
    // Intentionally only re-runs when enabled flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ---------- Listen for AI-speaking events from AIGreeter ----------
  useEffect(function() {
    var onStart = function() { aiSpeakingRef.current = true; };
    var onStop  = function() { aiSpeakingRef.current = false; };
    window.addEventListener('nadia-tts-start', onStart);
    window.addEventListener('nadia-tts-stop',  onStop);
    return function() {
      window.removeEventListener('nadia-tts-start', onStart);
      window.removeEventListener('nadia-tts-stop',  onStop);
    };
  }, []);

  // ---------- Keyboard shortcut: press & hold Space to manually trigger ----------
  useEffect(function() {
    var held = false;
    var onKd = function(e) {
      if (e.code !== 'Space' || e.repeat) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      if (!enabled) return;
      held = true;
      // Manual trigger: simulate wake detected, open command window
      try { window.dispatchEvent(new CustomEvent('hey-bob-manual-start')); } catch (err) {}
      setStatus('hearing');
    };
    var onKu = function(e) {
      if (!held || e.code !== 'Space') return;
      held = false;
      try { window.dispatchEvent(new CustomEvent('hey-bob-manual-end')); } catch (err) {}
      if (enabled) setStatus('listening');
    };
    window.addEventListener('keydown', onKd);
    window.addEventListener('keyup', onKu);
    return function() {
      window.removeEventListener('keydown', onKd);
      window.removeEventListener('keyup', onKu);
    };
  }, [enabled]);

  if (!visible) return null;

  // ---------- Indicator UI ----------
  var caps = getCaps();
  var label, dotColor, title;
  if (!caps.supported) {
    label = '🎙️ Voice unavailable'; dotColor = '#64748b';
    title = caps.isFirefox ? 'Voice recognition not supported in Firefox. Use Chrome, Safari, or Edge.'
                           : 'Voice recognition not supported in this browser.';
  } else if (!enabled) {
    label = '🎙️ Voice off'; dotColor = '#64748b';
    title = 'Voice disabled. Toggle on in Settings → Voice.';
  } else if (status === 'denied') {
    label = '🎙️ Permission denied'; dotColor = '#ef4444';
    title = 'Microphone access was blocked. Unblock in your browser site settings.';
  } else if (status === 'command') {
    label = '✨ Got it'; dotColor = '#10b981';
    title = 'Command received. Processing...';
  } else if (status === 'hearing') {
    label = '👂 Listening...'; dotColor = '#3b82f6';
    title = lastTranscript || 'Speak your command.';
  } else if (status === 'listening') {
    label = '🎙️ "Hey Nadia"'; dotColor = '#8b5cf6';
    title = 'Say "Hey Nadia" to wake me.';
  } else {
    label = '🎙️ Idle'; dotColor = '#64748b';
    title = '';
  }

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, zIndex: 60,
      background: 'rgba(15,23,42,0.92)', color: 'white', padding: '6px 12px',
      borderRadius: 20, fontSize: 11, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 8, cursor: 'default',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', backdropFilter: 'blur(6px)',
    }} title={title}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: dotColor,
        boxShadow: status === 'listening' || status === 'hearing' ? '0 0 8px ' + dotColor : 'none',
        animation: status === 'hearing' ? 'nadia-pulse 1s infinite' : 'none',
      }} />
      <span>{label}</span>
      {status === 'disabled' || status === 'unsupported' || status === 'denied' ? null : (
        <button
          onClick={stop}
          style={{
            marginLeft: 4, padding: '2px 6px', fontSize: 9, fontWeight: 700,
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10,
            color: 'white', cursor: 'pointer',
          }}
          title="Turn off for this session"
        >OFF</button>
      )}
      <style>{'@keyframes nadia-pulse{0%,100%{opacity:1}50%{opacity:.4}}'}</style>
    </div>
  );
}
