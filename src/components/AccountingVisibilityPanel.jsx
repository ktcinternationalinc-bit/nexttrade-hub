'use client';
// AccountingVisibilityPanel — v55.83-JE. SUPER-ADMIN control for how far back NORMAL users may see
// history (Bank Review, BankTab, Invoices, AR, Customer Ledger, Open Accounts). Super-admins always
// see all stored history. Reads/writes via the service-role route /api/admin/visibility.
import { useState, useEffect } from 'react';
import { WINDOW_OPTIONS, labelForWindow } from '../lib/visibility-window';

export default function AccountingVisibilityPanel({ userProfile, toast }) {
  var [win, setWin] = useState('all');
  var [customDays, setCustomDays] = useState('');
  var [customFrom, setCustomFrom] = useState('');
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);
  var [tableMissing, setTableMissing] = useState(false);
  var [updatedAt, setUpdatedAt] = useState(null);

  useEffect(function () {
    var alive = true;
    fetch('/api/admin/visibility').then(function (r) { return r.json(); }).then(function (j) {
      if (!alive) { return; }
      if (j && j.value) {
        setWin(j.value.window || 'all');
        setCustomDays(j.value.customDays != null ? String(j.value.customDays) : '');
        setCustomFrom(j.value.customFrom || '');
      }
      setTableMissing(j && j.table_missing === true);
      setUpdatedAt(j && j.updated_at);
      setLoading(false);
    }).catch(function () { if (alive) { setLoading(false); } });
    return function () { alive = false; };
  }, []);

  function save() {
    setSaving(true);
    var body = { window: win, user_id: userProfile && userProfile.id };
    if (win === 'custom') {
      if (customFrom) { body.customFrom = customFrom; }
      else { body.customDays = parseInt(customDays, 10); }
    }
    fetch('/api/admin/visibility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) { toast && toast.success ? toast.success('Saved — normal users now see: ' + labelForWindow(win, body.customDays)) : null; setTableMissing(false); }
        else { toast && toast.error ? toast.error((j && j.error) || 'Could not save') : null; }
      })
      .catch(function (e) { toast && toast.error ? toast.error('Could not save: ' + ((e && e.message) || 'error')) : null; })
      .finally(function () { setSaving(false); });
  }

  if (loading) { return <div className="bg-white rounded-xl p-5 max-w-2xl text-slate-500">Loading visibility settings…</div>; }

  return (
    <div className="bg-white rounded-xl p-5 max-w-2xl">
      <h3 className="text-lg font-bold mb-1">📅 Accounting History Visibility</h3>
      <p className="text-[13px] text-slate-600 mb-4">Controls how far back <b>normal users</b> can see history. You (super admin) always see <b>all</b> stored history regardless of this setting.</p>
      <div className="text-[12px] text-slate-600 mb-4 bg-slate-50 border border-slate-200 rounded p-2">
        <b>Enforced now:</b> Bank Review, Bank tab, Invoices, Open Accounts.<br/>
        <b>Coming next:</b> Customer Ledger &amp; Customer AR History still show full history (their balances/aging need older rows; the visible event list will be windowed in a follow-up).
      </div>

      {tableMissing && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-900">
          ⚠ The settings table is not set up yet. Run <code className="bg-amber-100 px-1 rounded">sql/v55-83-JE-visibility-window.sql</code> in Supabase, then save again. Until then, everyone sees all history.
        </div>
      )}

      <label className="block text-sm font-bold mb-1">Normal users can see</label>
      <select value={win} onChange={function (e) { setWin(e.target.value); }} className="w-full border border-slate-300 rounded px-2 py-2 text-sm mb-3">
        {WINDOW_OPTIONS.map(function (o) { return <option key={o.key} value={o.key}>{o.label}</option>; })}
      </select>

      {win === 'custom' && (
        <div className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div className="text-[12px] text-slate-600 mb-2">Pick <b>either</b> a number of days back, <b>or</b> an explicit start date.</div>
          <div className="flex gap-3 items-center flex-wrap">
            <label className="text-[12px]">Days back: <input type="number" min="1" value={customDays} onChange={function (e) { setCustomDays(e.target.value); setCustomFrom(''); }} className="w-24 border border-slate-300 rounded px-2 py-1 ml-1" /></label>
            <span className="text-slate-400 text-[12px]">or</span>
            <label className="text-[12px]">From date: <input type="date" value={customFrom} onChange={function (e) { setCustomFrom(e.target.value); setCustomDays(''); }} className="border border-slate-300 rounded px-2 py-1 ml-1" /></label>
          </div>
        </div>
      )}

      <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm font-bold">{saving ? 'Saving…' : 'Save visibility window'}</button>
      {updatedAt && <span className="ml-3 text-[11px] text-slate-400">Last changed {String(updatedAt).substring(0, 10)}</span>}

      <div className="mt-4 text-[11px] text-slate-500">
        Each accounting screen shows a “Visibility” chip with the active window and the cutoff date, so staff always know what they are (and aren’t) seeing.
      </div>
    </div>
  );
}
