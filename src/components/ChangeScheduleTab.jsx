'use client';
// v55.83-XH — Change Schedule (aka Releases) — release-governance session, 22 Nov 2026.
// A plain-English release register for Max: what is live on production, what is waiting on
// fix staging, and what each change still needs before it moves (Codex pass · Max's go · data
// flag), plus how a move happens and un-happens. Reads the hand-editable register via the
// read-only /api/releases route (release-management/release-register.json). Shows nothing it
// cannot read. v55.83-YJ: the super admin can also record a go / a roll-back request for a change
// (/api/releases/signoff). Hub releases are not handled on this screen. Visual spec: dark + gold, matching the warehouse Change-Schedule
// preview, using the Hub's JetBrains Mono for mono accents.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

var C = {
  bg: '#0a0e1a', panel: '#111827', card: '#151c2e',
  line: 'rgba(255,255,255,.09)', ink: '#eef1f6', muted: '#9aa3b2',
  gold: '#d4a72c', gold2: '#f2cf5b',
  prod: '#34d399', stage: '#f2cf5b', codex: '#38bdf8', max: '#f8a33b', data: '#c4b5fd',
  mono: '"JetBrains Mono", ui-monospace, monospace'
};

function Tag(props) {
  var color = props.color, label = props.label;
  var border = { prod: '#1f6e53', stage: '#8a6f1a', codex: '#1d5e82', max: '#8a5a1a', data: '#5b4ea8' }[color] || C.line;
  var tint = { prod: 'rgba(52,211,153,.1)', stage: 'rgba(242,207,91,.1)', codex: 'rgba(56,189,248,.1)', max: 'rgba(248,163,59,.12)', data: 'rgba(196,181,253,.1)' }[color] || 'transparent';
  var text = C[color] || C.ink;
  return (
    <span style={{ font: '700 10.5px system-ui, sans-serif', padding: '3px 9px', borderRadius: 999, border: '1px solid ' + border, color: text, background: tint }}>
      {label}
    </span>
  );
}

// v55.83-YJ — every call carries the sign-in; the server decides who may do what.
function callApi(path, method, body) {
  return supabase.auth.getSession().then(function (s) {
    var token = s && s.data && s.data.session ? s.data.session.access_token : '';
    var headers = { 'Content-Type': 'application/json' };
    if (token) { headers['Authorization'] = 'Bearer ' + token; }
    var opts = { method: method || 'GET', cache: 'no-store', headers: headers };
    if (body) { opts.body = JSON.stringify(body); }
    return fetch(path, opts);
  }).then(function (r) { return r.json(); });
}

var btn = function (color, solid) {
  return { font: '700 12px system-ui, sans-serif', padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: '1px solid ' + color, color: solid ? '#0a0e1a' : color, background: solid ? color : 'transparent' };
};
function fmtWhen(v) { if (!v) { return ''; } try { return new Date(v).toLocaleString(); } catch (e) { return String(v); } }

// v55.83-YJ — the sign-off / roll-back box under one change. Typing the name of the change is the confirmation.
function SignBox(props) {
  var it = props.item; var sg = props.sign || {};
  var os = useState(''); var open = os[0]; var setOpen = os[1];
  var ts = useState(''); var typed = ts[0]; var setTyped = ts[1];
  var bs = useState(false); var busy = bs[0]; var setBusy = bs[1];
  var ms = useState(null); var msg = ms[0]; var setMsg = ms[1];

  function send() {
    setBusy(true); setMsg(null);
    callApi(open === 'check' ? '/api/releases/check' : '/api/releases/signoff', 'POST', open === 'check' ? { item_id: it.id, head: sg.head, note: typed } : { item_id: it.id, action: open, confirm: typed, heads: { [it.id]: sg.head }, builds: { [it.id]: it.manifest && it.manifest.sha } })
      .then(function (j) {
        if (j && j.ok) { setMsg({ ok: true, text: j.note || 'Recorded.' }); setOpen(''); setTyped(''); props.onDone(); }
        else { setMsg({ ok: false, text: (j && j.error) || 'It could not be recorded. Nothing was changed.' }); }
      })
      .catch(function () { setMsg({ ok: false, text: 'The Hub could not be reached. Nothing was changed.' }); })
      .then(function () { setBusy(false); });
  }

  var label = { go: 'Sign off: go to production', rollback: 'Ask to roll this back', withdraw: 'Take it back', check: 'Record production verification' };
  var ask = { go: 'This records your go for this exact build. To confirm, type the name of the change:', rollback: 'This records your request to put this change back to what it was before. To confirm, type the name of the change:', withdraw: 'This takes your go / roll-back request back. To confirm, type the name of the change:' };
  return (
    <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed ' + C.line, paddingTop: 9, marginTop: 2, fontSize: '.82rem' }}>
      {sg.kind === 'go' && <div style={{ color: C.prod }}><b>Queued for deployment</b>{sg.by ? ' by ' + sg.by : ''}{sg.at ? ' · ' + fmtWhen(sg.at) : ''}{sg.sha ? ' · build ' + String(sg.sha).substring(0, 7) : ''}.</div>}
      {sg.kind === 'rollback' && <div style={{ color: C.max }}><b>Roll back requested</b>{sg.by ? ' by ' + sg.by : ''}{sg.at ? ' · ' + fmtWhen(sg.at) : ''}{sg.sha ? ' · of build ' + String(sg.sha).substring(0, 7) : ''}. The restore itself is done from the KTC office PC.</div>}
      {sg.kind === 'unknown' && <div style={{ color: C.muted }}>Sign-off status is not available right now.</div>}
      {sg.problem && <div style={{ color: '#fca5a5' }}>{sg.problem}</div>}
      {sg.why && <div style={{ color: C.muted }}>{sg.why}</div>}
      {!open && (sg.canWithdraw || sg.canCheck) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {sg.canWithdraw && <button style={btn(C.muted, false)} onClick={function () { setOpen('withdraw'); setMsg(null); }}>{label.withdraw}</button>}
          {sg.canCheck && <button style={btn(C.prod, false)} onClick={function () { setOpen('check'); setMsg(null); }}>Record production verification</button>}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 6, background: C.panel, border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ color: C.ink }}>{open === 'check' ? 'What did you test on the live warehouse, and what was the result?' : ask[open]}</div>
          {open === 'rollback' && sg.liveBuild && <div style={{ color: C.muted, marginTop: 4 }}>What will be undone: build <b style={{ fontFamily: C.mono, color: C.ink }}>{String(sg.liveBuild).substring(0, 7)}</b>, restored from <span style={{ fontFamily: C.mono }}>{sg.liveBackup}</span>.</div>}
          <div style={{ font: '700 12px ' + C.mono, color: C.gold2, margin: '4px 0 6px' }}>{it.title}</div>
          <input value={typed} onChange={function (e) { setTyped(e.target.value); }} placeholder={open === 'check' ? 'Production test notes' : 'Type the name here'} style={{ boxSizing: 'border-box', width: '100%', maxWidth: 520, padding: '7px 9px', borderRadius: 6, border: '1px solid ' + C.line, background: '#0a0e1a', color: C.ink, font: '500 13px system-ui, sans-serif' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button disabled={busy} style={btn(open === 'go' ? C.prod : C.max, true)} onClick={send}>{busy ? 'Recording…' : label[open]}</button>
            <button disabled={busy} style={btn(C.muted, false)} onClick={function () { setOpen(''); setTyped(''); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 6, color: msg.ok ? C.prod : '#fca5a5' }}>{msg.text}</div>}
    </div>
  );
}

function whereOf(it, sign) {
  if (sign && sign.where) { return sign.where; }
  return it && it.status === 'live' ? 'live' : 'staging';
}

// v55.83-YJ — the change history: every approval, request, move, check and roll back, newest first.
function History(props) {
  var rows = props.rows || [];
  var ss = useState(false); var all = ss[0]; var setAll = ss[1];
  var shown = all ? rows : rows.slice(0, 15);
  var tone = { go: C.prod, checked_live: C.prod, moved: C.max, rollback: C.max, rolled_back: C.max, failed: '#fca5a5', rollback_failed: '#fca5a5', recovery_incomplete: '#fca5a5', recovery_confirmed: C.prod, withdraw: C.muted, 'codex-pass': C.codex, 'behavioral-qa': C.codex };
  return (
    <section>
      <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 9 }}>
        Change history
        <span style={{ font: '700 10px ' + C.mono, padding: '2px 8px', borderRadius: 999, letterSpacing: '.05em', textTransform: 'uppercase', background: 'rgba(56,189,248,.12)', color: C.codex }}>{rows.length} entries</span>
      </h2>
      <p style={{ color: C.muted, fontSize: '.86rem', margin: '0 0 10px', maxWidth: '80ch' }}>
        Every approval, roll-back request, move, check and roll back of a warehouse change, newest first. An entry is never changed or removed.
      </p>
      {props.note && <div style={{ color: C.max, fontSize: '.84rem', marginBottom: 8 }}>{props.note}</div>}
      {!rows.length && !props.note && <div style={{ color: C.muted, fontSize: '.86rem' }}>Nothing recorded yet.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {shown.map(function (h) {
          return (
            <div key={h.key} style={{ background: C.card, border: '1px solid ' + C.line, borderLeft: '3px solid ' + (tone[h.action] || C.line), borderRadius: 8, padding: '8px 12px', fontSize: '.84rem' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ font: '600 11px ' + C.mono, color: C.muted, minWidth: 150 }}>{fmtWhen(h.at)}</span>
                <b style={{ color: tone[h.action] || C.ink }}>{h.what}</b>
                <span style={{ color: C.ink }}>{h.title}</span>
              </div>
              <div style={{ color: C.muted, fontSize: '.78rem', marginTop: 2 }}>
                {h.row ? '#' + h.row + ' · ' : ''}{h.by ? 'By ' + h.by : ''}{h.build ? (h.by ? ' · ' : '') + 'build ' + String(h.build).substring(0, 7) : ''}{h.backup ? ' · backup ' + h.backup : ''}{h.ref ? ' · carries out #' + h.ref : ''}{h.note ? ' · ' + h.note : ''}
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > 15 && <button style={Object.assign({ marginTop: 8 }, btn(C.codex, false))} onClick={function () { setAll(!all); }}>{all ? 'Show the latest 15' : 'Show all ' + rows.length}</button>}
    </section>
  );
}

function Row(props) {
  var it = props.item;
  // v55.83-YJ — where the change IS comes from the recorded history when there is one (current at all times)
  var where = whereOf(it, props.sign);
  var leftColor = it.dataChange ? C.data : (where === 'staging' ? C.stage : C.prod);
  var tags = [];
  if (where === 'live') { tags.push({ color: 'prod', label: 'On production' }); }
  else if (where === 'deployed') { tags.push({ color: 'max', label: 'On production — not yet checked' }); }
  else if (where === 'unknown') { tags.push({ color: 'max', label: 'Needs attention — production state unconfirmed' }); }
  else { tags.push({ color: 'stage', label: 'On staging' }); }
  if (props.sign && props.sign.problem && where !== 'unknown') { tags.push({ color: 'max', label: 'Needs a look' }); }
  if (it.dataChange) { tags.push({ color: 'data', label: 'Data change' }); }
  if (it.needsCodex) { tags.push({ color: 'codex', label: 'Codex reviewing' }); }
  if (it.needsMax) { tags.push({ color: 'max', label: "Needs your go" }); }
  return (
    <div className="warehouse-change-row" style={{ background: C.card, border: '1px solid ' + C.line, borderLeft: '3px solid ' + leftColor, borderRadius: 8, padding: '12px 14px', display: 'grid', gap: 10, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        {props.canSign && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}><input type="checkbox" aria-label={'Select ' + it.title} checked={!!props.selected} disabled={props.selectLocked} onChange={function () { props.onSelect(it.id); }} />Select change</label>}
        <h3 style={{ margin: '0 0 3px', fontSize: '.98rem', color: C.ink }}>{it.title}</h3>
        <div style={{ font: '600 11px ' + C.mono, color: C.muted }}>{it.meta || it.date || ''}</div>
        {it.desc && <div style={{ color: C.muted, fontSize: '.86rem', marginTop: 4, maxWidth: '70ch' }}>{it.desc}</div>}
        {(it.backup || it.rollback) && (
          <div style={{ marginTop: 6, fontSize: '.78rem', color: C.muted, lineHeight: 1.45 }}>
            {it.backup && <div><span style={{ color: C.gold2 }}>Backup:</span> {it.backup}</div>}
            {it.rollback && <div><span style={{ color: C.gold2 }}>Rollback:</span> {it.rollback}</div>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end', minWidth: 150 }}>
        {tags.map(function (t, i) { return <Tag key={i} color={t.color} label={t.label} />; })}
      </div>
      {props.sign && <SignBox item={it} sign={props.sign} onDone={props.onDone} />}
    </div>
  );
}

export default function ChangeScheduleTab() {
  var st = useState(null); var data = st[0]; var setData = st[1];
  var es = useState(''); var err = es[0]; var setErr = es[1];
  var ls = useState(true); var loading = ls[0]; var setLoading = ls[1];
  var ps = useState({}); var picked = ps[0]; var setPicked = ps[1];
  var rs = useState(null); var review = rs[0]; var setReview = rs[1];
  var bs = useState(false); var sending = bs[0]; var setSending = bs[1];
  var rq = useState(false); var reviewing = rq[0]; var setReviewing = rq[1];
  var ms = useState(''); var message = ms[0]; var setMessage = ms[1];
  var [headerHeight, setHeaderHeight] = useState(0);
  var toolbarRef = useRef(null);
  var reviewPanel = useRef(null);
  var reviewOpen = !!review;

  function load() {
    setLoading(true); setErr('');
    // The schedule is available to verified team members through the signed-in API.
    supabase.auth.getSession()
      .then(function (s) {
        var token = s && s.data && s.data.session ? s.data.session.access_token : '';
        var headers = {};
        if (token) { headers['Authorization'] = 'Bearer ' + token; }
        return fetch('/api/releases', { cache: 'no-store', headers: headers });
      })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { setErr((j && j.error) || 'Could not read the release register.'); setData(null); }
        else { setData(j); }
      })
      .catch(function () { setErr('Could not reach the release register.'); setData(null); })
      .then(function () { setLoading(false); });
  }
  useEffect(function () { load(); var timer = setInterval(load, 15000); return function () { clearInterval(timer); }; }, []);
  useEffect(function () {
    var header = document.querySelector('[role="banner"][aria-label="App header"]');
    if (!header) return undefined;
    function measure() { setHeaderHeight(Math.ceil(header.getBoundingClientRect().height)); }
    measure();
    var observer = new ResizeObserver(measure);
    observer.observe(header);
    return function () { observer.disconnect(); };
  }, []);
  useEffect(function () {
    if (!reviewOpen || !reviewPanel.current) return;
    var panel = reviewPanel.current;
    panel.style.scrollMarginTop = headerHeight + (toolbarRef.current?.offsetHeight || 0) + 12 + 'px';
    panel.scrollIntoView({ block: 'start' });
    panel.focus({ preventScroll: true });
  }, [reviewOpen, headerHeight]);

  var items = (data && data.items) || [];
  // Sign-off state and permission to take action come from the server.
  // Which list a change is in follows the recorded history (current), not only the register file.
  var signs = (data && data.signoffs) || {};
  var queued = items.filter(function (it) { return it && whereOf(it, signs[it.id]) === 'staging'; });
  var live = items.filter(function (it) { return it && whereOf(it, signs[it.id]) !== 'staging'; });
  var canSign = !!(data && data.canSign);
  var selectedIds = Object.keys(picked).filter(function (id) { return picked[id]; });
  function select(id) { setPicked(function (p) { var n = Object.assign({}, p); n[id] = !n[id]; return n; }); }
  function openReview(action) {
    var ids = selectedIds;
    var chosen = { action: action, items: ids.map(function (key) { return items.find(function (it) { return it.id === key; }); }).filter(Boolean), heads: Object.assign({}, signs) };
    setReview(chosen);
    setMessage('');
    if (action === 'go') {
      setReviewing(true);
      callApi('/api/releases/review', 'POST', { item_ids: ids })
        .then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.error) || 'Could not complete the release review.');
          setReview(function (current) { return current === chosen ? Object.assign({}, current, { result: j }) : current; });
        })
        .catch(function (e) { setMessage(e.message); })
        .finally(function () { setReviewing(false); });
    }
  }
  function confirmReview() {
    var payload = { item_ids: review.items.map(function (it) { return it.id; }), action: review.action };
    if (review.action === 'go') {
      if (!review.result?.passed) return;
      Object.assign(payload, { confirm: 'DEPLOY', review_receipt: review.result.receipt,
        heads: review.result.heads, builds: review.result.builds, digests: review.result.digests });
    } else {
      payload.confirm = 'ROLLBACK';
      payload.heads = Object.fromEntries(review.items.map(function (it) { return [it.id, (review.heads[it.id] || {}).head]; }));
    }
    setSending(true);
    callApi('/api/releases/signoff', 'POST', payload)
      .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'Could not queue the release.'); setMessage(j.note); setPicked({}); setReview(null); load(); })
      .catch(function (e) { setMessage(e.message); }).finally(function () { setSending(false); });
  }
  var reviewBlocked = review && (review.action === 'go' ? !review.result?.passed : review.items.some(function (it) { return !review.heads[it.id]?.canRollback; }));

  return (
    <div className="warehouse-release-manager" style={{ background: C.bg, color: C.ink, border: '1px solid ' + C.line, padding: '24px 22px 30px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
      <style>{'.warehouse-release-manager button:disabled{opacity:.45;cursor:not-allowed!important}.warehouse-change-row{grid-template-columns:minmax(0,1fr) auto}@media(max-width:600px){.warehouse-change-row{grid-template-columns:minmax(0,1fr)}}'}</style>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 22 }}>
        <header>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 4px', letterSpacing: 0 }}>Change Schedule</h1>
          <p style={{ margin: 0, color: C.muted, fontSize: '.92rem', maxWidth: '80ch' }}>
            {(data && data.intro) || "What's live on production, what's waiting on fix staging, and what each change still needs before it moves."}
          </p>
          <div style={{ font: '600 11px ' + C.mono, color: C.muted, marginTop: 6 }}>
            {loading ? 'Loading…' : ('Updated ' + ((data && data.updated) || '—') + ((data && data.updatedBy) ? ' · ' + data.updatedBy : ''))}
            <button onClick={load} style={{ marginLeft: 10, font: '600 11px ' + C.mono, color: C.codex, background: 'transparent', border: '1px solid ' + C.line, borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>Refresh</button>
          </div>
          <div style={{ marginTop: 8, fontSize: '.78rem', color: C.muted, background: 'rgba(56,189,248,.07)', border: '1px solid ' + C.line, borderRadius: 8, padding: '7px 10px', maxWidth: '80ch' }}>
            {(data && data.statusNote) || 'This is the maintained release plan as of the date shown — not a live deployment feed. A change is only “on production” once it was deployed and verified by hand.'}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: C.muted }}>
            {((data && data.legend) || []).map(function (lg, i) {
              return (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: C[lg.color] || C.muted }} />{lg.label}
                </span>
              );
            })}
          </div>
        </header>
        {data && <div role="status" style={{ color: data.workerOnline ? C.prod : C.max }}>
          {data.workerOnline ? 'Warehouse deployment worker online' : 'Warehouse deployment worker offline: requests remain queued until it reconnects'}
          {data.worker && data.worker.last_seen ? ' · Last contact ' + fmtWhen(data.worker.last_seen) : ''}
          {!canSign && <div style={{ color: C.muted }}>View only. Managing releases requires the NT Warehouse release permission.</div>}
          {!data.executionReady && <div>Execution database setup is not available. No release can be queued.</div>}
        </div>}
        {data && (data.executions || []).map(function (job) { return <div key={job.request_id} role="status" style={{ color: C.max }}>Request #{job.request_id}: {job.phase === 'running' ? 'Executing' : 'Recovery check required'} · Started {fmtWhen(job.started_at)}</div>; })}
        {canSign && <div ref={toolbarRef} role="group" aria-label="Selected Warehouse changes" style={{ position: 'sticky', top: headerHeight, zIndex: 20, background: C.panel, border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>{selectedIds.length} selected</b>
            <button disabled={!selectedIds.length || sending || reviewing || reviewOpen} style={btn(C.prod, true)} onClick={function () { openReview('go'); }}>Review selected deployments</button>
            <button disabled={!selectedIds.length || sending || reviewing || reviewOpen} style={btn(C.max, false)} onClick={function () { openReview('rollback'); }}>Review selected code rollbacks</button>
            <button disabled={!selectedIds.length || reviewOpen} style={btn(C.muted, false)} onClick={function () { setPicked({}); }}>Clear selection</button>
          </div>
          {!selectedIds.length && <div style={{ color: C.muted, marginTop: 5, fontSize: '.82rem' }}>Check the changes you want to review, then use the button above.</div>}
        </div>}
        {message && <div role="status" style={{ color: C.max }}>{message}</div>}
        {review && <section ref={reviewPanel} role="dialog" tabIndex={-1} aria-label="Review warehouse release" style={{ border: '1px solid ' + C.line, borderRadius: 8, padding: 16 }}>
          <h2>{review.action === 'go' ? 'Production release review' : 'Confirm selected code rollbacks'}</h2>
          {review.action === 'rollback' && <p>This restores the selected Warehouse code files. Business records and uploads stay as they are.</p>}
          {review.action === 'go' && <p role="status" style={{ color: review.result?.passed ? C.prod : C.max }}>
            {reviewing ? 'Checking the selected changes, staging test evidence and current release state…' :
              review.result?.passed ? 'Review passed. You can approve this exact build for production.' :
                review.result ? 'Review blocked. See what each change still needs below.' : 'Review incomplete. Run it again to continue.'}
          </p>}
          {review.items.map(function (it) { var s = review.heads[it.id] || {}; return <div key={it.id} style={{ padding: '10px 0', borderTop: '1px solid ' + C.line }}>
            <b>{it.title}</b>
            {review.action === 'go' ? (function () {
              var result = review.result?.results?.find(function (detail) { return detail.id === it.id; });
              return result && <div>
                <div>Build: {result.sha || 'Not prepared'}</div>
                {result.files.length > 0 && <div>Files: {result.files.join(', ')}</div>}
                {result.note && <div style={{ color: C.max }}>{result.note}</div>}
                {result.evidence && <div>{result.evidence}</div>}
                {result.steps.length > 0 && <ul>{result.steps.map(function (step) { return <li key={step}>{step}</li>; })}</ul>}
              </div>;
            })() : <div><div>Build: {s.liveBuild || 'No recorded target'}</div><div>Backup: {s.liveBackup || 'Not recorded'}</div>{s.why && <div style={{ color: C.max }}>{s.why}</div>}</div>}
          </div>; })}
          {review.result?.problems?.length > 0 && <ul style={{ color: C.max }}>{review.result.problems.map(function (problem) { return <li key={problem}>{problem}</li>; })}</ul>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button disabled={sending || reviewing || reviewBlocked || !review.items.length || !canSign} style={btn(C.prod, true)} onClick={confirmReview}>{sending ? 'Queuing...' : review.action === 'go' ? 'Approve and queue deployment' : 'Confirm and queue code rollback'}</button>
            <button disabled={sending || reviewing} style={btn(C.muted, false)} onClick={function () { setReview(null); }}>Close</button>
          </div>
        </section>}

        {canSign && data && data.signoffsInstalled === false && (
          <div style={{ background: 'rgba(248,163,59,.1)', border: '1px solid #8a5a1a', borderRadius: 10, padding: '10px 14px', color: C.max, fontSize: '.86rem' }}>
            The sign-off buttons are switched off until the v55.83-YJ sign-off table is installed in the database.
          </div>
        )}
        {canSign && data && data.signoffsError && (
          <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid #7f1d1d', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: '.86rem' }}>{data.signoffsError} No buttons are shown until it can be read.</div>
        )}

        {err && (
          <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid #7f1d1d', borderRadius: 10, padding: '12px 14px', color: '#fca5a5', fontSize: '.88rem' }}>
            {err} The screen falls back to the last readable register; check release-management/release-register.json for a bad edit.
          </div>
        )}

        <section>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 9 }}>
            Queued to move to production
            <span style={{ font: '700 10px ' + C.mono, padding: '2px 8px', borderRadius: 999, letterSpacing: '.05em', textTransform: 'uppercase', background: 'rgba(242,207,91,.15)', color: C.gold2 }}>{queued.length} items</span>
          </h2>
          <p style={{ color: C.muted, fontSize: '.86rem', margin: '0 0 12px' }}>All on fix staging. Each moves only after Codex passes it and you name it — then a backed-up, reversible deploy.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {queued.length ? queued.map(function (it, i) { return <Row key={it.id || i} item={it} sign={signs[it.id]} canSign={canSign} onDone={load} selected={picked[it.id]} selectLocked={reviewOpen} onSelect={select} />; })
              : <div style={{ color: C.muted, fontSize: '.86rem' }}>{loading ? 'Loading…' : 'Nothing queued.'}</div>}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 9 }}>
            Already on production
            <span style={{ font: '700 10px ' + C.mono, padding: '2px 8px', borderRadius: 999, letterSpacing: '.05em', textTransform: 'uppercase', background: 'rgba(52,211,153,.15)', color: C.prod }}>live</span>
          </h2>
          <p style={{ color: C.muted, fontSize: '.86rem', margin: '0 0 12px' }}>Warehouse changes moved to the live site.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {live.length ? live.map(function (it, i) { return <Row key={it.id || i} item={it} sign={signs[it.id]} canSign={canSign} onDone={load} selected={picked[it.id]} selectLocked={reviewOpen} onSelect={select} />; })
              : <div style={{ color: C.muted, fontSize: '.86rem' }}>{loading ? 'Loading…' : 'Nothing on production yet.'}</div>}
          </div>
        </section>

        {data && <History rows={data.history || []} note={data.signoffsInstalled === false ? 'The history starts once the v55.83-YJ table is installed in the database.' : (data.signoffsError ? 'The history could not be read right now.' : (data.historyComplete === false ? 'Only the most recent part of the history is shown.' : ''))} />}

        <section>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>How a move happens (and un-happens)</h2>
          <div style={{ background: C.panel, border: '1px solid ' + C.line, borderRadius: 10, padding: '14px 16px' }}>
            <ol style={{ margin: 0, paddingLeft: '1.2rem', color: C.muted, fontSize: '.9rem' }}>
              {((data && data.protocol) || []).map(function (step, i) { return <li key={i} style={{ margin: '5px 0' }}>{step}</li>; })}
            </ol>
            {(data && data.protocolNote) && <p style={{ fontSize: '.82rem', color: C.muted, marginTop: 10 }}>{data.protocolNote}</p>}
            {(data && data.deployAutomation && data.deployAutomation.status === 'needs-ssh-authorized') && (
              <div style={{ marginTop: 12, background: 'rgba(248,163,59,.1)', border: '1px solid #8a5a1a', borderRadius: 8, padding: '10px 12px', fontSize: '.82rem', color: '#f8a33b' }}>
                <b>Deploy automation — needs SSH authorized.</b> {data.deployAutomation.detail}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
