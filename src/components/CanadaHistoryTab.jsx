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
import { CANADA_GOODS, CURRENT_CGT_TYPES, KIND_LABELS, effectiveGoodsMap, unmatchedGoods, buildCanadaHistory, buildCanadaSales, mergeWarehouseFlow, fmtLb, fmtUsd, dayLabel } from '../lib/canada-history';

var C = {
  bg: '#f8fafc', card: '#ffffff', line: '#e2e8f0', ink: '#0f172a', muted: '#64748b',
  inn: '#0e7490', out: '#b45309', sysIn: '#16a34a', sysOut: '#ca8a04', warn: '#b91c1c', warnBg: '#fef2f2', ok: '#166534', okBg: '#f0fdf4', gold: '#92400e', goldBg: '#fffbeb'
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
  var hasSys = Array.isArray(g.sys_inbound);
  for (i = 0; i < g.months.length; i++) { if (g.inbound[i] > max) { max = g.inbound[i]; } if (g.outbound[i] > max) { max = g.outbound[i]; } if (hasSys && g.sys_inbound[i] > max) { max = g.sys_inbound[i]; } if (hasSys && g.sys_outbound[i] > max) { max = g.sys_outbound[i]; } }
  // v55.83-YH (Codex 24 Nov): a month with no data on one side is N/A — a grey mark, never a zero bar; an incomplete month is striped.
  function tip(v, st) { return st === 'unchecked' ? 'NOT CHECKED (warehouse not read)' : st === 'na' ? 'N/A (no data here)' : (fmtLb(v) + ' lb' + (st === 'partial' ? ' (incomplete month)' : '')); }
  function bar(v, st, color) {
    if (st === 'unchecked') { return <div style={{ width: 8, height: 14, borderRadius: 2, border: '1px dashed #f59e0b', background: '#fef3c7' }}></div>; }
    if (st === 'na') { return <div style={{ width: 8, height: 14, borderRadius: 2, border: '1px dashed #94a3b8', background: '#e2e8f0' }}></div>; }
    return <div style={{ width: 8, height: Math.max(v > 0 ? 2 : 0, Math.round(160 * v / max)), borderRadius: '2px 2px 0 0', background: st === 'partial' ? 'repeating-linear-gradient(45deg, ' + color + ', ' + color + ' 3px, #ffffff 3px, #ffffff 5px)' : color }}></div>;
  }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 8px 4px', background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 190, minWidth: g.months.length * (hasSys ? 44 : 26) }}>
        {g.months.map(function (m, idx) {
          var a = g.inbound[idx]; var b = g.outbound[idx]; var sa = g.inbound_status[idx]; var sb = g.outbound_status[idx];
          return (
            <div key={m} title={g.labels[idx] + ' — old workbook: received ' + tip(a, sa) + ', shipped ' + tip(b, sb) + (hasSys ? ' · new system: received ' + tip(g.sys_inbound[idx], g.sys_inbound_status[idx]) + ', shipped ' + tip(g.sys_outbound[idx], g.sys_outbound_status[idx]) : '')} style={{ flex: '1 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
                {idx < g.coverage.received.status.length || !hasSys ? bar(a, sa, C.inn) : null}
                {idx < g.coverage.received.status.length || !hasSys ? bar(b, sb, C.out) : null}
                {hasSys && g.sys_inbound_status[idx] !== 'na' ? bar(g.sys_inbound[idx], g.sys_inbound_status[idx], C.sysIn) : null}
                {hasSys && g.sys_outbound_status[idx] !== 'na' ? bar(g.sys_outbound[idx], g.sys_outbound_status[idx], C.sysOut) : null}
              </div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 4, whiteSpace: 'nowrap', transform: 'rotate(-55deg)', transformOrigin: 'center', height: 22 }}>{g.labels[idx]}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: C.inn, marginRight: 4 }}></span>Received (old workbook)
        <span style={{ display: 'inline-block', width: 10, height: 10, background: C.out, margin: '0 4px 0 14px' }}></span>Shipped (old workbook)
        {hasSys ? <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.sysIn, margin: '0 4px 0 14px' }}></span>Received (new system)<span style={{ display: 'inline-block', width: 10, height: 10, background: C.sysOut, margin: '0 4px 0 14px' }}></span>Shipped (new system)<span style={{ display: 'inline-block', width: 10, height: 10, border: '1px dashed #f59e0b', background: '#fef3c7', margin: '0 4px 0 14px' }}></span>not checked</span> : null}
        <span style={{ display: 'inline-block', width: 10, height: 10, border: '1px dashed #94a3b8', background: '#e2e8f0', margin: '0 4px 0 14px' }}></span>N/A = no data in this archive (not zero)
        <span style={{ marginLeft: 14 }}>striped = incomplete month · pounds per month — hover a bar for the figure</span>
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
  var qs = useState(''); var saleQ = qs[0]; var setSaleQ = qs[1];
  var ns = useState(60); var saleN = ns[0]; var setSaleN = ns[1];

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
  // v55.83-YO — by current CGT type the new system's months (NT Warehouse) are joined on; by old name there is no such link
  if (hist && by === 'cgt') { hist = mergeWarehouseFlow(hist, data.warehouse_flow || { state: 'unavailable', reason: 'the warehouse was not read.' }); }
  var sysOk = !!(hist && hist.sys_state === 'ok');
  var unmatched = unmatchedGoods(eff);
  // v55.83-YK — sales history: one row per Canadian release that shipped. Dollars only when the server sent them (super admin).
  var sales = data && data.loaded ? buildCanadaSales(data.shipments, data.ktc_invoices === undefined ? null : data.ktc_invoices, eff) : null;
  var saleRows = [];
  if (sales) {
    var needle = String(saleQ || '').toLowerCase().trim();
    saleRows = sales.rows.filter(function (r) {
      if (openKey && !r.lines.some(function (l) { return (by === 'goods' ? l.goods_name : (l.cgt_type || l.goods_name)) === openKey; })) { return false; }
      if (!needle) { return true; }
      return (r.release_no + ' ' + r.customer + ' ' + (r.nextrade_invoice || '') + ' ' + r.ship_date).toLowerCase().indexOf(needle) >= 0;
    });
  }
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
            It holds <b>pounds only, no dollar amounts</b>, and it is a Hub archive on its own: it is not connected to the warehouse system&apos;s own cards.
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
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Received (recorded)</div><div style={{ fontSize: 22, fontWeight: 800, color: C.inn }}>{fmtLb(hist.total_in)} lb</div><div style={{ fontSize: 11, color: C.muted }}>{dayLabel(hist.coverage.received.first)} → {dayLabel(hist.coverage.received.last)}</div></div>
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Shipped (recorded)</div><div style={{ fontSize: 22, fontWeight: 800, color: C.out }}>{fmtLb(hist.total_out)} lb</div><div style={{ fontSize: 11, color: C.muted }}>{dayLabel(hist.coverage.shipped.first)} → {dayLabel(hist.coverage.shipped.last)}</div></div>
              {by === 'cgt' ? <div style={Object.assign({}, box, sysOk ? {} : { background: C.goldBg, borderColor: '#fde68a' })}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>New system (NT Warehouse), Canada</div>{sysOk ? <div><div style={{ fontSize: 15, fontWeight: 800, color: C.sysIn }}>in {fmtLb(hist.sys_total_in)} lb</div><div style={{ fontSize: 15, fontWeight: 800, color: C.sysOut }}>out {fmtLb(hist.sys_total_out)} lb</div><div style={{ fontSize: 11, color: C.muted }}>{dayLabel(hist.sys_first_in)} → {dayLabel(hist.sys_last_in)}</div>{hist.sys_partial_mapping ? <div style={{ fontSize: 11, fontWeight: 800, color: C.warn }}>PARTIAL — linked grades only; + {fmtLb(hist.sys_unmapped_total_in)} in / {fmtLb(hist.sys_unmapped_total_out)} out not linked</div> : null}</div> : <div style={{ fontSize: 15, fontWeight: 800, color: C.gold }}>NOT CHECKED</div>}</div> : null}
              <div style={box}><div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase' }}>Old names with no match</div><div style={{ fontSize: 22, fontWeight: 800, color: unmatched.length ? C.warn : C.ok }}>{unmatched.length}</div></div>
            </div>

            <div style={{ background: C.goldBg, border: '1px solid #fde68a', color: C.gold, borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
              <b>How far this archive goes — read before comparing periods</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {hist.notes.map(function (n, i) { return <li key={i}>{n}</li>; })}
              </ul>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 13 }}><span style={{ color: C.muted }}>Received (recorded)</span><b style={{ color: C.inn }}>{fmtLb(g.total_in)} lb</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: C.muted }}>Shipped (recorded)</span><b style={{ color: C.out }}>{fmtLb(g.total_out)} lb</b></div>
                    {by === 'cgt' ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4, color: C.muted }}><span>New system in / out</span><span>{g.sys_total_in === null || g.sys_total_in === undefined ? 'not checked' : fmtLb(g.sys_total_in) + ' / ' + fmtLb(g.sys_total_out) + ' lb'}</span></div> : null}
                  </div>
                );
              })}
            </div>

            {sysOk && (hist.sys_unmapped.length || hist.sys_scope_unknown.length) ? (
              <div style={Object.assign({}, box, { background: C.warnBg, borderColor: '#fca5a5' })}>
                <div style={{ fontWeight: 800, fontSize: 14, color: C.warn }}>Warehouse grades not linked to a goods type</div>
                <div style={{ fontSize: 12, color: C.ink, margin: '4px 0 8px' }}>
                  The warehouse has these Canadian grades, but the Hub does not know which goods type they belong to. Their pounds are <b>not in the cards above</b>, so the new-system figures on the cards are a partial total. Nothing is guessed: tell Claude what each one counts as and it will be linked.
                </div>
                {hist.sys_unmapped.length ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                      <thead><tr><th style={th}>Warehouse grade (as named there)</th><th style={th}>Warehouse</th><th style={th}>Months</th><th style={thR}>Received lb</th><th style={thR}>Shipped lb</th></tr></thead>
                      <tbody>
                        {hist.sys_unmapped.map(function (u) { return <tr key={u.grade}><td style={Object.assign({}, td, { fontWeight: 700 })}>{u.grade}</td><td style={td}>{u.warehouses.join(', ') || '—'}</td><td style={td}>{u.first_month}{u.last_month !== u.first_month ? ' → ' + u.last_month : ''}</td><td style={tdR}>{fmtLb(u.in_lb)}</td><td style={tdR}>{fmtLb(u.out_lb)}</td></tr>; })}
                        <tr><td style={Object.assign({}, td, { fontWeight: 800 })} colSpan={3}>Not linked, total</td><td style={Object.assign({}, tdR, { fontWeight: 800 })}>{fmtLb(hist.sys_unmapped_total_in)}</td><td style={Object.assign({}, tdR, { fontWeight: 800 })}>{fmtLb(hist.sys_unmapped_total_out)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <div style={{ fontSize: 12, color: C.ink, marginTop: 8 }}>
                  Check: cards {fmtLb(hist.sys_total_in)} + not linked {fmtLb(hist.sys_unmapped_total_in)}{hist.sys_outside_months_in ? ' + before the first month shown ' + fmtLb(hist.sys_outside_months_in) : ''} = warehouse Canadian total received {fmtLb(hist.sys_feed_total_in)} lb · cards {fmtLb(hist.sys_total_out)} + not linked {fmtLb(hist.sys_unmapped_total_out)}{hist.sys_outside_months_out ? ' + before the first month shown ' + fmtLb(hist.sys_outside_months_out) : ''} = shipped {fmtLb(hist.sys_feed_total_out)} lb. {hist.sys_reconciles ? <b style={{ color: C.ok }}>Adds up.</b> : <b style={{ color: C.warn }}>DOES NOT ADD UP — tell Claude.</b>}
                </div>
                {hist.sys_scope_unknown.length ? <div style={{ fontSize: 12, color: C.ink, marginTop: 6 }}>Cannot tell whether these are Canadian, so they are in no total: {hist.sys_scope_unknown.map(function (x) { return x.grade + ' (' + fmtLb(x.in_lb) + ' in / ' + fmtLb(x.out_lb) + ' out)'; }).join(', ')}.</div> : null}
              </div>
            ) : null}

            {open ? (
              <div style={Object.assign({}, box, { display: 'grid', gap: 14 })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', color: C.ink }}>{open.key} — Canada · old workbook to {dayLabel(hist.coverage.received.last)} (received) / {dayLabel(hist.coverage.shipped.last)} (shipped){by === 'cgt' ? (sysOk ? ' · new system to ' + dayLabel(hist.sys_last_in) : ' · new system NOT CHECKED') : ''}</h2>
                  <button style={btn} onClick={function () { setOpenKey(''); }}>Close</button>
                </div>
                <Bars group={open} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>By year (pounds recorded) — a year marked “partial” is not a whole year of records</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>Year</th><th style={thR}>Received (old workbook)</th>{by === 'cgt' ? <th style={thR}>Received (new system)</th> : null}<th style={thR}>Shipped (old workbook)</th>{by === 'cgt' ? <th style={thR}>Shipped (new system)</th> : null}</tr></thead>
                      <tbody>
                        {open.yearly.map(function (y) { return <tr key={y.year}><td style={td}>{y.year}</td><td style={tdR}>{y.in === null ? 'N/A' : fmtLb(y.in)}{y.in !== null && y.in_partial ? <span style={{ color: C.warn, fontSize: 11 }}> partial</span> : null}</td>{by === 'cgt' ? <td style={tdR}>{!y.sys_checked ? <span style={{ color: C.gold }}>not checked</span> : y.sys_in === null ? 'N/A' : fmtLb(y.sys_in)}{y.in_whole_year ? <span style={{ color: C.ok, fontSize: 11 }}> · whole year covered</span> : <span style={{ color: C.warn, fontSize: 11 }}> · year not complete</span>}</td> : null}<td style={tdR}>{y.out === null ? 'N/A' : fmtLb(y.out)}{y.out !== null && y.out_partial ? <span style={{ color: C.warn, fontSize: 11 }}> partial</span> : null}</td>{by === 'cgt' ? <td style={tdR}>{!y.sys_checked ? <span style={{ color: C.gold }}>not checked</span> : y.sys_out === null ? 'N/A' : fmtLb(y.sys_out)}{y.out_whole_year ? <span style={{ color: C.ok, fontSize: 11 }}> · whole year covered</span> : <span style={{ color: C.warn, fontSize: 11 }}> · year not complete</span>}</td> : null}</tr>; })}
                        <tr><td style={Object.assign({}, td, { fontWeight: 800 })}>Total recorded</td><td style={Object.assign({}, tdR, { fontWeight: 800 })}>{fmtLb(open.total_in)}</td>{by === 'cgt' ? <td style={Object.assign({}, tdR, { fontWeight: 800 })}>{open.sys_total_in === null ? 'not checked' : fmtLb(open.sys_total_in)}</td> : null}<td style={Object.assign({}, tdR, { fontWeight: 800 })}>{fmtLb(open.total_out)}</td>{by === 'cgt' ? <td style={Object.assign({}, tdR, { fontWeight: 800 })}>{open.sys_total_out === null ? 'not checked' : fmtLb(open.sys_total_out)}</td> : null}</tr>
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
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Shipped to (customer as written in the workbook) — recorded pounds</div>
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

            {sales ? (
              <div style={box}>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>Sales history — every Canadian release that shipped{openKey ? ' · ' + openKey : ''}</div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                  {sales.releases} releases, {fmtLb(sales.total_lb)} lb recorded, dated by the confirmed loading date. The old workbook has pounds and customers but no prices.
                  {sales.money_shown ? (' The dollar column is the KTC invoice the Hub already holds for that release number: ' + sales.with_ktc_invoice + ' releases have one (' + fmtUsd(sales.ktc_total) + ' on ' + fmtLb(sales.lb_with_ktc_invoice) + ' lb); ' + sales.without_ktc_invoice + ' have none here — they were invoiced by NexTrade or prepaid, so their dollars are unknown in the Hub, not zero. An invoice can cover more than the goods in this list, so $ per lb is a guide only.') : ' Dollar figures are shown to the super admin only.'}
                </div>
                {data && data.ktc_invoices_note ? <div style={{ background: C.warnBg, border: '1px solid #fecaca', color: C.warn, borderRadius: 8, padding: '6px 10px', fontSize: 12, marginBottom: 8 }}>{data.ktc_invoices_note} No dollars are shown.</div> : null}
                <input value={saleQ} onChange={function (e) { setSaleQ(e.target.value); setSaleN(60); }} placeholder="Search release, customer, invoice number or date" style={{ width: '100%', maxWidth: 420, fontSize: 13, padding: '6px 10px', border: '1px solid ' + C.line, borderRadius: 8, background: '#fff', color: C.ink, marginBottom: 8 }} />
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Loaded</th><th style={th}>Release</th><th style={th}>Customer</th><th style={th}>Goods (old name → counts as)</th><th style={thR}>Pounds</th><th style={th}>NexTrade invoice (workbook)</th>{sales.money_shown ? <th style={thR}>KTC invoice $</th> : null}{sales.money_shown ? <th style={thR}>$ per lb</th> : null}</tr></thead>
                    <tbody>
                      {saleRows.slice(0, saleN).map(function (r) {
                        return (
                          <tr key={r.key}>
                            <td style={Object.assign({}, td, { whiteSpace: 'nowrap' })}>{dayLabel(r.ship_date)}</td>
                            <td style={Object.assign({}, td, { whiteSpace: 'nowrap', fontWeight: 700 })}>{r.release_no}</td>
                            <td style={td}>{r.customer}</td>
                            <td style={td}>{r.lines.map(function (l, i) { return <div key={i}>{l.goods_name}{l.cgt_type && l.cgt_type !== l.goods_name ? ' → ' + l.cgt_type : ''}: {fmtLb(l.weight_lb)} lb</div>; })}</td>
                            <td style={tdR}>{fmtLb(r.total_lb)}</td>
                            <td style={td}>{r.nextrade_invoice || '—'}</td>
                            {sales.money_shown ? <td style={tdR}>{r.ktc_total === null ? <span style={{ color: C.muted }}>none in the Hub</span> : <span title={r.ktc_invoices.map(function (v) { return '#' + v.invoice_number + ' ' + (v.invoice_date || '') + ' ' + fmtUsd(v.total); }).join(' · ')}>{fmtUsd(r.ktc_total)}{r.ktc_invoices.length > 1 ? ' (' + r.ktc_invoices.length + ' invoices)' : ''}</span>}</td> : null}
                            {sales.money_shown ? <td style={tdR}>{r.usd_per_lb === null ? '—' : '$' + r.usd_per_lb.toFixed(4)}</td> : null}
                          </tr>
                        );
                      })}
                      {!saleRows.length ? <tr><td style={td} colSpan={8}>No release matches.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                {saleRows.length > saleN ? <button style={Object.assign({}, btn, { marginTop: 8 })} onClick={function () { setSaleN(saleN + 200); }}>Show more ({saleRows.length - saleN} more)</button> : null}
              </div>
            ) : null}

            <div style={box}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>Old Canadian name → current CGT goods type</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                This is what makes the comparison like for like. “Proposed” links are suggestions until the super admin saves them. A name with no match is never guessed: it stays under its own name until the super admin decides. Earlier decisions are kept.
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
                          <td style={td}>{src === 'proposed' ? <span style={{ color: C.gold, fontWeight: 700 }}>Proposed — not confirmed yet</span> : src === 'decided' ? <span style={{ color: C.ok, fontWeight: 700 }}>Decided</span> : src === 'decided-unmatched' ? 'Decided: keep separate' : <span style={{ color: C.warn, fontWeight: 700 }}>Waiting for a decision</span>}</td>
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
