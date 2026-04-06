'use client';
import { useState, useRef, useEffect } from 'react';

export default function AIAssistant({ user, onAction }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      setVoiceSupported(true);
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US'; // Will also pick up Arabic in most browsers
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
        // Auto-send on final result
        if (event.results[event.results.length - 1].isFinal) {
          setTimeout(() => {
            setListening(false);
          }, 300);
        }
      };
      recognition.onerror = (e) => { console.log('Speech error:', e.error); setListening(false); };
      recognition.onend = () => { setListening(false); };
      recognitionRef.current = recognition;
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      setInput('');
      recognitionRef.current.start();
      setListening(true);
    }
  };

  const askQuestion = async (overrideText) => {
    const question = (overrideText || input).trim();
    if (!question || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setLoading(true);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          context: 'You are a voice-activated AI assistant for KTC Trading Operations. You can help with: creating tickets, answering questions about sales/treasury/inventory data, checking customer info, and general business queries. If the user asks to create a ticket, respond with the ticket details in a structured way. Be concise and helpful. Respond in the same language the user speaks.',
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        setMessages(prev => [...prev, { role: 'ai', text: 'API Error (' + res.status + '): ' + errText }]);
      } else {
        const data = await res.json();
        const answer = data.answer || data.error || 'No response — check API key in Vercel';
        setMessages(prev => [...prev, { role: 'ai', text: answer }]);
        // Text-to-speech response
        if ('speechSynthesis' in window && answer.length < 500) {
          const utterance = new SpeechSynthesisUtterance(answer);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Connection Error: ' + err.message }]);
    }
    setLoading(false);
  };

  const suggestions = [
    'Who owes us the most? / من يدين لنا أكثر؟',
    'What were total sales this year? / إجمالي المبيعات',
    'How many open tickets? / كم تذكرة مفتوحة؟',
    'Show me cash flow summary / ملخص التدفق النقدي',
    'Which customers are important? / العملاء المهمون',
    'Create a ticket for... / أنشئ تذكرة لـ...',
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-extrabold">🤖 AI Assistant / مساعد ذكي</h2>
        <div className="flex gap-2">
          {voiceSupported && (
            <div className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (listening ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700')}>
              {listening ? '🔴 Listening...' : '🎤 Voice Ready'}
            </div>
          )}
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); window.speechSynthesis?.cancel(); }}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold">Clear / مسح</button>
          )}
        </div>
      </div>

      {/* Voice Command Banner */}
      {voiceSupported && messages.length === 0 && (
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl p-5 mb-3">
          <div className="flex items-center gap-3">
            <div className="text-4xl">🎙️</div>
            <div>
              <h3 className="text-lg font-bold">Voice Command Center / مركز الأوامر الصوتية</h3>
              <p className="text-sm opacity-80">Tap the microphone and speak your command / اضغط على المايكروفون وتحدث</p>
              <p className="text-xs opacity-60 mt-1">Try: "Create a high priority ticket for Ahmed to get shipping rates from Turkey" / "من يدين لنا أكثر؟"</p>
            </div>
          </div>
        </div>
      )}

      {!voiceSupported && messages.length === 0 && (
        <div className="bg-amber-50 rounded-xl p-4 mb-3 border border-amber-200">
          <p className="text-xs text-amber-700">⚠️ Voice recognition not supported in this browser. Use Chrome for voice commands. / التعرف على الصوت غير مدعوم. استخدم Chrome للأوامر الصوتية.</p>
          <p className="text-xs text-amber-600 mt-1">You can still type your questions below. / يمكنك الكتابة أدناه.</p>
        </div>
      )}

      {/* Suggestions */}
      {messages.length === 0 && (
        <div className="bg-white rounded-xl p-4 mb-3">
          <p className="text-sm font-semibold mb-3">Quick questions / أسئلة سريعة:</p>
          <div className="grid grid-cols-2 gap-2">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => askQuestion(s.split(' / ')[0])}
                className="text-left px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs text-blue-700 font-medium transition">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div className="space-y-3 mb-3 max-h-[500px] overflow-auto">
        {messages.map((m, i) => (
          <div key={i} className={`rounded-xl p-4 ${m.role === 'user' ? 'bg-blue-500 text-white ml-12' : 'bg-white border border-slate-200 mr-12'}`}>
            <div className="text-[10px] font-semibold mb-1 opacity-60">{m.role === 'user' ? '🎤 You / أنت' : '🤖 AI'}</div>
            <div className="text-sm whitespace-pre-wrap">{m.text}</div>
          </div>
        ))}
        {loading && (
          <div className="bg-white rounded-xl p-4 mr-12 border border-slate-200">
            <div className="text-[10px] font-semibold mb-1 opacity-60">🤖 AI</div>
            <div className="text-sm text-slate-400 animate-pulse">Thinking... / جاري التفكير...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input with Voice Button */}
      <div className="bg-white rounded-xl p-3 flex gap-2 border border-slate-200">
        {voiceSupported && (
          <button onClick={toggleVoice}
            className={'px-4 py-2.5 rounded-lg text-lg transition ' + (listening
              ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-200'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-600')}>
            {listening ? '⏹️' : '🎤'}
          </button>
        )}
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && askQuestion()}
          placeholder={listening ? 'Listening... / جاري الاستماع...' : 'Ask or speak... / اسأل أو تحدث...'}
          className={'flex-1 px-4 py-2.5 border rounded-lg text-sm ' + (listening ? 'border-red-300 bg-red-50' : 'border-slate-200')} />
        <button onClick={() => askQuestion()} disabled={loading || !input.trim()}
          className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition whitespace-nowrap">
          {loading ? '...' : 'Send / أرسل'}
        </button>
      </div>
    </div>
  );
}
