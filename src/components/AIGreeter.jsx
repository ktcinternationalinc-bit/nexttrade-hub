'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { todayET, etGreetingWord, cmpETDays } from '../lib/et-time';
import NadiaFace from './NadiaFace';

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
            return <div key={i} className="text-[10px] text-slate-400 mb-0.5">{r}</div>;
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

export default function AIGreeter({ user, userProfile, users, tickets, invoices, treasury, checks, loginHistory, loginHistoryLoaded, lang, personality, greeterLang, onToggle, toast, enabled, hasGreeted, onGreeted, sessionMessages, onMessagesUpdate }) {
  // Use parent's session messages — persist across tab switches
  var messages = sessionMessages || [];
  var setMessages = function(msgs) { if (onMessagesUpdate) onMessagesUpdate(msgs); };
  
  var [input, setInput] = useState('');
  var [loading, setLoading] = useState(false);
  var [speaking, setSpeaking] = useState(false);
  var [listening, setListening] = useState(false);
  var [recording, setRecording] = useState(false); // MediaRecorder session (separate from live-mic `listening`)
  var [transcribing, setTranscribing] = useState(false); // uploading audio to /api/transcribe
  var [minimized, setMinimized] = useState(false);
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
  // S10 2026-04-22 — backup transcription path. While the user is recording,
  // we ALSO run the browser's built-in speech recognition in parallel. If
  // Whisper fails (missing API key, network issue, etc.) we still have the
  // user's words and can proceed. This is why the Record button now works
  // even if OPENAI_API_KEY is never added to Vercel.
  var recordBackupRecogRef = useRef(null);
  var recordBackupTextRef = useRef('');
  var [aiMemory, setAiMemory] = useState('');

  var myId = userProfile?.id || user?.id;
  var fullName = userProfile?.name || 'there';
  var firstName = fullName.split(' ')[0] || fullName;
  var useLang = greeterLang || lang || 'en';
  var persona = PERSONALITIES.find(function(p) { return p.id === personality; }) || PERSONALITIES[1];

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
    ctx += 'Time: Good ' + timeGreeting + ', ' + todayStr + '\n';
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
    return ctx;
  }, [myId, firstName, fullName, userProfile, tickets, invoices, treasury, checks, loginHistory]);

  var sysPrompt = persona.prompt + '\n'
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
    var t = setTimeout(function() {
      if (onGreeted) onGreeted();
      doSend(null, true);
    }, 1200);
    return function() { clearTimeout(t); };
  }, [enabled, loginHistoryLoaded, hasGreeted]);

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
    setSpeaking(true);
    try { window.dispatchEvent(new CustomEvent('nadia-tts-start')); } catch (e) {}
    var fireStop = function() {
      setSpeaking(false);
      setCurrentAudio(null);
      try { window.dispatchEvent(new CustomEvent('nadia-tts-stop')); } catch (e) {}
    };
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, language: useLang })
    }).then(function(res) {
      if (!res.ok) throw new Error('TTS failed');
      return res.blob();
    }).then(function(blob) {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      // CORS: objectURL blob is same-origin so no crossOrigin flag needed
      audioRef.current = audio;
      setCurrentAudio(audio);
      audio.onended = function() { audioRef.current = null; fireStop(); };
      audio.play().catch(function() { doFallbackSpeak(text); });
    }).catch(function() { doFallbackSpeak(text); });
  }, [useLang]);

  var doFallbackSpeak = function(text) {
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
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
    setCurrentAudio(null);
    try { window.dispatchEvent(new CustomEvent('nadia-tts-stop')); } catch (e) {}
  };

  // Listen for global Hey-Bob commands + barge-in events from VoiceController.
  // This replaces the old broken per-component mic code. Now the mic runs
  // globally and any page can receive voice commands.
  useEffect(function() {
    var onBobCommand = function(ev) {
      if (!enabled) return;
      var cmd = ev && ev.detail && ev.detail.command;
      if (!cmd) return;
      // If we were speaking, stop first (polite handoff)
      stopSpeech();
      // Dispatch the command as if the user typed it
      doSend(cmd, false);
    };
    var onBargeIn = function() { stopSpeech(); };
    // Some decision chips are "ask me more" — they dispatch nadia-push-question
    // to route a follow-up query back into this greeter.
    var onPushQuestion = function(ev) {
      var q = ev && ev.detail && ev.detail.question;
      if (!q) return;
      stopSpeech();
      doSend(q, false);
    };
    window.addEventListener('hey-bob-command', onBobCommand);
    window.addEventListener('hey-bob-bargein', onBargeIn);
    window.addEventListener('nadia-push-question', onPushQuestion);
    return function() {
      window.removeEventListener('hey-bob-command', onBobCommand);
      window.removeEventListener('hey-bob-bargein', onBargeIn);
      window.removeEventListener('nadia-push-question', onPushQuestion);
    };
  }, [enabled]);

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
        setInput((finalText + interim).trim());
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
        try { console.log('[record] posting to /api/transcribe'); } catch (e) {}
        var r = await fetch('/api/transcribe', { method: 'POST', body: form });
        var data = null;
        try { data = await r.json(); } catch (parseErr) { data = { error: 'Server returned invalid JSON (status ' + r.status + ')' }; }
        if (!r.ok || (data && data.error)) {
          whisperError = (data && data.error) || ('HTTP ' + r.status);
          try { console.warn('[record] Whisper failed:', whisperError); } catch (e) {}
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
        title = useLang === 'ar' ? 'خدمة التفريغ النصي غير مفعّلة وفشل النسخ الاحتياطي أيضًا' : 'Transcription service not set up and browser backup came back empty';
        detail = useLang === 'ar'
          ? 'اضغط وتحدث مباشرة بجوار الميكروفون، ثم اضغط إيقاف. إذا استمرت المشكلة، راجع إعدادات الميكروفون.'
          : 'The premium transcription (Whisper) has not been configured in Vercel (needs OPENAI_API_KEY), AND the browser backup did not pick up any speech. Speak clearly and close to the mic, then tap stop. If it keeps happening, check your microphone.';
      } else if (whisperError) {
        title = useLang === 'ar' ? 'لم يتمكن من التعرف على أي كلام' : 'Could not transcribe anything';
        detail = useLang === 'ar'
          ? ('سبب الفشل: ' + whisperError + '. حاول التحدث بوضوح أقرب إلى الميكروفون.')
          : ('Whisper error: ' + whisperError + '. The browser backup also came back empty — please speak closer to the mic and try again.');
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
          // Auto-restart while still recording — same trick as the live mic.
          if (recording && recordBackupRecogRef.current === br) {
            try { br.start(); } catch (restartErr) { /* ignore */ }
          }
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
    var ctx = buildContext();
    var msgs = isGreeting ? [] : [].concat(messages);
    if (userText) { msgs.push({ role: 'user', text: userText }); setMessages(msgs); setInput(''); }
    setLoading(true);
    try {
      var hist = msgs.map(function(m) { return { role: m.role === 'user' ? 'user' : 'assistant', text: m.text }; });
      var q = isGreeting ? ctx + '\nGreet ' + firstName + ' personally based on the LOGIN HISTORY above. Tell them what needs attention. Be natural, warm, and personal.' : (userText || '');

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
      var payload = useV2
        ? { question: q, history: isGreeting ? [] : hist.slice(-8), userId: (userProfile && userProfile.id) || null }
        : { question: q, mode: 'greeter', systemOverride: sysPrompt + '\n' + ctx, history: isGreeting ? [] : hist.slice(-8), userId: (userProfile && userProfile.id) || null };

      var res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      var aiText = data.answer || '';
      if (!aiText) aiText = useLang === 'ar' ? 'صباح الخير ' + firstName + '!' : 'Hey ' + firstName + '!';

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
      var final = [].concat(msgs, [assistantMsg]);
      setMessages(final);
      saveMemory(final);
      doSpeak(aiText);
      doType(aiText, null);
    } catch(e) {
      var fb = useLang === 'ar' ? 'عذراً، حدث خطأ.' : 'Sorry, something went wrong.';
      setMessages([].concat(msgs, [{ role: 'assistant', text: fb }]));
      doType(fb, null);
    }
    setLoading(false);
  };

  var handleSubmit = function() { if (!input.trim()) return; stopSpeech(); doSend(input.trim()); };

  if (!enabled) return null;

  if (minimized) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <button onClick={function() { setMinimized(false); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-xs font-bold text-white transition hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, ' + persona.color + ', ' + persona.color + 'aa)' }}>
          <span className="text-base">{persona.label.substring(0, 2)}</span>
          <span>Nadia AI</span>
          {speaking && <span className="flex gap-0.5 ml-1">{[0,1,2].map(function(i) { return <span key={i} className="w-1 bg-white/80 rounded-full animate-pulse" style={{ height: 6 + i * 3, animationDelay: i * 100 + 'ms' }} />; })}</span>}
        </button>
        <button onClick={function() { stopSpeech(); if (onToggle) onToggle(false); }}
          className="px-3 py-2 rounded-full bg-white/10 text-slate-400 text-[10px] font-semibold hover:bg-white/20">Turn Off</button>
      </div>
    );
  }

  var lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  var showTypingAnim = lastMsg && lastMsg.role === 'assistant' && !typingDone;
  var containerRef = useRef(null);

  return (
    <div ref={containerRef} className="mt-8 mb-4 rounded-2xl overflow-hidden shadow-2xl scroll-mt-32" style={{ border: '2px solid ' + persona.color + '30', background: 'linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,27,75,0.97))' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: persona.color + '18', borderBottom: '1px solid ' + persona.color + '25' }}>
        <NadiaFace
          speaking={speaking}
          listening={listening}
          loading={loading}
          color={persona.color}
          size={56}
          audioElement={currentAudio}
          lang={useLang}
        />
        <div className="flex-1">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            Nadia
            {speaking && <span className="flex items-end gap-0.5 h-4">{[0,1,2,3,4].map(function(i) { return <span key={i} className="w-0.5 rounded-full bg-emerald-400" style={{ height: 4 + Math.random() * 12, animation: 'pulse 0.6s infinite', animationDelay: i * 80 + 'ms' }} />; })}</span>}
            {listening && <span className="px-2 py-0.5 rounded-full bg-red-500 text-[8px] font-bold animate-pulse">● LISTENING</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {speaking && <button onClick={stopSpeech} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/40 text-xs" title="Stop speaking">⏹</button>}
          <button onClick={function() { setMinimized(true); }} className="p-1.5 rounded-lg bg-white/8 text-white/50 hover:bg-white/15 text-xs" title="Minimize">▬</button>
          <button onClick={function() { stopSpeech(); stopListen(); if (onToggle) onToggle(false); }} className="p-1.5 rounded-lg bg-white/8 text-white/50 hover:bg-white/15 text-xs" title="Turn off">✕</button>
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
              <div className={'max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed ' + (m.role === 'user' ? 'bg-blue-500 text-white rounded-br-sm' : 'text-slate-200 rounded-bl-sm')}
                style={m.role !== 'user' ? { background: persona.color + '20', direction: useLang === 'ar' ? 'rtl' : 'ltr' } : {}}>
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
              <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-xs leading-relaxed text-slate-200"
                style={{ background: persona.color + '20', direction: useLang === 'ar' ? 'rtl' : 'ltr' }}>
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
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm flex items-center gap-1.5" style={{ background: persona.color + '20' }}>
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
        {/* Floating STOP SPEAKING bar — big and obvious while Nadia is talking.
            Tapping it (or the mic) interrupts her immediately. */}
        {speaking && (
          <button
            onClick={stopSpeech}
            className="w-full mb-2 px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg animate-pulse"
            title="Stop Nadia from speaking"
          >
            <span>⏹</span>
            <span>{useLang === 'ar' ? 'إيقاف المساعد' : 'Tap to stop Nadia'}</span>
          </button>
        )}
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
          <button
            onClick={function() {
              // Mic button doubles as barge-in: if Nadia is speaking, the first tap stops her
              // AND starts listening, so the user doesn't have to tap twice.
              if (speaking) { try { stopSpeech(); } catch (e) {} }
              if (listening) stopListen(); else startListen();
            }}
            className={'p-2 rounded-lg text-sm transition ' + (listening ? 'bg-red-500 text-white animate-pulse' : 'text-white/50 hover:text-white hover:bg-white/10')}
            title={listening ? (useLang === 'ar' ? 'إنهاء الاستماع' : 'Tap to stop & send') : (useLang === 'ar' ? 'تحدث (مايك مباشر)' : 'Live mic (quick questions)')}
          >
            🎤
          </button>
          {/* NEW — press to record, press to stop. Uses MediaRecorder + Whisper.
              Reliable alternative to the live mic for dictation. */}
          <button
            onClick={toggleRecording}
            disabled={transcribing}
            className={'p-2 rounded-lg text-sm transition ' + (recording ? 'bg-rose-600 text-white animate-pulse' : 'text-white/50 hover:text-white hover:bg-white/10') + (transcribing ? ' opacity-40 cursor-not-allowed' : '')}
            title={recording ? (useLang === 'ar' ? 'إيقاف التسجيل وإرسال' : 'Tap to stop & send to Nadia') : (useLang === 'ar' ? 'تسجيل صوتي — يفرّغ النص ثم يُرسل' : 'Record → transcribe → send (record as long as you like)')}
          >
            🎙️
          </button>
          <input value={input} onChange={function(e) { setInput(e.target.value); }}
            onKeyDown={function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder={useLang === 'ar' ? 'اكتب أو تحدث...' : 'Type or speak to Nadia...'}
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
