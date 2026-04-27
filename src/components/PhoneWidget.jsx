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
  // endCall is defined further down (it depends on state setters), but it
  // gets referenced from inside Twilio event callbacks set up earlier.
  // We hold it in a ref so the callbacks always reach the latest version
  // without any source-order dependency or stale-closure bugs.
  const endCallRef = useRef(() => {});
  const myId = userProfile?.id || user?.id;

  // Load call logs and phone numbers
  const loadData = useCallback(async () => {
    try {
      const [{ data: l }, { data: n }] = await Promise.all([
        supabase.from('phone_calls').select('*').eq('user_id', myId).order('started_at', { ascending: false }).limit(50),
        supabase.from('phone_numbers').select('*').order('created_at'),
      ]);
      setLogs(l || []);
      setPhoneNumbers(n || []);
      const mine = (n || []).find(p => p.assigned_to === myId);
      setMyNumber(mine?.phone_number || null);
    } catch (e) {}
  }, [myId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Initialize Twilio Voice SDK v2 Device.
  //
  // Major changes vs v1 (which we used previously):
  //   • Different URL — /js/voice/releases/2.x.x/ not /js/client/...
  //   • Device is created with a Token, then call .register()
  //   • Token expiry handled via 'tokenWillExpire' event
  //   • Incoming call object is named 'Call' not 'Connection' but the event
  //     is still 'incoming'
  //
  // We always init when there's a logged-in user — even if they have no
  // assigned phone number. They might still need to receive incoming calls
  // through their browser if someone <Dial><Client>uuid</Client></Dial>'s them.
  const initDevice = useCallback(async () => {
    if (deviceRef.current) return;
    if (typeof window === 'undefined') return;
    if (!myId) return;

    try {
      // 1. Load the Twilio Voice SDK v2 (much newer than v1.14 we had before)
      if (!window.Twilio?.Device) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          // Voice SDK v2 — actively maintained, supports modern browsers, WebRTC
          s.src = 'https://sdk.twilio.com/js/voice/releases/2.10.2/twilio.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      // 2. Get an access token from our backend.
      //    We pass the Supabase session token in the Authorization header
      //    so the backend can verify which user is requesting the token
      //    and reject anonymous or impersonation attempts.
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes?.data?.session?.access_token || '';
      const res = await fetch('/api/phone/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': accessToken ? 'Bearer ' + accessToken : '',
        },
        body: JSON.stringify({ user_id: myId }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      // 3. Create the Device with v2 API
      const device = new window.Twilio.Device(data.token, {
        codecPreferences: ['opus', 'pcmu'],
        // Sound options
        sounds: {
          incoming: undefined, // use default ringtone
        },
        // Allow incoming when device registers
        allowIncomingWhileBusy: false,
        logLevel: 1, // 1 = errors only; bump higher for debugging
      });

      // 4. Wire up events. v2 uses 'registered' / 'unregistered' / 'tokenWillExpire'
      device.on('registered', () => { console.warn('📞 Twilio Device registered — ready to receive calls'); });
      device.on('unregistered', () => { console.warn('📞 Twilio Device unregistered'); });
      device.on('error', (err) => {
        // err.message and err.code in v2
        var msg = (err && err.message) ? err.message : String(err);
        setError('Phone error: ' + msg);
        console.error('📞 Twilio Device error:', err);
      });

      // Token will expire in 5 min — refresh it. Critical for keeping the
      // device alive past the 1-hour token TTL.
      device.on('tokenWillExpire', async () => {
        try {
          const sessionRes2 = await supabase.auth.getSession();
          const accessToken2 = sessionRes2?.data?.session?.access_token || '';
          const r2 = await fetch('/api/phone/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': accessToken2 ? 'Bearer ' + accessToken2 : '',
            },
            body: JSON.stringify({ user_id: myId }),
          });
          const d2 = await r2.json();
          if (d2.token) {
            device.updateToken(d2.token);
            console.warn('📞 Token refreshed');
          }
        } catch (e) {
          console.error('📞 Token refresh failed:', e);
        }
      });

      // Incoming call — in v2 it's a Call object not a Connection
      device.on('incoming', (call) => {
        connectionRef.current = call;
        const from = (call.parameters && call.parameters.From) || 'Unknown';
        // Try to match caller to customer by last 10 digits
        const digitsOnly = String(from).replace(/\D/g, '').slice(-10);
        const customer = (customers || []).find(c => c.phone && String(c.phone).replace(/\D/g, '').includes(digitsOnly));
        setIncomingCaller({ number: from, name: customer?.customer || customer?.name || null });
        setCallState('incoming');
        setOpen(true);

        call.on('disconnect', () => { endCallRef.current(); });
        call.on('cancel',     () => { setCallState('idle'); setIncomingCaller(null); connectionRef.current = null; });
        call.on('reject',     () => { setCallState('idle'); setIncomingCaller(null); connectionRef.current = null; });
      });

      // 5. Register so we can RECEIVE calls. (Without this, only outbound works.)
      await device.register();

      deviceRef.current = device;
    } catch (e) {
      setError('Phone init failed: ' + (e.message || String(e)));
      console.error('Phone init error:', e);
    }
  }, [myId, customers]);

  // Init when the user actually opens the widget. We deliberately do NOT
  // auto-init on page load anymore. Reasons:
  //
  //   1. device.register() can throw if microphone is blocked, Twilio env
  //      vars aren't configured, or the access token can't be obtained.
  //      An unhandled throw on every page load would take down the whole
  //      dashboard (logout button, sidebar, everything) for users who
  //      can't or don't want to use the phone system.
  //
  //   2. The microphone permission prompt is jarring as a side-effect of
  //      opening the dashboard. Users should only see it after they've
  //      explicitly chosen to use the phone (e.g. clicked the phone icon).
  //
  // Trade-off: incoming calls won't ring in the browser until the user
  // opens the widget at least once per session. For now that's acceptable —
  // cell forwarding still rings their phone. We can revisit once browser
  // dialing is fully validated.
  useEffect(() => {
    // Cleanup on unmount or user change. We don't init here.
    return () => {
      try {
        if (deviceRef.current) {
          deviceRef.current.destroy();
          deviceRef.current = null;
        }
      } catch (e) { /* ignore */ }
    };
  }, [myId]);

  // Init lazily when the user opens the widget for the first time.
  // initDevice itself is idempotent (early-returns if deviceRef is set)
  // so calling it multiple times is safe.
  useEffect(() => {
    if (open && myId && !deviceRef.current) {
      initDevice();
    }
  }, [open, myId, initDevice]);

  // Make outbound call. SDK v2 differences from v1:
  //   • device.connect() returns a Promise<Call>, not a Connection directly
  //   • params go in { params: { To, From } } not directly
  //   • Call uses 'accept' not 'accept' (same name actually) but the
  //     event firing pattern is slightly different
  const makeCall = async (phoneNum) => {
    if (!deviceRef.current) {
      setError('Phone not connected. Wait for "registered" or check microphone permissions.');
      return;
    }
    const num = (phoneNum || number).replace(/[^\d+]/g, '');
    if (!num) return;

    setCallState('connecting');
    try {
      // v2 connect() takes an options object and returns a Promise
      const call = await deviceRef.current.connect({
        params: {
          To: num,
          // CallerId comes from outbound TwiML lookup, no need to pass here
        },
      });
      connectionRef.current = call;

      call.on('ringing', () => { setCallState('ringing'); });
      call.on('accept', () => {
        setCallState('active');
        setCallDuration(0);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
      });
      call.on('disconnect', () => { endCallRef.current(); });
      call.on('error', (err) => {
        setError((err && err.message) ? err.message : 'Call error');
        endCallRef.current();
      });
    } catch (e) {
      setError('Call failed: ' + (e.message || String(e)));
      setCallState('idle');
    }
  };

  // Answer incoming call (v2 — same `accept()` method)
  const answerCall = () => {
    if (connectionRef.current) {
      connectionRef.current.accept();
      setCallState('active');
      setCallDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
  };

  // Reject incoming
  const rejectCall = () => {
    if (connectionRef.current) {
      try { connectionRef.current.reject(); } catch (e) { /* might already be rejected */ }
    }
    setCallState('idle');
    setIncomingCaller(null);
    connectionRef.current = null;
  };

  // End call (works for both incoming and outgoing in v2).
  // We also write this to endCallRef so async Twilio callbacks set up
  // earlier (e.g. inside initDevice) can reach the latest version
  // without depending on JavaScript declaration order.
  const endCall = () => {
    if (connectionRef.current) {
      try { connectionRef.current.disconnect(); } catch (e) { console.warn('disconnect error:', e); }
    }
    connectionRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    setCallState('idle');
    setCallDuration(0);
    setIncomingCaller(null);
    setMuted(false);
    loadData();
  };
  // Keep the ref pointing at the freshest endCall every render so the
  // callbacks set up inside Twilio Device events always see the latest
  // state (e.g. so loadData closes over the current myId).
  endCallRef.current = endCall;

  // Toggle mute (v2 — same `mute()` method)
  const toggleMute = () => {
    if (connectionRef.current) {
      try {
        connectionRef.current.mute(!muted);
        setMuted(!muted);
      } catch (e) { /* call may have ended */ }
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
      {/* Floating phone button — moved to LEFT side to stop obstructing
          action buttons on the right side of cards (calendar check-in,
          ticket action buttons, FAB). Smaller footprint. */}
      <button onClick={() => setOpen(!open)}
        className="fixed bottom-6 left-20 w-12 h-12 rounded-full bg-green-500 text-white text-xl shadow-xl z-50 flex items-center justify-center hover:bg-green-600 transition"
        style={{ boxShadow: '0 4px 20px rgba(34,197,94,0.4)' }}
        title="Phone">
        📞
        {callState === 'active' && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse" />}
      </button>

      {/* Phone panel — anchored to the left now, matching the button */}
      {open && (
        <div className="fixed bottom-20 left-4 w-80 bg-white rounded-2xl shadow-2xl z-50 overflow-hidden border" style={{ maxHeight: '70vh' }}>
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
                const contactName = getContactName(l.customer_number);
                return (
                  <div key={l.id} className="flex items-center justify-between p-3 border-b hover:bg-slate-50 cursor-pointer" onClick={() => { setNumber(l.customer_number); setTab('dial'); }}>
                    <div className="flex items-center gap-2">
                      <span className={l.direction === 'inbound' ? 'text-blue-500' : 'text-green-500'}>{l.direction === 'inbound' ? '📥' : '📤'}</span>
                      <div>
                        <div className="text-xs font-semibold">{contactName || fmtPhone(l.customer_number)}</div>
                        {contactName && <div className="text-[10px] text-slate-400">{fmtPhone(l.customer_number)}</div>}
                        <div className="text-[10px] text-slate-400">{new Date(l.started_at).toLocaleString()}{l.duration_seconds ? ` • ${fmtDuration(l.duration_seconds)}` : ''}</div>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setNumber(l.customer_number); makeCall(l.customer_number); }}
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
