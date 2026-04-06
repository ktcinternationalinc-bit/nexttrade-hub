'use client';
import { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#f59e0b',Waiting:'#6b7280',Review:'#ec4899',Testing:'#14b8a6',Ready:'#10b981',Closed:'#374151',Reopened:'#ef4444'};

export default function AdminTab({ user, users }) {
  const [logs, setLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selUser, setSelUser] = useState('all');
  const [section, setSection] = useState('activity');
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().substring(0, 10); });
  const [dateTo, setDateTo] = useState(new Date().toISOString().substring(0, 10));

  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || 'Unknown';

  const loadData = async () => {
    try { const { data } = await supabase.from('daily_log').select('*').gte('log_date', dateFrom).lte('log_date', dateTo).order('created_at', { ascending: false }).limit(500); setLogs(data || []); } catch(e) { console.log('daily_log:', e); }
    try { const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false }); setTickets(data || []); } catch(e) { console.log('tickets:', e); }
    try { const { data } = await supabase.from('audit_log').select('*').gte('created_at', dateFrom + 'T00:00:00').order('created_at', { ascending: false }).limit(300); setAuditLogs(data || []); } catch(e) { console.log('audit_log:', e); }
    setLoaded(true);
  };
  if (!loaded) loadData();

  const handleDateChange = (field, value) => { if (field === 'from') setDateFrom(value); else setDateTo(value); setLoaded(false); };

  const todayStr = new Date().toISOString().substring(0, 10);

  // Per-user scorecards
  const scorecards = useMemo(() => {
    if (!users) return [];
    return users.map(u => {
      const uLogs = logs.filter(l => l.user_id === u.id);
      const autoCount = uLogs.filter(l => l.auto_generated).length;
      const manualCount = uLogs.filter(l => !l.auto_generated).length;
      const uniqueDays = [...new Set(uLogs.map(l => l.log_date))].length;
      const openT = tickets.filter(t => t.assigned_to === u.id && t.status !== 'Closed').length;
      const closedT = tickets.filter(t => (t.assigned_to === u.id || t.closed_by === u.id) && t.status === 'Closed').length;
      const overdueT = tickets.filter(t => t.assigned_to === u.id && t.due_date && t.due_date < todayStr && t.status !== 'Closed').length;
      const createdT = tickets.filter(t => t.created_by === u.id).length;
      return { ...u, totalActivities: uLogs.length, autoCount, manualCount, uniqueDays, openT, closedT, overdueT, createdT };
    }).sort((a, b) => b.totalActivities - a.totalActivities);
  }, [users, logs, tickets]);

  // Filtered activity logs
  const filteredLogs = useMemo(() => {
    let arr = logs;
    if (selUser !== 'all') arr = arr.filter(l => l.user_id === selUser);
    return arr;
  }, [logs, selUser]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    let arr = tickets;
    if (selUser !== 'all') arr = arr.filter(t => t.assigned_to === selUser || t.created_by === selUser);
    return arr;
  }, [tickets, selUser]);

  // Filtered audit logs
  const filteredAudit = useMemo(() => {
    let arr = auditLogs;
    if (selUser !== 'all') arr = arr.filter(a => a.changed_by === selUser);
    return arr;
  }, [auditLogs, selUser]);

  const selUserName = selUser !== 'all' ? getUserName(selUser) : 'All Team';

  return (<div>
    <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>

    {/* Filters */}
    <div className="flex gap-2 flex-wrap mb-3 items-center">
      <select value={selUser} onChange={e => setSelUser(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold">
        <option value="all">👥 All Team</option>
        {(users || []).map(u => <option key={u.id} value={u.id}>👤 {u.name} ({u.role})</option>)}
      </select>
      <input type="date" value={dateFrom} onChange={e => handleDateChange('from', e.target.value)} className="px-2 py-1.5 rounded border text-xs" />
      <span className="text-xs text-slate-400">to</span>
      <input type="date" value={dateTo} onChange={e => handleDateChange('to', e.target.value)} className="px-2 py-1.5 rounded border text-xs" />
      <button onClick={() => setLoaded(false)} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">Refresh</button>
    </div>

    {/* Section tabs */}
    <div className="flex gap-1 mb-3 flex-wrap">
      {[['activity','📋 Activity Feed'],['tickets','🎫 Tickets'],['scorecards','📊 Scorecards'],['audit','🔍 Audit Log']].map(([v,l]) => (
        <button key={v} onClick={() => setSection(v)}
          className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition ' + (section === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
      ))}
    </div>

    {selUser !== 'all' && (
      <div className="bg-blue-50 rounded-lg px-3 py-2 mb-3 border border-blue-200 flex justify-between items-center">
        <span className="text-xs font-bold text-blue-800">Viewing: {selUserName}</span>
        <button onClick={() => setSelUser('all')} className="text-[10px] text-blue-500 hover:underline">Clear filter</button>
      </div>
    )}

    {/* ===== ACTIVITY FEED ===== */}
    {section === 'activity' && (<div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Activities</div><div className="text-lg font-extrabold">{filteredLogs.length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Auto Actions</div><div className="text-lg font-extrabold">{filteredLogs.filter(l=>l.auto_generated).length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Manual Entries</div><div className="text-lg font-extrabold">{filteredLogs.filter(l=>!l.auto_generated).length}</div></div>
      </div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">{selUserName} — Activity Feed ({filteredLogs.length})</h3>
        <div className="space-y-1 max-h-[600px] overflow-auto">
          {filteredLogs.map(l => {
            const userName = getUserName(l.user_id);
            const isTicket = (l.entry_text||'').includes('ticket');
            const isStatus = (l.entry_text||'').includes('status');
            const isComment = (l.entry_text||'').includes('Comment');
            const isCreate = (l.entry_text||'').includes('Created');
            const icon = isStatus ? '📋' : isTicket ? '🎫' : isComment ? '💬' : isCreate ? '✨' : l.auto_generated ? '⚡' : '✏️';
            return (
              <div key={l.id} className="flex items-start gap-2 py-2 border-b border-slate-50">
                <span className="text-sm mt-0.5">{icon}</span>
                <div className="flex-1">
                  <div className="text-xs">{l.entry_text}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    <span className="font-semibold text-blue-500 mr-2">{userName}</span>
                    {l.log_date} {l.created_at ? new Date(l.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredLogs.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No activity in this period</div>}
        </div>
      </div>
    </div>)}

    {/* ===== TICKETS VIEW ===== */}
    {section === 'tickets' && (<div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Open</div><div className="text-lg font-extrabold">{filteredTickets.filter(t=>t.status!=='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Overdue</div><div className="text-lg font-extrabold text-red-500">{filteredTickets.filter(t=>t.due_date&&t.due_date<todayStr&&t.status!=='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Closed</div><div className="text-lg font-extrabold">{filteredTickets.filter(t=>t.status==='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{filteredTickets.length}</div></div>
      </div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">{selUserName} — Tickets ({filteredTickets.filter(t=>t.status!=='Closed').length} open)</h3>
        <div className="overflow-auto max-h-[500px] rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0"><tr className="bg-slate-50">
              <th className="px-2 py-2 text-[10px] text-left">Title</th>
              <th className="px-2 py-2 text-[10px]">Status</th>
              <th className="px-2 py-2 text-[10px]">Priority</th>
              <th className="px-2 py-2 text-[10px] text-left">Created By</th>
              <th className="px-2 py-2 text-[10px] text-left">Assigned To</th>
              <th className="px-2 py-2 text-[10px]">Due</th>
              <th className="px-2 py-2 text-[10px]">Created</th>
            </tr></thead>
            <tbody>
              {filteredTickets.filter(t=>t.status!=='Closed').concat(filteredTickets.filter(t=>t.status==='Closed').slice(0,20)).map(t => {
                const isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'Closed';
                return (
                  <tr key={t.id} className={'border-b border-slate-50 ' + (isOverdue ? 'bg-red-50' : t.status === 'Closed' ? 'opacity-50' : '')}>
                    <td className="px-2 py-2 font-semibold max-w-[200px] truncate">{t.title}</td>
                    <td className="px-2 py-2 text-center"><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></td>
                    <td className="px-2 py-2 text-center"><span className={'font-bold ' + (t.priority==='high'?'text-red-500':t.priority==='low'?'text-green-500':'text-amber-500')}>{t.priority}</span></td>
                    <td className="px-2 py-2 text-blue-600">{getUserName(t.created_by)}</td>
                    <td className="px-2 py-2"><span className={t.assigned_to ? 'text-purple-600 font-semibold' : 'text-red-400'}>{t.assigned_to ? getUserName(t.assigned_to) : 'UNASSIGNED'}</span></td>
                    <td className={'px-2 py-2 text-center ' + (isOverdue ? 'text-red-600 font-bold' : '')}>{t.due_date || '—'}</td>
                    <td className="px-2 py-2 text-slate-400">{t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>)}

    {/* ===== SCORECARDS ===== */}
    {section === 'scorecards' && (<div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {scorecards.map(u => (
          <div key={u.id} onClick={() => setSelUser(selUser === u.id ? 'all' : u.id)}
            className={'bg-white rounded-xl p-4 cursor-pointer border-2 transition hover:shadow-md ' + (selUser === u.id ? 'border-blue-500 shadow-md' : 'border-slate-200')}>
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="text-sm font-extrabold">{u.name}</div>
                <div className="text-[10px]">
                  <span className={'font-semibold ' + (u.role === 'super_admin' ? 'text-red-500' : u.role === 'admin' ? 'text-purple-500' : 'text-blue-500')}>
                    {u.role === 'super_admin' ? '🔴 Super Admin' : u.role === 'admin' ? '🟣 Admin' : '🔵 Team'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold">{u.totalActivities}</div>
                <div className="text-[9px] text-slate-400">total actions</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center mt-2">
              <div className="bg-blue-50 rounded p-1.5"><div className="text-sm font-bold text-blue-600">{u.openT}</div><div className="text-[8px] text-slate-500">Open</div></div>
              <div className="bg-red-50 rounded p-1.5"><div className="text-sm font-bold text-red-500">{u.overdueT}</div><div className="text-[8px] text-slate-500">Overdue</div></div>
              <div className="bg-green-50 rounded p-1.5"><div className="text-sm font-bold text-emerald-600">{u.closedT}</div><div className="text-[8px] text-slate-500">Closed</div></div>
            </div>
            <div className="flex gap-3 mt-2 text-[10px] border-t border-slate-100 pt-2">
              <span className="text-amber-600">⚡ {u.autoCount} auto</span>
              <span className="text-blue-600">✏️ {u.manualCount} manual</span>
              <span className="text-slate-500">📅 {u.uniqueDays}d active</span>
              <span className="text-purple-500">✨ {u.createdT} created</span>
            </div>
          </div>
        ))}
      </div>
    </div>)}

    {/* ===== AUDIT LOG ===== */}
    {section === 'audit' && (<div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">{selUserName} — Audit Log ({filteredAudit.length} changes)</h3>
        <p className="text-[10px] text-slate-400 mb-3">Every database change — create, update, delete — with before/after values</p>
        <div className="space-y-1 max-h-[600px] overflow-auto">
          {filteredAudit.map(a => {
            const userName = getUserName(a.changed_by);
            const actionColors = { create: 'text-emerald-600', update: 'text-blue-600', delete: 'text-red-600' };
            const actionIcons = { create: '✨', update: '✏️', delete: '🗑️' };
            return (
              <div key={a.id} className="py-2 border-b border-slate-50">
                <div className="flex items-center gap-2 text-xs">
                  <span>{actionIcons[a.action] || '📋'}</span>
                  <span className={'font-bold ' + (actionColors[a.action] || '')}>{a.action?.toUpperCase()}</span>
                  <span className="text-slate-500">{a.table_name}</span>
                  <span className="text-blue-500 font-semibold ml-auto">{userName}</span>
                  <span className="text-slate-400">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                </div>
                {a.new_values && (
                  <div className="text-[10px] text-slate-500 mt-1 bg-slate-50 rounded p-1.5 max-h-[60px] overflow-auto">
                    {typeof a.new_values === 'object' ? Object.entries(a.new_values).slice(0, 5).map(([k, v]) => (
                      <span key={k} className="mr-2"><span className="text-slate-400">{k}:</span> <span className="font-semibold">{String(v).substring(0, 50)}</span></span>
                    )) : String(a.new_values).substring(0, 200)}
                  </div>
                )}
              </div>
            );
          })}
          {filteredAudit.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No audit entries{selUser !== 'all' ? ' for this user' : ''}</div>}
        </div>
      </div>
    </div>)}
  </div>);
}
