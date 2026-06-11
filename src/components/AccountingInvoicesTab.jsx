// v55.83-AC — Accounting invoices + proformas (app-owned, accounting_customer_id only).
// Approval: draft -> internal_review -> approved (Owner/Admin/Accounting Manager).
// Proformas never touch balances until converted. Printable PDF via browser print.
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { canViewBank, canEditMappings, canReopen } from '../lib/bank-permissions';
import { roundMoney } from '../lib/payment-matching';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function blankItem() { return { description: '', quantity: '1', unit_price: '0', sku: '', product_ref: '' }; }
function itemTotal(it) { return roundMoney((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)); }
function docTotal(items) { var t = 0; (items || []).forEach(function (it) { t += itemTotal(it); }); return roundMoney(t); }

function MiniTypeahead(props) {
  var items = props.items || [];
  var st = useState(''); var q = st[0]; var setQ = st[1];
  var os = useState(false); var open = os[0]; var setOpen = os[1];
  var getLabel = props.getLabel; var sel = items.find(function (x) { return x.id === props.value; });
  var shown = (q.trim() ? items.filter(function (x) { return getLabel(x).toLowerCase().indexOf(q.trim().toLowerCase()) >= 0; }) : items).slice(0, 10);
  return (
    <div className="relative">
      <input value={open ? q : (sel ? getLabel(sel) : '')} placeholder={props.placeholder} disabled={props.disabled}
        onFocus={function () { setOpen(true); setQ(''); }} onBlur={function () { setTimeout(function () { setOpen(false); }, 150); }}
        onChange={function (e) { setQ(e.target.value); setOpen(true); }}
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs disabled:opacity-60" />
      {open && !props.disabled && (
        <div className="absolute z-30 left-0 right-0 bg-slate-900 border border-slate-600 rounded mt-0.5 max-h-48 overflow-auto shadow-xl">
          {shown.length === 0 ? <div className="px-2 py-1 text-[11px] text-slate-500 italic">no matches</div> :
            shown.map(function (x) { return <div key={x.id} onMouseDown={function () { props.onPick(x.id); setOpen(false); }} className="px-2 py-1 text-[11px] text-slate-100 hover:bg-indigo-600/40 cursor-pointer">{getLabel(x)}</div>; })}
        </div>
      )}
    </div>
  );
}

var inp = 'w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs';

export default function AccountingInvoicesTab(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};

  var mayView = canViewBank(isSuperAdmin, modulePerms);
  var mayEdit = canEditMappings(isSuperAdmin, modulePerms);
  var mayApprove = canReopen(isSuperAdmin, modulePerms, userProfile && userProfile.role); // Owner/Admin/Accounting Mgr

  var [mode, setMode] = useState(props.defaultMode || 'invoices');     // invoices | proformas
  var [businessId, setBusinessId] = useState(null);
  var [businessName, setBusinessName] = useState('KTC International Inc.');
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [proformas, setProformas] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(false);

  var [editing, setEditing] = useState(null);     // null | 'new' | row
  var [hdr, setHdr] = useState({});
  var [items, setItems] = useState([blankItem()]);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('businesses').select('id,name').limit(1),
      supabase.from('accounting_customers').select('*').order('company_name', { ascending: true }),
      supabase.from('accounting_invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('accounting_proformas').select('*').order('created_at', { ascending: false }),
    ]).then(function (r) {
      var b = (r[0] && r[0].data && r[0].data[0]) || null;
      if (b) { setBusinessId(b.id); if (b.name) setBusinessName(b.name); }
      setCustomers((r[1] && r[1].data) || []);
      setInvoices((r[2] && r[2].data) || []);
      setProformas((r[3] && r[3].data) || []);
    }).catch(function (e) { console.error('[acctinv] load', e); toast.error('Failed to load'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  function custName(id) { var c = customers.find(function (x) { return x.id === id; }); return c ? (c.company_name || c.contact_name || id) : '—'; }
  function isInvoice() { return mode === 'invoices'; }
  var rows = isInvoice() ? invoices : proformas;

  function startNew() {
    var today = new Date().toISOString().substring(0, 10);
    if (isInvoice()) setHdr({ invoice_number: '', accounting_customer_id: '', invoice_date: today, due_date: '', notes: '', terms: '' });
    else setHdr({ proforma_number: '', accounting_customer_id: '', proforma_date: today, valid_until: '', notes: '', terms: '' });
    setItems([blankItem()]); setEditing('new');
  }
  function startEdit(row) {
    var tbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var key = isInvoice() ? 'invoice_id' : 'proforma_id';
    setHdr(Object.assign({}, row)); setEditing(row); setItems([blankItem()]);
    supabase.from(tbl).select('*').eq(key, row.id).order('sort_order', { ascending: true }).then(function (r) {
      var its = ((r && r.data) || []).map(function (it) { return { id: it.id, description: it.description || '', quantity: String(it.quantity != null ? it.quantity : 1), unit_price: String(it.unit_price != null ? it.unit_price : 0), sku: it.sku || '', product_ref: it.product_ref || '' }; });
      setItems(its.length ? its : [blankItem()]);
    });
  }
  function uh(k, v) { var c = Object.assign({}, hdr); c[k] = v; setHdr(c); }
  function ui(i, k, v) { var c = items.slice(); c[i] = Object.assign({}, c[i]); c[i][k] = v; setItems(c); }
  function addItem() { setItems(items.concat([blankItem()])); }
  function rmItem(i) { var c = items.slice(); c.splice(i, 1); setItems(c.length ? c : [blankItem()]); }

  function locked(row) { return isInvoice() && row && row.approval_status === 'approved'; }

  function save() {
    if (!mayEdit) { toast.error('You do not have permission to edit.'); return; }
    if (editing !== 'new' && locked(editing)) { toast.error('Approved invoice is locked. Reopen to edit.'); return; }
    if (!hdr.accounting_customer_id) { toast.error('Pick an accounting customer.'); return; }
    var clean = items.filter(function (it) { return (it.description || '').trim() || Number(it.unit_price) || Number(it.quantity); });
    if (clean.length === 0) { toast.error('Add at least one line item.'); return; }
    var total = docTotal(clean);
    setBusy(true);
    var tbl = isInvoice() ? 'accounting_invoices' : 'accounting_proformas';
    var itemTbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var fk = isInvoice() ? 'invoice_id' : 'proforma_id';
    var hpayload = isInvoice()
      ? { invoice_number: hdr.invoice_number || null, accounting_customer_id: hdr.accounting_customer_id, invoice_date: hdr.invoice_date || null, due_date: hdr.due_date || null, notes: hdr.notes || null, terms: hdr.terms || null, total_amount: total, balance_due: roundMoney(total - (Number(hdr.amount_paid) || 0)), updated_by: userProfile && userProfile.id }
      : { proforma_number: hdr.proforma_number || null, accounting_customer_id: hdr.accounting_customer_id, proforma_date: hdr.proforma_date || null, valid_until: hdr.valid_until || null, notes: hdr.notes || null, terms: hdr.terms || null, total_amount: total, updated_by: userProfile && userProfile.id };

    var getId;
    if (editing === 'new') {
      hpayload.business_id = businessId; hpayload.created_by = userProfile && userProfile.id;
      getId = dbInsert(tbl, hpayload, userProfile && userProfile.id).then(function (res) { return res && res[0] ? res[0].id : (res && res.id); });
    } else {
      getId = dbUpdate(tbl, editing.id, hpayload, userProfile && userProfile.id).then(function () { return editing.id; });
    }
    getId.then(function (docId) {
      if (!docId) throw new Error('Could not determine document id after save.');
      // Replace line items: delete existing, insert current set.
      return supabase.from(itemTbl).delete().eq(fk, docId).then(function () {
        var chain = Promise.resolve();
        clean.forEach(function (it, idx) {
          chain = chain.then(function () {
            var payload = { business_id: businessId, description: it.description || null, quantity: Number(it.quantity) || 0, unit_price: Number(it.unit_price) || 0, line_total: itemTotal(it), sku: it.sku || null, product_ref: it.product_ref || null, sort_order: idx };
            payload[fk] = docId;
            return dbInsert(itemTbl, payload, userProfile && userProfile.id);
          });
        });
        return chain.then(function () { return docId; });
      });
    }).then(function (docId) {
      return logActivity(userProfile && userProfile.id, (editing === 'new' ? 'Created ' : 'Updated ') + (isInvoice() ? 'invoice ' : 'proforma ') + (hpayload.invoice_number || hpayload.proforma_number || docId) + ' (' + fmt(total) + ')', 'accounting_' + mode);
    }).then(function () { toast.success('Saved'); setEditing(null); load(); })
      .catch(function (e) { toast.error('Save failed: ' + (e && e.message)); })
      .finally(function () { setBusy(false); });
  }

  function setApproval(row, status) {
    if (status === 'approved' && !mayApprove) { toast.error('Only an Owner/Admin or Accounting Manager can approve invoices.'); return; }
    if (!mayEdit && status !== 'approved') { toast.error('No permission.'); return; }
    setBusy(true);
    var patch = { approval_status: status, updated_by: userProfile && userProfile.id };
    if (status === 'approved') { patch.approved_by = userProfile && userProfile.id; patch.approved_at = new Date().toISOString(); patch.ready_for_wave = true; }
    if (status !== 'approved') { patch.ready_for_wave = false; }
    dbUpdate('accounting_invoices', row.id, patch, userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Invoice ' + (row.invoice_number || row.id) + ' -> ' + status, 'accounting_invoices'); })
      .then(function () { toast.success('Invoice ' + status.replace('_', ' ')); load(); })
      .catch(function (e) { toast.error('Failed: ' + (e && e.message)); })
      .finally(function () { setBusy(false); });
  }
  function reopenInvoice(row) {
    if (!mayApprove) { toast.error('Only an Owner/Admin or Accounting Manager can reopen.'); return; }
    var reason = window.prompt('Reopen approved invoice for editing. Reason:') || '';
    if (!reason.trim()) { toast.error('Reason required.'); return; }
    setBusy(true);
    dbUpdate('accounting_invoices', row.id, { approval_status: 'internal_review', ready_for_wave: false, updated_by: userProfile && userProfile.id }, userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Reopened invoice ' + (row.invoice_number || row.id) + ' (' + reason.trim() + ')', 'accounting_invoices'); })
      .then(function () { toast.success('Reopened'); load(); })
      .catch(function (e) { toast.error('Failed: ' + (e && e.message)); })
      .finally(function () { setBusy(false); });
  }

  function convertProforma(row) {
    if (!mayEdit) { toast.error('No permission to convert.'); return; }
    if (row.status === 'converted') { toast.error('Already converted.'); return; }
    if (!window.confirm('Convert this proforma into a real invoice? This creates an invoice and locks the proforma as Converted.')) return;
    setBusy(true);
    supabase.from('accounting_proforma_items').select('*').eq('proforma_id', row.id).order('sort_order', { ascending: true })
      .then(function (r) {
        var its = (r && r.data) || [];
        var total = roundMoney(its.reduce(function (a, it) { return a + (Number(it.line_total) || 0); }, 0)) || Number(row.total_amount) || 0;
        var invPayload = { business_id: row.business_id || businessId, accounting_customer_id: row.accounting_customer_id, invoice_number: null, invoice_date: new Date().toISOString().substring(0, 10), due_date: null, notes: row.notes || null, terms: row.terms || null, total_amount: total, amount_paid: 0, balance_due: total, payment_status: 'unpaid', approval_status: 'draft', created_by: userProfile && userProfile.id };
        return dbInsert('accounting_invoices', invPayload, userProfile && userProfile.id).then(function (res) {
          var invId = res && res[0] ? res[0].id : (res && res.id);
          var chain = Promise.resolve();
          its.forEach(function (it, idx) {
            chain = chain.then(function () { return dbInsert('accounting_invoice_items', { business_id: row.business_id || businessId, invoice_id: invId, description: it.description, quantity: it.quantity, unit_price: it.unit_price, line_total: it.line_total, sku: it.sku, product_ref: it.product_ref, sort_order: idx }, userProfile && userProfile.id); });
          });
          return chain.then(function () {
            return dbUpdate('accounting_proformas', row.id, { status: 'converted', converted_invoice_id: invId, updated_by: userProfile && userProfile.id }, userProfile && userProfile.id);
          }).then(function () { return logActivity(userProfile && userProfile.id, 'Converted proforma ' + (row.proforma_number || row.id) + ' to invoice', 'accounting_proformas'); });
        });
      })
      .then(function () { toast.success('Converted to invoice'); setMode('invoices'); load(); })
      .catch(function (e) { toast.error('Convert failed: ' + (e && e.message)); })
      .finally(function () { setBusy(false); });
  }

  function printDoc(row) {
    var tbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var key = isInvoice() ? 'invoice_id' : 'proforma_id';
    supabase.from(tbl).select('*').eq(key, row.id).order('sort_order', { ascending: true }).then(function (r) {
      var its = (r && r.data) || [];
      var cust = customers.find(function (c) { return c.id === row.accounting_customer_id; }) || {};
      var title = isInvoice() ? 'INVOICE' : 'PROFORMA INVOICE';
      var num = isInvoice() ? (row.invoice_number || row.id) : (row.proforma_number || row.id);
      var d1 = isInvoice() ? row.invoice_date : row.proforma_date;
      var d2label = isInvoice() ? 'Due' : 'Valid until';
      var d2 = isInvoice() ? row.due_date : row.valid_until;
      var lines = its.map(function (it) { return '<tr><td>' + esc(it.description) + '</td><td class="r">' + esc(it.quantity) + '</td><td class="r">' + fmt(it.unit_price) + '</td><td class="r">' + fmt(it.line_total) + '</td></tr>'; }).join('');
      var total = its.reduce(function (a, it) { return a + (Number(it.line_total) || 0); }, 0);
      var html = '<html><head><title>' + esc(num) + '</title><style>'
        + 'body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:760px;margin:auto}'
        + 'h1{font-size:22px;margin:0}.muted{color:#555}.r{text-align:right}'
        + 'table{width:100%;border-collapse:collapse;margin-top:18px}'
        + 'th,td{border-bottom:1px solid #ddd;padding:8px;font-size:13px}th{background:#f4f4f4;text-align:left}'
        + '.tot{font-size:16px;font-weight:bold}.head{display:flex;justify-content:space-between}'
        + '.box{font-size:13px;line-height:1.5}.terms{margin-top:18px;font-size:12px;color:#444;white-space:pre-wrap}'
        + '</style></head><body>'
        + '<div class="head"><div><h1>' + esc(businessName) + '</h1></div>'
        + '<div class="r"><h1>' + title + '</h1><div class="muted">#' + esc(num) + '</div></div></div>'
        + '<div style="margin-top:18px" class="box"><b>Bill to:</b><br>' + esc(cust.company_name || '') + '<br>' + esc(cust.contact_name || '') + '<br>' + esc(cust.billing_address || '') + '<br>' + esc(cust.email || '') + '  ' + esc(cust.phone || '')
        + '<div class="muted" style="margin-top:8px">Date: ' + esc(d1 || '') + ' &nbsp; ' + d2label + ': ' + esc(d2 || '') + '</div></div>'
        + '<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Line total</th></tr></thead>'
        + '<tbody>' + lines + '</tbody>'
        + '<tfoot><tr><td colspan="3" class="r tot">Total</td><td class="r tot">' + fmt(total) + '</td></tr></tfoot></table>'
        + (row.notes ? '<div class="terms"><b>Notes:</b>\n' + esc(row.notes) + '</div>' : '')
        + (row.terms ? '<div class="terms"><b>Terms:</b>\n' + esc(row.terms) + '</div>' : '')
        + '<script>window.onload=function(){window.print();}<\/script></body></html>';
      var w = window.open('', '_blank');
      if (!w) { toast.error('Allow pop-ups to print/save the PDF.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    });
  }

  if (!mayView) return <div className="p-6"><div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 text-amber-950"><div className="font-extrabold">🔒 Restricted</div><div className="text-sm font-medium mt-1">Requires the Bank: View permission.</div></div></div>;
  if (loading) return <div className="p-6 text-slate-300">Loading…</div>;

  var liveTotal = docTotal(items);

  return (
    <div className="p-4 text-slate-100">
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          <button onClick={function () { setMode('invoices'); setEditing(null); }} className={'px-3 py-1.5 text-xs rounded font-bold ' + (isInvoice() ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300')}>Invoices</button>
          <button onClick={function () { setMode('proformas'); setEditing(null); }} className={'px-3 py-1.5 text-xs rounded font-bold ' + (!isInvoice() ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300')}>Proformas</button>
        </div>
        {mayEdit && <button onClick={startNew} className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded font-bold">+ New {isInvoice() ? 'invoice' : 'proforma'}</button>}
      </div>

      <div className="border border-slate-700 rounded overflow-hidden mb-4">
        <div className="bg-slate-800/70 text-[11px] font-extrabold grid" style={{ gridTemplateColumns: '110px 1fr 100px 110px 120px 150px' }}>
          <div className="px-2 py-1.5">Number</div><div className="px-2 py-1.5">Customer</div><div className="px-2 py-1.5 r text-right">Total</div><div className="px-2 py-1.5">{isInvoice() ? 'Balance' : 'Valid until'}</div><div className="px-2 py-1.5">Status</div><div className="px-2 py-1.5">Actions</div>
        </div>
        {rows.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No {isInvoice() ? 'invoices' : 'proformas'} yet.</div> :
          rows.map(function (row) {
            return (
              <div key={row.id} className="grid items-center border-t border-slate-800 hover:bg-slate-800/40" style={{ gridTemplateColumns: '110px 1fr 100px 110px 120px 150px' }}>
                <div className="px-2 py-1.5 text-xs font-mono text-slate-200 cursor-pointer" onClick={function () { startEdit(row); }}>{(isInvoice() ? row.invoice_number : row.proforma_number) || <span className="text-slate-500 italic">(none)</span>}</div>
                <div className="px-2 py-1.5 text-xs text-slate-100 truncate cursor-pointer" onClick={function () { startEdit(row); }}>{custName(row.accounting_customer_id)}</div>
                <div className="px-2 py-1.5 text-right text-xs font-mono font-bold">{fmt(row.total_amount)}</div>
                <div className="px-2 py-1.5 text-[11px] text-slate-300">{isInvoice() ? fmt(row.balance_due != null ? row.balance_due : row.total_amount) : (row.valid_until || '—')}</div>
                <div className="px-2 py-1.5"><span className={'text-[10px] px-1.5 py-0.5 rounded font-bold ' + statusColor(isInvoice() ? row.approval_status : row.status)}>{labelStatus(isInvoice() ? row.approval_status : row.status)}</span>{isInvoice() && row.ready_for_wave ? <span className="ml-1 text-[9px] bg-indigo-700 text-white rounded px-1">wave-ready</span> : null}</div>
                <div className="px-2 py-1.5 flex gap-1 flex-wrap">
                  <button onClick={function () { printDoc(row); }} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold" title="Opens your browser print dialog — choose Save as PDF">Print / Save PDF</button>
                  {isInvoice() && mayEdit && row.approval_status === 'draft' && <button onClick={function () { setApproval(row, 'internal_review'); }} disabled={busy} className="text-[10px] bg-amber-600 text-white rounded px-1.5 py-0.5 font-bold">Submit</button>}
                  {isInvoice() && row.approval_status === 'internal_review' && mayApprove && <button onClick={function () { setApproval(row, 'approved'); }} disabled={busy} className="text-[10px] bg-blue-700 text-white rounded px-1.5 py-0.5 font-bold">Approve</button>}
                  {isInvoice() && row.approval_status === 'approved' && mayApprove && <button onClick={function () { reopenInvoice(row); }} disabled={busy} className="text-[10px] bg-slate-700 text-white rounded px-1.5 py-0.5 font-bold">Reopen</button>}
                  {!isInvoice() && mayEdit && row.status !== 'converted' && <button onClick={function () { convertProforma(row); }} disabled={busy} className="text-[10px] bg-emerald-700 text-white rounded px-1.5 py-0.5 font-bold">Convert</button>}
                </div>
              </div>
            );
          })}
      </div>

      {editing && (
        <div className="border border-slate-700 rounded bg-slate-900/60 p-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="font-extrabold">{editing === 'new' ? 'New' : 'Edit'} {isInvoice() ? 'invoice' : 'proforma'}{editing !== 'new' && locked(editing) ? ' (approved — locked)' : ''}</div>
            <button onClick={function () { setEditing(null); }} className="text-slate-400 hover:text-slate-200 text-xs">✕ close</button>
          </div>
          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Accounting customer *</span>
              <MiniTypeahead items={customers} value={hdr.accounting_customer_id} disabled={locked(editing)} getLabel={function (c) { return c.company_name || c.contact_name || c.id; }} onPick={function (id) { uh('accounting_customer_id', id); }} placeholder="Search customer…" /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{isInvoice() ? 'Invoice #' : 'Proforma #'}</span><input value={(isInvoice() ? hdr.invoice_number : hdr.proforma_number) || ''} disabled={locked(editing)} onChange={function (e) { uh(isInvoice() ? 'invoice_number' : 'proforma_number', e.target.value); }} className={inp} /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{isInvoice() ? 'Invoice date' : 'Date'}</span><input type="date" value={(isInvoice() ? hdr.invoice_date : hdr.proforma_date) || ''} disabled={locked(editing)} onChange={function (e) { uh(isInvoice() ? 'invoice_date' : 'proforma_date', e.target.value); }} className={inp} /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{isInvoice() ? 'Due date' : 'Valid until'}</span><input type="date" value={(isInvoice() ? hdr.due_date : hdr.valid_until) || ''} disabled={locked(editing)} onChange={function (e) { uh(isInvoice() ? 'due_date' : 'valid_until', e.target.value); }} className={inp} /></label>
          </div>

          <div className="text-[11px] font-bold text-slate-200 mb-1">Line items</div>
          {items.map(function (it, i) {
            return (
              <div key={i} className="flex gap-1 mb-1 items-center">
                <input value={it.description} disabled={locked(editing)} onChange={function (e) { ui(i, 'description', e.target.value); }} placeholder="Description" className={inp + ' flex-1'} />
                <input value={it.quantity} disabled={locked(editing)} onChange={function (e) { ui(i, 'quantity', e.target.value); }} placeholder="Qty" className="w-16 bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-xs" />
                <input value={it.unit_price} disabled={locked(editing)} onChange={function (e) { ui(i, 'unit_price', e.target.value); }} placeholder="Unit" className="w-20 bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-xs" />
                <div className="w-24 text-right text-xs font-mono text-slate-200">{fmt(itemTotal(it))}</div>
                {!locked(editing) && <button onClick={function () { rmItem(i); }} className="text-rose-300 text-xs px-1 font-bold">✕</button>}
              </div>
            );
          })}
          {!locked(editing) && <button onClick={addItem} className="text-[11px] text-indigo-300 font-bold mb-2">+ add line</button>}
          <div className="text-right text-sm font-bold mb-2">Total: {fmt(liveTotal)}</div>

          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Notes</span><textarea rows={2} value={hdr.notes || ''} disabled={locked(editing)} onChange={function (e) { uh('notes', e.target.value); }} className={inp} /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Terms</span><textarea rows={2} value={hdr.terms || ''} disabled={locked(editing)} onChange={function (e) { uh('terms', e.target.value); }} className={inp} /></label>
          </div>
          {mayEdit && !locked(editing) && (
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={function () { setEditing(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-bold">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusColor(s) {
  if (s === 'approved') return 'bg-blue-700 text-white';
  if (s === 'internal_review') return 'bg-amber-600 text-white';
  if (s === 'converted') return 'bg-indigo-700 text-white';
  if (s === 'accepted') return 'bg-emerald-700 text-white';
  if (s === 'rejected') return 'bg-rose-700 text-white';
  if (s === 'sent') return 'bg-slate-600 text-white';
  return 'bg-slate-700 text-slate-200';
}
function labelStatus(s) { return String(s || 'draft').replace(/_/g, ' '); }
