// v55.83-AC — Accounting invoices + proformas (app-owned, accounting_customer_id only).
// Approval: draft -> internal_review -> approved (Owner/Admin/Accounting Manager).
// Proformas never touch balances until converted. Printable PDF via browser print.
import { useState, useEffect } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { floorDateFor, labelForWindow } from '../lib/visibility-window';
import { scopeIfRegistered, getActiveWaveBusiness } from '../lib/wave-business';
import { businessOfInvoice } from '../lib/business-of';
import { canViewInvoices, canCreateInvoice, canReopen } from '../lib/bank-permissions';
import { roundMoney, isPaymentVoid } from '../lib/payment-matching';
import { canDeleteInvoices, INVOICE_DELETE_DENIED } from '../lib/invoice-delete-access'; // v55.83-UM
import { hubFetch } from '../lib/hub-fetch'; // v55.83-UM — signed-in token on lifecycle calls
import { dbDelete } from '../lib/supabase';
import { invoiceLifecycle, proformaLifecycle, archivePatch, voidPatch, restorePatch } from '../lib/record-lifecycle';
import { SHIPPING_TERMS, SHIPPING_TERMS_WORDS, checkShippingTerms, minShippingCharge, MARKUP_NOTE_MIN, fillShippingLine, autoShippingLine } from '../lib/shipping-terms'; // v55.83-TG (+ XV)
import { isTransportLine } from '../lib/profitability'; // v55.83-TG
import ProformaLinkBox, { proformaLinksApi } from './ProformaLinkBox'; // v55.83-VZ — proforma ↔ invoice links + signed proforma
import ProformaPeek from './ProformaPeek';
import InvoicePeek from './InvoicePeek';
import CustomsInvoiceBox from './CustomsInvoiceBox'; // v55.83-XD — customs invoice saved under an invoice (counted nowhere)
import ShippingPartsBox from './ShippingPartsBox'; // v55.83-WH — internal breakdown of the shipping (never printed)

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function blankItem() { return { description: '', quantity: '1', unit_price: '0', sku: '', product_ref: '', wave_product_id: '', wave_product_name: '' }; }
function itemTotal(it) { return roundMoney((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)); }
function docTotal(items) { var t = 0; (items || []).forEach(function (it) { t += itemTotal(it); }); return roundMoney(t); }
function Field(props) { return <div><div className="text-[10px] text-slate-400 font-semibold">{props.label}</div><div className="text-slate-100 font-medium">{props.value}</div></div>; }
function Row(props) { return <div className={'flex justify-between py-0.5 ' + (props.bold ? 'font-extrabold text-slate-100 border-t border-slate-700 mt-0.5 pt-1' : 'text-slate-300')}><span>{props.k}</span><span className="font-mono">{props.v}</span></div>; }

function MiniTypeahead(props) {
  var items = props.items || [];
  var st = useState(''); var q = st[0]; var setQ = st[1];
  var os = useState(false); var open = os[0]; var setOpen = os[1];
  var getLabel = props.getLabel; var sel = items.find(function (x) { return x.id === props.value; });
  var matched = (q.trim() ? items.filter(function (x) { return getLabel(x).toLowerCase().indexOf(q.trim().toLowerCase()) >= 0; }) : items);
  var shown = matched.slice(0, 50);
  var moreCount = matched.length - shown.length;
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
          {moreCount > 0 && <div className="px-2 py-1 text-[10px] text-amber-300 italic border-t border-slate-700">+{moreCount} more — keep typing to narrow</div>}
        </div>
      )}
    </div>
  );
}

var inp = 'w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs';

export default function AccountingInvoicesTab(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  // v55.83-OD — click-to-edit release editor (button cell, cannot lose the click)
  var rs1 = useState(null); var relEditId = rs1[0]; var setRelEditId = rs1[1];
  var rs2 = useState(''); var relDraft = rs2[0]; var setRelDraft = rs2[1];
  var rs3 = useState(0); var relBump = rs3[0]; var setRelBump = rs3[1];
  var rs4 = useState(''); var relErr = rs4[0]; var setRelErr = rs4[1];
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};

  // v55.83-HR (Codex P0) — Invoices/Proformas are DOCUMENT screens; gate on invoice.view /
  // invoice.create, NOT bank.view. A user can work invoices without seeing bank transactions.
  var _role = userProfile && userProfile.role;
  var mayView = canViewInvoices(isSuperAdmin, modulePerms, _role);
  var mayEdit = canCreateInvoice(isSuperAdmin, modulePerms, _role);
  var mayApprove = canReopen(isSuperAdmin, modulePerms, userProfile && userProfile.role); // Owner/Admin/Accounting Mgr
  // v55.83-UM — delete / void / cancel / archive / restore: the super admin, or the “Delete / void invoices 🔒” switch ON (no role gives it)
  var mayLifecycle = canDeleteInvoices(isSuperAdmin, modulePerms);

  var [mode, setMode] = useState(props.defaultMode || 'invoices');     // invoices | proformas
  var [businessId, setBusinessId] = useState(null);
  var [businessName, setBusinessName] = useState('KTC International Inc.');
  var [company, setCompany] = useState(null);
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [proformas, setProformas] = useState([]);
  var [waveProducts, setWaveProducts] = useState([]); // v55.83-IY — per-silo Wave product catalog for per-line selection
  var [pmCount, setPmCount] = useState({});
  var [hubPaidMap, setHubPaidMap] = useState({});
  var [showArchived, setShowArchived] = useState(false);
  var [search, setSearch] = useState('');
  // v55.83-OS (Max): the invoice list opens on the US business ONLY — Wave-
  // bound invoices (in Wave or pending push). Egypt is its own chip.
  var [bizFilter, setBizFilter] = useState('US');
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
  var [visCfg, setVisCfg] = useState({ window: 'all', customDays: null, customFrom: null }); // v55.83-JL admin visibility window
  // v55.83-VZ — the small marks on the lists (which invoice has a proforma; which proforma has invoices / a signed copy) and the two pop-ups
  var [linkMap, setLinkMap] = useState({ by_invoice: {}, by_proforma: {} });
  var [peekInv, setPeekInv] = useState(null);
  var [peekPf, setPeekPf] = useState(null);
  function loadLinkMap() {
    proformaLinksApi({ action: 'map' }).then(function (j) { setLinkMap({ by_invoice: j.by_invoice || {}, by_proforma: j.by_proforma || {} }); }).catch(function () { /* the lists work without the marks */ });
  }
  function openPeekInvoice(id) { setPeekPf(null); setPeekInv(id); }
  function openPeekProforma(id) { setPeekInv(null); setPeekPf(id); }

  async function load() {
    setLoading(true);
    // v55.83-JL — admin history-visibility floor. Apply at the QUERY (not fetch-then-hide) so older
    // rows never enter non-super-admin state. invoices floor on invoice_date, proformas on proforma_date.
    var _floor = null;
    try {
      var _vr = await fetch('/api/admin/visibility').then(function (x) { return x.json(); }).catch(function () { return null; });
      if (_vr && _vr.value) { setVisCfg(_vr.value); _floor = floorDateFor({ window: _vr.value.window, customDays: _vr.value.customDays, customFrom: _vr.value.customFrom, isSuperAdmin: isSuperAdmin }, new Date()); }
    } catch (eVis) {}
    var _invFloor = _floor ? { col: 'invoice_date', value: _floor } : null;
    var _proFloor = _floor ? { col: 'proforma_date', value: _floor } : null;
    Promise.all([
      supabase.from('businesses').select('id,name').limit(1),
      supabase.from('accounting_customers').select('*').order('company_name', { ascending: true }),
      fetchAllRows('accounting_invoices', '*', 'created_at', false, _invFloor),
      fetchAllRows('accounting_proformas', '*', 'created_at', false, _proFloor),
      supabase.from('company_profile').select('*').limit(1),
      supabase.from('payment_matches').select('invoice_id, voided').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('wave_products').select('wave_business_id, wave_product_id, name, description, is_archived').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
    ]).then(async function (r) {
      setWaveProducts((r[6] && r[6].data) || []);
      var b = (r[0] && r[0].data && r[0].data[0]) || null;
      if (b) { setBusinessId(b.id); if (b.name) setBusinessName(b.name); }
      setCustomers((r[1] && r[1].data) || []);
      var invRows = (r[2] && r[2].data) || [];
      setInvoices(invRows);
      setProformas((r[3] && r[3].data) || []); setCompany((r[4] && r[4].data && r[4].data[0]) || null);
      var pm = {}; ((r[5] && r[5].data) || []).forEach(function (row) { if (row && row.invoice_id && row.voided !== true) pm[row.invoice_id] = true; }); setPmCount(pm);
      // v55.83-JL/JM — payment rows: when a visibility floor is active (non-super-admin), DON'T load
      // all-history payments into state. Scope them to the in-window invoice ids (chunked .in). A
      // super-admin (no floor) keeps the full fetch since they see everything anyway.
      var payRows = [];
      if (_floor) {
        var invIds = invRows.map(function (i) { return i.id; }).filter(Boolean);
        var CH = 200; var ci;
        for (ci = 0; ci < invIds.length; ci += CH) {
          var chunk = invIds.slice(ci, ci + CH);
          var prc = await supabase.from('accounting_invoice_payments').select('accounting_invoice_id, amount, voided, sync_status').in('accounting_invoice_id', chunk).then(function (x) { return x; }).catch(function () { return { data: [] }; });
          if (prc && prc.data) { payRows = payRows.concat(prc.data); }
        }
      } else {
        var allPr = await fetchAllRows('accounting_invoice_payments', 'accounting_invoice_id, amount, voided, sync_status').then(function (x) { return x; }).catch(function () { return { data: [] }; });
        payRows = (allPr && allPr.data) || [];
      }
      var paidMap = {};
      payRows.forEach(function (p) {
        if (!p || !p.accounting_invoice_id) { return; }
        if (isPaymentVoid(p)) { return; }
        paidMap[p.accounting_invoice_id] = (paidMap[p.accounting_invoice_id] || 0) + (Number(p.amount) || 0);
      });
      setHubPaidMap(paidMap);
    }).catch(function (e) { console.error('[acctinv] load', e); toast.error('Failed to load'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) { load(); loadLinkMap(); } else setLoading(false); }, []);

  function custName(id) { var c = customers.find(function (x) { return x.id === id; }); return c ? (c.company_name || c.contact_name || id) : '—'; }
  function lcTbl() { return isInvoice() ? 'accounting_invoices' : 'accounting_proformas'; }
  function lcName(row) { return (isInvoice() ? row.invoice_number : row.proforma_number) || row.id; }
  function lcKind() { return isInvoice() ? 'invoice' : 'proforma'; }
  function lcRefresh() { setEditing(null); load(); }
  // v55.83-QM (Max 15:17: "tried to delete an invoice and it was not removed
  // and remained on all transactions") — deleting an invoice RELEASES its
  // bank matches: its payments are voided (never hard-deleted) and the
  // deposits reopen as unmatched, so All Transactions reflects it instantly.
  function releaseBankMatches(invoiceId) {
    return supabase.from('accounting_invoice_payments')
      .update({ voided: true })
      .eq('accounting_invoice_id', invoiceId).not('bank_transaction_id', 'is', null).neq('voided', true)
      .select('bank_transaction_id')
      .then(function (r0) {
        var txIds = []; ((r0 && r0.data) || []).forEach(function (p0) { if (p0.bank_transaction_id && txIds.indexOf(p0.bank_transaction_id) < 0) { txIds.push(p0.bank_transaction_id); } });
        return supabase.from('bank_transactions')
          .update({ matched_invoice_id: null, review_status: 'unreviewed' })
          .eq('matched_invoice_id', invoiceId)
          .then(function () {
            // v55.83-QZ2 (review fix) — a deposit SPLIT across several invoices
            // points its matched_invoice_id at only one of them; every deposit
            // that just lost a payment re-opens (it is no longer fully placed).
            if (!txIds.length) { return null; }
            return supabase.from('bank_transactions').update({ review_status: 'unreviewed' })
              .in('id', txIds).in('review_status', ['reviewed', 'approved']);
          })
          .then(function () { return txIds.length; });
      }).catch(function () { return 0; });
  }
  // v55.83-UM — every lifecycle change goes through the server, which checks the person and the record again
  function lcServer(action, row, reason) {
    return hubFetch('/api/accounting/invoice-lifecycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userProfile && userProfile.id, action: action, kind: lcKind(), id: row.id, reason: reason || null }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .then(function (j) { if (!j || !j.ok) { throw new Error((j && j.error) || 'Not saved.'); } return j; });
  }
  function doLcDelete(row) {
    if (!window.confirm('Permanently delete this ' + lcKind() + '? This CANNOT be undone.\n\nAny bank deposits matched to it are RELEASED back to unmatched (their payments voided, never deleted).')) return;
    lcServer('delete', row).then(function (j) {
      if (j.released > 0) { toast.success(j.released + ' bank match(es) released back to unmatched.'); }
      return logActivity(userProfile && userProfile.id, 'Deleted ' + lcKind() + ' ' + lcName(row), 'accounting_invoices').then(function () { toast.success('Deleted'); lcRefresh(); });
    }).catch(function (e) { toast.error('Delete failed: ' + ((e && e.message) || 'error')); });
  }
  // v55.83-NC (Max Aug 11) — "Can we actually delete an invoice from the
  // accounting side that will then delete from wave". A Wave-linked invoice is
  // (rightly) blocked from the plain lifecycle Delete; this path deletes the
  // Wave copy FIRST via /api/wave/delete-invoice, then the Hub record. Wave
  // refusal stops everything with nothing changed. Wave-pushed payments block
  // server-side; Hub-only payments need a second acknowledgement.
  function deleteWithWave(row, ackHubPayments) {
    if (!mayLifecycle) { toast.error(INVOICE_DELETE_DENIED); return; }
    var sure = window.confirm(
      'PERMANENTLY delete invoice ' + (row.invoice_number || row.id) + '?\n\n' +
      (row.wave_invoice_id ? 'Its Wave copy will be deleted FIRST — if Wave refuses, nothing is deleted anywhere.\n' : '') +
      'This CANNOT be undone.');
    if (!sure) { return; }
    setBusy(true);
    // v55.83-UM (Codex 21:35 P1) — nothing is changed here before the server answers: the server releases the bank lines itself,
    // in the same locked step as the Hub delete, and only after Wave confirmed its copy is gone
    hubFetch('/api/wave/delete-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: row.id, confirm_delete: true, user_id: (userProfile && userProfile.id) || null }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok === true) {
          toast.success('Invoice ' + (j.invoice_number || '') + ' deleted' + (j.deleted_in_wave ? ' from Wave and the Hub' : ' from the Hub') + (j.released_bank_lines ? ' · ' + j.released_bank_lines + ' bank line(s) back to review' : ''));
          logActivity(userProfile && userProfile.id, 'Deleted invoice ' + (row.invoice_number || row.id) + (j.deleted_in_wave ? ' (Wave copy deleted too)' : ''), 'accounting_invoices');
          setEditing(null); setViewing(null); load();
          return;
        }
        // v55.83-UM — payments are never deleted: an invoice with payment records is refused (void or archive it); no second confirm
        toast.error('Delete stopped: ' + (j.error || ('HTTP ' + res.status)));
      })
      .catch(function (e) { toast.error('Delete failed: ' + ((e && e.message) || 'network error')); })
      .finally(function () { setBusy(false); });
  }
  function doLcArchive(row) {
    if (!window.confirm('Archive this ' + lcKind() + '? It stays in the records (Wave link preserved) but is hidden from the active list.')) return;
    lcServer('archive', row)
      .then(function () { return logActivity(userProfile && userProfile.id, 'Archived ' + lcKind() + ' ' + lcName(row), 'accounting_invoices'); })
      .then(function () { toast.success('Archived'); lcRefresh(); })
      .catch(function (e) { console.error('[lifecycle] archive', e); toast.error('Archive failed: ' + ((e && e.message) || 'error')); });
  }
  function doLcVoid(row, kind) {
    var reason = window.prompt((kind === 'cancelled' ? 'Cancel' : 'Void') + ' reason (optional):', '');
    if (reason === null) return;
    lcServer(kind === 'cancelled' ? 'cancel' : 'void', row, reason)
      .then(function () { return logActivity(userProfile && userProfile.id, (kind === 'cancelled' ? 'Cancelled ' : 'Voided ') + lcKind() + ' ' + lcName(row) + (reason ? (' — ' + reason) : ''), 'accounting_invoices'); })
      .then(function () { toast.success(kind === 'cancelled' ? 'Cancelled' : 'Voided'); lcRefresh(); })
      .catch(function (e) { console.error('[lifecycle] void', e); toast.error('Failed: ' + ((e && e.message) || 'error')); });
  }
  function doLcRestore(row) {
    lcServer('restore', row)
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
      canEditInvoice: isInv && mayEdit && st !== 'approved',
      // v55.83-NA — "Update in Wave" appears when this Hub-authored invoice has a
      // Wave copy AND was reopened+edited after syncing (pending_sync). Only
      // approvers see it: the flow re-approves and then deletes+recreates in
      // Wave, both privileged actions. Wave-imported invoices are excluded —
      // the Hub never deletes a Wave-authored invoice (server enforces too).
      canUpdateWave: isInv && (mayApprove || isSuperAdmin)
        && !!row.wave_invoice_id
        && row.source !== 'wave_import'
        && row.wave_sync_status === 'pending_sync'
    };
  }
  var rows = scopeIfRegistered((isInvoice() ? invoices : proformas), waveBiz, waveReg, true);
  // v55.83-EI — the customer picker must only offer customers in the ACTIVE silo,
  // so an invoice can never be linked to a wrong-/cross-silo customer.
  var scopedCustomers = scopeIfRegistered(customers, waveBiz, waveReg, true);
  var custTagByIdOS = {};
  customers.forEach(function (c) { if (c && c.business_tag) { custTagByIdOS[c.id] = c.business_tag; } });
  var displayRows = rows
    .filter(function (r) { if (!isInvoice()) { return true; } if (bizFilter === 'ALL') { return true; } return businessOfInvoice(r, custTagByIdOS) === bizFilter; }) // OS: US book by default
    .filter(function (r) { if (showArchived) return true; var st = r.record_status; return st !== 'archived' && st !== 'void' && st !== 'cancelled'; })
    .filter(function (r) {
      if (!search.trim()) return true;
      var qq = search.trim().toLowerCase();
      var numv = ((isInvoice() ? r.invoice_number : r.proforma_number) || '') + ' ' + (r.release_number || ''); // NO: release # searchable
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
  // v55.83-NT — Release # inline column (Max: enter it right from the invoice list)
  var gcols = '92px 96px minmax(140px,1fr) 82px 82px 92px 82px 90px 54px 98px 142px';

  function startNew() {
    var today = new Date().toISOString().substring(0, 10);
    if (isInvoice()) setHdr({ invoice_number: '', release_number: '', accounting_customer_id: '', invoice_date: today, due_date: '', notes: '', terms: '', shipping_terms: '', shipping_cost_estimate: '' });
    else setHdr({ proforma_number: '', accounting_customer_id: '', proforma_date: today, valid_until: '', notes: '', terms: '' });
    setItems([blankItem()]); setEditing('new');
  }
  // v55.83-PQ (Max, 05:13): "upload invoices and from invoices it will create
  // the invoice based on data and show on both systems" — the reader proposes,
  // the HUMAN confirms in this same editor, the save flows to Wave + ClickBooks
  // like any hand-entered invoice.
  function importInvoiceFile(file) {
    if (!file) { return; }
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result || '').split(',')[1] || '';
      setBusy(true);
      toast.success('Reading the invoice…');
      hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract_invoice', invoice_id: 'n/a', file_base64: b64, media_type: file.type, user_id: userProfile && userProfile.id }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!(j && j.ok && j.draft)) { toast.error((j && j.error) || 'Could not read the invoice.'); return; }
          var d2 = j.draft;
          var today2 = new Date().toISOString().substring(0, 10);
          var pickedCust = '';
          var cands = j.customer_candidates || [];
          if (cands.length > 0 && cands[0].score >= 0.99) { pickedCust = cands[0].id; } // exact-ish match only; otherwise the human picks
          setHdr({ invoice_number: d2.invoice_number || '', release_number: '', accounting_customer_id: pickedCust,
            invoice_date: d2.invoice_date || today2, due_date: d2.due_date || '',
            notes: (d2.notes || '') + (d2.customer_name && !pickedCust ? ((d2.notes ? ' · ' : '') + 'Document says customer: ' + d2.customer_name) : ''), terms: '', shipping_terms: '', shipping_cost_estimate: '' });
          var its = (d2.line_items || []).map(function (li) {
            return { description: li.description || '', quantity: String(li.quantity !== null && li.quantity !== undefined ? li.quantity : 1),
              unit_price: String(li.unit_price !== null && li.unit_price !== undefined ? li.unit_price : (li.line_total !== null && li.line_total !== undefined ? li.line_total : 0)),
              sku: '', product_ref: '', wave_product_id: '', wave_product_name: '' };
          });
          setItems(its.length ? its : [blankItem()]);
          setEditing('new');
          var msgs = (j.problems || []).slice();
          if (!pickedCust) { msgs.unshift(cands.length ? 'Pick the customer (best guesses are in the dropdown).' : 'Pick the customer.'); }
          if (msgs.length) { toast.error('Check before saving: ' + msgs.join(' ')); } else { toast.success('Invoice read — review every field, then Save.'); }
        })
        .catch(function (e) { toast.error('Import failed: ' + ((e && e.message) || 'network')); })
        .finally(function () { setBusy(false); });
    };
    rd.readAsDataURL(file);
  }
  // v55.83-PW (Max, 10:46): "should be able to click on button to actually
  // open invoice to edit if necessary from here" — any invoice peek's ✏ Edit
  // lands here: fetch the full row by id and open the SAME editor.
  function openEditById(id) {
    if (!id || !isInvoice()) { return; }
    if (!mayEdit) { toast.error('You need invoice edit permission for that.'); return; }
    supabase.from('accounting_invoices').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (r && r.data) { startEdit(r.data); }
      else { toast.error('Could not open that invoice for editing.'); }
    });
  }
  // v55.83-WJ (Max: "take me to the exact invoice and exact area where i would enter that amount") — when another screen opens an
  // invoice FOR ITS SHIPPING COST (window.__ntInvoiceFocus = 'shipping'), the edit window scrolls to the shipping box, outlines it,
  // opens the internal breakdown and puts the cursor in the cost box. The hint is used once.
  var sSF = useState(false); var shipFocus = sSF[0]; var setShipFocus = sSF[1];
  useEffect(function () {
    if (!editing || typeof window === 'undefined' || window.__ntInvoiceFocus !== 'shipping') { return; }
    window.__ntInvoiceFocus = null; setShipFocus(true);
    setTimeout(function () { var box = document.getElementById('nt-invoice-shipping'); if (box) { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.style.outline = '3px solid #f59e0b'; setTimeout(function () { box.style.outline = ''; }, 4000); } var inp0 = document.getElementById('nt-invoice-ship-cost'); if (inp0 && !inp0.disabled) { inp0.focus(); } }, 250);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(function () { if (!editing && shipFocus) { setShipFocus(false); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(function () {
    var pending = typeof window !== 'undefined' ? window.__ntOpenInvoiceEdit : null;
    if (pending) { window.__ntOpenInvoiceEdit = null; openEditById(pending); }
    function onEvt(e) { if (e && e.detail) { window.__ntOpenInvoiceEdit = null; openEditById(e.detail); } }
    window.addEventListener('nt-open-invoice-edit', onEvt);
    return function () { window.removeEventListener('nt-open-invoice-edit', onEvt); };
  }, []); // eslint-disable-line
  // v55.83-TG — the invoice's shipping terms live in pl_invoice_terms (server route; the browser cannot read that table)
  function loadShippingTerms(invId, cb) {
    if (!invId) { return; }
    hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_shipping_terms', invoice_id: invId, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { cb({ shipping_terms: j.shipping_terms || '', shipping_cost_estimate: j.shipping_cost_estimate === null || j.shipping_cost_estimate === undefined ? '' : String(j.shipping_cost_estimate), markup_override_note: j.markup_override_note || '' /* v55.83-XV */ }); } })
      .catch(function () {});
  }
  function startEdit(row) {
    var tbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var key = isInvoice() ? 'invoice_id' : 'proforma_id';
    setHdr(Object.assign({ shipping_terms: '', shipping_cost_estimate: '' }, row)); setEditing(row); setItems([blankItem()]);
    if (isInvoice()) { loadShippingTerms(row.id, function (t) { setHdr(function (h) { return Object.assign({}, h, t); }); }); } // v55.83-TG
    supabase.from(tbl).select('*').eq(key, row.id).order('sort_order', { ascending: true }).then(function (r) {
      var its = ((r && r.data) || []).map(function (it) { return { id: it.id, description: it.description || '', quantity: String(it.quantity != null ? it.quantity : 1), unit_price: String(it.unit_price != null ? it.unit_price : 0), sku: it.sku || '', product_ref: it.product_ref || '', wave_product_id: it.wave_product_id || '', wave_product_name: it.wave_product_name || '' }; });
      setItems(its.length ? its : [blankItem()]);
    });
  }
  // v55.83-QZ (Max, Nov 8 11:51: "need to be able to duplicate bills or
  // invoices with the ability to edit the fields"). Opens the editor as a NEW
  // document prefilled from this one — customer, lines (fresh, no ids),
  // release, notes, terms; today's date with the same payment terms; NUMBER
  // left blank on purpose (never a duplicate invoice number). Saves as a
  // brand-new DRAFT — nothing about the original (payments, Wave link,
  // approval) is copied.
  function startDuplicate(row) {
    var tbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var key = isInvoice() ? 'invoice_id' : 'proforma_id';
    var today = new Date().toISOString().substring(0, 10);
    var d0 = isInvoice() ? row.invoice_date : row.proforma_date;
    var e0 = isInvoice() ? row.due_date : row.valid_until;
    var span = (d0 && e0) ? Math.round((Date.parse(e0) - Date.parse(d0)) / 86400000) : null;
    var newEnd = (span != null && span >= 0) ? new Date(Date.parse(today) + span * 86400000).toISOString().substring(0, 10) : '';
    if (isInvoice()) { setHdr({ invoice_number: '', release_number: row.release_number || '', accounting_customer_id: row.accounting_customer_id || '', invoice_date: today, due_date: newEnd, notes: row.notes || '', terms: row.terms || '', shipping_terms: '', shipping_cost_estimate: '' }); loadShippingTerms(row.id, function (t) { setHdr(function (h) { return Object.assign({}, h, t, { markup_override_note: '' /* v55.83-XV — a copy needs its own reason */ }); }); }); }
    else { setHdr({ proforma_number: '', accounting_customer_id: row.accounting_customer_id || '', proforma_date: today, valid_until: newEnd, notes: row.notes || '', terms: row.terms || '' }); }
    setEditing('new'); setItems([blankItem()]);
    supabase.from(tbl).select('*').eq(key, row.id).order('sort_order', { ascending: true }).then(function (r) {
      var its = ((r && r.data) || []).map(function (it) { return { description: it.description || '', quantity: String(it.quantity != null ? it.quantity : 1), unit_price: String(it.unit_price != null ? it.unit_price : 0), sku: it.sku || '', product_ref: it.product_ref || '', wave_product_id: it.wave_product_id || '', wave_product_name: it.wave_product_name || '' }; });
      setItems(its.length ? its : [blankItem()]);
    });
    toast.success('Copy opened as a NEW draft — give it its own number, change anything, then Save.');
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
  // List-row paid/balance/status derived from loaded payment rows (+ wave_imported_paid),
  // so the blotter is correct even when the stored amount_paid/balance_due are stale.
  function rowCalc(row) {
    var total = row.total_amount != null ? roundMoney(Number(row.total_amount)) : 0;
    var waveImp = Number(row.wave_imported_paid) || 0;
    var hub = Number(hubPaidMap[row.id]) || 0;
    var paid = roundMoney(waveImp + hub);
    var balance = roundMoney(Math.max(0, total - paid));
    var status = paid <= 0.0001 ? 'unpaid' : (balance <= 0.0001 ? 'paid' : 'partial');
    return { total: total, paid: paid, balance: balance, paymentStatus: status };
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
    viewPayments.forEach(function (p) { if (!isPaymentVoid(p)) { hubPaid += Number(p.amount) || 0; } });
    hubPaid = roundMoney(hubPaid);
    var paid = roundMoney(waveImported + hubPaid);
    var balance = roundMoney(Math.max(0, docTot - paid));
    var paymentStatus = paid <= 0.0001 ? 'unpaid' : (balance <= 0.0001 ? 'paid' : 'partial');
    return { lineSum: lineSum, docTot: docTot, adjustment: adjustment, waveImported: waveImported, hubPaid: hubPaid, paid: paid, balance: balance, paymentStatus: paymentStatus };
  }
  function uh(k, v) { var c = Object.assign({}, hdr); c[k] = v; setHdr(c); }
  function ui(i, k, v) { var c = items.slice(); c[i] = Object.assign({}, c[i]); c[i][k] = v; setItems(c); }
  // v55.83-MS (Codex delta 5) — selecting a Wave product is SYNC METADATA ONLY: it sets the line's
  // wave_product_id (the required Wave accounting carrier) + name, and NEVER touches the user's description,
  // quantity, or unit price. The Hub line description pushes to Wave verbatim (per-line override), so the
  // carrier product's name/description must not clobber what the user deliberately typed.
  function setLineWaveProduct(i, productId) {
    var prod = null; waveProducts.forEach(function (p) { if (p.wave_product_id === productId) { prod = p; } });
    var c = items.slice(); c[i] = Object.assign({}, c[i] || {});
    c[i].wave_product_id = productId || '';
    c[i].wave_product_name = prod ? (prod.name || '') : '';
    setItems(c);
  }
  // v55.83-MS (Codex QA #1) — change a line's Wave product. Always update local state; if the invoice is LOCKED
  // (approved/pending) and the line already exists (has an id), persist the mapping immediately via the
  // metadata-only server action so the per-line product can be set WITHOUT reopening the invoice's financials.
  function onLineProductChange(i, productId) {
    var existing = items[i];
    var prevProductId = existing ? (existing.wave_product_id || '') : '';
    setLineWaveProduct(i, productId);
    if (locked(editing) && existing && existing.id && editing && editing.id) {
      var prod = null; waveProducts.forEach(function (p) { if (p.wave_product_id === productId) { prod = p; } });
      hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_line_product', invoice_id: editing.id, item_id: existing.id, wave_product_id: productId || null, wave_product_name: prod ? (prod.name || '') : null, user_id: (userProfile && userProfile.id) || null }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok) { toast.success('Wave product mapped to this line (no financial change).'); } else { toast.error('Mapping failed: ' + ((d && d.error) || 'unknown') + ' — reverted.'); setLineWaveProduct(i, prevProductId); } })
        // v55.83-MS (Codex caution) — the dropdown is optimistic; on a failed/blocked server write, REVERT the
        // local selection so a failed mapping is never mistaken for persisted Hub state.
        .catch(function (e) { toast.error('Mapping failed: ' + ((e && e.message) || 'network error') + ' — reverted.'); setLineWaveProduct(i, prevProductId); });
    }
  }
  function addItem() { setItems(items.concat([blankItem()])); }
  function rmItem(i) { var c = items.slice(); c.splice(i, 1); setItems(c.length ? c : [blankItem()]); }

  function locked(row) { return isInvoice() && getInvStatus(row) === 'approved'; }

  // v55.83-TZ (Yasmeen, Nov 17: "the system will not allow me to save") — why Save stopped, in red next to the button (the pop-up alone was missed)
  var sSb = useState(''); var saveBlock = sSb[0]; var setSaveBlock = sSb[1];
  // v55.83-YP (Max, Nov 24) — shipActualFor = the Release # text whose COMPLETE breakdown is typed (the actual costs): only then is cost + 7% checked.
  // autoShip = the amount the Hub itself last put on the shipping line, so a line priced by hand is never overwritten.
  var sAc = useState(null); var shipActualFor = sAc[0]; var setShipActualFor = sAc[1];
  var sAu = useState(null); var autoShip = sAu[0]; var setAutoShip = sAu[1];
  function shipCostIsActual() { var r = String(hdr.release_number || '').trim(); return !!r && shipActualFor === r; }
  function autoShipLine(costText, terms) {
    if (locked(editing)) { return; }
    var a = autoShippingLine(items, costText, autoShip, terms, isTransportLine, blankItem);
    if (a.changed) { setItems(a.items); setAutoShip(a.amount); toast.success(a.why === 'added' ? ('Shipping line added at $' + Number(a.amount).toFixed(2) + ' (the cost you typed). Change the amount if you charge more or less.') : ('The shipping line now follows the cost: $' + Number(a.amount).toFixed(2) + '.')); }
  }
  function save() {
    if (!mayEdit) { toast.error('You do not have permission to edit.'); return; }
    if (editing !== 'new' && locked(editing)) { toast.error('Approved invoice is locked. Reopen to edit.'); return; }
    if (!hdr.accounting_customer_id) { toast.error('Pick an accounting customer.'); return; }
    var clean = items.filter(function (it) { return (it.description || '').trim() || Number(it.unit_price) || Number(it.quantity); });
    if (clean.length === 0) { toast.error('Add at least one line item.'); return; }
    var total = docTotal(clean);
    // v55.83-TG (Max): every invoice has ONE shipping-terms value, and a shipping line must cover our cost + 7%
    var shipCheck = null;
    if (isInvoice()) {
      shipCheck = checkShippingTerms(hdr.shipping_terms, hdr.shipping_cost_estimate, clean.map(function (it) { return { description: it.description, amount: itemTotal(it) }; }), isTransportLine, { costIsActual: shipCostIsActual() /* v55.83-YP */ });
      if (!shipCheck.ok) { toast.error(shipCheck.error); setSaveBlock(shipCheck.error); return; } // TZ — also shown by the Save button
      setSaveBlock('');
      // v55.83-XV (Max, Nov 23) — below cost + 7% is saved only with a written reason (kept on the audit trail by the server)
      var mk7 = shipCheck.markup || null; var mkNote = String(hdr.markup_override_note || '').replace(/\s+/g, ' ').trim();
      if (mk7 && mkNote.length < MARKUP_NOTE_MIN) { var m7 = 'The shipping line(s) total $' + mk7.charged.toFixed(2) + ', below our shipping cost + 7% ($' + mk7.need.toFixed(2) + '). To save it anyway, type the reason in the red box under the shipping cost (at least ' + MARKUP_NOTE_MIN + ' characters).'; toast.error(m7); setSaveBlock(m7); return; }
      var otherW = shipCheck.warnings.filter(function (w) { return !(mk7 && w === mk7.warning); });
      if (otherW.length && typeof window !== 'undefined' && !window.confirm('Please check before saving:\n\n- ' + otherW.join('\n- ') + '\n\nSave anyway? (It will also show on the profit report as a warning.)')) { return; }
    }
    setBusy(true);
    var tbl = isInvoice() ? 'accounting_invoices' : 'accounting_proformas';
    var itemTbl = isInvoice() ? 'accounting_invoice_items' : 'accounting_proforma_items';
    var fk = isInvoice() ? 'invoice_id' : 'proforma_id';
    // Recompute paid from ACTUAL non-void payments (not the stale header amount_paid), so
    // editing line items on an invoice that already has payments can't drift the balance.
    var realPaid = (editing && editing !== 'new') ? (Number(hubPaidMap[editing]) || 0) : 0;
    // v55.83-JP (audit) — do NOT silently floor the balance to 0 when the new total is BELOW what's
    // already been paid: that hides an overpayment and falsely shows the invoice "paid". Block the edit
    // and tell the user to handle the existing payment first (unmatch / issue a credit).
    if (isInvoice() && total < roundMoney(realPaid) - 0.01) {
      setBusy(false);
      toast.error('This invoice already has ' + fmt(realPaid) + ' applied, but the new total is ' + fmt(total) + '. Reducing it below the paid amount would hide an overpayment. Unmatch/reverse the excess payment first, or raise the total.');
      return;
    }
    var newBalance = roundMoney(Math.max(0, total - realPaid));
    var newStatus = realPaid <= 0.0001 ? 'unpaid' : (newBalance <= 0.0001 ? 'paid' : 'partial');
    var hpayload = isInvoice()
      ? { invoice_number: hdr.invoice_number || null, release_number: (hdr.release_number || '').trim() || null, accounting_customer_id: hdr.accounting_customer_id, invoice_date: hdr.invoice_date || null, due_date: hdr.due_date || null, notes: hdr.notes || null, terms: hdr.terms || null, total_amount: total, amount_paid: roundMoney(realPaid), balance_due: newBalance, payment_status: newStatus, updated_by: userProfile && userProfile.id }
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
            // v55.83-IY — persist the per-line Wave product selection (printed description stays separate).
            if (it.wave_product_id) { payload.wave_product_id = it.wave_product_id; payload.wave_product_name = it.wave_product_name || null; if (isInvoice()) { payload.wave_product_source = 'selected'; } }
            payload[fk] = docId;
            return dbInsert(itemTbl, payload, userProfile && userProfile.id);
          });
        });
        return chain.then(function () { return docId; });
      });
    }).then(function (docId) {
      if (!shipCheck) { return docId; }
      return hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_shipping_terms', invoice_id: docId, shipping_terms: shipCheck.value.shipping_terms, shipping_cost_estimate: shipCheck.value.shipping_cost_estimate, markup_override_note: shipCheck.markup ? String(hdr.markup_override_note || '') : '' /* v55.83-XV */, user_id: userProfile && userProfile.id }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!(j && j.ok)) { throw { termsFailed: true, docId: docId, msg: (j && j.error) || 'unknown error' }; } return docId; }, function () { throw { termsFailed: true, docId: docId, msg: 'network' }; });
    }).then(function (docId) {
      return logActivity(userProfile && userProfile.id, (editing === 'new' ? 'Created ' : 'Updated ') + (isInvoice() ? 'invoice ' : 'proforma ') + (hpayload.invoice_number || hpayload.proforma_number || docId) + ' (' + fmt(total) + ')', 'accounting_' + mode);
    }).then(function () { toast.success('Saved'); setEditing(null); load(); })
      .catch(function (e) {
        if (e && e.termsFailed) {
          // v55.83-TG (Codex P2) — PARTIAL save: the invoice and its lines are saved, the shipping terms are not. Stay in the editor
          // on the SAVED invoice (so pressing Save again updates it — never a duplicate) with the user's choices kept.
          toast.error('PARTLY SAVED: the invoice is saved, but its SHIPPING TERMS were not (' + e.msg + '). Your choice is still here — press Save again.', { duration: 15000 });
          if (editing === 'new') { setEditing(Object.assign({}, hdr, { id: e.docId, approval_status: 'draft' })); }
          load(); return;
        }
        console.error('[save] Save failed: ', e); toast.error('Save failed: ' + ((e && e.message) || 'unknown error — check console'));
      })
      .finally(function () { setBusy(false); });
  }

  // v55.83-JD — approval now goes through the SERVICE-ROLE route /api/accounting/invoice-write. The
  // old browser dbUpdate was silently filtered to 0 rows by RLS (app auth is by email, users.id !=
  // auth.uid()), so "Approve" toasted success but the invoice stayed DRAFT and could never reach Wave.
  function setApproval(row, status) {
    if (status === 'approved' && !mayApprove) { toast.error('You need the “Approve & reopen invoices” switch (Settings → Banking & Accounting Access → 3 · Bank work). Ask the super admin.'); return; }
    if (!mayEdit && status !== 'approved') { toast.error('No permission.'); return; }
    setBusy(true);
    hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_approval', invoice_id: row.id, status: status, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { throw new Error((j && j.error) || 'approval did not save'); }
        return logActivity(userProfile && userProfile.id, 'Invoice ' + (row.invoice_number || row.id) + ' -> ' + status, 'accounting_invoices').then(function () { return j; });
      })
      .then(function () {
        toast.success('Invoice ' + status.replace('_', ' '));
        // v55.83-JP (audit) — close whichever modal was showing this row so its buttons/lock reflect
        // the new status instead of staying stale (the old modal kept showing "Approve" after approval).
        setEditing(function (ed) { return (ed && ed !== 'new' && ed.id === row.id) ? null : ed; });
        setViewing(function (v) { return (v && v.id === row.id) ? null : v; });
        load();
      })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Could not ' + (status === 'approved' ? 'approve' : 'update') + ' invoice: ' + ((e && e.message) || 'unknown error') + ' (screenshot for Claude)'); })
      .finally(function () { setBusy(false); });
  }
  // v55.83-NA — the amend-and-re-push flow, in the order that keeps Wave safe:
  //   1. approve the amended Hub invoice (invoice-write set_approval — an
  //      approved amend is what gets pushed, never a half-edited draft)
  //   2. replace-invoice: server deletes the OLD Wave copy and unlinks it
  //      (refuses outright if any payment is already recorded in Wave)
  //   3. push-invoice-v2: the existing, battle-tested push recreates it from
  //      the current Hub data (product mapping, currency guarantee, DRAFT
  //      auto-approve and read-back all still apply)
  // If step 3 fails, the invoice sits honestly in pending_sync with no Wave
  // copy — visible in the Sync Center, recoverable with a normal push. At no
  // point can two copies exist in Wave.
  function updateInWave(row) {
    if (!(mayApprove || isSuperAdmin)) { toast.error('Only an Owner/Admin or Accounting Manager can update Wave.'); return; }
    if (!row || !row.wave_invoice_id) { toast.error('This invoice has no Wave copy — use the normal push.'); return; }
    var sure = window.confirm(
      'Update invoice ' + (row.invoice_number || row.id) + ' in Wave?\n\n' +
      'Wave has no edit — the old Wave copy will be DELETED and a new one created from the amended Hub invoice.\n' +
      'The Wave invoice id will change. Payments already recorded in Wave will block this (by design).\n\n' +
      'Continue?');
    if (!sure) { return; }
    setBusy(true);
    var uid = (userProfile && userProfile.id) || null;
    hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_approval', invoice_id: row.id, status: 'approved', user_id: uid }) })
      .then(function (r) { return r.json(); })
      .then(function (aj) {
        if (!aj || !aj.ok) { throw new Error('Could not approve the amended invoice: ' + ((aj && aj.error) || 'unknown error')); }
        toast.success('Amended invoice approved — replacing the Wave copy…');
        return hubFetch('/api/wave/replace-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: row.id, confirm_replace: true, user_id: uid }) }).then(function (r) { return r.json(); });
      })
      .then(function (rj) {
        if (!rj || rj.ok !== true) { throw new Error((rj && rj.error) || 'Wave did not delete the old copy — nothing was changed.'); }
        toast.success('Old Wave copy removed — pushing the amended invoice…');
        return hubFetch('/api/wave/push-invoice-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: row.id, dry_run: false, user_id: uid }) }).then(function (r) { return r.json(); });
      })
      .then(function (pj) {
        // Same result reading as approveAndPushInvoice in the Sync Center: never
        // treat a bare wave_invoice_id as success.
        var draftStuck = !!(pj && (pj.needs_approval === true || pj.wave_status === 'DRAFT' || pj.wave_sync_status === 'pushed_draft'));
        var currencyBad = !!(pj && pj.currency_mismatch === true);
        var pushed = !!(pj && (pj.success === true || pj.ok === true) && !draftStuck && !currencyBad);
        if (pushed) { toast.success('Wave now shows the amended invoice.'); }
        else if (draftStuck) { toast.error('Amended invoice created in Wave but is still DRAFT — use "Approve in Wave" in the Sync Center. ' + ((pj && pj.warning) || '')); }
        else if (currencyBad) { toast.error('Amended invoice created but its currency does not match: ' + ((pj && pj.error) || 'fix the customer currency in Wave')); }
        else { toast.error('Old copy was removed but the re-push failed: ' + ((pj && pj.error) || 'see Sync Log') + ' — the invoice is in Pending Sync; push it from the Sync Center once fixed.'); }
        logActivity(uid, 'Updated invoice ' + (row.invoice_number || row.id) + ' in Wave (delete + recreate)', 'accounting_invoices');
        setViewing(null); load();
      })
      .catch(function (e) { toast.error((e && e.message) || 'Update in Wave failed'); load(); })
      .finally(function () { setBusy(false); });
  }
  function reopenInvoice(row) {
    if (!mayApprove) { toast.error('You need the “Approve & reopen invoices” switch (Settings → Banking & Accounting Access → 3 · Bank work). Ask the super admin.'); return; }
    var reason = window.prompt('Reopen approved invoice for editing. Reason:') || '';
    if (!reason.trim()) { toast.error('Reason required.'); return; }
    setBusy(true);
    var waveTouch = (row.source === 'wave_import' || row.wave_sync_status === 'synced');
    hubFetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen', invoice_id: row.id, wave_touch: waveTouch, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) { throw new Error((j && j.error) || 'reopen did not save'); } return j; })
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
            // v55.83-JP (audit) — carry the per-line Wave product across the conversion, or the
            // invoice loses the silo's chosen Wave product and falls back to the default on push.
            chain = chain.then(function () { return dbInsert('accounting_invoice_items', { business_id: row.business_id || businessId, invoice_id: invId, description: it.description, quantity: it.quantity, unit_price: it.unit_price, line_total: it.line_total, sku: it.sku, product_ref: it.product_ref, wave_product_id: it.wave_product_id || null, wave_product_name: it.wave_product_name || null, wave_product_source: it.wave_product_id ? (it.wave_product_source || 'selected') : null, sort_order: idx }, userProfile && userProfile.id); });
          });
          return chain.then(function () {
            return dbUpdate('accounting_proformas', row.id, { status: 'converted', converted_invoice_id: invId, updated_by: userProfile && userProfile.id }, userProfile && userProfile.id);
          }).then(function () { return logActivity(userProfile && userProfile.id, 'Converted proforma ' + (row.proforma_number || row.id) + ' to invoice', 'accounting_proformas'); });
        });
      })
      .then(function () { toast.success('Converted to invoice'); setMode('invoices'); load(); loadLinkMap(); })
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
      // v55.83-IN — use the SAME canonical figure as the on-screen blotter/ledger
      // (wave_imported_paid + non-void Hub payment rows), not the stale stored amount_paid/balance_due,
      // so the printed/PDF invoice never disagrees with what staff see on screen.
      var paid = roundMoney((Number(row.wave_imported_paid) || 0) + (Number(hubPaidMap[row.id]) || 0));
      var bal = roundMoney(Math.max(0, docTot - paid));
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

  if (!mayView) return <div className="p-6"><RestrictedNotice title="Invoices restricted" message="Requires the Invoices: View permission (code ACCT-004 / invoice.view). Ask an admin to grant it in Settings — Bank View is NOT required." /></div>;
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
        {mayEdit && isInvoice() && <label className="px-3 py-1.5 text-xs rounded font-bold" style={{ background: '#1d4ed8', color: '#ffffff', cursor: 'pointer' }} title="Upload a photo/PDF of an invoice — it is read and opened in the editor for you to confirm; saving pushes to Wave and ClickBooks like any invoice">
          📷 Import invoice
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: 'none' }}
            onChange={function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; importInvoiceFile(f); }} /></label>}
      </div>

      <div className="flex items-center gap-2 mb-2">
        {isInvoice() && [['US', '🇺🇸 US'], ['EG', '🇪🇬 Egypt'], ['ALL', 'All']].map(function (bf) {
          var act = bizFilter === bf[0];
          return <button key={bf[0]} onClick={function () { setBizFilter(bf[0]); }}
            title={bf[0] === 'US' ? 'US business: invoices in Wave or pending push to Wave' : bf[0] === 'EG' ? 'Egypt business: the Egyptian ledger (never goes to Wave)' : 'Both businesses'}
            className={'px-2 py-1.5 rounded text-[11px] font-extrabold ' + (act ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 border border-slate-600 hover:bg-slate-700')}>{bf[1]}</button>;
        })}
        <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder={'Search ' + (isInvoice() ? 'invoices' : 'proformas') + ' — number, customer, status, Wave/Hub…'} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-slate-100 text-xs" style={{ width: '380px' }} />
        {search.trim() && <button onClick={function () { setSearch(''); }} className="text-[11px] text-slate-300 hover:text-white">clear</button>}
        {(function () {
          var f = floorDateFor({ window: visCfg.window, customDays: visCfg.customDays, customFrom: visCfg.customFrom, isSuperAdmin: isSuperAdmin }, new Date());
          var lbl = isSuperAdmin ? 'All history (super-admin)' : labelForWindow(visCfg.window, visCfg.customDays);
          // newest loaded date among the rows currently shown (invoice_date / proforma_date)
          var newest = null;
          (isInvoice() ? invoices : proformas).forEach(function (row) { var d = ((isInvoice() ? row.invoice_date : row.proforma_date) || '').substring(0, 10); if (d && (!newest || d > newest)) { newest = d; } });
          return <span className="text-[11px] text-slate-400 ml-1" title="Org history-visibility window (super admin sets it in Settings → Accounting Visibility).">Visibility: <b className={f ? 'text-sky-300' : 'text-slate-200'}>{lbl}</b>{f ? <span> (from {f})</span> : null} · Newest: <b className="text-slate-200">{newest || '—'}</b></span>;
        })()}
        <span className="text-[11px] text-slate-400">{displayRows.length} shown · newest first</span>
      </div>

      <div className="border border-slate-700 rounded mb-4" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: '1010px' }}>
          <div className="bg-slate-800 text-[11px] font-extrabold grid" style={{ gridTemplateColumns: gcols, position: 'sticky', top: 0, zIndex: 2 }}>
            <div className="px-2 py-1.5">Number</div><div className="px-2 py-1.5">Release #</div><div className="px-2 py-1.5">Customer</div><div className="px-2 py-1.5">Inv date</div><div className="px-2 py-1.5">{isInvoice() ? 'Due date' : 'Valid until'}</div><div className="px-2 py-1.5 text-right">Total</div><div className="px-2 py-1.5 text-right">Paid</div><div className="px-2 py-1.5 text-right">Balance</div><div className="px-2 py-1.5">Source</div><div className="px-2 py-1.5">Status</div><div className="px-2 py-1.5">Actions</div>
          </div>
          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
          {displayRows.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No {isInvoice() ? 'invoices' : 'proformas'}{search.trim() ? ' match your search' : ' yet'}.</div> :
            displayRows.map(function (row) {
              var rc = rowCalc(row);
              return (
                <div key={row.id} className="grid items-center border-t border-slate-800 hover:bg-slate-800/40" style={{ gridTemplateColumns: gcols }}>
                  <div className="px-2 py-1.5 text-xs font-mono text-slate-200 cursor-pointer" onClick={function () { openView(row); }}>{(isInvoice() ? row.invoice_number : row.proforma_number) || <span className="text-slate-500 italic">(none)</span>}
                    {/* v55.83-VZ — where it came from / what it made, right on the list */}
                    {isInvoice() && linkMap.by_invoice[row.id] ? <button type="button" onClick={function (e) { e.stopPropagation(); openPeekProforma(linkMap.by_invoice[row.id].proforma_id); }} title="Made from this proforma — click to open it" className="block mt-0.5 text-[9px] bg-indigo-700 hover:bg-indigo-600 text-white rounded px-1 py-0.5 font-bold font-sans">PF {linkMap.by_invoice[row.id].proforma_number || ''} ↗</button> : null}
                    {!isInvoice() && linkMap.by_proforma[row.id] ? <span className="block mt-0.5 font-sans">{linkMap.by_proforma[row.id].invoices > 0 ? <span className="text-[9px] bg-indigo-700 text-white rounded px-1 py-0.5 font-bold mr-1" title="Invoices made from this proforma — open it to see them">{linkMap.by_proforma[row.id].invoices} invoice{linkMap.by_proforma[row.id].invoices > 1 ? 's' : ''}</span> : null}{linkMap.by_proforma[row.id].signed > 0 ? <span className="text-[9px] bg-emerald-700 text-white rounded px-1 py-0.5 font-bold" title="A signed copy is on file — open it to see it">✍ signed</span> : null}</span> : null}</div>
                  <div className="px-1 py-1" onClick={function (e) { e.stopPropagation(); }}>{isInvoice() ? (
                    relEditId === row.id ? (
                      <div>
                        <input autoFocus value={relDraft}
                          onChange={function (e) { setRelDraft(e.target.value); }}
                          onClick={function (e) { e.stopPropagation(); }}
                          onKeyDown={function (e) { e.stopPropagation(); if (e.key === 'Escape') { setRelEditId(null); setRelErr(''); } if (e.key === 'Enter') { e.target.blur(); } }}
                          onBlur={function () {
                            var v = (relDraft || '').trim();
                            var cur = row.release_number || '';
                            setRelEditId(null); setRelErr('');
                            if (v === cur) { return; }
                            hubFetch('/api/reconcile/nexttrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'set_release', user_id: userProfile && userProfile.id, system: 'accounting', id: row.id, release_number: v }) })
                              .then(function (r) { return r.json(); })
                              .then(function (j) {
                                if (!j || j.ok !== true) {
                                  // v55.83-OG — a rejection must be IMPOSSIBLE to miss:
                                  // reopen the editor with the typed value and the reason in red.
                                  var msg = (j && j.error) || 'Save failed';
                                  toast.error(msg);
                                  setRelDraft(v); setRelErr(msg); setRelEditId(row.id);
                                  return;
                                }
                                row.release_number = j.saved;
                                toast.success('Release ' + (j.saved || 'cleared') + ' saved' + (j.saved && j.saved !== v ? ' (expanded from ' + v + ')' : ''));
                                setRelBump(relBump + 1);
                              })
                              .catch(function (er) { var m2 = 'Save failed: ' + ((er && er.message) || 'network'); toast.error(m2); setRelDraft(v); setRelErr(m2); setRelEditId(row.id); });
                          }}
                          className="w-full px-1 py-0.5 rounded border-2 border-amber-400 bg-white text-[10px] font-mono font-bold text-slate-900" placeholder="1193 or 1002-1193" />
                        {relErr ? <div className="text-[9px] font-bold mt-0.5 px-1 py-0.5 rounded" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{relErr}</div> : null}
                      </div>
                    ) : (
                      <button type="button" onClick={function (e) { e.stopPropagation(); setRelDraft(row.release_number || ''); setRelErr(''); setRelEditId(row.id); }}
                        title={row.release_number ? 'Click to edit the release number' : 'No release number — click to add'}
                        className={row.release_number ? 'w-full text-left px-1 py-0.5 rounded border border-slate-600 bg-slate-900 text-[10px] font-mono text-slate-100' : 'w-full text-left px-1 py-0.5 rounded border-2 border-amber-400 bg-amber-50 text-[10px] font-extrabold text-amber-900'}>
                        {row.release_number || '+ Release #'}
                      </button>
                    )
                  ) : <span className="text-[10px] text-slate-500">—</span>}</div>
                  <div className="px-2 py-1.5 text-xs text-slate-100 truncate cursor-pointer" onClick={function () { openView(row); }}>{custName(row.accounting_customer_id)}</div>
                  <div className="px-2 py-1.5 text-[11px] text-slate-300">{(isInvoice() ? row.invoice_date : row.proforma_date) || '—'}</div>
                  <div className="px-2 py-1.5 text-[11px] text-slate-300">{(isInvoice() ? row.due_date : row.valid_until) || '—'}</div>
                  <div className="px-2 py-1.5 text-right text-xs font-mono font-bold">{fmt(row.total_amount)}</div>
                  <div className="px-2 py-1.5 text-right text-[11px] font-mono text-slate-300">{isInvoice() ? fmt(rc.paid) : '—'}</div>
                  <div className="px-2 py-1.5 text-right text-[11px] font-mono text-slate-200">{isInvoice() ? fmt(rc.balance) : '—'}</div>
                  <div className="px-2 py-1.5">{isInvoice() ? <span className={'text-[9px] rounded px-1 py-0.5 font-bold ' + (row.source === 'wave_import' ? 'bg-sky-700 text-white' : 'bg-emerald-700 text-white')}>{row.source === 'wave_import' ? 'Wave' : 'Hub'}</span> : '—'}</div>
                  <div className="px-2 py-1.5"><span className={'text-[10px] px-1.5 py-0.5 rounded font-bold ' + statusColor(isInvoice() ? row.approval_status : row.status)}>{labelStatus(isInvoice() ? row.approval_status : row.status)}</span>{isInvoice() ? <span className={'ml-1 text-[9px] px-1 py-0.5 rounded font-bold ' + (rc.paymentStatus === 'paid' ? 'bg-emerald-700 text-white' : (rc.paymentStatus === 'partial' ? 'bg-amber-200 text-amber-950' : 'bg-slate-600 text-white'))}>{rc.paymentStatus}</span> : null}{row.record_status && row.record_status !== 'active' ? <span className="ml-1 text-[9px] bg-slate-600 text-white rounded px-1 font-bold">{String(row.record_status).toUpperCase()}</span> : null}</div>
                  <div className="px-2 py-1.5 flex gap-1 flex-wrap">
                    <button onClick={function () { openView(row); }} className="text-[10px] bg-sky-700 hover:bg-sky-600 text-white rounded px-1.5 py-0.5 font-bold">View</button>
                    <button onClick={function () { printDoc(row); }} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold" title="Print / Save PDF">Print</button>
                    {mayEdit && <button onClick={function () { startDuplicate(row); }} className="text-[10px] bg-teal-700 hover:bg-teal-600 text-white rounded px-1.5 py-0.5 font-bold" title="Duplicate — opens a NEW draft with the same customer and lines; give it its own number and edit anything">⧉ Duplicate</button>}
                    {isInvoice() && invActions(row).canSubmit && <button onClick={function () { setApproval(row, 'internal_review'); }} disabled={busy} className="text-[10px] bg-amber-600 text-white rounded px-1.5 py-0.5 font-bold">Submit</button>}
                    {isInvoice() && invActions(row).canApprove && <button onClick={function () { setApproval(row, 'approved'); }} disabled={busy} className="text-[10px] bg-blue-700 text-white rounded px-1.5 py-0.5 font-bold">Approve</button>}
                    {isInvoice() && invActions(row).canReopen && <button onClick={function () { reopenInvoice(row); }} disabled={busy} className="text-[10px] bg-slate-700 text-white rounded px-1.5 py-0.5 font-bold">Reopen</button>}
                    {isInvoice() && invActions(row).canUpdateWave && <button onClick={function () { updateInWave(row); }} disabled={busy} className="text-[10px] bg-violet-700 hover:bg-violet-600 text-white rounded px-1.5 py-0.5 font-bold" title="Wave has no edit — deletes the old Wave copy and recreates it from this amended invoice">🔁 Update in Wave</button>}
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '88px 16px 32px' }} onClick={function () { setViewing(null); }}>
            <div className="bg-slate-900 border border-slate-600 rounded-xl w-full" style={{ maxWidth: '840px', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }} onClick={function (e) { e.stopPropagation(); }}>
              <div className="flex items-center justify-between p-3 border-b border-slate-700">
                <div className="font-extrabold text-slate-100">View {isInvoice() ? 'invoice' : 'proforma'} · {(isInvoice() ? viewing.invoice_number : viewing.proforma_number) || '(no number)'} <span className="text-[10px] text-slate-400 font-medium">(read-only)</span></div>
                <div className="flex gap-1 flex-wrap">
                  <button onClick={function () { printDoc(viewing); }} className="text-[11px] bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-1 font-bold">Print / Save PDF</button>
                  {isInvoice() && mayEdit && (viewing.approval_status || 'draft') === 'draft' && <button onClick={function () { var row = viewing; setApproval(row, 'internal_review'); setViewing(null); }} disabled={busy} className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1 font-bold">Submit for Review</button>}
                  {isInvoice() && mayApprove && viewing.approval_status === 'internal_review' && <button onClick={function () { var row = viewing; setApproval(row, 'approved'); setViewing(null); }} disabled={busy} className="text-[11px] bg-blue-700 hover:bg-blue-600 text-white rounded px-2 py-1 font-bold">Approve</button>}
                  {isInvoice() && mayApprove && viewing.approval_status === 'approved' && <button onClick={function () { var row = viewing; reopenInvoice(row); }} disabled={busy} className="text-[11px] bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-1 font-bold">Reopen</button>}
                  {isInvoice() && invActions(viewing).canUpdateWave && <button onClick={function () { var row = viewing; updateInWave(row); }} disabled={busy} className="text-[11px] bg-violet-700 hover:bg-violet-600 text-white rounded px-2 py-1 font-bold" title="Wave has no edit — deletes the old Wave copy and recreates it from this amended invoice">🔁 Update in Wave</button>}
                  {editable && mayEdit && <button onClick={function () { var row = viewing; setViewing(null); startEdit(row); }} className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1 font-bold">Edit</button>}
                  {mayEdit && <button onClick={function () { var row = viewing; setViewing(null); startDuplicate(row); }} className="text-[11px] bg-teal-700 hover:bg-teal-600 text-white rounded px-2 py-1 font-bold">⧉ Duplicate</button>}
                  <button onClick={function () { setViewing(null); }} className="text-slate-300 hover:text-white text-sm px-2">✕</button>
                </div>
              </div>
              <div className="p-3 text-slate-100 text-xs">
                <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <Field label="Customer" value={custName(viewing.accounting_customer_id)} />
                  <Field label={isInvoice() ? 'Invoice date' : 'Date'} value={(isInvoice() ? viewing.invoice_date : viewing.proforma_date) || '—'} />
                  <Field label={isInvoice() ? 'Due date' : 'Valid until'} value={(isInvoice() ? viewing.due_date : viewing.valid_until) || '—'} />
                  <Field label="Status" value={labelStatus(isInvoice() ? viewing.approval_status : viewing.status) + (isInvoice() ? ' · ' + vc.paymentStatus : (viewing.payment_status ? ' · ' + viewing.payment_status : ''))} />
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
                {/* v55.83-VZ — the proforma it came from / the invoices it made, and the signed proforma */}
                <ProformaLinkBox kind={isInvoice() ? 'invoice' : 'proforma'} docId={viewing.id} doc={viewing} mayEdit={mayEdit} toast={toast}
                  invoices={scopeIfRegistered(invoices, waveBiz, waveReg, true)} proformas={scopeIfRegistered(proformas, waveBiz, waveReg, true)} customerName={custName} linkMap={linkMap}
                  onOpenInvoice={openPeekInvoice} onOpenProforma={openPeekProforma} onChanged={loadLinkMap} />
                {/* v55.83-XD — customs invoices saved under this invoice: their own tables, counted nowhere */}
                {isInvoice() && <CustomsInvoiceBox invoice={viewing} items={viewItems} company={company} customer={customers.find(function (c) { return c.id === viewing.accounting_customer_id; }) || null} mayEdit={mayEdit} toast={toast} />}
              </div>
            </div>
          </div>
        );
      })()}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '88px 16px 32px' }} onClick={function () { if (!busy) setEditing(null); }}>
        <div className="border border-slate-700 rounded bg-slate-900 p-3 w-full" style={{ maxWidth: '900px', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }} onClick={function (e) { e.stopPropagation(); }}>
          <div className="flex items-center justify-between mb-2 sticky top-0 bg-slate-900 py-1 z-10">
            <div className="font-extrabold">{editing === 'new' ? 'New' : 'Edit'} {isInvoice() ? 'invoice' : 'proforma'}{editing !== 'new' && locked(editing) ? ' (approved — locked)' : ''}</div>
            <button onClick={function () { setEditing(null); }} className="text-slate-400 hover:text-slate-200 text-xs">✕ close</button>
          </div>
          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Accounting customer *</span>
              <MiniTypeahead items={scopedCustomers} value={hdr.accounting_customer_id} disabled={locked(editing)} getLabel={function (c) { return c.company_name || c.contact_name || c.id; }} onPick={function (id) { uh('accounting_customer_id', id); }} placeholder="Search customer…" /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{isInvoice() ? 'Invoice #' : 'Proforma #'}</span><input value={(isInvoice() ? hdr.invoice_number : hdr.proforma_number) || ''} disabled={locked(editing)} onChange={function (e) { uh(isInvoice() ? 'invoice_number' : 'proforma_number', e.target.value); }} className={inp} /></label>
            {/* v55.83-NO — the SECOND reference. NextTrade orders only carry a
                release number; joining the two systems needs it here too. */}
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Release # <span className="text-slate-500">(warehouse order, e.g. 1002-1193)</span></span><input value={hdr.release_number || ''} disabled={locked(editing)} onChange={function (e) { uh('release_number', e.target.value); }} placeholder="optional" className={inp} /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{isInvoice() ? 'Invoice date' : 'Date'}</span><input type="date" value={(isInvoice() ? hdr.invoice_date : hdr.proforma_date) || ''} disabled={locked(editing)} onChange={function (e) { uh(isInvoice() ? 'invoice_date' : 'proforma_date', e.target.value); }} className={inp} /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{isInvoice() ? 'Due date' : 'Valid until'}</span><input type="date" value={(isInvoice() ? hdr.due_date : hdr.valid_until) || ''} disabled={locked(editing)} onChange={function (e) { uh(isInvoice() ? 'due_date' : 'valid_until', e.target.value); }} className={inp} /></label>
          </div>

          {isInvoice() && (function () { // v55.83-TG — shipping terms: required, one value
            var st = hdr.shipping_terms || '';
            var shipAmt = items.reduce(function (t, it) { return t + (isTransportLine(it.description) ? itemTotal(it) : 0); }, 0);
            var c = Number(hdr.shipping_cost_estimate) || 0;
            var noLineExw = st === 'EXW'; // v55.83-YP (Max, Nov 24): EXW never has a shipping cost
            var actual7 = shipCostIsActual();
            return (
              <div id="nt-invoice-shipping" className="mb-2 rounded p-2" style={{ border: '2px solid ' + (st ? '#334155' : '#f59e0b'), background: st ? 'transparent' : 'rgba(245,158,11,0.08)' }}>
                <div className="text-[11px] font-bold text-slate-200 mb-1">Shipping terms * <span className="font-normal text-slate-400">(pick one — required)</span></div>
                <div className="flex flex-wrap gap-3 mb-1">
                  {SHIPPING_TERMS.map(function (k) { return (
                    <label key={k} className="flex items-center gap-1 text-xs text-slate-100 cursor-pointer">
                      <input type="radio" name="ship_terms" checked={st === k} disabled={locked(editing)} onChange={function () { var costNow = k === 'EXW' ? '' : (hdr.shipping_cost_estimate || ''); setHdr(function (h) { var n = Object.assign({}, h, { shipping_terms: k }); if (k === 'EXW') { n.shipping_cost_estimate = ''; } return n; }); if (k === 'CNF_SEPARATE') { autoShipLine(costNow, k); } }} />{SHIPPING_TERMS_WORDS[k]}
                    </label>); })}
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                  <span>{'Our shipping cost (freight + trucking)' + (st === 'EXW' ? ' — none on EXW' : '')}</span>
                  <input id="nt-invoice-ship-cost" value={hdr.shipping_cost_estimate || ''} disabled={locked(editing) || noLineExw} onChange={function (e) { uh('shipping_cost_estimate', e.target.value); }} onBlur={function (e) { autoShipLine(e.target.value, st); }} placeholder={noLineExw ? 'none on EXW' : 'e.g. 5325'} className={inp} style={{ maxWidth: '140px' }} />
                  <span>estimate — the bills replace it when they arrive</span>
                </label>
                {/* v55.83-WH — the internal breakdown; saved for the release through the Profitability route, never into the invoice */}
                <ShippingPartsBox key={'spb-' + (shipFocus ? 'open' : 'closed')} initialOpen={shipFocus} releaseText={hdr.release_number} charged={shipAmt} terms={st} userId={userProfile && userProfile.id} toast={toast} disabled={false} onTotal={function (tot, info) { setShipActualFor(String(hdr.release_number || '').trim() || null); /* v55.83-YP: the complete breakdown = the actual costs */ if (locked(editing) || noLineExw) { return; } setHdr(function (h) { return Number(h.shipping_cost_estimate) === Number(tot) && String(h.shipping_cost_estimate || '') !== '' ? h : Object.assign({}, h, { shipping_cost_estimate: String(tot) }); }); if (info && info.fromSave) { var fl = fillShippingLine(items, tot, st, isTransportLine, blankItem); if (fl.changed) { setItems(fl.items); toast.success('The shipping line on this invoice is now $' + Number(tot).toFixed(2) + ' (the breakdown total). Save the invoice to keep it.'); } else if (fl.why === 'several_lines') { toast.error('This invoice has ' + fl.count + ' shipping lines, so the total was not put in for you. Set the amounts yourself.'); } } } /* v55.83-XV — the breakdown total fills the cost box; after a Save in the box, the shipping charge line too */} />
                {st === 'CNF_SEPARATE' && c > 0 && actual7 && <div className="text-[11px] mt-1" style={{ color: shipAmt + 0.005 >= minShippingCharge(c) ? '#86efac' : '#fca5a5' }}>{'Our actual shipping cost is typed, so the shipping line(s) should total at least $' + minShippingCharge(c).toFixed(2) + ' (cost + 7%). Now: $' + shipAmt.toFixed(2) + '. You may charge less with a written reason, or more freely.'}</div>}
                {st === 'CNF_SEPARATE' && c > 0 && !actual7 && <div className="text-[11px] mt-1" style={{ color: '#cbd5e1' }}>{'The cost above is your estimate, so nothing is checked yet. Shipping line now: $' + shipAmt.toFixed(2) + '. The cost + 7% check starts once the actual trucking and freight are typed under “Inside the shipping”.'}</div>}
                {/* v55.83-XV — the override: a written reason, required to save below cost + 7%, kept on the audit trail */}
                {st === 'CNF_SEPARATE' && actual7 && c > 0 && shipAmt > 0 && shipAmt + 0.005 < minShippingCharge(c) && <div id="nt-ship-override" className="rounded-lg p-2 mt-2" style={{ background: '#fef2f2', border: '2px solid #dc2626', color: '#450a0a' }}>
                  <div className="text-[12px] font-extrabold" style={{ color: '#7f1d1d' }}>{'Below cost + 7% by $' + (minShippingCharge(c) - shipAmt).toFixed(2) + ' — to save it anyway, write the reason'}</div>
                  <textarea value={hdr.markup_override_note || ''} disabled={locked(editing)} onChange={function (e) { uh('markup_override_note', e.target.value); }} rows={2} maxLength={500} placeholder="Why is the shipping charged below our cost + 7%? (for example: price agreed with the customer before the freight went up)" aria-label="Reason for charging shipping below cost plus 7 percent" className="nt-light w-full mt-1 px-2 py-1 rounded text-[12px]" style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #dc2626' }} />
                  <div className="text-[11px] mt-1" style={{ color: '#7f1d1d' }}>{'Required to save (at least ' + MARKUP_NOTE_MIN + ' characters). Saved on the audit trail with your name, the cost, the amount charged and the shortfall. The invoice still shows as a warning on the profit report.'}</div>
                </div>}
              </div>);
          })()}
          <div className="text-[11px] font-bold text-slate-200 mb-1">Line items</div>
          {(function () {
            var siloProducts = waveProducts.filter(function (p) { return (!waveBiz || waveBiz === 'all' || p.wave_business_id === waveBiz) && p.is_archived !== true; }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
            return items.map(function (it, i) {
            return (
              <div key={i} className="flex gap-1 mb-1 items-center flex-wrap">
                {/* v55.83-IY — per-line Wave product selector (the product Wave receives on push) */}
                {/* v55.83-MS — per-line Wave product selector = the required Wave accounting CARRIER for this
                    line. Options show the Wave name + description to help pick; selecting it is metadata only and
                    does NOT change your line description, which pushes to Wave exactly as typed. Optional — a
                    line with no product uses the Settings default product as the fallback carrier. */}
                <select value={it.wave_product_id || ''} disabled={locked(editing) && !it.id} onChange={function (e) { onLineProductChange(i, e.target.value); }} className="w-44 bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-xs" title="Wave product carrier for this line (optional — falls back to the Settings default). You can set/change this even on an approved invoice: it's saved as sync metadata only and does NOT change the description, amount, or approval. Your line description pushes to Wave exactly as typed. Pull the silo's products in Wave Sync Center if empty.">
                  <option value="">{siloProducts.length ? '— Wave product (uses default) —' : '— no products pulled —'}</option>
                  {siloProducts.map(function (p) { var d = (p.description && p.description.trim()) ? (' — ' + p.description.substring(0, 40)) : ''; return <option key={p.wave_product_id} value={p.wave_product_id}>{(p.name || p.wave_product_id) + d}</option>; })}
                </select>
                <input value={it.description} disabled={locked(editing)} onChange={function (e) { ui(i, 'description', e.target.value); }} placeholder="Line description (sent to Wave)" title="This text is the Wave line description on push — it pushes exactly as typed. Picking a Wave product above is just the accounting carrier and does NOT change this text." className={inp + ' flex-1'} />
                <input value={it.quantity} disabled={locked(editing)} onChange={function (e) { ui(i, 'quantity', e.target.value); }} placeholder="Qty" className="w-16 bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-xs" />
                <input value={it.unit_price} disabled={locked(editing)} onChange={function (e) { ui(i, 'unit_price', e.target.value); }} placeholder="Unit" className="w-20 bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-xs" />
                <div className="w-24 text-right text-xs font-mono text-slate-200">{fmt(itemTotal(it))}</div>
                {!locked(editing) && <button onClick={function () { rmItem(i); }} className="text-rose-300 text-xs px-1 font-bold">✕</button>}
              </div>
            );
            });
          })()}
          {!locked(editing) && <button onClick={addItem} className="text-[11px] text-indigo-300 font-bold mb-2">+ add line</button>}
          {!locked(editing) && <button onClick={function () { setItems(items.concat([{ description: 'Discount', quantity: '1', unit_price: '-0.00', sku: '', product_ref: '', wave_product_id: '', wave_product_name: '' }])); }}
            title="v55.83-QM (Max): discounts on invoices — a discount is a NEGATIVE line, so every total, balance, report and Wave push stays exact with zero special cases. Type the discount as a negative price."
            className="text-[11px] text-emerald-300 font-bold mb-2 ml-3">− add discount line</button>}
          <div className="text-right text-sm font-bold mb-2">Total: {fmt(liveTotal)}</div>

          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Notes</span><textarea rows={2} value={hdr.notes || ''} disabled={locked(editing)} onChange={function (e) { uh('notes', e.target.value); }} className={inp} /></label>
            <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">Terms</span><textarea rows={2} value={hdr.terms || ''} disabled={locked(editing)} onChange={function (e) { uh('terms', e.target.value); }} className={inp} /></label>
          </div>
          {editing !== 'new' && editing.id && <div className="mb-2"><ProformaLinkBox kind={isInvoice() ? 'invoice' : 'proforma'} docId={editing.id} doc={editing} mayEdit={mayEdit} toast={toast}
                  invoices={scopeIfRegistered(invoices, waveBiz, waveReg, true)} proformas={scopeIfRegistered(proformas, waveBiz, waveReg, true)} customerName={custName} linkMap={linkMap}
                  onOpenInvoice={openPeekInvoice} onOpenProforma={openPeekProforma} onChanged={loadLinkMap} /></div>}
          {mayEdit && !locked(editing) && (
            <div className="flex gap-2 flex-wrap">
              {saveBlock && <span className="text-[11px] font-bold mr-2" style={{ color: '#fca5a5', maxWidth: 520 }}>⛔ Not saved: {saveBlock}</span>}
              <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={function () { setEditing(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-bold">Cancel</button>
              {isInvoice() && editing !== 'new' && invActions(editing).canSubmit && <button onClick={function () { var row = editing; setApproval(row, 'internal_review'); }} disabled={busy} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold">Submit for Review</button>}
              {isInvoice() && editing !== 'new' && invActions(editing).canApprove && <button onClick={function () { var row = editing; setApproval(row, 'approved'); }} disabled={busy} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold">Approve</button>}
              {null}
            </div>
          )}
          {mayEdit && editing !== 'new' && (function () {
            var lc = isInvoice() ? invoiceLifecycle(editing, { paymentMatchCount: pmCount[editing.id] ? 1 : 0 }, userProfile && userProfile.role, mayLifecycle) : proformaLifecycle(editing, userProfile && userProfile.role, mayLifecycle);
            return (
              <div className="flex gap-2 mt-2 flex-wrap items-center border-t border-slate-700 pt-2">
                {editing.record_status && editing.record_status !== 'active' && <span className="text-[11px] bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold">{String(editing.record_status).toUpperCase()}</span>}
                {lc.canHardDelete && <button onClick={function () { doLcDelete(editing); }} className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-bold">Delete</button>}
                {lc.canVoid && <button onClick={function () { doLcVoid(editing, 'void'); }} className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded text-xs font-bold">Void</button>}
                {lc.canCancel && <button onClick={function () { doLcVoid(editing, 'cancelled'); }} className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded text-xs font-bold">Mark cancelled</button>}
                {lc.canArchive && <button onClick={function () { doLcArchive(editing); }} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold">Archive</button>}
                {lc.canRestore && <button onClick={function () { doLcRestore(editing); }} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">Restore</button>}
                {/* v55.83-NC — a Wave-linked Hub invoice can now be deleted THROUGH
                    Wave. The plain lifecycle Delete stays blocked (its blocker is
                    correct: a Hub-only delete would orphan the Wave copy); this
                    button takes the safe route instead. */}
                {!lc.canHardDelete && isInvoice() && !!editing.wave_invoice_id && editing.source !== 'wave_import' && mayLifecycle &&
                  <button onClick={function () { deleteWithWave(editing); }} disabled={busy} className="px-3 py-1.5 bg-rose-800 hover:bg-rose-700 text-white rounded text-xs font-bold" title="Deletes the Wave copy first, then the Hub invoice">🗑 Delete (incl. Wave)</button>}
                {!lc.canHardDelete && lc.blockReason && <span className="text-[11px] text-amber-300 font-semibold">{lc.blockReason}</span>}
              </div>
            );
          })()}
        </div>
        </div>
      )}
      {/* v55.83-VZ — the linked document, opened on top of whatever is on screen */}
      <InvoicePeek invoiceId={peekInv} onClose={function () { setPeekInv(null); }} onOpenProforma={openPeekProforma} />
      <ProformaPeek proformaId={peekPf} onClose={function () { setPeekPf(null); }} onOpenInvoice={openPeekInvoice} />
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
