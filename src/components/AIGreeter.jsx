'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { todayET, etGreetingWord, cmpETDays } from '../lib/et-time';
import NadiaFace from './NadiaFace';
import PortraitAvatar from './PortraitAvatar';
import MorningBriefing from './MorningBriefing';
// v55.73 — Persona layer. AIGreeter remains the SAME engine (voice,
// listening, recording, response, decisions). When a non-default persona
// is selected, the header swaps to that persona's photo/name/greeting.
// The recording / Whisper / TTS / message-state machinery is untouched.
import { AGENT_PERSONALITIES, getAgent, getElevenLabsVoiceId } from '../lib/agent-personalities';

var PERSONALITIES = [
  { id: 'professional', label: '🎩 Professional', labelAr: 'محترف', desc: 'Formal, concise, business-focused', color: '#1e40af', prompt: 'You are a professional executive assistant named Nadia. Speak formally, be concise and data-driven. Use business language. Be respectful and efficient.' },
  { id: 'friendly', label: '😊 Friendly', labelAr: 'ودود', desc: 'Warm, encouraging, personal', color: '#059669', prompt: 'You are a warm, friendly colleague named Nadia. Be encouraging, use casual language, add personal touches. Be supportive and caring.' },
  { id: 'motivational', label: '💪 Motivational', labelAr: 'محفز', desc: 'Energetic, pushing for results', color: '#dc2626', prompt: 'You are a high-energy motivational coach named Nadia. Be enthusiastic, push for action, celebrate wins!' },
  { id: 'military', label: '🎖️ Military', labelAr: 'عسكري', desc: 'Strict, disciplined, direct', color: '#374151', prompt: 'You are a military commander named Commander Nadia. Be strict, direct, no fluff. Use military-style language.' },
  { id: 'humorous', label: '😄 Humorous', labelAr: 'فكاهي', desc: 'Fun, witty, light-hearted', color: '#d97706', prompt: 'You are a funny, witty assistant named Nadia. Make jokes, use puns, keep things light while delivering info.' },
  { id: 'calm', label: '🧘 Calm', labelAr: 'هادئ', desc: 'Gentle, zen, stress-free', color: '#7c3aed', prompt: 'You are a calm, zen-like advisor named Nadia. Speak gently, reduce stress, frame tasks as manageable steps.' },
];

export { PERSONALITIES };

// ---------- Decision panel ----------
// Renders the recommendation + confidence bar + 1-3 one-click action chips
// beneath any assistant message that came back with a decision payload.
// Click dispatches a custom event the host app can listen to for execution.
function renderDecisionPanel(d, keyId, lang) {
  if (!d || !d.recommendation) return null;
  var conf = Math.round((d.confidence || 0) * 100);
  var risk = Math.round((d.risk_score || 0) * 100);
  var confColor = conf >= 75 ? '#10b981' : conf >= 50 ? '#f59e0b' : '#64748b';
  var riskColor = risk >= 70 ? '#ef4444' : risk >= 40 ? '#f59e0b' : '#10b981';
  var onAction = function(a) {
    try { window.dispatchEvent(new CustomEvent('nadia-decision-action', { detail: { action: a, decision: d } })); } catch (e) {}
  };
  return (
    <div key={'dec-' + keyId} className="mt-2 max-w-[95%] rounded-xl p-3 text-[11px]"
      style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(148,163,184,0.2)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-bold text-cyan-300 uppercase tracking-wide text-[9px]">💡 Recommendation</div>
        <div className="flex gap-3 items-center">
          <span className="text-[9px]" style={{ color: riskColor }}>⚠ Risk {risk}%</span>
          <span className="text-[9px]" style={{ color: confColor }}>◈ Conf {conf}%</span>
        </div>
      </div>
      <div className="text-slate-200 leading-snug mb-2">{d.recommendation}</div>
      {d.reasoning && d.reasoning.length > 0 && (
        <div className="mb-2 pl-2 border-l-2" style={{ borderColor: 'rgba(148,163,184,0.3)' }}>
          {d.reasoning.slice(0, 3).map(function(r, i) {
            return <div key={i} className="text-[10px] text-slate-500 mb-0.5">{r}</div>;
          })}
        </div>
      )}
      {d.suggested_actions && d.suggested_actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.suggested_actions.slice(0, 3).map(function(a, i) {
            return (
              <button key={i} onClick={function() { onAction(a); }}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold hover:opacity-90 transition"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white' }}>
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AIGreeter({ user, userProfile, users, tickets, invoices, treasury, checks, loginHistory, loginHistoryLoaded, lang, personality, greeterLang, onToggle, toast, enabled, hasGreeted, onGreeted, sessionMessages, onMessagesUpdate, contextTab, contextSelectedCustomer, contextSelectedInvoice, contextOpenTicketId, muted, selectedAssistant }) {
  // v55.73 — Persona resolution. SAFE NADIA DEFAULT so the file behaves
  // identically when selectedAssistant is omitted (e.g. older mounts).
  // The voice/listening/recording engine continues to use the existing
  // PERSONALITIES preset selected by `personality` prop — that's a tone
  // overlay (professional/friendly/etc) that stacks on top of the persona.
  var activeAgentKey = (selectedAssistant === 'jenna' || selectedAssistant === 'sara') ? selectedAssistant : 'nadia';
  var activeAgent = getAgent(activeAgentKey);
  // Use parent's session messages — persist across tab switches
  var messages = sessionMessages || [];
  var setMessages = function(msgs) { if (onMessagesUpdate) onMessagesUpdate(msgs); };
  
  var [input, setInput] = useState('');
  var [loading, setLoading] = useState(false);
  var [speaking, setSpeaking] = useState(false);
  var [listening, setListening] = useState(false);
  // v55.75 (A1) — Broadcast speaking state so AssistantsBar tiles can
  // pulse the active assistant ONLY while she's actually speaking. This
  // is purely additive — does not touch the speech engine, just adds an
  // observation layer on top of the existing speaking state.
  //
  // v55.77 — Fix #1 + #12 — Track the last agent we dispatched a
  // "speaking:true" event for. When the persona changes mid-speech we
  // need to first dispatch "speaking:false" for the OLD agent (so its
  // tile stops pulsing) before announcing the new one. Without this,
  // switching during speech would leave the old tile in a stuck pulse.
  var lastSpokenAgentRef = useRef(activeAgentKey);
  useEffect(function () {
    if (typeof window === 'undefined') return;
    try {
      var personaChanged = lastSpokenAgentRef.current !== activeAgentKey;
      if (personaChanged) {
        // Persona just switched. Clear the OLD agent's speaking state.
        // We do NOT fire a "speaking:true" for the new persona here even
        // if `speaking` is still true — the stop-audio effect (below) is
        // about to setSpeaking(false), which will re-trigger this effect
        // and dispatch {newAgent, false} cleanly. This avoids a flash of
        // the wrong tile pulsing during the switch transition.
        window.dispatchEvent(new CustomEvent('ktc:assistant-speaking', {
          detail: { agent: lastSpokenAgentRef.current, speaking: false }
        }));
      } else {
        // Same agent — normal speaking on/off transition.
        window.dispatchEvent(new CustomEvent('ktc:assistant-speaking', {
          detail: { agent: activeAgentKey, speaking: !!speaking }
        }));
      }
      lastSpokenAgentRef.current = activeAgentKey;
    } catch (_) {}
  }, [speaking, activeAgentKey]);

  // v55.77 — Fix #2 + Fix #F — COMPREHENSIVE voice halt on persona change.
  // Per Max May 8 2026: "Audio should stop when changing personas."
  // This effect must halt EVERYTHING related to the previous persona's
  // voice machinery so the new persona starts clean:
  //   1. Pause + clear any TTS audio playback
  //   2. Cancel browser speechSynthesis fallback
  //   3. Stop any active MediaRecorder + flag the captured audio for
  //      discard (so it doesn't get sent to the new persona's API)
  //   4. Exit conversation mode (continuous-listening loop) — otherwise
  //      the mic re-opens after the killed TTS and starts listening
  //      under the new persona's name
  //   5. Tear down conversation-mode silence monitor + audio context
  //   6. Fire 'nadia-tts-stop' event so VoiceController unwinds its
  //      self-suppress window — wake-word listening can resume cleanly
  //   7. Clear pausedRef so user gestures aren't accidentally suppressed
  //   8. Notify the dashboard that any open HR modal should auto-close
  //      (so user doesn't see Jenna's modal on top of Sara's panel)
  // Watches activeAgentKey ONLY (not speaking), so this fires exactly
  // once per switch — not on every speak/listen state change.
  var prevAgentRef = useRef(activeAgentKey);
  useEffect(function () {
    if (prevAgentRef.current === activeAgentKey) return;
    var fromAgent = prevAgentRef.current;
    prevAgentRef.current = activeAgentKey;
    // (1) Stop TTS audio playback
    try { if (audioRef.current) { try { audioRef.current.pause(); } catch (_) {} try { audioRef.current.src = ''; } catch (_) {} audioRef.current = null; } } catch (_) {}
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
    try { setSpeaking(false); } catch (_) {}
    try { setCurrentAudio(null); } catch (_) {}
    // (2) Stop active recording + flag for discard
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state && mediaRecorderRef.current.state !== 'inactive') {
        discardRecordingRef.current = true;
        mediaRecorderRef.current.stop();
      }
    } catch (_) {}
    // (3) Exit conversation mode + tear down silence monitor
    try {
      if (conversationModeRef.current) {
        conversationModeRef.current = false;
        try { setConversationMode(false); } catch (_) {}
      }
    } catch (_) {}
    try { if (typeof endConversationMonitoring === 'function') endConversationMonitoring(); } catch (_) {}
    // (4) Wake VoiceController's self-suppress unwind
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nadia-tts-stop')); } catch (_) {}
    // (5) Clear paused state — new persona starts fresh
    try { if (pausedRef && pausedRef.current) { pausedRef.current = false; setPaused(false); } } catch (_) {}
    // (6) Notify any open HR/Performance modal that persona switched —
    //     they can choose to auto-close while preserving their form draft
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ktc:assistant-changed-cleanup', { detail: { from: fromAgent, to: activeAgentKey } })); } catch (_) {}
    // (7) v55.80 BD-AUDIT FIX (32.2): abort any in-flight /api/ask request
    // so a Nadia request mid-flight doesn't resolve under Jenna's panel.
    try {
      if (currentAskAbortRef.current) {
        currentAskAbortRef.current.abort();
        currentAskAbortRef.current = null;
      }
    } catch (_) {}
    // (8) v55.81 — When the user actively switches personas (Sara ↔ Jenna ↔
    // Nadia), the new persona should immediately introduce herself. Without
    // this, switching feels silent/dead. We use the persona's `greeting`
    // from agent-personalities.js as the intro text. Only fires on a real
    // switch (fromAgent !== activeAgentKey, which we already gated on at
    // the top of this effect). Fires even if muted — the text still appears
    // in chat; doSpeak() short-circuits for muted/paused users.
    try {
      var newAgent = getAgent(activeAgentKey);
      if (newAgent && newAgent.greeting && fromAgent && fromAgent !== activeAgentKey) {
        var introText = newAgent.greeting;
        // Append the intro to the existing message stream so the user can
        // see all three personas' interactions in one transcript.
        var introMsg = { role: 'assistant', text: introText, agent: activeAgentKey };
        setMessages([].concat(messages, [introMsg]));
        // Speak it (doSpeak respects muted/paused).
        // Defer one tick so the React state has rerendered with the new
        // persona's voiceId before TTS fetches audio. Without this defer,
        // /api/tts may fetch using the OLD voiceId and the wrong voice
        // plays for the wrong persona.
        try {
          setTimeout(function () { try { doSpeak(introText); } catch (_) {} }, 80);
        } catch (_) {}
      }
    } catch (_) {}
  }, [activeAgentKey]);
  var [recording, setRecording] = useState(false); // MediaRecorder session (separate from live-mic `listening`)
  var [transcribing, setTranscribing] = useState(false); // uploading audio to /api/transcribe
  // v55.43 — Voice Conversation mode (ChatGPT-like).
  // When ON, the flow is:
  //   tap 🗣️ → mic opens → user talks → silence detected → audio sent to
  //   Whisper → transcript appears in chat → Nadia responds (text + TTS) →
  //   when TTS finishes, mic re-opens automatically → loop.
  // Tapping 🗣️ again or the global "End conversation" button stops the loop.
  // While conversationMode is true, the press-to-record button is disabled
  // (it would conflict with the auto-cycling).
  var [conversationMode, setConversationMode] = useState(false);
  var conversationModeRef = useRef(false);
  useEffect(function() { conversationModeRef.current = conversationMode; }, [conversationMode]);
  var [minimized, setMinimized] = useState(false);
  // S22.13 (Apr 23 2026) — "Paused" is separate from "muted":
  //   muted  = persistent user preference, "I never want to hear her voice"
  //   paused = transient "shut up right now until I ask again"
  // Set to true when the user taps the Stop button. Cleared when the user
  // says "Hey Nadia", types a message, or explicitly engages the mic. While
  // paused:
  //   - doSpeak is a no-op (text still shows in chat; just no voice)
  //   - auto-greetings (login or tab-change) do not fire
  //   - the wake-word ack ("I'm here") is suppressed too
  var [paused, setPaused] = useState(false);
  var pausedRef = useRef(false);  // for handlers registered once at mount
  useEffect(function() { pausedRef.current = paused; }, [paused]);

  // v51 (Apr 24 2026) — STOPPED = hard off for 30 minutes.
  //   Whereas paused is transient ("shut up for now"), stopped puts Nadia
  //   into deep sleep. VoiceController's wake-word listener is fully
  //   disabled for the sleep window so ambient noise, her own speech, or
  //   the user casually saying "Nadia" can't wake her.
  // Wake-up conditions:
  //   (1) 30 minutes elapsed → auto-wake
  //   (2) User clicks Start button → immediate wake
  //   (3) User says "Hey Nadia" (wake-word, once the 30 min is up) — via
  //       VoiceController resuming naturally
  // Persisted in localStorage so a refresh doesn't silently wake her.
  var STOP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  var STOP_KEY = 'nadia:stoppedUntil';
  var [stoppedUntil, setStoppedUntil] = useState(0); // epoch ms; 0 means not stopped
  var stoppedRef = useRef(0);
  useEffect(function() { stoppedRef.current = stoppedUntil; }, [stoppedUntil]);

  // Load persisted stopped state on mount. Honors remaining window only.
  useEffect(function() {
    try {
      var raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STOP_KEY) : null;
      var until = Number(raw || 0);
      if (until && until > Date.now()) {
        setStoppedUntil(until);
        stoppedRef.current = until;
      } else if (raw) {
        // Expired entry — scrub it
        try { localStorage.removeItem(STOP_KEY); } catch (e) {}
      }
    } catch (e) {}
  }, []);

  // Auto-expire the stop window. Wake up when the timer fires — this
  // re-enables VoiceController's wake listener naturally (it re-reads
  // stoppedRef on every result event).
  useEffect(function() {
    if (!stoppedUntil) return;
    var remaining = stoppedUntil - Date.now();
    if (remaining <= 0) {
      setStoppedUntil(0);
      try { localStorage.removeItem(STOP_KEY); } catch (e) {}
      return;
    }
    var t = setTimeout(function() {
      setStoppedUntil(0);
      stoppedRef.current = 0;
      try { localStorage.removeItem(STOP_KEY); } catch (e) {}
    }, remaining);
    return function() { clearTimeout(t); };
  }, [stoppedUntil]);

  // Tick every 15s so the countdown display stays fresh without
  // a dedicated second-by-second interval.
  var [stoppedTick, setStoppedTick] = useState(0);
  useEffect(function() {
    if (!stoppedUntil) return;
    var i = setInterval(function() { setStoppedTick(function(n) { return n + 1; }); }, 15000);
    return function() { clearInterval(i); };
  }, [stoppedUntil]);

  var goStopped = function(customMinutes) {
    var windowMs = STOP_WINDOW_MS;
    if (customMinutes && !isNaN(customMinutes)) {
      var mins = Math.max(1, Math.min(180, Number(customMinutes)));
      windowMs = mins * 60 * 1000;
    }
    var until = Date.now() + windowMs;
    setStoppedUntil(until);
    stoppedRef.current = until;
    try { localStorage.setItem(STOP_KEY, String(until)); } catch (e) {}
    // Stopping also clears paused — they're mutually exclusive states.
    try { setPaused(false); pausedRef.current = false; } catch (e) {}
    // Dispatch a global event so VoiceController can immediately stop listening.
    try { window.dispatchEvent(new CustomEvent('nadia-stop-hard', { detail: { until: until } })); } catch (e) {}
  };

  var wakeFromStopped = function() {
    setStoppedUntil(0);
    stoppedRef.current = 0;
    try { localStorage.removeItem(STOP_KEY); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('nadia-stop-wake')); } catch (e) {}
  };

  // v51 — self-suppression window. While Nadia is speaking (and for 500ms
  // after), ignore any wake-word events. Her own audio coming back
  // through the mic was triggering "hey nadia" matches, making her
  // restart herself and making "mute" feel broken. VoiceController reads
  // this window from the global event stream.
  //
  // v54.2 (Apr 24 2026) — Tail SHRUNK from 3s to 500ms. 3 seconds was
  // eating the user's follow-up command after "I'm here" (command
  // arrives ~500-2000ms after ack). Real mic echo is under 500ms on
  // any reasonable device. Combined with the "let wake-words through"
  // fix in VoiceController, this restores the natural Hey-Nadia-then-
  // command flow without breaking the echo protection.
  var SELF_SUPPRESS_MS = 500;
  var selfSuppressUntilRef = useRef(0);

  // v54.2 — Autoplay-blocked detection. Browsers block audio.play()
  // until the user has interacted with the page. On a fresh morning
  // tab-reload, the login greeting tries to speak, the browser blocks
  // it, and the greeting appears silently in the chat. We detect this,
  // show a "Tap to hear Nadia" banner, and replay the queued audio as
  // soon as the user taps anything.
  var [autoplayBlocked, setAutoplayBlocked] = useState(false);
  var pendingAutoplayRef = useRef(null); // { text, blob, url }
  var [typingText, setTypingText] = useState('');
  var [typingDone, setTypingDone] = useState(true);
  var chatEndRef = useRef(null);
  var typingRef = useRef(null);
  var audioRef = useRef(null);
  var recognitionRef = useRef(null);
  // MediaRecorder — reliable press-to-start / press-to-stop voice capture.
  // Completely independent from the live-mic SpeechRecognition path above.
  var mediaRecorderRef = useRef(null);
  var mediaStreamRef = useRef(null);
  var audioChunksRef = useRef([]);
  var recordStartTsRef = useRef(0);
  var [recordElapsed, setRecordElapsed] = useState(0);
  var recordTickRef = useRef(null);
  // v55.77 — Fix #F — Persona-switch recording discard flag.
  // When the user switches persona mid-recording, we want to STOP the
  // recorder (so the mic light goes off + the mediaStream is released)
  // BUT we do NOT want the captured audio to be sent to the API as if
  // the user submitted it. The MediaRecorder.onstop handler reads this
  // flag at the top — if true, it tears down without sending. This also
  // protects against the case where audio went to the wrong persona's
  // brain (e.g. user was talking to Nadia, swapped to Jenna mid-thought).
  var discardRecordingRef = useRef(false);
  // v55.80 BD-AUDIT FIX (32.2): track in-flight /api/ask request so we can
  // abort it on persona switch. Without this, a Nadia request that's mid-
  // flight when user clicks Jenna will resolve under Jenna's panel — a
  // wrong-persona reply showing in chat.
  var currentAskAbortRef = useRef(null);
  // S10 2026-04-22 — backup transcription path. While the user is recording,
  // we ALSO run the browser's built-in speech recognition in parallel. If
  // Whisper fails (missing API key, network issue, etc.) we still have the
  // user's words and can proceed. This is why the Record button now works
  // even if OPENAI_API_KEY is never added to Vercel.
  var recordBackupRecogRef = useRef(null);
  var recordBackupTextRef = useRef('');
  // S17.9 — Unique ID for THIS AIGreeter instance. Used to tag
  // "nadia-stop-all" events so we can distinguish events WE sent (which
  // we should ignore) from events OTHER instances sent (which we should
  // honor). Without this, Nadia tells herself to stop every time she
  // starts speaking, cutting off her own voice after 2-3 words.
  var instanceIdRef = useRef(null);
  if (!instanceIdRef.current) {
    instanceIdRef.current = 'nadia-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  // S17.10 — When Nadia started speaking. Used to ignore barge-in events
  // that arrive in the first few seconds of her speech, which are almost
  // certainly the microphone picking up her OWN voice from the speakers
  // (speaker echo). Without this guard, Nadia cuts herself off after
  // saying 2-3 words.
  var speakingStartedAtRef = useRef(0);
  var [aiMemory, setAiMemory] = useState('');

  var myId = userProfile?.id || user?.id;
  var fullName = userProfile?.name || 'there';
  var firstName = fullName.split(' ')[0] || fullName;
  var useLang = greeterLang || lang || 'en';
  var persona = PERSONALITIES.find(function(p) { return p.id === personality; }) || PERSONALITIES[1];

  // v55.77 — Fix #3 — UI color resolution.
  // Previously the chat surface's outer border + message bubble backgrounds
  // used `persona.color` (the user's TONE preset like "professional"/"friendly"
  // from PERSONALITIES). When persona switched to Jenna or Sara, the photo +
  // name swapped but the outer border + bubbles stayed Nadia-indigo. Now we
  // derive the UI color from the ACTIVE AGENT (Nadia/Jenna/Sara), so all
  // visual surfaces snap to the right color when switching.
  // tonePersona = communication style (professional/friendly/etc) — kept for
  // any logic that depends on tone, e.g. greeting word choice. uiColor is the
  // visual paint for borders, bubbles, gradient header.
  var uiColor = (activeAgent && activeAgent.colors && activeAgent.colors.primary) || persona.color;

  // Load AI memory from database
  useEffect(function() {
    if (!myId) return;
    (async function() {
      try {
        var result = await supabase.from('users').select('ai_memory').eq('id', myId).maybeSingle();
        if (result.data && result.data.ai_memory) {
          setAiMemory(result.data.ai_memory);
        }
      } catch(e) {}
    })();
  }, [myId]);

  // Parse memory into facts + conversation log
  var parsedMemory = useCallback(function() {
    try {
      var parsed = JSON.parse(aiMemory || '{}');
      return { facts: parsed.facts || [], log: parsed.log || '' };
    } catch(e) {
      // Legacy: if aiMemory is plain text, treat it all as log
      return { facts: [], log: aiMemory || '' };
    }
  }, [aiMemory]);

  // Save memory — extract facts from user messages + keep conversation log
  var saveMemory = useCallback(async function(newMessages) {
    if (!myId || newMessages.length < 2) return;
    try {
      var mem = parsedMemory();
      var existingFacts = mem.facts || [];
      // ET, not UTC. Past: UTC date truncation made late-night ET entries
      // land on tomorrow and confused "yesterday" lookups.
      var todayStr = todayET();

      // Extract facts from user messages using pattern matching
      var userMsgs = newMessages.filter(function(m) { return m.role === 'user'; });
      var newFacts = [];
      userMsgs.forEach(function(m) {
        var t = (m.text || '').toLowerCase();
        var orig = m.text || '';
        // "Call me X" / "My name is X" / "I go by X"
        var nameMatch = orig.match(/call me (\w+)|my name is (\w+)|i go by (\w+)|prefer (?:to be called |being called )?(\w+)/i);
        if (nameMatch) {
          var preferred = nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4];
          newFacts.push('Prefers to be called: ' + preferred);
          // Remove old name preferences
          existingFacts = existingFacts.filter(function(f) { return !f.startsWith('Prefers to be called'); });
        }
        // "Remember that..." / "Don't forget..."
        var remMatch = orig.match(/remember (?:that |this[: ]*)?(.+)/i);
        if (remMatch && remMatch[1].length > 3) newFacts.push('Remembered: ' + remMatch[1].substring(0, 200));
        var forgetMatch = orig.match(/(?:don'?t forget|keep in mind)[: ]*(.+)/i);
        if (forgetMatch) newFacts.push('Remembered: ' + forgetMatch[1].substring(0, 200));
        // "I have X kids" / "My kids are..." / "My son/daughter..."
        if (t.match(/my (?:kid|child|son|daughter|baby|wife|husband|spouse|family)/)) newFacts.push('Family: ' + orig.substring(0, 200));
        // "I like/love/prefer/hate/don't like..."
        var prefMatch = orig.match(/i (?:like|love|prefer|enjoy|hate|don'?t like|dislike) (.+)/i);
        if (prefMatch) newFacts.push('Preference: ' + prefMatch[0].substring(0, 200));
        // "I am..." / "I'm..."
        var iamMatch = orig.match(/(?:i am|i'?m) (?:a |an )?(\w.{3,})/i);
        if (iamMatch && !t.includes('i am good') && !t.includes('i am fine') && !t.includes('i am ok')) {
          newFacts.push('About user: ' + iamMatch[0].substring(0, 200));
        }
      });

      // Merge facts — deduplicate
      var allFacts = existingFacts.concat(newFacts);
      // Remove exact duplicates
      allFacts = allFacts.filter(function(v, i, a) { return a.indexOf(v) === i; });
      // Keep max 30 facts
      if (allFacts.length > 30) allFacts = allFacts.slice(-30);

      // Build conversation log summary (last 1500 chars)
      var convoSummary = newMessages.slice(-6).map(function(m) { return (m.role === 'user' ? firstName : 'Nadia') + ': ' + m.text; }).join(' | ');
      var logEntry = '[' + todayStr + '] ' + convoSummary.substring(0, 300);
      var fullLog = ((mem.log || '') + '\n' + logEntry).slice(-1500);

      var memoryObj = JSON.stringify({ facts: allFacts, log: fullLog });
      await supabase.from('users').update({ ai_memory: memoryObj }).eq('id', myId);
      setAiMemory(memoryObj);
    } catch(e) { console.warn('Memory save error:', e); }
  }, [myId, aiMemory, parsedMemory, firstName]);

  var buildContext = useCallback(function() {
    // Everything below uses Eastern Time. Max is in Princeton, NJ. Fixing
    // the "you weren't here yesterday" bug that happened because UTC
    // disagrees with ET after ~7pm local.
    var todayStr = todayET();
    var timeGreeting = etGreetingWord();

    // Login history analysis
    var loginSessions = loginHistory || [];
    var todayLogins = loginSessions.filter(function(s) { return s.date === todayStr; });
    var visitNumberToday = todayLogins.length;
    var previousDays = loginSessions.filter(function(s) { return s.date !== todayStr; });
    var lastLoginDate = previousDays.length > 0 ? previousDays[0].date : null;

    // Calculate days since last login — compare as ET calendar days, not UTC ms.
    // Pre-Session3 rows may still have UTC date in .date — cmpETDays handles both.
    var daysSinceLastLogin = 0;
    if (lastLoginDate) {
      daysSinceLastLogin = cmpETDays(lastLoginDate, todayStr);
    }

    // Login streak — walk backward day-by-day from today in ET
    var streak = 1;
    var allDates = loginSessions.map(function(s) { return s.date; })
      .filter(function(v, i, a) { return a.indexOf(v) === i; })
      .sort().reverse();
    for (var si = 1; si < allDates.length; si++) {
      // Expect consecutive days — if the gap is exactly 1 ET day, streak continues.
      if (cmpETDays(allDates[si], allDates[si - 1]) === 1) { streak++; } else { break; }
    }

    // Tickets
    var myTickets = (tickets || []).filter(function(t) { return t.assigned_to === myId && t.status !== 'Closed'; });
    var overdueTickets = myTickets.filter(function(t) { return t.due_date && t.due_date < todayStr; });
    var dueTodayTickets = myTickets.filter(function(t) { return t.due_date === todayStr; });
    var unackedTickets = myTickets.filter(function(t) { return t.status === 'New'; }); // unacknowledged — user hasn't accepted yet
    var newTickets = unackedTickets; // alias for backward compat
    // Stale tickets — not updated in 3+ days
    var staleTickets = myTickets.filter(function(t) {
      var lastUpdate = t.updated_at || t.created_at || '';
      if (!lastUpdate) return false;
      var daysSince = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 86400000);
      return daysSince >= 3;
    });
    var overdueInvoices = (invoices || []).filter(function(i) { return Number(i.outstanding || 0) > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000; });
    var pendingChecks = (checks || []).filter(function(c) { return c.status === 'pending' && c.due_date && c.due_date <= todayStr; });
    
    // Treasury summary
    var totalIn = (treasury || []).reduce(function(a, t) { return a + Number(t.cash_in || 0); }, 0);
    var totalOut = (treasury || []).reduce(function(a, t) { return a + Number(t.cash_out || 0); }, 0);
    var net = totalIn - totalOut;

    var ctx = 'USER CONTEXT:\n';
    ctx += 'Full name: ' + fullName + '\n';
    ctx += 'First name: ' + firstName + '\n';
    ctx += 'Role: ' + (userProfile?.role || 'team member') + '\n';
    // S22.7 (Apr 23 2026) — Always include day-of-week. Max reported Nadia
    // saying "Friday April 25" when April 25 is Saturday. Parsing as local
    // (not UTC) prevents timezone shift.
    var _dn = '';
    try {
      var _p = String(todayStr).split('-');
      if (_p.length === 3) {
        var _d = new Date(Number(_p[0]), Number(_p[1]) - 1, Number(_p[2]), 12, 0, 0);
        _dn = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][_d.getDay()];
      }
    } catch (_) {}
    ctx += 'Time: Good ' + timeGreeting + ', ' + (_dn ? _dn + ', ' : '') + todayStr + '\n';
    ctx += 'IMPORTANT: When referring to any date, use ONLY the day-of-week provided in context. Never calculate weekdays yourself.\n';
    // S22.7 — Timezone awareness for cross-team scheduling.
    ctx += '\nTIMEZONE CONTEXT:\n';
    ctx += 'Company HQ: Cairo, Egypt (UTC+2/+3). User may be working from US Eastern (UTC-4/-5). Cairo is typically 6-7 hours ahead of US Eastern.\n';
    ctx += 'All event_time values are stored in Cairo local time (company convention). When showing a time to the user, mention both zones when it would reduce confusion, e.g. "3:00 PM Cairo (9:00 AM Eastern)". When the user asks you to schedule an event for the Egypt team, default to Cairo time unless they specify otherwise.\n';
    ctx += '\nLOGIN HISTORY:\n';
    if (visitNumberToday <= 1) {
      ctx += 'This is ' + firstName + "'s FIRST login today.\n";
    } else {
      ctx += 'This is ' + firstName + "'s visit #" + visitNumberToday + ' today.\n';
    }
    if (daysSinceLastLogin === 0 && !lastLoginDate) {
      ctx += 'This appears to be their very first time using the hub.\n';
    } else if (daysSinceLastLogin === 1) {
      ctx += firstName + ' was here yesterday too. Login streak: ' + streak + ' days.\n';
    } else if (daysSinceLastLogin === 2) {
      ctx += firstName + ' missed yesterday. Last login was 2 days ago.\n';
    } else if (daysSinceLastLogin > 2 && lastLoginDate) {
      ctx += firstName + ' has been away for ' + daysSinceLastLogin + ' days! Last login: ' + lastLoginDate + '. Welcome them back warmly.\n';
    } else {
      ctx += 'Login streak: ' + streak + ' day(s).\n';
    }
    ctx += '\nBUSINESS STATUS (SURFACE THESE PROMINENTLY IN YOUR GREETING — do not bury them):\n';
    if (unackedTickets.length) {
      ctx += '⚠️ UNACKNOWLEDGED tickets waiting for first response: ' + unackedTickets.length + ' — ' + unackedTickets.slice(0, 5).map(function(t) { return (t.ticket_number || '') + ' "' + (t.title || '').substring(0, 40) + '"'; }).join(', ') + '\n';
    }
    if (dueTodayTickets.length) {
      ctx += '📅 DUE TODAY: ' + dueTodayTickets.length + ' ticket(s) — ' + dueTodayTickets.map(function(t) { return (t.ticket_number || '') + ' ' + (t.title || ''); }).join(', ') + '\n';
    }
    if (overdueTickets.length) {
      ctx += '🔴 OVERDUE tickets: ' + overdueTickets.length + ' — ' + overdueTickets.map(function(t) { return (t.ticket_number || '') + ' (was due ' + t.due_date + ')'; }).join(', ') + '\n';
    }
    ctx += 'Total open tickets: ' + myTickets.length + '\n';
    if (staleTickets.length) ctx += 'Stale (not updated 3+ days): ' + staleTickets.length + ' — ' + staleTickets.slice(0, 5).map(function(t) { return (t.ticket_number || '') + ' ' + (t.title || ''); }).join(', ') + '. Nudge them!\n';
    if (overdueInvoices.length) ctx += 'Overdue invoices: ' + overdueInvoices.length + ', EGP ' + overdueInvoices.reduce(function(a, i) { return a + Number(i.outstanding || 0); }, 0).toLocaleString() + '\n';
    if (pendingChecks.length) ctx += 'Checks due today: ' + pendingChecks.length + ', EGP ' + pendingChecks.reduce(function(a, c) { return a + Number(c.amount || 0); }, 0).toLocaleString() + '\n';
    ctx += 'Treasury net: EGP ' + net.toLocaleString() + '\n';
    if (!myTickets.length && !overdueInvoices.length && !pendingChecks.length) ctx += 'No urgent items — all clear!\n';

    // S15 — Phase 2 sub-project 3: Context-aware screens.
    // Inject what the user is currently looking at so Nadia can tailor her
    // conversation. E.g. if they're on a customer detail page, she knows
    // to talk about THAT customer specifically.
    var screenCtx = '';
    if (contextTab) {
      screenCtx += '\n===== CURRENT SCREEN CONTEXT =====\n';
      screenCtx += 'Active tab: ' + contextTab + '\n';

      if (contextSelectedCustomer) {
        screenCtx += 'Currently viewing customer: ' + contextSelectedCustomer + '\n';
        // Pull customer's recent invoices + outstanding balance
        var custInvoices = (invoices || []).filter(function(inv) {
          var n = inv.customer_name || inv.customer_name_en || '';
          return n === contextSelectedCustomer;
        });
        if (custInvoices.length > 0) {
          var custOutstanding = custInvoices.reduce(function(a, i) { return a + Number(i.outstanding || 0); }, 0);
          var custCollected = custInvoices.reduce(function(a, i) { return a + Number(i.total_collected || 0); }, 0);
          screenCtx += '  Total invoices with this customer: ' + custInvoices.length + '\n';
          screenCtx += '  Outstanding: EGP ' + custOutstanding.toLocaleString() + '\n';
          screenCtx += '  Lifetime collected: EGP ' + custCollected.toLocaleString() + '\n';
          var recentInv = custInvoices.slice(0, 3).map(function(i) {
            return (i.order_number || '#?') + ' ' + (i.invoice_date || '') + ' outstanding ' + Number(i.outstanding || 0).toLocaleString();
          }).join(' | ');
          if (recentInv) screenCtx += '  Recent: ' + recentInv + '\n';
        }
        var custChecks = (checks || []).filter(function(c) { return c.customer_name === contextSelectedCustomer; });
        if (custChecks.length > 0) {
          screenCtx += '  Has ' + custChecks.length + ' check(s) in the system.\n';
        }
        screenCtx += 'When the user asks generic questions, tailor to THIS customer specifically.\n';
      }

      if (contextSelectedInvoice) {
        screenCtx += 'Currently viewing invoice: ' + (contextSelectedInvoice.order_number || contextSelectedInvoice.id) + '\n';
        screenCtx += '  Customer: ' + (contextSelectedInvoice.customer_name || '?') + '\n';
        screenCtx += '  Total: EGP ' + Number(contextSelectedInvoice.total_amount || 0).toLocaleString() + '\n';
        screenCtx += '  Collected: EGP ' + Number(contextSelectedInvoice.total_collected || 0).toLocaleString() + '\n';
        screenCtx += '  Outstanding: EGP ' + Number(contextSelectedInvoice.outstanding || 0).toLocaleString() + '\n';
        screenCtx += '  Date: ' + (contextSelectedInvoice.invoice_date || '?') + '\n';
      }

      if (contextOpenTicketId) {
        var openT = (tickets || []).find(function(t) { return t.id === contextOpenTicketId; });
        if (openT) {
          screenCtx += 'Currently viewing ticket: ' + (openT.ticket_number || '') + ' — ' + (openT.title || '') + '\n';
          screenCtx += '  Status: ' + (openT.status || '') + ' | Priority: ' + (openT.priority || '') + '\n';
          if (openT.due_date) screenCtx += '  Due: ' + openT.due_date + '\n';
        }
      }

      // Tab-specific hints so Nadia anticipates useful conversation
      var tabHints = {
        treasury:   'User is in Treasury. Be ready to answer cash-flow, balance, and transaction questions.',
        sales:      'User is in Sales. Be ready to discuss specific invoices, collection rates, outstanding balances.',
        customers:  'User is in Customers. Be ready to pull up any customer\'s history or compare customers.',
        checks:     'User is in Checks. Be ready to discuss pending collections, overdue checks, bank matching.',
        tickets:    'User is in Tickets. Be ready to discuss any ticket status, assignee, or priority.',
        crm:        'User is in CRM. Be ready to discuss follow-ups, customer outreach.',
        shipping:   'User is in Shipping. Be ready to discuss rates, quotes, bookings.',
        calendar:   'User is in Calendar. Be ready to schedule or discuss meetings.',
      };
      if (tabHints[contextTab]) {
        screenCtx += '\nTab guidance: ' + tabHints[contextTab] + '\n';
      }
      screenCtx += '===================================\n';
      ctx += screenCtx;
    }

    return ctx;
  }, [myId, firstName, fullName, userProfile, tickets, invoices, treasury, checks, loginHistory, contextTab, contextSelectedCustomer, contextSelectedInvoice, contextOpenTicketId]);

  // v55.77 — Fix #B — Per-persona system prompt.
  // BEFORE this fix, all three personas received the same Nadia
  // executive-assistant prompt — so when user clicked Jenna and asked
  // about HR, "Jenna" replied with Nadia's executive tone instead of
  // Jenna's HR-empathetic tone. Now we PREPEND the active persona's
  // personalityPrompt + role declaration before the user's tone preset.
  // The user's tone preset (persona.prompt — "professional"/"friendly"/etc)
  // is layered on top as a tone modifier.
  // The result: Jenna actually knows she is HR. Sara actually knows she
  // is a coach. Each persona stays in character.
  var personaIntro = '';
  if (activeAgent) {
    personaIntro = '=== YOUR IDENTITY ===\n'
      + 'You are ' + activeAgent.name + ', the ' + activeAgent.role + ' for KTC International.\n'
      + (activeAgent.personalityPrompt || '') + '\n'
      + '\nIMPORTANT: Stay in character. You are NOT Nadia (unless you ARE Nadia). '
      + 'If the user asks something outside your role, politely redirect them to the right colleague — '
      + (activeAgentKey === 'nadia' ? 'for HR matters point them to Ms. Jenna; for coaching point them to Sara.\n'
        : activeAgentKey === 'jenna' ? 'for operational/business matters point them to Nadia; for performance coaching point them to Sara.\n'
        : activeAgentKey === 'sara'  ? 'for HR matters point them to Ms. Jenna; for daily operations point them to Nadia.\n'
        : '\n')
      + '=== END IDENTITY ===\n\n';
  }
  var sysPrompt = personaIntro
    + persona.prompt + '\n'
    + 'You work at KTC Trading Company (Kandil Trading - Egyptian/US import-export, textiles, chemicals, leather).\n'
    + 'Language: ' + (useLang === 'ar' ? 'Arabic (Egyptian dialect)' : 'English') + ' ONLY.\n'
    + 'CRITICAL RULES:\n'
    + '- ALWAYS address the user by their FIRST NAME (' + firstName + ').\n'
    + '- Build a personal relationship. Be warm. Remember you are their dedicated AI assistant.\n'
    + '- Use the LOGIN HISTORY to personalize: if first visit today say so naturally. If 2nd+ visit, acknowledge it. If they missed days, welcome them back.\n'
    + '- NEVER say "this is the first time you are on the hub" unless login history confirms it is truly their first ever visit.\n'
    + '- You REMEMBER past conversations. Use PAST MEMORIES below to reference things you discussed before — their kids, preferences, issues, personal details. This makes you a REAL secretary who knows them.\n'
    + '- If they share personal info (kids names, hobbies, preferences, concerns), naturally remember and reference it in future conversations.\n'
    + '- Keep responses SHORT: 2-4 sentences. Conversational, not robotic.\n'
    + '- No markdown. Plain text only.\n'
    + '- You have access to their tickets, invoices, treasury data, and checks. Answer business questions if asked.\n'
    + '- PROACTIVELY surface urgent items in your greeting: unacknowledged tickets, tickets due today, overdue tickets, checks due today. Lead with these — do not make the user ask. Be direct: "You have 3 tickets waiting for your acknowledgment and 2 due today."\n'
    + '- If there are NO urgent items, say so warmly ("all clear today") — do not invent urgency.\n'
    // v55.65 — Anti-repetition. Without this Nadia greets people the same
    // way every single time ("Good morning Max!" → "Good morning Max!").
    // We feed her the last 8 things she said so she can vary her openings,
    // pick different items to lead with, and not feel like a stuck record.
    + (function () {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return '';
        // v55.80 BD-AUDIT FIX: scope by user id so two people sharing a
        // browser don't cross-contaminate "recent phrases."
        var phrasesKey = 'nadia_recent_phrases_' + (myId || 'anon');
        var raw = window.localStorage.getItem(phrasesKey) || '[]';
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length === 0) return '';
        var lines = arr.slice(0, 8).map(function (p) { return '- "' + (p.fp || '').substring(0, 80) + '..."'; }).join('\n');
        return '\n\nIMPORTANT — DO NOT REPEAT YOURSELF. Here are the openings/phrases you used in your last few replies. Pick a DIFFERENT opening, a DIFFERENT angle, and DIFFERENT items to lead with. Variety matters — feel like a real colleague who notices new things, not a stuck record:\n' + lines + '\n';
      } catch (_) { return ''; }
    })()
    + (function() {
      var mem = parsedMemory();
      var result = '';
      if (mem.facts.length > 0) {
        result += '\nPERSONAL FACTS YOU KNOW ABOUT ' + firstName.toUpperCase() + ' (use these naturally, they are PERMANENT):\n';
        mem.facts.forEach(function(f) { result += '- ' + f + '\n'; });
        // Check for preferred name
        var namePref = mem.facts.find(function(f) { return f.startsWith('Prefers to be called'); });
        if (namePref) result += '\nIMPORTANT: ' + namePref + '. ALWAYS use this name instead of their system name.\n';
      }
      if (mem.log) {
        result += '\nRECENT CONVERSATION HISTORY:\n' + mem.log.substring(-800) + '\n';
      }
      if (!mem.facts.length && !mem.log) {
        result += '\nNo past conversation history yet. Get to know them!\n';
      }
      return result;
    })();

  // Auto-greet — only once per login session. Deferred 1.2s after mount so
  // the dashboard (invoices, tickets, sparklines, etc.) paints FIRST. Before
  // this defer, the AI fetch + typewriter were contending for main-thread
  // time with the dashboard render and the whole page felt frozen until
  // Nadia finished her first paragraph.
  useEffect(function() {
    if (hasGreeted || !enabled || !loginHistoryLoaded) return;
    // v51 — if user left the tab in hard-stop state, skip the initial greeting too.
    if (stoppedRef.current && stoppedRef.current > Date.now()) return;
    var t = setTimeout(function() {
      if (onGreeted) onGreeted();
      doSend(null, true);
    }, 1200);
    return function() { clearTimeout(t); };
  }, [enabled, loginHistoryLoaded, hasGreeted]);

  // S17.6 — Tab-aware proactive greeting. When the user navigates to a new
  // tab (e.g. from dashboard → tickets), Nadia says something relevant to
  // THAT tab. This runs AFTER the initial login greeting has happened, so
  // it won't double-greet. It also only fires once per tab per session via
  // a ref that tracks the last-greeted tab.
  //
  // The greeting is brief (1-2 sentences) and context-aware, e.g.:
  //   Tickets tab → "You've got 3 tickets open for you, 1 overdue."
  //   Treasury tab → "Cash net today is +180,000 EGP. Want the breakdown?"
  //   Customers tab → "On customers — anyone specific you want to check on?"
  var lastGreetedTabRef = useRef(null);
  useEffect(function() {
    if (!enabled) return;
    if (!hasGreeted) return;              // wait for initial greeting first
    if (!contextTab) return;
    if (contextTab === 'dashboard') return; // dashboard already handled by main greeting
    if (lastGreetedTabRef.current === contextTab) return;  // already greeted this tab
    // S22.13 — user tapped stop → respect their silence. Don't greet on
    // tab changes while paused. She'll stay quiet until they engage her.
    if (pausedRef.current) return;
    // v51 — hard-stopped. Same treatment: no proactive tab greetings.
    if (stoppedRef.current && stoppedRef.current > Date.now()) return;
    lastGreetedTabRef.current = contextTab;
    // Defer slightly so tab content paints first
    var t = setTimeout(function() {
      // Re-check paused right before firing — user may have re-paused
      // during the 600ms delay.
      if (pausedRef.current) return;
      doSend(null, 'tab_greeting');
    }, 600);
    return function() { clearTimeout(t); };
  }, [contextTab, hasGreeted, enabled]);

  useEffect(function() {
    // Only scroll the internal chat container — NEVER the window.
    // Previously used chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    // which propagates up through overflow-y-auto containers and forcibly
    // scrolls the whole dashboard page down every time Nadia types a
    // character. That made the rest of the dashboard unusable during a reply.
    try {
      var endEl = chatEndRef.current;
      if (!endEl) return;
      // Find the nearest scrollable ancestor (the overflow-y-auto container
      // holding the messages) and adjust only its scrollTop. The window stays put.
      var scroller = endEl.parentElement;
      while (scroller && scroller !== document.body) {
        var style = window.getComputedStyle(scroller);
        if (/(auto|scroll)/.test(style.overflowY)) break;
        scroller = scroller.parentElement;
      }
      if (scroller && scroller !== document.body) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    } catch (e) { /* best-effort — never let a scroll glitch crash the UI */ }
  }, [messages, typingText]);

  // TTS — dispatches window events so the global VoiceController can
  // barge-in (cut us off) when the user starts talking while we're speaking.
  // We also expose the current Audio element to NadiaFace via state so the
  // face can tap the live audio stream with an AnalyserNode for real lip sync.
  var [currentAudio, setCurrentAudio] = useState(null);
  var doSpeak = useCallback(function(text) {
    if (!text) return;
    // S16 — When user has muted Nadia, skip TTS playback. The text still
    // displays in the chat bubble; only voice is suppressed. Guard placed
    // at top so we don't even hit /api/tts.
    if (muted) {
      try { console.log('[nadia] muted — skipping TTS playback'); } catch (e) {}
      return;
    }
    // S22.13 — same treatment for paused. The user tapped stop; she should
    // stay quiet until they re-engage.
    if (pausedRef.current) {
      try { console.log('[nadia] paused — skipping TTS playback until user re-engages'); } catch (e) {}
      return;
    }
    // v51 — Hard-stopped. User put her to sleep for 30 minutes. No speech
    // at all until the window expires or the user explicitly wakes her.
    if (stoppedRef.current && stoppedRef.current > Date.now()) {
      try { console.log('[nadia] stopped — sleeping until ' + fmtET(stoppedRef.current, 'time')); } catch (e) {}
      return;
    }
    // S18 (Apr 23 2026) — REVERTED to original simple doSpeak.
    // Max kept reporting Nadia cut off after 2-3 words. The extra machinery
    // I added (nadia-stop-all broadcast, prior-audio pause, speechSynthesis
    // cancel at start) was fighting itself and killing her own speech.
    // Back to basics: fetch TTS blob, play it, done. The browser handles
    // everything else. If a stale audio from a previous turn is playing,
    // stopSpeech() gets called explicitly at the right moments (submit,
    // close button, barge-in). No need to auto-stop on every new speech.
    setSpeaking(true);
    speakingStartedAtRef.current = Date.now();
    // v51 — self-suppress the wake-word listener for the duration of this
    // utterance (recomputed on end to add the tail buffer).
    //
    // v51.3 (Apr 24 2026) — CRITICAL UX FIX. Previously the stop-tail
    // extension was a floor-only update (take MAX), which meant the 30-second
    // upper bound set here on start was NEVER reduced when TTS actually
    // ended. That made the mic deaf for 30 seconds after each ack — so after
    // "Hey Nadia" → "I'm here" the user's follow-up command ("show me my
    // tickets") was silently dropped. Now: on start we still set a 30s
    // upper bound (in case TTS-stop never fires — e.g. crash mid-speech),
    // but the STOP handler REPLACES the window with now+tail instead of
    // take-max. That way the suppress ends ~3s after real TTS finishes, and
    // the user's command is heard normally.
    var startUntil = Date.now() + 30 * 1000; // upper bound — replaced on TTS stop
    if (startUntil > selfSuppressUntilRef.current) selfSuppressUntilRef.current = startUntil;
    try { window.dispatchEvent(new CustomEvent('nadia-tts-start', { detail: { until: selfSuppressUntilRef.current } })); } catch (e) {}
    var fireStop = function() {
      setSpeaking(false);
      setCurrentAudio(null);
      // v51.3 — REPLACE (not max) the suppress window with now+tail. The
      // TTS actually ended, so we want the mic active again ~3s later, not
      // stuck deaf for the remainder of the original 30s upper bound.
      var stopUntil = Date.now() + SELF_SUPPRESS_MS;
      selfSuppressUntilRef.current = stopUntil;
      try { window.dispatchEvent(new CustomEvent('nadia-tts-stop', { detail: { until: selfSuppressUntilRef.current } })); } catch (e) {}
    };
    // v51.2 — voice preferences. Read from userProfile.voice_settings JSON
    // if set by the user, otherwise defaults (Rachel, balanced). The TTS
    // endpoint clamps values so bad data is safe.
    var voicePrefs = {};
    try {
      var raw = userProfile && userProfile.voice_settings;
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (raw && typeof raw === 'object') voicePrefs = raw;
    } catch (e) {}
    // v55.77 — Fix #A — Per-persona voice. Without this, Jenna and Sara both
    // speak with whatever voice the user picked (or Rachel). Now we resolve
    // the active persona's ElevenLabs voiceId from agent-personalities.js so
    // each persona has her own distinct voice. User-level override (if they
    // explicitly set voice_settings.voice_id) wins, but the default is now
    // the persona's voice — not a generic shared one.
    var personaVoiceId = getElevenLabsVoiceId(activeAgentKey);
    var resolvedVoiceId = voicePrefs.voice_id || personaVoiceId || undefined;
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        language: useLang,
        voiceId:      resolvedVoiceId,
        stability:    voicePrefs.stability,
        similarity:   voicePrefs.similarity,
        style:        voicePrefs.style,
        speakerBoost: voicePrefs.speaker_boost
      })
    }).then(function(res) {
      if (!res.ok) throw new Error('TTS failed');
      return res.blob();
    }).then(function(blob) {
      // S17.6 — re-check muted after the async fetch. If user toggled mute
      // while we were waiting, do not play the blob.
      if (muted) return;
      // S22.13 — same for paused: user may have tapped Stop while we were
      // waiting for the blob. Don't play it.
      if (pausedRef.current) return;
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      audioRef.current = audio;
      setCurrentAudio(audio);
      audio.onended = function() { audioRef.current = null; fireStop(); };
      // v54.2 (Apr 24 2026) — Autoplay-blocked detection.
      //
      // Browsers block audio.play() until the user has interacted with
      // the page. On a fresh morning tab-reload, the login greeting
      // tries to speak, the browser blocks it, and the greeting appears
      // silently in the chat with no audio. Users report "she didn't
      // greet me this morning" — she did, she just couldn't make sound.
      //
      // Fix: if play() rejects with NotAllowedError (autoplay policy),
      // queue the text for replay and flip a flag that shows a
      // "🔊 Tap to hear Nadia" banner. One tap unlocks audio for the
      // whole session.
      audio.play().catch(function(err) {
        var isAutoplayBlock = err && (err.name === 'NotAllowedError' || err.name === 'AbortError');
        if (isAutoplayBlock) {
          try { console.log('[nadia] autoplay blocked — queueing for user-tap unlock'); } catch (e) {}
          try {
            pendingAutoplayRef.current = { text: text, blob: blob, url: url };
            setAutoplayBlocked(true);
          } catch (e) {}
          // Don't fall back to SpeechSynthesis — that's also blocked on
          // autoplay-restricted pages. Wait for user tap.
          fireStop();
        } else {
          doFallbackSpeak(text);
        }
      });
    }).catch(function() { doFallbackSpeak(text); });
  }, [useLang, muted]);

  var doFallbackSpeak = function(text) {
    if (muted) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = useLang === 'ar' ? 'ar-EG' : 'en-US';
      u.rate = 0.95;
      u.onend = function() {
        setSpeaking(false);
        try { window.dispatchEvent(new CustomEvent('nadia-tts-stop')); } catch (e) {}
      };
      window.speechSynthesis.speak(u);
    } catch(e) {
      setSpeaking(false);
      try { window.dispatchEvent(new CustomEvent('nadia-tts-stop')); } catch (er) {}
    }
  };

  var stopSpeech = function() {
    // S22 (Apr 23 2026) — Hardened against every failure mode that was
    // crashing Nadia when users clicked buttons mid-conversation.
    // Every sub-step is its own try/catch so one problem doesn't cascade.
    // S22.13 — Also enter "paused" state. User tapping stop means "stop
    // talking and DON'T start again on your own." She stays paused until
    // the user types, taps the mic, or says "Hey Nadia".
    try {
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch (e) {}
        try { audioRef.current.src = ''; } catch (e) {}
        audioRef.current = null;
      }
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch (e) {}
    try { setSpeaking(false); } catch (e) {}
    try { setCurrentAudio(null); } catch (e) {}
    try { setPaused(true); pausedRef.current = true; } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('nadia-tts-stop')); } catch (e) {}
  };

  // S18.1 — stale-closure fix for cross-tab memory. The onBobCommand
  // listener below only registers when `enabled` flips. Over multiple
  // conversations its captured `doSend` is the one from that first
  // render — which closes over the initial (empty) `messages`. Result:
  // every "Hey Nadia" voice command was being sent to the API with
  // EMPTY history, even though messages had grown. It felt like Nadia
  // lost her memory on voice. Fix: keep a ref that always points at the
  // latest doSend; the listener reads the ref at call time.
  var doSendRef = useRef(null);

  // Listen for wake-word commands + user-initiated events from VoiceController.
  // This replaces the old broken per-component mic code.
  // S18.1 (Apr 23 2026) — Per Max: Nadia should stop ONLY when the user hits
  // the stop button or the mute button. No automatic cutoff from the mic.
  // The barge-in path is REMOVED entirely. The mic was picking up Nadia's
  // own voice from the speakers and stopping her after 2-3 words. The only
  // thing that interrupts her speech now is a deliberate user button press.
  useEffect(function() {
    var onBobCommand = function(ev) {
      if (!enabled) return;
      var cmd = ev && ev.detail && ev.detail.command;
      if (!cmd) return;
      // v55.78 — Multi-persona wake-word routing.
      // The wake engine now reports WHICH persona the user named (e.g.
      // "Hey Jenna, what about my vacation request?" → agent='jenna'). If
      // the named persona differs from the currently active one, switch
      // to that persona BEFORE processing the command. The unified module
      // (AssistantsBar) listens for ktc:assistant-changed and re-paints.
      // page.jsx also listens and updates selectedAssistant, which flows
      // back into AIGreeter on the next render — so the command will be
      // processed under the new persona's prompt and voice.
      var namedAgent = ev && ev.detail && ev.detail.agent;
      var personaWillSwitch = false;
      if (namedAgent && (namedAgent === 'nadia' || namedAgent === 'jenna' || namedAgent === 'sara')
          && namedAgent !== activeAgentKey) {
        try { console.log('[wake] persona switch via wake-word: ' + activeAgentKey + ' → ' + namedAgent); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('ktc:assistant-changed', { detail: { agent: namedAgent } })); } catch (e) {}
        personaWillSwitch = true;
        // v55.78 — IMPORTANT: doSendRef.current still references the OLD
        // doSend closure (built with the OLD activeAgentKey, OLD sysPrompt,
        // OLD voiceId) until React re-renders. If we called doSendRef now,
        // the API call would route to the OLD persona's brain even though
        // the panel just switched. Solution: defer the doSend invocation
        // by a few render frames so the persona-change effect finishes its
        // halt sequence + a fresh render produces a NEW doSend closure with
        // the new persona's identity. Then doSendRef.current points at it.
        // 80ms is a safe React render window; persona-switch halt is sync
        // inside the effect (sub-millisecond).
      }
      // v51.1 (Apr 24 2026) — "Hey Nadia" ALWAYS wakes her, even inside
      // the 30-minute hard-stop window. The user explicitly said her name
      // with a command; that's the strongest possible engagement signal.
      // We just need to clear the stop state before proceeding so the
      // response doesn't get swallowed by the doSpeak guard.
      if (stoppedRef.current && stoppedRef.current > Date.now()) {
        try { console.log('[nadia] wake-word during stop window → waking immediately'); } catch (e) {}
        // Clear the hard-stop state in-memory, in storage, and in VoiceController.
        setStoppedUntil(0);
        stoppedRef.current = 0;
        try { localStorage.removeItem(STOP_KEY); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('nadia-stop-wake')); } catch (e) {}
        // Fall through to normal processing below.
      }
      // v54.2 (Apr 24 2026) — REMOVED redundant self-suppress check here.
      //
      // VoiceController already does its own self-suppress check before
      // dispatching hey-bob-command. By the time we get here, this IS a
      // real user command — re-checking was dropping legit commands
      // spoken in the 3-second tail buffer after "I'm here". Symptom:
      // "Hey Nadia" → "I'm here" → user speaks → silence (command
      // silently discarded).
      //
      // Old code (disabled):
      // if (selfSuppressUntilRef.current && Date.now() < selfSuppressUntilRef.current) {
      //   return;  // <-- this was eating the user's follow-up command
      // }

      // User said a wake-word command — this IS a user action, so it's
      // treated like pressing a button. Stop current speech, then process.
      stopSpeech();
      // S22.13 — "Hey Nadia" is an explicit re-engagement. Clear paused so
      // her response plays aloud. (stopSpeech set paused=true; we override.)
      try { setPaused(false); pausedRef.current = false; } catch (e) {}
      // v55.78 — If persona switched, defer one render tick so doSendRef
      // points at the NEW persona's closure (with new sysPrompt + voice).
      // Without this defer, the API call goes to the OLD persona's brain.
      // S18.1 — read from ref so we ALWAYS have the latest messages/doSend
      //
      // v55.80 audit note: 80ms is empirical. Must be > 1 React render
      // commit (~16ms at 60fps) AND > the agent-personalities re-evaluation.
      // Tested on Max's M1 MBP + iOS Safari + Pixel 7. If the wake-word
      // race re-emerges on a slow device, raise to 120ms. Don't lower —
      // we measured race-condition occurrence at <50ms in the field.
      if (personaWillSwitch) {
        setTimeout(function () {
          try { if (doSendRef.current) doSendRef.current(cmd, false); } catch (e) {}
        }, 80);
      } else {
        if (doSendRef.current) doSendRef.current(cmd, false);
      }
    };
    // Some decision chips are "ask me more" — they dispatch nadia-push-question
    // to route a follow-up query back into this greeter. Button click = OK to stop.
    var onPushQuestion = function(ev) {
      var q = ev && ev.detail && ev.detail.question;
      if (!q) return;
      stopSpeech();
      // S22.13 — user clicked a decision chip → they want a voice answer.
      try { setPaused(false); pausedRef.current = false; } catch (e) {}
      if (doSendRef.current) doSendRef.current(q, false);
    };
    // S18.2 — acknowledgment on wake word. When VoiceController detects
    // "Hey Nadia" (before the user finishes their command), play a tiny
    // "Yes?" so the user knows the mic picked up the wake word and it's
    // safe to keep talking. This MUST NOT fire the API.
    var onWakeAck = function() {
      if (!enabled) return;
      if (muted) return;
      // v54.6 — Clear ALL silencing states. Previously this only un-paused.
      // But if Nadia was hard-stopped (user said "stop for 30 min" earlier),
      // the doSpeak gate on line 633 silenced the ack and any follow-up.
      // "Hey Nadia" is an explicit wake — it must override every silence
      // state, otherwise she stays silent and the user can't get her back.
      try { setPaused(false); pausedRef.current = false; } catch (e) {}
      try {
        setStoppedUntil(0);
        stoppedRef.current = 0;
        try { localStorage.removeItem(STOP_KEY); } catch (e) {}
      } catch (e) {}
      // Use the same doSpeak pipeline so it respects mute + TTS settings.
      // Very short phrase so it doesn't collide with the user's incoming
      // command (Web Speech tolerates a brief overlap).
      var ack = (useLang === 'ar') ? 'نعم' : "I'm here";
      try { doSpeak(ack); } catch (e) {}
    };
    window.addEventListener('hey-bob-command', onBobCommand);
    window.addEventListener('nadia-push-question', onPushQuestion);
    window.addEventListener('nadia-wake-ack', onWakeAck);
    // v55.13 (Apr 26 2026) — INSTANT BARGE-IN handler.
    // VoiceController dispatches this event the moment it picks up real
    // user speech (3+ char interim transcript) while Nadia is talking.
    // We immediately cancel her speech so she shuts up the same way
    // ChatGPT voice and Claude voice do — no waiting for the wake word.
    var onBargeIn = function(ev) {
      if (!enabled) return;
      try { console.log('[nadia] barge-in received — stopping speech'); } catch (e) {}
      try { stopSpeech(); } catch (e) {}
      // We do NOT clear paused here. stopSpeech() sets paused=true so she
      // doesn't auto-resume. The next user action (saying "Hey Nadia",
      // pressing record, or finishing their command) will un-pause as
      // appropriate. This matches the user's stated mental model: "stop
      // talking and listen carefully to what I'm saying."
    };
    window.addEventListener('nadia-bargein', onBargeIn);
    return function() {
      window.removeEventListener('hey-bob-command', onBobCommand);
      window.removeEventListener('nadia-push-question', onPushQuestion);
      window.removeEventListener('nadia-wake-ack', onWakeAck);
      window.removeEventListener('nadia-bargein', onBargeIn);
    };
  }, [enabled, muted, useLang]);

  // Voice recognition — press-to-start, press-to-stop, then send.
  // Previous behavior kept auto-stopping on silence pauses which cut users off
  // mid-thought. New behavior: you START the recording, and it only ENDS when
  // (a) you tap the mic again, or (b) 60 seconds of true silence pass as a
  // safety net. Users get predictable "record → stop → transcribe" flow.
  var SILENCE_TIMEOUT_MS = 60000; // 60s safety net; primary stop is user tap
  var silenceTimerRef = useRef(null);
  var accumulatedRef = useRef(''); // running transcript across results
  // True while the user intends to be listening — lets us auto-restart the
  // recognition if Chromium ends it prematurely (a known issue with Web Speech
  // on some Chromium builds where continuous=true still ends after ~10s of audio).
  var userWantsListenRef = useRef(false);
  var lastVoiceActivityRef = useRef(0);

  var clearSilenceTimer = function() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  var startListen = async function() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { if (toast) toast.warning('Voice not supported in this browser'); return; }

    // Pre-flight: barge in on any currently-speaking Nadia so the two audio paths
    // don't collide and so the user gets immediate feedback that the mic is engaged.
    if (speaking) { try { stopSpeech(); } catch (e) {} }
    // S22.13 — tapping the mic = explicit re-engagement. Clear paused so
    // her reply will be audible when it comes back.
    try { setPaused(false); pausedRef.current = false; } catch (e) {}

    // Clean up any stale recognition instance from a previous click. This is
    // the #1 cause of "mic doesn't work the first few times" — the browser
    // rejects a second rec.start() while the prior instance is still alive.
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; recognitionRef.current.onresult = null; recognitionRef.current.onerror = null; } catch (e) {}
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }

    // Use Permissions API when available to avoid re-prompting users who already
    // granted mic permission. Does not replace the browser's own prompt — but on
    // Chromium browsers, 'granted' means the recognition start will not re-prompt.
    try {
      if (navigator.permissions && navigator.permissions.query) {
        var perm = await navigator.permissions.query({ name: 'microphone' });
        if (perm && perm.state === 'denied') {
          if (toast) toast.warning('Microphone blocked in browser settings. Click the 🔒 icon in the address bar to enable.');
          return;
        }
      }
    } catch (e) { /* Safari / older browsers don't support permissions.query for microphone */ }

    userWantsListenRef.current = true;
    accumulatedRef.current = '';
    setListening(true);

    // Factory so we can build a fresh instance on auto-restart. Each instance
    // must have its own handlers because Chromium sometimes retains state.
    var buildRec = function() {
      var r = new SR();
      r.lang = useLang === 'ar' ? 'ar-EG' : 'en-US';
      var ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      var isSafari = /^((?!chrome|android).)*safari/i.test(ua);
      r.continuous = !isSafari;
      r.interimResults = true;
      r.maxAlternatives = 1;
      return r;
    };

    var attachHandlers = function(r) {
      // Every new audio chunk resets the silence timer. If the user goes quiet
      // for SILENCE_TIMEOUT_MS, we auto-send.
      var resetSilenceTimer = function() {
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(function() {
          // User stopped talking — end the session. onend will flush the transcript.
          userWantsListenRef.current = false;
          try { r.stop(); } catch (e) {}
        }, SILENCE_TIMEOUT_MS);
      };

      r.onresult = function(ev) {
        // Accumulate only finalized results into the running transcript; always
        // show interim text in the input while the user is mid-sentence.
        var finalText = accumulatedRef.current;
        var interim = '';
        var sawContent = false;
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var res = ev.results[i];
          var txt = res[0] && res[0].transcript ? res[0].transcript : '';
          if (res.isFinal) { finalText += txt + ' '; if (txt.trim()) sawContent = true; }
          else { interim += txt; if (txt.trim()) sawContent = true; }
        }
        accumulatedRef.current = finalText;
        // v51.2 — don't stomp on user-typed text. If they're actively typing
        // in the input, the mic is probably picking up ambient noise or her
        // own voice tail. Only update input when user is NOT typing.
        var userTypingNow = false;
        try { userTypingNow = !!window.__nadiaUserTyping; } catch (e) {}
        if (!userTypingNow) {
          setInput((finalText + interim).trim());
        }
        // Only reset silence timer on real speech progress, not empty ticks.
        if (sawContent) { lastVoiceActivityRef.current = Date.now(); resetSilenceTimer(); }
      };

      r.onerror = function(e) {
        // 'no-speech' and 'aborted' are normal stop events, not errors the user needs to see.
        if (e && e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
          if (toast) toast.warning('Mic error: ' + e.error);
        }
        // Fatal errors should stop the session; soft errors let onend decide.
        if (e && e.error && (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture')) {
          userWantsListenRef.current = false;
          clearSilenceTimer();
          setListening(false);
        }
      };

      r.onend = function() {
        // If the user still wants to listen AND we saw recent voice activity,
        // Chromium ended the recognition prematurely — silently restart it so
        // the "only caught 5–8 words" bug doesn't happen.
        var wantMore = userWantsListenRef.current;
        var recentSpeech = (Date.now() - lastVoiceActivityRef.current) < SILENCE_TIMEOUT_MS;
        if (wantMore && recentSpeech) {
          try {
            var nextRec = buildRec();
            recognitionRef.current = nextRec;
            attachHandlers(nextRec);
            nextRec.start();
            resetSilenceTimer();
            return;
          } catch (e) { /* fall through to finalize */ }
        }
        // Otherwise: this is a real stop. Finalize and send.
        clearSilenceTimer();
        userWantsListenRef.current = false;
        setListening(false);
        var finalTranscript = String(accumulatedRef.current || '').trim();
        accumulatedRef.current = '';
        if (finalTranscript) {
          setInput('');
          doSend(finalTranscript);
        }
      };
      return resetSilenceTimer;
    };

    var rec = buildRec();
    recognitionRef.current = rec;
    var resetSilenceTimer = attachHandlers(rec);

    try {
      rec.start();
      lastVoiceActivityRef.current = Date.now();
      resetSilenceTimer();
    } catch (e) {
      // InvalidStateError when an instance is still alive — abort + retry once.
      try {
        rec.abort();
        setTimeout(function() {
          try { rec.start(); resetSilenceTimer(); } catch (e2) {
            setListening(false);
            userWantsListenRef.current = false;
            if (toast) toast.warning('Could not start microphone — try clicking again');
          }
        }, 150);
      } catch (e3) {
        setListening(false);
        userWantsListenRef.current = false;
        if (toast) toast.warning('Could not start microphone');
      }
    }
  };

  var stopListen = function() {
    userWantsListenRef.current = false;
    clearSilenceTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
    setListening(false);
  };

  // =====================================================================
  // RECORD BUTTON — now bulletproof (S10 2026-04-22)
  //
  // Why this button exists: the live mic sometimes cuts off mid-sentence on
  // Chromium. This one never does — user taps to start, taps to stop.
  //
  // How it works now (the important part):
  //   1. Start — we turn on TWO things at once:
  //        a) Audio recording (for Whisper)
  //        b) The browser's built-in speech-to-text (as a free backup)
  //   2. Stop — we try Whisper first because it's more accurate, especially
  //      in Arabic. If Whisper fails for ANY reason (no key, network issue,
  //      anything), we silently use what the browser already transcribed.
  //   3. Errors — if both fail, we show a big RED card inside the chat
  //      explaining exactly what went wrong. Nothing ever fails silently.
  //
  // Every step logs to the browser console with the [record] prefix so if
  // it still breaks, the console tells us exactly where.
  // =====================================================================

  var stopRecordingTick = function() {
    if (recordTickRef.current) {
      clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
  };

  var releaseMediaStream = function() {
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach(function(t) { try { t.stop(); } catch (e) {} });
      } catch (e) {}
      mediaStreamRef.current = null;
    }
  };

  // Stop + tear down the backup SpeechRecognition. Safe to call multiple
  // times — a null ref is a no-op.
  var stopBackupRecog = function() {
    if (recordBackupRecogRef.current) {
      try {
        recordBackupRecogRef.current.onresult = null;
        recordBackupRecogRef.current.onerror = null;
        recordBackupRecogRef.current.onend = null;
      } catch (e) {}
      try { recordBackupRecogRef.current.stop(); } catch (e) {}
      try { recordBackupRecogRef.current.abort(); } catch (e) {}
      recordBackupRecogRef.current = null;
    }
  };

  // Push a loud inline error card into the chat. This is the new primary
  // way we communicate failures during recording — small auto-dismissing
  // toasts were getting missed, especially on mobile.
  var pushRecordError = function(title, detail) {
    try { console.warn('[record] error card:', title, '|', detail); } catch (e) {}
    var newMsgs = (messages || []).concat([{
      role: 'assistant',
      text: '⚠️ ' + title + (detail ? '\n\n' + detail : ''),
      isRecordError: true, // picked up by renderer for red styling
    }]);
    setMessages(newMsgs);
    // Show the existing toast too, as a backup — won't dismiss before the
    // card is visible in chat.
    if (toast) { try { toast.warning(title); } catch (e) {} }
  };

  var startRecording = async function() {
    if (recording || transcribing) return;
    try { console.log('[record] startRecording invoked'); } catch (e) {}

    // Barge-in: if Nadia is speaking, cut her off.
    if (speaking) { try { stopSpeech(); } catch (e) {} }
    // Live-mic and recorder are mutually exclusive.
    if (listening) { try { stopListen(); } catch (e) {} }
    // S22.13 — tapping Record = explicit re-engagement. Un-pause so the
    // response she gives back is audible.
    try { setPaused(false); pausedRef.current = false; } catch (e) {}

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      pushRecordError(
        useLang === 'ar' ? 'المتصفح لا يدعم التسجيل' : 'Recording not supported in this browser',
        useLang === 'ar' ? 'جرب فتح الصفحة في Chrome أو Safari حديث.' : 'Try opening this page in an up-to-date Chrome, Edge, or Safari.'
      );
      return;
    }

    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      try { console.warn('[record] getUserMedia denied:', e && e.message); } catch (er) {}
      pushRecordError(
        useLang === 'ar' ? 'تم رفض الوصول إلى الميكروفون' : 'Microphone access was denied',
        useLang === 'ar' ? 'افتح إعدادات الموقع في المتصفح واسمح بالوصول إلى الميكروفون، ثم حاول مرة أخرى.' : 'Click the 🔒 icon in the address bar, set Microphone to "Allow", reload the page, and try again.'
      );
      return;
    }
    mediaStreamRef.current = stream;
    try { console.log('[record] mic stream acquired'); } catch (e) {}

    // Pick the best supported mime type for MediaRecorder.
    var preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', ''];
    var mime = '';
    for (var i = 0; i < preferred.length; i++) {
      try {
        if (preferred[i] === '' || (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(preferred[i]))) {
          mime = preferred[i];
          break;
        }
      } catch (e) {}
    }
    try { console.log('[record] using mime:', mime || '(default)'); } catch (e) {}

    var mr;
    try {
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      releaseMediaStream();
      pushRecordError(
        useLang === 'ar' ? 'تعذر بدء المسجل' : 'Could not start recorder',
        (e && e.message) ? String(e.message) : (useLang === 'ar' ? 'خطأ غير معروف — أعد تحميل الصفحة وجرب مرة أخرى.' : 'Unknown error. Reload the page and try again.')
      );
      return;
    }
    mediaRecorderRef.current = mr;
    audioChunksRef.current = [];
    recordBackupTextRef.current = '';

    mr.ondataavailable = function(ev) {
      if (ev && ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };

    mr.onerror = function(ev) {
      try { console.warn('[record] MediaRecorder.onerror:', ev && ev.error); } catch (e) {}
      pushRecordError(
        useLang === 'ar' ? 'خطأ في المسجل' : 'Recorder error',
        ev && ev.error && ev.error.name ? ('Error type: ' + ev.error.name) : ''
      );
      setRecording(false);
      stopRecordingTick();
      stopBackupRecog();
      releaseMediaStream();
    };

    mr.onstop = async function() {
      try { console.log('[record] MediaRecorder.onstop — gathering result'); } catch (e) {}
      stopRecordingTick();
      setRecording(false);

      // v55.77 — Fix #F — Persona-switch discard.
      // If the user switched persona while recording, we tear down the
      // recorder cleanly but do NOT send the captured audio. The new
      // persona shouldn't be "haunted" by a recording the user started
      // for the previous persona. Resets the flag for the next session.
      if (discardRecordingRef.current) {
        try { console.log('[record] persona-switch discard — dropping captured audio'); } catch (e) {}
        discardRecordingRef.current = false;
        try { stopBackupRecog(); } catch (_) {}
        try { releaseMediaStream(); } catch (_) {}
        audioChunksRef.current = [];
        try { recordBackupTextRef.current = ''; } catch (_) {}
        return;
      }

      // Give the backup recognition a moment to finalize any last interim
      // text before we tear it down (SpeechRecognition can be async about
      // flushing the final result).
      await new Promise(function(resolve) { setTimeout(resolve, 250); });
      var backupText = String(recordBackupTextRef.current || '').trim();
      stopBackupRecog();
      releaseMediaStream();
      try { console.log('[record] backup transcript captured:', backupText.length, 'chars'); } catch (e) {}

      var chunks = audioChunksRef.current || [];
      audioChunksRef.current = [];

      // CASE 1: No audio chunks captured at all. Very unusual — usually means
      // the mic never produced data. Still — if backup picked up text, use it.
      if (chunks.length === 0) {
        try { console.warn('[record] no audio chunks captured'); } catch (e) {}
        if (backupText) {
          try { console.log('[record] falling back to backup transcript (no audio)'); } catch (e) {}
          setInput('');
          doSend(backupText);
          return;
        }
        pushRecordError(
          useLang === 'ar' ? 'لم يتم تسجيل أي صوت' : 'No audio was captured',
          useLang === 'ar' ? 'تأكد من أن الميكروفون يعمل ولم تكتمه الأيقونة في شريط الأدوات.' : 'Check that your microphone is not muted (system tray / address bar icon), then try again.'
        );
        return;
      }

      var type = chunks[0].type || mime || 'audio/webm';
      var blob = new Blob(chunks, { type: type });
      try { console.log('[record] blob built — type:', type, 'size:', blob.size); } catch (e) {}

      // CASE 2: Very tiny blob usually means a silent tap. If backup has
      // text anyway, send it; otherwise advise the user.
      if (blob.size < 1000) {
        if (backupText) {
          try { console.log('[record] tiny blob but backup has text — sending backup'); } catch (e) {}
          setInput('');
          doSend(backupText);
          return;
        }
        pushRecordError(
          useLang === 'ar' ? 'التسجيل قصير جدًا' : 'Recording was too short',
          useLang === 'ar' ? 'اضغط على الزر، تحدث بوضوح، ثم اضغط إيقاف.' : 'Tap the button, speak clearly for a few seconds, then tap stop.'
        );
        return;
      }

      // CASE 3: Normal path — try Whisper first for best quality.
      setTranscribing(true);
      var whisperText = '';
      var whisperError = null;
      try {
        var form = new FormData();
        var ext = type.indexOf('mp4') >= 0 ? 'mp4' : type.indexOf('ogg') >= 0 ? 'ogg' : 'webm';
        form.append('audio', blob, 'recording.' + ext);
        form.append('language', useLang === 'ar' ? 'ar' : 'en');
        // v55.82-O — Send Supabase session bearer token explicitly. The
        // /api/transcribe route requires auth and was previously relying
        // on the auth cookie, which is brittle (different cookie shapes
        // across browsers, missing in private/incognito, missing on
        // Safari ITP). Always send the access token from getSession() so
        // the route can verify the user reliably.
        var transcribeAuthHeaders = {};
        try {
          var sessRes = await supabase.auth.getSession();
          var sessTok = sessRes && sessRes.data && sessRes.data.session
            ? sessRes.data.session.access_token : '';
          if (sessTok) transcribeAuthHeaders['Authorization'] = 'Bearer ' + sessTok;
        } catch (e) {}
        try { console.log('[record] posting to /api/transcribe (auth header set:', !!transcribeAuthHeaders['Authorization'], ')'); } catch (e) {}
        var r = await fetch('/api/transcribe', { method: 'POST', body: form, headers: transcribeAuthHeaders });
        var data = null;
        try { data = await r.json(); } catch (parseErr) { data = { error: 'Server returned invalid JSON (status ' + r.status + ')' }; }
        if (!r.ok || (data && data.error)) {
          whisperError = (data && data.error) || ('HTTP ' + r.status);
          try { console.warn('[record] Whisper failed:', whisperError, '(status:', r.status + ')'); } catch (e) {}
        } else {
          whisperText = String((data && data.text) || '').trim();
          try { console.log('[record] Whisper returned', whisperText.length, 'chars'); } catch (e) {}
        }
      } catch (e) {
        whisperError = (e && e.message) ? e.message : 'network error';
        try { console.warn('[record] Whisper fetch threw:', whisperError); } catch (er) {}
      } finally {
        setTranscribing(false);
      }

      // Decision: Whisper wins if it returned text. Otherwise fall back to
      // the browser's built-in transcript we ran in parallel.
      var finalText = whisperText || backupText;

      if (finalText) {
        if (!whisperText && backupText) {
          try { console.log('[record] using browser backup transcript because Whisper failed:', whisperError); } catch (e) {}
        }
        setInput('');
        doSend(finalText);
        return;
      }

      // CASE 4: Both paths returned nothing. Explain plainly and point to
      // the most likely cause so Max knows what to do.
      var title, detail;
      if (whisperError && /OPENAI_API_KEY|not configured/i.test(String(whisperError))) {
        title = useLang === 'ar' ? 'خدمة التفريغ النصي غير مفعّلة وفشل النسخ الاحتياطي أيضًا' : 'Transcription service not set up';
        detail = useLang === 'ar'
          ? 'يجب إضافة مفتاح OpenAI إلى إعدادات Vercel. تواصل مع المسؤول.'
          : 'The premium transcription (Whisper) is not configured in Vercel — needs OPENAI_API_KEY environment variable from platform.openai.com/api-keys. Until that\'s added, voice recording can\'t work. Type your message instead, or ask the admin to add the key.';
      } else if (whisperError && /Authentication required|401|unauthor/i.test(String(whisperError))) {
        // v55.82-O — distinct auth-fail message. The "speak closer to the
        // mic" instruction is wrong here and was previously confusing
        // because auth errors look identical to the user.
        title = useLang === 'ar' ? 'جلسة العمل انتهت' : 'Session expired — please sign in again';
        detail = useLang === 'ar'
          ? 'انتهت جلسة تسجيل الدخول. حاول تحديث الصفحة (Cmd+Shift+R) ثم تسجيل الدخول من جديد. لا علاقة لهذا بالميكروفون.'
          : 'Your login session expired before the transcription request reached the server. This has nothing to do with the mic. Hard-refresh the page (Cmd+Shift+R), sign in again, and try recording. If it keeps happening on every recording, the auth cookie or token isn\'t being sent — tell me and I\'ll investigate.';
      } else if (whisperError && /rate limit|429/i.test(String(whisperError))) {
        // v55.82-O — also call out the rate-limit case (30 transcripts/hour/user)
        title = useLang === 'ar' ? 'تم تجاوز الحد المسموح به' : 'Hit the transcription rate limit';
        detail = useLang === 'ar'
          ? 'الحد الأقصى هو 30 تفريغًا في الساعة. حاول مرة أخرى بعد بضع دقائق.'
          : 'The transcription endpoint is capped at 30 recordings per hour per user. Wait a few minutes and try again — no mic problem here.';
      } else if (whisperError) {
        title = useLang === 'ar' ? 'فشل التفريغ النصي' : 'Transcription failed';
        detail = useLang === 'ar'
          ? ('سبب الفشل: ' + whisperError)
          : ('Whisper returned an error: ' + whisperError + '. The browser-backup transcription also came back empty. Try again, and if the same error keeps appearing, the server-side transcription service may be down — type your message instead in the meantime.');
      } else {
        title = useLang === 'ar' ? 'لم يتم التعرف على أي كلام' : 'No speech was detected';
        detail = useLang === 'ar'
          ? 'قد يكون الميكروفون مكتوماً. تحقق من إعدادات النظام، ثم حاول مرة أخرى.'
          : 'Your mic may be muted at the system level, or you may be too far from it. Check your system audio settings and try again.';
      }
      pushRecordError(title, detail);
    };

    // Start backup SpeechRecognition in parallel — this is the safety net.
    // If anything fails here we just skip the backup and rely on Whisper;
    // this path is best-effort on purpose.
    try {
      var SR2 = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
      if (SR2) {
        var br = new SR2();
        br.lang = useLang === 'ar' ? 'ar-EG' : 'en-US';
        var ua2 = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        var isSafari2 = /^((?!chrome|android).)*safari/i.test(ua2);
        br.continuous = !isSafari2;
        br.interimResults = true;
        br.maxAlternatives = 1;
        br.onresult = function(ev) {
          // Only accumulate final results into the backup buffer.
          var added = '';
          for (var j = ev.resultIndex; j < ev.results.length; j++) {
            var res2 = ev.results[j];
            if (res2.isFinal && res2[0] && res2[0].transcript) {
              added += res2[0].transcript + ' ';
            }
          }
          if (added) {
            recordBackupTextRef.current = (recordBackupTextRef.current || '') + added;
          }
        };
        br.onerror = function(e) {
          // Non-fatal — we still have the recording.
          try { console.log('[record] backup SR error (non-fatal):', e && e.error); } catch (er) {}
        };
        br.onend = function() {
          // v55.82-W (Max May 12 2026): only auto-restart if (a) the ref
          // still points to THIS instance (stopBackupRecog nulls the ref),
          // AND (b) the MediaRecorder is still actively recording. The
          // previous check used the closure-captured `recording` variable
          // which could be stale. mediaRecorderRef.current.state is the
          // canonical source of truth — it goes to 'inactive' the moment
          // mr.stop() is called.
          if (recordBackupRecogRef.current !== br) return;
          var mr2 = mediaRecorderRef.current;
          if (!mr2 || mr2.state !== 'recording') return;
          try { br.start(); } catch (restartErr) { /* ignore */ }
        };
        recordBackupRecogRef.current = br;
        try { br.start(); console.log('[record] backup SR started'); } catch (e) { try { console.log('[record] backup SR start failed (non-fatal):', e && e.message); } catch (er) {} }
      } else {
        try { console.log('[record] SpeechRecognition not available in this browser — skipping backup path'); } catch (e) {}
      }
    } catch (e) { /* best-effort — ignore */ }

    try {
      // timeslice=1000 gives us a data chunk every second so if something
      // crashes mid-record we don't lose the whole take.
      mr.start(1000);
      recordStartTsRef.current = Date.now();
      setRecordElapsed(0);
      setRecording(true);
      recordTickRef.current = setInterval(function() {
        setRecordElapsed(Math.floor((Date.now() - recordStartTsRef.current) / 1000));
      }, 1000);
      try { console.log('[record] recording started'); } catch (e) {}
    } catch (e) {
      stopBackupRecog();
      releaseMediaStream();
      pushRecordError(
        useLang === 'ar' ? 'تعذر بدء المسجل' : 'Could not start recorder',
        (e && e.message) ? String(e.message) : ''
      );
    }
  };

  var stopRecording = function() {
    if (!recording) return;
    // v55.82-W (Max May 12 2026 — "tap to stop keeps turning record on by
    // itself"): tear down the backup WebSpeech recognizer FIRST, before
    // stopping the MediaRecorder. The backup recognizer's onend handler
    // auto-restarts itself while recording is true. By nulling the ref
    // and clearing its handlers right here, we prevent any onend that
    // fires between mr.stop() and the actual onstop callback from
    // re-triggering itself. Previously this teardown only happened
    // inside onstop, which left a race window.
    try { stopBackupRecog(); } catch (e) {}
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (e) {}
    // Final state changes happen inside onstop.
  };

  var toggleRecording = function() {
    if (recording) stopRecording();
    else startRecording();
  };

  // ============================================================
  // v55.43 — VOICE CONVERSATION MODE (ChatGPT-style hands-free)
  // ============================================================
  // Approach:
  //   - When the user taps 🗣️, we set conversationMode=true and start
  //     recording immediately.
  //   - When the user stops speaking (detected via silence in the audio
  //     stream — implemented via the Web Audio API analyser below), we
  //     stop the recorder, which triggers the existing onstop → Whisper
  //     → doSend pipeline.
  //   - doSend triggers Nadia's reply (text + TTS via /api/tts).
  //   - When TTS playback finishes, we re-open the mic for the next turn.
  //   - To stop: user taps 🗣️ again. We flip conversationMode to false,
  //     stop any in-flight recorder, and don't auto-restart after the
  //     current TTS finishes.
  //
  // Critical: this MUST work even on mobile Safari/Chrome where audio
  // autoplay requires a user gesture. We initiate recording immediately
  // on the tap, so we have permission. The TTS audio Element is created
  // inside the user-gesture handler too.
  // ============================================================
  var conversationAudioCtxRef = useRef(null);
  var conversationStreamRef = useRef(null);
  var conversationSilenceTimerRef = useRef(null);
  var conversationVolMonitorRef = useRef(null);

  // Start recording for one turn, with silence-based auto-stop.
  var startConversationTurn = async function() {
    if (!conversationModeRef.current) return; // user already canceled
    if (recording) return; // already going
    try {
      // Reuse the existing startRecording — it handles getUserMedia,
      // MediaRecorder setup, mime sniffing, and the onstop → Whisper
      // → doSend pipeline. We just need to add silence detection on top.
      await startRecording();
      // After startRecording resolves, mediaRecorderRef.current is set.
      // Hook silence detection onto the same MediaStream.
      var stream = conversationStreamRef.current;
      if (!stream) {
        // startRecording stores the stream on a different ref — find it
        try { stream = mediaStreamRef.current; } catch (e) {}
      }
      if (!stream) return; // can't monitor silence without the stream
      // Build an AnalyserNode to watch the volume.
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        var ctx = new Ctx();
        conversationAudioCtxRef.current = ctx;
        var src = ctx.createMediaStreamSource(stream);
        var analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        src.connect(analyser);
        var data = new Uint8Array(analyser.frequencyBinCount);
        // v55.78 — Gap #5 — Adaptive silence threshold.
        // Before, SILENCE_THRESHOLD was hardcoded at 12. In a noisy office
        // (warehouses, phones ringing, AC running), the ambient RMS often
        // exceeds 12 → "silence" is never detected → recording hangs until
        // the 30s hard cap. Now we calibrate ambient noise during the
        // first 600ms after the mic opens, then set the threshold to
        // (calibrated_floor × 1.8) with a floor of 8 and ceiling of 35.
        // The 1.8x multiplier means we only trigger silence detection when
        // the volume drops well below ambient — safer than a fixed value.
        var CALIBRATION_MS = 600;
        var FLOOR_THRESHOLD = 8;
        var CEILING_THRESHOLD = 35;
        var THRESHOLD_MULTIPLIER = 1.8;
        var calibrationStart = Date.now();
        var calibrationSamples = [];
        var SILENCE_THRESHOLD = 12;   // initial guess; replaced after calibration
        var SILENCE_HOLD_MS  = 1800;   // how long silence has to last to stop
        var calibrated = false;
        var lastVoice = Date.now();
        var monitor = function() {
          if (!conversationModeRef.current) return; // canceled
          analyser.getByteTimeDomainData(data);
          // Compute simple deviation from 128 (silence center)
          var sum = 0;
          for (var i = 0; i < data.length; i++) {
            var d = data[i] - 128;
            sum += d * d;
          }
          var rms = Math.sqrt(sum / data.length);
          // Calibration phase: collect samples for the first 600ms before
          // we start judging silence. lastVoice is reset at the end of
          // calibration so the user effectively gets ~600ms head-start to
          // begin speaking before silence detection kicks in.
          if (!calibrated) {
            calibrationSamples.push(rms);
            if (Date.now() - calibrationStart >= CALIBRATION_MS) {
              // Use median of samples for robust ambient floor (avoids
              // outliers from coughs, mic-pops, etc.).
              calibrationSamples.sort(function (a, b) { return a - b; });
              var median = calibrationSamples[Math.floor(calibrationSamples.length / 2)] || 0;
              var threshold = Math.max(FLOOR_THRESHOLD, Math.min(CEILING_THRESHOLD, median * THRESHOLD_MULTIPLIER));
              SILENCE_THRESHOLD = threshold;
              calibrated = true;
              lastVoice = Date.now();
              try { console.log('[conversation] silence threshold calibrated: ambient=' + median.toFixed(1) + ' threshold=' + threshold.toFixed(1)); } catch (e) {}
            }
            conversationVolMonitorRef.current = requestAnimationFrame(monitor);
            return;
          }
          if (rms > SILENCE_THRESHOLD) {
            lastVoice = Date.now();
          } else if (Date.now() - lastVoice > SILENCE_HOLD_MS) {
            // User has been silent long enough — stop recording, which
            // triggers the Whisper upload + send.
            try { stopRecording(); } catch (e) {}
            return;
          }
          conversationVolMonitorRef.current = requestAnimationFrame(monitor);
        };
        conversationVolMonitorRef.current = requestAnimationFrame(monitor);
      } catch (e) {
        // Silence detection failed — fall back to a hard 30-second cap
        // so the recorder doesn't hang forever waiting for a stop.
        conversationSilenceTimerRef.current = setTimeout(function() {
          try { stopRecording(); } catch (er) {}
        }, 30000);
      }
    } catch (e) {
      try { console.warn('[conversation] turn-start failed:', e && e.message); } catch (_) {}
      setConversationMode(false);
    }
  };

  // Tear down silence detection / audio context.
  var endConversationMonitoring = function() {
    try {
      if (conversationVolMonitorRef.current) {
        cancelAnimationFrame(conversationVolMonitorRef.current);
        conversationVolMonitorRef.current = null;
      }
    } catch (e) {}
    try {
      if (conversationSilenceTimerRef.current) {
        clearTimeout(conversationSilenceTimerRef.current);
        conversationSilenceTimerRef.current = null;
      }
    } catch (e) {}
    try {
      if (conversationAudioCtxRef.current) {
        conversationAudioCtxRef.current.close();
        conversationAudioCtxRef.current = null;
      }
    } catch (e) {}
  };

  // Toggle the whole loop on/off.
  var toggleConversationMode = async function() {
    if (conversationModeRef.current) {
      // Turning it off — stop any active recording, kill the monitor,
      // stop any TTS audio that's currently playing.
      setConversationMode(false);
      conversationModeRef.current = false;
      endConversationMonitoring();
      try { if (recording) stopRecording(); } catch (e) {}
      try { stopSpeech && stopSpeech(); } catch (e) {}
      return;
    }
    // Turning it on
    setConversationMode(true);
    conversationModeRef.current = true;
    // Start the first turn after a brief delay so the user sees the
    // green button feedback first.
    setTimeout(function() { startConversationTurn(); }, 150);
  };

  // After Nadia finishes speaking (TTS audio ends), if we're still in
  // conversation mode, kick off the next turn. The TTS audio element
  // dispatches a 'nadia-tts-stop' event when it ends — we listen here.
  useEffect(function() {
    if (typeof window === 'undefined') return;
    var onTtsEnd = function() {
      if (!conversationModeRef.current) return;
      // Tiny delay so the user has a beat between Nadia stopping and the
      // mic re-opening — avoids the user's first word being cut.
      setTimeout(function() {
        if (conversationModeRef.current && !recording) {
          startConversationTurn();
        }
      }, 400);
    };
    window.addEventListener('nadia-tts-stop', onTtsEnd);
    return function() { window.removeEventListener('nadia-tts-stop', onTtsEnd); };
  }, []);
  // ============================================================
  // END VOICE CONVERSATION MODE
  // ============================================================

  // Clean up any in-flight recording when the component unmounts.
  useEffect(function() {
    return function() {
      stopRecordingTick();
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {}
      releaseMediaStream();
    };
  }, []);


  // Typewriter — was setInterval(setState) every 20ms which caused ~200
  // React re-renders for a short reply and "froze" the dashboard page.
  // Now: writes ~5 chars per animation frame via requestAnimationFrame.
  // Same feel to the user (~300 chars/sec), ~40x fewer state updates.
  var doType = function(text, cb) {
    setTypingText(''); setTypingDone(false);
    if (typingRef.current) {
      try { cancelAnimationFrame(typingRef.current); } catch (e) {}
      typingRef.current = null;
    }
    var i = 0;
    var CHARS_PER_FRAME = 5;
    var step = function() {
      i = Math.min(text.length, i + CHARS_PER_FRAME);
      setTypingText(text.substring(0, i));
      if (i >= text.length) {
        typingRef.current = null;
        setTypingDone(true);
        if (cb) cb();
        return;
      }
      typingRef.current = requestAnimationFrame(step);
    };
    typingRef.current = requestAnimationFrame(step);
  };

  // Send message
  var doSend = async function(userText, isGreeting) {
    if (loading) return;
    // S17.6 — isGreeting can be true (initial login greeting) or
    // 'tab_greeting' (tab-aware proactive greeting on tab change). Both
    // skip prior chat history in the API call; tab_greeting PRESERVES
    // the chat messages on screen so the conversation feels continuous.
    var isTabGreet = isGreeting === 'tab_greeting';
    var isLoginGreet = isGreeting === true;
    var anyGreeting = isLoginGreet || isTabGreet;
    var ctx = buildContext();
    // Login greeting resets visible messages; tab greeting appends to them.
    var msgs = isLoginGreet ? [] : [].concat(messages);
    if (userText) { msgs.push({ role: 'user', text: userText }); setMessages(msgs); setInput(''); }
    setLoading(true);
    try {
      var hist = msgs.map(function(m) { return { role: m.role === 'user' ? 'user' : 'assistant', text: m.text }; });
      var q;
      if (isLoginGreet) {
        q = ctx + '\nGreet ' + firstName + ' personally based on the LOGIN HISTORY above. Tell them what needs attention. Be natural, warm, and personal.';
      } else if (isTabGreet) {
        // S17.7 — Tab greeting. Two or three sentences, directly useful,
        // tab-specific. The buildContext already injected "CURRENT SCREEN
        // CONTEXT" (see Phase 2 sub-project #3) so Nadia has full tab +
        // selected record awareness.
        // We want her to sound like a coworker who just saw you sit down:
        // brief, personal, pointed, and ACTIONABLE. Not a cold summary.
        q = ctx + '\n\nThe user just navigated to the "' + contextTab + '" tab. '
          + 'Give a 2-3 sentence proactive update about what matters on THIS tab right now '
          + 'using the CURRENT SCREEN CONTEXT and the business data above. '
          + 'Be specific and actionable — cite real numbers, names, counts, or dates from the context. '
          + 'Tone: a warm experienced colleague noticing the important thing. Not a robot listing stats. '
          + 'Do NOT say hello/hi/good morning/sabah — you already greeted them earlier. '
          + 'Start directly with the useful info. End with a brief question or offer to help.';
      } else {
        q = userText || '';
      }

      // Opt-in to tool-use v2 via ?nadia_v2=1 OR localStorage flag.
      // Keep /api/ask as the default until v2 is battle-tested in production.
      var useV2 = false;
      try {
        if (typeof window !== 'undefined') {
          if (new URLSearchParams(window.location.search).get('nadia_v2') === '1') useV2 = true;
          else if (window.localStorage && window.localStorage.getItem('nadia_v2') === '1') useV2 = true;
        }
      } catch (e) {}

      var endpoint = useV2 ? '/api/ask-v2' : '/api/ask';
      // S9 2026-04-22: userId added to legacy greeter payload too. Without
      // this the server cannot detect super_admin and the team-visibility
      // / cross-team-action blocks never get injected into Nadia's prompt.
      // S13 2026-04-22: isGreeting flag added so server only computes the
      // morning briefing on the auto-greeting (not every chat turn).
      // v55.81 QA-16 (Max May 9 2026): include the active persona key
      // in the payload so the server can persist this turn into the
      // per-persona conversation_logs table — enables cross-device
      // continuity (a user on phone sees their laptop history, etc.).
      var payload = useV2
        ? { question: q, history: anyGreeting ? [] : hist.slice(-20), userId: (userProfile && userProfile.id) || null, isGreeting: isLoginGreet, agentKey: activeAgentKey }
        : { question: q, mode: 'greeter', systemOverride: sysPrompt + '\n' + ctx, history: anyGreeting ? [] : hist.slice(-20), userId: (userProfile && userProfile.id) || null, isGreeting: isLoginGreet, agentKey: activeAgentKey };

      // v55.80 BD-AUDIT FIX (32.2): create an AbortController and store its
      // ref so the persona-switch cleanup can cancel mid-flight requests.
      // If a previous request is still in flight (rare — usually serialized
      // through doSendRef), abort it before starting a new one.
      try { if (currentAskAbortRef.current) currentAskAbortRef.current.abort(); } catch (_) {}
      var askAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      currentAskAbortRef.current = askAbort;

      var res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: askAbort ? askAbort.signal : undefined,
      });
      // Clear the ref on successful response so a subsequent persona
      // switch doesn't try to abort an already-finished request.
      if (currentAskAbortRef.current === askAbort) currentAskAbortRef.current = null;

      // v54.6 (Apr 24 2026) — Defensive parse. If the server returned an
      // HTML error page (Cloudflare 503, Vercel cold-start timeout, etc.)
      // res.json() throws and we'd fall through to "something went wrong"
      // — which is what was happening on first morning page load. Detect
      // non-OK / non-JSON responses and either retry (greetings) or show
      // a clear message (user messages).
      var data;
      var contentType = res.headers && res.headers.get && res.headers.get('content-type');
      var looksLikeJson = contentType && contentType.indexOf('application/json') !== -1;
      if (!res.ok || !looksLikeJson) {
        if (anyGreeting) {
          // Greeting failed. Retry ONCE silently after a short delay.
          // If retry also fails, just stay quiet — don't pollute the chat
          // with "something went wrong" before the user has even said hi.
          try { console.log('[nadia] greeting fetch failed (' + res.status + '), retrying once'); } catch (e) {}
          await new Promise(function(r) { setTimeout(r, 1500); });
          var res2 = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var ct2 = res2.headers && res2.headers.get && res2.headers.get('content-type');
          if (!res2.ok || !ct2 || ct2.indexOf('application/json') === -1) {
            try { console.log('[nadia] greeting retry also failed — staying quiet'); } catch (e) {}
            setLoading(false);
            return;
          }
          data = await res2.json();
        } else {
          // User-initiated message failed. They pressed send, so they need
          // visible feedback — but make it actionable, not just "oops".
          var errText = useLang === 'ar'
            ? 'لم أستطع الوصول إلى الخادم الآن. حاول مرة أخرى بعد لحظة.'
            : 'I couldn\'t reach the server just now. Try again in a moment.';
          setMessages([].concat(msgs, [{ role: 'assistant', text: errText }]));
          doType(errText, null);
          setLoading(false);
          return;
        }
      } else {
        data = await res.json();
      }
      var aiText = data.answer || '';
      // v54.6 — if the answer is empty during a greeting, stay quiet
      // rather than speaking nothing or fabricating filler. User can
      // initiate the conversation themselves.
      if (anyGreeting && !aiText.trim()) {
        try { console.log('[nadia] greeting returned empty answer — staying quiet'); } catch (e) {}
        setLoading(false);
        return;
      }
      // v51.2 — take_break action from Nadia. User said "take a 20 minute
      // break" or similar. We execute it client-side: schedule the hard-stop
      // for AFTER she finishes speaking the confirmation message so the
      // stop doesn't swallow her own "OK, sleeping for X minutes" reply.
      if (data.pending_action && data.pending_action.type === 'take_break') {
        var breakMins = Number(data.pending_action.minutes) || 20;
        // Delay scheduling by ~500ms per spoken word, capped at 30s, so
        // her confirmation TTS plays fully before the stop window kicks in.
        var words = String(aiText || '').split(/\s+/).filter(Boolean).length || 6;
        var delayMs = Math.min(30000, words * 500);
        setTimeout(function() {
          try { goStopped(breakMins); } catch (e) {}
        }, delayMs);
      }
      // S17.7 — If API returned nothing, retry ONCE. Previously we fell back
      // to "Hey firstName!" which is the exact bug Max flagged: on tab
      // navigation Nadia would ONLY say "good morning mohamed" (the fallback)
      // even though the tab-greeting request should have yielded real content.
      // The empty response usually meant a transient API hiccup; a retry is
      // much better than silently shortening Nadia's output.
      if (!aiText) {
        try {
          var res2 = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data2 = await res2.json();
          aiText = (data2 && data2.answer) || '';
          if (data2 && data2.decision && data2.decision.ok) data.decision = data2.decision;
          if (data2 && data2.briefing) data.briefing = data2.briefing;
        } catch (e) { /* if retry also fails, fall through to minimal fallback below */ }
      }
      // Only use the minimal fallback if BOTH attempts returned nothing. Keep
      // this short — Nadia shouldn't fake a fake greeting.
      if (!aiText) aiText = useLang === 'ar'
        ? 'لحظة واحدة يا ' + firstName + '، بحمّل البيانات.'
        : 'One sec ' + firstName + ', loading your data.';

      // v2 returns drafts[] when Nadia called draft_email / draft_whatsapp / create_event
      // — fan those out to the bridge (which opens the right UI).
      if (useV2 && Array.isArray(data.drafts) && data.drafts.length > 0) {
        data.drafts.forEach(function(d) {
          try {
            var evName = d.kind === 'email'    ? 'open-email-composer'
                      : d.kind === 'whatsapp'  ? 'open-whatsapp-composer'
                      : d.kind === 'event'     ? 'open-event-form'
                      : null;
            if (evName) window.dispatchEvent(new CustomEvent(evName, { detail: d.payload || {} }));
          } catch (err) {}
        });
      }

      // Legacy /api/ask still returns `decision` for the decision-panel UI
      var assistantMsg = { role: 'assistant', text: aiText };
      if (data.decision && data.decision.ok) assistantMsg.decision = data.decision;
      // S13 — morning briefing returned only on isGreeting calls. Attach to
      // the message so the renderer shows the structured card above the text.
      if (data.briefing && (data.briefing.top3 || data.briefing.all_clear)) {
        assistantMsg.briefing = data.briefing;
      }
      var final = [].concat(msgs, [assistantMsg]);
      setMessages(final);
      saveMemory(final);
      // v55.65 — Anti-repetition: persist a fingerprint of every reply so
      // future greetings can be told "do not start with these phrases
      // and do not lead with these same items". Each fingerprint is the
      // first 80 chars normalized + timestamp. Cap at last 8.
      try {
        var fingerprint = aiText.replace(/\s+/g, ' ').substring(0, 80).toLowerCase().trim();
        if (fingerprint && typeof window !== 'undefined' && window.localStorage) {
          // v55.80 BD-AUDIT FIX: per-user key (was global before)
          var phrasesKey = 'nadia_recent_phrases_' + (myId || 'anon');
          var prevRaw = window.localStorage.getItem(phrasesKey) || '[]';
          var prev = [];
          try { prev = JSON.parse(prevRaw); if (!Array.isArray(prev)) prev = []; } catch (_) { prev = []; }
          // Drop dupes of THIS fingerprint
          prev = prev.filter(function (p) { return p && p.fp !== fingerprint; });
          prev.unshift({ fp: fingerprint, ts: Date.now() });
          // Cap at 8
          prev = prev.slice(0, 8);
          window.localStorage.setItem(phrasesKey, JSON.stringify(prev));
        }
      } catch (_) {}
      doSpeak(aiText);
      doType(aiText, null);
    } catch(e) {
      // v54.6 — same rule as the in-flight error path: be quiet on
      // greeting failures, give a real message on user-message failures.
      try { console.log('[nadia] doSend exception:', e && e.message); } catch (er) {}
      // v55.80 BD-AUDIT FIX (32.2): if the request was aborted because the
      // user switched persona, swallow silently — that's intentional UX,
      // not an error. AbortController throws a DOMException with name
      // 'AbortError'.
      if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
        setLoading(false);
        return;
      }
      if (anyGreeting) {
        // Don't pollute the chat with an error before user has said anything
        setLoading(false);
        return;
      }
      var fb = useLang === 'ar'
        ? 'عذراً، لم أتمكن من الوصول. حاول مرة أخرى.'
        : 'Sorry, I couldn\'t connect. Try again.';
      setMessages([].concat(msgs, [{ role: 'assistant', text: fb }]));
      doType(fb, null);
    }
    setLoading(false);
  };

  var handleSubmit = function() {
    if (!input.trim()) return;
    stopSpeech();
    // S22.13 — user typed a message → they're engaging Nadia. Clear paused
    // so her reply plays aloud. (stopSpeech always sets paused=true.)
    try { setPaused(false); pausedRef.current = false; } catch (e) {}
    // v51.2 — the message is on its way; clear the typing flag so the next
    // voice follow-up can fire normally.
    try { window.__nadiaUserTyping = false; } catch (_) {}
    doSend(input.trim());
  };

  // S18.1 — keep the ref fresh so hey-bob listeners read the latest doSend
  // (which closes over the latest messages). Without this, voice commands
  // get stale history and Nadia feels like she forgot everything.
  doSendRef.current = doSend;

  // S13 — Handle clicks on Morning Briefing action buttons. Each item has
  // an action_type like "open_ticket", "open_customer", etc. We dispatch
  // the appropriate window event so the main page (page.jsx) can react.
  var handleBriefingAction = function(item) {
    if (!item || !item.action_type) return;
    try { console.log('[briefing] action', item.action_type, item.action_payload); } catch (e) {}
    var p = item.action_payload || {};
    var eventName = null;
    var eventDetail = p;
    switch (item.action_type) {
      case 'open_ticket':
        eventName = 'briefing-open-ticket';
        break;
      case 'open_customer':
        eventName = 'briefing-open-customer';
        break;
      case 'open_check':
        eventName = 'briefing-open-check';
        break;
      case 'open_calendar':
        eventName = 'briefing-open-calendar';
        break;
      case 'open_crm':
        eventName = 'briefing-open-crm';
        break;
      case 'draft_collection_message':
        // Auto-prompt Nadia to draft the chase message
        var promptText = useLang === 'ar'
          ? 'اكتب لي رسالة متابعة دفع لـ ' + (p.customer_name || 'العميل') + ' المبلغ المستحق ' + (p.owed || 0) + ' جنيه'
          : 'Draft a polite payment follow-up message to ' + (p.customer_name || 'this customer') + ' for the outstanding ' + (p.owed || 0) + ' EGP on order ' + (p.order_number || '');
        setInput(promptText);
        setTimeout(function() { doSend(promptText); }, 100);
        return;
      default:
        eventName = null;
    }
    if (eventName) {
      try { window.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail })); } catch (e) {}
    }
  };

  if (!enabled) return null;

  if (minimized) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <button onClick={function() { setMinimized(false); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-xs font-bold text-white transition hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, ' + uiColor + ', ' + uiColor + 'aa)' }}>
          <span className="text-base">{persona.label.substring(0, 2)}</span>
          <span>Nadia AI</span>
          {speaking && <span className="flex gap-0.5 ml-1">{[0,1,2].map(function(i) { return <span key={i} className="w-1 bg-white/80 rounded-full animate-pulse" style={{ height: 6 + i * 3, animationDelay: i * 100 + 'ms' }} />; })}</span>}
        </button>
        <button onClick={function() { stopSpeech(); if (onToggle) onToggle(false); }}
          className="px-3 py-2 rounded-full bg-white/10 text-slate-500 text-[10px] font-semibold hover:bg-white/20">Turn Off</button>
      </div>
    );
  }

  var lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  var showTypingAnim = lastMsg && lastMsg.role === 'assistant' && !typingDone;
  var containerRef = useRef(null);

  return (
    <div ref={containerRef} className="mt-8 mb-4 rounded-2xl overflow-hidden shadow-2xl scroll-mt-32" style={{ border: '2px solid ' + uiColor + '30', background: 'linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,27,75,0.97))' }}>
      {/* Header
          v55.73 — Persona-aware header. Nadia keeps her existing animated
          NadiaFace SVG (with all its lip-sync logic). Jenna and Sara show
          their photo with a speaking-state ring. The voice/listening/
          recording engine below is unchanged — only the visual header swaps. */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: uiColor + '18', borderBottom: '1px solid ' + uiColor + '25' }}>
        {activeAgentKey === 'nadia' ? (
          <NadiaFace
            speaking={speaking}
            listening={listening}
            loading={loading}
            color={uiColor}
            size={56}
            audioElement={currentAudio}
            lang={useLang}
          />
        ) : (
          // v55.78 — Gap #3 — Audio-reactive PortraitAvatar replaces the
          // static-photo + ring treatment that Jenna and Sara had before.
          // Now both pulse with their actual voice, just like NadiaFace's
          // lip sync. Photo subtly scales with audio amplitude, concentric
          // rings ripple outward, listening shows a red breathing ring,
          // loading shows thinking dots beneath. Same component for both
          // — colors come from the active persona's palette.
          <PortraitAvatar
            photo={activeAgent.photo}
            alt={activeAgent.name}
            speaking={speaking}
            listening={listening}
            loading={loading}
            color={uiColor}
            size={56}
            audioElement={currentAudio}
          />
        )}
        <div className="flex-1">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            {activeAgent.name}
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15 text-white/80">{activeAgent.role}</span>
            {speaking && <span className="flex items-end gap-0.5 h-4">{[0,1,2,3,4].map(function(i) { return <span key={i} className="w-0.5 rounded-full bg-emerald-400" style={{ height: 4 + Math.random() * 12, animation: 'pulse 0.6s infinite', animationDelay: i * 80 + 'ms' }} />; })}</span>}
            {listening && <span className="px-2 py-0.5 rounded-full bg-red-500 text-[8px] font-bold animate-pulse">● LISTENING</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {speaking && <button onClick={function() { try { stopSpeech(); } catch (e) {} }} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/40 text-xs" title="Stop speaking">⏹</button>}
          <button onClick={function() { try { setMinimized(true); } catch (e) {} }} className="p-1.5 rounded-lg bg-white/8 text-white/50 hover:bg-white/15 text-xs" title="Minimize">▬</button>
          <button onClick={function() { try { stopSpeech(); } catch (e) {} try { stopListen(); } catch (e) {} try { if (onToggle) onToggle(false); } catch (e) {} }} className="p-1.5 rounded-lg bg-white/8 text-white/50 hover:bg-white/15 text-xs" title="Turn off">✕</button>
        </div>
      </div>

      {/* Chat */}
      <div className="px-4 py-3 max-h-[220px] overflow-y-auto" style={{ minHeight: 50 }}>
        {messages.slice(0, -1).map(function(m, i) {
          // Record-error messages get loud red styling so they can't be missed.
          if (m.isRecordError) {
            return (
              <div key={i} className="mb-3 flex flex-col items-start">
                <div className="max-w-[92%] px-3 py-2.5 rounded-xl text-xs leading-relaxed border-2 border-red-500"
                  style={{ background: 'rgba(220, 38, 38, 0.15)', color: '#fecaca', direction: useLang === 'ar' ? 'rtl' : 'ltr', whiteSpace: 'pre-wrap' }}>
                  {m.text}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={'mb-2 flex flex-col ' + (m.role === 'user' ? 'items-end' : 'items-start')}>
              {/* S13 — Morning briefing card renders BEFORE the chat bubble so user
                  sees the structured priority list first, then Nadia's friendly
                  acknowledgment beneath. */}
              {m.briefing && m.role === 'assistant' && (
                <div className="w-full max-w-[95%]">
                  <MorningBriefing briefing={m.briefing} onAction={handleBriefingAction} useLang={useLang} />
                </div>
              )}
              <div className={'max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed ' + (m.role === 'user' ? 'bg-blue-500 text-white rounded-br-sm' : 'text-slate-200 rounded-bl-sm')}
                style={m.role !== 'user' ? { background: uiColor + '20', direction: useLang === 'ar' ? 'rtl' : 'ltr' } : {}}>
                {m.text}
              </div>
              {m.decision && renderDecisionPanel(m.decision, i, useLang)}
            </div>
          );
        })}
        {lastMsg && lastMsg.role === 'assistant' && (
          lastMsg.isRecordError ? (
            <div className="mb-3 flex flex-col items-start">
              <div className="max-w-[92%] px-3 py-2.5 rounded-xl text-xs leading-relaxed border-2 border-red-500"
                style={{ background: 'rgba(220, 38, 38, 0.15)', color: '#fecaca', direction: useLang === 'ar' ? 'rtl' : 'ltr', whiteSpace: 'pre-wrap' }}>
                {lastMsg.text}
              </div>
            </div>
          ) : (
            <div className="mb-2 flex flex-col items-start">
              {/* S13 — also render briefing on the in-progress (last) message */}
              {lastMsg.briefing && (
                <div className="w-full max-w-[95%]">
                  <MorningBriefing briefing={lastMsg.briefing} onAction={handleBriefingAction} useLang={useLang} />
                </div>
              )}
              <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-xs leading-relaxed text-slate-200"
                style={{ background: uiColor + '20', direction: useLang === 'ar' ? 'rtl' : 'ltr' }}>
                {showTypingAnim ? typingText : lastMsg.text}
                {showTypingAnim && <span className="inline-block w-0.5 h-3 bg-white/60 ml-0.5 animate-pulse" />}
              </div>
              {!showTypingAnim && lastMsg.decision && renderDecisionPanel(lastMsg.decision, -1, useLang)}
            </div>
          )
        )}
        {lastMsg && lastMsg.role === 'user' && (
          <div className="mb-2 flex justify-end">
            <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-sm bg-blue-500 text-white text-xs">{lastMsg.text}</div>
          </div>
        )}
        {loading && (
          <div className="flex justify-start mb-2">
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm flex items-center gap-1.5" style={{ background: uiColor + '20' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3">
        {/* Floating STOP SPEAKING bar — big and obvious while the active
            assistant is talking. Tapping it (or the mic) interrupts her
            immediately.
            S22.13 — tapping this ALSO enters "paused" mode: she stays silent
            until the user engages her (type, tap mic, say "Hey Nadia").
            v55.82-S — label now uses the ACTIVE assistant's name (Nadia /
            Jenna / Sara) instead of always saying "Nadia". When Jenna or
            Sara is the active speaker, "Tap to stop Jenna" / "Tap to stop
            Sara" reads correctly. */}
        {speaking && (function () {
          var stopAssistantName = activeAgentKey === 'jenna' ? 'Jenna'
            : activeAgentKey === 'sara' ? 'Sara'
            : 'Nadia';
          var stopAssistantNameAr = activeAgentKey === 'jenna' ? 'جينا'
            : activeAgentKey === 'sara' ? 'سارة'
            : 'ناديا';
          return (
            <button
              onClick={stopSpeech}
              className="w-full mb-2 px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg animate-pulse"
              title={'Stop ' + stopAssistantName + ' from speaking (she stays quiet until you engage her)'}
            >
              <span>⏹</span>
              <span>{useLang === 'ar' ? ('إيقاف ' + stopAssistantNameAr) : ('Tap to stop ' + stopAssistantName)}</span>
            </button>
          );
        })()}
        {/* v54.2 — Autoplay-unlock banner. Browsers block audio on fresh
            page load until the user taps something. If Nadia tried to
            speak and got blocked, we show this big blue "tap to hear"
            button. One tap plays the queued audio and unlocks the rest
            of the session. */}
        {autoplayBlocked && !speaking && (
          <button
            onClick={function() {
              var queued = pendingAutoplayRef.current;
              setAutoplayBlocked(false);
              if (!queued) return;
              try {
                var audio = new Audio(queued.url);
                audioRef.current = audio;
                setCurrentAudio(audio);
                setSpeaking(true);
                audio.onended = function() { audioRef.current = null; fireStop(); };
                audio.play().catch(function() { fireStop(); });
              } catch (e) { fireStop(); }
              pendingAutoplayRef.current = null;
            }}
            className="w-full mb-2 px-3 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg animate-pulse"
            title={useLang === 'ar' ? 'اضغط لتشغيل صوت ناديا' : 'Tap to hear Nadia'}
          >
            <span>🔊</span>
            <span>{useLang === 'ar' ? 'اضغط لسماع تحية ناديا' : 'Tap to hear Nadia\'s greeting'}</span>
          </button>
        )}
        {/* v53.3 (Apr 24 2026) — ALWAYS-VISIBLE break button. Previously this
            was nested inside the paused banner so users had to first tap
            Stop, wait for the paused state, then find the 30m button. Max
            reported the button was "gone" because in practice you'd never
            see it without two extra taps. Now it's a persistent small row
            at the top of the chat input area, visible whenever Nadia is NOT
            currently speaking/listening/recording and NOT already stopped. */}
        {!speaking && !listening && !recording && !(stoppedUntil > Date.now()) && (
          <div className="flex gap-2 mb-2 text-[11px]">
            {paused ? (
              <button
                onClick={function() {
                  try { setPaused(false); pausedRef.current = false; } catch (e) {}
                }}
                className="flex-1 px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold flex items-center justify-center gap-1 border border-slate-600"
                title={useLang === 'ar' ? 'ناديا صامتة — اضغط لإيقاظها، أو اكتب رسالة، أو قل مرحبا ناديا' : 'Nadia is paused — tap to wake her, or just type/say "Hey Nadia"'}
              >
                <span>🤫</span>
                <span>{useLang === 'ar' ? 'صامتة — اضغط لإيقاظها' : 'Paused — tap to wake'}</span>
              </button>
            ) : (
              <div className="flex-1 px-2 py-1.5 text-[10px] text-slate-500 flex items-center gap-1">
                <span>💡</span>
                <span>{useLang === 'ar' ? 'اطلب منها "خذي استراحة 20 دقيقة"' : 'Say "take a 20 minute break" anytime'}</span>
              </div>
            )}
            <button
              onClick={function() { goStopped(); }}
              className="px-2 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-amber-100 font-semibold flex items-center justify-center gap-1 border border-amber-900"
              title={useLang === 'ar' ? 'إسكات تام لمدة 30 دقيقة' : 'Sleep for 30 minutes'}
            >
              <span>💤</span>
              <span>30m</span>
            </button>
          </div>
        )}
        {/* v51 — Hard-stopped banner. Shown instead of the paused banner
            during the 30-min sleep window. Counts down and gives a wake button. */}
        {stoppedUntil > Date.now() && !speaking && !listening && !recording && (function() {
          var remainingMs = stoppedUntil - Date.now();
          var remainingMin = Math.max(1, Math.ceil(remainingMs / 60000));
          return (
            <button
              onClick={wakeFromStopped}
              className="w-full mb-2 px-3 py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-red-100 text-xs font-semibold flex items-center justify-center gap-2 border border-red-800"
              title={useLang === 'ar' ? 'ناديا نائمة — اضغط لإيقاظها' : 'Nadia is sleeping — tap to wake her now'}
            >
              <span>💤</span>
              <span>
                {useLang === 'ar'
                  ? 'ناديا نائمة — ' + remainingMin + ' دقيقة متبقية (اضغط لإيقاظها)'
                  : 'Nadia is sleeping (' + remainingMin + 'm left) — tap to wake her'}
              </span>
            </button>
          );
        })()}
        {/* Listening status — big obvious STOP & SEND button. Users were missing
            the small mic-icon color change so they'd wait endlessly. Now it's
            a full-width red button with live mic animation + accumulated text. */}
        {listening && (
          <button onClick={stopListen}
            className="w-full mb-2 px-3 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold flex items-center gap-2 shadow-lg animate-pulse"
            title={useLang === 'ar' ? 'اضغط لإنهاء التسجيل وإرسال' : 'Tap to stop recording and send'}>
            <span className="flex items-end gap-0.5 h-4 flex-shrink-0">
              {[0,1,2,3,4].map(function(i) { return <span key={i} className="w-1 rounded-full bg-white" style={{ height: 3 + Math.random() * 12, animation: 'pulse 0.5s infinite', animationDelay: i * 60 + 'ms' }} />; })}
            </span>
            <span className="flex-1 text-left truncate">
              {input
                ? '🎤 ' + input.substring(0, 60) + (input.length > 60 ? '…' : '')
                : (useLang === 'ar' ? '🎤 أستمع… تحدث' : '🎤 Recording… speak now')}
            </span>
            <span className="flex-shrink-0 text-[11px] bg-white/20 rounded px-2 py-0.5">
              {useLang === 'ar' ? 'إيقاف وإرسال ⏹' : 'STOP & SEND ⏹'}
            </span>
          </button>
        )}
        {/* RECORDING banner — shown while MediaRecorder is active. Tapping
            anywhere stops the recording, uploads to Whisper, and sends the
            transcript to Nadia. Completely separate from the live-mic path. */}
        {recording && (
          <button onClick={stopRecording}
            className="w-full mb-2 px-3 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold flex items-center gap-3 shadow-lg animate-pulse"
            title={useLang === 'ar' ? 'اضغط لإنهاء التسجيل والإرسال إلى ناديا' : 'Tap to stop recording and send to Nadia'}>
            <span className="flex items-end gap-0.5 h-5 flex-shrink-0">
              {[0,1,2,3,4,5].map(function(i) { return <span key={i} className="w-1 rounded-full bg-white" style={{ height: 4 + Math.random() * 14, animation: 'pulse 0.5s infinite', animationDelay: i * 60 + 'ms' }} />; })}
            </span>
            <span className="flex-1 text-left">
              <span>🎙️ </span>
              <span>{useLang === 'ar' ? 'تسجيل…' : 'Recording…'}</span>
              <span className="ml-2 font-mono text-[13px] opacity-90">
                {String(Math.floor(recordElapsed / 60)).padStart(2, '0') + ':' + String(recordElapsed % 60).padStart(2, '0')}
              </span>
            </span>
            <span className="flex-shrink-0 text-[11px] bg-white/20 rounded px-2 py-1 font-bold">
              {useLang === 'ar' ? 'إيقاف وإرسال ⏹' : 'STOP & SEND ⏹'}
            </span>
          </button>
        )}
        {/* TRANSCRIBING banner — shown while the audio uploads to Whisper. */}
        {transcribing && (
          <div className="w-full mb-2 px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/40 text-blue-100 text-sm font-semibold flex items-center gap-2">
            <span className="animate-spin">⏳</span>
            <span>{useLang === 'ar' ? 'جار التفريغ النصي…' : 'Transcribing…'}</span>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl px-3 py-1.5" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {/* v55.43 — VOICE INPUT BUTTONS — RESTORED.
              Two clean modes, no Hey-Nadia wake word, no always-on mic:

              🎙️ Press-to-record: tap to start, tap to stop. Audio uploads
              to /api/transcribe (Whisper), transcript becomes a chat
              message and is sent to Nadia. Like ChatGPT's keyboard mic.

              🗣️ Voice conversation: tap to start a hands-free back-and-forth.
              Records → transcribes → Nadia responds with voice → records
              again automatically. Tap again to stop. Like ChatGPT's
              advanced voice mode. Set voiceConversationMode=true so the
              auto-listen kicks in after each Nadia reply.
          */}
          <button
            onClick={toggleRecording}
            disabled={transcribing || conversationMode}
            className={'p-2 rounded-lg text-sm transition ' + (recording ? 'bg-rose-600 text-white animate-pulse' : 'text-white/60 hover:text-white hover:bg-white/10') + ((transcribing || conversationMode) ? ' opacity-30 cursor-not-allowed' : '')}
            title={recording ? (useLang === 'ar' ? 'إيقاف وإرسال' : 'Tap to stop & send') : (useLang === 'ar' ? 'تسجيل صوتي' : 'Record voice message')}
            aria-label="Voice record"
          >
            🎙️
          </button>
          <button
            onClick={toggleConversationMode}
            disabled={recording || transcribing}
            className={'p-2 rounded-lg text-sm transition ' + (conversationMode ? 'bg-emerald-500 text-white animate-pulse' : 'text-white/60 hover:text-white hover:bg-white/10') + ((recording || transcribing) ? ' opacity-30 cursor-not-allowed' : '')}
            title={conversationMode ? (useLang === 'ar' ? 'إنهاء المحادثة الصوتية' : 'End voice conversation') : (useLang === 'ar' ? 'محادثة صوتية مع ناديا' : 'Start voice conversation')}
            aria-label="Voice conversation"
          >
            🗣️
          </button>
          <input value={input}
            onChange={function(e) {
              setInput(e.target.value);
              // v51.2 — flag user-typing so VoiceController's follow-up mode
              // doesn't auto-send a spoken clarifier while the user is still
              // finishing a typed message.
              try { window.__nadiaUserTyping = !!e.target.value; } catch (_) {}
            }}
            onFocus={function() {
              try { window.__nadiaUserTyping = !!input; } catch (_) {}
            }}
            onBlur={function() {
              // Small delay before clearing so the keydown handler still sees
              // the typing flag when Enter is pressed.
              try { setTimeout(function() { window.__nadiaUserTyping = false; }, 200); } catch (_) {}
            }}
            onKeyDown={function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder={useLang === 'ar' ? 'اكتب أو تحدث...' : ('Type or speak to ' + (activeAgent && activeAgent.name ? activeAgent.name : 'Nadia') + '...')}
            className="flex-1 bg-transparent text-white text-xs outline-none placeholder-white/25"
            style={{ direction: useLang === 'ar' ? 'rtl' : 'ltr' }}
            disabled={loading} />
          <button onClick={handleSubmit} disabled={loading || !input.trim()}
            className="p-2 rounded-lg text-sm transition text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-20">
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
