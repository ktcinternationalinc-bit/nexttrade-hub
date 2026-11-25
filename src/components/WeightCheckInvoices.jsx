// v55.83-YX — Bills → 🏭 Warehouse check → "Invoices" (Max 25 Nov 2026): "for each invoice [the] breakdown and comparison and a PASS
// green or a REVIEW in red for each invoice for nexpac and any selected vendor, and an approved or disputed button".
// Every invoice of the selected vendors in the date range, one card each: per product billed vs scanned in, the difference, the result;
// PASS (green) when every line is within the approved tolerance, otherwise REVIEW (red). "Approved" records a validated / accepted
// decision on every line (same audited decisions as the rest of the check); "Disputed" reports an issue on the lines. Nothing here
// changes a bill, a payment, inventory or the warehouse.
import React, { useState } from 'react';
import { wcApi, say, num, when, LinkChooser } from './WarehouseCheckBox';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
var GREEN = '#15803d'; var RED = '#b91c1c';
var PASS_OUTCOMES = ['matched', 'equal'];
var DONE_STATES = ['validated', 'accepted', 'resolved'];

function lastDays(n) { var b = new Date(); var a = new Date(Date.now() - n * 86400000); return [a.toISOString().substring(0, 10), b.toISOString().substring(0, 10)]; }

// rows (report_preview, all:true) → one entry per invoice (rows sharing the same bill set)
export function groupInvoices(rows) {
  var by = {}; var order = [];
  (rows || []).forEach(function (r) {
    var ids = (r.bill_ids || (r.bills || []).map(function (b) { return b.id; })).slice().sort();
    var k = ids.join('+'); if (!k) { return; }
    if (!by[k]) { by[k] = { key: k, bills: r.bills || [], rows: [] }; order.push(k); }
    by[k].rows.push(r);
  });
  return order.map(function (k) {
    var g = by[k];
    var products = g.rows.filter(function (r) { return r.kind === 'product'; });
    var others = g.rows.filter(function (r) { return r.kind !== 'product' && r.outcome !== 'warehouse_only'; });
    var pass = products.length > 0 && others.length === 0 && products.every(function (r) { return PASS_OUTCOMES.indexOf(r.outcome) >= 0; });
    var decidable = g.rows.filter(function (r) { return r.needs_decision; });
    var approved = decidable.length === 0 && g.rows.some(function (r) { return DONE_STATES.indexOf(r.state) >= 0; }) && !g.rows.some(function (r) { return r.state === 'issue_open'; });
    var disputed = g.rows.some(function (r) { return r.state === 'issue_open'; });
    var why = [];
    g.rows.forEach(function (r) { if (r.kind !== 'product' || PASS_OUTCOMES.indexOf(r.outcome) < 0) { (r.reasons && r.reasons.length ? r.reasons : [r.outcome_words || r.outcome]).forEach(function (w) { if (w && why.indexOf(w) < 0) { why.push(w); } }); } });
    // Codex 25 Nov: bills sharing one receipt are compared TOGETHER — the result is the group's, never each invoice's on its own.
    // What each invoice billed is still shown, product by product (from the lines the comparison used).
    var shared = (g.bills || []).length > 1;
    var perBill = (g.bills || []).map(function (b) {
      var lines = []; products.forEach(function (r) { (r.bill_lines || []).forEach(function (ln) { if (ln.bill_id === b.id) { lines.push({ product: r.product_label || ln.description, qty: ln.qty, unit: ln.unit }); } }); });
      return { id: b.id, bill_number: b.bill_number, vendor: b.vendor, bill_date: b.bill_date, reference: b.reference, lines: lines };
    });
    return { key: k, bills: g.bills, rows: g.rows, products: products, others: others, pass: pass, approved: approved, disputed: disputed, why: why, shared: shared, perBill: perBill };
  });
}

export default function WeightCheckInvoices(props) {
  var dr = lastDays(60);
  var _f = useState({ date_from: dr[0], date_to: dr[1] }); var flt = _f[0], setFlt = _f[1];
  var _d = useState(null); var data = _d[0], setData = _d[1];
  var _b = useState(''); var busy = _b[0], setBusy = _b[1];
  var _r = useState({}); var reasons = _r[0], setReasons = _r[1];
  var _o = useState(''); var only = _o[0], setOnly = _o[1];
  var inp = 'px-2 py-1 rounded-lg border border-slate-300 text-[12px] text-slate-900 bg-white';

  function load(recheck) {
    setBusy(recheck ? 'recheck' : 'load');
    return wcApi({ action: 'report_preview', date_from: flt.date_from, date_to: flt.date_to, all: true, recheck: !!recheck }).then(function (j) { setBusy(''); setData(j); return j; });
  }
  var perms = (data && data.permissions) || {};
  var invoices = data && data.ok ? groupInvoices(data.rows) : [];
  var shown = invoices.filter(function (v) { return !only || (only === 'review' ? !v.pass && !v.approved : only === 'pass' ? v.pass && !v.approved : only === 'open' ? !v.approved && !v.disputed : true); });
  var counts = { all: invoices.length, pass: invoices.filter(function (v) { return v.pass; }).length, review: invoices.filter(function (v) { return !v.pass; }).length, approved: invoices.filter(function (v) { return v.approved; }).length, disputed: invoices.filter(function (v) { return v.disputed; }).length };

  async function decideAll(inv, mode) {
    var reason = String(reasons[inv.key] || '').trim();
    if (mode === 'approve' && !inv.pass && reason.length < 5) { say(props.toast, 'This invoice is REVIEW — write why you approve it anyway (at least a few words).', 'error'); return; }
    if (mode === 'dispute' && reason.length < 5) { say(props.toast, 'Write what is wrong (at least a few words) before disputing.', 'error'); return; }
    if (mode === 'approve' && inv.pass && reason.length < 5) { reason = 'Approved: billed vs scanned within the approved tolerance'; }
    var todo = inv.rows.filter(function (r) { return r.needs_decision; });
    if (!todo.length) { say(props.toast, 'Nothing left to decide on this invoice.', 'error'); return; }
    var blocked = todo.filter(function (r) { var a = r.allowed || []; return mode === 'dispute' ? a.indexOf('report_issue') < 0 : (a.indexOf('validate_match') < 0 && a.indexOf('accept_discrepancy') < 0); });
    if (blocked.length) { say(props.toast, 'Not possible yet: ' + blocked.map(function (r) { return r.product_label || r.outcome_words || r.outcome; }).join(', ') + ' — see the note on the card (e.g. confirm the receipt or recheck the warehouse first).', 'error'); return; }
    setBusy(inv.key);
    var failed = [];
    for (var i = 0; i < todo.length; i++) {
      var r = todo[i]; var a = r.allowed || [];
      var kind = mode === 'dispute' ? 'report_issue' : (a.indexOf('validate_match') >= 0 ? 'validate_match' : 'accept_discrepancy');
      var j = await wcApi({ action: 'decide', bill_id: (r.bill_ids || [])[0] || inv.bills[0].id, item_key: r.item_key, kind: kind, reason: reason, expected_fp: r.comparison_fp });
      if (!j || !j.ok) { failed.push((r.product_label || r.item_key) + ': ' + ((j && j.error) || 'not saved')); }
    }
    await load(false);
    setBusy('');
    if (failed.length) { say(props.toast, 'Some lines were not saved — ' + failed.join(' · '), 'error'); }
    else { say(props.toast, (mode === 'dispute' ? 'Disputed: ' : 'Approved: ') + inv.bills.map(function (b) { return b.vendor + ' ' + b.bill_number; }).join(' + '), 'success'); }
  }

  return <div className="text-[12px]" style={{ color: INK }}>
    <div className="flex flex-wrap gap-2 items-end text-[11px] font-bold" style={{ color: SUB }}>
      <label>Bill date from<br /><input type="date" value={flt.date_from} onChange={function (e) { setFlt(Object.assign({}, flt, { date_from: e.target.value })); }} className={inp} /></label>
      <label>to<br /><input type="date" value={flt.date_to} onChange={function (e) { setFlt(Object.assign({}, flt, { date_to: e.target.value })); }} className={inp} /></label>
      <button disabled={!!busy} onClick={function () { load(true); }} className="px-3 py-1.5 rounded-lg font-extrabold text-[12px]" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.6 : 1 }}>{busy === 'recheck' ? 'Reading the warehouse…' : 'Check against the warehouse'}</button>
      <button disabled={!!busy} onClick={function () { load(false); }} className="px-3 py-1.5 rounded-lg font-bold text-[12px]" style={{ background: '#f1f5f9', color: '#334155' }}>{busy === 'load' ? 'Loading…' : 'Show (last reading)'}</button>
    </div>
    <div className="text-[11px] mt-1" style={{ color: SUB }}>{data && data.scope ? 'Vendors checked: ' + (data.scope.vendor_names || []).join(', ') + (data.scope.is_default ? ' (default — Max can add vendors under Mappings & tolerance)' : '') : 'Vendors checked: NexPac and the vendors Max selects (Mappings & tolerance).'}</div>
    {data && !data.ok ? <div className="mt-2 rounded px-2 py-1 font-bold" style={{ background: '#fef2f2', color: RED }}>{data.error || 'Could not load.'}</div> : null}
    {data && data.ok && data.feed && data.feed.feed_error ? <div className="mt-2 rounded px-2 py-1 font-bold" style={{ background: '#fef2f2', color: RED }}>{'Warehouse not read: ' + data.feed.feed_error}</div> : null}
    {data && data.ok && data.freshness ? <div className="mt-1 text-[11px]" style={{ color: data.freshness.qualified ? RED : SUB }}>{data.freshness.words}</div> : null}

    {data && data.ok ? <div className="flex flex-wrap gap-2 mt-2 text-[11px] font-extrabold">
      {[['', 'All ' + counts.all], ['open', 'Not decided'], ['review', 'REVIEW ' + counts.review], ['pass', 'PASS ' + counts.pass]].map(function (x) { return <button key={x[0]} onClick={function () { setOnly(x[0]); }} className="px-2 py-1 rounded-lg" style={only === x[0] ? { background: INK, color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{x[1]}</button>; })}
      <span style={{ color: SUB, alignSelf: 'center' }}>{counts.approved + ' approved · ' + counts.disputed + ' disputed'}</span>
    </div> : null}
    {data && data.ok && !invoices.length ? <div className="mt-2" style={{ color: SUB }}>No invoices from the selected vendors in these dates.</div> : null}

    {shown.map(function (inv) {
      var head = inv.bills.map(function (b) { return (b.vendor || '') + ' · Bill ' + (b.bill_number || '') + ' · ' + (b.bill_date || '') + (b.reference ? ' · ref ' + b.reference : ''); }).join('  +  ');
      var badge = inv.approved ? ['APPROVED', GREEN, '#dcfce7'] : inv.disputed ? ['DISPUTED', RED, '#fee2e2'] : inv.pass ? ['PASS', GREEN, '#dcfce7'] : ['REVIEW', RED, '#fee2e2'];
      var badgeText = badge[0] + (inv.shared ? ' · group of ' + inv.bills.length + ' invoices' : '');
      var receipts = []; inv.rows.forEach(function (r) { (r.receipts || []).forEach(function (x) { var t = 'Receipt ' + (x.reference_number || x.id) + (x.warehouse ? ' · ' + x.warehouse : '') + (x.receipt_date ? ' · ' + String(x.receipt_date).substring(0, 10) : ''); if (receipts.indexOf(t) < 0) { receipts.push(t); } }); });
      var linkRow = inv.rows.filter(function (r) { return r.needs_link || r.outcome === 'no_receipt'; })[0];
      var canDecide = inv.rows.some(function (r) { return r.needs_decision; });
      return <div key={inv.key} className="rounded-xl mt-2 p-2" style={{ border: '2px solid ' + badge[1], background: '#ffffff' }}>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="px-3 py-1 rounded-lg text-[14px] font-black" style={{ background: badge[2], color: badge[1], border: '1px solid ' + badge[1] }}>{badgeText}</span>
          <b className="text-[13px]">{head}</b>
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: SUB }}>{receipts.length ? receipts.join('  ·  ') : 'No warehouse receipt linked yet'}</div>
        {inv.shared ? <div className="text-[11px] mt-1 font-bold rounded px-2 py-1" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' }}>{'These ' + inv.bills.length + ' invoices share the same warehouse receipt, so they are compared TOGETHER: ' + badge[0] + ' is the result for the group, not for each invoice on its own. What each invoice billed is listed below.'}</div> : null}
        {inv.shared ? <table className="w-full mt-1 text-[11px]"><thead><tr style={{ color: SUB }} className="text-left"><th className="px-1">Invoice</th><th className="px-1">Billed on this invoice</th><th className="px-1">Status</th></tr></thead><tbody>{inv.perBill.map(function (b) { return <tr key={b.id} style={{ borderTop: '1px solid ' + LINE }}><td className="px-1">{(b.vendor || '') + ' · ' + (b.bill_number || '') + ' · ' + (b.bill_date || '')}</td><td className="px-1">{b.lines.length ? b.lines.map(function (l) { return l.product + ': ' + num(l.qty) + ' ' + (l.unit || ''); }).join(' · ') : '—'}</td><td className="px-1" style={{ color: SUB }}>part of the group result — not verified on its own</td></tr>; })}</tbody></table> : null}
        {inv.products.length ? <table className="w-full mt-1 text-[12px]"><thead><tr style={{ background: '#f1f5f9', color: SUB }} className="text-left text-[11px]"><th className="px-1">Product</th><th className="px-1 text-right">Billed</th><th className="px-1 text-right">Scanned in</th><th className="px-1 text-right">Difference</th><th className="px-1">Result</th></tr></thead>
          <tbody>{inv.products.map(function (r) {
            var f = r.figures || {}; var ok = PASS_OUTCOMES.indexOf(r.outcome) >= 0;
            return <tr key={r.item_key} style={{ borderTop: '1px solid ' + LINE }}>
              <td className="px-1">{r.product_label || '—'}</td>
              <td className="px-1 text-right">{f.billed != null ? num(f.billed) + ' ' + (f.unit || '') : '—'}</td>
              <td className="px-1 text-right">{f.received != null ? num(f.received) + ' ' + (f.unit || '') : '—'}</td>
              <td className="px-1 text-right" style={{ color: f.diff < 0 ? RED : INK, fontWeight: 700 }}>{f.diff != null ? (f.diff > 0 ? '+' : '') + num(f.diff) + (f.pct != null ? ' (' + (f.pct > 0 ? '+' : '') + f.pct + '%)' : '') : '—'}</td>
              <td className="px-1 font-extrabold" style={{ color: ok ? GREEN : RED }}>{(ok ? 'PASS' : 'REVIEW') + ' · ' + (r.outcome_words || r.outcome) + (r.state && DONE_STATES.indexOf(r.state) >= 0 ? ' · ' + (r.state_words || r.state) : r.state === 'issue_open' ? ' · disputed' : '')}</td>
            </tr>;
          })}</tbody></table> : null}
        {!inv.pass && inv.why.length ? <div className="text-[11px] mt-1 font-bold" style={{ color: RED }}>{'Why REVIEW: ' + inv.why.slice(0, 4).join(' · ')}</div> : null}
        {linkRow ? <LinkChooser item={linkRow} perms={perms} onLink={function (l) { setBusy(inv.key); wcApi(Object.assign({ action: 'link', bill_id: inv.bills[0].id }, l)).then(function (j) { setBusy(''); if (!j || !j.ok) { say(props.toast, (j && j.error) || 'Not saved.', 'error'); } load(false); }); }} /> : null}
        {canDecide && (perms.validate || perms.accept) ? <div className="flex flex-wrap gap-2 items-center mt-2">
          <input value={reasons[inv.key] || ''} onChange={function (e) { var o = Object.assign({}, reasons); o[inv.key] = e.target.value; setReasons(o); }} placeholder={inv.pass ? 'Note (optional)' : 'Why — required to approve a REVIEW or to dispute'} className={inp + ' flex-1'} style={{ minWidth: 220 }} />
          <button disabled={busy === inv.key} onClick={function () { decideAll(inv, 'approve'); }} className="px-4 py-1.5 rounded-lg font-black text-[13px]" style={{ background: GREEN, color: '#ffffff', opacity: busy === inv.key ? 0.6 : 1 }}>Approved</button>
          <button disabled={busy === inv.key} onClick={function () { decideAll(inv, 'dispute'); }} className="px-4 py-1.5 rounded-lg font-black text-[13px]" style={{ background: RED, color: '#ffffff', opacity: busy === inv.key ? 0.6 : 1 }}>Disputed</button>
        </div> : null}
        {inv.approved || inv.disputed ? <div className="text-[11px] mt-1" style={{ color: SUB }}>{inv.rows.filter(function (r) { return r.decision; }).slice(0, 1).map(function (r) { return 'Decided by ' + r.decision.actor_name + ' · ' + when(r.decision.at) + ' — “' + r.decision.reason + '”'; }).join('')}</div> : null}
      </div>;
    })}
  </div>;
}
