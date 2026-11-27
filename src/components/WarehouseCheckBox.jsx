// v55.83-XB — "Warehouse Check" inside a bill's details (Accounting → Bills → open a bill). Max, 21 Nov 2026.
// What the supplier billed (per product, in lb or yards) beside what was actually scanned into the NextTrade warehouse, the
// receipt and scan rows behind it, and an audited decision on every difference. The server (api/accounting/weight-check)
// decides everything; this box only shows it and sends the person's choices. It never changes the bill, a payment or a wire.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
export var OUTCOME_STYLE = {
  matched: { bg: '#dcfce7', fg: '#14532d', bd: '#86efac' }, equal: { bg: '#dcfce7', fg: '#14532d', bd: '#86efac' },
  discrepancy: { bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' }, no_receipt: { bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' }, product_missing: { bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' },
  incomplete: { bg: '#fef9c3', fg: '#854d0e', bd: '#fde047' }, cannot_compare: { bg: '#ffedd5', fg: '#9a3412', bd: '#fdba74' }, mapping_conflict: { bg: '#ffedd5', fg: '#9a3412', bd: '#fdba74' },
  warehouse_unavailable: { bg: '#e2e8f0', fg: '#334155', bd: '#94a3b8' }, limited_access: { bg: '#e2e8f0', fg: '#334155', bd: '#94a3b8' }, warehouse_only: { bg: '#f1f5f9', fg: '#334155', bd: '#cbd5e1' }
};
export var STATE_STYLE = { not_checked: '#b91c1c', limited: '#b91c1c', blocked: '#b91c1c', validated: '#14532d', accepted: '#1d4ed8', resolved: '#0f766e', issue_open: '#b91c1c', needs_revalidation: '#c2410c', reopened: '#7c2d12', unreviewed: '#475569' };
export var DECISION_LABEL = { validate_match: '✓ Validate match', accept_discrepancy: 'Accept discrepancy', report_issue: '⚑ Report an issue', resolve: 'Resolve the issue', reopen: '↺ Reopen' };

// the Bills screen passes toast as { success, error }; other places may pass a function
export function say(t, msg, kind) { if (!t) { return; } if (typeof t === 'function') { t(msg, kind); return; } if (kind === 'error' && t.error) { t.error(msg); } else if (t.success) { t.success(msg); } }
export function wcApi(payload) {
  return hubFetch('/api/accounting/weight-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    // v55.83-ZT (Codex 27 Nov): an explicit server refusal stays a refusal; an unreachable server or an unreadable answer is UNCERTAIN —
    // the request may have been saved, so callers must check before saying "not saved" or offering a retry. Codex 07:19: a readable
    // 5xx (or any non-4xx failure) can come AFTER the write (the route saves, then re-reads) — uncertain too; only a 4xx is a refusal.
    .then(function (r) { return r.json().then(function (j) { if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean') { return { ok: false, uncertain: true, error: 'The server answer (' + r.status + ') could not be read.', http_status: r.status }; } j.http_status = r.status; if (j.ok !== true && (r.status >= 500 || r.status < 400)) { j.uncertain = true; } return j; }, function () { return { ok: false, uncertain: true, error: 'The server answered ' + r.status + ' without a readable answer.', http_status: r.status }; }); })
    .catch(function () { return { ok: false, uncertain: true, error: 'Could not reach the Hub server.' }; });
}
export function warehouseMappingLabel(map, lookups) {
  return [['wh_product_type', 'product_types'], ['wh_cgt', 'cgt_grades'], ['wh_nt', 'nt_grades'], ['wh_color', 'colors']].map(function (pair) {
    return (lookups[pair[1]] || {})[map[pair[0]]];
  }).filter(Boolean).join(' · ');
}
export function num(v, d) { if (v === null || v === undefined) { return '—'; } return Number(v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 3 : d }); }
export function when(s) { if (!s) { return '—'; } try { return new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (e) { return String(s); } }
export function Chip(props) { var s = OUTCOME_STYLE[props.outcome] || OUTCOME_STYLE.cannot_compare; return <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold" style={{ background: s.bg, color: s.fg, border: '1px solid ' + s.bd }}>{props.children}</span>; }

// the source line: which warehouse copy, when it was last read, and whether that read worked
export function FeedLine(props) {
  var f = props.feed || {}; var last = f.last_run; var good = f.last_good;
  return <div className="text-[11px] flex flex-wrap gap-2 items-center" style={{ color: SUB }}>
    <span className="px-1.5 py-0.5 rounded font-extrabold" style={f.staging ? { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' } : { background: '#dbeafe', color: '#1e3a8a' }}>{f.staging ? 'STAGING warehouse data' : 'LIVE warehouse data'}</span>
    {f.feed_error ? <span style={{ color: '#991b1b', fontWeight: 700 }}>{'Warehouse unavailable / not checked — ' + f.feed_error}</span> : null}
    <span>{'Last read: ' + (good ? when(good.at) + (good.complete === false ? ' (incomplete answer)' : '') : 'never')}</span>
    {last && last.ok === false ? <span style={{ color: '#991b1b', fontWeight: 700 }}>{'Last attempt ' + when(last.at) + ' FAILED: ' + (last.error || 'warehouse unavailable') + ' — figures below are from the last good read'}</span> : null}
  </div>;
}

// Validate / Accept / Report / Resolve / Reopen — one dialog for the box and the report
export function DecisionDialog(props) {
  var it = props.item; var kind = props.kind;
  var _r = useState(''); var reason = _r[0], setReason = _r[1];
  var _n = useState(''); var note = _n[0], setNote = _n[1];
  var _f = useState([]); var files = _f[0], setFiles = _f[1];
  var _a = useState(''); var assignee = _a[0], setAssignee = _a[1];
  var _p = useState(null); var people = _p[0], setPeople = _p[1];
  var _b = useState(false); var busy = _b[0], setBusy = _b[1];
  var _e = useState(''); var err = _e[0], setErr = _e[1];
  useEffect(function () { if (kind === 'report_issue') { wcApi({ action: 'people' }).then(function (j) { setPeople(j && j.ok ? j.people : []); }); } }, [kind]);
  function pick(e) {
    var list = Array.prototype.slice.call(e.target.files || [], 0, 3); var outF = []; var n = 0;
    if (!list.length) { setFiles([]); return; }
    list.forEach(function (f) { var rd = new FileReader(); rd.onload = function () { var s = String(rd.result || ''); outF.push({ name: f.name, type: f.type, base64: s.substring(s.indexOf(',') + 1) }); n++; if (n === list.length) { setFiles(outF); } }; rd.readAsDataURL(f); });
  }
  function send() {
    setBusy(true); setErr('');
    wcApi({ action: 'decide', bill_id: props.billId, item_key: it.item_key, kind: kind, reason: reason, evidence_note: note, evidence_files: files, assignee: assignee || null, expected_fp: it.comparison_fp })
      .then(function (j) { setBusy(false); if (!j || !j.ok) { setErr((j && j.error) || 'Not saved.'); return; } props.onDone(j); });
  }
  var head = kind === 'accept_discrepancy' ? 'The difference stays visible and is labelled "Reviewed — discrepancy accepted" (never "Matched").'
    : kind === 'report_issue' ? 'A ticket is created and assigned. The item stays OPEN (not approved) until someone records a resolution with evidence. It does NOT dispute the bill or stop payment.'
      : kind === 'resolve' ? 'Record how the reported issue was resolved and the evidence for it.'
        : kind === 'reopen' ? 'The earlier decision and its evidence stay in the history; the item becomes outstanding again.' : 'You confirm the billed and scanned figures agree.';
  var f = it.figures || {};
  return <div onClick={props.onClose} style={{ position: 'fixed', inset: 0, zIndex: 340, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div onClick={function (e) { e.stopPropagation(); }} role="dialog" aria-modal="true" aria-label={DECISION_LABEL[kind]} style={{ background: '#ffffff', color: INK, borderRadius: 12, border: '2px solid #0f172a', width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
      <div className="px-3 py-2 font-extrabold text-[13px]" style={{ background: '#0f172a', color: '#ffffff' }}>{DECISION_LABEL[kind] + (it.product_label ? ' — ' + it.product_label : '')}</div>
      <div className="p-3 text-[12px] space-y-2">
        <div style={{ color: SUB }}>{head}</div>
        {f.basis ? <div className="font-semibold">{'Billed ' + num(f.billed) + ' ' + f.unit + ' · scanned in ' + num(f.received) + ' ' + f.unit + ' · difference ' + num(f.diff) + ' ' + f.unit + (f.pct != null ? ' (' + num(f.pct, 2) + '%)' : '')}</div> : null}
        <label className="block font-bold">{kind === 'report_issue' ? 'What is wrong (explanation)' : kind === 'resolve' ? 'Resolution' : 'Reason'}
          <textarea value={reason} onChange={function (e) { setReason(e.target.value); }} rows={3} className="w-full mt-1 px-2 py-1 rounded-lg border border-slate-300 text-[12px] text-slate-900 bg-white nt-light" /></label>
        {kind === 'report_issue' && <label className="block font-bold">Assign to (optional)
          <select value={assignee} onChange={function (e) { setAssignee(e.target.value); }} className="w-full mt-1 px-2 py-1 rounded-lg border border-slate-300 text-[12px] text-slate-900 bg-white nt-light">
            <option value="">— me —</option>{(people || []).map(function (p) { return <option key={p.id} value={p.id}>{p.name}</option>; })}</select></label>}
        {kind !== 'reopen' && <label className="block font-bold">{kind === 'resolve' ? 'Evidence (a file and / or what proves it — required)' : 'Evidence (optional)'}
          <input type="file" multiple onChange={pick} className="block mt-1 text-[12px]" />
          <textarea value={note} onChange={function (e) { setNote(e.target.value); }} rows={2} placeholder="e.g. scale ticket number, supplier email of 20 Nov" className="w-full mt-1 px-2 py-1 rounded-lg border border-slate-300 text-[12px] text-slate-900 bg-white nt-light" /></label>}
        {err && <div className="rounded-lg px-2 py-1 font-extrabold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{'⛔ ' + err}</div>}
      </div>
      <div className="px-3 py-2 flex gap-2 justify-end" style={{ borderTop: '1px solid ' + LINE }}>
        <button disabled={busy} onClick={send} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save decision'}</button>
        <button onClick={props.onClose} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
      </div>
    </div>
  </div>;
}

// the buttons a person may use on one item (the server checks again)
export function DecisionButtons(props) {
  var it = props.item; var p = props.perms || {};
  var btn = 'px-2 py-0.5 rounded text-[11px] font-extrabold';
  var outB = [];
  if (!it.needs_decision) { return null; }
  var decided = it.state === 'validated' || it.state === 'accepted' || it.state === 'resolved';
  if (!decided && it.state !== 'issue_open') {
    (it.allowed || []).forEach(function (k) {
      var ok = k === 'accept_discrepancy' ? p.accept : p.validate;
      if (ok) { outB.push(<button key={k} onClick={function () { props.onDecide(k); }} className={btn} style={k === 'report_issue' ? { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' } : { background: '#1d4ed8', color: '#ffffff' }}>{DECISION_LABEL[k]}</button>); }
    });
  }
  if (it.state === 'issue_open' && p.resolve) { outB.push(<button key="resolve" onClick={function () { props.onDecide('resolve'); }} className={btn} style={{ background: '#0f766e', color: '#ffffff' }}>{DECISION_LABEL.resolve}</button>); }
  var lastK = it.decision && it.decision.kind;
  var canReopen = lastK === 'accept_discrepancy' ? p.accept : lastK === 'resolve' ? p.resolve : p.validate;
  if (it.decision && it.state !== 'reopened' && it.state !== 'unreviewed' && canReopen) { outB.push(<button key="reopen" onClick={function () { props.onDecide('reopen'); }} className={btn} style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>{DECISION_LABEL.reopen}</button>); }
  return <span className="inline-flex gap-1 flex-wrap">{outB}</span>;
}

export function StateLine(props) {
  var it = props.item;
  if (!it.needs_attention && !it.needs_decision) { return null; }
  var d = it.decision;
  return <div className="text-[11px]" style={{ color: STATE_STYLE[it.state] || SUB, fontWeight: 800 }}>
    {it.state_words}{d ? ' · ' + d.actor_name + ', ' + when(d.at) + ' — “' + d.reason + '”' : ''}{it.issue && it.state === 'issue_open' ? ' · assigned to ' + (it.issue.assignee_name || it.issue.actor_name) : ''}
    {it.changed && it.changed.length ? <ul className="list-disc ml-5 font-semibold" style={{ color: '#9a3412' }}>{it.changed.map(function (c, i) { return <li key={i}>{c}</li>; })}</ul> : null}
  </div>;
}

export function ItemCard(props) {
  var it = props.item;
  var _o = useState(false); var open = _o[0], setOpen = _o[1];
  var f = it.figures || {};
  return <div className="rounded-lg p-2 mb-2" style={{ border: '1px solid ' + LINE, background: '#ffffff' }}>
    <div className="flex flex-wrap gap-2 items-center">
      <Chip outcome={it.outcome}>{it.outcome_words}</Chip>
      <b className="text-[12px]">{it.product_label || (it.kind === 'bill' ? 'Whole bill' : '')}</b>
      {(it.receipts || []).length ? <span className="text-[11px]" style={{ color: SUB }}>{'Receipt ' + it.receipts.map(function (r) { return (r.reference_number || r.id) + (r.warehouse ? ' (' + r.warehouse + ')' : '') + (r.is_draft ? ' — DRAFT' : ''); }).join(', ')}</span> : null}
      {(it.bills || []).length > 1 ? <span className="text-[11px] font-bold" style={{ color: '#1e3a8a' }}>{'Group of ' + it.bills.length + ' bills: ' + it.bills.map(function (b) { return b.bill_number; }).join(', ')}</span> : null}
      <span style={{ flex: 1 }} />
      <DecisionButtons item={it} perms={props.perms} onDecide={function (k) { props.onDecide(it, k); }} />
    </div>
    {f.basis ? <table className="text-[12px] mt-1"><tbody><tr>
      <td className="pr-3">{'Billed: '}<b>{num(f.billed) + ' ' + f.unit}</b></td>
      <td className="pr-3">{'Scanned in: '}<b>{num(f.received) + ' ' + f.unit}</b>{f.received_rolls != null ? ' · ' + num(f.received_rolls, 0) + ' rolls' : ''}</td>
      <td className="pr-3">{'Difference: '}<b style={{ color: f.diff ? '#991b1b' : '#14532d' }}>{(f.diff > 0 ? '+' : '') + num(f.diff) + ' ' + f.unit + (f.pct != null ? ' (' + (f.pct > 0 ? '+' : '') + num(f.pct, 2) + '%)' : '')}</b></td>
    </tr></tbody></table> : null}
    {f.basis ? <div className="text-[11px]" style={{ color: SUB }}>{'Unit / conversion: ' + (f.conversion || '—') + (f.basis === 'yd' ? ' · compared in yards, like with like' : ' · compared in pounds') + (f.lb_factor ? ' · approved ' + f.lb_factor + ' lb/yd → billed ≈ ' + num(f.billed_lb_by_factor) + ' lb vs scanned ' + num(f.received_lb) + ' lb' : '') + (f.declared_pl_kg != null ? ' · packing list declared ' + num(f.declared_pl_kg) + ' kg (not used as received)' : '') + (f.scanned_out ? ' · ' + f.scanned_out + ' of ' + f.scans + ' scans already shipped out (still counted)' : '')}</div> : null}
    {(it.reasons || []).length ? <div className="text-[11px] font-semibold" style={{ color: '#9a3412' }}>{it.reasons.join(' · ')}</div> : null}
    {it.provisional ? <div className="text-[11px] font-bold" style={{ color: '#854d0e' }}>Provisional: the receipt is still a draft in the warehouse — completeness is not confirmed.</div> : null}
    <StateLine item={it} />
    {props.children}
    {(it.scan_rows || []).length || (it.bill_lines || []).length || (it.history || []).length ? <button onClick={function () { setOpen(!open); }} className="mt-1 text-[11px] font-bold underline" style={{ color: '#1d4ed8' }}>{open ? 'Hide the records behind this' : 'Show the bill lines, scan rows and history behind this'}</button> : null}
    {open && <div className="mt-1 text-[11px]">
      {(it.bill_lines || []).length ? <div><b>Bill lines:</b> {it.bill_lines.map(function (l, i) { return <div key={i}>{'Bill ' + (l.bill_number || '?') + ' line ' + l.line_no + ': “' + l.description + '” ' + num(l.qty) + ' ' + (l.unit || '') + ' (' + (l.conversion || '') + ')'}</div>; })}</div> : null}
      {(it.scan_rows || []).length ? <div className="mt-1"><b>{'Scan rows (' + it.scan_rows.length + '):'}</b>
        <table className="text-[11px]"><thead><tr style={{ color: SUB }}><th className="pr-2 text-left">Scan id</th><th className="pr-2 text-left">Receipt</th><th className="pr-2 text-left">Skew / pallet</th><th className="pr-2 text-right">lb</th><th className="pr-2 text-right">yd</th><th className="pr-2 text-right">rolls</th><th className="pr-2 text-left">shipped out</th></tr></thead>
          <tbody>{it.scan_rows.map(function (s) { return <tr key={s.id}><td className="pr-2">{s.id}</td><td className="pr-2">{s.receipt_key}</td><td className="pr-2">{s.skew || s.pallet || '—'}</td><td className="pr-2 text-right">{num(s.lb)}</td><td className="pr-2 text-right">{num(s.yd)}</td><td className="pr-2 text-right">{num(s.rolls, 0)}</td><td className="pr-2">{s.scanned_out ? 'yes' : ''}</td></tr>; })}</tbody></table></div> : null}
      {(it.links || []).length ? <div className="mt-1"><b>Links:</b> {it.links.map(function (l, i) { return <div key={i}>{'Bill → receipt ' + l.receipt_key + ' by ' + l.basis_words + ' (' + (l.bill_value || '—') + ' = ' + (l.receipt_value || '—') + '), confirmed by ' + l.actor_name + ' ' + when(l.at)}</div>; })}</div> : null}
      {(it.history || []).length ? <div className="mt-1"><b>History:</b> {it.history.map(function (d) { return <div key={d.id}>{when(d.at) + ' · ' + d.actor_name + ' · ' + (DECISION_LABEL[d.kind] || d.kind) + ' — “' + d.reason + '”' + (d.assignee_name ? ' · assigned to ' + d.assignee_name : '') + ((d.evidence || []).length ? ' · evidence: ' : '')}{(d.evidence || []).map(function (e, i) { return e.path ? <button key={i} onClick={function () { openEvidence(d.id, e.path); }} className="underline mr-1" style={{ color: '#1d4ed8' }}>{e.name || 'file'}</button> : <span key={i} className="mr-1">{'“' + e.note + '”'}</span>; })}</div>; })}</div> : null}
    </div>}
  </div>;
}
export function openEvidence(decisionId, path) {
  var w = window.open('', '_blank');
  wcApi({ action: 'evidence_url', decision_id: decisionId, path: path }).then(function (j) { if (j && j.ok && w) { w.location.href = j.url; } else { if (w) { w.close(); } alert((j && j.error) || 'Could not open the file.'); } });
}

// a bill with no confirmed receipt: the proposals to confirm / reject, or choose one by hand
export function LinkChooser(props) {
  var it = props.item; var p = props.perms || {};
  var _m = useState(''); var rid = _m[0], setRid = _m[1];
  var _w = useState(''); var why = _w[0], setWhy = _w[1];
  if (!p.validate) { return it.needs_link ? <div className="text-[11px]" style={{ color: SUB }}>A person with “Warehouse check: Validate” must confirm which receipt belongs to this bill.</div> : null; }
  return <div className="mt-1 text-[12px]">
    {(it.candidates || []).map(function (c) {
      return <div key={c.receipt_key} className="flex flex-wrap gap-2 items-center py-0.5">
        <span>{'Receipt ' + (c.reference_number || c.receipt_id) + ' — same ' + c.bases.join(' + ').replace(/_/g, ' ') + ' (' + c.bill_value + ' = ' + c.receipt_value + ')'}</span>
        <button onClick={function () { props.onLink({ receipt_id: c.receipt_id, basis: c.bases[0], bill_value: c.bill_value, receipt_value: c.receipt_value, state: 'confirmed' }); }} className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Confirm this receipt</button>
        <button onClick={function () { var r = window.prompt('Why is receipt ' + (c.reference_number || c.receipt_id) + ' NOT this bill’s receipt?'); if (r) { props.onLink({ receipt_id: c.receipt_id, basis: c.bases[0], state: 'rejected', reason: r }); } }} className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>Not this one</button>
      </div>;
    })}
    {it.needs_link || it.outcome === 'no_receipt' ? <div className="flex flex-wrap gap-1 items-center mt-1">
      <span style={{ color: SUB }}>Choose by hand — warehouse receipt id:</span>
      <input value={rid} onChange={function (e) { setRid(e.target.value.replace(/[^0-9]/g, '')); }} className="px-2 py-0.5 rounded border border-slate-300 w-24 text-[12px] text-slate-900 bg-white nt-light" />
      <input value={why} onChange={function (e) { setWhy(e.target.value); }} placeholder="why it is this bill’s receipt" className="px-2 py-0.5 rounded border border-slate-300 w-64 text-[12px] text-slate-900 bg-white nt-light" />
      <button disabled={!rid} onClick={function () { props.onLink({ receipt_id: rid, basis: 'manual', reason: why, state: 'confirmed' }); }} className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: '#334155', color: '#ffffff', opacity: rid ? 1 : 0.5 }}>Link</button>
    </div> : null}
  </div>;
}

export default function WarehouseCheckBox(props) {
  var bill = props.bill;
  var _d = useState(null); var data = _d[0], setData = _d[1];
  var _b = useState(''); var busy = _b[0], setBusy = _b[1];
  var _q = useState(null); var ask = _q[0], setAsk = _q[1];
  function load(payload) {
    setBusy(payload.action);
    wcApi(Object.assign({ bill_id: bill.id }, payload)).then(function (j) { setBusy(''); setData(j); if (j && !j.ok && payload.action !== 'bill') { say(props.toast, j.error || 'Not done.', 'error'); } });
  }
  useEffect(function () { load({ action: 'bill' }); }, [bill.id]);
  if (!data) { return <div className="text-[11px] mt-2" style={{ color: SUB }}>Warehouse Check: loading…</div>; }
  if (data.http_status === 403 && /Warehouse check: View/.test(String(data.error || ''))) { return null; } // not switched on for this person
  if (data.out_of_scope) { return null; } // v55.83-YX: this vendor is not in the warehouse check (NexPac + the vendors Max selects)
  var perms = data.permissions || {};
  return <div className="mt-2 rounded-xl p-2" style={{ border: '2px solid #cbd5e1', background: '#f8fafc', color: INK }}>
    <div className="flex flex-wrap gap-2 items-center mb-1">
      <b className="text-[13px]">🏭 Warehouse Check</b>
      <span className="text-[11px]" style={{ color: SUB }}>billed weight / quantity vs what was scanned into the warehouse — never changes the bill or its payment</span>
      <span style={{ flex: 1 }} />
      {perms.validate && <button disabled={!!busy} onClick={function () { load({ action: 'recheck' }); }} className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff', opacity: busy ? 0.6 : 1 }}>{busy === 'recheck' ? 'Reading the warehouse…' : '↻ Recheck warehouse'}</button>}
    </div>
    {data.sql_missing ? <div className="text-[12px] font-bold rounded-lg px-2 py-1" style={{ background: '#fef9c3', color: '#854d0e' }}>{data.error}</div> : null}
    {!data.ok && !data.sql_missing ? <div className="text-[12px] font-bold rounded-lg px-2 py-1" style={{ background: '#fef2f2', color: '#991b1b' }}>{data.error}</div> : null}
    {data.ok ? <FeedLine feed={data.feed} /> : null}
    {data.recheck && data.recheck.ok === false ? <div className="text-[12px] font-bold mt-1" style={{ color: '#991b1b' }}>{'Recheck failed: ' + data.recheck.error}</div> : null}
    {data.ok && !data.tolerance ? <div className="text-[11px] mt-1" style={{ color: '#854d0e' }}>No tolerance approved yet: figures are shown as they are; “Matched” appears only after Max approves a tolerance.</div> : null}
    <div className="mt-1">{(data.items || []).map(function (it) {
      return <ItemCard key={it.item_key} item={it} perms={perms} onDecide={function (item, k) { setAsk({ item: item, kind: k }); }}>
        {(it.needs_link || it.outcome === 'no_receipt') ? <LinkChooser item={it} perms={perms} onLink={function (l) { load(Object.assign({ action: 'link' }, l)); }} /> : null}
        {it.needs_mapping ? <div className="text-[11px] mt-1" style={{ color: SUB }}>{perms.settings ? 'Add the mapping in Bills → 🏭 Warehouse check → Mappings & tolerance.' : 'A person with “Warehouse check: Settings” must approve which warehouse product this bill product is.'}</div> : null}
        {it.searched_at && it.searched_at.length ? <div className="text-[11px]" style={{ color: SUB }}>{it.searched_at.map(function (s) { return s.ref + ': ' + (s.at ? 'looked for ' + when(s.at) + ', ' + s.found + ' receipt(s)' : 'not looked for yet'); }).join(' · ')}</div> : null}
      </ItemCard>;
    })}</div>
    {ask && <DecisionDialog item={ask.item} kind={ask.kind} billId={bill.id} onClose={function () { setAsk(null); }} onDone={function (j) { setAsk(null); setData(Object.assign({}, data, { items: j.items })); say(props.toast, 'Decision saved.', 'success'); }} />}
  </div>;
}
