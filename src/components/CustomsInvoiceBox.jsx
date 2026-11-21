'use client';
// v55.83-XD (Max, 21 Nov 2026: "an abiltiy to create a custom invoice that has no bearing on amount due or tax implications or is
// even part of any data ... just saved under te original invoice like a proforma invoice") — ONE box on a customer invoice:
//   • the customs invoices saved under it (Customs #1, #2 …), each with every version ever saved, who and when
//   • + New customs invoice (a starting point copied from this invoice — every field can be changed), Edit (saves a NEW version),
//     Print / Save PDF of any saved version, Void (stays on record)
// The printed number is the invoice number and can be changed by hand (Max 21 Nov). Everything goes through
// /api/accounting/customs-invoices (the server checks the person again). Nothing here touches the invoice, its amount due,
// payments, Wave, reports or numbering. Nothing here deletes anything.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { CUSTOMS_TITLES, prefillDoc, docTotal, lineAmount, customsPrintHtml } from '../lib/customs-invoice';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function when(x) { if (!x) { return ''; } var d = new Date(x); return isNaN(d.getTime()) ? String(x) : d.toLocaleString(); }

export function customsApi(body) {
  return hubFetch('/api/accounting/customs-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }).then(function (j) { return { status: r.status, j: j }; }); })
    .then(function (res) {
      var j = res.j || {};
      if (!j.ok) { var e = new Error(j.error || 'Not saved.'); e.code = j.code || ''; e.status = res.status; throw e; }
      return j;
    });
}

var C = { text: '#f1f5f9', soft: '#94a3b8', line: '#334155', panel: 'rgba(30,41,59,0.6)', warn: '#fca5a5', btn: '#4f46e5', quiet: '#334155', input: '#0f172a', note: '#fde68a' };
var inp = { background: C.input, color: C.text, border: '1px solid ' + C.line, borderRadius: 4, padding: '3px 6px', fontSize: 12, width: '100%' };
function Btn(props) {
  var bg = props.kind === 'main' ? C.btn : props.kind === 'danger' ? '#7f1d1d' : C.quiet;
  return <button type="button" onClick={props.onClick} disabled={props.disabled} title={props.title}
    style={{ background: bg, color: '#ffffff', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700, marginRight: 6, opacity: props.disabled ? 0.5 : 1 }}>{props.children}</button>;
}
function L(props) { return <label style={{ display: 'block', fontSize: 10, color: C.soft, fontWeight: 700 }}>{props.t}{props.children}</label>; }

export function printCustomsVersion(doc, company, toast) {
  var w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  if (!w) { if (toast) { toast.error('Allow pop-ups to print / save the PDF.'); } return; }
  w.document.open(); w.document.write(customsPrintHtml(doc, { logoDataUrl: company && company.logo_data_url })); w.document.close();
}

export default function CustomsInvoiceBox(props) {
  var invoice = props.invoice || null;
  var invoiceId = invoice && invoice.id;
  var toast = props.toast || { success: function () {}, error: function (m) { if (typeof window !== 'undefined') { window.alert(m); } } };
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var s4 = useState(null); var ed = s4[0]; var setEd = s4[1];           // { id|null, base_version, doc, note }
  var s5 = useState({}); var open = s5[0]; var setOpen = s5[1];         // customs id → its versions (loaded)
  var s6 = useState(0); var bump = s6[0]; var setBump = s6[1];

  function reload() { setBump(function (b) { return b + 1; }); }
  useEffect(function () {
    if (!invoiceId) { return; }
    var live = true; setD(null); setErr(''); setEd(null); setOpen({});
    customsApi({ action: 'list', invoice_id: invoiceId })
      .then(function (j) { if (live) { setD(j); } })
      .catch(function (e) { if (live) { setErr(e.status === 403 ? '403' : ((e && e.message) || 'Could not load the customs invoices.')); } });
    return function () { live = false; };
  }, [invoiceId, bump]); // eslint-disable-line

  if (!invoiceId) { return null; }
  if (err === '403') { return null; }
  var box = { border: '1px solid ' + C.line, background: C.panel, borderRadius: 8, padding: 10, marginTop: 12, color: C.text, fontSize: 12 };
  if (err) { return <div style={box}><span style={{ color: C.warn, fontWeight: 700 }}>Customs invoices: {err}</span> <button onClick={reload} style={{ marginLeft: 8, textDecoration: 'underline', color: C.soft }}>try again</button></div>; }
  if (!d) { return <div style={box}><span style={{ color: C.soft }}>Loading the customs invoices…</span></div>; }
  var canEdit = d.can_edit === true && props.mayEdit !== false;

  function loadVersions(id, then) {
    customsApi({ action: 'get', id: id }).then(function (j) {
      setOpen(function (o) { var c = Object.assign({}, o); c[id] = j; return c; });
      if (then) { then(j); }
    }).catch(function (e) { toast.error((e && e.message) || 'Could not open it.'); });
  }
  function toggleVersions(id) {
    if (open[id]) { setOpen(function (o) { var c = Object.assign({}, o); delete c[id]; return c; }); return; }
    loadVersions(id);
  }
  function printNewest(id) { loadVersions(id, function (j) { var v = (j.versions || [])[0]; if (v && v.doc) { printCustomsVersion(v.doc, props.company, toast); } }); }
  function startNew() { setEd({ id: null, base_version: 0, doc: prefillDoc(invoice, props.items || [], props.company, props.customer), note: '' }); }
  function startEdit(id) { loadVersions(id, function (j) { var v = (j.versions || [])[0]; if (v && v.doc) { setEd({ id: id, base_version: v.version, doc: JSON.parse(JSON.stringify(v.doc)), note: '' }); } }); }
  function voidIt(it) {
    var reason = typeof window !== 'undefined' ? window.prompt('Void ' + it.label + '? It stays on record with every version. Why is it voided?') : '';
    if (!reason || !String(reason).trim()) { return; }
    setBusy(true);
    customsApi({ action: 'void', id: it.id, reason: String(reason).trim() })
      .then(function () { toast.success(it.label + ' voided (kept on record).'); reload(); })
      .catch(function (e) { toast.error((e && e.message) || 'Not voided.'); })
      .finally(function () { setBusy(false); });
  }
  function save() {
    if (!ed) { return; }
    setBusy(true);
    var req = ed.id ? { action: 'save', id: ed.id, base_version: ed.base_version, doc: ed.doc, note: ed.note } : { action: 'create', invoice_id: invoiceId, doc: ed.doc, note: ed.note };
    customsApi(req)
      .then(function (j) { toast.success(ed.id ? ('Saved as version ' + j.version + ' — the earlier versions are kept.') : 'Customs invoice saved (not counted anywhere).'); setEd(null); reload(); })
      .catch(function (e) { toast.error((e && e.message) || 'Not saved.'); })
      .finally(function () { setBusy(false); });
  }
  function setF(k, v) { setEd(function (x) { var dd = Object.assign({}, x.doc); dd[k] = v; return Object.assign({}, x, { doc: dd }); }); }
  function setLine(i, k, v) { setEd(function (x) { var ls = (x.doc.lines || []).slice(); ls[i] = Object.assign({}, ls[i]); ls[i][k] = v; var dd = Object.assign({}, x.doc, { lines: ls }); return Object.assign({}, x, { doc: dd }); }); }
  function addLine() { setEd(function (x) { var ls = (x.doc.lines || []).concat([{ description: '', hs_code: '', origin: '', quantity: 1, unit: '', unit_price: 0 }]); return Object.assign({}, x, { doc: Object.assign({}, x.doc, { lines: ls }) }); }); }
  function rmLine(i) { setEd(function (x) { var ls = (x.doc.lines || []).slice(); ls.splice(i, 1); return Object.assign({}, x, { doc: Object.assign({}, x.doc, { lines: ls }) }); }); }

  var items = d.items || [];
  var doc = ed && ed.doc;
  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontWeight: 800 }}>🛃 Customs invoices <span style={{ color: C.soft, fontWeight: 500 }}>— for customs only; not counted anywhere (no amount due, reports, tax, Wave or invoice numbers)</span></div>
        {canEdit && d.installed !== false && !ed && <Btn kind="main" onClick={startNew} disabled={busy}>+ New customs invoice</Btn>}
      </div>
      {d.installed === false && <div style={{ color: C.note }}>Customs invoices need a database update first (sql/v55-83-XD-customs-invoices.sql). Nothing was changed.</div>}
      {d.installed !== false && !items.length && !ed && <div style={{ color: C.soft }}>None yet.</div>}
      {items.map(function (it) {
        var nv = it.newest || {}; var vers = open[it.id];
        return (
          <div key={it.id} style={{ borderTop: '1px solid ' + C.line, paddingTop: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <div>
                <b>{it.label}</b>{it.voided && <span style={{ marginLeft: 6, background: '#7f1d1d', color: '#fff', borderRadius: 4, padding: '0 5px', fontSize: 10, fontWeight: 800 }}>VOIDED</span>}
                <span style={{ color: C.soft }}> · version {nv.version || '—'} · {nv.currency || ''} {nv.total !== null && nv.total !== undefined ? fmt(nv.total) : ''} · saved by {nv.saved_by_name || '—'} {when(nv.saved_at)}</span>
                {it.voided && <div style={{ color: C.warn, fontSize: 11 }}>Voided by {it.voided_by_name || '—'} {when(it.voided_at)}{it.void_reason ? ' — ' + it.void_reason : ''}</div>}
              </div>
              <div>
                <Btn onClick={function () { printNewest(it.id); }} title="Print / Save PDF of the newest saved version">Print / Save PDF</Btn>
                <Btn onClick={function () { toggleVersions(it.id); }}>{vers ? 'Hide versions' : 'Versions'}</Btn>
                {canEdit && !it.voided && !ed && <Btn onClick={function () { startEdit(it.id); }} disabled={busy}>Edit</Btn>}
                {canEdit && !it.voided && !ed && <Btn kind="danger" onClick={function () { voidIt(it); }} disabled={busy}>Void</Btn>}
              </div>
            </div>
            {vers && <div style={{ marginTop: 4, paddingLeft: 10 }}>
              {(vers.versions || []).map(function (v) {
                return <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', color: C.soft }}>
                  <span>Version {v.version}{v.version === (vers.versions[0] && vers.versions[0].version) ? ' (newest)' : ''} · # {(v.doc && v.doc.printed_number) || '—'} · {v.currency || ''} {v.total !== null ? fmt(v.total) : ''} · {v.saved_by_name || '—'} {when(v.saved_at)}{v.note ? ' — ' + v.note : ''}</span>
                  <Btn onClick={function () { printCustomsVersion(v.doc, props.company, toast); }}>Print this version</Btn>
                </div>;
              })}
            </div>}
          </div>
        );
      })}

      {ed && doc && <div style={{ borderTop: '2px solid ' + C.btn, marginTop: 8, paddingTop: 8 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>{ed.id ? 'Edit customs invoice — saving makes version ' + (ed.base_version + 1) + ' (version ' + ed.base_version + ' is kept)' : 'New customs invoice — copied from this invoice, change anything'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
          <L t="Title"><select style={inp} value={doc.title} onChange={function (e) { setF('title', e.target.value); }}>{CUSTOMS_TITLES.map(function (t) { return <option key={t} value={t}>{t}</option>; })}</select></L>
          <L t="Invoice # printed (the invoice number — change it if needed)"><input style={inp} value={doc.printed_number} onChange={function (e) { setF('printed_number', e.target.value); }} /></L>
          <L t="Date"><input type="date" style={inp} value={doc.doc_date} onChange={function (e) { setF('doc_date', e.target.value); }} /></L>
          <L t="Currency"><input style={inp} value={doc.currency} onChange={function (e) { setF('currency', e.target.value); }} /></L>
          <L t="Country of origin"><input style={inp} value={doc.country_of_origin} onChange={function (e) { setF('country_of_origin', e.target.value); }} /></L>
          <L t="Country of destination"><input style={inp} value={doc.country_of_destination} onChange={function (e) { setF('country_of_destination', e.target.value); }} /></L>
          <L t="Incoterms"><input style={inp} value={doc.incoterms} onChange={function (e) { setF('incoterms', e.target.value); }} /></L>
          <L t="Reference (release, AWB, B/L…)"><input style={inp} value={doc.reference} onChange={function (e) { setF('reference', e.target.value); }} /></L>
          <L t="Packages"><input style={inp} value={doc.packages} onChange={function (e) { setF('packages', e.target.value); }} /></L>
          <L t="Gross weight"><input style={inp} value={doc.gross_weight} onChange={function (e) { setF('gross_weight', e.target.value); }} /></L>
          <L t="Net weight"><input style={inp} value={doc.net_weight} onChange={function (e) { setF('net_weight', e.target.value); }} /></L>
          <L t="Weight unit"><input style={inp} value={doc.weight_unit} onChange={function (e) { setF('weight_unit', e.target.value); }} /></L>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 6 }}>
          <L t="Exporter / shipper"><textarea rows={4} style={inp} value={doc.exporter} onChange={function (e) { setF('exporter', e.target.value); }} /></L>
          <L t="Consignee"><textarea rows={4} style={inp} value={doc.consignee} onChange={function (e) { setF('consignee', e.target.value); }} /></L>
          <L t="Ship to (if different)"><textarea rows={4} style={inp} value={doc.ship_to} onChange={function (e) { setF('ship_to', e.target.value); }} /></L>
        </div>
        <table style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
          <thead><tr style={{ color: C.soft, fontSize: 10, textAlign: 'left' }}><th>Description of goods</th><th>HS code</th><th>Origin</th><th>Qty</th><th>Unit</th><th>Unit price</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
          <tbody>{(doc.lines || []).map(function (l, i) {
            return <tr key={i}>
              <td style={{ width: '34%' }}><input style={inp} value={l.description} onChange={function (e) { setLine(i, 'description', e.target.value); }} /></td>
              <td><input style={inp} value={l.hs_code} onChange={function (e) { setLine(i, 'hs_code', e.target.value); }} /></td>
              <td><input style={inp} value={l.origin} onChange={function (e) { setLine(i, 'origin', e.target.value); }} /></td>
              <td><input style={inp} value={l.quantity} onChange={function (e) { setLine(i, 'quantity', e.target.value); }} /></td>
              <td><input style={inp} value={l.unit} onChange={function (e) { setLine(i, 'unit', e.target.value); }} /></td>
              <td><input style={inp} value={l.unit_price} onChange={function (e) { setLine(i, 'unit_price', e.target.value); }} /></td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(lineAmount(l))}</td>
              <td><button type="button" onClick={function () { rmLine(i); }} style={{ color: C.warn }} title="Remove this line">✕</button></td>
            </tr>;
          })}</tbody>
        </table>
        <Btn onClick={addLine}>+ Line</Btn>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginTop: 6 }}>
          <L t="Freight"><input style={inp} value={doc.freight} onChange={function (e) { setF('freight', e.target.value); }} /></L>
          <L t="Insurance"><input style={inp} value={doc.insurance} onChange={function (e) { setF('insurance', e.target.value); }} /></L>
          <L t="Other charges"><input style={inp} value={doc.other_charges} onChange={function (e) { setF('other_charges', e.target.value); }} /></L>
          <div style={{ alignSelf: 'end', textAlign: 'right', fontWeight: 800 }}>Total {doc.currency} {fmt(docTotal(doc))}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginTop: 6 }}>
          <L t="Notes (printed)"><textarea rows={2} style={inp} value={doc.notes} onChange={function (e) { setF('notes', e.target.value); }} /></L>
          <L t="Declaration (printed)"><textarea rows={2} style={inp} value={doc.declaration} onChange={function (e) { setF('declaration', e.target.value); }} /></L>
          <L t="Signed by (name)"><input style={inp} value={doc.signer_name} onChange={function (e) { setF('signer_name', e.target.value); }} /></L>
          <L t="Title of the signer"><input style={inp} value={doc.signer_title} onChange={function (e) { setF('signer_title', e.target.value); }} /></L>
        </div>
        <L t="What changed (not printed, kept with this version)"><input style={inp} value={ed.note} onChange={function (e) { var v = e.target.value; setEd(function (x) { return Object.assign({}, x, { note: v }); }); }} /></L>
        <div style={{ marginTop: 8 }}>
          <Btn kind="main" onClick={save} disabled={busy}>{busy ? 'Saving…' : (ed.id ? 'Save as a new version' : 'Save customs invoice')}</Btn>
          <Btn onClick={function () { setEd(null); }} disabled={busy}>Cancel</Btn>
        </div>
      </div>}
    </div>
  );
}
