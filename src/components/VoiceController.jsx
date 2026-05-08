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

export default function VoiceController({ userId, userProfile, enabled, onCommand, onTurnOff }) {
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
  // v55.13 (Apr 26 2026) — Refs for INSTANT BARGE-IN logic. Tracked at
  // component scope so they persist across recognition restarts. See the
  // big comment in rec.onresult below for the full explanation.
  var bargeInDispatchedRef = useRef(false);
  var bargeInLastTextRef = useRef('');
  // v55.22 (Apr 27 2026) — When Nadia STARTED speaking, in epoch ms.
  // Used to enforce an "echo guard" at the beginning of every utterance:
  // any transcript that arrives in the first BARGE_IN_GUARD_MS after she
  // starts is almost certainly the microphone picking up her OWN voice
  // through the speakers, not the user. Without this guard, she cuts
  // herself off after 2-3 words on every response.
  var aiSpeakingStartedAtRef = useRef(0);
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
  // v54.5 — silence-pause timer. After the user says "Hey Nadia" and
  // starts speaking a command, this timer is restarted on every transcript
  // chunk. If no new chunk arrives for 1500ms, we treat that pause as
  // "user finished" and commit the command immediately. This is the
  // "wait for me to pause then answer" UX the user requested.
  var silenceTimerRef = useRef(null);
  var SILENCE_PAUSE_MS = 1500;
  // v51 — self-suppression window. When Nadia speaks, AIGreeter dispatches
  // `nadia-tts-start` with a `detail.until` epoch ms. Any wake-word results
  // that arrive with Date.now() < this timestamp are silently dropped so
  // her own speech bleeding through the mic can't re-trigger her.
  var selfSuppressUntilRef = useRef(0);
  // v51 — hard-stop window. AIGreeter dispatches `nadia-stop-hard` with a
  // `detail.until` epoch ms when the user clicks the STOP button. During
  // this window we drop ALL transcripts before they reach the wake engine —
  // microphone effectively goes deaf.
  var hardStopUntilRef = useRef(0);

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
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
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

    // v55.13 (Apr 26 2026) — INSTANT BARGE-IN.
    //
    // The original design dropped any transcript heard while Nadia was
    // speaking (self-suppress window) UNLESS it matched "Hey Nadia". That
    // worked but felt slow: user had to say the wake word AND wait for her
    // to finish her sentence before recognition would fire onresult.
    //
    // Modern voice assistants (ChatGPT voice, Claude voice, Alexa, Siri)
    // cut themselves off the instant they detect the user starting to talk.
    // To match that, we listen for ANY interim transcript >= 3 chars while
    // she's speaking and dispatch a barge-in event immediately. AIGreeter
    // catches the event and calls stopSpeech() — kills her audio, the
    // SpeechSynthesis queue, and the playing <audio> element.
    //
    // Echo-protection:
    //   • The 3-char minimum filters out brief audio blips from her own
    //     voice through speakers (those usually transcribe to a single
    //     short word like "I" or "the" before the engine corrects itself).
    //   • Modern Chromium / iOS Safari / Android Chrome all have hardware
    //     echo cancellation on by default. Devices manufactured in the
    //     last 5 years rarely produce sustained mic-echo of her own voice.
    //   • If echo IS triggering false barge-ins on a particular setup,
    //     muting Nadia (the existing mute button) bypasses TTS entirely.

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

      // v55.22 (Apr 27 2026) — INSTANT BARGE-IN: DISABLED.
      //
      // Background: v55.13 added a feature where ANY interim transcript
      // (>=3 chars) detected while Nadia is speaking would dispatch a
      // barge-in event and stop her audio. The intent was to match the
      // ChatGPT/Claude voice UX where you can talk over the assistant.
      //
      // In practice this fires constantly on Nadia's own voice echoing
      // through the speakers and back into the mic. Hardware echo
      // cancellation isn't perfect — laptop speakers, Bluetooth, low
      // ambient noise, all cause speech-recognition to pick up her own
      // words and "transcribe" them. That looks identical to a real user
      // interrupt, so barge-in fires and she cuts herself off after 2-3
      // words. Confirmed by Max: "she stops after a few words, just on
      // wake up and after I ask her a question."
      //
      // A short time-guard (e.g. ignore the first 1.5s) doesn't fix this
      // because longer responses still produce mic echo past the guard.
      //
      // Real fix would require: comparing the live transcript against
      // Nadia's own utterance text and only barging when they differ.
      // That's a bigger change.
      //
      // FOR NOW: barge-in is disabled. Users can still interrupt by:
      //   (1) Saying "Hey Nadia [new question]" — wake-word path below
      //       cleanly stops her and processes the new command.
      //   (2) Clicking the stop button on her panel.
      // Both are explicit user actions with no echo-loop risk.
      //
      // To re-enable instant barge-in once we have transcript-matching,
      // restore the original block — see git history for v55.13.
      //
      // (Refs are still kept around because the wake-word path uses them.)
      if (false /* barge-in disabled */) {
        // Don't double-fire if the same partial transcript repeats. Some
        // engines emit the same interim text multiple times.
        if (transcript !== bargeInLastTextRef.current) {
          bargeInLastTextRef.current = transcript;
          bargeInDispatchedRef.current = true;
          try { console.log('[voice] barge-in fired by transcript: "' + transcript + '"'); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('nadia-bargein', { detail: { transcript: transcript, at: Date.now() } })); } catch (e) {}
          // Also clear self-suppress now so the rest of this transcript path
          // can process the user's command without dropping it.
          selfSuppressUntilRef.current = 0;
        }
      }

      // v51 — Self-suppress. Nadia just spoke; ignore anything the mic
      // picks up for a brief window to prevent audio feedback loops.
      //
      // v54.2 (Apr 24 2026) — Let wake-word matches through even during
      // self-suppress. Real mic echo lasts at most 300-500ms, but the
      // user's follow-up command ("show me my tickets") legitimately
      // arrives 500-2000ms after "I'm here". Dropping those commands
      // was breaking the Hey-Nadia-then-command flow. If her own echo
      // produces a false "hey nadia" match, the handler just wakes her
      // again harmlessly — worst case, she says "I'm here" a second time,
      // which is far better than silently eating a real command.
      if (selfSuppressUntilRef.current && Date.now() < selfSuppressUntilRef.current) {
        var inSuppressCheck = detectWakeWord(transcript);
        if (!inSuppressCheck.matched) {
          // Not a wake word — likely her own voice echo. Drop.
          return;
        }
        // Is a wake word → fall through; the engine + command path will
        // handle it normally. User's "Hey Nadia" re-wakes cleanly.
      }

      // v51.1 (Apr 24 2026) — Hard stop: we still process wake-word matches
      // so "Hey Nadia" wakes her from sleep at any time. Non-wake ambient
      // transcripts (random speech, follow-up chatter, her own voice) are
      // dropped so she doesn't re-greet or collect commands during sleep.
      // When wake IS detected, the command falls through to the regular
      // handler below, which AIGreeter will catch and immediately clear
      // the hard-stop state.
      if (hardStopUntilRef.current && Date.now() < hardStopUntilRef.current) {
        var wakeCheck = detectWakeWord(transcript);
        if (!wakeCheck.matched) return; // drop non-wake chatter
        // Bypass follow-up mode during stop — user hasn't been conversing.
        followUpActiveRef.current = false;
      }

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

      // v51.2 — FOLLOW-UP AUTO-SEND DISABLED (Apr 24 2026)
      // Previously, for 5 seconds after Nadia finished speaking, any 2-word
      // transcript auto-sent as a command. This created:
      //   (1) Echo feedback loops when her voice bled through the mic
      //   (2) Accidental sends when user was typing a follow-up
      //   (3) Random speech picked up as commands
      // The 1-second convenience of skipping "Hey Nadia" wasn't worth the
      // bugs. Commands now require either an explicit wake word or the
      // mic/record buttons.
      //
      // (Code kept commented for fast re-enable if we find a safer design.)
      //
      // if (followUpActiveRef.current && isFinal && !wakeInCurrent.matched) {
      //   var userIsTyping = false;
      //   try { userIsTyping = !!(typeof window !== 'undefined' && window.__nadiaUserTyping === true); } catch (e) {}
      //   if (!userIsTyping) {
      //     var words = transcript.split(/\s+/).filter(function(w) {
      //       return w.length > 1 && !/^(uh|um|mm|er|ah)$/i.test(w);
      //     });
      //     if (words.length >= FOLLOWUP_MIN_WORDS && transcript !== followUpLastFiredRef.current) {
      //       followUpLastFiredRef.current = transcript;
      //       clearFollowUp();
      //       setStatus('command');
      //       try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: transcript, at: Date.now(), followUp: true } })); } catch (e) {}
      //       if (onCommand) { try { onCommand(transcript); } catch (e) {} }
      //       setTimeout(function() { if (mountedRef.current) setStatus('listening'); }, 800);
      //       return;
      //     }
      //   }
      // }

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

      // v54.5 — Silence-pause commit. While collecting, every transcript
      // chunk resets the silence timer. If the user stops talking for
      // 1500ms, treat that pause as "user is done" and commit immediately.
      // This is the human-friendly "wait for me to finish then answer"
      // behavior. Without it, we'd wait for either Web Speech's flaky
      // isFinal or the 8-second window to expire — both feel broken.
      if (engineRef.current.isCollecting()) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(function() {
          if (!mountedRef.current) return;
          if (!engineRef.current || !engineRef.current.isCollecting()) return;
          // v55.78 — Read agent BEFORE commitPending (commit clears it).
          var pendingAgent = engineRef.current.getActiveAgent && engineRef.current.getActiveAgent();
          var pending = engineRef.current.commitPending();
          if (pending) {
            ackFiredRef.current = false;
            setStatus('command');
            try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: pending, agent: pendingAgent || null, at: Date.now() } })); } catch (e) {}
            if (onCommand) { try { onCommand(pending, pendingAgent || null); } catch (e) {} }
            setTimeout(function() { if (mountedRef.current) setStatus(followUpActiveRef.current ? 'followup' : 'listening'); }, 800);
          }
        }, SILENCE_PAUSE_MS);
      }

      if (out.trigger && out.command) {
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        ackFiredRef.current = false; // reset for the next wake
        setStatus('command');
        // v55.78 — out.agent comes from the engine's wake-word match.
        try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: out.command, agent: out.agent || null, at: Date.now() } })); } catch (e) {}
        if (onCommand) { try { onCommand(out.command, out.agent || null); } catch (e) {} }
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

      // v54.5 (Apr 24 2026) — CRITICAL FIX: when the recognizer ends
      // (which happens naturally when the user stops speaking for ~1-2
      // seconds), if the engine is still collecting a wake-word command,
      // force-commit it. Web Speech's `isFinal` is unreliable — it
      // sometimes never fires, especially in Safari/Chromium variants.
      // Without this, the user says "Hey Nadia" → ack → speaks command
      // → goes silent → recognizer ends → command was never committed →
      // command is silently dropped. Symptom: "she stops listening".
      try {
        if (engineRef.current && engineRef.current.isCollecting()) {
          // v55.78 — read agent before commit (commit clears it).
          var pendingAgent = engineRef.current.getActiveAgent && engineRef.current.getActiveAgent();
          var pending = engineRef.current.commitPending();
          if (pending) {
            ackFiredRef.current = false;
            setStatus('command');
            try { window.dispatchEvent(new CustomEvent('hey-bob-command', { detail: { command: pending, agent: pendingAgent || null, at: Date.now() } })); } catch (e) {}
            if (onCommand) { try { onCommand(pending, pendingAgent || null); } catch (e) {} }
          }
        }
      } catch (e) { /* non-fatal */ }

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
    var onStart = function(ev) {
      aiSpeakingRef.current = true;
      // v55.22 — record the moment she started speaking so the barge-in
      // check below can ignore mic-echo that arrives in the first ~2s.
      aiSpeakingStartedAtRef.current = Date.now();
      // v55.13 — reset barge-in flag at the START of every new utterance.
      // Without this, only the FIRST sentence of a session could be cut
      // off by user voice; subsequent ones would silently ignore barge-in.
      bargeInDispatchedRef.current = false;
      bargeInLastTextRef.current = '';
      // v51 — pick up the self-suppress window from the dispatching event.
      // v51.2 — FLOOR ONLY on start: never let an incoming window shorten
      // the current one. Prevents a quick onStart→onStop cycle from cutting
      // the tail window short and letting her own echo through.
      var until = ev && ev.detail && ev.detail.until;
      if (until && until > selfSuppressUntilRef.current) selfSuppressUntilRef.current = until;
    };
    var onStop  = function(ev) {
      aiSpeakingRef.current = false;
      // v51.3 (Apr 24 2026) — REPLACE (not max) on stop. The start handler
      // sets a 30-second upper bound as a safety in case the stop event
      // never fires. When stop DOES fire, we want the suppress to shrink
      // down to now+tail so the user's command is heard immediately after
      // Nadia finishes speaking. Taking max kept the mic deaf for 30s.
      var until = ev && ev.detail && ev.detail.until;
      if (until) selfSuppressUntilRef.current = until;
      // v51.2 — Follow-up mode was causing echo feedback. Keep the window
      // tracking for future use, but DO NOT fire commands from it
      // (auto-send logic is disabled above in onresult).
      followUpActiveRef.current = false;
      followUpLastFiredRef.current = '';
      if (followUpTimerRef.current) { clearTimeout(followUpTimerRef.current); followUpTimerRef.current = null; }
      // v55.42 — CRITICAL: do NOT resurrect listening status if the user
      // explicitly stopped (clicked OFF) or voice is disabled. Without
      // these guards, the OFF button appeared not to work — every
      // nadia-tts-stop event would flip the badge back to "🎙️ Hey Nadia"
      // a beat after the user pressed OFF, even though the recognizer
      // itself had been destroyed.
      if (!mountedRef.current) return;
      if (userStoppedRef.current) return;
      if (!enabled) return;
      setStatus('listening');
    };
    // v51 — hard-stop coordination. AIGreeter flips the state, we silence
    // the mic. Wake on either the timer expiring (AIGreeter dispatches
    // nadia-stop-wake) or the user clicking Start.
    var onHardStop = function(ev) {
      var until = ev && ev.detail && ev.detail.until;
      if (until) hardStopUntilRef.current = until;
      // Cancel any follow-up so the next interaction is a clean slate.
      followUpActiveRef.current = false;
      if (followUpTimerRef.current) { clearTimeout(followUpTimerRef.current); followUpTimerRef.current = null; }
    };
    var onHardWake = function() {
      hardStopUntilRef.current = 0;
    };
    window.addEventListener('nadia-tts-start', onStart);
    window.addEventListener('nadia-tts-stop',  onStop);
    window.addEventListener('nadia-stop-hard', onHardStop);
    window.addEventListener('nadia-stop-wake', onHardWake);
    return function() {
      window.removeEventListener('nadia-tts-start', onStart);
      window.removeEventListener('nadia-tts-stop',  onStop);
      window.removeEventListener('nadia-stop-hard', onHardStop);
      window.removeEventListener('nadia-stop-wake', onHardWake);
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

  // v55.59 — When voice is disabled at the system level (the default since
  // v55.42 — voice has been off the surface pending a rebuild), don't render
  // the pill at all. Previously we rendered "🎙️ Voice off" which looked
  // tappable but had no click handler — Max reported "there is something
  // for Nadia of off on for Nadia on the bottom left of the screen which
  // when clicked does absolutely nothing." Hiding the pill removes the
  // dead element entirely. If voice is ever re-enabled (page.jsx
  // voiceEnabled flipped to true), the pill re-appears with working
  // controls. Same logic for unsupported / permission-denied browsers —
  // showing a pill the user cannot act on is just clutter.
  if (!caps.supported || !enabled || status === 'denied') {
    return null;
  }

  if (status === 'command') {
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
      // v55.58 — Was bottom: 16, left: 16 — sat directly on top of the
      // phone button (also at left: 16, bottom: 16). Now: bottom: 72px
      // so it stacks ABOVE the 48px phone button + 8px gap. left: 16
      // unchanged. Reported by Max May 6 2026: "calling icon overlaps
      // with this other icon for Nadia."
      position: 'fixed', bottom: 72, left: 16, zIndex: 60,
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
          onClick={function() {
            // v55.42 — clicking OFF must actually turn voice OFF, not just
            // pause for one frame. Previously stop() set status='idle'
            // but the parent's `voiceEnabled` was still true, so any
            // event that fired setStatus('listening') (e.g. nadia-tts-stop)
            // immediately resurrected the indicator and the UI looked
            // like the OFF button "did nothing".
            //
            // Now we:
            //   1. Stop the recognizer locally (immediate — no waiting on
            //      a parent state round-trip)
            //   2. Ask the parent to flip voiceEnabled → false (the
            //      [enabled] effect then sees the change and stops calling
            //      start(), and the resurrection-via-onStop bug also
            //      stops since status now reads 'disabled' branch above)
            //   3. Persist the off-state so refresh keeps it off
            stop();
            if (typeof onTurnOff === 'function') {
              try { onTurnOff(); } catch (e) {}
            }
          }}
          style={{
            marginLeft: 4, padding: '2px 6px', fontSize: 9, fontWeight: 700,
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10,
            color: 'white', cursor: 'pointer',
          }}
          title="Turn off voice for this session — toggle back on in Settings"
        >OFF</button>
      )}
      <style>{'@keyframes nadia-pulse{0%,100%{opacity:1}50%{opacity:.4}}'}</style>
    </div>
  );
}
