'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function AIAssistant({ user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const pendingActionRef = useRef(null);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const autoSendRef = useRef(null);
  const inputRef = useRef('');

  // Keep refs in sync
  useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);
  useEffect(() => { inputRef.current = input; }, [input]);

  useEffect(() => {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      setVoiceSupported(true);
      var recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = function(event) {
        var transcript = '';
        for (var i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
        inputRef.current = transcript;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (autoSendRef.current) clearTimeout(autoSendRef.current);
        silenceTimerRef.current = setTimeout(function() {
          recognition.stop();
          setListening(false);
          autoSendRef.current = setTimeout(function() {
            var btn = document.getElementById('ai-send-btn');
            if (btn && inputRef.current.trim()) btn.click();
          }, 500);
        }, 3000);
      };
      recognition.onerror = function() { setListening(false); if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
      recognition.onend = function() { setListening(false); };
      recognitionRef.current = recognition;
    }
    return function() { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); if (autoSendRef.current) clearTimeout(autoSendRef.current); };
  }, []);

  useEffect(function() { if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  var toggleVoice = function() {
    if (!recognitionRef.current) return;
    // STOP AI speech immediately
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (listening) { recognitionRef.current.stop(); setListening(false); }
    else { setInput(''); inputRef.current = ''; recognitionRef.current.start(); setListening(true); }
  };

  var speak = function(text) {
    if (window.speechSynthesis && text && text.length < 600) {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, '').substring(0, 400));
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    }
  };

  var doExecuteAction = async function(actionToRun) {
    if (!actionToRun) return;
    if (actionToRun.type === 'request_quote') {
      var a = actionToRun;
      var todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      var msg = 'Dear ' + (a.vendor_contact || a.vendor_company || 'Team') + ',\n\nWe are requesting your best rates:\n\nOrigin: ' + (a.origin || '[Origin]') + '\nDestination: ' + (a.destination || 'Egypt') + '\nContainer: ' + (a.container || '40ft') + '\nCommodity: ' + (a.commodity || 'Trading materials') + (a.customer_name ? '\nClient: ' + a.customer_name : '') + '\n\nPlease include freight rate, transit time, free days, fees, and validity.\n\nBest regards,\nKTC International\n' + todayStr;
      var subj = 'Rate Request - ' + (a.origin || '') + ' to ' + (a.destination || 'Egypt') + ' - KTC';
      if (a.send_via === 'email' && a.vendor_email) {
        window.open('mailto:' + a.vendor_email + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(msg));
        setMessages(function(prev) { return prev.concat([{ role: 'ai', text: 'Email opened for ' + a.vendor_company }]); });
      } else if (a.vendor_whatsapp) {
        var cl = (a.vendor_whatsapp || '').replace(/[^0-9+]/g, '');
        if (!cl.startsWith('+')) cl = '+' + cl;
        window.open('https://wa.me/' + cl.replace('+', '') + '?text=' + encodeURIComponent(msg));
        setMessages(function(prev) { return prev.concat([{ role: 'ai', text: 'WhatsApp opened for ' + a.vendor_company }]); });
      } else if (a.vendor_email) {
        window.open('mailto:' + a.vendor_email + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(msg));
        setMessages(function(prev) { return prev.concat([{ role: 'ai', text: 'Email opened for ' + a.vendor_company }]); });
      } else {
        setMessages(function(prev) { return prev.concat([{ role: 'ai', text: 'No contact info for ' + a.vendor_company }]); });
      }
      speak('Quote request sent to ' + a.vendor_company);
      setPendingAction(null);
    } else {
      setLoading(true);
      try {
        var res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: actionToRun, userId: user ? user.id : null }) });
        var data = await res.json();
        setMessages(function(prev) { return prev.concat([{ role: 'ai', text: data.answer || 'Done.' }]); });
        speak(data.answer || 'Done');
      } catch (err) {
        setMessages(function(prev) { return prev.concat([{ role: 'ai', text: 'Error: ' + err.message }]); });
      }
      setLoading(false);
      setPendingAction(null);
    }
  };

  var askQuestion = async function(overrideText) {
    var question = (overrideText || inputRef.current || input).trim();
    if (!question || loading) return;

    // Check for pending action confirmation via REF (always fresh)
    var currentAction = pendingActionRef.current;
    if (currentAction) {
      var cmd = question.toLowerCase().replace(/[.,!?]/g, '');
      var confirmWords = ['execute', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'do it', 'go ahead', 'confirm', 'send it', 'go', 'sure', 'approve', 'proceed'];
      if (confirmWords.some(function(w) { return cmd === w || cmd.startsWith(w + ' '); })) {
        setInput('');
        inputRef.current = '';
        setMessages(function(prev) { return prev.concat([{ role: 'user', text: question }]); });
        await doExecuteAction(currentAction);
        return;
      }
      var cancelWords = ['cancel', 'no', 'nah', 'never mind', 'skip', 'stop'];
      if (cancelWords.some(function(w) { return cmd === w || cmd.startsWith(w + ' '); })) {
        setInput('');
        inputRef.current = '';
        setMessages(function(prev) { return prev.concat([{ role: 'user', text: question }, { role: 'ai', text: 'Cancelled.' }]); });
        setPendingAction(null);
        speak('Cancelled');
        return;
      }
    }

    setInput('');
    inputRef.current = '';
    var newMsg = { role: 'user', text: question };
    setMessages(function(prev) { return prev.concat([newMsg]); });
    setLoading(true);
    setPendingAction(null);

    try {
      var res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question, history: messages.slice(-10), userId: user ? user.id : null }),
      });
      var data = await res.json();
      var answer = data.answer || 'No response';
      setMessages(function(prev) { return prev.concat([{ role: 'ai', text: answer }]); });
      speak(answer);
      if (data.pending_action) setPendingAction(data.pending_action);
    } catch (err) {
      setMessages(function(prev) { return prev.concat([{ role: 'ai', text: 'Connection error: ' + err.message }]); });
    }
    setLoading(false);
  };

  var suggestions = [
    { text: 'Who owes us the most?', icon: '\uD83D\uDCB0' },
    { text: 'Request shipping rate from China to Egypt, 40ft', icon: '\uD83D\uDCCB' },
    { text: 'How many tickets are overdue?', icon: '\uD83C\uDFAB' },
    { text: 'Send rate request to all truckers for Cairo', icon: '\uD83D\uDE9B' },
    { text: 'Give me a morning briefing', icon: '\u2600\uFE0F' },
    { text: 'Create a ticket for the team', icon: '\u270F\uFE0F' },
    { text: 'What are total sales this month?', icon: '\uD83D\uDCCA' },
    { text: 'Which vendors have rates expiring?', icon: '\uD83D\uDEA2' },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-extrabold">AI Secretary</h2>
          <p className="text-[10px]" style={{color:'var(--text-muted,#64748b)'}}>Voice commands + Business intelligence + Actions</p>
        </div>
        <div className="flex gap-2">
          {voiceSupported && (
            <div className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (listening ? 'text-red-400' : 'text-emerald-400')}
              style={{background: listening ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)', border: '1px solid ' + (listening ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.2)')}}>
              {listening ? 'Listening...' : 'Voice Ready'}
            </div>
          )}
          {messages.length > 0 && (
            <button onClick={function() { setMessages([]); setPendingAction(null); if (window.speechSynthesis) window.speechSynthesis.cancel(); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary,#94a3b8)'}}>
              Clear
            </button>
          )}
        </div>
      </div>

      {messages.length === 0 && (
        <div className="rounded-xl p-5 mb-4" style={{background:'linear-gradient(135deg, rgba(56,189,248,0.12), rgba(167,139,250,0.12))', border:'1px solid rgba(56,189,248,0.2)'}}>
          <div className="flex items-center gap-4">
            <div className="text-5xl">{voiceSupported ? '\uD83C\uDF99\uFE0F' : '\uD83E\uDD16'}</div>
            <div>
              <h3 className="text-lg font-bold" style={{color:'var(--accent,#38bdf8)'}}>AI Executive Secretary</h3>
              <p className="text-sm" style={{color:'var(--text-secondary,#94a3b8)'}}>Ask anything about your business or give commands</p>
            </div>
          </div>
        </div>
      )}

      {messages.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {suggestions.map(function(s, i) {
            return (
              <button key={i} onClick={function() { askQuestion(s.text); }}
                className="text-left px-3 py-2.5 rounded-lg text-xs font-medium transition"
                style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-secondary,#94a3b8)'}}>
                <span className="text-base mr-1">{s.icon}</span> {s.text}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-3 mb-3 max-h-[500px] overflow-auto">
        {messages.map(function(m, i) {
          return (
            <div key={i} className="rounded-xl p-4" style={m.role === 'user' ? {background:'linear-gradient(135deg, #0ea5e9, #6366f1)', marginLeft:'3rem', color:'white'} : {background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', marginRight:'1rem'}}>
              <div className="text-[10px] font-semibold mb-1" style={{opacity:0.6}}>{m.role === 'user' ? 'You' : 'AI Secretary'}</div>
              <div className="text-sm whitespace-pre-wrap" style={{lineHeight:1.7}}>{m.text}</div>
            </div>
          );
        })}

        {pendingAction && !loading && (
          <div className="rounded-xl p-4 mx-2" style={{background: pendingAction.type === 'request_quote' ? 'rgba(56,189,248,0.08)' : 'rgba(167,139,250,0.08)', border:'1px solid ' + (pendingAction.type === 'request_quote' ? 'rgba(56,189,248,0.25)' : 'rgba(167,139,250,0.25)')}}>
            <div className="text-xs font-bold mb-2" style={{color: pendingAction.type === 'request_quote' ? '#7dd3fc' : '#c4b5fd'}}>
              {pendingAction.type === 'request_quote' ? 'RATE QUOTE REQUEST' : 'ACTION READY - ' + (pendingAction.type || '').replace('_', ' ').toUpperCase()}
            </div>
            <div className="text-xs mb-1" style={{color:'var(--text-muted,#64748b)'}}>Say "execute" or tap a button below:</div>
            {pendingAction.type === 'request_quote' ? (
              <div>
                <div className="text-sm mb-1" style={{color:'var(--text-primary,#f1f5f9)'}}><strong>{pendingAction.vendor_company}</strong>{pendingAction.vendor_contact ? ' - ' + pendingAction.vendor_contact : ''}</div>
                <div className="text-xs mb-3" style={{color:'var(--text-secondary,#94a3b8)'}}>{pendingAction.origin} to {pendingAction.destination} - {pendingAction.container || '40ft'}</div>
                <div className="space-y-2">
                  {pendingAction.vendor_whatsapp && <button onClick={function() { doExecuteAction(Object.assign({}, pendingAction, {send_via:'whatsapp'})); }} className="w-full py-4 rounded-xl text-base font-bold text-white" style={{background:'linear-gradient(135deg, #10b981, #059669)'}}>WhatsApp Send</button>}
                  {pendingAction.vendor_email && <button onClick={function() { doExecuteAction(Object.assign({}, pendingAction, {send_via:'email'})); }} className="w-full py-4 rounded-xl text-base font-bold text-white" style={{background:'linear-gradient(135deg, #0ea5e9, #3b82f6)'}}>Email Send</button>}
                  <button onClick={function() { setPendingAction(null); }} className="w-full py-2 rounded-xl text-xs" style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary,#94a3b8)'}}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm mb-3" style={{color:'var(--text-secondary,#94a3b8)'}}>
                  {pendingAction.title || pendingAction.task}
                  {pendingAction.priority && <span className="ml-2 text-[10px] font-bold" style={{color:'#fbbf24'}}>({pendingAction.priority})</span>}
                  {pendingAction.due_date && <span className="ml-2 text-[10px]" style={{color:'var(--text-muted,#64748b)'}}>Due: {pendingAction.due_date}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={function() { doExecuteAction(pendingAction); }} className="flex-1 py-3 text-white rounded-xl text-sm font-bold" style={{background:'linear-gradient(135deg, #10b981, #059669)'}}>Execute</button>
                  <button onClick={function() { setPendingAction(null); }} className="px-4 py-3 rounded-xl text-xs" style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary,#94a3b8)'}}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="rounded-xl p-4" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', marginRight:'1rem'}}>
            <div className="text-[10px] font-semibold mb-1" style={{opacity:0.6}}>AI Secretary</div>
            <div className="text-sm animate-pulse" style={{color:'var(--text-muted,#64748b)'}}>Thinking...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="rounded-xl p-2" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)'}}>
        <div className="flex gap-2">
          {voiceSupported && (
            <button onClick={toggleVoice} className="rounded-xl text-2xl transition flex-shrink-0"
              style={listening ? {background:'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow:'0 0 25px rgba(248,113,113,0.5)', color:'white', width:56, height:56, display:'flex', alignItems:'center', justifyContent:'center'} : {background:'linear-gradient(135deg, rgba(56,189,248,0.15), rgba(167,139,250,0.15))', border:'2px solid rgba(56,189,248,0.3)', color:'#38bdf8', width:56, height:56, display:'flex', alignItems:'center', justifyContent:'center'}}>
              {listening ? '\u23F9\uFE0F' : '\uD83C\uDFA4'}
            </button>
          )}
          <input value={input} onChange={function(e) { setInput(e.target.value); inputRef.current = e.target.value; }}
            onKeyDown={function(e) { if (e.key === 'Enter') askQuestion(); }}
            placeholder={listening ? 'Listening...' : 'Ask anything or give a command...'}
            className="flex-1 px-4 py-3 rounded-xl text-sm"
            style={{background: listening ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.04)', border:'1px solid ' + (listening ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)'), color:'var(--text-primary,#f1f5f9)', fontSize:'16px'}} />
          <button id="ai-send-btn" onClick={function() { askQuestion(); }} disabled={loading}
            className="rounded-xl text-sm font-bold disabled:opacity-40 transition flex-shrink-0 px-5"
            style={{background:'linear-gradient(135deg, #0ea5e9, #6366f1)', color:'white', height:56}}>
            {loading ? '...' : '\u2192'}
          </button>
        </div>
        {listening && (
          <div className="text-center mt-2 py-2">
            <div className="text-xs font-bold animate-pulse" style={{color:'#f87171'}}>Listening - speak your command...</div>
            <div className="text-[10px] mt-1" style={{color:'var(--text-muted,#64748b)'}}>Auto-sends 3 seconds after you stop talking</div>
          </div>
        )}
      </div>
    </div>
  );
}
