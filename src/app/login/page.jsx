'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // v55.38 FIX (Emad bounce-out, locale/translate hydration crash):
  // time MUST start as null. If we use `new Date()` here, the server
  // renders one timestamp and the client renders a different one
  // (Arabic locale, Egypt time, Chrome auto-translate, etc.) — that
  // mismatch crashes React hydration with errors #425/#418/#423 and
  // the whole app refuses to start. We let the server render a
  // placeholder, then fill the time in after the browser has mounted.
  const [time, setTime] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [clockedIn, setClockedIn] = useState(false);
  const [userName, setUserName] = useState('');
  const [particles, setParticles] = useState([]);
  const canvasRef = useRef(null);

  // Live clock — first render happens AFTER mount, on the client only.
  useEffect(() => {
    setMounted(true);
    setTime(new Date());
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Animated network background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let dots = [];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    for (let i = 0; i < 50; i++) {
      dots.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 0.5, a: Math.random() * 0.25 + 0.05,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dots.forEach(d => {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > canvas.width) d.vx *= -1;
        if (d.y < 0 || d.y > canvas.height) d.vy *= -1;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56,189,248,' + d.a + ')'; ctx.fill();
      });
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            ctx.beginPath(); ctx.moveTo(dots[i].x, dots[i].y); ctx.lineTo(dots[j].x, dots[j].y);
            ctx.strokeStyle = 'rgba(56,189,248,' + (0.05 * (1 - dist / 140)) + ')'; ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  const getGreeting = (d) => {
    if (!d) return { text: 'Welcome', emoji: '👋', ar: 'أهلاً' };
    const h = d.getHours();
    if (h < 6) return { text: 'Working Late', emoji: '🌙', ar: 'سهران؟' };
    if (h < 12) return { text: 'Good Morning', emoji: '☀️', ar: 'صباح الخير' };
    if (h < 17) return { text: 'Good Afternoon', emoji: '🌤️', ar: 'مساء الخير' };
    if (h < 21) return { text: 'Good Evening', emoji: '🌆', ar: 'مساء النور' };
    return { text: 'Night Shift', emoji: '🌙', ar: 'وردية ليلية' };
  };

  // Force en-US locale so Arabic-locale browsers don't render Arabic numerals,
  // which would cause a hydration mismatch on its own.
  const fmt = (d) => {
    if (!d) return '--:--:--';
    try {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    } catch (_) { return '--:--:--'; }
  };
  const fmtDate = (d) => {
    if (!d) return '';
    try {
      return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) { return ''; }
  };
  const greeting = getGreeting(time);

  const spawnBurst = () => {
    const p = [];
    for (let i = 0; i < 30; i++) {
      const angle = (Math.PI * 2 * i) / 30;
      const speed = 2 + Math.random() * 3;
      p.push({ id: i, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color: ['#38bdf8','#818cf8','#a78bfa','#34d399','#fbbf24'][i % 5] });
    }
    setParticles(p);
    setTimeout(() => setParticles([]), 1500);
  };

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!email || !password) { setError('Enter email and password'); return; }
    setLoading(true); setError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      let name = email.split('@')[0];
      // v55.83-A.6.27.60 — Profile lookup now blocks deactivated users.
      // Previously "Deactivate" in Settings only set users.active=false but did
      // NOT block login (auth.users was untouched). This check enforces the
      // deactivation at the app layer: if profile.active === false, sign out
      // immediately and show a clear error.
      // ALSO: session insert is now skipped when no profile.id is found
      // (previously fell back to data.user.id which is the auth UUID — a
      // different value from users.id — silently breaking Admin tab stats).
      if (data?.user) {
        try {
          const lookupEmail = (email || '').toLowerCase().trim();
          const { data: profile } = await supabase
            .from('users')
            .select('id, name, active')
            .ilike('email', lookupEmail)
            .maybeSingle();

          // v55.83-A.6.27.60 — Hard block: deactivated users CANNOT log in.
          if (profile && profile.active === false) {
            try { await supabase.auth.signOut(); } catch (_) {}
            setError('Your account has been deactivated. Contact your administrator to restore access.');
            setLoading(false);
            return;
          }

          if (profile?.name) name = profile.name;

          // Only insert session if we found the profile.id. Skipping when
          // missing is better than inserting a row with the wrong user_id
          // that would silently never show up in Admin tab.
          if (profile?.id) {
            await supabase.from('user_sessions').insert({
              user_id: profile.id,
              login_at: new Date().toISOString(),
              last_seen: new Date().toISOString(),
              date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
            });
          } else {
            try { console.warn('[login] no users.id found for ' + lookupEmail + ' — session NOT tracked. Add user to public.users table.'); } catch(_){}
          }
        } catch (profileErr) {
          try { console.warn('[login] profile lookup soft-fail:', profileErr?.message || profileErr); } catch(_){}
        }
      }
      setUserName(name); setClockedIn(true); spawnBurst();
      setTimeout(() => { window.location.href = '/'; }, 2400);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden notranslate" translate="no" style={{ background: '#060a14' }}>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ zIndex: 0 }} />
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(56,189,248,0.07) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(167,139,250,0.05) 0%, transparent 50%)',
        zIndex: 1 }} />

      {/* Burst particles */}
      {particles.length > 0 && <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
        {particles.map(p => <div key={p.id} style={{
          position:'absolute', left:'50%', top:'50%', width:6, height:6, borderRadius:'50%',
          background:p.color, boxShadow:'0 0 10px ' + p.color,
          transform:'translate(' + (p.vx*50) + 'px, ' + (p.vy*50) + 'px)',
          animation:'burstOut 1.2s ease-out forwards', animationDelay:(p.id*20) + 'ms',
        }} />)}
      </div>}

      <style>{`
        @keyframes burstOut { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(var(--tx),var(--ty)) scale(0);opacity:0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes stampIn { 0%{transform:scale(3) rotate(-12deg);opacity:0} 50%{transform:scale(1.05) rotate(2deg);opacity:1} 100%{transform:scale(1) rotate(0)} }
        @keyframes pulse2 { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes cardGlow { 0%{box-shadow:0 25px 60px rgba(0,0,0,0.5),0 0 0px rgba(52,211,153,0)} 100%{box-shadow:0 25px 60px rgba(0,0,0,0.5),0 0 60px rgba(52,211,153,0.2)} }
        .login-card { animation: slideUp 0.6s ease-out; }
        .clocked-card { animation: cardGlow 0.8s ease-out forwards; }
        .stamp { animation: stampIn 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        .sec-tick { animation: pulse2 1s steps(1) infinite; }
      `}</style>

      <div className={clockedIn ? 'clocked-card' : 'login-card'} style={{
        background: clockedIn ? 'rgba(12,18,32,0.9)' : 'rgba(12,18,32,0.85)',
        backdropFilter: 'blur(24px)',
        border: '1px solid ' + (clockedIn ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.06)'),
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        zIndex: 5, position: 'relative', transition: 'border-color 0.5s',
      }} className="rounded-3xl p-8 w-full max-w-md">

        {!clockedIn ? (<>
          {/* Logo + greeting */}
          <div className="text-center mb-5">
            {/* Emoji is locale-stable, but we still suppress hydration warnings
                for safety in case Chrome auto-translate gets to it. */}
            <div className="text-4xl mb-2" suppressHydrationWarning>{greeting.emoji}</div>
            <h1 className="text-3xl font-black tracking-tight mb-0.5"
              style={{ background:'linear-gradient(135deg,#38bdf8,#818cf8,#a78bfa)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              KANDIL KTC
            </h1>
            <p style={{ color:'rgba(148,163,184,0.35)' }} className="text-[9px] tracking-[0.3em] uppercase">Egypt — USA Operations Hub</p>
          </div>

          {/* Live clock — only renders after mount, so server and client agree
              on the initial "--:--:--" placeholder. No hydration mismatch. */}
          <div className="text-center mb-5" suppressHydrationWarning>
            <div className="text-[11px] font-medium mb-0.5" style={{ color:'rgba(148,163,184,0.5)' }}>
              {greeting.text} / {greeting.ar}
            </div>
            <div className="font-mono text-2xl font-bold" style={{ color:'#f1f5f9', letterSpacing:'0.06em' }}>
              {mounted && time ? (
                fmt(time).split(':').map((p, i) => (
                  <span key={i}>{i > 0 && <span className="sec-tick" style={{ color:'rgba(56,189,248,0.6)' }}>:</span>}{p}</span>
                ))
              ) : (
                <span style={{ opacity: 0.4 }}>--:--:--</span>
              )}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color:'rgba(148,163,184,0.3)', minHeight: 14 }}>
              {mounted && time ? fmtDate(time) : '\u00A0'}
            </div>
          </div>

          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px" style={{ background:'rgba(255,255,255,0.06)' }} />
            <span className="text-[8px] tracking-[0.25em] uppercase" style={{ color:'rgba(148,163,184,0.25)' }}>Clock In / تسجيل</span>
            <div className="flex-1 h-px" style={{ background:'rgba(255,255,255,0.06)' }} />
          </div>

          <div className="mb-3.5">
            <label style={{ color:'rgba(148,163,184,0.5)' }} className="block text-[10px] font-semibold mb-1 uppercase tracking-wider">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'#f1f5f9' }}
              className="w-full px-4 py-3 rounded-xl outline-none text-sm" placeholder="you@ktcus.com" />
          </div>
          <div className="mb-5">
            <label style={{ color:'rgba(148,163,184,0.5)' }} className="block text-[10px] font-semibold mb-1 uppercase tracking-wider">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'#f1f5f9' }}
              className="w-full px-4 py-3 rounded-xl outline-none text-sm"
              onKeyDown={e => e.key === 'Enter' && handleLogin(e)} placeholder="••••••••" />
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl text-xs flex items-center gap-2"
              style={{ background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.12)', color:'#fca5a5' }}>
              ⚠️ {error}
            </div>
          )}

          <button onClick={handleLogin} disabled={loading}
            style={{
              background: loading ? 'rgba(255,255,255,0.04)' : 'linear-gradient(135deg,#0ea5e9,#6366f1)',
              boxShadow: loading ? 'none' : '0 4px 24px rgba(56,189,248,0.25)',
            }}
            className="w-full py-3.5 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm tracking-wider uppercase">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white/20 border-t-white rounded-full" style={{ animation:'spin 0.7s linear infinite' }} />
                Authenticating...
              </span>
            ) : '🕐  Clock In / تسجيل الحضور'}
          </button>

          <p className="text-center mt-5" style={{ color:'rgba(148,163,184,0.15)' }}>
            <span className="text-[8px] tracking-wider">KTC International Inc. — Trading & Import Operations</span>
          </p>
        </>) : (
          /* ===== CLOCKED IN ===== */
          <div className="text-center py-2" style={{ animation:'fadeIn 0.3s ease-out' }} suppressHydrationWarning>
            <div className="stamp mb-4">
              <div style={{
                width:90, height:90, borderRadius:'50%',
                border:'3px solid #34d399',
                display:'flex', alignItems:'center', justifyContent:'center',
                margin:'0 auto',
                boxShadow:'0 0 30px rgba(52,211,153,0.25), inset 0 0 15px rgba(52,211,153,0.08)',
                background:'rgba(52,211,153,0.04)',
              }}>
                <span style={{ fontSize:40, color:'#34d399' }}>✓</span>
              </div>
            </div>

            <h2 className="text-xl font-black mb-0.5" style={{ color:'#34d399' }}>Clocked In!</h2>
            <p className="text-sm mb-4" style={{ color:'rgba(148,163,184,0.5)' }}>
              Welcome, <span style={{ color:'#f1f5f9', fontWeight:700 }}>{userName}</span>
            </p>

            <div style={{ background:'rgba(52,211,153,0.05)', border:'1px solid rgba(52,211,153,0.12)' }} className="rounded-xl p-4 mb-4">
              <div className="font-mono text-3xl font-bold mb-0.5" style={{ color:'#f1f5f9' }}>{fmt(time)}</div>
              <div className="text-[10px]" style={{ color:'rgba(148,163,184,0.4)' }}>{fmtDate(time)}</div>
              <div className="mt-2 inline-block px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider"
                style={{ background:'rgba(52,211,153,0.1)', color:'#34d399', border:'1px solid rgba(52,211,153,0.2)' }}>
                Session Started
              </div>
            </div>

            <div className="flex items-center justify-center gap-1.5" style={{ color:'rgba(148,163,184,0.35)' }}>
              <span className="sec-tick" style={{ color:'#34d399', fontSize:7 }}>●</span>
              <span className="text-[11px]">Loading workspace...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
