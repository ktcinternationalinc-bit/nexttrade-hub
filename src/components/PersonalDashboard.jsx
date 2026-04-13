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
    try { const { data: rm } = await supabase.from('reminders').select('*').eq('user_id', pid).eq('completed', false).order('due_date'); setReminders(rm || []); } catch(e) {}
    setLoaded(true);
  }; load(); }, [user, userProfile]);

  const addReminder = async () => { if (!newReminder.trim()) return; try { await dbInsert('reminders', { user_id: myId, text: newReminder, due_date: reminderDue || null }, myId); setNewReminder(''); setReminderDue(''); const { data } = await supabase.from('reminders').select('*').eq('user_id', myId).eq('completed', false).order('due_date'); setReminders(data || []); } catch(e) {} };
  const completeReminder = async (id) => { try { await dbUpdate('reminders', id, { completed: true }, myId); setReminders(reminders.filter(r => r.id !== id)); } catch(e) {} };

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
    <div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">⏰ Reminders</h3>
      <div className="flex gap-2 mb-3"><input value={newReminder} onChange={e=>setNewReminder(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addReminder()} placeholder="Quick reminder..." className="flex-1 px-3 py-2 rounded-lg border text-xs" /><input type="date" value={reminderDue} onChange={e=>setReminderDue(e.target.value)} className="px-2 py-2 rounded-lg border text-xs w-32" /><button onClick={addReminder} className="px-3 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">Add</button></div>
      {reminders.length>0?(<div className="space-y-1 max-h-[150px] overflow-auto">{reminders.map(r=>{const ov=r.due_date&&r.due_date<todayStr; return (<div key={r.id} className={'flex justify-between items-center py-1.5 px-2 rounded border '+(ov?'border-red-200 bg-red-50':'border-slate-100')}><div className="flex-1"><div className={'text-xs '+(ov?'font-bold text-red-700':'')}>{r.text}</div>{r.due_date&&<div className={'text-[10px] '+(ov?'text-red-600 font-bold':'text-slate-400')}>Due: {r.due_date}</div>}</div><button onClick={()=>completeReminder(r.id)} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold ml-2">Done ✓</button></div>);})}</div>):<div className="text-xs text-slate-400">No reminders</div>}</div>

    {(myCustomers.length>0||isAdmin)&&(<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📊 My Pipeline ({myCustomers.length} clients)</h3><div className="flex gap-1.5 flex-wrap mb-2">{PIPELINE_STAGES.map(s=>{const c=pipelineStats[s.v]||0; return (<div key={s.v} className="rounded-lg px-3 py-2 text-center min-w-[70px]" style={{background:c>0?s.c+'15':'#f8fafc',borderLeft:'3px solid '+(c>0?s.c:'#e2e8f0')}}><div className="text-lg font-extrabold" style={{color:c>0?s.c:'#cbd5e1'}}>{c}</div><div className="text-[9px] font-semibold text-slate-600">{s.icon} {s.l}</div></div>);})}</div>{notContacted30.length>0&&<div className="bg-amber-50 rounded-lg p-2 mt-2 border border-amber-200"><div className="text-[10px] font-bold text-amber-700">⚠️ {notContacted30.length} clients not contacted in 30+ days</div></div>}</div>)}

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
