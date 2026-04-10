'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';

const VAT_DEFAULT = 14;

export default function QuotesTab({ user, userProfile, isAdmin }) {
  const [view, setView] = useState('list'); // list | create | preview | companies
  const [companies, setCompanies] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [editCompany, setEditCompany] = useState(null);
  const [editQuote, setEditQuote] = useState(null);
  const [previewQuote, setPreviewQuote] = useState(null);
  const [loading, setLoading] = useState(true);

  // ───── Load Data ─────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: q }] = await Promise.all([
      supabase.from('quote_companies').select('*').order('name'),
      supabase.from('customer_quotes').select('*').order('created_at', { ascending: false }),
    ]);
    setCompanies(c || []);
    setQuotes(q || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ───── Company CRUD ─────
  const saveCompany = async (co) => {
    if (co.id) {
      await dbUpdate('quote_companies', co.id, co, user?.id);
    } else {
      await dbInsert('quote_companies', co, user?.id);
    }
    setEditCompany(null);
    load();
  };
  const deleteCompany = async (id) => {
    if (!confirm('Delete this company profile?')) return;
    await dbDelete('quote_companies', id, user?.id);
    load();
  };

  // ───── Quote CRUD ─────
  const saveQuote = async (qt) => {
    const record = {
      ...qt,
      line_items: JSON.stringify(qt.line_items || []),
    };
    delete record._company; // don't store joined obj
    if (qt.id) {
      await dbUpdate('customer_quotes', qt.id, record, user?.id);
    } else {
      record.created_by = user?.id;
      await dbInsert('customer_quotes', record, user?.id);
      await logActivity(user?.id, `Created quote ${qt.quote_number}`, 'quotes');
    }
    setEditQuote(null);
    setView('list');
    load();
  };
  const deleteQuote = async (id) => {
    if (!confirm('Delete this quote?')) return;
    await dbDelete('customer_quotes', id, user?.id);
    load();
  };

  // ───── Auto quote number ─────
  const nextQuoteNumber = () => {
    const yr = new Date().getFullYear();
    const existing = quotes.filter(q => (q.quote_number || '').startsWith('QT-' + yr));
    const max = existing.reduce((m, q) => {
      const n = parseInt((q.quote_number || '').split('-').pop()) || 0;
      return n > m ? n : m;
    }, 0);
    return `QT-${yr}-${String(max + 1).padStart(4, '0')}`;
  };

  // ───── VIEWS ─────
  if (loading) return <div className="text-center py-12 text-slate-400">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-extrabold">📋 Quotes / عروض الأسعار</h2>
        <div className="flex gap-1.5">
          <button onClick={() => setView('companies')} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200">🏢 Companies</button>
          <button onClick={() => { setEditQuote({ quote_number: nextQuoteNumber(), date: new Date().toISOString().split('T')[0], validity_days: 30, vat_rate: VAT_DEFAULT, include_vat: false, line_items: [{ description: '', qty: 1, unit_price: 0 }], notes: '', status: 'draft' }); setView('create'); }}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">+ New Quote</button>
        </div>
      </div>

      {/* ===== COMPANY MANAGEMENT ===== */}
      {view === 'companies' && (
        <CompanyManager companies={companies} onSave={saveCompany} onDelete={deleteCompany}
          editCompany={editCompany} setEditCompany={setEditCompany} onBack={() => setView('list')} />
      )}

      {/* ===== QUOTE BUILDER ===== */}
      {view === 'create' && editQuote && (
        <QuoteBuilder quote={editQuote} companies={companies} onSave={saveQuote}
          onCancel={() => { setEditQuote(null); setView('list'); }} />
      )}

      {/* ===== QUOTE PREVIEW / PDF ===== */}
      {view === 'preview' && previewQuote && (
        <QuotePreview quote={previewQuote} companies={companies} onClose={() => { setPreviewQuote(null); setView('list'); }} />
      )}

      {/* ===== QUOTE LIST ===== */}
      {view === 'list' && (
        <QuoteList quotes={quotes} companies={companies} onEdit={(qt) => {
          setEditQuote({ ...qt, line_items: typeof qt.line_items === 'string' ? JSON.parse(qt.line_items) : (qt.line_items || []) });
          setView('create');
        }} onPreview={(qt) => {
          setPreviewQuote({ ...qt, line_items: typeof qt.line_items === 'string' ? JSON.parse(qt.line_items) : (qt.line_items || []) });
          setView('preview');
        }} onDelete={deleteQuote} />
      )}
    </div>
  );
}

// ============================================================
//  COMPANY MANAGER
// ============================================================
function CompanyManager({ companies, onSave, onDelete, editCompany, setEditCompany, onBack }) {
  const [form, setForm] = useState(editCompany || { name: '', address: '', phone: '', email: '', website: '', logo_url: '', tax_id: '' });
  const fileRef = useRef();

  useEffect(() => {
    if (editCompany) setForm(editCompany);
    else setForm({ name: '', address: '', phone: '', email: '', website: '', logo_url: '', tax_id: '' });
  }, [editCompany]);

  const handleLogo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm(f => ({ ...f, logo_url: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!form.name.trim()) { alert('Company name required'); return; }
    onSave({ ...form });
    setForm({ name: '', address: '', phone: '', email: '', website: '', logo_url: '', tax_id: '' });
  };

  return (
    <div>
      <button onClick={onBack} className="text-xs text-blue-500 font-semibold mb-3">← Back to Quotes</button>
      <div className="bg-white rounded-xl p-4 shadow-sm border mb-4">
        <h3 className="font-bold text-sm mb-3">{editCompany?.id ? 'Edit Company' : 'Add Company / إضافة شركة'}</h3>
        <div className="space-y-2">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company Name *" className="w-full border rounded-lg px-3 py-2 text-xs" />
          <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Address (multi-line)" rows={2} className="w-full border rounded-lg px-3 py-2 text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="border rounded-lg px-3 py-2 text-xs" />
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="border rounded-lg px-3 py-2 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="Website" className="border rounded-lg px-3 py-2 text-xs" />
            <input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="Tax ID / الرقم الضريبي" className="border rounded-lg px-3 py-2 text-xs" />
          </div>
          {/* Logo */}
          <div className="flex items-center gap-3">
            {form.logo_url && <img src={form.logo_url} alt="logo" className="h-12 w-auto rounded border" />}
            <div>
              <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold hover:bg-slate-200">
                {form.logo_url ? '🔄 Change Logo' : '📁 Upload Logo'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
              <p className="text-[9px] text-slate-400 mt-0.5">Recommended: PNG/SVG, transparent bg</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
            {editCompany?.id ? 'Update' : 'Add Company'}
          </button>
          {editCompany?.id && <button onClick={() => setEditCompany(null)} className="px-4 py-2 bg-slate-100 rounded-lg text-xs font-semibold">Cancel</button>}
        </div>
      </div>

      {/* Company list */}
      <div className="space-y-2">
        {companies.map(c => (
          <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm border flex items-center gap-3">
            {c.logo_url ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded object-contain border" /> : <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-lg">🏢</div>}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{c.name}</div>
              <div className="text-[10px] text-slate-400 truncate">{c.address || 'No address'} {c.tax_id ? `• Tax: ${c.tax_id}` : ''}</div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setEditCompany(c)} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-semibold">Edit</button>
              <button onClick={() => onDelete(c.id)} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-semibold">Delete</button>
            </div>
          </div>
        ))}
        {companies.length === 0 && <p className="text-center text-slate-400 text-xs py-6">No companies yet. Add one above.</p>}
      </div>
    </div>
  );
}

// ============================================================
//  QUOTE BUILDER
// ============================================================
function QuoteBuilder({ quote, companies, onSave, onCancel }) {
  const [q, setQ] = useState(quote);
  const set = (k, v) => setQ(prev => ({ ...prev, [k]: v }));

  const addLine = () => set('line_items', [...(q.line_items || []), { description: '', qty: 1, unit_price: 0 }]);
  const updateLine = (i, k, v) => {
    const items = [...(q.line_items || [])];
    items[i] = { ...items[i], [k]: v };
    set('line_items', items);
  };
  const removeLine = (i) => set('line_items', (q.line_items || []).filter((_, j) => j !== i));

  const subtotal = (q.line_items || []).reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unit_price) || 0), 0);
  const vatAmount = q.include_vat ? subtotal * (parseFloat(q.vat_rate) || VAT_DEFAULT) / 100 : 0;
  const total = subtotal + vatAmount;

  // Expiry date calc
  const expiryDate = q.date && q.validity_days ? new Date(new Date(q.date).getTime() + (parseInt(q.validity_days) || 30) * 86400000).toISOString().split('T')[0] : '';

  return (
    <div>
      <button onClick={onCancel} className="text-xs text-blue-500 font-semibold mb-3">← Back to Quotes</button>
      <div className="bg-white rounded-xl p-4 shadow-sm border mb-3">
        <h3 className="font-bold text-sm mb-3">{q.id ? 'Edit Quote' : 'New Quote / عرض سعر جديد'}</h3>

        {/* Top info */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Quote # / رقم</label>
            <input value={q.quote_number || ''} onChange={e => set('quote_number', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Company / الشركة</label>
            <select value={q.company_id || ''} onChange={e => set('company_id', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs">
              <option value="">Select company...</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Date / التاريخ</label>
            <input type="date" value={q.date || ''} onChange={e => set('date', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Validity (days)</label>
            <input type="number" value={q.validity_days || ''} onChange={e => set('validity_days', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs" />
            {expiryDate && <p className="text-[9px] text-slate-400 mt-0.5">Expires: {expiryDate}</p>}
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Client Name / العميل</label>
            <input value={q.client_name || ''} onChange={e => set('client_name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Client Email</label>
            <input value={q.client_email || ''} onChange={e => set('client_email', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Currency</label>
            <select value={q.currency || 'USD'} onChange={e => set('currency', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs">
              {['USD', 'EUR', 'EGP', 'GBP', 'SAR', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold">Status</label>
            <select value={q.status || 'draft'} onChange={e => set('status', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs">
              {['draft', 'sent', 'accepted', 'rejected', 'expired'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>

        {/* VAT toggle */}
        <div className="flex items-center gap-3 mb-3 p-2 bg-slate-50 rounded-lg">
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={q.include_vat || false} onChange={e => set('include_vat', e.target.checked)} className="rounded" />
            Include VAT / ضريبة
          </label>
          {q.include_vat && (
            <div className="flex items-center gap-1">
              <input type="number" value={q.vat_rate ?? VAT_DEFAULT} onChange={e => set('vat_rate', e.target.value)} className="w-16 border rounded px-2 py-1 text-xs text-center" />
              <span className="text-xs text-slate-500">%</span>
            </div>
          )}
        </div>

        {/* Line Items */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] text-slate-500 font-bold uppercase">Line Items / المنتجات</label>
            <button onClick={addLine} className="text-[10px] text-blue-500 font-bold">+ Add Line</button>
          </div>
          <div className="space-y-1.5">
            {(q.line_items || []).map((l, i) => (
              <div key={i} className="flex gap-1.5 items-start">
                <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Product / Description" className="flex-1 border rounded-lg px-2 py-1.5 text-xs" />
                <input type="number" value={l.qty} onChange={e => updateLine(i, 'qty', e.target.value)} placeholder="Qty" className="w-16 border rounded-lg px-2 py-1.5 text-xs text-center" />
                <input type="number" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} placeholder="Price" className="w-24 border rounded-lg px-2 py-1.5 text-xs text-right" />
                <div className="w-20 text-right text-xs font-bold pt-1.5">{((parseFloat(l.qty) || 0) * (parseFloat(l.unit_price) || 0)).toLocaleString()}</div>
                <button onClick={() => removeLine(i)} className="text-red-400 text-sm pt-1">✕</button>
              </div>
            ))}
          </div>
          {/* Totals */}
          <div className="mt-2 text-right space-y-0.5">
            <div className="text-xs text-slate-500">Subtotal: <span className="font-bold text-slate-700">{subtotal.toLocaleString()} {q.currency || 'USD'}</span></div>
            {q.include_vat && <div className="text-xs text-slate-500">VAT ({q.vat_rate || VAT_DEFAULT}%): <span className="font-bold text-slate-700">{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {q.currency || 'USD'}</span></div>}
            <div className="text-sm font-extrabold text-blue-700">Total: {total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {q.currency || 'USD'}</div>
          </div>
        </div>

        {/* Notes (internal) */}
        <div className="mb-3">
          <label className="text-[10px] text-slate-500 font-bold">Notes & Agreements / ملاحظات (shown on quote)</label>
          <textarea value={q.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Payment terms, special agreements, conditions..." className="w-full border rounded-lg px-3 py-2 text-xs mt-1" />
        </div>
        <div className="mb-3">
          <label className="text-[10px] text-slate-500 font-bold">Internal Comments / تعليقات داخلية (NOT on quote)</label>
          <textarea value={q.internal_notes || ''} onChange={e => set('internal_notes', e.target.value)} rows={2} placeholder="Internal notes for team only..." className="w-full border rounded-lg px-3 py-2 text-xs mt-1 bg-amber-50 border-amber-200" />
        </div>

        <div className="flex gap-2">
          <button onClick={() => onSave(q)} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">💾 Save Quote</button>
          <button onClick={onCancel} className="px-4 py-2 bg-slate-100 rounded-lg text-xs font-semibold">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  QUOTE LIST
// ============================================================
function QuoteList({ quotes, companies, onEdit, onPreview, onDelete }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = quotes.filter(q => {
    if (filter !== 'all' && q.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (q.quote_number || '').toLowerCase().includes(s) ||
        (q.client_name || '').toLowerCase().includes(s) ||
        companies.find(c => c.id === q.company_id)?.name?.toLowerCase()?.includes(s);
    }
    return true;
  });

  const statusColor = { draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-100 text-blue-600', accepted: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600', expired: 'bg-amber-100 text-amber-600' };

  return (
    <div>
      <div className="flex gap-1.5 mb-3 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes..." className="border rounded-lg px-3 py-1.5 text-xs flex-1 min-w-[120px]" />
        {['all', 'draft', 'sent', 'accepted', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold ${filter === s ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {s === 'all' ? `All (${quotes.length})` : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-2">📋</div>
          <p className="text-xs">No quotes yet. Create your first quote above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(qt => {
            const co = companies.find(c => c.id === qt.company_id);
            const items = typeof qt.line_items === 'string' ? JSON.parse(qt.line_items || '[]') : (qt.line_items || []);
            const subtotal = items.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unit_price) || 0), 0);
            const vatAmt = qt.include_vat ? subtotal * (parseFloat(qt.vat_rate) || VAT_DEFAULT) / 100 : 0;
            const total = subtotal + vatAmt;
            const expiry = qt.date && qt.validity_days ? new Date(new Date(qt.date).getTime() + (parseInt(qt.validity_days) || 30) * 86400000).toISOString().split('T')[0] : null;
            const isExp = expiry && expiry < new Date().toISOString().split('T')[0];

            return (
              <div key={qt.id} className="bg-white rounded-xl p-3 shadow-sm border">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{qt.quote_number}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${statusColor[qt.status] || statusColor.draft}`}>{qt.status}</span>
                      {isExp && qt.status !== 'expired' && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-600">EXPIRED</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {qt.client_name || 'No client'} {co ? `• ${co.name}` : ''} • {qt.date}
                      {expiry && ` → valid until ${expiry}`}
                    </div>
                    <div className="text-xs font-bold text-blue-700 mt-0.5">{total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {qt.currency || 'USD'}{qt.include_vat ? ` (incl. ${qt.vat_rate || VAT_DEFAULT}% VAT)` : ''}</div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => onPreview(qt)} className="px-2 py-1 bg-purple-50 text-purple-600 rounded text-[10px] font-semibold">📄 PDF</button>
                    <button onClick={() => onEdit(qt)} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-semibold">Edit</button>
                    <button onClick={() => onDelete(qt.id)} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-semibold">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  QUOTE PREVIEW + PDF
// ============================================================
function QuotePreview({ quote, companies, onClose }) {
  const printRef = useRef();
  const co = companies.find(c => c.id === quote.company_id) || {};
  const items = quote.line_items || [];
  const subtotal = items.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unit_price) || 0), 0);
  const vatRate = parseFloat(quote.vat_rate) || VAT_DEFAULT;
  const vatAmt = quote.include_vat ? subtotal * vatRate / 100 : 0;
  const total = subtotal + vatAmt;
  const cur = quote.currency || 'USD';
  const expiryDate = quote.date && quote.validity_days ? new Date(new Date(quote.date).getTime() + (parseInt(quote.validity_days) || 30) * 86400000).toISOString().split('T')[0] : '';
  const fmtN = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank', 'width=800,height=1100');
    win.document.write(`<!DOCTYPE html><html><head><title>Quote ${quote.quote_number}</title><style>
      @media print { body { margin: 0; } @page { margin: 20mm 15mm; } }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; line-height: 1.5; padding: 40px; }
      .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0ea5e9; padding-bottom: 20px; margin-bottom: 30px; }
      .logo { max-height: 60px; max-width: 180px; object-fit: contain; }
      .co { font-size: 20px; font-weight: 800; } .co-sub { font-size: 10px; color: #64748b; margin-top: 4px; white-space: pre-line; }
      .qt { font-size: 18px; font-weight: 800; color: #0ea5e9; text-align: right; }
      .qm { font-size: 10px; color: #64748b; text-align: right; margin-top: 4px; }
      .sec { margin-bottom: 24px; } .st { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #475569; }
      td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
      .ar { text-align: right; } .bl { font-weight: 700; }
      .tr td { border-top: 2px solid #0ea5e9; font-weight: 800; font-size: 14px; background: #f0f9ff; }
      .ft { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; text-align: center; }
      .vl { background: #fef3c7; padding: 10px 16px; border-radius: 6px; font-size: 11px; color: #92400e; margin-top: 16px; text-align: center; }
      .nt { background: #f8fafc; padding: 12px 16px; border-radius: 6px; font-size: 11px; color: #475569; margin-top: 12px; white-space: pre-wrap; }
      .client-box { background: #f8fafc; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; }
      .client-box .lbl { font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; } .client-box .val { font-size: 13px; font-weight: 600; }
    </style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-2 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[700px] my-4">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-bold">Quote Preview — {quote.quote_number}</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold">🖨️ Print / Save PDF</button>
            <button onClick={onClose} className="text-slate-400 text-lg px-2">✕</button>
          </div>
        </div>

        <div ref={printRef} className="p-6">
          {/* Header: Logo + Company | Quote Info */}
          <div className="hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0ea5e9', paddingBottom: '20px', marginBottom: '30px' }}>
            <div>
              {co.logo_url && <img src={co.logo_url} alt="" className="logo" style={{ maxHeight: '60px', maxWidth: '180px', objectFit: 'contain', marginBottom: '8px' }} />}
              <div className="co" style={{ fontSize: '20px', fontWeight: 800 }}>{co.name || 'Company'}</div>
              <div className="co-sub" style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', whiteSpace: 'pre-line' }}>
                {co.address}{co.phone ? `\n📞 ${co.phone}` : ''}{co.email ? `\n✉️ ${co.email}` : ''}{co.website ? `\n🌐 ${co.website}` : ''}{co.tax_id ? `\nTax ID: ${co.tax_id}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="qt" style={{ fontSize: '18px', fontWeight: 800, color: '#0ea5e9' }}>QUOTATION</div>
              <div className="qm" style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                {quote.quote_number}<br />Date: {quote.date}<br />{expiryDate ? `Valid until: ${expiryDate}` : ''}
              </div>
            </div>
          </div>

          {/* Client */}
          <div className="client-box" style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '6px', marginBottom: '20px' }}>
            <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Quoted To</div>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>{quote.client_name || '—'}</div>
            {quote.client_email && <div style={{ fontSize: '10px', color: '#64748b' }}>{quote.client_email}</div>}
          </div>

          {/* Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ background: '#f1f5f9', textAlign: 'left', padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>#</th>
                <th style={{ background: '#f1f5f9', textAlign: 'left', padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>Description</th>
                <th style={{ background: '#f1f5f9', textAlign: 'right', padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>Qty</th>
                <th style={{ background: '#f1f5f9', textAlign: 'right', padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>Unit Price</th>
                <th style={{ background: '#f1f5f9', textAlign: 'right', padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}>{i + 1}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}>{l.description || '—'}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '12px', textAlign: 'right' }}>{l.qty}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '12px', textAlign: 'right' }}>{fmtN(l.unit_price)} {cur}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '12px', textAlign: 'right', fontWeight: 700 }}>{fmtN((parseFloat(l.qty) || 0) * (parseFloat(l.unit_price) || 0))} {cur}</td>
                </tr>
              ))}
              {/* Subtotal */}
              <tr>
                <td colSpan={4} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600 }}>Subtotal</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 700 }}>{fmtN(subtotal)} {cur}</td>
              </tr>
              {quote.include_vat && (
                <tr>
                  <td colSpan={4} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600 }}>VAT ({vatRate}%)</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 700 }}>{fmtN(vatAmt)} {cur}</td>
                </tr>
              )}
              {/* Grand Total */}
              <tr className="tr">
                <td colSpan={4} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontWeight: 800, borderTop: '2px solid #0ea5e9', background: '#f0f9ff' }}>TOTAL</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontWeight: 800, borderTop: '2px solid #0ea5e9', background: '#f0f9ff' }}>{fmtN(total)} {cur}</td>
              </tr>
            </tbody>
          </table>

          {/* Notes */}
          {quote.notes && (
            <div className="nt" style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '6px', fontSize: '11px', color: '#475569', marginTop: '12px', whiteSpace: 'pre-wrap' }}>
              <strong>Notes & Terms:</strong><br />{quote.notes}
            </div>
          )}

          {/* Validity */}
          {expiryDate && (
            <div className="vl" style={{ background: '#fef3c7', padding: '10px 16px', borderRadius: '6px', fontSize: '11px', color: '#92400e', marginTop: '16px', textAlign: 'center' }}>
              This quotation is valid until <strong>{expiryDate}</strong>
            </div>
          )}

          <div className="ft" style={{ marginTop: '40px', paddingTop: '20px', borderTop: '1px solid #e2e8f0', fontSize: '9px', color: '#94a3b8', textAlign: 'center' }}>
            {co.name} {co.address ? `• ${co.address.replace(/\n/g, ' ')}` : ''} {co.phone ? `• ${co.phone}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
