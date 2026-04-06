'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { fE, fmt } from '../lib/utils';

const GROUPS = ['Textiles', 'Leather', 'Pool', 'Industrial', 'Retail', 'Export', 'Other'];
const TYPES = ['Trader', 'Manufacturer', 'Retailer', 'Wholesaler', 'Distributor', 'Agent'];

export default function CRMTab({ customers, invoices, user, onReload, isAdmin, onSelectInvoice }) {
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [groupF, setGroupF] = useState('all');
  const [typeF, setTypeF] = useState('all');
  const [sortBy, setSortBy] = useState('alpha');
  const [showAdd, setShowAdd] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [notes, setNotes] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [f, setF] = useState({});

  const loadClientData = async (client) => {
    setSel(client);
    if (!client) return;
    const [n, fu] = await Promise.all([
      supabase.from('client_notes').select('*').eq('customer_id', client.id).order('created_at', { ascending: false }),
      supabase.from('follow_ups').select('*').eq('customer_id', client.id).order('due_date', { ascending: true }),
    ]);
    setNotes(n.data || []);
    setFollowUps(fu.data || []);
  };

  const custInvoices = (c) => invoices.filter(i => i.customer_id === (c ? c.id : null) || (c && i.customer_name === c.name));

  const filtered = useMemo(() => {
    let arr = customers.filter(c => {
      if (!isAdmin && c.restricted) return false;
      if (q && !(c.name || '').includes(q) && !(c.name_en || '').toLowerCase().includes(q.toLowerCase())) return false;
      if (groupF !== 'all' && c.group_name !== groupF) return false;
      if (typeF !== 'all' && c.client_type !== typeF) return false;
      return true;
    });
    if (sortBy === 'alpha') arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sortBy === 'most_orders') arr.sort((a, b) => custInvoices(b).length - custInvoices(a).length);
    if (sortBy === 'top_sales') arr.sort((a, b) => {
      const aT = custInvoices(a).reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const bT = custInvoices(b).reduce((s, i) => s + Number(i.total_amount || 0), 0);
      return bT - aT;
    });
    return arr;
  }, [customers, q, groupF, typeF, sortBy, invoices]);

  const groups = [...new Set(customers.map(c => c.group_name).filter(Boolean))].sort();

  const handleAddClient = async () => {
    if (!f.name) return;
    try {
      await dbInsert('customers', {
        name: f.name, name_ar: f.nameAr || f.name, name_en: f.nameEn || '',
        phone: f.phone || '', email: f.email || '', address: f.address || '', city: f.city || '',
        group_name: f.group || '', client_type: f.clientType || '',
        industry: f.industry || '', lead_source: f.leadSource || '',
        credit_limit: f.creditLimit ? Number(f.creditLimit) : null, status: 'active',
      }, user?.id);
      setShowAdd(false); setF({}); onReload();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const handleEditClient = async () => {
    if (!sel) return;
    try {
      await dbUpdate('customers', sel.id, {
        name: f.name || sel.name, name_ar: f.nameAr || sel.name_ar, name_en: f.nameEn || sel.name_en,
        phone: f.phone || sel.phone, email: f.email || sel.email, address: f.address || sel.address,
        city: f.city || sel.city, group_name: f.group || sel.group_name, client_type: f.clientType || sel.client_type,
      }, user?.id);
      setEditingClient(false); setF({}); onReload();
      loadClientData({...sel, name: f.name || sel.name});
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const handleAddNote = async () => {
    if (!f.noteText || !sel) return;
    try {
      await dbInsert('client_notes', { customer_id: sel.id, note_text: f.noteText }, user?.id);
      setShowNote(false); setF({}); loadClientData(sel);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const handleAddFollowUp = async () => {
    if (!f.task || !f.dueDate || !sel) return;
    try {
      await dbInsert('follow_ups', {
        customer_id: sel.id, task: f.task, due_date: f.dueDate,
        due_time: f.dueTime || '09:00',
      }, user?.id);
      await dbInsert('calendar_events', {
        title: 'Follow-up: ' + f.task + ' (' + sel.name + ')',
        event_date: f.dueDate, event_time: f.dueTime || '09:00',
        event_type: 'call', customer_id: sel.id,
      }, user?.id);
      setShowFollowUp(false); setF({}); loadClientData(sel);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const completeFollowUp = async (id) => {
    try {
      await dbUpdate('follow_ups', id, { completed: true, completed_at: new Date().toISOString() }, user?.id);
      loadClientData(sel);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  if (!sel) return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">CRM / إدارة العملاء</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search / بحث"
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-28" />
          <button onClick={() => { setShowAdd(true); setF({}); }}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Client / عميل</button>
        </div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <select value={groupF} onChange={e => setGroupF(e.target.value)} className="px-2 py-1 rounded border border-slate-200 text-xs">
          <option value="all">All Groups / كل المجموعات</option>
          {[...new Set([...GROUPS, ...groups])].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={typeF} onChange={e => setTypeF(e.target.value)} className="px-2 py-1 rounded border border-slate-200 text-xs">
          <option value="all">All Types / كل الأنواع</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="px-2 py-1 rounded border border-slate-200 text-xs">
          <option value="alpha">A-Z</option>
          <option value="most_orders">Most Orders</option>
          <option value="top_sales">Top Sales</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}>
          <div className="text-[10px] text-slate-500">Clients / عملاء</div>
          <div className="text-lg font-extrabold">{filtered.length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
          <div className="text-[10px] text-slate-500">Active / نشط</div>
          <div className="text-lg font-extrabold">{filtered.filter(c => c.status !== 'inactive').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}>
          <div className="text-[10px] text-slate-500">Groups / مجموعات</div>
          <div className="text-lg font-extrabold">{groups.length || '—'}</div></div>
      </div>
      {showAdd && (
        <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
          <h3 className="text-sm font-bold text-blue-800 mb-3">New Client / عميل جديد</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] font-semibold">Name (Arabic)</label>
              <input value={f.name||''} onChange={e=>setF({...f,name:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" style={{direction:'rtl'}} /></div>
            <div><label className="text-[10px] font-semibold">Name (English)</label>
              <input value={f.nameEn||''} onChange={e=>setF({...f,nameEn:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Group</label>
              <select value={f.group||''} onChange={e=>setF({...f,group:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">Select...</option>{GROUPS.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Type</label>
              <select value={f.clientType||''} onChange={e=>setF({...f,clientType:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">Select...</option>{TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Phone</label>
              <input value={f.phone||''} onChange={e=>setF({...f,phone:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">City</label>
              <input value={f.city||''} onChange={e=>setF({...f,city:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Credit Limit</label>
              <input type="number" value={f.creditLimit||''} onChange={e=>setF({...f,creditLimit:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Industry</label>
              <input value={f.industry||''} onChange={e=>setF({...f,industry:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddClient} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Save / حفظ</button>
            <button onClick={()=>setShowAdd(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel / إلغاء</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map(c => {
          const invs = custInvoices(c);
          const total = invs.reduce((a,i) => a + Number(i.total_amount||0), 0);
          const owed = invs.reduce((a,i) => a + Number(i.outstanding||0), 0);
          return (
            <div key={c.id} onClick={()=>loadClientData(c)} className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
              <div className="text-sm font-bold" style={{direction:'rtl'}}>{c.name}</div>
              {c.name_en && <div className="text-[10px] text-blue-500">{c.name_en}</div>}
              <div className="flex gap-1 mt-1 flex-wrap">
                {c.group_name && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px]">{c.group_name}</span>}
                {c.client_type && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{c.client_type}</span>}
              </div>
              <div className="flex justify-between mt-2">
                <div><div className="text-[9px] text-slate-400">Sales</div>
                  <div className="text-xs font-bold text-blue-500">{total>0?fmt(total):'—'}</div></div>
                <div className="text-right"><div className="text-[9px] text-slate-400">{invs.length} orders</div>
                  <div className={'text-xs font-bold '+(owed>0?'text-red-500':'text-emerald-500')}>{owed>0?fmt(owed):'✓'}</div></div>
              </div>
            </div>);
        })}
      </div>
    </div>
  );

  const invs = custInvoices(sel);
  const totalSales = invs.reduce((a,i)=>a+Number(i.total_amount||0),0);
  const totalCollected = invs.reduce((a,i)=>a+Number(i.total_collected||0),0);
  const totalOwed = invs.reduce((a,i)=>a+Number(i.outstanding||0),0);
  const pendingFU = followUps.filter(fu=>!fu.completed);

  return (
    <div>
      <button onClick={()=>{setSel(null);setEditingClient(false);setF({});}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back / رجوع</button>
      <div className="bg-white rounded-xl p-4 mb-3">
        {editingClient ? (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] font-semibold">Name (Arabic)</label>
              <input value={f.name!==undefined?f.name:sel.name} onChange={e=>setF({...f,name:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm" style={{direction:'rtl'}} /></div>
            <div><label className="text-[10px] font-semibold">Name (English)</label>
              <input value={f.nameEn!==undefined?f.nameEn:(sel.name_en||'')} onChange={e=>setF({...f,nameEn:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Group</label>
              <select value={f.group!==undefined?f.group:(sel.group_name||'')} onChange={e=>setF({...f,group:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="">None</option>{GROUPS.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Type</label>
              <select value={f.clientType!==undefined?f.clientType:(sel.client_type||'')} onChange={e=>setF({...f,clientType:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="">None</option>{TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Phone</label>
              <input value={f.phone!==undefined?f.phone:(sel.phone||'')} onChange={e=>setF({...f,phone:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] font-semibold">City</label>
              <input value={f.city!==undefined?f.city:(sel.city||'')} onChange={e=>setF({...f,city:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div className="col-span-2 flex gap-2">
              <button onClick={handleEditClient} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-semibold">Save / حفظ</button>
              <button onClick={()=>{setEditingClient(false);setF({});}} className="px-3 py-1.5 border border-slate-200 rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-extrabold" style={{direction:'rtl'}}>{sel.name}</h3>
                {sel.name_en && <div className="text-sm text-blue-500">{sel.name_en}</div>}
                <div className="flex gap-1 mt-1 flex-wrap">
                  {sel.group_name && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">{sel.group_name}</span>}
                  {sel.client_type && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{sel.client_type}</span>}
                  {sel.city && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{sel.city}</span>}
                </div>
              </div>
              <button onClick={()=>{setEditingClient(true);setF({});}} className="px-3 py-1 border border-blue-300 text-blue-500 rounded text-xs">Edit / تعديل</button>
            </div>
            {sel.phone && <div className="text-xs text-slate-500 mt-2">Phone: {sel.phone}</div>}
            {sel.credit_limit && <div className="text-xs text-slate-500">Credit Limit: {fE(sel.credit_limit)}</div>}
            {isAdmin && (
              <div className="flex items-center gap-2 mt-2 p-2 bg-red-50 rounded border border-red-200">
                <input type="checkbox" checked={sel.restricted || false}
                  onChange={async (e) => {
                    try {
                      await dbUpdate('customers', sel.id, { restricted: e.target.checked }, user?.id);
                      setSel({...sel, restricted: e.target.checked});
                      onReload();
                    } catch (err) { alert('Error: ' + err.message); }
                  }} className="w-4 h-4" />
                <label className="text-xs font-semibold text-red-700">Restricted — Admin Only / مقيد — للمسؤول فقط</label>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-blue-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Sales</div><div className="text-sm font-bold text-blue-600">{fE(totalSales)}</div></div>
        <div className="bg-emerald-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Collected</div><div className="text-sm font-bold text-emerald-600">{fE(totalCollected)}</div></div>
        <div className="bg-red-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Owed</div><div className="text-sm font-bold text-red-500">{fE(totalOwed)}</div></div>
        <div className="bg-amber-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Orders</div><div className="text-sm font-bold">{invs.length}</div></div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={()=>{setShowNote(true);setF({});}} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Note / ملاحظة</button>
        <button onClick={()=>{setShowFollowUp(true);setF({});}} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold">+ Follow-up / متابعة</button>
      </div>
      {showNote && (
        <div className="bg-blue-50 rounded-lg p-3 mb-3 border border-blue-200">
          <textarea value={f.noteText||''} onChange={e=>setF({...f,noteText:e.target.value})} placeholder="Note / ملاحظة..." rows={3} className="w-full px-3 py-2 rounded border text-sm mb-2" />
          <div className="flex gap-2">
            <button onClick={handleAddNote} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-semibold">Save</button>
            <button onClick={()=>setShowNote(false)} className="px-3 py-1.5 border border-slate-200 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}
      {showFollowUp && (
        <div className="bg-amber-50 rounded-lg p-3 mb-3 border border-amber-200">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input value={f.task||''} onChange={e=>setF({...f,task:e.target.value})} placeholder="Task / المهمة" className="col-span-2 px-3 py-2 rounded border text-sm" />
            <input type="date" value={f.dueDate||''} onChange={e=>setF({...f,dueDate:e.target.value})} className="px-3 py-2 rounded border text-sm" />
            <input type="time" value={f.dueTime||'09:00'} onChange={e=>setF({...f,dueTime:e.target.value})} className="px-3 py-2 rounded border text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddFollowUp} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-semibold">Save</button>
            <button onClick={()=>setShowFollowUp(false)} className="px-3 py-1.5 border border-slate-200 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}
      {pendingFU.length > 0 && (
        <div className="bg-amber-50 rounded-xl p-4 mb-3 border border-amber-200">
          <h4 className="text-sm font-bold text-amber-800 mb-2">Follow-ups ({pendingFU.length})</h4>
          {pendingFU.map(fu => (
            <div key={fu.id} className="flex justify-between items-center py-2 border-b border-amber-100">
              <div><div className="text-xs font-semibold">{fu.task}</div><div className="text-[10px] text-slate-500">{fu.due_date}</div></div>
              <button onClick={()=>completeFollowUp(fu.id)} className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px]">Done / تم</button>
            </div>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
          <h4 className="text-sm font-bold mb-2">Notes / ملاحظات ({notes.length})</h4>
          {notes.map(n => (
            <div key={n.id} className="py-2 border-b border-slate-50">
              <div className="text-xs">{n.note_text}</div>
              <div className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      {invs.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-slate-200">
          <h4 className="text-sm font-bold mb-2">Invoices / الفواتير ({invs.length})</h4>
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full border-collapse"><thead><tr className="bg-slate-50">
              <th className="px-2 py-1.5 text-[10px] text-left">Order</th>
              <th className="px-2 py-1.5 text-[10px] text-left">Date</th>
              <th className="px-2 py-1.5 text-[10px] text-right">Amount</th>
              <th className="px-2 py-1.5 text-[10px] text-right">Owed</th>
            </tr></thead><tbody>
              {invs.sort((a,b)=>(b.invoice_date||'').localeCompare(a.invoice_date||'')).map(inv=>(
                <tr key={inv.id} onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                  className="border-b border-slate-50 cursor-pointer hover:bg-blue-50">
                  <td className="px-2 py-1 text-xs font-bold text-blue-600">{inv.order_number}</td>
                  <td className="px-2 py-1 text-xs">{inv.invoice_date}</td>
                  <td className="px-2 py-1 text-xs text-right">{fE(inv.total_amount)}</td>
                  <td className="px-2 py-1 text-xs text-right text-red-500">{inv.outstanding>0?fE(inv.outstanding):'✓'}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}
