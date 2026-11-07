'use client';
// v55.83-PS — Invoice peek (Max, Nov 7 05:35: "i should be able to click on any
// reference invoice and the invoice should pop up... so i can see the
// details"). One shared modal used by every drill: header (invoice + RELEASE
// number — Max 05:37), customer, dates, totals, line items, payments.
// Read-only: editing stays in the Invoices tab.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

export default function InvoicePeek(props) {
  var invoiceId = props.invoiceId;
  var onClose = props.onClose || function () {};
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(null); var err = s2[0]; var setErr = s2[1];

  useEffect(function () {
    if (!invoiceId) { return; }
    setD(null); setErr(null);
    Promise.all([
      supabase.from('accounting_invoices').select('*').eq('id', invoiceId).maybeSingle(),
      supabase.from('accounting_invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order'),
      supabase.from('accounting_invoice_payments').select('id, amount, payment_date, voided, sync_status').eq('accounting_invoice_id', invoiceId).order('payment_date'),
    ]).then(function (r) {
      var inv = r[0].data;
      if (!inv) { setErr('Invoice not found.'); return; }
      var custQ = inv.accounting_customer_id
        ? supabase.from('accounting_customers').select('company_name, contact_name').eq('id', inv.accounting_customer_id).maybeSingle()
        : Promise.resolve({ data: null });
      custQ.then(function (c) {
        var pays = (r[2].data || []).filter(function (p) {
          if (p.voided === true) { return false; }
          var st = String(p.sync_status || '').toLowerCase();
          return st !== 'void' && st !== 'voided' && st !== 'cancelled' && st !== 'reversed' && st !== 'deleted';
        });
        var paid = r2((Number(inv.wave_imported_paid) || 0) + pays.reduce(function (t, p) { return t + (Number(p.amount) || 0); }, 0));
        setD({ inv: inv, items: r[1].data || [], pays: pays, paid: paid,
          customer: c.data ? (c.data.company_name || c.data.contact_name || '') : '',
          open: r2((Number(inv.total_amount) || 0) - paid) });
      });
    }).catch(function (e) { setErr((e && e.message) || 'Could not load the invoice.'); });
  }, [invoiceId]); // eslint-disable-line

  if (!invoiceId) { return null; }
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div onClick={function (e) { e.stopPropagation(); }} className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid #e2e8f0', maxWidth: 720, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
      {err && <div className="text-sm font-bold" style={{ color: '#7f1d1d' }}>{err}</div>}
      {!err && !d && <div className="text-sm" style={{ color: '#334155' }}>Opening the invoice…</div>}
      {d && <div>
        <div className="flex gap-2 items-start flex-wrap mb-2">
          <div>
            <div className="text-base font-extrabold" style={{ color: '#0f172a' }}>Invoice {d.inv.invoice_number || '(no number)'}
              {d.inv.release_number && <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#e0e7ff', color: '#312e81' }}>Release {d.inv.release_number}</span>}</div>
            <div className="text-xs font-bold" style={{ color: '#334155' }}>{d.customer || '(no customer)'}</div>
            <div className="text-[10px]" style={{ color: '#64748b' }}>Dated {d.inv.invoice_date || '—'} · Due <span style={{ color: '#7f1d1d', fontWeight: 700 }}>{d.inv.due_date || '—'}</span> · {d.inv.currency || 'USD'} · {d.inv.source === 'wave_import' ? 'Wave' : 'Hub'} · {d.inv.record_status || 'active'}</div>
          </div>
          <div className="flex-1" />
          {props.onEdit && <button onClick={function () { props.onEdit(invoiceId); }} title="Open this invoice in the Invoices editor"
            className="px-2 py-1 rounded-lg text-xs font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>✏ Edit invoice</button>}
          <button onClick={onClose} className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ close</button>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <span className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#eef2ff', color: '#312e81' }}>Original ${fmt(d.inv.total_amount)}</span>
          <span className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#ecfdf5', color: '#064e3b' }}>Paid ${fmt(d.paid)}</span>
          <span className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: d.open > 0.005 ? '#fffbeb' : '#ecfdf5', color: d.open > 0.005 ? '#78350f' : '#064e3b' }}>Balance ${fmt(d.open)}</span>
        </div>
        {d.items.length > 0 && <table className="w-full text-[11px] mb-2">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Line</th><th className="py-1 pr-2 text-right font-semibold">Qty</th>
            <th className="py-1 pr-2 text-right font-semibold">Unit</th><th className="py-1 text-right font-semibold">Total</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {d.items.map(function (it) {
              return <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1 pr-2">{it.description || '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{Number(it.quantity) || 0}</td>
                <td className="py-1 pr-2 text-right tabular-nums">${fmt(it.unit_price)}</td>
                <td className="py-1 text-right font-bold tabular-nums">${fmt(it.line_total)}</td></tr>;
            })}
          </tbody>
        </table>}
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>Payments {d.pays.length === 0 ? '— none recorded' : ''}</div>
        {(Number(d.inv.wave_imported_paid) || 0) > 0.005 && <div className="text-[10px] mb-1" style={{ color: '#64748b' }}>Includes ${fmt(d.inv.wave_imported_paid)} paid in Wave before the hub tracked dated payments.</div>}
        {d.pays.map(function (p) {
          return <div key={p.id} className="flex gap-2 text-[11px] py-0.5" style={{ borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}>
            <span>{p.payment_date || '—'}</span><div className="flex-1" />
            <span className="font-extrabold tabular-nums" style={{ color: '#064e3b' }}>+${fmt(p.amount)}</span></div>;
        })}
        {d.inv.notes && <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>Notes: {d.inv.notes}</div>}
      </div>}
    </div>
  </div>;
}
