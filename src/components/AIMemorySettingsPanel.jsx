'use client';
import { useState, useEffect } from 'react';

// Super-admin-only panel. Renders nothing for non-super-admin.
// Drop this into SettingsTab (or anywhere else in the admin area).
export default function AIMemorySettingsPanel({ userProfile, toast }) {
  const isSuperAdmin = userProfile && (userProfile.role === 'super_admin' || userProfile.role === 'superadmin' || userProfile.role === 'owner');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin || !userProfile?.id) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/memory?settings=1&userId=' + userProfile.id);
        const data = await r.json();
        if (data.settings) setSettings(data.settings);
      } catch (e) {}
      setLoading(false);
    })();
  }, [isSuperAdmin, userProfile?.id]);

  const loadAllItems = async () => {
    if (!isSuperAdmin) return;
    setItemsLoading(true);
    try {
      const r = await fetch('/api/memory?all=1&userId=' + userProfile.id);
      const data = await r.json();
      setAllItems(data.items || []);
    } catch (e) {}
    setItemsLoading(false);
  };

  const saveSettings = async () => {
    if (!isSuperAdmin || !settings) return;
    setSaving(true);
    try {
      const r = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'save_settings', userId: userProfile.id, settings: settings }),
      });
      const data = await r.json();
      if (data.ok) {
        if (toast && toast.success) toast.success('AI memory settings saved ✓');
      } else {
        if (toast && toast.error) toast.error(data.error || 'Save failed');
      }
    } catch (e) {
      if (toast && toast.error) toast.error(e.message);
    }
    setSaving(false);
  };

  const dismissItem = async (id) => {
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'dismiss', id: id, userId: userProfile.id }),
      });
      setAllItems(prev => prev.filter(x => x.id !== id));
      if (toast && toast.success) toast.success('Item dismissed');
    } catch (e) {}
  };

  if (!isSuperAdmin) return null;
  if (loading) return <div className="p-4 text-sm text-slate-500">Loading AI memory settings…</div>;
  if (!settings) return <div className="p-4 text-sm text-red-500">Could not load AI memory settings.</div>;

  const toggle = (k) => setSettings({ ...settings, [k]: !settings[k] });

  return (
    <div className="bg-white rounded-xl p-5 mb-4 border border-indigo-200" style={{boxShadow:'0 2px 8px rgba(79,70,229,0.1)'}}>
      <div className="flex justify-between items-center mb-3">
        <div>
          <h3 className="text-base font-extrabold text-indigo-800">🧠 AI Memory Settings</h3>
          <p className="text-xs text-slate-500">Super-admin only. Controls how the AI remembers things for every employee.</p>
        </div>
        <button onClick={saveSettings} disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{background: saving ? '#94a3b8' : '#4f46e5', color: '#fff'}}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!settings.auto_capture_enabled} onChange={() => toggle('auto_capture_enabled')} />
            <span className="text-sm font-bold text-indigo-900">Auto-capture from conversations</span>
          </label>
          <p className="text-[10px] text-slate-500 mt-1 ml-6">When on, the AI passively extracts memory items from what employees say. No "remember this" prefix needed.</p>
        </div>

        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <div className="text-xs font-bold text-slate-700 mb-1.5">What to auto-capture:</div>
          {[
            { k: 'capture_urgent', l: '🚨 Urgent items' },
            { k: 'capture_meetings', l: '📅 Meetings' },
            { k: 'capture_reminders', l: '⏰ Reminders' },
            { k: 'capture_follow_ups', l: '🔁 Follow-ups' },
            { k: 'capture_notes', l: '📝 General notes' },
          ].map(x => (
            <label key={x.k} className="flex items-center gap-2 cursor-pointer py-0.5">
              <input type="checkbox" checked={!!settings[x.k]} onChange={() => toggle(x.k)} disabled={!settings.auto_capture_enabled} />
              <span className={'text-xs ' + (settings.auto_capture_enabled ? 'text-slate-700' : 'text-slate-400')}>{x.l}</span>
            </label>
          ))}
        </div>

        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <label className="text-xs font-bold text-slate-700 block mb-1">Default note retention (days)</label>
          <input type="number" min="1" max="365" value={settings.default_note_retention_days || 30}
            onChange={e => setSettings({ ...settings, default_note_retention_days: Number(e.target.value) || 30 })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
          <p className="text-[10px] text-slate-500 mt-1">Notes auto-expire after this many days. Urgent items never auto-expire until dismissed.</p>
        </div>

        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <label className="text-xs font-bold text-slate-700 block mb-1">Cross-user read access</label>
          <select value={settings.cross_user_read || 'team_only'}
            onChange={e => setSettings({ ...settings, cross_user_read: e.target.value })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm">
            <option value="disabled">Disabled — employees only see their own items</option>
            <option value="team_only">Team only — employees can see items explicitly flagged for them</option>
            <option value="unrestricted">Unrestricted — AI can query across all employees</option>
          </select>
        </div>

        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!settings.morning_briefing_enabled} onChange={() => toggle('morning_briefing_enabled')} />
            <span className="text-sm font-bold text-slate-700">Morning briefing</span>
          </label>
          <p className="text-[10px] text-slate-500 mt-1 ml-6">First AI open of the day shows a summary card of urgent items, meetings, reminders.</p>
          <div className="ml-6 mt-1">
            <label className="text-[10px] text-slate-500">Briefing hour (local, 24h)</label>
            <input type="number" min="0" max="23" value={settings.briefing_hour_local || 8}
              onChange={e => setSettings({ ...settings, briefing_hour_local: Number(e.target.value) || 8 })}
              className="w-20 ml-2 px-2 py-1 border border-slate-200 rounded text-xs" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <label className="text-xs font-bold text-slate-700 block mb-1">Max memory items per user (soft cap)</label>
          <input type="number" min="50" max="2000" value={settings.max_memory_items_per_user || 500}
            onChange={e => setSettings({ ...settings, max_memory_items_per_user: Number(e.target.value) || 500 })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3 mt-3">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-sm font-extrabold text-indigo-800">All memory items (audit view)</h4>
          <button onClick={loadAllItems} className="text-xs text-indigo-600 font-bold hover:underline">
            {itemsLoading ? 'Loading…' : allItems.length > 0 ? 'Refresh' : 'Load all items'}
          </button>
        </div>
        {allItems.length > 0 && (
          <div className="max-h-[320px] overflow-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left">Type</th>
                  <th className="px-2 py-1.5 text-left">Content</th>
                  <th className="px-2 py-1.5 text-left">Owner</th>
                  <th className="px-2 py-1.5 text-left">Target</th>
                  <th className="px-2 py-1.5 text-left">Created</th>
                  <th className="px-2 py-1.5 text-left">Expires</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {allItems.map(it => (
                  <tr key={it.id} className="border-b border-slate-100">
                    <td className="px-2 py-1">
                      <span className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' +
                        (it.type === 'urgent' ? 'bg-red-100 text-red-800'
                          : it.type === 'meeting' ? 'bg-indigo-100 text-indigo-800'
                          : it.type === 'reminder' ? 'bg-amber-100 text-amber-800'
                          : it.type === 'follow_up' ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700')}>
                        {it.type}
                      </span>
                    </td>
                    <td className="px-2 py-1 max-w-[280px] truncate" title={it.content}>{it.content}</td>
                    <td className="px-2 py-1 text-slate-500 truncate max-w-[100px]" title={it.user_id}>{String(it.user_id || '').substring(0, 8)}…</td>
                    <td className="px-2 py-1 text-slate-500 truncate max-w-[100px]">{it.target_user_id ? String(it.target_user_id).substring(0, 8) + '…' : '—'}</td>
                    <td className="px-2 py-1 text-slate-500">{(it.created_at || '').substring(0, 10)}</td>
                    <td className="px-2 py-1 text-slate-500">{it.expires_at ? it.expires_at.substring(0, 10) : '—'}</td>
                    <td className="px-2 py-1">
                      <button onClick={() => dismissItem(it.id)} className="text-[10px] text-red-500 hover:underline">Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
