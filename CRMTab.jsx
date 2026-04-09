'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { notifyClientAssigned, notifyFollowUp } from '../lib/notify';
import EmailComposer from './EmailComposer';
import { fE, fmt } from '../lib/utils';

const DEFAULT_CATEGORIES = ['Pool', 'Leather'];
const DEFAULT_GROUPS = ['Retail', 'Manufacturer', 'Export', 'Distributor'];
const LEAD_SOURCES = ['Referral', 'Facebook', 'WhatsApp', 'Exhibition', 'Walk-in', 'Website', 'Cold Call', 'Existing'];
const PIPELINE_STAGES = [
  { v: 'lead', l: 'Lead', c: '#94a3b8', icon: '🔘' },
  { v: 'contacted', l: 'Contacted', c: '#3b82f6', icon: '📞' },
  { v: 'qualified', l: 'Qualified', c: '#8b5cf6', icon: '✅' },
  { v: 'proposal', l: 'Proposal', c: '#f59e0b', icon: '📋' },
  { v: 'negotiation', l: 'Negotiation', c: '#ec4899', icon: '🤝' },
  { v: 'won', l: 'Won / Deal', c: '#10b981', icon: '🏆' },
  { v: 'lost', l: 'Lost', c: '#ef4444', icon: '❌' },
];

export default function CRMTab({ customers, invoices, user, userProfile, users, onReload, isAdmin, onSelectInvoice, lang, modulePerms }) {
  const myId = userProfile?.id;
  const canViewAll = isAdmin || modulePerms?.['CRM View All'] === true;
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [groupF, setGroupF] = useState('all');
  const [catF, setCatF] = useState('all');
  const [sortBy, setSortBy] = useState('alpha');
  const [repF, setRepF] = useState('all');
  const [stageF, setStageF] = useState('all');
  const [customCategories, setCustomCategories] = useState([]);
  const [customGroups, setCustomGroups] = useState([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [notes, setNotes] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [contactLog, setContactLog] = useState([]);
  const [allNotes, setAllNotes] = useState([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [f, setF] = useState({});

  // Load all notes once for card display
  const loadAllNotes = async () => {
    const { data } = await supabase.from('client_notes').select('customer_id, created_at, created_by').order('created_at', { ascending: false });
    setAllNotes(data || []);
    setNotesLoaded(true);
  };
  if (!notesLoaded) loadAllNotes();

  // Load custom categories & groups from app_settings
  const loadCustomLists = async () => {
    try {
      const { data } = await supabase.from('app_settings').select('setting_key, setting_value').in('setting_key', ['custom_categories', 'custom_groups']);
      (data || []).forEach(row => {
        try {
          if (row.setting_key === 'custom_categories') setCustomCategories(JSON.parse(row.setting_value));
          if (row.setting_key === 'custom_groups') setCustomGroups(JSON.parse(row.setting_value));
        } catch(e) {}
      });
    } catch(e) { console.log('Custom lists not loaded:', e); }
    setListsLoaded(true);
  };
  if (!listsLoaded) loadCustomLists();

  // Merged lists: defaults + custom
  const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...customCategories])].sort();
  const allGroups = [...new Set([...DEFAULT_GROUPS, ...customGroups])].sort();

  const saveCustomList = async (key, list) => {
    try {
      const { data: existing } = await supabase.from('app_settings').select('id').eq('setting_key', key).single();
      if (existing) {
        await supabase.from('app_settings').update({ setting_value: JSON.stringify(list) }).eq('id', existing.id);
      } else {
        await supabase.from('app_settings').insert({ setting_key: key, setting_value: JSON.stringify(list) });
      }
    } catch(e) { console.log('Save list error:', e); }
  };

  const addCategory = async (name) => {
    if (!name || allCategories.includes(name)) return;
    const updated = [...customCategories, name];
    setCustomCategories(updated);
    await saveCustomList('custom_categories', updated);
  };

  const addGroup = async (name) => {
    if (!name || allGroups.includes(name)) return;
    const updated = [...customGroups, name];
    setCustomGroups(updated);
    await saveCustomList('custom_groups', updated);
  };

  const loadClientData = async (client) => {
    setSel(client);
    if (!client) return;
    const [n, fu, cl] = await Promise.all([
      supabase.from('client_notes').select('*').eq('customer_id', client.id).order('created_at', { ascending: false }),
      supabase.from('follow_ups').select('*').eq('customer_id', client.id).order('due_date', { ascending: true }),
      supabase.from('contact_log').select('*').eq('customer_id', client.id).order('contacted_at', { ascending: false }).limit(50),
    ]);
    setNotes(n.data || []);
    setFollowUps(fu.data || []);
    setContactLog(cl.data || []);
  };

  const logContact = async (type, notes) => {
    if (!sel) return;
    try {
      await dbInsert('contact_log', {
        customer_id: sel.id, contact_type: type,
        notes: notes || '', contacted_by: myId,
        contacted_at: new Date().toISOString(),
      }, myId);
      await logActivity(myId, type + ' contact with: ' + sel.name + (notes ? ' — ' + notes : ''), 'crm');
      loadClientData(sel);
    } catch(err) { console.log('Contact log error:', err); }
  };

  const openWhatsApp = (phone) => {
    if (!phone) { alert('No phone number / لا يوجد رقم هاتف'); return; }
    // Clean phone number
    let clean = phone.replace(/[^0-9+]/g, '');
    if (clean.startsWith('0')) clean = '+2' + clean; // Egypt default
    if (!clean.startsWith('+')) clean = '+' + clean;
    logContact('whatsapp', 'Opened WhatsApp chat');
    window.open('https://wa.me/' + clean.replace('+', ''), '_blank');
  };

  const custInvoices = (c) => invoices.filter(i => i.customer_id === (c ? c.id : null) || (c && i.customer_name === c.name));

  // Get last note info for a customer
  const getLastNote = (customerId) => {
    const cn = allNotes.filter(n => n.customer_id === customerId);
    if (cn.length === 0) return null;
    return cn[0]; // already sorted desc
  };

  // Get last order for a customer
  const getLastOrder = (c) => {
    const invs = custInvoices(c).sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));
    return invs.length > 0 ? invs[0] : null;
  };

  // Sales visibility: hide invoice amounts for customers not assigned to this user (unless admin or has CRM View All)
  const canSeeSales = (c) => canViewAll || !c.assigned_rep || c.assigned_rep === myId;

  const filtered = useMemo(() => {
    let arr = customers.filter(c => {
      if (!isAdmin && c.restricted) return false;
      if (q && !(c.name || '').includes(q) && !(c.name_en || '').toLowerCase().includes(q.toLowerCase())) return false;
      if (groupF !== 'all' && c.group_name !== groupF) return false;
      if (catF !== 'all' && c.industry !== catF) return false;
      if (repF !== 'all') { if (repF === 'unassigned') { if (c.assigned_rep) return false; } else if (c.assigned_rep !== repF) return false; }
      if (stageF !== 'all') { if (stageF === 'active') { if (c.pipeline_stage === 'won' || c.pipeline_stage === 'lost') return false; } else if ((c.pipeline_stage || 'lead') !== stageF) return false; }
      return true;
    });
    if (sortBy === 'alpha') arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sortBy === 'alpha_rev') arr.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    if (sortBy === 'most_orders') arr.sort((a, b) => custInvoices(b).length - custInvoices(a).length);
    if (sortBy === 'top_sales') arr.sort((a, b) => {
      const aT = custInvoices(a).reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const bT = custInvoices(b).reduce((s, i) => s + Number(i.total_amount || 0), 0);
      return bT - aT;
    });
    if (sortBy === 'latest_note') arr.sort((a, b) => {
      const aN = getLastNote(a.id);
      const bN = getLastNote(b.id);
      if (!aN && !bN) return 0;
      if (!aN) return 1;
      if (!bN) return -1;
      return (bN.created_at || '').localeCompare(aN.created_at || '');
    });
    if (sortBy === 'earliest_note') arr.sort((a, b) => {
      const aN = getLastNote(a.id);
      const bN = getLastNote(b.id);
      if (!aN && !bN) return 0;
      if (!aN) return -1;
      if (!bN) return 1;
      return (aN.created_at || '').localeCompare(bN.created_at || '');
    });
    if (sortBy === 'no_notes') arr.sort((a, b) => {
      const aN = getLastNote(a.id);
      const bN = getLastNote(b.id);
      if (!aN && bN) return -1;
      if (aN && !bN) return 1;
      return 0;
    });
    return arr;
  }, [customers, q, groupF, catF, sortBy, invoices, allNotes]);

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
      }, myId);
      await logActivity(myId, 'Created client: ' + f.name, 'crm');
      setShowAdd(false); setF({}); onReload(); loadAllNotes();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const handleEditClient = async () => {
    if (!sel) return;
    try {
      await dbUpdate('customers', sel.id, {
        name: f.name || sel.name, name_ar: f.nameAr || sel.name_ar, name_en: f.nameEn || sel.name_en,
        phone: f.phone || sel.phone, email: f.email || sel.email, address: f.address || sel.address,
        city: f.city || sel.city, group_name: f.group || sel.group_name, industry: f.industry !== undefined ? f.industry : sel.industry,
        lead_source: f.leadSource || sel.lead_source,
        assigned_rep: f.assignedRep !== undefined ? (f.assignedRep || null) : sel.assigned_rep,
      }, myId);
      await logActivity(myId, 'Edited client: ' + (f.name || sel.name), 'crm');
      if (f.assignedRep && f.assignedRep !== sel.assigned_rep) notifyClientAssigned([f.assignedRep], f.name || sel.name, myId);
      setEditingClient(false); setF({}); onReload();
      loadClientData({...sel, name: f.name || sel.name});
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const handleAddNote = async () => {
    if (!f.noteText || !sel) return;
    try {
      await dbInsert('client_notes', { customer_id: sel.id, note_text: f.noteText }, myId);
      await logActivity(myId, 'Added note to client: ' + sel.name, 'crm');
      setShowNote(false); setF({}); loadClientData(sel); loadAllNotes();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const handleAddFollowUp = async () => {
    if (!f.task || !f.dueDate || !sel) return;
    try {
      const assignTo = f.assignTo || myId;
      await dbInsert('follow_ups', {
        customer_id: sel.id, task: f.task, due_date: f.dueDate,
        due_time: f.dueTime || '09:00', assigned_to: assignTo,
      }, myId);
      // Create calendar event for assignee
      await dbInsert('calendar_events', {
        title: 'Follow-up: ' + f.task + ' (' + sel.name + ')',
        event_date: f.dueDate, event_time: f.dueTime || '09:00',
        event_type: 'call', customer_id: sel.id, assigned_to: assignTo,
      }, myId);
      // Also create on creator's calendar if different from assignee
      if (assignTo && assignTo !== myId) {
        await dbInsert('calendar_events', {
          title: '[Assigned] Follow-up: ' + f.task + ' (' + sel.name + ') → ' + (users?.find(u => u.id === assignTo)?.name || ''),
          event_date: f.dueDate, event_time: f.dueTime || '09:00',
          event_type: 'call', customer_id: sel.id, assigned_to: myId,
        }, myId);
      }
      await logActivity(myId, 'Created follow-up for ' + sel.name + ': ' + f.task, 'crm');
      if (assignTo && assignTo !== myId) notifyFollowUp([assignTo], sel.name, f.task, myId);
      setShowFollowUp(false); setF({}); loadClientData(sel);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const completeFollowUp = async (id) => {
    try {
      await dbUpdate('follow_ups', id, { completed: true, completed_at: new Date().toISOString() }, myId);
      await logActivity(myId, 'Completed follow-up for ' + sel.name, 'crm');
      loadClientData(sel);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const changeStage = async (client, newStage) => {
    try {
      const oldStage = client.pipeline_stage || 'lead';
      await dbUpdate('customers', client.id, { pipeline_stage: newStage }, myId);
      const stageName = PIPELINE_STAGES.find(s => s.v === newStage)?.l || newStage;
      await logActivity(myId, 'Pipeline: ' + (client.name_en || client.name) + ' → ' + stageName, 'crm');
      await dbInsert('client_notes', { customer_id: client.id, note_text: '📊 Pipeline stage changed: ' + oldStage + ' → ' + newStage + ' by ' + (users?.find(u => u.id === myId)?.name || '') }, myId);
      if (sel && sel.id === client.id) { setSel({...sel, pipeline_stage: newStage}); loadClientData({...sel, pipeline_stage: newStage}); }
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  // ===== LIST VIEW =====
  if (!sel) return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">CRM</h2>
          <p className="text-[11px] text-slate-400">{filtered.length} clients · {customers.filter(c=>(c.pipeline_stage||'lead')!=='won'&&(c.pipeline_stage||'lead')!=='lost').length} in pipeline</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search..."
              className="pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs w-36 bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition" />
            <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
          </div>
          <button onClick={() => { setShowAdd(true); setF({}); }}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-xs font-bold shadow-sm hover:shadow-md transition">+ New Client</button>
        </div>
      </div>

      {/* Pipeline Visual */}
      <div className="bg-white rounded-2xl p-4 mb-4 border border-slate-100 shadow-sm">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setStageF('all')}
            className={'px-3 py-2.5 rounded-xl text-[10px] font-bold transition whitespace-nowrap ' + (stageF === 'all' ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}>
            All ({customers.length})
          </button>
          {PIPELINE_STAGES.map(s => {
            const count = customers.filter(c => (c.pipeline_stage || 'lead') === s.v).length;
            const isActive = stageF === s.v;
            return (
              <button key={s.v} onClick={() => setStageF(stageF === s.v ? 'all' : s.v)}
                className={'px-3 py-2.5 rounded-xl text-[10px] font-bold transition whitespace-nowrap ' + (isActive ? 'text-white shadow-md scale-105' : 'hover:scale-102')}
                style={isActive ? { background: s.c } : { background: s.c + '10', color: s.c }}>
                <span className="text-sm">{count}</span> {s.icon} {s.l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select value={catF} onChange={e => setCatF(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white">
          <option value="all">All Categories</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={groupF} onChange={e => setGroupF(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white">
          <option value="all">All Groups</option>
          {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={repF} onChange={e => setRepF(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white">
          <option value="all">All Reps</option>
          {(users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white">
          <option value="alpha">A → Z</option><option value="alpha_rev">Z → A</option>
          <option value="most_orders">Most Orders</option><option value="top_sales">Top Sales</option>
          <option value="latest_note">Latest Note</option><option value="no_notes">No Notes</option>
        </select>
        <span className="text-[10px] text-slate-400 ml-auto">{filtered.length} results</span>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl p-3 border border-slate-100"><div className="text-[9px] text-slate-400 uppercase tracking-wide">Total</div>
          <div className="text-xl font-extrabold">{filtered.length}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-100"><div className="text-[9px] text-slate-400 uppercase tracking-wide">Active</div>
          <div className="text-xl font-extrabold text-blue-600">{filtered.filter(c=>!['won','lost'].includes(c.pipeline_stage||'lead')).length}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-100"><div className="text-[9px] text-emerald-500 uppercase tracking-wide">Won</div>
          <div className="text-xl font-extrabold text-emerald-600">{filtered.filter(c=>(c.pipeline_stage)==='won').length}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-100"><div className="text-[9px] text-red-400 uppercase tracking-wide">Lost</div>
          <div className="text-xl font-extrabold text-red-500">{filtered.filter(c=>(c.pipeline_stage)==='lost').length}</div></div>
      </div>

      {showAdd && (
        <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
          <h3 className="text-sm font-bold text-blue-800 mb-3">New Client / عميل جديد</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] font-semibold">Name (Arabic)</label>
              <input value={f.name||''} onChange={e=>setF({...f,name:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" style={{direction:'rtl'}} /></div>
            <div><label className="text-[10px] font-semibold">Name (English)</label>
              <input value={f.nameEn||''} onChange={e=>setF({...f,nameEn:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Category / الفئة</label>
              <select value={f.industry||''} onChange={e=>{if(e.target.value==='_new'){const n=prompt('New category name:');if(n){addCategory(n);setF({...f,industry:n});}}else{setF({...f,industry:e.target.value});}}} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">Select...</option>{allCategories.map(c=><option key={c} value={c}>{c}</option>)}<option value="_new">+ Add New Category...</option></select></div>
            <div><label className="text-[10px] font-semibold">Group / المجموعة</label>
              <select value={f.group||''} onChange={e=>{if(e.target.value==='_new'){const n=prompt('New group name:');if(n){addGroup(n);setF({...f,group:n});}}else{setF({...f,group:e.target.value});}}} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">Select...</option>{allGroups.map(g=><option key={g} value={g}>{g}</option>)}<option value="_new">+ Add New Group...</option></select></div>
            <div><label className="text-[10px] font-semibold">Lead Source / المصدر</label>
              <select value={f.leadSource||''} onChange={e=>setF({...f,leadSource:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">Select...</option>{LEAD_SOURCES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Phone</label>
              <input value={f.phone||''} onChange={e=>setF({...f,phone:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">City</label>
              <input value={f.city||''} onChange={e=>setF({...f,city:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Credit Limit / حد ائتمان</label>
              <input type="number" value={f.creditLimit||''} onChange={e=>setF({...f,creditLimit:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Address / العنوان</label>
              <input value={f.address||''} onChange={e=>setF({...f,address:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
          </div>
          <div className="mt-2"><label className="text-[10px] font-semibold">Initial Notes / ملاحظات أولية</label>
            <textarea value={f.initialNotes||''} onChange={e=>setF({...f,initialNotes:e.target.value})} rows={2} className="w-full px-3 py-2 rounded border text-sm" /></div>
          <div className="flex gap-2 mt-3">
            <button onClick={async () => { await handleAddClient(); if (f.initialNotes && f.name) { /* note added separately after client creation */ } }}
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Save / حفظ</button>
            <button onClick={()=>setShowAdd(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel / إلغاء</button>
          </div>
        </div>
      )}
      {/* 30-Day Alert: Important Clients with No Recent Activity */}
      {(() => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoff = thirtyDaysAgo.toISOString();
        const neglected = customers.filter(c => {
          if (!c.important) return false;
          const lastNote = getLastNote(c.id);
          if (!lastNote) return true;
          return lastNote.created_at < cutoff;
        });
        if (neglected.length === 0) return null;
        return (
          <div className="bg-red-50 rounded-xl p-4 mb-3 border border-red-200">
            <h3 className="text-sm font-bold text-red-700 mb-2">⚠️ Important Clients — No Contact in 30+ Days ({neglected.length})</h3>
            {neglected.map(c => {
              const lastNote = getLastNote(c.id);
              const daysSince = lastNote ? Math.floor((Date.now() - new Date(lastNote.created_at).getTime()) / 86400000) : null;
              return (
                <div key={c.id} onClick={() => loadClientData(c)}
                  className="flex justify-between items-center py-2 border-b border-red-100 cursor-pointer hover:bg-red-100 rounded px-2">
                  <div>
                    <span className="text-xs font-bold" style={{direction: lang === 'ar' ? 'rtl' : 'ltr'}}>{lang === 'en' && c.name_en ? c.name_en : c.name}</span>
                    {c.group_name && <span className="ml-2 text-[10px] text-purple-600">{c.group_name}</span>}
                  </div>
                  <span className="text-[10px] font-bold text-red-600">
                    {daysSince ? daysSince + ' days ago' : 'Never contacted'}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(c => {
          const invs = custInvoices(c);
          const total = invs.reduce((a,i) => a + Number(i.total_amount||0), 0);
          const owed = invs.reduce((a,i) => a + Number(i.outstanding||0), 0);
          const lastNote = getLastNote(c.id);
          const lastOrder = getLastOrder(c);
          const noteUser = lastNote ? users?.find(u => u.id === lastNote.created_by) : null;
          const stage = PIPELINE_STAGES.find(s => s.v === (c.pipeline_stage || 'lead'));
          const rep = users?.find(u => u.id === c.assigned_rep);
          const showSales = canSeeSales(c);
          return (
            <div key={c.id} onClick={()=>loadClientData(c)}
              className="bg-white rounded-2xl overflow-hidden cursor-pointer border border-slate-100 hover:border-slate-300 hover:shadow-lg transition-all group">
              {/* Stage color bar */}
              <div className="h-1.5" style={{ background: stage ? `linear-gradient(90deg, ${stage.c}, ${stage.c}88)` : '#e2e8f0' }} />
              <div className="p-4">
                {/* Name + Stage */}
                <div className="flex justify-between items-start gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate" style={{direction:'rtl'}}>
                      {c.important && <span className="text-amber-400 mr-0.5">★</span>}
                      {lang === 'en' && c.name_en ? c.name_en : c.name}
                    </div>
                    {lang === 'ar' && c.name_en && <div className="text-[10px] text-blue-500 truncate">{c.name_en}</div>}
                  </div>
                  {stage && <span className="px-2 py-1 rounded-lg text-[9px] font-bold text-white flex-shrink-0" style={{background:stage.c}}>{stage.icon} {stage.l}</span>}
                </div>

                {/* Tags */}
                <div className="flex gap-1 mb-3 flex-wrap">
                  {c.industry && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md text-[9px] font-medium">{c.industry}</span>}
                  {c.group_name && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md text-[9px] font-medium">{c.group_name}</span>}
                </div>

                {/* Sales — hidden for non-assigned unless permitted */}
                {showSales ? (
                  <div className="flex justify-between items-end mb-3 px-3 py-2 rounded-xl bg-slate-50">
                    <div><div className="text-[8px] text-slate-400 uppercase tracking-wider">Sales</div>
                      <div className="text-sm font-extrabold text-slate-800">{total > 0 ? fmt(total) : '—'}</div></div>
                    <div className="text-right"><div className="text-[8px] text-slate-400 uppercase tracking-wider">{invs.length} orders</div>
                      <div className={'text-sm font-extrabold ' + (owed > 0 ? 'text-red-500' : 'text-emerald-500')}>{owed > 0 ? fmt(owed) : '✓ Paid'}</div></div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center mb-3 px-3 py-2 rounded-xl bg-slate-50">
                    <span className="text-[10px] text-slate-400">🔒 Sales restricted</span>
                  </div>
                )}

                {/* Footer */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    {rep ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />{rep.name}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">No rep</span>
                    )}
                  </div>
                  <div className="text-right">
                    {lastNote ? (
                      <div className="text-[9px] text-slate-400">
                        {new Date(lastNote.created_at).toLocaleDateString()}
                        {noteUser && <span className="ml-0.5 text-blue-400">{noteUser.name}</span>}
                      </div>
                    ) : (
                      <span className="text-[9px] text-red-400 font-medium">No notes</span>
                    )}
                  </div>
                </div>
              </div>
            </div>);
        })}
      </div>
    </div>
  );

  // ===== DETAIL VIEW =====
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
            <div><label className="text-[10px] font-semibold">Category</label>
              <select value={f.industry!==undefined?f.industry:(sel.industry||'')} onChange={e=>{if(e.target.value==='_new'){const n=prompt('New category:');if(n){addCategory(n);setF({...f,industry:n});}}else{setF({...f,industry:e.target.value});}}} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="">None</option>{allCategories.map(c=><option key={c} value={c}>{c}</option>)}<option value="_new">+ Add New...</option></select></div>
            <div><label className="text-[10px] font-semibold">Group</label>
              <select value={f.group!==undefined?f.group:(sel.group_name||'')} onChange={e=>{if(e.target.value==='_new'){const n=prompt('New group:');if(n){addGroup(n);setF({...f,group:n});}}else{setF({...f,group:e.target.value});}}} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="">None</option>{allGroups.map(g=><option key={g} value={g}>{g}</option>)}<option value="_new">+ Add New...</option></select></div>
            <div><label className="text-[10px] font-semibold">Lead Source</label>
              <select value={f.leadSource!==undefined?f.leadSource:(sel.lead_source||'')} onChange={e=>setF({...f,leadSource:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="">None</option>{LEAD_SOURCES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Phone</label>
              <input value={f.phone!==undefined?f.phone:(sel.phone||'')} onChange={e=>setF({...f,phone:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] font-semibold">City</label>
              <input value={f.city!==undefined?f.city:(sel.city||'')} onChange={e=>setF({...f,city:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Assigned Rep / الممثل</label>
              <select value={f.assignedRep!==undefined?f.assignedRep:(sel.assigned_rep||'')} onChange={e=>setF({...f,assignedRep:e.target.value})} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="">Unassigned / غير معيّن</option>
                {(users||[]).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
              </select></div>
            <div className="col-span-2 flex gap-2">
              <button onClick={handleEditClient} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-semibold">Save / حفظ</button>
              <button onClick={()=>{setEditingClient(false);setF({});}} className="px-3 py-1.5 border border-slate-200 rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-extrabold" style={{direction: lang === 'ar' ? 'rtl' : 'ltr'}}>{lang === 'en' && sel.name_en ? sel.name_en : sel.name}</h3>
                {lang === 'ar' && sel.name_en && <div className="text-sm text-blue-500">{sel.name_en}</div>}
                <div className="flex gap-1 mt-1 flex-wrap">
                  {sel.industry && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">{sel.industry}</span>}
                  {sel.group_name && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">{sel.group_name}</span>}
                  {sel.lead_source && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{sel.lead_source}</span>}
                  {sel.city && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{sel.city}</span>}
                </div>
              </div>
              <button onClick={()=>{setEditingClient(true);setF({});}} className="px-3 py-1 border border-blue-300 text-blue-500 rounded text-xs">Edit / تعديل</button>
            </div>
            {/* Important Toggle */}
            <button onClick={async () => {
              try {
                const newVal = !sel.important;
                await dbUpdate('customers', sel.id, { important: newVal }, myId);
                setSel({...sel, important: newVal});
                onReload();
              } catch(err) { alert('Error: ' + err.message); }
            }} className={'mt-2 px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ' + (sel.important ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-400')}>
              {sel.important ? '⭐ Important Client / عميل مهم' : '☆ Mark as Important / تعيين كمهم'}
            </button>
            {sel.phone && <div className="text-xs text-slate-500 mt-2">Phone: {sel.phone}</div>}
            {sel.assigned_rep && (() => { const rep = users?.find(u => u.id === sel.assigned_rep); return rep ? <div className="text-xs text-indigo-600 font-semibold mt-1">👤 Assigned Rep / الممثل: {rep.name}</div> : null; })()}

            {/* Pipeline Stage */}
            <div className="mt-3 p-3 bg-slate-50 rounded-lg">
              <div className="text-[10px] text-slate-500 font-semibold mb-2">Pipeline Stage / مرحلة البيع</div>
              <div className="flex gap-1 flex-wrap">
                {PIPELINE_STAGES.map(s => {
                  const isActive = (sel.pipeline_stage || 'lead') === s.v;
                  return (
                    <button key={s.v} onClick={(e) => { e.stopPropagation(); changeStage(sel, s.v); }}
                      className={'px-2.5 py-1.5 rounded text-[10px] font-bold transition ' + (isActive ? 'text-white shadow-sm' : 'hover:opacity-80')}
                      style={isActive ? { background: s.c } : { background: s.c + '18', color: s.c }}>
                      {s.icon} {s.l}
                    </button>
                  );
                })}
              </div>
            </div>

            {sel.credit_limit && <div className="text-xs text-slate-500 mt-2">Credit Limit: {fE(sel.credit_limit)}</div>}
            {isAdmin && (
              <div className="flex items-center gap-2 mt-2 p-2 bg-red-50 rounded border border-red-200">
                <input type="checkbox" checked={sel.restricted || false}
                  onChange={async (e) => {
                    try {
                      await dbUpdate('customers', sel.id, { restricted: e.target.checked }, myId);
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
      {canSeeSales(sel) ? (
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="bg-blue-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Sales</div><div className="text-sm font-bold text-blue-600">{fE(totalSales)}</div></div>
          <div className="bg-emerald-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Collected</div><div className="text-sm font-bold text-emerald-600">{fE(totalCollected)}</div></div>
          <div className="bg-red-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Owed</div><div className="text-sm font-bold text-red-500">{fE(totalOwed)}</div></div>
          <div className="bg-amber-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Orders</div><div className="text-sm font-bold">{invs.length}</div></div>
        </div>
      ) : (
        <div className="bg-slate-50 rounded-lg p-3 mb-3 text-center"><span className="text-xs text-slate-400">🔒 Sales data restricted — only visible to assigned rep or admins</span></div>
      )}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={()=>{setShowNote(true);setF({});}} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Note / ملاحظة</button>
        <button onClick={()=>{setShowFollowUp(true);setF({});}} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold">+ Follow-up / متابعة</button>
        <button onClick={() => openWhatsApp(sel.phone)} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-semibold">💬 WhatsApp</button>
        <button onClick={() => { if(sel.phone) { logContact('phone', 'Phone call'); window.open('tel:'+sel.phone); } else alert('No phone'); }}
          className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-semibold">📞 Call</button>
        <button onClick={() => { const note = prompt('Contact notes / ملاحظات الاتصال:'); if(note) logContact('email', note); }}
          className="px-3 py-1.5 bg-slate-500 text-white rounded-lg text-xs font-semibold">📧 Log Email</button>
        {sel.email && <button onClick={() => setShowEmailComposer(true)}
          className="px-3 py-1.5 text-white rounded-lg text-xs font-semibold"
          style={{background:'linear-gradient(135deg, #0ea5e9, #6366f1)'}}>📨 Send Email</button>}
        <button onClick={() => { const note = prompt('Visit notes / ملاحظات الزيارة:'); if(note) logContact('visit', note); }}
          className="px-3 py-1.5 bg-cyan-500 text-white rounded-lg text-xs font-semibold">🚗 Visit</button>
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
            <select value={f.assignTo||''} onChange={e=>setF({...f,assignTo:e.target.value})} className="col-span-2 px-3 py-2 rounded border text-sm">
              <option value="">Assign to me / تعيين لي</option>
              {(users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddFollowUp} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-semibold">Save + Add to Calendar / حفظ</button>
            <button onClick={()=>setShowFollowUp(false)} className="px-3 py-1.5 border border-slate-200 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}
      {pendingFU.length > 0 && (
        <div className="bg-amber-50 rounded-xl p-4 mb-3 border border-amber-200">
          <h4 className="text-sm font-bold text-amber-800 mb-2">Follow-ups ({pendingFU.length})</h4>
          {pendingFU.map(fu => {
            const isOverdue = fu.due_date && fu.due_date < new Date().toISOString().substring(0, 10);
            const assignedName = users?.find(u => u.id === fu.assigned_to)?.name;
            return (
              <div key={fu.id} className={'flex justify-between items-center py-2 border-b border-amber-100 ' + (isOverdue ? 'bg-red-50 -mx-2 px-2 rounded' : '')}>
                <div>
                  <div className={'text-xs font-semibold ' + (isOverdue ? 'text-red-700' : '')}>{fu.task}</div>
                  <div className="text-[10px] text-slate-500">
                    {fu.due_date} {fu.due_time ? fu.due_time.substring(0, 5) : ''}
                    {assignedName && <span className="ml-1 text-purple-600">→ {assignedName}</span>}
                    {isOverdue && <span className="ml-1 text-red-600 font-bold">OVERDUE</span>}
                  </div>
                </div>
                <button onClick={()=>completeFollowUp(fu.id)} className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px]">Done / تم</button>
              </div>
            );
          })}
        </div>
      )}
      {notes.length > 0 && (
        <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
          <h4 className="text-sm font-bold mb-2">Notes / ملاحظات ({notes.length})</h4>
          {notes.map(n => {
            const noteUser = users?.find(u => u.id === n.created_by);
            return (
              <div key={n.id} className="py-2 border-b border-slate-50">
                <div className="text-xs">{n.note_text}</div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {noteUser && <span className="font-semibold text-blue-500 mr-1">{noteUser.name}</span>}
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Contact History */}
      {contactLog.length > 0 && (
        <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
          <h4 className="text-sm font-bold mb-2">Contact History / سجل الاتصال ({contactLog.length})</h4>
          {contactLog.map(c => {
            const icons = { whatsapp: '💬', phone: '📞', email: '📧', visit: '🚗' };
            const colors = { whatsapp: 'text-green-600', phone: 'text-purple-600', email: 'text-slate-600', visit: 'text-cyan-600' };
            const contactUser = users?.find(u => u.id === c.contacted_by);
            return (
              <div key={c.id} className="flex items-start gap-2 py-2 border-b border-slate-50">
                <span className="text-sm">{icons[c.contact_type] || '📋'}</span>
                <div className="flex-1">
                  <div className="text-xs">
                    <span className={'font-semibold ' + (colors[c.contact_type] || '')}>{c.contact_type}</span>
                    {c.notes && <span className="text-slate-600 ml-1">— {c.notes}</span>}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {contactUser && <span className="font-semibold text-blue-500 mr-1">{contactUser.name}</span>}
                    {new Date(c.contacted_at).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
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
