// v55.83-XB — Accounting → Bills → "🏭 Warehouse check": the exception report, Report History and the mappings / tolerance.
// Max, 21 Nov 2026: filters (vendor, reference, warehouse, bill dates, status, reviewer, unresolved), summary counts, drill-down
// to the bill and the warehouse evidence, export of the filtered rows; "staff must be able to open the bill in question straight
// from the report (and its PDF) to look at it before deciding, then return to the same place in the report" — the bill opens in
// a pop-up ON TOP of the report, so closing it leaves the filters, rows and scroll position exactly where they were.
// Every saved report keeps a number and is never overwritten; reopening one shows it as it stood, what was decided since, and
// where each item stands now — kept apart. A report with open items never looks approved.
import React, { useState, useEffect } from 'react';
import BillPeek from './BillPeek';
import WeightCheckInvoices from './WeightCheckInvoices'; // v55.83-YX — one card per invoice: PASS / REVIEW + Approved / Disputed
import { wcApi, say, ItemCard, DecisionDialog, FeedLine, Chip, num, when, OUTCOME_STYLE, STATE_STYLE, DECISION_LABEL } from './WarehouseCheckBox';
import { toCsv, OUTCOME_WORDS, STATE_WORDS } from '../lib/weight-check';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function monthRange() { var d = new Date(); var y = d.getFullYear(); var m = d.getMonth(); var a = new Date(Date.UTC(y, m - 1, 1)); var b = new Date(Date.UTC(y, m, 0)); return [a.toISOString().substring(0, 10), b.toISOString().substring(0, 10)]; }
function download(name, text) { var blob = new Blob([text], { type: 'text/csv;charset=utf-8' }); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function csvRows(rows, reportNo) {
  return rows.map(function (r) {
    var f = r.figures || {}; var d = r.decision;
    return { report: reportNo || '', bill_number: (r.bills || []).map(function (b) { return b.bill_number; }).join(' + '), vendor: (r.bills || []).map(function (b) { return b.vendor; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' + '),
      bill_date: (r.bills || []).map(function (b) { return b.bill_date; }).join(' + '), reference: (r.references || []).join(' + '), receipts: (r.receipts || []).map(function (x) { return x.reference_number || x.id; }).join(' + '),
      warehouse: (r.receipts || []).map(function (x) { return x.warehouse || ''; }).filter(Boolean).join(' + '), product: r.product_label || '', billed: f.billed, received: f.received, unit: f.unit || '', diff: f.diff, diff_pct: f.pct,
      conversion: f.conversion || '', outcome: r.outcome_words || OUTCOME_WORDS[r.outcome] || r.outcome, state: r.state_words || STATE_WORDS[r.state] || '', reviewer: d ? d.actor_name : '', decided_at: d ? d.at : '', reason: d ? d.reason : (r.reasons || []).join(' · '), source: '' };
  });
}

export default function WeightCheckPanel(props) {
  var _t = useState('invoices'); var tab = _t[0], setTab = _t[1];
  var mr = monthRange();
  var _f = useState({ date_from: mr[0], date_to: mr[1], vendor: '', reference: '', warehouse: '', status: '', reviewer: '', unresolved: false, all: false }); var flt = _f[0], setFlt = _f[1];
  var _d = useState(null); var data = _d[0], setData = _d[1];
  var _b = useState(''); var busy = _b[0], setBusy = _b[1];
  var _p = useState(null); var peek = _p[0], setPeek = _p[1];
  var _a = useState(null); var ask = _a[0], setAsk = _a[1];
  var _o = useState(null); var openKey = _o[0], setOpenKey = _o[1];
  var _pp = useState([]); var people = _pp[0], setPeople = _pp[1];
  useEffect(function () { wcApi({ action: 'people' }).then(function (j) { if (j && j.ok) { setPeople(j.people); } }); }, []);
  function set(k, v) { setFlt(Object.assign({}, flt, (function () { var o = {}; o[k] = v; return o; })())); }
  function run(action) {
    setBusy(action);
    wcApi(Object.assign({ action: action }, flt, { recheck: true })).then(function (j) { setBusy(''); setData(j); if (j && j.report) { say(props.toast, 'Report ' + j.report.report_no + ' saved — ' + j.report.status, 'success'); } });
  }
  var rows = (data && data.rows) || []; var perms = (data && data.permissions) || {};
  var inp = 'px-2 py-1 rounded-lg border border-slate-300 text-[12px] text-slate-900 bg-white nt-light';
  var billsById = {}; (props.bills || []).forEach(function (b) { billsById[b.id] = b; });
  function openBill(b) { var full = billsById[b.id] || {}; setPeek({ bill_number: b.bill_number, vendor: b.vendor, bill_date: b.bill_date, release: full.release_number || null, bill_total_cents: full.total_amount != null ? Math.round(Number(full.total_amount) * 100) : null, cents: full.paid != null ? Math.round(Number(full.paid) * 100) : null, attachment_path: b.attachment_path || full.attachment_path || null, reference: b.reference }); }
  return <div className="nt-paper rounded-xl border-2 border-slate-300 p-3 mb-3" style={{ background: '#ffffff', color: INK }}>
    <div className="flex flex-wrap gap-2 items-center mb-2">
      <b className="text-[14px]">🏭 Warehouse check — billed vs scanned in</b>
      {['invoices', 'report', 'history', 'settings'].map(function (k) { var lbl = k === 'invoices' ? 'Invoices' : k === 'report' ? 'Exceptions' : k === 'history' ? 'Report history' : 'Mappings & tolerance'; return <button key={k} onClick={function () { setTab(k); }} className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={tab === k ? { background: '#0f172a', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{lbl}</button>; })}
      <span style={{ flex: 1 }} />
      <button onClick={props.onClose} className="px-2 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Close</button>
    </div>
    <div className="text-[11px] mb-2" style={{ color: SUB }}>Read-only towards bills, payments, wires, inventory and the warehouse. Decisions are recorded with who, when, why and the figures as they stood.</div>

    {/* the bill pop-up: on top of the report, so closing it returns to exactly the same place */}
    {peek && <div onClick={function () { setPeek(null); }} style={{ position: 'fixed', inset: 0, zIndex: 330, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}><div onClick={function (e) { e.stopPropagation(); }}>
      <BillPeek row={peek} paidLabel="Paid so far" extraLines={[['Reference', peek.reference || '—']]} note="Opened from the warehouse check — read-only. Close to return to the report where you were."
        onOpenDoc={props.openDoc} onClose={function () { setPeek(null); }} /></div></div>}
    {ask && <DecisionDialog item={ask.item} kind={ask.kind} billId={ask.billId} onClose={function () { setAsk(null); }} onDone={function (j) {
      setAsk(null);
      var fresh = {}; (j.items || []).forEach(function (x) { fresh[x.item_key] = x; });
      setData(Object.assign({}, data, { rows: rows.map(function (r) { return fresh[r.item_key] || r; }) }));
      say(props.toast, 'Decision saved.', 'success');
    }} />}

    {tab === 'invoices' && <WeightCheckInvoices toast={props.toast} />}
    {tab === 'report' && <div>
      <div className="flex flex-wrap gap-2 items-end text-[11px] font-bold" style={{ color: SUB }}>
        <label>Bill date from<br /><input type="date" value={flt.date_from} onChange={function (e) { set('date_from', e.target.value); }} className={inp} /></label>
        <label>to<br /><input type="date" value={flt.date_to} onChange={function (e) { set('date_to', e.target.value); }} className={inp} /></label>
        <label>Vendor<br /><input value={flt.vendor} onChange={function (e) { set('vendor', e.target.value); }} className={inp + ' w-32'} /></label>
        <label>Reference<br /><input value={flt.reference} onChange={function (e) { set('reference', e.target.value); }} className={inp + ' w-28'} /></label>
        <label>Warehouse<br /><input value={flt.warehouse} onChange={function (e) { set('warehouse', e.target.value); }} className={inp + ' w-24'} /></label>
        <label>Status<br /><select value={flt.status} onChange={function (e) { set('status', e.target.value); }} className={inp}><option value="">any</option>
          {Object.keys(OUTCOME_WORDS).map(function (k) { return <option key={k} value={k}>{OUTCOME_WORDS[k]}</option>; })}
          {Object.keys(STATE_WORDS).map(function (k) { return <option key={'s' + k} value={k}>{'Decision: ' + STATE_WORDS[k]}</option>; })}</select></label>
        <label>Reviewer / assigned<br /><select value={flt.reviewer} onChange={function (e) { set('reviewer', e.target.value); }} className={inp}><option value="">anyone</option>{people.map(function (p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}</select></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={flt.unresolved} onChange={function (e) { set('unresolved', e.target.checked); }} />Unresolved issues only</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={flt.all} onChange={function (e) { set('all', e.target.checked); }} />Also show decided items</label>
        <button disabled={!!busy} onClick={function () { run('report_preview'); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.6 : 1 }}>{busy === 'report_preview' ? 'Checking…' : 'Show'}</button>
        {(!data || perms.validate) && <button disabled={!!busy} title="Reads the warehouse again for these bills, then saves a numbered report as it stands now (it is never overwritten)" onClick={function () { run('run_report'); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff', opacity: busy ? 0.6 : 1 }}>{busy === 'run_report' ? 'Reading the warehouse and saving…' : 'Recheck + save as a numbered report'}</button>}
        {rows.length > 0 && <button onClick={function () { download('warehouse-check-' + flt.date_from + '-to-' + flt.date_to + '.csv', toCsv(csvRows(rows, data && data.report ? data.report.report_no : ''))); }} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>Export these rows (CSV)</button>}
      </div>
      {data && !data.ok && <div className="mt-2 rounded-lg px-2 py-1 text-[12px] font-extrabold" style={{ background: data.sql_missing ? '#fef9c3' : '#fef2f2', color: data.sql_missing ? '#854d0e' : '#991b1b' }}>{data.error}</div>}
      {data && data.ok && <div className="mt-2">
        <FeedLine feed={data.feed} />
        {data.freshness && data.freshness.kind !== 'refreshed' ? <div className="text-[12px] font-extrabold mt-1 rounded px-2 py-1" style={data.freshness.qualified ? { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' } : { background: '#f1f5f9', color: '#334155' }}>{data.freshness.words + (data.freshness.qualified ? ' — this report is not complete until a refresh succeeds; decisions already made are kept and are not asked again if nothing changed.' : '')}</div> : null}
        {data.recheck && data.recheck.ok === false ? <div className="text-[12px] font-bold" style={{ color: '#991b1b' }}>{'The warehouse could not be read now: ' + data.recheck.error + ' — the rows below use the last good read; items never read show “Warehouse unavailable / not checked”.'}</div> : null}
        {data.report ? <div className="text-[12px] font-extrabold mt-1" style={{ color: /^Complete/.test(data.report.status) ? '#14532d' : '#b91c1c' }}>{'Saved as report ' + data.report.report_no + ' — ' + data.report.status}</div> : null}
        {data.window_floor ? <div className="text-[11px]" style={{ color: '#854d0e' }}>{'Your access starts at ' + data.window_floor + ' — earlier bills are not included.'}</div> : null}
        <div className="flex flex-wrap gap-1 mt-1 text-[11px]">
          <span className="font-bold">{(data.bills_checked != null ? data.bills_checked + ' bills checked · ' : '') + data.summary.items + ' items · ' + data.summary.outstanding + ' outstanding'}</span>
          {Object.keys(data.summary.by_outcome).map(function (k) { return <Chip key={k} outcome={k}>{(OUTCOME_WORDS[k] || k) + ': ' + data.summary.by_outcome[k]}</Chip>; })}
        </div>
        {!data.tolerance ? <div className="text-[11px] mt-1" style={{ color: '#854d0e' }}>No tolerance approved yet — “Matched” is not used; exact agreement shows “Equal”.</div> : <div className="text-[11px] mt-1" style={{ color: SUB }}>{'Tolerance (approved, version ' + data.tolerance.version + '): ' + (data.tolerance.pct != null ? data.tolerance.pct + '%' : '') + (data.tolerance.pct != null && data.tolerance.lb != null ? ' or ' : '') + (data.tolerance.lb != null ? data.tolerance.lb + ' lb' : '') + ', whichever is larger — only for a bill BELOW what was scanned; a bill above what was scanned is never within tolerance'}</div>}
        {!rows.length ? <div className="mt-2 text-[12px]" style={{ color: SUB }}>{flt.all ? 'No items in this range.' : 'Nothing outstanding in this range (tick “Also show decided items” to see everything).'}</div> : null}
        <table className="w-full text-[12px] mt-2" style={{ borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f1f5f9', color: SUB }} className="text-left text-[11px]"><th className="px-1">Bill(s)</th><th className="px-1">Reference / receipt</th><th className="px-1">Product</th><th className="px-1 text-right">Billed</th><th className="px-1 text-right">Scanned in</th><th className="px-1 text-right">Difference</th><th className="px-1">Result</th><th className="px-1">Decision</th></tr></thead>
          <tbody>{rows.map(function (r) {
            var f = r.figures || {}; var openRow = openKey === r.item_key;
            return <React.Fragment key={r.item_key}>
              <tr style={{ borderTop: '1px solid ' + LINE, background: openRow ? '#f8fafc' : '#ffffff' }}>
                <td className="px-1 py-1">{(r.bills || []).map(function (b) { return <div key={b.id}><button onClick={function () { openBill(b); }} title="Open this bill (and its PDF) on top of the report" className="underline font-bold" style={{ color: '#1d4ed8' }}>{(b.vendor || '') + ' ' + (b.bill_number || '')}</button><span style={{ color: SUB }}>{' ' + (b.bill_date || '')}</span></div>; })}{!(r.bills || []).length ? <span style={{ color: SUB }}>(outside your access)</span> : null}</td>
                <td className="px-1">{(r.references || []).join(', ') || '—'}<div style={{ color: SUB }}>{(r.receipts || []).map(function (x) { return (x.reference_number || x.id) + (x.warehouse ? ' · ' + x.warehouse : '') + (x.is_draft ? ' · DRAFT' : ''); }).join(', ')}</div></td>
                <td className="px-1">{r.product_label || '—'}</td>
                <td className="px-1 text-right">{f.basis ? num(f.billed) + ' ' + f.unit : '—'}</td>
                <td className="px-1 text-right">{f.basis ? num(f.received) + ' ' + f.unit : '—'}</td>
                <td className="px-1 text-right font-bold" style={{ color: f.diff ? '#991b1b' : INK }}>{f.diff != null ? (f.diff > 0 ? '+' : '') + num(f.diff) + (f.pct != null ? ' (' + num(f.pct, 2) + '%)' : '') : '—'}</td>
                <td className="px-1"><Chip outcome={r.outcome}>{r.outcome_words}</Chip></td>
                <td className="px-1"><span style={{ color: STATE_STYLE[r.state] || SUB, fontWeight: 800 }}>{r.needs_attention ? r.state_words : '—'}</span>{r.stale ? <div className="text-[11px] font-bold" style={{ color: '#991b1b' }}>{'Not refreshed now — last verified ' + (r.last_verified_at ? when(r.last_verified_at) : 'never (not read whole)')}</div> : null} <button onClick={function () { setOpenKey(openRow ? null : r.item_key); }} className="ml-1 underline text-[11px] font-bold" style={{ color: '#1d4ed8' }}>{openRow ? 'close' : 'details / decide'}</button></td>
              </tr>
              {openRow && <tr><td colSpan={8} className="p-1"><ItemCard item={r} perms={perms} onDecide={function (item, k) { setAsk({ item: item, kind: k, billId: (item.bill_ids || [])[0] }); }} /></td></tr>}
            </React.Fragment>;
          })}</tbody>
        </table>
      </div>}
    </div>}

    {tab === 'history' && <ReportHistory toast={props.toast} openBill={openBill} />}
    {tab === 'settings' && <WcSettings toast={props.toast} />}
  </div>;
}

function ReportHistory(props) {
  var _l = useState(null); var list = _l[0], setList = _l[1];
  var _r = useState(null); var rep = _r[0], setRep = _r[1];
  useEffect(function () { wcApi({ action: 'reports' }).then(setList); }, []);
  function open(id) { setRep({ loading: true }); wcApi({ action: 'report', id: id }).then(setRep); }
  if (!list) { return <div className="text-[12px]" style={{ color: SUB }}>Loading…</div>; }
  if (!list.ok) { return <div className="text-[12px] font-bold" style={{ color: '#991b1b' }}>{list.error}</div>; }
  if (rep && !rep.loading && rep.ok) {
    var r = rep.report;
    var frozenRows = rep.items.map(function (i) { return Object.assign({}, i.frozen, { state_words: (i.frozen && i.frozen.state_words) || STATE_WORDS[i.frozen_state] || '' }); });
    return <div>
      <button onClick={function () { setRep(null); }} className="px-2 py-1 rounded-lg text-[11px] font-bold mb-2" style={{ background: '#f1f5f9', color: '#334155' }}>← All reports</button>
      <div className="text-[13px] font-extrabold">{'Report ' + r.report_no}</div>
      <div className="text-[12px]" style={{ color: SUB }}>{'Run by ' + r.run_by_name + ' · ' + when(r.run_at) + ' · bills dated ' + (r.date_from || '?') + ' to ' + (r.date_to || '?') + ' · source ' + (r.source || '?') + (r.feed_generated_at ? ' · warehouse read ' + when(r.feed_generated_at) : '') + ' · ' + (r.bills_checked || []).length + ' bills checked'}</div>
      <div className="text-[12px] font-extrabold" style={{ color: /^Complete/.test(r.status_at_run) ? '#14532d' : '#b91c1c' }}>{'When it was run: ' + r.status_at_run}</div>
      {rep.current_status ? <div className="text-[12px] font-extrabold" style={{ color: rep.current_status.complete ? '#14532d' : '#b91c1c' }}>{'Now: ' + rep.current_status.words + (rep.current_note ? ' (' + rep.current_note + ')' : '')}</div> : null}
      {rep.partial ? <div className="text-[12px] font-extrabold mt-1 rounded px-2 py-1" style={{ background: '#fef9c3', color: '#854d0e' }}>{rep.partial_words}</div> : null}
      <button onClick={function () { download(r.report_no + (rep.partial ? '-PARTIAL' : '') + '.csv', toCsv(csvRows(frozenRows, r.report_no + (rep.partial ? ' (PARTIAL)' : '')))); }} className="mt-1 px-2 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>Export this report as it stood (CSV)</button>
      <table className="w-full text-[12px] mt-2"><thead><tr style={{ background: '#f1f5f9', color: SUB }} className="text-left text-[11px]"><th className="px-1">#</th><th className="px-1">Bill(s)</th><th className="px-1">Product</th><th className="px-1">As it stood</th><th className="px-1">Decided since</th><th className="px-1">Now</th></tr></thead>
        <tbody>{rep.items.map(function (i) {
          var fz = i.frozen || {}; var f = fz.figures || {};
          return <tr key={i.seq} style={{ borderTop: '1px solid ' + LINE }}>
            <td className="px-1 align-top">{i.seq}</td>
            <td className="px-1 align-top">{(fz.bills || []).map(function (b) { return <div key={b.id}><button onClick={function () { props.openBill(b); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>{(b.vendor || '') + ' ' + (b.bill_number || '')}</button></div>; })}</td>
            <td className="px-1 align-top">{fz.product_label || '—'}{f.basis ? <div style={{ color: SUB }}>{num(f.billed) + ' billed / ' + num(f.received) + ' scanned ' + f.unit + ' (' + (f.diff > 0 ? '+' : '') + num(f.diff) + ')'}</div> : null}</td>
            <td className="px-1 align-top"><Chip outcome={i.outcome}>{OUTCOME_WORDS[i.outcome] || i.outcome}</Chip><div style={{ color: STATE_STYLE[i.frozen_state] || SUB, fontWeight: 700 }}>{i.needs_attention ? (STATE_WORDS[i.frozen_state] || i.frozen_state) : ''}</div></td>
            <td className="px-1 align-top">{i.later.length ? i.later.map(function (d, k) { return <div key={k}>{when(d.at) + ' · ' + d.actor_name + ' · ' + (DECISION_LABEL[d.kind] || d.kind) + ' — “' + d.reason + '”'}</div>; }) : <span style={{ color: SUB }}>—</span>}</td>
            <td className="px-1 align-top">{i.current ? <span style={{ color: STATE_STYLE[i.current.state] || SUB, fontWeight: 800 }}>{i.current.state_words || i.current.state}</span> : '—'}{i.current && i.current.changed && i.current.changed.length ? <div style={{ color: '#9a3412' }}>{i.current.changed.join(' · ')}</div> : null}</td>
          </tr>;
        })}</tbody></table>
    </div>;
  }
  return <div>
    {rep && rep.loading ? <div className="text-[12px]" style={{ color: SUB }}>Opening…</div> : null}
    {rep && !rep.loading && !rep.ok ? <div className="text-[12px] font-bold" style={{ color: '#991b1b' }}>{rep.error}</div> : null}
    {!list.reports.length ? <div className="text-[12px]" style={{ color: SUB }}>No saved reports yet. Use “Recheck + save as a numbered report” on the Exceptions tab.</div> : null}
    <table className="w-full text-[12px]"><thead><tr style={{ background: '#f1f5f9', color: SUB }} className="text-left text-[11px]"><th className="px-1">Report</th><th className="px-1">Run</th><th className="px-1">By</th><th className="px-1">Bill dates</th><th className="px-1">Status when run</th><th /></tr></thead>
      <tbody>{list.reports.map(function (r) {
        return <tr key={r.id} style={{ borderTop: '1px solid ' + LINE }}>
          <td className="px-1 font-bold">{r.report_no}</td><td className="px-1">{when(r.run_at)}</td><td className="px-1">{r.run_by_name}</td><td className="px-1">{(r.date_from || '?') + ' – ' + (r.date_to || '?')}{r.partial ? <span className="ml-1 font-bold" style={{ color: '#854d0e' }}>(partly outside your access)</span> : null}</td>
          <td className="px-1" style={{ color: /^Complete/.test(r.status_at_run) ? '#14532d' : '#b91c1c', fontWeight: 700 }}>{r.status_at_run}</td>
          <td className="px-1"><button onClick={function () { open(r.id); }} className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Open</button></td>
        </tr>;
      })}</tbody></table>
  </div>;
}

function WcSettings(props) {
  var _s = useState(null); var s = _s[0], setS = _s[1];
  var BLANK_MAP = { vendor_name: 'NexPac Corporation', bill_description: '', bill_unit: 'LBS', wh_product_type: '', wh_cgt: '', wh_nt: '', wh_color: '', wh_label: '', lb_per_yd: '', lb_factor_approved: false, note: '' };
  var _m = useState(BLANK_MAP); var m = _m[0], setM = _m[1];
  var _ed = useState(null); var editing = _ed[0], setEditing = _ed[1]; // v55.83-ZF: the mapping row being changed (or null = adding)
  var _t = useState({ pct: '', lb: '', note: '' }); var t = _t[0], setT = _t[1];
  var _e = useState(''); var msg = _e[0], setMsg = _e[1];
  var _v = useState(null); var vsel = _v[0], setVsel = _v[1];
  function load() { wcApi({ action: 'settings_view' }).then(function (j) { setS(j); if (j && j.ok && j.scope) { var o = {}; (j.scope.vendor_keys || []).forEach(function (k, i) { o[k] = (j.scope.vendor_names || [])[i] || k; }); setVsel(o); } }); }
  useEffect(load, []);
  if (!s) { return <div className="text-[12px]" style={{ color: SUB }}>Loading…</div>; }
  if (!s.ok) { return <div className="text-[12px] font-bold" style={{ color: '#991b1b' }}>{s.error}</div>; }
  var p = s.permissions || {}; var L = s.lookups || {};
  var inp = 'px-2 py-1 rounded-lg border border-slate-300 text-[12px] text-slate-900 bg-white nt-light';
  function sel(tabName, key, label) { var opts = L[tabName] || {}; return <label>{label}<br /><select value={m[key]} onChange={function (e) { var o = {}; o[key] = e.target.value; setM(Object.assign({}, m, o)); }} className={inp}><option value="">any</option>{Object.keys(opts).map(function (id) { return <option key={id} value={id}>{opts[id] + ' (#' + id + ')'}</option>; })}</select></label>; }
  function saveMap() {
    setMsg('');
    if (editing && String(m.note || '').trim().length < 5) { setMsg('Say why this mapping is changed (at least a few words) — it is kept with the new version.'); return; }
    var body = Object.assign({ action: 'map_save' }, m); if (!p.super_admin) { delete body.lb_factor_approved; } // Codex 25 Nov (ZF): the approval tick is hidden for non-super editors, so it is never sent; an unchanged approved factor is kept by the server, a changed one is saved unapproved
    if (editing) { body.family = editing.family; body.expected_version = editing.version; if (!String(body.vendor_name || '').trim()) { delete body.vendor_name; } }
    wcApi(body).then(function (j) { if (!j.ok) { setMsg(j.error); return; } setMsg(editing ? 'Mapping changed: version ' + j.map.version + ' saved, version ' + j.changed_from + ' kept in the history. Decisions that used it are asked again.' : 'Mapping saved.'); setEditing(null); setM(BLANK_MAP); load(); });
  }
  // v55.83-ZF (Max 25 Nov "need to be able to update the product mappings"): Edit = prefill the form with this mapping; saving makes a new version
  function startEdit(x) { setMsg(''); setEditing(x); setM({ vendor_name: '', bill_description: x.bill_description || '' /* Codex 25 Nov (ZF): never prefill the stored key as a description (that would re-key it); the key shows as a hint */, bill_unit: x.bill_unit || '', wh_product_type: x.wh_product_type || '', wh_cgt: x.wh_cgt || '', wh_nt: x.wh_nt || '', wh_color: x.wh_color || '', wh_label: x.wh_label || '', lb_per_yd: x.lb_per_yd != null ? String(x.lb_per_yd) : '', lb_factor_approved: !!x.lb_factor_approved, note: '' }); }
  function cancelEdit() { setEditing(null); setM(BLANK_MAP); setMsg(''); }
  function retire(fam) { var r = window.prompt('Why is this mapping retired? (it stays in the history)'); if (!r) { return; } wcApi({ action: 'map_retire', family: fam, reason: r }).then(function (j) { setMsg(j.ok ? 'Retired.' : j.error); load(); }); }
  function saveTol() { setMsg(''); wcApi(Object.assign({ action: 'tolerance_save' }, t)).then(function (j) { setMsg(j.ok ? 'Tolerance saved (version ' + j.tolerance.version + ').' : j.error); load(); }); }
  var tol = (s.tolerances || [])[0];
  function saveScope() { setMsg(''); var names = Object.keys(vsel || {}).filter(function (k) { return !!vsel[k]; }).map(function (k) { return vsel[k]; }); wcApi({ action: 'scope_save', vendor_names: names }).then(function (j) { setMsg(j.ok ? 'Vendors saved (version ' + j.scope.version + '): ' + j.scope.vendor_names.join(', ') : j.error); load(); }); }
  var sc = s.scope || {}; var scKeys = sc.vendor_keys || [];
  return <div className="text-[12px]">
    {msg ? <div className="rounded px-2 py-1 mb-2 font-bold" style={{ background: '#f1f5f9' }}>{msg}</div> : null}
    <div className="font-extrabold">Vendors in the warehouse check (NexPac always, plus the ones you tick)</div>
    <div style={{ color: SUB }}>{'Checked now: ' + (sc.vendor_names || []).join(', ') + (sc.is_default ? ' — the default (NexPac only) until Max saves a selection' : ' — version ' + sc.version + ', ' + when(sc.at)) + '. Bills from other vendors show no warehouse check and are left out of every list.'}{sc.table_missing ? ' (The vendor list cannot be saved until Max runs sql/v55-83-YX-wc-vendor-scope.sql.)' : ''}</div>
    {p.super_admin && vsel ? <div className="mt-1"><div className="flex flex-wrap gap-x-3 gap-y-1" style={{ maxHeight: 160, overflowY: 'auto' }}>{(s.vendor_choices || []).map(function (v) { var always = v.key === 'nexpac'; var on = always || !!vsel[v.key]; return <label key={v.key} className="flex items-center gap-1"><input type="checkbox" checked={on} disabled={always} onChange={function (e) { var o = Object.assign({}, vsel); o[v.key] = e.target.checked ? v.name : false; setVsel(o); }} />{v.name + ' (' + v.bills + ')' + (always ? ' — always' : '')}</label>; })}</div>
      <button onClick={saveScope} className="mt-1 px-3 py-1 rounded-lg font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>Save vendors</button></div> : <div className="text-[11px]" style={{ color: SUB }}>Only the super admin chooses the vendors.</div>}
    <div className="mt-3" />
    <div className="font-extrabold">Tolerance</div>
    <div style={{ color: SUB }}>{tol ? 'Approved: ' + (tol.pct != null ? tol.pct + '%' : '') + (tol.pct != null && tol.lb != null ? ' or ' : '') + (tol.lb != null ? tol.lb + ' lb' : '') + ' (whichever is larger) — version ' + tol.version + ', ' + tol.actor_name + ', ' + when(tol.at) : 'None approved yet. Until Max sets one, nothing is called “Matched”; exact agreement shows “Equal”.'}</div>
    <div className="font-bold mt-1" style={{ color: '#7c2d12' }}>One way only: a bill may be LESS than what was scanned into the warehouse by up to this amount (packaging, gross vs net). A bill MORE than what was scanned is never allowed — no tolerance, it is always a discrepancy.</div>
    {p.super_admin ? <div className="flex flex-wrap gap-2 items-end mt-1"><label>%<br /><input value={t.pct} onChange={function (e) { setT(Object.assign({}, t, { pct: e.target.value })); }} className={inp + ' w-16'} /></label><label>lb<br /><input value={t.lb} onChange={function (e) { setT(Object.assign({}, t, { lb: e.target.value })); }} className={inp + ' w-20'} /></label><label>Note<br /><input value={t.note} onChange={function (e) { setT(Object.assign({}, t, { note: e.target.value })); }} className={inp + ' w-64'} /></label><button onClick={saveTol} className="px-3 py-1 rounded-lg font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>Save tolerance</button></div> : <div className="text-[11px]" style={{ color: SUB }}>Only the super admin sets the tolerance.</div>}

    <div className="font-extrabold mt-3">Product mappings (this bill product = that warehouse product)</div>
    <div style={{ color: SUB }}>A bill line is compared only through an approved mapping — different names are never treated as the same product on their own. Changing a mapping keeps its history and asks for revalidation of decisions that used it.</div>
    <table className="w-full mt-1"><thead><tr style={{ background: '#f1f5f9', color: SUB }} className="text-left text-[11px]"><th className="px-1">Vendor</th><th className="px-1">Bill product</th><th className="px-1">Unit</th><th className="px-1">Warehouse product</th><th className="px-1">lb / yd for this check</th><th className="px-1">By</th><th /></tr></thead>
      <tbody>{(s.maps || []).map(function (x) { return <tr key={x.id} style={{ borderTop: '1px solid ' + LINE }}><td className="px-1">{x.vendor_key}</td><td className="px-1">{x.bill_description || x.item_key}</td><td className="px-1">{x.bill_unit}</td><td className="px-1">{x.wh_label || ['product_type', 'cgt', 'nt', 'color'].map(function (k) { return x['wh_' + k] ? k + ' #' + x['wh_' + k] : null; }).filter(Boolean).join(' · ')}</td><td className="px-1">{x.lb_per_yd ? x.lb_per_yd + (x.lb_factor_approved ? ' (approved)' : ' (NOT approved — not used)') : '—'}</td><td className="px-1">{x.actor_name + ', v' + x.version}</td><td className="px-1">{p.settings ? <span className="inline-flex gap-2"><button onClick={function () { startEdit(x); }} className="underline text-[11px] font-bold" style={{ color: '#1d4ed8' }}>Edit</button><button onClick={function () { retire(x.family); }} className="underline text-[11px]" style={{ color: '#991b1b' }}>retire</button></span> : null}</td></tr>; })}</tbody></table>
    {p.settings && editing ? <div className="rounded-lg px-2 py-1 mt-2 text-[12px] font-bold" style={{ background: '#eff6ff', color: '#1e3a8a', border: '1px solid #bfdbfe' }}>{'Editing the mapping for “' + (editing.bill_description || editing.item_key) + '” (' + editing.bill_unit + ', ' + editing.vendor_key + ') — version ' + editing.version + '. Saving makes version ' + (editing.version + 1) + '; version ' + editing.version + ' is kept in the history. Decisions that used it are asked again.'}</div> : null}
    {p.settings ? <div className="flex flex-wrap gap-2 items-end mt-2 text-[11px] font-bold" style={{ color: SUB }}>
      <label>Vendor<br /><input value={m.vendor_name} onChange={function (e) { setM(Object.assign({}, m, { vendor_name: e.target.value })); }} placeholder={editing ? editing.vendor_key + ' (unchanged)' : ''} className={inp + ' w-40'} /></label>
      <label>Bill product (as on the bill)<br /><input value={m.bill_description} onChange={function (e) { setM(Object.assign({}, m, { bill_description: e.target.value })); }} placeholder={editing && !editing.bill_description ? 'matched by key: ' + editing.item_key + ' (no description saved)' : 'Cambridge Seconds (LBS)'} className={inp + ' w-48'} /></label>
      <label>Bill unit<br /><input value={m.bill_unit} onChange={function (e) { setM(Object.assign({}, m, { bill_unit: e.target.value })); }} className={inp + ' w-20'} /></label>
      {sel('product_types', 'wh_product_type', 'Warehouse product type')}{sel('cgt_grades', 'wh_cgt', 'CGT grade')}{sel('nt_grades', 'wh_nt', 'NT grade')}{sel('colors', 'wh_color', 'Colour')}
      <label>Name to show<br /><input value={m.wh_label} onChange={function (e) { setM(Object.assign({}, m, { wh_label: e.target.value })); }} className={inp + ' w-40'} /></label>
      <label>lb per yard (optional)<br /><input value={m.lb_per_yd} onChange={function (e) { setM(Object.assign({}, m, { lb_per_yd: e.target.value })); }} className={inp + ' w-16'} /></label>
      {p.super_admin ? <label className="flex items-center gap-1"><input type="checkbox" checked={m.lb_factor_approved} onChange={function (e) { setM(Object.assign({}, m, { lb_factor_approved: e.target.checked })); }} />approve this factor for the check</label> : null}
      {editing ? <label>Why is it changed? (required)<br /><input value={m.note} onChange={function (e) { setM(Object.assign({}, m, { note: e.target.value })); }} placeholder="e.g. Texas Thirds are scanned as Folds, not Thirds" className={inp + ' w-72'} /></label> : null}
      <button onClick={saveMap} className="px-3 py-1 rounded-lg font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>{editing ? 'Save change (new version)' : 'Save mapping'}</button>
      {editing ? <button onClick={cancelEdit} className="px-3 py-1 rounded-lg font-bold" style={{ background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>Cancel</button> : null}
    </div> : <div className="text-[11px] mt-1" style={{ color: SUB }}>Adding mappings needs “Warehouse check: Settings”.</div>}
    {!Object.keys(L.product_types || {}).length ? <div className="text-[11px] mt-1" style={{ color: '#854d0e' }}>The warehouse product list appears after the first successful warehouse read.</div> : null}
  </div>;
}
