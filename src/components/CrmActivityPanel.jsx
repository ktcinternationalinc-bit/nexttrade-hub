'use client';
// v55.83-RJ — CRM: who was ADDED and what was UPDATED, by period (Max, Nov 9 11:16):
// "a way for me to see in periods who was added during the last 7 days 30 days.
// 3 months. 6 months. 1 year. and who created it in the crm. Also any updates...
// same time periods with dates of each updates should be in the crm by default"
// Shown OPEN by default at the top of the CRM list. CrmClientHistory = the same
// record for one client, on the client's page.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fmtET } from '../lib/et-time';
import { CRM_PERIODS, CRM_DEFAULT_PERIOD, periodStart, addedIn, describeChange, visibleUpdates } from '../lib/crm-history';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
var SQL_MSG = 'Run sql/v55-83-RJ-crm-added-updated.sql in Supabase to record every update (dates added already show).';

async function pageRows(mk) {
  var acc = [];
  for (var pg = 0; pg < 20; pg++) {
    var r = await mk().range(pg * 1000, pg * 1000 + 999);
    if (r.error) { return { data: acc, error: r.error }; }
    acc = acc.concat(r.data || []);
    if (!r.data || r.data.length < 1000) { break; }
  }
  return { data: acc, error: null };
}
function nameOf(users, id) { var u = (users || []).find(function (x) { return x.id === id; }); return u ? (u.name || u.email) : null; }
function clientLabel(c, lang) { return c ? ((lang === 'en' && c.name_en) ? c.name_en : (c.name || c.name_en || '—')) : '—'; }

export default function CrmActivityPanel(props) {
  var customers = props.customers || []; var users = props.users || []; var lang = props.lang;
  var s1 = useState(CRM_DEFAULT_PERIOD); var period = s1[0]; var setPeriod = s1[1];
  var s2 = useState('added'); var view = s2[0]; var setView = s2[1];
  var s3 = useState('all'); var who = s3[0]; var setWho = s3[1];
  var s4 = useState(true); var open = s4[0]; var setOpen = s4[1];
  var s5 = useState(null); var hist = s5[0]; var setHist = s5[1];
  var s6 = useState([]); var notes = s6[0]; var setNotes = s6[1];
  var s7 = useState(true); var withNotes = s7[0]; var setWithNotes = s7[1];
  var s8 = useState(''); var err = s8[0]; var setErr = s8[1];
  var start = periodStart(period);

  useEffect(function () {
    var alive = true; setHist(null); setErr('');
    (async function () {
      var h = await pageRows(function () { return supabase.from('customer_history').select('*').gte('changed_at', start).order('changed_at', { ascending: false }); });
      var n = await pageRows(function () { return supabase.from('client_notes').select('customer_id, note_text, created_at, created_by').gte('created_at', start).order('created_at', { ascending: false }); });
      if (!alive) { return; }
      if (h.error) { setErr(/customer_history/.test(h.error.message || '') ? SQL_MSG : h.error.message); }
      setHist(h.data || []); setNotes(n.data || []);
    })();
    return function () { alive = false; };
  }, [period]); // eslint-disable-line

  var byId = {}; customers.forEach(function (c) { byId[String(c.id)] = c; });
  var ctxFor = function (c) { return { userName: function (id) { return nameOf(users, id); }, canSeeContact: props.canSeeContact ? props.canSeeContact(c) : true }; };
  var added = addedIn(customers, start).filter(function (c) { return who === 'all' || c.created_by === who; });
  var unknownDates = customers.filter(function (c) { return !c.created_at; }).length;
  var upd = visibleUpdates(hist || [], Object.keys(byId), props.isAdmin === true).map(function (r) { return { kind: r.action, at: r.changed_at, by: r.changed_by, cid: r.customer_id, name: r.customer_name, row: r }; });
  if (withNotes) {
    notes.forEach(function (n) {
      if (!byId[String(n.customer_id)]) { return; }
      if (/^📊 Pipeline stage changed/.test(n.note_text || '')) { return; } // the stage change itself is already a line
      upd.push({ kind: 'note', at: n.created_at, by: n.created_by, cid: n.customer_id, note: n.note_text });
    });
  }
  upd = upd.filter(function (u) { return who === 'all' || u.by === who; }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  var updClients = {}; upd.forEach(function (u) { updClients[u.cid] = true; });
  var people = users.filter(function (u) { return u.active !== false; });
  var pLabel = (CRM_PERIODS.filter(function (p) { return p.key === period; })[0] || {}).label;

  return <div className="nt-paper rounded-2xl p-4 mb-4" style={{ border: '1px solid #cbd5e1' }}>
    <div className="flex gap-2 items-center flex-wrap">
      <button onClick={function () { setOpen(!open); }} className="text-[15px] font-extrabold" style={{ color: INK }}>{(open ? '▾' : '▸') + ' 🗓 Clients added & updated'}</button>
      <div className="flex-1" />
      {CRM_PERIODS.map(function (p) {
        return <button key={p.key} onClick={function () { setPeriod(p.key); setOpen(true); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold"
          style={period === p.key ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: SUB }}>{p.label.replace('Last ', '')}</button>;
      })}
    </div>
    {open && <div className="mt-3">
      <div className="flex gap-2 flex-wrap items-center mb-2">
        <button onClick={function () { setView('added'); }} className="rounded-xl px-4 py-2 text-left" style={view === 'added' ? { background: '#047857', color: '#ffffff' } : { background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>
          <div className="text-[20px] font-extrabold leading-none">{added.length}</div><div className="text-[11px] font-bold">➕ added · {pLabel}</div></button>
        <button onClick={function () { setView('updated'); }} className="rounded-xl px-4 py-2 text-left" style={view === 'updated' ? { background: '#1d4ed8', color: '#ffffff' } : { background: '#eff6ff', color: '#1e3a8a', border: '1px solid #bfdbfe' }}>
          <div className="text-[20px] font-extrabold leading-none">{hist ? Object.keys(updClients).length : '…'}</div><div className="text-[11px] font-bold">{'✏ clients updated · ' + (hist ? upd.length : '…') + ' updates'}</div></button>
        <div className="flex-1" />
        <label className="text-[12px] font-bold" style={{ color: SUB }}>{view === 'added' ? 'Added by ' : 'Updated by '}
          <select value={who} onChange={function (e) { setWho(e.target.value); }} className="px-2 py-1 rounded-lg border text-[12px] nt-light" style={{ color: INK, background: '#ffffff' }}>
            <option value="all">anyone</option>{people.map(function (u) { return <option key={u.id} value={u.id}>{u.name || u.email}</option>; })}</select></label>
        {view === 'updated' && <label className="flex items-center gap-1 text-[12px] font-bold" style={{ color: SUB }}><input type="checkbox" checked={withNotes} onChange={function (e) { setWithNotes(e.target.checked); }} /> include notes</label>}
      </div>
      {err && <div className="rounded-lg p-2 mb-2 text-[12px] font-bold" style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f' }}>{err}</div>}

      {view === 'added' ? <div className="overflow-auto rounded-lg" style={{ maxHeight: 360, border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-1.5 text-left">Date added</th><th className="px-2 py-1.5 text-left">Client</th><th className="px-2 py-1.5 text-left">Added by</th><th className="px-2 py-1.5 text-left">Rep</th><th className="px-2 py-1.5 text-left">Stage</th></tr></thead>
        <tbody style={{ color: INK }}>
          {added.map(function (c) {
            return <tr key={c.id} onClick={function () { if (props.onOpen) { props.onOpen(c); } }} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>
              <td className="px-2 py-1.5 whitespace-nowrap font-bold">{fmtET(c.created_at, 'datetime')}</td>
              <td className="px-2 py-1.5 font-extrabold" style={{ color: '#1d4ed8' }}>{clientLabel(c, lang)}</td>
              <td className="px-2 py-1.5">{nameOf(users, c.created_by) || <span style={{ color: MUTED }}>not recorded</span>}</td>
              <td className="px-2 py-1.5">{nameOf(users, c.assigned_rep) || <span style={{ color: MUTED }}>—</span>}</td>
              <td className="px-2 py-1.5">{c.pipeline_stage || 'lead'}</td>
            </tr>;
          })}
          {added.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-[12px]" style={{ color: MUTED }}>{'No clients added in the ' + String(pLabel || '').toLowerCase() + (who !== 'all' ? ' by ' + nameOf(users, who) : '') + '.'}</td></tr>}
        </tbody></table>
        {unknownDates > 0 && <div className="px-2 py-1.5 text-[11px]" style={{ color: MUTED, borderTop: '1px solid #e2e8f0' }}>{unknownDates + ' older client(s) have no recorded creation date, so they are not in any period.'}</div>}
      </div>
      : <div className="overflow-auto rounded-lg" style={{ maxHeight: 420, border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-1.5 text-left">Date & time</th><th className="px-2 py-1.5 text-left">Client</th><th className="px-2 py-1.5 text-left">By</th><th className="px-2 py-1.5 text-left">What changed</th></tr></thead>
        <tbody style={{ color: INK }}>
          {!hist ? <tr><td colSpan={4} className="px-3 py-3" style={{ color: MUTED }}>Loading…</td></tr> : upd.map(function (u, i) {
            var c = byId[String(u.cid)];
            var what;
            if (u.kind === 'note') { what = <span>📝 Note: {String(u.note || '').substring(0, 160)}</span>; }
            else if (u.kind === 'deleted') { what = <span style={{ color: '#b91c1c', fontWeight: 700 }}>🗑 Client deleted</span>; }
            else { var ch = u.row.changes || {}; what = <div>{Object.keys(ch).map(function (k) { return <div key={k}>{describeChange(k, ch[k] && ch[k].from, ch[k] && ch[k].to, ctxFor(c))}</div>; })}</div>; }
            return <tr key={i} onClick={function () { if (c && props.onOpen) { props.onOpen(c); } }} style={{ borderTop: '1px solid #f1f5f9', cursor: c ? 'pointer' : 'default', verticalAlign: 'top' }}>
              <td className="px-2 py-1.5 whitespace-nowrap font-bold">{fmtET(u.at, 'datetime')}</td>
              <td className="px-2 py-1.5 font-extrabold" style={{ color: c ? '#1d4ed8' : SUB }}>{c ? clientLabel(c, lang) : (u.name || '—')}</td>
              <td className="px-2 py-1.5">{nameOf(users, u.by) || <span style={{ color: MUTED }}>system</span>}</td>
              <td className="px-2 py-1.5">{what}</td>
            </tr>;
          })}
          {hist && upd.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-[12px]" style={{ color: MUTED }}>{'No updates in the ' + String(pLabel || '').toLowerCase() + (who !== 'all' ? ' by ' + nameOf(users, who) : '') + '.'}</td></tr>}
        </tbody></table></div>}
    </div>}
  </div>;
}

// One client's full record: when it was added and by whom, and every update with its date.
export function CrmClientHistory(props) {
  var c = props.client; var users = props.users || [];
  var s1 = useState(null); var rows = s1[0]; var setRows = s1[1];
  var s2 = useState(true); var open = s2[0]; var setOpen = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  useEffect(function () {
    var alive = true; setRows(null); setErr('');
    if (!c) { return undefined; }
    supabase.from('customer_history').select('*').eq('customer_id', String(c.id)).order('changed_at', { ascending: false }).limit(500).then(function (r) {
      if (!alive) { return; }
      if (r.error) { setErr(/customer_history/.test(r.error.message || '') ? SQL_MSG : r.error.message); setRows([]); } else { setRows(r.data || []); }
    });
    return function () { alive = false; };
  }, [c && c.id, props.reloadKey]); // eslint-disable-line
  if (!c) { return null; }
  var ctx = { userName: function (id) { return nameOf(users, id); }, canSeeContact: props.canSeeContact ? props.canSeeContact(c) : true };
  var updates = (rows || []).filter(function (r) { return r.action === 'updated'; });
  return <div className="nt-paper rounded-xl p-3 mb-3" style={{ border: '1px solid #cbd5e1' }}>
    <div className="flex gap-3 flex-wrap items-center text-[12px]" style={{ color: INK }}>
      <span><b>📅 Added:</b> {c.created_at ? fmtET(c.created_at, 'datetime') : <span style={{ color: MUTED }}>date not recorded</span>}{' · by '}<b>{nameOf(users, c.created_by) || 'not recorded'}</b></span>
      <span><b>✏ Last updated:</b> {c.updated_at ? fmtET(c.updated_at, 'datetime') + (nameOf(users, c.updated_by) ? ' · by ' + nameOf(users, c.updated_by) : '') : (updates[0] ? fmtET(updates[0].changed_at, 'datetime') + (nameOf(users, updates[0].changed_by) ? ' · by ' + nameOf(users, updates[0].changed_by) : '') : 'never')}</span>
      <div className="flex-1" />
      <button onClick={function () { setOpen(!open); }} className="text-[12px] font-extrabold" style={{ color: '#1d4ed8' }}>{(open ? '▾ ' : '▸ ') + 'History (' + updates.length + ' update' + (updates.length === 1 ? '' : 's') + ')'}</button>
    </div>
    {err && <div className="rounded p-2 mt-2 text-[11px] font-bold" style={{ background: '#fef3c7', color: '#78350f' }}>{err}</div>}
    {open && <div className="mt-2 overflow-auto rounded-lg" style={{ maxHeight: 300, border: '1px solid #e2e8f0' }}>
      {!rows ? <div className="p-2 text-[12px]" style={{ color: MUTED }}>Loading…</div> : rows.length === 0 ? <div className="p-2 text-[12px]" style={{ color: MUTED }}>No changes recorded yet.</div> :
        <table className="w-full text-[12px]"><tbody style={{ color: INK }}>
          {rows.map(function (r) {
            var ch = r.changes || {};
            return <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              <td className="px-2 py-1.5 whitespace-nowrap font-bold">{fmtET(r.changed_at, 'datetime')}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{nameOf(users, r.changed_by) || <span style={{ color: MUTED }}>system</span>}</td>
              <td className="px-2 py-1.5">{r.action === 'created' ? <b style={{ color: '#065f46' }}>➕ Client added</b> : Object.keys(ch).map(function (k) { return <div key={k}>{describeChange(k, ch[k] && ch[k].from, ch[k] && ch[k].to, ctx)}</div>; })}</td>
            </tr>;
          })}
        </tbody></table>}
    </div>}
  </div>;
}
