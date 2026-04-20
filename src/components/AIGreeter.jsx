'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

var PERSONALITIES = [
  { id: 'professional', label: '🎩 Professional', labelAr: 'محترف', desc: 'Formal, concise, business-focused', color: '#1e40af', prompt: 'You are a professional executive assistant named Nadia. Speak formally, be concise and data-driven. Use business language. Be respectful and efficient.' },
  { id: 'friendly', label: '😊 Friendly', labelAr: 'ودود', desc: 'Warm, encouraging, personal', color: '#059669', prompt: 'You are a warm, friendly colleague named Nadia. Be encouraging, use casual language, add personal touches. Be supportive and caring.' },
  { id: 'motivational', label: '💪 Motivational', labelAr: 'محفز', desc: 'Energetic, pushing for results', color: '#dc2626', prompt: 'You are a high-energy motivational coach named Nadia. Be enthusiastic, push for action, celebrate wins!' },
  { id: 'military', label: '🎖️ Military', labelAr: 'عسكري', desc: 'Strict, disciplined, direct', color: '#374151', prompt: 'You are a military commander named Commander Nadia. Be strict, direct, no fluff. Use military-style language.' },
  { id: 'humorous', label: '😄 Humorous', labelAr: 'فكاهي', desc: 'Fun, witty, light-hearted', color: '#d97706', prompt: 'You are a funny, witty assistant named Nadia. Make jokes, use puns, keep things light while delivering info.' },
  { id: 'calm', label: '🧘 Calm', labelAr: 'هادئ', desc: 'Gentle, zen, stress-free', color: '#7c3aed', prompt: 'You are a calm, zen-like advisor named Nadia. Speak gently, reduce stress, frame tasks as manageable steps.' },
];

export { PERSONALITIES };

export default function AIGreeter({ user, userProfile, users, tickets, invoices, treasury, checks, loginHistory, loginHistoryLoaded, lang, personality, greeterLang, onToggle, toast, enabled, hasGreeted, onGreeted, sessionMessages, onMessagesUpdate }) {
  // Use parent's session messages — persist across tab switches
  var messages = sessionMessages || [];
  var setMessages = function(msgs) { if (onMessagesUpdate) onMessagesUpdate(msgs); };
  
  var [input, setInput] = useState('');
  var [loading, setLoading] = useState(false);
  var [speaking, setSpeaking] = useState(false);
  var [listening, setListening] = useState(false);
  var [minimized, setMinimized] = useState(false);
  var [typingText, setTypingText] = useState('');
  var [typingDone, setTypingDone] = useState(true);
  var chatEndRef = useRef(null);
  var typingRef = useRef(null);
  var audioRef = useRef(null);
  var recognitionRef = useRef(null);
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
      var todayStr = new Date().toISOString().substring(0, 10);

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
    var todayStr = new Date().toISOString().substring(0, 10);
    var hour = new Date().getHours();
    var timeGreeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    
    // Login history analysis
    var loginSessions = loginHistory || [];
    var todayLogins = loginSessions.filter(function(s) { return s.date === todayStr; });
    var visitNumberToday = todayLogins.length;
    var previousDays = loginSessions.filter(function(s) { return s.date !== todayStr; });
    var lastLoginDate = previousDays.length > 0 ? previousDays[0].date : null;
    
    // Calculate days since last login
    var daysSinceLastLogin = 0;
    if (lastLoginDate) {
      var diff = new Date(todayStr) - new Date(lastLoginDate);
      daysSinceLastLogin = Math.floor(diff / 86400000);
    }
    
    // Login streak
    var streak = 1;
    var allDates = loginSessions.map(function(s) { return s.date; }).filter(function(v, i, a) { return a.indexOf(v) === i; }).sort().reverse();
    for (var si = 1; si < allDates.length; si++) {
      var prev = new Date(allDates[si - 1]);
      var curr = new Date(allDates[si]);
      prev.setDate(prev.getDate() - 1);
      if (prev.toISOString().substring(0, 10) === allDates[si]) { streak++; } else { break; }
    }

    // Tickets
    var myTickets = (tickets || []).filter(function(t) { return t.assigned_to === myId && t.status !== 'Closed'; });
    var overdueTickets = myTickets.filter(function(t) { return t.due_date && t.due_date < todayStr; });
    var newTickets = myTickets.filter(function(t) { return t.status === 'New'; });
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
    ctx += '\nBUSINESS STATUS:\n';
    ctx += 'Open tickets: ' + myTickets.length;
    if (newTickets.length) ctx += ' (' + newTickets.length + ' NEW)';
    if (overdueTickets.length) ctx += ' (' + overdueTickets.length + ' OVERDUE: ' + overdueTickets.map(function(t) { return t.ticket_number || t.title; }).join(', ') + ')';
    ctx += '\n';
    if (staleTickets.length) ctx += 'Stale tickets (not updated 3+ days): ' + staleTickets.length + ' — ' + staleTickets.slice(0, 5).map(function(t) { return (t.ticket_number || '') + ' ' + (t.title || ''); }).join(', ') + '. Remind them to update these!\n';
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

  // Auto-greet — only once per login session, waits for login history
  useEffect(function() {
    if (hasGreeted || !enabled || !loginHistoryLoaded) return;
    if (onGreeted) onGreeted(); // Mark as greeted in parent (survives tab switches)
    doSend(null, true);
  }, [enabled, loginHistoryLoaded, hasGreeted]);

  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingText]);

  // TTS
  var doSpeak = useCallback(function(text) {
    if (!text) return;
    setSpeaking(true);
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
      audioRef.current = audio;
      audio.onended = function() { setSpeaking(false); audioRef.current = null; };
      audio.play().catch(function() { doFallbackSpeak(text); });
    }).catch(function() { doFallbackSpeak(text); });
  }, [useLang]);

  var doFallbackSpeak = function(text) {
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = useLang === 'ar' ? 'ar-EG' : 'en-US';
      u.rate = 0.95;
      u.onend = function() { setSpeaking(false); };
      window.speechSynthesis.speak(u);
    } catch(e) { setSpeaking(false); }
  };

  var stopSpeech = function() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  // Voice recognition
  var startListen = function() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { if (toast) toast.warning('Voice not supported in this browser'); return; }
    var rec = new SR();
    rec.lang = useLang === 'ar' ? 'ar-EG' : 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    recognitionRef.current = rec;
    setListening(true);
    rec.onresult = function(ev) {
      var t = '';
      for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setInput(t);
      if (ev.results[0].isFinal) { setListening(false); if (t.trim()) doSend(t.trim()); }
    };
    rec.onerror = function() { setListening(false); };
    rec.onend = function() { setListening(false); };
    rec.start();
  };

  var stopListen = function() { if (recognitionRef.current) recognitionRef.current.stop(); setListening(false); };

  // Typewriter
  var doType = function(text, cb) {
    setTypingText(''); setTypingDone(false);
    var i = 0;
    if (typingRef.current) clearInterval(typingRef.current);
    typingRef.current = setInterval(function() {
      i++;
      setTypingText(text.substring(0, i));
      if (i >= text.length) { clearInterval(typingRef.current); typingRef.current = null; setTypingDone(true); if (cb) cb(); }
    }, 20);
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
      var res = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, mode: 'greeter', systemOverride: sysPrompt + '\n' + ctx, history: isGreeting ? [] : hist.slice(-8) })
      });
      var data = await res.json();
      var aiText = data.answer || '';
      if (!aiText) aiText = useLang === 'ar' ? 'صباح الخير ' + firstName + '!' : 'Hey ' + firstName + '!';
      var final = [].concat(msgs, [{ role: 'assistant', text: aiText }]);
      setMessages(final);
      saveMemory(final); // Save conversation memory after every interaction
      // Start speech immediately in parallel with typing animation so the user
      // hears the greeting at once instead of waiting for the typing to finish.
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

  // Scroll the greeter into view when it starts loading (initial greet) or when a
  // new message begins typing — so the user sees the animation from the start
  // instead of the card being above the fold.
  useEffect(function() {
    if ((loading || showTypingAnim) && containerRef.current) {
      try { containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
    }
  }, [loading, showTypingAnim]);

  return (
    <div ref={containerRef} className="mt-6 mb-4 rounded-2xl overflow-hidden shadow-2xl scroll-mt-24" style={{ border: '2px solid ' + persona.color + '30', background: 'linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,27,75,0.97))' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: persona.color + '18', borderBottom: '1px solid ' + persona.color + '25' }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shadow-lg" style={{ background: 'linear-gradient(135deg, ' + persona.color + ', ' + persona.color + '80)' }}>
          {persona.label.substring(0, 2)}
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            Nadia
            {speaking && <span className="flex items-end gap-0.5 h-4">{[0,1,2,3,4].map(function(i) { return <span key={i} className="w-0.5 rounded-full bg-emerald-400" style={{ height: 4 + Math.random() * 12, animation: 'pulse 0.6s infinite', animationDelay: i * 80 + 'ms' }} />; })}</span>}
            {listening && <span className="px-2 py-0.5 rounded-full bg-red-500 text-[8px] font-bold animate-pulse">● LISTENING</span>}
          </div>
          <div className="text-[9px] font-medium" style={{ color: persona.color + 'cc' }}>{persona.desc} · {useLang === 'ar' ? 'عربي' : 'EN'}</div>
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
          return (
            <div key={i} className={'mb-2 flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={'max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed ' + (m.role === 'user' ? 'bg-blue-500 text-white rounded-br-sm' : 'text-slate-200 rounded-bl-sm')}
                style={m.role !== 'user' ? { background: persona.color + '20', direction: useLang === 'ar' ? 'rtl' : 'ltr' } : {}}>
                {m.text}
              </div>
            </div>
          );
        })}
        {lastMsg && lastMsg.role === 'assistant' && (
          <div className="mb-2 flex justify-start">
            <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-xs leading-relaxed text-slate-200"
              style={{ background: persona.color + '20', direction: useLang === 'ar' ? 'rtl' : 'ltr' }}>
              {showTypingAnim ? typingText : lastMsg.text}
              {showTypingAnim && <span className="inline-block w-0.5 h-3 bg-white/60 ml-0.5 animate-pulse" />}
            </div>
          </div>
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
        <div className="flex items-center gap-2 rounded-xl px-3 py-1.5" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <button onClick={function() { listening ? stopListen() : startListen(); }}
            className={'p-2 rounded-lg text-sm transition ' + (listening ? 'bg-red-500 text-white animate-pulse' : 'text-white/50 hover:text-white hover:bg-white/10')}>
            🎤
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
