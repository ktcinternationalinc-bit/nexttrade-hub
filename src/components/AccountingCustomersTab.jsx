// v55.83-AB — US accounting customer master (separate from Egypt CRM).
// Everything in the banking/accounting workflow links to accounting_customer_id.
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { canViewBank, canEditMappings } from '../lib/bank-permissions';

var BLANK = {
  company_name: '', contact_name: '', email: '', phone: '',
  billing_address: '', shipping_address: '', tax_id: '',
  status: 'active', credit_limit: '', notes: '',
};

export default function AccountingCustomersTab(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var [businessId, setBusinessId] = useState(props.businessId || null);

  var mayView = canViewBank(isSuperAdmin, modulePerms);
  var mayEdit = canEditMappings(isSuperAdmin, modulePerms);

  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState('');
  var [editing, setEditing] = useState(null);      // null | 'new' | row
  var [form, setForm] = useState(BLANK);
  var [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    if (!businessId) { supabase.from('businesses').select('id').limit(1).then(function (b) { if (b && b.data && b.data[0]) setBusinessId(b.data[0].id); }).catch(function () {}); }
    supabase.from('accounting_customers').select('*').order('company_name', { ascending: true })
      .then(function (r) { setRows((r && r.data) || []); })
      .catch(function (e) { console.error('[acctcust] load', e); toast.error('Failed to load accounting customers'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  function startNew() { setForm(Object.assign({}, BLANK)); setEditing('new'); }
  function startEdit(row) {
    setForm({
      company_name: row.company_name || '', contact_name: row.contact_name || '', email: row.email || '', phone: row.phone || '',
      billing_address: row.billing_address || '', shipping_address: row.shipping_address || '', tax_id: row.tax_id || '',
      status: row.status || 'active', credit_limit: row.credit_limit != null ? String(row.credit_limit) : '', notes: row.notes || '',
    });
    setEditing(row);
  }
  function upd(k, v) { var c = Object.assign({}, form); c[k] = v; setForm(c); }

  function save() {
    if (!mayEdit) { toast.error('You do not have permission to manage accounting customers.'); return; }
    if (!form.company_name.trim()) { toast.error('Company name is required.'); return; }
    setBusy(true);
    var payload = {
      company_name: form.company_name.trim(), contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null, phone: form.phone.trim() || null,
      billing_address: form.billing_address.trim() || null, shipping_address: form.shipping_address.trim() || null,
      tax_id: form.tax_id.trim() || null, status: form.status,
      credit_limit: form.credit_limit === '' ? null : Number(form.credit_limit),
      notes: form.notes.trim() || null, updated_by: userProfile && userProfile.id,
    };
    var done;
    if (editing === 'new') {
      payload.business_id = businessId;
      payload.created_by = userProfile && userProfile.id;
      done = dbInsert('accounting_customers', payload, userProfile && userProfile.id)
        .then(function () { return logActivity(userProfile && userProfile.id, 'Added accounting customer ' + payload.company_name, 'accounting_customers'); });
    } else {
      done = dbUpdate('accounting_customers', editing.id, payload, userProfile && userProfile.id)
        .then(function () { return logActivity(userProfile && userProfile.id, 'Updated accounting customer ' + payload.company_name, 'accounting_customers'); });
    }
    done.then(function () { toast.success('Saved'); setEditing(null); load(); })
      .catch(function (e) { toast.error('Save failed: ' + (e && e.message)); })
      .finally(function () { setBusy(false); });
  }

  if (!mayView) {
    return (
      <div className="p-6">
        <div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 text-amber-950">
          <div className="font-extrabold">🔒 Restricted</div>
          <div className="text-sm font-medium mt-1">Viewing accounting customers requires the Bank: View permission.</div>
        </div>
      </div>
    );
  }
  if (loading) return <div className="p-6 text-slate-300">Loading accounting customers…</div>;

  var filtered = rows.filter(function (r) {
    if (!search.trim()) return true;
    var q = search.trim().toLowerCase();
    return (r.company_name || '').toLowerCase().indexOf(q) >= 0
      || (r.contact_name || '').toLowerCase().indexOf(q) >= 0
      || (r.email || '').toLowerCase().indexOf(q) >= 0;
  });

  return (
    <div className="p-4 text-slate-100">
      <div className="flex items-center justify-between mb-1">
        <div className="text-lg font-extrabold">👤 Accounting Customers <span className="text-[11px] font-medium text-slate-400">(US accounting — separate from Egypt CRM)</span></div>
        {mayEdit && <button onClick={startNew} className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded font-bold">+ New customer</button>}
      </div>
      <div className="bg-white text-slate-900 rounded p-2 text-xs font-medium mb-3">
        This list is intentionally empty until you add US customers here. Egypt CRM customers are <b>not</b> copied in — add accounting customers manually as you need them.
      </div>

      <input placeholder="Search company / contact / email" value={search} onChange={function (e) { setSearch(e.target.value); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs mb-2" />

      <div className="border border-slate-700 rounded overflow-hidden mb-4">
        <div className="bg-slate-800/70 text-[11px] font-extrabold grid" style={{ gridTemplateColumns: '1fr 1fr 140px 90px 90px' }}>
          <div className="px-2 py-1.5">Company</div><div className="px-2 py-1.5">Contact</div><div className="px-2 py-1.5">Email</div><div className="px-2 py-1.5">Status</div><div className="px-2 py-1.5">Wave</div>
        </div>
        {filtered.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No accounting customers yet.</div> :
          filtered.map(function (r) {
            return (
              <div key={r.id} onClick={function () { startEdit(r); }} className="grid items-center border-t border-slate-800 cursor-pointer hover:bg-slate-800/50" style={{ gridTemplateColumns: '1fr 1fr 140px 90px 90px' }}>
                <div className="px-2 py-1.5 text-xs text-slate-100 truncate font-semibold">{r.company_name}</div>
                <div className="px-2 py-1.5 text-xs text-slate-300 truncate">{r.contact_name || '—'}</div>
                <div className="px-2 py-1.5 text-[11px] text-slate-300 truncate">{r.email || '—'}</div>
                <div className="px-2 py-1.5"><span className={'text-[10px] px-1.5 py-0.5 rounded font-bold ' + (r.status === 'active' ? 'bg-emerald-700 text-white' : r.status === 'on_hold' ? 'bg-amber-600 text-white' : 'bg-slate-600 text-white')}>{(r.status || 'active').replace('_', ' ')}</span></div>
                <div className="px-2 py-1.5 text-[10px] text-slate-400">{r.wave_customer_id ? 'linked' : (r.sync_status || 'not synced').replace('_', ' ')}</div>
              </div>
            );
          })}
      </div>

      {editing && (
        <div className="border border-slate-700 rounded bg-slate-900/60 p-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="font-extrabold text-slate-100">{editing === 'new' ? 'New accounting customer' : 'Edit accounting customer'}</div>
            <button onClick={function () { setEditing(null); }} className="text-slate-400 hover:text-slate-200 text-xs">✕ close</button>
          </div>
          {!mayEdit && <div className="bg-amber-100 text-amber-950 rounded p-2 text-xs font-semibold mb-2">View only — you don't have permission to edit accounting customers.</div>}
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Company name *"><input value={form.company_name} disabled={!mayEdit} onChange={function (e) { upd('company_name', e.target.value); }} className={inp} /></Field>
            <Field label="Contact name"><input value={form.contact_name} disabled={!mayEdit} onChange={function (e) { upd('contact_name', e.target.value); }} className={inp} /></Field>
            <Field label="Email"><input value={form.email} disabled={!mayEdit} onChange={function (e) { upd('email', e.target.value); }} className={inp} /></Field>
            <Field label="Phone"><input value={form.phone} disabled={!mayEdit} onChange={function (e) { upd('phone', e.target.value); }} className={inp} /></Field>
            <Field label="Billing address"><textarea rows={2} value={form.billing_address} disabled={!mayEdit} onChange={function (e) { upd('billing_address', e.target.value); }} className={inp} /></Field>
            <Field label="Shipping address"><textarea rows={2} value={form.shipping_address} disabled={!mayEdit} onChange={function (e) { upd('shipping_address', e.target.value); }} className={inp} /></Field>
            <Field label="Tax ID (optional)"><input value={form.tax_id} disabled={!mayEdit} onChange={function (e) { upd('tax_id', e.target.value); }} className={inp} /></Field>
            <Field label="Credit limit (optional)"><input value={form.credit_limit} disabled={!mayEdit} onChange={function (e) { upd('credit_limit', e.target.value); }} placeholder="e.g. 50000" className={inp} /></Field>
            <Field label="Status">
              <select value={form.status} disabled={!mayEdit} onChange={function (e) { upd('status', e.target.value); }} className={inp}>
                <option value="active">Active</option><option value="on_hold">On hold</option><option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="Wave customer (Phase 4)"><input value={(editing !== 'new' && editing.wave_customer_id) || ''} disabled className={inp + ' opacity-60'} placeholder="set during Wave sync" /></Field>
          </div>
          <Field label="Notes"><textarea rows={2} value={form.notes} disabled={!mayEdit} onChange={function (e) { upd('notes', e.target.value); }} className={inp} /></Field>
          {mayEdit && (
            <div className="flex gap-2 mt-2">
              <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={function () { setEditing(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-bold">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

var inp = 'w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs';
function Field(props) {
  return (
    <label className="block">
      <span className="block text-[11px] text-slate-400 mb-0.5">{props.label}</span>
      {props.children}
    </label>
  );
}
