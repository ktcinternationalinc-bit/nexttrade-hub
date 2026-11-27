// Bills → 🏭 Warehouse check → "Invoices" — the dashboard Max works from (v55.83-YX, redesigned ZA 25 Nov 2026).
// Max: "for each invoice [the] breakdown and comparison and a PASS green or a REVIEW in red … for nexpac and any selected vendor,
// and an approved or disputed button" · "where is the tolerance … where are the other vendors to select" · "where do we do the
// mappings … we need to be able to handle these things" · "user friendly and professional looking dashboard".
// One card per invoice: every product billed vs scanned in, the difference and the result. When exactly one warehouse receipt carries
// the bill's reference the comparison is shown straight away as a PREVIEW; "Approved" first confirms that receipt (a person, never
// silently), then records the decisions. Lines without a product mapping can be mapped right on the card. Tolerance and vendors are
// set at the top. Read-only towards bills, payments, inventory and the warehouse; every action is audited.
import React, { useState, useEffect } from 'react';
import { wcApi, say, num, when, LinkChooser, warehouseMappingLabel } from './WarehouseCheckBox';
import { vendorKey, billItemKey } from '../lib/weight-check';

var INK = '#0f172a'; var SUB = '#475569'; var MUTED = '#64748b'; var LINE = '#e2e8f0'; var SOFT = '#f8fafc';
var GREEN = '#15803d'; var RED = '#b91c1c'; var AMBER = '#b45309'; var BLUE = '#1d4ed8';
var PASS_OUTCOMES = ['matched', 'equal'];
var DONE_STATES = ['validated', 'accepted', 'resolved'];
// explicit colours: the Hub's dark theme must never make these boxes unreadable (Max 25 Nov "you can't see the fonts")
var FIELD = { background: '#ffffff', color: INK, border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', fontSize: 13, lineHeight: '18px' };
var LABEL = { display: 'block', fontSize: 11, fontWeight: 700, color: SUB, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 };
function btn(bg, fg, outline) { return { background: outline ? '#ffffff' : bg, color: outline ? bg : fg, border: '1px solid ' + bg, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }; }
function pill(color, bg) { return { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', color: color, background: bg, border: '1px solid ' + color }; }

// v55.83-ZL (Max 26 Nov: "default to each bill check to be closed with a pass or fail showing..user can click on drill down"):
// the status block of a COLLAPSED card — the real state, never dressed up as a pass. Approved Hub look: solid block, black text.
var Z_GREEN = '#22c55e'; var Z_RED = '#ef4444'; var Z_AMBER = '#f59e0b'; var Z_BLUE = '#3b82f6'; var Z_GREY = '#a3a3a3'; var Z_GOLD = '#facc15';
var NOT_COMPARED = { cannot_compare: 1, warehouse_unavailable: 1, limited_access: 1, mapping_conflict: 1, no_receipt: 1 };
export function cardStatus(inv) {
  var rows = (inv && inv.rows) || []; var prods = (inv && inv.products) || [];
  function why() { return ((inv && inv.why) || [])[0] || null; }
  if (inv.disputed) { return { key: 'disputed', label: 'DISPUTED', bg: Z_RED, why: 'an issue was reported' }; }
  if (rows.some(function (r) { return r.state === 'needs_revalidation'; })) { return { key: 'recheck', label: 'RECHECK', bg: Z_AMBER, why: 'the figures changed after it was decided — decide again' }; }
  if (inv.approved) { return rows.some(function (r) { return r.state === 'accepted'; }) ? { key: 'accepted', label: 'ACCEPTED', bg: Z_AMBER, why: 'a difference was accepted (it did not pass)' } : { key: 'approved', label: 'APPROVED', bg: Z_GREEN, why: 'checked and approved' }; }
  if (inv.previewed) { return { key: 'confirm', label: 'CONFIRM RECEIPT', bg: Z_BLUE, why: 'preview ' + (inv.pass ? 'within tolerance' : 'not within tolerance') + ' — a person confirms the warehouse receipt first' }; }
  if (rows.some(function (r) { return r.provisional || r.outcome === 'incomplete'; })) { return { key: 'provisional', label: 'PROVISIONAL', bg: Z_AMBER, why: 'the warehouse receipt is still a draft' }; }
  if (prods.some(function (r) { return r.outcome === 'discrepancy' || r.outcome === 'product_missing'; })) { return { key: 'fail', label: 'FAIL', bg: Z_RED, why: why() }; }
  if (inv.pass) { return { key: 'pass', label: 'PASS', bg: Z_GREEN, why: null }; }
  return { key: 'not_checked', label: 'NOT CHECKED', bg: Z_GREY, why: why() || 'nothing could be compared yet' };
}
export function cardLine(inv) {
  var prods = ((inv && inv.products) || []).filter(function (r) { return r.figures && (r.figures.billed != null || r.figures.received != null); });
  var parts = prods.slice(0, 2).map(function (r) { var f = r.figures; return (r.product_label || 'product') + ': billed ' + (f.billed != null ? num(f.billed) + ' ' + (f.unit || '') : '—') + ' · warehouse ' + (f.received != null ? num(f.received) + ' ' + (f.unit || '') : '—'); });
  if (prods.length > 2) { parts.push('+' + (prods.length - 2) + ' more'); }
  return parts.join('   ·   ') || 'no product compared yet';
}
// Codex 26 Nov (ZL hold): with a wire, count ONLY the wire's own bills (a related bill sharing the receipt is context, not counted)
// v55.83-ZS (Max 27 Nov: "if something is full passing then there should be a status of Pass or Fail or Review in the top layer near
// confirm receipt"): the MAIN block is always what the comparison says — PASS, FAIL, or REVIEW (anything not clearly pass or fail).
// Confirm receipt / provisional / approved / accepted / disputed / recheck are a SECOND tag beside it (cardTags), never the result.
export function cardResult(inv) {
  var prods = (inv && inv.products) || [];
  if (prods.some(function (r) { return r.outcome === 'discrepancy' || r.outcome === 'product_missing'; })) { return { key: 'fail', label: 'FAIL', bg: Z_RED, why: ((inv && inv.why) || [])[0] || 'billed and warehouse do not agree within the tolerance' }; }
  if (inv && inv.pass) { return { key: 'pass', label: 'PASS', bg: Z_GREEN, why: null }; }
  var why = ((inv && inv.why) || [])[0] || null;
  if ((inv && inv.rows || []).some(function (r) { return r.provisional || r.outcome === 'incomplete'; })) { why = 'the warehouse receipt is still a draft — the figures may still change'; }
  return { key: 'review', label: 'REVIEW', bg: Z_AMBER, why: why || 'nothing could be compared yet' };
}
export function cardTags(inv) {
  var rows = (inv && inv.rows) || []; var tags = [];
  if (inv.disputed) { tags.push({ key: 'disputed', label: 'DISPUTED', color: Z_RED, why: 'an issue was reported' }); }
  if (rows.some(function (r) { return r.state === 'needs_revalidation'; })) { tags.push({ key: 'recheck', label: 'RECHECK', color: Z_AMBER, why: 'the figures changed after it was decided — decide again' }); }
  if (inv.approved) { tags.push(rows.some(function (r) { return r.state === 'accepted'; }) ? { key: 'accepted', label: 'ACCEPTED', color: Z_AMBER, why: 'a difference was accepted (it did not pass)' } : { key: 'approved', label: 'APPROVED', color: Z_GREEN, why: 'checked and approved' }); }
  if (inv.previewed) { tags.push({ key: 'confirm', label: 'CONFIRM RECEIPT', color: Z_BLUE, why: 'matched by reference — a person confirms the warehouse receipt before it can be approved' }); }
  if (rows.some(function (r) { return r.provisional || r.outcome === 'incomplete'; })) { tags.push({ key: 'provisional', label: 'PROVISIONAL', color: Z_AMBER, why: 'the warehouse receipt is still a draft' }); }
  return tags;
}
// the wire tally counts by RESULT (PASS / FAIL / REVIEW) and only the wire's own bills (Codex 26 Nov)
export function wireTally(invs, wireBillIds) {
  // Codex 27 Nov (ZS hold): the result counts alone hid what is still pending — count the workflow tags too (same bills)
  var t = { bills: 0, pass: 0, fail: 0, review: 0, waiting: { confirm: 0, recheck: 0, disputed: 0, provisional: 0 }, decided: { approved: 0, accepted: 0 }, to_decide: 0 };
  (invs || []).forEach(function (inv) {
    var k = cardResult(inv).key; var bs = (inv.bills || []).filter(function (b) { return !wireBillIds || wireBillIds.indexOf(b.id) >= 0; }); var n = wireBillIds ? bs.length : (bs.length || 1); if (!n) { return; }
    t.bills += n; t[k] += n;
    var tagsW = cardTags(inv); var hasWaitTag = false;
    tagsW.forEach(function (tg) { if (t.waiting[tg.key] != null) { t.waiting[tg.key] += n; hasWaitTag = true; } else if (t.decided[tg.key] != null) { t.decided[tg.key] += n; } });
    // Codex 27 Nov (ZS rev3): a bill not yet approved / disputed (unreviewed, reopened, no receipt, …) is still open work — never "final"
    if (!hasWaitTag && (inv.rows || []).some(function (r) { return r.outstanding === true || r.needs_decision === true; })) { t.to_decide += n; }
  });
  return t;
}
// the words of the wire summary (rendered by WireSummaryBar; tested as rendered text)
export function wireWaitingWords(t, W) {
  var w = t.waiting; var parts = []; W = W || {};
  if (t.to_decide) { parts.push(t.to_decide + ' to DECIDE (approve or dispute)'); }
  if (t.review) { parts.push(t.review + ' REVIEW — not compared yet'); }
  if (w.confirm) { parts.push(w.confirm + ' to CONFIRM RECEIPT'); }
  if (w.recheck) { parts.push(w.recheck + ' to RECHECK'); }
  if (w.disputed) { parts.push(w.disputed + ' DISPUTED'); }
  if (w.provisional) { parts.push(w.provisional + ' PROVISIONAL (draft receipt)'); }
  if (W.hidden_count) { parts.push(W.hidden_count + ' outside your access (not counted)'); }
  if ((W.out_of_scope || []).length || (W.no_lines || []).length) { parts.push(((W.out_of_scope || []).length + (W.no_lines || []).length) + ' not in the check (see below)'); }
  return parts;
}
// v55.83-ZL/ZS: the black wire bar — exported so it can be rendered on its own (tests, screenshots)
export function WireSummaryBar(props) {
  var W = props.wire; var t = wireTally(props.invoices || [], W.bill_ids || []); var waiting = wireWaitingWords(t, W);
  return <div data-testid="wire-summary" style={{ marginTop: 14, background: '#000000', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 2, padding: '10px 12px' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', color: '#a3a3a3' }}>WIRE</span>
      <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: Z_GOLD, fontWeight: 800 }}>{'#' + W.seq}</span>
      <span style={{ fontWeight: 800 }}>{W.payee || ''}</span>
      <span style={{ fontSize: 12, color: '#a3a3a3' }}>{String(W.status || '').replace(/_/g, ' ').toUpperCase()}</span>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
      <span style={{ fontWeight: 800 }}>{W.bills_on_wire + ' bill' + (W.bills_on_wire === 1 ? '' : 's') + ' on this wire'}</span>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', color: '#a3a3a3' }}>COMPARISON RESULTS (incl. receipts not yet confirmed):</span>
      <span style={zBlock(Z_GREEN)}>{t.pass + ' PASS'}</span><span style={zBlock(Z_RED)}>{t.fail + ' FAIL'}</span><span style={zBlock(Z_AMBER)}>{t.review + ' REVIEW'}</span>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', color: '#a3a3a3' }}>WAITING ON THIS WIRE:</span>
      {waiting.length ? waiting.map(function (w, i) { return <span key={i} style={zTag(Z_BLUE)}>{w}</span>; }) : <span style={{ fontSize: 12, color: '#d4d4d4' }}>nothing waiting — every bill on this wire was compared and decided</span>}
      {t.decided.approved || t.decided.accepted ? <span style={{ fontSize: 12, color: '#d4d4d4' }}>{'decided: ' + t.decided.approved + ' approved · ' + t.decided.accepted + ' accepted (a difference)'}</span> : null}
    </div>
    {(W.out_of_scope || []).length ? <div style={{ fontSize: 12, color: '#d4d4d4', marginTop: 6 }}>{'Not in the warehouse check (vendor not selected): ' + W.out_of_scope.map(function (b) { return (b.vendor || '') + ' ' + (b.bill_number || ''); }).join(' · ')}</div> : null}
    {(W.no_lines || []).length ? <div style={{ fontSize: 12, color: '#d4d4d4', marginTop: 4 }}>{'Nothing to compare (no product lines): ' + W.no_lines.map(function (b) { return (b.vendor || '') + ' ' + (b.bill_number || ''); }).join(' · ')}</div> : null}
    {W.hidden_count ? <div style={{ fontSize: 12, color: Z_AMBER, marginTop: 4 }}>{W.hidden_count + ' bill' + (W.hidden_count === 1 ? ' is' : 's are') + ' on this wire but outside what you may see — not shown, not counted as checked.'}</div> : null}
    {!props.tol ? <div style={{ fontSize: 12, color: Z_AMBER, marginTop: 4, fontWeight: 700 }}>No tolerance is approved yet, so only an exact match can PASS.</div> : null}
  </div>;
}
// the closed card's black bar — exported for the same reason
export function BillCardBar(props) {
  var inv = props.inv; var cs = cardResult(inv); var tags = cardTags(inv); var isOpen = !!props.isOpen; var outside = outsideWire(inv, props.wireIds || null);
  return <button type="button" data-testid="card-bar" onClick={props.onToggle} aria-expanded={isOpen} style={{ display: 'flex', width: '100%', flexWrap: 'wrap', gap: 10, alignItems: 'center', textAlign: 'left', background: '#000000', color: '#ffffff', border: 'none', borderBottom: isOpen ? '1px solid #3f3f46' : 'none', borderRadius: 0, padding: '9px 12px', cursor: 'pointer' }}>
    <span style={zBlock(cs.bg)}>{cs.label}</span>{tags.map(function (tg) { return <span key={tg.key} style={zTag(tg.color)}>{tg.label}</span>; })}
    <span style={{ fontWeight: 800 }}>{inv.bills.map(function (b) { return b.vendor || ''; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' + ')}</span>
    <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: Z_GOLD, fontWeight: 800 }}>{inv.bills.map(function (b) { return 'Bill ' + (b.bill_number || '') + (outside.indexOf(b) >= 0 ? ' (not on this wire)' : ''); }).join(' + ')}</span>
    {outside.length ? <span style={{ fontSize: 11, color: Z_AMBER, width: '100%' }}>{'Compared together with ' + outside.length + ' related bill' + (outside.length === 1 ? '' : 's') + ' NOT on this wire (same warehouse receipt) — only this wire’s bill' + (inv.bills.length - outside.length === 1 ? ' is' : 's are') + ' counted on top.'}</span> : null}
    <span style={{ fontSize: 12, color: '#a3a3a3' }}>{inv.bills.map(function (b) { return (b.bill_date || '') + (b.reference ? ' · ref ' + b.reference : ''); }).join('  +  ')}</span>
    <span style={{ fontSize: 12, color: '#e5e5e5', flex: '1 1 260px' }}>{cardLine(inv)}</span>
    {(cs.why && cs.key !== 'pass') || tags.length ? <span style={{ fontSize: 11, color: '#d4d4d4', width: '100%' }}>{[cs.key !== 'pass' ? cs.why : null].concat(tags.map(function (tg) { return tg.why; })).filter(Boolean).join(' · ')}</span> : null}
    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', color: '#a3a3a3', marginLeft: 'auto' }}>{isOpen ? 'CLOSE ▲' : 'OPEN ▼'}</span>
  </button>;
}
function zTag(color) { return { display: 'inline-block', padding: '3px 8px', background: '#000000', color: color, border: '1px solid ' + color, fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', borderRadius: 2 }; }
// the bills of a card that are NOT on the selected wire (compared together because they share a receipt) — [] without a wire
export function outsideWire(inv, wireBillIds) {
  if (!wireBillIds) { return []; }
  return ((inv && inv.bills) || []).filter(function (b) { return wireBillIds.indexOf(b.id) < 0; });
}
export function groupActionWarning(inv, wireBillIds) {
  var o = outsideWire(inv, wireBillIds); if (!o.length) { return null; }
  return 'Approved / Disputed decides this whole group, including ' + o.map(function (b) { return (b.vendor || '') + ' bill ' + (b.bill_number || ''); }).join(' + ') + ' — ' + (o.length === 1 ? 'that bill is' : 'those bills are') + ' NOT on this wire (it shares the warehouse receipt, so the bills are compared together).';
}
function zBlock(bg) { return { display: 'inline-block', minWidth: 96, textAlign: 'center', padding: '4px 10px', background: bg, color: '#000000', fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', borderRadius: 2 }; }

// v55.83-ZT: the answer to Approved / Disputed, shown ON the card next to the buttons (the corner message alone was missed)
// the exact comparison an answer was given for (each line's key + fingerprint + decision state)
export function fpKey(inv) { return ((inv && inv.rows) || []).map(function (r) { return String(r.item_key) + ':' + String(r.comparison_fp || '') ; }).sort().join('|'); }
// Codex 27 Nov (ZT hold): a card answer is shown only while the card still shows the SAME comparison; a green "Saved" only while it is
// still decided — after a recheck that changed the figures (reopened / needs revalidation) the old answer is not shown any more
export function cardMsgFor(msg, inv) {
  if (!msg || !msg.text || msg.kind === 'busy') { return null; }
  if (msg.fp !== fpKey(inv)) { return null; }
  if (msg.kind === 'ok' && !(inv.approved || inv.disputed)) { return null; }
  return msg;
}
export function CardMessage(props) {
  var m = props.msg; if (!m || !m.text) { return null; }
  var ok = m.kind === 'ok'; var warn = m.kind === 'warn';
  if (warn) { return <div role="alert" data-testid="card-message" style={{ width: '100%', marginTop: 10, padding: '8px 10px', borderRadius: 2, fontSize: 13, fontWeight: 700, background: '#fffbeb', color: '#92400e', border: '1px solid #f59e0b' }}>{'⚠ ' + m.text}</div>; }
  return <div role={ok ? 'status' : 'alert'} data-testid="card-message" style={{ width: '100%', marginTop: 10, padding: '8px 10px', borderRadius: 2, fontSize: 13, fontWeight: 700, background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#14532d' : '#991b1b', border: '1px solid ' + (ok ? '#22c55e' : '#ef4444') }}>{(ok ? '✓ ' : '✗ ') + m.text}</div>;
}

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

// What a person saw on the card: which bills, and per product the figures and the result. Used to stop an "Approved" / "Disputed"
// click when confirming the previewed receipt changes any of it (Codex 25 Nov: B1 previewed within tolerance, after confirming the
// receipt the real comparison also held B2 and was over — one click must never decide that).
export function invoiceSignature(inv) {
  if (!inv) { return ''; }
  var bills = (inv.bills || []).map(function (b) { return String(b.id); }).sort();
  var prods = (inv.products || []).map(function (r) { var f = r.figures || {}; var c = f.checks || {}; return [r.product_label || '', f.billed, f.received, f.diff, f.unit || '', r.outcome || '', checkSig(c.weight), checkSig(c.yards)].join('|'); }).sort();
  return JSON.stringify({ bills: bills, pass: !!inv.pass, products: prods });
}
function checkSig(c) { return c ? [c.billed, c.received, c.diff, c.result].join(':') : '-'; }
// v55.83-ZB (Max 25 Nov "yards and yards and weight and weight"): the two side-by-side checks of one product, in plain words.
// A side without a figure says "not on the bill" / "not recorded" — never a mismatch. No conversion between yards and pounds.
// v55.83-ZF: the mapping a product line of this invoice is compared through (latest active version of its family), or null
export function mappingFor(maps, vendor, line, used) {
  // Codex 25 Nov: the SAME mapping the comparison used (by family), falling back to the comparison's own match only without it
  if (used && used.length === 1 && used[0].family) { var byFam = (maps || []).filter(function (m) { return m.family === used[0].family && m.state === 'active'; }); return byFam.length === 1 ? byFam[0] : null; }
  if (used && used.length > 1) { return null; }
  if (!line) { return null; }
  var vk = vendorKey(vendor); var ik = billItemKey(line); var un = String(line.unit || '').toUpperCase().trim();
  var hits = (maps || []).filter(function (m) { return m.state === 'active' && m.vendor_key === vk && m.item_key === ik && String(m.bill_unit || '').toUpperCase().trim() === un; });
  return hits.length === 1 ? hits[0] : null;
}
export function checkWords(label, c) {
  if (!c) { return { text: label + ': —', tone: 'muted' }; }
  if (c.result === 'not_recorded') {
    var extra = c.received != null && c.billed == null ? ' — warehouse ' + num(c.received) + ' ' + c.unit : '';
    if (c.packing_list_lb != null && c.billed == null) { extra += ' · packing list ' + num(Math.round(c.packing_list_lb)) + ' lb'; }
    return { text: label + ': ' + (c.note || 'not recorded') + extra, tone: 'muted' };
  }
  var figs = 'billed ' + num(c.billed) + ' ' + c.unit + ' · warehouse ' + num(c.received) + ' ' + c.unit;
  // Codex 25 Nov (ZB P2): never a green PASS while the receipt is a draft or was not read completely
  if (c.result === 'provisional') { return { text: label + ': ' + figs + ' — Provisional (the receipt is still a draft)', tone: 'provisional' }; }
  if (c.result === 'not_checked') { return { text: label + ': ' + figs + ' — Not checked (see why on the card)', tone: 'muted' }; }
  var ok = c.result === 'matched' || c.result === 'equal';
  var t = label + ': billed ' + num(c.billed) + ' ' + c.unit + ' · warehouse ' + num(c.received) + ' ' + c.unit + ' · ' + (c.diff > 0 ? '+' : '') + num(c.diff) + (c.pct != null ? ' (' + (c.pct > 0 ? '+' : '') + c.pct + '%)' : '') + ' — ' + (ok ? passWords(c.diff, c.tol, c.unit === 'yd' ? 'yd' : 'lb') : 'REVIEW') + (c.over ? ' (billed MORE than the warehouse — never allowed)' : '');
  return { text: t, tone: ok ? 'pass' : 'review' };
}
// Max 25 Nov: "if within tolerance it should say Pass within tolerance for each item that is within the tolerance". An exact match is
// "PASS"; a difference inside the approved tolerance is "PASS — within tolerance (10%)" (the lb allowance is named for weight only).
export function tolWords(tol, basis) {
  if (!tol) { return ''; }
  var parts = []; if (tol.pct != null && tol.pct !== '') { parts.push(Number(tol.pct) + '%'); }
  if (basis !== 'yd' && tol.lb != null && tol.lb !== '') { parts.push(Number(tol.lb) + ' lb'); }
  return parts.join(' or ');
}
export function passWords(diff, tol, basis) {
  if (diff == null || Math.abs(Number(diff)) < 1e-9) { return 'PASS'; }
  var w = tolWords(tol, basis);
  return 'PASS — within tolerance' + (w ? ' (' + w + ')' : '');
}
function checksBlock(ch) {
  var rows = [checkWords('Weight', ch.weight), checkWords('Yards', ch.yards)];
  var notes = []; if (ch.yards && ch.yards.copied_note) { notes.push(ch.yards.copied_note); }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, padding: '4px 8px', background: SOFT, borderRadius: 6 }}>
    {rows.map(function (w, i) { return <div key={i} style={{ color: w.tone === 'pass' ? GREEN : (w.tone === 'review' ? RED : (w.tone === 'provisional' ? AMBER : SUB)), fontWeight: w.tone === 'muted' ? 400 : 600 }}>{w.text}</div>; })}
    {notes.map(function (n, i) { return <div key={'n' + i} style={{ color: AMBER }}>{'Note: ' + n}</div>; })}
  </div>;
}
// the automatic approval reason names the evidence actually compared (Codex 25 Nov, ZB): pounds on the scale, receipt yards, or both
export function autoReason(inv) {
  var bases = {}; (inv.products || []).forEach(function (r) { var f = r.figures || {}; if (f.basis) { bases[f.basis] = true; } });
  // v55.83-ZS: yards have no tolerance — the note says what was actually applied
  if (bases.lb && bases.yd) { return 'Approved: billed weight vs scanned weight within the approved tolerance; billed yards vs receipt yards an exact match'; }
  if (bases.yd) { return 'Approved: billed yards vs receipt yards — an exact match'; }
  return 'Approved: billed weight vs scanned weight within the approved tolerance';
}
function reasonProblem(inv, mode, reason) {
  if (mode === 'approve' && !inv.pass && reason.length < 5) { return 'Not saved: this bill is ' + cardResult(inv).label + ' — type a note in the box (a few words saying why you approve it anyway), then press Approved again.'; }
  if (mode === 'dispute' && reason.length < 5) { return 'Not saved: type what is wrong in the box (a few words), then press Disputed again.'; }
  return '';
}
// The Approved / Disputed flow, outside React so it can be tested. o = { inv, mode: 'approve'|'dispute', reason, api(body) → json,
// reload() → fresh report rows }. A previewed card first has its receipt confirmed by this person; then the fresh, REAL result must be
// exactly what was shown, otherwise nothing is decided and the person looks again. The reason is judged against the real result.
// v55.83-ZT (Codex 27 Nov): after an UNCERTAIN answer (server unreachable / unreadable), re-read and say per line what is actually saved —
// never "not saved" on a guess, never "try again" before checking. refreshed = the report_preview answer after the problem (or null).
export function reconcileWords(res, refreshed, inv, mode, label) {
  // Codex 27 Nov 07:19: a re-read can PROVE a line is saved (the same line + comparison now shows this decision and note); it can never
  // prove "not saved" — an unanswered request may still be finishing. Without an explicit refusal the answer is "not yet confirmed".
  var verb = mode === 'dispute' ? 'Disputed' : 'Approved';
  var checkFirst = 'Wait a moment, press Show (last reading) and check the card before pressing ' + verb + ' again.';
  if (!refreshed || !refreshed.ok) {
    var what = res.linkUnknown ? 'whether warehouse receipt ' + res.receipt + ' was confirmed' : 'whether ' + res.uncertainLines.map(function (x) { return x.label; }).join(', ') + ' ' + (res.uncertainLines.length === 1 ? 'was' : 'were') + ' saved';
    return { kind: 'warn', text: 'Connection problem: could not confirm ' + what + ' (' + (res.error || 'no answer') + ')' + (res.wrote ? '; ' + res.wrote + ' line' + (res.wrote === 1 ? ' was' : 's were') + ' saved before it' : '') + '. ' + checkFirst };
  }
  var rows = refreshed.rows || []; var billId = inv.bills[0].id;
  var billRows = rows.filter(function (r) { return (r.bill_ids || []).indexOf(billId) >= 0; });
  if (res.linkUnknown) {
    var confirmed = billRows.some(function (r) { return (r.links || []).some(function (l) { return String(l.receipt_id) === String(res.receipt) && String(l.bill_id || billId) === String(billId) && l.state === 'confirmed'; }); });
    var stillPreview = billRows.some(function (r) { return r.preview && r.proposed_receipt && String(r.proposed_receipt.receipt_id) === String(res.receipt); });
    if (confirmed && !stillPreview) { return { kind: 'warn', text: 'Connection problem — checked again: warehouse receipt ' + res.receipt + ' now shows as confirmed, but nothing was ' + verb.toLowerCase() + ' yet. Look at the card and press ' + verb + ' again.' }; }
    return { kind: 'warn', text: 'Connection problem: not yet confirmed whether warehouse receipt ' + res.receipt + ' was confirmed (' + (res.error || 'no answer') + '). ' + checkFirst };
  }
  var done = mode === 'dispute' ? ['issue_open'] : ['validated', 'accepted'];
  function provedSaved(x) {
    var r = billRows.filter(function (y) { return y.item_key === x.key; })[0];
    if (!r || String(r.comparison_fp || '') !== String(x.fp || '')) { return false; }
    var d = mode === 'dispute' ? (r.issue || r.decision) : r.decision;
    return done.indexOf(r.state) >= 0 && !!d && d.kind === x.kind && String(d.reason || '') === String(x.reason || '');
  }
  var savedU = res.uncertainLines.filter(provedSaved); var pendingU = res.uncertainLines.filter(function (x) { return !provedSaved(x); });
  var total = (res.wrote || 0) + savedU.length;
  if (!pendingU.length && !(res.notSent || []).length && !(res.failed || []).length) {
    return { kind: 'ok', text: 'Saved — ' + verb + ': ' + label + ' (' + total + ' line' + (total === 1 ? '' : 's') + '), confirmed after a connection problem.' };
  }
  var parts = [];
  if (total) { parts.push(total + ' line' + (total === 1 ? '' : 's') + ' saved'); }
  if (pendingU.length) { parts.push('not yet confirmed: ' + pendingU.map(function (x) { return x.label; }).join(', ')); }
  if ((res.notSent || []).length) { parts.push('not sent: ' + res.notSent.map(function (x) { return x.label; }).join(', ')); }
  if ((res.failed || []).length) { parts.push('refused: ' + res.failed.join(' · ')); }
  return { kind: 'warn', text: 'Connection problem — checked again: ' + parts.join('; ') + '. ' + (pendingU.length ? checkFirst : 'Press ' + verb + ' again for the rest.') };
}

export async function runInvoiceDecision(o) {
  var inv = o.inv; var mode = o.mode; var reason = String(o.reason || '').trim();
  var problem = reasonProblem(inv, mode, reason); if (problem) { return { ok: false, error: problem, wrote: 0 }; }
  if (inv.previewed) {
    var shown = invoiceSignature(inv);
    var c = inv.proposed || (inv.linkRow && (inv.linkRow.candidates || [])[0]);
    if (!c) { return { ok: false, error: 'No warehouse receipt to confirm.', wrote: 0 }; }
    var j0 = await o.api({ action: 'link', bill_id: inv.bills[0].id, receipt_id: c.receipt_id, basis: (c.bases || [])[0], bill_value: c.bill_value, receipt_value: c.receipt_value, state: 'confirmed' });
    if (j0 && j0.uncertain) { return { ok: false, uncertain: true, linkUnknown: true, receipt: c.receipt_id, uncertainLines: [], notSent: [], failed: [], wrote: 0, error: j0.error }; }
    if (!j0 || !j0.ok) { return { ok: false, error: (j0 && j0.error) || 'The receipt could not be confirmed.', wrote: 0 }; }
    var rows = await o.reload();
    var again = groupInvoices(rows || []).filter(function (v) { return v.bills.some(function (b) { return b.id === inv.bills[0].id; }); })[0] || null;
    if (!again) { return { ok: false, stopped: true, linked: true, error: 'Receipt ' + c.receipt_id + ' is confirmed. The invoice is no longer in this list — nothing was ' + (mode === 'dispute' ? 'disputed' : 'approved') + '.', wrote: 0 }; }
    if (invoiceSignature(again) !== shown) {
      var more = again.bills.filter(function (b) { return !inv.bills.some(function (x) { return x.id === b.id; }); });
      var what = more.length ? 'the receipt also covers ' + more.map(function (b) { return (b.vendor || '') + ' ' + (b.bill_number || b.id); }).join(' + ') + ', so the bills are compared together' : 'the figures or the result are not what the preview showed';
      return { ok: false, stopped: true, linked: true, error: 'Receipt ' + c.receipt_id + ' is confirmed, but with it ' + what + (again.pass ? '' : ' — now REVIEW') + '. Nothing was ' + (mode === 'dispute' ? 'disputed' : 'approved') + ': look at the card again and choose.', wrote: 0, inv: again };
    }
    inv = again;
    problem = reasonProblem(inv, mode, reason); if (problem) { return { ok: false, stopped: true, linked: true, error: problem, wrote: 0, inv: inv }; }
  }
  if (mode === 'approve' && inv.pass && reason.length < 5) { reason = autoReason(inv); }
  var todo = inv.rows.filter(function (r) { return r.needs_decision; });
  if (!todo.length) { return { ok: false, error: 'Nothing left to decide on this invoice.', wrote: 0, linked: !!o.inv.previewed }; }
  var blocked = todo.filter(function (r) { var a = r.allowed || []; return mode === 'dispute' ? a.indexOf('report_issue') < 0 : (a.indexOf('validate_match') < 0 && a.indexOf('accept_discrepancy') < 0); });
  if (blocked.length) { return { ok: false, error: 'Not possible yet: ' + blocked.map(function (r) { return r.product_label || r.outcome_words || r.outcome; }).join(', ') + ' — see the note on the card.', wrote: 0, linked: !!o.inv.previewed }; }
  var failed = []; var wrote = 0; var uncertainLines = []; var notSent = [];
  for (var i = 0; i < todo.length; i++) {
    var r = todo[i]; var a = r.allowed || [];
    var kind = mode === 'dispute' ? 'report_issue' : (a.indexOf('validate_match') >= 0 ? 'validate_match' : 'accept_discrepancy');
    var j = await o.api({ action: 'decide', bill_id: (r.bill_ids || [])[0] || inv.bills[0].id, item_key: r.item_key, kind: kind, reason: reason, expected_fp: r.comparison_fp });
    if (j && j.uncertain) { uncertainLines.push({ key: r.item_key, label: r.product_label || r.item_key, error: j.error, fp: r.comparison_fp, kind: kind, reason: reason }); notSent = todo.slice(i + 1).map(function (x) { return { key: x.item_key, label: x.product_label || x.item_key }; }); break; }
    if (!j || !j.ok) { failed.push((r.product_label || r.item_key) + ': ' + ((j && j.error) || 'not saved')); } else { wrote++; }
  }
  if (uncertainLines.length) { return { ok: false, uncertain: true, wrote: wrote, uncertainLines: uncertainLines, notSent: notSent, failed: failed, error: uncertainLines[0].error, mode: mode }; }
  if (failed.length) { return { ok: false, error: 'Some lines were not saved — ' + failed.join(' · '), wrote: wrote, failed: failed }; }
  return { ok: true, wrote: wrote, message: (mode === 'dispute' ? 'Disputed: ' : 'Approved: ') + inv.bills.map(function (b) { return b.vendor + ' ' + b.bill_number; }).join(' + ') };
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
  var _ch = useState({}); var changing = _ch[0], setChanging = _ch[1]; // v55.83-ZF: product line → the mapping being changed
  var _w = useState(null); var wires = _w[0], setWires = _w[1]; // v55.83-ZL: { list, note }
  var _wi = useState((props.wirePreset && props.wirePreset.wire_id) || ''); var wireId = _wi[0], setWireId = _wi[1];
  var _op = useState({}); var openCards = _op[0], setOpenCards = _op[1]; // v55.83-ZL: cards are CLOSED by default
  var _cm = useState({}); var cardMsg = _cm[0], setCardMsg = _cm[1]; // v55.83-ZT: card key → { kind: 'ok' | 'warn' | 'err', text, fp, needNote }
  var _la = useState(null); var lastAction = _la[0], setLastAction = _la[1]; // v55.83-ZT: the last Approved / Disputed answer, kept above the list (a decided card can leave a filtered view)
  var [mapError, setMapError] = useState(null);
  var [mapNotice, setMapNotice] = useState(null);

  function loadCfg() { return wcApi({ action: 'settings_view' }).then(function (j) { setCfg(j); return j; }); }
  useEffect(function () { loadCfg(); }, []);
  function readPreview(recheck, dates, wid) {
    var w = wid === undefined ? wireId : wid;
    if (w) { return wcApi({ action: 'report_preview', wire_id: w, all: true, recheck: !!recheck }); } // ZL: a wire ignores the dates
    return wcApi({ action: 'report_preview', date_from: dates.date_from, date_to: dates.date_to, all: true, recheck: !!recheck });
  }
  useEffect(function () { wcApi({ action: 'wires_for_check' }).then(function (j) { setWires(j && j.ok ? { list: j.wires || [], note: j.note || null } : { list: [], note: (j && j.error) || null }); }); }, []);
  // ZL: opened from a wire ("Check these bills against the warehouse") → that wire, shown straight away
  useEffect(function () {
    var wp = props.wirePreset; if (!wp || !wp.wire_id) { return; }
    setWireId(wp.wire_id); setOpenCards({}); setBusy('load');
    readPreview(false, flt, wp.wire_id).then(function (j) { setMapNotice(null); setBusy(''); setData(j); });
  }, [props.wirePreset && props.wirePreset.n]); // eslint-disable-line react-hooks/exhaustive-deps
  function toggleCard(k) { var o = Object.assign({}, openCards); o[k] = !o[k]; setOpenCards(o); }
  function load(recheck) {
    setBusy(recheck ? 'recheck' : 'load');
    return readPreview(recheck, flt).then(function (j) { setMapNotice(null); setBusy(''); setData(j); return j; });
  }
  // v55.83-ZT: after a decision, refresh WITHOUT throwing the list away when the refresh itself fails (the answer says so instead)
  function refreshKeep() { return readPreview(false, flt).then(function (j) { if (j && j.ok) { setData(j); } return j; }, function () { return { ok: false, error: 'the Hub could not be reached' }; }); }
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
  function closeMapping(key) {
    setMapEdit(function (current) { var next = Object.assign({}, current); delete next[key]; return next; });
    setChanging(function (current) { var next = Object.assign({}, current); delete next[key]; return next; });
    setMapError(null);
  }
  function readCurrentPreview() {
    return readPreview(false, { date_from: (data && data.from) || flt.date_from, date_to: (data && data.to) || flt.date_to });
  }
  async function saveMapping(inv, r) {
    if (busy) { return; }
    var e = mapEdit[r.item_key] || {}; var bl = r.bill_line || ((r.bill_lines || [])[0]) || {};
    var em = changing[r.item_key] || null;
    var key = r.item_key;
    setMapNotice(null);
    if (!e.wh_product_type && !e.wh_cgt && !e.wh_nt && !e.wh_color) {
      setMapError({ key: key, words: 'Choose a warehouse product or grade.' }); return;
    }
    var note = String(e.note || '').trim();
    if (em && note.length < 5) {
      setMapError({ key: key, words: 'Enter a reason with at least five characters to save this change.' }); return;
    }
    setMapError(null); setBusy(key);
    var body = Object.assign({ action: 'map_save', wh_product_type: e.wh_product_type || '', wh_cgt: e.wh_cgt || '',
      wh_nt: e.wh_nt || '', wh_color: e.wh_color || '', wh_label: warehouseMappingLabel(e, L) },
      em ? { family: em.family, expected_version: em.version, lb_per_yd: em.lb_per_yd != null ? String(em.lb_per_yd) : '', note: note }
        : { vendor_name: (inv.bills.find(function (b) { return b.id === bl.bill_id; }) || inv.bills[0]).vendor, bill_description: bl.description, bill_unit: bl.unit || '' });
    try {
      var saved = await wcApi(body);
      if (!saved || !saved.ok) {
        setMapError({ key: key, words: (saved && saved.error) || 'The mapping could not be saved.', reload: saved && saved.http_status === 409 });
        return;
      }
      setCfg(function (current) {
        if (!current || !current.ok) { return current; }
        return Object.assign({}, current, { maps: [saved.map].concat((current.maps || []).filter(function (m) { return m.family !== saved.map.family; })) });
      });
      var refreshed = await readCurrentPreview();
      if (refreshed && refreshed.ok) { setData(refreshed); }
      var words = 'Mapping v' + saved.map.version + ' saved' + (saved.map.wh_label ? ' · ' + saved.map.wh_label : '') + '.';
      setMapNotice({ key: inv.key, words: words, warning: !refreshed || !refreshed.ok });
      closeMapping(key);
      say(props.toast, words, 'success');
    } finally {
      setBusy('');
    }
  }
  async function reloadMapping(key) {
    setBusy(key);
    try {
      var rs = await Promise.all([loadCfg(), readCurrentPreview()]);
      if (rs[0].ok && rs[1].ok) { setData(rs[1]); closeMapping(key); return; }
      setMapError({ key: key, words: (rs[0].ok ? rs[1].error : rs[0].error) || 'Could not reload the latest mapping.', reload: true });
    } finally { setBusy(''); }
  }
  function mappingNotice() {
    return <div role="status" style={{ marginTop: 8, padding: '6px 8px', background: mapNotice.warning ? '#fffbeb' : '#f0fdf4', color: mapNotice.warning ? '#92400e' : '#14532d' }}>
      {mapNotice.words}{mapNotice.warning && ' The comparison could not refresh. Use Show (last reading) to try again.'}
    </div>;
  }

  function putCardMsg(k, m) { setCardMsg(function (prev) { var o = Object.assign({}, prev); if (m) { o[k] = m; } else { delete o[k]; } return o; }); }
  async function decideAll(inv, mode) {
    var fpk = fpKey(inv); var label = inv.bills.map(function (b) { return (b.vendor || '') + ' ' + (b.bill_number || ''); }).join(' + ');
    putCardMsg(inv.key, { kind: 'busy', text: '', fp: fpk });
    setBusy(inv.key);
    var res; var unknown = false;
    try { res = await runInvoiceDecision({ inv: inv, mode: mode, reason: reasons[inv.key], api: wcApi, reload: function () { return refreshKeep().then(function (j) { return (j && j.ok && j.rows) || []; }); } }); }
    catch (eD) { unknown = true; res = { ok: false, wrote: 0, error: 'Could not confirm whether this was saved (' + ((eD && eD.message) || 'no answer') + ') — press Show (last reading) to see what is saved now.' }; }
    var refreshed = null;
    if (res.wrote || res.linked || unknown || res.uncertain) { refreshed = await refreshKeep(); }
    setBusy('');
    var refreshFailed = !!(refreshed && !refreshed.ok);
    var n = res.wrote || 0; var lines = n + ' line' + (n === 1 ? '' : 's');
    var m;
    if (res.uncertain) { m = reconcileWords(res, refreshed, inv, mode, label); }
    else if (res.ok) { m = { kind: refreshFailed ? 'warn' : 'ok', text: 'Saved — ' + res.message + ' (' + lines + ').' + (refreshFailed ? ' The list could not be refreshed — press Show (last reading) to see it.' : '') }; }
    else if (unknown) { m = { kind: 'warn', text: res.error }; }
    else if (n > 0) { m = { kind: 'warn', text: 'Partly saved: ' + lines + ' saved; ' + String(res.error || '').replace(/^Some lines were not saved — /, 'not saved: ') + ' — press Show (last reading), then decide the rest.' }; }
    else { m = { kind: 'err', text: res.error || 'Not saved.', needNote: /type (a note|what is wrong) in the box/.test(res.error || '') }; }
    // the answer belongs to the card as it is NOW: after a successful re-read, the comparison that came back (e.g. a confirmed receipt)
    var msgKey = inv.key; m.fp = fpk;
    if (refreshed && refreshed.ok) { var g2 = groupInvoices(refreshed.rows || []).filter(function (v) { return v.bills.some(function (b) { return b.id === inv.bills[0].id; }); })[0]; if (g2) { m.fp = fpKey(g2); msgKey = g2.key; } }
    putCardMsg(msgKey, m);
    setLastAction({ kind: m.kind, text: label + ': ' + m.text, at: new Date().toISOString() });
    say(props.toast, m.text, m.kind === 'ok' ? 'success' : 'error'); // the corner message says the same as the card
  }

  function MapForm(p) {
    var r = p.row; var e = mapEdit[r.item_key] || {};
    function setE(k, v) { var o = Object.assign({}, mapEdit); o[r.item_key] = Object.assign({}, e); o[r.item_key][k] = v; setMapEdit(o); }
    var pts = L.product_types || {}; var cgts = L.cgt_grades || {}; var nts = L.nt_grades || {}; var cols = L.colors || {}; var em = changing[r.item_key] || null;
    if (!perms.settings) { return <div style={{ fontSize: 12, color: MUTED }}>No product mapping yet — someone with “Warehouse check: Settings” maps it.</div>; }
    return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginTop: 6, padding: 8, background: SOFT, border: '1px dashed #cbd5e1', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: em ? '#1e3a8a' : SUB, fontWeight: em ? 700 : 400, width: '100%' }}>{em ? 'Change the mapping for “' + (em.bill_description || em.item_key) + '” (' + em.bill_unit + ') — now version ' + em.version + '. Saving makes version ' + (em.version + 1) + '; version ' + em.version + ' is kept in the history. Decisions that used it are asked again.' : 'Map “' + (((r.bill_line || (r.bill_lines || [])[0]) || {}).description || 'this product') + '” to the warehouse product it is scanned as:'}</div>
      <label><span style={LABEL}>Warehouse product</span><select value={e.wh_product_type || ''} onChange={function (ev) { setE('wh_product_type', ev.target.value); }} className="nt-light" style={FIELD}><option value="">choose…</option>{Object.keys(pts).map(function (id) { return <option key={id} value={id}>{pts[id]}</option>; })}</select></label>
      <label><span style={LABEL}>Grade (CGT)</span><select value={e.wh_cgt || ''} onChange={function (ev) { setE('wh_cgt', ev.target.value); }} className="nt-light" style={FIELD}><option value="">any grade</option>{Object.keys(cgts).map(function (id) { return <option key={id} value={id}>{cgts[id]}</option>; })}</select></label>
      {em ? <label><span style={LABEL}>NT grade</span><select value={e.wh_nt || ''} onChange={function (ev) { setE('wh_nt', ev.target.value); }} className="nt-light" style={FIELD}><option value="">any</option>{Object.keys(nts).map(function (id) { return <option key={id} value={id}>{nts[id]}</option>; })}</select></label> : null}
      {em ? <label><span style={LABEL}>Colour</span><select value={e.wh_color || ''} onChange={function (ev) { setE('wh_color', ev.target.value); }} className="nt-light" style={FIELD}><option value="">any</option>{Object.keys(cols).map(function (id) { return <option key={id} value={id}>{cols[id]}</option>; })}</select></label> : null}
      {em ? <label style={{ flex: '1 1 260px' }}><span style={LABEL}>Why is it changed? (required)</span><input value={e.note || ''} onChange={function (ev) { setE('note', ev.target.value); }} placeholder="e.g. scanned as Folds, not Thirds" className="nt-light" style={Object.assign({}, FIELD, { width: '100%' })} /></label> : null}
      <button type="button" disabled={!!busy} onClick={function () { saveMapping(p.inv, r); }} style={btn(INK, '#ffffff')}>{busy === r.item_key ? 'Saving…' : (em ? 'Save change (new version)' : 'Save mapping')}</button>
      {em ? <button type="button" disabled={!!busy} onClick={function () { closeMapping(r.item_key); }} style={btn('#334155', '#ffffff', true)}>Cancel</button> : null}
      {mapError && mapError.key === r.item_key && <div role="alert" style={{ width: '100%', color: RED, fontSize: 12, fontWeight: 700 }}>
        {mapError.words}{mapError.reload && <button type="button" disabled={!!busy} onClick={function () { reloadMapping(r.item_key); }} style={{ marginLeft: 8, color: BLUE, textDecoration: 'underline' }}>Reload latest mapping</button>}
      </div>}
    </div>;
  }

  var tile = { flex: '1 1 220px', background: '#ffffff', border: '1px solid ' + LINE, borderRadius: 12, padding: 12 };
  return <div style={{ color: INK, fontSize: 13 }}>
    {/* controls */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <label><span style={LABEL}>Wire</span><select value={wireId} onChange={function (e) { setWireId(e.target.value); setData(null); setOpenCards({}); }} className="nt-light" style={Object.assign({}, FIELD, { maxWidth: 320 })}>
        <option value="">All bills (by bill date)</option>
        {((wires && wires.list) || []).map(function (w) { return <option key={w.id} value={w.id}>{'Wire #' + w.seq + ' — ' + (w.payee || '') + ' (' + w.bills + ' bill' + (w.bills === 1 ? '' : 's') + ', ' + String(w.status || '').replace(/_/g, ' ') + ')'}</option>; })}
      </select>{wires && wires.note ? <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2 }}>{wires.note}</span> : null}</label>
      <label style={{ opacity: wireId ? 0.45 : 1 }}><span style={LABEL}>Bill date from</span><input type="date" disabled={!!wireId} value={flt.date_from} onChange={function (e) { setFlt(Object.assign({}, flt, { date_from: e.target.value })); }} className="nt-light" style={FIELD} /></label>
      <label style={{ opacity: wireId ? 0.45 : 1 }}><span style={LABEL}>to</span><input type="date" disabled={!!wireId} value={flt.date_to} onChange={function (e) { setFlt(Object.assign({}, flt, { date_to: e.target.value })); }} className="nt-light" style={FIELD} /></label>
      <button disabled={!!busy} onClick={function () { load(true); }} style={Object.assign(btn(BLUE, '#ffffff'), { opacity: busy ? 0.6 : 1 })}>{busy === 'recheck' ? 'Reading the warehouse…' : 'Check against the warehouse'}</button>
      <button disabled={!!busy} onClick={function () { load(false); }} style={btn('#334155', '#ffffff', true)}>{busy === 'load' ? 'Loading…' : 'Show (last reading)'}</button>
    </div>

    {/* settings strip: tolerance · vendors · last reading */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
      <div style={tile}>
        <span style={LABEL}>Tolerance</span>
        {tol ? <div style={{ fontSize: 16, fontWeight: 800 }}>{(tol.pct != null ? tol.pct + '%' : '') + (tol.lb != null ? (tol.pct != null ? ' or ' : '') + tol.lb + ' lb' : '')}</div> : <div style={{ fontSize: 15, fontWeight: 800, color: AMBER }}>Not set</div>}
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>A bill may be BELOW what was scanned by up to this much. A bill ABOVE what was scanned is never allowed. The tolerance is for WEIGHT only. Yards must match exactly — no tolerance (Max 27 Nov).</div>
        {perms.super_admin ? <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}><input value={tolPct} onChange={function (e) { setTolPct(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder={tol && tol.pct != null ? String(tol.pct) : '10'} className="nt-light" style={Object.assign({}, FIELD, { width: 70 })} /><span style={{ color: SUB }}>%</span><button disabled={busy === 'tol' || !tolPct} onClick={saveTolerance} style={Object.assign(btn(INK, '#ffffff'), { opacity: tolPct ? 1 : 0.5 })}>{tol ? 'Change' : 'Set tolerance'}</button></div> : null}
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
    {mapNotice && !shown.some(function (inv) { return inv.key === mapNotice.key; }) && mappingNotice()}

    {/* v55.83-ZL: one wire — its bills only, with the overall tally */}
    {data && data.ok && data.wire ? <WireSummaryBar wire={data.wire} invoices={invoices} tol={tol} /> : null}

    {lastAction ? <div role="status" data-testid="last-action" style={{ marginTop: 10, padding: '6px 10px', borderRadius: 2, fontSize: 12, fontWeight: 700, background: lastAction.kind === 'ok' ? '#f0fdf4' : (lastAction.kind === 'warn' ? '#fffbeb' : '#fef2f2'), color: lastAction.kind === 'ok' ? '#14532d' : (lastAction.kind === 'warn' ? '#92400e' : '#991b1b'), border: '1px solid ' + (lastAction.kind === 'ok' ? '#22c55e' : (lastAction.kind === 'warn' ? '#f59e0b' : '#ef4444')) }}>{'Last action (' + when(lastAction.at) + '): ' + lastAction.text}</div> : null}
    {/* one card per invoice — CLOSED by default (v55.83-ZL); click the bar to open its rows */}
    {shown.map(function (inv) {
      var head = inv.bills.map(function (b) { return (b.vendor || '') + ' · Bill ' + (b.bill_number || '') + ' · ' + (b.bill_date || '') + (b.reference ? ' · ref ' + b.reference : ''); }).join('  +  ');
      var badge = inv.approved ? ['APPROVED', GREEN, '#dcfce7'] : inv.disputed ? ['DISPUTED', RED, '#fee2e2'] : inv.pass ? ['PASS', GREEN, '#dcfce7'] : (cardResult(inv).key === 'fail' ? ['FAIL', RED, '#fee2e2'] : ['REVIEW', AMBER, '#fffbeb']); // v55.83-ZT: same result word as the bar
      var badgeText = badge[0] + (inv.shared ? ' · group of ' + inv.bills.length + ' invoices' : '');
      var receipts = []; inv.rows.forEach(function (r) { (r.receipts || []).forEach(function (x) { var t = 'Receipt ' + (x.reference_number || x.id) + (x.warehouse ? ' · ' + x.warehouse : '') + (x.receipt_date ? ' · received ' + String(x.receipt_date).substring(0, 10) : ''); if (receipts.indexOf(t) < 0) { receipts.push(t); } }); });
      var canDecide = inv.previewed || inv.rows.some(function (r) { return r.needs_decision; });
      var isOpen = !!openCards[inv.key] || !!(mapNotice && mapNotice.key === inv.key);
      var wireIds = data && data.wire ? (data.wire.bill_ids || []) : null; var outside = outsideWire(inv, wireIds); var gWarn = groupActionWarning(inv, wireIds);
      var bar = <BillCardBar inv={inv} wireIds={wireIds} isOpen={isOpen} onToggle={function () { toggleCard(inv.key); }} />;
      if (!isOpen) { return <div key={inv.key} style={{ marginTop: 6, border: '1px solid #3f3f46', borderRadius: 2 }}>{bar}</div>; }
      return <div key={inv.key} style={{ marginTop: 6, border: '1px solid #3f3f46', borderRadius: 2, background: '#000000' }}>{bar}<div style={{ background: '#ffffff', padding: 14 }}>
        {mapNotice && mapNotice.key === inv.key && mappingNotice()}
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
              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.product_label || bl.description || '—'}{r.product_label && bl.description && r.product_label !== bl.description ? <div style={{ fontSize: 11, color: MUTED, fontWeight: 400 }}>{'billed as ' + bl.description}</div> : null}{(function () { if (!perms.settings || r.needs_mapping || changing[r.item_key] || r.kind !== 'product') { return null; } var mm = mappingFor((cfg && cfg.maps) || [], (inv.bills[0] || {}).vendor, bl, r.map_families); if (!mm) { return null; } return <div><button onClick={function () { var c = Object.assign({}, changing); c[r.item_key] = mm; setChanging(c); var o = Object.assign({}, mapEdit); o[r.item_key] = { wh_product_type: mm.wh_product_type || '', wh_cgt: mm.wh_cgt || '', wh_nt: mm.wh_nt || '', wh_color: mm.wh_color || '', note: '' }; setMapEdit(o); }} style={{ background: 'none', border: 'none', padding: 0, color: BLUE, fontSize: 11, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>{'Change mapping (v' + mm.version + ')'}</button></div>; })()}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.billed != null ? num(f.billed) + ' ' + (f.unit || '') : (bl.qty != null ? num(bl.qty) + ' ' + (bl.unit || '') : '—')}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.received != null ? num(f.received) + ' ' + (f.unit || '') : '—'}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: f.diff < 0 ? RED : INK, fontWeight: 700 }}>{f.diff != null ? (f.diff > 0 ? '+' : '') + num(f.diff) + (f.pct != null ? '  (' + (f.pct > 0 ? '+' : '') + f.pct + '%)' : '') : '—'}</td>
              <td style={{ padding: '7px 8px' }}><span style={pill(ok ? GREEN : RED, ok ? '#f0fdf4' : '#fef2f2')}>{ok ? passWords(f.diff, ((f.checks || {})[f.basis === 'yd' ? 'yards' : 'weight'] || {}).tol || tol, f.basis) : (r.outcome === 'discrepancy' || r.outcome === 'product_missing' ? 'FAIL' : 'REVIEW')}</span><span style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>{r.outcome_words || r.outcome}{r.state && DONE_STATES.indexOf(r.state) >= 0 ? ' · ' + (r.state_words || r.state) : r.state === 'issue_open' ? ' · disputed' : ''}</span></td>
            </tr>
            {f.checks ? <tr><td colSpan={5} style={{ padding: '0 8px 8px' }}>{checksBlock(f.checks)}</td></tr> : null}
            {r.needs_mapping || changing[r.item_key] ? <tr><td colSpan={5} style={{ padding: '0 8px 8px' }}>{MapForm({ row: r, inv: inv })}</td></tr> : null}
            </React.Fragment>;
          })}</tbody></table> : null}

        {inv.shared ? <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ color: SUB, textAlign: 'left' }}><th style={{ padding: '4px 8px' }}>Invoice</th><th style={{ padding: '4px 8px' }}>Billed on this invoice</th><th style={{ padding: '4px 8px' }}>Status</th></tr></thead><tbody>{inv.perBill.map(function (b) { return <tr key={b.id} style={{ borderTop: '1px solid ' + LINE }}><td style={{ padding: '4px 8px' }}>{(b.vendor || '') + ' · ' + (b.bill_number || '') + ' · ' + (b.bill_date || '')}</td><td style={{ padding: '4px 8px' }}>{b.lines.length ? b.lines.map(function (l) { return l.product + ': ' + num(l.qty) + ' ' + (l.unit || ''); }).join(' · ') : '—'}</td><td style={{ padding: '4px 8px', color: MUTED }}>part of the group result — not verified on its own</td></tr>; })}</tbody></table> : null}

        {!inv.pass && inv.why.length ? <div style={{ fontSize: 12, marginTop: 8, color: RED, fontWeight: 600 }}>{'Why ' + cardResult(inv).label + ': ' + inv.why.slice(0, 4).join(' · ')}</div> : null}
        {inv.linkRow && !inv.previewed ? <div style={{ marginTop: 8 }}><LinkChooser item={inv.linkRow} perms={perms} onLink={function (l) { setBusy(inv.key); wcApi(Object.assign({ action: 'link', bill_id: inv.bills[0].id }, l)).then(function (j) { setBusy(''); if (!j || !j.ok) { say(props.toast, (j && j.error) || 'Not saved.', 'error'); } load(false); }); }} /></div> : null}

        {gWarn && canDecide && (perms.validate || perms.accept) && !inv.approved && !inv.disputed ? <div role="note" style={{ fontSize: 12, marginTop: 10, padding: '6px 10px', borderRadius: 2, background: '#fffbeb', color: '#92400e', border: '1px solid #f59e0b', fontWeight: 700 }}>{gWarn}</div> : null}
        {canDecide && (perms.validate || perms.accept) && !inv.approved && !inv.disputed ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid ' + LINE }}>
          <input value={reasons[inv.key] || ''} onChange={function (e) { var o = Object.assign({}, reasons); o[inv.key] = e.target.value; setReasons(o); }} placeholder={inv.pass ? 'Note (optional)' : 'Note — REQUIRED to approve this ' + cardResult(inv).label + ' (a few words why), or to dispute'} aria-label="Note for Approved or Disputed" className="nt-light" style={Object.assign({}, FIELD, { flex: '1 1 260px' }, cardMsgFor(cardMsg[inv.key], inv) && cardMsg[inv.key].needNote && String(reasons[inv.key] || '').trim().length < 5 ? { border: '2px solid #ef4444' } : {})} />
          <button disabled={busy === inv.key} onClick={function () { decideAll(inv, 'approve'); }} style={Object.assign(btn(GREEN, '#ffffff'), { opacity: busy === inv.key ? 0.6 : 1 })}>{busy === inv.key ? 'Saving…' : 'Approved'}</button>
          <button disabled={busy === inv.key} onClick={function () { decideAll(inv, 'dispute'); }} style={Object.assign(btn(RED, '#ffffff'), { opacity: busy === inv.key ? 0.6 : 1 })}>Disputed</button>
        </div> : null}
        <CardMessage msg={cardMsgFor(cardMsg[inv.key], inv)} />
        {inv.approved || inv.disputed ? <div style={{ fontSize: 12, marginTop: 8, color: SUB }}>{inv.rows.filter(function (r) { return r.decision; }).slice(0, 1).map(function (r) { return 'Decided by ' + r.decision.actor_name + ' · ' + when(r.decision.at) + ' — “' + r.decision.reason + '”'; }).join('')}</div> : null}
      </div></div>;
    })}
  </div>;
}
