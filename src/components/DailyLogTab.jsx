'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

const CAT_ICONS = {
  ticket: '🎫', crm: '🤝', shipping: '🛳️', customs: '🚢', calendar: '📅',
  finance: '💰', inventory: '📦', communication: '📬', ai: '🤖', manual: '✏️', other: '⚡'
};
const CAT_COLORS = {
  ticket: '#8b5cf6', crm: '#0ea5e9', shipping: '#10b981', customs: '#f59e0b',
  calendar: '#ec4899', finance: '#6366f1', inventory: '#14b8a6', communication: '#38bdf8',
  ai: '#a78bfa', manual: '#3b82f6', other: '#94a3b8'
};

export default function DailyLogTab({ user, userProfile, users, isAdmin }) {
  const [logs, setLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState('my');
  const [selUser, setSelUser] = useState(null);
  const [selDate, setSelDate] = useState(new Date().toISOString().substring(0, 10));
  const [newEntry, setNewEntry] = useState('');
  const [newCategory, setNewCategory] = useState('manual');
  const [archiveView, setArchiveView] = useState(false);
  const [archiveDates, setArchiveDates] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [selCat, setSelCat] = useState(null);
  const [sessions, setSessions] = useState([]);

  const myId = userProfile?.id;
  const today = new Date().toISOString().substring(0, 10);

  const loadLogs = useCallback(async () => {
    const [{ data }, { data: sess }] = await Promise.all([
      supabase.from('daily_log').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('user_sessions').select('*').order('login_at', { ascending: false }).limit(500),
    ]);
    setLogs(data || []);
    setSessions(sess || []);
    setLoaded(true);
    const dates = [...new Set((data || []).map(l => (l.log_date || '').substring(0, 10)).filter(Boolean))].sort().reverse();
    setArchiveDates(dates);
  }, []);

  useEffect(() => { if (!loaded) loadLogs(); }, [loaded, loadLogs]);

  const filtered = useMemo(() => {
    let arr = logs;
    if (viewMode === 'my') arr = arr.filter(l => l.user_id === myId);
    else if (selUser) arr = arr.filter(l => l.user_id === selUser);
    if (selDate) arr = arr.filter(l => (l.log_date || '').substring(0, 10) === selDate);
    return arr;
  }, [logs, viewMode, selUser, selDate, myId]);

  // Group by category for summary
  const catSummary = useMemo(() => {
    const counts = {};
    filtered.forEach(l => {
      const cat = l.log_category || (l.auto_generated ? 'other' : 'manual');
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const handleAddEntry = async () => {
    if (!newEntry.trim()) return;
    const isHistorical = selDate !== today;
    try {
      await dbInsert('daily_log', {
        user_id: myId,
        entry_text: newEntry,
        auto_generated: false,
        log_date: selDate,
        log_category: newCategory || 'manual',
        edited_historical: isHistorical || false
      }, myId);
      setNewEntry('');
      loadLogs();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const handleEditEntry = async (log) => {
    if (!editText.trim()) return;
    try {
      await dbUpdate('daily_log', log.id, {
        entry_text: editText,
        edited_historical: true,
        edited_at: new Date().toISOString()
      }, myId);
      setEditingId(null);
      setEditText('');
      loadLogs();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const teamSummary = useMemo(() => {
    if (!users) return [];
    return users.map(u => {
      const userLogs = logs.filter(l => l.user_id === u.id && (l.log_date || '').substring(0, 10) === selDate);
      const autoCount = userLogs.filter(l => l.auto_generated).length;
      const manualCount = userLogs.filter(l => !l.auto_generated).length;
      const cats = {};
      userLogs.forEach(l => { const c = l.log_category || 'other'; cats[c] = (cats[c] || 0) + 1; });
      // Session data for selected date
      const userSessions = sessions.filter(s => s.user_id === u.id && (s.date || '').substring(0, 10) === selDate);
      const firstLogin = userSessions.length > 0 ? userSessions[userSessions.length - 1]?.login_at : null;
      const lastSeen = userSessions.length > 0 ? userSessions[0]?.last_seen : null;
      const lastLogout = userSessions.length > 0 ? userSessions[0]?.logout_at : null;
      let totalMinutes = 0;
      userSessions.forEach(s => {
        const end = s.logout_at || s.last_seen || s.login_at;
        if (s.login_at && end) totalMinutes += Math.max(0, (new Date(end) - new Date(s.login_at)) / 60000);
      });
      return { ...u, logCount: userLogs.length, autoCount, manualCount, cats, firstLogin, lastSeen, lastLogout, totalMinutes, sessionCount: userSessions.length };
    });
  }, [users, logs, sessions, selDate]);

  const archiveData = useMemo(() => {
    if (!archiveView) return [];
    return archiveDates.slice(0, 60).map(date => {
      const dayLogs = logs.filter(l => (l.log_date || '').substring(0, 10) === date);
      const uniqueUsers = [...new Set(dayLogs.map(l => l.user_id))];
      const autoCount = dayLogs.filter(l => l.auto_generated).length;
      const editedCount = dayLogs.filter(l => l.edited_historical).length;
      return { date, total: dayLogs.length, users: uniqueUsers.length, autoCount, manualCount: dayLogs.length - autoCount, editedCount };
    });
  }, [archiveView, archiveDates, logs]);

  const navigateDate = (dir) => {
    const d = new Date(selDate);
    d.setDate(d.getDate() + dir);
    setSelDate(d.toISOString().substring(0, 10));
  };

  const getCatIcon = (log) => {
    const cat = log.log_category || (log.auto_generated ? 'other' : 'manual');
    return CAT_ICONS[cat] || '⚡';
  };

  const getCatColor = (log) => {
    const cat = log.log_category || (log.auto_generated ? 'other' : 'manual');
    return CAT_COLORS[cat] || '#94a3b8';
  };

  const getCatLabel = (cat) => {
    const labels = { ticket: 'Tickets', crm: 'CRM', shipping: 'Shipping', customs: 'Customs', calendar: 'Calendar', finance: 'Finance', inventory: 'Inventory', communication: 'Comms', ai: 'AI', manual: 'Notes', other: 'System' };
    return labels[cat] || cat;
  };

  const formatTime = (log) => {
    if (log.log_time) return log.log_time.substring(0, 5);
    if (log.created_at) return new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return '';
  };

  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';

  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">📓 Daily Log</h2>
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => { setViewMode('my'); setSelUser(null); setArchiveView(false); }}
                className={'px-3 py-1 rounded text-xs font-semibold transition ' + (viewMode === 'my' && !archiveView ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>My Log</button>
              <button onClick={() => { setViewMode('team'); setArchiveView(false); }}
                className={'px-3 py-1 rounded text-xs font-semibold transition ' + (viewMode === 'team' && !archiveView ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>Team</button>
              <button onClick={() => setArchiveView(!archiveView)}
                className={'px-3 py-1 rounded text-xs font-semibold transition ' + (archiveView ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>📅 Archive</button>
            </div>
          )}
          {!archiveView && (
            <div className="flex items-center gap-1">
              <button onClick={() => navigateDate(-1)} className="px-2 py-1 rounded border border-slate-200 text-xs">◀</button>
              <input type="date" value={selDate} onChange={e => setSelDate(e.target.value)}
                className="px-2 py-1 rounded border border-slate-200 text-xs" />
              <button onClick={() => navigateDate(1)} className="px-2 py-1 rounded border border-slate-200 text-xs" disabled={selDate >= today}>▶</button>
              {selDate !== today && <button onClick={() => setSelDate(today)} className="px-2 py-1 rounded bg-blue-500 text-white text-[10px] font-semibold">Today</button>}
            </div>
          )}
        </div>
      </div>

      {/* Archive View */}
      {archiveView ? (
        <div className="bg-white rounded-xl p-4 border mb-3">
          <h3 className="text-sm font-bold mb-3">📅 Activity Archive ({archiveDates.length} days)</h3>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0"><tr className="bg-slate-50">
                <th className="px-3 py-2 text-left text-[10px]">Date</th>
                <th className="px-3 py-2 text-right text-[10px]">Total</th>
                <th className="px-3 py-2 text-right text-[10px]">Team</th>
                <th className="px-3 py-2 text-right text-[10px]">Auto</th>
                <th className="px-3 py-2 text-right text-[10px]">Manual</th>
                <th className="px-3 py-2 text-right text-[10px]">Edited</th>
                <th className="px-3 py-2 text-[10px]"></th>
              </tr></thead>
              <tbody>{archiveData.map(d => {
                const isToday = d.date === today;
                return (
                  <tr key={d.date} className={'border-b border-slate-50 hover:bg-blue-50 ' + (isToday ? 'bg-blue-50/50' : '')}>
                    <td className="px-3 py-2 font-semibold">{d.date} {isToday && <span className="text-blue-500 text-[10px]">(today)</span>}</td>
                    <td className="px-3 py-2 text-right font-bold">{d.total}</td>
                    <td className="px-3 py-2 text-right">{d.users}</td>
                    <td className="px-3 py-2 text-right text-slate-400">⚡ {d.autoCount}</td>
                    <td className="px-3 py-2 text-right text-blue-600">✏️ {d.manualCount}</td>
                    <td className="px-3 py-2 text-right">{d.editedCount > 0 && <span className="text-amber-500 font-bold">⚠ {d.editedCount}</span>}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => { setSelDate(d.date); setViewMode('team'); setArchiveView(false); }}
                        className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px] font-semibold">View →</button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {/* Manual Entry */}
          <div className="bg-white rounded-xl p-3 mb-3">
            <div className="flex gap-2 mb-2">
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="px-2 py-2 border rounded-lg text-xs font-semibold" style={{minWidth: 100}}>
                <option value="manual">✏️ Note</option>
                <option value="ticket">🎫 Ticket</option>
                <option value="crm">🤝 CRM</option>
                <option value="shipping">🛳️ Shipping</option>
                <option value="customs">🚢 Customs</option>
                <option value="finance">💰 Finance</option>
                <option value="calendar">📅 Calendar</option>
                <option value="other">⚡ Other</option>
              </select>
              <input value={newEntry} onChange={e => setNewEntry(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
                placeholder="What did you do? / ماذا فعلت؟" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
              <button onClick={handleAddEntry} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap">+ Log</button>
            </div>
            {selDate !== today && (
              <div className="text-[10px] text-amber-600 font-semibold px-1">⚠️ Adding to {selDate} (historical) — entry will be flagged</div>
            )}
          </div>

          {/* Category Summary — clickable buckets */}
          {catSummary.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              <div onClick={() => setFormData && setSelCat && setSelCat(null)} className={'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ' + (!selCat ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                All ({filtered.length})
              </div>
              {catSummary.map(([cat, count]) => (
                <div key={cat} onClick={() => setSelCat(selCat === cat ? null : cat)}
                  className={'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ' + (selCat === cat ? 'ring-2 ring-offset-1' : '')}
                  style={{ background: CAT_COLORS[cat] + '15', border: '1px solid ' + CAT_COLORS[cat] + '30', color: CAT_COLORS[cat], ...(selCat === cat ? {ringColor: CAT_COLORS[cat]} : {}) }}>
                  {CAT_ICONS[cat] || '⚡'} {getCatLabel(cat)} <span className="font-bold ml-1">{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Team View */}
          {viewMode === 'team' && isAdmin && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {teamSummary.map(u => {
                const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
                const hrs = Math.floor(u.totalMinutes / 60);
                const mins = Math.round(u.totalMinutes % 60);
                const durStr = u.totalMinutes > 0 ? (hrs > 0 ? hrs + 'h ' : '') + mins + 'm' : null;
                return (
                <div key={u.id} onClick={() => setSelUser(selUser === u.id ? null : u.id)}
                  className={'bg-white rounded-lg p-3 cursor-pointer border-2 transition ' + (selUser === u.id ? 'border-blue-500 shadow-md' : 'border-slate-200 hover:border-slate-300')}>
                  <div className="text-sm font-bold">{u.name}</div>
                  <div className="text-[10px] text-slate-500">{u.role}</div>
                  {/* Session info */}
                  {u.firstLogin ? (
                    <div className="mt-1 p-1.5 bg-blue-50 rounded text-[10px] space-y-0.5">
                      <div>🟢 In: <span className="font-bold text-blue-700">{fmtTime(u.firstLogin)}</span></div>
                      {u.lastLogout ? (
                        <div>🔴 Out: <span className="font-bold text-red-600">{fmtTime(u.lastLogout)}</span></div>
                      ) : u.lastSeen ? (
                        <div>👁️ Last: <span className="font-bold text-slate-600">{fmtTime(u.lastSeen)}</span></div>
                      ) : null}
                      {durStr && <div>⏱️ <span className="font-bold text-emerald-600">{durStr}</span>{u.sessionCount > 1 ? ` (${u.sessionCount} sessions)` : ''}</div>}
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-slate-400">No login today</div>
                  )}
                  {u.logCount > 0 ? (
                    <div className="mt-1">
                      <span className="text-xs font-bold text-emerald-600">{u.logCount} entries</span>
                      <div className="text-[10px] text-slate-400">⚡ {u.autoCount} auto · ✏️ {u.manualCount} manual</div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {Object.entries(u.cats).map(([c, n]) => (
                          <span key={c} className="text-[9px] px-1 rounded" style={{ background: (CAT_COLORS[c] || '#94a3b8') + '20', color: CAT_COLORS[c] || '#94a3b8' }}>
                            {CAT_ICONS[c] || '⚡'}{n}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs font-bold text-red-500 mt-1">No log</div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* Activity Timeline */}
          <div className="bg-white rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3">
              {viewMode === 'my' ? 'My Activity' : selUser ? (getUserName(selUser) || 'User') + "'s Activity" : 'All Team Activity'}
              <span className="text-slate-400 font-normal ml-2">({selDate}{selDate === today ? ' — Today' : ''})</span>
              {selCat && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{background: CAT_COLORS[selCat] + '20', color: CAT_COLORS[selCat]}}>{CAT_ICONS[selCat]} {getCatLabel(selCat)} ({filtered.filter(l => (l.log_category || (l.auto_generated ? 'other' : 'manual')) === selCat).length})</span>}
            </h3>
            {!selCat && filtered.length > 0 ? (
              /* Bucketed view — group by category */
              <div className="space-y-2">
                {catSummary.map(([cat, count]) => {
                  const catEntries = filtered.filter(l => (l.log_category || (l.auto_generated ? 'other' : 'manual')) === cat);
                  return (
                    <div key={cat} className="rounded-lg border" style={{borderColor: CAT_COLORS[cat] + '40'}}>
                      <div onClick={() => setSelCat(cat)}
                        className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-slate-50 rounded-lg transition">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{CAT_ICONS[cat] || '⚡'}</span>
                          <div>
                            <div className="text-xs font-bold" style={{color: CAT_COLORS[cat]}}>{getCatLabel(cat)}</div>
                            <div className="text-[10px] text-slate-400">{catEntries.slice(0, 2).map(l => l.entry_text.substring(0, 40) + (l.entry_text.length > 40 ? '...' : '')).join(' · ')}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-extrabold" style={{color: CAT_COLORS[cat]}}>{count}</span>
                          <span className="text-slate-400 text-xs">→</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : filtered.length > 0 ? (
              /* Filtered/drill-down view — individual entries */
              <div>
                {selCat && <button onClick={() => setSelCat(null)} className="text-xs text-blue-600 font-bold mb-2 hover:underline">← All categories</button>}
                <div className="space-y-1">
                {filtered.filter(l => !selCat || (l.log_category || (l.auto_generated ? 'other' : 'manual')) === selCat).map(l => {
                  const userName = getUserName(l.user_id);
                  const isEdited = l.edited_historical || (l.edited_at && l.log_date !== today);
                  const isEditMode = editingId === l.id;
                  return (
                    <div key={l.id}
                      className={'flex items-start gap-2 py-2.5 px-2 rounded-lg border transition ' + (isEdited ? 'bg-amber-50 border-amber-200' : 'border-transparent hover:bg-slate-50')}
                    >
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center mt-0.5">
                        <span className="text-sm">{getCatIcon(l)}</span>
                        <div className="w-0.5 flex-1 mt-1" style={{ background: getCatColor(l) + '30' }}></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        {isEditMode ? (
                          <div className="flex gap-2">
                            <input value={editText} onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleEditEntry(l); if (e.key === 'Escape') setEditingId(null); }}
                              className="flex-1 px-2 py-1 border rounded text-xs" autoFocus />
                            <button onClick={() => handleEditEntry(l)} className="px-2 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">Save</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-1 border rounded text-[10px]">Cancel</button>
                          </div>
                        ) : (
                          <div className="text-xs leading-relaxed">{l.entry_text}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] font-mono font-semibold" style={{ color: getCatColor(l) }}>
                            {formatTime(l)}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                            style={{ background: getCatColor(l) + '15', color: getCatColor(l) }}>
                            {getCatLabel(l.log_category || (l.auto_generated ? 'other' : 'manual'))}
                          </span>
                          {l.auto_generated && <span className="text-[9px] text-slate-400">auto</span>}
                          {viewMode === 'team' && userName && <span className="text-[10px] font-semibold text-blue-500">{userName}</span>}
                          {isEdited && <span className="text-[9px] font-bold text-amber-600">⚠️ edited{l.edited_at ? ' ' + new Date(l.edited_at).toLocaleDateString() : ''}</span>}
                          {!l.auto_generated && !isEditMode && l.user_id === myId && (
                            <button onClick={() => { setEditingId(l.id); setEditText(l.entry_text); }}
                              className="text-[9px] text-slate-400 hover:text-blue-500 cursor-pointer">edit</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            ) : (
              <div className="text-center text-slate-400 text-sm py-6">No entries for this date</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
