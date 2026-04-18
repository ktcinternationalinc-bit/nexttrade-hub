'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

var PERSONALITIES = [
  { id: 'professional', label: '🎩 Professional', labelAr: 'محترف', desc: 'Formal, concise, business-focused', color: '#1e40af', prompt: 'You are a professional executive assistant named Nadia. Speak formally, be concise and data-driven. Use business language. Be respectful and efficient.' },
  { id: 'friendly', label: '😊 Friendly', labelAr: 'ودود', desc: 'Warm, encouraging, personal', color: '#059669', prompt: 'You are a warm, friendly colleague named Nadia. Be encouraging, use casual language, add personal touches. Be supportive and caring.' },
  { id: 'motivational', label: '💪 Motivational', labelAr: 'محفز', desc: 'Energetic, pushing for results', color: '#dc2626', prompt: 'You are a high-energy motivational coach named Nadia. Be enthusiastic, push for action, celebrate wins!' },
  { id: 'military', label: '🎖️ Military', labelAr: 'عسكري', desc: 'Strict, disciplined, direct', color: '#374151', prompt: 'You are a military commander named Commander Nadia. Be strict, direct, no fluff. Use military-style language.' },
  { id: 'humorous', label: '😄 Humorous', labelAr: 'فكاهي', desc: 'Fun, witty, light-hearted', color: '#d97706', prompt: 'You are a funny, witty assistant named Nadia. Make jokes, use puns, keep things light while delivering info.' },
  { id: 'calm', label: '🧘 Calm', labelAr: 'هادئ', desc: 'Gentle, zen, stress-free', color: '#7c3aed', prompt: 'You are a calm, zen-like advisor named Nadia. Speak gently, reduce stress, frame tasks as manageable steps.' },
];

export { PERSONALITIES };

export default function AIGreeter({ user, userProfile, users, tickets, invoices, treasury, checks, lang, personality, greeterLang, onToggle, toast, enabled }) {
  var [messages, setMessages] = useState([]);
  var [input, setInput] = useState('');
  var [loading, setLoading] = useState(false);
  var [speaking, setSpeaking] = useState(false);
  var [listening, setListening] = useState(false);
  var [minimized, setMinimized] = useState(false);
  var [typingText, setTypingText] = useState('');
  var [typingDone, setTypingDone] = useState(true);
  var hasGreetedRef = useRef(false);
  var chatEndRef = useRef(null);
  var typingRef = useRef(null);
  var audioRef = useRef(null);
  var recognitionRef = useRef(null);

  var myId = userProfile?.id || user?.id;
  var myName = userProfile?.name || 'there';
  var useLang = greeterLang || lang || 'en';
  var persona = PERSONALITIES.find(function(p) { return p.id === personality; }) || PERSONALITIES[1];

  var buildContext = useCallback(function() {
    var todayStr = new Date().toISOString().substring(0, 10);
    var hour = new Date().getHours();
    var timeGreeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    var myTickets = (tickets || []).filter(function(t) { return t.assigned_to === myId && t.status !== 'Closed'; });
    var overdueTickets = myTickets.filter(function(t) { return t.due_date && t.due_date < todayStr; });
    var newTickets = myTickets.filter(function(t) { return t.status === 'New'; });
    var overdueInvoices = (invoices || []).filter(function(i) { return Number(i.outstanding || 0) > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000; });
    var pendingChecks = (checks || []).filter(function(c) { return c.status === 'pending' && c.due_date && c.due_date <= todayStr; });

    var ctx = 'BUSINESS CONTEXT:\n';
    ctx += 'User: ' + myName + ' (' + (userProfile?.role || 'team') + ')\n';
    ctx += 'Good ' + timeGreeting + ', ' + todayStr + '\n';
    ctx += 'Open tickets: ' + myTickets.length;
    if (newTickets.length) ctx += ' (' + newTickets.length + ' NEW)';
    if (overdueTickets.length) ctx += ' (' + overdueTickets.length + ' OVERDUE: ' + overdueTickets.map(function(t) { return t.ticket_number; }).join(', ') + ')';
    ctx += '\n';
    if (overdueInvoices.length) ctx += 'Overdue invoices: ' + overdueInvoices.length + ', EGP ' + overdueInvoices.reduce(function(a, i) { return a + Number(i.outstanding || 0); }, 0).toLocaleString() + '\n';
    if (pendingChecks.length) ctx += 'Checks due: ' + pendingChecks.length + ', EGP ' + pendingChecks.reduce(function(a, c) { return a + Number(c.amount || 0); }, 0).toLocaleString() + '\n';
    if (!myTickets.length && !overdueInvoices.length && !pendingChecks.length) ctx += 'No urgent items.\n';
    return ctx;
  }, [myId, myName, userProfile, tickets, invoices, checks]);

  var sysPrompt = persona.prompt + '\n'
    + 'You work at KTC Trading Company (Egyptian/US import-export).\n'
    + 'Language: ' + (useLang === 'ar' ? 'Arabic (Egyptian dialect)' : 'English') + ' ONLY.\n'
    + 'Keep responses SHORT: 2-4 sentences. Conversational, not robotic.\n'
    + 'No markdown. Plain text only. Address user by name sometimes.\n';

  // Auto-greet on first load
  useEffect(function() {
    if (hasGreetedRef.current || !enabled) return;
    hasGreetedRef.current = true;
    doSend(null, true);
  }, [enabled]);

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
      var q = isGreeting ? ctx + '\nGreet ' + myName + ' and tell them what needs attention today.' : (userText || '');
      var res = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, mode: 'greeter', systemOverride: sysPrompt + '\n' + ctx, history: isGreeting ? [] : hist.slice(-8) })
      });
      var data = await res.json();
      var aiText = data.answer || '';
      if (!aiText) aiText = useLang === 'ar' ? 'صباح الخير ' + myName + '!' : 'Hey ' + myName + '!';
      var final = [].concat(msgs, [{ role: 'assistant', text: aiText }]);
      setMessages(final);
      doType(aiText, function() { doSpeak(aiText); });
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

  return (
    <div className="mb-4 rounded-2xl overflow-hidden shadow-2xl" style={{ border: '2px solid ' + persona.color + '30', background: 'linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,27,75,0.97))' }}>
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
