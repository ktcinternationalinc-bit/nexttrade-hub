'use client';
// v55.83-AAH — ⚙ Work assignments (Max, 27 Nov: "a dashboard where the admin or the super admin can select specific people, users for
// each task"). Opened from the 📋 work feed header by an admin or the super admin. One row per feed task: who owns it (primary) and a
// backup. The server checks the role again on every save and records it on the audit trail. Assigning never gives anyone access:
// when the chosen person's switches do not already show that task, the row says so in plain words.
import React, { useEffect, useState } from 'react';
import { hubFetch } from '../lib/hub-fetch';

var BG = '#000000'; var PANEL = '#0b0b0b'; var LINE = '#2a2a2a'; var INK = '#fafafa'; var SUB = '#a3a3a3'; var AMBER = '#f59e0b'; var GREEN = '#22c55e'; var RED = '#dc2626';

export function rowWarning(task, person, role) {
  if (!person) { return ''; }
  if (person.sees && person.sees[task.key] === false) { return '⚠ ' + person.name + ' cannot see these yet — needs ' + (task.needs || 'the matching switch') + '. Assigning does not give access; switch it on in Settings first.'; }
  return '';
}

export default function WorkAssignmentsPanel(props) {
  var me = props.userProfile && props.userProfile.id;
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];      // GET answer
  var s2 = useState({}); var draft = s2[0]; var setDraft = s2[1];      // { taskKey: { primary, backup } }
  var s3 = useState(''); var msg = s3[0]; var setMsg = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(''); var err = s5[0]; var setErr = s5[1];

  function load() {
    setBusy(true); setErr(''); setMsg('');
    hubFetch('/api/work-feed/assignments', { method: 'GET' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) { setErr((j && j.error) || 'Could not load the assignments.'); return; }
      if (!j.can_edit) { setErr('Only an admin or the super admin can assign work.'); return; }
      setData(j); setDraft(JSON.parse(JSON.stringify(j.tasks || {})));
    }).catch(function () { setErr('Could not reach the Hub. Try again.'); }).finally(function () { setBusy(false); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setPick(key, field, val) {
    setMsg('');
    setDraft(function (d) { var n = Object.assign({}, d); var row = Object.assign({ primary: null, backup: null }, n[key] || {}); row[field] = val || null; if (field === 'primary' && row.backup === row.primary) { row.backup = null; } n[key] = row; return n; });
  }
  function save() {
    if (!data) { return; }
    setBusy(true); setErr(''); setMsg('');
    hubFetch('/api/work-feed/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: me, tasks: draft, expected_at: data.at || null }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) { setErr((j && j.error) || 'Not saved.'); return; }
        setData(Object.assign({}, data, { tasks: j.tasks, at: j.at, by_name: j.by_name })); setDraft(JSON.parse(JSON.stringify(j.tasks || {})));
        setMsg('✓ Saved. Each person sees their tasks marked YOURS in their work feed.');
        if (props.onSaved) { props.onSaved(); }
      }).catch(function () { setErr('Could not reach the Hub — it may or may not have saved. Press ↻ to check before saving again.'); }).finally(function () { setBusy(false); });
  }

  var people = (data && data.people) || []; var byId = {}; people.forEach(function (p) { byId[p.id] = p; });
  var catalog = (data && data.catalog) || [];
  var changed = data && JSON.stringify(draft) !== JSON.stringify(data.tasks || {});
  var sel = { background: '#111111', color: INK, border: '1px solid #525252', borderRadius: 0, padding: '4px 6px', fontSize: 12, width: 230 };
  function picker(t, field) {
    var cur = (draft[t.key] || {})[field] || '';
    return <select aria-label={(field === 'primary' ? 'Owner' : 'Backup') + ' for ' + t.label} value={cur} onChange={function (e) { setPick(t.key, field, e.target.value); }} style={sel} disabled={busy}>
      <option value="">{field === 'primary' ? '— nobody —' : '— no backup —'}</option>
      {people.filter(function (p) { return field !== 'backup' || p.id !== (draft[t.key] || {}).primary; }).map(function (p) { return <option key={p.id} value={p.id}>{p.name + (p.sees && p.sees[t.key] === false ? '  (cannot see these)' : '')}</option>; })}
    </select>;
  }
  var jobs = []; catalog.forEach(function (t) { if (jobs.indexOf(t.job) < 0) { jobs.push(t.job); } });

  return <div className="mb-3" style={{ background: BG, border: '1px solid ' + INK, color: INK }} data-testid="work-assignments">
    <div className="flex items-center gap-3 flex-wrap px-4 py-3" style={{ borderBottom: '1px solid ' + LINE }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '0.08em' }}>⚙ WORK ASSIGNMENTS</div>
        <div className="text-[11px]" style={{ color: SUB }}>{'Pick who owns each task and a backup. Their work feed marks those tasks YOURS. Assigning never gives access — switches stay in Settings.' + (data && data.at ? ' Last saved ' + new Date(data.at).toLocaleString() + (data.by_name ? ' by ' + data.by_name : '') + '.' : '')}</div>
      </div>
      <div className="flex-1" />
      <button onClick={load} disabled={busy} className="px-3 py-1.5 text-[11px] font-extrabold" style={{ background: 'transparent', color: INK, border: '1px solid #525252' }}>↻</button>
      <button onClick={save} disabled={busy || !changed} className="px-4 py-1.5 text-[12px] font-extrabold" style={{ background: changed ? INK : '#262626', color: changed ? '#000000' : SUB, border: '1px solid ' + (changed ? INK : '#404040') }}>{busy ? 'Saving…' : 'Save assignments'}</button>
      {props.onClose && <button onClick={props.onClose} className="px-3 py-1.5 text-[11px] font-extrabold" style={{ background: 'transparent', color: INK, border: '1px solid #525252' }}>✕ Close</button>}
    </div>
    <div className="px-4 py-3">
      {err && <div className="px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#450a0a', color: '#fecaca', border: '1px solid ' + RED }}>{'⛔ ' + err}</div>}
      {msg && <div className="px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#052e16', color: '#bbf7d0', border: '1px solid ' + GREEN }}>{msg}</div>}
      {!data && busy && <div className="text-[13px]" style={{ color: SUB }}>Loading…</div>}
      {data && jobs.map(function (job) {
        return <div key={job} className="mb-3">
          <div className="pb-1 mb-1" style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', color: SUB, borderBottom: '1px solid ' + LINE }}>{String(job).toUpperCase()}</div>
          {catalog.filter(function (t) { return t.job === job; }).map(function (t) {
            var d = draft[t.key] || {}; var w1 = rowWarning(t, byId[d.primary], 'primary'); var w2 = rowWarning(t, byId[d.backup], 'backup');
            return <div key={t.key} className="flex items-center gap-2 flex-wrap py-1.5" style={{ borderBottom: '1px solid #171717' }} data-assign-row={t.key}>
              <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13, fontWeight: 800 }}>{t.label}{!t.live && <span className="ml-2 px-1.5 py-0.5" style={{ fontSize: 9, fontWeight: 900, background: '#262626', color: SUB }}>FEED ITEMS COMING LATER</span>}</div>
              <span style={{ fontSize: 10, fontWeight: 900, color: SUB }}>OWNER</span>{picker(t, 'primary')}
              <span style={{ fontSize: 10, fontWeight: 900, color: SUB }}>BACKUP</span>{picker(t, 'backup')}
              {(w1 || w2) && <div className="w-full text-[11px] font-bold" style={{ color: AMBER }}>{[w1, w2].filter(Boolean).join(' ')}</div>}
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
}
