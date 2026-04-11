'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: '#0a0e1a',
        backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(56,189,248,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(167,139,250,0.08) 0%, transparent 50%)',
      }}>
      <div style={{
        background: 'rgba(17,24,39,0.8)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 40px rgba(56,189,248,0.05)',
      }} className="rounded-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-tight"
            style={{background:'linear-gradient(135deg, #38bdf8, #818cf8, #a78bfa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            KTC EGYPT USA
          </h1>
          <p style={{color:'rgba(148,163,184,0.5)'}} className="text-sm mt-1 tracking-widest uppercase">Operational HUB</p>
        </div>
        <div onSubmit={handleLogin}>
          <div className="mb-4">
            <label style={{color:'rgba(148,163,184,0.7)'}} className="block text-sm font-semibold mb-1.5">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',color:'#f1f5f9'}}
              className="w-full px-4 py-3 rounded-lg outline-none"
              placeholder="you@ktcegypt.com" required />
          </div>
          <div className="mb-6">
            <label style={{color:'rgba(148,163,184,0.7)'}} className="block text-sm font-semibold mb-1.5">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',color:'#f1f5f9'}}
              className="w-full px-4 py-3 rounded-lg outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin(e)}
              placeholder="••••••••" required />
          </div>
          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm" style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',color:'#fca5a5'}}>
              {error}
            </div>
          )}
          <button onClick={handleLogin} disabled={loading}
            style={{background:'linear-gradient(135deg, #0ea5e9, #6366f1)',boxShadow:'0 4px 20px rgba(56,189,248,0.35)'}}
            className="w-full py-3.5 text-white font-bold rounded-lg transition disabled:opacity-50 text-base">
            {loading ? 'Signing in...' : 'Sign In / تسجيل الدخول'}
          </button>
        </div>
      </div>
    </div>
  );
}
