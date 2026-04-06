'use client';
import { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';

export default function AdminTab({ user, users }) {
  const [logs, setLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selUser, setSelUser] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().substring(0, 10);
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().substring(0, 10));

  const loadData = async () => {
    const [l, t] = await Promise.all([
      supabase.from('daily_log').select('*').gte('log_date', dateFrom).lte('log_date', dateTo).order('created_at', { ascending: false }),
      supabase.from('tickets').select('*'),
    ]);
    setLogs(l.data || []);
    setTickets(t.data || []);
    setLoaded(true);
  };

  if (!loaded) loadData();

  // Reload when date range changes
  const handleDateChange = (field, value) => {
    if (field === 'from') setDateFrom(value);
    else setDateTo(value);
    setLoaded(false);
  };

  const scorecards = useMemo(() => {
    if (!users) return [];
    return users.map(u => {
      const userLogs = logs.filter(l => l.user_id === u.id);
      const autoCount = userLogs.filter(l => l.auto_generated).length;
      const manualCount = userLogs.filter(l => !l.auto_generated).length;
      const uniqueDays = [...new Set(userLogs.map(l => l.log_date))].length;
      const openTickets = tickets.filter(t => t.assigned_to === u.id && t.status !== 'Closed').length;
      const closedTickets = tickets.filter(t => (t.assigned_to === u.id || t.closed_by === u.id) && t.status === 'Closed').length;
      return { ...u, totalActivities: userLogs.length, autoCount, manualCount, uniqueDays, openTickets, closedTickets };
    });
  }, [users, logs, tickets]);

  const filteredLogs = useMemo(() => {
    let arr = logs;
    if (selUser !== 'all') arr = arr.filter(l => l.user_id === selUser);
    return arr;
  }, [logs, selUser]);

  return (
    <div>
      <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-3 items-center">
        <select value={selUser} onChange={e => setSelUser(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs">
          <option value="all">All Team / كل الفريق</option>
          {(users || []).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => handleDateChange('from', e.target.value)}
          className="px-2 py-1.5 rounded border border-slate-200 text-xs" />
        <span className="text-xs text-slate-400">to</span>
        <input type="date" value={dateTo} onChange={e => handleDateChange('to', e.target.value)}
          className="px-2 py-1.5 rounded border border-slate-200 text-xs" />
      </div>

      {/* Team Scorecards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {scorecards.map(u => (
          <div key={u.id} onClick={() => setSelUser(selUser === u.id ? 'all' : u.id)}
            className={'bg-white rounded-xl p-3 cursor-pointer border-2 transition ' + (selUser === u.id ? 'border-blue-500 shadow-md' : 'border-slate-200')}>
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm font-bold">{u.name}</div>
                <div className="text-[10px]">
                  <span className={'font-semibold ' + (u.role === 'super_admin' ? 'text-red-500' : u.role === 'admin' ? 'text-purple-500' : 'text-blue-500')}>
                    {u.role === 'super_admin' ? '🔴 Super Admin' : u.role === 'admin' ? '🟣 Admin' : '🔵 Team'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold">{u.totalActivities}</div>
                <div className="text-[9px] text-slate-400">activities</div>
              </div>
            </div>
            <div className="flex gap-2 mt-2 text-[10px]">
              <span className="text-amber-600">⚡ {u.autoCount}</span>
              <span className="text-blue-600">✏️ {u.manualCount}</span>
              <span className="text-slate-500">{u.uniqueDays}d active</span>
            </div>
            <div className="flex gap-2 mt-1 text-[10px]">
              <span className="text-red-500">{u.openTickets} open</span>
              <span className="text-emerald-500">✅ {u.closedTickets} closed</span>
            </div>
          </div>
        ))}
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">Activity Feed ({filteredLogs.length} entries)</h3>
        <div className="space-y-1 max-h-[500px] overflow-auto">
          {filteredLogs.map(l => {
            const userName = users?.find(u => u.id === l.user_id)?.name || 'Unknown';
            return (
              <div key={l.id} className="flex items-start gap-2 py-2 border-b border-slate-50">
                <span className="text-sm mt-0.5">{l.auto_generated ? '⚡' : '✏️'}</span>
                <div className="flex-1">
                  <div className="text-xs">{l.entry_text}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    <span className="font-semibold text-blue-500 mr-2">{userName}</span>
                    {l.log_date} {l.log_time ? l.log_time.substring(0, 5) : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredLogs.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No activity in this period</div>}
        </div>
      </div>
    </div>
  );
}
