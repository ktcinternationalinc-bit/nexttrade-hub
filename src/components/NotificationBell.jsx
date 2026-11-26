'use client';
import { useState, useEffect, useCallback } from 'react';
import { hubFetch } from '../lib/hub-fetch'; // v55.83-ZM — the bell goes through /api/notifications (signed-in person, own rows only)

export default function NotificationBell({ userId, users }) {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      // v55.83-ZM — read through the server: the browser no longer touches public.notifications (its allow_all policy is being closed)
      const res = await hubFetch('/api/notifications');
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) return; // keep what is shown; the next minute tries again
      const data = j.notifications || [];
      setNotifications(data);
      setUnread(data.filter(n => n.read !== true).length);
    } catch (e) { /* table may not exist yet */ }
  }, [userId]);

  useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, [load]);

  const markRead = async (id) => {
    await hubFetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_read', ids: [id] }) }).catch(() => null); // ZM: own rows only, on the server
    load();
  };

  const markAllRead = async () => {
    const ids = notifications.filter(n => n.read !== true).map(n => n.id);
    if (ids.length > 0) {
      await hubFetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_read', ids: ids }) }).catch(() => null);
      load();
    }
  };

  const getIcon = (type) => {
    const icons = { invoice: '💰', payment: '✅', ticket: '🎫', shipping: '🚢', reminder: '⏰', crm: '🤝', admin: '⚙️', alert: '🚨' };
    return icons[type] || '📋';
  };

  const timeAgo = (ts) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    return Math.floor(hrs / 24) + 'd';
  };

  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
        className="px-2.5 py-1.5 rounded-lg text-sm hover:bg-white/10 transition relative">
        🔔
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 w-80 bg-white rounded-xl shadow-2xl border z-[151] overflow-hidden"
            style={{ maxHeight: '70vh' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
              <span className="text-sm font-extrabold">Notifications</span>
              <div className="flex gap-2">
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-blue-500 font-semibold">
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-slate-400 text-xs">✕</button>
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
              {notifications.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-400">No notifications yet</div>
              ) : notifications.map(n => (
                <div key={n.id}
                  className={`px-4 py-3 border-b border-slate-50 hover:bg-blue-50 cursor-pointer transition ${n.read !== true ? 'bg-blue-50/50' : ''}`}
                  onClick={() => markRead(n.id)}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg mt-0.5">{getIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800">{n.title}</div>
                      {n.body && <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</div>}
                      <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2">
                        <span>{timeAgo(n.created_at)}</span>

                        {n.read !== true && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
