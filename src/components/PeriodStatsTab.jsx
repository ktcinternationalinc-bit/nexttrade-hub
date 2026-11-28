'use client';
// v55.83-PH — Accounting > 📉 Stats (Max, Nov 6): "i need a tab from june 1st
// on for both invoices and bills to see stats". Default June 1, 2026 → today;
// invoices and bills side by side; month-by-month table; CSV.
import { remainderRows } from '../lib/paid-through-blocks'; // v55.83-SR
import { spendingByCategoryCsv, spendingDetailCsv, incomeStatementCsv, taxPackBlocked } from '../lib/tax-pack'; // v55.83-WF step C — the accountant pack's spending files
import React, { Fragment, useState, useEffect } from 'react';
import UndoPickBar from './UndoPickBar'; // v55.83-WP — undo the last category pick
import { keepUndoBar, undoChangedSomething } from '../lib/undo-bar-state'; // v55.83-WS — the Undo bar stays only when the undo can be finished
import InvoicePeek from './InvoicePeek'; // v55.83-PS — click a reference → the invoice pops up
import { acctAccess } from '../lib/accounting-access'; // v55.83-RE
import { hubFetch } from '../lib/hub-fetch'; // v55.83-WQ — every accounting call carries the signed-in person's token
// v55.83-ZD — a CSV money cell: a withheld figure (null / missing) is "restricted", never 0 and never a crash
export function csvMoney(x) { return x === null || x === undefined || isNaN(Number(x)) ? 'restricted' : Number(x).toFixed(2); }

var KIND_LABELS = { income: 'Income', cogs: 'Cost of goods sold', expense: 'Expense', other_income: 'Other income', other_expense: 'Other expense', transfer: 'Transfer', not_pnl: 'Not P&L (loan/owner)' }; // v55.83-PW

// v55.83-QB (Max, Nov 7): the RTM radio. Real-cost view = take the RTM
// payments OUT of the category they were paid under (professional fees),
// put the covered bills INTO their real categories, and show the
// unallocated remainder as RTM's service fee. −payments + bills + fee = 0,
// so every total is IDENTICAL in both views — only the breakdown moves.
export function rtmAdjust(cats0, rtm) {
  var r2a = function (x) { return Math.round((Number(x) || 0) * 100) / 100; };
  var map = {};
  (cats0 || []).forEach(function (c) { map[c.key] = Object.assign({}, c); }); // v55.83-QY — keep earlier companies' markers when several are applied in turn
  ((rtm && rtm.payments_by_cat) || []).forEach(function (p) {
    if (!map[p.key]) { map[p.key] = { key: p.key, label: p.label || p.key, kind: 'expense', count: 0, total: 0 }; }
    map[p.key].total = r2a(map[p.key].total - p.total); map[p.key].rtm_out = p.total;
  });
  ((rtm && rtm.allocations_by_cat) || []).forEach(function (a) {
    if (!map[a.key]) { map[a.key] = { key: a.key, label: a.label || a.key, kind: a.kind || 'expense', count: 0, total: 0 }; }
    map[a.key].total = r2a(map[a.key].total + a.total); map[a.key].via_rtm = r2a((map[a.key].via_rtm || 0) + a.total); map[a.key].count += a.count || 0;
  });
  // v55.83-SR — the remainder is shown as up to three rows that always add up to it: the company's fee / advance (as
  // before), the service fee booked on requests, and money still waiting for bills. Same money, so totals never move.
  // (label fallback kept here: 'RTM service fee (payments − covered bills)'; an affiliate's remainder stays 'not_pnl')
  remainderRows(rtm).forEach(function (rw) { map[rw.key] = rw; });
  return Object.keys(map).map(function (k) { return map[k]; })
    .filter(function (c) { return Math.abs(c.total) > 0.004 || c.via_rtm || c.rtm_out || c.net === true; }) // v55.83-WO — a net category (returned checks) stays listed at 0
    .sort(function (x, y) { return y.total - x.total; });
}
// v55.83-TS (Max, Nov 17: "uncategorized -235,000 — what is that") — money sent to a paid-through company (NextTrade, RTM
// Capital) with NO category was taken out under a made-up "uncategorized" category: a -$235,000 row with nothing behind it,
// counted as an expense on the Income Statement. It is the SAME money as the ⚠ Uncategorized row, so it is folded back there.
export function foldUnc(cats) {
  var shift = 0;
  var out = (cats || []).filter(function (c) { if (c.key === 'uncategorized') { shift += Number(c.total) || 0; return false; } return true; });
  out.uncShift = Math.round(shift * 100) / 100;
  return out;
}
function nd(x) { return (x === null || x === undefined) ? '—' : '$' + (Number(x) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } // v55.83-PO
function fmt(n) { if (n == null) { return '•••'; } return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } // v55.83-QI — masked totals render as •••
var TODAY = new Date().toISOString().substring(0, 10);

// v55.83-XR (Codex 10:32 P2) — the Income Statement when the money-back records could not be read: NO figures at all (no revenue,
// expenses or profit recomputed from the incomplete categories, in either view) and no "covers the whole period" claim
export function incomeStatementBlocked(spending) { return !!(spending && spending.incomplete); }
export function IncomeStatementUnavailable(p) {
  return <div className="mt-3 rounded-lg p-3" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
    <div className="text-xs font-extrabold mb-1" style={{ color: '#7f1d1d' }}>📊 INCOME STATEMENT — {p.from} → {p.to}: NOT AVAILABLE</div>
    <div className="text-[11px] font-bold" style={{ color: '#7f1d1d' }}>The statement cannot be shown because part of the data could not be read: {p.why} Without it, revenue, expenses and profit would be wrong. Reload the page to try again.</div>
  </div>;
}

export default function PeriodStatsTab(props) {
  var onGo = props.onGo || function () {}; // v55.83-RN — the invoice peek's "edit" called onGo, which was never declared (crash on click)
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  // v55.83-RE (Max, Nov 8 15:12) — Accounting Access (P1) opens Stats; each
  // card then follows its own group (P3 invoices, P2 bank/financial, P1 bills owed).
  var VS = acctAccess(isSuperAdmin, modulePerms, userProfile && userProfile.role, 'ktc'); // RF — a ClickBooks (KTC Hub) screen
  var canView = VS.access;
  var toast = props.toast || { success: function () {}, error: function () {} };

  // v55.83-VD (Max, Nov 19: "i need the full year in the financial reports") — the Financial Reports screen opens this from 1 January
  var s1 = useState(/^\d{4}-\d{2}-\d{2}$/.test(String(props.initialFrom || '')) ? props.initialFrom : '2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(TODAY); var to = s2[0]; var setTo = s2[1];
  var sSp = useState(null); var spCat = sSp[0]; var setSpCat = sSp[1]; // v55.83-PQ — spending-by-category drill (category key or '' = uncategorized, 'transfer')
  // v55.83-QY — one tax/real-cost switch PER paid-through company (RTM
  // Capital, NextTrade Industries, …). DEFAULT {} = tax view for all.
  var sRt = useState({}); var ptOn = sRt[0]; var setPtOn = sRt[1];
  function ptBlocks() { return (data && data.spending && (data.spending.paid_through || (data.spending.rtm ? [data.spending.rtm] : []))) || []; }
  // v55.83-RB — a RELATED company (NextTrade) defaults to the real-cost view:
  // money sent ahead of its costs is an advance, not spending. RTM stays on the
  // one-line tax view by default (Max's decision). Either can be switched.
  function ptIsOn(b) { var bk = b.key || b.payer; return ptOn[bk] === undefined ? true : ptOn[bk] === true; } // v55.83-TS (Max, Nov 17: "NextTrade as well as RTM Capital will have this real-cost view") — real-cost is the default for every paid-through company; each still has its switch // v55.83-SR — one switch per block (a company can have a before / from block)
  function ptAdjust(cats0) { var out = cats0 || []; ptBlocks().forEach(function (b0) { if (ptIsOn(b0)) { out = rtmAdjust(out, b0); } }); return foldUnc(out); }
  // v55.83-WF step C (Max 20 Nov; Codex 18:00) — the accountant pack is the TAX presentation: every transfer to RTM / NextTrade stays ONE
  // Professional-fees amount, in full. Nothing is re-bucketed here for any company, whatever the switches above say (src/lib/tax-pack.js).
  function taxCats(cats0) { return foldUnc(cats0 || []); }
  // the ⚠ Uncategorized spending total AFTER paid-through money is shown as the bills it paid (screen view / accountant view)
  function uncOutView() { var u = data && data.spending && data.spending.uncategorized; if (!u) { return 0; } return Math.max(0, Math.round((Number(u.total) + ptAdjust(data.spending.categories).uncShift) * 100) / 100); }
  function uncOutTax() { var u = data && data.spending && data.spending.uncategorized; if (!u) { return 0; } return Math.max(0, Math.round((Number(u.total) + taxCats(data.spending.categories).uncShift) * 100) / 100); }
  var ptOnNames = ptBlocks().filter(function (b1) { return ptIsOn(b1); }).map(function (b2) { return b2.payer; });
  var sIn = useState(null); var inCat = sIn[0]; var setInCat = sIn[1]; // v55.83-PV — income-by-category drill
  var sPk = useState(null); var peekId = sPk[0]; var setPeekId = sPk[1]; // v55.83-PS
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(null); var drill = s5[0]; var setDrill = s5[1]; // {key, title, unitWho}
  // v55.83-TS (Max, Nov 17: "for uncategorized i should be able to select category from right there" + "same description should
  // fill up automatically creating the rule and saving") — the SAME save as All Transactions (expense-rules bulk_classify,
  // single pick): it learns a rule from the description's key words and fills every look-alike at once.
  var canPick = isSuperAdmin || modulePerms['bank.classify'] === true; /* v55.83-UG (Max, Nov 18: "the admin should not just have access, i need to give him access") — only the super admin bypasses; admins/owners use their switches */
  var sCl = useState(null); var catList = sCl[0]; var setCatList = sCl[1];
  var categoryErrorState = useState(''); var categoryError = categoryErrorState[0]; var setCategoryError = categoryErrorState[1];
  var sSv = useState({}); var saving = sSv[0]; var setSaving = sSv[1];
  // v55.83-WP (Max, 21 Nov: "need to be able to undo a category selection") — the last pick's undo point, and the undo itself
  var sXL = useState(null); var leftList = sXL[0]; var setLeftList = sXL[1]; // v55.83-XU — lines left by Remove category
  var sUndo = useState(null); var undoPt = sUndo[0]; var setUndoPt = sUndo[1]; var sUndoB = useState(false); var undoBusy = sUndoB[0]; var setUndoBusy = sUndoB[1];
  var editingCategory = undoBusy || Object.keys(saving).length > 0;
  function undoPick() { if (!undoPt || busy || editingCategory) { return; } setUndoBusy(true); erApi('undo_category_pick', { undo_id: undoPt.id }).then(function (j) { if (j && j.ok) { toast.success(j.message || 'Undone.', { duration: 9000 }); setUndoPt(null); return load(data.from, data.to); } toast.error((j && j.error) || 'Not undone.', { duration: 12000 }); if (keepUndoBar(j)) { if (undoChangedSomething(j)) { return load(data.from, data.to); } } else { setUndoPt(null); } }).finally(function () { setUndoBusy(false); }); }
  function erApi(action, payload) {
    return hubFetch('/api/accounting/expense-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {}, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function loadCategoryChoices() {
    setCategoryError('');
    return erApi('list').then(function (j) {
      if (j && j.ok) { setCatList((j.categories || []).filter(function (c) { return c.active !== false; })); }
      else { setCategoryError((j && j.error) || 'Could not load categories.'); }
    });
  }
  var categoryDrillOpen = spCat !== null || inCat !== null;
  useEffect(function () {
    if (canPick && categoryDrillOpen && !catList) { loadCategoryChoices(); }
  }, [canPick, categoryDrillOpen]); // eslint-disable-line
  function pickCat(r, key) {
    if (!canPick || busy || editingCategory || !key || !r || !r.id || r.paired) { return; }
    if (key === '__new__') {
      var nm = window.prompt('New category name (created as an EXPENSE type — change the type later in 🏷 Categories & Rules):');
      if (!nm || !nm.trim()) { return; }
      erApi('save_category', { label: nm.trim(), kind: 'expense' }).then(function (jc) {
        var newKey = jc && (jc.key || (jc.category && jc.category.key));
        if (jc && jc.ok && newKey) { loadCategoryChoices(); return pickCat(r, newKey); }
        else { toast.error((jc && jc.error) || 'Could not create the category.'); }
      });
      return;
    }
    setSaving(function (m) { var n = Object.assign({}, m); n[r.id] = true; return n; });
    erApi('bulk_classify', { ids: [r.id], classification: key, single_pick: true }).then(function (j) {
      if (j && j.ok && j.updated > 0) {
        setUndoPt(j.undo_id ? { id: j.undo_id, who: r.who, label: key, hours: j.undo_hours, ready: j.undo_ready !== false } : null);
        var more = Number(j.look_alikes_updated) || 0; var left = Number(j.look_alikes_left_people) || 0;
        toast.success('Saved' + (j.rules_learned ? ' — rule learned' : '') + (more ? ' — ' + more + ' more with the same description filled in' : '') +
          (left ? ' (' + left + ' a person already categorized were left as they are)' : '') + '.' + (j.look_alikes_error ? ' ⚠ ' + j.look_alikes_error : ''));
        return load(data.from, data.to);
      } else { toast.error((j && j.error) || 'Nothing was saved — reload the page and try again.'); }
    }).finally(function () { setSaving(function (m) { var n = Object.assign({}, m); delete n[r.id]; return n; }); });
  }
  // v55.83-XU (Max 22 Nov: "i need to be able to uncATEORIZE A SELCTION AFTER I CATEGORIZE IT.") — take the category off one line
  // (✕ on the row) or every line listed under this category; same server action and checks as All Transactions; asks first
  function removeCat(ids, what) {
    var list = (ids || []).filter(Boolean);
    if (!canPick || busy || editingCategory || !list.length) { return; }
    if (!window.confirm('Take the category off ' + (what || (list.length + ' line(s)')) + '?\n\nThey go back to Uncategorized and rules will not fill them again. Lines already in the ClickBooks ledger, sent to Wave, in a closed month, matched, paired as a transfer or verified are LEFT as they are and listed.')) { return; }
    setSaving(function (m) { var n = Object.assign({}, m); list.forEach(function (id) { n[id] = true; }); return n; });
    erApi('clear_category', { ids: list, confirm: true }).then(function (j) {
      if (j && j.ok) { if ((j.refused || []).length) { toast.error(j.message, { duration: 9000 }); setLeftList(j.refused); } else { toast.success(j.message); setLeftList(null); } return load(data.from, data.to); }
      else { toast.error((j && j.error) || 'Nothing was changed.'); }
    }).finally(function () { setSaving(function (m) { var n = Object.assign({}, m); list.forEach(function (id) { delete n[id]; }); return n; }); });
  }
  // (Codex 18:08) the lines that were LEFT stay listed (date, payee, amount, reason) until closed; a restricted line is counted only
  function leftPanel() {
    if (!leftList || !leftList.length) { return null; }
    var seenL = leftList.filter(function (x) { return !x.restricted; }); var restL = leftList.length - seenL.length;
    return <div className="mt-1 mb-1 rounded p-1.5 text-[10px]" style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#78350f' }}>
      <div className="flex items-center gap-2 mb-0.5"><b>{leftList.length} line(s) kept their category</b><button onClick={function () { setLeftList(null); }} className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#ffffff', border: '1px solid #f59e0b', color: '#78350f' }}>close</button></div>
      {seenL.map(function (x) { return <div key={x.id} className="flex gap-2"><span className="tabular-nums">{x.date}</span><span className="font-semibold">{x.who}</span><span className="tabular-nums">${fmt(x.amount)}</span><span>— {x.why}</span></div>; })}
      {restL > 0 && <div>{restL} line(s) you may not change were left as they are.</div>}
    </div>;
  }
  function removeBtn(r) {
    if (!canPick || !r || !r.id || r.paired) { return null; }
    if (saving[r.id]) { return <span className="text-[9px] font-bold" style={{ color: '#475569' }}>saving…</span>; }
    return <button type="button" disabled={busy || editingCategory} onClick={function () { removeCat([r.id], 'this line (' + String(r.who || '').substring(0, 40) + ')'); }} title="Remove the category from this line (back to Uncategorized)" className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #f59e0b' }}>✕ remove category</button>;
  }
  function catPicker(r) {
    var current = r.bank_category || '';
    if (r.bank_category === undefined) { current = r.category || ''; }
    if (!canPick || !r.id || r.paired) { return <span>{current ? ((catList || []).find(function (c) { return c.key === current; }) || {}).label || current : 'Uncategorized'}</span>; }
    if (saving[r.id]) { return <span className="text-[9px] font-bold" style={{ color: '#475569' }}>saving…</span>; }
    if (categoryError) { return <button type="button" className="underline" title={categoryError} onClick={loadCategoryChoices}>Retry loading categories</button>; }
    return <select aria-label={'Category for ' + r.who + ' on ' + r.date} value={current} disabled={!catList || busy || editingCategory} onChange={function (e) { pickCat(r, e.target.value); }} className="nt-light text-[11px] font-semibold rounded px-1 py-1"
      style={{ border: '1px solid #fdba74', background: '#ffffff', color: '#0f172a', maxWidth: 190 }}>
      <option value="" disabled>{catList ? 'Uncategorized' : 'Loading categories…'}</option>
      {current && !(catList || []).some(function (c) { return c.key === current && c.key !== 'needs_clarification'; }) && <option value={current} disabled>{current}</option>}
      {(catList || []).filter(function (c) { return c.key !== 'needs_clarification'; }).map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
      {catList && <option value="__new__">＋ new category…</option>}
    </select>;
  }

  function bankCategoryDetails(key, title, moneyIn) {
    var report = data.spending;
    var bank = (moneyIn ? report.in_rows : report.rows) || [];
    var direct = bank.filter(function (r) { return r.category === key; });
    var blocks = moneyIn ? [] : ptBlocks().filter(ptIsOn);
    var remainder = blocks.find(function (block) { return remainderRows(block).some(function (row) { return row.key === key; }); });
    var support = remainder ? remainderRows(remainder).find(function (row) { return row.key === key; }) : null;
    var billRows = blocks.flatMap(function (block) {
      return (block.rows || []).filter(function (row) { return remainder ? block === remainder && !support.money_back : row.category === key; });
    });
    var bankById = new Map(bank.map(function (row) { return [row.id, row]; }));
    var fundingRows = remainder ? (support.money_back ? support.money_back_rows : remainder.lines) || [] : [];
    var displayedBankRows = remainder ? fundingRows : direct;
    var editableIds = [...new Set(direct.filter(function (r) { return r.id && !r.paired && r.category !== 'transfer'; }).map(function (r) { return r.id; }))];
    var clipped = report.category_rows_limited && report.category_rows_limited[moneyIn ? 'in' : 'out'];
    return <tr><td colSpan={4} className="px-1 pb-2">
      <section className="rounded border border-slate-200 p-2" style={{ background: '#ffffff', color: '#0f172a' }} aria-label={title + ' transactions'}>
        <div className="overflow-x-auto">
          {displayedBankRows.length > 0 && <table className="w-full min-w-[540px] text-[10px]" aria-label={title + ' bank records'}>
            <thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="text-left py-1">Date</th><th scope="col" className="text-left">Description</th><th scope="col" className="text-right">Amount</th><th scope="col" className="text-right">Bank category</th></tr></thead>
            <tbody>{displayedBankRows.map(function (r, index) {
              var actual = remainder ? bankById.get(r.id) : r;
              var incoming = moneyIn || r.money_in || !!(support && support.money_back);
              return <tr key={index} className="border-b border-slate-100">
                <td className="py-1 pr-2 whitespace-nowrap">{r.date}</td>
                <td className="py-1 pr-2 font-semibold">{r.who || (actual && actual.who) || (support && support.money_back ? 'Returned funds' : 'Bank transfer')}{r.paired && <span className="ml-1 font-normal">Paired transfer</span>}</td>
                <td className="py-1 pr-2 text-right tabular-nums font-bold">{incoming ? '+' : '−'}${fmt(Math.abs(r.amount))}</td>
                <td className="py-1 text-right">{actual ? <>{catPicker(actual)}{!remainder && actual.category && actual.category !== 'transfer' && !actual.paired && <span className="ml-1">{removeBtn(actual)}</span>}</> : '—'}</td>
              </tr>;
            })}</tbody>
          </table>}
          {remainder && <p className="mt-1 text-[10px] text-slate-600">Supporting records for {remainder.payer}. Bank amounts are shown in full. The category total uses the report’s paid-through calculation.</p>}
          {billRows.length > 0 && <table className="w-full mt-2 text-[10px]" aria-label={title + ' covered bills'}>
            <thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="text-left">Paid date</th><th scope="col" className="text-left">Covered bill</th><th scope="col" className="text-right">Amount paid</th></tr></thead>
            <tbody>{billRows.map(function (bill, index) { return <tr key={index} className="border-b border-slate-100"><td className="py-1">{bill.date}</td><td>{bill.who} · {bill.ref}</td><td className="text-right tabular-nums">${fmt(bill.amount)}</td></tr>; })}</tbody>
          </table>}
          {!displayedBankRows.length && !billRows.length && <p className="text-[10px] text-slate-600">No underlying records are available for this row in the current report.</p>}
          {clipped && <p className="mt-1 text-[10px] text-slate-600">Some bank records are outside the report’s display limit. Use a shorter date range to see more.</p>}
        </div>
        {canPick && !remainder && editableIds.length > 1 && <div className="mt-1 text-right"><button type="button" disabled={busy || editingCategory} onClick={function () { removeCat(editableIds, 'all ' + editableIds.length + ' transactions listed here'); }} className="px-2 py-1 rounded text-[10px] font-bold bg-amber-100 text-amber-950">Remove category from all {editableIds.length} transactions listed</button></div>}
      </section>
    </td></tr>;
  }

  function categoryRow(category, moneyIn, percent, style) {
    var open = (moneyIn ? inCat : spCat) === category.key;
    var setOpen = moneyIn ? setInCat : setSpCat;
    return <Fragment key={category.key}>
      <tr style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', ...style }} onClick={function () { setOpen(open ? null : category.key); }}>
        <th scope="row" className="py-1 pr-2 text-left font-bold">
          <button type="button" aria-expanded={open} className="text-left">{category.label}
            {category.kind && <>{' '}<span className="px-1 py-0.5 rounded text-[8px] font-extrabold" style={category.kind === 'not_pnl' ? { background: '#f3e8ff', color: '#6b21a8' } : { background: '#f1f5f9', color: '#475569' }}>{KIND_LABELS[category.kind] || category.kind}</span></>}
            {' '}<span className="text-[9px] text-slate-600">{open ? 'Hide transactions' : 'Show transactions'}</span>
          </button>
        </th>
        <td className="py-1 pr-2 text-right tabular-nums">{category.count}</td>
        <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: style && style.color || (moneyIn ? '#065f46' : undefined) }}>${fmt(category.total)}</td>
        <td className="py-1 text-right tabular-nums">{percent}</td>
      </tr>
      {open && bankCategoryDetails(category.key, category.label, moneyIn)}
    </Fragment>;
  }

  function load(f, t) {
    setBusy(true);
    return hubFetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'period_stats', inline_category_details: true, from: f, to: t, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setData(j); } else { toast.error((j && j.error) || 'Could not load stats.'); setData({ denied: true, error: (j && j.error) || '' }); } })
      .catch(function () { toast.error('Could not refresh the report. Select Go to reload it.'); setData({ denied: true, error: 'Could not load stats.' }); })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canView) { load(from, to); } }, []); // eslint-disable-line

  if (!canView) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
      Stats need the <b>Bills: View</b> or <b>AR balances</b> permission — Settings → 🏦 Banking & Accounting Access.</div>;
  }

  function csv() {
    if (!data || !data.months) { return; }
    var L = ['month,invoiced,invoices,collected,payments,bills_entered,bills,bills_paid,bill_payments,net_cash'];
    data.months.forEach(function (m) {
      // v55.83-ZD — a withheld figure (null) is written as "restricted", never 0 and never a crash
      L.push([m.month, csvMoney(m.invoiced), m.invoiced_count, csvMoney(m.collected), m.collected_count,
        csvMoney(m.billed), m.billed_count, csvMoney(m.bills_paid), m.bills_paid_count, csvMoney(m.net)].join(','));
    });
    var blob = new Blob([L.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'period-stats-' + data.from + '-to-' + data.to + '.csv'; a.click();
  }

  function Card(p2) {
    if (p2.locked) { // v55.83-RE — restricted card: no number, no click
      return <div className="rounded-xl p-3 text-left" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', minWidth: 160, flex: '1 1 160px' }}>
        <div className="text-[10px] font-extrabold uppercase" style={{ color: '#475569' }}>{p2.label}</div>
        <div className="text-lg font-extrabold" style={{ color: '#475569' }}>Restricted</div>
        <div className="text-[9px] font-bold mt-0.5" style={{ color: '#64748b' }}>{p2.why}</div>
      </div>;
    }
    return <button onClick={p2.onClick} className="rounded-xl p-3 text-left" style={{ background: p2.bg, border: '1px solid ' + p2.border, minWidth: 160, flex: '1 1 160px', cursor: 'pointer' }}>
      <div className="text-[10px] font-extrabold uppercase" style={{ color: p2.fg, opacity: 0.75 }}>{p2.label}</div>
      <div className="text-lg font-extrabold tabular-nums" style={{ color: p2.fg }}>{p2.value}</div>
      {p2.sub && <div className="text-[10px] font-semibold" style={{ color: p2.fg, opacity: 0.75 }}>{p2.sub}</div>}
      <div className="text-[9px] font-bold mt-0.5" style={{ color: p2.fg, opacity: 0.55 }}>click for the rows ▸</div>
    </button>;
  }
  function openDrill(key, title, unitWho) { setDrill({ key: key, title: title, unitWho: unitWho }); }
  function drillRows() { return (data && data.drills && data.drills[drill.key]) || []; }
  function drillSum() { var t2 = 0; drillRows().forEach(function (r) { t2 += Number(r.amount) || 0; }); return Math.round(t2 * 100) / 100; }

  function dl(name, lines) {
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
  }
  function rowsCsv(rows, kindLabel) {
    var lines = ['reference,who,date,due_date,original,paid,open,amount,source'];
    (rows || []).forEach(function (r) {
      lines.push(['"' + String(r.ref || '').replace(/"/g, '""') + '"', '"' + String(r.who || '').replace(/"/g, '""') + '"',
        r.date || '', r.due || '', r.total === null || r.total === undefined ? '' : Number(r.total).toFixed(2),
        r.paid === null || r.paid === undefined ? '' : Number(r.paid).toFixed(2),
        r.open === null || r.open === undefined ? '' : Number(r.open).toFixed(2),
        Number(r.amount || 0).toFixed(2), '"' + String(r.source || '') + '"'].join(','));
    });
    return lines;
  }
  function taxPack() {
    var blockedWhy = data && data.spending ? taxPackBlocked(data.spending) : null; // v55.83-XR — no definitive pack from an incomplete report
    if (blockedWhy) { toast.error('The accountant pack is not available: this report is incomplete — ' + blockedWhy + ' Reload and try again.', { duration: 12000 }); return; }
    if (data && data.totals_masked) { toast.error('The accountant pack needs the "Accounting: See Money Totals" permission — totals are hidden for your account.'); return; } // v55.83-QI
    if (data && data.spending_restricted) { toast.error('The accountant pack is not available for these dates: ' + (data.spending_restricted.words || 'the figures include a starting balance only the super admin may see.')); return; } // v55.83-XO (Codex 14:52 P1) — never a pack without its spending files
    // v55.83-PQ (Max, Nov 7 05:09): "need to make sure we have the reports
    // necessary to file our taxes" — one click, every hub CSV the accountant
    // needs for the chosen period, consistently named. (Wave remains the 2026
    // book of record until cutover; this is the supporting detail.)
    var tag = from + '_to_' + to;
    var d = data.drills || {};
    dl('tax-pack-1-revenue-invoiced-' + tag + '.csv', rowsCsv(d.invoiced));
    var col2 = rowsCsv(d.collected);
    // v55.83-PQ (Max, 05:12): "pull data from other system to complete full tax
    // reporting" — Wave-era payments were imported as LIFETIME totals without
    // per-payment dates, so they cannot appear in a dated CSV. Say so IN the
    // file, so no accountant mistakes this for the whole year's collections.
    col2.push('');
    col2.push('"NOTE: payments recorded in Wave before the hub tracked dated payment rows are NOT listed here (Wave stores them as lifetime totals without dates). For periods before the hub, use Wave\'s own Income/Payments report, or ask for the Wave payment-history migration."');
    dl('tax-pack-2-revenue-collected-' + tag + '.csv', col2);
    dl('tax-pack-3-open-receivables-' + tag + '.csv', rowsCsv(d.open_invoices));
    dl('tax-pack-4-bills-entered-' + tag + '.csv', rowsCsv(d.billed));
    dl('tax-pack-5-bills-paid-' + tag + '.csv', rowsCsv(d.bills_paid));
    dl('tax-pack-6-open-payables-' + tag + '.csv', rowsCsv(d.open_bills));
    if (data.spending) {
      dl('tax-pack-7-spending-by-category-' + tag + '.csv', spendingByCategoryCsv(data.spending, KIND_LABELS)); // v55.83-WF step C — built in src/lib/tax-pack.js (run in a test)
      dl('tax-pack-8-spending-detail-' + tag + '.csv', spendingDetailCsv(data.spending));
    }
    if (data.spending && data.spending.in_categories) {
      var spi = ['category,type,deposits,total_usd'];
      (data.spending.in_categories || []).forEach(function (c) { spi.push('"' + String(c.label).replace(/"/g, '""') + '",' + (KIND_LABELS[c.kind] || c.kind || '') + ',' + c.count + ',' + Number(c.total).toFixed(2)); });
      if (data.spending.not_pnl_in && data.spending.not_pnl_in.count > 0) { spi.push('"NOT P&L - loan proceeds / owner (NOT income)",,' + data.spending.not_pnl_in.count + ',' + Number(data.spending.not_pnl_in.total).toFixed(2)); }
      if (data.spending.taxable_income !== undefined) { spi.push('"TAXABLE INCOME (P&L categories only)",,,' + Number(data.spending.taxable_income).toFixed(2)); }
      if (data.spending.in_uncategorized) { spi.push('"UNCATEGORIZED DEPOSITS (match before filing)",' + data.spending.in_uncategorized.count + ',' + Number(data.spending.in_uncategorized.total).toFixed(2)); }
      if (data.spending.in_transfers) { spi.push('"TRANSFERS BETWEEN OWN ACCOUNTS (not income)",' + data.spending.in_transfers.count + ',' + Number(data.spending.in_transfers.total).toFixed(2)); }
      spi.push('"REAL MONEY IN (transfers excluded)",,' + Number(data.spending.real_income).toFixed(2));
      dl('tax-pack-10-income-by-category-' + tag + '.csv', spi);
      var deti = ['date,who,amount,category,paired_transfer'];
      (data.spending.in_rows || []).forEach(function (r) { deti.push(r.date + ',"' + String(r.who).replace(/"/g, '""') + '",' + Number(r.amount).toFixed(2) + ',' + (r.category || 'UNCATEGORIZED') + ',' + (r.paired ? 'yes' : '')); });
      dl('tax-pack-11-income-detail-' + tag + '.csv', deti);
    }
    if (data.spending && data.spending.in_categories) {
      dl('tax-pack-12-income-statement-cash-basis-' + tag + '.csv', incomeStatementCsv(data.spending)); // v55.83-WF step C
    }
    var mo = ['month,invoiced,collected,bills_entered,bills_paid,net_cash'];
    (data.months || []).forEach(function (m) { mo.push(m.month + ',' + csvMoney(m.invoiced) + ',' + csvMoney(m.collected) + ',' + csvMoney(m.billed) + ',' + csvMoney(m.bills_paid) + ',' + csvMoney(m.net)); }); // ZD: null → "restricted"
    dl('tax-pack-9-monthly-summary-' + tag + '.csv', mo);
    toast.success('Accountant pack downloaded — 12 CSVs for ' + from + ' → ' + to + ' (incl. the cash-basis income statement).');
  }
  var inv = (data && data.invoices) || null;
  var bl = (data && data.bills) || null;
  var dV = (data && data.vis) || VS; // v55.83-RE — the server's decision wins
  return <div className="rounded-xl p-3" style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0' }}><UndoPickBar point={undoPt} busy={undoBusy} onUndo={undoPick} onClose={function () { setUndoPt(null); }} />{/* v55.83-SX (Max, Nov 16: "the font under month can't be seen") — the dark theme repaints the bg-white class (with !important), so that class is gone and the white panel is set inline so dark text is never on a dark background */}
    <InvoicePeek invoiceId={peekId} onClose={function () { setPeekId(null); }} onEdit={function (id2) { try { window.__ntOpenInvoiceEdit = id2; window.dispatchEvent(new CustomEvent('nt-open-invoice-edit', { detail: id2 })); } catch (e4) {} setPeekId(null); onGo('invoices'); }} />
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold text-slate-900">📉 Stats — invoices & bills</div>
      <input type="date" className="nt-light px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={from} onChange={function (e) { setFrom(e.target.value); }} />
      <span className="text-[10px] text-slate-500">→</span>
      <input type="date" className="nt-light px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={to} onChange={function (e) { setTo(e.target.value); }} />
      <button onClick={function () { load(from, to); }} disabled={busy || editingCategory} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>{busy ? '…' : 'Go'}</button>
      {/* v55.83-PK (Max): "the dates has something from june 1st as selection next to month year etc" */}
      {(function () {
        var y = TODAY.substring(0, 4);
        var m0 = TODAY.substring(0, 8) + '01';
        var lastM = new Date(Number(y), Number(TODAY.substring(5, 7)) - 2, 1);
        var lmFrom = lastM.toISOString().substring(0, 10);
        var lmEnd = new Date(Number(y), Number(TODAY.substring(5, 7)) - 1, 0).toISOString().substring(0, 10);
        var P = [['Jun 1 →', '2026-06-01', TODAY], ['This month', m0, TODAY], ['Last month', lmFrom, lmEnd], ['This year', y + '-01-01', TODAY]];
        return P.map(function (p2) {
          var on = from === p2[1] && to === p2[2];
          return <button key={p2[0]} disabled={busy || editingCategory} onClick={function () { setFrom(p2[1]); setTo(p2[2]); load(p2[1], p2[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{p2[0]}</button>;
        });
      })()}
      <div className="flex-1" />
      {data && data.months && <button onClick={csv} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>}
      {data && data.drills && <button onClick={taxPack} title="Every CSV your accountant needs from the hub for this period, named and dated"
        className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#7c3aed', color: '#ffffff' }}>🧾 Accountant pack</button>}
    </div>

    {!data ? <div className="text-[11px] text-slate-500">Loading…</div> :
     data.denied ? <div className="text-[11px]" style={{ color: '#92400e' }}>{data.error || 'Not permitted.'}</div> :
     <div>
      <div className="text-[10px] font-extrabold uppercase mb-1" style={{ color: '#065f46' }}>Invoices (money we earn) · {data.from} → {data.to}</div>
      <div className="flex gap-2 flex-wrap mb-3">
        <Card locked={!dV.inv} why="needs P3 · Invoicing & Collections" onClick={function () { openDrill('invoiced', 'Invoiced in period', 'Customer'); }} label={'Invoiced' + (dV.inv ? ' (' + inv.count + ')' : '')} value={'$' + fmt(inv.invoiced)} bg="#d1fae5" border="#a7f3d0" fg="#065f46" sub="invoices dated in period" />
        <Card locked={!dV.inv} why="needs P3 · Invoicing & Collections" onClick={function () { openDrill('collected', 'Collected in period', 'Customer'); }} label={'Collected' + (dV.inv ? ' (' + inv.collected_count + ' payments)' : '')} value={'$' + fmt(inv.collected)} bg="#ecfeff" border="#a5f3fc" fg="#155e75" sub="payments received in period" />
        <Card locked={!dV.inv} why="needs P3 · Invoicing & Collections" onClick={function () { openDrill('open_invoices', 'Still open — period invoices', 'Customer'); }} label="Still open from these" value={'$' + fmt(inv.still_open_from_period)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub="unpaid balance of period invoices" />
      </div>
      <div className="text-[10px] font-extrabold uppercase mb-1" style={{ color: '#7f1d1d' }}>Bills (money we owe)</div>
      <div className="flex gap-2 flex-wrap mb-3">
        <Card onClick={function () { openDrill('billed', 'Bills entered in period', 'Vendor'); }} label={'Bills entered (' + bl.count + ')'} value={'$' + fmt(bl.billed)} bg="#fee2e2" border="#fecaca" fg="#7f1d1d" sub="bills dated in period" />
        <Card locked={!dV.fin} why="needs P2 · Bank & Financial Summary" onClick={function () { openDrill('bills_paid', 'Bill payments in period', 'Vendor'); }} label={'Bills paid' + (dV.fin ? ' (' + bl.paid_count + ')' : '')} value={'$' + fmt(bl.paid)} bg="#e0e7ff" border="#c7d2fe" fg="#312e81" sub="bill payments in period" />
        <Card onClick={function () { openDrill('open_bills', 'Still open — period bills', 'Vendor'); }} label="Still open from these" value={'$' + fmt(bl.still_open_from_period)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub={bl.disputed_open > 0.005 ? ('+ $' + fmt(bl.disputed_open) + ' disputed (excluded)') : 'disputed excluded'} />
      </div>

      {drill && <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <div className="flex gap-2 items-center mb-1">
          <div className="text-xs font-extrabold" style={{ color: '#0f172a' }}>{drill.title} — the rows behind the card</div>
          <div className="flex-1" />
          <button onClick={function () { setDrill(null); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Reference</th>
            <th className="py-1 pr-2 text-left font-semibold">{drill.unitWho}</th>
            <th className="py-1 pr-2 text-left font-semibold">Date</th>
            <th className="py-1 pr-2 text-left font-semibold">Due</th>
            <th className="py-1 pr-2 text-right font-semibold">Original</th>
            <th className="py-1 pr-2 text-right font-semibold">Paid</th>
            <th className="py-1 pr-2 text-right font-semibold">Open</th>
            <th className="py-1 pr-2 text-right font-semibold">Amount</th>
            <th className="py-1 text-left font-semibold">Where it comes from</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {drillRows().slice().sort(function (a, b2) { return b2.amount - a.amount; }).map(function (r, i) {
              return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1 pr-2 font-semibold">{r.invoice_id
                  ? <button onClick={function () { setPeekId(r.invoice_id); }} className="font-bold underline" style={{ color: '#1d4ed8' }} title="Open the invoice">{r.ref}{r.rel ? ' · ' + r.rel : ''}</button>
                  : <span>{r.ref}</span>}</td><td className="py-1 pr-2">{r.who}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{r.date || '—'}</td>
                <td className="py-1 pr-2 whitespace-nowrap" style={{ color: '#7f1d1d' }}>{r.due || '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{nd(r.total)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{nd(r.paid)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{nd(r.open)}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(r.amount)}</td>
                <td className="py-1 text-[10px]" style={{ color: '#64748b' }}>{r.source}</td></tr>;
            })}
            {drillRows().length === 0 && <tr><td colSpan={9} className="py-2 text-center text-slate-500 text-[11px]">No rows in this period.</td></tr>}
          </tbody>
          <tfoot><tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
            <td className="py-1.5 pr-2 font-extrabold" colSpan={7}>Σ total — equals the card to the cent</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">${fmt(drillSum())}</td><td /></tr></tfoot>
        </table></div>
      </div>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 640 }}>
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1.5 pr-2 text-left font-semibold">Month</th>
            <th className="py-1.5 px-2 text-right font-semibold">Invoiced</th>
            <th className="py-1.5 px-2 text-right font-semibold">Collected</th>
            <th className="py-1.5 px-2 text-right font-semibold">Bills entered</th>
            <th className="py-1.5 px-2 text-right font-semibold">Bills paid</th>
            <th className="py-1.5 px-2 text-right font-semibold">Net cash (collected − bills paid)</th>
          </tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {(data.months || []).map(function (m) {
              return <tr key={m.month} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1.5 pr-2 font-bold">{m.month}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{m.invoiced == null ? 'Restricted' : <span>${fmt(m.invoiced)} <span className="text-[9px] text-slate-400">({m.invoiced_count})</span></span>}</td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#065f46' }}>{m.collected == null ? 'Restricted' : '$' + fmt(m.collected)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">${fmt(m.billed)} <span className="text-[9px] text-slate-400">({m.billed_count})</span></td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#7f1d1d' }}>{m.bills_paid == null ? 'Restricted' : '$' + fmt(m.bills_paid)}</td>
                <td className="py-1.5 px-2 text-right font-extrabold tabular-nums" style={{ color: m.net >= 0 ? '#065f46' : '#7f1d1d' }}>{m.net == null ? 'Restricted' : (m.net >= 0 ? '+$' : '−$') + fmt(Math.abs(m.net))}</td>
              </tr>;
            })}
            {(data.months || []).length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-500 text-[11px]">Nothing in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>
        US business, USD. Invoiced = by invoice date; Collected = by payment date (so a payment on an older invoice still counts in its month). Bills by bill date; disputed bills stay out of the open totals.
      </div>

      {data && data.totals_masked && <div className="mt-2 rounded-lg p-2 text-[10px] font-bold" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
        🔒 Totals are hidden for your account ("Accounting: See Money Totals" not granted).{data.rows_visible ? ' You CAN open any card and work with the underlying rows.' : ' Underlying rows are hidden too — ask for "Accounting: Open Cards (rows only)" or "See Money Totals".'}{data.date_filters_locked ? ' · Date range locked to the default — "Accounting: Change Date Filters" unlocks it.' : ''}</div>}
      {data && !data.totals_masked && data.date_filters_locked && <div className="mt-2 rounded-lg p-2 text-[10px] font-bold" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>🔒 Date range was clamped to the default — "Accounting: Change Date Filters" unlocks other periods.</div>}
      {/* v55.83-PQ (Max): "categorizing etc should affect the underlying reports" */}
      {data.spending_restricted && <div className="mt-3 rounded-lg p-2 text-[12px] font-bold" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' }}>{'🔒 ' + (data.spending_restricted.words || 'Spending, tax and P&L figures for these dates are withheld.')}</div>}
      {data.spending && <div className="mt-3 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        {data.spending.incomplete && <div className="mb-2 rounded p-2 text-[11px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fca5a5' }}>
          ⚠ This report is INCOMPLETE: {data.spending.incomplete.reason} Professional fees and income by category may be wrong, taxable income and deductible spending are not shown, and the Accountant pack cannot be downloaded until this is fixed. Reload to try again.</div>}
        <div className="text-xs font-extrabold mb-1" style={{ color: '#0f172a' }}>💸 Spending by category — {from} → {to}</div>
        {ptBlocks().map(function (pb) {
          var onP = ptIsOn(pb);
          var isAff = pb.kind === 'affiliate';
          return <div key={pb.key || pb.payer} className="flex gap-3 items-center flex-wrap mb-1 rounded p-1.5" style={{ background: isAff ? '#f0fdfa' : '#fdf2f8', border: '1px solid ' + (isAff ? '#99f6e4' : '#fbcfe8') }}>
            <span className="text-[10px] font-extrabold" style={{ color: isAff ? '#115e59' : '#9d174d' }}>🏢 {pb.payer}{pb.era_note ? ' · ' + pb.era_note : ''} ({isAff ? 'booked as an advance — earlier entries stay as booked' : 'pays vendors for us — one professional-fees line'}):</span>
            <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#0f172a' }}><input type="radio" checked={!onP} onChange={function () { var n0 = Object.assign({}, ptOn); n0[pb.key || pb.payer] = false; setPtOn(n0); }} /> Tax view — payments to {pb.payer} stay ONE line (${fmt(pb.payments_total)})</label>
            <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#0f172a' }}><input type="radio" checked={onP} onChange={function () { var n1 = Object.assign({}, ptOn); n1[pb.key || pb.payer] = true; setPtOn(n1); }} /> Real-cost view — covered costs in their ACTUAL categories (${fmt(pb.allocations_total)} + ${fmt(pb.service_fee)} {isAff ? 'not yet linked to costs' : ((pb.waiting > 0.005 || pb.fees_booked > 0.005) ? 'not in bills' : 'service fee')}){!isAff && (pb.waiting > 0.005 || pb.fees_booked > 0.005) ? ' = bills $' + fmt(pb.allocations_total) + ' · service fee $' + fmt((Number(pb.fees_booked) || 0) + (Number(pb.remainder_other) || 0)) + ' · waiting for bills $' + fmt(pb.waiting) : ''}</label>
            {onP && <span className="text-[9px]" style={{ color: isAff ? '#115e59' : '#9d174d' }}>{isAff ? 'This is the INTERNAL view: money sent ahead of its costs is held, not spending, until NextTrade\'s bills are linked. The accountant tax pack does NOT use it — there every transfer to NextTrade stays one Professional-fees amount, in full.' : 'Totals identical in both views. The accountant tax pack always uses the one-line tax view: each transfer once, in full.'}</span>}
          </div>;
        })}
        {categoryDrillOpen && leftPanel()}
        <table className="w-full text-[11px]">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Category</th><th className="py-1 pr-2 text-right font-semibold">Txns</th>
            <th className="py-1 pr-2 text-right font-semibold">Total</th><th className="py-1 text-right font-semibold">% of spending</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {ptAdjust(data.spending.categories).map(function (c) {
              var pct = data.spending.real_spending > 0 ? Math.round(c.total / data.spending.real_spending * 1000) / 10 : 0;
              return categoryRow(c, false, pct + '%');
            })}
            {data.spending.uncategorized && data.spending.uncategorized.count > 0 && categoryRow({ ...data.spending.uncategorized, key: '', label: 'Uncategorized — needs a category' }, false, null, { background: '#fff7ed', color: '#9a3412' })}
            {/* TS (Codex QA 17 Nov) — the ⚠ row shows the SAME total as the lines listed under it; the money sent to the paid-through
                company is taken off on its own visible line, so every row on screen still adds up to the totals below. */}
            {ptAdjust(data.spending.categories).uncShift < -0.004 && <tr style={{ background: '#fff7ed', borderBottom: '1px solid #f1f5f9' }}>
              <td className="py-1 pr-2 text-[10px] font-bold" style={{ color: '#9a3412' }}>&nbsp;&nbsp;− of which sent to {ptOnNames.join(' / ')} with no category (shown above as the bills it paid)</td><td />
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums text-[10px]" style={{ color: '#9a3412' }}>−${fmt(Math.abs(ptAdjust(data.spending.categories).uncShift))}</td><td /></tr>}
            {data.spending.transfers && data.spending.transfers.count > 0 && categoryRow({ ...data.spending.transfers, key: 'transfer', label: 'Transfers between own accounts — excluded from spending' }, false, null, { background: '#eff6ff', color: '#1e40af' })}
          </tbody>
          <tfoot>
            {data.spending.not_pnl_out && data.spending.not_pnl_out.count > 0 && <tr style={{ color: '#6b21a8' }}>
              <td className="py-1 pr-2 font-bold">Not P&L — loan principal / owner money (NOT deductible)</td>
              <td className="py-1 pr-2 text-right tabular-nums">{data.spending.not_pnl_out.count}</td>
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(data.spending.not_pnl_out.total)}</td><td /></tr>}
            {data.spending.deductible_spending !== undefined && <tr style={{ color: '#0f172a' }}>
              <td className="py-1 pr-2 font-extrabold">DEDUCTIBLE SPENDING (P&L categories only)</td><td />
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#7f1d1d' }}>{data.spending.deductible_spending === null ? 'not available (incomplete)' : '$' + fmt(data.spending.deductible_spending)}</td><td /></tr>}
            <tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
            <td className="py-1.5 pr-2 font-extrabold">Real spending (transfers excluded)</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">{(data.spending.total_out ? '' : '')}</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">${fmt(data.spending.real_spending)}</td><td /></tr></tfoot>
        </table>

        {/* v55.83-PV (Max): "tax reports need data for all of 2026" — the income
            side, from the bank feed (the only DATED full-year money record). */}
        {data.spending.in_categories && <div className="mt-3">
          <div className="text-xs font-extrabold mb-1" style={{ color: '#0f172a' }}>💰 Money in by category — {from} → {to} (bank deposits)</div>
          <table className="w-full text-[11px]">
            <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
              <th className="py-1 pr-2 text-left font-semibold">Category</th><th className="py-1 pr-2 text-right font-semibold">Deposits</th>
              <th className="py-1 pr-2 text-right font-semibold">Total</th><th className="py-1 text-right font-semibold">% of income</th></tr></thead>
            <tbody style={{ color: '#0f172a' }}>
              {(data.spending.in_categories || []).map(function (c) {
                var pct = data.spending.real_income > 0 ? Math.round(c.total / data.spending.real_income * 1000) / 10 : 0;
                return categoryRow(c, true, pct + '%');
              })}
              {data.spending.in_uncategorized && data.spending.in_uncategorized.count > 0 && categoryRow({ ...data.spending.in_uncategorized, key: '', label: 'Uncategorized deposits — match or categorize before filing' }, true, null, { background: '#fff7ed', color: '#9a3412' })}
              {data.spending.in_transfers && data.spending.in_transfers.count > 0 && categoryRow({ ...data.spending.in_transfers, key: 'transfer', label: 'Transfers between own accounts — excluded from income' }, true, null, { background: '#eff6ff', color: '#1e40af' })}
            </tbody>
            <tfoot>
              {data.spending.not_pnl_in && data.spending.not_pnl_in.count > 0 && <tr style={{ color: '#6b21a8' }}>
                <td className="py-1 pr-2 font-bold">Not P&L — loan proceeds / owner money (NOT income)</td>
                <td className="py-1 pr-2 text-right tabular-nums">{data.spending.not_pnl_in.count}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(data.spending.not_pnl_in.total)}</td><td /></tr>}
              {data.spending.taxable_income !== undefined && <tr style={{ color: '#0f172a' }}>
                <td className="py-1 pr-2 font-extrabold">TAXABLE INCOME (P&L categories only)</td><td />
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#065f46' }}>{data.spending.taxable_income === null ? 'not available (incomplete)' : '$' + fmt(data.spending.taxable_income)}</td><td /></tr>}
              <tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
              <td className="py-1.5 pr-2 font-extrabold">Real money in (transfers excluded)</td><td />
              <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#065f46' }}>${fmt(data.spending.real_income)}</td><td /></tr></tfoot>
          </table>
          {/* v55.83-PY (Max, Nov 7 11:10: "i need the reports to take over from
            now for 2026. so make it happen.. find a way") — the CASH-BASIS
            INCOME STATEMENT, assembled from the bank record: the one dated,
            complete money source for all of 2026. Revenue = money actually
            received (P&L income kinds), expenses = money actually spent (P&L
            expense kinds). Transfers and Not-P&L money excluded on both
            sides. Uncategorized shown as its own line so the gap to a
            filing-ready statement is VISIBLE, never hidden. */}
        {data.spending.in_categories && incomeStatementBlocked(data.spending) && <IncomeStatementUnavailable why={data.spending.incomplete.reason} from={from} to={to} />}
        {data.spending.in_categories && !incomeStatementBlocked(data.spending) && (function () {
          var rev = 0; var cogs2 = 0; var exp2 = 0; var oin = 0; var oex = 0;
          (data.spending.in_categories || []).forEach(function (c) {
            if (c.kind === 'income') { rev += c.total; } else if (c.kind === 'other_income') { oin += c.total; }
          });
          // v55.83-QB — the RTM radio applies to the income statement too:
          // same totals, real-category breakdown.
          ptAdjust(data.spending.categories).forEach(function (c) {
            if (c.kind === 'cogs') { cogs2 += c.total; } else if (c.kind === 'other_expense') { oex += c.total; } else if (c.kind !== 'not_pnl') { exp2 += c.total; }
          });
          var r2x = function (x) { return Math.round(x * 100) / 100; };
          rev = r2x(rev); cogs2 = r2x(cogs2); exp2 = r2x(exp2); oin = r2x(oin); oex = r2x(oex);
          var gross = r2x(rev - cogs2);
          var op = r2x(gross - exp2);
          var net = r2x(op + oin - oex);
          var uncIn2 = (data.spending.in_uncategorized && data.spending.in_uncategorized.total) || 0;
          var uncOut2 = uncOutView(); // v55.83-TS — after paid-through money is shown as its bills
          function line(lbl, val, strong, color) {
            return <div className="flex text-[11px] py-0.5" style={{ borderBottom: strong ? '2px solid #cbd5e1' : '1px solid #f1f5f9', color: color || '#0f172a', fontWeight: strong ? 800 : 500 }}>
              <span className="flex-1">{lbl}</span><span className="tabular-nums">{(val < 0 ? '−$' : '$') + fmt(Math.abs(val))}</span></div>;
          }
          return <div className="mt-3 rounded-lg p-3" style={{ background: '#ffffff', border: '2px solid #312e81', maxWidth: 560 }}>
            <div className="text-xs font-extrabold mb-1" style={{ color: '#312e81' }}>📊 INCOME STATEMENT (cash basis, from the bank record) — {from} → {to}{ptOnNames.length ? ' — BREAKDOWN ON: ' + ptOnNames.join(', ') : ''}</div>
            {line('Revenue (money received, income categories)', rev)}
            {line('− Cost of goods sold', -cogs2)}
            {line('GROSS PROFIT', gross, true)}
            {line('− Operating expenses', -exp2)}
            {line('OPERATING PROFIT', op, true)}
            {oin > 0 && line('+ Other income', oin)}
            {oex > 0 && line('− Other expenses', -oex)}
            {line('NET PROFIT (cash basis)', net, true, net >= 0 ? '#065f46' : '#7f1d1d')}
            {(uncIn2 > 0.005 || uncOut2 > 0.005) && <div className="mt-1.5 rounded p-1.5 text-[10px] font-bold" style={{ background: '#fff7ed', color: '#9a3412' }}>
              ⚠ Not filing-ready yet: ${fmt(uncIn2)} of deposits and ${fmt(uncOut2)} of spending are still UNCATEGORIZED and sit outside this statement. Categorize them (rules + bulk updates do most of it) and this statement is complete.</div>}
            {(uncIn2 <= 0.005 && uncOut2 <= 0.005) && <div className="mt-1.5 text-[10px] font-bold" style={{ color: '#065f46' }}>✓ Every transaction in the period is categorized — this statement covers the whole period.</div>}
            <div className="text-[9px] mt-1" style={{ color: '#64748b' }}>Cash basis = income when received, expenses when paid — the standard filing basis for most LLCs (your accountant confirms which basis you file on). Transfers and Not-P&L money (loans, owner) are excluded by the category types.</div>
          </div>;
        })()}
        </div>}
      </div>}
     </div>}
  </div>;
}
