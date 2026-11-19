'use client';
// v55.83-SY — Accounting > 📊 Profitability (product · customer · invoice). Max, Nov 16 2026.
// NOT the cash report: dated by invoice date, includes unpaid invoices and bills, a standard inbound allowance and
// labelled estimates. Every number here is worked out by lib/profitability.js on the server; this screen only shows it
// and lets a person make the REPORT decisions (names that belong together, units, pricing basis, …).
// Nothing on this screen changes an invoice, a bill, inventory or the ledger.
// All colours are inline: the dark theme repaints the bg-white class, which is how the Stats table became unreadable.
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom'; // v55.83-UM — full screen above the Hub header
import WarehouseShippingPanel from './WarehouseShippingPanel'; // v55.83-TG
import { supabase } from '../lib/supabase'; // v55.83-TG
import InvoicePeek from './InvoicePeek'; // v55.83-VG — view the invoice from this page (edit opens the Invoices screen)
import { filterRowsBySearch } from '../lib/profitability-search'; // v55.83-VG — the search box
import { bucketOf, bucketsBetween, periodBreakdown, linesToFix } from '../lib/pnl-period';
import { expenseScope, expenseRequests, pendingRequests, loadExpensePeriods, totalExpenses, finalPnl } from '../lib/pnl-expenses'; // v55.83-VQ — expense columns and the final P&L per period
import { rtmAdjust, foldUnc } from './PeriodStatsTab'; // v55.83-VQ — the Income Statement's own real-cost rule (one copy) // v55.83-VL — P&L by period: periods and the breakdown of one period

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
// v55.83-TC (Max, Nov 16: "you need a bottom and side scroll bar to move within the square") — the Hub's dark theme draws 6 px white
// scroll bars, invisible on these white tables. These are grey, 14 px, always there.
var SCROLL_CSS = '.pl-scroll{scrollbar-width:auto;scrollbar-color:#94a3b8 #e2e8f0}.pl-scroll::-webkit-scrollbar{width:14px;height:14px}.pl-scroll::-webkit-scrollbar-track{background:#e2e8f0}.pl-scroll::-webkit-scrollbar-thumb{background:#94a3b8;border-radius:7px;border:3px solid #e2e8f0}.pl-scroll::-webkit-scrollbar-thumb:hover{background:#64748b}.pl-scroll::-webkit-scrollbar-corner{background:#e2e8f0}';
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pf(n) { return n === undefined ? '🔒 hidden' : '$' + fmt(n); } // v55.83-TG — profit hidden without 'P&L: See profit & margin'
function fmt0(n) { return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmt4(n) { return n === null || n === undefined ? '—' : '$' + Number(n).toFixed(4); }

var FLAG_WORDS = {
  basis_missing: 'Pricing basis not set (EXW / CNF / trucking included)',
  transport_not_separated: 'Transportation not separated from the price',
  release_missing: 'No release number on the invoice',
  release_split_missing: 'Invoice is on two releases — pounds per release not entered',
  unit_unknown: 'Unit not set (pounds, kilograms, tons, yards or linear metres)',
  cost_missing: 'Goods cost missing',
  cost_manual: 'Goods cost typed by hand',
  cost_assumed_before_first_purchase: 'Sold before our first supplier bill for it — cost taken from the first 90 days of purchases on record (assumed bought earlier at that price)', // v55.83-TJ
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
  two_trucking_bills_on_one_release: 'TWO trucking bills on one release (only one is allowed)',
  warehouse_cost_not_usable: 'The warehouse has this release but its shipping cost cannot be used yet (a part is missing, or two orders share the release)', // v55.83-TG
  basis_not_stated_on_invoice: 'The invoice does not say CNF or EXW — basis guessed by the rule, please check', // v55.83-TG
  headliner_and_foam: 'A line says both headliner and foam. It is counted as HEADLINER (1.25 lb per yard), not foam (3 lb) — fix the name if that is wrong', // v55.83-VQ
  foam_evidence_conflict: 'A line says both “no foam” and foam (product name vs description). It is counted as NOT foam (2.5 lb per yard) — fix the name if it is foam', // v55.83-UZ
  basis_assumed_from_shipping_line:'The invoice has a shipping line, so shipping is taken as charged on that line — NOT inside the goods price (Max’s rule). Set CNF/EXW on the invoice to confirm', // v55.83-TJ
  basis_exw_without_shipping_line: 'EXW, but the invoice has no shipping charge line and the warehouse shows shipping costs', // v55.83-TG
  basis_set_differs_from_invoice_text: 'The basis set in the Hub differs from what the invoice text says (CNF / EXW)', // v55.83-TG
  basis_invoice_says_both_cnf_and_exw: 'The invoice text mentions both CNF and EXW', // v55.83-TG
  own_transport_but_invoice_charges_shipping: 'Warehouse looks like customer’s own transport, but the invoice charges shipping', // v55.83-TG
  shipping_charged_below_cost_plus_7pct: 'Shipping charged on the invoice is less than our shipping cost + 7%', // v55.83-TG
  exw_but_shipping_cost_on_release: 'EXW with no shipping line, but we have a shipping cost on this release', // v55.83-TG
  cnf_separate_without_shipping_line: 'Set as “CNF, separate shipping line”, but the invoice has no shipping line', // v55.83-TG
  shipping_markup_not_checkable: 'Shipping line present, but our shipping cost is not known yet — the 7% check waits', // v55.83-TG
  invoice_shipping_estimates_differ: 'Invoices on the same release give different shipping-cost estimates — the largest is used', // v55.83-TG
  invoice_shipping_estimate_split_unresolved: 'An invoice on several releases has a shipping estimate, but a release has no pounds — it cannot be split, so it is not used' // v55.83-TG
};
var BASIS_WORDS = { EXW: 'EXW', CNF: 'CNF', TRUCKING_INCLUDED: 'Trucking included' };
var UNIT_WORDS = { lb: 'pounds', kg: 'kilograms', t: 'tons', yd: 'yards', lm: 'linear metres' }; // v55.83-TA — + tons (1 ton = 1,000 kg = 2,204.62 lb) // v55.83-SZ — + kilograms (1 kg = 2.20462 lb)
var COLS = [['goods_revenue', 'Goods revenue'], ['transport_revenue', 'Transport charged'], ['base_cost', 'Goods cost'], ['commission', 'Commission'], ['inbound_allowance', 'Inbound allowance'], ['outbound_cost', 'Outbound transport'], ['bonded', 'Bonded / brokerage']];

export default function ProfitabilityTab(props) {
  var userProfile = props.userProfile;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(''); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var sEF = useState(true); var onlyDiff = sEF[0]; var setOnlyDiff = sEF[1]; // v55.83-TG — Estimate vs Final: show only differences
  var s5 = useState('product'); var view = s5[0]; var setView = s5[1];
  // v55.83-VG (Max, Nov 19: "need a search on this page" · "click on the view invoice and see a copy of the invoice and edit it from there")
  var sQ = useState(''); var searchQ = sQ[0]; var setSearchQ = sQ[1];
  var sPk = useState(null); var peekId = sPk[0]; var setPeekId = sPk[1];
  var onGo = props.onGo || function () {};
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
  // v55.83-UI (Max, Nov 18: "more professional ... extra text on hover ... a scroll bar to move left to right ... show more of the screen")
  var sAb = useState(false); var showAbout = sAb[0]; var setShowAbout = sAb[1];
  var sFull = useState(false); var full = sFull[0]; var setFull = sFull[1];
  var topBar = useRef(null); var topInner = useRef(null); var tableBox = useRef(null); 
  // v55.83-UI (Max: "2 layers ... when we scroll the second layer that starts with invoice disappears") — the shipments header sticks
  // right UNDER the main header while its shipments are on screen; outerHead measures how tall the main header is
  var outerHead = useRef(null); var sHH = useState(44); var headH = sHH[0]; var setHeadH = sHH[1];
  useEffect(function () { // the top scroll bar is as wide as the table, so it moves it left / right from the top
    function size() { if (topInner.current && tableBox.current && topBar.current) { var tb = tableBox.current; topInner.current.style.width = Math.max(0, tb.scrollWidth - tb.clientWidth + topBar.current.clientWidth) + 'px'; } if (outerHead.current) { var hh = outerHead.current.offsetHeight || 44; if (hh !== headH) { setHeadH(hh); } } }
    size(); var t = setTimeout(size, 300); window.addEventListener('resize', size);
    return function () { clearTimeout(t); window.removeEventListener('resize', size); };
  });
  useEffect(function () { if (!full) { return undefined; } function esc(e) { if (e.key === 'Escape') { setFull(false); } } window.addEventListener('keydown', esc); return function () { window.removeEventListener('keydown', esc); }; }, [full]);
  // v55.83-VQ (Max, Nov 19: in full screen, “type it” / identifying a product "takes me to a screen where I can't move. I'm frozen") —
  // those buttons open Containers or Set-up, which have no full-screen table and no Exit button, while full screen stayed ON and
  // kept the page locked. Full screen now ends the moment the view is one that has no full-screen table.
  var FULL_VIEWS = ['product', 'customer', 'invoice', 'period'];
  useEffect(function () { if (full && FULL_VIEWS.indexOf(view) < 0) { setFull(false); } }, [view, full]);
  // v55.83-UM (Codex UI P2) — no guard flag: copy the left position only when it differs, so a vertical-only scroll can never
  // swallow the next horizontal move; the copied scroll fires back once, finds the positions equal and stops
  function syncFrom(src, dst) { if (!src.current || !dst.current) { return; } var x = src.current.scrollLeft; if (Math.abs(dst.current.scrollLeft - x) < 1) { return; } dst.current.scrollLeft = x; }
  // full screen: the page behind does not scroll, the focus moves to the exit button and comes back after
  var fullBtn = useRef(null);
  useEffect(function () { if (fullBtn.current) { try { fullBtn.current.focus(); } catch (eF) {} } if (!full) { return undefined; } var prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return function () { document.body.style.overflow = prev; }; }, [full]);
  var s16 = useState('month'); var pGran = s16[0]; var setPGran = s16[1]; // v55.83-TN — P&L by period: week / month / quarter / year
  var s18 = useState(null); var pOpen = s18[0]; var setPOpen = s18[1];
  var s17 = useState('all'); var pPre = s17[0]; var setPPre = s17[1]; // v55.83-TN — release prefix: all / 1001 / 1002 / 1003 / other
  // v55.83-VQ (Max, Nov 19: "where are the rest of the columns and the total final pnl per month") — each period's expenses come from
  // the Income Statement (period_stats), asked for exactly the days of that period that are INSIDE this report. The rules of what is
  // asked, what an answer means and what the total is are in src/lib/pnl-expenses.js (tested); this only keeps the answers.
  // (Codex 22:20 / 22:35): the dates are the report's own; every period of the report is asked, also one with no sales; a new
  // report, grouping or person throws the old answers away and ignores late ones; a failed period can be asked again.
  var s19 = useState({}); var pExp = s19[0]; var setPExp = s19[1];
  var s20 = useState({ from: '', to: '' }); var applied = s20[0]; var setApplied = s20[1]; // the dates the report on screen was loaded with
  var expGen = useRef(0); var expAuto = useRef(-1);
  var todayIso = new Date().toISOString().substring(0, 10);
  var floorIso = (data && data.window_floor) || '';
  var effFrom = applied.from && floorIso && floorIso > applied.from ? floorIso : (applied.from || floorIso || '');
  var effTo = applied.to && applied.to < todayIso ? applied.to : todayIso;
  var expScope = expenseScope(pGran, effFrom, effTo, userProfile && userProfile.id);
  function periodKeys() { // every period of the report: the ones with sales AND every period between its two dates
    var seen = {}; var keys = [];
    bucketsBetween(effFrom, effTo, pGran).forEach(function (b0) { if (!seen[b0.key]) { seen[b0.key] = true; keys.push(b0.key); } });
    ((data && data.cells) || []).forEach(function (c) { var b1 = bucketOf(c.invoice_date, pGran); if (b1.key !== 'zz' && !seen[b1.key]) { seen[b1.key] = true; keys.push(b1.key); } });
    return keys.sort();
  }
  function startExpenses(opts) {
    var reqs = pendingRequests(expenseRequests(periodKeys(), pGran, effFrom, effTo), pExp, expScope, opts);
    if (!reqs.length) { return; }
    var gen = expGen.current; var scope = expScope;
    loadExpensePeriods({ requests: reqs, adjust: rtmAdjust, fold: foldUnc,
      isCurrent: function () { return expGen.current === gen; },
      put: function (k, res) { if (expGen.current !== gen) { return; } setPExp(function (prev) { var nx = Object.assign({}, prev); nx[scope + '|' + k] = res; return nx; }); },
      fetchOne: function (q) { return fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'period_stats', from: q.from, to: q.to, user_id: userProfile && userProfile.id }) }).then(function (r) { return r.json(); }); } });
  }
  // a new report, another grouping or another person: the answers kept so far no longer apply
  useEffect(function () { expGen.current += 1; setPExp({}); }, [data, pGran, userProfile && userProfile.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 13 periods or fewer load by themselves, once per report; more than that wait for the “Load expenses” button (same loader)
  useEffect(function () {
    if (view !== 'period' || pPre !== 'all' || !data || !data.cells) { return; }
    if (expAuto.current === expGen.current) { return; }
    if (periodKeys().length > 13) { return; }
    expAuto.current = expGen.current; startExpenses({ ignoreCache: true });
  }, [view, pGran, pPre, data, applied]); // eslint-disable-line react-hooks/exhaustive-deps

  function call(payload) {
    // v55.83-TG — the server checks the sign-in token itself (it no longer trusts the user id in the request)
    return supabase.auth.getSession().then(function (sres) {
      var token = sres && sres.data && sres.data.session ? sres.data.session.access_token : '';
      return fetch('/api/accounting/profitability', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) });
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load(f, t) {
    setBusy(true);
    call({ action: 'report', date_from: (f === undefined ? from : f) || null, date_to: (t === undefined ? to : t) || null }).then(function (j) {
      if (!j || j.ok !== true) { toast.error((j && j.error) || 'The report did not load.'); return; }
      setData(j); setApplied({ from: (f === undefined ? from : f) || '', to: (t === undefined ? to : t) || '' });
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { load('2026-06-01', ''); }, []);
  function act(payload, okMsg) {
    setBusy(true);
    return call(payload).then(function (j) {
      if (j && j.ok) { if (j.message || okMsg) { toast.success(j.message || okMsg); } load(); return true; } // TB — the server says when it merged into an existing product
      toast.error((j && j.error) || 'Not saved.'); setBusy(false); return false;
    });
  }
  function d(k, v) { var o = Object.assign({}, draft); o[k] = v; setDraft(o); }

  var canEdit = !!(data && data.can_edit);
  var box = { background: '#ffffff', color: INK, border: '1px solid ' + LINE };
  var th = { background: '#0f172a', color: '#ffffff' };
  var inp = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };
  // v55.83-UM (Codex UI P2) — every amber dot / dash is a small button: hover shows the words, and Tab + Enter or a tap shows them too
  function explain(tip) { var t = String(tip || 'Part of this amount is still missing.'); if (toast.info) { toast.info(t); } else { toast.success(t); } }
  function dot(tip) { var t = tip || 'Only part of this amount is known — part missing'; return <button type="button" aria-label={t} title={t} onClick={function (e) { e.stopPropagation(); explain(t); }} style={{ display: 'inline-block', width: 13, height: 13, borderRadius: 7, background: '#f59e0b', backgroundClip: 'content-box', padding: 3, marginLeft: 2, verticalAlign: 'middle', cursor: 'help', border: 0 }} />; }
  function dash(tip) { return <button type="button" aria-label={tip} title={tip} onClick={function (e) { e.stopPropagation(); explain(tip); }} style={{ color: '#b45309', fontWeight: 700, cursor: 'help', background: 'transparent', border: 0, padding: '0 2px' }}>—</button>; }
  function money(row, f) {
    if (row.unknown_fields && row.unknown_fields.indexOf(f) >= 0) { // v55.83-TB (Max: "looks so awful") — the known amount plainly, a small note that part is missing
      // v55.83-UI — no text in the cell: the known number with an amber dot; the words are on hover
      if ((Number(row[f]) || 0) === 0) { return dash('Missing — nothing is known yet for this amount'); }
      return <span>{'$' + fmt(row[f])}{dot()}</span>;
    }
    return '$' + fmt(row[f]);
  }
  // v55.83-TJ (Max, Nov 17: "not sure what these messages mean. they need to be more meaningful and maybe link us directly to where
  // we make the update or change") — every reason a cost is missing, in plain words, with a button that opens the exact place to fix it
  function costHelp(w) {
    var why = String(w.why || ''); var first = (why.match(/first one: ([0-9-]+)/) || [])[1] || '';
    var sold = w.first_sale ? (w.sales > 1 ? 'Sold from ' : 'Sold on ') + w.first_sale : 'Sold';
    if (why === 'unit not set') { return { text: 'We don’t know if this is sold by the lb, kg or ton, so it has no pounds.', fix: 'Set the unit', go: 'names' }; }
    if (why === 'not in a product group') { return { text: 'This description is not part of a product yet, so no supplier bills are tied to it.', fix: 'Put it in a product', go: 'names' }; }
    if (why === 'no supplier description linked') { return { text: 'Nobody has said which supplier bills are what we pay for this product.', fix: 'Link supplier bills', go: 'link' }; }
    if (why === 'a linked supplier bill line has no cost') { return { text: 'One of its supplier bill lines has no amount, so the cost can’t be worked out.', fix: 'See its supplier bills', go: 'group' }; }
    if (why === 'a weight on the invoice is missing') { return { text: 'Another line on the same invoice has no unit, so the invoice can’t be split by weight.', fix: 'Set the unit', go: 'names' }; }
    if (why.indexOf('have no bill lines') >= 0) { return { text: 'The supplier descriptions linked to it have no bills in the Hub yet.', fix: 'Link other supplier bills', go: 'link' }; }
    if (why.indexOf('have no unit') >= 0) { return { text: 'Its supplier bill lines don’t say lb, kg or ton.', fix: 'See its supplier bills', go: 'group' }; }
    if (why.indexOf('no linked purchase dated on or before') >= 0) { return { text: sold + ', but the first supplier bill we have for it is dated ' + (first || '?') + ' — there is no purchase before the sale to take the cost from. Link the older supplier bill, or type a cost per lb.', fix: 'Link an older bill or type a cost', go: 'group' }; }
    return { text: why, fix: 'Open the set-up', go: 'names' };
  }
  function goFix(go, gid, name) {
    setView('setup'); setOpen(null);
    if (go === 'names' && name) { setNameQ(name); }
    if (go === 'link' && gid) { setLinkFor(gid); setBillPick({}); setBillQ(''); }
    var target = go === 'names' ? 'pl-setup-names' : (gid ? 'pl-group-' + gid : 'pl-setup-groups');
    setTimeout(function () { var el = document.getElementById(target); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.style.outline = '3px solid #f59e0b'; setTimeout(function () { el.style.outline = ''; }, 3000); } }, 200);
  }
  function fixChip(list, fallbackGid) { // v55.83-UI — reasons on hover; one small button opens the place to fix it
    if (!list || !list.length) { return null; }
    var tip = list.map(function (w) { return (w.sales > 1 ? w.sales + ' sales: ' : '') + costHelp(w).text; }).join('\n');
    var w0 = list[0]; var h0 = costHelp(w0); var gid0 = w0.group_id || fallbackGid || null;
    return <div className="mt-0.5"><button title={tip + (canEdit ? '\n\nClick: ' + h0.fix : '')} aria-label={canEdit ? h0.fix + ': ' + tip : 'Why the cost is missing: ' + tip} onClick={function (e) { e.stopPropagation(); if (canEdit) { goFix(h0.go, gid0, (w0.names || [])[0]); } else { explain(tip); } }} className="px-1.5 py-0.5 rounded font-bold" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', fontSize: 10, cursor: canEdit ? 'pointer' : 'help' }}>{canEdit ? '⚠ ' + h0.fix : '⚠ why?'}</button></div>;
  }
  function costHelpBlock(list, fallbackGid) {
    if (!list || !list.length) { return null; }
    return <div className="text-left" style={{ color: '#92400e', fontSize: 10, lineHeight: 1.25, minWidth: 200, maxWidth: 260, whiteSpace: 'normal' }}>{list.slice(0, 3).map(function (w, ix) {
      var h = costHelp(w); var gid = w.group_id || fallbackGid || null;
      return <div key={ix} className="mt-1"><b>{w.sales > 1 ? w.sales + ' sales: ' : ''}</b>{h.text}
        {canEdit && <div><button onClick={function (e) { e.stopPropagation(); goFix(h.go, gid, (w.names || [])[0]); }} className="mt-0.5 px-1.5 py-0.5 rounded font-extrabold" style={{ background: '#b45309', color: '#ffffff', fontSize: 10 }}>{'→ ' + h.fix}</button></div>}</div>; })}</div>;
  }
  function cellMoney(v) { return v === null || v === undefined ? <span style={{ color: '#b45309', fontWeight: 800 }}>unknown</span> : '$' + fmt(v); }
  function statusChip(row) {
    if (row.complete) { return <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#d1fae5', color: '#065f46' }}>COMPLETE</span>; }
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#fef3c7', color: '#78350f' }}>{row.estimate ? 'ESTIMATE / INCOMPLETE' : 'INCOMPLETE'}</span>;
  }
  function Btn(p) { return <button onClick={p.onClick} disabled={p.disabled || busy} title={p.title} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={Object.assign({ background: p.bg || '#f1f5f9', color: p.color || '#334155', opacity: (p.disabled || busy) ? 0.5 : 1 }, p.style || {})}>{p.children}</button>; }

  // ── drill-down: the cells behind a row ──
  function cellsTable(cells, invoiceRow, nested) {
    // nested (inside a report table): no scroll box of its own, so its header sticks against the report's scroll box, under the main header
    return <div className={(nested ? '' : 'overflow-auto pl-scroll ') + 'rounded nt-solid-head'} style={nested ? { border: '1px solid #7dd3fc' } : { border: '1px solid #cbd5e1', maxHeight: '55vh' }}>
      <table className="w-full text-[10px]" style={{ minWidth: 1500 }}>
        <thead style={{ top: nested ? headH : 0, zIndex: 4 }}><tr>{['Invoice', 'Customer', 'Release', 'Original description', 'Original qty', 'Pounds', 'Goods revenue', '$ / lb', 'Transport charged', 'Goods cost', 'Cost from', 'Commission', 'Inbound', 'Bonded / brokerage', 'Goods profit', 'Trucking (our cost)', 'Freight / shipping (our cost)', 'Transport profit', 'Total profit', 'Needs attention'].map(function (h) { return <th key={h} className="px-1.5 py-1 text-left font-bold nt-th-sub" style={th}>{h}</th>; })}</tr></thead>
        <tbody>{cells.map(function (c, i) {
          return <tr key={c.invoice_id + ':' + c.line_id + ':' + c.release + ':' + i} style={{ background: i % 2 ? '#f8fafc' : '#ffffff', color: INK, borderTop: '1px solid ' + LINE }}>
            <td className="px-1.5 py-1 font-bold">{c.invoice}<div style={{ color: SUB }}>{c.invoice_date}</div></td>
            <td className="px-1.5 py-1">{c.customer}</td>
            <td className="px-1.5 py-1">{c.release_raw || <span style={{ color: '#b45309' }}>none</span>}<div style={{ color: c.origin ? SUB : '#b45309' }}>{c.origin || 'origin unknown'}</div></td>
            <td className="px-1.5 py-1">{c.description}</td>
            <td className="px-1.5 py-1 text-right">{fmt(c.orig_qty) + ' ' + (c.orig_unit ? (UNIT_WORDS[c.orig_unit] || c.orig_unit) : '')}<div style={{ color: SUB }}>{'@ $' + Number(c.orig_unit_price || 0).toFixed(4) + (c.unit_factor && c.unit_factor !== 1 ? ' · ×' + c.unit_factor : '')}</div></td>
            <td className="px-1.5 py-1 text-right font-bold">{c.pounds === null ? <span style={{ color: '#b45309' }}>unit not set</span> : fmt0(c.pounds)}</td>
            <td className="px-1.5 py-1 text-right">{c.embedded_transport > 0 && c.goods_revenue !== null ? <span>{'$' + fmt(c.goods_revenue)}<button type="button" title={'On invoice $' + fmt(c.invoiced) + '\n− shipping inside the price $' + fmt(c.embedded_transport) + '\n= goods revenue $' + fmt(c.goods_revenue)} aria-label={'On invoice $' + fmt(c.invoiced) + '\n− shipping inside the price $' + fmt(c.embedded_transport) + '\n= goods revenue $' + fmt(c.goods_revenue)} onClick={function (e) { e.stopPropagation(); explain('On invoice $' + fmt(c.invoiced) + '\n− shipping inside the price $' + fmt(c.embedded_transport) + '\n= goods revenue $' + fmt(c.goods_revenue)); }} className="ml-1 px-1 rounded font-bold" style={{ fontSize: 8, background: '#e2e8f0', color: '#475569', verticalAlign: 'middle', border: 0, cursor: 'help' }}>CNF</button></span> : cellMoney(c.goods_revenue)}{!c.goods_price_confirmed && <div style={{ color: '#b45309' }}>not confirmed</div>}</td>
            <td className="px-1.5 py-1 text-right">{c.pounds > 0 && c.goods_revenue !== null && c.goods_price_confirmed ? fmt4(c.goods_revenue / c.pounds) : '—'}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.transport_revenue)}<div style={{ color: SUB }}>{c.transport_source || ''}</div></td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.base_cost)}<div style={{ color: SUB }}>{c.base_cost_per_lb !== null ? fmt4(c.base_cost_per_lb) + ' / lb' : ''}</div>{c.cost_missing_reason ? costHelpBlock([{ why: c.cost_missing_reason, sales: 1, group_id: c.group_id, first_sale: c.invoice_date, names: [c.description] }]) : null}</td>
            <td className="px-1.5 py-1" title={(c.cost_sources || []).map(function (s) { return (s.vendor || '') + ' ' + (s.bill_number || '') + ' · ' + (s.bill_date || '') + ' · ' + s.description + ' · ' + fmt0(s.pounds) + ' lb · $' + (s.cost === null ? '?' : fmt(s.cost)); }).join('\n')}>
              {c.cost_method === 'manual' ? <span style={{ color: '#7c2d12', fontWeight: 700 }}>{'typed by hand (' + (c.cost_level || 'sale') + ')' + (c.cost_note ? ' — ' + c.cost_note : '')}</span> : null}
              {c.cost_method === 'manual' ? null : c.cost_method === 'release' ? 'bill on the same release' : c.cost_method === 'window' ? 'bills in the 90 days before' : c.cost_method === 'last_purchase' ? 'last purchase before' : c.cost_method === 'assumed_earliest' ? <span style={{ color: '#7c2d12', fontWeight: 700 }}>{'assumed: sold before our first bill (' + (c.cost_first_purchase || '?') + ') — price of the first 90 days'}</span> : c.cost_method === 'manual' ? 'typed by hand' : <span style={{ color: '#b45309' }}>none</span>}
              {canEdit && c.line_id && c.pounds !== null && (c.base_cost === null || c.cost_method === 'assumed_earliest' || (c.cost_method === 'manual' && c.cost_level === 'sale')) && <div className="mt-0.5 flex gap-1 items-center flex-wrap" onClick={function (e) { e.stopPropagation(); }}>
                <span>$</span><input value={draft['lc:' + c.line_id] !== undefined ? draft['lc:' + c.line_id] : (c.cost_method === 'manual' ? String(c.base_cost_per_lb) : '')} onChange={function (e) { d('lc:' + c.line_id, e.target.value); }} placeholder="cost / lb" className="nt-light rounded px-1 text-[10px]" style={Object.assign({ width: 64 }, inp)} title="Goods cost per POUND for this sale" />
                <span>+</span><input value={draft['lm:' + c.line_id] !== undefined ? draft['lm:' + c.line_id] : (c.cost_method === 'manual' ? String(c.commission_per_lb || 0) : '')} onChange={function (e) { d('lm:' + c.line_id, e.target.value); }} placeholder="comm. / lb" className="nt-light rounded px-1 text-[10px]" style={Object.assign({ width: 64 }, inp)} title="Commission per pound (0 if none)" />
                <button disabled={busy || !data.manual_costs_ready} onClick={function () { act({ action: 'set_manual_cost', level: 'line', invoice_item_id: c.line_id, cost_per_lb: draft['lc:' + c.line_id] === undefined ? (c.cost_method === 'manual' ? c.base_cost_per_lb : '') : draft['lc:' + c.line_id], commission_per_lb: draft['lm:' + c.line_id] === undefined ? (c.cost_method === 'manual' ? c.commission_per_lb : '') : draft['lm:' + c.line_id] }, 'Cost for this sale saved (typed by hand).'); }} className="px-1.5 rounded text-[10px] font-extrabold" style={{ background: '#7c2d12', color: '#ffffff' }} title={data.manual_costs_ready ? 'Save this cost for this sale only. Leave the cost empty and save to remove it.' : 'Run sql/v55-83-SY-profitability.sql in Supabase once more to turn this on'}>save</button>
              </div>}
              {(c.cost_sources || []).length > 0 && <div style={{ color: SUB }}>{(c.cost_sources || []).slice(0, 3).map(function (s) { return s.bill_number || '?'; }).join(', ') + ((c.cost_sources || []).length > 3 ? ' +' + ((c.cost_sources || []).length - 3) : '')}</div>}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.commission)}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.inbound_allowance)}</td>
            <td className="px-1.5 py-1 text-right">{cellMoney(c.bonded)}{c.bonded_from && <div style={{ color: SUB, fontSize: 9 }}>{c.bonded_from}</div>}</td>
            <td className="px-1.5 py-1 text-right font-extrabold">{c.goods_profit === null ? <span style={{ color: "#b45309" }}>unknown</span> : pf(c.goods_profit)}</td>
            <td className="px-1.5 py-1 text-right">{c.trucking_cost === null ? <span style={{ color: '#b45309' }}>none yet</span> : '$' + fmt(c.trucking_cost)}<div style={{ color: c.trucking_kind === 'bill' ? SUB : '#b45309', fontSize: 9 }}>{c.trucking_from || ''}</div></td>
            <td className="px-1.5 py-1 text-right">{c.freight_cost === null ? <span style={{ color: '#b45309' }}>none yet</span> : '$' + fmt(c.freight_cost)}<div style={{ color: c.freight_kind === 'bill' ? SUB : '#b45309', fontSize: 9 }}>{c.freight_from || ''}</div></td>
            <td className="px-1.5 py-1 text-right">{c.transport_profit === undefined ? "🔒" : c.transport_profit === null ? <span style={{ color: "#b45309" }}>unknown</span> : "$" + fmt(c.transport_profit)}</td>
            <td className="px-1.5 py-1 text-right font-extrabold" style={{ color: c.complete ? (c.profit >= 0 ? '#065f46' : '#7f1d1d') : '#78350f' }}>{pf(c.profit)}<div className="font-bold">{c.complete ? 'complete' : 'known part only'}</div></td>
            <td className="px-1.5 py-1" style={{ color: '#92400e' }}>{(c.flags || []).filter(function (f, ix, arr) { return arr.indexOf(f) === ix; }).map(function (f) { return <div key={f}>{'• ' + (FLAG_WORDS[f] || f)}</div>; })}
              {invoiceRow && canEdit && <div className="mt-0.5"><select value={c.orig_unit || ''} onChange={function (e) { act({ action: 'set_line_unit', invoice_item_id: c.line_id, unit: e.target.value }, 'Unit of this one line saved.'); }} className="nt-light rounded text-[10px]" style={inp} title="Unit of THIS line only (overrides the unit of the description)">
                <option value="">line unit: as the description</option><option value="lb">this line: pounds</option><option value="kg">this line: kilograms</option><option value="t">this line: tons</option><option value="yd">this line: yards</option><option value="lm">this line: linear metres</option></select></div>}</td>
          </tr>;
        })}</tbody>
      </table></div>;
  }

  // ── what a person sets for ONE invoice (report only) ──
  // v55.83-TE — a customer's usual pricing basis (Maa Kirpa: always CNF)
  function customerPanel(row, cs) {
    var cid = cs.length ? cs[0].customer_id : null; if (!cid) { return null; }
    var cur = null; (data.customer_basis || []).forEach(function (x) { if (x.customer_id === cid) { cur = x.basis; } });
    return <div className="rounded-lg p-2 mb-2 flex gap-2 items-center flex-wrap" style={{ background: '#eff6ff', border: '1px solid #93c5fd', color: '#1e3a8a' }}>
      <span className="text-[11px] font-extrabold">{row.label + '’s usual pricing basis:'}</span>
      {['EXW', 'CNF', 'TRUCKING_INCLUDED'].map(function (b0) { var on = cur === b0;
        return <button key={b0} disabled={!canEdit || busy || !data.customer_terms_ready} onClick={function () { act({ action: 'set_customer_basis', customer_id: cid, customer_name: row.label, basis: on ? '' : b0 }, on ? 'Usual basis removed for ' + row.label + '.' : row.label + ' is now usually ' + BASIS_WORDS[b0] + '. Every invoice of theirs without its own basis uses it.'); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={on ? { background: '#1d4ed8', color: '#ffffff' } : { background: '#ffffff', color: '#1e3a8a', border: '1px solid #93c5fd' }}>{(on ? '✓ ' : '') + BASIS_WORDS[b0]}</button>; })}
      <span className="text-[10px]">{data.customer_terms_ready ? 'Used for every invoice of this customer that has no basis of its own. Click again to remove.' : 'Run sql/v55-83-SY-profitability.sql in Supabase once more to turn this on.'}</span>
    </div>;
  }
  // v55.83-TE — every container (release) in the period and what its shipping cost
  // v55.83-TG (Max, Nov 16 workflow) — one part (freight or trucking): estimate → bill (final) → difference
  function partText(pp, rel, partName) {
    if (!pp) { return <span style={{ color: SUB }}>—</span>; }
    return <div>
      <div>{'est. ' + (pp.estimate === null ? 'missing' : '$' + fmt(pp.estimate))}{pp.estimate_from ? <span style={{ color: SUB }}>{' (' + pp.estimate_from + ')'}</span> : null}</div>
      <div style={{ fontWeight: 800, color: pp.bill !== null ? '#166534' : '#b45309' }}>{pp.bill !== null ? 'BILLED $' + fmt(pp.bill) + ' — final' : 'no bill yet — estimate used'}</div>
      {pp.differs && <div style={{ color: '#b91c1c', fontWeight: 800 }}>{'⚠ difference ' + (pp.difference > 0 ? '+' : '') + '$' + fmt(pp.difference)}</div>}
      {pp.payment_differs_from_bill && <div style={{ color: '#b91c1c', fontWeight: 700 }}>{'⚠ warehouse payment $' + fmt(pp.warehouse_payment) + ' ≠ bill'}</div>}
      {partInput(rel, partName, pp)}
    </div>;
  }
  // v55.83-TL (Max, Nov 17: "we should manually be able to enter it, and then it gets overridden if you have a bill ... for that
  // specific release number") — type trucking or freight for ONE release; the bill for that part replaces it when it is in the Hub
  // v55.83-TL — one outbound part on a report row: the number when known (even if the other part is not), else a plain note + the way to fix it
  function partCell(r, f, word) {
    var unk = r.unknown_fields && r.unknown_fields.indexOf(f) >= 0; var v = Number(r[f]) || 0;
    var go = <div><button onClick={function (e) { e.stopPropagation(); setView('containers'); setOpen(null); }} className="mt-0.5 px-1.5 py-0.5 rounded font-bold" title="Open Containers to type it" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', fontSize: 10 }}>⚠ type it</button></div>;
    if (!unk) { return '$' + fmt(v); }
    if (v === 0) { return <span>{dash('No ' + word + ' bill, Nextrade figure or typed amount yet.')}{canEdit && go}</span>; }
    return <span>{'$' + fmt(v)}{dot('Some containers have no ' + word + ' yet — only the known part is shown')}</span>;
  }
  function partInput(rel, partName, pp) {
    if (!canEdit || !rel || !partName) { return null; }
    if (pp && pp.bill !== null) { return null; }
    var k = 'pe:' + rel + ':' + partName;
    if (!data.part_estimates_ready) { return <div style={{ color: SUB, fontSize: 10 }}>Run sql/v55-83-TL-trucking-freight.sql in Supabase to type it here.</div>; }
    return <div className="mt-0.5 flex gap-1 items-center flex-wrap" onClick={function (e) { e.stopPropagation(); }}>
      <span style={{ fontSize: 10 }}>type $</span>
      <input value={draft[k] !== undefined ? draft[k] : (pp && pp.typed !== null && pp.typed !== undefined ? String(pp.typed) : '')} onChange={function (e) { d(k, e.target.value); }} placeholder={partName === 'trucking' ? 'trucking' : 'freight'} className="nt-light px-1.5 py-0.5 rounded text-[10px]" style={Object.assign({ width: 76 }, inp)} title="Used for this release until its bill is in the Hub. Empty + save removes it." />
      <Btn onClick={function () { act({ action: 'set_part_estimate', release: rel, part: partName, amount: draft[k] === undefined ? (pp && pp.typed !== null && pp.typed !== undefined ? pp.typed : '') : draft[k] }, (partName === 'trucking' ? 'Trucking' : 'Freight') + ' saved for ' + rel + '. The bill replaces it when it arrives.').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[k]; setDraft(o); } }); }}>save</Btn>
    </div>;
  }
  // v55.83-TN (Max, Nov 17: "I need to see what the P&L was for the month, week, quarter, year or custom — for the goods and then for
  // the transportation, and between 1001 or 1002 or 1003 (by what the release number starts with)") — the SAME lines as the rest of this
  // report (so the numbers agree), summed per week / month / quarter / year of the invoice date, goods and transport side by side.
  function setRange(kind) {
    var now = new Date(); var y = now.getFullYear(); var m = now.getMonth(); var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var iso = function (dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); };
    var f = null;
    if (kind === 'week') { var dw = (now.getDay() + 6) % 7; f = new Date(y, m, now.getDate() - dw); setPGran('week'); }
    if (kind === 'month') { f = new Date(y, m, 1); setPGran('week'); }
    if (kind === 'quarter') { f = new Date(y, m - (m % 3), 1); setPGran('month'); }
    if (kind === 'year') { f = new Date(y, 0, 1); setPGran('month'); }
    if (!f) { return; }
    var fs0 = iso(f); var ts0 = iso(now); setFrom(fs0); setTo(ts0); load(fs0, ts0);
  }
  function prefixOf(c) { var m0 = String(c.release_raw || '').match(/^\s*(\d{4})\s*-/); return m0 ? m0[1] : ''; }
  function periodView() {
    var cells = (data.cells || []).filter(function (c) { var p0 = prefixOf(c); return pPre === 'all' || (pPre === 'other' ? ['1001', '1002', '1003'].indexOf(p0) < 0 : p0 === pPre); });
    var F = ['goods_revenue', 'goods_cost', 'goods_profit', 'transport_revenue', 'trucking_cost', 'freight_cost', 'transport_profit', 'profit', 'uncounted_revenue'];
    var hidden = cells.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; });
    function add(row, c) {
      row.lines++; row.pounds += Number(c.pounds) || 0;
      var gc = [c.base_cost, c.commission, c.inbound_allowance, c.brokerage, c.bonded];
      var v = { goods_revenue: c.goods_revenue, goods_cost: gc.some(function (x) { return x === null || x === undefined; }) ? null : gc.reduce(function (s0, x) { return s0 + Number(x); }, 0), goods_profit: c.goods_profit,
        transport_revenue: c.transport_revenue, trucking_cost: c.trucking_cost, freight_cost: c.freight_cost, transport_profit: c.transport_profit, profit: c.profit, uncounted_revenue: c.uncounted_revenue || 0 };
      F.forEach(function (f) { if (v[f] === null || v[f] === undefined) { row.miss[f] = (row.miss[f] || 0) + 1; } else { row[f] += Math.round(Number(v[f]) * 100); } });
      if (!c.complete) { row.incomplete++; }
      if (c.uncounted_lines) { row.uncounted++; }
    }
    // v55.83-UD — total profit is ALWAYS goods profit + transport profit (each over the lines whose costs are known)
    function settle(r) { r.profit = r.goods_profit + r.transport_profit; return r; }
    function blank(key, label) { var r = { key: key, label: label, lines: 0, pounds: 0, incomplete: 0, uncounted: 0, miss: {} }; F.forEach(function (f) { r[f] = 0; }); return r; }
    var by = {}; var tot = blank('total', 'Total');
    cells.forEach(function (c) { var b = bucketOf(c.invoice_date, pGran); var r = by[b.key] || (by[b.key] = blank(b.key, b.label)); add(r, c); add(tot, c); });
    // v55.83-VQ (Codex 22:20) — every period between the report's two dates has a row, also one with no sales (its expenses still count)
    bucketsBetween(effFrom, effTo, pGran).forEach(function (b0) { if (!by[b0.key]) { by[b0.key] = blank(b0.key, b0.label); } });
    var rows = Object.keys(by).sort().map(function (k) { return settle(by[k]); }); settle(tot);
    function cell(r, f, isProfit) {
      if (isProfit && hidden) { return '🔒'; }
      var v = r[f] / 100; var miss = r.miss[f] || 0;
      return <span>{(v < 0 ? '−$' : '$') + fmt(Math.abs(v))}{miss > 0 && (r.key === 'total' ? <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>{miss + ' sale line(s) missing this'}</div> : <button onClick={function (e) { e.stopPropagation(); setPOpen(r.key); }} title="Show these sale lines and how to fix them" style={{ display: 'block', marginLeft: 'auto', color: '#b45309', fontSize: 9, fontWeight: 800, textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{miss + ' missing — see & fix'}</button>)}</span>;
    }
    function pct(a, b) { return hidden ? '🔒' : (b ? (Math.round(a / b * 1000) / 10) + '%' : '—'); }
    function csv() {
      var head = ['Period', 'Lines', 'Pounds', 'Goods revenue', 'Goods cost (goods + commission + inbound + bonded)', 'Goods profit', 'Goods margin %', 'Transport charged', 'Trucking (our cost)', 'Freight (our cost)', 'Transport profit', 'Total profit (goods + transport)', 'Revenue not counted (cost unknown)', 'Lines not complete', 'Expense dates', 'A Warehouse / Office', 'C Partner fee', 'D Payroll', 'E Taxes', 'Uncategorized expenses (not taken off)', 'FINAL P&L (total profit − A − C − D − E)', 'Final P&L complete?'];
      var lines = [head].concat(rows.concat([tot]).map(function (r) { return [r.label, r.lines, Math.round(r.pounds), r.goods_revenue / 100, r.goods_cost / 100, hidden ? '' : r.goods_profit / 100, hidden ? '' : (r.goods_revenue ? Math.round(r.goods_profit / r.goods_revenue * 1000) / 10 : ''), r.transport_revenue / 100, r.trucking_cost / 100, r.freight_cost / 100, hidden ? '' : r.transport_profit / 100, hidden ? '' : r.profit / 100, r.uncounted_revenue / 100, r.incomplete].concat((function () {
        // the expense columns of the CSV follow the screen exactly: empty when not shown there (other release filter, locked, not loaded, total incomplete)
        var e = expOn ? expOf(r) : null; var isTot = r.key === 'total';
        if (!e || e.status !== 'ok') { return [e && e.from ? e.from + ' to ' + e.to : '', '', '', '', '', '', '', expOn ? (e ? (e.why || e.status) : 'not loaded') : 'expenses are shown with Releases: All']; }
        var f = (hidden || (isTot && !e.complete)) ? { cents: null, complete: false } : finalPnl(r.profit, e.cols, (r.incomplete || 0) + (r.uncounted || 0));
        return [isTot ? (e.loaded + ' of ' + e.periods + ' periods') : e.from + ' to ' + e.to, e.cols.A.cents / 100, e.cols.C.cents / 100, e.cols.D.cents / 100, e.cols.E.cents / 100, e.cols.unassigned.cents / 100, f.cents === null ? '' : f.cents / 100, f.cents === null ? 'not shown' : (f.complete ? 'yes' : 'known part only')];
      })()); }));
      var text = lines.map(function (l) { return l.map(function (x) { var t0 = String(x === null || x === undefined ? '' : x); return /[",\n]/.test(t0) ? '"' + t0.replace(/"/g, '""') + '"' : t0; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'pnl-by-' + pGran + '-' + (pPre === 'all' ? 'all' : pPre) + '-' + (from || 'start') + '-to-' + (to || 'today') + '.csv'; a.click();
    }
    function money(c) { return c === null || c === undefined ? '🔒' : (c < 0 ? '−$' : '$') + fmt(Math.abs(c / 100)); }
    function breakdownPanel(r, cs) {
      var bd = periodBreakdown(cs);
      function side(group, title, color) {
        return <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <div className="font-extrabold text-[11px] mb-1" style={{ color: color }}>{title}</div>
          <table className="w-full text-[11px]" style={{ background: '#ffffff', border: '1px solid ' + LINE }}><tbody>{bd.categories.filter(function (x) { return x.group === group; }).map(function (x) {
            var isP = x.kind === 'profit';
            return <tr key={x.key} style={{ borderTop: '1px solid ' + LINE, fontWeight: isP ? 800 : 400, background: isP ? '#ecfdf5' : '#ffffff', color: INK }}>
              <td className="px-2 py-1">{(x.kind === 'out' ? '− ' : x.kind === 'in' ? '+ ' : '= ') + x.label}</td>
              <td className="px-2 py-1 text-right tabular-nums" style={isP && x.cents !== null ? { color: x.cents >= 0 ? '#065f46' : '#7f1d1d' } : undefined}>{money(x.cents)}{x.missing > 0 && <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>{x.missing + ' line(s) missing — listed under “Lines to fix”'}</div>}</td>
            </tr>; })}</tbody></table>
        </div>;
      }
      function list(title, items) {
        return <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <div className="font-extrabold text-[11px] mb-1" style={{ color: INK }}>{title + ' (' + items.length + ')'}</div>
          <div className="overflow-auto pl-scroll" style={{ maxHeight: 240, border: '1px solid ' + LINE, background: '#ffffff' }}><table className="w-full text-[11px]">
            <thead><tr style={{ background: '#f1f5f9', color: '#334155' }}>{['', 'Pounds', 'Goods profit', 'Transport profit', 'Total'].map(function (h, i) { return <th key={i} className={'px-2 py-1 font-bold ' + (i === 0 ? 'text-left' : 'text-right')}>{h}</th>; })}</tr></thead>
            <tbody>{items.map(function (it) { return <tr key={it.name} style={{ borderTop: '1px solid ' + LINE, color: INK }}>
              <td className="px-2 py-1">{it.name}{it.missing > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}>{' · some costs not known yet'}</span>}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmt0(it.pounds)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{money(it.goods_profit)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{money(it.transport_profit)}</td>
              <td className="px-2 py-1 text-right tabular-nums font-extrabold" style={it.profit === null ? undefined : { color: it.profit >= 0 ? '#065f46' : '#7f1d1d' }}>{money(it.profit)}</td>
            </tr>; })}</tbody></table></div>
        </div>;
      }
      // v55.83-VQ (Max: "what does this mean? how do I go and fix it?") — the lines behind every amber note, why, and where to fix
      var fx = linesToFix(cs);
      function goFix(where, row) { setFull(false); setOpen(null); if (where === 'invoice' && row) { setSearchQ(String(row.invoice || '')); setView('invoice'); if (row.invoice_id) { setOpen('invoice:' + row.invoice_id); } } else { setView(where === 'containers' ? 'containers' : (where === 'invoice' ? 'invoice' : 'setup')); } }
      var fixBox = fx.rows.length === 0 ? null : <div className="mb-3 rounded-lg p-2" style={{ background: '#fffbeb', border: '2px solid #f59e0b' }}>
        <div className="font-extrabold text-[12px]" style={{ color: '#92400e' }}>{'⚠ Lines to fix — ' + fx.rows.length + ' of ' + fx.total + ' sale lines in ' + r.label + ' are missing a cost, so their profit is not counted yet.'}</div>
        <div className="text-[11px] mb-1" style={{ color: '#92400e' }}>What is missing, and where to fix it:</div>
        {fx.reasons.map(function (g) { return <div key={g.key} className="text-[11px] mb-1 flex gap-2 items-start flex-wrap" style={{ color: INK }}><span><b>{g.count + ' × ' + g.title + '.'}</b>{' ' + g.how}</span><button onClick={function (e) { e.stopPropagation(); goFix(g.go, null); }} className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#b45309', color: '#ffffff' }}>{g.goLabel + ' →'}</button></div>; })}
        <div className="overflow-auto pl-scroll mt-1" style={{ maxHeight: 260, border: '1px solid ' + LINE, background: '#ffffff' }}><table className="w-full text-[11px]">
          <thead><tr style={{ background: '#fef3c7', color: '#92400e' }}>{['Invoice', 'Date', 'Customer', 'Product', 'Release', 'Sold for', 'What is missing', ''].map(function (h, i) { return <th key={i} className={'px-2 py-1 font-bold ' + (i === 5 ? 'text-right' : 'text-left')}>{h}</th>; })}</tr></thead>
          <tbody>{fx.rows.slice(0, 300).map(function (w, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE, color: INK }}>
            <td className="px-2 py-1 font-bold">{w.invoice}</td><td className="px-2 py-1">{w.invoice_date}</td><td className="px-2 py-1">{w.customer}</td><td className="px-2 py-1">{w.product}</td><td className="px-2 py-1">{w.release || '—'}</td>
            <td className="px-2 py-1 text-right tabular-nums">{w.sold_for === null ? '—' : '$' + fmt(w.sold_for)}</td><td className="px-2 py-1 font-bold" style={{ color: '#b45309' }}>{w.missing_text}</td>
            <td className="px-2 py-1 text-right"><button onClick={function (e) { e.stopPropagation(); goFix('invoice', w); }} className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Open this invoice →</button></td>
          </tr>; })}</tbody></table></div>
        {fx.rows.length > 300 && <div className="text-[10px] mt-1" style={{ color: SUB }}>{'Showing the 300 biggest of ' + fx.rows.length + '.'}</div>}
      </div>;
      return <div>
        {fixBox}
        <div className="font-extrabold text-[12px] mb-2" style={{ color: INK }}>{r.label + ' — breakdown · ' + bd.lines + ' line(s) · ' + fmt0(bd.pounds) + ' lb · total profit ' + money(bd.total.profit) + ' (goods ' + money(bd.total.goods_profit) + ' + transport ' + money(bd.total.transport_profit) + ')'}</div>
        <div className="flex gap-3 flex-wrap mb-2">{side('goods', 'GOODS', '#1e3a8a')}{side('transport', 'TRANSPORTATION', '#7c2d12')}</div>
        <div className="flex gap-3 flex-wrap">{list('By product', bd.products)}{list('By customer', bd.customers)}</div>
        {expPanel(r)}
        <div className="text-[10px] mt-1" style={{ color: SUB }}>The commission taken off above is the per-pound commission inside goods profit; there is no separate commission expense column. FINAL P&L = total profit − A − C − D − E. Profit is dated by invoice date; expenses by the date the money left the bank.</div>
      </div>;
    }
    // v55.83-VQ — the expense columns. Only with ALL releases: the Income Statement's expenses are the whole company's and cannot
    // be split by release prefix. The Total row adds the periods that have loaded and says so when some have not.
    var expOn = pPre === 'all'; var EXK = ['A', 'C', 'D', 'E', 'unassigned'];
    var expKeys = rows.filter(function (r0) { return r0.key !== 'zz'; }).map(function (r0) { return r0.key; });
    var totalExp = totalExpenses(expKeys, pExp, expScope);
    function expOf(r) { return r.key === 'total' ? totalExp : pExp[expScope + '|' + r.key]; }
    function expCell(r, k) {
      if (!expOn) { return '—'; }
      var e = expOf(r); if (!e || e.status === 'loading') { return '…'; }
      if (e.status === 'locked') { return '🔒'; }
      if (e.status !== 'ok') { return <span title={e.why} style={{ color: '#b45309' }}>n/a</span>; }
      return <span>{money(e.cols[k].cents)}{r.key === 'total' && !e.complete && <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>{e.loaded + ' of ' + e.periods + ' periods only'}</div>}</span>;
    }
    function finalCell(r) {
      if (!expOn) { return '—'; } if (hidden) { return '🔒'; }
      var e = expOf(r); if (!e || e.status === 'loading') { return '…'; }
      if (e.status === 'locked') { return '🔒'; }
      if (e.status !== 'ok') { return <span title={e.why} style={{ color: '#b45309' }}>n/a</span>; }
      if (r.key === 'total' && !e.complete) { return <span style={{ color: '#b45309', fontSize: 10, fontWeight: 700 }} title="A total with periods missing is not a total">not shown until every period has its expenses</span>; }
      var f = finalPnl(r.profit, e.cols, (r.incomplete || 0) + (r.uncounted || 0));
      return <span style={{ color: f.cents >= 0 ? '#065f46' : '#7f1d1d' }}>{money(f.cents)}
        {e.cols.unassigned.cents !== 0 && <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>{'if the uncategorized is all expense: ' + money(f.cents - e.cols.unassigned.cents)}</div>}
        {!f.complete && <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>known part only</div>}</span>;
    }
    function expPanel(r) {
      if (!expOn) { return <div className="text-[11px] mt-2" style={{ color: SUB }}>Expenses and the final P&L are shown with Releases: All (they are the whole company’s and cannot be split by release).</div>; }
      var e = expOf(r); if (!e || e.status !== 'ok') { return <div className="text-[11px] mt-2" style={{ color: '#b45309' }}>{e && e.why ? e.why : 'Expenses for this period are loading…'}</div>; }
      var groups = [['A', 'A · Warehouse / Office'], ['C', 'C · Partner fee'], ['D', 'D · Payroll'], ['E', 'E · Taxes'], ['unassigned', 'Uncategorized expenses — not taken off the profit yet'], ['in_profit', 'Paid to suppliers, truckers, brokers — already inside goods and transport profit, NOT taken off again']];
      return <div className="mt-2">
        <div className="font-extrabold text-[11px] mb-1" style={{ color: '#7c2d12' }}>{'EXPENSES paid ' + e.from + ' → ' + e.to + ' (from the Income Statement, real-cost look)'}</div>
        <div className="flex gap-3 flex-wrap">{groups.map(function (g) { var col = e.cols[g[0]];
          return <div key={g[0]} style={{ flex: '1 1 260px', minWidth: 240 }}><table className="w-full text-[11px]" style={{ background: '#ffffff', border: '1px solid ' + LINE }}><tbody>
            <tr style={{ background: g[0] === 'unassigned' ? '#fef3c7' : (g[0] === 'in_profit' ? '#f1f5f9' : '#ffedd5'), color: INK, fontWeight: 800 }}><td className="px-2 py-1">{g[1]}</td><td className="px-2 py-1 text-right tabular-nums">{money(col.cents)}</td></tr>
            {col.cats.map(function (c0) { return <tr key={c0.key} style={{ borderTop: '1px solid ' + LINE, color: INK }}><td className="px-2 py-1">{c0.label}</td><td className="px-2 py-1 text-right tabular-nums">{money(c0.cents)}</td></tr>; })}
            {col.cats.length === 0 && <tr><td colSpan={2} className="px-2 py-1" style={{ color: SUB }}>nothing</td></tr>}
          </tbody></table></div>; })}</div>
        <div className="text-[10px] mt-1" style={{ color: SUB }}>To move money out of “Uncategorized”, give the bank line a category in Accounting → Transactions (or Stats → Income Statement, which lists the lines). Categories are placed in a column by their name.</div>
      </div>;
    }
    var hd = { background: '#f1f5f9', color: '#334155' };
    // v55.83-VL (Max, Nov 19: "i need full screen look like you did on the other tab. as well as scroll bar on top") — the same full
    // screen and the same top bar as By product; ("click in to see the breakdown of each month for each category") a period opens.
    var body = <div role={full ? 'dialog' : undefined} aria-modal={full ? 'true' : undefined} aria-label={full ? 'P&L by period, full screen' : undefined} style={full ? { position: 'fixed', inset: 0, zIndex: 200, background: '#ffffff', color: INK, padding: 10, display: 'flex', flexDirection: 'column' } : {}}>
      <div className="flex gap-2 items-center flex-wrap mb-2 text-[11px]">
        <b>Dates:</b>
        {[['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year']].map(function (x) { return <Btn key={x[0]} onClick={function () { setRange(x[0]); }}>{x[1]}</Btn>; })}
        <span style={{ color: SUB }}>{'or Custom: set the two dates at the top and press Apply · showing ' + (from || 'the start') + ' → ' + (to || 'today')}</span>
      </div>
      <div className="flex gap-2 items-center flex-wrap mb-2 text-[11px]">
        <b>Group by:</b>
        {[['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']].map(function (x) { return <button key={x[0]} onClick={function () { setPGran(x[0]); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={pGran === x[0] ? { background: '#0f172a', color: '#ffffff' } : hd}>{x[1]}</button>; })}
        <b className="ml-2">Releases:</b>
        {[['all', 'All'], ['1001', '1001- (Canada)'], ['1002', '1002- (Houston)'], ['1003', '1003-'], ['other', 'Other / none']].map(function (x) { return <button key={x[0]} onClick={function () { setPPre(x[0]); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={pPre === x[0] ? { background: '#0f172a', color: '#ffffff' } : hd}>{x[1]}</button>; })}
        <div className="flex-1" /><Btn onClick={csv}>⬇ CSV</Btn>
      </div>
      <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: SUB }}>
        <button ref={fullBtn} onClick={function () { setFull(!full); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={full ? { background: '#0f172a', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155', border: '1px solid ' + LINE }} title={full ? 'Back to the normal page (Esc)' : 'Show the table on the whole screen'}>{full ? '✕ Exit full screen' : '⤢ Full screen'}</button>
        <span>Click a period to open its breakdown · drag the bar below to move left / right</span>
        {expOn && <span style={{ color: totalExp.complete ? '#065f46' : '#b45309', fontWeight: 700 }}>{'Expenses: ' + totalExp.loaded + ' of ' + totalExp.periods + ' periods loaded' + (totalExp.loading ? ' · ' + totalExp.loading + ' loading…' : '') + (totalExp.failed ? ' · ' + totalExp.failed + ' failed' : '') + (totalExp.unavailable ? ' · ' + totalExp.unavailable + ' not open to you' : '')}</span>}
        {expOn && totalExp.missing > 0 && totalExp.loading === 0 && <button onClick={function () { startExpenses({}); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={{ background: '#7c2d12', color: '#ffffff' }}>{'Load expenses for ' + totalExp.missing + ' period(s)'}</button>}
        {expOn && totalExp.failed > 0 && totalExp.loading === 0 && <button onClick={function () { startExpenses({ retryErrors: true }); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={{ background: '#b45309', color: '#ffffff' }}>{'Try again (' + totalExp.failed + ' failed)'}</button>}
        {expOn && <span style={{ color: SUB }}>{'· ' + (effFrom || 'the start') + ' → ' + effTo}</span>}
      </div>
      <div ref={topBar} onScroll={function () { syncFrom(topBar, tableBox); }} className="overflow-x-auto overflow-y-hidden pl-scroll" style={{ height: 16, marginBottom: 2 }}><div ref={topInner} style={{ height: 1 }} /></div>
      <div ref={tableBox} onScroll={function () { syncFrom(tableBox, topBar); }} className="overflow-auto rounded pl-scroll nt-solid-head" style={{ border: '1px solid ' + LINE, maxHeight: full ? 'none' : '65vh', flex: full ? '1 1 auto' : undefined }}>
        <table className="w-full text-[11px]" style={{ minWidth: 2050 }}>
          <thead ref={outerHead}>
            <tr><th className="px-2 py-1" /><th className="px-2 py-1" /><th colSpan={3} className="px-2 py-1 text-center font-extrabold" style={{ background: '#064e3b', color: '#ffffff' }}>PROFIT ON SALES</th><th colSpan={5} className="px-2 py-1 text-center font-extrabold" style={{ background: '#7c2d12', color: '#ffffff' }}>EXPENSES (paid in the period)</th><th className="px-2 py-1 text-center font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>BOTTOM LINE</th><th colSpan={4} className="px-2 py-1 text-center font-extrabold nt-th-goods">GOODS — how the goods profit is made</th><th colSpan={3} className="px-2 py-1 text-center font-extrabold nt-th-transport">TRANSPORTATION — how the transport profit is made</th><th className="px-2 py-1" /></tr>
            <tr>{['Period', 'Pounds', 'Goods profit', 'Transport profit', 'Total profit', 'A · Warehouse / Office', 'C · Partner fee', 'D · Payroll', 'E · Taxes', 'Uncategorized expenses', 'FINAL P&L', 'Goods revenue', 'Goods cost', 'Margin', 'Avg profit / lb', 'Transport charged', 'Trucking (our cost)', 'Freight (our cost)', 'Lines'].map(function (h, i) { return <th key={h} className={'px-2 py-1.5 font-bold ' + (i === 0 ? 'text-left' : 'text-right')}>{h}</th>; })}</tr>
          </thead>
          <tbody>{rows.concat(rows.length > 1 ? [tot] : []).map(function (r, i) {
            var isT = r.key === 'total'; var isOpen = !isT && pOpen === r.key;
            var out = [<tr key={r.key} onClick={isT ? undefined : function () { setPOpen(isOpen ? null : r.key); }} title={isT ? undefined : (isOpen ? 'Close the breakdown' : 'Open the breakdown of ' + r.label)} style={{ background: isT ? '#e2e8f0' : (isOpen ? '#e0f2fe' : (i % 2 ? '#f8fafc' : '#ffffff')), color: INK, borderTop: '1px solid ' + LINE, fontWeight: isT ? 800 : 400, cursor: isT ? 'default' : 'pointer' }}>
              <td className="px-2 py-1.5 font-bold">{isT ? '' : (isOpen ? '▾ ' : '▸ ')}{r.label}{!isT && expOf(r) && expOf(r).partial && <div style={{ color: SUB, fontSize: 9, fontWeight: 400 }}>{expOf(r).from + ' → ' + expOf(r).to + ' only'}</div>}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt0(r.pounds)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ color: r.goods_profit >= 0 ? '#065f46' : '#7f1d1d', background: isT ? undefined : '#ecfdf5' }}>{cell(r, 'goods_profit', true)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ color: r.transport_profit >= 0 ? '#065f46' : '#7f1d1d', background: isT ? undefined : '#ecfdf5' }}>{cell(r, 'transport_profit', true)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ color: r.profit >= 0 ? '#065f46' : '#7f1d1d', background: isT ? undefined : '#d1fae5' }}>{hidden ? '🔒' : <span>{(r.profit < 0 ? '−$' : '$') + fmt(Math.abs(r.profit / 100))}{r.uncounted > 0 && <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>{r.uncounted + ' line(s) / $' + fmt(r.uncounted_revenue / 100) + ' revenue not counted until their cost is known'}</div>}</span>}</td>
              {EXK.map(function (k) { return <td key={'x' + k} className="px-2 py-1.5 text-right tabular-nums" style={{ background: isT ? undefined : (k === 'unassigned' ? '#fef3c7' : '#fff7ed') }}>{expCell(r, k)}</td>; })}
              <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ background: isT ? undefined : '#e2e8f0' }}>{finalCell(r)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{cell(r, 'goods_revenue')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{cell(r, 'goods_cost')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.goods_profit, r.goods_revenue)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{hidden ? '🔒' : (r.pounds > 0 ? fmt4(r.goods_profit / 100 / r.pounds) : '—')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{cell(r, 'transport_revenue')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{cell(r, 'trucking_cost')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{cell(r, 'freight_cost')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.lines}{r.incomplete > 0 && (isT ? <div style={{ color: '#b45309', fontSize: 9, fontWeight: 700 }}>{r.incomplete + ' to fix'}</div> : <button onClick={function (e) { e.stopPropagation(); setPOpen(r.key); }} title="Show the sale lines that are missing a cost and how to fix them" style={{ display: 'block', marginLeft: 'auto', color: '#b45309', fontSize: 9, fontWeight: 800, textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{r.incomplete + ' to fix — show'}</button>)}</td>
            </tr>];
            if (isOpen) { out.push(<tr key={r.key + ':open'}><td colSpan={19} className="px-3 py-2" style={{ background: '#f0f9ff', borderTop: '1px solid #7dd3fc' }}>{breakdownPanel(r, cells.filter(function (c) { return bucketOf(c.invoice_date, pGran).key === r.key; }))}</td></tr>); }
            return out; })}
            {rows.length === 0 && <tr><td colSpan={19} className="px-3 py-4 text-center" style={{ color: SUB }}>No sales in these dates for these releases.</td></tr>}</tbody>
        </table>
      </div>
      <div className="text-[10px] mt-1" style={{ color: SUB }}>Dated by invoice date. Goods cost = goods + commission + inbound allowance + bonded ($200 per Houston container; brokerage is the same thing and is not added twice). Transport profit = transport charged − trucking − freight. Total profit = goods profit + transport profit; a line whose cost is not known yet adds nothing to profit until it is (its revenue is shown under the total). “Not known yet” = some lines have no figure for that column yet (e.g. a bill not in) — the total shows only what is known. The same lines as By product / customer / invoice, so the totals agree.</div>
    </div>;
    return full && typeof document !== 'undefined' ? createPortal(body, document.body) : body;
  }
  function estFinalView() {
    var all = (data.containers || []).filter(function (x) { return x.parts && (x.parts.freight.bill !== null || x.parts.trucking.bill !== null || x.parts.freight.estimate !== null || x.parts.trucking.estimate !== null); });
    var list = onlyDiff ? all.filter(function (x) { var pp = x.parts; return pp.freight.differs || pp.trucking.differs || pp.freight.payment_differs_from_bill || pp.trucking.payment_differs_from_bill; }) : all;
    var tot = { fe: 0, fb: 0, te: 0, tb: 0 };
    list.forEach(function (x) { var pp = x.parts; if (pp.freight.bill !== null && pp.freight.estimate !== null) { tot.fe += pp.freight.estimate; tot.fb += pp.freight.bill; } if (pp.trucking.bill !== null && pp.trucking.estimate !== null) { tot.te += pp.trucking.estimate; tot.tb += pp.trucking.bill; } });
    function csv() {
      var rows = [['Release', 'Customer(s)', 'Invoice(s)', 'Freight estimate', 'Freight estimate from', 'Freight bill', 'Freight difference', 'Freight bills', 'Trucking estimate', 'Trucking estimate from', 'Trucking bill', 'Trucking difference', 'Trucking bills', 'Final confirmed']];
      list.forEach(function (x) { var f = x.parts.freight; var t = x.parts.trucking; rows.push([x.raw, x.customers.join(' / '), x.invoices.join(' / '), f.estimate, f.estimate_from, f.bill, f.difference, f.bills.map(function (b) { return (b.vendor || '') + ' ' + (b.bill_number || ''); }).join(' / '), t.estimate, t.estimate_from, t.bill, t.difference, t.bills.map(function (b) { return (b.vendor || '') + ' ' + (b.bill_number || ''); }).join(' / '), x.parts.final_confirmed ? 'yes' : 'no']); });
      var txt = rows.map(function (r) { return r.map(function (v) { var q = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(q) ? '"' + q.replace(/"/g, '""') + '"' : q; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'estimate-vs-final-shipping.csv'; a.click();
    }
    return <div>
      <div className="text-[11px] mb-2" style={{ color: SUB }}>{'Each shipment’s first ESTIMATE against the BILLED amount (the final cost), freight and trucking separately. A cost is final only when its bill is in the Hub; until then the profit report uses the estimate. Bills shared by several releases are split by pounds.'}</div>
      <div className="flex gap-2 items-center mb-2 flex-wrap text-[11px]">
        <label className="flex items-center gap-1 font-bold" style={{ color: INK }}><input type="checkbox" checked={onlyDiff} onChange={function (e) { setOnlyDiff(e.target.checked); }} />Only shipments with a difference</label>
        <span style={{ color: SUB }}>{list.length + ' of ' + all.length + ' shipment(s)'}</span>
        <span style={{ color: INK, fontWeight: 700 }}>{'Billed vs estimated — freight $' + fmt(tot.fb) + ' vs $' + fmt(tot.fe) + ' (' + (tot.fb - tot.fe >= 0 ? '+' : '') + fmt(tot.fb - tot.fe) + '), trucking $' + fmt(tot.tb) + ' vs $' + fmt(tot.te) + ' (' + (tot.tb - tot.te >= 0 ? '+' : '') + fmt(tot.tb - tot.te) + ')'}</span>
        <Btn onClick={csv}>⬇ Download (CSV)</Btn>
      </div>
      <div className="overflow-auto rounded pl-scroll nt-solid-head" style={{ border: '1px solid ' + LINE, maxHeight: '70vh' }}>
        <table className="w-full text-[11px]" style={{ minWidth: 900 }}>
          <thead><tr>{['Container (release)', 'Customer(s)', 'Invoice(s)', 'Freight / shipping', 'Trucking', 'Total', 'Status'].map(function (h) { return <th key={h} className="px-2 py-1.5 text-left font-bold sticky top-0" style={Object.assign({}, th, { zIndex: 2 })}>{h}</th>; })}</tr></thead>
          <tbody>{list.map(function (x, i) { var pp = x.parts; var diffRow = pp.freight.differs || pp.trucking.differs;
            return <tr key={x.key} style={{ background: diffRow ? '#fef2f2' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE }}>
              <td className="px-2 py-1.5 font-bold">{x.raw}</td><td className="px-2 py-1.5">{x.customers.join(', ')}</td><td className="px-2 py-1.5">{x.invoices.join(', ')}</td>
              <td className="px-2 py-1.5">{partText(pp.freight)}</td><td className="px-2 py-1.5">{partText(pp.trucking)}</td>
              <td className="px-2 py-1.5 tabular-nums">{(pp.estimate_total === null ? 'est. missing' : 'est. $' + fmt(pp.estimate_total)) + (pp.bill_total !== null ? ' · billed $' + fmt(pp.bill_total) : '')}{pp.total_differs && <div style={{ color: '#b91c1c', fontWeight: 800 }}>{'⚠ ' + (pp.total_difference > 0 ? '+' : '') + '$' + fmt(pp.total_difference)}</div>}</td>
              <td className="px-2 py-1.5 font-bold" style={{ color: pp.final_confirmed ? '#166534' : '#b45309' }}>{pp.final_confirmed ? 'FINAL — both billed' : (pp.freight.bill !== null || pp.trucking.bill !== null ? 'PART BILLED — rest is estimate' : 'ESTIMATE — no bill yet')}</td></tr>; })}
          {list.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-center" style={{ color: SUB, background: '#ffffff' }}>{onlyDiff ? 'No differences between estimates and bills in this period.' : 'No shipments with an estimate or a bill in this period.'}</td></tr>}</tbody>
        </table></div>
    </div>;
  }
  function containersView() {
    var list = data.containers || [];
    var miss = list.filter(function (x) { return x.status === 'missing'; }).length;
    var wPart = function (amt, kind, man) { return man !== null && man !== undefined ? '$' + fmt(man) + ' (corrected)' : amt === null || amt === undefined ? 'missing' : '$' + fmt(amt) + (kind === 'final' ? ' final' : ' quote'); };
    return <div>
      <WarehouseShippingPanel userProfile={userProfile} toast={toast} onChanged={function () { load(); }} warehouseOn={data.warehouse_on === true} />
      <div className="text-[11px] mb-2" style={{ color: SUB }}>{'What each container cost us to ship (outbound trucking / shipping bills with the same release number). Where no bill is in yet, type an estimate; it is replaced, never added to, when the bill arrives. For CNF invoices with no amount typed, this cost is what is taken out of the price. ' + miss + ' of ' + list.length + ' container(s) have no shipping cost yet.'}</div>
      <div className="overflow-auto rounded pl-scroll nt-solid-head" style={{ border: '1px solid ' + LINE, maxHeight: '70vh' }}>
        <table className="w-full text-[11px]" style={{ minWidth: 1000 }}>
          <thead><tr>{['Container (release)', 'From', 'Customer(s)', 'Invoice(s)', 'Pounds', 'Shipping cost used', 'Freight / shipping (estimate → bill)', 'Trucking (estimate → bill)', 'Where it comes from', 'Warehouse (Nextrade) order', 'Estimate while the bill is missing'].map(function (h) { return <th key={h} className="px-2 py-1.5 text-left font-bold sticky top-0" style={Object.assign({}, th, { zIndex: 2 })}>{h}</th>; })}</tr></thead>
          <tbody>{list.map(function (x, i) { var k = 'x:' + x.key;
            return <tr key={x.key} style={{ background: x.status === 'missing' ? '#fff7ed' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE }}>
              <td className="px-2 py-1.5 font-bold">{x.raw}</td><td className="px-2 py-1.5">{x.origin || <span style={{ color: '#b45309' }}>unknown</span>}</td>
              <td className="px-2 py-1.5">{x.customers.join(', ')}</td><td className="px-2 py-1.5">{x.invoices.join(', ')}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt0(x.pounds)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-bold">{x.status === 'bill' || x.status === 'warehouse_final' ? '$' + fmt(x.shipping_actual) : x.status === 'estimate' || x.status === 'warehouse_estimate' ? '$' + fmt(x.shipping_estimate) : <span style={{ color: '#b45309' }}>missing</span>}</td>
              <td className="px-2 py-1.5">{partText(x.parts && x.parts.freight, x.raw, 'freight')}</td><td className="px-2 py-1.5">{partText(x.parts && x.parts.trucking, x.raw, 'trucking')}</td>
              <td className="px-2 py-1.5">{x.status === 'warehouse_final' || x.status === 'warehouse_estimate' ? <span style={{ color: x.status === 'warehouse_final' ? '#166534' : '#b45309', fontWeight: 700 }}>{(x.status === 'warehouse_final' ? 'FINAL — billed' : 'ESTIMATE — final only when the bills are in the Hub') + (x.bills.length ? ' + Hub bill ' + x.bills.map(function (b0) { return (b0.bill_number || '') + ' $' + fmt(b0.amount); }).join(' · ') : '')}</span> : x.status === 'bill' ? x.bills.map(function (b0) { return (b0.vendor || '') + ' ' + (b0.bill_number || '') + ' $' + fmt(b0.amount); }).join(' · ') : x.status === 'estimate' ? <span style={{ color: '#b45309', fontWeight: 700 }}>ESTIMATE (no bill yet)</span> : <span style={{ color: '#b45309' }}>no outbound bill with this release number</span>}</td>
              <td className="px-2 py-1.5">{(x.warehouse || []).length === 0 ? <span style={{ color: SUB }}>not in the warehouse sync</span> : x.warehouse.map(function (w) { return <div key={w.id}>
                <a href={w.link || '#'} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontWeight: 700 }}>{'order ' + w.order_id}</a>{' · freight ' + wPart(w.freight_used, w.freight_kind, w.manual_freight) + ' + trucking ' + wPart(w.trucking_used, w.trucking_kind, w.manual_trucking)}
                {(w.bill_checks || []).filter(function (c) { return c.status === 'bill_above_quote' || c.status === 'bill_below_quote'; }).map(function (c) { return <div key={c.part} style={{ color: '#b91c1c', fontWeight: 700 }}>{'⚠ ' + c.part + ' bill $' + fmt(c.bill_total) + ' vs quote $' + fmt(c.quote) + ' (' + (c.difference > 0 ? '+' : '') + fmt(c.difference) + ') — demurrage? extra charges?'}</div>; })}
              </div>; })}{!data.warehouse_on && (x.warehouse || []).length > 0 && <div style={{ color: SUB, fontSize: 10 }}>shown only — not in the numbers until the switch is on</div>}</td>
              <td className="px-2 py-1.5">{x.status === 'bill' || x.status === 'warehouse_final' ? <span style={{ color: SUB }}>{x.status === 'bill' ? 'bill in — no estimate needed' : 'warehouse final — no estimate needed'}</span> : <span style={{ color: SUB }}>{(x.warehouse || []).length ? 'from Nextrade Shipping In Progress until the bill' : 'not in Nextrade yet — fill it on the order there'}</span>}</td></tr>; })}
          {list.length === 0 && <tr><td colSpan={11} className="px-2 py-4 text-center" style={{ color: SUB, background: '#ffffff' }}>No invoice in this period has a release number.</td></tr>}</tbody>
        </table></div>
    </div>;
  }
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
        {iv.basis_source === 'customer' && <span className="text-[10px] font-bold" style={{ color: '#1e3a8a' }}>{'Using ' + iv.customer + '’s usual: ' + BASIS_WORDS[iv.basis] + '. Click a button and save to set THIS invoice differently.'}</span>}
        {!iv.basis && iv.suggested_basis && <span className="text-[10px] font-bold" style={{ color: '#92400e' }}>{'The invoice wording suggests ' + BASIS_WORDS[iv.suggested_basis] + ' — confirm it by clicking.'}</span>}
        {!iv.basis && !iv.suggested_basis && <span className="text-[10px] font-bold" style={{ color: '#92400e' }}>Nothing on the invoice says which — it stays unresolved until you choose.</span>}
      </div>
      {(basis === 'CNF' || basis === 'TRUCKING_INCLUDED') && <div className="flex gap-2 items-center flex-wrap mb-1">
        <span className="text-[11px] font-bold">Transportation INSIDE the price $</span>
        <input value={emb} disabled={!canEdit} onChange={function (e) { d(eK, e.target.value); }} className="nt-light px-2 py-1 rounded text-[11px]" style={Object.assign({ width: 130 }, inp)} placeholder="blank = container cost" />
        <span className="text-[10px]">{'It is taken OUT of the goods price and shown as transportation revenue, never added to the invoice total. Left blank, the actual shipping cost of this invoice’s share of its container is used' + (iv.embedded_source && iv.embedded_source !== 'manual' ? ' — now $' + fmt(iv.embedded_used) + ' (' + iv.embedded_source + ').' : ' — not known yet, so nothing is taken out.')}</span>
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
        // v55.83-TK (Max, Nov 17: "No ability to manual update. Just take it directly through shipping in progress") — no typing here
        return <div key={r.key} className="mt-1 text-[11px]" style={{ color: '#92400e' }}>
          <b>{'Outbound for ' + r.raw + ': '}</b>{cur.outbound_kind === 'estimate' ? 'ESTIMATE from Nextrade “Shipping In Progress” until the trucking / shipping bill is in the Hub.' : 'no bill in the Hub and no figure in Nextrade “Shipping In Progress” yet — fill freight and trucking on that order in Nextrade, or enter the bill on the Bills screen.'}
        </div>; })}
    </div>;
  }

  // one row's cells — the same columns for a top line and for an original description underneath it
  function rowTds(r, isInvoice, isOpen, sub) {
    var pc = sub ? 'px-2 py-1 text-right tabular-nums' : 'px-2 py-1.5 text-right tabular-nums';
    return [
      <td key="c0" className={sub ? 'px-2 py-1' : 'px-2 py-1.5 font-bold'} style={Object.assign({ position: 'sticky', left: 0, zIndex: 1, background: 'inherit', minWidth: 220, maxWidth: 300 }, sub ? { paddingLeft: 26 } : {})}>{(isOpen ? '▾ ' : '▸ ') + r.label}
        {!sub && r.grouped && <span className="ml-1 text-[9px] font-semibold" style={{ color: '#64748b' }}>{'(' + r.name_list.length + ' names)'}</span>}
        {isInvoice && r.invoice && <div className="font-normal" style={{ color: SUB }}>{r.invoice.date + ' · ' + r.invoice.customer + ' · ' + (r.invoice.basis ? BASIS_WORDS[r.invoice.basis] + (r.invoice.basis_source === 'customer' ? ' (customer’s usual)' : r.invoice.basis_source === 'inferred' ? ' (inferred by rule)' : r.invoice.basis_source === 'shipping_line_rule' ? ' (assumed — shipping line on the invoice, not in the price)' : r.invoice.basis_source === 'invoice_text' ? ' (stated on invoice)' : r.invoice.basis_source === 'invoice_form' ? (r.invoice.shipping_terms === 'CNF_SEPARATE' ? ' (separate shipping line — set on invoice)' : ' (set on invoice)') : '') : 'basis not set') + ' · ' + (r.invoice.releases.map(function (x) { return x.raw; }).join(', ') || 'no release')}</div>}
        {isInvoice && !sub && r.invoice && r.invoice.id && <button type="button" onClick={function (e) { e.stopPropagation(); setPeekId(r.invoice.id); }} className="mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }} title="Open a copy of this invoice. From there, Edit opens it in the Invoices screen.">🧾 view invoice</button>}</td>,
      <td key="c1" className={pc}>{fmt0(r.pounds)}{r.pounds_incomplete && dot('Some weights are missing — only lines with a weight are counted')}</td>,
      <td key="c2" className={pc + (sub ? '' : ' font-bold')}>{(Number(r.invoiced) || 0) - (Number(r.goods_revenue) || 0) > 0.009 && !(r.unknown_fields || []).some(function (f) { return f === 'goods_revenue'; }) ? <span>{'$' + fmt(r.goods_revenue)}<button type="button" title={'On invoices $' + fmt(r.invoiced) + '\n− shipping inside CNF prices $' + fmt(r.invoiced - r.goods_revenue) + '\n= goods revenue $' + fmt(r.goods_revenue) + ' (used for $/lb and the goods profit)'} aria-label={'On invoices $' + fmt(r.invoiced) + '\n− shipping inside CNF prices $' + fmt(r.invoiced - r.goods_revenue) + '\n= goods revenue $' + fmt(r.goods_revenue) + ' (used for $/lb and the goods profit)'} onClick={function (e) { e.stopPropagation(); explain('On invoices $' + fmt(r.invoiced) + '\n− shipping inside CNF prices $' + fmt(r.invoiced - r.goods_revenue) + '\n= goods revenue $' + fmt(r.goods_revenue) + ' (used for $/lb and the goods profit)'); }} className="ml-1 px-1 rounded font-bold" style={{ fontSize: 8, background: '#e2e8f0', color: '#475569', verticalAlign: 'middle', border: 0, cursor: 'help' }}>CNF</button></span> : money(r, 'goods_revenue')}</td>,
      <td key="c3" className={pc + (sub ? '' : ' font-extrabold')} style={sub ? {} : { color: '#065f46' }}>{r.avg_goods_price_per_lb === null ? <span style={{ color: '#b45309' }}>—</span> : fmt4(r.avg_goods_price_per_lb)}</td>,
      <td key="c4" className={pc}>{money(r, 'transport_revenue')}</td>,
      <td key="c5" className={pc} title={(r.cost_missing_why || []).map(function (w) { return w.sales + ' sale(s): ' + w.why; }).join('\n')}>{money(r, 'base_cost')}{fixChip(r.cost_missing_why, r.key.indexOf('g:') === 0 ? r.key.substring(2) : (r.parent && r.parent.indexOf('g:') === 0 ? r.parent.substring(2) : null))}</td>,
      <td key="c6" className={pc + (sub ? '' : ' font-extrabold')} style={sub ? {} : { color: '#7f1d1d' }}>{fmt4(r.avg_base_cost_per_lb)}</td>,
      <td key="c6b" className={pc + (sub ? '' : ' font-extrabold')} style={sub ? {} : { color: '#7f1d1d' }} title="(goods cost + commission + inbound allowance) ÷ pounds">{r.avg_all_cost_per_lb === null || r.avg_all_cost_per_lb === undefined ? <span style={{ color: '#b45309' }}>—</span> : fmt4(r.avg_all_cost_per_lb)}</td>,
      <td key="c7" className={pc}>{money(r, 'commission')}</td>,
      <td key="c8" className={pc}>{money(r, 'inbound_allowance')}</td>,
      <td key="c11" className={pc}>{money(r, 'bonded')}</td>,
      <td key="c12" className={pc}>{'$' + fmt(r.total_cost)}{r.total_cost_known === false && dot('Not all costs are known yet')}</td>,
      <td key="c12b" className={pc + " font-extrabold"} style={{ color: r.goods_profit_known ? (r.goods_profit >= 0 ? "#065f46" : "#7f1d1d") : "#78350f" }}>{pf(r.goods_profit)}{r.goods_profit_known === false && r.goods_profit !== undefined && dot('known part only — some costs are missing')}</td>,
      <td key="c9t" className={pc}>{partCell(r, 'trucking_cost', 'trucking')}</td>,
      <td key="c9f" className={pc}>{partCell(r, 'freight_cost', 'freight / shipping')}</td>,
      <td key="c14" className={pc}>{r.transport_profit === undefined ? '🔒' : r.transport_profit === null ? <span style={{ color: '#b45309' }}>unknown</span> : '$' + fmt(r.transport_profit)}</td>,
      <td key="c13" className={pc + ' font-extrabold'} style={{ color: r.complete ? (r.profit >= 0 ? '#065f46' : '#7f1d1d') : '#78350f' }}>{pf(r.profit)}{!r.complete && dot('known part only — some costs are missing')}</td>,
      <td key="c15" className="px-2 py-1 text-right">{statusChip(r)}</td>
    ];
  }
  function detailRow(key, r, cs, isInvoice) {
    return <tr key={key + ':d'}><td colSpan={18} className="px-2 py-2" style={{ background: '#f1f5f9' }}>
      {isInvoice && invoicePanel(r)}
      {view === 'customer' && customerPanel(r, cs)}
      <div className="text-[10px] mb-1" style={{ color: SUB }}>{'Releases: ' + (r.release_list.length ? r.release_list.join(', ') : 'none') + ' · ' + r.invoice_count + ' invoice(s) · ' + cs.length + ' line(s). Hover over “Cost from” to see the supplier bills behind a cost.'}</div>
      {cellsTable(cs, isInvoice, true)}</td></tr>;
  }
  function viewTable(rowsAll, firstCol, isInvoice) {
    var rows = filterRowsBySearch(rowsAll, searchQ); // v55.83-VG — search only chooses which rows are shown
    // v55.83-TA — under each MERGED product, its original descriptions, each with its own totals and averages
    var subsOf = {};
    if (view === 'product') { ((data && data.by_product_names) || []).forEach(function (s0) { (subsOf[s0.parent] = subsOf[s0.parent] || []).push(s0); }); }
    var tableView = <div role={full ? 'dialog' : undefined} aria-modal={full ? 'true' : undefined} aria-label={full ? 'Profitability table, full screen' : undefined} style={full ? { position: 'fixed', inset: 0, zIndex: 200, background: '#ffffff', color: INK, padding: 10, display: 'flex', flexDirection: 'column' } : {}}>
      <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: SUB }}>
        <button ref={fullBtn} onClick={function () { setFull(!full); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={full ? { background: '#0f172a', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155', border: '1px solid ' + LINE }} title={full ? 'Back to the normal page (Esc)' : 'Show the table on the whole screen'}>{full ? '✕ Exit full screen' : '⤢ Full screen'}</button>
        <span>Drag the bar below to move left / right · hover, tap or Tab to an amber dot for details</span>
      </div>
      <div ref={topBar} onScroll={function () { syncFrom(topBar, tableBox); }} className="overflow-x-auto overflow-y-hidden pl-scroll" style={{ height: 16, marginBottom: 2 }}><div ref={topInner} style={{ height: 1 }} /></div>
      <div ref={tableBox} onScroll={function () { syncFrom(tableBox, topBar); }} className="overflow-auto rounded pl-scroll nt-solid-head" style={{ border: '1px solid ' + LINE, maxHeight: full ? 'none' : '75vh', flex: full ? '1 1 auto' : undefined }}>
      <table className="w-full text-[11px]" style={{ minWidth: 1500 }}>
        <thead ref={outerHead}><tr>{[[firstCol, ''], ['Pounds', 'Total pounds sold'], ['Goods revenue', 'Goods sold, after taking out shipping inside CNF prices. Hover a number to see the invoice amount.'], ['Avg $ / lb', 'Goods revenue ÷ pounds'], ['Transport charged', 'Shipping / trucking billed to the customer'], ['Goods cost', 'What we paid suppliers for these pounds'], ['Avg cost / lb', 'Goods cost ÷ pounds'], ['Avg cost all / lb', '(goods cost + commission + inbound allowance) ÷ pounds'], ['Commission', ''], ['Inbound allowance', 'Standard $0.02 per pound — an allowance, not a real payment'], ['Bonded / brokerage', '$200 per Houston container; not on paper / foil'], ['Total cost', 'Goods cost + commission + inbound + bonded. Outbound shipping is NOT included'], ['Goods profit', 'Goods revenue − total cost'], ['Trucking', 'Our trucking cost'], ['Freight', 'Our freight / shipping cost'], ['Transport profit', 'Transport charged − trucking − freight'], ['Total profit', 'Goods profit + transport profit'], ['', '']].map(function (hx, i) { var h = hx[0]; return <th key={h + i} title={hx[1] || undefined} className={'px-2 py-1.5 font-bold sticky top-0 ' + (i === 0 ? 'text-left' : 'text-right')} style={i === 0 ? Object.assign({}, th, { left: 0, zIndex: 3 }) : Object.assign({}, th, { zIndex: 2, cursor: hx[1] ? 'help' : 'default' })}>{h}</th>; })}</tr></thead>
        <tbody>{rows.map(function (r, i) {
          var isOpen = open === view + ':' + r.key;
          // v55.83-TB (Max: "should be all showing high level names .. drill down to see each name below it .. and further drill down
          // to the shipments for each name") — closed by default; open a merged product → its descriptions; open a description → its shipments
          var subs = r.grouped ? (subsOf[r.key] || []) : [];
          var openSub = subs.some(function (s0) { return open === view + ':' + s0.key; });
          var expanded = isOpen || openSub;
          var out = [<tr key={r.key} onClick={function () { setOpen(expanded ? null : view + ':' + r.key); }} style={{ background: expanded ? '#e0f2fe' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE, cursor: 'pointer' }}>{rowTds(r, isInvoice, expanded, false)}</tr>];
          if (expanded && subs.length) {
            subs.forEach(function (s0) {
              var sOpen = open === view + ':' + s0.key;
              out.push(<tr key={s0.key} onClick={function () { setOpen(sOpen ? view + ':' + r.key : view + ':' + s0.key); }} style={{ background: sOpen ? '#dbeafe' : '#f8fafc', color: '#334155', borderTop: '1px solid #e2e8f0', cursor: 'pointer' }} /* sticky name cell inherits this */>{rowTds(s0, false, sOpen, true)}</tr>);
              if (sOpen) { out.push(detailRow(s0.key, s0, (data.cells || []).filter(function (c) { return c.product_key === s0.parent && c.name_key === s0.name_key; }), false)); }
            });
          } else if (isOpen) {
            out.push(detailRow(r.key, r, (data.cells || []).filter(function (c) { return (view === 'product' ? c.product_key : view === 'customer' ? c.customer : c.invoice_id) === r.key; }), isInvoice));
          }
          return out;
        })}
        {rows.length === 0 && <tr><td colSpan={18} className="px-2 py-4 text-center" style={{ color: SUB, background: '#ffffff' }}>No invoices in this period.</td></tr>}</tbody>
      </table></div></div>;
    return full && typeof document !== 'undefined' ? createPortal(tableView, document.body) : tableView;
  }

  // ── set-up: descriptions, units, groups, supplier bill links ──
  function setupView() {
    var names = (data.invoice_names || []).filter(function (n) { var q = nameQ.trim().toLowerCase(); return !q || (n.name + ' ' + (n.group || '')).toLowerCase().indexOf(q) >= 0; });
    var picked = Object.keys(pick).filter(function (k) { return pick[k]; });
    var pickedNames = (data.invoice_names || []).filter(function (n) { return pick[n.key]; }).map(function (n) { return n.name; });
    return <div>
      <div className="rounded-lg p-3 mb-3" style={box}>
        <div className="text-[13px] font-extrabold mb-1">1 · Weights (how many pounds in one unit)</div>
        <div className="text-[11px] mb-2" style={{ color: SUB }}>Everything is converted to pounds. Kilograms and tons use the real conversion. Yards and linear metres use OUR reporting weights, which are not a physical conversion. Quantity × weight = pounds. Price ÷ weight = price per pound. Example: $0.30 per yard ÷ 2.5 = $0.12 per pound.</div>
        <div className="flex gap-3 items-center flex-wrap text-[12px]">
          <span><b>1 kilogram = 2.20462 lb</b> <span style={{ color: SUB }}>(fixed)</span></span>
          <span><b>1 ton = 1,000 kg = 2,204.62 lb</b> <span style={{ color: SUB }}>(fixed)</span></span>
          {['yd', 'lm'].map(function (u) { var k = 'f:' + u;
            return <span key={u} className="flex items-center gap-1"><b>{'1 ' + (u === 'yd' ? 'yard' : 'linear metre') + ' ='}</b>
              <input value={draft[k] !== undefined ? draft[k] : String((data.factors || {})[u] || '')} disabled={!canEdit} onChange={function (e) { d(k, e.target.value); }} className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 70 }, inp)} /> lb
              {canEdit && draft[k] !== undefined && <Btn bg="#047857" color="#ffffff" onClick={function () { act({ action: 'set_factor', unit: u, pounds_per_unit: draft[k] }, 'Weight saved.').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[k]; setDraft(o); } }); }}>save</Btn>}</span>; })}
        </div>
      </div>

      <div id="pl-setup-names" className="rounded-lg p-3 mb-3" style={box}>
        <div className="text-[13px] font-extrabold mb-1">2 ·What we call things when we SELL — set the unit, and put the same product under one name</div>
        <div className="text-[11px] mb-2" style={{ color: SUB }}>Typing a name that already exists ADDS the ticked descriptions to that product — you never get two products with the same name. An invoice line has a quantity but no unit, so the Hub must be told once per description whether it is sold in pounds, kilograms, tons, yards or linear metres. Tick descriptions that are the same product and give them one name. This changes the report only; the invoices keep their own wording.</div>
        <div className="flex gap-2 items-center flex-wrap mb-2">
          <input value={nameQ} onChange={function (e) { setNameQ(e.target.value); }} placeholder="find a description…" className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 220 }, inp)} />
          <span className="text-[11px] font-bold" style={{ color: SUB }}>{picked.length + ' ticked'}</span>
          {canEdit && <span className="flex items-center gap-1 text-[11px]"><b>Set ticked to:</b>{['lb', 'kg', 't', 'yd', 'lm'].map(function (u) { return <Btn key={u} disabled={!picked.length} onClick={function () { act({ action: 'set_name_unit', names: pickedNames, unit: u }, picked.length + ' description(s) set to ' + UNIT_WORDS[u] + '.'); }}>{UNIT_WORDS[u]}</Btn>; })}<Btn disabled={!picked.length} title="Not a product: shipping or an extra shipping cost charged to the customer" onClick={function () { act({ action: 'set_name_kind', names: pickedNames, kind: 'transport' }, picked.length + ' description(s) now counted as shipping charged to the customer.').then(function (ok) { if (ok) { setPick({}); } }); }}>🚚 shipping charge</Btn></span>}
          {canEdit && <span className="flex items-center gap-1 text-[11px]"><b>Group ticked as:</b>
            <input value={groupName} onChange={function (e) { setGroupName(e.target.value); }} placeholder="the name YOU want on the report" className="nt-light px-2 py-1 rounded text-[12px]" style={Object.assign({ width: 230 }, inp)} />
            <Btn bg="#047857" color="#ffffff" disabled={!picked.length || groupName.trim().length < 2} onClick={function () { act({ action: 'group_save', display_name: groupName, invoice_names: pickedNames }, 'Group “' + groupName.trim() + '” saved.').then(function (ok) { if (ok) { setPick({}); setGroupName(''); } }); }}>Save group</Btn></span>}
          {canEdit && (data.groups || []).length > 0 && <span className="flex items-center gap-1 text-[11px]"><b>or add ticked to:</b>
            <select value={addTo} onChange={function (e) { setAddTo(e.target.value); }} className="nt-light px-2 py-1 rounded text-[12px]" style={inp}><option value="">an existing group…</option>{(data.groups || []).map(function (g) { return <option key={g.id} value={g.id}>{g.name}</option>; })}</select>
            <Btn disabled={!picked.length || !addTo} onClick={function () { act({ action: 'group_save', id: addTo, invoice_names: pickedNames }, 'Added to the group.').then(function (ok) { if (ok) { setPick({}); setAddTo(''); } }); }}>Add</Btn></span>}
        </div>
        {(data.transport_names || []).length > 0 && <div className="rounded-lg p-2 mb-2 text-[11px]" style={{ background: '#e0f2fe', color: '#0c2a5e', border: '1px solid #7dd3fc' }}>
          <b>Counted as SHIPPING CHARGED TO THE CUSTOMER (transport revenue, not a product):</b>
          <div className="flex gap-1.5 flex-wrap mt-1">{(data.transport_names || []).map(function (t0) {
            return <span key={t0.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: '#ffffff', border: '1px solid #7dd3fc' }}>{t0.name + ' · $' + fmt(t0.invoiced) + ' · ' + t0.how}
              {canEdit && <button onClick={function () { act({ action: 'set_name_kind', names: [t0.name], kind: 'goods' }, '“' + t0.name + '” is now counted as a product.'); }} title="This is actually a product, not a shipping charge" style={{ fontWeight: 900, color: '#7f1d1d' }}>✕ it is a product</button>}</span>; })}</div>
          {!data.kinds_ready && <div className="mt-1 font-bold" style={{ color: '#92400e' }}>To mark descriptions yourself, run sql/v55-83-SY-profitability.sql in Supabase once more.</div>}
        </div>}
        <div className="overflow-auto rounded pl-scroll nt-solid-head" style={{ border: '1px solid ' + LINE, maxHeight: 380 }}>
          <table className="w-full text-[11px]">
            <thead><tr>{['', 'Description on the invoices', 'Lines', 'Quantity', 'Invoiced', 'Sold in', 'Reported as'].map(function (h, i) { return <th key={h + i} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
            <tbody>{names.map(function (n, i) {
              return <tr key={n.key} style={{ background: pick[n.key] ? '#ecfdf5' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE }}>
                <td className="px-2 py-1"><input type="checkbox" checked={!!pick[n.key]} onChange={function () { var o = Object.assign({}, pick); o[n.key] = !o[n.key]; setPick(o); }} style={{ width: 15, height: 15 }} /></td>
                <td className="px-2 py-1 font-bold">{n.name}</td><td className="px-2 py-1">{n.lines}</td><td className="px-2 py-1 tabular-nums">{fmt(n.qty)}</td><td className="px-2 py-1 tabular-nums">{'$' + fmt(n.invoiced)}</td>
                <td className="px-2 py-1"><select value={n.unit || ''} disabled={!canEdit || busy} onChange={function (e) { if (e.target.value === '__transport') { act({ action: 'set_name_kind', names: [n.name], kind: 'transport' }, '“' + n.name + '” is now counted as shipping charged to the customer.'); } else if (e.target.value) { act({ action: 'set_name_unit', names: [n.name], unit: e.target.value }, 'Unit saved for “' + n.name + '”.'); } }} className="nt-light px-1.5 py-0.5 rounded text-[11px]" style={Object.assign({}, inp, n.unit ? {} : { border: '2px solid #f59e0b' })}>
                  <option value="">⚠ not set</option><option value="lb">pounds</option><option value="kg">kilograms</option><option value="t">tons</option><option value="yd">yards</option><option value="lm">linear metres</option><option value="__transport">🚚 not a product — a shipping charge</option></select></td>
                <td className="px-2 py-1">{n.group ? <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#e0e7ff', color: '#312e81' }}>{n.group}</span> : <span style={{ color: SUB }}>its own name</span>}</td></tr>;
            })}</tbody>
          </table></div>
      </div>

      <div id="pl-setup-groups" className="rounded-lg p-3" style={box}>
        <div className="text-[13px] font-extrabold mb-1">3 ·Product groups — the name shown, and the SUPPLIER BILL descriptions that are its cost</div>
        <div className="text-[11px] mb-2" style={{ color: SUB }}>Linking a supplier description says “this is what we pay for that product”. The cost of a sale is then taken from those bill lines only: first a bill on the same release, otherwise bills dated in the 90 days before the invoice, otherwise the last purchase before it. A sale is charged the cost per pound × its own pounds, never a whole bill. Names that merely look alike are never assumed to be the same product.</div>
        {(data.groups || []).length === 0 && <div className="text-[11px]" style={{ color: SUB }}>No groups yet. Tick descriptions in section 2 and save a group.</div>}
        {(data.groups || []).map(function (g) {
          var nk = 'g:' + g.id; var isLink = linkFor === g.id;
          var bq = billQ.trim().toLowerCase();
          var linked = {}; g.bill_names.forEach(function (x) { linked[x.key] = true; });
          var cand = (data.bill_names || []).filter(function (b0) { return !linked[b0.key] && (!bq || (b0.name + ' ' + b0.vendors.join(' ')).toLowerCase().indexOf(bq) >= 0); }).slice(0, 200);
          return <div key={g.id} id={'pl-group-' + g.id} className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: INK }}>
            <div className="flex gap-2 items-center flex-wrap mb-1">
              <input value={draft[nk] !== undefined ? draft[nk] : g.name} disabled={!canEdit} onChange={function (e) { d(nk, e.target.value); }} className="nt-light px-2 py-1 rounded text-[12px] font-extrabold" style={Object.assign({ width: 280 }, inp)} />
              {canEdit && draft[nk] !== undefined && draft[nk].trim() !== g.name && <Btn bg="#047857" color="#ffffff" onClick={function () { act({ action: 'group_save', id: g.id, display_name: draft[nk] }, 'Name changed on the report.').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[nk]; setDraft(o); } }); }}>save name</Btn>}
              <div className="flex-1" />
              {canEdit && <Btn onClick={function () { setLinkFor(isLink ? null : g.id); setBillPick({}); setBillQ(''); }}>{isLink ? 'close' : '🔗 Link supplier bill descriptions'}</Btn>}
              {canEdit && (draft['dz:' + g.id] ? <span className="flex items-center gap-1 text-[11px]"><b style={{ color: '#7f1d1d' }}>Un-group these names?</b><Btn bg="#b91c1c" color="#ffffff" onClick={function () { act({ action: 'group_dissolve', id: g.id }, 'Group removed. The descriptions report under their own names again; nothing else changed.'); }}>yes</Btn><Btn onClick={function () { d('dz:' + g.id, false); }}>no</Btn></span>
                : <Btn onClick={function () { d('dz:' + g.id, true); }} title="The descriptions go back to their own names. Invoices and bills are untouched.">un-group</Btn>)}
            </div>
            <div className="text-[11px] mb-1"><b>Sold as:</b> {g.invoice_names.length === 0 ? <span style={{ color: '#b45309' }}>no sales descriptions</span> : g.invoice_names.map(function (x) { return <span key={x.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded mr-1 mb-1" style={{ background: '#e0e7ff', color: '#312e81' }}>{x.name}{canEdit && <button onClick={function () { act({ action: 'group_remove_name', group_id: g.id, source: 'invoice', name_key: x.key }, 'Taken out of the group.'); }} title="Take this description out of the group" style={{ fontWeight: 900 }}>✕</button>}</span>; })}</div>
            {(function () { var gc = null; (data.group_costs || []).forEach(function (x) { if (x.group_id === g.id) { gc = x; } }); var kc = 'gc:' + g.id; var km = 'gm:' + g.id;
              return <div className="flex gap-1 items-center flex-wrap text-[11px] mb-1"><b>When no supplier bill gives a cost, use:</b> $
                <input value={draft[kc] !== undefined ? draft[kc] : (gc ? String(gc.cost_per_lb) : '')} disabled={!canEdit} onChange={function (e) { d(kc, e.target.value); }} placeholder="cost / lb" className="nt-light px-1.5 py-0.5 rounded text-[11px]" style={Object.assign({ width: 80 }, inp)} /> per lb + commission $
                <input value={draft[km] !== undefined ? draft[km] : (gc ? String(gc.commission_per_lb || 0) : '')} disabled={!canEdit} onChange={function (e) { d(km, e.target.value); }} placeholder="0" className="nt-light px-1.5 py-0.5 rounded text-[11px]" style={Object.assign({ width: 70 }, inp)} /> per lb
                {canEdit && <Btn disabled={!data.manual_costs_ready} onClick={function () { act({ action: 'set_manual_cost', level: 'group', group_id: g.id, cost_per_lb: draft[kc] === undefined ? (gc ? gc.cost_per_lb : '') : draft[kc], commission_per_lb: draft[km] === undefined ? (gc ? gc.commission_per_lb : '') : draft[km] }, 'Default cost saved for ' + g.name + ' (typed by hand).').then(function (ok) { if (ok) { var o = Object.assign({}, draft); delete o[kc]; delete o[km]; setDraft(o); } }); }}>save</Btn>}
                <span className="text-[10px]" style={{ color: SUB }}>{data.manual_costs_ready ? 'Used only for sales with no cost from a linked bill; shown as “typed by hand”. A cost typed on one sale wins over this. Empty + save removes it.' : 'Run sql/v55-83-SY-profitability.sql once more to turn this on.'}</span></div>;
            })()}
            {g.link_stats && g.bill_names.length > 0 && <div className="text-[10px] mb-1" style={{ color: g.link_stats.usable ? '#065f46' : '#92400e' }}>{g.link_stats.usable ? g.link_stats.usable + ' supplier bill line(s) can be used for cost; the earliest is dated ' + g.link_stats.first + '. Sales before that date use the price of the first 90 days of purchases (assumed bought earlier).' : (g.link_stats.lines ? '⚠ The ' + g.link_stats.lines + ' linked supplier bill line(s) have no unit (lb / kg / ton …), so they cannot be turned into a cost per pound. Open those bills on the Bills screen and fill in the unit on each line.' : '⚠ No supplier bill in the Hub has a line with these descriptions yet.')}</div>}
            <div className="text-[11px]"><b>Cost comes from supplier bill lines called:</b> {g.bill_names.length === 0 ? <span className="font-extrabold" style={{ color: '#b45309' }}>nothing linked — the goods cost of this product shows as MISSING</span> : g.bill_names.map(function (x) { var bn = (data.bill_names || []).filter(function (b0) { return b0.key === x.key; })[0]; var okU = bn && bn.usable_lines > 0; return <span key={x.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded mr-1 mb-1" style={okU ? { background: '#d1fae5', color: '#065f46' } : { background: '#fef3c7', color: '#78350f', border: '1px solid #f59e0b' }} title={bn ? bn.lines + ' bill line(s), ' + bn.usable_lines + ' with a unit' + (bn.unit_from_name ? ' (unit read from the description)' : '') : 'no bill line with this description'}>{x.name}<span style={{ fontSize: 9, fontWeight: 700 }}>{bn ? ' · ' + bn.lines + ' line(s)' + (okU ? '' : ' · ⚠ no unit') : ' · ⚠ no bill lines'}</span>{canEdit && <button onClick={function () { act({ action: 'group_remove_name', group_id: g.id, source: 'bill', name_key: x.key }, 'Unlinked.'); }} title="Unlink this supplier description" style={{ fontWeight: 900 }}>✕</button>}</span>; })}</div>
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
    <style>{SCROLL_CSS}</style>
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold" style={{ color: INK }}>📊 Profitability — by product, customer and invoice</div>
      {data && data.can_see_margin === false && <div className="text-[11px] font-bold mt-1" style={{ color: '#92400e' }}>🔒 Profit and margin are hidden for you. They need the “P&L: See profit & margin” permission (Settings → Module Access) — ask an admin.</div>}
      <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="nt-light px-2 py-1 rounded text-xs" style={inp} />
      <span style={{ color: SUB }}>→</span>
      <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="nt-light px-2 py-1 rounded text-xs" style={inp} />
      <Btn bg="#047857" color="#ffffff" onClick={function () { load(from, to); }}>Apply</Btn>
      {busy && <span className="text-[11px]" style={{ color: SUB }}>Working…</span>}
    </div>
    <div className="rounded-lg px-3 py-1.5 mb-3 text-[11px] flex items-center gap-2 flex-wrap" style={{ background: '#f8fafc', color: '#334155', border: '1px solid ' + LINE }}>
      <span><b>Profit view</b> — by invoice date, includes unpaid invoices and bills. Not the cash / tax report.</span>
      <button onClick={function () { setShowAbout(!showAbout); }} className="font-bold underline" style={{ color: '#1d4ed8' }}>{showAbout ? 'Hide details' : 'About this report'}</button>
      {showAbout && <div className="w-full mt-1"><b>This is NOT the cash report.</b> It answers “did this product, customer or invoice make money?”. It is dated by invoice date and includes unpaid invoices, unpaid bills, a standard inbound allowance of $0.02 per pound (not a real payment) and any estimate, labelled. For money actually received and paid — the tax view — use <b>Accounting → Stats → Income Statement (cash basis)</b>. The two will not match. RTM and NextTrade service fees are left out of this report on purpose; they are in the cash report.</div>}
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
        {[['Goods revenue', money(tt, 'goods_revenue'), '#16a34a'], ['Transport charged', money(tt, 'transport_revenue'), '#0284c7'], ['Goods cost', money(tt, 'base_cost'), '#dc2626'], ['Commission', money(tt, 'commission'), '#dc2626'], ['Inbound allowance', money(tt, 'inbound_allowance'), '#ea580c'], ['Outbound transport', money(tt, 'outbound_cost'), '#dc2626'], [tt.complete ? 'Profit (goods + transport)' : 'Profit (known lines only)', pf(tt.profit), tt.complete ? '#059669' : '#d97706', tt.complete || !tt.uncounted_lines ? '' : tt.uncounted_lines + ' line(s) · $' + fmt(tt.uncounted_revenue) + ' not counted', tt.complete ? 'Goods profit + transport profit' : 'Goods profit + transport profit, known lines only' + (tt.uncounted_lines ? ' — ' + tt.uncounted_lines + ' line(s) / $' + fmt(tt.uncounted_revenue) + ' revenue not counted until their cost is known' : '')]].map(function (k) {
          return <div key={k[0]} className="rounded-lg px-3 py-2" title={k[4] || undefined} style={{ background: '#ffffff', border: '1px solid ' + LINE, borderLeft: '4px solid ' + k[2], color: INK }}><div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#64748b' }}>{k[0]}</div><div className="text-[16px] font-black tabular-nums" style={{ color: '#0f172a' }}>{k[1]}</div>{k[3] ? <div className="text-[10px] font-semibold" style={{ color: '#92400e' }}>{k[3]}</div> : null}</div>; })}
      </div>
      <div className="flex gap-2 items-center flex-wrap mb-2 text-[11px]">
        <span style={{ color: SUB }}>{fmt0(tt.pounds) + ' lb · ' + data.counts.invoices_in_period + ' invoice(s) · bonded / brokerage $' + fmt(tt.bonded) + ' (standard $' + fmt(data.bonded_per_houston_release || 200) + ' per Houston shipment)'}</span>
        {(data.actual_bonded_bills || []).length > 0 && <span style={{ color: SUB }}>{'Actual bonded bills dated in this period: $' + fmt(data.actual_bonded_total) + ' (' + data.actual_bonded_bills.length + ') — for comparison only, not added.'}</span>}
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
          {(data.flags || []).filter(function (f) { return f.kind === 'shipping_charged_below_cost_plus_7pct' || f.kind === 'exw_but_shipping_cost_on_release' || f.kind === 'cnf_separate_without_shipping_line' || f.kind === 'invoice_shipping_estimates_differ' || f.kind === 'invoice_shipping_estimate_split_unresolved'; }).slice(0, 60).map(function (f, i) { return <div key={'s' + i} style={{ color: '#991b1b', fontWeight: 700 }}>{'• ' + (FLAG_WORDS[f.kind] || f.kind) + ': ' + (f.invoice ? 'invoice ' + f.invoice : '') + (f.release ? 'release ' + f.release : '') + (f.charged !== undefined ? ' — charged $' + fmt(f.charged) : '') + (f.cost !== undefined ? ', our cost $' + fmt(f.cost) + (f.cost_kind === 'estimate' ? ' (estimate)' : ' (bill)') : '') + (f.minimum !== undefined ? ', minimum $' + fmt(f.minimum) + ', short by $' + fmt(f.short_by) : '') + (f.used !== undefined ? ' — $' + fmt(f.used) + ' used' : '') + (f.releases ? ' — releases ' + f.releases.join(', ') : '') + (f.amount !== undefined ? ' — $' + fmt(f.amount) : '')}</div>; })}
          {(data.flags || []).filter(function (f) { return f.kind === 'two_trucking_bills_on_one_release' || f.kind === 'transport_bill_not_marked_outbound' || f.kind === 'brokerage_bill_on_non_houston_release' || f.kind === 'bill_split_unresolved'; }).slice(0, 40).map(function (f, i) { return <div key={'f' + i}>{'• ' + (FLAG_WORDS[f.kind] || f.kind) + ': ' + (f.bill ? 'bill ' + f.bill + ' ' : '') + (f.vendor ? '(' + f.vendor + ') ' : '') + (f.release ? 'release ' + f.release + ' ' : '') + (f.releases ? 'release ' + f.releases.join(', ') + ' ' : '') + (f.bills ? '— bills ' + f.bills.join(', ') : '') + (f.why ? '— ' + f.why : '')}</div>; })}
        </div>}
      </div>}
      <div className="flex gap-1.5 flex-wrap mb-2">
        {/* v55.83-VL (Max, Nov 19: "Names, units and supplier links should be in a separate place ... different button and look" · "just make them look separated somehow") — three groups: reports, shipping, set-up */}
        <span className="flex gap-1.5 flex-wrap items-center px-1.5 py-1 rounded-lg" style={{ border: '1px solid ' + LINE }}>
          <span className="text-[10px] font-extrabold uppercase" style={{ color: SUB }}>Reports</span>
          {[['period', '📅 P&L by period (goods · transport)'], ['product', 'By product'], ['customer', 'By customer'], ['invoice', 'By invoice']].map(function (v) {
            return <button key={v[0]} onClick={function () { setView(v[0]); setOpen(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={view === v[0] ? { background: '#0f172a', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{v[1]}</button>; })}
        </span>
        <span className="flex gap-1.5 flex-wrap items-center px-1.5 py-1 rounded-lg" style={{ border: '1px solid #7dd3fc', background: '#f0f9ff' }}>
          <span className="text-[10px] font-extrabold uppercase" style={{ color: '#075985' }}>Shipping</span>
          {[['containers', '🚢 Containers (shipping cost)'], ['estfinal', '⚖ Estimate vs Final (shipping)']].map(function (v) {
            return <button key={v[0]} onClick={function () { setView(v[0]); setOpen(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={view === v[0] ? { background: '#075985', color: '#ffffff' } : { background: '#e0f2fe', color: '#075985' }}>{v[1]}</button>; })}
        </span>
        <button onClick={function () { setView('setup'); setOpen(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" title="Set-up, not a report: product names, units and which supplier bills belong to which product" style={view === 'setup' ? { background: '#7c2d12', color: '#ffffff', border: '2px solid #7c2d12' } : { background: '#ffffff', color: '#7c2d12', border: '2px dashed #c2410c' }}>⚙ Set-up: names, units and supplier links</button>
        <span className="text-[11px] self-center" style={{ color: SUB }}>Click a product to see the names that make it up. Click a name to see its shipments.</span>
        {(view === 'product' || view === 'customer' || view === 'invoice') && <span className="flex items-center gap-1 ml-auto">
          <input type="search" value={searchQ} onChange={function (e) { setSearchQ(e.target.value); setOpen(null); }} placeholder="🔎 Search invoice, customer, release, product…" aria-label="Search the rows of this table" className="nt-light px-2.5 py-1.5 rounded-lg text-[12px]" style={{ width: 290, border: '1px solid ' + LINE, background: '#ffffff', color: INK }} />
          {searchQ.trim() !== '' && <span className="text-[11px] font-bold" style={{ color: '#b45309' }}>{filterRowsBySearch(view === 'product' ? (data.by_product || []) : view === 'customer' ? (data.by_customer || []) : (data.by_invoice || []), searchQ).length + ' of ' + (view === 'product' ? (data.by_product || []) : view === 'customer' ? (data.by_customer || []) : (data.by_invoice || [])).length + ' shown — the totals above are for ALL rows'}</span>}
          {searchQ.trim() !== '' && <button type="button" onClick={function () { setSearchQ(''); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155', border: '1px solid ' + LINE }}>clear</button>}
        </span>}
      </div>
      {view === 'period' && periodView()}
      {view === 'product' && viewTable(data.by_product || [], 'Product', false)}
      {view === 'customer' && viewTable(data.by_customer || [], 'Customer', false)}
      {view === 'invoice' && viewTable(data.by_invoice || [], 'Invoice', true)}
      {view === 'setup' && setupView()}
      {view === 'containers' && containersView()}
      {view === 'estfinal' && estFinalView()}
      <div className="text-[10px] mt-2" style={{ color: SUB }}>
        Goods profit = goods revenue − goods cost − commission − inbound allowance − bonded/brokerage. Transport profit = transport charged − trucking − freight. Total profit = both. Averages are total ÷ total pounds. Costs that belong to a release are split across all the goods on that release by pounds, before any grouping or filter. Bonded / brokerage (the same thing) is $200 per Houston container (release 1002-), none on paper / foil containers or Canada (1001-). A bonded or brokerage bill that names exactly that one Houston release replaces the $200; any other bonded / brokerage bill is only listed for comparison.
      </div>
    </div>}
    {!data && busy && <div className="text-[12px] p-2" style={{ color: SUB }}>Building the report…</div>}
    {/* v55.83-VQ (Max, Nov 19: "clicking on view invoice from here is not working" — in FULL SCREEN the invoice opened BEHIND the table: the full-screen layer is above the viewer's own layer. The viewer is now mounted on the page body, above full screen.) */}
    {peekId && typeof document !== 'undefined' && createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 300 }}><InvoicePeek invoiceId={peekId} onClose={function () { setPeekId(null); }} onEdit={function (id2) { setFull(false); try { window.__ntOpenInvoiceEdit = id2; window.dispatchEvent(new CustomEvent('nt-open-invoice-edit', { detail: id2 })); } catch (e4) {} setPeekId(null); setFull(false); onGo('invoices'); }} /></div>, document.body)}
  </div>;
}
