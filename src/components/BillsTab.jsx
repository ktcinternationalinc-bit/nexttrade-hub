'use client';
// v55.83-PB — Accounting > Bills (AP). Max (Nov 5): "add a vendors bill side".
// Enter what the company owes, track OPEN / PARTIAL / PAID, and pay a bill by
// linking the REAL bank transaction (money out, settled). Writes need the
// bills.manage permission; nothing is ever deleted — bills void, payments void.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { US_WAVE_BUSINESS_ID } from '../lib/business-of';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var TODAY = new Date().toISOString().substring(0, 10);

export default function BillsTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canView = isSuperAdmin || modulePerms['bills.view'] === true || modulePerms['bills.manage'] === true;
  var canManage = isSuperAdmin || modulePerms['bills.manage'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };

  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(null); var editing = s3[0]; var setEditing = s3[1]; // bill draft or null
  var s4 = useState(null); var paying = s4[0]; var setPaying = s4[1];   // {bill, amount, paid_date, bank_transaction_id}
  var s5 = useState('open'); var filter = s5[0]; var setFilter = s5[1];
  var s6 = useState([]); var outTxns = s6[0]; var setOutTxns = s6[1];
  var s7 = useState(null); var expanded = s7[0]; var setExpanded = s7[1];
  var s8 = useState(null); var importFile = s8[0]; var setImportFile = s8[1]; // {file, base64, media_type}
  var s9 = useState(false); var reading = s9[0]; var setReading = s9[1];
  var s10 = useState([]); var importNotes = s10[0]; var setImportNotes = s10[1];
  var s11 = useState(null); var validating = s11[0]; var setValidating = s11[1]; // {bill, checks, notes}
  var s12 = useState(null); var disputing = s12[0]; var setDisputing = s12[1];   // {bill, reason, follow_up_date}
  var s13 = useState(null); var dueThru = s13[0]; var setDueThru = s13[1];       // result of due_through
  var s14 = useState(''); var thruDate = s14[0]; var setThruDate = s14[1];
  var fileInputRef = React.useRef(null);

  function api(payload) {
    return fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json(); });
  }
  function load() {
    setBusy(true);
    api({ action: 'list' }).then(function (j) {
      if (j && j.ok) { setData(j); } else { toast.error((j && j.error) || 'Could not load bills.'); }
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canView) { load(); } }, []); // eslint-disable-line

  // settled OUT bank transactions of the US business, newest first, for the pay picker
  function loadOutTxns() {
    supabase.from('bank_transactions')
      .select('id, date, posted_date, amount_abs, name, merchant_name, pending, direction, wave_business_id')
      .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out')
      .order('date', { ascending: false }).limit(200)
      .then(function (r) { setOutTxns((r.data || []).filter(function (t) { return t.pending !== true; })); });
  }

  // v55.83-PC — import a bill: the AI reads it, the form gets pre-filled,
  // MAX confirms. Unreadable fields stay blank — never guessed.
  function onPickFile(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) { return; }
    var okTypes = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1 };
    if (!okTypes[f.type]) { toast.error('Use a JPG/PNG photo or a PDF.'); return; }
    if (f.size > 10 * 1024 * 1024) { toast.error('Keep the file under 10 MB.'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result).split(',')[1] || '';
      setReading(true); setImportNotes([]);
      api({ action: 'extract_bill', file_base64: b64, media_type: f.type }).then(function (j) {
        if (j && j.ok && j.draft) {
          setImportFile({ file: f, base64: b64, media_type: f.type });
          setImportNotes(j.problems || []);
          setEditing({
            vendor_name: j.draft.vendor_name || '', bill_number: j.draft.bill_number || '',
            bill_date: j.draft.bill_date || TODAY, due_date: j.draft.due_date || '',
            total_amount: j.draft.total_amount || '', category: j.draft.category || '',
            notes: j.draft.notes || '', _imported: true,
          });
          toast.success('Bill read — check every field, then Save.');
        } else { toast.error((j && j.error) || 'Could not read the bill — enter it manually.'); }
      }).finally(function () { setReading(false); });
    };
    rd.readAsDataURL(f);
  }

  if (!canView) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
      Bills need the <b>Bills: View</b> permission — ask an admin to grant it in Settings → Permissions.</div>;
  }

  var bills = (data && data.bills) || [];
  var payments = (data && data.payments) || [];
  var totals = (data && data.totals) || { open: 0, overdue: 0, open_count: 0 };
  var shown = bills.filter(function (b) {
    if (filter === 'open') { return b.record_status === 'active' && b.disputed !== true && b.open > 0.005; }
    if (filter === 'paid') { return b.record_status === 'active' && b.open <= 0.005; }
    if (filter === 'disputed') { return b.disputed === true && b.record_status === 'active'; }
    if (filter === 'void') { return b.record_status === 'void'; }
    return true;
  });
  function paysOf(id) { return payments.filter(function (p) { return p.bill_id === id; }); }
  function chip(st) {
    var map = { OPEN: ['#fee2e2', '#7f1d1d'], PARTIAL: ['#ffedd5', '#431407'], PAID: ['#d1fae5', '#065f46'], VOID: ['#e2e8f0', '#334155'], DISPUTED: ['#ede9fe', '#5b21b6'] };
    var c = map[st] || map.VOID;
    return <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: c[0], color: c[1] }}>{st}</span>;
  }
  function valChip(b) {
    if (b.validation_status === 'validated') {
      return <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" title={'Validated ' + (b.validated_at ? String(b.validated_at).substring(0, 10) : '') + (b.validation_notes ? ' — ' + b.validation_notes : '')} style={{ background: '#d1fae5', color: '#065f46' }}>✓ VALIDATED</span>;
    }
    return <button onClick={function () { if (canManage) { setValidating({ bill: b, checks: {}, notes: '' }); } }}
      className="px-2 py-0.5 rounded text-[10px] font-extrabold" title="Click to run the validation checks"
      style={{ background: '#ffedd5', color: '#431407', border: '1px dashed #fdba74' }}>PENDING</button>;
  }
  function openDoc(path) {
    var priv = String(path).indexOf('pv/') === 0;
    var bucket = priv ? 'bills-private' : 'attachments';
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(function (r) {
      var u = r && r.data && r.data.signedUrl;
      if (!u && !priv) { u = (supabase.storage.from('attachments').getPublicUrl(path).data || {}).publicUrl; }
      if (u) { window.open(u, '_blank'); } else { toast.error('Could not open the file.'); }
    });
  }

  function saveBill() {
    var d = Object.assign({}, editing || {});
    setBusy(true);
    var pre = Promise.resolve(null);
    if (importFile && d._imported) {
      var safeName = String(importFile.file.name || 'bill').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
      var storagePath = 'pv/' + Date.now() + '-' + safeName; // v55.83-PE: private bucket — financial documents are not public files
      pre = supabase.storage.from('bills-private').upload(storagePath, importFile.file, { upsert: false })
        .then(function (r) { return r && r.error ? null : storagePath; })
        .catch(function () { return null; });
    }
    pre.then(function (att) {
      if (att) { d.attachment_path = att; }
      return api({ action: 'save_bill', bill: d });
    }).then(function (j) {
      if (j && j.ok) {
        toast.success('Bill saved.' + (j.warning ? ' ⚠ ' + j.warning : ''));
        setEditing(null); setImportFile(null); setImportNotes([]); load();
      } else { toast.error((j && j.error) || 'Save failed.'); }
    }).finally(function () { setBusy(false); });
  }
  function savePayment() {
    var p = paying || {};
    setBusy(true);
    api({ action: 'record_payment', bill_id: p.bill.id, amount: p.amount, paid_date: p.paid_date || TODAY, bank_transaction_id: p.bank_transaction_id || null, method: p.method || '' })
      .then(function (j) {
        if (j && j.ok) { toast.success('Payment recorded.'); setPaying(null); load(); }
        else { toast.error((j && j.error) || 'Payment failed.'); }
      }).finally(function () { setBusy(false); });
  }

  var inp = 'px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white';
  return <div className="bg-white rounded-xl border border-slate-200 p-3">
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold text-slate-900 mr-1">💸 Bills — what we owe</div>
      <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>Open: ${fmt(totals.open)} ({totals.open_count})</span>
      {totals.overdue > 0 && <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#ffedd5', color: '#431407' }}>Overdue: ${fmt(totals.overdue)}</span>}
      <div className="flex-1" />
      {['open', 'paid', 'disputed', 'void', 'all'].map(function (f) {
        return <button key={f} onClick={function () { setFilter(f); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
          style={filter === f ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{f.toUpperCase()}</button>;
      })}
      {canManage && <button onClick={function () { if (fileInputRef.current) { fileInputRef.current.click(); } }} disabled={busy || reading}
        className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#7c3aed', color: '#ffffff' }}>{reading ? 'Reading…' : '📷 Import bill'}</button>}
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style={{ display: 'none' }} onChange={onPickFile} />
      {canManage && <button onClick={function () { setEditing({ bill_date: TODAY }); }} disabled={busy}
        className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>+ Add bill</button>}
      <button onClick={load} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>↻</button>
    </div>

    {/* v55.83-PE — "If I ask how much we owe through <date>, I should immediately
        receive a complete and accurate list, by vendor, with the total." */}
    <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs font-extrabold" style={{ color: '#0f172a' }}>What do we owe through…</span>
        <input type="date" className={inp} value={thruDate} onChange={function (e) { setThruDate(e.target.value); }} />
        <button onClick={function () { if (!thruDate) { toast.error('Pick a date.'); return; } setBusy(true); api({ action: 'due_through', through: thruDate }).then(function (j) { if (j && j.ok) { setDueThru(j); } else { toast.error((j && j.error) || 'Failed.'); } }).finally(function () { setBusy(false); }); }}
          disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>Answer</button>
        {dueThru && <button onClick={function () {
          var L2 = ['vendor,bill_number,due_date,open_balance,validation'];
          (dueThru.bills || []).forEach(function (b2) { L2.push(['"' + String(b2.vendor).replace(/"/g, '""') + '"', '"' + String(b2.bill_number || '').replace(/"/g, '""') + '"', b2.due_date, b2.open.toFixed(2), b2.validation].join(',')); });
          L2.push(''); L2.push('TOTAL OWED through ' + dueThru.through + ',,,' + dueThru.total_owed.toFixed(2) + ',');
          var blob = new Blob([L2.join('\n')], { type: 'text/csv' }); var a2 = document.createElement('a');
          a2.href = URL.createObjectURL(blob); a2.download = 'bills-due-through-' + dueThru.through + '.csv'; a2.click();
        }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>}
      </div>
      {dueThru && <div className="mt-2">
        <div className="flex gap-2 flex-wrap text-[11px] font-extrabold">
          <span className="px-2 py-1 rounded-lg" style={{ background: '#fee2e2', color: '#7f1d1d' }}>TOTAL through {dueThru.through}: ${fmt(dueThru.total_owed)} ({dueThru.bill_count} bills)</span>
          <span className="px-2 py-1 rounded-lg" style={{ background: '#d1fae5', color: '#065f46' }}>validated: ${fmt(dueThru.validated_open)}</span>
          <span className="px-2 py-1 rounded-lg" style={{ background: '#ffedd5', color: '#431407' }}>pending validation: ${fmt(dueThru.pending_validation_open)}</span>
          {(dueThru.disputed_excluded || []).length > 0 && <span className="px-2 py-1 rounded-lg" style={{ background: '#ede9fe', color: '#5b21b6' }}>{dueThru.disputed_excluded.length} disputed bill(s) EXCLUDED from the total</span>}
        </div>
        <div className="text-[11px] mt-1" style={{ color: '#334155' }}>
          <b>By vendor:</b> {(dueThru.by_vendor || []).map(function (v) { return v.vendor + ' $' + fmt(v.open) + ' (' + v.count + ')'; }).join(' · ') || 'nothing due'}
        </div>
      </div>}
    </div>

    {validating && <div className="rounded-xl p-3 mb-3" style={{ background: '#fffbeb', border: '1px solid #f59e0b' }}>
      <div className="text-xs font-extrabold mb-1" style={{ color: '#78350f' }}>Validate: {validating.bill.vendor_name} {validating.bill.bill_number ? '· ' + validating.bill.bill_number : ''} — ${fmt(validating.bill.total_amount)}</div>
      <div className="text-[11px] mb-2" style={{ color: '#92400e' }}>Validation is not a formality. Confirm each check ONLY if you actually performed it — this record is audited, with your name and timestamp on it.</div>
      {[['matches_records', 'The bill matches our system records (PO/shipment/order)'], ['goods_received', 'The goods or services were actually received'], ['charges_accurate', 'The charges are accurate and legitimate']].map(function (c) {
        return <label key={c[0]} className="flex gap-2 items-center text-[12px] py-0.5" style={{ color: '#431407' }}>
          <input type="checkbox" checked={validating.checks[c[0]] === true} onChange={function (e) { var ch = Object.assign({}, validating.checks); ch[c[0]] = e.target.checked; setValidating(Object.assign({}, validating, { checks: ch })); }} />{c[1]}</label>;
      })}
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        <input className={inp} style={{ width: 170 }} placeholder="Warehouse ref (optional)" value={validating.warehouse_reference || ''} onChange={function (e) { setValidating(Object.assign({}, validating, { warehouse_reference: e.target.value })); }} />
        <button onClick={function () {
          var refv = String(validating.warehouse_reference || '').trim();
          if (refv.length < 2) { toast.error('Type a reference first.'); return; }
          api({ action: 'match_reference', reference: refv }).then(function (j) {
            if (j && j.ok) {
              var hits = (j.warehouse_orders || []).map(function (o) { return 'order ' + o.release_number + ' (' + (o.customer_name || '?') + ', ' + (o.order_date || '?') + ')'; })
                .concat((j.shipments || []).map(function (sh) { return 'shipment ' + sh.shipment_ref + ' (' + (sh.supplier_name || '?') + (sh.received_date ? ', received ' + sh.received_date : ', ' + (sh.status || '')) + ')'; }));
              setValidating(Object.assign({}, validating, { system_match: { reference: refv, found: j.found, hits: hits.slice(0, 5) } }));
              if (j.found) { toast.success('System match: ' + hits[0]); } else { toast.error('No warehouse record matches "' + refv + '".'); }
            } else { toast.error((j && j.error) || 'Lookup failed.'); }
          });
        }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#0ea5e9', color: '#ffffff' }}>🔎 Check warehouse</button>
        {validating.system_match && <span className="text-[10px] font-bold" style={{ color: validating.system_match.found ? '#065f46' : '#7f1d1d' }}>
          {validating.system_match.found ? '✓ ' + validating.system_match.hits[0] : '✕ no system match'}</span>}
      </div>
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        <input className={inp} style={{ width: 380 }} placeholder="HOW did you verify it? (required — goes on the audit trail)" value={validating.notes} onChange={function (e) { setValidating(Object.assign({}, validating, { notes: e.target.value })); }} />
        <button onClick={function () {
          setBusy(true);
          api({ action: 'validate_bill', id: validating.bill.id, checks: validating.checks, notes: validating.notes, warehouse_reference: validating.warehouse_reference || '', system_match: validating.system_match || null }).then(function (j) {
            if (j && j.ok) { toast.success('Validated — recorded on the audit trail.'); setValidating(null); load(); }
            else { toast.error((j && j.error) || 'Validation refused.'); }
          }).finally(function () { setBusy(false); });
        }} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>✓ Mark validated</button>
        <button onClick={function () { setValidating(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
    </div>}

    {disputing && <div className="rounded-xl p-3 mb-3" style={{ background: '#f5f3ff', border: '1px solid #c4b5fd' }}>
      <div className="text-xs font-extrabold mb-1" style={{ color: '#4c1d95' }}>Dispute: {disputing.bill.vendor_name} {disputing.bill.bill_number ? '· ' + disputing.bill.bill_number : ''}</div>
      <div className="text-[11px] mb-2" style={{ color: '#5b21b6' }}>A dispute without a ticket does not exist. This creates a High ticket with a follow-up date; the bill leaves the payable totals until resolved.</div>
      <div className="flex gap-2 items-center flex-wrap">
        <input className={inp} style={{ width: 380 }} placeholder="Reason for the dispute (required)" value={disputing.reason || ''} onChange={function (e) { setDisputing(Object.assign({}, disputing, { reason: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Follow-up<input className={inp + ' ml-1'} type="date" value={disputing.follow_up_date || ''} onChange={function (e) { setDisputing(Object.assign({}, disputing, { follow_up_date: e.target.value })); }} /></label>
        <button onClick={function () {
          setBusy(true);
          api({ action: 'dispute_bill', id: disputing.bill.id, reason: disputing.reason, follow_up_date: disputing.follow_up_date }).then(function (j) {
            if (j && j.ok) { toast.success('Disputed — ticket ' + j.ticket_number + ' created.'); setDisputing(null); load(); }
            else { toast.error((j && j.error) || 'Failed.'); }
          }).finally(function () { setBusy(false); });
        }} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#6d28d9', color: '#ffffff' }}>⚑ Dispute + ticket</button>
        <button onClick={function () { setDisputing(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
    </div>}

    {editing && <div className="rounded-xl p-3 mb-3" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div className="text-xs font-extrabold mb-2" style={{ color: '#1e3a8a' }}>{editing.id ? 'Edit bill' : (editing._imported ? '📷 Imported bill — CHECK every field before saving' : 'New bill')}</div>
      {editing._imported && importNotes.length > 0 && <div className="text-[11px] rounded-lg p-2 mb-2" style={{ background: '#ffedd5', color: '#431407', border: '1px solid #fdba74' }}>{importNotes.join(' ')}</div>}
      <div className="flex gap-2 flex-wrap items-center">
        <input className={inp} style={{ width: 200 }} placeholder="Vendor *" value={editing.vendor_name || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { vendor_name: e.target.value })); }} />
        <input className={inp} style={{ width: 120 }} placeholder="Bill #" value={editing.bill_number || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_number: e.target.value })); }} />
        <input className={inp} type="number" step="0.01" style={{ width: 120 }} placeholder="Amount *" value={editing.total_amount || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { total_amount: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Bill date<input className={inp + ' ml-1'} type="date" value={editing.bill_date || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_date: e.target.value })); }} /></label>
        <label className="text-[10px] font-bold text-slate-600">Due<input className={inp + ' ml-1'} type="date" value={editing.due_date || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { due_date: e.target.value })); }} /></label>
        <input className={inp} style={{ width: 160 }} placeholder="Category (e.g. Freight)" value={editing.category || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { category: e.target.value })); }} />
        <input className={inp} style={{ width: 220 }} placeholder="Notes" value={editing.notes || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { notes: e.target.value })); }} />
        <button onClick={saveBill} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Save</button>
        <button onClick={function () { setEditing(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
    </div>}

    {paying && <div className="rounded-xl p-3 mb-3" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
      <div className="text-xs font-extrabold mb-2" style={{ color: '#14532d' }}>Pay: {paying.bill.vendor_name} {paying.bill.bill_number ? '· ' + paying.bill.bill_number : ''} — open ${fmt(paying.bill.open)}</div>
      <div className="flex gap-2 flex-wrap items-center">
        <input className={inp} type="number" step="0.01" style={{ width: 120 }} placeholder="Amount *" value={paying.amount || ''} onChange={function (e) { setPaying(Object.assign({}, paying, { amount: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Paid on<input className={inp + ' ml-1'} type="date" value={paying.paid_date || TODAY} onChange={function (e) { setPaying(Object.assign({}, paying, { paid_date: e.target.value })); }} /></label>
        <select className={inp} style={{ maxWidth: 380 }} value={paying.bank_transaction_id || ''} onChange={function (e) { setPaying(Object.assign({}, paying, { bank_transaction_id: e.target.value })); }}>
          <option value="">No bank link (cash/other)</option>
          {outTxns.map(function (t) {
            return <option key={t.id} value={t.id}>{(t.posted_date || t.date) + ' · $' + fmt(t.amount_abs) + ' · ' + String(t.merchant_name || t.name || '').substring(0, 48)}</option>;
          })}
        </select>
        <button onClick={savePayment} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Record payment</button>
        <button onClick={function () { setPaying(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
      <div className="text-[10px] mt-1" style={{ color: '#166534' }}>Linking the real bank transaction keeps the books provable — the list shows settled money-out from the US accounts.</div>
    </div>}

    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          <th className="py-2 pr-2 font-semibold">Vendor</th><th className="py-2 pr-2 font-semibold">Bill #</th>
          <th className="py-2 pr-2 font-semibold">Bill date</th><th className="py-2 pr-2 font-semibold">Due</th>
          <th className="py-2 pr-2 font-semibold text-right">Amount</th><th className="py-2 pr-2 font-semibold text-right">Paid</th>
          <th className="py-2 pr-2 font-semibold text-right">Open</th><th className="py-2 pr-2 font-semibold">Category</th>
          <th className="py-2 pr-2 font-semibold">Status</th><th className="py-2 pr-2 font-semibold">Validation</th><th className="py-2 font-semibold"></th></tr></thead>
        <tbody>
          {shown.map(function (b) {
            var late = b.record_status === 'active' && b.open > 0.005 && b.due_date && b.due_date < TODAY;
            return <React.Fragment key={b.id}>
              <tr style={late ? { background: '#ffedd5', color: '#431407', borderBottom: '1px solid #e2e8f0' } : { color: '#0f172a', borderBottom: '1px solid #e2e8f0' }}>
                <td className="py-1.5 pr-2 font-semibold">{b.vendor_name}</td>
                <td className="py-1.5 pr-2">{b.bill_number || '—'}</td>
                <td className="py-1.5 pr-2">{b.bill_date}</td>
                <td className="py-1.5 pr-2">{b.due_date || '—'}{late ? ' ⚠' : ''}</td>
                <td className="py-1.5 pr-2 text-right">${fmt(b.total_amount)}</td>
                <td className="py-1.5 pr-2 text-right">${fmt(b.paid)}</td>
                <td className="py-1.5 pr-2 text-right font-extrabold">${fmt(b.open)}</td>
                <td className="py-1.5 pr-2">{b.category || '—'}</td>
                <td className="py-1.5 pr-2">{chip(b.status)}{b.attachment_path && <button className="ml-1" title="View the imported bill file (private link, 1 hour)" onClick={function () { openDoc(b.attachment_path); }}>📎</button>}</td>
                <td className="py-1.5 pr-2">{b.record_status === 'active' ? valChip(b) : '—'}</td>
                <td className="py-1.5 whitespace-nowrap">
                  <button onClick={function () { setExpanded(expanded === b.id ? null : b.id); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#f1f5f9', color: '#334155' }}>{expanded === b.id ? 'Hide' : 'View'}</button>
                  {canManage && b.record_status === 'active' && b.open > 0.005 && <button onClick={function () { setPaying({ bill: b, amount: b.open, paid_date: TODAY }); loadOutTxns(); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold mr-1" style={{ background: '#047857', color: '#ffffff' }}>Pay</button>}
                  {canManage && b.record_status === 'active' && <button onClick={function () { setEditing(Object.assign({}, b)); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#f1f5f9', color: '#334155' }}>Edit</button>}
                  {canManage && b.record_status === 'active' && b.disputed !== true && <button onClick={function () { setDisputing({ bill: b }); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#ede9fe', color: '#5b21b6' }}>Dispute</button>}
                  {canManage && b.disputed === true && <button onClick={function () { var res = (typeof window !== 'undefined' && window.prompt) ? window.prompt('How was this dispute resolved? (goes on the audit trail)') : ''; if (res && res.length >= 10) { setBusy(true); api({ action: 'resolve_dispute', id: b.id, resolution: res }).then(function (j) { if (j && j.ok) { toast.success('Dispute resolved.'); load(); } else { toast.error((j && j.error) || 'Failed.'); } }).finally(function () { setBusy(false); }); } else if (res !== null) { toast.error('Write how it was resolved (a sentence).'); } }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#d1fae5', color: '#065f46' }}>Resolve</button>}
                  {canManage && b.record_status === 'active' && <button onClick={function () { if (window.confirm('Void this bill? It stays on record as VOID.')) { setBusy(true); api({ action: 'void_bill', id: b.id }).then(function (j) { if (j && j.ok) { load(); } else { toast.error((j && j.error) || 'Failed.'); } }).finally(function () { setBusy(false); }); } }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>Void</button>}
                </td>
              </tr>
              {expanded === b.id && <tr><td colSpan={11} className="py-1.5 pl-4" style={{ background: '#f8fafc', color: '#334155' }}>
                {b.notes && <div className="text-[11px] mb-1"><b>Notes:</b> {b.notes}</div>}
                {paysOf(b.id).length === 0 ? <span className="text-[11px]">No payments yet.</span> :
                  paysOf(b.id).map(function (p) {
                    return <div key={p.id} className="text-[11px] flex gap-2 items-center">
                      <span>{p.paid_date} — ${fmt(p.amount)}{p.voided ? ' (VOID)' : ''}{p.bank_transaction_id ? ' · 🏦 bank-linked' : (p.method ? ' · ' + p.method : '')}</span>
                      {canManage && !p.voided && <button onClick={function () { if (window.confirm('Void this payment?')) { setBusy(true); api({ action: 'void_payment', id: p.id }).then(function (j) { if (j && j.ok) { load(); } else { toast.error((j && j.error) || 'Failed.'); } }).finally(function () { setBusy(false); }); } }} className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>void</button>}
                    </div>;
                  })}
              </td></tr>}
            </React.Fragment>;
          })}
          {shown.length === 0 && <tr><td colSpan={11} className="py-4 text-center text-slate-500 text-[11px]">{busy ? 'Loading…' : 'No bills here yet.'}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
