'use client';
import { useState } from 'react';

export default function AIAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const askQuestion = async () => {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setLoading(true);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        const errText = await res.text();
        setMessages(prev => [...prev, { role: 'ai', text: 'API Error (' + res.status + '): ' + errText }]);
      } else {
        const data = await res.json();
        setMessages(prev => [...prev, { role: 'ai', text: data.answer || data.error || 'No response — check API key in Vercel' }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Connection Error: ' + err.message + '\n\nMake sure route.js is at src/app/api/ask/route.js' }]);
    }
    setLoading(false);
  };

  const suggestions = [
    'Who owes us the most? / من يدين لنا أكثر؟',
    'What were total sales this year? / إجمالي المبيعات',
    'How many open tickets? / كم تذكرة مفتوحة؟',
    'Show me cash flow summary / ملخص التدفق النقدي',
    'Which customers are important? / العملاء المهمون',
    'Top expenses this month / أعلى المصروفات',
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-extrabold">AI Assistant / مساعد ذكي 🤖</h2>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold">Clear / مسح</button>
        )}
      </div>

      {/* Suggestions */}
      {messages.length === 0 && (
        <div className="bg-white rounded-xl p-4 mb-3">
          <p className="text-sm font-semibold mb-3">Quick questions / أسئلة سريعة:</p>
          <div className="grid grid-cols-2 gap-2">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => { setInput(s.split(' / ')[0]); }}
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
            <div className="text-[10px] font-semibold mb-1 opacity-60">{m.role === 'user' ? 'You / أنت' : '🤖 AI Assistant'}</div>
            <div className="text-sm whitespace-pre-wrap">{m.text}</div>
          </div>
        ))}
        {loading && (
          <div className="bg-white rounded-xl p-4 mr-12 border border-slate-200">
            <div className="text-[10px] font-semibold mb-1 opacity-60">🤖 AI Assistant</div>
            <div className="text-sm text-slate-400 animate-pulse">Thinking... / جاري التفكير...</div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="bg-white rounded-xl p-3 flex gap-2 border border-slate-200">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && askQuestion()}
          placeholder="Ask about your data... / اسأل عن بياناتك..."
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm" />
        <button onClick={askQuestion} disabled={loading}
          className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition whitespace-nowrap">
          {loading ? '...' : 'Ask / اسأل'}
        </button>
      </div>
    </div>
  );
}
