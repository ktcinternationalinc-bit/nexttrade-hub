'use client';
// v55.83-SY — Accounting > 📊 Profitability (product · customer · invoice). Max, Nov 16 2026.
// NOT the cash report: dated by invoice date, includes unpaid invoices and bills, a standard inbound allowance and
// labelled estimates. Every number here is worked out by lib/profitability.js on the server; this screen only shows it
// and lets a person make the REPORT decisions (names that belong together, units, pricing basis, …).
// Nothing on this screen changes an invoice, a bill, inventory or the ledger.
// All colours are inline: the dark theme repaints the bg-white class, which is how the Stats table became unreadable.
import React, { useState, useEffect } from 'react';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt0(n) { return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmt4(n) { return n === null || n === undefined ? '—' : '$' + Number(n).toFixed(4); }

var FLAG_WORDS = {
  basis_missing: 'Pricing basis not set (EXW / CNF / trucking included)',
  transport_not_separated: 'Transportation not separated from the price',
  release_missing: 'No release number on the invoice',
  release_split_missing: 'Invoice is on two releases — pounds per release not entered',
  unit_unknown: 'Unit not set (pounds, yards or linear metres)',
  cost_missing: 'Goods cost missing',
  cost_manual: 'Goods cost typed by hand',
  purchase_line_without_cost: 'A linked supplier bill line has no cost on it',
  no_bill_description_linked: 'No supplier bill description linked to this product',
  not_grouped_no_cost_source: 'Not in a product group, so no cost source',
  outbound_bill_missing: 'Outbound transportation bill missing',
  outbound_estimate: 'Outbound transportation is an ESTIMATE',
  allocation_unresolved_missing_weight: 'A split could not be made — a product has no weight',
  embedded_exceeds_goods: 'Transportation entered is more than the goods on the invoice',
  manual_transport_ignored_not_inclusive: 'A typed transportation amount was ignored (invoice is not CNF / trucking included)',
  bill_line_unit_unknown: 'A linked supplier bill line has no usable unit',
  brokerage_bill_on_non_houston_release: 'Brokerage / bonded bill is on a release that is not Houston',
  bill_split_unresolved: 'A bill could not be split between its releases',
  transport_bill_not_marked_outbound: 'A trucking / shipping bill on this release is not marked OUTBOUND, so it was not counted',
  two_trucking_bills_on_one_release: 'TWO trucking bills on one release (only one is allowed)'
};
var BASIS_WORDS = { EXW: 'EXW', CNF: 'CNF', TRUCKING_INCLUDED: 'Trucking included' };
var UNIT_WORDS = { lb: 'pounds', yd: 'yards', lm: 'linear metres' };
var COLS = [['goods_revenue', 'Goods revenue'], ['transport_revenue', 'Transport charged'], ['base_cost', 'Goods cost'], ['commission', 'Commission'], ['inbound_allowance', 'Inbound allowance'], ['outbound_cost', 'Outbound transport'], ['brokerage', 'Brokerage'], ['bonded', 'Bonded']];

export default function ProfitabilityTab(props) {
  var userProfile = props.userProfile;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(''); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState('product'); var view = s5[0]; var setView = s5[1];
  var s6 = useState(null); var open = s6[0]; var setOpen = s6[1];
  var s7 = useState({}); var pick = s7[0]; var setPick = s7[1];
  var s8 = useState(''); var groupName = s8[0]; var setGroupName = s8[1];
  var s9 = useState(''); var addTo = s9[0]; var setAddTo = s9[1];
  var s10 = useState(null); var linkFor = s10[0]; var setLinkFor = s10[1];
  var s11 = useState({}); var billPick = s11[0]; var setBillPick = s11[1];
  var s12 = useState(''); var billQ = s12[0]; var setBillQ = s12[1];
  var s13 = useState({}); var draft = s13[0]; var setDraft = s13[1];
  var s14 = useState(''); var nameQ = s14[0]; var setNameQ = s14[1];
  var s15 = useState(false); var showWarn = s15[0]; var setShowWarn = s15[1];

  function call(payload) {
    return fetch('/api/accounting/profitability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load(f, t) {
    setBusy(true);
    call({ action: 'report', date_from: (f === undefined ? from : f) || null, date_to: (t === undefined ? to : t) || null }).then(function (j) {
      if (!j || j.ok !== true) { toast.error((j && j.error) || 'The report did not load.'); return; }
      setData(j);
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { load('2026-06-01', ''); }, []);
  function act(payload, okMsg) {
    setBusy(true);
    return call(payload).then(function (j) {
      if (j && j.ok) { if (okMsg) { toast.success(okMsg); } load(); return true; }
      toast.error((j && j.error) || 'Not saved.'); setBusy(false); return false;
    });
  }
  function d(k, v) { var o = Object.assign({}, draft); o[k] = v; setDraft(o); }

  var canEdit = !!(data && data.can_edit);
  var box = { background: '#ffffff', color: INK, border: '1px solid ' + LINE };
  var th = { background: '#0f172a', color: '#ffffff' };
  var inp = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };
  function money(row, f) {
    if (row.unknown_fields && row.unknown_fields.indexOf(f) >= 0) { return <span style={{ color: '#b45309', fontWeight: 800 }}>{'unknown' + ((Number(row[f]) || 0) !== 0 ? ' (+$' + fmt(row[f]) + ' known)' : '')}</span>; }
    return '$' + fmt(row[f]);
  }
  function cellMoney(v) { return v === null || v === undefined ? <span style={{ color: '#b45309', fontWeight: 800 }}>unknown</span> : '$' + fmt(v); }
  function statusChip(row) {
    if (row.complete) { return <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#d1fae5', color: '#065f46' }}>COMPLETE</span>; }
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#fef3c7', color: '#78350f' }}>{row.estimate ? 'ESTIMATE / INCOMPLETE' : 'INCOMPLETE'}</span>;
  }
  function Btn(p) { return <button onClick={p.onClick} disabled={p.disabled || busy} title={p.title} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={Object.assign({ background: p.bg || '#f1f5f9', color: p.color || '#334155', opacity: (p.disabled || busy) ? 0.5 : 1 }, p.style || {})}>{p.children}</button>; }

  // ── drill-down: the cells behind a row ──
  function cellsTable(cells, invoiceRow) {
    return <div className="overflow-auto rounded" style={{ border: '1px solid #cbd5e1', maxHeight: 420 }}>
      <table className="w-full text-[10px]" style={{ minWidth: 1500 }}>
        <thead><tr>{['Invoice', 'Customer', 'Release', 'Original description', 'Original qty', 'Pounds', 'Goods revenue', '$ / lb', 'Transport charged', 'Goods cost', 'Cost from', 'Commission', 'Inbound', 'Outbound', 'Brokerage', 'Bonded', 'Profit', 'Needs attention'].map(function (h) { return <th key={h} className="px-1.5 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
        <tbody>{cells.map(function (c, i) {
          return <tr key={c.invoice_id + ':' + c.line_id + ':' + c.release + ':' + i} style={{ background: i % 2 ? '#f8fafc' : '#ffffff', color: INK, borderTop: '1px solid ' + LINE }}>
            <td className="px-1.5 py-1 font-bold">{c.invoice}<div style={{ color: SUB }}>{c.invoice_date}</div></td>
            <td className="px-1.5 py-1">{c.customer}</td>
            <td className="px-1.5 py-1">{c.release_raw || <span style={{ color: '#b45309' }}>none</span>}<div style={{ color: c.origin ? SUB : '#b45309' }}>{c.origin || 'origin unknown'}</div></td>
            <td className="px-1.5 py-1">{c.description}</td>
            <td className="px-1.5 py-1 text-right">{fmt(c.orig_qty) + ' ' + (c.orig_unit ? (UNIT_WORDS[c.orig_unit] || c.orig_unit) : '')}<div style={{ color: SUB }}>{'@ $' + Number(c.orig_unit_price || 0).toFixed(4) + (c.unit_factor && c.unit_factor !== 1 ? ' · ×' + c.unit_factor : '')}</div></td>
            <td className="px-1.5 py-1 text-right font-bold">{c.pounds === null ? <span style={{ color: '#b45309' }}>unit not set</span> : fmt0(c.pounds)}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.goods_revenue)}{!c.goods_price_confirmed && <div style={{ color: '#b45309' }}>not confirmed</div>}</td>
            <td className="px-1.5 py-1 text-right">{c.pounds > 0 && c.goods_revenue !== null && c.goods_price_confirmed ? fmt4(c.goods_revenue / c.pounds) : '—'}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.transport_revenue)}<div style={{ color: SUB }}>{c.transport_source || ''}</div></td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.base_cost)}<div style={{ color: SUB }}>{c.base_cost_per_lb !== null ? fmt4(c.base_cost_per_lb) + ' / lb' : ''}</div></td>
            <td className="px-1.5 py-1" title={(c.cost_sources || []).map(function (s) { return (s.vendor || '') + ' ' + (s.bill_number || '') + ' · ' + (s.bill_date || '') + ' · ' + s.description + ' · ' + fmt0(s.pounds) + ' lb · $' + (s.cost === null ? '?' : fmt(s.cost)); }).join('\n')}>
              {c.cost_method === 'release' ? 'bill on the same release' : c.cost_method === 'window' ? 'bills in the 90 days before' : c.cost_method === 'last_purchase' ? 'last purchase before' : c.cost_method === 'manual' ? 'typed by hand' : <span style={{ color: '#b45309' }}>none</span>}
              {(c.cost_sources || []).length > 0 && <div style={{ color: SUB }}>{(c.cost_sources || []).slice(0, 3).map(function (s) { return s.bill_number || '?'; }).join(', ') + ((c.cost_sources || []).length > 3 ? ' +' + ((c.cost_sources || []).length - 3) : '')}</div>}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.commission)}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.inbound_allowance)}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.outbound_cost)}<div style={{ color: c.outbound_kind === 'actual' ? SUB : '#b45309' }}>{c.outbound_kind === 'actual' ? (c.outbound_bills || []).map(function (b0) { return b0.bill_number; }).join(', ') : c.outbound_kind === 'estimate' ? 'ESTIMATE' : 'bill missing'}</div></td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.brokerage)}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.bonded)}</td>
            <td className="px-1.5 py-1 text-right font-extrabold" style={{ color: c.complete ? (c.profit >= 0 ? '#065f46' : '#7f1d1d') : '#78350f' }}>{'$' + fmt(c.profit)}<div className="font-bold">{c.complete ? 'complete' : 'known part only'}</div></td>
            <td className="px-1.5 py-1" style={{ color: '#92400e' }}>{(c.flags || []).filter(function (f, ix, arr) { return arr.indexOf(f) === ix; }).map(function (f) { return <div key={f}>{'• ' + (FLAG_WORDS[f] || f)}</div>; })}
              {invoiceRow && canEdit && <div className="mt-0.5"><select value={c.orig_unit || ''} onChange={function (e) { act({ action: 'set_line_unit', invoice_item_id: c.line_id, unit: e.target.value }, 'Unit of this one line saved.'); }} className="nt-light rounded text-[10px]" style={inp} title="Unit of THIS line only (overrides the unit of the description)">
                <option value="">line unit: as the description</option><option value="lb">this line: pounds</option><option value="yd">this line: yards</option><option value="lm">this line: linear metres</option></select></div>}</td>
          </tr>;
        })}</tbody>
      </table></div>;
  }

  // ── what a person sets for ONE invoice (report only) ──
  function invoicePanel(row) {
    var iv = row.invoice; if (!iv) { return null; }
    var bK = 'b:' + iv.id; var eK = 'e:' + iv.id;
    var basis = draft[bK] !== undefined ? draft[bK] : (iv.basis || '');
    var emb = draft[eK] !== undefined ? draft[eK] : (iv.embedded_transport === null || iv.embedded_transport === undefined ? '' : String(iv.embedded_transport));
    var mine = (data.cells || []).filter(function (c) { return c.invoice_id === iv.id; });
    return <div className="rounded-lg p-2 mb-2" style={{ background: '#eff6ff', border: '1px solid #93c5fd', color: '#1e3a8a' }}>
      <div className="text-[11px] font-extrabold mb-1">For the report only — the invoice the customer received is not changed. Every change is recorded with your name.</div>
      <div className="flex gap-2 items-center flex-wrap mb-1">
        <span className="text-[11px] font-bold">Pricing basis:</span>
        {['EXW', 'CNF', 'TRUCKING_INCLUDED'].map(function (b0) { var on = basis === b0;
          return <button key={b0} disabled={!canEdit || busy} onClick={function () { d(bK, b0); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={on ? { background: '#1d4ed8', color: '#ffffff' } : { background: '#ffffff', color: '#1e3a8a', border: '1px solid #93c5fd' }}>{(on ? '✓ ' : '') + BASIS_WORDS[b0]}</button>; })}
        {!iv.basis && iv.suggested_basis && <span className="text-[10px] font-bold" style={{ color: '#92400e' }}>{'The invoice wording suggests ' + BASIS_WORDS[iv.suggested_basis] + ' — confirm it by clicking.'}</span>}
        {!iv.basis && !iv.suggested_basis && <span className="text-[10px] font-bold" style={{ color: '#92400e' }}>Nothing on the invoice says which — it stays unresolved until you choose.</span>}
      </div>
      {(basis === 'CNF' || basis === 'TRUCKING_INCLUDED') && <div className="flex gap-2 items-center flex-wrap mb-1">
        <span className="text-[11px] font-bold">Transportation INSIDE the price $</span>
        <input value={emb} disabled={!canEdit} onChange={function (e) { d(eK, e.target.value); }} className="nt-light px-2 py-1 rounded text-[11px]" style={Object.assign({ width: 110 }, inp)} placeholder="e.g. 3000" />
        <span className="text-[10px]">It is taken OUT of the goods price and shown as transportation revenue. It is never added to the invoice total.</span>
      </div>}
      {basis === 'EXW' && <div className="text-[10px] mb-1">EXW: the goods price is goods only. Transportation revenue is whatever separate transportation line the invoice carries.</div>}
      {canEdit && <Btn bg="#1d4ed8" color="#ffffff" disabled={!basis} onClick={function () { act({ action: 'set_terms', invoice_id: iv.id, basis: basis, embedded_transport: emb }, 'Saved for the report.').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[bK]; delete o[eK]; setDraft(o); } }); }}>Save pricing basis</Btn>}
      {iv.releases.length > 1 && <div className="mt-2">
        <div className="text-[11px] font-extrabold">{'This invoice is on ' + iv.releases.length + ' releases (' + iv.releases.map(function (r) { return r.raw; }).join(', ') + '). Enter the POUNDS of each line on each release:'}</div>
        {mine.filter(function (c, ix, arr) { return arr.findIndex(function (x) { return x.line_id === c.line_id; }) === ix; }).map(function (c) {
          return <div key={c.line_id} className="flex gap-2 items-center flex-wrap text-[11px] py-0.5">
            <span className="font-bold" style={{ minWidth: 220 }}>{c.description}</span>
            {iv.releases.map(function (r) { var k = 'r:' + c.line_id + ':' + r.key;
              return <span key={r.key}>{r.raw + ' '}<input value={draft[k] !== undefined ? draft[k] : ''} disabled={!canEdit} onChange={function (e) { d(k, e.target.value); }} className="nt-light px-1.5 py-0.5 rounded text-[11px]" style={Object.assign({ width: 90 }, inp)} placeholder="pounds" /></span>; })}
            {canEdit && <Btn onClick={function () { var p = {}; iv.releases.forEach(function (r) { var v = Number(String(draft['r:' + c.line_id + ':' + r.key] || '').replace(/,/g, '')); if (v > 0) { p[r.key] = v; } }); act({ action: 'set_line_release_pounds', invoice_item_id: c.line_id, pounds: p }, 'Pounds per release saved.'); }}>save</Btn>}
          </div>; })}
      </div>}
      {iv.releases.map(function (r) { var k = 'x:' + r.key; var cur = mine.filter(function (c) { return c.release === r.key; })[0];
        if (!cur || cur.outbound_kind === 'actual') { return null; }
        return <div key={r.key} className="flex gap-2 items-center flex-wrap mt-1 text-[11px]">
          <span className="font-bold">{'Outbound bill for ' + r.raw + ' not in yet — estimate $'}</span>
          <input value={draft[k] !== undefined ? draft[k] : ''} disabled={!canEdit} onChange={function (e) { d(k, e.target.value); }} className="nt-light px-2 py-0.5 rounded text-[11px]" style={Object.assign({ width: 100 }, inp)} placeholder={cur.outbound_kind === 'estimate' ? 'change' : 'optional'} />
          {canEdit && <Btn onClick={function () { act({ action: 'set_estimate', release: r.raw, amount: draft[k] === undefined ? '' : draft[k] }, 'Estimate saved. It is replaced, not added to, when the bill arrives.'); }}>save estimate</Btn>}
          <span className="text-[10px]">Shown as ESTIMATE; the row is never called complete on an estimate.</span>
        </div>; })}
    </div>;
  }

  function viewTable(rows, firstCol, isInvoice) {
    return <div className="overflow-auto rounded" style={{ border: '1px solid ' + LINE, maxHeight: 620 }}>
      <table className="w-full text-[11px]" style={{ minWidth: 1500 }}>
        <thead><tr>{[firstCol, 'Pounds', 'Goods revenue', 'Avg $ / lb', 'Transport charged', 'Goods cost', 'Avg cost / lb', 'Commission', 'Inbound allowance', 'Outbound transport', 'Brokerage', 'Bonded', 'Total cost', 'Profit', 'Transport profit', ''].map(function (h, i) { return <th key={h + i} className={'px-2 py-1.5 font-bold sticky top-0 ' + (i === 0 ? 'text-left' : 'text-right')} style={th}>{h}</th>; })}</tr></thead>
        <tbody>{rows.map(function (r, i) {
          var isOpen = open === view + ':' + r.key;
          var out = [<tr key={r.key} onClick={function () { setOpen(isOpen ? null : view + ':' + r.key); }} style={{ background: isOpen ? '#e0f2fe' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE, cursor: 'pointer' }}>
            <td className="px-2 py-1.5 font-bold">{(isOpen ? '▾ ' : '▸ ') + r.label}{r.grouped && <span className="ml-1 px-1 rounded text-[9px] font-extrabold" style={{ background: '#e0e7ff', color: '#312e81' }}>{r.name_list.length + ' names'}</span>}
              {isInvoice && r.invoice && <div className="font-normal" style={{ color: SUB }}>{r.invoice.date + ' · ' + r.invoice.customer + ' · ' + (r.invoice.basis ? BASIS_WORDS[r.invoice.basis] : 'basis not set') + ' · ' + (r.invoice.releases.map(function (x) { return x.raw; }).join(', ') || 'no release')}</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt0(r.pounds)}{r.pounds_incomplete && <div style={{ color: '#b45309', fontWeight: 800 }}>some weights missing</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums font-bold">{money(r, 'goods_revenue')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{r.avg_goods_price_per_lb === null ? <span style={{ color: '#b45309' }}>—</span> : fmt4(r.avg_goods_price_per_lb)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'transport_revenue')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'base_cost')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt4(r.avg_base_cost_per_lb)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'commission')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'inbound_allowance')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'outbound_cost')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'brokerage')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(r, 'bonded')}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{'$' + fmt(r.total_cost)}{r.unknown_fields.length > 0 && <div style={{ color: '#b45309', fontWeight: 800 }}>not all known</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ color: r.complete ? (r.profit >= 0 ? '#065f46' : '#7f1d1d') : '#78350f' }}>{'$' + fmt(r.profit)}{!r.complete && <div className="font-bold">known part only</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{r.transport_profit === null ? <span style={{ color: '#b45309' }}>unknown</span> : '$' + fmt(r.transport_profit)}</td>
            <td className="px-2 py-1.5 text-right">{statusChip(r)}</td></tr>];
          if (isOpen) {
            var cs = (data.cells || []).filter(function (c) { return (view === 'product' ? c.product_key : view === 'customer' ? c.customer : c.invoice_id) === r.key; });
            out.push(<tr key={r.key + ':d'}><td colSpan={16} className="px-2 py-2" style={{ background: '#f1f5f9' }}>
              {isInvoice && invoicePanel(r)}
              {r.grouped && <div className="text-[11px] mb-1" style={{ color: INK }}><b>Original descriptions in this product:</b> {r.name_list.join(' · ')}</div>}
              <div className="text-[10px] mb-1" style={{ color: SUB }}>{'Releases: ' + (r.release_list.length ? r.release_list.join(', ') : 'none') + ' · ' + r.invoice_count + ' invoice(s) · ' + cs.length + ' line(s). Hover over “Cost from” to see the supplier bills behind a cost.'}</div>
              {cellsTable(cs, isInvoice)}</td></tr>);
          }
          return out;
        })}
        {rows.length === 0 && <tr><td colSpan={16} className="px-2 py-4 text-center" style={{ color: SUB, background: '#ffffff' }}>No invoices in this period.</td></tr>}</tbody>
      </table></div>;
  }

  // ── set-up: descriptions, units, groups, supplier bill links ──
  function setupView() {
    var names = (data.invoice_names || []).filter(function (n) { var q = nameQ.trim().toLowerCase(); return !q || (n.name + ' ' + (n.group || '')).toLowerCase().indexOf(q) >= 0; });
    var picked = Object.keys(pick).filter(function (k) { return pick[k]; });
    var pickedNames = (data.invoice_names || []).filter(function (n) { return pick[n.key]; }).map(function (n) { return n.name; });
    return <div>
      <div className="rounded-lg p-3 mb-3" style={box}>
        <div className="text-[13px] font-extrabold mb-1">1 · Weights (how many pounds in one unit)</div>
        <div className="text-[11px] mb-2" style={{ color: SUB }}>These are our reporting weights, not a physical conversion. Quantity × weight = pounds. Price ÷ weight = price per pound. Example: $0.30 per yard ÷ 2.5 = $0.12 per pound.</div>
        <div className="flex gap-3 items-center flex-wrap text-[12px]">
          {['yd', 'lm'].map(function (u) { var k = 'f:' + u;
            return <span key={u} className="flex items-center gap-1"><b>{'1 ' + (u === 'yd' ? 'yard' : 'linear metre') + ' ='}</b>
              <input value={draft[k] !== undefined ? draft[k] : String((data.factors || {})[u] || '')} disabled={!canEdit} onChange={function (e) { d(k, e.target.value); }} className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 70 }, inp)} /> lb
              {canEdit && draft[k] !== undefined && <Btn bg="#047857" color="#ffffff" onClick={function () { act({ action: 'set_factor', unit: u, pounds_per_unit: draft[k] }, 'Weight saved.').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[k]; setDraft(o); } }); }}>save</Btn>}</span>; })}
        </div>
      </div>

      <div className="rounded-lg p-3 mb-3" style={box}>
        <div className="text-[13px] font-extrabold mb-1">2 · What we call things when we SELL — set the unit, and put the same product under one name</div>
        <div className="text-[11px] mb-2" style={{ color: SUB }}>An invoice line has a quantity but no unit, so the Hub must be told once per description. Tick descriptions that are the same product and give them one name. This changes the report only; the invoices keep their own wording.</div>
        <div className="flex gap-2 items-center flex-wrap mb-2">
          <input value={nameQ} onChange={function (e) { setNameQ(e.target.value); }} placeholder="find a description…" className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 220 }, inp)} />
          <span className="text-[11px] font-bold" style={{ color: SUB }}>{picked.length + ' ticked'}</span>
          {canEdit && <span className="flex items-center gap-1 text-[11px]"><b>Set ticked to:</b>{['lb', 'yd', 'lm'].map(function (u) { return <Btn key={u} disabled={!picked.length} onClick={function () { act({ action: 'set_name_unit', names: pickedNames, unit: u }, picked.length + ' description(s) set to ' + UNIT_WORDS[u] + '.'); }}>{UNIT_WORDS[u]}</Btn>; })}</span>}
          {canEdit && <span className="flex items-center gap-1 text-[11px]"><b>Group ticked as:</b>
            <input value={groupName} onChange={function (e) { setGroupName(e.target.value); }} placeholder="the name YOU want on the report" className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 230 }, inp)} />
            <Btn bg="#047857" color="#ffffff" disabled={!picked.length || groupName.trim().length < 2} onClick={function () { act({ action: 'group_save', display_name: groupName, invoice_names: pickedNames }, 'Group “' + groupName.trim() + '” saved.').then(function (ok) { if (ok) { setPick({}); setGroupName(''); } }); }}>Save group</Btn></span>}
          {canEdit && (data.groups || []).length > 0 && <span className="flex items-center gap-1 text-[11px]"><b>or add ticked to:</b>
            <select value={addTo} onChange={function (e) { setAddTo(e.target.value); }} className="nt-light px-2 py-1 rounded text-[12px]" style={inp}><option value="">an existing group…</option>{(data.groups || []).map(function (g) { return <option key={g.id} value={g.id}>{g.name}</option>; })}</select>
            <Btn disabled={!picked.length || !addTo} onClick={function () { act({ action: 'group_save', id: addTo, invoice_names: pickedNames }, 'Added to the group.').then(function (ok) { if (ok) { setPick({}); setAddTo(''); } }); }}>Add</Btn></span>}
        </div>
        <div className="overflow-auto rounded" style={{ border: '1px solid ' + LINE, maxHeight: 380 }}>
          <table className="w-full text-[11px]">
            <thead><tr>{['', 'Description on the invoices', 'Lines', 'Quantity', 'Invoiced', 'Sold in', 'Reported as'].map(function (h, i) { return <th key={h + i} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
            <tbody>{names.map(function (n, i) {
              return <tr key={n.key} style={{ background: pick[n.key] ? '#ecfdf5' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE }}>
                <td className="px-2 py-1"><input type="checkbox" checked={!!pick[n.key]} onChange={function () { var o = Object.assign({}, pick); o[n.key] = !o[n.key]; setPick(o); }} style={{ width: 15, height: 15 }} /></td>
                <td className="px-2 py-1 font-bold">{n.name}</td><td className="px-2 py-1">{n.lines}</td><td className="px-2 py-1 tabular-nums">{fmt(n.qty)}</td><td className="px-2 py-1 tabular-nums">{'$' + fmt(n.invoiced)}</td>
                <td className="px-2 py-1"><select value={n.unit || ''} disabled={!canEdit || busy} onChange={function (e) { if (e.target.value) { act({ action: 'set_name_unit', names: [n.name], unit: e.target.value }, 'Unit saved for “' + n.name + '”.'); } }} className="nt-light px-1.5 py-0.5 rounded text-[11px]" style={Object.assign({}, inp, n.unit ? {} : { border: '2px solid #f59e0b' })}>
                  <option value="">⚠ not set</option><option value="lb">pounds</option><option value="yd">yards</option><option value="lm">linear metres</option></select></td>
                <td className="px-2 py-1">{n.group ? <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#e0e7ff', color: '#312e81' }}>{n.group}</span> : <span style={{ color: SUB }}>its own name</span>}</td></tr>;
            })}</tbody>
          </table></div>
      </div>

      <div className="rounded-lg p-3" style={box}>
        <div className="text-[13px] font-extrabold mb-1">3 · Product groups — the name shown, and the SUPPLIER BILL descriptions that are its cost</div>
        <div className="text-[11px] mb-2" style={{ color: SUB }}>Linking a supplier description says “this is what we pay for that product”. The cost of a sale is then taken from those bill lines only: first a bill on the same release, otherwise bills dated in the 90 days before the invoice, otherwise the last purchase before it. A sale is charged the cost per pound × its own pounds, never a whole bill. Names that merely look alike are never assumed to be the same product.</div>
        {(data.groups || []).length === 0 && <div className="text-[11px]" style={{ color: SUB }}>No groups yet. Tick descriptions in section 2 and save a group.</div>}
        {(data.groups || []).map(function (g) {
          var nk = 'g:' + g.id; var isLink = linkFor === g.id;
          var bq = billQ.trim().toLowerCase();
          var linked = {}; g.bill_names.forEach(function (x) { linked[x.key] = true; });
          var cand = (data.bill_names || []).filter(function (b0) { return !linked[b0.key] && (!bq || (b0.name + ' ' + b0.vendors.join(' ')).toLowerCase().indexOf(bq) >= 0); }).slice(0, 200);
          return <div key={g.id} className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: INK }}>
            <div className="flex gap-2 items-center flex-wrap mb-1">
              <input value={draft[nk] !== undefined ? draft[nk] : g.name} disabled={!canEdit} onChange={function (e) { d(nk, e.target.value); }} className="nt-light px-2 py-1 rounded text-[12px] font-extrabold" style={Object.assign({ width: 280 }, inp)} />
              {canEdit && draft[nk] !== undefined && draft[nk].trim() !== g.name && <Btn bg="#047857" color="#ffffff" onClick={function () { act({ action: 'group_save', id: g.id, display_name: draft[nk] }, 'Name changed on the report.').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[nk]; setDraft(o); } }); }}>save name</Btn>}
              <div className="flex-1" />
              {canEdit && <Btn onClick={function () { setLinkFor(isLink ? null : g.id); setBillPick({}); setBillQ(''); }}>{isLink ? 'close' : '🔗 Link supplier bill descriptions'}</Btn>}
              {canEdit && (draft['dz:' + g.id] ? <span className="flex items-center gap-1 text-[11px]"><b style={{ color: '#7f1d1d' }}>Un-group these names?</b><Btn bg="#b91c1c" color="#ffffff" onClick={function () { act({ action: 'group_dissolve', id: g.id }, 'Group removed. The descriptions report under their own names again; nothing else changed.'); }}>yes</Btn><Btn onClick={function () { d('dz:' + g.id, false); }}>no</Btn></span>
                : <Btn onClick={function () { d('dz:' + g.id, true); }} title="The descriptions go back to their own names. Invoices and bills are untouched.">un-group</Btn>)}
            </div>
            <div className="text-[11px] mb-1"><b>Sold as:</b> {g.invoice_names.length === 0 ? <span style={{ color: '#b45309' }}>no sales descriptions</span> : g.invoice_names.map(function (x) { return <span key={x.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded mr-1 mb-1" style={{ background: '#e0e7ff', color: '#312e81' }}>{x.name}{canEdit && <button onClick={function () { act({ action: 'group_remove_name', group_id: g.id, source: 'invoice', name_key: x.key }, 'Taken out of the group.'); }} title="Take this description out of the group" style={{ fontWeight: 900 }}>✕</button>}</span>; })}</div>
            <div className="text-[11px]"><b>Cost comes from supplier bill lines called:</b> {g.bill_names.length === 0 ? <span className="font-extrabold" style={{ color: '#b45309' }}>nothing linked — the goods cost of this product shows as MISSING</span> : g.bill_names.map(function (x) { return <span key={x.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded mr-1 mb-1" style={{ background: '#d1fae5', color: '#065f46' }}>{x.name}{canEdit && <button onClick={function () { act({ action: 'group_remove_name', group_id: g.id, source: 'bill', name_key: x.key }, 'Unlinked.'); }} title="Unlink this supplier description" style={{ fontWeight: 900 }}>✕</button>}</span>; })}</div>
            {isLink && <div className="mt-2 rounded p-2" style={{ background: '#ffffff', border: '1px solid #94a3b8' }}>
              <div className="flex gap-2 items-center flex-wrap mb-1">
                <input value={billQ} onChange={function (e) { setBillQ(e.target.value); }} placeholder="find a supplier description or vendor…" className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 260 }, inp)} />
                <Btn bg="#047857" color="#ffffff" disabled={!Object.keys(billPick).some(function (k) { return billPick[k]; })} onClick={function () { var ns = (data.bill_names || []).filter(function (b0) { return billPick[b0.key]; }).map(function (b0) { return b0.name; }); act({ action: 'group_save', id: g.id, bill_names: ns }, ns.length + ' supplier description(s) linked.').then(function (ok) { if (ok) { setBillPick({}); setLinkFor(null); } }); }}>Link ticked</Btn>
                <span className="text-[10px]" style={{ color: SUB }}>{(data.bill_names || []).length + ' different descriptions on supplier bills'}</span>
              </div>
              {(data.bill_names || []).length === 0 && <div className="text-[11px] font-bold" style={{ color: '#b45309' }}>No supplier bill has its product lines stored yet, so there is nothing to link. Open a supplier bill on the Bills screen and enter or read its lines first.</div>}
              <div className="overflow-auto" style={{ maxHeight: 260 }}><table className="w-full text-[11px]"><tbody>{cand.map(function (b0, i) {
                return <tr key={b0.key} style={{ background: billPick[b0.key] ? '#ecfdf5' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE }}>
                  <td className="px-2 py-1"><input type="checkbox" checked={!!billPick[b0.key]} onChange={function () { var o = Object.assign({}, billPick); o[b0.key] = !o[b0.key]; setBillPick(o); }} style={{ width: 15, height: 15 }} /></td>
                  <td className="px-2 py-1 font-bold">{b0.name}</td><td className="px-2 py-1">{b0.vendors.join(', ')}</td><td className="px-2 py-1">{b0.lines + ' line(s)'}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(b0.qty) + ' ' + b0.units.map(function (u) { return u === '?' ? '⚠ no unit' : (UNIT_WORDS[u] || u); }).join(' / ')}</td><td className="px-2 py-1 tabular-nums">{'$' + fmt(b0.cost)}</td><td className="px-2 py-1">{'last ' + (b0.last_date || '—')}</td></tr>; })}</tbody></table></div>
            </div>}
          </div>;
        })}
      </div>
    </div>;
  }

  var tt = data && data.totals;
  var warnCount = {}; ((data && data.flags) || []).forEach(function (f) { warnCount[f.kind] = (warnCount[f.kind] || 0) + 1; });
  var cellWarn = {}; ((data && data.cells) || []).forEach(function (c) { (c.flags || []).forEach(function (f) { cellWarn[f] = (cellWarn[f] || 0) + 1; }); });
  var allWarnKinds = Object.keys(Object.assign({}, cellWarn, warnCount));
  var incomplete = tt ? ((data.cells || []).filter(function (c) { return !c.complete; }).length) : 0;

  return <div className="rounded-xl p-3" style={{ background: '#ffffff', color: INK, border: '1px solid ' + LINE }}>
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold" style={{ color: INK }}>📊 Profitability — by product, customer and invoice</div>
      <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="nt-light px-2 py-1 rounded text-xs" style={inp} />
      <span style={{ color: SUB }}>→</span>
      <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="nt-light px-2 py-1 rounded text-xs" style={inp} />
      <Btn bg="#047857" color="#ffffff" onClick={function () { load(from, to); }}>Apply</Btn>
      {busy && <span className="text-[11px]" style={{ color: SUB }}>Working…</span>}
    </div>
    <div className="rounded-lg px-3 py-2 mb-3 text-[11px]" style={{ background: '#eef2ff', color: '#312e81', border: '1px solid #c7d2fe' }}>
      <b>This is NOT the cash report.</b> It answers “did this product, customer or invoice make money?”. It is dated by invoice date and includes unpaid invoices, unpaid bills, a standard inbound allowance of $0.02 per pound (not a real payment) and any estimate, labelled. For money actually received and paid — the tax view — use <b>Accounting → Stats → Income Statement (cash basis)</b>. The two will not match. RTM and NextTrade service fees are left out of this report on purpose; they are in the cash report.
    </div>

    {data && data.setup_needed && <div className="rounded-lg p-3 text-[12px]" style={{ background: '#fffbeb', color: '#78350f', border: '1px solid #f59e0b' }}>
      <div className="font-extrabold mb-1">One-time setup before this report can run</div>
      <div>1. Open supabase.com in your browser and sign in. Click the Hub’s project.</div>
      <div>2. In the left menu click “SQL Editor”, then “New query”.</div>
      <div>3. On this computer open the file <b>sql/v55-83-SY-profitability.sql</b> (inside the nexttrade-hub folder) with Notepad. Select all, copy, paste it into the query box.</div>
      <div>4. Click “Run”. It should list eight table names starting with pl_.</div>
      <div>5. Come back here and click Apply.</div>
      <div className="mt-1">It only adds the tables that hold your report choices. It changes no invoice, bill or accounting entry.</div>
    </div>}

    {tt && <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-2">
        {[['Goods revenue', money(tt, 'goods_revenue'), '#dcfce7', '#052e16'], ['Transport charged', money(tt, 'transport_revenue'), '#e0f2fe', '#0c2a5e'], ['Goods cost', money(tt, 'base_cost'), '#fee2e2', '#7f1d1d'], ['Commission', money(tt, 'commission'), '#fee2e2', '#7f1d1d'], ['Inbound allowance', money(tt, 'inbound_allowance'), '#ffedd5', '#431407'], ['Outbound transport', money(tt, 'outbound_cost'), '#fee2e2', '#7f1d1d'], [tt.complete ? 'Profit' : 'Profit (known part only)', '$' + fmt(tt.profit), tt.complete ? '#d1fae5' : '#fef3c7', tt.complete ? '#065f46' : '#78350f']].map(function (k) {
          return <div key={k[0]} className="rounded-lg p-2" style={{ background: k[2], color: k[3] }}><div className="text-[10px] font-bold">{k[0]}</div><div className="text-[15px] font-black">{k[1]}</div></div>; })}
      </div>
      <div className="flex gap-2 items-center flex-wrap mb-2 text-[11px]">
        <span style={{ color: SUB }}>{fmt0(tt.pounds) + ' lb · ' + data.counts.invoices_in_period + ' invoice(s) · brokerage $' + fmt(tt.brokerage) + ' · bonded $' + fmt(tt.bonded)}</span>
        <span className="px-1.5 py-0.5 rounded font-extrabold" style={data.reconciled.product && data.reconciled.customer && data.reconciled.invoice ? { background: '#d1fae5', color: '#065f46' } : { background: '#fee2e2', color: '#7f1d1d' }}>{data.reconciled.product && data.reconciled.customer && data.reconciled.invoice ? '✓ the three views add up to the same totals' : '⛔ the views do NOT add up — tell the developer'}</span>
        {data.counts.invoices_brought_in_for_shared_releases > 0 && <span style={{ color: SUB }}>{data.counts.invoices_brought_in_for_shared_releases + ' invoice(s) outside these dates share a release and were used for the cost split only'}</span>}
      </div>
      {(allWarnKinds.length > 0 || (data.unallocated || []).length > 0 || data.bills_note) && <div className="rounded-lg p-2 mb-3" style={{ background: '#fffbeb', color: '#78350f', border: '1px solid #f59e0b' }}>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="text-[12px] font-extrabold">{'⚠ ' + incomplete + ' of ' + (data.cells || []).length + ' line(s) are incomplete. A margin is not called complete while something it needs is missing.'}</div>
          <div className="flex-1" /><Btn onClick={function () { setShowWarn(!showWarn); }}>{showWarn ? 'hide' : 'show what is missing'}</Btn>
        </div>
        {data.bills_note && <div className="text-[11px] font-bold mt-1">{data.bills_note}</div>}
        {showWarn && <div className="mt-1 text-[11px]">
          {allWarnKinds.map(function (k) { return <div key={k}>{'• ' + (FLAG_WORDS[k] || k) + ' — ' + ((cellWarn[k] || 0) ? cellWarn[k] + ' line(s)' : warnCount[k] + ' time(s)')}</div>; })}
          {(data.unallocated || []).length > 0 && <div className="mt-1 font-extrabold">Amounts NOT yet placed on any product (they are not lost, and not in the profit above):</div>}
          {(data.unallocated || []).map(function (u, i) { return <div key={i}>{'• $' + fmt(u.amount) + ' — ' + String(u.what).replace(/_/g, ' ') + (u.invoice ? ' · invoice ' + u.invoice : '') + (u.bill ? ' · bill ' + u.bill : '') + (u.vendor ? ' (' + u.vendor + ')' : '') + (u.release ? ' · release ' + u.release : '') + ' — ' + u.why}</div>; })}
          {(data.flags || []).filter(function (f) { return f.kind === 'two_trucking_bills_on_one_release' || f.kind === 'transport_bill_not_marked_outbound' || f.kind === 'brokerage_bill_on_non_houston_release' || f.kind === 'bill_split_unresolved'; }).slice(0, 40).map(function (f, i) { return <div key={'f' + i}>{'• ' + (FLAG_WORDS[f.kind] || f.kind) + ': ' + (f.bill ? 'bill ' + f.bill + ' ' : '') + (f.vendor ? '(' + f.vendor + ') ' : '') + (f.release ? 'release ' + f.release + ' ' : '') + (f.releases ? 'release ' + f.releases.join(', ') + ' ' : '') + (f.bills ? '— bills ' + f.bills.join(', ') : '') + (f.why ? '— ' + f.why : '')}</div>; })}
        </div>}
      </div>}
      <div className="flex gap-1.5 flex-wrap mb-2">
        {[['product', 'By product'], ['customer', 'By customer'], ['invoice', 'By invoice'], ['setup', '⚙ Names, units and supplier links']].map(function (v) {
          return <button key={v[0]} onClick={function () { setView(v[0]); setOpen(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={view === v[0] ? { background: '#0f172a', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{v[1]}</button>; })}
        <span className="text-[11px] self-center" style={{ color: SUB }}>Click a row to see the invoices, releases, bills and calculations behind it.</span>
      </div>
      {view === 'product' && viewTable(data.by_product || [], 'Product', false)}
      {view === 'customer' && viewTable(data.by_customer || [], 'Customer', false)}
      {view === 'invoice' && viewTable(data.by_invoice || [], 'Invoice', true)}
      {view === 'setup' && setupView()}
      <div className="text-[10px] mt-2" style={{ color: SUB }}>
        Profit = goods revenue + transportation charged − goods cost − commission − inbound allowance − outbound transportation − brokerage − bonded. Averages are total ÷ total pounds. Costs that belong to a release are split across all the goods on that release by pounds, before any grouping or filter. Brokerage and bonded charges go to Houston releases only (release numbers starting 1002-); Canada (1001-) gets none.
      </div>
    </div>}
    {!data && busy && <div className="text-[12px] p-2" style={{ color: SUB }}>Building the report…</div>}
  </div>;
}
