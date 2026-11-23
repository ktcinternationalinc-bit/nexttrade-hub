'use client';
// v55.83-XC (Max, 21 Nov: "a place to enter screenshots for wires in one place and the hub able to sort them out and put them in
// the proper wire for confirmation. If there is a discrepancy somewhere it must create a note and send to emails ... and keep an
// audit") — 🏦 Wires → 📥 Bank confirmations. Drop many PDFs / screenshots; each is read, the Hub PROPOSES its wire, a person
// confirms. Confirming attaches the file to the wire — it does NOT mark the wire sent (that stays the wire's own step).
import React, { useState, useEffect } from 'react';
import { fmtET } from '../lib/et-time';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
var inp = 'rounded-lg px-2 py-1.5 text-[12px] outline-none'; var inpS = { border: '1px solid #cbd5e1', color: INK, background: '#ffffff' };
var ST = {
  new: ['Waiting to be read', '#f1f5f9', '#334155'], read: ['Read', '#f1f5f9', '#334155'], unreadable: ['Could not be read', '#fee2e2', '#991b1b'],
  proposed: ['Wire found — confirm it', '#dbeafe', '#1e3a8a'], several: ['Several wires fit — pick one', '#fef3c7', '#92400e'],
  no_wire: ['No matching wire', '#fee2e2', '#991b1b'], linked: ['Attached to its wire', '#d1fae5', '#065f46'], dismissed: ['Set aside', '#e2e8f0', '#475569'],
};
var KIND = { amount: 'Different amount', date: 'Different date', recipient: 'Different recipient', status: 'Bank status not sent', currency: 'Other currency', no_wire: 'No matching wire', missing_confirmation: 'Sent wire with no confirmation', not_readable: 'Could not be read' };
var MAIL = { pending: 'e-mail pending', sending: 'e-mailing…', sent: 'e-mailed', partly_sent: 'e-mailed to some', not_sent: 'NOT e-mailed', no_recipients: 'no one to e-mail' };
function money(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function Btn(p) { return <button onClick={p.onClick} disabled={p.disabled} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={p.light ? { background: '#f1f5f9', color: SUB, opacity: p.disabled ? 0.5 : 1 } : { background: p.color || '#1d4ed8', color: '#ffffff', opacity: p.disabled ? 0.5 : 1 }}>{p.children}</button>; }

async function sha256(file) {
  try { var buf = await file.arrayBuffer(); var h = await crypto.subtle.digest('SHA-256', buf); return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); } catch (e) { return null; }
}
function newId() { try { if (crypto.randomUUID) { return crypto.randomUUID(); } } catch (e) { /* older browser */ } return Date.now().toString(36) + Math.random().toString(36).substring(2, 10); }

export default function WireInboxPanel(p) {
  var api = p.api; var toast = p.toast; var supabase = p.supabase; var perms = p.perms || {};
  var a1 = useState(null); var data = a1[0]; var setData = a1[1];
  var a2 = useState(false); var busy = a2[0]; var setBusy = a2[1];
  var a3 = useState({}); var pick = a3[0]; var setPick = a3[1];       // inbox row → chosen wire id
  var a4 = useState({}); var why = a4[0]; var setWhy = a4[1];         // inbox row → reason to set aside
  var a5 = useState(''); var progress = a5[0]; var setProgress = a5[1];
  var a6 = useState('open'); var view = a6[0]; var setView = a6[1];

  function load() { api({ action: 'inbox_list' }).then(function (j) { if (j && j.ok) { setData(j); } else { setData({ error: (j && j.error) || 'The inbox could not be loaded.' }); } }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return /^(application\/pdf|image\/)/.test(f.type || '') || /\.(pdf|png|jpe?g|webp|gif)$/i.test(f.name || ''); });
    if (!files.length) { toast.error('Pick PDFs or screenshots (PNG / JPG).'); return; }
    setBusy(true);
    try {
      var reg = [];
      for (var i = 0; i < files.length; i++) {
        setProgress('Uploading ' + (i + 1) + ' of ' + files.length + '…');
        var f = files[i]; var safe = String(f.name || 'confirmation').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
        var path = 'pv/wire-inbox-' + newId() + '-' + safe;
        var up = await supabase.storage.from('bills-private').upload(path, f, { upsert: false });
        if (up && up.error) { toast.error(f.name + ': upload failed — ' + up.error.message); continue; }
        reg.push({ path: path, file_name: f.name, sha256: await sha256(f) });
      }
      if (!reg.length) { return; }
      var j = await api({ action: 'inbox_add', files: reg });
      if (!j || !j.ok) { toast.error((j && j.error) || 'The files were not added.'); return; }
      (j.refused || []).forEach(function (r) { toast.error((r.file_name || 'A file') + ': ' + r.why); });
      for (var k = 0; k < (j.added || []).length; k++) {
        setProgress('Reading ' + (k + 1) + ' of ' + j.added.length + '…');
        await api({ action: 'inbox_read', inbox_id: j.added[k].id });
      }
      toast.success((j.added || []).length + ' confirmation(s) added and read.');
    } finally { setProgress(''); setBusy(false); load(); }
  }
  function act(payload, okMsg) {
    setBusy(true);
    return api(payload).then(function (j) {
      if (j && j.ok) { toast.success(typeof okMsg === 'function' ? okMsg(j) : okMsg); load(); }
      else { toast.error((j && j.error) || 'That did not work.'); }
      return j;
    }).finally(function () { setBusy(false); });
  }
  function openFile(path) {
    var w = null; try { w = window.open('', '_blank'); } catch (eW) { w = null; }
    supabase.storage.from('bills-private').createSignedUrl(path, 3600).then(function (r) { var u = r && r.data && r.data.signedUrl; if (u) { if (w) { w.location.href = u; } else { window.location.assign(u); } } else { if (w) { w.close(); } toast.error('Could not open the file.'); } });
  }

  if (!data) { return <div className="text-[12px]" style={{ color: MUTED }}>Loading the bank confirmations…</div>; }
  if (data.error) { return <div className="rounded-lg p-3 text-[12px] font-bold" style={{ background: '#fee2e2', color: '#991b1b' }}>{'⛔ ' + data.error}</div>; }
  var rows = (data.rows || []).filter(function (r) { return view === 'all' ? true : (view === 'open' ? (r.status !== 'linked' && r.status !== 'dismissed') : r.status === view); });
  var wires = data.wires || [];
  var notices = data.notices || [];
  return <div>
    <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '2px dashed #94a3b8' }}
      onDragOver={function (e) { e.preventDefault(); }} onDrop={function (e) { e.preventDefault(); if (perms.send && !busy) { addFiles(e.dataTransfer && e.dataTransfer.files); } }}>
      <div className="text-[14px] font-extrabold mb-1" style={{ color: INK }}>📥 Bank confirmations</div>
      <div className="text-[12px] mb-2" style={{ color: SUB }}>Drop the bank’s wire confirmations here (PDFs or screenshots, many at once). The Hub reads each one and finds the wire it belongs to. You confirm it, and the file is attached to that wire. Attaching does not mark a wire sent. Anything that does not match is noted and e-mailed to everyone with ClickBooks access. Files stay private and are never deleted.</div>
      {perms.send ? <label className="inline-block px-3 py-2 rounded-lg text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy && progress ? progress : '＋ Add confirmations'}
        <input type="file" multiple accept="application/pdf,image/*" disabled={busy} onChange={function (e) { var fl = e.target.files; addFiles(fl); e.target.value = ''; }} style={{ display: 'none' }} /></label>
        : <div className="text-[12px]" style={{ color: MUTED }}>Adding confirmations needs “Wires: Send”.</div>}
    </div>
    <div className="flex gap-1.5 flex-wrap mb-2">
      {[['open', 'To do'], ['linked', 'Attached'], ['dismissed', 'Set aside'], ['all', 'All']].map(function (k) {
        var n = (data.rows || []).filter(function (r) { return k[0] === 'all' ? true : (k[0] === 'open' ? (r.status !== 'linked' && r.status !== 'dismissed') : r.status === k[0]); }).length;
        return <button key={k[0]} onClick={function () { setView(k[0]); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={view === k[0] ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: SUB }}>{k[1] + ' (' + n + ')'}</button>;
      })}
    </div>
    {rows.length === 0 ? <div className="rounded-lg p-4 text-center text-[12px]" style={{ background: '#f8fafc', color: MUTED }}>Nothing here.</div>
      : rows.map(function (r) {
        var s = ST[r.status] || [r.status, '#f1f5f9', SUB]; var rd = r.read || {};
        var cands = r.candidates || []; var chosen = pick[r.id] || r.proposed_package_id || '';
        var open = r.status !== 'linked' && r.status !== 'dismissed';
        return <div key={r.id} className="rounded-xl p-3 mb-2" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: INK }}>
          <div className="flex gap-2 items-center flex-wrap">
            <button onClick={function () { openFile(r.path); }} className="underline font-extrabold text-[13px]" style={{ color: '#1d4ed8' }}>{'📄 ' + (r.file_name || 'file')}</button>
            <span className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: s[1], color: s[2] }}>{s[0]}</span>
            <span className="text-[11px]" style={{ color: MUTED }}>{'added ' + fmtET(r.uploaded_at, 'datetime') + (r.uploaded_by_name ? ' by ' + r.uploaded_by_name : '')}</span>
          </div>
          {r.read && <div className="text-[12px] mt-1" style={{ color: SUB }}>{['Reference ' + (rd.reference || '—') + (rd.transaction_number ? ' · Transaction ' + rd.transaction_number : ''), 'Wire date ' + (rd.sent_date || '—'), 'Amount ' + (rd.amount != null ? (rd.currency ? rd.currency + ' ' : '') + money(rd.amount) + (rd.currency ? '' : ' (currency not shown)') : '—'), 'To ' + (rd.beneficiary || '—'), rd.status ? 'Status ' + rd.status : null].filter(Boolean).join(' · ')}</div>}
          {r.read_error && <div className="text-[12px] mt-1 font-bold" style={{ color: '#b45309' }}>{'⚠ ' + r.read_error}</div>}
          {r.note && <div className="text-[12px] mt-1 font-bold" style={{ color: '#9a3412' }}>{'📝 ' + r.note}</div>}
          {r.status === 'linked' && <div className="text-[12px] mt-1 font-bold" style={{ color: '#065f46' }}>{'🔗 Attached to ' + (r.linked_label || 'its wire') + (r.linked_by_name ? ' by ' + r.linked_by_name : '') + ' · ' + fmtET(r.linked_at, 'datetime') + '. To mark that wire sent, open it in the wires list.'}</div>}
          {r.status === 'dismissed' && <div className="text-[12px] mt-1" style={{ color: MUTED }}>{'Set aside: “' + (r.dismiss_reason || '') + '” — the file is kept.'}</div>}
          {open && perms.send && <div className="mt-2 flex gap-2 items-center flex-wrap">
            {(r.status === 'new' || r.status === 'unreadable') && <Btn color="#0f766e" disabled={busy} onClick={function () { act({ action: 'inbox_read', inbox_id: r.id }, function (j) { return j.status === 'unreadable' ? 'Still could not be read — pick the wire yourself.' : 'Read.'; }); }}>🔎 Read it {r.status === 'unreadable' ? 'again' : ''}</Btn>}
            <select value={chosen} onChange={function (e) { var o = {}; o[r.id] = e.target.value; setPick(Object.assign({}, pick, o)); }} className={inp} style={Object.assign({ maxWidth: 420 }, inpS)}>
              <option value="">{cands.length ? 'Pick the wire…' : 'Pick the wire yourself…'}</option>
              {cands.length > 0 && <optgroup label="Suggested">{cands.map(function (c) { return <option key={'c' + c.id} value={c.id}>{c.label + ' — ' + (c.reasons || []).join(', ')}</option>; })}</optgroup>}
              <optgroup label="All wires">{wires.map(function (w) { return <option key={w.id} value={w.id}>{w.label + ' · ' + w.payee_name + ' · $' + money(w.total) + ' · ' + (w.sent_date ? 'sent ' + w.sent_date : (w.planned_send_date ? 'planned ' + w.planned_send_date : w.status))}</option>; })}</optgroup>
            </select>
            <Btn disabled={busy || !chosen} onClick={function () { act({ action: 'inbox_link', inbox_id: r.id, package_id: chosen }, function (j) { return '🔗 Attached to ' + j.wire + '.' + ((j.notes || []).length ? ' ' + j.notes.length + ' difference(s) noted and e-mailed.' : '') + ' ' + (j.next || ''); }); }}>{r.status === 'proposed' && chosen === r.proposed_package_id ? '✓ Yes, this is the wire' : '🔗 Attach to this wire'}</Btn>
            <input value={why[r.id] || ''} onChange={function (e) { var o = {}; o[r.id] = e.target.value; setWhy(Object.assign({}, why, o)); }} placeholder="why set aside" className={inp} style={Object.assign({ width: 150 }, inpS)} />
            <Btn light disabled={busy || String(why[r.id] || '').trim().length < 5} onClick={function () { act({ action: 'inbox_dismiss', inbox_id: r.id, reason: why[r.id] }, 'Set aside — the file is kept.'); }}>Set aside</Btn>
          </div>}
        </div>;
      })}
    {notices.length > 0 && <div className="mt-4">
      <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{'📝 Discrepancy notes (' + notices.length + ')'}</div>
      {notices.map(function (n) {
        return <div key={n.id} className="text-[12px] rounded-lg px-3 py-1.5 mb-1" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: INK }}>
          <b>{KIND[n.kind] || n.kind}</b>{' · ' + n.note + ' · ' + fmtET(n.created_at, 'datetime') + ' · '}
          {/* XC rev3 — an e-mail that started but whose result was never saved is NOT retried by itself: a person checks it */}
          {n.mail_status === 'sending' && Date.now() - Date.parse(n.mail_claimed_at || n.created_at || 0) >= 120000
            ? <span className="font-extrabold" style={{ color: '#b45309' }}>{'⚠ e-mail outcome unknown (started ' + fmtET(n.mail_claimed_at || n.created_at, 'datetime') + ', no result saved) — check with the people who should have got it; it is not sent again by itself'}</span>
            : <span style={{ color: n.mail_status === 'sent' ? '#065f46' : (n.mail_status === 'not_sent' ? '#b91c1c' : MUTED) }}>{(MAIL[n.mail_status] || n.mail_status) + (n.mail_status === 'not_sent' && n.mail_error ? ' (' + n.mail_error + ')' : '')}</span>}
        </div>;
      })}
    </div>}
  </div>;
}
