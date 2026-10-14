'use client';
// v55.83-OQ — Accounting > All Invoices (Max, Oct 13): "one tab that shows
// everything, closed and open invoices, for each type. US business and Egypt
// business — these are 2 separate businesses."
// EVERY invoice entered in the Hub appears here — pushed to Wave or not,
// approved or still a draft (drafts are labeled; they stay out of AR money
// elsewhere, but they are never invisible). US = USD, Egypt = EGP.
import React, { useState, useEffect } from 'react';
import { isPaymentVoid } from '../lib/payment-matching';
import { canViewArInvoiceBalances } from '../lib/bank-permissions';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { businessOfInvoice } from '../lib/business-of';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

export default function BusinessBooksTab(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var mayView = canViewArInvoiceBalances(isSuperAdmin, modulePerms, userProfile && userProfile.role);

  var [biz, setBiz] = useState('US');
  var [from, setFrom] = useState('2026-06-01');
  var [to, setTo] = useState('');
  var [preset, setPreset] = useState('Jun 1 →');
  var [statusFilter, setStatusFilter] = useState('all'); // all | open | paid | draft
  var [raw, setRaw] = useState(null);
  var [loading, setLoading] = useState(true);

  function iso(d) { return d.toISOString().substring(0, 10); }
  function agoDays(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  var PRESETS = [
    ['Jun 1 →', '2026-06-01', ''],
    ['Last 3 months', agoDays(90), ''],
    ['This year', '2026-01-01', ''],
    ['2025', '2025-01-01', '2025-12-31'],
    ['All history', '', '']
  ];

  useEffect(function () {
    if (!mayView) { setLoading(false); return; }
    Promise.all([
      fetchAllRows('accounting_invoices', '*').catch(function () { return { data: [] }; }),
      fetchAllRows('accounting_customers', 'id,company_name,contact_name,business_tag').catch(function () { return { data: [] }; }),
      fetchAllRows('accounting_invoice_payments', 'accounting_invoice_id,amount,payment_date,sync_status,voided').catch(function () { return { data: [] }; })
    ]).then(function (r) {
      setRaw({ inv: (r[0] && r[0].data) || [], custs: (r[1] && r[1].data) || [], pays: (r[2] && r[2].data) || [] });
    }).catch(function () { setRaw({ inv: [], custs: [], pays: [] }); }).finally(function () { setLoading(false); });
  }, []);

  if (!mayView) { return <div className="bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-600 font-bold">Restricted — needs "AR: View Invoice Balances" (Settings → Permissions).</div>; }
  if (loading || !raw) { return <div className="bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-500">Loading all invoices…</div>; }

  var activeCur = biz === 'EG' ? 'EGP' : 'USD';
  var sym = activeCur === 'EGP' ? 'EGP ' : '$';
  var custName = {}; var custBizTag = {};
  raw.custs.forEach(function (c) { custName[c.id] = c.company_name || c.contact_name || ''; if (c.business_tag) { custBizTag[c.id] = c.business_tag; } });
  // v55.83-OS — the shared Wave-bound rule: US = in Wave or headed there.
  function bizOfInv(i) { return businessOfInvoice(i, custBizTag); }
  var payByInv = {};
  raw.pays.forEach(function (p) { if (isPaymentVoid(p)) { return; } payByInv[p.accounting_invoice_id] = (payByInv[p.accounting_invoice_id] || 0) + (Number(p.amount) || 0); });

  var rows = []; var tInvoiced = 0, tPaidAmt = 0, tOpen = 0; var cPaid = 0, cOpen = 0, cDraft = 0, cCredit = 0; var otherCurCount = 0;
  var paidInPeriod = 0;
  raw.inv.forEach(function (i) {
    var rs = i.record_status;
    if (rs === 'void' || rs === 'cancelled' || rs === 'archived' || rs === 'deleted') { return; }
    if (bizOfInv(i) !== biz) { return; } // OR: the customer's business decides — an Egyptian customer's USD invoice stays in the Egypt book
    var idt = i.invoice_date || '';
    if (from && idt && idt < from) { return; }
    if (to && idt && idt > to) { return; }
    var total = r2(i.total_amount);
    var paid = r2((Number(i.wave_imported_paid) || 0) + (payByInv[i.id] || 0));
    var bal = r2(total - paid);
    var isDraft = i.wave_status ? i.wave_status === 'DRAFT' : i.approval_status !== 'approved';
    if (isDraft) { cDraft += 1; }
    var st;
    if (isDraft && Math.abs(bal - total) < 0.005 && paid < 0.005 && bal > 0.005) { st = 'DRAFT'; cOpen += 1; }
    else if (bal < -0.005) { st = 'CREDIT'; cCredit += 1; }
    else if (bal <= 0.005) { st = 'PAID'; cPaid += 1; }
    else if (paid > 0.005) { st = 'PARTIAL'; cOpen += 1; }
    else { st = 'UNPAID'; cOpen += 1; }
    var rowCur = i.currency || 'USD';
    // Money cards stay single-currency (the book's main currency); invoices in
    // another currency are listed with their own symbol and counted separately.
    // v55.83-OT (Max): drafts are REAL invoices — entered = counted. The
    // DRAFT chip remains as information only.
    if (rowCur === activeCur) { tInvoiced = r2(tInvoiced + total); tPaidAmt = r2(tPaidAmt + paid); if (bal > 0.005) { tOpen = r2(tOpen + bal); } }
    if (rowCur !== activeCur) { otherCurCount += 1; }
    rows.push({ id: i.id, num: i.invoice_number || '(no number)', cust: custName[i.accounting_customer_id] || '', inv_date: idt, due_date: i.due_date || '', total: total, paid: paid, balance: bal, status: st, cur: rowCur, in_wave: !!i.wave_invoice_id, source: i.source === 'wave_import' ? 'Wave' : 'Hub' });
  });
  raw.pays.forEach(function (p) {
    if (isPaymentVoid(p)) { return; }
    var pd = p.payment_date || '';
    if (!pd) { return; }
    if (from && pd < from) { return; }
    if (to && pd > to) { return; }
    var parent = raw.inv.find(function (i) { return i.id === p.accounting_invoice_id; });
    if (!parent || bizOfInv(parent) !== biz || (parent.currency || 'USD') !== activeCur) { return; }
    paidInPeriod = r2(paidInPeriod + (Number(p.amount) || 0));
  });
  rows.sort(function (a, b) { return (a.inv_date || '') < (b.inv_date || '') ? 1 : -1; });
  var shown = rows.filter(function (r) {
    if (statusFilter === 'open') { return r.status === 'UNPAID' || r.status === 'PARTIAL'; }
    if (statusFilter === 'paid') { return r.status === 'PAID'; }
    if (statusFilter === 'draft') { return r.status === 'DRAFT'; }
    return true;
  });

  function csv() {
    if (!shown.length) { return; }
    var lines = ['invoice,customer,invoice_date,due_date,total,paid,balance,status,source,in_wave'];
    shown.forEach(function (r) { lines.push([r.num, r.cust, r.inv_date, r.due_date, r.total, r.paid, r.balance, r.status, r.source, r.in_wave ? 'yes' : 'no'].map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all-invoices-' + biz.toLowerCase() + '.csv'; a.click();
  }
  var STATUS_STYLE = {
    PAID: { background: '#dcfce7', color: '#052e16' }, PARTIAL: { background: '#fef3c7', color: '#451a03' },
    UNPAID: { background: '#fee2e2', color: '#450a0a' }, DRAFT: { background: '#e2e8f0', color: '#334155' },
    CREDIT: { background: '#ede9fe', color: '#3b0764' }
  };
  var th = { background: '#0f172a', color: '#fff' };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900 mr-1">📚 All Invoices</div>
        {[['US', '🇺🇸 US (USD)'], ['EG', '🇪🇬 Egypt (EGP)']].map(function (b) {
          var act = biz === b[0];
          return <button key={b[0]} onClick={function () { setBiz(b[0]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={act ? { background: '#059669', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{b[1]}</button>;
        })}
        <span className="text-slate-300">|</span>
        {PRESETS.map(function (ps) {
          var act = preset === ps[0];
          return <button key={ps[0]} onClick={function () { setPreset(ps[0]); setFrom(ps[1]); setTo(ps[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={act ? { background: '#0f172a', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{ps[0]}</button>;
        })}
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); setPreset('custom'); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); setPreset('custom'); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <button onClick={csv} className="ml-auto px-2 py-1 rounded text-[10px] font-bold bg-slate-800 text-white">⬇ CSV</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
        <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Invoiced ({activeCur})</div><div className="text-lg font-black">{fmt(tInvoiced)}</div><div className="text-[9px]">drafts counted — entered = real</div></div>
        <div className="rounded-lg p-2" style={{ background: '#dcfce7', color: '#052e16' }}><div className="text-[10px] font-bold">Paid in period</div><div className="text-lg font-black">{fmt(paidInPeriod)}</div><div className="text-[9px]">recorded payments</div></div>
        <div className="rounded-lg p-2" style={{ background: tOpen ? '#fee2e2' : '#dcfce7', color: tOpen ? '#450a0a' : '#052e16' }}><div className="text-[10px] font-bold">Still open</div><div className="text-lg font-black">{fmt(tOpen)}</div></div>
        <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Closed · Open</div><div className="text-lg font-black">{cPaid} · {cOpen}</div>{cCredit ? <div className="text-[9px]">+ {cCredit} overpaid</div> : null}</div>
        <div className="rounded-lg p-2" style={{ background: cDraft ? '#e2e8f0' : '#f1f5f9', color: '#334155' }}><div className="text-[10px] font-bold">Drafts</div><div className="text-lg font-black">{cDraft}</div><div className="text-[9px]">entered, not approved yet</div></div>
      </div>
      <div className="flex gap-1 mb-2">
        {[['all', 'All'], ['open', 'Open'], ['paid', 'Closed (paid)'], ['draft', 'Drafts']].map(function (f) {
          var act = statusFilter === f[0];
          return <button key={f[0]} onClick={function () { setStatusFilter(f[0]); }}
            className="px-2 py-1 rounded text-[10px] font-extrabold"
            style={act ? { background: '#0369a1', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{f[1]}</button>;
        })}
        <span className="text-[10px] text-slate-500 self-center ml-1">{shown.length} invoice(s) — Hub-entered and Wave-pushed alike, nothing hidden{otherCurCount ? ' · ' + otherCurCount + ' in another currency (listed with own symbol, excluded from the money cards)' : ''}</span>
      </div>
      <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 480 }}>
        <table className="w-full text-[11px]">
          <thead><tr>{['Invoice', 'Customer', 'Inv date', 'Due date', 'Total', 'Paid', 'Balance', 'Status', 'Source', 'In Wave'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
          <tbody>{shown.map(function (r, i) {
            return (
              <tr key={r.id} className="border-t border-slate-200" style={{ background: i % 2 ? '#f8fafc' : '#fff', color: '#0f172a' }}>
                <td className="px-2 py-1 font-mono font-bold whitespace-nowrap">{r.num}</td>
                <td className="px-2 py-1 truncate" style={{ maxWidth: 220 }}>{r.cust}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.inv_date || '—'}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.due_date || '—'}</td>
                <td className="px-2 py-1 text-right font-mono">{(r.cur === 'EGP' ? 'EGP ' : '$')}{fmt(r.total)}</td>
                <td className="px-2 py-1 text-right font-mono">{(r.cur === 'EGP' ? 'EGP ' : '$')}{fmt(r.paid)}</td>
                <td className="px-2 py-1 text-right font-mono font-bold">{(r.cur === 'EGP' ? 'EGP ' : '$')}{fmt(r.balance)}</td>
                <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={STATUS_STYLE[r.status]}>{r.status}</span></td>
                <td className="px-2 py-1"><span className={'text-[9px] rounded px-1 py-0.5 font-bold text-white ' + (r.source === 'Wave' ? 'bg-sky-700' : 'bg-emerald-700')}>{r.source}</span></td>
                <td className="px-2 py-1 text-[10px] font-bold">{r.in_wave ? '✓' : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
