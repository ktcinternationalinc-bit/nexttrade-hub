'use client';
// v55.83-RQ — Max, Nov 9 21:18: "we also need a section to enter the prices of the types of products supplied so the HUB
// can validate that the correct prices were entered into the bill. Same for trucking.. or any other type of charge.. there
// should be a rule creation where we can enter the types of services or supplies and the expected cost"
import React, { useState, useEffect } from 'react';
import { BILL_TYPES, BILL_TYPE_LABEL } from '../lib/bill-extract';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
var BLANK = { vendor_match: '', bill_type: '', item_match: '', unit: '', price_mode: 'unit', expected_unit_price: '', expected_amount: '', tolerance_pct: '2', applies_to: 'cost', note: '' };

export default function PriceRulesPanel(p) {
  var api = p.api; var toast = p.toast;
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(null); var f = s2[0]; var setF = s2[1];
  var s3 = useState(null); var cf = s3[0]; var setCf = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(''); var q = s5[0]; var setQ = s5[1];
  function load() { api({ action: 'price_rules_list' }).then(function (j) { setD(j && j.ok ? j : { ok: false, error: (j && j.error) || 'Could not load the rules.' }); }); }
  useEffect(function () { load(); }, []); // eslint-disable-line
  if (!d) { return <div className="nt-paper rounded-xl p-3 mb-3 text-[12px]" style={{ color: MUTED }}>Loading price rules…</div>; }
  var inp = 'px-2 py-1.5 rounded-lg border text-[12px] nt-light'; var st = { color: INK, background: '#ffffff', borderColor: '#cbd5e1' };
  var can = !!d.can_edit;
  function saveRule() {
    var r = Object.assign({}, f);
    if (r.price_mode === 'unit') { r.expected_amount = ''; } else { r.expected_unit_price = ''; }
    setBusy(true);
    api({ action: 'price_rule_save', rule: r }).then(function (j) {
      if (j && j.ok) { toast.success('Rule saved — ' + j.rechecked + ' open bill(s) checked again' + (j.remaining ? ' (' + j.remaining + ' more are checked when opened)' : '') + '.'); setF(null); load(); if (p.onChanged) { p.onChanged(); } }
      else { toast.error((j && j.error) || 'Not saved.'); }
    }).finally(function () { setBusy(false); });
  }
  function onOff(r) { setBusy(true); api({ action: 'price_rule_off', id: r.id, active: r.active === false }).then(function (j) { if (j && j.ok) { load(); if (p.onChanged) { p.onChanged(); } } else { toast.error((j && j.error) || 'Failed.'); } }).finally(function () { setBusy(false); }); }
  function saveComm() {
    setBusy(true);
    api({ action: 'commission_rule_save', rule: cf }).then(function (j) {
      if (j && j.ok) { toast.success('Commission rule saved — ' + j.rechecked + ' open bill(s) checked again' + (j.remaining ? ' (' + j.remaining + ' more when opened)' : '') + '.'); setCf(null); load(); if (p.onChanged) { p.onChanged(); } }
      else { toast.error((j && j.error) || 'Not saved.'); }
    }).finally(function () { setBusy(false); });
  }
  var rules = (d.rules || []).filter(function (r) { var t = (String(r.vendor_match || '') + ' ' + (r.item_match || '') + ' ' + (r.bill_type || '') + ' ' + (r.note || '')).toLowerCase(); return !q || t.indexOf(q.toLowerCase()) >= 0; });
  function priceTxt(r) { return r.expected_unit_price != null ? '$' + Number(r.expected_unit_price).toLocaleString('en-US', { maximumFractionDigits: 5 }) + ' per ' + (r.unit || 'unit') : '$' + Number(r.expected_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) + (r.item_match ? ' per line' : ' per bill'); }

  return <div className="nt-paper rounded-xl p-3 mb-3" style={{ border: '2px solid #a5b4fc' }}>
    <div className="flex gap-2 items-center flex-wrap mb-1">
      <div className="text-[14px] font-extrabold" style={{ color: INK }}>📏 Price rules — what each product or service should cost</div>
      <div className="flex-1" />
      <button onClick={p.onClose} className="px-3 py-1 rounded-lg text-[12px] font-bold" style={{ background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' }}>✕ Close</button>
    </div>
    <div className="text-[12px] mb-2" style={{ color: SUB }}>Every bill line is checked against these rules when it comes in. A price outside the allowed difference is <b style={{ color: '#b91c1c' }}>flagged</b>: a person must check it and write how it was resolved before the bill can be validated.</div>
    {d.sql_missing && <div className="rounded-lg p-2 mb-2 text-[12px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{d.note}</div>}
    {!can && !d.sql_missing && <div className="text-[11px] mb-2" style={{ color: MUTED }}>You can see the rules. Changing them needs “Set price rules” (Settings → 🏦 Banking & Accounting Access → Bills).</div>}

    {/* commission vendors */}
    <div className="rounded-lg p-2 mb-2" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
      <div className="text-[12px] font-extrabold" style={{ color: '#78350f' }}>Vendors that bill COST + a commission</div>
      {(d.commission_rules || []).map(function (c) {
        return <div key={c.id} className="text-[12px] flex gap-2 items-center" style={{ color: INK }}>
          <b>{c.vendor_match}</b><span>{'cost + ' + (Number(c.rate) * 100) + '% commission'}</span>
          {(c.default_direction || /^nexpac$/i.test(String(c.vendor_match).trim())) && <span className="px-1.5 py-0.5 rounded text-[11px] font-bold" style={{ background: '#e0e7ff', color: '#312e81' }}>{'bills are ' + (c.default_direction === 'outbound' ? 'Outbound ➡' : '⬅ Inbound') + ' (pre-picked, can be changed per bill)'}</span>}{c.active === false && <span style={{ color: MUTED }}>(off)</span>}
          <span className="text-[11px]" style={{ color: MUTED }}>{c.note || ''}</span>
          {can && <button onClick={function () { setCf({ id: c.id, vendor_match: c.vendor_match, rate_pct: String(Number(c.rate) * 100), note: c.note || '', active: c.active !== false, default_direction: c.default_direction || (/^nexpac$/i.test(String(c.vendor_match).trim()) ? 'inbound' : '') }); }} className="underline text-[11px] font-bold" style={{ color: '#1d4ed8' }}>change</button>}
        </div>;
      })}
      <div className="text-[11px]" style={{ color: '#92400e' }}>Their bills show each product at cost plus one commission line; the Hub spreads the commission over the products, so each product shows its actual cost and its commission.</div>
      {can && !cf && <button onClick={function () { setCf({ vendor_match: '', rate_pct: '12.5', note: '', active: true, default_direction: '' }); }} className="mt-1 px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#ffffff', color: '#78350f', border: '1px solid #fcd34d' }}>＋ another commission vendor</button>}
      {cf && <div className="flex gap-2 items-center mt-1 flex-wrap">
        <input className={inp} style={Object.assign({ width: 180 }, st)} placeholder="vendor name (e.g. NexPac)" value={cf.vendor_match} onChange={function (e) { setCf(Object.assign({}, cf, { vendor_match: e.target.value })); }} />
        <input className={inp} style={Object.assign({ width: 80 }, st)} placeholder="%" value={cf.rate_pct} onChange={function (e) { setCf(Object.assign({}, cf, { rate_pct: e.target.value })); }} /><span className="text-[12px]" style={{ color: SUB }}>% on top of cost</span>
        <span className="text-[12px]" style={{ color: SUB }}>· their bills are</span>
        <select className={inp} style={st} value={cf.default_direction || ''} onChange={function (e) { setCf(Object.assign({}, cf, { default_direction: e.target.value })); }}>
          <option value="">— no default —</option><option value="inbound">⬅ Inbound</option><option value="outbound">Outbound ➡</option></select>
        {cf.id && <label className="text-[12px]" style={{ color: SUB }}><input type="checkbox" checked={cf.active !== false} onChange={function (e) { setCf(Object.assign({}, cf, { active: e.target.checked })); }} /> on</label>}
        <button disabled={busy} onClick={saveComm} className="px-3 py-1 rounded text-[12px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Save</button>
        <button onClick={function () { setCf(null); }} className="px-2 py-1 rounded text-[12px] font-bold" style={{ background: '#e2e8f0', color: SUB }}>cancel</button>
      </div>}
    </div>

    {/* price rules */}
    <div className="flex gap-2 items-center mb-1 flex-wrap">
      <div className="text-[12px] font-extrabold" style={{ color: INK }}>{'Expected prices (' + (d.rules || []).length + ')'}</div>
      <input className={inp} style={Object.assign({ width: 220 }, st)} placeholder="🔎 search rules" value={q} onChange={function (e) { setQ(e.target.value); }} />
      <div className="flex-1" />
      {can && !f && <button onClick={function () { setF(Object.assign({}, BLANK)); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#4f46e5', color: '#ffffff' }}>＋ New price rule</button>}
    </div>
    {f && <div className="rounded-lg p-2 mb-2" style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <label className="text-[11px] font-bold" style={{ color: SUB }}>Product / service words<input className={inp + ' w-full mt-0.5'} style={st} placeholder="e.g. Cambridge Seconds · Line Haul · Rail swing" value={f.item_match} onChange={function (e) { setF(Object.assign({}, f, { item_match: e.target.value })); }} /></label>
        <label className="text-[11px] font-bold" style={{ color: SUB }}>Vendor (empty = any vendor)<input className={inp + ' w-full mt-0.5'} style={st} placeholder="e.g. NexPac · AMB Logistic" value={f.vendor_match} onChange={function (e) { setF(Object.assign({}, f, { vendor_match: e.target.value })); }} /></label>
        <label className="text-[11px] font-bold" style={{ color: SUB }}>Bill type (optional)<select className={inp + ' w-full mt-0.5'} style={st} value={f.bill_type} onChange={function (e) { setF(Object.assign({}, f, { bill_type: e.target.value })); }}>
          <option value="">any type</option>{BILL_TYPES.map(function (t) { return <option key={t} value={t}>{BILL_TYPE_LABEL[t]}</option>; })}</select></label>
      </div>
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        {[['unit', 'Price per unit'], ['amount', f.item_match ? 'Fixed amount per line' : 'Fixed amount per bill']].map(function (m) { var on = f.price_mode === m[0]; return <button key={m[0]} onClick={function () { setF(Object.assign({}, f, { price_mode: m[0] })); }} className="px-2 py-1 rounded text-[12px] font-extrabold" style={on ? { background: '#312e81', color: '#ffffff' } : { background: '#ffffff', color: '#312e81', border: '1px solid #c7d2fe' }}>{m[1]}</button>; })}
        {f.price_mode === 'unit' ? <span className="flex gap-1 items-center"><input className={inp} style={Object.assign({ width: 100 }, st)} placeholder="$ e.g. 0.26" value={f.expected_unit_price} onChange={function (e) { setF(Object.assign({}, f, { expected_unit_price: e.target.value })); }} /><span className="text-[12px]" style={{ color: SUB }}>per</span><input className={inp} style={Object.assign({ width: 80 }, st)} placeholder="LBS" value={f.unit} onChange={function (e) { setF(Object.assign({}, f, { unit: e.target.value })); }} /></span>
          : <input className={inp} style={Object.assign({ width: 120 }, st)} placeholder="$ e.g. 1850.00" value={f.expected_amount} onChange={function (e) { setF(Object.assign({}, f, { expected_amount: e.target.value })); }} />}
        <span className="text-[12px]" style={{ color: SUB }}>allowed difference</span><input className={inp} style={Object.assign({ width: 60 }, st)} value={f.tolerance_pct} onChange={function (e) { setF(Object.assign({}, f, { tolerance_pct: e.target.value })); }} /><span className="text-[12px]" style={{ color: SUB }}>%</span>
      </div>
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        <span className="text-[12px]" style={{ color: SUB }}>For a commission vendor, this price is the</span>
        {[['cost', 'cost (as printed)'], ['billed', 'cost + commission']].map(function (m) { var on = f.applies_to === m[0]; return <button key={m[0]} onClick={function () { setF(Object.assign({}, f, { applies_to: m[0] })); }} className="px-2 py-1 rounded text-[11px] font-bold" style={on ? { background: '#78350f', color: '#ffffff' } : { background: '#ffffff', color: '#78350f', border: '1px solid #fcd34d' }}>{m[1]}</button>; })}
        <input className={inp} style={Object.assign({ flex: '1 1 200px' }, st)} placeholder="note (optional) — e.g. agreed with NexPac, Jun 2026" value={f.note} onChange={function (e) { setF(Object.assign({}, f, { note: e.target.value })); }} />
        <button disabled={busy} onClick={saveRule} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>{busy ? 'Saving…' : '💾 Save rule'}</button>
        <button onClick={function () { setF(null); }} className="px-2 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#e2e8f0', color: SUB }}>cancel</button>
      </div>
    </div>}
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
      <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-1.5 text-left">Product / service</th><th className="px-2 py-1.5 text-left">Vendor</th><th className="px-2 py-1.5 text-left">Type</th>
        <th className="px-2 py-1.5 text-right">Expected price</th><th className="px-2 py-1.5 text-right">± %</th><th className="px-2 py-1.5 text-left">Note</th><th className="px-2 py-1.5" /></tr></thead>
      <tbody style={{ color: INK }}>
        {rules.map(function (r) {
          return <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9', opacity: r.active === false ? 0.5 : 1 }}>
            <td className="px-2 py-1.5 font-bold">{r.item_match || '(whole bill)'}</td><td className="px-2 py-1.5">{r.vendor_match || 'any'}</td><td className="px-2 py-1.5">{BILL_TYPE_LABEL[r.bill_type] || 'any'}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{priceTxt(r) + (r.applies_to === 'billed' ? ' (incl. commission)' : '')}</td><td className="px-2 py-1.5 text-right">{Number(r.tolerance_pct)}</td>
            <td className="px-2 py-1.5" style={{ color: MUTED }}>{r.note || ''}{r.active === false ? ' (off)' : ''}</td>
            <td className="px-2 py-1.5 whitespace-nowrap">{can && <span>
              <button onClick={function () { setF({ id: r.id, vendor_match: r.vendor_match || '', bill_type: r.bill_type || '', item_match: r.item_match || '', unit: r.unit || '', price_mode: r.expected_unit_price != null ? 'unit' : 'amount', expected_unit_price: r.expected_unit_price == null ? '' : String(r.expected_unit_price), expected_amount: r.expected_amount == null ? '' : String(r.expected_amount), tolerance_pct: String(r.tolerance_pct), applies_to: r.applies_to || 'cost', note: r.note || '' }); }} className="underline font-bold mr-2" style={{ color: '#1d4ed8' }}>change</button>
              <button disabled={busy} onClick={function () { onOff(r); }} className="underline font-bold" style={{ color: r.active === false ? '#047857' : '#b91c1c' }}>{r.active === false ? 'turn on' : 'turn off'}</button></span>}</td>
          </tr>;
        })}
        {rules.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-center" style={{ color: MUTED }}>{(d.rules || []).length ? 'No rule matches the search.' : 'No price rules yet. Add the prices you agreed (e.g. NexPac “Cambridge Seconds” $0.26 per LBS, AMB “Line Haul” $1,850).'}</td></tr>}
      </tbody></table></div>
  </div>;
}
