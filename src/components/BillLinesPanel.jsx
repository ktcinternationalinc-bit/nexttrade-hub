'use client';
// v55.83-RQ — a bill's lines and the Hub's price check (Max, Nov 9 21:10 / 21:18):
//  NexPac: "broken down for each product billed line with 2 lines. actual cost and commission line"
//  "if there is an issue that the HUB sees, then it should flag it for manual intervention"
import React, { useState, useEffect } from 'react';
import { PRICE_STATUS_LABEL, LINE_KIND_LABEL } from '../lib/bill-lines';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qtyF(n) { return n == null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }); }
function rateF(n) { return n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }); }

export function PriceCheckBox(p) {
  var c = p.check; var st = p.status || (c && c.status) || 'not_checked';
  var bg = st === 'flagged' ? '#fee2e2' : st === 'ok' ? '#d1fae5' : '#f1f5f9';
  var fg = st === 'flagged' ? '#7f1d1d' : st === 'ok' ? '#065f46' : '#334155';
  return <div className="rounded-lg px-3 py-2 my-1" style={{ background: bg, border: '1px solid ' + (st === 'flagged' ? '#fca5a5' : '#e2e8f0') }}>
    <div className="text-[12px] font-extrabold" style={{ color: fg }}>{'Hub price check: ' + (PRICE_STATUS_LABEL[st] || st)}{c && c.commission_rule ? ' · ' + c.commission_rule.vendor + ' bills cost + ' + (c.commission_rule.rate * 100) + '% commission' : ''}</div>
    {c && (c.flags || []).map(function (f, i) { return <div key={i} className="text-[12px] font-bold" style={{ color: '#7f1d1d' }}>{'⚠ ' + f.text}</div>; })}
    {c && (c.notes || []).length > 0 && <div className="text-[11px]" style={{ color: MUTED }}>{c.notes.length + ' line(s) have no price rule yet' + (p.onRules ? ' — ' : '.')}{p.onRules && <button onClick={p.onRules} className="underline font-bold" style={{ color: '#1d4ed8' }}>add price rules</button>}</div>}
    {st === 'flagged' && p.resolved && <div className="text-[11px] mt-1" style={{ color: '#065f46' }}>{'✓ Resolved: “' + p.resolved + '”'}</div>}
    {st === 'flagged' && !p.resolved && <div className="text-[11px] mt-1 font-bold" style={{ color: '#7f1d1d' }}>A person must check this. It can be validated only with a written explanation of how it was resolved.</div>}
  </div>;
}

export default function BillLinesPanel(p) {
  var b = p.bill; var api = p.api; var toast = p.toast;
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(null); var ed = s2[0]; var setEd = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  function load() { api({ action: 'bill_lines', id: b.id }).then(function (j) { setD(j && j.ok ? j : { ok: false, error: (j && j.error) || 'Could not load the lines.' }); }); }
  useEffect(function () { load(); }, [b.id]); // eslint-disable-line
  if (!d) { return <div className="text-[11px]" style={{ color: MUTED }}>Loading lines…</div>; }
  if (!d.ok) { return <div className="text-[11px] font-bold" style={{ color: '#7f1d1d' }}>{d.error}</div>; }
  if (d.sql_missing) { return <div className="text-[11px]" style={{ color: MUTED }}>{d.note}</div>; }
  var cr = d.commission_rule; var lines = d.lines || [];
  var canEdit = p.canManage && !d.locked && b.record_status === 'active';
  function save() {
    setBusy(true);
    api({ action: 'save_lines', id: b.id, lines: ed }).then(function (j) {
      if (j && j.ok) { toast.success('Lines saved — the price check ran again.'); setEd(null); load(); if (p.onChanged) { p.onChanged(); } }
      else { toast.error((j && j.error) || 'The lines were not saved.'); }
    }).finally(function () { setBusy(false); });
  }
  function recheck() { setBusy(true); api({ action: 'price_check', id: b.id }).then(function (j) { if (j && j.ok) { load(); if (p.onChanged) { p.onChanged(); } } else { toast.error((j && j.error) || 'Check failed.'); } }).finally(function () { setBusy(false); }); }

  if (ed) {
    var inp = 'px-1.5 py-1 rounded border text-[11px] nt-light';
    var st = { color: INK, background: '#ffffff', borderColor: '#cbd5e1' };
    function setF(i, k, v) { var n = ed.slice(); n[i] = Object.assign({}, n[i]); n[i][k] = v; setEd(n); }
    var sum = ed.reduce(function (a, l) { var am = l.amount !== '' && l.amount != null ? Number(String(l.amount).replace(/[$,]/g, '')) : (Number(l.qty) || 0) * (Number(l.unit_price) || 0); return a + (isFinite(am) ? am : 0); }, 0);
    return <div className="rounded-lg p-2" style={{ background: '#ffffff', border: '1px solid #bfdbfe' }}>
      <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>Edit the lines exactly as printed on the bill</div>
      {ed.map(function (l, i) {
        return <div key={i} className="flex gap-1 items-center mb-1 flex-wrap">
          <span className="text-[10px] w-5 text-right" style={{ color: MUTED }}>{i + 1}</span>
          <select className={inp} style={st} value={l.line_kind || 'item'} onChange={function (e) { setF(i, 'line_kind', e.target.value); }}>
            {['item', 'charge', 'commission'].map(function (k) { return <option key={k} value={k}>{LINE_KIND_LABEL[k]}</option>; })}
          </select>
          <input className={inp} style={Object.assign({ width: 230 }, st)} placeholder="description" value={l.description || ''} onChange={function (e) { setF(i, 'description', e.target.value); }} />
          <input className={inp} style={Object.assign({ width: 80 }, st)} placeholder="qty" value={l.qty == null ? '' : l.qty} onChange={function (e) { setF(i, 'qty', e.target.value); }} />
          <input className={inp} style={Object.assign({ width: 60 }, st)} placeholder="unit" value={l.unit || ''} onChange={function (e) { setF(i, 'unit', e.target.value); }} />
          <input className={inp} style={Object.assign({ width: 80 }, st)} placeholder="rate" value={l.unit_price == null ? '' : l.unit_price} onChange={function (e) { setF(i, 'unit_price', e.target.value); }} />
          <input className={inp} style={Object.assign({ width: 90 }, st)} placeholder="amount" value={l.amount == null ? '' : l.amount} onChange={function (e) { setF(i, 'amount', e.target.value); }} />
          <button onClick={function () { setEd(ed.filter(function (x, k) { return k !== i; })); }} className="px-1.5 py-0.5 rounded text-[11px] font-bold" style={{ background: '#fee2e2', color: '#b91c1c' }}>✕</button>
        </div>;
      })}
      <div className="flex gap-2 items-center mt-1 flex-wrap">
        <button onClick={function () { setEd(ed.concat([{ line_kind: b.bill_type && b.bill_type !== 'supplier' ? 'charge' : 'item', description: '', qty: '', unit: '', unit_price: '', amount: '' }])); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#e0e7ff', color: '#312e81' }}>＋ line</button>
        <span className="text-[11px] font-bold" style={{ color: Math.abs(sum - Number(b.total_amount)) > 0.01 ? '#b91c1c' : '#065f46' }}>{'Lines: $' + fmt(sum) + ' · bill total: $' + fmt(b.total_amount)}</span>
        <div className="flex-1" />
        <button disabled={busy} onClick={save} className="px-3 py-1 rounded text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>{busy ? 'Saving…' : '💾 Save lines'}</button>
        <button onClick={function () { setEd(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#e2e8f0', color: SUB }}>cancel</button>
      </div>
    </div>;
  }

  var items = lines.filter(function (l) { return l.line_kind !== 'commission'; });
  var comms = lines.filter(function (l) { return l.line_kind === 'commission'; });
  var tCost = 0; var tCom = 0; var tAll = 0;
  return <div>
    <PriceCheckBox check={d.price_check} status={d.price_check_status} resolved={d.price_resolved_note} onRules={p.onRules} />
    {lines.length === 0 ? <div className="text-[11px] my-1" style={{ color: MUTED }}>No lines on this bill yet{canEdit ? ' — add them so the Hub can check the prices and count the products.' : '.'}</div> :
    <div className="overflow-x-auto rounded-lg my-1" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[11px]">
      <thead><tr style={{ background: '#f1f5f9', color: SUB }}>
        <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">{cr ? 'Product / line' : 'Line'}</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-left">Unit</th>
        <th className="px-2 py-1 text-right">Rate</th><th className="px-2 py-1 text-right">{cr ? 'Actual cost' : 'Amount'}</th>{cr && <th className="px-2 py-1 text-right">Total with commission</th>}</tr></thead>
      <tbody style={{ color: INK }}>
        {items.map(function (l) {
          var cost = Number(l.cost_amount != null ? l.cost_amount : l.amount) || 0; var com = Number(l.commission_amount) || 0;
          tCost += cost; tCom += com; tAll += cost + com;
          var rows = [<tr key={l.line_no} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td className="px-2 py-1" style={{ color: MUTED }}>{l.line_no}</td>
            <td className="px-2 py-1 font-bold">{l.description}{l.line_kind === 'charge' && !cr ? <span className="ml-1 text-[10px]" style={{ color: MUTED }}>(charge)</span> : null}</td>
            <td className="px-2 py-1 text-right tabular-nums">{qtyF(l.qty)}</td><td className="px-2 py-1">{l.unit || ''}</td>
            <td className="px-2 py-1 text-right tabular-nums">{rateF(l.unit_price)}</td><td className="px-2 py-1 text-right tabular-nums">${fmt(cost)}</td>
            {cr && <td className="px-2 py-1 text-right tabular-nums font-extrabold" rowSpan={l.commission_amount != null ? 2 : 1}>${fmt(cost + com)}</td>}
          </tr>];
          if (cr && l.commission_amount != null) {
            rows.push(<tr key={l.line_no + 'c'} style={{ background: '#fffbeb' }}>
              <td className="px-2 py-0.5" /><td className="px-2 py-0.5 pl-6" style={{ color: '#92400e' }}>{'↳ commission ' + (Number(l.commission_rate) * 100) + '%'}</td>
              <td colSpan={3} /><td className="px-2 py-0.5 text-right tabular-nums" style={{ color: '#92400e' }}>${fmt(com)}</td>
            </tr>);
          }
          return rows;
        })}
        {comms.map(function (l) { return <tr key={'cm' + l.line_no} style={{ borderTop: '1px solid #f1f5f9', color: MUTED }}>
          <td className="px-2 py-1">{l.line_no}</td><td className="px-2 py-1" colSpan={4}>{'“' + l.description + '” on the bill — $' + fmt(l.amount) + (cr ? ' (spread over the products above)' : '')}</td><td className="px-2 py-1 text-right tabular-nums">{cr ? '' : '$' + fmt(l.amount)}</td>{cr && <td />}
        </tr>; })}
        {cr && items.length > 0 && <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}>
          <td /><td className="px-2 py-1 font-extrabold">Totals</td><td colSpan={3} className="px-2 py-1 text-right" style={{ color: '#92400e' }}>{'commission $' + fmt(tCom)}</td>
          <td className="px-2 py-1 text-right font-extrabold tabular-nums">${fmt(tCost)}</td><td className="px-2 py-1 text-right font-extrabold tabular-nums">${fmt(tAll)}</td></tr>}
      </tbody></table></div>}
    <div className="flex gap-2 items-center">
      {canEdit && <button onClick={function () { setEd(lines.map(function (l) { return { line_kind: l.line_kind, description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, amount: l.amount }; })); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#e0e7ff', color: '#312e81' }}>{lines.length ? '✏ Edit lines' : '＋ Add lines'}</button>}
      <button disabled={busy} onClick={recheck} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: SUB }}>↻ Check prices again</button>
      {d.locked && <span className="text-[10px]" style={{ color: MUTED }}>Validated — the lines are locked (reopen the validation to change them).</span>}
    </div>
  </div>;
}
