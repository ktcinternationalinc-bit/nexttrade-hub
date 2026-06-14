// v55.83-AC — Accounting invoices + proformas (app-owned, accounting_customer_id only).
// Approval: draft -> internal_review -> approved (Owner/Admin/Accounting Manager).
// Proformas never touch balances until converted. Printable PDF via browser print.
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { scopeIfRegistered, getActiveWaveBusiness } from '../lib/wave-business';
import { canViewBank, canEditMappings, canReopen } from '../lib/bank-permissions';
import { roundMoney } from '../lib/payment-matching';
import { dbDelete } from '../lib/supabase';
import { invoiceLifecycle, proformaLifecycle, archivePatch, voidPatch, restorePatch } from '../lib/record-lifecycle';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function blankItem() { return { description: '', quantity: '1', unit_price: '0', sku: '', product_ref: '' }; }
function itemTotal(it) { return roundMoney((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)); }
function docTotal(items) { var t = 0; (items || []).forEach(function (it) { t += itemTotal(it); }); return roundMoney(t); }
function Field(props) { return <div><div className="text-[10px] text-slate-400 font-semibold">{props.label}</div><div className="text-slate-100 font-medium">{props.value}</div></div>; }
function Row(props) { return <div className={'flex justify-between py-0.5 ' + (props.bold ? 'font-extrabold text-slate-100 border-t border-slate-700 mt-0.5 pt-1' : 'text-slate-300')}><span>{props.k}</span><span className="font-mono">{props.v}</span></div>; }

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
  var [company, setCompany] = useState(null);
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [proformas, setProformas] = useState([]);
  var [pmCount, setPmCount] = useState({});
  var [showArchived, setShowArchived] = useState(false);
  var [search, setSearch] = useState('');
  var waveBiz = getActiveWaveBusiness() || '';
  var [waveReg, setWaveReg] = useState([]);
  useEffect(function () { fetchAllRows('wave_business_registry', '*').then(function (r) { setWaveReg((r && r.data) || []); }).catch(function () {}); }, []);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(false);

  var [editing, setEditing] = useState(null);     // null | 'new' | row
  var [hdr, setHdr] = useState({});
  var [items, setItems] = useState([blankItem()]);
  var [viewing, setViewing] = useState(null);
  var [viewItems, setViewItems] = useState([]);
  var [viewPayments, setViewPayments] = useState([]);
  var [viewLoading, setViewLoading] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('businesses').select('id,name').limit(1),
      supabase.from('accounting_customers').select('*').order('company_name', { ascending: true }),
      fetchAllRows('accounting_invoices', '*', 'created_at', false),
      fetchAllRows('accounting_proformas', '*', 'created_at', false),
      supabase.from('company_profile').select('*').limit(1),
      supabase.from('payment_matches').select('accounting_invoice_id').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      var b = (r[0] && r[0].data && r[0].data[0]) || null;
      if (b) { setBusinessId(b.id); if (b.name) setBusinessName(b.name); }
      setCustomers((r[1] && r[1].data) || []);
      setInvoices((r[2] && r[2].data) || []);
      setProformas((r[3] && r[3].data) || []); setCompany((r[4] && r[4].data && r[4].data[0]) || null);
      var pm = {}; ((r[5] && r[5].data) || []).forEach(function (row) { if (row && row.accounting_invoice_id) pm[row.accounting_invoice_id] = true; }); setPmCount(pm);
    }).catch(function (e) { console.error('[acctinv] load', e); toast.error('Failed to load'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  function custName(id) { var c = customers.find(function (x) { return x.id === id; }); return c ? (c.company_name || c.contact_name || id) : '—'; }
  function lcTbl() { return isInvoice() ? 'accounting_invoices' : 'accounting_proformas'; }
  function lcName(row) { return (isInvoice() ? row.invoice_number : row.proforma_number) || row.id; }
  function lcKind() { return isInvoice() ? 'invoice' : 'proforma'; }
  function lcRefresh() { setEditing(null); load(); }
  function doLcDelete(row) {
    if (!window.confirm('Permanently delete this ' + lcKind() + '? This CANNOT be undone.')) return;
    dbDelete(lcTbl(), row.id, userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Deleted ' + lcKind() + ' ' + lcName(row), 'accounting_invoices'); })
      .then(function () { toast.success('Deleted'); lcRefresh(); })
      .catch(function (e) { console.error('[lifecycle] delete', e); toast.error('Delete failed: ' + ((e && e.message) || 'error')); });
  }
  function doLcArchive(row) {
    if (!window.confirm('Archive this ' + lcKind() + '? It stays in the records (Wave link preserved) but is hidden from the active list.')) return;
    dbUpdate(lcTbl(), row.id, archivePatch(userProfile && userProfile.id), userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Archived ' + lcKind() + ' ' + lcName(row), 'accounting_invoices'); })
      .then(function () { toast.success('Archived'); lcRefresh(); })
      .catch(function (e) { console.error('[lifecycle] archive', e); toast.error('Archive failed: ' + ((e && e.message) || 'error')); });
  }
  function doLcVoid(row, kind) {
    var reason = window.prompt((kind === 'cancelled' ? 'Cancel' : 'Void') + ' reason (optional):', '');
    if (reason === null) return;
    dbUpdate(lcTbl(), row.id, voidPatch(userProfile && userProfile.id, kind, reason), userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, (kind === 'cancelled' ? 'Cancelled ' : 'Voided ') + lcKind() + ' ' + lcName(row) + (reason ? (' — ' + reason) : ''), 'accounting_invoices'); })
      .then(function () { toast.success(kind === 'cancelled' ? 'Cancelled' : 'Voided'); lcRefresh(); })
      .catch(function (e) { console.error('[lifecycle] void', e); toast.error('Failed: ' + ((e && e.message) || 'error')); });
  }
  function doLcRestore(row) {
    dbUpdate(lcTbl(), row.id, restorePatch(), userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Restored ' + lcKind() + ' ' + lcName(row), 'accounting_invoices'); })
      .then(function () { toast.success('Restored'); lcRefresh(); })
      .catch(function (e) { console.error('[lifecycle] restore', e); toast.error('Restore failed: ' + ((e && e.message) || 'error')); });
  }
  function isInvoice() { return mode === 'invoices'; }

  // v55.83-ED — ONE normalized status + ONE eligibility helper, used everywhere.
  function getInvStatus(row) { return String((row && row.approval_status) || 'draft').trim().toLowerCase(); }
  function invActions(row) {
    var st = getInvStatus(row);
    var isInv = isInvoice();
    return {
      status: st,
      canSubmit: isInv && mayEdit && st === 'draft',
      canApprove: isInv && (mayApprove || isSuperAdmin) && st === 'internal_review',
      canReopen: isInv && (mayApprove || isSuperAdmin) && st === 'approved',
      canEditInvoice: isInv && mayEdit && st !== 'approved'
    };
  }
  var rows = scopeIfRegistered((isInvoice() ? invoices : proformas), waveBiz, waveReg, true);
  var displayRows = rows
    .filter(function (r) { if (showArchived) return true; var st = r.record_status; return st !== 'archived' && st !== 'void' && st !== 'cancelled'; })
    .filter(function (r) {
      if (!search.trim()) return true;
      var qq = search.trim().toLowerCase();
      var numv = (isInvoice() ? r.invoice_number : r.proforma_number) || '';
      var cn = custName(r.accounting_customer_id) || '';
      var stat = (isInvoice() ? (r.approval_status || '') : (r.status || '')) + ' ' + (r.payment_status || '');
      var srcv = r.source === 'wave_import' ? 'wave' : 'hub';
      return (numv + ' ' + cn + ' ' + stat + ' ' + srcv).toLowerCase().indexOf(qq) >= 0;
    })
    .slice()
    .sort(function (a, b) {
      var da = (isInvoice() ? a.invoice_date : a.proforma_date) || '';
      var db = (isInvoice() ? b.invoice_date : b.proforma_date) || '';
      if (da < db) return 1; if (da > db) return -1; return 0;
    });
  var gcols = '92px minmax(140px,1fr) 82px 82px 92px 82px 90px 54px 98px 142px';

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
  function openView(row) {
    setViewing(row); setViewItems([]); setViewPayments([]); setViewLoading(true);
    var tbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var key = isInvoice() ? 'invoice_id' : 'proforma_id';
    var pItems = supabase.from(tbl).select('*').eq(key, row.id).order('sort_order', { ascending: true }).then(function (r) { return (r && r.data) || []; }).catch(function () { return []; });
    var pPays = isInvoice()
      ? supabase.from('accounting_invoice_payments').select('*').eq('accounting_invoice_id', row.id).order('payment_date', { ascending: true }).then(function (r) { return (r && r.data) || []; }).catch(function () { return []; })
      : Promise.resolve([]);
    Promise.all([pItems, pPays]).then(function (res) { setViewItems(res[0]); setViewPayments(res[1]); }).finally(function () { setViewLoading(false); });
  }
  function viewCalc() {
    var lineSum = 0;
    viewItems.forEach(function (it) {
      var lt = (it.line_total != null && Number(it.line_total) !== 0) ? Number(it.line_total) : (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
      lineSum += lt;
    });
    lineSum = roundMoney(lineSum);
    var docTot = (viewing && viewing.total_amount != null) ? roundMoney(Number(viewing.total_amount)) : lineSum;
    var adjustment = roundMoney(docTot - lineSum);
    var waveImported = viewing ? (Number(viewing.wave_imported_paid) || 0) : 0;
    var hubPaid = 0;
    viewPayments.forEach(function (p) { if (p.sync_status !== 'void') { hubPaid += Number(p.amount) || 0; } });
    hubPaid = roundMoney(hubPaid);
    var balance = (viewing && viewing.balance_due != null) ? Number(viewing.balance_due) : roundMoney(docTot - waveImported - hubPaid);
    return { lineSum: lineSum, docTot: docTot, adjustment: adjustment, waveImported: waveImported, hubPaid: hubPaid, balance: balance };
  }
  function uh(k, v) { var c = Object.assign({}, hdr); c[k] = v; setHdr(c); }
  function ui(i, k, v) { var c = items.slice(); c[i] = Object.assign({}, c[i]); c[i][k] = v; setItems(c); }
  function addItem() { setItems(items.concat([blankItem()])); }
  function rmItem(i) { var c = items.slice(); c.splice(i, 1); setItems(c.length ? c : [blankItem()]); }

  function locked(row) { return isInvoice() && getInvStatus(row) === 'approved'; }

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
      if (isInvoice()) { hpayload.approval_status = 'draft'; if (hpayload.payment_status == null) { hpayload.payment_status = 'unpaid'; } } // v55.83-EA — never leave status NULL
      if (waveBiz) { hpayload.wave_business_id = waveBiz; } // v55.83-DY — tag active silo
      if (!hpayload.source) { hpayload.source = 'hub'; }
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
      .catch(function (e) { console.error('[save] Save failed: ', e); toast.error('Save failed: ' + ((e && e.message) || 'unknown error — check console')); })
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
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }
  function reopenInvoice(row) {
    if (!mayApprove) { toast.error('Only an Owner/Admin or Accounting Manager can reopen.'); return; }
    var reason = window.prompt('Reopen approved invoice for editing. Reason:') || '';
    if (!reason.trim()) { toast.error('Reason required.'); return; }
    setBusy(true);
    var waveTouch = (row.source === 'wave_import' || row.wave_sync_status === 'synced');
    var rpatch = { approval_status: 'internal_review', ready_for_wave: false, updated_by: userProfile && userProfile.id };
    if (waveTouch) { rpatch.wave_sync_status = 'pending_sync'; }
    dbUpdate('accounting_invoices', row.id, rpatch, userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Reopened invoice ' + (row.invoice_number || row.id) + ' (' + reason.trim() + ')' + (waveTouch ? ' [marked pending Wave re-sync]' : ''), 'accounting_invoices'); })
      .then(function () {
        toast.success('Reopened — now editable' + (waveTouch ? ' (will need Wave re-sync)' : ''));
        load();
        var reopened = Object.assign({}, row, { approval_status: 'internal_review', ready_for_wave: false });
        if (waveTouch) { reopened.wave_sync_status = 'pending_sync'; }
        setViewing(null);
        startEdit(reopened);
      })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
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
        var invPayload = { business_id: row.business_id || businessId, wave_business_id: (row.wave_business_id || waveBiz || null), source: (row.source || 'hub'), accounting_customer_id: row.accounting_customer_id, invoice_number: null, invoice_date: new Date().toISOString().substring(0, 10), due_date: null, notes: row.notes || null, terms: row.terms || null, total_amount: total, amount_paid: 0, balance_due: total, payment_status: 'unpaid', approval_status: 'draft', created_by: userProfile && userProfile.id };
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
      .catch(function (e) { console.error('[save] Convert failed: ', e); toast.error('Convert failed: ' + ((e && e.message) || 'unknown error — check console')); })
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
      var lineSum = roundMoney(its.reduce(function (a, it) { return a + (Number(it.line_total) || 0); }, 0));
      // v55.83-BA — printed total must equal the imported Wave/stored total. If a
      // Wave-level discount made the stored total less than the line subtotal, show
      // a visible adjustment line so the print reconciles exactly.
      var docTot = row.total_amount != null ? roundMoney(Number(row.total_amount)) : lineSum;
      var adjustment = roundMoney(docTot - lineSum);
      var c = company || {};
      var paid = Number(row.amount_paid) || 0;
      var bal = row.balance_due != null ? Number(row.balance_due) : roundMoney(docTot - paid);
      var notes = row.notes || (isInvoice() ? (c.default_invoice_notes || '') : (c.default_proforma_notes || ''));
      var terms = row.terms || (c.default_payment_terms || '');
      var logoHtml = c.logo_data_url ? '<img src="' + c.logo_data_url + '" style="max-height:70px;max-width:200px;margin-bottom:6px"/>' : '';
      var compName = c.company_name || businessName;
      var compLines = [c.address, c.phone, c.email, c.website, (c.tax_id ? 'Tax ID: ' + c.tax_id : '')].filter(Boolean).map(esc).join('<br>');
      var paidRows = isInvoice() ? ('<tr><td colspan="3" class="r">Amount paid</td><td class="r">' + fmt(paid) + '</td></tr><tr><td colspan="3" class="r tot">Balance due</td><td class="r tot">' + fmt(bal) + '</td></tr>') : '';
      var html = '<html><head><title>' + esc(num) + '</title><style>'
        + 'body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:780px;margin:auto}'
        + 'h1{font-size:22px;margin:0}.muted{color:#555}.r{text-align:right}'
        + 'table{width:100%;border-collapse:collapse;margin-top:18px}'
        + 'th,td{border-bottom:1px solid #ddd;padding:8px;font-size:13px}th{background:#f4f4f4;text-align:left}'
        + '.tot{font-size:15px;font-weight:bold}.head{display:flex;justify-content:space-between;align-items:flex-start}'
        + '.box{font-size:13px;line-height:1.5}.terms{margin-top:14px;font-size:12px;color:#444;white-space:pre-wrap}'
        + '.sigwrap{display:flex;justify-content:space-between;margin-top:48px}.sig{width:45%}.sigline{border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:12px;color:#555}'
        + '</style></head><body>'
        + '<div class="head"><div>' + logoHtml + '<h1>' + esc(compName) + '</h1><div class="muted box">' + compLines + '</div></div>'
        + '<div class="r"><h1>' + title + '</h1><div class="muted">#' + esc(num) + '</div><div class="muted box" style="margin-top:8px">Date: ' + esc(d1 || '') + '<br>' + d2label + ': ' + esc(d2 || '') + '</div></div></div>'
        + '<div style="margin-top:18px" class="box"><b>Bill to:</b><br>' + esc(cust.company_name || '') + '<br>' + esc(cust.contact_name || '') + '<br>' + esc(cust.billing_address || '') + '<br>' + esc(cust.email || '') + '  ' + esc(cust.phone || '') + '</div>'
        + '<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Line total</th></tr></thead>'
        + '<tbody>' + lines + '</tbody>'
        + '<tfoot>'
        + (adjustment !== 0 ? ('<tr><td colspan="3" class="r">Subtotal</td><td class="r">' + fmt(lineSum) + '</td></tr><tr><td colspan="3" class="r">' + (adjustment < 0 ? 'Discount / adjustment' : 'Adjustment') + '</td><td class="r">' + fmt(adjustment) + '</td></tr>') : '')
        + '<tr><td colspan="3" class="r tot">Total</td><td class="r tot">' + fmt(docTot) + '</td></tr>' + paidRows + '</tfoot></table>'
        + (notes ? '<div class="terms"><b>Notes:</b>\n' + esc(notes) + '</div>' : '')
        + (terms ? '<div class="terms"><b>Terms:</b>\n' + esc(terms) + '</div>' : '')
        + '<div class="sigwrap"><div class="sig"><div class="sigline">Customer signature / date</div></div><div class="sig"><div class="sigline">Authorized signature (' + esc(compName) + ')</div></div></div>'
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
          <label className="text-xs text-slate-100 font-bold flex items-center gap-2 ml-2 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 cursor-pointer hover:bg-slate-700"><input type="checkbox" checked={showArchived} onChange={function (e) { setShowArchived(e.target.checked); }} /> Show archived/voided</label>
        </div>
        {mayEdit && <button onClick={startNew} className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded font-bold">+ New {isInvoice() ? 'invoice' : 'proforma'}</button>}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder={'Search ' + (isInvoice() ? 'invoices' : 'proformas') + ' — number, customer, status, Wave/Hub…'} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-slate-100 text-xs" style={{ width: '380px' }} />
        {search.trim() && <button onClick={function () { setSearch(''); }} className="text-[11px] text-slate-300 hover:text-white">clear</button>}
        <span className="text-[11px] text-slate-400">{displayRows.length} shown · newest first</span>
      </div>

      <div className="border border-slate-700 rounded mb-4" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: '1010px' }}>
          <div className="bg-slate-800 text-[11px] font-extrabold grid" style={{ gridTemplateColumns: gcols, position: 'sticky', top: 0, zIndex: 2 }}>
            <div className="px-2 py-1.5">Number</div><div className="px-2 py-1.5">Customer</div><div className="px-2 py-1.5">Inv date</div><div className="px-2 py-1.5">{isInvoice() ? 'Due date' : 'Valid until'}</div><div className="px-2 py-1.5 text-right">Total</div><div className="px-2 py-1.5 text-right">Paid</div><div className="px-2 py-1.5 text-right">Balance</div><div className="px-2 py-1.5">Source</div><div className="px-2 py-1.5">Status</div><div className="px-2 py-1.5">Actions</div>
          </div>
          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
          {displayRows.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No {isInvoice() ? 'invoices' : 'proformas'}{search.trim() ? ' match your search' : ' yet'}.</div> :
            displayRows.map(function (row) {
              return (
                <div key={row.id} className="grid items-center border-t border-slate-800 hover:bg-slate-800/40" style={{ gridTemplateColumns: gcols }}>
                  <div className="px-2 py-1.5 text-xs font-mono text-slate-200 cursor-pointer" onClick={function () { openView(row); }}>{(isInvoice() ? row.invoice_number : row.proforma_number) || <span className="text-slate-500 italic">(none)</span>}</div>
                  <div className="px-2 py-1.5 text-xs text-slate-100 truncate cursor-pointer" onClick={function () { openView(row); }}>{custName(row.accounting_customer_id)}</div>
                  <div className="px-2 py-1.5 text-[11px] text-slate-300">{(isInvoice() ? row.invoice_date : row.proforma_date) || '—'}</div>
                  <div className="px-2 py-1.5 text-[11px] text-slate-300">{(isInvoice() ? row.due_date : row.valid_until) || '—'}</div>
                  <div className="px-2 py-1.5 text-right text-xs font-mono font-bold">{fmt(row.total_amount)}</div>
                  <div className="px-2 py-1.5 text-right text-[11px] font-mono text-slate-300">{isInvoice() ? fmt(row.amount_paid) : '—'}</div>
                  <div className="px-2 py-1.5 text-right text-[11px] font-mono text-slate-200">{isInvoice() ? fmt(row.balance_due != null ? row.balance_due : row.total_amount) : '—'}</div>
                  <div className="px-2 py-1.5">{isInvoice() ? <span className={'text-[9px] rounded px-1 py-0.5 font-bold ' + (row.source === 'wave_import' ? 'bg-sky-700 text-white' : 'bg-emerald-700 text-white')}>{row.source === 'wave_import' ? 'Wave' : 'Hub'}</span> : '—'}</div>
                  <div className="px-2 py-1.5"><span className={'text-[10px] px-1.5 py-0.5 rounded font-bold ' + statusColor(isInvoice() ? row.approval_status : row.status)}>{labelStatus(isInvoice() ? row.approval_status : row.status)}</span>{row.record_status && row.record_status !== 'active' ? <span className="ml-1 text-[9px] bg-slate-600 text-white rounded px-1 font-bold">{String(row.record_status).toUpperCase()}</span> : null}</div>
                  <div className="px-2 py-1.5 flex gap-1 flex-wrap">
                    <button onClick={function () { openView(row); }} className="text-[10px] bg-sky-700 hover:bg-sky-600 text-white rounded px-1.5 py-0.5 font-bold">View</button>
                    <button onClick={function () { printDoc(row); }} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold" title="Print / Save PDF">Print</button>
                    {isInvoice() && invActions(row).canSubmit && <button onClick={function () { setApproval(row, 'internal_review'); }} disabled={busy} className="text-[10px] bg-amber-600 text-white rounded px-1.5 py-0.5 font-bold">Submit</button>}
                    {isInvoice() && invActions(row).canApprove && <button onClick={function () { setApproval(row, 'approved'); }} disabled={busy} className="text-[10px] bg-blue-700 text-white rounded px-1.5 py-0.5 font-bold">Approve</button>}
                    {isInvoice() && invActions(row).canReopen && <button onClick={function () { reopenInvoice(row); }} disabled={busy} className="text-[10px] bg-slate-700 text-white rounded px-1.5 py-0.5 font-bold">Reopen</button>}
                    {isSuperAdmin && isInvoice() && <span className="text-[9px] text-amber-300 font-mono w-full mt-0.5">DBG raw={String(row.approval_status)} norm={getInvStatus(row)} edit={String(mayEdit)} appr={String(mayApprove)} sub={String(invActions(row).canSubmit)} app={String(invActions(row).canApprove)} lock={String(locked(row))}</span>}
                    {!isInvoice() && mayEdit && row.status !== 'converted' && <button onClick={function () { convertProforma(row); }} disabled={busy} className="text-[10px] bg-emerald-700 text-white rounded px-1.5 py-0.5 font-bold">Convert</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {viewing && (function () {
        var vc = viewCalc();
        var src = viewing.source === 'wave_import' ? 'Wave import' : 'Hub-created';
        var editable = isInvoice() ? (viewing.approval_status !== 'approved') : (viewing.status !== 'converted');
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px' }} onClick={function () { setViewing(null); }}>
            <div className="bg-slate-900 border border-slate-600 rounded-xl w-full" style={{ maxWidth: '840px' }} onClick={function (e) { e.stopPropagation(); }}>
              <div className="flex items-center justify-between p-3 border-b border-slate-700">
                <div className="font-extrabold text-slate-100">View {isInvoice() ? 'invoice' : 'proforma'} · {(isInvoice() ? viewing.invoice_number : viewing.proforma_number) || '(no number)'} <span className="text-[10px] text-slate-400 font-medium">(read-only)</span></div>
                <div className="flex gap-1 flex-wrap">
                  <button onClick={function () { printDoc(viewing); }} className="text-[11px] bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-1 font-bold">Print / Save PDF</button>
                  {isInvoice() && mayEdit && (viewing.approval_status || 'draft') === 'draft' && <button onClick={function () { var row = viewing; setApproval(row, 'internal_review'); setViewing(null); }} disabled={busy} className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1 font-bold">Submit for Review</button>}
                  {isInvoice() && mayApprove && viewing.approval_status === 'internal_review' && <button onClick={function () { var row = viewing; setApproval(row, 'approved'); setViewing(null); }} disabled={busy} className="text-[11px] bg-blue-700 hover:bg-blue-600 text-white rounded px-2 py-1 font-bold">Approve</button>}
                  {isInvoice() && mayApprove && viewing.approval_status === 'approved' && <button onClick={function () { var row = viewing; reopenInvoice(row); }} disabled={busy} className="text-[11px] bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-1 font-bold">Reopen</button>}
                  {editable && mayEdit && <button onClick={function () { var row = viewing; setViewing(null); startEdit(row); }} className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1 font-bold">Edit</button>}
                  <button onClick={function () { setViewing(null); }} className="text-slate-300 hover:text-white text-sm px-2">✕</button>
                </div>
              </div>
              <div className="p-3 text-slate-100 text-xs">
                <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <Field label="Customer" value={custName(viewing.accounting_customer_id)} />
                  <Field label={isInvoice() ? 'Invoice date' : 'Date'} value={(isInvoice() ? viewing.invoice_date : viewing.proforma_date) || '—'} />
                  <Field label={isInvoice() ? 'Due date' : 'Valid until'} value={(isInvoice() ? viewing.due_date : viewing.valid_until) || '—'} />
                  <Field label="Status" value={labelStatus(isInvoice() ? viewing.approval_status : viewing.status) + (viewing.payment_status ? ' · ' + viewing.payment_status : '')} />
                  <Field label="Source" value={src + (viewing.is_historical ? ' · historical' : '')} />
                  {isInvoice() && <Field label="Wave sync" value={viewing.wave_sync_status || '—'} />}
                </div>

                <div className="text-[11px] font-bold text-slate-300 mb-1 border-b border-slate-700 pb-0.5">Line items</div>
                {viewLoading ? <div className="text-slate-400 italic py-2">Loading…</div> : (
                  <table className="w-full mb-2"><thead><tr className="text-slate-400 text-left"><th className="py-1">Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Line total</th></tr></thead>
                    <tbody>{viewItems.length === 0 ? <tr><td colSpan={4} className="text-slate-500 italic py-1">No line items.</td></tr> : viewItems.map(function (it, i) {
                      var lt = (it.line_total != null && Number(it.line_total) !== 0) ? Number(it.line_total) : (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
                      return <tr key={i} className="border-t border-slate-800"><td className="py-1">{it.description || (it.product_ref || '')}</td><td className="text-right">{it.quantity}</td><td className="text-right font-mono">{fmt(it.unit_price)}</td><td className="text-right font-mono">{fmt(lt)}</td></tr>;
                    })}</tbody>
                  </table>
                )}

                <div className="flex justify-end"><div style={{ minWidth: '280px' }}>
                  {vc.adjustment !== 0 && <Row k="Subtotal" v={fmt(vc.lineSum)} />}
                  {vc.adjustment !== 0 && <Row k={vc.adjustment < 0 ? 'Discount / adjustment' : 'Adjustment'} v={fmt(vc.adjustment)} />}
                  <Row k="Total" v={fmt(vc.docTot)} bold={true} />
                  {isInvoice() && <Row k="Wave imported paid" v={fmt(vc.waveImported)} />}
                  {isInvoice() && <Row k="Hub / Plaid matched paid" v={fmt(vc.hubPaid)} />}
                  {isInvoice() && <Row k="Balance due" v={fmt(vc.balance)} bold={true} />}
                </div></div>

                {isInvoice() && (
                  <div className="mt-3">
                    <div className="text-[11px] font-bold text-slate-300 mb-1 border-b border-slate-700 pb-0.5">Payment history</div>
                    {viewPayments.length === 0 ? <div className="text-slate-400 italic">No bank-matched payments. {vc.waveImported > 0 ? 'Wave-imported paid (' + fmt(vc.waveImported) + ') is an aggregate from Wave — individual historical dates are not exposed by Wave\u2019s API.' : ''}</div> :
                      <table className="w-full"><thead><tr className="text-slate-400 text-left"><th className="py-1">Date</th><th className="text-right">Amount</th><th>Source</th><th>Wave sync</th></tr></thead>
                        <tbody>{viewPayments.map(function (p) {
                          return <tr key={p.id} className="border-t border-slate-800"><td className="py-1">{p.payment_date || '—'}</td><td className="text-right font-mono">{fmt(p.amount)}</td><td>{p.source || ''}</td><td>{p.sync_status === 'synced' ? <span className="text-emerald-400">synced</span> : p.sync_status === 'failed' ? <span className="text-rose-400">failed</span> : <span className="text-amber-400">pending Wave sync</span>}</td></tr>;
                        })}</tbody>
                      </table>}
                  </div>
                )}

                {viewing.notes && <div className="mt-3 bg-slate-800 rounded p-2 text-slate-200"><span className="font-bold">Notes:</span> {viewing.notes}</div>}
              </div>
            </div>
          </div>
        );
      })()}

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
            <div className="flex gap-2 flex-wrap">
              <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={function () { setEditing(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-bold">Cancel</button>
              {isInvoice() && editing !== 'new' && invActions(editing).canSubmit && <button onClick={function () { var row = editing; setApproval(row, 'internal_review'); }} disabled={busy} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold">Submit for Review</button>}
              {isInvoice() && editing !== 'new' && invActions(editing).canApprove && <button onClick={function () { var row = editing; setApproval(row, 'approved'); }} disabled={busy} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold">Approve</button>}
              {isSuperAdmin && isInvoice() && editing !== 'new' && <span className="text-[10px] text-amber-300 font-mono w-full">DBG raw={String(editing.approval_status)} norm={getInvStatus(editing)} edit={String(mayEdit)} appr={String(mayApprove)} locked={String(locked(editing))} sub={String(invActions(editing).canSubmit)} app={String(invActions(editing).canApprove)}</span>}
            </div>
          )}
          {mayEdit && editing !== 'new' && (function () {
            var lc = isInvoice() ? invoiceLifecycle(editing, { paymentMatchCount: pmCount[editing.id] ? 1 : 0 }, userProfile && userProfile.role) : proformaLifecycle(editing, userProfile && userProfile.role);
            return (
              <div className="flex gap-2 mt-2 flex-wrap items-center border-t border-slate-700 pt-2">
                {editing.record_status && editing.record_status !== 'active' && <span className="text-[11px] bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold">{String(editing.record_status).toUpperCase()}</span>}
                {lc.canHardDelete && <button onClick={function () { doLcDelete(editing); }} className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-bold">Delete</button>}
                {lc.canVoid && <button onClick={function () { doLcVoid(editing, 'void'); }} className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded text-xs font-bold">Void</button>}
                {lc.canCancel && <button onClick={function () { doLcVoid(editing, 'cancelled'); }} className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded text-xs font-bold">Mark cancelled</button>}
                {lc.canArchive && <button onClick={function () { doLcArchive(editing); }} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold">Archive</button>}
                {lc.canRestore && <button onClick={function () { doLcRestore(editing); }} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">Restore</button>}
                {!lc.canHardDelete && lc.blockReason && <span className="text-[11px] text-amber-300 font-semibold">{lc.blockReason}</span>}
              </div>
            );
          })()}
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
