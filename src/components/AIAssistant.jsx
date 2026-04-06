'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function AIAssistant({ user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      setVoiceSupported(true);
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
        if (event.results[event.results.length - 1].isFinal) {
          setTimeout(() => setListening(false), 200);
        }
      };
      recognition.onerror = () => setListening(false);
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (listening) { recognitionRef.current.stop(); setListening(false); }
    else { setInput(''); recognitionRef.current.start(); setListening(true); }
  };

  const speak = (text) => {
    if ('speechSynthesis' in window && text.length < 600) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, '').substring(0, 400));
      u.rate = 1.05; u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    }
  };

  const askQuestion = useCallback(async (overrideText) => {
    const question = (overrideText || input).trim();
    if (!question || loading) return;
    setInput('');
    const newMsg = { role: 'user', text: question };
    setMessages(prev => [...prev, newMsg]);
    setLoading(true);
    setPendingAction(null);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: [...messages, newMsg].slice(-10),
          userId: user?.id,
        }),
      });
      const data = await res.json();
      const answer = data.answer || 'No response';
      setMessages(prev => [...prev, { role: 'ai', text: answer }]);
      speak(answer);
      if (data.pending_action) setPendingAction(data.pending_action);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: '❌ Connection error: ' + err.message }]);
    }
    setLoading(false);
  }, [input, loading, messages, user]);

  const executeAction = async () => {
    if (!pendingAction) return;
    setLoading(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pendingAction, userId: user?.id }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer || 'Action completed.' }]);
      speak(data.answer || 'Done');
      setPendingAction(null);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: '❌ Action failed: ' + err.message }]);
    }
    setLoading(false);
  };

  const suggestions = [
    { text: 'Who owes us the most?', icon: '💰' },
    { text: 'What are total sales this month?', icon: '📊' },
    { text: 'How many tickets are overdue?', icon: '🎫' },
    { text: 'Show me our shipping rates from China', icon: '🚢' },
    { text: 'Which customers haven\'t been contacted?', icon: '👥' },
    { text: 'Create a ticket for the team', icon: '✏️' },
    { text: 'What are our top expenses?', icon: '💸' },
    { text: 'Give me a morning briefing', icon: '☀️' },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-extrabold">AI Secretary / مساعد تنفيذي 🤖</h2>
          <p className="text-[10px]" style={{color:'var(--text-muted)'}}>Voice commands + Business intelligence + Task execution</p>
        </div>
        <div className="flex gap-2">
          {voiceSupported && (
            <div className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (listening ? 'text-red-400' : 'text-emerald-400')}
              style={{background: listening ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)', border: '1px solid ' + (listening ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.2)')}}>
              {listening ? '🔴 Listening...' : '🎤 Voice Ready'}
            </div>
          )}
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setPendingAction(null); window.speechSynthesis?.cancel(); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary)'}}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Voice Command Banner */}
      {messages.length === 0 && (
        <div className="rounded-xl p-5 mb-4" style={{
          background: 'linear-gradient(135deg, rgba(56,189,248,0.12), rgba(167,139,250,0.12))',
          border: '1px solid rgba(56,189,248,0.2)',
        }}>
          <div className="flex items-center gap-4">
            <div className="text-5xl">{voiceSupported ? '🎙️' : '🤖'}</div>
            <div>
              <h3 className="text-lg font-bold" style={{color:'var(--accent)'}}>AI Executive Secretary</h3>
              <p className="text-sm" style={{color:'var(--text-secondary)'}}>Ask anything about your business or give commands</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{background:'rgba(56,189,248,0.15)',color:'#7dd3fc'}}>📊 Q&A</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{background:'rgba(167,139,250,0.15)',color:'#c4b5fd'}}>🎫 Create Tickets</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{background:'rgba(52,211,153,0.15)',color:'#6ee7b7'}}>📅 Schedule</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{background:'rgba(251,191,36,0.15)',color:'#fde68a'}}>⏰ Reminders</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!voiceSupported && messages.length === 0 && (
        <div className="rounded-xl p-3 mb-3" style={{background:'rgba(251,191,36,0.06)', border:'1px solid rgba(251,191,36,0.15)'}}>
          <p className="text-xs" style={{color:'#fde68a'}}>⚠️ Voice not supported in this browser. Use Chrome for voice commands. You can still type below.</p>
        </div>
      )}

      {/* Quick Suggestions */}
      {messages.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => askQuestion(s.text)}
              className="text-left px-3 py-2.5 rounded-lg text-xs font-medium transition"
              style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-secondary)'}}
              onMouseEnter={e => { e.target.style.background = 'rgba(56,189,248,0.08)'; e.target.style.borderColor = 'rgba(56,189,248,0.2)'; e.target.style.color = '#7dd3fc'; }}
              onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.04)'; e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.color = 'var(--text-secondary)'; }}>
              <span className="text-base mr-1">{s.icon}</span> {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Chat Messages */}
      <div className="space-y-3 mb-3 max-h-[500px] overflow-auto">
        {messages.map((m, i) => (
          <div key={i} className="rounded-xl p-4" style={m.role === 'user' ? {
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
            marginLeft: '3rem', color: 'white',
          } : {
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            marginRight: '1rem',
          }}>
            <div className="text-[10px] font-semibold mb-1" style={{opacity: 0.6}}>
              {m.role === 'user' ? '🎤 You' : '🤖 AI Secretary'}
            </div>
            <div className="text-sm whitespace-pre-wrap" style={{lineHeight: 1.7}}>{m.text}</div>
          </div>
        ))}

        {/* Pending Action Confirmation */}
        {pendingAction && !loading && (
          <div className="rounded-xl p-4 mx-4" style={{
            background: 'rgba(167,139,250,0.08)',
            border: '1px solid rgba(167,139,250,0.25)',
          }}>
            <div className="text-xs font-bold mb-2" style={{color:'#c4b5fd'}}>
              ⚡ Action Ready — {pendingAction.type?.replace('_', ' ').toUpperCase()}
            </div>
            <div className="text-sm mb-3" style={{color:'var(--text-secondary)'}}>
              {pendingAction.title || pendingAction.task}
              {pendingAction.priority && <span className="ml-2 text-[10px] font-bold" style={{color: pendingAction.priority === 'high' ? '#f87171' : pendingAction.priority === 'urgent' ? '#ef4444' : '#fbbf24'}}>({pendingAction.priority})</span>}
              {pendingAction.due_date && <span className="ml-2 text-[10px]" style={{color:'var(--text-muted)'}}>Due: {pendingAction.due_date}</span>}
              {pendingAction.event_date && <span className="ml-2 text-[10px]" style={{color:'var(--text-muted)'}}>{pendingAction.event_date} {pendingAction.event_time || ''}</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={executeAction}
                style={{background:'linear-gradient(135deg, #10b981, #059669)', boxShadow:'0 2px 12px rgba(52,211,153,0.3)'}}
                className="px-4 py-2 text-white rounded-lg text-xs font-bold">
                ✅ Execute / تنفيذ
              </button>
              <button onClick={() => setPendingAction(null)}
                style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary)'}}
                className="px-4 py-2 rounded-lg text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="rounded-xl p-4" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', marginRight:'1rem'}}>
            <div className="text-[10px] font-semibold mb-1" style={{opacity:0.6}}>🤖 AI Secretary</div>
            <div className="text-sm animate-pulse" style={{color:'var(--text-muted)'}}>Thinking... / جاري التفكير...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Bar */}
      <div className="rounded-xl p-3 flex gap-2" style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {voiceSupported && (
          <button onClick={toggleVoice}
            className="px-4 py-2.5 rounded-lg text-lg transition"
            style={listening ? {
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              boxShadow: '0 0 20px rgba(248,113,113,0.4)',
              color: 'white',
            } : {
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-secondary)',
            }}>
            {listening ? '⏹️' : '🎤'}
          </button>
        )}
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && askQuestion()}
          placeholder={listening ? 'Listening... / جاري الاستماع...' : 'Ask anything or give a command...'}
          className="flex-1 px-4 py-2.5 rounded-lg text-sm"
          style={{
            background: listening ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (listening ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)'),
            color: 'var(--text-primary)',
          }} />
        <button onClick={() => askQuestion()} disabled={loading || !input.trim()}
          style={{background:'linear-gradient(135deg, #0ea5e9, #6366f1)', boxShadow:'0 2px 12px rgba(56,189,248,0.3)'}}
          className="px-5 py-2.5 text-white rounded-lg text-sm font-bold disabled:opacity-40 transition whitespace-nowrap">
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
