'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const DIAL_KEYS = [['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']];

export default function PhoneWidget({ user, userProfile, users, customers }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('dial'); // dial | log | settings
  const [number, setNumber] = useState('');
  const [callState, setCallState] = useState('idle'); // idle | connecting | active | incoming | ringing
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCaller, setIncomingCaller] = useState(null);
  const [logs, setLogs] = useState([]);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [myNumber, setMyNumber] = useState(null);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);

  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const timerRef = useRef(null);
  const myId = userProfile?.id || user?.id;

  // Load call logs and phone numbers
  const loadData = useCallback(async () => {
    try {
      const [{ data: l }, { data: n }] = await Promise.all([
        supabase.from('call_logs').select('*').eq('user_id', myId).order('called_at', { ascending: false }).limit(50),
        supabase.from('phone_numbers').select('*').order('created_at'),
      ]);
      setLogs(l || []);
      setPhoneNumbers(n || []);
      const mine = (n || []).find(p => p.assigned_to === myId);
      setMyNumber(mine?.phone_number || null);
    } catch (e) {}
  }, [myId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Initialize Twilio Device
  const initDevice = useCallback(async () => {
    if (deviceRef.current) return;
    if (typeof window === 'undefined') return;

    try {
      // Load Twilio Client JS SDK
      if (!window.Twilio?.Device) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://sdk.twilio.com/js/client/releases/1.14.0/twilio.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const res = await fetch('/api/phone/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: myId }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      const device = new window.Twilio.Device(data.token, {
        codecPreferences: ['opus', 'pcmu'],
        enableRingingState: true,
      });

      device.on('ready', () => { console.warn('📞 Twilio Device ready'); });
      device.on('error', (err) => { setError(err.message); setCallState('idle'); });

      device.on('incoming', (conn) => {
        connectionRef.current = conn;
        const from = conn.parameters.From || 'Unknown';
        // Try to match caller to customer
        const customer = (customers || []).find(c => c.phone && from.includes(c.phone.replace(/\D/g, '').slice(-10)));
        setIncomingCaller({ number: from, name: customer?.customer || customer?.name || null });
        setCallState('incoming');
        setOpen(true);

        conn.on('disconnect', () => { endCall(); });
        conn.on('cancel', () => { setCallState('idle'); setIncomingCaller(null); });
      });

      device.on('disconnect', () => { endCall(); });

      deviceRef.current = device;
    } catch (e) { setError('Phone init failed: ' + e.message); }
  }, [myId, customers]);

  useEffect(() => {
    if (myNumber) initDevice();
  }, [myNumber, initDevice]);

  // Make call
  const makeCall = (phoneNum) => {
    if (!deviceRef.current) { setError('Phone not connected. Check Twilio settings.'); return; }
    const num = (phoneNum || number).replace(/[^\d+]/g, '');
    if (!num) return;

    setCallState('connecting');
    const conn = deviceRef.current.connect({ To: num, CallerId: myNumber });
    connectionRef.current = conn;

    conn.on('ringing', () => { setCallState('ringing'); });
    conn.on('accept', () => {
      setCallState('active');
      setCallDuration(0);
      timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    });
    conn.on('disconnect', () => { endCall(); });
    conn.on('error', (err) => { setError(err.message); endCall(); });

    // Log outbound call
    fetch('/api/phone/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: myId, phone_number: num, direction: 'outbound', status: 'initiated' }),
    });
  };

  // Answer incoming
  const answerCall = () => {
    if (connectionRef.current) {
      connectionRef.current.accept();
      setCallState('active');
      setCallDuration(0);
      timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
  };

  // Reject incoming
  const rejectCall = () => {
    if (connectionRef.current) connectionRef.current.reject();
    setCallState('idle');
    setIncomingCaller(null);
  };

  // End call
  const endCall = () => {
    if (connectionRef.current) { try { connectionRef.current.disconnect(); } catch(e) { console.warn(e); } }
    connectionRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // Log duration
    if (callDuration > 0) {
      fetch('/api/phone/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: myId, phone_number: number, direction: 'outbound', status: 'completed', duration: callDuration }),
      });
    }

    setCallState('idle');
    setCallDuration(0);
    setIncomingCaller(null);
    setMuted(false);
    loadData();
  };

  // Toggle mute
  const toggleMute = () => {
    if (connectionRef.current) {
      connectionRef.current.mute(!muted);
      setMuted(!muted);
    }
  };

  const fmtDuration = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const fmtPhone = (n) => n || '';
  const getContactName = (phone) => {
    const c = (customers || []).find(c => c.phone && phone && phone.includes(c.phone.replace(/\D/g, '').slice(-10)));
    return c?.customer || c?.name || null;
  };
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';

  // Incoming call overlay
  if (callState === 'incoming' && incomingCaller) {
    return (
      <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl">
          <div className="text-5xl mb-4 animate-pulse">📞</div>
          <div className="text-lg font-black">Incoming Call</div>
          {incomingCaller.name && <div className="text-xl font-bold text-blue-600 mt-1">{incomingCaller.name}</div>}
          <div className="text-sm text-slate-500 mt-1">{incomingCaller.number}</div>
          <div className="flex gap-4 justify-center mt-6">
            <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500 text-white text-2xl flex items-center justify-center shadow-lg">✕</button>
            <button onClick={answerCall} className="w-16 h-16 rounded-full bg-green-500 text-white text-2xl flex items-center justify-center shadow-lg animate-bounce">📞</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating phone button */}
      <button onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-green-500 text-white text-2xl shadow-xl z-50 flex items-center justify-center hover:bg-green-600 transition"
        style={{ boxShadow: '0 4px 20px rgba(34,197,94,0.4)' }}>
        📞
        {callState === 'active' && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse" />}
      </button>

      {/* Phone panel */}
      {open && (
        <div className="fixed bottom-24 right-4 w-80 bg-white rounded-2xl shadow-2xl z-50 overflow-hidden border" style={{ maxHeight: '70vh' }}>
          {/* Header */}
          <div className="bg-slate-900 text-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-bold text-sm">📞 KTC Phone</div>
                <div className="text-[10px] text-slate-400">{myNumber || 'No number assigned'}</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 text-lg">✕</button>
            </div>
            {/* Active call bar */}
            {callState === 'active' && (
              <div className="mt-2 bg-green-600 rounded-lg p-2 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold">On Call</div>
                  <div className="text-lg font-black">{fmtDuration(callDuration)}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={toggleMute} className={'w-8 h-8 rounded-full text-sm flex items-center justify-center ' + (muted ? 'bg-red-500' : 'bg-white/20')}>{muted ? '🔇' : '🎤'}</button>
                  <button onClick={endCall} className="w-8 h-8 rounded-full bg-red-500 text-sm flex items-center justify-center">📵</button>
                </div>
              </div>
            )}
            {callState === 'connecting' && <div className="mt-2 text-xs text-amber-400 animate-pulse">Connecting...</div>}
            {callState === 'ringing' && <div className="mt-2 text-xs text-blue-400 animate-pulse">Ringing...</div>}
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-[10px] p-2">{error} <button onClick={() => setError('')} className="underline ml-1">dismiss</button></div>
          )}

          {/* Tabs */}
          <div className="flex border-b">
            {[['dial', '⌨️ Dial'], ['log', '📋 Log']].map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)} className={'flex-1 py-2 text-xs font-semibold ' + (tab === v ? 'border-b-2 border-blue-500 text-blue-600' : 'text-slate-400')}>{l}</button>
            ))}
          </div>

          {/* Dial pad */}
          {tab === 'dial' && (
            <div className="p-4">
              <input value={number} onChange={e => setNumber(e.target.value)} placeholder="+1 (555) 123-4567"
                className="w-full text-center text-xl font-bold border-b-2 border-slate-200 pb-2 mb-3 outline-none" />
              <div className="grid grid-cols-3 gap-2 mb-3">
                {DIAL_KEYS.flat().map(k => (
                  <button key={k} onClick={() => setNumber(n => n + k)}
                    className="py-3 rounded-lg bg-slate-50 text-lg font-bold hover:bg-slate-100 transition">{k}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setNumber(n => n.slice(0, -1))} className="flex-1 py-3 rounded-lg bg-slate-100 text-sm font-semibold">⌫ Delete</button>
                <button onClick={() => makeCall()} disabled={!number || callState !== 'idle'}
                  className="flex-1 py-3 rounded-lg bg-green-500 text-white font-bold text-sm disabled:opacity-50">📞 Call</button>
              </div>
            </div>
          )}

          {/* Call log */}
          {tab === 'log' && (
            <div className="max-h-[400px] overflow-auto">
              {logs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">No calls yet</div>
              ) : logs.map(l => {
                const contactName = getContactName(l.phone_number);
                return (
                  <div key={l.id} className="flex items-center justify-between p-3 border-b hover:bg-slate-50 cursor-pointer" onClick={() => { setNumber(l.phone_number); setTab('dial'); }}>
                    <div className="flex items-center gap-2">
                      <span className={l.direction === 'inbound' ? 'text-blue-500' : 'text-green-500'}>{l.direction === 'inbound' ? '📥' : '📤'}</span>
                      <div>
                        <div className="text-xs font-semibold">{contactName || fmtPhone(l.phone_number)}</div>
                        {contactName && <div className="text-[10px] text-slate-400">{fmtPhone(l.phone_number)}</div>}
                        <div className="text-[10px] text-slate-400">{new Date(l.called_at).toLocaleString()}{l.duration ? ` • ${fmtDuration(l.duration)}` : ''}</div>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setNumber(l.phone_number); makeCall(l.phone_number); }}
                      className="text-green-500 text-sm">📞</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
