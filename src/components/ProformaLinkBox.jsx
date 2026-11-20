'use client';
// v55.83-VZ (Max, 20 Nov 2026: "Proforma invoices need to be linked to invoices and that we need to upload a signed proforma
// that is saved and archived with them.") — ONE box, shown on an invoice and on a proforma:
//   • invoice: the proforma it came from (a button that opens it on top) — link / unlink for people who may edit
//   • proforma: the invoice(s) made from it (buttons that open them on top) — link / unlink
//   • the signed proforma: every version ever uploaded, who and when, Open / Download; "Upload signed proforma" on the proforma
// Everything goes through /api/accounting/proforma-links (the server checks the person again). Nothing here deletes anything.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { hubFetch } from '../lib/hub-fetch';
import { SIGNED_ACCEPT, signedFileProblem, sizeWords } from '../lib/proforma-links';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function when(x) { if (!x) { return ''; } var d = new Date(x); return isNaN(d.getTime()) ? String(x) : d.toLocaleString(); }

export function proformaLinksApi(body) {
  return hubFetch('/api/accounting/proforma-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }).then(function (j) { return { status: r.status, j: j }; }); })
    .then(function (res) {
      var j = res.j || {};
      if (!j.ok) { var e = new Error(j.error || 'Not saved.'); e.code = j.code || ''; e.status = res.status; throw e; }
      return j;
    });
}

export default function ProformaLinkBox(props) {
  var kind = props.kind === 'proforma' ? 'proforma' : 'invoice';
  var docId = props.docId;
  var light = props.light === true;
  var toast = props.toast || { success: function () {}, error: function (m) { if (typeof window !== 'undefined') { window.alert(m); } } };
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var s4 = useState(false); var picking = s4[0]; var setPicking = s4[1];
  var s5 = useState(''); var q = s5[0]; var setQ = s5[1];
  var s6 = useState(''); var note = s6[0]; var setNote = s6[1];
  var s7 = useState(false); var showEarlier = s7[0]; var setShowEarlier = s7[1];
  var s8 = useState(0); var bump = s8[0]; var setBump = s8[1];
  var s9 = useState(''); var progress = s9[0]; var setProgress = s9[1];

  var C = light
    ? { text: '#0f172a', soft: '#475569', line: '#e2e8f0', panel: '#f8fafc', chipBg: '#e0e7ff', chipText: '#312e81', warn: '#7f1d1d', ok: '#064e3b', btn: '#1d4ed8', btnText: '#ffffff', quiet: '#f1f5f9', quietText: '#334155' }
    : { text: '#f1f5f9', soft: '#94a3b8', line: '#334155', panel: 'rgba(30,41,59,0.6)', chipBg: '#3730a3', chipText: '#ffffff', warn: '#fca5a5', ok: '#86efac', btn: '#4f46e5', btnText: '#ffffff', quiet: '#334155', quietText: '#f1f5f9' };

  function reload() { setBump(function (b) { return b + 1; }); }
  useEffect(function () {
    if (!docId) { return; }
    var live = true; setD(null); setErr(''); setPicking(false); setQ(''); setProgress('');
    proformaLinksApi({ action: 'get', kind: kind, id: docId })
      .then(function (j) { if (live) { setD(j); } })
      .catch(function (e) { if (live) { setErr(e.status === 403 ? '403' : ((e && e.message) || 'Could not load the proforma link.')); } });
    return function () { live = false; };
  }, [docId, kind, bump, props.refreshKey]); // eslint-disable-line

  if (!docId) { return null; }
  if (err === '403') { return null; } // a person who may not see invoices sees nothing here
  var box = { border: '1px solid ' + C.line, background: C.panel, borderRadius: 8, padding: 10, marginTop: 12, color: C.text, fontSize: 12 };
  if (err) { return <div style={box}><span style={{ color: C.warn, fontWeight: 700 }}>Proforma link: {err}</span> <button onClick={reload} style={{ marginLeft: 8, textDecoration: 'underline', color: C.soft }}>try again</button></div>; }
  if (!d) { return <div style={box}><span style={{ color: C.soft }}>Loading the proforma link…</span></div>; }

  var mayEdit = d.can_edit === true && props.mayEdit !== false && props.readOnly !== true;
  var ready = d.installed !== false;
  var proformaId = kind === 'proforma' ? docId : (d.proforma && !d.proforma.hidden ? d.proforma.id : null);
  var files = d.files || [];
  var btn = { background: C.btn, color: C.btnText, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800 };
  var quietBtn = { background: C.quiet, color: C.quietText, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700 };
  var chip = { background: C.chipBg, color: C.chipText, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer' };
  var head = { fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 4 };

  function changed() { reload(); if (props.onChanged) { props.onChanged(); } }
  function doLink(pfId, invId, confirmOther) {
    setBusy(true); var retrying = false;
    proformaLinksApi({ action: 'link', proforma_id: pfId, invoice_id: invId, confirm_other_customer: confirmOther === true })
      .then(function () { toast.success('Linked.'); setPicking(false); setQ(''); changed(); })
      .catch(function (e) {
        if (e.code === 'other_customer' && confirmOther !== true) {
          if (window.confirm(e.message + '\n\nPress OK only if this really is the same deal.')) { retrying = true; doLink(pfId, invId, true); }
          return;
        }
        toast.error(e.message || 'Not linked.');
      })
      .finally(function () { if (!retrying) { setBusy(false); } });
  }
  function doUnlink(linkId, label) {
    var reason = window.prompt('Unlink ' + label + '?\n\nThe link is taken off both screens. It stays in the records as history, and the signed proforma stays with the proforma.\n\nReason (optional):', '');
    if (reason === null) { return; }
    setBusy(true);
    proformaLinksApi({ action: 'unlink', link_id: linkId, reason: reason })
      .then(function () { toast.success('Unlinked.'); changed(); })
      .catch(function (e) { toast.error(e.message || 'Not unlinked.'); })
      .finally(function () { setBusy(false); });
  }
  function openFile(f, download) {
    var w = download ? null : window.open('', '_blank');
    proformaLinksApi({ action: 'file_url', file_id: f.id, download: download === true })
      .then(function (j) { if (w) { w.location.href = j.url; } else { window.location.assign(j.url); } })
      .catch(function (e) { if (w) { w.close(); } toast.error(e.message || 'The file could not be opened.'); });
  }
  function upload(file) {
    if (!file || !proformaId) { return; }
    var problem = signedFileProblem(file);
    if (problem) { toast.error(problem); return; }
    setBusy(true); setProgress('Sending ' + file.name + ' (' + sizeWords(file.size) + ')…');
    var ticket = null;
    proformaLinksApi({ action: 'upload_start', proforma_id: proformaId, file_name: file.name, size: file.size, content_type: file.type || '' })
      .then(function (j) {
        ticket = j;
        return supabase.storage.from(j.bucket).uploadToSignedUrl(j.path, j.token, file, { contentType: file.type || 'application/octet-stream' });
      })
      .then(function (up) {
        if (up && up.error) { throw new Error('The file could not be sent (' + up.error.message + '). Nothing was saved.'); }
        setProgress('Checking and saving…');
        return proformaLinksApi({ action: 'upload_finish', proforma_id: proformaId, path: ticket.path, file_name: file.name, note: note });
      })
      .then(function (j) {
        var v = j.file ? j.file.version : '';
        toast.success('Signed proforma saved as version ' + v + '.' + (j.kept_versions > 0 ? ' The earlier version' + (j.kept_versions > 1 ? 's are' : ' is') + ' kept.' : ''));
        setNote(''); changed();
      })
      .catch(function (e) { toast.error((e && e.message) || 'Not saved.'); })
      .finally(function () { setBusy(false); setProgress(''); });
  }

  // ── the list to pick from when linking (the screen passes what it already has loaded)
  function pickList() {
    var pool = kind === 'invoice' ? (props.proformas || []) : (props.invoices || []);
    var myCust = kind === 'invoice' ? (props.doc && props.doc.accounting_customer_id) : (d.proforma && d.proforma.accounting_customer_id);
    var taken = (props.linkMap && props.linkMap.by_invoice) || {};
    var name = props.customerName || function () { return ''; };
    var words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var out = pool.filter(function (r) {
      if (r.record_status === 'deleted') { return false; }
      if (kind === 'proforma' && taken[r.id]) { return false; } // already belongs to a proforma
      var hay = ((kind === 'invoice' ? r.proforma_number : r.invoice_number) || '') + ' ' + (r.release_number || '') + ' ' + name(r.accounting_customer_id) + ' ' + (kind === 'invoice' ? (r.proforma_date || '') : (r.invoice_date || '')) + ' ' + fmt(r.total_amount);
      hay = hay.toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    out.sort(function (a, b) {
      var sa = myCust && a.accounting_customer_id === myCust ? 0 : 1; var sb = myCust && b.accounting_customer_id === myCust ? 0 : 1;
      if (sa !== sb) { return sa - sb; }
      var da = (kind === 'invoice' ? a.proforma_date : a.invoice_date) || ''; var db = (kind === 'invoice' ? b.proforma_date : b.invoice_date) || '';
      return da < db ? 1 : (da > db ? -1 : 0);
    });
    return { rows: out.slice(0, 40), more: Math.max(0, out.length - 40), myCust: myCust, name: name };
  }
  var canPick = mayEdit && ready && (kind === 'invoice' ? !!props.proformas : !!props.invoices);
  var picker = null;
  if (picking && canPick) {
    var pl = pickList();
    picker = <div style={{ border: '1px solid ' + C.line, borderRadius: 6, padding: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input autoFocus value={q} onChange={function (e) { setQ(e.target.value); }} placeholder={kind === 'invoice' ? 'Search proformas — number, customer, date, amount' : 'Search invoices — number, release, customer, date, amount'}
          style={{ flex: 1, border: '1px solid ' + C.line, borderRadius: 6, padding: '4px 8px', fontSize: 12, background: light ? '#ffffff' : '#0f172a', color: C.text }} />
        <button onClick={function () { setPicking(false); setQ(''); }} style={quietBtn}>Cancel</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {pl.rows.length === 0 && <div style={{ color: C.soft, fontStyle: 'italic' }}>Nothing matches.</div>}
        {pl.rows.map(function (r) {
          var same = pl.myCust && r.accounting_customer_id === pl.myCust;
          return <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', borderBottom: '1px solid ' + C.line }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, minWidth: 90 }}>{(kind === 'invoice' ? r.proforma_number : r.invoice_number) || '(no number)'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name(r.accounting_customer_id) || '—'}{!same && pl.myCust ? <span style={{ color: C.warn, fontWeight: 700 }}> · other customer</span> : null}</span>
            <span style={{ color: C.soft }}>{(kind === 'invoice' ? r.proforma_date : r.invoice_date) || '—'}</span>
            <span style={{ fontFamily: 'monospace' }}>{fmt(r.total_amount)}</span>
            <button disabled={busy} onClick={function () { if (kind === 'invoice') { doLink(r.id, docId, false); } else { doLink(docId, r.id, false); } }} style={btn}>Link</button>
          </div>;
        })}
        {pl.more > 0 && <div style={{ color: C.soft, fontStyle: 'italic', paddingTop: 4 }}>+{pl.more} more — keep typing to narrow.</div>}
      </div>
    </div>;
  }

  var linkPart;
  if (kind === 'invoice') {
    var p = d.proforma;
    linkPart = <div>
      <div style={head}>Proforma this invoice came from</div>
      {!p && <div style={{ color: C.soft }}>Not linked to a proforma.{canPick && !picking ? <button onClick={function () { setPicking(true); }} style={Object.assign({ marginLeft: 8 }, btn)}>Link to a proforma…</button> : null}</div>}
      {p && p.hidden && <div style={{ color: C.soft }}>Linked to a proforma that is older than the history you are allowed to see.</div>}
      {p && !p.hidden && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={function () { if (props.onOpenProforma) { props.onOpenProforma(p.id); } }} style={chip} title="Open this proforma on top of the page">Proforma {p.proforma_number || '(no number)'} ↗</button>
        <span style={{ color: C.soft }}>{p.proforma_date || ''}{p.record_status && p.record_status !== 'active' ? ' · ' + String(p.record_status).toUpperCase() : ''} · {p.via === 'convert' ? 'made by Convert' : ('linked by ' + (p.linked_by_name || 'someone') + (p.linked_at ? ' on ' + when(p.linked_at) : ''))}{p.other_customer ? ' · different customer (confirmed)' : ''}</span>
        {mayEdit && p.via === 'link' && p.link_id && <button disabled={busy} onClick={function () { doUnlink(p.link_id, 'proforma ' + (p.proforma_number || '')); }} style={quietBtn}>Unlink</button>}
      </div>}
    </div>;
  } else {
    var invs = d.invoices || [];
    linkPart = <div>
      <div style={head}>Invoices made from this proforma</div>
      {invs.length === 0 && !d.hidden_invoices && <div style={{ color: C.soft }}>No invoice is linked yet.</div>}
      {invs.map(function (iv, n) {
        return <div key={iv.id || ('gone' + n)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
          {iv.gone
            ? <span style={{ color: C.soft }}>Invoice {iv.invoice_number || ''} — deleted since it was linked</span>
            : <button onClick={function () { if (props.onOpenInvoice) { props.onOpenInvoice(iv.id); } }} style={chip} title="Open this invoice on top of the page">Invoice {iv.invoice_number || '(no number)'} ↗</button>}
          {!iv.gone && <span style={{ color: C.soft }}>{iv.invoice_date || ''} · {fmt(iv.total_amount)}{iv.record_status && iv.record_status !== 'active' ? ' · ' + String(iv.record_status).toUpperCase() : ''} · {iv.via === 'convert' ? 'made by Convert' : ('linked by ' + (iv.linked_by_name || 'someone') + (iv.linked_at ? ' on ' + when(iv.linked_at) : ''))}{iv.other_customer ? ' · different customer (confirmed)' : ''}</span>}
          {mayEdit && iv.via === 'link' && iv.link_id && <button disabled={busy} onClick={function () { doUnlink(iv.link_id, 'invoice ' + (iv.invoice_number || '')); }} style={quietBtn}>Unlink</button>}
        </div>;
      })}
      {d.hidden_invoices > 0 && <div style={{ color: C.soft }}>{d.hidden_invoices} linked invoice(s) are older than the history you are allowed to see.</div>}
      {canPick && !picking && <button onClick={function () { setPicking(true); }} style={Object.assign({ marginTop: 4 }, btn)}>Link an invoice…</button>}
      {(d.earlier_links || []).length > 0 && <div style={{ marginTop: 4 }}>
        <button onClick={function () { setShowEarlier(!showEarlier); }} style={{ color: C.soft, textDecoration: 'underline', fontSize: 11 }}>{showEarlier ? 'Hide' : 'Show'} {(d.earlier_links || []).length} earlier link(s) that were removed</button>
        {showEarlier && d.earlier_links.map(function (l, n) {
          return <div key={n} style={{ color: C.soft, fontSize: 11 }}>Invoice {l.invoice_number || '(not shown)'} — linked by {l.linked_by_name || 'someone'} on {when(l.linked_at)}; unlinked by {l.removed_by_name || 'someone'} on {when(l.removed_at)}{l.removed_reason ? ' — ' + l.removed_reason : ''}</div>;
        })}
      </div>}
    </div>;
  }

  var showFiles = kind === 'proforma' || !!proformaId;
  var mayUpload = mayEdit && ready && kind === 'proforma' && props.allowUpload !== false;
  return <div style={box} data-proforma-link-box={kind}>
    {linkPart}
    {picker}
    {showFiles && <div style={{ marginTop: 10, borderTop: '1px solid ' + C.line, paddingTop: 8 }}>
      <div style={head}>Signed proforma {files.length > 0 ? <span style={{ color: C.ok }}>· {files.length} version{files.length > 1 ? 's' : ''} on file</span> : <span style={{ color: C.soft, fontWeight: 600 }}>· none uploaded yet</span>}</div>
      {files.map(function (f) {
        return <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0', borderBottom: '1px solid ' + C.line }}>
          <span style={{ fontWeight: 800, minWidth: 74 }}>Version {f.version}{f.newest ? <span style={{ color: C.ok }}> · latest</span> : null}</span>
          <span style={{ flex: 1, minWidth: 140 }}>{f.file_name} <span style={{ color: C.soft }}>· {sizeWords(f.size_bytes)} · uploaded by {f.uploaded_by_name || 'someone'} on {when(f.uploaded_at)}{f.note ? ' · ' + f.note : ''}</span></span>
          <button onClick={function () { openFile(f, false); }} style={btn}>Open</button>
          <button onClick={function () { openFile(f, true); }} style={quietBtn}>Download</button>
        </div>;
      })}
      {files.length > 1 && <div style={{ color: C.soft, fontSize: 11, marginTop: 3 }}>Earlier versions are kept for the record. Nothing is replaced or deleted.</div>}
      {mayUpload && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <label style={Object.assign({ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }, btn)} title="A PDF or a picture (JPG, PNG, WEBP), up to 15 MB. It is added as a new version; earlier versions stay.">
          {files.length > 0 ? '⬆ Upload a newer signed copy' : '⬆ Upload signed proforma'}
          <input type="file" accept={SIGNED_ACCEPT} disabled={busy} style={{ display: 'none' }} onChange={function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; upload(f); }} />
        </label>
        <input value={note} onChange={function (e) { setNote(e.target.value); }} maxLength={300} placeholder="Note for this copy (optional) — e.g. signed by the buyer"
          style={{ flex: 1, minWidth: 180, border: '1px solid ' + C.line, borderRadius: 6, padding: '4px 8px', fontSize: 12, background: light ? '#ffffff' : '#0f172a', color: C.text }} />
        {progress && <span style={{ color: C.soft }}>{progress}</span>}
      </div>}
      {kind === 'invoice' && files.length === 0 && <div style={{ color: C.soft, fontSize: 11 }}>The signed copy is uploaded on the proforma itself (open it with the button above).</div>}
    </div>}
    {!ready && d.can_edit === true && <div style={{ color: C.warn, fontSize: 11, marginTop: 6, fontWeight: 700 }}>Linking and signed copies switch on after one database update (sql/v55-83-VZ-proforma-links-signed.sql). Until then only links made by Convert are shown.</div>}
  </div>;
}
