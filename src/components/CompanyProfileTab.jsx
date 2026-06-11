// v55.83-AH — Company Profile (singleton). Drives invoice/proforma branding.
// WAVE: maps to the Wave business; logo is Hub-only for our printed PDFs.
import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { canViewBank, canEditMappings } from '../lib/bank-permissions';

var BLANK = {
  company_name: '', address: '', phone: '', email: '', website: '', tax_id: '',
  default_invoice_notes: '', default_proforma_notes: '', default_payment_terms: '', logo_data_url: '',
};
var inp = 'w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs';

export default function CompanyProfileTab(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var mayView = canViewBank(isSuperAdmin, modulePerms);
  var mayEdit = canEditMappings(isSuperAdmin, modulePerms);

  var [form, setForm] = useState(BLANK);
  var [rowId, setRowId] = useState(null);
  var [businessId, setBusinessId] = useState(null);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('businesses').select('id').limit(1),
      supabase.from('company_profile').select('*').limit(1),
    ]).then(function (r) {
      var b = r[0] && r[0].data && r[0].data[0];
      if (b) setBusinessId(b.id);
      var p = r[1] && r[1].data && r[1].data[0];
      if (p) {
        setRowId(p.id);
        setForm({
          company_name: p.company_name || '', address: p.address || '', phone: p.phone || '', email: p.email || '',
          website: p.website || '', tax_id: p.tax_id || '', default_invoice_notes: p.default_invoice_notes || '',
          default_proforma_notes: p.default_proforma_notes || '', default_payment_terms: p.default_payment_terms || '',
          logo_data_url: p.logo_data_url || '',
        });
      }
    }).catch(function (e) { console.error('[companyprofile] load', e); toast.error('Failed to load company profile'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  function upd(k, v) { var c = Object.assign({}, form); c[k] = v; setForm(c); }

  function onLogo(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 600 * 1024) { toast.error('Logo too large — please use an image under 600 KB.'); return; }
    var reader = new FileReader();
    reader.onload = function () { upd('logo_data_url', reader.result); };
    reader.onerror = function () { toast.error('Could not read that image.'); };
    reader.readAsDataURL(file);
  }

  function save() {
    if (!mayEdit) { toast.error('You do not have permission to edit the company profile.'); return; }
    setBusy(true);
    var payload = Object.assign({}, form, { updated_by: userProfile && userProfile.id });
    var done;
    if (rowId) {
      done = dbUpdate('company_profile', rowId, payload, userProfile && userProfile.id);
    } else {
      payload.business_id = businessId; payload.created_by = userProfile && userProfile.id;
      done = dbInsert('company_profile', payload, userProfile && userProfile.id).then(function (res) { if (res && res.id) setRowId(res.id); });
    }
    done.then(function () { return logActivity(userProfile && userProfile.id, 'Updated company profile', 'accounting_customers'); })
      .then(function () { toast.success('Company profile saved'); })
      .catch(function (e) { console.error('[save] company profile', e); toast.error('Save failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  if (!mayView) return <div className="p-6"><div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 text-amber-950"><div className="font-extrabold">🔒 Restricted</div></div></div>;
  if (loading) return <div className="p-6 text-slate-300">Loading company profile…</div>;

  return (
    <div className="p-4 text-slate-100 max-w-3xl">
      <div className="text-lg font-extrabold mb-1">🏢 Company Profile</div>
      <div className="bg-white text-slate-900 rounded p-2 text-xs font-medium mb-3">This information appears automatically on every invoice and proforma you print.</div>

      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Company name"><input value={form.company_name} disabled={!mayEdit} onChange={function (e) { upd('company_name', e.target.value); }} className={inp} /></Field>
        <Field label="Tax ID (optional)"><input value={form.tax_id} disabled={!mayEdit} onChange={function (e) { upd('tax_id', e.target.value); }} className={inp} /></Field>
        <Field label="Phone"><input value={form.phone} disabled={!mayEdit} onChange={function (e) { upd('phone', e.target.value); }} className={inp} /></Field>
        <Field label="Email"><input value={form.email} disabled={!mayEdit} onChange={function (e) { upd('email', e.target.value); }} className={inp} /></Field>
        <Field label="Website"><input value={form.website} disabled={!mayEdit} onChange={function (e) { upd('website', e.target.value); }} className={inp} /></Field>
        <Field label="Address"><textarea rows={2} value={form.address} disabled={!mayEdit} onChange={function (e) { upd('address', e.target.value); }} className={inp} /></Field>
      </div>

      <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Field label="Default payment terms"><textarea rows={2} value={form.default_payment_terms} disabled={!mayEdit} onChange={function (e) { upd('default_payment_terms', e.target.value); }} className={inp} /></Field>
        <Field label="Default invoice notes"><textarea rows={2} value={form.default_invoice_notes} disabled={!mayEdit} onChange={function (e) { upd('default_invoice_notes', e.target.value); }} className={inp} /></Field>
        <Field label="Default proforma notes"><textarea rows={2} value={form.default_proforma_notes} disabled={!mayEdit} onChange={function (e) { upd('default_proforma_notes', e.target.value); }} className={inp} /></Field>
      </div>

      <div className="mt-3">
        <div className="text-[11px] text-slate-400 mb-1">Company logo (PNG/JPG, under 600 KB)</div>
        <div className="flex items-center gap-3">
          {form.logo_data_url ? <img src={form.logo_data_url} alt="logo" style={{ maxHeight: '64px', maxWidth: '180px' }} className="bg-white rounded p-1" /> : <div className="text-slate-500 text-xs italic">No logo yet</div>}
          {mayEdit && <input type="file" accept="image/png,image/jpeg" onChange={onLogo} className="text-xs text-slate-300" />}
          {mayEdit && form.logo_data_url && <button onClick={function () { upd('logo_data_url', ''); }} className="text-[11px] text-rose-300 font-bold">remove</button>}
        </div>
      </div>

      {mayEdit && (
        <div className="mt-4">
          <button onClick={save} disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save company profile'}</button>
        </div>
      )}
    </div>
  );
}

function Field(props) {
  return <label className="block"><span className="block text-[11px] text-slate-400 mb-0.5">{props.label}</span>{props.children}</label>;
}
