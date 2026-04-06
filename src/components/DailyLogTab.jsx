'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert } from '../lib/supabase';

export default function DailyLogTab({ user, users, isAdmin }) {
  const [logs, setLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState('my'); // my | team
  const [selUser, setSelUser] = useState(null);
  const [selDate, setSelDate] = useState(new Date().toISOString().substring(0, 10));
  const [f, setF] = useState({});

  const loadLogs = async () => {
    const { data } = await supabase.from('daily_log').select('*').order('created_at', { ascending: false }).limit(500);
    setLogs(data || []);
    setLoaded(true);
  };

  if (!loaded) loadLogs();

  const today = new Date().toISOString().substring(0, 10);

  const filtered = useMemo(() => {
    let arr = logs;
    if (viewMode === 'my') {
      arr = arr.filter(l => l.user_id === user?.id);
    } else if (selUser) {
      arr = arr.filter(l => l.user_id === selUser);
    }
    if (selDate) {
      arr = arr.filter(l => l.log_date === selDate);
    }
    return arr;
  }, [logs, viewMode, selUser, selDate, user]);

  const handleAddEntry = async () => {
    if (!f.entry) return;
    try {
      await dbInsert('daily_log', {
        user_id: user?.id,
        entry_text: f.entry,
        auto_generated: false,
        log_date: today,
      }, user?.id);
      setF({});
      loadLogs();
    } catch (err) { alert('Error: ' + err.message); }
  };

  // Team summary: who logged today
  const teamSummary = useMemo(() => {
    if (!users) return [];
    return users.map(u => {
      const userLogs = logs.filter(l => l.user_id === u.id && l.log_date === selDate);
      const autoCount = userLogs.filter(l => l.auto_generated).length;
      const manualCount = userLogs.filter(l => !l.auto_generated).length;
      return { ...u, logCount: userLogs.length, autoCount, manualCount };
    });
  }, [users, logs, selDate]);

  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">Daily Log / السجل اليومي</h2>
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => { setViewMode('my'); setSelUser(null); }}
                className={'px-3 py-1 rounded text-xs font-semibold transition ' + (viewMode === 'my' ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>My Log</button>
              <button onClick={() => setViewMode('team')}
                className={'px-3 py-1 rounded text-xs font-semibold transition ' + (viewMode === 'team' ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>Team</button>
            </div>
          )}
          <input type="date" value={selDate} onChange={e => setSelDate(e.target.value)}
            className="px-2 py-1 rounded border border-slate-200 text-xs" />
        </div>
      </div>

      {/* Manual Entry */}
      <div className="bg-white rounded-xl p-3 mb-3 flex gap-2">
        <input value={f.entry || ''} onChange={e => setF({ ...f, entry: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
          placeholder="What did you do? / ماذا فعلت؟" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
        <button onClick={handleAddEntry} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap">+ Log</button>
      </div>

      {/* Team View */}
      {viewMode === 'team' && isAdmin && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {teamSummary.map(u => (
            <div key={u.id} onClick={() => setSelUser(selUser === u.id ? null : u.id)}
              className={'bg-white rounded-lg p-3 cursor-pointer border-2 transition ' + (selUser === u.id ? 'border-blue-500 shadow-md' : 'border-slate-200 hover:border-slate-300')}>
              <div className="text-sm font-bold">{u.name}</div>
              <div className="text-[10px] text-slate-500">{u.role}</div>
              {u.logCount > 0 ? (
                <div className="mt-1">
                  <span className="text-xs font-bold text-emerald-600">{u.logCount} entries</span>
                  <div className="text-[10px] text-slate-400">⚡ {u.autoCount} auto · ✏️ {u.manualCount} manual</div>
                </div>
              ) : (
                <div className="text-xs font-bold text-red-500 mt-1">No log</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Activity Feed */}
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">
          {viewMode === 'my' ? 'My Activity' : selUser ? (users.find(u => u.id === selUser)?.name || 'User') + "'s Activity" : 'All Team Activity'}
          <span className="text-slate-400 font-normal ml-2">({selDate})</span>
        </h3>
        {filtered.length > 0 ? (
          <div className="space-y-2">
            {filtered.map(l => {
              const userName = users?.find(u => u.id === l.user_id)?.name || '';
              return (
                <div key={l.id} className="flex items-start gap-2 py-2 border-b border-slate-50">
                  <span className="text-sm mt-0.5">{l.auto_generated ? '⚡' : '✏️'}</span>
                  <div className="flex-1">
                    <div className="text-xs">{l.entry_text}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {viewMode === 'team' && userName && <span className="font-semibold text-blue-500 mr-2">{userName}</span>}
                      {l.log_time ? l.log_time.substring(0, 5) : new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center text-slate-400 text-sm py-6">No entries for this date / لا توجد سجلات</div>
        )}
      </div>
    </div>
  );
}
