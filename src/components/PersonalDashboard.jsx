'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function PersonalDashboard({ user, userProfile, isAdmin, invoices, customers, navigate, fE }) {
  const [tickets, setTickets] = useState([]);
  const [events, setEvents] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [t, e, fu] = await Promise.all([
        supabase.from('tickets').select('*').order('created_at', { ascending: false }),
        supabase.from('calendar_events').select('*').gte('event_date', new Date().toISOString().substring(0, 10)).order('event_date').limit(20),
        supabase.from('follow_ups').select('*, customers(name)').eq('completed', false).order('due_date'),
      ]);
      setTickets(t.data || []);
      setEvents(e.data || []);
      setFollowUps(fu.data || []);
      setLoaded(true);
    };
    load();
  }, []);

  if (!loaded) return <div className="text-center text-slate-400 py-4 text-sm">Loading...</div>;

  const todayStr = new Date().toISOString().substring(0, 10);
  const myTickets = tickets.filter(t => t.assigned_to === user?.id && t.status !== 'Closed');
  const needsAck = myTickets.filter(t => t.status === 'New');
  const overdueTickets = myTickets.filter(t => t.due_date && t.due_date < todayStr);
  const myEvents = events.filter(e => (e.assigned_to === user?.id || e.created_by === user?.id) && !e.completed);
  const todayEvents = myEvents.filter(e => e.event_date === todayStr);
  const myFollowUps = followUps.filter(fu => fu.assigned_to === user?.id || fu.created_by === user?.id);
  const overdueFollowUps = myFollowUps.filter(fu => fu.due_date && fu.due_date < todayStr);

  // My sales (if sales rep)
  const mySales = invoices.filter(inv => inv.sales_rep === userProfile?.name || inv.created_by === user?.id);
  const thisMonth = todayStr.substring(0, 7);
  const monthlySales = mySales.filter(inv => (inv.invoice_date || '').startsWith(thisMonth));
  const monthlyTotal = monthlySales.reduce((a, i) => a + Number(i.total_amount || 0), 0);

  const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#f59e0b',Waiting:'#6b7280',Review:'#ec4899',Closed:'#374151'};

  return (
    <div className="mb-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={() => navigate('tickets')}
          style={{borderLeftWidth:3, borderLeftColor: needsAck.length > 0 ? '#ef4444' : '#3b82f6'}}>
          <div className="text-[10px] text-slate-500">My Tickets / تذاكري</div>
          <div className="text-lg font-extrabold">{myTickets.length}</div>
          {needsAck.length > 0 && <div className="text-[10px] text-red-600 font-bold">⚠️ {needsAck.length} need acknowledgment</div>}
        </div>
        <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={() => navigate('calendar')}
          style={{borderLeftWidth:3, borderLeftColor:'#8b5cf6'}}>
          <div className="text-[10px] text-slate-500">Today's Events / أحداث اليوم</div>
          <div className="text-lg font-extrabold">{todayEvents.length}</div>
          <div className="text-[10px] text-slate-400">{myEvents.length} upcoming total</div>
        </div>
        <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={() => navigate('crm')}
          style={{borderLeftWidth:3, borderLeftColor: overdueFollowUps.length > 0 ? '#ef4444' : '#f59e0b'}}>
          <div className="text-[10px] text-slate-500">Follow-ups / متابعات</div>
          <div className="text-lg font-extrabold">{myFollowUps.length}</div>
          {overdueFollowUps.length > 0 && <div className="text-[10px] text-red-600 font-bold">⚠️ {overdueFollowUps.length} overdue</div>}
        </div>
        {monthlyTotal > 0 && (
          <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={() => navigate('sales')}
            style={{borderLeftWidth:3, borderLeftColor:'#10b981'}}>
            <div className="text-[10px] text-slate-500">My Monthly Sales</div>
            <div className="text-lg font-extrabold text-emerald-600">{fE(monthlyTotal)}</div>
            <div className="text-[10px] text-slate-400">{monthlySales.length} orders this month</div>
          </div>
        )}
      </div>

      {/* My Open Tickets */}
      {myTickets.length > 0 && (
        <div className="bg-white rounded-xl p-4 mb-3">
          <h3 className="text-sm font-bold mb-2">🎫 My Open Tickets ({myTickets.length})</h3>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {myTickets.slice(0, 10).map(t => (
              <div key={t.id} onClick={() => navigate('tickets')}
                className="flex justify-between items-center py-1.5 border-b border-slate-50 cursor-pointer hover:bg-blue-50 rounded px-2">
                <div className="flex-1">
                  <div className="text-xs font-semibold">{t.title}</div>
                  <div className="text-[10px] text-slate-400">
                    {t.due_date && <span className={t.due_date < todayStr ? 'text-red-600 font-bold' : ''}>Due: {t.due_date} </span>}
                    {t.priority === 'high' && <span className="text-red-500">🔴 High</span>}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{background: STATUS_COLORS[t.status] || '#6b7280'}}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Events */}
      {todayEvents.length > 0 && (
        <div className="bg-white rounded-xl p-4 mb-3">
          <h3 className="text-sm font-bold mb-2">📅 Today's Schedule ({todayEvents.length})</h3>
          {todayEvents.map(ev => (
            <div key={ev.id} className="flex justify-between items-center py-1.5 border-b border-slate-50">
              <div>
                <div className="text-xs font-semibold">{ev.title}</div>
                <div className="text-[10px] text-slate-400">{ev.event_time || 'All day'} | {ev.event_type}</div>
              </div>
              <span className={'text-[10px] font-bold ' + (ev.completed ? 'text-emerald-500' : 'text-amber-500')}>{ev.completed ? '✅ Done' : '⏳ Pending'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Overdue Follow-ups */}
      {overdueFollowUps.length > 0 && (
        <div className="bg-red-50 rounded-xl p-4 mb-3 border border-red-200">
          <h3 className="text-sm font-bold text-red-700 mb-2">⚠️ Overdue Follow-ups ({overdueFollowUps.length})</h3>
          {overdueFollowUps.map(fu => (
            <div key={fu.id} className="flex justify-between items-center py-1.5 border-b border-red-100">
              <div>
                <div className="text-xs font-semibold">{fu.task}</div>
                <div className="text-[10px] text-slate-500">{fu.customers?.name || ''} | Due: {fu.due_date}</div>
              </div>
              <span className="text-[10px] font-bold text-red-600">
                {Math.floor((Date.now() - new Date(fu.due_date).getTime()) / 86400000)}d overdue
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
