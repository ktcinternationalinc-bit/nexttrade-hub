'use client';
import { useState } from 'react';

export default function EmailComposer({ to, subject, body, cc, onClose, onSent, userId, senderName }) {
  const [form, setForm] = useState({
    to: to || '',
    subject: subject || '',
    body: body || '',
    cc: cc || '',
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const handleSend = async () => {
    if (!form.to || !form.subject || !form.body) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: form.to.split(',').map(e => e.trim()).filter(Boolean),
          subject: form.subject,
          body: form.body,
          cc: form.cc ? form.cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
          senderName: senderName || 'KTC International',
          userId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ ok: false, msg: data.error });
      } else {
        setResult({ ok: true, msg: 'Email sent to ' + form.to });
        if (onSent) onSent(data);
      }
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] my-8 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 flex justify-between items-center">
          <div>
            <h3 className="text-white font-bold text-base">✉️ Compose Email</h3>
            <p className="text-blue-200 text-[10px]">Sent from your @ktcus.com address via Resend</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl">×</button>
        </div>

        <div className="p-5 space-y-3">
          {/* To */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">To</label>
            <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value })}
              placeholder="email@example.com (comma-separate multiple)"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-0.5 focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition" />
          </div>

          {/* CC */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">CC <span className="font-normal">(optional)</span></label>
            <input value={form.cc} onChange={e => setForm({ ...form, cc: e.target.value })}
              placeholder="cc@example.com"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-0.5" />
          </div>

          {/* Subject */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Subject</label>
            <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold mt-0.5 focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition" />
          </div>

          {/* Body */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Message</label>
            <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
              rows={10}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-0.5 leading-relaxed focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition" />
          </div>

          {/* Result */}
          {result && (
            <div className={`px-3 py-2 rounded-lg text-sm font-semibold ${result.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {result.ok ? '✅ ' : '❌ '}{result.msg}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button onClick={handleSend} disabled={sending || !form.to || !form.subject || !form.body}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition"
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', boxShadow: '0 4px 15px rgba(56,189,248,0.3)' }}>
              {sending ? '⏳ Sending...' : '📨 Send Email'}
            </button>
            <button onClick={onClose}
              className="px-5 py-3 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
