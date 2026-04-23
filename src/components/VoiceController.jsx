'use client';
// ============================================================
// src/components/VoiceController.jsx
//
// The global voice system. Mounts ONCE at the root of the app. Handles:
//   - continuous listening for "Hey Nadia" wake phrase
//   - command extraction + dispatch to the AI
//   - S18.2 (Apr 23 2026): CONVERSATION MODE — per Max's request:
//       1. Say "Hey Nadia" → short ack ("Yes?") so user knows she heard
//       2. User speaks; 2s of silence = end of utterance
//       3. Nadia answers
//       4. After she finishes, 5s "follow-up window" where the user can
//          keep talking WITHOUT saying "Hey Nadia" again
//       5. 5s of silence → back to sleep, needs "Hey Nadia" to wake
//       6. Saying "Hey Nadia" at ANY time starts a new topic
//   - cross-browser quirks (Safari auto-restart, Chrome continuous, Firefox fallback)
//   - per-user on/off toggle (reads users.voice_enabled)
//   - visible indicator that's always onscreen (fixed position, dismissible)
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { createWakeEngine, detectWakeWord, isBargeInCandidate } from '../lib/voice/wake-word';

// S18.2 — follow-up window duration. After Nadia stops speaking, keep the
// mic "open" (no wake word required) for this long. Long enough to let the
// user start a follow-up thought, short enough to avoid picking up
// unrelated room chatter.
var FOLLOWUP_WINDOW_MS = 5000;

// S18.2 — minimum meaningful words to count as a follow-up command. A
// single "yeah" shouldn't fire; "tell me more" should.
var FOLLOWUP_MIN_WORDS = 2;

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
    needsRestart: isSafari,
  };
  return _caps;
}

export default function VoiceController({ userId, userProfile, enabled, onCommand }) {
  var [status, setStatus] = useState('idle');
    // 'idle' | 'listening' | 'hearing' | 'command' | 'followup' | 'disabled' | 'unsupported' | 'denied'
  var [lastTranscript, setLastTranscript] = useState('');
  var [visible, setVisible] = useState(true);
  var recognitionRef = useRef(null);
  var engineRef = useRef(null);
  var restartTimerRef = useRef(null);
  var mountedRef = useRef(true);
  var userStoppedRef = useRef(false);
  var aiSpeakingRef = useRef(false);
  // S18.2 — follow-up window state. True when Nadia just finished speaking
  // and we're giving the user 5s to continue without saying "Hey Nadia".
  var followUpActiveRef = useRef(false);
  var followUpTimerRef = useRef(null);
  // Seen-transcripts for follow-up so the same interim text doesn't fire twice
  var followUpLastFiredRef = useRef('');
  // S18.2 — ack-fired ref tracks whether we already played the "Yes?" for
  // the current wake. Reset when a command finally commits. MUST be declared
  // before `start` (the callback closes over it).
  var ackFiredRef = useRef(false);

  if (!engineRef.current) engineRef.current = createWakeEngine();

  var clearFollowUp = useCallback(function() {
    if (followUpTimerRef.current) { clearTimeout(followUpTimerRef.current); followUpTimerRef.current = null; }
    followUpActiveRef.current = false;
    followUpLastFiredRef.current = '';
  }, []);

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
    clearFollowUp();
    setStatus('idle');
  }, [clearFollowUp]);

  // ---------- Start recognition ----------
  var start = useCallback(function() {
    var caps = getCaps();
    if (!caps.supported) { setStatus('unsupported'); return; }
    if (!enabled)         { setStatus('disabled'); return; }
    userStoppedRef.current = false;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }

    var rec;
    try { rec = new caps.SR(); }
    catch (e) { setStatus('unsupported'); return; }

    rec.continuous = !caps.needsRestart;
    rec.interimResults = true;
    rec.lang = (userProfile && userProfile.ai_language === 'ar') ? 'ar-EG' : 'en-US';
    rec.maxAlternatives = 1;

    rec.onstart = function() {
      if (mountedRef.current) setStatus(followUpActiveRef.current ? 'followup' : 'listening');
    };

    rec.onresult = function(ev) {
      if (!mountedRef.current) return;
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

      // S18.2 — check wake word FIRST even during follow-up.
      // If user says "Hey Nadia" mid-conversation, that's a new topic
      // and should cancel follow-up mode + go through the wake engine.
      var wakeInCurrent = detectWakeWord(transcript);
      if (wakeInCurrent.matched && followUpActiveRef.current) {
        // Explicit wake during follow-up → clear follow-up, let wake engine take over
        clearFollowUp();
        // Fall through to wake-engine processing below
      }

      // S18.2 — follow-up mode: any final result with 2+ words is a command.
      // Skip the wake engine entirely.
      if (followUpActiveRef.current && isFinal && !wakeInCurrent.matched) {
        var words = transcript.split(/\s+/).filter(function(w) {
          return w.length > 1 && !/^(uh|um|mm|er|ah)$/i.test(w);
        });
        if (words.length >= FOLLOWUP_MIN_WORDS && transcript !== followUpLastFiredRef.current) {
          followUpLastFiredRef.current = transcript;
          clearFollowUp();
          setStatus('command');
          try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: transcript, at: Date.now(), followUp: true } })); } catch (e) {}
          if (onCommand) { try { onCommand(transcript); } catch (e) {} }
          setTimeout(function() { if (mountedRef.current) setStatus('listening'); }, 800);
          return;
        }
      }

      // S17.10 — barge-in path is OFF. Aggressive mic pickup of Nadia's
      // own voice used to cut her off mid-sentence.
      // if (aiSpeakingRef.current && !engineRef.current.isCollecting() && isBargeInCandidate(transcript)) {
      //   try { window.dispatchEvent(new CustomEvent('hey-bob-bargein')); } catch (e) {}
      //   aiSpeakingRef.current = false;
      // }

      if (engineRef.current.isCollecting()) setStatus('hearing');

      var out = engineRef.current.process(transcript, isFinal);

      // S18.2 — acknowledgment. When user said just "Hey Nadia" (no command
      // yet), the engine flips into "collecting" mode. Fire a one-shot ack
      // event so AIGreeter can play a short "Yes?" / "I'm here" so the
      // user knows the mic heard them and it's safe to speak.
      if (out.stillListening && engineRef.current.isCollecting() && !ackFiredRef.current) {
        ackFiredRef.current = true;
        try { window.dispatchEvent(new CustomEvent('nadia-wake-ack')); } catch (e) {}
      }

      if (out.trigger && out.command) {
        ackFiredRef.current = false; // reset for the next wake
        setStatus('command');
        try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: out.command, at: Date.now() } })); } catch (e) {}
        if (onCommand) { try { onCommand(out.command); } catch (e) {} }
        setTimeout(function() { if (mountedRef.current) setStatus(followUpActiveRef.current ? 'followup' : 'listening'); }, 800);
      }
    };

    rec.onerror = function(ev) {
      if (!mountedRef.current) return;
      var err = (ev && ev.error) || '';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setStatus('denied');
        userStoppedRef.current = true;
      } else if (err === 'no-speech' || err === 'audio-capture') {
        // benign
      } else if (err === 'aborted') {
        // expected on clean stop
      } else {
        setStatus('listening');
      }
    };

    rec.onend = function() {
      if (!mountedRef.current) return;
      recognitionRef.current = null;
      if (userStoppedRef.current) return;
      if (status === 'denied' || status === 'unsupported' || status === 'disabled') return;
      restartTimerRef.current = setTimeout(function() {
        if (mountedRef.current && !userStoppedRef.current) start();
      }, 250);
    };

    try { rec.start(); recognitionRef.current = rec; }
    catch (e) {
      if (!/already/.test(String(e.message || ''))) setStatus('idle');
    }
  }, [enabled, onCommand, userProfile, clearFollowUp]);

  // ---------- React to enabled changes ----------
  useEffect(function() {
    mountedRef.current = true;
    if (enabled) start(); else stop();
    return function() {
      mountedRef.current = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ---------- Listen for AI-speaking events from AIGreeter ----------
  useEffect(function() {
    var onStart = function() { aiSpeakingRef.current = true; };
    var onStop  = function() {
      aiSpeakingRef.current = false;
      // S18.2 — Nadia just finished speaking. Open the follow-up window.
      // During FOLLOWUP_WINDOW_MS, any 2-word final transcript is accepted
      // as a command without requiring "Hey Nadia".
      followUpActiveRef.current = true;
      followUpLastFiredRef.current = '';
      if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = setTimeout(function() {
        followUpActiveRef.current = false;
        followUpTimerRef.current = null;
        followUpLastFiredRef.current = '';
        if (mountedRef.current) setStatus('listening');
      }, FOLLOWUP_WINDOW_MS);
      if (mountedRef.current) setStatus('followup');
    };
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
      try { window.dispatchEvent(new CustomEvent('hey-bob-manual-start')); } catch (err) {}
      setStatus('hearing');
    };
    var onKu = function(e) {
      if (!held || e.code !== 'Space') return;
      held = false;
      try { window.dispatchEvent(new CustomEvent('hey-bob-manual-end')); } catch (err) {}
      if (enabled) setStatus(followUpActiveRef.current ? 'followup' : 'listening');
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
  } else if (status === 'followup') {
    label = '💬 Listening (follow-up)'; dotColor = '#10b981';
    title = 'Keep talking — no need to say "Hey Nadia" again.';
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
        boxShadow: status === 'listening' || status === 'hearing' || status === 'followup' ? '0 0 8px ' + dotColor : 'none',
        animation: status === 'hearing' || status === 'followup' ? 'nadia-pulse 1s infinite' : 'none',
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
