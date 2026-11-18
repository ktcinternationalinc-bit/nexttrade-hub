'use client';
// v55.83-SV — Project 1 (commercial agent), Stage 1: the Sourcing desk.
// Max, Nov 15 2026: "You need to find a way to organize communication and requests to you." — every request is a numbered
// assignment with an owner, a stage, a next action and a due date. The agent researches the public web and proposes a
// shortlist; every fact shows where it came from; a person keeps or drops; drafts are prepared, nothing is sent.
// v55.83-SW — Stage 2: each supplier has a conversation; a person sends a draft for approval, an approver (super admin or
// the “Commercial: Approve outgoing messages” switch) approves the exact version and it goes from info@ktcus.com signed by Roma.
// Screen rules: white panels with dark text, every field carries nt-light, no browser pop-ups, nothing shown as working
// when it is not connected.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { hubFetch } from '../lib/hub-fetch'; // v55.83-UH
import { COMPANIES, DIRECTIONS, STAGES, ROLES } from '../lib/sourcing';

var INK = '#0f172a', SUB = '#334155', MUTED = '#64748b';
var inp = 'nt-light rounded-lg px-2 py-1.5 text-[13px]';
var inpS = { background: '#ffffff', color: '#0f172a', border: '1px solid #94a3b8' };
function Btn(p) {
  var st = p.light ? { background: '#ffffff', color: INK, border: '1px solid #94a3b8' } : { background: p.color || '#1d4ed8', color: '#ffffff', border: '1px solid ' + (p.color || '#1d4ed8') };
  return <button onClick={p.onClick} disabled={!!p.disabled} className={'rounded-lg font-extrabold ' + (p.big ? 'px-4 py-2 text-[13px]' : 'px-3 py-1.5 text-[12px]')} style={Object.assign({ opacity: p.disabled ? 0.6 : 1 }, st)}>{p.children}</button>;
}
function Chip(p) { return <span className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: p.bg, color: p.fg, whiteSpace: 'nowrap' }}>{p.children}</span>; }
var STAGE_COLORS = { new: ['#e2e8f0', '#0f172a'], researching: ['#dbeafe', '#1e3a8a'], shortlist: ['#fef3c7', '#78350f'], drafts_ready: ['#d1fae5', '#065f46'], in_contact: ['#ede9fe', '#5b21b6'], on_hold: ['#f1f5f9', '#475569'], closed: ['#e2e8f0', '#475569'] };
var GRADE = { verified: ['#d1fae5', '#065f46', 'VERIFIED'], claim: ['#fef3c7', '#78350f', 'CLAIM'], estimate: ['#e0e7ff', '#3730a3', 'ESTIMATE'] };
function dirLabel(k) { var d = DIRECTIONS.filter(function (x) { return x.key === k; })[0]; return d ? d.label : k; }
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }

export default function SourcingDeskTab(props) {
  var userProfile = props.userProfile; var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var list = s1[0]; var setList = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState(null); var det = s4[0]; var setDet = s4[1];
  var s5 = useState(null); var form = s5[0]; var setForm = s5[1];
  var s6 = useState(null); var health = s6[0]; var setHealth = s6[1];
  var s7 = useState(false); var showHealth = s7[0]; var setShowHealth = s7[1];
  var s8 = useState(null); var ask = s8[0]; var setAsk = s8[1];           // inline question: {kind, …}
  var s9 = useState('open'); var fStage = s9[0]; var setFStage = s9[1];
  var s10 = useState(null); var openDraft = s10[0]; var setOpenDraft = s10[1];
  var s11 = useState(false); var canResearch = s11[0]; var setCanResearch = s11[1];
  var s12 = useState(false); var canApprove = s12[0]; var setCanApprove = s12[1];
  var s13 = useState(null); var approvals = s13[0]; var setApprovals = s13[1];
  var s14 = useState(null); var edit = s14[0]; var setEdit = s14[1];          // { id, to_address, subject, body }
  var s15 = useState(null); var mailTest = s15[0]; var setMailTest = s15[1];

  function api(body) {
    // v55.83-UH — hubFetch sends the signed-in person's token; the server acts only for that person
    return hubFetch('/api/commercial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, body)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() {
    setBusy(true); setErr('');
    api({ action: 'list' }).then(function (j) { setBusy(false); if (j.ok) { setList(j.requests || []); setCanResearch(!!j.can_research); } else { setList([]); setErr(j.error || 'Could not load the requests.'); } });
    api({ action: 'health' }).then(function (j) { if (j.ok) { setHealth(j); setCanApprove(!!j.can_approve); } });
    api({ action: 'approvals' }).then(function (j) { if (j.ok) { setApprovals(j.items || []); setCanApprove(!!j.can_approve); } });
  }
  function open(id) { setBusy(true); setAsk(null); setOpenDraft(null); setEdit(null); api({ action: 'get', id: id }).then(function (j) { setBusy(false); if (j.ok) { setDet(j); setCanResearch(!!j.can_research); setCanApprove(!!j.can_approve); } else { toast.error(j.error || 'Could not open the request.'); } }); }
  function act(body, okMsg, after) {
    setBusy(true);
    return api(body).then(function (j) {
      setBusy(false);
      if (j.ok) { if (okMsg) { toast.success(typeof okMsg === 'function' ? okMsg(j) : okMsg); } if (after) { after(j); } }
      else { toast.error(j.error || 'Not saved.'); }
      return j;
    });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line

  function upload(file) {
    var safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
    var path = 'pv/sourcing-' + Date.now() + '-' + safe;
    return supabase.storage.from('bills-private').upload(path, file, { upsert: false }).then(function (r) { if (r && r.error) { throw new Error('Upload failed: ' + r.error.message); } return { path: path, name: file.name }; });
  }
  function openFile(path) {
    var w = null; try { w = window.open('', '_blank'); } catch (eW) { w = null; }
    supabase.storage.from('bills-private').createSignedUrl(path, 3600).then(function (r) {
      if (r && r.data && r.data.signedUrl) { if (w) { w.location.href = r.data.signedUrl; } else { toast.error('The browser blocked the new window — allow pop-ups for this site and try again.'); } }
      else { if (w) { try { w.close(); } catch (eC) { /* ignore */ } } toast.error('Could not open the file.'); }
    });
  }
  function saveForm() {
    var f = form;
    var go = function (atts) { act({ action: 'create_request', request: Object.assign({}, f, { attachments: atts, files: undefined }) }, function (j) { return '✓ ' + j.label + ' created.'; }, function (j) { setForm(null); load(); open(j.id); }); };
    if (f.files && f.files.length) {
      setBusy(true);
      Promise.all(Array.prototype.slice.call(f.files).slice(0, 5).map(upload)).then(go).catch(function (e) { setBusy(false); toast.error((e && e.message) || 'A file could not be uploaded.'); });
    } else { go([]); }
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t).then(function () { toast.success('Copied.'); }, function () { toast.error('Could not copy — select the text and copy it by hand.'); }); }
    catch (e) { toast.error('Could not copy — select the text and copy it by hand.'); }
  }

  var panel = { background: '#ffffff', border: '1px solid #cbd5e1', color: INK };
  var MSG_COLORS = { draft: ['#e2e8f0', '#0f172a'], pending_approval: ['#fef3c7', '#78350f'], approved: ['#dbeafe', '#1e3a8a'], sending: ['#dbeafe', '#1e3a8a'], sent: ['#d1fae5', '#065f46'], failed: ['#fee2e2', '#7f1d1d'], bounced: ['#fee2e2', '#7f1d1d'], received: ['#ede9fe', '#5b21b6'] };

  // v55.83-SW — the conversation with one supplier: our messages (with their approval and sending state) and their replies
  function renderThread(x, R, closed) {
    var th = x.thread || [];
    if (!th.length) { return null; }
    var live = th.filter(function (m) { return m.direction === 'out' && ['draft', 'pending_approval', 'approved', 'sending', 'failed'].indexOf(m.status) >= 0; })[0];
    return <div className="mt-2 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
      <div className="flex gap-2 items-center flex-wrap mb-1">
        <div className="text-[13px] font-extrabold" style={{ color: INK }}>{'✉ Conversation (' + th.length + ')'}</div>
        <div className="flex-1" />
        {!closed && !live && th.some(function (m) { return m.status === 'sent' || m.status === 'received'; }) && <Btn light onClick={function () { act({ action: 'write_again', id: R.id, supplier_id: x.supplier_id }, 'Draft started — write it, then send it for approval.', function (j) { open(R.id); }); }} disabled={busy}>✍ Write again</Btn>}
      </div>
      {th.map(function (m) {
        var c = MSG_COLORS[m.status] || MSG_COLORS.draft; var incoming = m.direction === 'in';
        var editing = edit && edit.id === m.id; var askHere = ask && ask.msg === m.id;
        return <div key={m.id} className="rounded-lg p-2 mb-2" style={{ background: incoming ? '#faf5ff' : '#ffffff', border: '1px solid ' + (incoming ? '#d8b4fe' : '#e2e8f0'), marginLeft: incoming ? 0 : 18, marginRight: incoming ? 18 : 0 }}>
          <div className="flex gap-2 items-center flex-wrap">
            <Chip bg={c[0]} fg={c[1]}>{incoming ? (m.kind === 'bounce' ? 'BOUNCE NOTICE' : 'THEIR REPLY') : m.status_words.toUpperCase()}</Chip>
            {!incoming && m.kind === 'followup' && <Chip bg="#f1f5f9" fg="#334155">{'follow-up ' + m.followup_no + ' of 2'}</Chip>}
            <span className="text-[12px] font-bold" style={{ color: SUB }}>{incoming ? 'From ' + (m.from_address || '?') : 'To ' + (m.to_address || 'no address yet')}</span>
            <span className="text-[11px]" style={{ color: MUTED }}>{String(m.received_at || m.sent_at || m.created_at || '').substring(0, 16).replace('T', ' ')}</span>
          </div>
          {(m.flags || []).map(function (f) { return <div key={f.key} className="mt-1 rounded px-2 py-1 text-[12px] font-bold" style={{ background: '#fef2f2', color: '#7f1d1d', border: '1px solid #fca5a5' }}>{'⚠ ' + f.words}</div>; })}
          {!editing && <div>
            <div className="text-[13px] font-extrabold mt-1" style={{ color: INK }}>{m.subject}</div>
            <div className="text-[13px] mt-1" style={{ color: INK, whiteSpace: 'pre-wrap', maxHeight: incoming ? 320 : 'none', overflowY: incoming ? 'auto' : 'visible' }}>{m.body}</div>
          </div>}
          {(m.attachments || []).length > 0 && <div className="mt-1 flex gap-2 flex-wrap">{m.attachments.map(function (a) { return <button key={a.path} onClick={function () { openFile(a.path); }} className="underline text-[12px] font-bold" style={{ color: '#1d4ed8' }}>{'📎 ' + (a.name || 'file')}</button>; })}</div>}
          {!incoming && (m.approved_by || m.submitted_by) && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{(m.submitted_by ? 'Sent for approval by ' + m.submitted_by : '') + (m.approved_by ? (m.submitted_by ? ' · ' : '') + 'approved by ' + m.approved_by + (m.approved_at ? ' ' + String(m.approved_at).substring(0, 16).replace('T', ' ') : '') : '')}</div>}
          {!incoming && m.last_error && <div className="text-[12px] mt-1 font-bold" style={{ color: m.status === 'draft' ? '#78350f' : '#7f1d1d' }}>{m.last_error}</div>}

          {editing && <div className="mt-2 flex flex-col gap-2">
            <input value={edit.to_address} onChange={function (e) { setEdit(Object.assign({}, edit, { to_address: e.target.value })); }} placeholder="their email address" className={inp} style={inpS} />
            <input value={edit.subject} onChange={function (e) { setEdit(Object.assign({}, edit, { subject: e.target.value })); }} placeholder="subject" className={inp} style={inpS} />
            <textarea value={edit.body} onChange={function (e) { setEdit(Object.assign({}, edit, { body: e.target.value })); }} rows={12} className={inp} style={inpS} />
            {(m.status === 'pending_approval' || m.status === 'approved') && <div className="text-[11px] font-bold" style={{ color: '#78350f' }}>Saving a change sends it back to draft: it has to be approved again.</div>}
            <div className="flex gap-2"><Btn onClick={function () { act({ action: 'edit_message', id: R.id, message_id: m.id, to_address: edit.to_address, subject: edit.subject, body: edit.body }, function (j) { return j.approval_cleared ? 'Saved — back to draft, it needs approval again.' : 'Saved.'; }, function () { setEdit(null); open(R.id); }); }} disabled={busy}>Save</Btn><Btn light onClick={function () { setEdit(null); }}>Cancel</Btn></div>
          </div>}

          {!incoming && !editing && !closed && ['draft', 'pending_approval', 'failed'].indexOf(m.status) >= 0 && <div className="mt-2 flex gap-2 flex-wrap items-center">
            {m.status === 'draft' && <Btn color="#1d4ed8" onClick={function () { act({ action: 'submit', id: R.id, message_id: m.id }, 'Sent for approval.', function () { open(R.id); load(); }); }} disabled={busy}>Send for approval</Btn>}
            {m.status === 'pending_approval' && canApprove && <Btn color="#065f46" onClick={function () { if (!det.mail_ready) { toast.error('The info@ktcus.com mailbox is not connected yet — nothing can be sent.'); return; } act({ action: 'approve', id: R.id, message_id: m.id, seen_hash: m.content_hash }, function (j) { return j.sent ? '✓ Approved and sent from info@ktcus.com.' : 'Approved, but not sent: ' + ((j.send && j.send.error) || 'unknown reason'); }, function () { open(R.id); load(); }); }} disabled={busy}>✓ Approve and send this version</Btn>}
            {m.status === 'pending_approval' && canApprove && <Btn light onClick={function () { setAsk({ msg: m.id, kind: 'send_back', reason: '' }); }}>Send back</Btn>}
            {m.status === 'pending_approval' && !canApprove && <span className="text-[12px] font-bold" style={{ color: '#78350f' }}>Waiting for someone who can approve.</span>}
            {m.status === 'failed' && canApprove && <Btn color="#1d4ed8" onClick={function () { if (m.outcome_unknown) { setAsk({ msg: m.id, kind: 'retry', checked: false }); return; } act({ action: 'retry', id: R.id, message_id: m.id, seen_hash: m.content_hash }, function (j) { return j.sent ? '✓ Sent.' : 'Still not sent: ' + ((j.send && j.send.error) || ''); }, function () { open(R.id); }); }} disabled={busy}>Try again</Btn>}
            <Btn light onClick={function () { setEdit({ id: m.id, to_address: m.to_address || '', subject: m.subject, body: m.body }); }}>✏ Edit</Btn>
            <Btn light onClick={function () { setAsk({ msg: m.id, kind: 'discard', reason: '' }); }}>Discard</Btn>
          </div>}
          {askHere && ask.kind === 'send_back' && <div className="mt-2 flex gap-2 flex-wrap items-center"><input value={ask.reason} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value })); }} placeholder="what should change" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} /><Btn color="#78350f" onClick={function () { act({ action: 'send_back', id: R.id, message_id: m.id, reason: ask.reason }, 'Sent back to draft.', function () { setAsk(null); open(R.id); load(); }); }} disabled={busy}>Send back</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div>}
          {askHere && ask.kind === 'discard' && <div className="mt-2 flex gap-2 flex-wrap items-center"><input value={ask.reason} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value })); }} placeholder="why (optional)" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} /><Btn color="#7f1d1d" onClick={function () { act({ action: 'discard', id: R.id, message_id: m.id, reason: ask.reason }, 'Discarded — it stays in the history.', function () { setAsk(null); open(R.id); load(); }); }} disabled={busy}>Discard</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div>}
          {askHere && ask.kind === 'retry' && <div className="mt-2 rounded-lg p-2" style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
            <div className="text-[12px] font-bold" style={{ color: '#7f1d1d' }}>It is not known whether the first attempt went out. Open the Sent folder of info@ktcus.com (webmail) and look for this message before sending it again.</div>
            <label className="text-[12px] font-bold flex gap-2 items-center mt-1" style={{ color: INK }}><input type="checkbox" checked={!!ask.checked} onChange={function (e) { setAsk(Object.assign({}, ask, { checked: e.target.checked })); }} />I checked — it is not there</label>
            <div className="mt-1 flex gap-2"><Btn color="#1d4ed8" onClick={function () { act({ action: 'retry', id: R.id, message_id: m.id, seen_hash: m.content_hash, checked_sent_folder: !!ask.checked }, function (j) { return j.sent ? '✓ Sent.' : 'Still not sent: ' + ((j.send && j.send.error) || ''); }, function () { setAsk(null); open(R.id); }); }} disabled={busy || !ask.checked}>Send it again</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div></div>}
        </div>;
      })}
    </div>;
  }

  // ── integration health
  var healthBox = health && <div className="rounded-xl p-3 mb-3" style={panel}>
    <div className="flex gap-2 items-center flex-wrap">
      <div className="text-[13px] font-extrabold" style={{ color: INK }}>🔌 What is connected</div>
      {health.usage && <span className="text-[12px] font-bold" style={{ color: SUB }}>{'Paid web search this month: ' + money(health.usage.spent) + ' of ' + money(health.usage.cap) + ' (' + health.usage.searches_used + ' searches)'}</span>}
      <div className="flex-1" />
      <Btn light onClick={function () { setShowHealth(!showHealth); }}>{showHealth ? 'Hide' : 'Show details'}</Btn>
    </div>
    {showHealth && <div className="mt-2 flex flex-col gap-1">
      {health.health.map(function (h) {
        var c = h.ok ? ['#d1fae5', '#065f46', 'CONNECTED'] : h.planned ? ['#e2e8f0', '#334155', 'NOT IN THIS STAGE'] : h.unknown ? ['#fef3c7', '#78350f', 'NOT TESTED'] : ['#fee2e2', '#7f1d1d', 'NOT WORKING'];
        return <div key={h.key} className="flex gap-2 items-start py-1" style={{ borderTop: '1px solid #f1f5f9' }}>
          <Chip bg={c[0]} fg={c[1]}>{c[2]}</Chip>
          <div className="text-[12px]"><b style={{ color: INK }}>{h.label}</b> <span style={{ color: SUB }}>— {h.detail}</span></div></div>;
      })}
      <div className="flex gap-2 flex-wrap mt-1">
        {canApprove && <Btn light onClick={function () { setMailTest({ running: true }); api({ action: 'mail_test' }).then(function (j) { setMailTest(j.ok ? j.test : { ok: false, steps: [{ ok: false, text: j.error || 'Could not run the test.' }] }); }); }} disabled={mailTest && mailTest.running}>{mailTest && mailTest.running ? 'Testing…' : '🔌 Test the mailbox (sends nothing)'}</Btn>}
        <Btn light onClick={function () { act({ action: 'check_mail_now' }, function (j) { return j.inbox.not_configured ? 'The mailbox is not connected yet.' : j.inbox.nothing_sent ? 'Nothing has been sent yet, so there are no replies to look for.' : j.inbox.ok ? 'Checked: ' + j.inbox.stored + ' new reply(ies)' + (j.inbox.bounces ? ', ' + j.inbox.bounces + ' bounce(s)' : '') + (j.followups ? ', ' + j.followups + ' follow-up(s) prepared' : '') + '.' : 'Could not read the mailbox: ' + j.inbox.error; }, function () { load(); }); }} disabled={busy}>📥 Check for replies now</Btn>
      </div>
      {mailTest && !mailTest.running && <div className="mt-1 rounded-lg p-2" style={{ background: mailTest.ok ? '#ecfdf5' : '#fef2f2', border: '1px solid ' + (mailTest.ok ? '#6ee7b7' : '#fca5a5') }}>
        {(mailTest.steps || []).map(function (st, i) { return <div key={i} className="text-[12px] font-bold" style={{ color: st.ok ? '#065f46' : '#7f1d1d' }}>{(st.ok ? '✓ ' : '✗ ') + st.text}</div>; })}
        {mailTest.sender && <div className="text-[12px] mt-1" style={{ color: SUB }}>{'Signature: ' + mailTest.sender}</div>}</div>}
      {health.usage && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{'The $' + health.usage.cap.toFixed(0) + ' cap covers the search fee ($0.01 a search; a run uses up to 6). The AI’s reading and writing is billed separately by the AI account: ' + (health.usage.input_tokens + health.usage.output_tokens).toLocaleString('en-US') + ' tokens used by research this month.'}</div>}
    </div>}
  </div>;

  // ── new request form
  if (form) {
    var F = function (k, v) { var n = Object.assign({}, form); n[k] = v; setForm(n); };
    return <div className="nt-paper rounded-xl p-3" style={panel}>
      <div className="flex gap-2 items-center mb-2"><div className="text-[16px] font-extrabold" style={{ color: INK }}>New sourcing request</div><div className="flex-1" /><Btn light onClick={function () { setForm(null); }}>✕ Close</Btn></div>
      <div className="text-[12px] mb-3" style={{ color: SUB }}>It becomes a numbered assignment (SR-…) with you as the owner. Nothing is searched or sent until you say so.</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <label className="text-[12px] font-bold" style={{ color: SUB }}>For which company
          <select value={form.company} onChange={function (e) { F('company', e.target.value); }} className={inp + ' w-full mt-1'} style={inpS}><option value="">— pick —</option>{COMPANIES.map(function (c) { return <option key={c} value={c}>{c}</option>; })}</select></label>
        <label className="text-[12px] font-bold" style={{ color: SUB }}>What is this
          <select value={form.direction} onChange={function (e) { F('direction', e.target.value); }} className={inp + ' w-full mt-1'} style={inpS}><option value="">— pick —</option>{DIRECTIONS.map(function (d) { return <option key={d.key} value={d.key}>{d.label + ' — ' + d.hint}</option>; })}</select></label>
        <label className="text-[12px] font-bold" style={{ color: SUB, gridColumn: '1 / -1' }}>Product or service
          <input value={form.product} onChange={function (e) { F('product', e.target.value); }} placeholder="for example: used Caterpillar 950 wheel loaders, 2015 or newer" className={inp + ' w-full mt-1'} style={inpS} /></label>
        <label className="text-[12px] font-bold" style={{ color: SUB, gridColumn: '1 / -1' }}>Specifications (what a supplier needs to know)
          <textarea value={form.specs} onChange={function (e) { F('specs', e.target.value); }} rows={3} placeholder="size, grade, condition, standard, colour, packing…" className={inp + ' w-full mt-1'} style={inpS} /></label>
        <label className="text-[12px] font-bold" style={{ color: SUB }}>Quantity
          <input value={form.quantity} onChange={function (e) { F('quantity', e.target.value); }} placeholder="for example: 3 units, or 2 × 40ft" className={inp + ' w-full mt-1'} style={inpS} /></label>
        <label className="text-[12px] font-bold" style={{ color: SUB }}>Destination
          <input value={form.destination} onChange={function (e) { F('destination', e.target.value); }} placeholder="for example: Alexandria, Egypt" className={inp + ' w-full mt-1'} style={inpS} /></label>
        <label className="text-[12px] font-bold" style={{ color: SUB }}>Needed by (optional)
          <input type="date" value={form.needed_by} onChange={function (e) { F('needed_by', e.target.value); }} className={inp + ' w-full mt-1'} style={inpS} /></label>
        <label className="text-[12px] font-bold" style={{ color: SUB }}>Answer due (optional)
          <input type="date" value={form.due_date} onChange={function (e) { F('due_date', e.target.value); }} className={inp + ' w-full mt-1'} style={inpS} /></label>
        <label className="text-[12px] font-bold" style={{ color: '#7f1d1d', gridColumn: '1 / -1' }}>🔒 Internal note — stays inside KTC (target price, limits, who asked)
          <textarea value={form.internal_note} onChange={function (e) { F('internal_note', e.target.value); }} rows={2} placeholder="never sent to a supplier and never given to the web research" className={inp + ' w-full mt-1'} style={Object.assign({}, inpS, { border: '1px solid #fca5a5' })} /></label>
        <label className="text-[12px] font-bold rounded-lg px-3 py-2" style={{ color: INK, background: '#f1f5f9', border: '1px dashed #94a3b8', cursor: 'pointer', gridColumn: '1 / -1' }}>📎 {form.files && form.files.length ? form.files.length + ' file(s) chosen' : 'Attach a photo or a specification sheet (optional, up to 5)'}
          <input type="file" multiple accept="application/pdf,image/*" onChange={function (e) { F('files', e.target.files); }} style={{ display: 'none' }} /></label>
      </div>
      <div className="mt-3 flex gap-2"><Btn big onClick={saveForm} disabled={busy}>{busy ? 'Saving…' : 'Create the request'}</Btn><Btn big light onClick={function () { setForm(null); }}>Cancel</Btn></div>
    </div>;
  }

  // ── one request
  if (det) {
    var R = det.request; var sc = STAGE_COLORS[R.stage] || STAGE_COLORS.new;
    var live = (det.jobs || []).filter(function (j) { return j.status === 'queued' || j.status === 'running'; })[0];
    var lastJob = (det.jobs || [])[0];
    var closed = R.stage === 'closed';
    return <div className="nt-paper rounded-xl p-3" style={panel}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <Btn light onClick={function () { setDet(null); load(); }}>← Back to requests</Btn>
        <div className="text-[17px] font-extrabold" style={{ color: INK }}>{R.label}</div>
        <Chip bg={sc[0]} fg={sc[1]}>{R.stage_label}</Chip>
        <span className="text-[12px] font-bold" style={{ color: SUB }}>{R.company + ' · ' + dirLabel(R.direction)}</span>
        <div className="flex-1" /><Btn light onClick={function () { setDet(null); load(); }}>✕ Close</Btn>
      </div>
      <div className="rounded-lg p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-[15px] font-extrabold" style={{ color: INK }}>{R.product}</div>
        {R.specs && <div className="text-[13px] mt-1" style={{ color: SUB, whiteSpace: 'pre-wrap' }}>{R.specs}</div>}
        <div className="text-[12px] mt-1 flex gap-4 flex-wrap" style={{ color: SUB }}>
          {R.quantity && <span><b>Quantity:</b> {R.quantity}</span>}{R.destination && <span><b>Destination:</b> {R.destination}</span>}{R.needed_by && <span><b>Needed by:</b> {R.needed_by}</span>}
          <span><b>Owner:</b> {R.owner || '—'}</span>{R.due_date && <span><b>Due:</b> {R.due_date}</span>}
        </div>
        {R.internal_note && <div className="text-[12px] mt-2 rounded px-2 py-1" style={{ background: '#fef2f2', color: '#7f1d1d', border: '1px solid #fca5a5' }}><b>🔒 Internal (never sent, never searched):</b> {R.internal_note}</div>}
        {(R.attachments || []).length > 0 && <div className="mt-2 flex gap-2 flex-wrap">{R.attachments.map(function (a) { return <button key={a.path} onClick={function () { openFile(a.path); }} className="underline text-[12px] font-bold" style={{ color: '#1d4ed8' }}>{'📎 ' + (a.name || 'file')}</button>; })}</div>}
      </div>

      <div className="rounded-lg p-3 mb-3" style={{ background: '#eff6ff', border: '1px solid #93c5fd' }}>
        <div className="text-[11px] font-extrabold" style={{ color: '#1e3a8a' }}>NEXT STEP</div>
        <div className="text-[14px] font-extrabold" style={{ color: INK }}>{closed ? 'Closed: ' + (R.closed_reason || '') : (R.next_action || R.stage_words)}</div>
        {!closed && <div className="mt-2 flex gap-2 flex-wrap items-center">
          {!live && <Btn big color="#0f766e" onClick={function () { if (!canResearch) { toast.error('Starting paid web research needs the “Commercial: Start web research” permission — ask an admin in Settings.'); return; } setAsk({ kind: 'research' }); }} disabled={busy}>{'🔎 ' + (det.shortlist.length ? 'Research again' : 'Research suppliers on the web')}</Btn>}
          {live && <span className="text-[13px] font-extrabold" style={{ color: '#1e3a8a' }}>{live.status === 'running' ? '⏳ Researching now…' : '⏳ Waiting for the worker (it runs every 5 minutes)'}</span>}
          {live && <Btn color="#1d4ed8" onClick={function () { act({ action: 'run_now', id: R.id }, function (j) { var r = j.result || {}; return !j.ran ? 'Nothing was waiting.' : r.ok ? '✓ Research finished — ' + ((r.result && r.result.found) || 0) + ' supplier(s) proposed.' : 'Research did not finish: ' + (r.error || (r.cap ? 'the monthly cap is reached' : 'see the request')) + (r.will_retry ? ' It will try again.' : ''); }, function () { open(R.id); load(); }); }} disabled={busy}>{busy ? 'Working… (can take a few minutes)' : '▶ Run now'}</Btn>}
          <Btn light onClick={function () { setAsk({ kind: 'supplier', legal_name: '', website: '', country: '', role: 'unknown', products: '' }); }}>＋ Add a supplier I know</Btn>
          <Btn light onClick={function () { setAsk({ kind: 'next', next_action: R.next_action || '', due_date: R.due_date || '' }); }}>✏ Next step / due date</Btn>
          <Btn light onClick={function () { setAsk({ kind: 'close', reason: '' }); }}>Close this request</Btn>
        </div>}
        {closed && <div className="mt-2"><Btn light onClick={function () { act({ action: 'reopen', id: R.id }, 'Reopened.', function () { open(R.id); }); }}>Reopen</Btn></div>}

        {ask && ask.kind === 'research' && <div className="mt-2 rounded-lg p-2" style={{ background: '#ffffff', border: '1px solid #0f766e' }}>
          <div className="text-[13px] font-bold" style={{ color: INK }}>{'This uses paid web search: up to 6 searches (at most $0.06) plus the AI’s reading. This month so far: ' + (det.usage ? money(det.usage.spent) + ' of ' + money(det.usage.cap) : 'unknown') + '.'}</div>
          <div className="text-[12px]" style={{ color: SUB }}>The agent only reads public pages. It contacts nobody, and your internal note is not given to it.</div>
          <div className="mt-2 flex gap-2"><Btn color="#0f766e" onClick={function () { act({ action: 'start_research', id: R.id }, 'Research queued.', function () { setAsk(null); open(R.id); }); }} disabled={busy}>Yes, start the research</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div></div>}
        {ask && ask.kind === 'next' && <div className="mt-2 rounded-lg p-2 flex gap-2 flex-wrap items-center" style={{ background: '#ffffff', border: '1px solid #93c5fd' }}>
          <input value={ask.next_action} onChange={function (e) { setAsk(Object.assign({}, ask, { next_action: e.target.value })); }} placeholder="the next step" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
          <input type="date" value={ask.due_date} onChange={function (e) { setAsk(Object.assign({}, ask, { due_date: e.target.value })); }} className={inp} style={inpS} />
          <Btn onClick={function () { act({ action: 'update', id: R.id, next_action: ask.next_action, due_date: ask.due_date }, 'Saved.', function () { setAsk(null); open(R.id); }); }} disabled={busy}>Save</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div>}
        {ask && ask.kind === 'close' && <div className="mt-2 rounded-lg p-2 flex gap-2 flex-wrap items-center" style={{ background: '#ffffff', border: '1px solid #93c5fd' }}>
          <input value={ask.reason} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value })); }} placeholder="why it is closed: done, cancelled, not worth it…" className={inp} style={Object.assign({ flex: '1 1 300px' }, inpS)} />
          <Btn color="#7f1d1d" onClick={function () { act({ action: 'update', id: R.id, stage: 'closed', closed_reason: ask.reason }, 'Closed.', function () { setAsk(null); open(R.id); }); }} disabled={busy}>Close the request</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div>}
        {ask && ask.kind === 'supplier' && <div className="mt-2 rounded-lg p-2" style={{ background: '#ffffff', border: '1px solid #93c5fd' }}>
          <div className="flex gap-2 flex-wrap items-center">
            <input value={ask.legal_name} onChange={function (e) { setAsk(Object.assign({}, ask, { legal_name: e.target.value })); }} placeholder="supplier name" className={inp} style={Object.assign({ flex: '1 1 220px' }, inpS)} />
            <input value={ask.website} onChange={function (e) { setAsk(Object.assign({}, ask, { website: e.target.value })); }} placeholder="website (optional)" className={inp} style={Object.assign({ flex: '1 1 180px' }, inpS)} />
            <input value={ask.country} onChange={function (e) { setAsk(Object.assign({}, ask, { country: e.target.value })); }} placeholder="country" className={inp} style={Object.assign({ width: 130 }, inpS)} />
            <select value={ask.role} onChange={function (e) { setAsk(Object.assign({}, ask, { role: e.target.value })); }} className={inp} style={inpS}>{ROLES.map(function (r) { return <option key={r} value={r}>{r}</option>; })}</select>
            <Btn onClick={function () { act({ action: 'add_supplier', request_id: R.id, legal_name: ask.legal_name, website: ask.website, country: ask.country, role: ask.role }, function (j) { return j.existing ? 'Already on file as “' + j.existing_name + '” — that record was used, no duplicate made.' : '✓ Supplier added.'; }, function () { setAsk(null); open(R.id); }); }} disabled={busy}>Add</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div></div>}
      </div>

      {det.threads_ready && !det.mail_ready && det.shortlist.some(function (x) { return (x.thread || []).length; }) && <div className="rounded-lg p-2 mb-3 text-[12px] font-bold" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#78350f' }}>Sending is not connected yet: drafts can be written and sent for approval, but nothing goes out until the info@ktcus.com mailbox is added on the server.</div>}
      {lastJob && lastJob.status === 'done' && lastJob.result && <div className="rounded-lg p-2 mb-3 text-[12px]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: SUB }}>
        <b style={{ color: INK }}>Last research:</b> {lastJob.result.summary || '—'} <span style={{ color: MUTED }}>{'· ' + (lastJob.searches || 0) + ' search(es), ' + (lastJob.result.pages_seen || 0) + ' pages seen'}</span>
        {(lastJob.result.dropped || []).length > 0 && <div className="mt-1" style={{ color: '#78350f' }}>{'Left out because nothing could be tied to a page the search returned: ' + lastJob.result.dropped.map(function (d) { return d.name; }).join(', ') + '.'}</div>}
        {(lastJob.result.facts_dropped > 0 || lastJob.result.contacts_dropped > 0) && <div style={{ color: '#78350f' }}>{lastJob.result.facts_dropped + ' statement(s) and ' + lastJob.result.contacts_dropped + ' contact(s) were not saved for the same reason.'}</div>}
      </div>}
      {lastJob && lastJob.status === 'failed' && <div className="rounded-lg p-2 mb-3 text-[12px] font-bold" style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d' }}>{'Last research did not finish: ' + (lastJob.last_error || 'unknown reason')}</div>}

      <div className="text-[14px] font-extrabold mb-1" style={{ color: INK }}>{'Shortlist (' + det.shortlist.length + ')'}</div>
      {det.shortlist.length === 0 && <div className="text-[13px] rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: SUB }}>No suppliers yet. Start the research, or add a supplier you already know.</div>}
      {det.shortlist.map(function (x) {
        var s = x.supplier; var stc = x.status === 'kept' ? ['#d1fae5', '#065f46', 'KEPT'] : x.status === 'dropped' ? ['#e2e8f0', '#475569', 'DROPPED'] : ['#fef3c7', '#78350f', 'PROPOSED'];
        var dAsk = ask && ask.kind === 'drop' && ask.id === x.shortlist_id; var fAsk = ask && ask.kind === 'fact' && ask.supplier_id === x.supplier_id; var rAsk = ask && ask.kind === 'retract' && ask.supplier_id === x.supplier_id;
        return <div key={x.shortlist_id} className="rounded-xl p-3 mb-2" style={{ background: '#ffffff', border: '1px solid ' + (x.status === 'kept' ? '#6ee7b7' : '#cbd5e1'), opacity: x.status === 'dropped' ? 0.75 : 1 }}>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="text-[15px] font-extrabold" style={{ color: INK }}>{s.legal_name}</div>
            <Chip bg={stc[0]} fg={stc[1]}>{stc[2]}</Chip>
            <Chip bg="#f1f5f9" fg="#334155">{s.role}</Chip>
            {x.added_by_kind === 'agent' ? <Chip bg="#ede9fe" fg="#5b21b6">found by the agent</Chip> : <Chip bg="#e0f2fe" fg="#075985">added by a person</Chip>}
            <span className="text-[12px]" style={{ color: SUB }}>{[s.city, s.country].filter(Boolean).join(', ')}</span>
            {s.website && <a href={s.website} target="_blank" rel="noopener noreferrer" className="underline text-[12px] font-bold" style={{ color: '#1d4ed8' }}>{s.website.replace(/^https?:\/\//, '')}</a>}
          </div>
          {s.products && <div className="text-[12px] mt-1" style={{ color: SUB }}><b>Sells:</b> {s.products}</div>}
          {x.fit_note && <div className="text-[12px] mt-1" style={{ color: '#065f46' }}><b>Why it fits:</b> {x.fit_note}</div>}
          {x.concerns && <div className="text-[12px] mt-1" style={{ color: '#78350f' }}><b>Open concerns:</b> {x.concerns}</div>}
          {x.status === 'dropped' && <div className="text-[12px] mt-1 font-bold" style={{ color: '#475569' }}>Dropped: {x.dropped_reason}</div>}

          <div className="mt-2">
            {x.facts.map(function (f) { var gr = GRADE[f.grade] || GRADE.claim;
              return <div key={f.id} className="flex gap-2 items-start py-1 text-[12px]" style={{ borderTop: '1px solid #f1f5f9', opacity: f.retracted ? 0.55 : 1 }}>
                <Chip bg={gr[0]} fg={gr[1]}>{gr[2]}</Chip>
                <div className="flex-1 min-w-0" style={{ color: INK }}>
                  <span style={{ textDecoration: f.retracted ? 'line-through' : 'none' }}><b>{f.topic}:</b> {f.statement}</span>
                  <div style={{ color: MUTED }}>
                    {f.source_url ? <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="underline font-bold" style={{ color: '#1d4ed8' }}>{'source: ' + (f.source_title || f.source_url).substring(0, 70)}</a> : <span>no link</span>}
                    {' · seen ' + f.observed_on + ' · confidence ' + f.confidence}{f.evidence_note ? ' · evidence: ' + f.evidence_note : ''}{f.retracted ? ' · RETRACTED: ' + f.retracted_why : ''}
                  </div>
                </div>
                {!f.retracted && !closed && <button onClick={function () { setAsk({ kind: 'retract', supplier_id: x.supplier_id, fact_id: f.id, reason: '' }); }} className="underline text-[11px] font-bold" style={{ color: '#7f1d1d' }}>wrong?</button>}
              </div>; })}
            {x.contacts.map(function (c) { return <div key={c.id} className="flex gap-2 items-start py-1 text-[12px]" style={{ borderTop: '1px solid #f1f5f9', color: INK }}>
              <Chip bg={c.verified ? '#d1fae5' : '#f1f5f9'} fg={c.verified ? '#065f46' : '#334155'}>{c.verified ? 'CONTACT ✓' : 'CONTACT (not confirmed)'}</Chip>
              <div className="flex-1 min-w-0">{[c.name, c.title, c.email, c.phone, c.whatsapp ? 'WhatsApp ' + c.whatsapp : ''].filter(Boolean).join(' · ')}
                {c.source_url && <div><a href={c.source_url} target="_blank" rel="noopener noreferrer" className="underline font-bold" style={{ color: '#1d4ed8' }}>found on this page</a><span style={{ color: MUTED }}>{c.found_on ? ' · ' + c.found_on : ''}</span></div>}</div></div>; })}
          </div>

          {!closed && <div className="mt-2 flex gap-2 flex-wrap items-center">
            {x.status !== 'kept' && <Btn color="#065f46" onClick={function () { act({ action: 'decide', id: R.id, shortlist_id: x.shortlist_id, decision: 'keep' }, 'Kept.', function () { open(R.id); }); }} disabled={busy}>✓ Keep</Btn>}
            {x.status !== 'dropped' && <Btn light onClick={function () { setAsk({ kind: 'drop', id: x.shortlist_id, reason: '' }); }}>✕ Drop</Btn>}
            {x.status === 'kept' && !(x.thread || []).some(function (m) { return m.direction === 'out' && ['sent', 'bounced', 'draft', 'pending_approval', 'approved', 'sending', 'failed'].indexOf(m.status) >= 0; }) && <Btn color="#4338ca" onClick={function () { act({ action: 'prepare_draft', id: R.id, supplier_id: x.supplier_id }, function (j) { return j.has_contact ? '✉ Draft prepared — read it, then send it for approval.' : '✉ Draft prepared — no email address is on file yet: add one in the draft.'; }, function () { open(R.id); }); }} disabled={busy}>✉ Prepare an outreach draft</Btn>}
            <Btn light onClick={function () { setAsk({ kind: 'fact', supplier_id: x.supplier_id, topic: '', statement: '', grade: 'claim', source_url: '', evidence_note: '' }); }}>＋ Add a fact</Btn>
          </div>}
          {dAsk && <div className="mt-2 flex gap-2 flex-wrap items-center rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
            <input value={ask.reason} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value })); }} placeholder="why drop it" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
            <Btn color="#7f1d1d" onClick={function () { act({ action: 'decide', id: R.id, shortlist_id: x.shortlist_id, decision: 'drop', reason: ask.reason }, 'Dropped.', function () { setAsk(null); open(R.id); }); }} disabled={busy}>Drop</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div>}
          {rAsk && <div className="mt-2 flex gap-2 flex-wrap items-center rounded-lg p-2" style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
            <input value={ask.reason} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value })); }} placeholder="why this fact is wrong" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
            <Btn color="#7f1d1d" onClick={function () { act({ action: 'retract_fact', id: R.id, fact_id: ask.fact_id, reason: ask.reason }, 'Retracted — it stays on file, struck through.', function () { setAsk(null); open(R.id); }); }} disabled={busy}>Retract</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div>}
          {fAsk && <div className="mt-2 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
            <div className="flex gap-2 flex-wrap items-center">
              <select value={ask.grade} onChange={function (e) { setAsk(Object.assign({}, ask, { grade: e.target.value })); }} className={inp} style={inpS}><option value="verified">VERIFIED — I have evidence</option><option value="claim">CLAIM — they say so</option><option value="estimate">ESTIMATE</option></select>
              <input value={ask.topic} onChange={function (e) { setAsk(Object.assign({}, ask, { topic: e.target.value })); }} placeholder="topic (price, MOQ, lead time…)" className={inp} style={Object.assign({ width: 190 }, inpS)} />
              <input value={ask.statement} onChange={function (e) { setAsk(Object.assign({}, ask, { statement: e.target.value })); }} placeholder="the fact" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
            </div>
            <div className="flex gap-2 flex-wrap items-center mt-2">
              <input value={ask.source_url} onChange={function (e) { setAsk(Object.assign({}, ask, { source_url: e.target.value })); }} placeholder="source link (optional)" className={inp} style={Object.assign({ flex: '1 1 220px' }, inpS)} />
              {ask.grade === 'verified' && <input value={ask.evidence_note} onChange={function (e) { setAsk(Object.assign({}, ask, { evidence_note: e.target.value })); }} placeholder="what you saw: their reply, a document, a call" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />}
              <Btn onClick={function () { act({ action: 'add_fact', id: R.id, supplier_id: x.supplier_id, grade: ask.grade, topic: ask.topic, statement: ask.statement, source_url: ask.source_url, evidence_note: ask.evidence_note }, 'Fact added.', function () { setAsk(null); open(R.id); }); }} disabled={busy}>Save fact</Btn><Btn light onClick={function () { setAsk(null); }}>Cancel</Btn></div></div>}
          {renderThread(x, R, closed)}
        </div>;
      })}
    </div>;
  }

  // ── the list
  var shown = (list || []).filter(function (r) { return fStage === 'all' ? true : fStage === 'open' ? r.stage !== 'closed' : r.stage === fStage; });
  return <div>
    {healthBox}
    {approvals && approvals.length > 0 && <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', border: '2px solid #f59e0b', color: INK }}>
      <div className="text-[14px] font-extrabold mb-1" style={{ color: '#78350f' }}>{'✍ Waiting for approval (' + approvals.length + ')' + (canApprove ? '' : ' — someone who can approve will see these')}</div>
      {approvals.map(function (a) { return <button key={a.id} onClick={function () { open(a.request_id); }} className="w-full text-left rounded-lg px-3 py-2 mb-1" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: INK }}>
        <span className="font-extrabold" style={{ color: '#1d4ed8' }}>{a.label}</span><span className="font-bold">{' · ' + a.supplier + ' · ' + (a.kind === 'followup' ? 'follow-up' : a.kind === 'reply' ? 'reply' : 'first message')}</span>
        <div className="text-[12px]" style={{ color: SUB }}>{'To ' + (a.to || '?') + ' — “' + a.subject + '”' + (a.by ? ' · sent for approval by ' + a.by : '')}</div></button>; })}
    </div>}
    <div className="nt-paper rounded-xl p-3" style={panel}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-[17px] font-extrabold" style={{ color: INK }}>🧭 Sourcing desk</div>
        <span className="text-[12px]" style={{ color: SUB }}>Every request is a numbered assignment. The agent researches and drafts; nothing is sent until an approver approves the exact message.</span>
        <div className="flex-1" />
        <Btn big onClick={function () { setForm({ company: '', direction: '', product: '', specs: '', quantity: '', destination: '', needed_by: '', due_date: '', internal_note: '', files: null }); }}>＋ New request</Btn>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {[['open', 'Open'], ['new', 'New'], ['researching', 'Researching'], ['shortlist', 'Shortlist ready'], ['drafts_ready', 'Drafts ready'], ['in_contact', 'In contact'], ['on_hold', 'On hold'], ['closed', 'Closed'], ['all', 'All']].map(function (f) {
          var n = (list || []).filter(function (r) { return f[0] === 'all' ? true : f[0] === 'open' ? r.stage !== 'closed' : r.stage === f[0]; }).length;
          return <button key={f[0]} onClick={function () { setFStage(f[0]); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={fStage === f[0] ? { background: '#0f172a', color: '#ffffff' } : { background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' }}>{f[1] + ' (' + n + ')'}</button>; })}
        <div className="flex-1" /><Btn light onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</Btn>
      </div>
      {err && <div className="rounded-lg p-3 text-[13px] font-bold" style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d' }}>{'⛔ ' + err}</div>}
      {!err && list === null && <div className="text-[13px]" style={{ color: SUB }}>Loading…</div>}
      {!err && list !== null && shown.length === 0 && <div className="text-[13px] rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: SUB }}>{(list || []).length === 0 ? 'No requests yet. Press “＋ New request” to give the desk its first assignment.' : 'Nothing in this view.'}</div>}
      {shown.map(function (r) { var c = STAGE_COLORS[r.stage] || STAGE_COLORS.new;
        return <button key={r.id} onClick={function () { open(r.id); }} className="w-full text-left rounded-xl p-3 mb-2" style={{ background: '#ffffff', border: '1px solid ' + (r.overdue ? '#fca5a5' : '#cbd5e1'), color: INK }}>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[14px] font-extrabold" style={{ color: '#1d4ed8' }}>{r.label}</span>
            <Chip bg={c[0]} fg={c[1]}>{r.stage_label}</Chip>
            <span className="text-[14px] font-extrabold" style={{ color: INK }}>{r.title}</span>
            <div className="flex-1" />
            {r.due_date && <span className="text-[12px] font-extrabold" style={{ color: r.overdue ? '#b91c1c' : SUB }}>{(r.overdue ? '⚠ overdue · ' : 'due ') + r.due_date}</span>}
          </div>
          <div className="text-[12px] mt-1" style={{ color: SUB }}>{r.company + ' · ' + dirLabel(r.direction) + ' · owner ' + (r.owner || '—') + ' · suppliers: ' + r.shortlist.kept + ' kept, ' + r.shortlist.proposed + ' to review' + (r.shortlist.dropped ? ', ' + r.shortlist.dropped + ' dropped' : '')}</div>
          {r.next_action && <div className="text-[12px] mt-1 font-bold" style={{ color: '#1e3a8a' }}>{'Next: ' + r.next_action}</div>}
        </button>; })}
    </div>
  </div>;
}
