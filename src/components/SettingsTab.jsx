'use client';
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { EXPENSE_CATS } from '../lib/utils';
import TranslationPanel from './TranslationPanel';
import { PERSONALITIES } from './AIGreeter';

const ROLES = [
  { v: 'super_admin', l: '🔴 Super Admin', c: 'text-red-500' },
  { v: 'admin', l: '🟣 Admin/Manager', c: 'text-purple-500' },
  { v: 'team', l: '🔵 Team Member', c: 'text-blue-500' },
  { v: 'viewer', l: '⚪ Viewer', c: 'text-slate-500' },
];

const MODULES = [
  'Dashboard', 'Personal Dashboard', 'Sales', 'Customers', 'Treasury', 'Checks', 'Debts',
  'Warehouse', 'Inventory', 'CRM', 'CRM View All', 'Tickets', 'Calendar', 'Customs',
  'Shipping Rates', 'Quotes', 'Bank', 'Egypt Bank', 'Reports',
  'Daily Log', 'Admin', 'AI Assistant', 'Communications', 'Settings', 'Import',
  // Granular permissions
  'Edit Treasury', 'Edit Invoices', 'Delete Invoices', 'Edit Inventory', 'Edit Warehouse',
  'Edit CRM', 'View Costs', 'Delete Tickets', 'Assign Tickets', 'Merge Customers',
  'Manage Categories', 'Export Data', 'Post Reminders', 'Welcome Briefing',
];

const NOTIF_TYPES = [
  { v: 'ticket_assigned', l: 'Ticket Assigned / تعيين تذكرة' },
  { v: 'ticket_status', l: 'Ticket Status Changed / تغيير حالة التذكرة' },
  { v: 'ticket_comment', l: 'Ticket Comment / تعليق على تذكرة' },
  { v: 'ticket_reassigned', l: 'Ticket Reassigned / إعادة تعيين تذكرة' },
  { v: 'event_scheduled', l: 'Event Scheduled / حدث مجدول' },
  { v: 'followup_created', l: 'Follow-up Created / متابعة جديدة' },
  { v: 'overdue_digest', l: 'Overdue Digest / تنبيه متأخر' },
  { v: 'daily_reminder', l: 'Daily Log Reminder / تذكير يومي' },
  { v: 'shipping_rate_added', l: 'Shipping Rate Added / سعر شحن جديد' },
  { v: 'shipping_rate_booked', l: 'Shipping Rate Booked / حجز شحنة' },
  { v: 'shipping_quote', l: 'Shipping Quote Created / عرض سعر شحن' },
  { v: 'crm_status_change', l: 'CRM Status Changed / تغيير حالة العميل' },
  { v: 'client_assigned', l: 'Client Assigned to Rep / تعيين عميل لمندوب' },
  { v: 'translation_complete', l: 'Translation Complete / اكتمال الترجمة' },
  { v: 'reminder', l: 'Team Reminders / تذكيرات الفريق' },
];

export default function SettingsTab({ toast, user, users, onReload, isAdmin, userProfile }) {
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const [section, setSection] = useState('roles');
  const [showAddMember, setShowAddMember] = useState(false);
  const [f, setF] = useState({});
  const [permissions, setPermissions] = useState({});
  const [notifPrefs, setNotifPrefs] = useState({});
  const [rules, setRules] = useState([]);
  const [expDescs, setExpDescs] = useState([]);
  const [expSearch, setExpSearch] = useState('');
  const [expCatFilter, setExpCatFilter] = useState('all');
  const [mergeMode, setMergeMode] = useState(null);
  const [mergeTargets, setMergeTargets] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    const [perms, notifs, rls] = await Promise.all([
      supabase.from('module_permissions').select('*'),
      supabase.from('notification_prefs').select('*'),
      supabase.from('expense_rules').select('*').order('created_at', { ascending: false }),
    ]);
    // Load unique expense descriptions from treasury
    try {
      let allTreasury = []; let from = 0;
      while (true) {
        const { data } = await supabase.from('treasury').select('description, category, subcategory, cash_in, cash_out').order('description').range(from, from + 999);
        if (!data || data.length === 0) break;
        allTreasury = allTreasury.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      const descMap = {};
      allTreasury.forEach(t => {
        const desc = (t.description || '').trim();
        if (!desc) return;
        const isExpense = Number(t.cash_out || 0) > 0;
        if (!isExpense) return; // only expenses
        if (!descMap[desc]) descMap[desc] = { description: desc, category: '', subcategory: '', count: 0, total: 0 };
        descMap[desc].count++;
        descMap[desc].total += Number(t.cash_out || 0);
        if (t.category && !descMap[desc].category) descMap[desc].category = t.category;
        if (t.subcategory && !descMap[desc].subcategory) descMap[desc].subcategory = t.subcategory;
      });
      setExpDescs(Object.values(descMap).sort((a, b) => b.total - a.total));
    } catch(e) { console.warn('Expense desc load error:', e); }
    const pMap = {};
    (perms.data || []).forEach(p => {
      if (!pMap[p.user_id]) pMap[p.user_id] = {};
      pMap[p.user_id][p.module_name] = p.has_access;
    });
    setPermissions(pMap);
    const nMap = {};
    (notifs.data || []).forEach(n => {
      if (!nMap[n.user_id]) nMap[n.user_id] = {};
      nMap[n.user_id][n.notif_type] = n.enabled;
    });
    setNotifPrefs(nMap);
    setRules(rls.data || []);
    setLoaded(true);
  };

  const togglePermission = async (userId, module) => {
    const current = permissions[userId]?.[module] ?? true;
    const newVal = !current;
    try {
      const { data: existing } = await supabase.from('module_permissions')
        .select('id').eq('user_id', userId).eq('module_name', module).maybeSingle();
      if (existing) {
        await supabase.from('module_permissions').update({ has_access: newVal }).eq('id', existing.id);
      } else {
        await supabase.from('module_permissions').insert({ user_id: userId, module_name: module, has_access: newVal });
      }
      setPermissions(prev => ({ ...prev, [userId]: { ...prev[userId], [module]: newVal } }));
    } catch (err) { console.error(err); }
  };

  const toggleNotif = async (userId, notifType) => {
    const current = notifPrefs[userId]?.[notifType] ?? true;
    const newVal = !current;
    try {
      const { data: existing } = await supabase.from('notification_prefs')
        .select('id').eq('user_id', userId).eq('notif_type', notifType).single();
      if (existing) {
        await supabase.from('notification_prefs').update({ enabled: newVal }).eq('id', existing.id);
      } else {
        await supabase.from('notification_prefs').insert({ user_id: userId, notif_type: notifType, enabled: newVal });
      }
      setNotifPrefs(prev => ({ ...prev, [userId]: { ...prev[userId], [notifType]: newVal } }));
    } catch (err) { console.error(err); }
  };

  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [selectedModules, setSelectedModules] = useState([]);

  const handleAddMember = async () => {
    if (!f.name || !f.email || !f.password) { setAddError('Name, email, and password are required'); return; }
    if (f.password.length < 6) { setAddError('Password must be at least 6 characters'); return; }
    setAddLoading(true); setAddError(''); setAddSuccess('');
    try {
      var res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.name, name_ar: f.nameAr || '', email: f.email,
          password: f.password, role: f.role || 'team',
          reports_to: f.reportsTo || null, phone: f.phone || '',
          modules: selectedModules
        })
      });
      var data = await res.json();
      if (data.error) { setAddError(data.error); }
      else if (data.warning) { setAddError(data.warning); }
      else { setAddSuccess(f.name + ' added successfully! They can now log in with ' + f.email); setShowAddMember(false); setF({}); setSelectedModules([]); onReload(); loadPrefs(); }
    } catch (err) { setAddError('Error: ' + err.message); }
    setAddLoading(false);
  };

  const handleUpdateUser = async (userId, updates) => {
    try {
      var res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, ...updates })
      });
      var data = await res.json();
      if (data.error) alert('Error: ' + data.error);
      else { onReload(); loadPrefs(); }
    } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
  };

  const handleDeactivateUser = async (userId, userName) => {
    if (!confirm('Deactivate ' + userName + '? They will no longer be able to log in.')) return;
    try {
      var res = await fetch('/api/users?id=' + userId, { method: 'DELETE' });
      var data = await res.json();
      if (data.error) alert('Error: ' + data.error);
      else { onReload(); loadPrefs(); }
    } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
  };

  const handlePermanentDelete = async (userId, userName) => {
    var confirmation = prompt('Type "DELETE ' + userName + '" to permanently remove this person and all their data. This CANNOT be undone.');
    if (confirmation !== 'DELETE ' + userName) { if (confirmation !== null) alert('Text did not match. Deletion cancelled.'); return; }
    try {
      var res = await fetch('/api/users?id=' + userId + '&permanent=true', { method: 'DELETE' });
      var data = await res.json();
      if (data.error) alert('Error: ' + data.error);
      else { alert(userName + ' has been permanently deleted.'); onReload(); loadPrefs(); }
    } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
  };

  const toggleModule = (mod) => {
    if (selectedModules.includes(mod)) setSelectedModules(selectedModules.filter(function(m) { return m !== mod; }));
    else setSelectedModules([...selectedModules, mod]);
  };

  const nonSuperUsers = (users || []).filter(u => u.role !== 'super_admin');

  return (
    <div>
      <h2 className="text-xl font-extrabold mb-3">Settings / إعدادات</h2>

      {/* Section Tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {[['roles', 'Team & Roles'], ['permissions', 'Module Access'], ['notifications', 'Notifications'], ['comms', '📬 Communications'], ['greeter', '🤖 AI Greeter'], ['categories', '🏷️ Categories'], ['rules', 'Category Rules / قواعد'], ['expenses', '📋 Expense Descriptions'], ['translation', '🌐 Translation / ترجمة']].map(([v, l]) => (
          <button key={v} onClick={() => setSection(v)}
            className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition ' + (section === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>
            {l}
          </button>
        ))}
      </div>

      {/* ===== TEAM & ROLES ===== */}
      {section === 'roles' && (
        <div>
          {/* Role Legend */}
          <div className="bg-white rounded-xl p-4 mb-3">
            <h3 className="text-sm font-bold mb-2">Role Hierarchy</h3>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500"></span> Super Admin — sees everything, manages all</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-500"></span> Admin/Manager — sees their team</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500"></span> Team Member — sees own data only</div>
            </div>
          </div>

          {/* Add Member */}
          <button onClick={() => { setShowAddMember(true); setF({}); setSelectedModules(['Dashboard','Tickets','Calendar','CRM','Daily Log']); setAddError(''); setAddSuccess(''); }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold mb-3">+ Add Team Member / إضافة عضو</button>

          {addSuccess && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 text-xs text-emerald-700 font-semibold">✅ {addSuccess}</div>}

          {showAddMember && (
            <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
              <h3 className="text-sm font-bold text-blue-800 mb-3">New Team Member / عضو جديد</h3>
              {addError && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 text-xs text-red-700">{addError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold">Name *</label>
                  <input value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" placeholder="Full name" /></div>
                <div><label className="text-[10px] font-semibold">Name (Arabic)</label>
                  <input value={f.nameAr || ''} onChange={e => setF({ ...f, nameAr: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" style={{ direction: 'rtl' }} placeholder="الاسم بالعربي" /></div>
                <div><label className="text-[10px] font-semibold">Email *</label>
                  <input type="email" value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" placeholder="name@company.com" /></div>
                <div><label className="text-[10px] font-semibold">Password * <span className="text-slate-400">(min 6 chars)</span></label>
                  <input type="text" value={f.password || ''} onChange={e => setF({ ...f, password: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" placeholder="Temp password" /></div>
                <div><label className="text-[10px] font-semibold">Phone</label>
                  <input value={f.phone || ''} onChange={e => setF({ ...f, phone: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" placeholder="+20..." /></div>
                <div><label className="text-[10px] font-semibold">Role</label>
                  <select value={f.role || 'team'} onChange={e => setF({ ...f, role: e.target.value })} className="w-full px-3 py-2 rounded border text-sm">
                    {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-semibold">Reports To / المدير</label>
                  <select value={f.reportsTo || ''} onChange={e => setF({ ...f, reportsTo: e.target.value })} className="w-full px-3 py-2 rounded border text-sm">
                    <option value="">None (Top Level)</option>
                    {(users || []).filter(u => u.role === 'super_admin' || u.role === 'admin').map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select></div>
              </div>
              <div className="mt-3">
                <label className="text-[10px] font-semibold mb-1 block">Module Access / الصلاحيات</label>
                <div className="flex gap-2 flex-wrap">
                  {MODULES.map(mod => (
                    <label key={mod} className={'flex items-center gap-1 px-2 py-1 rounded border text-[10px] cursor-pointer ' + (selectedModules.includes(mod) ? 'bg-blue-100 border-blue-300 text-blue-700 font-bold' : 'bg-white border-slate-200 text-slate-500')}>
                      <input type="checkbox" checked={selectedModules.includes(mod)} onChange={() => toggleModule(mod)} className="w-3 h-3" />
                      {mod}
                    </label>
                  ))}
                </div>
                <div className="flex gap-1 mt-1">
                  <button onClick={() => setSelectedModules([...MODULES])} className="text-[9px] text-blue-500 hover:underline">Select All</button>
                  <button onClick={() => setSelectedModules([])} className="text-[9px] text-slate-400 hover:underline">Clear</button>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAddMember} disabled={addLoading}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  {addLoading ? 'Creating...' : '✅ Create Account & Add / إنشاء حساب'}
                </button>
                <button onClick={() => { setShowAddMember(false); setAddError(''); }} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
              </div>
              <div className="text-[9px] text-slate-400 mt-2">This creates a login account + sets their role and permissions. They can sign in immediately.</div>
            </div>
          )}

          {/* Team Members List */}
          <div className="space-y-2">
            {(users || []).map(u => {
              const roleInfo = ROLES.find(r => r.v === u.role) || ROLES[2];
              const reportsToUser = users?.find(m => m.id === u.reports_to);
              const isEditing = editingUser === u.id;
              return (
                <div key={u.id} className={'bg-white rounded-xl p-4 border ' + (u.active === false ? 'opacity-50 border-red-200' : isEditing ? 'border-blue-400 shadow-md' : 'border-slate-200')}>
                  {isEditing ? (
                    <div>
                      <h4 className="text-xs font-bold text-blue-700 mb-2">✏️ Editing {u.name}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-[10px] font-semibold">Name</label>
                          <input defaultValue={u.name} id={'edit-name-'+u.id} className="w-full px-3 py-2 rounded border text-sm" /></div>
                        <div><label className="text-[10px] font-semibold">Name (Arabic)</label>
                          <input defaultValue={u.name_ar||''} id={'edit-namear-'+u.id} className="w-full px-3 py-2 rounded border text-sm" style={{direction:'rtl'}} /></div>
                        <div><label className="text-[10px] font-semibold">Email</label>
                          <input defaultValue={u.email} className="w-full px-3 py-2 rounded border text-sm bg-slate-50" disabled />
                          <div className="text-[9px] text-slate-400">Email cannot be changed</div></div>
                        <div><label className="text-[10px] font-semibold">Phone</label>
                          <input defaultValue={u.phone||''} id={'edit-phone-'+u.id} className="w-full px-3 py-2 rounded border text-sm" placeholder="+20..." /></div>
                        <div><label className="text-[10px] font-semibold">Role</label>
                          <select defaultValue={u.role} id={'edit-role-'+u.id} className="w-full px-3 py-2 rounded border text-sm">
                            {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                          </select></div>
                        <div><label className="text-[10px] font-semibold">Reports To</label>
                          <select defaultValue={u.reports_to||''} id={'edit-reports-'+u.id} className="w-full px-3 py-2 rounded border text-sm">
                            <option value="">None (Top Level)</option>
                            {(users || []).filter(m => m.id !== u.id).map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select></div>
                        <div><label className="text-[10px] font-semibold">New Password <span className="text-slate-400">(leave blank to keep)</span></label>
                          <input type="text" id={'edit-pw-'+u.id} className="w-full px-3 py-2 rounded border text-sm" placeholder="Min 6 chars" /></div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={async () => {
                          var updates = {
                            name: document.getElementById('edit-name-'+u.id).value,
                            name_ar: document.getElementById('edit-namear-'+u.id).value,
                            phone: document.getElementById('edit-phone-'+u.id).value,
                            role: document.getElementById('edit-role-'+u.id).value,
                            reports_to: document.getElementById('edit-reports-'+u.id).value || null
                          };
                          var pw = document.getElementById('edit-pw-'+u.id).value;
                          if (pw) { if (pw.length < 6) { alert('Password must be at least 6 characters'); return; } updates.new_password = pw; }
                          await handleUpdateUser(u.id, updates);
                          setEditingUser(null);
                        }} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold">💾 Save Changes</button>
                        <button onClick={() => setEditingUser(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-sm font-bold">{u.name} {u.active === false && <span className="text-red-500 text-[10px]">(Deactivated)</span>}</div>
                          {u.name_ar && <div className="text-xs text-slate-500" style={{ direction: 'rtl' }}>{u.name_ar}</div>}
                          <div className="text-xs text-slate-400">{u.email}</div>
                          {u.phone && <div className="text-[10px] text-slate-400">📱 {u.phone}</div>}
                          {reportsToUser && <div className="text-[10px] text-slate-400">Reports to: {reportsToUser.name}</div>}
                        </div>
                        <span className={'text-xs font-bold ' + roleInfo.c}>{roleInfo.l}</span>
                      </div>
                      <div className="flex gap-2 mt-2 flex-wrap items-center">
                        <button onClick={() => setEditingUser(u.id)}
                          className="px-2 py-1 rounded border border-blue-300 text-blue-600 text-[10px] font-semibold">✏️ Edit</button>
                        <button onClick={() => {
                          var pw = prompt('New password for ' + u.name + ' (min 6 chars):');
                          if (pw && pw.length >= 6) handleUpdateUser(u.id, { new_password: pw });
                          else if (pw) alert('Password must be at least 6 characters');
                        }} className="px-2 py-1 rounded border border-amber-300 text-amber-600 text-[10px] font-semibold">🔑 Reset Password</button>
                        {u.active !== false && <button onClick={() => handleDeactivateUser(u.id, u.name)}
                          className="px-2 py-1 rounded border border-red-300 text-red-500 text-[10px] font-semibold">Deactivate</button>}
                        {u.active === false && <button onClick={() => handleUpdateUser(u.id, { active: true })}
                          className="px-2 py-1 rounded border border-emerald-300 text-emerald-600 text-[10px] font-semibold">✅ Reactivate</button>}
                        {isSuperAdmin && <button onClick={() => handlePermanentDelete(u.id, u.name)}
                          className="px-2 py-1 rounded border border-red-600 bg-red-50 text-red-700 text-[10px] font-bold">🗑 Delete Permanently</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== MODULE ACCESS ===== */}
      {section === 'permissions' && (
        <div className="bg-white rounded-xl p-4 overflow-auto">
          <h3 className="text-sm font-bold mb-3">Module Access / صلاحيات الوحدات</h3>
          <p className="text-[10px] text-slate-400 mb-3">Super Admin always has full access. Toggle modules for other users.</p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-2 py-1.5 text-left text-[10px] font-bold">Module / Permission</th>
                {nonSuperUsers.map(u => (
                  <th key={u.id} className="px-2 py-1.5 text-center text-[10px] font-bold">{u.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Tab Access */}
              <tr><td colSpan={nonSuperUsers.length + 1} className="px-2 py-2 bg-blue-50 text-[10px] font-bold text-blue-700 border-b border-blue-200">📑 TAB ACCESS — which tabs the user can see</td></tr>
              {['Dashboard', 'Personal Dashboard', 'Sales', 'Customers', 'Treasury', 'Checks', 'Debts', 'Warehouse', 'Inventory', 'CRM', 'Tickets', 'Calendar', 'Customs', 'Shipping Rates', 'Quotes', 'Bank', 'Egypt Bank', 'Reports', 'Daily Log', 'Admin', 'AI Assistant', 'Communications', 'Settings', 'Import', 'Welcome Briefing'].map(mod => (
                <tr key={mod} className="border-b border-slate-50">
                  <td className="px-2 py-1.5 text-[10px] font-semibold">{mod}</td>
                  {nonSuperUsers.map(u => {
                    const hasAccess = permissions[u.id]?.[mod] ?? true;
                    return (
                      <td key={u.id} className="px-2 py-1 text-center">
                        <button onClick={() => togglePermission(u.id, mod)}
                          className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (hasAccess ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                          {hasAccess ? 'ON' : 'OFF'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Action Permissions */}
              <tr><td colSpan={nonSuperUsers.length + 1} className="px-2 py-2 bg-amber-50 text-[10px] font-bold text-amber-700 border-b border-amber-200 mt-2">🔐 ACTION PERMISSIONS — what the user can do (Tab ON + Edit OFF = Read Only 👁️)</td></tr>
              {['Edit Treasury', 'Edit Invoices', 'Delete Invoices', 'Edit Inventory', 'Edit Warehouse', 'Edit CRM', 'View Costs', 'CRM View All', 'CRM View Contacts', 'Delete Tickets', 'Assign Tickets', 'Merge Customers', 'Manage Categories', 'Export Data', 'Post Reminders'].map(mod => (
                <tr key={mod} className="border-b border-slate-50">
                  <td className="px-2 py-1.5 text-[10px] font-semibold text-amber-700">{mod}</td>
                  {nonSuperUsers.map(u => {
                    const hasAccess = permissions[u.id]?.[mod] ?? false;
                    return (
                      <td key={u.id} className="px-2 py-1 text-center">
                        <button onClick={() => togglePermission(u.id, mod)}
                          className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (hasAccess ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                          {hasAccess ? 'ON' : 'OFF'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== NOTIFICATIONS ===== */}
      {section === 'notifications' && (
        <div className="bg-white rounded-xl p-4 overflow-auto">
          <h3 className="text-sm font-bold mb-3">Email Notification Controls / إشعارات البريد</h3>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-2 py-1.5 text-left text-[10px] font-bold">Notification Type</th>
                {(users || []).map(u => (
                  <th key={u.id} className="px-2 py-1.5 text-center text-[10px] font-bold">{u.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIF_TYPES.map(nt => (
                <tr key={nt.v} className="border-b border-slate-50">
                  <td className="px-2 py-1.5 text-[10px] font-semibold">{nt.l}</td>
                  {(users || []).map(u => {
                    const enabled = notifPrefs[u.id]?.[nt.v] ?? true;
                    return (
                      <td key={u.id} className="px-2 py-1 text-center">
                        <button onClick={() => toggleNotif(u.id, nt.v)}
                          className={'px-2 py-0.5 rounded text-[9px] font-bold ' + (enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                          {enabled ? 'ON' : 'OFF'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== COMMUNICATIONS ===== */}
      {section === 'comms' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3">📧 Gmail Integration</h3>
            <p className="text-xs text-slate-500 mb-3">Connect your Gmail account to read and send emails from the app and AI Secretary.</p>
            <button onClick={() => { var url = '/api/gmail/connect'; if (user && user.id) url += '?userId=' + user.id; window.open(url, '_blank', 'width=600,height=700'); }}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white" style={{background:'linear-gradient(135deg, #0ea5e9, #3b82f6)'}}>
              Connect Gmail Account
            </button>
            <div className="mt-2 text-[10px] text-slate-400">Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in Vercel env vars</div>
          </div>
          <div className="bg-white rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3">💬 WhatsApp Business (Twilio)</h3>
            <p className="text-xs text-slate-500 mb-3">Send and receive WhatsApp messages via Twilio. Set up your Twilio account first.</p>
            <div className="text-xs text-slate-500 space-y-1">
              <div>1. Create account at <strong>twilio.com</strong></div>
              <div>2. Get Account SID + Auth Token from console</div>
              <div>3. Enable WhatsApp sandbox or request a business number</div>
              <div>4. Add to Vercel: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM</div>
              <div>5. Set webhook URL: <code className="bg-slate-100 px-1 rounded">https://nexttrade-hub.vercel.app/api/whatsapp/webhook</code></div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3">🤖 AI Secretary Communications</h3>
            <p className="text-xs text-slate-500 mb-2">Once Gmail and/or WhatsApp are connected, the AI Secretary can:</p>
            <div className="text-xs text-slate-600 space-y-1">
              <div>• Check email: <em>&quot;Check my email for anything urgent&quot;</em></div>
              <div>• Search email: <em>&quot;Find emails from Ahmed about shipping&quot;</em></div>
              <div>• Reply to email: <em>&quot;Reply to Ahmed and tell him Thursday&quot;</em></div>
              <div>• Send WhatsApp: <em>&quot;Send WhatsApp to Omar confirming the shipment&quot;</em></div>
              <div>• Create tickets from messages: <em>&quot;Create a ticket from that email&quot;</em></div>
            </div>
            <p className="text-[10px] text-slate-400 mt-2">All sends require your approval first. Full audit log in Communications tab.</p>
          </div>
        </div>
      )}

      {/* ===== CATEGORIES MANAGER ===== */}
      {/* ===== AI GREETER SETTINGS ===== */}
      {section === 'greeter' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-bold mb-1">🤖 AI Greeter Settings</h3>
          <p className="text-xs text-slate-500 mb-4">Configure the AI personality that greets each team member when they log in. Super admin can set per-user preferences.</p>
          
          <div className="space-y-3">
            {(users || []).filter(u => u.role !== 'super_admin' || isSuperAdmin).map(u => (
              <div key={u.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm font-bold">{u.name}</div>
                    <div className="text-[10px] text-slate-400">{u.email}</div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-[10px] text-slate-500">Greeter</span>
                    <input type="checkbox" checked={u.greeter_enabled !== false}
                      onChange={async (e) => {
                        try {
                          await supabase.from('users').update({ greeter_enabled: e.target.checked }).eq('id', u.id);
                          onReload();
                        } catch(err) { if (toast) toast.error(err.message); }
                      }}
                      className="w-4 h-4 rounded" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Personality</label>
                    <select value={u.greeter_personality || 'friendly'}
                      onChange={async (e) => {
                        try {
                          await supabase.from('users').update({ greeter_personality: e.target.value }).eq('id', u.id);
                          onReload();
                          if (toast) toast.success('Personality updated for ' + u.name);
                        } catch(err) { if (toast) toast.error(err.message); }
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs">
                      {(PERSONALITIES || []).map(p => (
                        <option key={p.id} value={p.id}>{p.label} — {p.desc}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Language</label>
                    <select value={u.greeter_language || 'en'}
                      onChange={async (e) => {
                        try {
                          await supabase.from('users').update({ greeter_language: e.target.value }).eq('id', u.id);
                          onReload();
                          if (toast) toast.success('Language updated for ' + u.name);
                        } catch(err) { if (toast) toast.error(err.message); }
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs">
                      <option value="en">🇺🇸 English</option>
                      <option value="ar">🇪🇬 Arabic / عربي</option>
                    </select>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-slate-400">
                  Current: {(PERSONALITIES || []).find(p => p.id === (u.greeter_personality || 'friendly'))?.label || 'Friendly'} · {u.greeter_language === 'ar' ? 'Arabic' : 'English'}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
            <div className="text-xs font-bold text-indigo-700 mb-2">Personality Types</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {(PERSONALITIES || []).map(p => (
                <div key={p.id} className="bg-white rounded-lg p-3 border border-indigo-100">
                  <div className="text-sm font-bold">{p.label}</div>
                  <div className="text-[10px] text-slate-500">{p.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {section === 'categories' && (
        <div className="bg-white rounded-xl p-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-sm font-bold">🏷️ Manage Categories & Subcategories</h3>
              <p className="text-[10px] text-slate-400">Add, view, and organize income & expense categories. New categories appear in all dropdowns immediately.</p>
            </div>
          </div>
          {/* Add New Category */}
          <div className="bg-blue-50 rounded-lg p-3 mb-4 border border-blue-200">
            <div className="text-xs font-bold text-blue-700 mb-2">+ Add New Category</div>
            <div className="flex gap-2 items-end flex-wrap">
              <div>
                <label className="text-[9px] text-slate-500">Arabic Name</label>
                <input value={f.newCatAr || ''} onChange={e => setF({...f, newCatAr: e.target.value})}
                  placeholder="e.g. مصروفات جديدة" className="px-2 py-1.5 border rounded text-xs w-40" style={{direction:'rtl'}} />
              </div>
              <div>
                <label className="text-[9px] text-slate-500">English Name</label>
                <input value={f.newCatEn || ''} onChange={e => setF({...f, newCatEn: e.target.value})}
                  placeholder="e.g. New Expenses" className="px-2 py-1.5 border rounded text-xs w-40" />
              </div>
              <div>
                <label className="text-[9px] text-slate-500">Type</label>
                <select value={f.newCatType || 'expense'} onChange={e => setF({...f, newCatType: e.target.value})}
                  className="px-2 py-1.5 border rounded text-xs">
                  <option value="expense">Expense / منصرفات</option>
                  <option value="income">Income / إيرادات</option>
                </select>
              </div>
              <button onClick={async () => {
                const ar = (f.newCatAr || '').trim();
                const en = (f.newCatEn || '').trim();
                if (!ar && !en) { alert('Enter a category name'); return; }
                const catName = ar || en;
                try {
                  // Create a rule with this category so it persists
                  await dbInsert('expense_rules', {
                    description_match: '__CATEGORY__' + catName,
                    category: catName,
                    subcategory: '',
                    rule_type: f.newCatType || 'expense',
                  }, user?.id);
                  setF({...f, newCatAr: '', newCatEn: ''});
                  loadPrefs();
                  alert('Category "' + catName + '" added! It will now appear in all dropdowns.');
                } catch(err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
              }} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-bold">+ Add</button>
            </div>
          </div>
          {/* Add New Subcategory */}
          <div className="bg-orange-50 rounded-lg p-3 mb-4 border border-orange-200">
            <div className="text-xs font-bold text-orange-700 mb-2">+ Add New Subcategory</div>
            <div className="flex gap-2 items-end flex-wrap">
              <div>
                <label className="text-[9px] text-slate-500">Parent Category</label>
                <select value={f.subParent || ''} onChange={e => setF({...f, subParent: e.target.value})}
                  className="px-2 py-1.5 border rounded text-xs w-40">
                  <option value="">Select...</option>
                  {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en} / {ar}</option>)}
                  {[...new Set(rules.map(r => r.category).filter(c => c && !EXPENSE_CATS[c] && !c.startsWith('__')))].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-slate-500">Subcategory Name</label>
                <input value={f.newSubName || ''} onChange={e => setF({...f, newSubName: e.target.value})}
                  placeholder="e.g. Fuel, Office..." className="px-2 py-1.5 border rounded text-xs w-40" />
              </div>
              <button onClick={async () => {
                if (!f.subParent || !f.newSubName?.trim()) { alert('Select parent category and enter subcategory name'); return; }
                try {
                  await dbInsert('expense_rules', {
                    description_match: '__SUBCAT__' + f.newSubName.trim(),
                    category: f.subParent,
                    subcategory: f.newSubName.trim(),
                    rule_type: 'expense',
                  }, user?.id);
                  setF({...f, newSubName: ''});
                  loadPrefs();
                  alert('Subcategory "' + f.newSubName.trim() + '" added under ' + f.subParent);
                } catch(err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
              }} className="px-3 py-1.5 bg-orange-500 text-white rounded text-xs font-bold">+ Add</button>
            </div>
          </div>
          {/* Current Categories */}
          <div>
            <h4 className="text-xs font-bold mb-2">Current Categories</h4>
            {(() => {
              // Build category map from EXPENSE_CATS + rules + treasury
              const allCats = {};
              Object.entries(EXPENSE_CATS).forEach(([ar, en]) => {
                allCats[ar] = { en, type: 'built-in', subcats: new Set() };
              });
              rules.forEach(r => {
                if (r.category && !allCats[r.category]) allCats[r.category] = { en: r.category, type: r.rule_type || 'expense', subcats: new Set() };
                if (r.subcategory && allCats[r.category]) allCats[r.category].subcats.add(r.subcategory);
              });
              // Get subcats from treasury data via expDescs
              expDescs.forEach(d => {
                if (d.category && allCats[d.category] && d.subcategory) allCats[d.category].subcats.add(d.subcategory);
              });
              return Object.entries(allCats).sort((a,b) => a[0].localeCompare(b[0])).map(([cat, data]) => (
                <div key={cat} className="border-b border-slate-100 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{data.en !== cat ? data.en + ' / ' : ''}{cat}</span>
                      <span className={'text-[9px] px-1.5 py-0.5 rounded-full ' + (data.type === 'built-in' ? 'bg-slate-100 text-slate-500' : data.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500')}>
                        {data.type === 'built-in' ? 'System' : data.type}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400">{data.subcats.size} subcategories</span>
                  </div>
                  {data.subcats.size > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap pl-4">
                      {[...data.subcats].sort().map(sub => (
                        <span key={sub} className="text-[9px] px-2 py-0.5 bg-orange-50 text-orange-600 rounded border border-orange-200">{sub}</span>
                      ))}
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ===== CATEGORY RULES ===== */}
      {section === 'rules' && (
        <div>
          {['expense', 'income'].map(ruleType => {
            const typeRules = rules.filter(r => ruleType === 'expense' ? (!r.rule_type || r.rule_type === 'expense') : r.rule_type === 'income');
            const isIncome = ruleType === 'income';
            return (
              <div key={ruleType} className="bg-white rounded-xl p-4 mb-3">
                <h3 className="text-sm font-bold mb-2">{isIncome ? '💰 Income Rules / قواعد الإيرادات' : '📤 Expense Rules / قواعد المصروفات'} ({typeRules.length})</h3>
                <p className="text-xs text-slate-500 mb-3">{isIncome ? 'Auto-categorize cash-in transactions' : 'Auto-categorize cash-out transactions'}. Rules apply on import and manual entry. Created automatically when you categorize transactions.</p>
                {typeRules.length > 0 ? (
                  <div className="overflow-auto max-h-[400px]">
                    <table className="w-full border-collapse text-xs">
                      <thead><tr className={isIncome ? 'bg-emerald-50' : 'bg-slate-50'}>
                        <th className="px-3 py-2 text-left">Description Match / الوصف</th>
                        <th className="px-3 py-2 text-left">Category / التصنيف</th>
                        <th className="px-3 py-2 text-left">Subcategory / فرعي</th>
                        <th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody>
                        {typeRules.map(r => (
                          <tr key={r.id} className="border-b border-slate-50">
                            <td className="px-3 py-2 font-semibold" style={{direction:'rtl', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.description_match}</td>
                            <td className="px-3 py-2">
                              <select defaultValue={r.category || ''} onChange={async (e) => {
                                try {
                                  await dbUpdate('expense_rules', r.id, { category: e.target.value }, user?.id);
                                  loadPrefs();
                                } catch(err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                              }} className={'text-xs border rounded px-1 py-0.5 w-full ' + (isIncome ? 'bg-emerald-50' : 'bg-amber-50')}>
                                <option value="">None</option>
                                {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input defaultValue={r.subcategory || ''} onBlur={async (e) => {
                                if (e.target.value !== (r.subcategory || '')) {
                                  try {
                                    await dbUpdate('expense_rules', r.id, { subcategory: e.target.value }, user?.id);
                                    loadPrefs();
                                  } catch(err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                                }
                              }} className="text-xs border rounded px-1 py-0.5 bg-orange-50 w-full" />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <button onClick={async () => {
                                  if (!confirm('Reverse this rule? All matching transactions will be reset to Uncategorized.\n\nعكس هذه القاعدة؟')) return;
                                  try {
                                    const { data: matching } = await supabase.from('treasury').select('id').eq('category', r.category).ilike('description', r.description_match);
                                    for (const t of (matching || [])) {
                                      await dbUpdate('treasury', t.id, { category: '', subcategory: '' }, user?.id);
                                    }
                                    alert('Reversed ' + (matching || []).length + ' transactions');
                                    onReload();
                                  } catch(err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                                }} className="px-2 py-0.5 rounded border border-amber-300 text-amber-600 text-[10px] hover:bg-amber-50">Reverse</button>
                                <button onClick={async () => {
                                  if (!confirm('Delete this rule?\nحذف هذه القاعدة؟')) return;
                                  try {
                                    await supabase.from('expense_rules').delete().eq('id', r.id);
                                    loadPrefs();
                                  } catch(err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                                }} className="px-2 py-0.5 rounded border border-red-300 text-red-600 text-[10px] hover:bg-red-50">Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-slate-400 py-4 text-xs">No {ruleType} rules yet. Rules are created when you categorize {isIncome ? 'income' : 'expense'} transactions.</div>
                )}
              </div>
            );
          })}

          {/* Auto-Categorize Button */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
            <h3 className="text-sm font-bold text-blue-800 mb-1">🔄 Retroactive Auto-Categorization</h3>
            <p className="text-[10px] text-blue-600 mb-3">Apply all rules to uncategorized treasury entries. Runs automatically every 24 hours via Vercel Cron, or click below to run now.</p>
            <button onClick={async () => {
              try {
                const res = await fetch('/api/categorize', { method: 'POST' });
                const data = await res.json();
                alert('Auto-categorization complete!\n\nApplied: ' + (data.applied || 0) + ' entries\nTotal uncategorized: ' + (data.total_uncategorized || 0) + '\nRules used: ' + (data.total_rules || 0));
                onReload();
              } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
            }} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition">
              ▶ Run Now / تشغيل الآن
            </button>
          </div>
        </div>
      )}

      {/* ===== EXPENSE DESCRIPTIONS ===== */}
      {section === 'expenses' && (
        <div>
          <div className="bg-white rounded-xl p-4 mb-3">
            <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
              <div>
                <h3 className="text-sm font-bold">📋 Expense Descriptions ({expDescs.length} unique)</h3>
                <p className="text-[10px] text-slate-400">Every unique expense description. Update category/subcategory here — changes apply to ALL matching treasury entries and create rules for future entries.</p>
              </div>
              <div className="flex gap-2 items-center">
                <input value={expSearch} onChange={e => setExpSearch(e.target.value)} placeholder="Search..."
                  className="px-3 py-1.5 rounded-lg border text-xs w-32" />
                <select value={expCatFilter} onChange={e => setExpCatFilter(e.target.value)} className="px-2 py-1.5 rounded border text-xs">
                  <option value="all">All Categories</option>
                  <option value="uncategorized">⚠️ Uncategorized</option>
                  {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                </select>
                {!mergeMode ? (
                  <button onClick={() => { setMergeMode(true); setMergeTargets([]); }}
                    className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-bold">🔀 Merge</button>
                ) : (
                  <div className="flex gap-1">
                    <span className="text-xs text-purple-600 font-bold self-center">Select items to merge ({mergeTargets.length})</span>
                    <button onClick={() => { setMergeMode(null); setMergeTargets([]); }}
                      className="px-2 py-1 border border-slate-200 rounded text-xs">Cancel</button>
                  </div>
                )}
              </div>
            </div>

            {/* Merge bar */}
            {mergeMode && mergeTargets.length >= 2 && (
              <div className="bg-purple-50 rounded-lg p-3 mb-3 border border-purple-200">
                <div className="text-xs font-bold text-purple-800 mb-2">Merge {mergeTargets.length} descriptions into one:</div>
                <div className="text-[10px] text-purple-600 mb-2 space-y-0.5">
                  {mergeTargets.map((d, i) => <div key={i}>• {d} <button onClick={() => setMergeTargets(mergeTargets.filter(t => t !== d))} className="text-red-500 ml-1">✕</button></div>)}
                </div>
                <div className="flex gap-2 items-center">
                  <input id="merge-name" defaultValue={mergeTargets[0]} placeholder="Final description name..."
                    className="flex-1 px-3 py-2 rounded border text-sm" style={{ direction: 'rtl' }} />
                  <button onClick={async () => {
                    const newName = document.getElementById('merge-name')?.value?.trim();
                    if (!newName) return;
                    if (!confirm('Merge ' + mergeTargets.length + ' descriptions into:\n\n"' + newName + '"\n\nThis will rename ALL treasury entries matching these descriptions. Continue?')) return;
                    try {
                      for (const desc of mergeTargets) {
                        if (desc === newName) continue;
                        // Batch update — single query per description
                        await supabase.from('treasury').update({ description: newName }).eq('description', desc);
                        await supabase.from('expense_rules').delete().eq('description_match', desc);
                      }
                      alert('Merged ' + mergeTargets.length + ' descriptions into "' + newName + '"');
                      setMergeMode(null); setMergeTargets([]); setTimeout(() => { loadPrefs(); onReload(); }, 800);
                    } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                  }} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold">
                    ✅ Merge All
                  </button>
                </div>
              </div>
            )}

            {/* Description list */}
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10"><tr className="bg-slate-50">
                  {mergeMode && <th className="px-2 py-2 w-8"></th>}
                  <th className="px-3 py-2 text-left">Description / الوصف</th>
                  <th className="px-3 py-2 text-center w-16">Count</th>
                  <th className="px-3 py-2 text-right w-24">Total</th>
                  <th className="px-3 py-2 text-left w-36">Category</th>
                  <th className="px-3 py-2 text-left w-36">Subcategory</th>
                </tr></thead>
                <tbody>
                  {expDescs
                    .filter(d => {
                      if (expSearch && !(d.description || '').includes(expSearch) && !(d.description || '').toLowerCase().includes(expSearch.toLowerCase())) return false;
                      if (expCatFilter === 'uncategorized' && d.category) return false;
                      if (expCatFilter !== 'all' && expCatFilter !== 'uncategorized' && d.category !== expCatFilter) return false;
                      return true;
                    })
                    .map(d => (
                      <tr key={d.description} className={'border-b border-slate-50 hover:bg-slate-50 ' + (mergeTargets.includes(d.description) ? 'bg-purple-50' : '')}>
                        {mergeMode && (
                          <td className="px-2 py-2 text-center">
                            <input type="checkbox" checked={mergeTargets.includes(d.description)}
                              onChange={() => {
                                if (mergeTargets.includes(d.description)) setMergeTargets(mergeTargets.filter(t => t !== d.description));
                                else setMergeTargets([...mergeTargets, d.description]);
                              }} className="w-4 h-4" />
                          </td>
                        )}
                        <td className="px-3 py-2 font-semibold" style={{ direction: 'rtl', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.description}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-500">{d.count}</td>
                        <td className="px-3 py-2 text-right font-bold text-purple-600">{Number(d.total).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <select defaultValue={d.category || ''} key={d.description + '-cat-' + d.category}
                            onChange={async (e) => {
                              const newCat = e.target.value;
                              try {
                                // Single batch update
                                await supabase.from('treasury').update({ category: newCat }).eq('description', d.description);
                                const existing = rules.find(r => r.description_match === d.description);
                                if (existing) await dbUpdate('expense_rules', existing.id, { category: newCat }, user?.id);
                                else await dbInsert('expense_rules', { description_match: d.description, category: newCat, subcategory: d.subcategory || '', rule_type: 'expense' }, user?.id);
                                setTimeout(() => { loadPrefs(); onReload(); }, 800);
                              } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                            }}
                            className="w-full text-[10px] border rounded px-1 py-1 bg-amber-50">
                            <option value="">Uncategorized</option>
                            {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input defaultValue={d.subcategory || ''} key={d.description + '-sub-' + d.subcategory} placeholder="Subcategory..."
                            onBlur={async (e) => {
                              const newSub = e.target.value.trim();
                              if (newSub === (d.subcategory || '')) return;
                              try {
                                // Single batch update
                                await supabase.from('treasury').update({ subcategory: newSub }).eq('description', d.description);
                                const existing = rules.find(r => r.description_match === d.description);
                                if (existing) await dbUpdate('expense_rules', existing.id, { subcategory: newSub }, user?.id);
                                else await dbInsert('expense_rules', { description_match: d.description, category: d.category || '', subcategory: newSub, rule_type: 'expense' }, user?.id);
                                setTimeout(() => { loadPrefs(); onReload(); }, 800);
                              } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
                            }}
                            className="w-full text-[10px] border rounded px-1 py-1 bg-orange-50" />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px] text-slate-400">
              Showing {expDescs.filter(d => {
                if (expSearch && !(d.description || '').includes(expSearch) && !(d.description || '').toLowerCase().includes(expSearch.toLowerCase())) return false;
                if (expCatFilter === 'uncategorized' && d.category) return false;
                if (expCatFilter !== 'all' && expCatFilter !== 'uncategorized' && d.category !== expCatFilter) return false;
                return true;
              }).length} of {expDescs.length} descriptions
            </div>
          </div>
        </div>
      )}

      {/* ===== TRANSLATION ===== */}
      {section === 'translation' && (
        <TranslationPanel user={user} users={users} isAdmin={isAdmin} />
      )}
    </div>
  );
}
