'use client';
// v55.83-VZ — Proforma peek: the read-only pop-up of ONE proforma, opened on top of the page from its linked invoice (the twin of
// InvoicePeek). Header, customer, dates, total, lines, then the invoices made from it and its signed copies (ProformaLinkBox).
// Read-only: editing, linking and uploading stay on the Proformas screen.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import ProformaLinkBox from './ProformaLinkBox';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function ProformaPeek(props) {
  var proformaId = props.proformaId;
  var onClose = props.onClose || function () {};
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(null); var err = s2[0]; var setErr = s2[1];

  useEffect(function () {
    if (!proformaId) { return; }
    setD(null); setErr(null);
    Promise.all([
      supabase.from('accounting_proformas').select('*').eq('id', proformaId).maybeSingle(),
      supabase.from('accounting_proforma_items').select('*').eq('proforma_id', proformaId).order('sort_order'),
    ]).then(function (r) {
      var pf = r[0].data;
      if (!pf) { setErr('Proforma not found.'); return; }
      var custQ = pf.accounting_customer_id
        ? supabase.from('accounting_customers').select('company_name, contact_name').eq('id', pf.accounting_customer_id).maybeSingle()
        : Promise.resolve({ data: null });
      custQ.then(function (c) {
        setD({ pf: pf, items: r[1].data || [], customer: c.data ? (c.data.company_name || c.data.contact_name || '') : '' });
      });
    }).catch(function (e) { setErr((e && e.message) || 'Could not load the proforma.'); });
  }, [proformaId]); // eslint-disable-line

  if (!proformaId) { return null; }
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div onClick={function (e) { e.stopPropagation(); }} className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid #e2e8f0', maxWidth: 720, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
      {err && <div className="text-sm font-bold" style={{ color: '#7f1d1d' }}>{err} <button onClick={onClose} className="ml-2 underline">close</button></div>}
      {!err && !d && <div className="text-sm" style={{ color: '#334155' }}>Opening the proforma…</div>}
      {d && <div>
        <div className="flex gap-2 items-start flex-wrap mb-2">
          <div>
            <div className="text-base font-extrabold" style={{ color: '#0f172a' }}>Proforma {d.pf.proforma_number || '(no number)'}
              <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#fef3c7', color: '#78350f' }}>{String(d.pf.status || 'draft').toUpperCase()}</span></div>
            <div className="text-xs font-bold" style={{ color: '#334155' }}>{d.customer || '(no customer)'}</div>
            <div className="text-[10px]" style={{ color: '#64748b' }}>Dated {d.pf.proforma_date || '—'} · Valid until {d.pf.valid_until || '—'} · {d.pf.currency || 'USD'} · {d.pf.source === 'wave_import' ? 'Wave' : 'Hub'} · {d.pf.record_status || 'active'}</div>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ close</button>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <span className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#eef2ff', color: '#312e81' }}>Total ${fmt(d.pf.total_amount)}</span>
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
        {d.pf.notes && <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>Notes: {d.pf.notes}</div>}
        <ProformaLinkBox kind="proforma" docId={proformaId} light={true} readOnly={true} onOpenInvoice={props.onOpenInvoice} />
      </div>}
    </div>
  </div>;
}
