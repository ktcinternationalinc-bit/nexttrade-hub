'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

const STATUSES = ['New','Acknowledged','In Progress','Waiting','Review','Testing','Ready','Closed','Reopened'];
const PRIORITIES = [{v:'high',l:'High / عالي',c:'#ef4444'},{v:'medium',l:'Medium / متوسط',c:'#f59e0b'},{v:'low',l:'Low / منخفض',c:'#10b981'}];
const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#f59e0b',Waiting:'#6b7280',Review:'#ec4899',Testing:'#14b8a6',Ready:'#10b981',Closed:'#374151',Reopened:'#ef4444'};

export default function TicketsTab({ customers, user, users, onReload }) {
  const [tickets, setTickets] = useState([]);
  const [comments, setComments] = useState([]);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('open');
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [listening, setListening] = useState(false);

  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice not supported / المتصفح لا يدعم الصوت'); return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setListening(false);
      let priority = 'medium';
      if (/urgent|high|asap/i.test(text)) priority = 'high';
      if (/\blow\b/i.test(text)) priority = 'low';
      let assignTo = '';
      (users || []).forEach(u => { if (text.toLowerCase().includes((u.name || '').toLowerCase())) assignTo = u.id; });
      let dueDate = '';
      if (/due today|today/i.test(text)) dueDate = new Date().toISOString().substring(0, 10);
      if (/due tomorrow|tomorrow/i.test(text)) { const d = new Date(); d.setDate(d.getDate() + 1); dueDate = d.toISOString().substring(0, 10); }
      let title = text;
      if (/rate|shipping/i.test(text)) title = 'Get rate quote: ' + text;
      setF({ title, priority, assignedTo: assignTo, dueDate });
      setShowAdd(true);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const loadTickets = async () => {
    const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false });
    setTickets(data || []); setLoaded(true);
  };
  const loadComments = async (ticketId) => {
    const { data } = await supabase.from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at');
    setComments(data || []);
  };
  if (!loaded) loadTickets();

  const todayStr = new Date().toISOString().substring(0, 10);
  const filtered = useMemo(() => {
    let arr = tickets;
    if (statusF === 'open') arr = arr.filter(t => t.status !== 'Closed');
    else if (statusF === 'mine') arr = arr.filter(t => t.assigned_to === user?.id && t.status !== 'Closed');
    else if (statusF === 'overdue') arr = arr.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'Closed');
    else if (statusF !== 'all') arr = arr.filter(t => t.status === statusF);
    if (q) arr = arr.filter(t => (t.title||'').toLowerCase().includes(q.toLowerCase()) || (t.description||'').includes(q) || (t.order_number||'').includes(q));
    return arr;
  }, [tickets, statusF, q, user]);

  const handleAddTicket = async () => {
    if (!f.title) return;
    try {
      await dbInsert('tickets', {
        title: f.title, description: f.description || '', priority: f.priority || 'medium',
        order_number: f.orderNumber || '', due_date: f.dueDate || null,
        customer_id: f.customerId || null, status: 'New',
        assigned_to: f.assignedTo || null, created_by: user?.id,
      }, user?.id);
      setShowAdd(false); setF({}); loadTickets();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const updateStatus = async (ticket, newStatus) => {
    try {
      const updates = { status: newStatus };
      if (newStatus === 'Closed') { updates.closed_at = new Date().toISOString(); updates.closed_by = user?.id; }
      await dbUpdate('tickets', ticket.id, updates, user?.id);
      await dbInsert('ticket_comments', { ticket_id: ticket.id, comment_text: `Status changed to ${newStatus}` }, user?.id);
      loadTickets();
      if (sel && sel.id === ticket.id) { setSel({...sel, ...updates}); loadComments(ticket.id); }
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const addComment = async () => {
    if (!f.comment || !sel) return;
    try {
      await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: f.comment }, user?.id);
      setF({...f, comment: ''}); loadComments(sel.id);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const getUserName = (id) => users?.find(u => u.id === id)?.name || '';

  // ===== DETAIL VIEW =====
  if (sel) {
    const priColor = PRIORITIES.find(p => p.v === sel.priority)?.c || '#f59e0b';
    const assignedName = getUserName(sel.assigned_to);
    const createdName = getUserName(sel.created_by);
    const isOverdue = sel.due_date && sel.due_date < todayStr && sel.status !== 'Closed';
    return (
      <div>
        <button onClick={() => { setSel(null); setComments([]); }} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back / رجوع</button>
        <div className="bg-white rounded-xl p-4 mb-3">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-extrabold flex-1">{sel.title}</h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{background:STATUS_COLORS[sel.status]}}>{sel.status}</span>
          </div>
          {sel.description && <p className="text-xs text-slate-600 mb-3">{sel.description}</p>}
          <div className="flex gap-2 flex-wrap mb-3">
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{background:priColor+'20',color:priColor}}>{sel.priority}</span>
            {assignedName && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px]">👤 {assignedName}</span>}
            {createdName && <span className="px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-[10px]">Created by: {createdName}</span>}
            {sel.order_number && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">Order #{sel.order_number}</span>}
            {sel.due_date && <span className={'px-2 py-0.5 rounded text-[10px] ' + (isOverdue ? 'bg-red-100 text-red-700 font-bold' : 'bg-slate-100 text-slate-600')}>Due: {sel.due_date}</span>}
          </div>
          {sel.status === 'New' && sel.assigned_to === user?.id && (
            <button onClick={() => updateStatus(sel, 'Acknowledged')}
              className="w-full mb-3 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-bold animate-pulse">
              ✓ Acknowledge / اعتراف
            </button>
          )}
          <div className="flex gap-1 flex-wrap">
            <span className="text-[10px] text-slate-500 mr-1">Change status:</span>
            {STATUSES.filter(s => s !== sel.status).map(s => (
              <button key={s} onClick={() => updateStatus(sel, s)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold border hover:shadow" style={{borderColor:STATUS_COLORS[s],color:STATUS_COLORS[s]}}>{s}</button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 mb-3">
          <h4 className="text-sm font-bold mb-2">Comments / تعليقات ({comments.length})</h4>
          {comments.map(c => (
            <div key={c.id} className="py-2 border-b border-slate-50">
              <div className="text-xs">{c.comment_text}</div>
              <div className="text-[10px] text-slate-400 mt-1">
                {getUserName(c.created_by) && <span className="font-semibold text-blue-500 mr-1">{getUserName(c.created_by)}</span>}
                {new Date(c.created_at).toLocaleString()}
              </div>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <input value={f.comment || ''} onChange={e => setF({...f, comment: e.target.value})}
              onKeyDown={e => e.key === 'Enter' && addComment()}
              placeholder="Add comment / أضف تعليق..." className="flex-1 px-3 py-2 border rounded text-sm" />
            <button onClick={addComment} className="px-3 py-2 bg-blue-500 text-white rounded text-xs font-semibold">Send</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== LIST VIEW =====
  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">Tickets / التذاكر</h2>
        <div className="flex gap-2 items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search / بحث"
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-28" />
          <button onClick={() => { setShowAdd(true); setF({}); }}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Ticket</button>
          <button onClick={startVoice}
            className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (listening ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-500 text-white')}>
            {listening ? '🎙 Listening...' : '🎤 Voice'}</button>
        </div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {[['open','Open / مفتوح'],['mine','Mine / لي'],['overdue','Overdue / متأخر'],['all','All / الكل'],...STATUSES.map(s=>[s,s])].map(([v,l]) => (
          <button key={v} onClick={() => setStatusF(v)}
            className={'px-3 py-1 rounded-md text-xs font-semibold transition ' + (statusF === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}>
          <div className="text-[10px] text-slate-500">Open</div>
          <div className="text-lg font-extrabold">{tickets.filter(t=>t.status!=='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}>
          <div className="text-[10px] text-slate-500">High Priority</div>
          <div className="text-lg font-extrabold text-red-500">{tickets.filter(t=>t.priority==='high'&&t.status!=='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
          <div className="text-[10px] text-slate-500">Closed</div>
          <div className="text-lg font-extrabold">{tickets.filter(t=>t.status==='Closed').length}</div></div>
      </div>
      {showAdd && (
        <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
          <h3 className="text-sm font-bold text-blue-800 mb-3">New Ticket / تذكرة جديدة</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="text-[10px] font-semibold">Title / العنوان</label>
              <input value={f.title||''} onChange={e=>setF({...f,title:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div className="col-span-2"><label className="text-[10px] font-semibold">Description / الوصف</label>
              <textarea value={f.description||''} onChange={e=>setF({...f,description:e.target.value})} rows={3} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Priority / الأولوية</label>
              <select value={f.priority||'medium'} onChange={e=>setF({...f,priority:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                {PRIORITIES.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Due Date / تاريخ</label>
              <input type="date" value={f.dueDate||''} onChange={e=>setF({...f,dueDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Assign To / تعيين إلى</label>
              <select value={f.assignedTo||''} onChange={e=>setF({...f,assignedTo:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">Unassigned / غير معين</option>
                {(users||[]).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
              </select></div>
            <div><label className="text-[10px] font-semibold">Order # / رقم الأمر</label>
              <input value={f.orderNumber||''} onChange={e=>setF({...f,orderNumber:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div className="col-span-2"><label className="text-[10px] font-semibold">Client / العميل</label>
              <select value={f.customerId||''} onChange={e=>setF({...f,customerId:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">None</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddTicket} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Create / إنشاء</button>
            <button onClick={()=>setShowAdd(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {filtered.map(t => {
          const priColor = PRIORITIES.find(p=>p.v===t.priority)?.c||'#f59e0b';
          const assignedName = getUserName(t.assigned_to);
          const isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'Closed';
          const needsAck = t.status === 'New' && t.assigned_to === user?.id;
          return (
            <div key={t.id} onClick={()=>{setSel(t);loadComments(t.id);}}
              className={'bg-white rounded-lg p-3 cursor-pointer border hover:shadow-md transition ' + (needsAck ? 'border-purple-400 border-2' : isOverdue ? 'border-red-300' : 'border-slate-200')}>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="text-sm font-bold">{t.title}</div>
                  {t.description && <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{t.description}</div>}
                </div>
                <div className="flex gap-1 items-center ml-2">
                  <span className="w-2 h-2 rounded-full" style={{background:priColor}}></span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{background:STATUS_COLORS[t.status]}}>{t.status}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-1 text-[10px] text-slate-400 flex-wrap">
                {assignedName && <span className="text-purple-600 font-semibold">👤 {assignedName}</span>}
                {t.order_number && <span>Order #{t.order_number}</span>}
                {t.due_date && <span className={isOverdue ? 'text-red-600 font-bold' : ''}>Due: {t.due_date}</span>}
                <span>{new Date(t.created_at).toLocaleDateString()}</span>
              </div>
              {needsAck && (
                <button onClick={(e) => { e.stopPropagation(); updateStatus(t, 'Acknowledged'); }}
                  className="mt-2 w-full px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold">
                  ✓ Acknowledge / اعتراف
                </button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="bg-white rounded-xl p-6 text-center text-slate-400 text-sm">No tickets / لا توجد تذاكر</div>}
      </div>
    </div>
  );
}
