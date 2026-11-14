'use client';
// v55.83-SI — master plan build 2: "🔔 Waiting for me". One clean list of what is waiting on this person in Bills and Wires,
// with stuck items marked. READ-ONLY: it calls the same two list requests the Bills and Wires screens already make.
// Look (Max, Nov 12: "make the GUI professional looking ... keep an eye on the fonts and the background colors"): white
// panels and dark text with explicit colours, so it reads the same in the light and the dark skin.
import React, { useEffect, useState } from 'react';
import { waitingFor } from '../lib/waiting-list';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';

export default function WaitingTab(props) {
  var userProfile = props.userProfile; var mp = props.modulePerms || {};
  var isSuper = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var boss = isSuper || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'));
  var perms = { bills: boss || mp['bills.manage'] === true, prepare: boss || mp['wires.prepare'] === true, signoff: boss || mp['wires.signoff'] === true, send: boss || mp['wires.send'] === true };
  var canBills = boss || mp['bills.view'] === true || mp['bills.manage'] === true;
  var canWires = boss || mp['wires.view'] === true || perms.prepare || perms.signoff || perms.send;
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState([]); var errs = s3[0]; var setErrs = s3[1];
  var s4 = useState(''); var at = s4[0]; var setAt = s4[1];

  function post(url, payload) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'the server did not answer properly (HTTP ' + r.status + ')' }; }); })
      .catch(function (e) { return { ok: false, error: 'could not reach the server (' + ((e && e.message) || 'network') + ')' }; });
  }
  function load() {
    setBusy(true);
    Promise.all([canBills ? post('/api/accounting/bills', { action: 'list' }) : Promise.resolve(null), canWires ? post('/api/accounting/wire-packages', { action: 'list' }) : Promise.resolve(null)]).then(function (r) {
      var e = [];
      if (r[0] && !r[0].ok) { e.push('Bills: ' + (r[0].error || 'not loaded')); }
      if (r[1] && !r[1].ok) { e.push('Wires: ' + (r[1].error || 'not loaded')); }
      setErrs(e);
      setData(waitingFor({ bills: (r[0] && r[0].ok && r[0].bills) || [], wires: (r[1] && r[1].ok && r[1].packages) || [], perms: perms, userId: userProfile && userProfile.id }));
      setAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function go(k) { if (props.onGo) { props.onGo(k); } }
  var btn = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };

  return <div className="nt-paper rounded-2xl p-4" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: INK }}>
    <div className="flex items-center gap-3 flex-wrap mb-1">
      <div className="text-[18px] font-extrabold" style={{ color: INK }}>🔔 Waiting for me</div>
      {data && <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={data.total ? { background: '#0f172a', color: '#ffffff' } : { background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7' }}>{data.total ? data.total + ' item' + (data.total === 1 ? '' : 's') : 'nothing waiting'}</span>}
      {data && data.stuck > 0 && <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{data.stuck + ' stuck'}</span>}
      <div className="flex-1" />
      {at && <span className="text-[11px]" style={{ color: SUB }}>{'updated ' + at}</span>}
      <button onClick={load} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>{busy ? 'Loading…' : '↻ Refresh'}</button>
    </div>
    <div className="text-[12px] mb-3" style={{ color: SUB }}>What needs you in Bills and Wires, oldest first. Stuck items are marked in red. This list only reads — nothing changes until you open the bill or the wire.</div>
    {errs.map(function (e, ix) { return <div key={ix} className="rounded-lg px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{'⛔ ' + e}</div>; })}
    {!canBills && !canWires && <div className="rounded-lg px-3 py-2 text-[13px] font-bold" style={{ background: '#f8fafc', color: INK, border: '1px solid ' + LINE }}>You do not have Bills or Wires switched on, so nothing can be waiting for you here.</div>}
    {!data && busy && <div className="text-[13px]" style={{ color: SUB }}>Loading…</div>}
    {data && !data.total && !errs.length && (canBills || canWires) && <div className="rounded-xl px-4 py-6 text-center" style={{ background: '#f8fafc', border: '1px solid ' + LINE }}>
      <div className="text-[15px] font-extrabold" style={{ color: INK }}>✓ You are all caught up</div>
      <div className="text-[12px] mt-1" style={{ color: SUB }}>No bills to validate, no wires waiting for you, nothing stuck.</div></div>}
    {data && data.sections.map(function (s) {
      var stuckN = s.items.filter(function (x) { return x.stuck; }).length;
      return <div key={s.key} className="rounded-xl mb-3 overflow-hidden" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
        <div className="flex items-center gap-2 flex-wrap px-4 py-3" style={{ background: '#f8fafc', borderBottom: '1px solid ' + LINE }}>
          <div className="text-[14px] font-extrabold" style={{ color: INK }}>{s.title}</div>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: '#e2e8f0', color: INK }}>{s.items.length}</span>
          {stuckN > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{stuckN + ' stuck'}</span>}
          <div className="flex-1" />
          <button onClick={function () { go(s.go); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' }}>{s.go === 'bills' ? 'Open Bills →' : 'Open Wires →'}</button>
          <div className="w-full text-[12px]" style={{ color: SUB }}>{s.hint}</div>
        </div>
        {s.items.slice(0, 25).map(function (x) {
          return <div key={x.id} className="flex items-center gap-3 flex-wrap px-4 py-2.5" style={{ borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div className="text-[13px] font-bold" style={{ color: INK }}>{x.title}</div>
              <div className="text-[11px]" style={{ color: SUB }}>{x.detail}</div>
            </div>
            <div className="text-[13px] font-extrabold tabular-nums" style={{ color: INK }}>{x.amount}</div>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={x.stuck ? { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' } : { background: '#f1f5f9', color: SUB, border: '1px solid ' + LINE }}>{x.chip ? x.chip : (x.stuck ? 'stuck · ' : '') + (x.age == null ? '—' : x.age === 0 ? 'today' : x.age + ' day' + (x.age === 1 ? '' : 's'))}</span>
          </div>;
        })}
        {s.items.length > 25 && <div className="px-4 py-2 text-[12px] font-bold" style={{ color: SUB, borderTop: '1px solid #f1f5f9' }}>{'+ ' + (s.items.length - 25) + ' more — open the screen to see them all.'}</div>}
      </div>;
    })}
  </div>;
}
