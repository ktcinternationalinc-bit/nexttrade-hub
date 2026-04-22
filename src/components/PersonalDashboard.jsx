'use client';
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

const STATUS_COLORS = { New:'#3b82f6', Acknowledged:'#8b5cf6', 'In Progress':'#f59e0b', Waiting:'#6b7280', Review:'#ec4899', Testing:'#14b8a6', Ready:'#10b981', Closed:'#374151', Reopened:'#ef4444' };
const PIPELINE_STAGES = [
  { v: 'lead', l: 'Lead', c: '#94a3b8', icon: '🔘' },
  { v: 'contacted', l: 'Contacted', c: '#3b82f6', icon: '📞' },
  { v: 'qualified', l: 'Qualified', c: '#8b5cf6', icon: '✅' },
  { v: 'proposal', l: 'Proposal', c: '#f59e0b', icon: '📋' },
  { v: 'negotiation', l: 'Negotiation', c: '#ec4899', icon: '🤝' },
  { v: 'won', l: 'Won / Deal', c: '#10b981', icon: '🏆' },
  { v: 'lost', l: 'Lost', c: '#ef4444', icon: '❌' },
];

export default function PersonalDashboard({ user, userProfile, isAdmin, invoices, customers, navigate, fE, users }) {
  const [tickets, setTickets] = useState([]);
  const [events, setEvents] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [newReminder, setNewReminder] = useState('');
  const [reminderDue, setReminderDue] = useState('');
  const todayStr = new Date().toISOString().substring(0, 10);
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';
  const myId = userProfile?.id || user?.id;

  useEffect(() => { const load = async () => {
    const pid = userProfile?.id || user?.id;
    const [t, e, fu] = await Promise.all([
      supabase.from('tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('calendar_events').select('*').gte('event_date', todayStr).order('event_date').order('event_time').limit(30),
      supabase.from('follow_ups').select('*, customers(name, name_en)').eq('completed', false).order('due_date'),
    ]);
    setTickets(t.data || []); setEvents(e.data || []); setFollowUps(fu.data || []);
    try { const { data: rm } = await supabase.from('reminders').select('*').eq('user_id', pid).eq('completed', false).order('due_date'); setReminders(rm || []); } catch(e) { console.warn(e); }
    setLoaded(true);
  }; load(); }, [user, userProfile]);

  const addReminder = async () => { if (!newReminder.trim()) return; try { await dbInsert('reminders', { user_id: myId, text: newReminder, due_date: reminderDue || null }, myId); setNewReminder(''); setReminderDue(''); const { data } = await supabase.from('reminders').select('*').eq('user_id', myId).eq('completed', false).order('due_date'); setReminders(data || []); } catch(e) { console.warn(e); } };
  const completeReminder = async (id) => { try { await dbUpdate('reminders', id, { completed: true }, myId); setReminders(reminders.filter(r => r.id !== id)); } catch(e) { console.warn(e); } };

  if (!loaded) return <div className="text-center text-slate-400 py-4 text-sm">Loading...</div>;

  const myTickets = tickets.filter(t => t.assigned_to === myId && t.status !== 'Closed');
  const ticketsICreated = tickets.filter(t => t.created_by === myId && t.assigned_to !== myId && t.status !== 'Closed');
  const teamTickets = tickets.filter(t => t.status !== 'Closed' && t.assigned_to !== myId && t.created_by !== myId);
  const needsAck = myTickets.filter(t => t.status === 'New');
  const myEvents = events.filter(e => e.assigned_to === myId || e.created_by === myId);
  const todayEvents = myEvents.filter(e => e.event_date === todayStr);
  const upcomingEvents = myEvents.filter(e => e.event_date > todayStr).slice(0, 5);
  const myFollowUps = followUps.filter(fu => fu.assigned_to === myId || fu.created_by === myId);
  const overdueFollowUps = myFollowUps.filter(fu => fu.due_date && fu.due_date < todayStr);
  const overdueTickets = [...myTickets, ...ticketsICreated].filter(t => t.due_date && t.due_date < todayStr);
  const overdueReminders = reminders.filter(r => r.due_date && r.due_date < todayStr);

  const myCustomers = customers.filter(c => c.assigned_rep === myId);
  const pipelineStats = {};
  PIPELINE_STAGES.forEach(s => { pipelineStats[s.v] = myCustomers.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });
  const notContacted30 = customers.filter(c => { if (c.assigned_rep && c.assigned_rep !== myId && !isAdmin) return false; if (!c.last_contact_date) return c.assigned_rep === myId; return Math.floor((Date.now() - new Date(c.last_contact_date).getTime()) / 86400000) > 30; });

  const mySales = invoices.filter(inv => inv.sales_rep === userProfile?.name || inv.created_by === myId);
  const thisMonth = todayStr.substring(0, 7);
  const monthlyTotal = mySales.filter(inv => (inv.invoice_date || '').startsWith(thisMonth)).reduce((a, i) => a + Number(i.total_amount || 0), 0);

  const allOverdue = [
    ...overdueTickets.map(t => ({ type: 'ticket', title: t.title, due: t.due_date, assignee: getUserName(t.assigned_to), status: t.status })),
    ...overdueFollowUps.map(f => ({ type: 'followup', title: f.task, due: f.due_date, customer: f.customers?.name })),
    ...overdueReminders.map(r => ({ type: 'reminder', title: r.text, due: r.due_date })),
  ].sort((a, b) => (a.due || '').localeCompare(b.due || ''));

  return (<div className="mb-4">
    {allOverdue.length > 0 && (<div className="bg-red-50 rounded-xl p-4 mb-4 border-2 border-red-300">
      <h3 className="text-sm font-extrabold text-red-700 mb-2">🚨 OVERDUE ({allOverdue.length})</h3>
      <div className="space-y-1.5 max-h-[200px] overflow-auto">{allOverdue.map((item, i) => {
        const d = Math.floor((Date.now() - new Date(item.due).getTime()) / 86400000);
        return (<div key={i} className="flex justify-between items-center py-1.5 px-2 bg-red-100 rounded border border-red-200">
          <div className="flex items-center gap-2 flex-1"><span className="text-xs">{item.type==='ticket'?'🎫':item.type==='followup'?'📞':'⏰'}</span>
            <div><div className="text-xs font-bold text-red-800">{item.title}</div>
              <div className="text-[10px] text-red-600">Due: {item.due}{item.assignee&&' • 👤 '+item.assignee}{item.customer&&' • '+item.customer}{item.status&&' • '+item.status}</div></div></div>
          <span className="text-xs font-extrabold text-red-700 whitespace-nowrap">{d}d late</span></div>);
      })}</div></div>)}

    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('tickets')} style={{borderLeftWidth:3,borderLeftColor:needsAck.length>0?'#ef4444':'#3b82f6'}}><div className="text-[10px] text-slate-500">My Tickets</div><div className="text-lg font-extrabold">{myTickets.length}</div>{needsAck.length>0&&<div className="text-[10px] text-red-600 font-bold">⚠️ {needsAck.length} new</div>}</div>
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('tickets')} style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Assigned by Me</div><div className="text-lg font-extrabold">{ticketsICreated.length}</div></div>
      {(isAdmin || teamTickets.length > 0) && <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('tickets')} style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Team Tickets</div><div className="text-lg font-extrabold">{teamTickets.length}</div></div>}
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('calendar')} style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Today's Events</div><div className="text-lg font-extrabold">{todayEvents.length}</div><div className="text-[10px] text-slate-400">{upcomingEvents.length} upcoming</div></div>
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('crm')} style={{borderLeftWidth:3,borderLeftColor:overdueFollowUps.length>0?'#ef4444':'#f59e0b'}}><div className="text-[10px] text-slate-500">Follow-ups</div><div className="text-lg font-extrabold">{myFollowUps.length}</div>{overdueFollowUps.length>0&&<div className="text-[10px] text-red-600 font-bold">⚠️ {overdueFollowUps.length} overdue</div>}</div>
      {monthlyTotal>0&&<div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('sales')} style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Sales ({thisMonth})</div><div className="text-lg font-extrabold text-emerald-600">{fE(monthlyTotal)}</div></div>}
    </div>

    {myTickets.length>0&&(<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">🎫 My Tickets ({myTickets.length})</h3><div className="space-y-1.5 max-h-[220px] overflow-auto">{myTickets.map(t=>{const ov=t.due_date&&t.due_date<todayStr; return (<div key={t.id} onClick={()=>navigate('tickets')} className={'flex justify-between items-center py-2 px-2 rounded cursor-pointer hover:bg-blue-50 border '+(ov?'border-red-200 bg-red-50':t.status==='New'?'border-purple-200 bg-purple-50':'border-slate-100')}><div className="flex-1"><div className="text-xs font-bold">{t.title}</div><div className="text-[10px] text-slate-500">{t.due_date&&<span className={ov?'text-red-600 font-bold':''}>Due: {t.due_date} </span>}{t.priority==='high'&&<span className="text-red-500 font-bold">🔴 </span>}{getUserName(t.created_by)&&<span className="text-slate-400">From: {getUserName(t.created_by)}</span>}</div></div><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white ml-2" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></div>);})}</div></div>)}

    {ticketsICreated.length>0&&(<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📤 Tickets I Assigned ({ticketsICreated.length})</h3><div className="space-y-1.5 max-h-[200px] overflow-auto">{ticketsICreated.map(t=>{const ov=t.due_date&&t.due_date<todayStr; return (<div key={t.id} onClick={()=>navigate('tickets')} className={'flex justify-between items-center py-2 px-2 rounded cursor-pointer hover:bg-blue-50 border '+(ov?'border-red-200 bg-red-50':'border-slate-100')}><div className="flex-1"><div className="text-xs font-bold">{t.title}</div><div className="text-[10px] text-slate-500"><span className="text-purple-600 font-semibold">👤 {getUserName(t.assigned_to)||'Unassigned'}</span>{t.due_date&&<span className={ov?' text-red-600 font-bold':''}> • Due: {t.due_date}</span>}<span className="text-slate-400"> • {t.updated_at?new Date(t.updated_at).toLocaleDateString():'—'}</span></div></div><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white ml-2" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></div>);})}</div></div>)}

    <div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📅 Today ({todayEvents.length})</h3>
      {todayEvents.length>0?todayEvents.map(ev=>(<div key={ev.id} className="flex justify-between items-center py-2 border-b border-slate-50"><div><div className="text-xs font-semibold">{ev.title}</div><div className="text-[10px] text-slate-400">{ev.event_time?ev.event_time.substring(0,5):'All day'} • {ev.event_type||'Event'}</div></div><span className={'text-[10px] font-bold '+(ev.completed?'text-emerald-500':'text-amber-500')}>{ev.completed?'✅':'⏳'}</span></div>)):<div className="text-xs text-slate-400 py-2">No events today</div>}
      {upcomingEvents.length>0&&(<div className="mt-2 pt-2 border-t border-slate-100"><div className="text-[10px] font-semibold text-slate-500 mb-1">Upcoming</div>{upcomingEvents.map(ev=>(<div key={ev.id} className="flex justify-between py-1 text-[10px] text-slate-500"><span>{ev.title}</span><span>{ev.event_date} {ev.event_time?ev.event_time.substring(0,5):''}</span></div>))}</div>)}</div>

    {/* Reminders — split into Urgent (today or overdue) vs Normal (future).
        Today-due items (not yet overdue) get a blink animation so they stand out.
        Tickets with due_date === today are folded in because they're reminders
        that need action TODAY but aren't yet late. */}
    <div className="bg-white rounded-xl p-4 mb-3">
      <h3 className="text-sm font-bold mb-2">⏰ Reminders</h3>
      <div className="flex gap-2 mb-3">
        <input value={newReminder} onChange={e=>setNewReminder(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addReminder()} placeholder="Quick reminder..." className="flex-1 px-3 py-2 rounded-lg border text-xs" />
        <input type="date" value={reminderDue} onChange={e=>setReminderDue(e.target.value)} className="px-2 py-2 rounded-lg border text-xs w-32" />
        <button onClick={addReminder} className="px-3 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">Add</button>
      </div>
      {(() => {
        // Bucket reminders
        const urgentReminders = reminders.filter(r => r.due_date && r.due_date <= todayStr);
        const normalReminders = reminders.filter(r => !r.due_date || r.due_date > todayStr);
        // Today-due tickets appear here too — they're action items for today.
        // Overdue tickets are already surfaced in the top "🚨 OVERDUE" banner so
        // we skip them here to avoid duplication.
        const todayDueTickets = [...myTickets, ...ticketsICreated]
          .filter(t => t.due_date === todayStr)
          .map(t => ({ kind: 'ticket', id: t.id, text: t.title, due_date: t.due_date, status: t.status, priority: t.priority }));
        const urgentAll = [...urgentReminders.map(r => ({ kind: 'reminder', ...r })), ...todayDueTickets];

        if (urgentAll.length === 0 && normalReminders.length === 0) {
          return <div className="text-xs text-slate-400">No reminders</div>;
        }

        return (<>
          {urgentAll.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-extrabold text-red-700 uppercase tracking-wide mb-1">🔴 Urgent ({urgentAll.length})</div>
              <div className="space-y-1 max-h-[160px] overflow-auto">{urgentAll.map(item => {
                const overdue = item.due_date && item.due_date < todayStr;
                const today = item.due_date === todayStr;
                // Blink today-due (not overdue) — draws the eye to "act TODAY"
                const blinkClass = today && !overdue ? 'animate-pulse' : '';
                return (<div key={item.kind + ':' + item.id}
                  className={'flex justify-between items-center py-1.5 px-2 rounded border ' +
                    (overdue ? 'border-red-300 bg-red-50 ' : 'border-amber-300 bg-amber-50 ') + blinkClass}>
                  <div className="flex-1 min-w-0">
                    <div className={'text-xs font-bold ' + (overdue ? 'text-red-700' : 'text-amber-800')}>
                      {item.kind === 'ticket' ? '🎫 ' : ''}{item.text}
                    </div>
                    <div className={'text-[10px] font-bold ' + (overdue ? 'text-red-600' : 'text-amber-700')}>
                      {overdue ? 'Overdue ' : 'Due today'}{item.due_date ? ' • ' + item.due_date : ''}
                      {item.priority === 'high' && <span className="ml-1 text-red-500">🔴 HIGH</span>}
                      {item.status && <span className="ml-1 text-slate-500">• {item.status}</span>}
                    </div>
                  </div>
                  {item.kind === 'reminder' && <button onClick={()=>completeReminder(item.id)} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold ml-2">Done ✓</button>}
                  {item.kind === 'ticket' && <button onClick={()=>navigate('tickets')} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold ml-2">Open →</button>}
                </div>);
              })}</div>
            </div>
          )}
          {normalReminders.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Normal ({normalReminders.length})</div>
              <div className="space-y-1 max-h-[150px] overflow-auto">{normalReminders.map(r => (
                <div key={r.id} className="flex justify-between items-center py-1.5 px-2 rounded border border-slate-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs">{r.text}</div>
                    {r.due_date && <div className="text-[10px] text-slate-400">Due: {r.due_date}</div>}
                  </div>
                  <button onClick={()=>completeReminder(r.id)} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold ml-2">Done ✓</button>
                </div>
              ))}</div>
            </div>
          )}
        </>);
      })()}
    </div>

    {(myCustomers.length>0||isAdmin)&&(<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📊 My Pipeline ({myCustomers.length} clients)</h3><div className="flex gap-1.5 flex-wrap mb-2">{PIPELINE_STAGES.map(s=>{const c=pipelineStats[s.v]||0; return (<div key={s.v} className="rounded-lg px-3 py-2 text-center min-w-[70px]" style={{background:c>0?s.c+'15':'#f8fafc',borderLeft:'3px solid '+(c>0?s.c:'#e2e8f0')}}><div className="text-lg font-extrabold" style={{color:c>0?s.c:'#cbd5e1'}}>{c}</div><div className="text-[9px] font-semibold text-slate-600">{s.icon} {s.l}</div></div>);})}</div>{notContacted30.length>0&&<div className="bg-amber-50 rounded-lg p-2 mt-2 border border-amber-200"><div className="text-[10px] font-bold text-amber-700">⚠️ {notContacted30.length} clients not contacted in 30+ days</div></div>}</div>)}

    {overdueFollowUps.length>0&&(<div className="bg-red-50 rounded-xl p-4 mb-3 border border-red-200"><h3 className="text-sm font-bold text-red-700 mb-2">⚠️ Overdue Follow-ups ({overdueFollowUps.length})</h3>{overdueFollowUps.map(fu=>(<div key={fu.id} className="flex justify-between items-center py-1.5 border-b border-red-100"><div><div className="text-xs font-semibold">{fu.task}</div><div className="text-[10px] text-slate-500">{fu.customers?.name||''} • Due: {fu.due_date}</div></div><span className="text-[10px] font-bold text-red-600">{Math.floor((Date.now()-new Date(fu.due_date).getTime())/86400000)}d late</span></div>))}</div>)}

    {/* Monthly Sales Report - visible to all */}
    {(() => {
      const monthlySales = {};
      invoices.filter(inv => inv.invoice_date >= '2026-01-01').forEach(inv => {
        const m = (inv.invoice_date || '').substring(0, 7);
        if (m) {
          if (!monthlySales[m]) monthlySales[m] = { invoiced: 0, collected: 0, count: 0 };
          monthlySales[m].invoiced += Number(inv.total_amount || 0);
          monthlySales[m].collected += Number(inv.total_collected || 0);
          monthlySales[m].count++;
        }
      });
      const months = Object.entries(monthlySales).sort((a, b) => b[0].localeCompare(a[0]));
      const totalInvoiced = months.reduce((a, m) => a + m[1].invoiced, 0);
      const totalCollected = months.reduce((a, m) => a + m[1].collected, 0);
      if (months.length === 0) return null;
      return (
        <div className="bg-white rounded-xl p-4 mb-3">
          <h3 className="text-sm font-bold mb-3">📊 Monthly Sales Report (2026)</h3>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-blue-50 rounded-lg p-2 text-center"><div className="text-lg font-extrabold text-blue-600">{fE(totalInvoiced)}</div><div className="text-[9px] text-slate-500">Total Invoiced</div></div>
            <div className="bg-emerald-50 rounded-lg p-2 text-center"><div className="text-lg font-extrabold text-emerald-600">{fE(totalCollected)}</div><div className="text-[9px] text-slate-500">Total Collected</div></div>
            <div className="bg-amber-50 rounded-lg p-2 text-center"><div className="text-lg font-extrabold text-amber-600">{fE(totalInvoiced - totalCollected)}</div><div className="text-[9px] text-slate-500">Outstanding</div></div>
          </div>
          <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0"><tr className="bg-slate-50">
                <th className="px-3 py-2 text-left text-[10px]">Month</th>
                <th className="px-3 py-2 text-right text-[10px]">Orders</th>
                <th className="px-3 py-2 text-right text-[10px]">Invoiced</th>
                <th className="px-3 py-2 text-right text-[10px]">Collected</th>
                <th className="px-3 py-2 text-right text-[10px]">Outstanding</th>
              </tr></thead>
              <tbody>
                {months.map(([month, data]) => {
                  const outstanding = data.invoiced - data.collected;
                  const collPct = data.invoiced > 0 ? Math.round((data.collected / data.invoiced) * 100) : 0;
                  return (
                    <tr key={month} className="border-b border-slate-50 hover:bg-blue-50">
                      <td className="px-3 py-2 font-semibold">{month}</td>
                      <td className="px-3 py-2 text-right">{data.count}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-600">{fE(data.invoiced)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{fE(data.collected)} <span className="text-[9px] text-slate-400">({collPct}%)</span></td>
                      <td className={'px-3 py-2 text-right font-bold ' + (outstanding > 0 ? 'text-amber-600' : 'text-emerald-500')}>{fE(outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    })()}
  </div>);
}
