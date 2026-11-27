'use client';
// v55.83-ZZ — Bills → 💸 Payments (Max 27 Nov: "a bills Report on payments made and dates associated to payment and wire from actual
// wire swift received. soo by date or vendor or custom dates or monthly..to provide to vendor etc."; his choices: its own tab in Bills,
// real Hub payments only, voided only when asked, bills paid through NextTrade / RTM in their own section).
// Read-only: nothing here changes a bill, a payment or a wire. var + string concatenation only.
// Codex 13:52: ZZ-01 the heading / CSV / vendor page describe the filters that were APPLIED (exports wait while the filters on screen
// differ); ZZ-02 no totals anywhere without "See Money Totals"; ZZ-03 every total is per currency, never added across currencies.
import React, { useState, useEffect } from 'react';
import BillDocViewer from './BillDocViewer';
import { paymentsCsv, moneyCur } from '../lib/bill-payments-report';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0'; var AMBER = '#b45309';
var FIELD = { background: '#ffffff', color: INK, border: '1px solid #cbd5e1', borderRadius: 2, padding: '5px 8px', fontSize: 12 };
function btn(bg, fg) { return { background: bg, color: fg, border: 'none', borderRadius: 2, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }; }
function pad(n) { return String(n).padStart(2, '0'); }
export function monthRange(ym) { if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) { return null; } var y = Number(ym.substring(0, 4)); var m = Number(ym.substring(5, 7)); var last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: ym + '-01', to: ym + '-' + pad(last) }; }
export function thisMonth(now) { var d = now || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
export function lastMonth(now) { var d = now || new Date(); var y = d.getFullYear(); var m = d.getMonth(); if (m === 0) { y--; m = 12; } return y + '-' + pad(m); }
export function monthWords(ym) { var r = monthRange(ym); if (!r) { return ym || ''; } return new Date(r.from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
export var EMPTY_WORDS = 'No live payments in this period. A payment appears here once it is recorded against its bank line (for a wire: once the wire is attached to the bank line).';
// totals per currency, in words: "$6,000.00 · CAD 1,200.00" (••• when hidden)
export function totalsWords(list, hidden) { if (hidden) { return '•••'; } return (list || []).map(function (t) { return moneyCur(t.total, t.currency); }).join(' · ') || '$0.00'; }
// the filters as they were sent — the heading, CSV and vendor page describe THESE, never what is merely selected on screen
export function filterKey(f) { return [f.mode, f.mode === 'month' ? f.ym : '', f.mode === 'custom' ? (f.from || '') : '', f.mode === 'custom' ? (f.to || '') : '', f.vendor || '', f.showVoided ? '1' : '0'].join('|'); }
export function periodWords(applied, rep) { return applied && applied.mode === 'month' ? monthWords(applied.ym) : ((rep && rep.period && rep.period.from) || '…') + ' to ' + ((rep && rep.period && rep.period.to) || '…'); }

// a printable page for ONE vendor (to send to them): KTC header, the period, every payment, its wire + bank reference, the total PER
// CURRENCY — or no total at all for a person without "See Money Totals"
export function vendorPrintHtml(rep, vendor, asOf) {
  function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var rows = rep.rows.filter(function (r) { return r.bill.vendor === vendor && !r.voided; });
  var tots = (rep.by_vendor || []).filter(function (v) { return v.vendor === vendor; });
  var period = (rep.period.from || '…') + ' to ' + (rep.period.to || '…');
  var foot = rep.totals_hidden ? '<tr><td colspan="8">Totals not shown</td></tr>' : (tots.length ? tots.map(function (t) { return '<tr><td colspan="4">Total paid (' + esc(t.currency) + ')</td><td class="n">' + esc(moneyCur(t.total, t.currency)) + '</td><td colspan="3"></td></tr>'; }).join('') : '<tr><td colspan="4">Total paid</td><td class="n">' + esc(moneyCur(0, 'USD')) + '</td><td colspan="3"></td></tr>');
  return '<!doctype html><html><head><meta charset="utf-8"><title>Payments — ' + esc(vendor) + '</title><style>body{font-family:Arial,sans-serif;color:#000;margin:28px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:4px 0 14px;font-weight:normal}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #000;padding:5px 6px;text-align:left}td.n,th.n{text-align:right}tfoot td{font-weight:bold}.s{font-size:11px;color:#333;margin-top:12px}</style></head><body>'
    + '<h1>KTC International — payments to ' + esc(vendor) + '</h1><h2>Period ' + esc(period) + ' · as of ' + esc(asOf) + '</h2>'
    + '<table><thead><tr><th>Paid date</th><th>Your bill number</th><th>Bill date</th><th>Release</th><th class="n">Amount paid</th><th>Wire</th><th>Wire sent</th><th>Bank reference</th></tr></thead><tbody>'
    + (rows.length ? rows.map(function (r) { return '<tr><td>' + esc(r.paid_date) + '</td><td>' + esc(r.bill.number) + '</td><td>' + esc(r.bill.date) + '</td><td>' + esc(r.bill.release || '') + '</td><td class="n">' + esc(moneyCur(r.amount, r.bill.currency)) + '</td><td>' + esc(r.wire ? r.wire.label : '') + '</td><td>' + esc(r.wire ? (r.wire.sent_date || '') : '') + '</td><td>' + esc(r.wire ? (r.wire.bank_reference || '') : '') + '</td></tr>'; }).join('') : '<tr><td colspan="8">No payments in this period.</td></tr>')
    + '</tbody><tfoot>' + foot + '</tfoot></table>'
    + '<div class="s">Bills are listed by your bill number. A wire can pay several bills; the bank reference is the one on our bank confirmation. Amounts are in the bill’s own currency.</div></body></html>';
}

export default function BillPaymentsReport(props) {
  var _m = useState('month'); var mode = _m[0], setMode = _m[1]; // 'month' | 'custom'
  var _ym = useState(thisMonth()); var ym = _ym[0], setYm = _ym[1];
  var _f = useState(''); var cFrom = _f[0], setCFrom = _f[1];
  var _t = useState(''); var cTo = _t[0], setCTo = _t[1];
  var _v = useState(''); var vendor = _v[0], setVendor = _v[1];
  var _sv = useState(false); var showVoided = _sv[0], setShowVoided = _sv[1];
  var _d = useState(null); var data = _d[0], setData = _d[1]; // { j, applied } — the answer AND the filters it answers
  var _b = useState(false); var busy = _b[0], setBusy = _b[1];
  var _e = useState(''); var err = _e[0], setErr = _e[1];
  var _p = useState(null); var proof = _p[0], setProof = _p[1];
  function current() { return { mode: mode, ym: ym, from: cFrom || null, to: cTo || null, vendor: vendor || '', showVoided: !!showVoided }; }
  function periodOf(f) { if (f.mode === 'month') { return monthRange(f.ym) || { from: null, to: null }; } return { from: f.from, to: f.to }; }
  function load() {
    var f = current(); var pr = periodOf(f); setBusy(true); setErr('');
    return props.api({ action: 'payments_report', date_from: pr.from, date_to: pr.to, vendor: f.vendor || null, show_voided: f.showVoided }).then(function (j) {
      setBusy(false);
      if (!j || !j.ok) { setErr((j && j.error) || 'The report could not be loaded.'); return; } // the last report shown stays, with ITS own heading
      setData({ j: j, applied: f });
    }, function () { setBusy(false); setErr('The report could not be loaded — check the connection and press Show again.'); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- first load only; filters apply on Show
  var rep = data && data.j && data.j.report; var applied = data && data.applied;
  var changed = !!(applied && filterKey(applied) !== filterKey(current()));
  var canExport = !!rep && !changed && !busy;
  var asOf = new Date().toISOString().substring(0, 10);
  function download() {
    if (!canExport) { return; }
    var csv = paymentsCsv(rep, asOf, 'Bill payments' + (applied.vendor ? ' — ' + applied.vendor : ''));
    try { var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bill-payments' + (applied.vendor ? '-' + applied.vendor.replace(/[^A-Za-z0-9]+/g, '-') : '') + '-' + (rep.period.from || 'start') + '-to-' + (rep.period.to || asOf) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); } catch (eD) { setErr('The file could not be made in this browser.'); }
  }
  function printFor(v) { if (!canExport) { return; } var w = null; try { w = window.open('', '_blank'); } catch (eW) { w = null; } if (!w) { setErr('The print page was blocked by the browser — allow pop-ups for the Hub and press it again.'); return; } w.document.open(); w.document.write(vendorPrintHtml(rep, v, asOf)); w.document.close(); try { w.focus(); w.print(); } catch (eP) { /* the person can print from the page */ } }
  var vendorsOnce = []; if (rep) { rep.by_vendor.forEach(function (x) { if (vendorsOnce.indexOf(x.vendor) < 0) { vendorsOnce.push(x.vendor); } }); }
  return <div data-testid="payments-report" className="rounded-xl p-3 mt-2" style={{ background: '#ffffff', color: INK, border: '1px solid ' + LINE }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 14, fontWeight: 900, flex: 1 }}>💸 Payments — what was paid, when, and by which wire</div>
      {props.onClose ? <button onClick={props.onClose} style={btn('#f1f5f9', '#334155')}>Close</button> : null}
    </div>
    <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>Read-only. Only real payments are counted; a voided payment is shown only when you tick “show voided”, and never counted. Totals are per currency.</div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: SUB }}>Period<br /><select aria-label="Period" value={mode} onChange={function (e) { setMode(e.target.value); }} style={FIELD}><option value="month">a month</option><option value="custom">custom dates</option></select></label>
      {mode === 'month' ? <label style={{ fontSize: 11, fontWeight: 700, color: SUB }}>Month<br /><input aria-label="Month" type="month" value={ym} onChange={function (e) { setYm(e.target.value); }} style={FIELD} /></label> : null}
      {mode === 'month' ? <button onClick={function () { setYm(thisMonth()); }} style={btn('#f1f5f9', '#334155')}>This month</button> : null}
      {mode === 'month' ? <button onClick={function () { setYm(lastMonth()); }} style={btn('#f1f5f9', '#334155')}>Last month</button> : null}
      {mode === 'custom' ? <label style={{ fontSize: 11, fontWeight: 700, color: SUB }}>From<br /><input aria-label="From" type="date" value={cFrom} onChange={function (e) { setCFrom(e.target.value); }} style={FIELD} /></label> : null}
      {mode === 'custom' ? <label style={{ fontSize: 11, fontWeight: 700, color: SUB }}>To<br /><input aria-label="To" type="date" value={cTo} onChange={function (e) { setCTo(e.target.value); }} style={FIELD} /></label> : null}
      <label style={{ fontSize: 11, fontWeight: 700, color: SUB }}>Vendor<br /><select aria-label="Vendor" value={vendor} onChange={function (e) { setVendor(e.target.value); }} style={FIELD}><option value="">all vendors</option>{((data && data.j && data.j.vendors) || []).map(function (v) { return <option key={v} value={v}>{v}</option>; })}</select></label>
      <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center', paddingBottom: 6 }}><input aria-label="Show voided" type="checkbox" checked={showVoided} onChange={function (e) { setShowVoided(e.target.checked); }} />show voided</label>
      <button data-testid="payments-show" disabled={busy} onClick={load} style={btn('#0f172a', '#ffffff')}>{busy ? 'Loading…' : 'Show'}</button>
      {rep ? <button data-testid="payments-csv" disabled={!canExport} onClick={download} title={canExport ? 'Download what is shown' : 'Press Show first — the list does not match the filters yet'} style={Object.assign(btn('#1e293b', '#ffffff'), { opacity: canExport ? 1 : 0.4 })}>⬇ CSV</button> : null}
    </div>
    {changed ? <div data-testid="payments-stale" style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: AMBER }}>The filters changed — press Show to update. Until then the list, CSV and vendor page are still for the filters shown below.</div> : null}
    {err ? <div role="alert" style={{ marginTop: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, color: '#991b1b', border: '1px solid #ef4444', background: '#fef2f2' }}>{'✗ ' + err}</div> : null}
    {rep ? <div style={{ marginTop: 10 }}>
      <div data-testid="payments-summary" style={{ fontSize: 13, fontWeight: 800 }}>{periodWords(applied, rep) + (applied.vendor ? ' · ' + applied.vendor : '') + ' — ' + rep.count + ' payment' + (rep.count === 1 ? '' : 's') + ' · ' + totalsWords(rep.totals, rep.totals_hidden) + (rep.voided_shown ? ' · ' + rep.voided_shown + ' voided shown, not counted' : '')}</div>
      {rep.floor ? <div style={{ fontSize: 11, color: AMBER, marginTop: 2 }}>{'Your access shows payments from ' + rep.floor + ' on.'}</div> : null}
      {!rep.rows.length ? <div data-testid="payments-empty" style={{ marginTop: 8, padding: '8px 10px', fontSize: 12, color: SUB, border: '1px dashed #cbd5e1' }}>{EMPTY_WORDS}</div> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ background: '#f8fafc', color: SUB, textAlign: 'left' }}><th style={{ padding: 6 }}>Paid</th><th style={{ padding: 6 }}>Vendor</th><th style={{ padding: 6 }}>Bill</th><th style={{ padding: 6 }}>Bill date</th><th style={{ padding: 6 }}>Release</th><th style={{ padding: 6, textAlign: 'right' }}>Amount</th><th style={{ padding: 6 }}>Wire</th><th style={{ padding: 6 }}>Bank line</th><th style={{ padding: 6 }}>SWIFT / bank proof</th></tr></thead>
        <tbody>{rep.rows.map(function (r) { return <tr key={r.payment_id} data-testid="payment-row" style={{ borderTop: '1px solid ' + LINE, color: r.voided ? '#94a3b8' : INK, textDecoration: r.voided ? 'line-through' : 'none' }}>
          <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{r.paid_date}{r.voided ? <span style={{ marginLeft: 4, fontWeight: 800, color: '#b91c1c', textDecoration: 'none' }}> VOIDED</span> : null}</td>
          <td style={{ padding: 6 }}>{r.bill.vendor}</td><td style={{ padding: 6, fontWeight: 700 }}>{r.bill.number}</td><td style={{ padding: 6 }}>{r.bill.date || '—'}</td><td style={{ padding: 6 }}>{r.bill.release || '—'}</td>
          <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{moneyCur(r.amount, r.bill.currency)}</td>
          <td style={{ padding: 6 }}>{r.wire ? r.wire.label + (r.wire.sent_date ? ' · sent ' + r.wire.sent_date : '') + (r.wire.bank_reference ? ' · ref ' + r.wire.bank_reference : '') : (r.method ? r.method : 'direct from the bank line')}</td>
          <td style={{ padding: 6 }}>{r.bank ? r.bank.date + ' · ' + moneyCur(r.bank.amount, 'USD') + (r.bank.name ? ' · ' + r.bank.name : '') : '—'}</td>
          <td style={{ padding: 6 }}>{r.wire && r.wire.proofs.length ? r.wire.proofs.map(function (pf) { return <button key={pf.id} data-testid="open-proof" onClick={function () { setProof({ title: r.wire.label + ' — ' + pf.file_name, path: pf.path }); }} style={Object.assign(btn('#1d4ed8', '#ffffff'), { padding: '3px 8px', fontSize: 11 })}>📄 SWIFT</button>; }) : <span style={{ color: SUB }}>{r.wire ? 'no confirmation attached' : '—'}</span>}</td>
        </tr>; })}</tbody>
      </table></div>}
      {rep.by_vendor.length ? <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
        <div><div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>BY VENDOR</div>{vendorsOnce.map(function (vn) { var vs = rep.by_vendor.filter(function (x) { return x.vendor === vn; }); var n = 0; vs.forEach(function (x) { n += x.count; }); return <div key={vn} data-testid="vendor-total" style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}><span style={{ minWidth: 180 }}>{vn}</span><span style={{ fontWeight: 800 }}>{n + ' · ' + totalsWords(vs, rep.totals_hidden)}</span><button data-testid="print-vendor" disabled={!canExport} onClick={function () { printFor(vn); }} title="A clean page for this vendor: every payment, its wire and bank reference, and the total" style={Object.assign(btn('#f1f5f9', '#334155'), { padding: '2px 8px', fontSize: 11, opacity: canExport ? 1 : 0.4 })}>🖨 for the vendor</button></div>; })}</div>
        <div><div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>BY MONTH</div>{rep.by_month.map(function (x) { return <div key={x.month + x.currency} data-testid="month-total" style={{ fontSize: 12, marginTop: 2 }}>{monthWords(x.month) + ': ' + x.count + ' · ' + (rep.totals_hidden ? '•••' : moneyCur(x.total, x.currency))}</div>; })}</div>
      </div> : null}
      {rep.paid_through.length ? <div data-testid="paid-through" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{'Paid through NextTrade / RTM (' + rep.paid_through.length + ') — not paid from our bank; the date is in their funding record'}</div>
        {rep.paid_through.map(function (b) { return <div key={b.id} style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{b.vendor + ' · bill ' + b.number + ' · ' + (b.date || '—') + ' · ' + moneyCur(b.total, b.currency) + ' · paid through ' + b.paid_via}</div>; })}
      </div> : null}
    </div> : null}
    {proof ? <div data-testid="proof-popup" role="dialog" aria-modal="true" aria-label={proof.title} onClick={function () { setProof(null); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}><div onClick={function (e) { e.stopPropagation(); }} style={{ background: '#ffffff', width: 900, maxWidth: '96vw', maxHeight: '94vh', overflow: 'auto', border: '2px solid #000000' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#000000', color: '#ffffff', fontWeight: 800, fontSize: 13 }}><span style={{ flex: 1 }}>{proof.title}</span><button data-testid="close-proof" onClick={function () { setProof(null); }} style={btn('#ffffff', '#000000')}>Close ✕</button></div>
      <div style={{ padding: 10 }}><BillDocViewer bill={{ attachment_path: proof.path }} /></div></div></div> : null}
  </div>;
}
