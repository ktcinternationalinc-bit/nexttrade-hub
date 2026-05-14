'use client';
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { fmtET, todayET } from '../lib/et-time';
import AssistantsBar from './AssistantsBar';
import { SafeSection } from './ErrorBoundary';

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

export default function PersonalDashboard({ user, userProfile, isAdmin, isSuperAdmin, invoices, customers, navigate, fE, users, chatSurface }) {
  const [tickets, setTickets] = useState([]);
  const [events, setEvents] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [newReminder, setNewReminder] = useState('');
  const [reminderDue, setReminderDue] = useState('');
  // v55.65 — bugs the user filed that Claude shipped a fix for and that
  // are now waiting for the creator to retest.
  const [bugsToRetest, setBugsToRetest] = useState([]);
  const todayStr = todayET();
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';
  const myId = userProfile?.id || user?.id;

  // v55.68 — Bulletproof load with STABLE dependency.
  //
  // Why stable: previously `[user, userProfile]` re-fired the effect whenever
  // page.jsx re-created either object reference (which happens on most
  // re-renders), causing dashboard data to refetch and the `loaded` flag to
  // briefly flip false again on each remount. That flicker was unmounting
  // MyHRDesk + MyPerformance and resetting their internal state.
  //
  // myId is a primitive string, so the effect ONLY re-fires when the actual
  // logged-in user changes — not on every parent re-render.
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    const load = async () => {
      const pid = myId;
      // tickets
      try {
        const r = await supabase.from('tickets').select('*').order('created_at', { ascending: false });
        if (!cancelled) setTickets(r.data || []);
      } catch (err) { console.warn('[dashboard] tickets load failed:', err && err.message); }
      // calendar_events
      try {
        const r = await supabase.from('calendar_events').select('*').gte('event_date', todayStr).order('event_date').order('event_time').limit(30);
        if (!cancelled) setEvents(r.data || []);
      } catch (err) { console.warn('[dashboard] events load failed:', err && err.message); }
      // follow_ups
      try {
        const r = await supabase.from('follow_ups').select('*, customers(name, name_en)').eq('completed', false).order('due_date');
        if (!cancelled) setFollowUps(r.data || []);
      } catch (err) { console.warn('[dashboard] follow_ups load failed:', err && err.message); }
      // reminders
      try {
        const { data: rm } = await supabase.from('reminders').select('*').eq('user_id', pid).eq('completed', false).order('due_date');
        if (!cancelled) setReminders(rm || []);
      } catch (err) { console.warn('[dashboard] reminders load failed:', err && err.message); }
      // v55.65 — system tickets needing retest. Independent try/catch.
      try {
        const { data: bugs } = await supabase.from('system_tickets')
          .select('*')
          .eq('created_by', pid)
          .eq('needs_retest', true)
          .order('claude_last_fixed_at', { ascending: false });
        if (!cancelled) setBugsToRetest(bugs || []);
      } catch (err) { console.warn('[dashboard] bugsToRetest load failed (non-fatal):', err && err.message); }
      // ALWAYS flip loaded — never leave the dashboard stuck on "Loading..."
      if (!cancelled) setLoaded(true);
    };
    load();
    return () => { cancelled = true; };
  }, [myId]);

  const addReminder = async () => { if (!newReminder.trim()) return; try { await dbInsert('reminders', { user_id: myId, text: newReminder, due_date: reminderDue || null }, myId); setNewReminder(''); setReminderDue(''); const { data } = await supabase.from('reminders').select('*').eq('user_id', myId).eq('completed', false).order('due_date'); setReminders(data || []); } catch(e) { console.warn(e); } };
  const completeReminder = async (id) => { try { await dbUpdate('reminders', id, { completed: true }, myId); setReminders(reminders.filter(r => r.id !== id)); } catch(e) { console.warn(e); } };

  // v55.68 — derived values computed defensively. All array accessors guard
  // for missing data so the SAME render tree works whether data has loaded
  // yet or not. We no longer use a dual return path (early "Loading..." vs
  // main return) because that was causing React to unmount/remount MyHRDesk
  // and MyPerformance every time `loaded` flipped — which is what made them
  // appear, then disappear, then reappear. Now there's ONE return tree, the
  // dashboard cards just show their own inline loading spinners.
  // v55.82-Z QA — helpers for visibility-aware filtering.
  //   isMineByAssign: I'm assigned_to OR I'm in additional_assignees.
  //     This corrects an earlier under-count where a ticket I was added
  //     to via "additional assignees" didn't appear on my dashboard.
  //   canSee: visibility gate matching TicketsTab. Private (super-admin
  //     only) and confidential (creator/assignees) tickets don't appear
  //     in any list for non-viewers.
  const parseExtras = (t) => {
    if (!t || !t.additional_assignees) return [];
    try {
      var v = typeof t.additional_assignees === 'string'
        ? JSON.parse(t.additional_assignees)
        : t.additional_assignees;
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  };
  const isMineByAssign = (t) => t.assigned_to === myId || parseExtras(t).indexOf(myId) >= 0;
  const canSee = (t) => {
    if (isSuperAdmin) return true;
    if (t.is_private) return t.private_to === myId;
    if (t.is_confidential) {
      return t.created_by === myId || isMineByAssign(t);
    }
    return true;
  };
  // myTickets — anything assigned to me (direct or additional) and not closed.
  const myTickets = (tickets || []).filter(t => isMineByAssign(t) && t.status !== 'Closed' && canSee(t));
  // ticketsICreated — I made it but didn't assign it to myself.
  const ticketsICreated = (tickets || []).filter(t => t.created_by === myId && !isMineByAssign(t) && t.status !== 'Closed' && canSee(t));
  // teamTickets — open tickets not mine and not authored by me. Filter out
  // private and confidential I can't see, so other people's private items
  // never leak into my "team activity" view.
  const teamTickets = (tickets || []).filter(t => t.status !== 'Closed' && !isMineByAssign(t) && t.created_by !== myId && canSee(t));
  const needsAck = myTickets.filter(t => t.status === 'New');
  const myEvents = (events || []).filter(e => e.assigned_to === myId || e.created_by === myId);
  const todayEvents = myEvents.filter(e => e.event_date === todayStr);
  const upcomingEvents = myEvents.filter(e => e.event_date > todayStr).slice(0, 5);
  const myFollowUps = (followUps || []).filter(fu => fu.assigned_to === myId || fu.created_by === myId);
  const overdueFollowUps = myFollowUps.filter(fu => fu.due_date && fu.due_date < todayStr);
  const overdueTickets = [...myTickets, ...ticketsICreated].filter(t => t.due_date && t.due_date < todayStr);
  const overdueReminders = (reminders || []).filter(r => r.due_date && r.due_date < todayStr);

  const myCustomers = (customers || []).filter(c => c.assigned_rep === myId);
  const pipelineStats = {};
  PIPELINE_STAGES.forEach(s => { pipelineStats[s.v] = myCustomers.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });
  const notContacted30 = (customers || []).filter(c => { if (c.assigned_rep && c.assigned_rep !== myId && !isAdmin) return false; if (!c.last_contact_date) return c.assigned_rep === myId; return Math.floor((Date.now() - new Date(c.last_contact_date).getTime()) / 86400000) > 30; });

  const mySales = (invoices || []).filter(inv => inv.sales_rep === userProfile?.name || inv.created_by === myId);
  const thisMonth = todayStr.substring(0, 7);
  const monthlyTotal = mySales.filter(inv => (inv.invoice_date || '').startsWith(thisMonth)).reduce((a, i) => a + Number(i.total_amount || 0), 0);

  const allOverdue = [
    ...overdueTickets.map(t => ({ type: 'ticket', title: t.title, due: t.due_date, assignee: getUserName(t.assigned_to), status: t.status })),
    ...overdueFollowUps.map(f => ({ type: 'followup', title: f.task, due: f.due_date, customer: f.customers?.name })),
    ...overdueReminders.map(r => ({ type: 'reminder', title: r.text, due: r.due_date })),
  ].sort((a, b) => (a.due || '').localeCompare(b.due || ''));

  return (<div className="mb-4">
    {/* v55.70 — AssistantsBar: two big avatar tiles for Nadia (executive
        secretary) and Jenna (HR/relationship coach). Per Max May 7 2026:
        "There should be a big large person that's Nadia and a large
        person that is the HR rep [Jenna]... organized in a way that's
        clear in the dashboard."

        Behavior:
        - Both tiles ALWAYS render (no loaded gate, never disappear).
        - Click Nadia → smooth-scroll to her chat surface (AIGreeter
          mounts in page.jsx), highlighted briefly.
        - Click Jenna → smooth-scroll to her HR Desk + Performance
          Coach section, highlighted briefly.
        - Each tile shows a one-line summary (urgent items count for
          Nadia, pending HR items + new responses for Jenna). */}
    <AssistantsBar
      user={user} userProfile={userProfile} users={users}
      tickets={tickets} checks={[]}
      chatSurface={chatSurface}
      onTalkToNadia={function () {
        // v55.75 — chat is now INLINE under the avatars (chatSurface slot
        // above). This handler stays as a no-op safety net so any legacy
        // listener (e.g. a quick-action button) still works without crashing.
        try { window.dispatchEvent(new CustomEvent('ktc:open-nadia')); } catch (_) {}
      }}
    />

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

    {/* v55.71 — MyHRDesk and MyPerformance NO LONGER mount here directly.
        They mount INSIDE the AssistantsBar's expanded Jenna and Sara panels
        respectively (so they only render when the user explicitly expands
        the corresponding avatar). This avoids double-mounting and keeps
        the dashboard clean — three big avatars are the visual organization,
        the deeper experiences open on demand. */}

    {/* v55.68 — subtle inline loading hint while the rest of the dashboard
        data populates. Doesn't block or remount anything; the cards
        below just stay empty/skeleton until their data arrives. */}
    {!loaded && (
      <div className="text-center text-slate-600 py-2 text-xs">Loading the rest of your dashboard…</div>
    )}

    {/* v55.65 — Bugs you reported that Claude fixed in the latest build.
        Card pulses gently to draw attention. Click any item to jump to
        the system tickets tab where you can submit your retest result. */}
    {bugsToRetest && bugsToRetest.length > 0 && (
      <div className="mb-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border-2 border-amber-300 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔁</span>
            <div>
              <div className="text-sm font-extrabold text-amber-900">{bugsToRetest.length} bug{bugsToRetest.length === 1 ? '' : 's'} you filed {bugsToRetest.length === 1 ? 'is' : 'are'} ready to retest</div>
              <div className="text-[11px] text-amber-900">Claude shipped a fix. Verify it works and close the loop — it counts toward your reliability score.</div>
            </div>
          </div>
          <button
            onClick={() => navigate && navigate('admin')}
            className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700 whitespace-nowrap">
            Open System Tickets →
          </button>
        </div>
        <div className="space-y-1.5">
          {bugsToRetest.slice(0, 5).map(b => (
            <div key={b.id} className="bg-white rounded p-2 border border-amber-200">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">{b.title}</div>
                  <div className="text-xs text-slate-700">
                    {b.claude_fixed_in_build_version && <span className="font-mono bg-violet-100 text-violet-700 px-1 rounded mr-1">{b.claude_fixed_in_build_version}</span>}
                    Fixed {b.claude_last_fixed_at ? fmtET(b.claude_last_fixed_at, 'shortdate') : 'recently'}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {bugsToRetest.length > 5 && (
            <div className="text-[10px] text-amber-900 text-center pt-1">…and {bugsToRetest.length - 5} more — see System Tickets</div>
          )}
        </div>
      </div>
    )}

    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('tickets')} style={{borderLeftWidth:3,borderLeftColor:needsAck.length>0?'#ef4444':'#3b82f6'}}><div className="text-xs text-slate-700">My Tickets</div><div className="text-lg font-extrabold">{myTickets.length}</div>{needsAck.length>0&&<div className="text-[10px] text-red-600 font-bold">⚠️ {needsAck.length} new</div>}</div>
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('tickets')} style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-xs text-slate-700">Assigned by Me</div><div className="text-lg font-extrabold">{ticketsICreated.length}</div></div>
      {(isAdmin || teamTickets.length > 0) && <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('tickets')} style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-xs text-slate-700">Team Tickets</div><div className="text-lg font-extrabold">{teamTickets.length}</div></div>}
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('calendar')} style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-xs text-slate-700">Today's Events</div><div className="text-lg font-extrabold">{todayEvents.length}</div><div className="text-xs text-slate-600">{upcomingEvents.length} upcoming</div></div>
      <div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('crm')} style={{borderLeftWidth:3,borderLeftColor:overdueFollowUps.length>0?'#ef4444':'#f59e0b'}}><div className="text-xs text-slate-700">Follow-ups</div><div className="text-lg font-extrabold">{myFollowUps.length}</div>{overdueFollowUps.length>0&&<div className="text-[10px] text-red-600 font-bold">⚠️ {overdueFollowUps.length} overdue</div>}</div>
      {monthlyTotal>0&&<div className="bg-white rounded-lg p-3 cursor-pointer hover:shadow" onClick={()=>navigate('sales')} style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-xs text-slate-700">Sales ({thisMonth})</div><div className="text-lg font-extrabold text-emerald-600">{fE(monthlyTotal)}</div></div>}
    </div>

    {myTickets.length>0&&(<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">🎫 My Tickets ({myTickets.length})</h3><div className="space-y-1.5 max-h-[220px] overflow-auto">{myTickets.map(t=>{const ov=t.due_date&&t.due_date<todayStr; return (<div key={t.id} onClick={()=>navigate('tickets')} className={'flex justify-between items-center py-2 px-2 rounded cursor-pointer hover:bg-blue-50 border '+(t.status==='Closed'?'border-slate-200 bg-slate-50 opacity-70':ov?'border-red-200 bg-red-50':t.status==='New'?'border-purple-200 bg-purple-50':'border-slate-100')}><div className="flex-1"><div className="text-xs font-bold">{t.title}</div><div className="text-xs text-slate-700">{t.due_date&&<span className={ov?'text-red-600 font-bold':''}>Due: {t.due_date} </span>}{t.priority==='critical'&&<span className="text-red-900 font-bold">🚨 </span>}{t.priority==='high'&&<span className="text-red-500 font-bold">🔴 </span>}{getUserName(t.created_by)&&<span className="text-slate-600">From: {getUserName(t.created_by)}</span>}</div></div><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white ml-2" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></div>);})}</div></div>)}

    {ticketsICreated.length>0&&(<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📤 Tickets I Assigned ({ticketsICreated.length})</h3><div className="space-y-1.5 max-h-[200px] overflow-auto">{ticketsICreated.map(t=>{const ov=t.due_date&&t.due_date<todayStr; return (<div key={t.id} onClick={()=>navigate('tickets')} className={'flex justify-between items-center py-2 px-2 rounded cursor-pointer hover:bg-blue-50 border '+(ov?'border-red-200 bg-red-50':'border-slate-100')}><div className="flex-1"><div className="text-xs font-bold">{t.title}</div><div className="text-xs text-slate-700"><span className="text-purple-600 font-semibold">👤 {getUserName(t.assigned_to)||'Unassigned'}</span>{t.due_date&&<span className={ov?' text-red-600 font-bold':''}> • Due: {t.due_date}</span>}<span className="text-slate-600"> • {t.updated_at?fmtET(t.updated_at, 'shortdate'):'—'}</span></div></div><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white ml-2" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></div>);})}</div></div>)}

    <div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📅 Today ({(() => {
      // v55.82-J — Today widget now counts events + today-due tickets.
      // Max May 11 2026: "the today reminders. And calendar should include
      // also your the tickets that are due".
      var todayTktCount = [...(Array.isArray(myTickets)?myTickets:[]), ...(Array.isArray(ticketsICreated)?ticketsICreated:[])]
        .filter(function(t) { return t.due_date === todayStr && ['Closed','Resolved','Fixed'].indexOf(t.status) === -1; })
        .length;
      return todayEvents.length + todayTktCount;
    })()})</h3>
      {(() => {
        // v55.82-J — Build a unified "today" stream: real calendar events
        // PLUS tickets whose due_date === today (not closed). Same widget,
        // tickets get a 🎫 prefix and dashed-feel pseudo-event styling.
        var todayTickets = [...(Array.isArray(myTickets)?myTickets:[]), ...(Array.isArray(ticketsICreated)?ticketsICreated:[])]
          .filter(function(t) { return t.due_date === todayStr && ['Closed','Resolved','Fixed'].indexOf(t.status) === -1; })
          // Dedup: a ticket I both created AND am assigned to should appear once.
          .filter(function(t, idx, arr) { return arr.findIndex(function(x){ return x.id === t.id; }) === idx; })
          .map(function(t) { return { _ticket: true, id: 'tkt-' + t.id, _ticket_id: t.id, title: (t.ticket_number ? '[' + t.ticket_number + '] ' : '') + (t.title || 'Ticket'), event_type: 'Ticket due', priority: t.priority, status: t.status }; });
        var streamToday = [...todayEvents, ...todayTickets];
        if (streamToday.length === 0) return <div className="text-xs text-slate-600 py-2">No events or tickets today</div>;
        return streamToday.map(function(ev) {
          if (ev._ticket) {
            return (<div key={ev.id} onClick={function(){ navigate('tickets'); }} className="flex justify-between items-center py-2 border-b border-slate-50 cursor-pointer hover:bg-slate-50 rounded">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">🎫 {ev.title}</div>
                <div className="text-xs text-slate-600">
                  {ev.event_type}
                  {ev.priority === 'critical' && <span className="ml-1 text-red-900 font-bold">🚨 CRITICAL</span>}
                  {ev.priority === 'high' && <span className="ml-1 text-red-600 font-bold">🔴 HIGH</span>}
                  {ev.status && <span className="ml-1 text-slate-500">• {ev.status}</span>}
                </div>
              </div>
              <span className="text-[10px] font-bold text-blue-600">Open →</span>
            </div>);
          }
          return (<div key={ev.id} className="flex justify-between items-center py-2 border-b border-slate-50">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{ev.title}</div>
              <div className="text-xs text-slate-600">{ev.event_time?ev.event_time.substring(0,5):'All day'} • {ev.event_type||'Event'}</div>
            </div>
            <span className={'text-[10px] font-bold '+(ev.completed?'text-emerald-500':'text-amber-500')}>{ev.completed?'✅':'⏳'}</span>
          </div>);
        });
      })()}
      {upcomingEvents.length>0&&(<div className="mt-2 pt-2 border-t border-slate-100"><div className="text-xs font-bold text-slate-700 mb-1">Upcoming</div>{upcomingEvents.map(ev=>(<div key={ev.id} className="flex justify-between py-1 text-xs text-slate-700"><span>{ev.title}</span><span>{ev.event_date} {ev.event_time?ev.event_time.substring(0,5):''}</span></div>))}</div>)}</div>

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
          return <div className="text-xs text-slate-600">No reminders</div>;
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
                    <div className={'text-xs font-bold ' + (overdue ? 'text-red-700' : 'text-amber-900')}>
                      {item.kind === 'ticket' ? '🎫 ' : ''}{item.text}
                    </div>
                    <div className={'text-[10px] font-bold ' + (overdue ? 'text-red-600' : 'text-amber-900')}>
                      {overdue ? 'Overdue ' : 'Due today'}{item.due_date ? ' • ' + item.due_date : ''}
                      {item.priority === 'critical' && <span className="ml-1 text-red-900 font-bold">🚨 CRITICAL</span>}
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
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Normal ({normalReminders.length})</div>
              <div className="space-y-1 max-h-[150px] overflow-auto">{normalReminders.map(r => (
                <div key={r.id} className="flex justify-between items-center py-1.5 px-2 rounded border border-slate-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs">{r.text}</div>
                    {r.due_date && <div className="text-xs text-slate-600">Due: {r.due_date}</div>}
                  </div>
                  <button onClick={()=>completeReminder(r.id)} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold ml-2">Done ✓</button>
                </div>
              ))}</div>
            </div>
          )}
        </>);
      })()}
    </div>

    {/* v55.81 #5 (Max May 9 2026): Pipeline shown for admins even with 0
        customers — but instead of seven empty zero-pills, render a clear
        empty-state message that explains what this section IS. Without
        this, admins on a fresh deploy see a wall of "0" and don't know
        what they're looking at.
        v55.81 QA-7 (Max May 9 2026): also show the empty-state to a
        non-admin team member who has CRM access (i.e., they can see at
        least one customer in the system) but happens to have zero
        assigned to them yet. Without this fix, a brand-new sales rep
        sees no Pipeline card at all and may think the feature doesn't
        exist for them. */}
    {(myCustomers.length>0 || isAdmin || (Array.isArray(customers) && customers.length>0)) && (<div className="bg-white rounded-xl p-4 mb-3"><h3 className="text-sm font-bold mb-2">📊 My Pipeline ({myCustomers.length} clients)</h3>
      {myCustomers.length === 0 ? (
        <div className="text-center py-3">
          <div className="text-xs text-slate-500 mb-1.5">No clients assigned to you yet</div>
          <div className="text-[10px] text-slate-500">When customers are assigned to you in the CRM, you'll see them flow through Lead → Qualified → Proposal → Won here.</div>
        </div>
      ) : (
        <div className="flex gap-1.5 flex-wrap mb-2">{PIPELINE_STAGES.map(s=>{const c=pipelineStats[s.v]||0; return (<div key={s.v} className="rounded-lg px-3 py-2 text-center min-w-[70px]" style={{background:c>0?s.c+'15':'#f8fafc',borderLeft:'3px solid '+(c>0?s.c:'#e2e8f0')}}><div className="text-lg font-extrabold" style={{color:c>0?s.c:'#cbd5e1'}}>{c}</div><div className="text-[9px] font-semibold text-slate-600">{s.icon} {s.l}</div></div>);})}</div>
      )}
      {notContacted30.length>0&&<div className="bg-amber-50 rounded-lg p-2 mt-2 border border-amber-200"><div className="text-[10px] font-bold text-amber-900">⚠️ {notContacted30.length} clients not contacted in 30+ days</div></div>}
    </div>)}

    {overdueFollowUps.length>0&&(<div className="bg-red-50 rounded-xl p-4 mb-3 border border-red-200"><h3 className="text-sm font-bold text-red-700 mb-2">⚠️ Overdue Follow-ups ({overdueFollowUps.length})</h3>{overdueFollowUps.map(fu=>(<div key={fu.id} className="flex justify-between items-center py-1.5 border-b border-red-100"><div><div className="text-xs font-semibold">{fu.task}</div><div className="text-xs text-slate-700">{fu.customers?.name||''} • Due: {fu.due_date}</div></div><span className="text-[10px] font-bold text-red-600">{Math.floor((Date.now()-new Date(fu.due_date).getTime())/86400000)}d late</span></div>))}</div>)}

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
                  // v55.55 — Click a month → navigate to Sales tab pre-filtered
                  // to that exact month. month is "YYYY-MM" so we build first
                  // and last day. Last-day-of-month = day 0 of next month.
                  const [yr, mo] = month.split('-').map(Number);
                  const lastDay = new Date(yr, mo, 0).getDate();
                  const monthFrom = month + '-01';
                  const monthTo = month + '-' + String(lastDay).padStart(2, '0');
                  return (
                    <tr key={month}
                        onClick={() => navigate('sales', { from: monthFrom, to: monthTo })}
                        title={'Click to see all ' + data.count + ' orders from ' + month}
                        className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer">
                      <td className="px-3 py-2 font-semibold">{month} <span className="text-[9px] text-blue-500 ml-1">→ view orders</span></td>
                      <td className="px-3 py-2 text-right">{data.count}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-600">{fE(data.invoiced)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{fE(data.collected)} <span className="text-[9px] text-slate-500">({collPct}%)</span></td>
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
