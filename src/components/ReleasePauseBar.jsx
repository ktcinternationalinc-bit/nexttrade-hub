'use client';
// v55.83-YQ — the STOP switch on Change Schedule (Max, 24 Nov 2026). Everyone who can open the screen sees whether warehouse
// releases are stopped; only the super admin gets the button. The confirmation is on the page (no browser pop-up).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

function authHeaders() {
  return supabase.auth.getSession().then(function (s) {
    var token = s && s.data && s.data.session ? s.data.session.access_token : '';
    var h = { 'Content-Type': 'application/json' };
    if (token) { h['Authorization'] = 'Bearer ' + token; }
    return h;
  });
}

export default function ReleasePauseBar(props) {
  var s1 = useState(null); var st = s1[0]; var setSt = s1[1];
  var s2 = useState(''); var mode = s2[0]; var setMode = s2[1];        // '' | 'stop' | 'restart'
  var s3 = useState(''); var reason = s3[0]; var setReason = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(''); var err = s5[0]; var setErr = s5[1];

  function load() {
    authHeaders().then(function (h) { return fetch('/api/releases/pause', { cache: 'no-store', headers: h }); })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setSt(j); setErr(''); } else { setErr((j && j.error) || 'The stop switch could not be read.'); } })
      .catch(function () { setErr('The stop switch could not be read.'); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function send(paused) {
    setBusy(true); setErr('');
    authHeaders().then(function (h) { return fetch('/api/releases/pause', { method: 'POST', headers: h, body: JSON.stringify(paused ? { paused: true, reason: reason } : { paused: false, confirm: 'RESTART' }) }); })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setBusy(false);
        if (!j || !j.ok) { setErr((j && j.error) || 'Nothing changed.'); return; }
        setSt(j); setMode(''); setReason(''); if (props.onChange) { props.onChange(j.pause); }
      })
      .catch(function () { setBusy(false); setErr('Could not reach the Hub. Refresh to see whether the switch changed.'); });
  }

  var p = st && st.pause; var paused = !!(p && p.paused); var can = !!(st && st.can_switch);
  var box = { border: '2px solid ' + (paused ? '#f87171' : 'rgba(255,255,255,.14)'), background: paused ? '#450a0a' : '#111827', color: '#eef1f6', borderRadius: 10, padding: '12px 14px' };
  var btn = { border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 800, cursor: 'pointer', fontSize: '.9rem' };
  return (
    <section aria-label="Stop switch for warehouse releases" style={box}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1rem' }}>{'Warehouse releases: ' + (!st ? 'checking…' : paused ? 'STOPPED' : 'allowed')}</strong>
        {can && !mode && !paused && <button type="button" style={Object.assign({}, btn, { background: '#dc2626', color: '#ffffff' })} onClick={function () { setMode('stop'); setErr(''); }}>Stop all warehouse releases</button>}
        {can && !mode && paused && <button type="button" style={Object.assign({}, btn, { background: '#16a34a', color: '#ffffff' })} onClick={function () { setMode('restart'); setErr(''); }}>Allow releases again</button>}
        {st && !can && <span style={{ color: '#9aa3b2', fontSize: '.86rem' }}>Only the super admin can change this.</span>}
      </div>
      <div style={{ marginTop: 6, fontSize: '.88rem', color: paused ? '#fecaca' : '#9aa3b2' }}>
        {paused ? (p.sentence || 'Nothing new can be approved or started.') : 'While allowed, an approved change is picked up by the office worker within about a minute. “Stop” blocks every new approval and every start. It does not interrupt a move that is already running and it does not undo anything.'}
        {paused && p.at && <span>{' Since ' + new Date(p.at).toLocaleString() + '.'}</span>}
      </div>
      {mode === 'stop' && <div style={{ marginTop: 10 }}>
        <label style={{ display: 'block', fontSize: '.86rem', fontWeight: 700, marginBottom: 4 }} htmlFor="release-stop-reason">Why are you stopping releases? (kept with your name)</label>
        <input id="release-stop-reason" value={reason} onChange={function (e) { setReason(e.target.value); }} maxLength={300} placeholder="for example: waiting for a review of the Order Queue change" style={{ width: '100%', maxWidth: 560, padding: '8px 10px', borderRadius: 8, border: '1px solid #f87171', background: '#ffffff', color: '#0f172a' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} style={Object.assign({}, btn, { background: '#dc2626', color: '#ffffff' })} onClick={function () { send(true); }}>Yes, stop them now</button>
          <button type="button" disabled={busy} style={Object.assign({}, btn, { background: '#334155', color: '#ffffff' })} onClick={function () { setMode(''); setErr(''); }}>Cancel</button>
        </div>
      </div>}
      {mode === 'restart' && <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: '.88rem', fontWeight: 700 }}>Allow warehouse releases again? Anything already approved and waiting will start within about a minute.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} style={Object.assign({}, btn, { background: '#16a34a', color: '#ffffff' })} onClick={function () { send(false); }}>Yes, allow them</button>
          <button type="button" disabled={busy} style={Object.assign({}, btn, { background: '#334155', color: '#ffffff' })} onClick={function () { setMode(''); setErr(''); }}>Cancel</button>
        </div>
      </div>}
      {err && <div role="alert" style={{ marginTop: 8, color: '#fecaca', fontWeight: 700, fontSize: '.88rem' }}>{err}</div>}
    </section>
  );
}
