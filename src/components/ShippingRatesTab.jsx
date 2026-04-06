'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { fmt } from '../lib/utils';
import * as XLSX from 'xlsx';

const CONTAINER_TYPES = ['20ft','40ft','40ft HC','LCL','FTL','LTL','bulk','breakbulk'];
const LANE_TYPES = ['ocean','trucking','air','rail','inland'];
const VENDOR_TYPES = ['shipping_line','freight_forwarder','trucker','broker','agent'];
const CURRENCIES = ['USD','EUR','EGP','GBP','SAR','AED','CNY','TRY'];
const RATE_PER = ['container','kg','cbm','ton','shipment','trip'];

const VENDOR_LABELS = { shipping_line:'Shipping Line', freight_forwarder:'Freight Forwarder', trucker:'Trucker', broker:'Broker', agent:'Agent' };
const LANE_LABELS = { ocean:'🚢 Ocean', trucking:'🚛 Trucking', air:'✈️ Air', rail:'🚂 Rail', inland:'📦 Inland' };
const LANE_ICONS = { ocean:'🚢', trucking:'🚛', air:'✈️', rail:'🚂', inland:'📦' };

const fCur = (n, cur='USD') => {
  if (n == null || isNaN(n) || n === 0) return '—';
  return cur + ' ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
};

export default function ShippingRatesTab({ user, isAdmin }) {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('lanes'); // lanes, list, add, import, compare
  const [search, setSearch] = useState('');
  const [filterLane, setFilterLane] = useState('all');
  const [filterVendor, setFilterVendor] = useState('all');
  const [filterContainer, setFilterContainer] = useState('all');
  const [selectedRate, setSelectedRate] = useState(null);
  const [editingRate, setEditingRate] = useState(null);
  const [form, setForm] = useState({});
  const [importData, setImportData] = useState([]);
  const [importStep, setImportStep] = useState('select');
  const [compareLane, setCompareLane] = useState(null);

  // Load rates
  const loadRates = async () => {
    try {
      let all = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from('shipping_rates').select('*').order('effective_date', { ascending: false }).range(from, from + 999);
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      setRates(all);
    } catch (e) {
      console.error('Error loading shipping rates:', e);
    }
    setLoading(false);
  };

  useEffect(() => { loadRates(); }, []);

  // Computed
  const lanes = useMemo(() => {
    const map = {};
    rates.forEach(r => {
      const key = r.origin + ' → ' + r.destination;
      if (!map[key]) map[key] = { origin: r.origin, destination: r.destination, origin_country: r.origin_country, destination_country: r.destination_country, lane_type: r.lane_type, rates: [], vendors: new Set(), bestRate: Infinity, latestDate: '' };
      map[key].rates.push(r);
      map[key].vendors.add(r.vendor_name);
      if (Number(r.rate_amount) < map[key].bestRate) map[key].bestRate = Number(r.rate_amount);
      if (r.effective_date > map[key].latestDate) map[key].latestDate = r.effective_date;
    });
    return Object.entries(map).sort((a, b) => b[1].latestDate.localeCompare(a[1].latestDate));
  }, [rates]);

  const vendors = useMemo(() => [...new Set(rates.map(r => r.vendor_name))].sort(), [rates]);
  const origins = useMemo(() => [...new Set(rates.map(r => r.origin))].sort(), [rates]);
  const destinations = useMemo(() => [...new Set(rates.map(r => r.destination))].sort(), [rates]);

  const filteredRates = useMemo(() => {
    let arr = rates;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(r =>
        (r.origin || '').toLowerCase().includes(q) ||
        (r.destination || '').toLowerCase().includes(q) ||
        (r.vendor_name || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.contract_ref || '').toLowerCase().includes(q)
      );
    }
    if (filterLane !== 'all') arr = arr.filter(r => r.lane_type === filterLane);
    if (filterVendor !== 'all') arr = arr.filter(r => r.vendor_name === filterVendor);
    if (filterContainer !== 'all') arr = arr.filter(r => r.container_type === filterContainer);
    return arr;
  }, [rates, search, filterLane, filterVendor, filterContainer]);

  // Save rate
  const handleSave = async () => {
    const f = form;
    if (!f.origin || !f.destination || !f.vendor_name || !f.rate_amount) {
      alert('Please fill origin, destination, vendor, and rate amount'); return;
    }
    try {
      const record = {
        origin: f.origin, origin_country: f.origin_country || '',
        destination: f.destination, destination_country: f.destination_country || '',
        lane_type: f.lane_type || 'ocean',
        vendor_name: f.vendor_name, vendor_type: f.vendor_type || 'shipping_line',
        container_type: f.container_type || '40ft HC',
        rate_amount: Number(f.rate_amount) || 0,
        rate_currency: f.rate_currency || 'USD',
        rate_per: f.rate_per || 'container',
        transit_days: f.transit_days ? Number(f.transit_days) : null,
        free_days: Number(f.free_days) || 0,
        detention_rate: Number(f.detention_rate) || 0,
        demurrage_rate: Number(f.demurrage_rate) || 0,
        port_fees: Number(f.port_fees) || 0,
        customs_fees: Number(f.customs_fees) || 0,
        inland_fees: Number(f.inland_fees) || 0,
        thc_fees: Number(f.thc_fees) || 0,
        doc_fees: Number(f.doc_fees) || 0,
        other_fees: Number(f.other_fees) || 0,
        other_fees_desc: f.other_fees_desc || '',
        effective_date: f.effective_date || new Date().toISOString().substring(0, 10),
        expiry_date: f.expiry_date || null,
        is_contract: f.is_contract || false,
        contract_ref: f.contract_ref || '',
        status: f.status || 'active',
        notes: f.notes || '',
      };
      if (editingRate) {
        await dbUpdate('shipping_rates', editingRate.id, record, user?.id);
      } else {
        await dbInsert('shipping_rates', record, user?.id);
      }
      setForm({});
      setEditingRate(null);
      setView('list');
      await loadRates();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this rate? / حذف هذا السعر؟')) return;
    try {
      await dbDelete('shipping_rates', id, user?.id);
      setSelectedRate(null);
      await loadRates();
    } catch (err) { alert('Error: ' + err.message); }
  };

  // Excel Import
  const processImport = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const parsed = rows.map(r => {
      // Try to match common column names
      const origin = r['Origin'] || r['origin'] || r['From'] || r['from'] || r['POL'] || '';
      const dest = r['Destination'] || r['destination'] || r['To'] || r['to'] || r['POD'] || '';
      const vendor = r['Vendor'] || r['vendor'] || r['Carrier'] || r['carrier'] || r['Shipping Line'] || r['Line'] || '';
      const rate = Number(r['Rate'] || r['rate'] || r['Amount'] || r['amount'] || r['Price'] || r['price'] || 0);
      const transit = Number(r['Transit'] || r['transit'] || r['Transit Days'] || r['transit_days'] || r['Days'] || 0) || null;
      const free = Number(r['Free Days'] || r['free_days'] || r['Free'] || 0);
      const container = r['Container'] || r['container'] || r['Type'] || r['container_type'] || '40ft HC';
      const port = Number(r['Port Fees'] || r['port_fees'] || 0);
      const customs = Number(r['Customs'] || r['customs_fees'] || 0);
      const inland = Number(r['Inland'] || r['inland_fees'] || r['Trucking'] || 0);
      const thc = Number(r['THC'] || r['thc_fees'] || 0);
      const doc = Number(r['Doc Fees'] || r['doc_fees'] || 0);
      const other = Number(r['Other Fees'] || r['other_fees'] || 0);
      const notes = r['Notes'] || r['notes'] || '';
      const date = r['Date'] || r['effective_date'] || new Date().toISOString().substring(0, 10);
      return { origin, destination: dest, vendor_name: vendor, rate_amount: rate, transit_days: transit, free_days: free, container_type: container, port_fees: port, customs_fees: customs, inland_fees: inland, thc_fees: thc, doc_fees: doc, other_fees: other, notes, effective_date: typeof date === 'number' ? excelDate(date) : String(date).substring(0, 10) };
    }).filter(r => r.origin && r.destination && r.vendor_name && r.rate_amount > 0);
    setImportData(parsed);
    setImportStep('preview');
  };

  const excelDate = (serial) => {
    const d = XLSX.SSF.parse_date_code(serial);
    return d.y + '-' + String(d.m).padStart(2,'0') + '-' + String(d.d).padStart(2,'0');
  };

  const executeImport = async () => {
    setImportStep('importing');
    let imported = 0;
    for (const row of importData) {
      try {
        await dbInsert('shipping_rates', {
          ...row,
          lane_type: 'ocean', vendor_type: 'shipping_line',
          rate_currency: 'USD', rate_per: 'container', status: 'active', source: 'import',
        }, user?.id);
        imported++;
      } catch (e) { console.log('Skip:', e.message); }
    }
    setImportStep('done');
    setImportData([]);
    await loadRates();
    alert('Imported ' + imported + ' rates / تم استيراد ' + imported + ' أسعار');
  };

  // Modal
  const Modal = ({ onClose, title, children }) => (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>
        {children}
      </div>
    </div>
  );

  if (loading) return <div className="text-center py-12 text-slate-400">Loading shipping rates...</div>;

  return (
    <div>
      {/* HEADER */}
      <div className="flex justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-xl font-extrabold">🚢 Shipping Rates / أسعار الشحن</h2>
        <div className="flex gap-2 flex-wrap">
          {['lanes','list','add','import'].map(v => (
            <button key={v} onClick={() => { setView(v); if (v==='add') { setForm({}); setEditingRate(null); } }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${view === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {v === 'lanes' ? '🗺️ Routes' : v === 'list' ? '📋 All Rates' : v === 'add' ? '+ New Rate' : '📥 Import'}
            </button>
          ))}
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl p-4" style={{ borderLeftWidth: 4, borderLeftColor: '#0ea5e9' }}>
          <div className="text-[10px] text-slate-500 uppercase">Active Routes</div>
          <div className="text-2xl font-extrabold mt-1">{lanes.length}</div>
        </div>
        <div className="bg-white rounded-xl p-4" style={{ borderLeftWidth: 4, borderLeftColor: '#10b981' }}>
          <div className="text-[10px] text-slate-500 uppercase">Total Rates</div>
          <div className="text-2xl font-extrabold mt-1">{rates.length}</div>
        </div>
        <div className="bg-white rounded-xl p-4" style={{ borderLeftWidth: 4, borderLeftColor: '#f59e0b' }}>
          <div className="text-[10px] text-slate-500 uppercase">Vendors</div>
          <div className="text-2xl font-extrabold mt-1">{vendors.length}</div>
        </div>
        <div className="bg-white rounded-xl p-4" style={{ borderLeftWidth: 4, borderLeftColor: '#8b5cf6' }}>
          <div className="text-[10px] text-slate-500 uppercase">Origins</div>
          <div className="text-2xl font-extrabold mt-1">{origins.length}</div>
        </div>
      </div>

      {/* ==================== LANES VIEW ==================== */}
      {view === 'lanes' && (
        <div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search routes, vendors... / بحث" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lanes
              .filter(([key]) => !search || key.toLowerCase().includes(search.toLowerCase()))
              .map(([key, lane]) => (
              <div key={key} onClick={() => { setCompareLane(key); setView('list'); setSearch(''); }}
                className="bg-white rounded-xl p-4 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all border border-slate-200">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-2xl">{LANE_ICONS[lane.lane_type] || '📦'}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                    {lane.rates.length} rate{lane.rates.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-sm font-bold text-slate-900">{lane.origin}</div>
                <div className="text-[10px] text-slate-400 my-0.5">→</div>
                <div className="text-sm font-bold text-slate-900">{lane.destination}</div>
                <div className="flex justify-between items-end mt-3">
                  <div>
                    <div className="text-[10px] text-slate-400">Best Rate</div>
                    <div className="text-lg font-extrabold text-emerald-600">{fCur(lane.bestRate)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">{lane.vendors.size} vendor{lane.vendors.size > 1 ? 's' : ''}</div>
                    <div className="text-[10px] text-slate-500">{lane.latestDate}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {lanes.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🚢</div>
              <div className="text-sm font-bold text-slate-500 mb-1">No shipping rates yet</div>
              <div className="text-xs text-slate-400 mb-4">Add your first rate or import from Excel</div>
              <div className="flex gap-2 justify-center">
                <button onClick={() => { setView('add'); setForm({}); }} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Add Rate</button>
                <button onClick={() => setView('import')} className="px-4 py-2 bg-slate-200 rounded-lg text-xs font-semibold">📥 Import Excel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== LIST VIEW ==================== */}
      {view === 'list' && (
        <div>
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search / بحث" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs flex-1 min-w-[120px]" />
            <select value={filterLane} onChange={e => setFilterLane(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs">
              <option value="all">All Types</option>
              {LANE_TYPES.map(t => <option key={t} value={t}>{LANE_LABELS[t]}</option>)}
            </select>
            <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs">
              <option value="all">All Vendors</option>
              {vendors.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterContainer} onChange={e => setFilterContainer(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs">
              <option value="all">All Containers</option>
              {CONTAINER_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {compareLane && (
              <button onClick={() => setCompareLane(null)} className="px-2 py-1 rounded border border-red-300 text-red-500 text-[10px]">
                ✕ Clear Route Filter
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl overflow-hidden border border-slate-200">
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-50">
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-600">Date</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold text-slate-600">Route</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold text-slate-600">Vendor</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold text-slate-600">Container</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-slate-600">Rate</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-slate-600">Total</th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-slate-600">Transit</th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-slate-600">Free Days</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(compareLane
                    ? filteredRates.filter(r => (r.origin + ' → ' + r.destination) === compareLane)
                    : filteredRates
                  ).map(r => (
                    <tr key={r.id} onClick={() => setSelectedRate(r)}
                      className="border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition">
                      <td className="px-3 py-2 text-xs">{r.effective_date}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-semibold">{r.origin}</span>
                        <span className="text-slate-400 mx-1">→</span>
                        <span className="font-semibold">{r.destination}</span>
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold">{r.vendor_name}</td>
                      <td className="px-3 py-2 text-xs text-center">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">{r.container_type}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-right font-bold text-emerald-600">{fCur(r.rate_amount, r.rate_currency)}</td>
                      <td className="px-3 py-2 text-xs text-right font-bold text-blue-600">{fCur(r.total_cost, r.rate_currency)}</td>
                      <td className="px-3 py-2 text-xs text-center">{r.transit_days ? r.transit_days + 'd' : '—'}</td>
                      <td className="px-3 py-2 text-xs text-center">{r.free_days || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
                          r.status === 'active' ? 'bg-green-100 text-green-700' :
                          r.status === 'expired' ? 'bg-red-100 text-red-700' :
                          r.status === 'draft' ? 'bg-slate-100 text-slate-500' :
                          'bg-amber-100 text-amber-700'
                        }`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredRates.length === 0 && (
              <div className="text-center py-8 text-xs text-slate-400">No rates match your filters</div>
            )}
          </div>
        </div>
      )}

      {/* ==================== ADD / EDIT VIEW ==================== */}
      {view === 'add' && (
        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <h3 className="text-sm font-bold mb-4">{editingRate ? 'Edit Rate / تعديل السعر' : 'New Shipping Rate / سعر شحن جديد'}</h3>

          {/* Route */}
          <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
            <h4 className="text-xs font-bold text-blue-800 mb-2">📍 Route / المسار</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Origin / المنشأ *</label>
                <input list="origins" value={form.origin || ''} onChange={e => setForm({...form, origin: e.target.value})}
                  placeholder="e.g. Shanghai" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                <datalist id="origins">{origins.map(o => <option key={o} value={o} />)}</datalist>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Origin Country</label>
                <input value={form.origin_country || ''} onChange={e => setForm({...form, origin_country: e.target.value})}
                  placeholder="China" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Destination / الوجهة *</label>
                <input list="dests" value={form.destination || ''} onChange={e => setForm({...form, destination: e.target.value})}
                  placeholder="e.g. Alexandria" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                <datalist id="dests">{destinations.map(d => <option key={d} value={d} />)}</datalist>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Dest Country</label>
                <input value={form.destination_country || ''} onChange={e => setForm({...form, destination_country: e.target.value})}
                  placeholder="Egypt" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Lane Type / نوع المسار</label>
                <select value={form.lane_type || 'ocean'} onChange={e => setForm({...form, lane_type: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {LANE_TYPES.map(t => <option key={t} value={t}>{LANE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Container Type / نوع الحاوية</label>
                <select value={form.container_type || '40ft HC'} onChange={e => setForm({...form, container_type: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {CONTAINER_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Vendor */}
          <div className="bg-emerald-50 rounded-lg p-4 mb-4 border border-emerald-200">
            <h4 className="text-xs font-bold text-emerald-800 mb-2">🏢 Vendor / المورد</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Vendor Name / اسم المورد *</label>
                <input list="vendors" value={form.vendor_name || ''} onChange={e => setForm({...form, vendor_name: e.target.value})}
                  placeholder="e.g. MSC, Maersk" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                <datalist id="vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Vendor Type / نوع المورد</label>
                <select value={form.vendor_type || 'shipping_line'} onChange={e => setForm({...form, vendor_type: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {VENDOR_TYPES.map(t => <option key={t} value={t}>{VENDOR_LABELS[t]}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Rate */}
          <div className="bg-amber-50 rounded-lg p-4 mb-4 border border-amber-200">
            <h4 className="text-xs font-bold text-amber-800 mb-2">💰 Rate / السعر</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Base Rate *</label>
                <input type="number" value={form.rate_amount || ''} onChange={e => setForm({...form, rate_amount: e.target.value})}
                  placeholder="0" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Currency</label>
                <select value={form.rate_currency || 'USD'} onChange={e => setForm({...form, rate_currency: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Per</label>
                <select value={form.rate_per || 'container'} onChange={e => setForm({...form, rate_per: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {RATE_PER.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Effective Date</label>
                <input type="date" value={form.effective_date || new Date().toISOString().substring(0,10)} onChange={e => setForm({...form, effective_date: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
          </div>

          {/* Transit & Free Days */}
          <div className="bg-purple-50 rounded-lg p-4 mb-4 border border-purple-200">
            <h4 className="text-xs font-bold text-purple-800 mb-2">⏱️ Transit & Terms / العبور والشروط</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Transit Days / أيام العبور</label>
                <input type="number" value={form.transit_days || ''} onChange={e => setForm({...form, transit_days: e.target.value})}
                  placeholder="e.g. 25" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Free Days / أيام مجانية</label>
                <input type="number" value={form.free_days || ''} onChange={e => setForm({...form, free_days: e.target.value})}
                  placeholder="0" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Detention $/day</label>
                <input type="number" value={form.detention_rate || ''} onChange={e => setForm({...form, detention_rate: e.target.value})}
                  placeholder="0" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Demurrage $/day</label>
                <input type="number" value={form.demurrage_rate || ''} onChange={e => setForm({...form, demurrage_rate: e.target.value})}
                  placeholder="0" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
          </div>

          {/* Fees Breakdown */}
          <div className="bg-red-50 rounded-lg p-4 mb-4 border border-red-200">
            <h4 className="text-xs font-bold text-red-800 mb-2">📋 Additional Fees / رسوم إضافية</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Port Fees / رسوم ميناء</label>
                <input type="number" value={form.port_fees || ''} onChange={e => setForm({...form, port_fees: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Customs Fees / رسوم جمارك</label>
                <input type="number" value={form.customs_fees || ''} onChange={e => setForm({...form, customs_fees: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Inland / نقل داخلي</label>
                <input type="number" value={form.inland_fees || ''} onChange={e => setForm({...form, inland_fees: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">THC</label>
                <input type="number" value={form.thc_fees || ''} onChange={e => setForm({...form, thc_fees: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Doc Fees / رسوم مستندات</label>
                <input type="number" value={form.doc_fees || ''} onChange={e => setForm({...form, doc_fees: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Other Fees / أخرى</label>
                <input type="number" value={form.other_fees || ''} onChange={e => setForm({...form, other_fees: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
            {(form.other_fees > 0) && (
              <input value={form.other_fees_desc || ''} onChange={e => setForm({...form, other_fees_desc: e.target.value})}
                placeholder="Describe other fees..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-2" />
            )}
            {/* Total Preview */}
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-red-200">
              <span className="text-xs font-bold">Estimated Total / الإجمالي</span>
              <span className="text-lg font-extrabold text-blue-600">
                {fCur(
                  (Number(form.rate_amount) || 0) + (Number(form.port_fees) || 0) + (Number(form.customs_fees) || 0) +
                  (Number(form.inland_fees) || 0) + (Number(form.thc_fees) || 0) + (Number(form.doc_fees) || 0) + (Number(form.other_fees) || 0),
                  form.rate_currency || 'USD'
                )}
              </span>
            </div>
          </div>

          {/* Notes & Contract */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[10px] font-semibold text-slate-600">Notes / ملاحظات</label>
              <textarea value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})}
                rows={2} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-600">Contract Ref / مرجع العقد</label>
              <input value={form.contract_ref || ''} onChange={e => setForm({...form, contract_ref: e.target.value})}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.is_contract || false} onChange={e => setForm({...form, is_contract: e.target.checked})} />
                <label className="text-xs">Contract Rate / سعر تعاقدي</label>
              </div>
              <div className="mt-1">
                <label className="text-[10px] font-semibold text-slate-600">Expiry Date</label>
                <input type="date" value={form.expiry_date || ''} onChange={e => setForm({...form, expiry_date: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave}
              className="px-6 py-2.5 bg-blue-500 text-white rounded-lg font-semibold text-sm hover:bg-blue-600 transition">
              {editingRate ? 'Update / تحديث ✓' : 'Save Rate / حفظ ✓'}
            </button>
            <button onClick={() => { setView('list'); setForm({}); setEditingRate(null); }}
              className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm">Cancel / إلغاء</button>
          </div>
        </div>
      )}

      {/* ==================== IMPORT VIEW ==================== */}
      {view === 'import' && (
        <div>
          {importStep === 'select' && (
            <div className="bg-white rounded-xl p-8 text-center border-2 border-dashed border-blue-300">
              <div className="text-4xl mb-3">📁</div>
              <h3 className="text-sm font-bold mb-1">Upload Shipping Rates Excel / رفع أسعار الشحن</h3>
              <p className="text-[10px] text-slate-400 mb-4">
                Columns: Origin, Destination, Vendor, Rate, Transit Days, Free Days, Container, Port Fees, Customs, Inland, THC, Doc Fees, Other Fees, Notes, Date
              </p>
              <label className="px-6 py-3 bg-blue-500 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-blue-600 inline-block">
                Select File / اختر ملف
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => {
                  if (e.target.files[0]) processImport(e.target.files[0]);
                }} />
              </label>
            </div>
          )}
          {importStep === 'preview' && importData.length > 0 && (
            <div>
              <div className="bg-emerald-50 rounded-xl p-4 mb-3 border border-emerald-200 flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold text-emerald-800">Parsed {importData.length} rates</h3>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setImportStep('select'); setImportData([]); }}
                    className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs">Cancel</button>
                  <button onClick={executeImport}
                    className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold">Import All</button>
                </div>
              </div>
              <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200 bg-white">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0"><tr className="bg-slate-50">
                    <th className="px-2 py-2 text-[10px] text-left">Origin</th>
                    <th className="px-2 py-2 text-[10px] text-left">Destination</th>
                    <th className="px-2 py-2 text-[10px] text-left">Vendor</th>
                    <th className="px-2 py-2 text-[10px] text-right">Rate</th>
                    <th className="px-2 py-2 text-[10px] text-center">Transit</th>
                    <th className="px-2 py-2 text-[10px] text-center">Free Days</th>
                    <th className="px-2 py-2 text-[10px]">Container</th>
                  </tr></thead>
                  <tbody>
                    {importData.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="px-2 py-1.5">{r.origin}</td>
                        <td className="px-2 py-1.5">{r.destination}</td>
                        <td className="px-2 py-1.5 font-semibold">{r.vendor_name}</td>
                        <td className="px-2 py-1.5 text-right font-bold text-emerald-600">{fCur(r.rate_amount)}</td>
                        <td className="px-2 py-1.5 text-center">{r.transit_days || '—'}</td>
                        <td className="px-2 py-1.5 text-center">{r.free_days || '—'}</td>
                        <td className="px-2 py-1.5">{r.container_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {importStep === 'importing' && (
            <div className="bg-white rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">⏳</div>
              <h3 className="text-lg font-bold">Importing...</h3>
            </div>
          )}
        </div>
      )}

      {/* ==================== RATE DETAIL MODAL ==================== */}
      {selectedRate && (
        <Modal onClose={() => setSelectedRate(null)}
          title={`${LANE_ICONS[selectedRate.lane_type] || '📦'} ${selectedRate.origin} → ${selectedRate.destination}`}>
          <div className="space-y-4">
            {/* Route & Vendor */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-[10px] text-blue-700">Vendor / المورد</div>
                <div className="text-sm font-bold">{selectedRate.vendor_name}</div>
                <div className="text-[10px] text-blue-500">{VENDOR_LABELS[selectedRate.vendor_type] || selectedRate.vendor_type}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="text-[10px] text-slate-500">Container</div>
                <div className="text-sm font-bold">{selectedRate.container_type}</div>
                <div className="text-[10px] text-slate-400">{selectedRate.effective_date}{selectedRate.expiry_date ? ' → ' + selectedRate.expiry_date : ''}</div>
              </div>
            </div>

            {/* Rate Breakdown */}
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
              <h4 className="text-xs font-bold text-emerald-800 mb-2">Rate Breakdown / تفصيل السعر</h4>
              <div className="space-y-1">
                <div className="flex justify-between text-xs"><span>Base Rate</span><span className="font-bold">{fCur(selectedRate.rate_amount, selectedRate.rate_currency)}</span></div>
                {selectedRate.port_fees > 0 && <div className="flex justify-between text-xs"><span>Port Fees / رسوم ميناء</span><span>{fCur(selectedRate.port_fees, selectedRate.rate_currency)}</span></div>}
                {selectedRate.customs_fees > 0 && <div className="flex justify-between text-xs"><span>Customs / جمارك</span><span>{fCur(selectedRate.customs_fees, selectedRate.rate_currency)}</span></div>}
                {selectedRate.inland_fees > 0 && <div className="flex justify-between text-xs"><span>Inland / داخلي</span><span>{fCur(selectedRate.inland_fees, selectedRate.rate_currency)}</span></div>}
                {selectedRate.thc_fees > 0 && <div className="flex justify-between text-xs"><span>THC</span><span>{fCur(selectedRate.thc_fees, selectedRate.rate_currency)}</span></div>}
                {selectedRate.doc_fees > 0 && <div className="flex justify-between text-xs"><span>Doc Fees / مستندات</span><span>{fCur(selectedRate.doc_fees, selectedRate.rate_currency)}</span></div>}
                {selectedRate.other_fees > 0 && <div className="flex justify-between text-xs"><span>Other / أخرى {selectedRate.other_fees_desc ? '(' + selectedRate.other_fees_desc + ')' : ''}</span><span>{fCur(selectedRate.other_fees, selectedRate.rate_currency)}</span></div>}
                <div className="flex justify-between text-sm font-extrabold pt-2 mt-1 border-t-2 border-emerald-300">
                  <span>TOTAL / الإجمالي</span>
                  <span className="text-emerald-600">{fCur(selectedRate.total_cost, selectedRate.rate_currency)}</span>
                </div>
              </div>
            </div>

            {/* Transit Details */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-purple-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Transit</div>
                <div className="text-lg font-bold text-purple-600">{selectedRate.transit_days || '—'}<span className="text-[10px] text-slate-400"> days</span></div>
              </div>
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Free Days</div>
                <div className="text-lg font-bold text-blue-600">{selectedRate.free_days || 0}</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Detention</div>
                <div className="text-sm font-bold text-amber-600">{selectedRate.detention_rate ? fCur(selectedRate.detention_rate, selectedRate.rate_currency) + '/d' : '—'}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Demurrage</div>
                <div className="text-sm font-bold text-red-600">{selectedRate.demurrage_rate ? fCur(selectedRate.demurrage_rate, selectedRate.rate_currency) + '/d' : '—'}</div>
              </div>
            </div>

            {selectedRate.notes && (
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 mb-1">Notes / ملاحظات</div>
                <div className="text-xs">{selectedRate.notes}</div>
              </div>
            )}

            {selectedRate.contract_ref && (
              <div className="text-xs text-blue-600">
                {selectedRate.is_contract ? '📄 Contract: ' : 'Ref: '}{selectedRate.contract_ref}
              </div>
            )}

            {/* Rate History for same lane */}
            {(() => {
              const history = rates.filter(r =>
                r.origin === selectedRate.origin && r.destination === selectedRate.destination &&
                r.id !== selectedRate.id
              ).slice(0, 10);
              if (history.length === 0) return null;
              return (
                <div>
                  <h4 className="text-xs font-bold mb-2">📊 Rate History — same route ({history.length})</h4>
                  <div className="overflow-auto max-h-[200px] rounded border border-slate-200">
                    <table className="w-full border-collapse">
                      <thead><tr className="bg-slate-50">
                        <th className="px-2 py-1.5 text-[10px] text-left">Date</th>
                        <th className="px-2 py-1.5 text-[10px]">Vendor</th>
                        <th className="px-2 py-1.5 text-[10px]">Container</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Rate</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Total</th>
                      </tr></thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id} className="border-b border-slate-50 cursor-pointer hover:bg-blue-50"
                            onClick={() => setSelectedRate(h)}>
                            <td className="px-2 py-1 text-[10px]">{h.effective_date}</td>
                            <td className="px-2 py-1 text-[10px] font-semibold">{h.vendor_name}</td>
                            <td className="px-2 py-1 text-[10px]">{h.container_type}</td>
                            <td className="px-2 py-1 text-[10px] text-right text-emerald-600 font-bold">{fCur(h.rate_amount, h.rate_currency)}</td>
                            <td className="px-2 py-1 text-[10px] text-right font-bold">{fCur(h.total_cost, h.rate_currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button onClick={() => {
                setForm({
                  origin: selectedRate.origin, origin_country: selectedRate.origin_country,
                  destination: selectedRate.destination, destination_country: selectedRate.destination_country,
                  lane_type: selectedRate.lane_type, vendor_name: selectedRate.vendor_name,
                  vendor_type: selectedRate.vendor_type, container_type: selectedRate.container_type,
                  rate_amount: selectedRate.rate_amount, rate_currency: selectedRate.rate_currency,
                  rate_per: selectedRate.rate_per, transit_days: selectedRate.transit_days,
                  free_days: selectedRate.free_days, detention_rate: selectedRate.detention_rate,
                  demurrage_rate: selectedRate.demurrage_rate, port_fees: selectedRate.port_fees,
                  customs_fees: selectedRate.customs_fees, inland_fees: selectedRate.inland_fees,
                  thc_fees: selectedRate.thc_fees, doc_fees: selectedRate.doc_fees,
                  other_fees: selectedRate.other_fees, other_fees_desc: selectedRate.other_fees_desc,
                  effective_date: selectedRate.effective_date, expiry_date: selectedRate.expiry_date,
                  is_contract: selectedRate.is_contract, contract_ref: selectedRate.contract_ref,
                  notes: selectedRate.notes, status: selectedRate.status,
                });
                setEditingRate(selectedRate);
                setSelectedRate(null);
                setView('add');
              }} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">Edit / تعديل</button>
              <button onClick={() => {
                setForm({
                  origin: selectedRate.origin, origin_country: selectedRate.origin_country,
                  destination: selectedRate.destination, destination_country: selectedRate.destination_country,
                  lane_type: selectedRate.lane_type, vendor_name: selectedRate.vendor_name,
                  vendor_type: selectedRate.vendor_type, container_type: selectedRate.container_type,
                  rate_currency: selectedRate.rate_currency, rate_per: selectedRate.rate_per,
                  transit_days: selectedRate.transit_days, free_days: selectedRate.free_days,
                });
                setEditingRate(null);
                setSelectedRate(null);
                setView('add');
              }} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold">+ New Rate (same route)</button>
              {isAdmin && (
                <button onClick={() => handleDelete(selectedRate.id)}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-xs font-semibold">Delete / حذف</button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
