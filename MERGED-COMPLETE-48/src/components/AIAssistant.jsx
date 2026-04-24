'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

export default function AIAssistant({ user, userProfile, users, customers }) {
  const myId = userProfile?.id || user?.id;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimerRef = useRef(null);
  const recordingRecRef = useRef(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [pendingAction, _setPendingAction] = useState(null);
  const pendingActionRef = useRef(null);
  const setPendingAction = (val) => { _setPendingAction(val); pendingActionRef.current = val; };
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const autoSendRef = useRef(null);
  const pendingTextRef = useRef(null);

  const conversationModeRef = useRef(false);
  const maxTimeoutRef = useRef(null);
  const voiceRef = useRef(null);

  // Memory briefing state
  const [briefing, setBriefing] = useState(null);
  const [briefingShown, setBriefingShown] = useState(false);

  // Fetch the morning briefing for this user
  const fetchBriefing = async () => {
    if (!myId) return null;
    try {
      const r = await fetch('/api/memory?briefing=1&userId=' + myId);
      const data = await r.json();
      return data && data.briefing ? data.briefing : null;
    } catch (e) { return null; }
  };

  // On mount: show briefing once per day per user (first open of the day)
  useEffect(() => {
    if (!myId) return;
    const key = 'ktc_briefing_shown_' + myId + '_' + new Date().toISOString().substring(0, 10);
    if (typeof window !== 'undefined' && window.sessionStorage && window.sessionStorage.getItem(key)) return;
    (async () => {
      const b = await fetchBriefing();
      if (!b) return;
      const anyItems = (b.counts.urgent + b.counts.meetings + b.counts.reminders + b.counts.from_others) > 0;
      if (!anyItems) return;
      setBriefing(b);
      setBriefingShown(true);
      try { window.sessionStorage.setItem(key, '1'); } catch (e) {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    // Find the most natural-sounding voice available
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      // Prefer natural/premium voices first, then high-quality, then any English
      const preferred = [
        'Samantha', 'Karen', 'Daniel', 'Moira', 'Tessa',  // Apple natural voices
        'Google UK English Female', 'Google UK English Male',  // Google
        'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Guy',  // Microsoft natural
        'Microsoft Zira', 'Microsoft David',  // Microsoft standard
        'Alex', 'Victoria', 'Fiona',  // Other Apple
      ];
      for (const name of preferred) {
        const found = voices.find(v => v.name.includes(name));
        if (found) { voiceRef.current = found; break; }
      }
      if (!voiceRef.current) {
        // Find any English voice that's NOT robotic-sounding
        const eng = voices.find(v => v.lang.startsWith('en') && !v.name.includes('Google US') && !v.name.includes('eSpeak'));
        if (eng) voiceRef.current = eng;
      }
    };
    if ('speechSynthesis' in window) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      setVoiceSupported(true);
      const recognition = new SR();
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      recognition.continuous = !isSafari; // Safari doesn't support continuous
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      let lastFinalText = '';
      let lastFinalTime = 0;
      let accumulatedText = '';
      
      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';
        let hasFinal = false;
        
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript;
            hasFinal = true;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }
        
        // Safari: accumulate text across recognition restarts
        if (hasFinal && isSafari) {
          accumulatedText = (accumulatedText + ' ' + finalText).trim();
          finalText = accumulatedText;
        }
        
        const displayText = isSafari ? (accumulatedText + ' ' + interimText).trim() : (finalText + interimText).trim();
        if (!displayText) return;
        
        const lower = displayText.toLowerCase().replace(/[.,!?]/g, '').trim();
        const words = lower.split(/\s+/).filter(w => w.length > 1);
        const wordCount = words.length;
        
        // Noise filter
        const NOISE_WORDS = ['the', 'a', 'uh', 'um', 'ah', 'oh', 'hmm', 'hm', 'eh', 'er', 'like', 'yeah', 'so', 'and', 'but', 'is', 'it'];
        const isNoise = wordCount === 0 || 
          (wordCount === 1 && NOISE_WORDS.includes(words[0])) ||
          (displayText.length < 3);
        
        // ── IF AI IS SPEAKING ──
        if (speakingRef.current) {
          // "break"/"stop" command
          if (hasFinal && (lower === 'break' || lower === 'stop')) {
            stopSpeaking();
            setInput('');
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            if (autoSendRef.current) clearTimeout(autoSendRef.current);
            lastFinalText = ''; accumulatedText = '';
            try { recognition.stop(); } catch(e) {}
            setTimeout(() => { if (conversationModeRef.current) { try { recognition.start(); setListening(true); } catch(e) {} } }, 300);
            return;
          }
          // 2+ real words in a FINAL result → user is talking, stop AI
          if (hasFinal && wordCount >= 2 && !isNoise) {
            stopSpeaking();
            lastFinalText = displayText;
            lastFinalTime = Date.now();
            setInput(displayText);
            // Don't return — fall through to set silence timer
          } else {
            // Interim result or noise while AI speaks — ignore completely
            return;
          }
        }
        
        // ── NORMAL LISTENING ──
        if (isNoise && !hasFinal) return; // skip interim noise
        
        setInput(displayText);
        
        // "break"/"stop" command
        if (hasFinal && (lower === 'break' || lower === 'stop')) {
          setInput('');
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          if (autoSendRef.current) clearTimeout(autoSendRef.current);
          lastFinalText = ''; accumulatedText = '';
          try { recognition.stop(); } catch(e) {}
          setTimeout(() => { if (conversationModeRef.current) { try { recognition.start(); setListening(true); } catch(e) {} } }, 300);
          return;
        }
        
        // ── SILENCE TIMER: only reset on FINAL results ──
        // Interim results do NOT reset the timer — this is the key fix
        if (hasFinal && displayText !== lastFinalText) {
          lastFinalText = displayText;
          lastFinalTime = Date.now();
          
          // Clear any existing timer
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          if (autoSendRef.current) clearTimeout(autoSendRef.current);
          
          // Wait 3 seconds of silence after the last FINAL result
          silenceTimerRef.current = setTimeout(() => {
            const textToSend = displayText.trim();
            if (!textToSend || textToSend.length < 3) return;
            // Double-check we haven't gotten new speech
            if (Date.now() - lastFinalTime < 2500) return;
            try { recognition.stop(); } catch(e) {}
            pendingTextRef.current = textToSend;
            setInput('');
            lastFinalText = ''; accumulatedText = '';
            autoSendRef.current = setTimeout(() => {
              const btn = document.getElementById('ai-send-btn-hidden');
              if (btn) btn.click();
            }, 100);
          }, 3000);
        }
      };
      recognition.onerror = (e) => { 
        if (e.error !== 'aborted' && e.error !== 'no-speech') { setListening(false); }
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); 
      };
      recognition.onend = () => { 
        if (conversationModeRef.current && !speakingRef.current) {
          // Auto-restart — critical for Safari which stops after each utterance
          setTimeout(() => {
            if (conversationModeRef.current && !speakingRef.current) {
              try { recognition.start(); setListening(true); } catch(e) {}
            }
          }, isSafari ? 100 : 300);
        } else if (!conversationModeRef.current) {
          setListening(false);
          accumulatedText = '';
        }
      };
      recognitionRef.current = recognition;
    }
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); if (autoSendRef.current) clearTimeout(autoSendRef.current); if (maxTimeoutRef.current) clearTimeout(maxTimeoutRef.current); if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); if (watchdogRef.current) clearInterval(watchdogRef.current); };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const startListeningAgain = () => {
    if (!conversationModeRef.current || !recognitionRef.current) return;
    try {
      setInput('');
      recognitionRef.current.start();
      setListening(true);
    } catch(e) { /* already running */ }
  };

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (recording) { stopRecording(); return; }

    const wasSpeaking = speakingRef.current;
    
    // ALWAYS kill any speech immediately
    stopSpeaking();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (autoSendRef.current) clearTimeout(autoSendRef.current);

    if (wasSpeaking) {
      // AI was talking → stop it and START listening
      setInput('');
      try { recognitionRef.current.stop(); } catch(e) {}
      conversationModeRef.current = true;
      setTimeout(() => {
        try { recognitionRef.current.start(); setListening(true); } catch(e) {}
      }, 300);
      return;
    }

    if (listening || conversationModeRef.current) {
      // Currently listening → stop everything
      try { recognitionRef.current.stop(); } catch(e) {}
      setListening(false);
      conversationModeRef.current = false;
      if (maxTimeoutRef.current) clearTimeout(maxTimeoutRef.current);
    } else {
      // Not listening, not speaking → start conversation mode
      setInput('');
      conversationModeRef.current = true;
      try { recognitionRef.current.start(); } catch(e) {}
      setListening(true);
      if (maxTimeoutRef.current) clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = setTimeout(() => {
        conversationModeRef.current = false;
        try { recognitionRef.current.stop(); } catch(e) {}
        setListening(false);
        stopSpeaking();
      }, 120000);
    }
  };

  const audioRef = useRef(null);
  const speakingRef = useRef(false);

  const stopSpeaking = () => {
    speakingRef.current = false; setSpeaking(false);
    // Stop ElevenLabs audio
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch(e) { console.warn(e); }
      audioRef.current = null;
    }
    // Stop browser speech synthesis — call cancel multiple times for reliability
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.cancel(); // Double cancel for Chrome bug
    }
  };

  // Build known names for correction
  const knownNames = useMemo(() => {
    const names = [];
    (users || []).forEach(u => {
      if (u.name) names.push(u.name);
      if (u.name_ar) names.push(u.name_ar);
      // Add first names and last names separately
      const parts = (u.name || '').split(/\s+/);
      parts.forEach(p => { if (p.length > 2) names.push(p); });
    });
    (customers || []).slice(0, 100).forEach(c => {
      if (c.name) names.push(c.name);
      if (c.name_en) names.push(c.name_en);
    });
    return [...new Set(names)];
  }, [users, customers]);

  // Correct names in transcribed text using similarity matching
  const correctNames = (text) => {
    if (!text || knownNames.length === 0) return text;
    let corrected = text;
    const words = text.split(/\s+/);
    // Check 1-word and 2-word combinations
    for (let i = 0; i < words.length; i++) {
      const w1 = words[i];
      const w2 = i < words.length - 1 ? words[i] + ' ' + words[i + 1] : '';
      for (const name of knownNames) {
        const nameLower = name.toLowerCase();
        // Exact match (case-insensitive) — skip
        if (w1.toLowerCase() === nameLower) break;
        // Close match for single word (Levenshtein-like: differ by 1-2 chars)
        if (w1.length >= 3 && nameLower.length >= 3 && Math.abs(w1.length - nameLower.length) <= 2) {
          let matches = 0;
          const shorter = w1.length <= nameLower.length ? w1.toLowerCase() : nameLower;
          const longer = w1.length > nameLower.length ? w1.toLowerCase() : nameLower;
          for (let c = 0; c < shorter.length; c++) { if (longer.includes(shorter[c])) matches++; }
          if (matches / longer.length > 0.75 && matches >= 3) {
            corrected = corrected.replace(new RegExp('\\b' + w1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), name);
            break;
          }
        }
        // Two-word name match
        if (w2 && w2.length >= 4) {
          const w2Lower = w2.toLowerCase();
          if (w2Lower === nameLower) { corrected = corrected.replace(w2, name); break; }
        }
      }
    }
    return corrected;
  };

  // ===== VOICE NOTE RECORDING =====
  const recordingRef = useRef(false);
  const accumulatedTextRef = useRef('');
  const watchdogRef = useRef(null);
  const lastResultTimeRef = useRef(0);
  
  const startRecording = () => {
    stopSpeaking();
    if (conversationModeRef.current) {
      conversationModeRef.current = false;
      try { recognitionRef.current?.stop(); } catch(e) { console.warn(e); }
      setListening(false);
    }
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (autoSendRef.current) clearTimeout(autoSendRef.current);
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition not supported'); return; }
    
    accumulatedTextRef.current = '';
    lastResultTimeRef.current = Date.now();
    setInput('');
    setRecording(true);
    recordingRef.current = true;
    setRecordingTime(0);
    recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    
    const launchRecognition = () => {
      if (!recordingRef.current) return;
      
      try {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        
        let sessionFinal = '';
        
        rec.onresult = (event) => {
          lastResultTimeRef.current = Date.now();
          let finalText = '';
          let interimText = '';
          for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              finalText += event.results[i][0].transcript + ' ';
            } else {
              interimText += event.results[i][0].transcript;
            }
          }
          sessionFinal = finalText;
          setInput((accumulatedTextRef.current + finalText + interimText).trim());
        };
        
        rec.onend = () => {
          // Save this session's final text
          if (sessionFinal.trim()) {
            accumulatedTextRef.current += sessionFinal;
            setInput(accumulatedTextRef.current.trim());
          }
          // Restart if still recording
          if (recordingRef.current) {
            setTimeout(launchRecognition, 200);
          }
        };
        
        rec.onerror = (e) => {
          // Restart on any error if still recording
          if (recordingRef.current && e.error !== 'not-allowed') {
            setTimeout(launchRecognition, 300);
          }
        };
        
        recordingRecRef.current = rec;
        rec.start();
      } catch(e) {
        // Retry launch
        if (recordingRef.current) setTimeout(launchRecognition, 500);
      }
    };
    
    // Watchdog: if no result for 8 seconds, force restart recognition
    watchdogRef.current = setInterval(() => {
      if (!recordingRef.current) { clearInterval(watchdogRef.current); return; }
      const silentMs = Date.now() - lastResultTimeRef.current;
      if (silentMs > 8000 && recordingRecRef.current) {
        try { recordingRecRef.current.stop(); } catch(e) { console.warn(e); }
        // onend will trigger restart
      }
    }, 3000);
    
    launchRecognition();
  };

  const stopRecording = () => {
    setRecording(false);
    recordingRef.current = false;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    if (recordingRecRef.current) { try { recordingRecRef.current.stop(); } catch(e) { console.warn(e); } recordingRecRef.current = null; }
    // Final text stays in input for review
  };

  const formatTime = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  const speak = async (text) => {
    stopSpeaking();
    const clean = text.replace(/[*#_`\-]/g, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    speakingRef.current = true;
    setSpeaking(true);

    // Keep recognition running so user can say "break" to interrupt

    // Try TTS API first (ElevenLabs / server)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean.substring(0, 1200) })
      });
      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          speakingRef.current = false; setSpeaking(false);
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (conversationModeRef.current) { setInput(''); startListeningAgain(); }
        };
        audio.onerror = () => {
          speakingRef.current = false; setSpeaking(false);
          audioRef.current = null;
          if (conversationModeRef.current) startListeningAgain();
        };
        await audio.play();
        return;
      }
    } catch(e) { /* TTS API not available, fall back */ }

    // Fallback: browser speech — chunk into sentences to avoid Chrome 15s cutoff
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      // Split into chunks at sentence boundaries, max 150 chars each
      const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
      const chunks = [];
      let current = '';
      for (const s of sentences) {
        if ((current + s).length > 150 && current) { chunks.push(current.trim()); current = s; }
        else { current += s; }
      }
      if (current.trim()) chunks.push(current.trim());

      let i = 0;
      const speakNext = () => {
        if (i >= chunks.length || !speakingRef.current) {
          speakingRef.current = false; setSpeaking(false);
          if (conversationModeRef.current) { setInput(''); startListeningAgain(); }
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        if (voiceRef.current) u.voice = voiceRef.current;
        u.rate = 0.95; u.pitch = 1.05; u.volume = 1.0; // Slightly slower, slightly higher pitch = warmer
        u.onend = () => { i++; speakNext(); };
        u.onerror = () => { speakingRef.current = false; setSpeaking(false); if (conversationModeRef.current) startListeningAgain(); };
        window.speechSynthesis.speak(u);
      };
      speakNext();
    }
  };

  const askQuestion = useCallback(async (overrideText) => {
    const voiceText = pendingTextRef.current;
    pendingTextRef.current = null;
    const rawQuestion = (overrideText || voiceText || input).trim();
    if (!rawQuestion || loading) return;
    const question = correctNames(rawQuestion);
    setInput('');
    
    // Check "break" command
    const lowerQ = question.toLowerCase().replace(/[.,!?]/g, '').trim();
    if (lowerQ === 'break' || lowerQ === 'stop') {
      stopSpeaking();
      return;
    }
    
    // Use ref for pending action to avoid stale closure
    const currentPending = pendingActionRef.current;
    
    if (currentPending) {
      const cmd = lowerQ;
      const confirmWords = ['execute', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'do it', 'go ahead', 'confirm', 'send it', 'go', 'sure', 'approve', 'proceed', 'نعم', 'نفذ', 'تنفيذ', 'موافق'];
      if (confirmWords.some(w => cmd === w || cmd.startsWith(w + ' '))) {
        setMessages(prev => [...prev, { role: 'user', text: '✅ ' + question }]);
        // Execute inline
        if (currentPending.type === 'request_quote') {
          const a = currentPending;
          const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          const msg = `Dear ${a.vendor_contact || a.vendor_company || 'Team'},\n\nWe are requesting your best rates:\n\nOrigin: ${a.origin || '[Origin]'}\nDestination: ${a.destination || 'Egypt'}\nContainer: ${a.container || '40ft'}\nCommodity: ${a.commodity || 'Trading materials'}${a.customer_name ? '\nClient: ' + a.customer_name : ''}\n\nPlease include freight rate, transit time, free days, fees, and validity.\n\nBest regards,\nKTC International\n${todayStr}`;
          const subj = 'Rate Request — ' + (a.origin||'') + ' to ' + (a.destination||'Egypt') + ' — KTC';
          if (a.send_via === 'email' && a.vendor_email) {
            window.open('mailto:' + a.vendor_email + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(msg));
            setMessages(prev => [...prev, { role: 'ai', text: '✅ Email opened for ' + a.vendor_company }]);
          } else if (a.vendor_whatsapp) {
            let cl = (a.vendor_whatsapp||'').replace(/[^0-9+]/g,''); if (!cl.startsWith('+')) cl='+'+cl;
            window.open('https://wa.me/' + cl.replace('+','') + '?text=' + encodeURIComponent(msg));
            setMessages(prev => [...prev, { role: 'ai', text: '✅ WhatsApp opened for ' + a.vendor_company }]);
          } else if (a.vendor_email) {
            window.open('mailto:' + a.vendor_email + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(msg));
            setMessages(prev => [...prev, { role: 'ai', text: '✅ Email opened for ' + a.vendor_company }]);
          } else {
            setMessages(prev => [...prev, { role: 'ai', text: '❌ No contact info for ' + a.vendor_company }]);
          }
          speak('Quote request sent to ' + a.vendor_company);
          setPendingAction(null);
        } else {
          setLoading(true);
          try {
            const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: currentPending, userId: myId }) });
            const data = await res.json();
            setMessages(prev => [...prev, { role: 'ai', text: data.answer || 'Done.' }]);
            speak(data.answer || 'Done');
          } catch (err) { setMessages(prev => [...prev, { role: 'ai', text: '❌ ' + err.message }]); }
          setLoading(false);
          setPendingAction(null);
        }
        return;
      }
      const cancelWords = ['cancel', 'no', 'nah', 'never mind', 'skip', 'لا', 'إلغاء'];
      if (cancelWords.some(w => cmd === w || cmd.startsWith(w + ' '))) {
        setMessages(prev => [...prev, { role: 'user', text: '❌ ' + question }]);
        setMessages(prev => [...prev, { role: 'ai', text: 'Cancelled.' }]);
        setPendingAction(null);
        speak('Cancelled');
        return;
      }
    }
    
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
          userId: myId,
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
  }, [input, loading, messages, user, pendingAction]);

  const executeAction = async () => {
    if (!pendingAction) return;
    // Handle request_quote locally (opens WhatsApp/email)
    if (pendingAction.type === 'request_quote') {
      executeQuoteRequest(pendingAction);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pendingAction, userId: myId }),
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

  const executeQuoteRequest = (action) => {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const msg = `Dear ${action.vendor_contact || action.vendor_company || 'Team'},

I hope this message finds you well.

We are requesting your best rates for the following:

Origin: ${action.origin || '[Origin]'}
Destination: ${action.destination || 'Egypt'}
Container: ${action.container || '40ft Standard'}
Commodity: ${action.commodity || 'General cargo / Trading materials'}${action.customer_name ? '\nClient Reference: ' + action.customer_name : ''}

Please include:
• Freight rate
• Transit time
• Free days at destination
• Any additional fees (THC, documentation, etc.)
• Rate validity period

Thank you for your continued partnership.

Best regards,
KTC International Trading
${today}`;

    const subject = 'Rate Request — ' + (action.origin || 'Origin') + ' to ' + (action.destination || 'Egypt') + ' — KTC International';

    if (action.send_via === 'email' && action.vendor_email) {
      window.open('mailto:' + action.vendor_email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(msg), '_blank');
      setMessages(prev => [...prev, { role: 'ai', text: '✅ Email opened for ' + action.vendor_company + '\n📧 ' + action.vendor_email + '\n\nSubject: ' + subject }]);
    } else if (action.vendor_whatsapp) {
      let clean = (action.vendor_whatsapp || '').replace(/[^0-9+]/g, '');
      if (clean.startsWith('0')) clean = '+2' + clean;
      if (!clean.startsWith('+')) clean = '+' + clean;
      window.open('https://wa.me/' + clean.replace('+', '') + '?text=' + encodeURIComponent(msg), '_blank');
      setMessages(prev => [...prev, { role: 'ai', text: '✅ WhatsApp opened for ' + action.vendor_company + '\n💬 ' + action.vendor_whatsapp }]);
    } else if (action.vendor_email) {
      window.open('mailto:' + action.vendor_email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(msg), '_blank');
      setMessages(prev => [...prev, { role: 'ai', text: '✅ Email opened for ' + action.vendor_company + '\n📧 ' + action.vendor_email }]);
    } else {
      setMessages(prev => [...prev, { role: 'ai', text: '❌ No contact info found for ' + action.vendor_company + '. Add their email or WhatsApp in Shipping → Vendors.' }]);
    }
    speak('Quote request sent to ' + action.vendor_company);
    setPendingAction(null);
  };

  const suggestions = [
    { text: 'Who owes us the most?', icon: '💰' },
    { text: 'Request shipping rate from China to Egypt, 40ft', icon: '📋' },
    { text: 'How many tickets are overdue?', icon: '🎫' },
    { text: 'Send rate request to all truckers for Cairo', icon: '🚛' },
    { text: 'Give me a morning briefing', icon: '☀️' },
    { text: 'Create a ticket for the team', icon: '✏️' },
    { text: 'What are total sales this month?', icon: '📊' },
    { text: 'Which vendors have rates expiring this week?', icon: '🚢' },
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
          <button onClick={async () => {
              const b = await fetchBriefing();
              if (!b) return;
              setBriefing(b);
              setBriefingShown(true);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)'}}
            title="Show your daily briefing (urgent items, meetings, reminders)">
            ☀️ Brief Me
          </button>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setPendingAction(null); window.speechSynthesis?.cancel(); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary)'}}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Morning briefing card */}
      {briefingShown && briefing && (
        <div className="rounded-xl p-4 mb-4" style={{
          background: 'linear-gradient(135deg, rgba(79,70,229,0.15), rgba(16,185,129,0.1))',
          border: '1.5px solid rgba(79,70,229,0.35)',
        }}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div style={{fontSize:14, fontWeight:900, color:'#fff'}}>☀️ Good morning{userProfile?.name ? ', ' + userProfile.name : ''}</div>
              <div style={{fontSize:11, color:'rgba(255,255,255,0.6)'}}>Your briefing for {new Date().toLocaleDateString()}</div>
            </div>
            <button onClick={() => setBriefingShown(false)} style={{color:'rgba(255,255,255,0.5)', fontSize:16}}>✕</button>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, fontSize:11}}>
            {briefing.urgent.length > 0 && (
              <div style={{background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:10}}>
                <div style={{fontWeight:900, color:'#fca5a5', marginBottom:4}}>🚨 URGENT ({briefing.urgent.length})</div>
                {briefing.urgent.slice(0, 3).map(m => <div key={m.id} style={{color:'#fee2e2', marginBottom:2}}>• {m.content}</div>)}
                {briefing.urgent.length > 3 && <div style={{color:'rgba(254,226,226,0.5)'}}>+ {briefing.urgent.length - 3} more</div>}
              </div>
            )}
            {briefing.meetings.length > 0 && (
              <div style={{background:'rgba(79,70,229,0.15)', border:'1px solid rgba(79,70,229,0.3)', borderRadius:8, padding:10}}>
                <div style={{fontWeight:900, color:'#a5b4fc', marginBottom:4}}>📅 Meetings ({briefing.meetings.length})</div>
                {briefing.meetings.slice(0, 3).map(m => <div key={m.id} style={{color:'#e0e7ff', marginBottom:2}}>• {m.content}</div>)}
              </div>
            )}
            {briefing.reminders.length > 0 && (
              <div style={{background:'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:8, padding:10}}>
                <div style={{fontWeight:900, color:'#fcd34d', marginBottom:4}}>⏰ Reminders ({briefing.reminders.length})</div>
                {briefing.reminders.slice(0, 3).map(m => <div key={m.id} style={{color:'#fef3c7', marginBottom:2}}>• {m.content}</div>)}
                {briefing.reminders.length > 3 && <div style={{color:'rgba(254,243,199,0.5)'}}>+ {briefing.reminders.length - 3} more</div>}
              </div>
            )}
            {briefing.from_others.length > 0 && (
              <div style={{background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.3)', borderRadius:8, padding:10}}>
                <div style={{fontWeight:900, color:'#6ee7b7', marginBottom:4}}>💬 From Team ({briefing.from_others.length})</div>
                {briefing.from_others.slice(0, 3).map(m => <div key={m.id} style={{color:'#d1fae5', marginBottom:2}}>• {m.content}</div>)}
              </div>
            )}
          </div>
          <div style={{marginTop:10, fontSize:10, color:'rgba(255,255,255,0.55)', fontStyle:'italic'}}>
            Ask me to knock through any of these, or just chat — I'll remember what matters.
          </div>
        </div>
      )}

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
          <div className="rounded-xl p-4 mx-2" style={{
            background: pendingAction.type === 'request_quote' ? 'rgba(56,189,248,0.08)' : 'rgba(167,139,250,0.08)',
            border: '1px solid ' + (pendingAction.type === 'request_quote' ? 'rgba(56,189,248,0.25)' : 'rgba(167,139,250,0.25)'),
          }}>
            <div className="text-xs font-bold mb-2" style={{color: pendingAction.type === 'request_quote' ? '#7dd3fc' : '#c4b5fd'}}>
              {pendingAction.type === 'request_quote' ? '📋 RATE QUOTE REQUEST' : '⚡ ' + (pendingAction.type?.replace('_', ' ').toUpperCase())}
            </div>
            {pendingAction.type === 'request_quote' ? (
              <div>
                <div className="text-sm mb-1" style={{color:'var(--text-primary)'}}>
                  <strong>{pendingAction.vendor_company}</strong>{pendingAction.vendor_contact ? ' — ' + pendingAction.vendor_contact : ''}
                </div>
                <div className="text-xs mb-3" style={{color:'var(--text-secondary)'}}>
                  {pendingAction.origin} → {pendingAction.destination} • {pendingAction.container || '40ft'}
                  {pendingAction.customer_name && <span> • Client: {pendingAction.customer_name}</span>}
                </div>
                <div className="space-y-2">
                  {pendingAction.vendor_whatsapp && (
                    <button onClick={() => { const a = {...pendingAction, send_via:'whatsapp'}; executeQuoteRequest(a); }}
                      className="w-full py-4 rounded-xl text-base font-bold text-white flex items-center justify-center gap-2"
                      style={{background:'linear-gradient(135deg, #10b981, #059669)', boxShadow:'0 4px 15px rgba(52,211,153,0.3)'}}>
                      💬 Send via WhatsApp
                    </button>
                  )}
                  {pendingAction.vendor_email && (
                    <button onClick={() => { const a = {...pendingAction, send_via:'email'}; executeQuoteRequest(a); }}
                      className="w-full py-4 rounded-xl text-base font-bold text-white flex items-center justify-center gap-2"
                      style={{background:'linear-gradient(135deg, #0ea5e9, #3b82f6)', boxShadow:'0 4px 15px rgba(56,189,248,0.3)'}}>
                      📧 Send via Email
                    </button>
                  )}
                  <button onClick={() => setPendingAction(null)}
                    className="w-full py-2 rounded-xl text-xs"
                    style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary)'}}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (pendingAction.type === 'send_email' || pendingAction.type === 'send_whatsapp') ? (
              <div>
                <div className="text-xs font-bold mb-2" style={{color: pendingAction.type === 'send_email' ? '#38bdf8' : '#10b981'}}>
                  {pendingAction.type === 'send_email' ? '📧 EMAIL DRAFT' : '💬 WHATSAPP DRAFT'}
                </div>
                <div className="text-xs mb-1" style={{color:'var(--text-secondary)'}}>
                  <strong>To:</strong> {pendingAction.to}
                </div>
                {pendingAction.subject && <div className="text-xs mb-1" style={{color:'var(--text-secondary)'}}><strong>Subject:</strong> {pendingAction.subject}</div>}
                <div className="text-sm p-3 rounded-lg mt-2 mb-3 whitespace-pre-wrap" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-primary)', lineHeight:1.6, maxHeight:200, overflow:'auto'}}>
                  {pendingAction.body}
                </div>
                <div className="flex gap-2">
                  <button onClick={executeAction}
                    className="flex-1 py-3 text-white rounded-xl text-sm font-bold"
                    style={{background: pendingAction.type === 'send_email' ? 'linear-gradient(135deg, #0ea5e9, #3b82f6)' : 'linear-gradient(135deg, #10b981, #059669)', boxShadow:'0 2px 12px rgba(52,211,153,0.3)'}}>
                    {pendingAction.type === 'send_email' ? '📧 Send Email' : '💬 Send WhatsApp'}
                  </button>
                  <button onClick={() => setPendingAction(null)}
                    className="px-4 py-3 rounded-xl text-xs"
                    style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary)'}}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm mb-3" style={{color:'var(--text-secondary)'}}>
                  {pendingAction.title || pendingAction.task}
                  {pendingAction.priority && <span className="ml-2 text-[10px] font-bold" style={{color: pendingAction.priority === 'high' ? '#f87171' : pendingAction.priority === 'urgent' ? '#ef4444' : '#fbbf24'}}>({pendingAction.priority})</span>}
                  {pendingAction.due_date && <span className="ml-2 text-[10px]" style={{color:'var(--text-muted)'}}>Due: {pendingAction.due_date}</span>}
                  {pendingAction.event_date && <span className="ml-2 text-[10px]" style={{color:'var(--text-muted)'}}>{pendingAction.event_date} {pendingAction.event_time || ''}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={executeAction}
                    className="flex-1 py-3 text-white rounded-xl text-sm font-bold"
                    style={{background:'linear-gradient(135deg, #10b981, #059669)', boxShadow:'0 2px 12px rgba(52,211,153,0.3)'}}>
                    ✅ Execute
                  </button>
                  <button onClick={() => setPendingAction(null)}
                    className="px-4 py-3 rounded-xl text-xs"
                    style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--text-secondary)'}}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
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

      {/* Input Bar — Mobile Optimized */}
      <div className="rounded-xl p-2" style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div className="flex gap-2">
          {voiceSupported && !recording && (
            <button onClick={toggleVoice}
              className="rounded-xl text-2xl transition flex-shrink-0"
              style={listening ? {
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                boxShadow: '0 0 25px rgba(248,113,113,0.5)',
                color: 'white', width: 48, height: 56,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              } : {
                background: 'linear-gradient(135deg, rgba(56,189,248,0.15), rgba(167,139,250,0.15))',
                border: '2px solid rgba(56,189,248,0.3)',
                color: '#38bdf8', width: 48, height: 56,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {listening ? '⏹️' : '🎤'}
            </button>
          )}
          {/* Voice Note button */}
          {voiceSupported && !listening && (
            <button onClick={recording ? stopRecording : startRecording}
              className="rounded-xl text-lg transition flex-shrink-0"
              style={recording ? {
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                boxShadow: '0 0 20px rgba(248,113,113,0.4)',
                color: 'white', width: 48, height: 56,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              } : {
                background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))',
                border: '2px solid rgba(16,185,129,0.3)',
                color: '#10b981', width: 48, height: 56,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={recording ? 'Stop recording' : 'Record voice note'}>
              {recording ? '⏹' : '🎙️'}
            </button>
          )}
          {/* Stop Speaking button */}
          {speaking && (
            <button onClick={() => { stopSpeaking(); if (conversationModeRef.current) startListeningAgain(); }}
              className="rounded-xl text-lg transition flex-shrink-0 animate-pulse"
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: 'white', width: 48, height: 56,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 15px rgba(245,158,11,0.4)',
              }}>
              🔇
            </button>
          )}
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !recording && askQuestion()}
            placeholder={recording ? 'Recording... tap ⏹ when done' : speaking ? 'AI speaking... tap 🔇' : listening ? 'Listening...' : 'Ask anything or give a command...'}
            className="flex-1 px-4 py-3 rounded-xl text-sm"
            style={{
              background: recording ? 'rgba(16,185,129,0.06)' : speaking ? 'rgba(245,158,11,0.06)' : listening ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.04)',
              border: '1px solid ' + (recording ? 'rgba(16,185,129,0.3)' : speaking ? 'rgba(245,158,11,0.2)' : listening ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)'),
              color: 'var(--text-primary)',
              fontSize: '16px',
            }} />
          <button id="ai-send-btn" onClick={() => { if (recording) stopRecording(); askQuestion(); }} disabled={loading || !input.trim()}
            className="rounded-xl text-sm font-bold disabled:opacity-40 transition flex-shrink-0 px-5"
            style={{background:'linear-gradient(135deg, #0ea5e9, #6366f1)', boxShadow:'0 2px 12px rgba(56,189,248,0.3)', color:'white', height: 56}}>
            {loading ? '...' : '→'}
          </button>
          <button id="ai-send-btn-hidden" onClick={() => askQuestion()} style={{display:'none'}} />
        </div>
        {/* Recording indicator */}
        {recording && (
          <div className="text-center mt-2 py-2">
            <div className="flex items-center justify-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-bold" style={{color:'#10b981'}}>Recording — {formatTime(recordingTime)}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{background:'rgba(16,185,129,0.15)', color:'#10b981', fontWeight:700}}>{(input || '').split(/\s+/).filter(w => w).length} words</span>
            </div>
            <div className="text-[10px] mt-1" style={{color:'var(--text-muted)'}}>
              🎙️ Keep talking — picks up every phrase. Tap ⏹ when done.
            </div>
          </div>
        )}
        {speaking && !recording && (
          <div className="text-center mt-2 py-1">
            <div className="text-xs font-bold" style={{color:'#f59e0b'}}>
              🔊 AI Speaking... 
              <button onClick={() => { stopSpeaking(); if (conversationModeRef.current) startListeningAgain(); }} className="ml-2 px-3 py-1 rounded bg-amber-600 text-white text-xs font-bold">🔇 Stop & Listen</button>
            </div>
          </div>
        )}
        {listening && !speaking && (
          <div className="text-center mt-2 py-2">
            <div className="text-xs font-bold animate-pulse" style={{color:'#f87171'}}>🔴 Listening — speak naturally...</div>
            <div className="text-[10px] mt-1" style={{color:'var(--text-muted)'}}>
              Sends after 3s of silence • Say "Break" to stop • Tap ⏹️ to end
              <button onClick={() => { toggleVoice(); }} className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold" style={{background:'rgba(248,113,113,0.2)', color:'#f87171'}}>End Session</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
