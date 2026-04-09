'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { notifyTicketAssigned, notifyTicketStatus, notifyTicketComment, notifyTicketReassigned } from '../lib/notify';

const STATUSES = ['New','Acknowledged','In Progress','Blocked','On Hold','Review','Closed','Reopened'];
const PRIORITIES = [{v:'high',l:'High / عالي',c:'#ef4444'},{v:'medium',l:'Medium / متوسط',c:'#f59e0b'},{v:'low',l:'Low / منخفض',c:'#10b981'}];
const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#eab308',Blocked:'#ef4444','On Hold':'#f97316',Review:'#06b6d4',Closed:'#10b981',Reopened:'#eab308'};
const STATUS_DESC = {New:'Just created — nobody has looked at it yet',Acknowledged:'Assigned person has seen and accepted it','In Progress':'Actively being worked on',Blocked:'Cannot proceed — waiting on something external',
  'On Hold':'Paused intentionally — not urgent right now',Review:'Work done — needs someone to check/approve',Closed:'Complete — no more action needed',Reopened:'Was closed but needs more work'};
const USER_COLORS = ['#8b5cf6','#0ea5e9','#f59e0b','#10b981','#ec4899','#ef4444','#6366f1','#14b8a6','#f97316','#06b6d4','#a855f7','#84cc16'];

export default function TicketsTab({ customers, user, userProfile, users, onReload, lang, isAdmin, modulePerms }) {
  const myId = userProfile?.id;
  const canManage = isAdmin || userProfile?.role === 'super_admin' || userProfile?.role === 'admin';
  const canDelete = userProfile?.role === 'super_admin' || modulePerms?.['Delete Tickets'] === true;
  // Stable color per user
  const userColorMap = useMemo(() => {
    const map = {};
    (users || []).forEach((u, i) => { map[u.id] = USER_COLORS[i % USER_COLORS.length]; });
    return map;
  }, [users]);
  const [tickets, setTickets] = useState([]);
  const [comments, setComments] = useState([]);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('open');
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({});
  const [sortBy, setSortBy] = useState('date');
  const [loaded, setLoaded] = useState(false);
  const [listening, setListening] = useState(false);

  const todayStr = new Date().toISOString().substring(0, 10);
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '';

  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { alert('Voice not supported'); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (event) => { const text = event.results[0][0].transcript; setListening(false); let priority = 'medium'; if (/urgent|high|asap/i.test(text)) priority = 'high'; if (/\blow\b/i.test(text)) priority = 'low'; let assignTo = ''; (users || []).forEach(u => { if (text.toLowerCase().includes((u.name || '').toLowerCase())) assignTo = u.id; }); let dueDate = ''; if (/today/i.test(text)) dueDate = todayStr; if (/tomorrow/i.test(text)) { const d = new Date(); d.setDate(d.getDate() + 1); dueDate = d.toISOString().substring(0, 10); } setF({ title: text, priority, assignedTo: assignTo, dueDate }); setShowAdd(true); };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const loadTickets = async () => { const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false }); setTickets(data || []); setLoaded(true); };
  const loadComments = async (ticketId) => { const { data } = await supabase.from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at'); setComments(data || []); };
  if (!loaded) loadTickets();

  const filtered = useMemo(() => {
    let arr = tickets;
    if (statusF === 'open') arr = arr.filter(t => t.status !== 'Closed');
    else if (statusF === 'mine') arr = arr.filter(t => t.assigned_to === myId && t.status !== 'Closed');
    else if (statusF === 'team') arr = arr.filter(t => t.status !== 'Closed' && t.assigned_to && t.assigned_to !== myId);
    else if (statusF === 'created') arr = arr.filter(t => t.created_by === myId && t.status !== 'Closed');
    else if (statusF === 'overdue') arr = arr.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'Closed');
    else if (statusF !== 'all') arr = arr.filter(t => t.status === statusF);
    if (q) arr = arr.filter(t => (t.title||'').toLowerCase().includes(q.toLowerCase()) || (t.description||'').includes(q) || (t.order_number||'').includes(q) || (t.ticket_number||'').toLowerCase().includes(q.toLowerCase()));
    // Sort
    const priOrder = { high: 0, medium: 1, low: 2 };
    if (sortBy === 'priority') arr = [...arr].sort((a, b) => (priOrder[a.priority] ?? 1) - (priOrder[b.priority] ?? 1));
    else if (sortBy === 'owner') arr = [...arr].sort((a, b) => (getUserName(a.assigned_to) || 'zzz').localeCompare(getUserName(b.assigned_to) || 'zzz'));
    else if (sortBy === 'due') arr = [...arr].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    else arr = [...arr].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }, [tickets, statusF, q, user, sortBy]);

  const handleAddTicket = async () => {
    if (!f.title) return;
    try {
      // Auto-generate ticket number
      const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true });
      const ticketNum = 'TKT-' + String((count || 0) + 1).padStart(4, '0');
      const assignedName = getUserName(f.assignedTo);
      const creatorName = getUserName(myId);
      await dbInsert('tickets', { ticket_number: ticketNum, title: f.title, description: f.description || '', priority: f.priority || 'medium', order_number: f.orderNumber || '', due_date: f.dueDate || null, customer_id: f.customerId || null, client_name: f.clientName || '', status: 'New', assigned_to: f.assignedTo || null, created_by: myId || null }, myId || null);
      await logActivity(myId, 'Created ' + ticketNum + ': ' + f.title + (assignedName ? ' → ' + assignedName : ''), 'ticket');
      if (f.assignedTo) notifyTicketAssigned([f.assignedTo], ticketNum + ' ' + f.title, myId);
      setShowAdd(false); setF({}); loadTickets();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const updateStatus = async (ticket, newStatus) => {
    try {
      const updates = { status: newStatus, updated_by: myId };
      if (newStatus === 'Closed') { updates.closed_at = new Date().toISOString(); updates.closed_by = myId; }
      await dbUpdate('tickets', ticket.id, updates, myId);
      const myName = getUserName(myId) || 'Unknown';
      await dbInsert('ticket_comments', { ticket_id: ticket.id, comment_text: '📋 Status changed to ' + newStatus + ' by ' + myName, is_system: true, created_by: myId }, myId);
      await logActivity(myId, 'Ticket status → ' + newStatus + ': ' + ticket.title, 'ticket');
      if (ticket.assigned_to && ticket.assigned_to !== myId) notifyTicketStatus([ticket.assigned_to], ticket.title, newStatus, myId);
      loadTickets();
      if (sel && sel.id === ticket.id) { setSel({...sel, ...updates}); loadComments(ticket.id); }
    } catch (err) { alert('Error: ' + err.message); }
  };

  const reassignTicket = async (ticket, newUserId) => {
    try {
      await dbUpdate('tickets', ticket.id, { assigned_to: newUserId, updated_by: myId }, myId);
      const newName = getUserName(newUserId);
      const myName = getUserName(myId);
      await dbInsert('ticket_comments', { ticket_id: ticket.id, comment_text: '👤 Reassigned to ' + newName + ' by ' + myName, is_system: true, created_by: myId }, myId);
      await logActivity(myId, 'Reassigned ticket to ' + newName + ': ' + ticket.title, 'ticket');
      if (newUserId) notifyTicketReassigned([newUserId], ticket.title, myId);
      loadTickets();
      if (sel && sel.id === ticket.id) { setSel({...sel, assigned_to: newUserId}); loadComments(ticket.id); }
    } catch (err) { alert('Error: ' + err.message); }
  };

  const addComment = async () => {
    if (!f.comment || !sel) return;
    try {
      await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: f.comment, is_system: false, created_by: myId }, myId);
      await dbUpdate('tickets', sel.id, { updated_by: myId }, myId);
      await logActivity(myId, 'Comment on ticket: ' + sel.title, 'ticket');
      if (sel.assigned_to && sel.assigned_to !== myId) notifyTicketComment([sel.assigned_to], sel.title, f.comment, myId);
      setF({...f, comment: ''}); loadComments(sel.id);
    } catch (err) { alert('Error: ' + err.message); }
  };

  const deleteTicket = async (ticket) => {
    if (!confirm('Permanently delete ' + (ticket.ticket_number || '') + ' "' + ticket.title + '"?\n\nThis cannot be undone.')) return;
    try {
      // Delete comments first (foreign key)
      await supabase.from('ticket_comments').delete().eq('ticket_id', ticket.id);
      await dbDelete('tickets', ticket.id, myId);
      await logActivity(myId, 'Deleted ticket: ' + (ticket.ticket_number || '') + ' ' + ticket.title, 'ticket');
      setSel(null); setComments([]); loadTickets();
    } catch (err) { alert('Error: ' + err.message); }
  };

  // ===== TICKET DETAIL VIEW =====
  if (sel) {
    const priInfo = PRIORITIES.find(p => p.v === sel.priority) || PRIORITIES[1];
    const isOverdue = sel.due_date && sel.due_date < todayStr && sel.status !== 'Closed';
    const createdByName = getUserName(sel.created_by) || 'Unknown';
    const assignedName = getUserName(sel.assigned_to) || 'UNASSIGNED';
    const systemComments = comments.filter(c => c.is_system);
    const userComments = comments.filter(c => !c.is_system);

    return (<div>
      <div className="flex justify-between items-center mb-3">
        <button onClick={() => { setSel(null); setComments([]); }} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold">← Back</button>
        {canDelete && (
          <button onClick={() => deleteTicket(sel)}
            className="px-3 py-1 rounded border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-50 transition">
            🗑 Delete Ticket
          </button>
        )}
      </div>

      {/* TICKET HEADER */}
      <div className={'bg-white rounded-xl p-5 mb-3 border-l-4'} style={{ borderLeftColor: STATUS_COLORS[sel.status] || '#6b7280' }}>
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-lg font-extrabold flex-1">{sel.ticket_number && <span className="text-blue-400 mr-2">{sel.ticket_number}</span>}{sel.title}</h3>
          <span className="px-3 py-1 rounded-full text-xs font-bold text-white ml-2" style={{ background: STATUS_COLORS[sel.status] }}>{sel.status}</span>
        </div>

        {sel.description && <p className="text-sm text-slate-600 mb-4 bg-slate-50 rounded-lg p-3">{sel.description}</p>}

        {/* KEY DETAILS GRID */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 font-semibold">Opened By / أنشأها</div>
            <div className="text-sm font-bold text-blue-600">{createdByName}</div>
            <div className="text-[10px] text-slate-400">{fmtDate(sel.created_at)}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 font-semibold">Assigned To / معيّن إلى</div>
            <div className={'text-sm font-bold ' + (sel.assigned_to ? 'text-purple-600' : 'text-red-500')}>{assignedName}</div>
            {canManage ? (
              <select value={sel.assigned_to || ''} onChange={e => reassignTicket(sel, e.target.value)}
                className="mt-1 w-full px-2 py-1 rounded border border-purple-200 text-[10px] bg-white">
                <option value="">Unassigned</option>
                {(users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            ) : (
              <div className="text-[9px] text-slate-400 mt-1">Only managers can reassign</div>
            )}
          </div>
          <div className={'rounded-lg p-3 ' + (isOverdue ? 'bg-red-50 border border-red-200' : 'bg-slate-50')}>
            <div className="text-[10px] text-slate-500 font-semibold">Due Date / تاريخ الاستحقاق</div>
            <div className={'text-sm font-bold ' + (isOverdue ? 'text-red-600' : sel.due_date ? '' : 'text-slate-400')}>
              {sel.due_date || 'No due date'}
            </div>
            {isOverdue && <div className="text-[10px] font-bold text-red-600">🚨 {Math.floor((Date.now() - new Date(sel.due_date).getTime()) / 86400000)} days OVERDUE</div>}
            {(() => {
              const isSuperAdmin = userProfile?.role === 'super_admin';
              const isManager = userProfile?.role === 'admin';
              const canEditDue = isSuperAdmin || (isManager && sel.assigned_to !== myId);
              return canEditDue ? (
                <div className="flex gap-1 mt-1">
                  <input type="date" id="ticket-due-date" defaultValue={sel.due_date || ''} key={sel.id + '-due-' + (sel.due_date || '')}
                    className="flex-1 px-2 py-1 rounded border text-[10px] bg-white" />
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    const val = document.getElementById('ticket-due-date')?.value || null;
                    try {
                      await dbUpdate('tickets', sel.id, { due_date: val, updated_by: myId }, myId);
                      await logActivity(myId, 'Changed due date on ' + (sel.ticket_number || sel.title) + ' to ' + (val || 'none'), 'ticket');
                      loadTickets(); setSel({...sel, due_date: val});
                    } catch(err) { alert('Error: ' + err.message); }
                  }} className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">Set</button>
                </div>
              ) : (
                <div className="text-[9px] text-slate-400 mt-1">Only super admins and managers can change due dates</div>
              );
            })()}
          </div>
          <div className="rounded-lg p-3" style={{ background: priInfo.c + '15' }}>
            <div className="text-[10px] text-slate-500 font-semibold">Priority / الأولوية</div>
            <div className="text-sm font-bold" style={{ color: priInfo.c }}>{sel.priority?.toUpperCase()}</div>
            {sel.order_number && <div className="text-[10px] text-slate-500 mt-1">Order #{sel.order_number}</div>}
            {sel.client_name && <div className="text-[10px] text-slate-500">Client: {sel.client_name}</div>}
          </div>
        </div>

        {/* LAST UPDATED INFO */}
        {sel.updated_at && (
          <div className="flex items-center gap-2 mb-3 text-[10px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
            <span>🕐 Last updated: {fmtDate(sel.updated_at)}</span>
            {sel.updated_by && <span>by <span className="font-semibold text-purple-500">{getUserName(sel.updated_by) || 'Unknown'}</span></span>}
            {sel.closed_by && sel.status === 'Closed' && <span>• Closed by: <span className="font-semibold text-purple-500">{getUserName(sel.closed_by) || 'Unknown'}</span></span>}
          </div>
        )}

        {/* ACKNOWLEDGE BUTTON */}
        {sel.status === 'New' && sel.assigned_to === myId && (
          <button onClick={() => updateStatus(sel, 'Acknowledged')}
            className="w-full mb-3 px-4 py-3 bg-purple-600 text-white rounded-lg text-sm font-bold animate-pulse">
            ✓ Acknowledge Ticket</button>
        )}

        {/* STATUS CHANGE BUTTONS */}
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500 mr-1 self-center">Change status:</span>
          {STATUSES.filter(s => s !== sel.status).map(s => (
            <button key={s} onClick={() => updateStatus(sel, s)}
              className="px-3 py-1 rounded-lg text-[10px] font-bold border-2 hover:shadow transition"
              style={{ borderColor: STATUS_COLORS[s], color: STATUS_COLORS[s] }}>{s}</button>
          ))}
        </div>
      </div>

      {/* ACTIVITY LOG (system events) */}
      <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
        <h4 className="text-sm font-bold mb-2">📋 Activity Log ({systemComments.length})</h4>
        {systemComments.length > 0 ? (
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {systemComments.map(c => {
              const updaterName = getUserName(c.created_by) || 'System';
              return (
                <div key={c.id} className="flex items-start gap-2 py-1.5 border-b border-slate-50">
                  <span className="text-xs mt-0.5">📋</span>
                  <div className="flex-1">
                    <div className="text-xs">{c.comment_text}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      <span className="font-semibold text-purple-500">{updaterName}</span>
                      <span className="ml-2">{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-slate-400">No status changes yet</div>
        )}
      </div>

      {/* COMMENTS / NOTES */}
      <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
        <h4 className="text-sm font-bold mb-2">💬 Comments ({userComments.length})</h4>
        {userComments.length > 0 && (
          <div className="space-y-2 max-h-[300px] overflow-auto mb-3">
            {userComments.map(c => {
              const authorName = getUserName(c.created_by) || 'Unknown';
              const isMe = c.created_by === myId;
              return (
                <div key={c.id} className={'rounded-lg p-3 ' + (isMe ? 'bg-blue-50 ml-8' : 'bg-slate-50 mr-8')}>
                  <div className="text-xs">{c.comment_text}</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    <span className={'font-semibold ' + (isMe ? 'text-blue-500' : 'text-purple-500')}>{authorName}</span>
                    <span className="ml-2">{fmtDate(c.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <input value={f.comment || ''} onChange={e => setF({...f, comment: e.target.value})}
            onKeyDown={e => e.key === 'Enter' && addComment()}
            placeholder="Add comment..." className="flex-1 px-3 py-2 border rounded-lg text-sm" />
          <button onClick={addComment} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">Send</button>
        </div>
      </div>
    </div>);
  }

  // ===== TICKET LIST VIEW =====
  return (<div>
    <div className="flex justify-between flex-wrap gap-2 mb-3">
      <h2 className="text-xl font-extrabold">Tickets / التذاكر</h2>
      <div className="flex gap-2 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search..." className="px-3 py-1.5 rounded-lg border text-xs w-28" />
        <button onClick={() => { setShowAdd(true); setF({}); }} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Ticket</button>
        <button onClick={startVoice} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (listening ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-500 text-white')}>
          {listening ? '🎙 Listening...' : '🎤 Voice'}</button>
      </div>
    </div>

    {/* Filters */}
    <div className="flex gap-2 mb-3 flex-wrap">
      {[['open','Open'],['mine','Assigned to Me'],['team','Assigned to Team'],['created','Created by Me'],['overdue','Overdue'],['all','All'],...STATUSES.map(s=>[s,s])].map(([v,l]) => (
        <button key={v} onClick={() => setStatusF(v)}
          className={'px-3 py-1 rounded-md text-xs font-semibold transition ' + (statusF === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
      ))}
    </div>

    {/* Sort */}
    <div className="flex gap-2 mb-3 items-center">
      <span className="text-[10px] text-slate-500 font-semibold">Sort:</span>
      {[['date','Newest'],['priority','Priority ↑'],['owner','Owner'],['due','Due Date']].map(([v,l]) => (
        <button key={v} onClick={() => setSortBy(v)}
          className={'px-2.5 py-1 rounded-md text-[10px] font-semibold transition ' + (sortBy === v ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-600')}>{l}</button>
      ))}
    </div>

    {/* Stats */}
    <div className="grid grid-cols-4 gap-3 mb-3">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Open</div><div className="text-lg font-extrabold">{tickets.filter(t=>t.status!=='Closed').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Overdue</div><div className="text-lg font-extrabold text-red-500">{tickets.filter(t=>t.due_date&&t.due_date<todayStr&&t.status!=='Closed').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">High Priority</div><div className="text-lg font-extrabold text-amber-500">{tickets.filter(t=>t.priority==='high'&&t.status!=='Closed').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Closed</div><div className="text-lg font-extrabold">{tickets.filter(t=>t.status==='Closed').length}</div></div>
    </div>

    {/* Status Legend — collapsible */}
    <details className="mb-3">
      <summary className="text-[10px] text-blue-500 font-bold cursor-pointer hover:underline">ℹ️ Status Guide — what each status means</summary>
      <div className="bg-white rounded-xl p-3 mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
        {STATUSES.map(s => (
          <div key={s} className="rounded-lg p-2 border border-slate-100">
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{background: STATUS_COLORS[s]}} />
              <span className="text-xs font-bold">{s}</span>
            </div>
            <div className="text-[9px] text-slate-500 leading-tight">{STATUS_DESC[s]}</div>
          </div>
        ))}
      </div>
    </details>

    {/* Add Ticket Form */}
    {showAdd && (<div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
      <h3 className="text-sm font-bold text-blue-800 mb-3">New Ticket</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="text-[10px] font-semibold">Title *</label>
          <input value={f.title||''} onChange={e=>setF({...f,title:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div className="col-span-2"><label className="text-[10px] font-semibold">Description</label>
          <textarea value={f.description||''} onChange={e=>setF({...f,description:e.target.value})} rows={3} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Priority</label>
          <select value={f.priority||'medium'} onChange={e=>setF({...f,priority:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
            {PRIORITIES.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Due Date</label>
          <input type="date" value={f.dueDate||''} onChange={e=>setF({...f,dueDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Assign To</label>
          <select value={f.assignedTo||''} onChange={e=>setF({...f,assignedTo:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
            <option value="">Unassigned</option>{(users||[]).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Order #</label>
          <input value={f.orderNumber||''} onChange={e=>setF({...f,orderNumber:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div className="col-span-2"><label className="text-[10px] font-semibold">Client</label>
          <input list="tkt-cl" value={f.clientName||''} onChange={e=>{ const m=customers.find(c=>c.name===e.target.value); setF({...f,clientName:e.target.value,customerId:m?m.id:''}); }} className="w-full px-3 py-2 rounded border text-sm" />
          <datalist id="tkt-cl">{customers.map(c=><option key={c.id} value={c.name}/>)}</datalist></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={handleAddTicket} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Create</button>
        <button onClick={()=>setShowAdd(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
      </div>
    </div>)}

    {/* Ticket Cards */}
    <div className="space-y-2">
      {filtered.map(t => {
        const priColor = PRIORITIES.find(p=>p.v===t.priority)?.c||'#f59e0b';
        const assignedName = getUserName(t.assigned_to);
        const createdName = getUserName(t.created_by);
        const isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'Closed';
        const needsAck = t.status === 'New' && t.assigned_to === myId;
        return (
          <div key={t.id} onClick={()=>{setSel(t);loadComments(t.id);}}
            className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition cursor-pointer overflow-hidden">
            <div className="h-1" style={{ background: STATUS_COLORS[t.status] || '#6b7280' }} />
            <div className="px-4 py-3">
              <div className="flex justify-between items-center gap-2 mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {t.ticket_number && <span className="text-[10px] font-mono text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded flex-shrink-0">{t.ticket_number}</span>}
                  <span className="text-sm font-bold truncate">{t.title}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="w-2 h-2 rounded-full" style={{background:priColor}} title={t.priority} />
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold text-white" style={{background:STATUS_COLORS[t.status]}}>{t.status}</span>
                </div>
              </div>
              {t.description && <div className="text-[11px] text-slate-500 mb-2 line-clamp-1">{t.description}</div>}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] bg-slate-50 text-slate-600 px-2 py-0.5 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{createdName || '?'}</span>
                <span className={'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold ' + (assignedName ? '' : 'bg-red-50 text-red-600')}
                  style={assignedName ? { background: (userColorMap[t.assigned_to] || '#8b5cf6') + '18', color: userColorMap[t.assigned_to] || '#8b5cf6' } : {}}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: assignedName ? (userColorMap[t.assigned_to] || '#8b5cf6') : '#ef4444' }} />{assignedName || 'Unassigned'}</span>
                {t.due_date && <span className={'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded ' + (isOverdue ? 'bg-red-100 text-red-700 font-bold' : 'bg-slate-50 text-slate-600')}>📅 {t.due_date}{isOverdue ? ' OVERDUE' : ''}</span>}
                {t.order_number && <span className="text-[10px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded">#{t.order_number}</span>}
                <span className="text-[10px] text-slate-400 ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
              </div>
            </div>
            {needsAck && (
              <button onClick={(e) => { e.stopPropagation(); updateStatus(t, 'Acknowledged'); }}
                className="w-full px-4 py-2.5 bg-purple-600 text-white text-xs font-bold border-t border-purple-500">✓ Acknowledge</button>
            )}
          </div>
        );
      })}
      {filtered.length === 0 && <div className="bg-white rounded-xl p-6 text-center text-slate-400 text-sm">No tickets</div>}
    </div>
  </div>);
}
