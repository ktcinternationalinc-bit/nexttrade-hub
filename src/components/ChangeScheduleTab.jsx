'use client';
// v55.83-XH — Change Schedule (aka Releases) — release-governance session, 22 Nov 2026.
// A plain-English release register for Max: what is live on production, what is waiting on
// fix staging, and what each change still needs before it moves (Codex pass · Max's go · data
// flag), plus how a move happens and un-happens. Reads the hand-editable register via the
// read-only /api/releases route (release-management/release-register.json). Shows nothing it
// cannot read; never writes. Visual spec: dark + gold, matching the warehouse Change-Schedule
// preview, using the Hub's JetBrains Mono for mono accents.
import React, { useEffect, useState } from 'react';
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
    <span style={{ font: '700 10.5px system-ui, sans-serif', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', border: '1px solid ' + border, color: text, background: tint }}>
      {label}
    </span>
  );
}

function Row(props) {
  var it = props.item;
  var leftColor = it.dataChange ? C.data : (it.status === 'live' ? C.prod : C.stage);
  var tags = [];
  if (it.status === 'live') { tags.push({ color: 'prod', label: 'On production' }); }
  else { tags.push({ color: 'stage', label: 'On staging' }); }
  if (it.dataChange) { tags.push({ color: 'data', label: 'Data change' }); }
  if (it.needsCodex) { tags.push({ color: 'codex', label: 'Codex reviewing' }); }
  if (it.needsMax) { tags.push({ color: 'max', label: "Needs your go" }); }
  return (
    <div style={{ background: C.card, border: '1px solid ' + C.line, borderLeft: '3px solid ' + leftColor, borderRadius: 10, padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
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
    </div>
  );
}

export default function ChangeScheduleTab() {
  var st = useState(null); var data = st[0]; var setData = st[1];
  var es = useState(''); var err = es[0]; var setErr = es[1];
  var ls = useState(true); var loading = ls[0]; var setLoading = ls[1];

  function load() {
    setLoading(true); setErr('');
    // The route is authenticated (super-admin OR releases.access), so send the sign-in bearer.
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
  useEffect(function () { load(); }, []);

  var items = (data && data.items) || [];
  var queued = items.filter(function (it) { return it && it.status !== 'live'; });
  var live = items.filter(function (it) { return it && it.status === 'live'; });

  return (
    <div style={{ background: C.bg, color: C.ink, borderRadius: 14, border: '1px solid ' + C.line, padding: '24px 22px 30px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 22 }}>
        <header>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 4px', letterSpacing: '-.01em' }}>Change Schedule</h1>
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
            {queued.length ? queued.map(function (it, i) { return <Row key={it.id || i} item={it} />; })
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
            {live.length ? live.map(function (it, i) { return <Row key={it.id || i} item={it} />; })
              : <div style={{ color: C.muted, fontSize: '.86rem' }}>{loading ? 'Loading…' : 'Nothing on production yet.'}</div>}
          </div>
        </section>

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
