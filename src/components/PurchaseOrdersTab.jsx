// v55.83-BM — Purchase Orders (INTERNAL print tool). Create, edit, list, and
// print/Save-PDF purchase orders. These never touch Wave, AR, or any financial
// report — purely an internal document the team can hand to suppliers.
import { useState, useEffect } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { canViewBank, canEditMappings, canCreateInvoice } from '../lib/bank-permissions';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function todayISO() { return new Date().toISOString().substring(0, 10); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export default function PurchaseOrdersTab(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var role = userProfile && userProfile.role;
  var mayView = isSuperAdmin || canViewBank(isSuperAdmin, modulePerms) || canCreateInvoice(isSuperAdmin, modulePerms);
  var mayEdit = isSuperAdmin || role === 'admin' || role === 'owner' || canEditMappings(isSuperAdmin, modulePerms) || canCreateInvoice(isSuperAdmin, modulePerms);

  var [rows, setRows] = useState([]);
  var [itemsByPo, setItemsByPo] = useState({});
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState('');
  var [busy, setBusy] = useState(false);
  var [editing, setEditing] = useState(null);   // 'new' | row | null
  var [hdr, setHdr] = useState(null);
  var [lines, setLines] = useState([]);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('purchase_order_items').select('*').order('sort_order', { ascending: true }).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
    ]).then(function (res) {
      var pos = (res[0] && res[0].data) || [];
      var its = (res[1] && res[1].data) || [];
      var map = {};
      its.forEach(function (it) { if (!map[it.po_id]) { map[it.po_id] = []; } map[it.po_id].push(it); });
      setRows(pos); setItemsByPo(map);
    }).finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  function startNew() {
    setEditing('new');
    setHdr({ po_number: '', supplier_name: '', supplier_contact: '', po_date: todayISO(), expected_date: '', currency: 'USD', status: 'open', notes: '', terms: '' });
    setLines([{ description: '', quantity: 1, unit_price: 0 }]);
  }
  function startEdit(row) {
    setEditing(row);
    setHdr({ po_number: row.po_number || '', supplier_name: row.supplier_name || '', supplier_contact: row.supplier_contact || '', po_date: row.po_date || todayISO(), expected_date: row.expected_date || '', currency: row.currency || 'USD', status: row.status || 'open', notes: row.notes || '', terms: row.terms || '' });
    var its = (itemsByPo[row.id] || []).map(function (it) { return { description: it.description || '', quantity: it.quantity, unit_price: it.unit_price }; });
    setLines(its.length ? its : [{ description: '', quantity: 1, unit_price: 0 }]);
  }
  function setLine(i, k, v) { var copy = lines.slice(); copy[i] = Object.assign({}, copy[i]); copy[i][k] = v; setLines(copy); }
  function addLine() { setLines(lines.concat([{ description: '', quantity: 1, unit_price: 0 }])); }
  function delLine(i) { setLines(lines.filter(function (_, ix) { return ix !== i; })); }
  function lineTotal(l) { return r2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)); }
  function grandTotal() { return r2(lines.reduce(function (a, l) { return a + lineTotal(l); }, 0)); }

  function save() {
    if (!mayEdit) return;
    if (!hdr.supplier_name) { alert('Supplier name is required.'); return; }
    setBusy(true);
    var total = grandTotal();
    var payload = {
      po_number: hdr.po_number || null, supplier_name: hdr.supplier_name, supplier_contact: hdr.supplier_contact || null,
      po_date: hdr.po_date || null, expected_date: hdr.expected_date || null, currency: hdr.currency || 'USD',
      status: hdr.status || 'open', notes: hdr.notes || null, terms: hdr.terms || null, total_amount: total,
      updated_by: userProfile && userProfile.id
    };
    var p;
    if (editing === 'new') { payload.created_by = userProfile && userProfile.id; p = dbInsert('purchase_orders', payload); }
    else { p = dbUpdate('purchase_orders', editing.id, payload, userProfile && userProfile.id).then(function () { return { id: editing.id }; }); }
    p.then(function (poRow) {
      var poId = poRow && poRow.id ? poRow.id : (editing !== 'new' ? editing.id : null);
      if (!poId) { throw new Error('Could not save purchase order header.'); }
      return supabase.from('purchase_order_items').delete().eq('po_id', poId).then(function () {
        var itemRows = lines.filter(function (l) { return (l.description || '').trim() || Number(l.quantity) || Number(l.unit_price); })
          .map(function (l, ix) { return { po_id: poId, description: l.description || null, quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0, line_total: lineTotal(l), sort_order: ix }; });
        if (!itemRows.length) { return { id: poId }; }
        return supabase.from('purchase_order_items').insert(itemRows).then(function () { return { id: poId }; });
      });
    }).then(function (res) {
      return logActivity(userProfile && userProfile.id, (editing === 'new' ? 'Created' : 'Updated') + ' purchase order ' + (hdr.po_number || hdr.supplier_name) + ' (' + fmt(total) + ')', 'purchase_orders').then(function () { return res; });
    }).then(function () { setEditing(null); load(); })
      .catch(function (e) { alert('Save failed: ' + (e && e.message ? e.message : e)); })
      .finally(function () { setBusy(false); });
  }

  function removePo(row) {
    if (!mayEdit) return;
    if (!window.confirm('Delete purchase order ' + (row.po_number || row.supplier_name) + '? This cannot be undone.')) return;
    setBusy(true);
    supabase.from('purchase_order_items').delete().eq('po_id', row.id)
      .then(function () { return dbDelete('purchase_orders', row.id, userProfile && userProfile.id); })
      .then(function () { return logActivity(userProfile && userProfile.id, 'Deleted purchase order ' + (row.po_number || row.supplier_name), 'purchase_orders'); })
      .then(function () { load(); }).catch(function (e) { alert('Delete failed: ' + e); }).finally(function () { setBusy(false); });
  }

  function printPo(row) {
    var its = itemsByPo[row.id] || [];
    var company = (props.companyProfile && props.companyProfile.company_name) || 'KTC International Inc.';
    var rowsHtml = its.map(function (it) {
      return '<tr><td>' + esc(it.description) + '</td><td style="text-align:right">' + esc(it.quantity) + '</td><td style="text-align:right">' + fmt(it.unit_price) + '</td><td style="text-align:right">' + fmt(it.line_total) + '</td></tr>';
    }).join('');
    var html = '<html><head><title>PO ' + esc(row.po_number || row.id) + '</title>'
      + '<style>body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:32px;}h1{margin:0 0 4px;}table{width:100%;border-collapse:collapse;margin-top:16px;}th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:13px;}th{background:#f1f5f9;text-align:left;}.meta{font-size:13px;color:#334155;margin-top:8px;}.tot{text-align:right;font-weight:bold;font-size:15px;margin-top:10px;}</style></head><body>'
      + '<h1>PURCHASE ORDER</h1>'
      + '<div class="meta"><b>' + esc(company) + '</b></div>'
      + '<div class="meta">PO #: <b>' + esc(row.po_number || '—') + '</b> &nbsp; Date: ' + esc(row.po_date || '—') + (row.expected_date ? ' &nbsp; Expected: ' + esc(row.expected_date) : '') + '</div>'
      + '<div class="meta">Supplier: <b>' + esc(row.supplier_name || '—') + '</b>' + (row.supplier_contact ? ' &nbsp; (' + esc(row.supplier_contact) + ')' : '') + '</div>'
      + '<table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Line total</th></tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="4">No items</td></tr>') + '</tbody></table>'
      + '<div class="tot">Total (' + esc(row.currency || 'USD') + '): ' + fmt(row.total_amount) + '</div>'
      + (row.terms ? '<div class="meta" style="margin-top:14px"><b>Terms:</b> ' + esc(row.terms) + '</div>' : '')
      + (row.notes ? '<div class="meta"><b>Notes:</b> ' + esc(row.notes) + '</div>' : '')
      + '<div class="meta" style="margin-top:24px;color:#64748b">Internal purchase order — not a financial/AR document.</div>'
      + '<script>window.onload=function(){window.print();}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  if (!mayView) return <div className="p-6"><RestrictedNotice title="Restricted" /></div>;
  if (loading) return <div className="p-4 text-slate-400 text-sm">Loading purchase orders…</div>;

  var shown = rows.filter(function (r) {
    if (!search.trim()) return true;
    var q = search.toLowerCase();
    return (r.po_number || '').toLowerCase().indexOf(q) >= 0 || (r.supplier_name || '').toLowerCase().indexOf(q) >= 0;
  });

  return (
    <div className="p-4 text-slate-100">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-lg font-extrabold">📦 Purchase Orders</div>
          <div className="text-[11px] text-slate-400">Internal create &amp; print tool — does not affect Wave, AR, or any report.</div>
        </div>
        {mayEdit && <button onClick={startNew} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">+ New purchase order</button>}
      </div>

      <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search PO # or supplier…" className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-slate-100 text-xs w-full max-w-md mb-3" />

      <div className="bg-white text-slate-900 rounded-lg overflow-hidden">
        <div className="grid text-[11px] font-extrabold text-slate-600 bg-slate-100 px-2 py-1" style={{ gridTemplateColumns: '110px 1fr 90px 90px 100px 150px' }}>
          <div>PO #</div><div>Supplier</div><div>Date</div><div>Status</div><div className="text-right">Total</div><div>Actions</div>
        </div>
        {shown.length === 0 ? <div className="px-3 py-4 text-xs text-slate-500 italic">No purchase orders yet.</div> :
          shown.map(function (r) {
            return (
              <div key={r.id} className="grid items-center text-[11px] border-t border-slate-100 px-2 py-1.5" style={{ gridTemplateColumns: '110px 1fr 90px 90px 100px 150px' }}>
                <div className="font-mono font-bold">{r.po_number || '—'}</div>
                <div className="truncate">{r.supplier_name}</div>
                <div>{r.po_date || '—'}</div>
                <div><span className="text-[10px] rounded px-1.5 py-0.5 font-bold bg-slate-200 text-slate-800">{r.status || 'open'}</span></div>
                <div className="text-right font-mono font-bold">{(r.currency || 'USD') + ' ' + fmt(r.total_amount)}</div>
                <div className="flex gap-1">
                  <button onClick={function () { printPo(r); }} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold">Print</button>
                  {mayEdit && <button onClick={function () { startEdit(r); }} className="text-[10px] bg-sky-700 hover:bg-sky-600 text-white rounded px-1.5 py-0.5 font-bold">Edit</button>}
                  {mayEdit && <button onClick={function () { removePo(r); }} disabled={busy} className="text-[10px] bg-rose-700 hover:bg-rose-600 text-white rounded px-1.5 py-0.5 font-bold">Delete</button>}
                </div>
              </div>
            );
          })}
      </div>

      {editing && hdr && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px' }} onClick={function () { if (!busy) setEditing(null); }}>
          <div className="bg-slate-900 border border-slate-600 rounded-xl w-full text-slate-100" style={{ maxWidth: '760px' }} onClick={function (e) { e.stopPropagation(); }}>
            <div className="flex items-center justify-between p-3 border-b border-slate-700">
              <div className="font-extrabold">{editing === 'new' ? 'New purchase order' : 'Edit purchase order'}</div>
              <button onClick={function () { setEditing(null); }} className="text-slate-300 hover:text-white px-2">✕</button>
            </div>
            <div className="p-3 text-xs space-y-2">
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <label className="block"><span className="text-[10px] text-slate-400">PO #</span><input value={hdr.po_number} onChange={function (e) { setHdr(Object.assign({}, hdr, { po_number: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
                <label className="block"><span className="text-[10px] text-slate-400">PO date</span><input type="date" value={hdr.po_date} onChange={function (e) { setHdr(Object.assign({}, hdr, { po_date: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
                <label className="block"><span className="text-[10px] text-slate-400">Expected date</span><input type="date" value={hdr.expected_date} onChange={function (e) { setHdr(Object.assign({}, hdr, { expected_date: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr' }}>
                <label className="block"><span className="text-[10px] text-slate-400">Supplier *</span><input value={hdr.supplier_name} onChange={function (e) { setHdr(Object.assign({}, hdr, { supplier_name: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
                <label className="block"><span className="text-[10px] text-slate-400">Supplier contact</span><input value={hdr.supplier_contact} onChange={function (e) { setHdr(Object.assign({}, hdr, { supplier_contact: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
                <label className="block"><span className="text-[10px] text-slate-400">Currency</span><input value={hdr.currency} onChange={function (e) { setHdr(Object.assign({}, hdr, { currency: e.target.value.toUpperCase() })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
                <label className="block"><span className="text-[10px] text-slate-400">Status</span>
                  <select value={hdr.status} onChange={function (e) { setHdr(Object.assign({}, hdr, { status: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100">
                    <option value="open">open</option><option value="received">received</option><option value="closed">closed</option><option value="cancelled">cancelled</option>
                  </select>
                </label>
              </div>

              <div className="mt-2">
                <div className="text-[11px] font-bold text-slate-300 mb-1">Line items</div>
                <div className="grid text-[10px] text-slate-400 font-bold mb-1" style={{ gridTemplateColumns: '1fr 70px 90px 90px 30px' }}><div>Description</div><div className="text-right">Qty</div><div className="text-right">Unit</div><div className="text-right">Total</div><div></div></div>
                {lines.map(function (l, i) {
                  return (
                    <div key={i} className="grid gap-1 mb-1 items-center" style={{ gridTemplateColumns: '1fr 70px 90px 90px 30px' }}>
                      <input value={l.description} onChange={function (e) { setLine(i, 'description', e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" />
                      <input type="number" value={l.quantity} onChange={function (e) { setLine(i, 'quantity', e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-right" />
                      <input type="number" value={l.unit_price} onChange={function (e) { setLine(i, 'unit_price', e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-1 py-1 text-slate-100 text-right" />
                      <div className="text-right font-mono text-slate-200">{fmt(lineTotal(l))}</div>
                      <button onClick={function () { delLine(i); }} className="text-rose-400 hover:text-rose-300 text-center">✕</button>
                    </div>
                  );
                })}
                <button onClick={addLine} className="text-[11px] bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-0.5 font-bold mt-1">+ Add line</button>
                <div className="text-right font-extrabold text-sm mt-2">Total: {hdr.currency} {fmt(grandTotal())}</div>
              </div>

              <label className="block"><span className="text-[10px] text-slate-400">Terms</span><input value={hdr.terms} onChange={function (e) { setHdr(Object.assign({}, hdr, { terms: e.target.value })); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>
              <label className="block"><span className="text-[10px] text-slate-400">Notes</span><textarea value={hdr.notes} onChange={function (e) { setHdr(Object.assign({}, hdr, { notes: e.target.value })); }} rows={2} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" /></label>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={function () { setEditing(null); }} className="px-3 py-1.5 bg-slate-700 text-white rounded font-bold">Cancel</button>
                <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save purchase order'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
