'use client';
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

const ROLES = [
  { v: 'super_admin', l: '🔴 Super Admin', c: 'text-red-500' },
  { v: 'admin', l: '🟣 Admin/Manager', c: 'text-purple-500' },
  { v: 'team', l: '🔵 Team Member', c: 'text-blue-500' },
  { v: 'viewer', l: '⚪ Viewer', c: 'text-slate-500' },
];

const MODULES = [
  'Dashboard', 'Sales', 'Customers', 'Treasury', 'Checks', 'Debts',
  'Warehouse', 'Inventory', 'CRM', 'Tickets', 'Calendar', 'Customs',
  'Daily Log', 'Admin', 'Settings', 'Import'
];

const NOTIF_TYPES = [
  { v: 'ticket_assigned', l: 'Ticket Assigned / تعيين تذكرة' },
  { v: 'status_changed', l: 'Status Changed / تغيير حالة' },
  { v: 'event_scheduled', l: 'Event Scheduled / حدث مجدول' },
  { v: 'followup_created', l: 'Follow-up Created / متابعة جديدة' },
  { v: 'overdue_digest', l: 'Overdue Digest / تنبيه متأخر' },
  { v: 'daily_reminder', l: 'Daily Log Reminder / تذكير يومي' },
];

export default function SettingsTab({ user, users, onReload }) {
  const [section, setSection] = useState('roles');
  const [showAddMember, setShowAddMember] = useState(false);
  const [f, setF] = useState({});
  const [permissions, setPermissions] = useState({});
  const [notifPrefs, setNotifPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    const [perms, notifs] = await Promise.all([
      supabase.from('module_permissions').select('*'),
      supabase.from('notification_prefs').select('*'),
    ]);
    // Build permission map: {userId: {module: boolean}}
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
    setLoaded(true);
  };

  const togglePermission = async (userId, module) => {
    const current = permissions[userId]?.[module] ?? true;
    const newVal = !current;
    try {
      const { data: existing } = await supabase.from('module_permissions')
        .select('id').eq('user_id', userId).eq('module_name', module).single();
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

  const handleAddMember = async () => {
    if (!f.name || !f.email) return;
    try {
      await dbInsert('users', {
        name: f.name, name_ar: f.nameAr || '', email: f.email,
        role: f.role || 'team', reports_to: f.reportsTo || null,
      }, user?.id);
      setShowAddMember(false); setF({});
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const updateRole = async (userId, newRole) => {
    try {
      await dbUpdate('users', userId, { role: newRole }, user?.id);
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const updateReportsTo = async (userId, reportsToId) => {
    try {
      await dbUpdate('users', userId, { reports_to: reportsToId || null }, user?.id);
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const nonSuperUsers = (users || []).filter(u => u.role !== 'super_admin');

  return (
    <div>
      <h2 className="text-xl font-extrabold mb-3">Settings / إعدادات</h2>

      {/* Section Tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {[['roles', 'Team & Roles'], ['permissions', 'Module Access'], ['notifications', 'Notifications']].map(([v, l]) => (
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
          <button onClick={() => { setShowAddMember(true); setF({}); }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold mb-3">+ Add Member / إضافة عضو</button>

          {showAddMember && (
            <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
              <h3 className="text-sm font-bold text-blue-800 mb-3">New Team Member</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold">Name</label>
                  <input value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Name (Arabic)</label>
                  <input value={f.nameAr || ''} onChange={e => setF({ ...f, nameAr: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" style={{ direction: 'rtl' }} /></div>
                <div><label className="text-[10px] font-semibold">Email</label>
                  <input type="email" value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Role</label>
                  <select value={f.role || 'team'} onChange={e => setF({ ...f, role: e.target.value })} className="w-full px-3 py-2 rounded border text-sm">
                    {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-semibold">Reports To</label>
                  <select value={f.reportsTo || ''} onChange={e => setF({ ...f, reportsTo: e.target.value })} className="w-full px-3 py-2 rounded border text-sm">
                    <option value="">None (Top Level)</option>
                    {(users || []).filter(u => u.role === 'super_admin' || u.role === 'admin').map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select></div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAddMember} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Save / حفظ</button>
                <button onClick={() => setShowAddMember(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          )}

          {/* Team Members List */}
          <div className="space-y-2">
            {(users || []).map(u => {
              const roleInfo = ROLES.find(r => r.v === u.role) || ROLES[2];
              const reportsToUser = users?.find(m => m.id === u.reports_to);
              return (
                <div key={u.id} className="bg-white rounded-xl p-4 border border-slate-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-bold">{u.name}</div>
                      {u.name_ar && <div className="text-xs text-slate-500" style={{ direction: 'rtl' }}>{u.name_ar}</div>}
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </div>
                    <span className={'text-xs font-bold ' + roleInfo.c}>{roleInfo.l}</span>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    <select value={u.role} onChange={e => updateRole(u.id, e.target.value)}
                      className="px-2 py-1 rounded border border-slate-200 text-[10px]">
                      {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                    </select>
                    <select value={u.reports_to || ''} onChange={e => updateReportsTo(u.id, e.target.value)}
                      className="px-2 py-1 rounded border border-slate-200 text-[10px]">
                      <option value="">Reports to: None</option>
                      {(users || []).filter(m => m.id !== u.id).map(m => (
                        <option key={m.id} value={m.id}>Reports to: {m.name}</option>
                      ))}
                    </select>
                    {reportsToUser && <span className="text-[10px] text-slate-400">→ {reportsToUser.name}</span>}
                  </div>
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
                <th className="px-2 py-1.5 text-left text-[10px] font-bold">Module</th>
                {nonSuperUsers.map(u => (
                  <th key={u.id} className="px-2 py-1.5 text-center text-[10px] font-bold">{u.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map(mod => (
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
    </div>
  );
}
