'use client';
// v55.83-YH — Canada History (Max, 24 Nov 2026).
// The old Cambridge (Ontario) workbook, kept as a private READ-ONLY archive: goods received and
// goods shipped, in pounds, by goods type and month (Jun 2021 – Apr 2024). Each old Canadian goods
// name is tied to a CURRENT CGT goods type so the comparison is like for like; a name with no
// match stays under its own name, flagged, until Max decides.
// Reads /api/canada-history (authenticated). Shows nothing it cannot read. It never touches
// inventory, bills, invoices, bank lines or P&L.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CANADA_GOODS, CURRENT_CGT_TYPES, KIND_LABELS, effectiveGoodsMap, unmatchedGoods, buildCanadaHistory, fmtLb } from '../lib/canada-history';

var C = {
  bg: '#f8fafc', card: '#ffffff', line: '#e2e8f0', ink: '#0f172a', muted: '#64748b',
  inn: '#0e7490', out: '#b45309', warn: '#b91c1c', warnBg: '#fef2f2', ok: '#166534', okBg: '#f0fdf4', gold: '#92400e', goldBg: '#fffbeb'
};

function bearer() {
  return supabase.auth.getSession().then(function (s) {
    var token = s && s.data && s.data.session ? s.data.session.access_token : '';
    var h = { 'Content-Type': 'application/json' };
    if (token) { h['Authorization'] = 'Bearer ' + token; }
    return h;
  });
}

function Bars(props) {
  var g = props.group;
  var max = 1; var i;
  for (i = 0; i < g.months.length; i++) { if (g.inbound[i] > max) { max = g.inbound[i]; } if (g.outbound[i] > max) { max = g.outbound[i]; } }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 8px 4px', background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 190, minWidth: g.months.length * 26 }}>
        {g.months.map(function (m, idx) {
          var a = g.inbound[idx]; var b = g.outbound[idx];
          return (
            <div key={m} title={g.labels[idx] + ' — received ' + fmtLb(a) + ' lb, shipped ' + fmtLb(b) + ' lb'} style={{ flex: '1 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
                <div style={{ width: 8, height: Math.max(a > 0 ? 2 : 0, Math.round(160 * a / max)), background: C.inn, borderRadius: '2px 2px 0 0' }}></div>
                <div style={{ width: 8, height: Math.max(b > 0 ? 2 : 0, Math.round(160 * b / max)), background: C.out, borderRadius: '2px 2px 0 0' }}></div>
              </div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 4, whiteSpace: 'nowrap', transform: 'rotate(-55deg)', transformOrigin: 'center', height: 22 }}>{g.labels[idx]}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: C.inn, marginRight: 4 }}></span>Received
        <span style={{ display: 'inline-block', width: 10, height: 10, background: C.out, margin: '0 4px 0 14px' }}></span>Shipped
        <span style={{ marginLeft: 14 }}>pounds per month — hover a bar for the figure</span>
      </div>
    </div>
  );
}

var th = { textAlign: 'left', padding: '6px 10px', fontSize: 11, color: '#64748b', borderBottom: '1px solid #e2e8f0', textTransform: 'uppercase', letterSpacing: '.04em' };
var thR = Object.assign({}, th, { textAlign: 'right' });
var td = { padding: '6px 10px', fontSize: 13, color: '#0f172a', borderBottom: '1px solid #f1f5f9' };
var tdR = Object.assign({}, td, { textAlign: 'right', fontVariantNumeric: 'tabular-nums' });

export default function CanadaHistoryTab(props) {
  var toast = props && props.toast;
  var st = useState(null); var data = st[0]; var setData = st[1];
  var es = useState(''); var err = es[0]; var setErr = es[1];
  var ls = useState(true); var loading = ls[0]; var setLoading = ls[1];
  var bs = useState('cgt'); var by = bs[0]; var setBy = bs[1];
  var os = useState(''); var openKey = os[0]; var setOpenKey = os[1];
  var ws = useState(''); var busy = ws[0]; var setBusy = ws[1];
  var ms = useState(''); var msg = ms[0]; var setMsg = ms[1];
  var ps = useState({}); var picks = ps[0]; var setPicks = ps[1];

  function say(text, bad) { setMsg(text); if (toast) { try { toast(text, bad ? 'error' : 'success'); } catch (e) { /* message is on the page */ } } }

  function load() {
    setLoading(true); setErr('');
    bearer()
      .then(function (h) { return fetch('/api/canada-history', { cache: 'no-store', headers: h }); })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { setErr((j && j.error) || 'Could not read the Canada history.'); setData(null); }
        else { setData(j); }
      })
      .catch(function () { setErr('Could not reach the Canada history.'); setData(null); })
      .then(function () { setLoading(false); });
  }
  useEffect(function () { load(); }, []);

  function post(body, doneText) {
    setBusy(body.action); setMsg('');
    return bearer()
      .then(function (h) { return fetch('/api/canada-history', { method: 'POST', headers: h, body: JSON.stringify(body) }); })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { say((j && j.error) || 'That did not work.', true); return false; }
        say(doneText, false); load(); return true;
      })
      .catch(function () { say('Could not reach the Hub. Nothing was changed.', true); return false; })
      .then(function (r) { setBusy(''); return r; });
  }

  function onFile(ev) {
    var f = ev.target && ev.target.files && ev.target.files[0];
    if (!f) { return; }
    var reader = new FileReader();
    reader.onload = function () { post({ action: 'load', file_text: String(reader.result || '') }, 'The Canada history is stored.'); };
    reader.onerror = function () { say('The file could not be read.', true); };
    reader.readAsText(f);
    ev.target.value = '';
  }

  var canManage = !!(data && data.can_manage);
  var eff = effectiveGoodsMap((data && data.decisions) || []);
  var hist = data && data.loaded ? buildCanadaHistory(data.receipts, data.shipments, eff, { by: by }) : null;
  var unmatched = unmatchedGoods(eff);
  var open = null;
  if (hist && openKey) { hist.groups.forEach(function (g) { if (g.key === openKey) { open = g; } }); }

  var box = { background: C.card, border: '1px solid ' + C.line, borderRadius: 12, padding: 16 };
  var btn = { font: '600 12px system-ui, sans-serif', padding: '6px 12px', borderRadius: 8, border: '1px solid ' + C.line, background: '#fff', color: C.ink, cursor: 'pointer' };
  function tabBtn(on) { return Object.assign({}, btn, on ? { background: C.ink, color: '#fff', borderColor: C.ink } : {}); }

  return (
    <div style={{ background: C.bg, color: C.ink, borderRadius: 14, border: '1px solid ' + C.line, padding: '20px 18px 28px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.45 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header>
          <h1 style={{ fontSize: '1.4rem', margin: '0 0 4px', color: C.ink }}>🇨🇦 Canada History</h1>
          <p style={{ margin: 0, color: C.muted, fontSize: '.9rem', maxWidth: '95ch' }}>
            The old Cambridge workbook, kept for comparison and reports: goods <b>received</b> and goods <b>shipped</b>, in pounds, by type of goods and by month.
            It is a read-only archive. It does not change any stock, bill, invoice, bank line or profit figure.
          </p>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            {loading ? 'Loading…' : (data && data.batch ? ('Source: ' + data.batch.source_file + ' · stored ' + String(data.batch.loaded_at || '').slice(0, 10) + ' · ' + data.batch.receipt_lines + ' received lines, ' + data.batch.shipment_lines + ' shipped lines') : '')}
            <button onClick={load} style={Object.assign({}, btn, { marginLeft: 10, padding: '2px 8px', fontSize: 11 })}>Refresh</button>
          </div>
        </header>

        {err ? <div style={{ background: C.warnBg, border: '1px solid #fecaca', color: C.warn, borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div> : null}
        {msg ? <div style={{ background: C.goldBg, border: '1px solid #fde68a', color: C.gold, borderRadius: 10, padding: '8px 14px', fontSize: 13 }}>{msg}</div> : null}

        {data && data.sql_missing ? (
          <div style={{ background: C.goldBg, border: '1px solid #fde68a', color: C.gold, borderRadius: 10, padding: '12px 14px', fontSize: 13 }}>
            <b>Not set up yet.</b> {data.sql_hint}
          </div>
        ) : null}

        {data && !data.sql_missing && !data.loaded ? (
          <div style={box}>
            <b>The archive is empty.</b>
            <div style={{ fontSize: 13, color: C.muted, margin: '6px 0 10px' }}>
              The history is loaded once from the file made from the 11.23 workbook (<code>canada-history-archive.json</code>). Only that exact file is accepted; anything else is refused. After it is stored it cannot be changed or loaded twice.
            </div>
            {canManage ? (
              <label style={Object.assign({}, btn, { display: 'inline-block', background: C.ink, color: '#fff', borderColor: C.ink, opacity: busy ? 0.6 : 1 })}>
                {busy === 'load' ? 'Storing…' : 'Load the Canada history file'}
                <input type="file" accept=".json,application/json" onChange={onFile} disabled={!!busy} style={{ display: 'none' }} />
              </label>
            ) : <div style={{ fontSize: 13, color: C.muted }}>Only the super admin can load it.</div>}
          </div>
        ) : null}

        {hist ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Received</div><div style={{ fontSize: 22, fontWeight: 800, color: C.inn }}>{fmtLb(hist.total_in)} lb</div></div>
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Shipped</div><div style={{ fontSize: 22, fontWeight: 800, color: C.out }}>{fmtLb(hist.total_out)} lb</div></div>
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Period</div><div style={{ fontSize: 22, fontWeight: 800 }}>{hist.first_month} → {hist.last_month}</div></div>
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Old names with no match</div><div style={{ fontSize: 22, fontWeight: 800, color: unmatched.length ? C.warn : C.ok }}>{unmatched.length}</div></div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: C.muted }}>Show by</span>
              <button style={tabBtn(by === 'cgt')} onClick={function () { setBy('cgt'); setOpenKey(''); }}>Current CGT goods type</button>
              <button style={tabBtn(by === 'goods')} onClick={function () { setBy('goods'); setOpenKey(''); }}>Old Canadian name</button>
              <span style={{ fontSize: 12, color: C.muted }}>Click a card for its month-by-month history.</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 12 }}>
              {hist.groups.map(function (g) {
                var on = g.key === openKey;
                var flagged = by === 'cgt' && !g.matched;
                return (
                  <div key={g.key} role="button" tabIndex={0} onClick={function () { setOpenKey(on ? '' : g.key); }}
                    onKeyDown={function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(on ? '' : g.key); } }}
                    style={Object.assign({}, box, { cursor: 'pointer', borderColor: on ? C.ink : (flagged ? '#fca5a5' : C.line), boxShadow: on ? '0 0 0 2px ' + C.ink : 'none', background: flagged ? C.warnBg : C.card })}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>{g.key}</div>
                    {flagged ? <div style={{ fontSize: 11, fontWeight: 700, color: C.warn }}>NO MATCH YET — old Canadian name</div>
                      : (by === 'cgt' ? <div style={{ fontSize: 11, color: C.muted }}>from: {g.goods.join(', ')}</div> : <div style={{ fontSize: 11, color: C.muted }}>{eff.map[g.key] ? ('counts as: ' + eff.map[g.key]) : 'no match yet'}</div>)}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 13 }}><span style={{ color: C.muted }}>Received</span><b style={{ color: C.inn }}>{fmtLb(g.total_in)} lb</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: C.muted }}>Shipped</span><b style={{ color: C.out }}>{fmtLb(g.total_out)} lb</b></div>
                  </div>
                );
              })}
            </div>

            {open ? (
              <div style={Object.assign({}, box, { display: 'grid', gap: 14 })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', color: C.ink }}>{open.key} — Canada, {hist.first_month} to {hist.last_month}</h2>
                  <button style={btn} onClick={function () { setOpenKey(''); }}>Close</button>
                </div>
                <Bars group={open} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>By year (pounds)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>Year</th><th style={thR}>Received</th><th style={thR}>Shipped</th></tr></thead>
                      <tbody>
                        {open.yearly.map(function (y) { return <tr key={y.year}><td style={td}>{y.year}</td><td style={tdR}>{fmtLb(y.in)}</td><td style={tdR}>{fmtLb(y.out)}</td></tr>; })}
                        <tr><td style={Object.assign({}, td, { fontWeight: 800 })}>Total</td><td style={Object.assign({}, tdR, { fontWeight: 800 })}>{fmtLb(open.total_in)}</td><td style={Object.assign({}, tdR, { fontWeight: 800 })}>{fmtLb(open.total_out)}</td></tr>
                      </tbody>
                    </table>
                    <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 4px' }}>Not counted as received (pounds)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {['opening', 'conversion', 'adjustment', 'disposal'].map(function (k) { return <tr key={k}><td style={td}>{KIND_LABELS[k]}</td><td style={tdR}>{fmtLb(open.other[k])}</td></tr>; })}
                      </tbody>
                    </table>
                    {open.undated_other ? <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{fmtLb(open.undated_other)} lb of this has no date in the workbook.</div> : null}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Shipped to (customer as written in the workbook)</div>
                    <div style={{ maxHeight: 330, overflowY: 'auto', border: '1px solid ' + C.line, borderRadius: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={th}>Customer</th><th style={thR}>Pounds</th></tr></thead>
                        <tbody>
                          {open.customers.map(function (c) { return <tr key={c.customer}><td style={td}>{c.customer}</td><td style={tdR}>{fmtLb(c.lb)}</td></tr>; })}
                          {!open.customers.length ? <tr><td style={td} colSpan={2}>Nothing shipped.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div style={box}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>Old Canadian name → current CGT goods type</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                This is what makes the comparison like for like. A name with no match is never guessed: it stays under its own name until the super admin decides. Earlier decisions are kept.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Old Canadian name</th><th style={th}>Counts as</th><th style={th}>Status</th>{canManage ? <th style={th}>Change</th> : null}</tr></thead>
                  <tbody>
                    {CANADA_GOODS.map(function (name) {
                      var cur = eff.map[name]; var src = eff.source[name];
                      var pick = picks[name] === undefined ? cur : picks[name];
                      var opts = CURRENT_CGT_TYPES.slice(); if (cur && opts.indexOf(cur) < 0) { opts.push(cur); }
                      return (
                        <tr key={name} style={{ background: cur ? 'transparent' : C.warnBg }}>
                          <td style={Object.assign({}, td, { fontWeight: 700 })}>{name}</td>
                          <td style={td}>{cur || <span style={{ color: C.warn, fontWeight: 700 }}>No match yet</span>}</td>
                          <td style={td}>{src === 'proposed' ? 'Proposed' : src === 'decided' ? 'Decided' : src === 'decided-unmatched' ? 'Decided: keep separate' : 'Waiting for a decision'}</td>
                          {canManage ? (
                            <td style={td}>
                              <select value={pick} onChange={function (e) { var n = Object.assign({}, picks); n[name] = e.target.value; setPicks(n); }} style={{ fontSize: 12, padding: '3px 6px', border: '1px solid ' + C.line, borderRadius: 6, background: '#fff', color: C.ink }}>
                                <option value="">Keep separate (no match)</option>
                                {opts.map(function (o) { return <option key={o} value={o}>{o}</option>; })}
                              </select>
                              <button disabled={!!busy || pick === cur} onClick={function () { post({ action: 'map', goods_name: name, cgt_type: pick }, name + ' saved.'); }}
                                style={Object.assign({}, btn, { marginLeft: 6, padding: '3px 10px', opacity: (busy || pick === cur) ? 0.45 : 1 })}>Save</button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
