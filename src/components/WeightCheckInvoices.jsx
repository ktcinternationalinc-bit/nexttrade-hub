// Bills → 🏭 Warehouse check → "Invoices" — the dashboard Max works from (v55.83-YX, redesigned ZA 25 Nov 2026).
// Max: "for each invoice [the] breakdown and comparison and a PASS green or a REVIEW in red … for nexpac and any selected vendor,
// and an approved or disputed button" · "where is the tolerance … where are the other vendors to select" · "where do we do the
// mappings … we need to be able to handle these things" · "user friendly and professional looking dashboard".
// One card per invoice: every product billed vs scanned in, the difference and the result. When exactly one warehouse receipt carries
// the bill's reference the comparison is shown straight away as a PREVIEW; "Approved" first confirms that receipt (a person, never
// silently), then records the decisions. Lines without a product mapping can be mapped right on the card. Tolerance and vendors are
// set at the top. Read-only towards bills, payments, inventory and the warehouse; every action is audited.
import React, { useState, useEffect } from 'react';
import { wcApi, say, num, when, LinkChooser } from './WarehouseCheckBox';

var INK = '#0f172a'; var SUB = '#475569'; var MUTED = '#64748b'; var LINE = '#e2e8f0'; var SOFT = '#f8fafc';
var GREEN = '#15803d'; var RED = '#b91c1c'; var AMBER = '#b45309'; var BLUE = '#1d4ed8';
var PASS_OUTCOMES = ['matched', 'equal'];
var DONE_STATES = ['validated', 'accepted', 'resolved'];
// explicit colours: the Hub's dark theme must never make these boxes unreadable (Max 25 Nov "you can't see the fonts")
var FIELD = { background: '#ffffff', color: INK, border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', fontSize: 13, lineHeight: '18px' };
var LABEL = { display: 'block', fontSize: 11, fontWeight: 700, color: SUB, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 };
function btn(bg, fg, outline) { return { background: outline ? '#ffffff' : bg, color: outline ? bg : fg, border: '1px solid ' + bg, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }; }
function pill(color, bg) { return { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', color: color, background: bg, border: '1px solid ' + color }; }

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
    // product comparisons AND billed lines that cannot be compared yet (e.g. no product mapping) — both belong in the table
    var products = g.rows.filter(function (r) { return r.kind === 'product' || r.kind === 'line'; });
    var linkRow = g.rows.filter(function (r) { return r.needs_link || r.outcome === 'no_receipt'; })[0] || null;
    var previewed = products.some(function (r) { return r.preview; });
    // the "confirm the receipt" line is not a REVIEW reason when its comparison is already shown as a preview
    var others = g.rows.filter(function (r) { return r.kind !== 'product' && r.kind !== 'line' && r.outcome !== 'warehouse_only' && !(previewed && r === linkRow); });
    var pass = products.length > 0 && others.length === 0 && products.every(function (r) { return PASS_OUTCOMES.indexOf(r.outcome) >= 0; });
    var decidable = g.rows.filter(function (r) { return r.needs_decision; });
    var approved = !previewed && decidable.length === 0 && g.rows.some(function (r) { return DONE_STATES.indexOf(r.state) >= 0; }) && !g.rows.some(function (r) { return r.state === 'issue_open'; });
    var disputed = g.rows.some(function (r) { return r.state === 'issue_open'; });
    var why = [];
    g.rows.forEach(function (r) { if (previewed && r === linkRow) { return; } if (r.kind === 'warehouse_only' || r.outcome === 'warehouse_only') { return; } if ((r.kind !== 'product' && r.kind !== 'line') || PASS_OUTCOMES.indexOf(r.outcome) < 0) { (r.reasons && r.reasons.length ? r.reasons : [r.outcome_words || r.outcome]).forEach(function (w) { if (w && why.indexOf(w) < 0) { why.push(w); } }); } });
    // Codex 25 Nov: bills sharing one receipt are compared TOGETHER — the result is the group's, never each invoice's on its own.
    var shared = (g.bills || []).length > 1;
    var perBill = (g.bills || []).map(function (b) {
      var lines = []; products.forEach(function (r) { (r.bill_lines || []).forEach(function (ln) { if (ln.bill_id === b.id) { lines.push({ product: r.product_label || ln.description, qty: ln.qty, unit: ln.unit }); } }); });
      return { id: b.id, bill_number: b.bill_number, vendor: b.vendor, bill_date: b.bill_date, reference: b.reference, lines: lines };
    });
    return { key: k, bills: g.bills, rows: g.rows, products: products, others: others, pass: pass, approved: approved, disputed: disputed, why: why, shared: shared, perBill: perBill,
      linkRow: linkRow, previewed: previewed, proposed: previewed ? (products.filter(function (r) { return r.preview; })[0].proposed_receipt || null) : null };
  });
}

export default function WeightCheckInvoices(props) {
  var dr = lastDays(60);
  var _f = useState({ date_from: dr[0], date_to: dr[1] }); var flt = _f[0], setFlt = _f[1];
  var _d = useState(null); var data = _d[0], setData = _d[1];
  var _s = useState(null); var cfg = _s[0], setCfg = _s[1];
  var _b = useState(''); var busy = _b[0], setBusy = _b[1];
  var _r = useState({}); var reasons = _r[0], setReasons = _r[1];
  var _o = useState(''); var only = _o[0], setOnly = _o[1];
  var _t = useState(''); var tolPct = _t[0], setTolPct = _t[1];
  var _v = useState(null); var vendorEdit = _v[0], setVendorEdit = _v[1];
  var _m = useState({}); var mapEdit = _m[0], setMapEdit = _m[1];

  function loadCfg() { return wcApi({ action: 'settings_view' }).then(function (j) { setCfg(j); return j; }); }
  useEffect(function () { loadCfg(); }, []);
  function load(recheck) {
    setBusy(recheck ? 'recheck' : 'load');
    return wcApi({ action: 'report_preview', date_from: flt.date_from, date_to: flt.date_to, all: true, recheck: !!recheck }).then(function (j) { setBusy(''); setData(j); return j; });
  }
  var perms = (cfg && cfg.permissions) || (data && data.permissions) || {};
  var tol = cfg && cfg.ok ? (cfg.tolerances || [])[0] || null : null;
  var scope = (cfg && cfg.scope) || (data && data.scope) || null;
  var L = (cfg && cfg.lookups) || {};
  var invoices = data && data.ok ? groupInvoices(data.rows) : [];
  var shown = invoices.filter(function (v) { return !only || (only === 'review' ? !v.pass && !v.approved && !v.disputed : only === 'pass' ? v.pass && !v.approved : only === 'open' ? !v.approved && !v.disputed : true); });
  var counts = { all: invoices.length, pass: invoices.filter(function (v) { return v.pass && !v.approved && !v.disputed; }).length, review: invoices.filter(function (v) { return !v.pass && !v.approved && !v.disputed; }).length, approved: invoices.filter(function (v) { return v.approved; }).length, disputed: invoices.filter(function (v) { return v.disputed; }).length };

  function saveTolerance() {
    var pct = Number(tolPct); if (!(pct >= 0 && pct <= 100)) { say(props.toast, 'Type the tolerance as a percent, e.g. 10.', 'error'); return; }
    setBusy('tol');
    wcApi({ action: 'tolerance_save', pct: pct, lb: '', note: 'Set on the Invoices dashboard: a bill may be up to ' + pct + '% below what was scanned, never above' }).then(function (j) { setBusy(''); if (!j || !j.ok) { say(props.toast, (j && j.error) || 'Not saved.', 'error'); return; } say(props.toast, 'Tolerance saved: ' + pct + '%', 'success'); setTolPct(''); loadCfg().then(function () { if (data) { load(false); } }); });
  }
  function saveVendors() {
    var names = Object.keys(vendorEdit || {}).filter(function (k) { return !!vendorEdit[k]; }).map(function (k) { return vendorEdit[k]; });
    setBusy('vendors');
    wcApi({ action: 'scope_save', vendor_names: names }).then(function (j) { setBusy(''); if (!j || !j.ok) { say(props.toast, (j && j.error) || 'Not saved.', 'error'); return; } say(props.toast, 'Vendors saved: ' + j.scope.vendor_names.join(', '), 'success'); setVendorEdit(null); loadCfg(); });
  }
  function openVendors() { var o = {}; ((scope && scope.vendor_keys) || []).forEach(function (k, i) { o[k] = (scope.vendor_names || [])[i] || k; }); setVendorEdit(o); }
  function saveMapping(inv, r) {
    var e = mapEdit[r.item_key] || {}; var bl = r.bill_line || ((r.bill_lines || [])[0]) || {};
    if (!e.wh_product_type && !e.wh_cgt) { say(props.toast, 'Choose the warehouse product (and grade if it has one).', 'error'); return; }
    setBusy(r.item_key);
    wcApi({ action: 'map_save', vendor_name: inv.bills[0].vendor, bill_description: bl.description, bill_unit: bl.unit || '', wh_product_type: e.wh_product_type || '', wh_cgt: e.wh_cgt || '', wh_nt: '', wh_color: '', wh_label: [L.product_types && L.product_types[e.wh_product_type], L.cgt_grades && L.cgt_grades[e.wh_cgt]].filter(Boolean).join(' · ') })
      .then(function (j) { setBusy(''); if (!j || !j.ok) { say(props.toast, (j && j.error) || 'Not saved.', 'error'); return; } say(props.toast, 'Mapping saved — ' + bl.description, 'success'); var o = Object.assign({}, mapEdit); delete o[r.item_key]; setMapEdit(o); load(false); });
  }

  async function confirmPreview(inv) {
    var c = inv.proposed || (inv.linkRow && (inv.linkRow.candidates || [])[0]);
    if (!c) { return null; }
    var j = await wcApi({ action: 'link', bill_id: inv.bills[0].id, receipt_id: c.receipt_id, basis: (c.bases || [])[0], bill_value: c.bill_value, receipt_value: c.receipt_value, state: 'confirmed' });
    if (!j || !j.ok) { say(props.toast, (j && j.error) || 'The receipt could not be confirmed.', 'error'); return null; }
    var fresh = await load(false);
    var again = groupInvoices((fresh && fresh.rows) || []).filter(function (v) { return v.bills.some(function (b) { return b.id === inv.bills[0].id; }); })[0];
    return again || null;
  }
  async function decideAll(inv0, mode) {
    var inv = inv0;
    var reason = String(reasons[inv.key] || '').trim();
    if (mode === 'approve' && !inv.pass && reason.length < 5) { say(props.toast, 'This invoice is REVIEW — write why you approve it anyway (at least a few words).', 'error'); return; }
    if (mode === 'dispute' && reason.length < 5) { say(props.toast, 'Write what is wrong (at least a few words) before disputing.', 'error'); return; }
    if (mode === 'approve' && inv.pass && reason.length < 5) { reason = 'Approved: billed vs scanned within the approved tolerance'; }
    setBusy(inv.key);
    if (inv.previewed) { var conf = await confirmPreview(inv); if (!conf) { setBusy(''); return; } inv = conf; }
    var todo = inv.rows.filter(function (r) { return r.needs_decision; });
    if (!todo.length) { setBusy(''); say(props.toast, 'Nothing left to decide on this invoice.', 'error'); return; }
    var blocked = todo.filter(function (r) { var a = r.allowed || []; return mode === 'dispute' ? a.indexOf('report_issue') < 0 : (a.indexOf('validate_match') < 0 && a.indexOf('accept_discrepancy') < 0); });
    if (blocked.length) { setBusy(''); say(props.toast, 'Not possible yet: ' + blocked.map(function (r) { return r.product_label || r.outcome_words || r.outcome; }).join(', ') + ' — see the note on the card.', 'error'); return; }
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

  function MapForm(p) {
    var r = p.row; var e = mapEdit[r.item_key] || {};
    function setE(k, v) { var o = Object.assign({}, mapEdit); o[r.item_key] = Object.assign({}, e); o[r.item_key][k] = v; setMapEdit(o); }
    var pts = L.product_types || {}; var cgts = L.cgt_grades || {};
    if (!perms.settings) { return <div style={{ fontSize: 12, color: MUTED }}>No product mapping yet — someone with “Warehouse check: Settings” maps it.</div>; }
    return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginTop: 6, padding: 8, background: SOFT, border: '1px dashed #cbd5e1', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: SUB, width: '100%' }}>{'Map “' + (((r.bill_line || (r.bill_lines || [])[0]) || {}).description || 'this product') + '” to the warehouse product it is scanned as:'}</div>
      <label><span style={LABEL}>Warehouse product</span><select value={e.wh_product_type || ''} onChange={function (ev) { setE('wh_product_type', ev.target.value); }} style={FIELD}><option value="">choose…</option>{Object.keys(pts).map(function (id) { return <option key={id} value={id}>{pts[id]}</option>; })}</select></label>
      <label><span style={LABEL}>Grade (CGT)</span><select value={e.wh_cgt || ''} onChange={function (ev) { setE('wh_cgt', ev.target.value); }} style={FIELD}><option value="">any grade</option>{Object.keys(cgts).map(function (id) { return <option key={id} value={id}>{cgts[id]}</option>; })}</select></label>
      <button disabled={busy === r.item_key} onClick={function () { saveMapping(p.inv, r); }} style={btn(INK, '#ffffff')}>{busy === r.item_key ? 'Saving…' : 'Save mapping'}</button>
    </div>;
  }

  var tile = { flex: '1 1 220px', background: '#ffffff', border: '1px solid ' + LINE, borderRadius: 12, padding: 12 };
  return <div style={{ color: INK, fontSize: 13 }}>
    {/* controls */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <label><span style={LABEL}>Bill date from</span><input type="date" value={flt.date_from} onChange={function (e) { setFlt(Object.assign({}, flt, { date_from: e.target.value })); }} style={FIELD} /></label>
      <label><span style={LABEL}>to</span><input type="date" value={flt.date_to} onChange={function (e) { setFlt(Object.assign({}, flt, { date_to: e.target.value })); }} style={FIELD} /></label>
      <button disabled={!!busy} onClick={function () { load(true); }} style={Object.assign(btn(BLUE, '#ffffff'), { opacity: busy ? 0.6 : 1 })}>{busy === 'recheck' ? 'Reading the warehouse…' : 'Check against the warehouse'}</button>
      <button disabled={!!busy} onClick={function () { load(false); }} style={btn('#334155', '#ffffff', true)}>{busy === 'load' ? 'Loading…' : 'Show (last reading)'}</button>
    </div>

    {/* settings strip: tolerance · vendors · last reading */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
      <div style={tile}>
        <span style={LABEL}>Tolerance</span>
        {tol ? <div style={{ fontSize: 16, fontWeight: 800 }}>{(tol.pct != null ? tol.pct + '%' : '') + (tol.lb != null ? (tol.pct != null ? ' or ' : '') + tol.lb + ' lb' : '')}</div> : <div style={{ fontSize: 15, fontWeight: 800, color: AMBER }}>Not set</div>}
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>A bill may be BELOW what was scanned by up to this much. A bill ABOVE what was scanned is never allowed.</div>
        {perms.super_admin ? <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}><input value={tolPct} onChange={function (e) { setTolPct(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder={tol && tol.pct != null ? String(tol.pct) : '10'} style={Object.assign({}, FIELD, { width: 70 })} /><span style={{ color: SUB }}>%</span><button disabled={busy === 'tol' || !tolPct} onClick={saveTolerance} style={Object.assign(btn(INK, '#ffffff'), { opacity: tolPct ? 1 : 0.5 })}>{tol ? 'Change' : 'Set tolerance'}</button></div> : null}
      </div>
      <div style={tile}>
        <span style={LABEL}>Vendors checked</span>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{scope ? (scope.vendor_names || []).join(', ') : 'NexPac Corporation'}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>NexPac is always checked. Other vendors are added here.</div>
        {perms.super_admin && !vendorEdit ? <button onClick={openVendors} style={Object.assign(btn(INK, '#ffffff', true), { marginTop: 8 })}>Change vendors</button> : null}
        {vendorEdit ? <div style={{ marginTop: 8 }}>
          {scope && scope.table_missing ? <div style={{ fontSize: 12, color: AMBER, marginBottom: 6 }}>Adding vendors needs the one-time SQL (sql/v55-83-YX-wc-vendor-scope.sql) — ask Claude for it.</div> : null}
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid ' + LINE, borderRadius: 8, padding: 6, background: '#ffffff' }}>
            {((cfg && cfg.vendor_choices) || []).map(function (v) { var always = v.key === 'nexpac'; var on = always || !!vendorEdit[v.key]; return <label key={v.key} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', color: INK }}><input type="checkbox" checked={on} disabled={always} onChange={function (e) { var o = Object.assign({}, vendorEdit); o[v.key] = e.target.checked ? v.name : false; setVendorEdit(o); }} />{v.name}<span style={{ color: MUTED }}>{' · ' + v.bills + ' bills' + (always ? ' · always' : '')}</span></label>; })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><button disabled={busy === 'vendors'} onClick={saveVendors} style={btn(INK, '#ffffff')}>Save vendors</button><button onClick={function () { setVendorEdit(null); }} style={btn('#334155', '#ffffff', true)}>Cancel</button></div>
        </div> : null}
      </div>
      <div style={tile}>
        <span style={LABEL}>Warehouse reading</span>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{data && data.feed && data.feed.last_good ? when(data.feed.last_good.finished_at || data.feed.last_good.started_at) : (data ? 'not read yet' : '—')}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{data && data.feed ? (data.feed.staging ? 'TEST copy of the warehouse' : 'LIVE warehouse') + (data.freshness ? ' · ' + data.freshness.words : '') : 'Press “Check against the warehouse” to read it.'}</div>
        {data && data.ok && data.feed && data.feed.feed_error ? <div style={{ fontSize: 12, color: RED, marginTop: 4, fontWeight: 700 }}>{'Not read: ' + data.feed.feed_error}</div> : null}
      </div>
    </div>

    {data && !data.ok ? <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#fef2f2', color: RED, fontWeight: 700 }}>{data.error || 'Could not load.'}</div> : null}

    {/* summary + filters */}
    {data && data.ok ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, alignItems: 'center' }}>
      {[['', 'All', counts.all, INK], ['open', 'Not decided', counts.pass + counts.review, SUB], ['review', 'REVIEW', counts.review, RED], ['pass', 'PASS', counts.pass, GREEN]].map(function (x) {
        var on = only === x[0];
        return <button key={x[0]} onClick={function () { setOnly(x[0]); }} style={{ background: on ? x[3] : '#ffffff', color: on ? '#ffffff' : x[3], border: '1px solid ' + x[3], borderRadius: 999, padding: '5px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{x[1] + '  ' + x[2]}</button>;
      })}
      <span style={{ color: SUB, fontSize: 13 }}>{counts.approved + ' approved · ' + counts.disputed + ' disputed'}</span>
    </div> : null}
    {!data ? <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: SOFT, color: SUB, border: '1px solid ' + LINE }}>Choose the bill dates and press <b>Check against the warehouse</b>. Every invoice of the vendors above gets a card: each product billed vs scanned in, the difference, PASS or REVIEW, and Approved / Disputed.</div> : null}
    {data && data.ok && !invoices.length ? <div style={{ marginTop: 16, color: SUB }}>No invoices from these vendors in these dates.</div> : null}

    {/* one card per invoice */}
    {shown.map(function (inv) {
      var head = inv.bills.map(function (b) { return (b.vendor || '') + ' · Bill ' + (b.bill_number || '') + ' · ' + (b.bill_date || '') + (b.reference ? ' · ref ' + b.reference : ''); }).join('  +  ');
      var badge = inv.approved ? ['APPROVED', GREEN, '#dcfce7'] : inv.disputed ? ['DISPUTED', RED, '#fee2e2'] : inv.pass ? ['PASS', GREEN, '#dcfce7'] : ['REVIEW', RED, '#fee2e2'];
      var badgeText = badge[0] + (inv.shared ? ' · group of ' + inv.bills.length + ' invoices' : '');
      var receipts = []; inv.rows.forEach(function (r) { (r.receipts || []).forEach(function (x) { var t = 'Receipt ' + (x.reference_number || x.id) + (x.warehouse ? ' · ' + x.warehouse : '') + (x.receipt_date ? ' · received ' + String(x.receipt_date).substring(0, 10) : ''); if (receipts.indexOf(t) < 0) { receipts.push(t); } }); });
      var canDecide = inv.previewed || inv.rows.some(function (r) { return r.needs_decision; });
      return <div key={inv.key} style={{ marginTop: 12, background: '#ffffff', border: '1px solid ' + LINE, borderLeft: '5px solid ' + badge[1], borderRadius: 12, padding: 14, boxShadow: '0 1px 2px rgba(15,23,42,0.06)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={pill(badge[1], badge[2])}>{badgeText}</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{head}</span>
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{receipts.length ? receipts.join('   ·   ') : 'No warehouse receipt linked yet'}</div>
        {inv.previewed && inv.proposed ? <div style={{ fontSize: 12, marginTop: 8, padding: '6px 10px', borderRadius: 8, background: '#eff6ff', color: '#1e3a8a', border: '1px solid #bfdbfe' }}>{'Matched by reference to warehouse receipt ' + (inv.proposed.reference_number || inv.proposed.receipt_id) + ' (' + inv.proposed.bill_value + ' = ' + inv.proposed.receipt_value + '). Shown for review — pressing Approved confirms this receipt belongs to the bill.'}</div> : null}
        {inv.shared ? <div style={{ fontSize: 12, marginTop: 8, padding: '6px 10px', borderRadius: 8, background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' }}>{'These ' + inv.bills.length + ' invoices share the same warehouse receipt, so they are compared TOGETHER: ' + badge[0] + ' is the result for the group, not for each invoice on its own. What each invoice billed is listed below.'}</div> : null}

        {inv.products.length ? <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: SOFT, color: SUB, textAlign: 'left' }}>
            <th style={{ padding: '6px 8px', fontWeight: 700 }}>Product</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Billed</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Scanned in</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Difference</th><th style={{ padding: '6px 8px' }}>Result</th>
          </tr></thead>
          <tbody>{inv.products.map(function (r) {
            var f = r.figures || {}; var ok = PASS_OUTCOMES.indexOf(r.outcome) >= 0; var bl = r.bill_line || (r.bill_lines || [])[0] || {};
            return <React.Fragment key={r.item_key}><tr style={{ borderTop: '1px solid ' + LINE }}>
              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.product_label || bl.description || '—'}{r.product_label && bl.description && r.product_label !== bl.description ? <div style={{ fontSize: 11, color: MUTED, fontWeight: 400 }}>{'billed as ' + bl.description}</div> : null}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.billed != null ? num(f.billed) + ' ' + (f.unit || '') : (bl.qty != null ? num(bl.qty) + ' ' + (bl.unit || '') : '—')}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.received != null ? num(f.received) + ' ' + (f.unit || '') : '—'}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: f.diff < 0 ? RED : INK, fontWeight: 700 }}>{f.diff != null ? (f.diff > 0 ? '+' : '') + num(f.diff) + (f.pct != null ? '  (' + (f.pct > 0 ? '+' : '') + f.pct + '%)' : '') : '—'}</td>
              <td style={{ padding: '7px 8px' }}><span style={pill(ok ? GREEN : RED, ok ? '#f0fdf4' : '#fef2f2')}>{ok ? 'PASS' : 'REVIEW'}</span><span style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>{r.outcome_words || r.outcome}{r.state && DONE_STATES.indexOf(r.state) >= 0 ? ' · ' + (r.state_words || r.state) : r.state === 'issue_open' ? ' · disputed' : ''}</span></td>
            </tr>
            {r.needs_mapping ? <tr><td colSpan={5} style={{ padding: '0 8px 8px' }}>{MapForm({ row: r, inv: inv })}</td></tr> : null}
            </React.Fragment>;
          })}</tbody></table> : null}

        {inv.shared ? <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ color: SUB, textAlign: 'left' }}><th style={{ padding: '4px 8px' }}>Invoice</th><th style={{ padding: '4px 8px' }}>Billed on this invoice</th><th style={{ padding: '4px 8px' }}>Status</th></tr></thead><tbody>{inv.perBill.map(function (b) { return <tr key={b.id} style={{ borderTop: '1px solid ' + LINE }}><td style={{ padding: '4px 8px' }}>{(b.vendor || '') + ' · ' + (b.bill_number || '') + ' · ' + (b.bill_date || '')}</td><td style={{ padding: '4px 8px' }}>{b.lines.length ? b.lines.map(function (l) { return l.product + ': ' + num(l.qty) + ' ' + (l.unit || ''); }).join(' · ') : '—'}</td><td style={{ padding: '4px 8px', color: MUTED }}>part of the group result — not verified on its own</td></tr>; })}</tbody></table> : null}

        {!inv.pass && inv.why.length ? <div style={{ fontSize: 12, marginTop: 8, color: RED, fontWeight: 600 }}>{'Why REVIEW: ' + inv.why.slice(0, 4).join(' · ')}</div> : null}
        {inv.linkRow && !inv.previewed ? <div style={{ marginTop: 8 }}><LinkChooser item={inv.linkRow} perms={perms} onLink={function (l) { setBusy(inv.key); wcApi(Object.assign({ action: 'link', bill_id: inv.bills[0].id }, l)).then(function (j) { setBusy(''); if (!j || !j.ok) { say(props.toast, (j && j.error) || 'Not saved.', 'error'); } load(false); }); }} /></div> : null}

        {canDecide && (perms.validate || perms.accept) && !inv.approved && !inv.disputed ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid ' + LINE }}>
          <input value={reasons[inv.key] || ''} onChange={function (e) { var o = Object.assign({}, reasons); o[inv.key] = e.target.value; setReasons(o); }} placeholder={inv.pass ? 'Note (optional)' : 'Reason — needed to approve a REVIEW or to dispute'} style={Object.assign({}, FIELD, { flex: '1 1 260px' })} />
          <button disabled={busy === inv.key} onClick={function () { decideAll(inv, 'approve'); }} style={Object.assign(btn(GREEN, '#ffffff'), { opacity: busy === inv.key ? 0.6 : 1 })}>Approved</button>
          <button disabled={busy === inv.key} onClick={function () { decideAll(inv, 'dispute'); }} style={Object.assign(btn(RED, '#ffffff'), { opacity: busy === inv.key ? 0.6 : 1 })}>Disputed</button>
        </div> : null}
        {inv.approved || inv.disputed ? <div style={{ fontSize: 12, marginTop: 8, color: SUB }}>{inv.rows.filter(function (r) { return r.decision; }).slice(0, 1).map(function (r) { return 'Decided by ' + r.decision.actor_name + ' · ' + when(r.decision.at) + ' — “' + r.decision.reason + '”'; }).join('')}</div> : null}
      </div>;
    })}
  </div>;
}
