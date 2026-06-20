'use client';
// AccountingVisibilityPanel — v55.83-JQ. SUPER-ADMIN admin tool: control how far back NORMAL users may
// see accounting history (Bank Review, Bank tab, Invoices, Open Accounts, Customer Ledger, Customer AR
// History). Super-admins ALWAYS see all stored history (this never restricts them). Reads/writes via the
// service-role route /api/admin/visibility. The panel proves the setting actually persists (it re-reads
// after every save) and tells the admin exactly what to do if the backing table isn't set up yet.
import { useState, useEffect } from 'react';
import { WINDOW_OPTIONS, labelForWindow, floorDateFor } from '../lib/visibility-window';

export default function AccountingVisibilityPanel({ userProfile, toast }) {
  var [win, setWin] = useState('all');
  var [customDays, setCustomDays] = useState('');
  var [customFrom, setCustomFrom] = useState('');
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);
  var [tableMissing, setTableMissing] = useState(false);
  var [updatedAt, setUpdatedAt] = useState(null);
  var [savedValue, setSavedValue] = useState(null);   // last value confirmed read-back from the server
  var [statusMsg, setStatusMsg] = useState(null);      // { ok, text } persistent inline confirmation

  function applyValue(v) {
    if (!v) { return; }
    setWin(v.window || 'all');
    setCustomDays(v.customDays != null ? String(v.customDays) : '');
    setCustomFrom(v.customFrom || '');
  }

  function refresh() {
    return fetch('/api/admin/visibility').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.value) { applyValue(j.value); setSavedValue(j.value); }
      setTableMissing(j && j.table_missing === true);
      setUpdatedAt(j && j.updated_at);
      return j;
    });
  }

  useEffect(function () {
    var alive = true;
    refresh().then(function () { if (alive) setLoading(false); }).catch(function () { if (alive) setLoading(false); });
    return function () { alive = false; };
  }, []);

  function save() {
    setSaving(true); setStatusMsg(null);
    var body = { window: win, user_id: userProfile && userProfile.id };
    if (win === 'custom') {
      if (customFrom) { body.customFrom = customFrom; }
      else { body.customDays = parseInt(customDays, 10); }
    }
    fetch('/api/admin/visibility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) {
          var em = (j && j.error) || 'Could not save';
          setStatusMsg({ ok: false, text: em });
          if (toast && toast.error) { toast.error(em); }
          return;
        }
        // VERIFY it persisted by reading it back from the server.
        return refresh().then(function (after) {
          var v = (after && after.value) || j.value;
          var persisted = v && v.window === win && (win !== 'custom' || (String(v.customDays || '') === String(body.customDays || '') && (v.customFrom || '') === (body.customFrom || '')));
          if (persisted) {
            setTableMissing(false);
            setStatusMsg({ ok: true, text: 'Saved & verified — your employees now see ' + labelForWindow(win, body.customDays) + '. You (super admin) still see everything.' });
            if (toast && toast.success) { toast.success('Visibility window saved & verified'); }
          } else {
            setStatusMsg({ ok: false, text: 'Saved but the value did not read back the same — the database may not be persisting it. Run the SQL below and try again.' });
          }
        });
      })
      .catch(function (e) { setStatusMsg({ ok: false, text: 'Could not save: ' + ((e && e.message) || 'error') }); })
      .finally(function () { setSaving(false); });
  }

  if (loading) { return <div className="bg-white rounded-xl p-5 max-w-2xl text-slate-500">Loading visibility settings…</div>; }

  var active = !tableMissing;

  return (
    <div className="bg-white rounded-xl p-5 max-w-2xl">
      <h3 className="text-lg font-bold mb-1">📅 Accounting History Visibility — Admin Control</h3>
      <p className="text-[13px] text-slate-600 mb-3">You decide how far back <b>normal employees</b> can see invoices, AR, customer ledgers, bank transactions and open accounts. <b>You (super admin) always see ALL history</b> — this never limits you.</p>

      {/* SETUP STATUS — the #1 thing that makes this "not work" is the backing table not existing. */}
      {active ? (
        <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-[12px] text-emerald-900">
          ✅ <b>Active.</b> Saving works and applies to employees immediately. Currently employees see: <b>{savedValue ? labelForWindow(savedValue.window, savedValue.customDays) : 'all history'}</b>{updatedAt ? <span className="text-emerald-700"> · last changed {String(updatedAt).substring(0, 10)}</span> : null}.
        </div>
      ) : (
        <div className="mb-3 p-3 rounded-lg bg-rose-50 border border-rose-400 text-[12px] text-rose-900">
          ⛔ <b>NOT ACTIVE YET — one-time setup needed.</b> The settings table doesn't exist on the database, so this control can't save and <b>everyone still sees all history</b>. Fix it once: open Supabase → SQL Editor → run <code className="bg-rose-100 px-1 rounded font-bold">sql/v55-83-JE-visibility-window.sql</code>, then click Save below. (It changes no data — it just creates the settings table.)
        </div>
      )}

      <div className="text-[12px] text-slate-600 mb-4 bg-slate-50 border border-slate-200 rounded p-2">
        <b>Applies to:</b> Bank Review, Bank tab, Invoices, Open Accounts, Customer Ledger, Customer AR History.<br/>
        <span className="text-slate-500">Ledgers/AR keep all-time <b>balances &amp; aging</b> (correct math); only the older <b>line/statement rows</b> are hidden from employees.</span>
      </div>

      <label className="block text-sm font-bold mb-1">Employees can see history for</label>
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

      {/* v55.83-JZ — employee-preview: show the EXACT cutoff date employees are limited to, so the super
          admin can verify the staff window without switching accounts. */}
      {(function () {
        var f = floorDateFor({ window: win, customDays: (win === 'custom' && !customFrom) ? parseInt(customDays, 10) : null, customFrom: (win === 'custom' && customFrom) ? customFrom : null, isSuperAdmin: false }, new Date());
        return (
          <div className="mb-3 text-[12px] text-slate-700 bg-blue-50 border border-blue-200 rounded p-2">
            👁 <b>Employee preview:</b> with this setting, a normal employee will see accounting history {f ? <span>dated <b>on or after {f}</b> (older invoices/AR/ledger/bank rows hidden from them).</span> : <span><b>all the way back</b> (no restriction).</span>} You always see everything.
          </div>
        );
      })()}

      <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm font-bold">{saving ? 'Saving & verifying…' : 'Save & apply to employees'}</button>

      {statusMsg && (
        <div className={'mt-3 p-2 rounded text-[12px] font-semibold ' + (statusMsg.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900')}>
          {statusMsg.ok ? '✅ ' : '⛔ '}{statusMsg.text}
        </div>
      )}

      <div className="mt-4 text-[11px] text-slate-500">
        Every accounting screen shows a “Visibility” chip with the active window and cutoff date, so staff always know what they are (and aren’t) seeing.
      </div>
    </div>
  );
}
