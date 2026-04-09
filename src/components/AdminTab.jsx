'use client';
import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#f59e0b',Waiting:'#6b7280',Review:'#ec4899',Testing:'#14b8a6',Ready:'#10b981',Closed:'#374151',Reopened:'#ef4444'};
const CAT_ICONS = { ticket:'🎫', crm:'🤝', shipping:'🛳️', customs:'🚢', calendar:'📅', finance:'💰', inventory:'📦', communication:'📬', ai:'🤖', manual:'✏️', other:'⚡', login:'🟢' };
const CAT_COLORS = { ticket:'#8b5cf6', crm:'#0ea5e9', shipping:'#10b981', customs:'#f59e0b', calendar:'#ec4899', finance:'#6366f1', inventory:'#14b8a6', communication:'#38bdf8', ai:'#a78bfa', manual:'#3b82f6', other:'#94a3b8', login:'#22c55e' };
const CAT_LABELS = { ticket:'Tickets', crm:'CRM', shipping:'Shipping', customs:'Customs', calendar:'Calendar', finance:'Finance', inventory:'Inventory', communication:'Comms', ai:'AI', manual:'Notes', other:'System', login:'Logins' };
const PIPELINE_STAGES = [
  { v: 'lead', l: 'Lead', c: '#94a3b8', icon: '🔘' },
  { v: 'contacted', l: 'Contacted', c: '#3b82f6', icon: '📞' },
  { v: 'qualified', l: 'Qualified', c: '#8b5cf6', icon: '✅' },
  { v: 'proposal', l: 'Proposal', c: '#f59e0b', icon: '📋' },
  { v: 'negotiation', l: 'Negotiation', c: '#ec4899', icon: '🤝' },
  { v: 'won', l: 'Won / Deal', c: '#10b981', icon: '🏆' },
  { v: 'lost', l: 'Lost', c: '#ef4444', icon: '❌' },
];

export default function AdminTab({ user, userProfile, users, isAdmin, customers }) {
  const [logs, setLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [rates, setRates] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selUser, setSelUser] = useState('all');
  const [section, setSection] = useState('scorecards');
  const [drillStage, setDrillStage] = useState(null);
  const [drillUser, setDrillUser] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10); });
  const [dateTo, setDateTo] = useState(new Date().toISOString().substring(0, 10));

  const myId = userProfile?.id || user?.id;
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';

  // Filter visible team members based on role
  const visibleUsers = useMemo(() => {
    if (!users) return [];
    if (isSuperAdmin) return users;
    // Admin/manager sees only direct reports
    return users.filter(u => u.reports_to === myId || u.id === myId);
  }, [users, myId, isSuperAdmin]);

  const loadData = async () => {
    try { const { data } = await supabase.from('daily_log').select('*').gte('log_date', dateFrom).lte('log_date', dateTo).order('created_at', { ascending: false }).limit(1000); setLogs(data || []); } catch(e) {}
    try { const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false }); setTickets(data || []); } catch(e) {}
    try { const { data } = await supabase.from('shipping_rates').select('id, vendor_name, origin, destination, rate_amount, currency, created_at').order('created_at', { ascending: false }).limit(500); setRates(data || []); } catch(e) {}
    try { const { data } = await supabase.from('shipping_quotes').select('id, quote_number, customer_name, total_amount, created_at, created_by').order('created_at', { ascending: false }).limit(500); setQuotes(data || []); } catch(e) {}
    try { const { data } = await supabase.from('audit_log').select('*').gte('created_at', dateFrom + 'T00:00:00').order('created_at', { ascending: false }).limit(300); setAuditLogs(data || []); } catch(e) {}
    setLoaded(true);
  };

  useEffect(() => { if (!loaded) loadData(); }, [loaded]);

  const handleDateChange = (field, value) => { if (field === 'from') setDateFrom(value); else setDateTo(value); setLoaded(false); };
  const todayStr = new Date().toISOString().substring(0, 10);

  // Enhanced scorecards
  const scorecards = useMemo(() => {
    return visibleUsers.map(u => {
      const uLogs = logs.filter(l => l.user_id === u.id);
      const autoCount = uLogs.filter(l => l.auto_generated).length;
      const manualCount = uLogs.filter(l => !l.auto_generated).length;
      const uniqueDays = [...new Set(uLogs.map(l => l.log_date))].length;

      // Tickets
      const myTickets = tickets.filter(t => t.assigned_to === u.id);
      const openT = myTickets.filter(t => t.status !== 'Closed').length;
      const closedT = myTickets.filter(t => t.status === 'Closed').length;
      const createdT = tickets.filter(t => t.created_by === u.id).length;

      // Overdue analysis
      const overdueNow = myTickets.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'Closed');
      const overdueCount = overdueNow.length;
      // Count all tickets that were ever overdue (closed after due date)
      const closedOverdue = myTickets.filter(t => t.status === 'Closed' && t.due_date && t.closed_at && new Date(t.closed_at) > new Date(t.due_date + 'T23:59:59'));
      const totalTimesOverdue = overdueCount + closedOverdue.length;
      // Average overdue days
      var totalOverdueDays = 0;
      var overdueItemCount = 0;
      overdueNow.forEach(function(t) {
        var days = Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000);
        totalOverdueDays += days;
        overdueItemCount++;
      });
      closedOverdue.forEach(function(t) {
        var days = Math.floor((new Date(t.closed_at).getTime() - new Date(t.due_date).getTime()) / 86400000);
        if (days > 0) { totalOverdueDays += days; overdueItemCount++; }
      });
      var avgOverdueDays = overdueItemCount > 0 ? Math.round(totalOverdueDays / overdueItemCount) : 0;

      // Rates & Quotes (approximation - check if user created them via audit or direct match)
      // We'll count rates where the audit shows this user created them
      var ratesCompleted = 0;
      var quotesCompleted = 0;
      try {
        var userAudits = auditLogs.filter(function(a) { return a.changed_by === u.id; });
        ratesCompleted = userAudits.filter(function(a) { return a.table_name === 'shipping_rates' && a.action === 'create'; }).length;
        quotesCompleted = quotes.filter(function(q) { return q.created_by === u.id; }).length;
      } catch(e) {}

      // Category breakdown
      const catCounts = {};
      uLogs.forEach(l => {
        const c = l.log_category || (l.auto_generated ? 'other' : 'manual');
        catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

      return {
        ...u, totalActivities: uLogs.length, autoCount, manualCount, uniqueDays,
        openT, closedT, createdT, overdueCount, totalTimesOverdue, avgOverdueDays,
        ratesCompleted, quotesCompleted, topCats
      };
    }).sort((a, b) => b.totalActivities - a.totalActivities);
  }, [visibleUsers, logs, tickets, quotes, auditLogs, todayStr]);

  // Filtered data
  const filteredLogs = useMemo(() => { let arr = logs; if (selUser !== 'all') arr = arr.filter(l => l.user_id === selUser); return arr; }, [logs, selUser]);
  const filteredTickets = useMemo(() => { let arr = tickets; if (selUser !== 'all') arr = arr.filter(t => t.assigned_to === selUser || t.created_by === selUser); return arr; }, [tickets, selUser]);
  const filteredAudit = useMemo(() => { let arr = auditLogs; if (selUser !== 'all') arr = arr.filter(a => a.changed_by === selUser); return arr; }, [auditLogs, selUser]);
  const selUserName = selUser !== 'all' ? getUserName(selUser) : 'All Team';

  return (<div>
    <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>

    {/* Filters */}
    <div className="flex gap-2 flex-wrap mb-3 items-center">
      <select value={selUser} onChange={e => setSelUser(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold">
        <option value="all">👥 All Team ({visibleUsers.length})</option>
        {visibleUsers.map(u => <option key={u.id} value={u.id}>👤 {u.name} ({u.role})</option>)}
      </select>
      <input type="date" value={dateFrom} onChange={e => handleDateChange('from', e.target.value)} className="px-2 py-1.5 rounded border text-xs" />
      <span className="text-xs text-slate-400">to</span>
      <input type="date" value={dateTo} onChange={e => handleDateChange('to', e.target.value)} className="px-2 py-1.5 rounded border text-xs" />
      <button onClick={() => setLoaded(false)} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">Refresh</button>
    </div>

    {/* Section tabs */}
    <div className="flex gap-1 mb-3 flex-wrap">
      {[['scorecards','📊 Scorecards'],['pipeline','🏆 Sales Pipeline'],['activity','📋 Activity'],['tickets','🎫 Tickets'],['audit','🔍 Audit']].map(([v,l]) => (
        <button key={v} onClick={() => setSection(v)}
          className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition ' + (section === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
      ))}
    </div>

    {!isSuperAdmin && visibleUsers.length <= 1 && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-700">
        You can see your direct reports only. Ask a Super Admin to assign team members to you via the <strong>reports_to</strong> field.
      </div>
    )}

    {/* ===== SCORECARDS ===== */}
    {section === 'scorecards' && (<div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scorecards.map(u => (
          <div key={u.id} onClick={() => setSelUser(selUser === u.id ? 'all' : u.id)}
            className={'bg-white rounded-xl p-5 cursor-pointer border-2 transition hover:shadow-lg ' + (selUser === u.id ? 'border-blue-500 shadow-lg' : 'border-slate-200')}>
            {/* Header */}
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-base font-extrabold">{u.name}</div>
                <div className="text-[10px]">
                  <span className={'font-semibold ' + (u.role === 'super_admin' ? 'text-red-500' : u.role === 'admin' ? 'text-purple-500' : 'text-blue-500')}>
                    {u.role === 'super_admin' ? '🔴 Super Admin' : u.role === 'admin' ? '🟣 Admin' : '🔵 Team'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold">{u.totalActivities}</div>
                <div className="text-[9px] text-slate-400">actions ({dateFrom.substring(5)} – {dateTo.substring(5)})</div>
              </div>
            </div>

            {/* Ticket Metrics */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-blue-600">{u.openT}</div>
                <div className="text-[8px] text-slate-500 font-semibold">In Queue</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-emerald-600">{u.closedT}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Closed</div>
              </div>
              <div className={'rounded-lg p-2 text-center ' + (u.overdueCount > 0 ? 'bg-red-50' : 'bg-slate-50')}>
                <div className={'text-lg font-bold ' + (u.overdueCount > 0 ? 'text-red-600' : 'text-slate-400')}>{u.overdueCount}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Overdue Now</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-purple-600">{u.createdT}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Created</div>
              </div>
            </div>

            {/* Rates & Quotes */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-cyan-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-cyan-600">{u.ratesCompleted}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Rates Added</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-amber-600">{u.quotesCompleted}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Quotes Created</div>
              </div>
            </div>

            {/* Overdue History */}
            <div className="flex gap-3 text-[10px] border-t border-slate-100 pt-2 mb-2">
              <span className={u.totalTimesOverdue > 0 ? 'text-red-500 font-bold' : 'text-slate-400'}>
                🚨 {u.totalTimesOverdue} times overdue
              </span>
              <span className={u.avgOverdueDays > 0 ? 'text-orange-500 font-bold' : 'text-slate-400'}>
                ⏱️ {u.avgOverdueDays}d avg overdue
              </span>
            </div>

            {/* Activity breakdown by category */}
            <div className="border-t border-slate-100 pt-2 mb-2">
              <div className="text-[9px] font-bold text-slate-400 mb-1.5">Activity Breakdown</div>
              <div className="flex gap-1.5 flex-wrap">
                {(u.topCats || []).map(([cat, count]) => (
                  <div key={cat} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
                    style={{ background: (CAT_COLORS[cat] || '#94a3b8') + '15', color: CAT_COLORS[cat] || '#94a3b8' }}>
                    {CAT_ICONS[cat] || '⚡'} {CAT_LABELS[cat] || cat} <span className="font-extrabold ml-0.5">{count}</span>
                  </div>
                ))}
                {(u.topCats || []).length === 0 && <span className="text-[10px] text-slate-400">No activity</span>}
              </div>
            </div>

            {/* Performance indicator */}
            {u.overdueCount > 2 && <div className="mt-2 px-2 py-1 bg-red-100 border border-red-200 rounded text-[10px] text-red-700 font-bold">⚠️ {u.overdueCount} tickets overdue — needs attention</div>}
            {u.totalActivities === 0 && <div className="mt-2 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[10px] text-slate-500">No activity in selected period</div>}
          </div>
        ))}
      </div>
    </div>)}

    {/* ===== SALES PIPELINE ===== */}
    {section === 'pipeline' && (<div>
      {(() => {
        const cust = customers || [];

        // Per-user pipeline stats
        const userStats = (users || []).map(u => {
          const assigned = cust.filter(c => c.assigned_rep === u.id);
          const byStage = {};
          PIPELINE_STAGES.forEach(s => { byStage[s.v] = assigned.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });
          return { ...u, assigned: assigned.length, byStage };
        }).filter(u => u.assigned > 0);

        // Overall pipeline
        const overallByStage = {};
        PIPELINE_STAGES.forEach(s => { overallByStage[s.v] = cust.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });

        // Drill-down clients
        const drillClients = drillStage ? cust.filter(c =>
          (c.pipeline_stage || 'lead') === drillStage &&
          (!drillUser || c.assigned_rep === drillUser)
        ) : [];

        return (<div>
          {/* Overall funnel */}
          <div className="bg-white rounded-xl p-4 mb-3">
            <h3 className="text-sm font-bold mb-3">Overall Pipeline / خط المبيعات</h3>
            <div className="flex gap-1 flex-wrap">
              {PIPELINE_STAGES.map(s => (
                <button key={s.v} onClick={() => { setDrillStage(s.v); setDrillUser(null); }}
                  className={'px-3 py-2 rounded-lg text-xs font-bold transition flex-1 min-w-[80px] text-center ' + (drillStage === s.v && !drillUser ? 'text-white shadow' : '')}
                  style={drillStage === s.v && !drillUser ? { background: s.c } : { background: s.c + '15', color: s.c }}>
                  <div className="text-lg">{overallByStage[s.v]}</div>
                  <div className="text-[9px]">{s.icon} {s.l}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Per-user breakdown */}
          <div className="bg-white rounded-xl p-4 mb-3">
            <h3 className="text-sm font-bold mb-3">By Team Member / حسب الفريق</h3>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left font-bold">Rep</th>
                  <th className="px-3 py-2 text-center font-bold">Total</th>
                  {PIPELINE_STAGES.map(s => <th key={s.v} className="px-2 py-2 text-center" style={{color:s.c}}>{s.icon}</th>)}
                </tr></thead>
                <tbody>
                  {userStats.map(u => (
                    <tr key={u.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 font-semibold">{u.name}</td>
                      <td className="px-3 py-2 text-center font-bold">{u.assigned}</td>
                      {PIPELINE_STAGES.map(s => (
                        <td key={s.v} className="px-2 py-2 text-center">
                          {u.byStage[s.v] > 0 ? (
                            <button onClick={() => { setDrillStage(s.v); setDrillUser(u.id); }}
                              className="px-2 py-0.5 rounded font-bold text-white text-[10px]" style={{background:s.c}}>
                              {u.byStage[s.v]}
                            </button>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drill-down */}
          {drillStage && (
            <div className="bg-white rounded-xl p-4 mb-3">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold">
                  {PIPELINE_STAGES.find(s=>s.v===drillStage)?.icon} {PIPELINE_STAGES.find(s=>s.v===drillStage)?.l}
                  {drillUser && ' — ' + (users?.find(u=>u.id===drillUser)?.name || '')}
                  <span className="text-slate-400 ml-1">({drillClients.length})</span>
                </h3>
                <button onClick={() => { setDrillStage(null); setDrillUser(null); }} className="px-2 py-1 border rounded text-xs">Close</button>
              </div>
              <div className="space-y-1 max-h-[300px] overflow-auto">
                {drillClients.map(c => {
                  const rep = users?.find(u => u.id === c.assigned_rep);
                  return (
                    <div key={c.id} className="flex justify-between items-center py-2 px-2 border-b border-slate-50 hover:bg-slate-50 rounded">
                      <div>
                        <div className="text-xs font-bold" style={{direction:'rtl'}}>{c.name_en || c.name}</div>
                        <div className="text-[10px] text-slate-500">{c.industry || ''} {c.group_name ? '· ' + c.group_name : ''}</div>
                      </div>
                      <div className="text-right">
                        {rep && <div className="text-[10px] text-indigo-600 font-semibold">{rep.name}</div>}
                        {c.phone && <div className="text-[10px] text-slate-400">{c.phone}</div>}
                      </div>
                    </div>
                  );
                })}
                {drillClients.length === 0 && <div className="text-xs text-slate-400 text-center py-4">No clients in this stage</div>}
              </div>
            </div>
          )}
        </div>);
      })()}
    </div>)}

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
            var userName = getUserName(l.user_id);
            var cat = l.log_category || 'other';
            var icons = {ticket:'🎫',crm:'🤝',shipping:'🛳️',customs:'🚢',calendar:'📅',finance:'💰',manual:'✏️',other:'⚡'};
            return (
              <div key={l.id} className="flex items-start gap-2 py-2 border-b border-slate-50">
                <span className="text-sm mt-0.5">{icons[cat] || (l.auto_generated ? '⚡' : '✏️')}</span>
                <div className="flex-1">
                  <div className="text-xs">{l.entry_text}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    <span className="text-blue-500 font-semibold mr-2">{userName}</span>
                    {l.log_date} {l.log_time ? l.log_time.substring(0, 5) : ''}
                    {cat !== 'other' && <span className="ml-2 px-1 py-0.5 bg-slate-100 rounded text-[9px]">{cat}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredLogs.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No activity</div>}
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
        <h3 className="text-sm font-bold mb-3">{selUserName} — Tickets</h3>
        <div className="overflow-auto max-h-[500px] rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0"><tr className="bg-slate-50">
              <th className="px-2 py-2 text-[10px] text-left">#</th>
              <th className="px-2 py-2 text-[10px] text-left">Title</th>
              <th className="px-2 py-2 text-[10px]">Status</th>
              <th className="px-2 py-2 text-[10px]">Priority</th>
              <th className="px-2 py-2 text-[10px] text-left">Assigned</th>
              <th className="px-2 py-2 text-[10px]">Due</th>
            </tr></thead>
            <tbody>
              {filteredTickets.filter(t=>t.status!=='Closed').concat(filteredTickets.filter(t=>t.status==='Closed').slice(0,20)).map(t => {
                var isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'Closed';
                return (
                  <tr key={t.id} className={'border-b border-slate-50 ' + (isOverdue ? 'bg-red-50' : t.status === 'Closed' ? 'opacity-50' : '')}>
                    <td className="px-2 py-2 text-blue-500 font-mono text-[10px]">{t.ticket_number || '—'}</td>
                    <td className="px-2 py-2 font-semibold max-w-[200px] truncate">{t.title}</td>
                    <td className="px-2 py-2 text-center"><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></td>
                    <td className="px-2 py-2 text-center"><span className={'font-bold ' + (t.priority==='high'?'text-red-500':t.priority==='low'?'text-green-500':'text-amber-500')}>{t.priority}</span></td>
                    <td className="px-2 py-2"><span className={t.assigned_to ? 'text-purple-600 font-semibold' : 'text-red-400'}>{t.assigned_to ? getUserName(t.assigned_to) : 'UNASSIGNED'}</span></td>
                    <td className={'px-2 py-2 text-center ' + (isOverdue ? 'text-red-600 font-bold' : '')}>{t.due_date || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>)}

    {/* ===== AUDIT LOG ===== */}
    {section === 'audit' && (<div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">{selUserName} — Audit Log ({filteredAudit.length})</h3>
        <div className="space-y-1 max-h-[600px] overflow-auto">
          {filteredAudit.map(a => {
            var userName = getUserName(a.changed_by);
            var actionColors = { create: 'text-emerald-600', update: 'text-blue-600', delete: 'text-red-600' };
            var actionIcons = { create: '✨', update: '✏️', delete: '🗑️' };
            return (
              <div key={a.id} className="py-2 border-b border-slate-50">
                <div className="flex items-center gap-2 text-xs">
                  <span>{actionIcons[a.action] || '📋'}</span>
                  <span className={'font-bold ' + (actionColors[a.action] || '')}>{(a.action||'').toUpperCase()}</span>
                  <span className="text-slate-500">{a.table_name}</span>
                  <span className="text-blue-500 font-semibold ml-auto">{userName}</span>
                  <span className="text-slate-400">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                </div>
                {a.new_values && (
                  <div className="text-[10px] text-slate-500 mt-1 bg-slate-50 rounded p-1.5 max-h-[60px] overflow-auto">
                    {typeof a.new_values === 'object' ? Object.entries(a.new_values).slice(0, 5).map(function(entry) {
                      return <span key={entry[0]} className="mr-2"><span className="text-slate-400">{entry[0]}:</span> <span className="font-semibold">{String(entry[1]).substring(0, 50)}</span></span>;
                    }) : String(a.new_values).substring(0, 200)}
                  </div>
                )}
              </div>
            );
          })}
          {filteredAudit.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No audit entries</div>}
        </div>
      </div>
    </div>)}
  </div>);
}
