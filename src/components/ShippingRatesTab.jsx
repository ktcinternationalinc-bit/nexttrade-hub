'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { fE, fmt } from '../lib/utils';
import * as XLSX from 'xlsx';

const CONTAINER_TYPES = ['20ft', '40ft', '40ft HC', '45ft', 'LCL', 'Bulk', 'Flatbed', 'Reefer', 'Open Top', 'Truck', 'Trailer'];
const TRANSPORT_MODES = ['Ocean', 'Trucking', 'Air', 'Rail', 'Multi-modal'];
const CURRENCIES = ['USD', 'EUR', 'EGP', 'GBP', 'SAR', 'AED', 'CNY', 'TRY'];
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'booked'];
const fCur = (amount, currency) => { if (!amount && amount !== 0) return '—'; const sym = { USD: '\$', EUR: '€', EGP: 'E£', GBP: '£', CNY: '¥', TRY: '₺', SAR: 'SR', AED: 'AED ' }; return (sym[currency] || currency + ' ') + Number(amount).toLocaleString(); };
const isExpired = (d) => d && d < new Date().toISOString().substring(0, 10);
const daysUntil = (d) => { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); };

export default function ShippingRatesTab({ user, isAdmin, customers }) {
  const [rates, setRates] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('routes');
  const [q, setQ] = useState('');
  const [filterOrigin, setFilterOrigin] = useState('all');
  const [filterDest, setFilterDest] = useState('all');
  const [filterVendor, setFilterVendor] = useState('all');
  const [filterLine, setFilterLine] = useState('all');
  const [filterMode, setFilterMode] = useState('all');
  const [filterExpiry, setFilterExpiry] = useState('all');
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [editingRate, setEditingRate] = useState(null);
  const [editingQuote, setEditingQuote] = useState(null);
  const [f, setF] = useState({});
  const [aiQuery, setAiQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [importData, setImportData] = useState([]);
  const [importStep, setImportStep] = useState('select');
  const [importProgress, setImportProgress] = useState(0);

  const fetchAll = async (table, orderCol) => { let all = [], from = 0; while (true) { const { data } = await supabase.from(table).select('*').order(orderCol, { ascending: false }).range(from, from + 999); if (!data || data.length === 0) break; all = all.concat(data); if (data.length < 1000) break; from += 1000; } return all; };

  const loadData = useCallback(async () => {
    setLoading(true);
    try { const [r, q] = await Promise.all([fetchAll('shipping_rates', 'effective_date'), fetchAll('shipping_quotes', 'quote_date').catch(() => [])]); setRates(r); setQuotes(q); } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const origins = useMemo(() => [...new Set(rates.map(r => r.origin).filter(Boolean))].sort(), [rates]);
  const destinations = useMemo(() => [...new Set(rates.map(r => r.destination).filter(Boolean))].sort(), [rates]);
  const vendors = useMemo(() => [...new Set(rates.map(r => r.vendor_name).filter(Boolean))].sort(), [rates]);
  const lines = useMemo(() => [...new Set(rates.map(r => r.shipping_line).filter(Boolean))].sort(), [rates]);
  const pols = useMemo(() => [...new Set(rates.map(r => r.port_of_loading).filter(Boolean))].sort(), [rates]);
  const pods = useMemo(() => [...new Set(rates.map(r => r.port_of_discharge).filter(Boolean))].sort(), [rates]);

  const filtered = useMemo(() => rates.filter(r => {
    if (filterOrigin !== 'all' && r.origin !== filterOrigin) return false;
    if (filterDest !== 'all' && r.destination !== filterDest) return false;
    if (filterVendor !== 'all' && r.vendor_name !== filterVendor) return false;
    if (filterLine !== 'all' && r.shipping_line !== filterLine) return false;
    if (filterMode !== 'all' && r.transport_mode !== filterMode) return false;
    if (filterExpiry === 'active' && isExpired(r.expiry_date)) return false;
    if (filterExpiry === 'expired' && !isExpired(r.expiry_date)) return false;
    if (q) { const hay = [r.origin, r.destination, r.vendor_name, r.shipping_line, r.port_of_loading, r.port_of_discharge, r.container_type, r.notes, r.shipment_reference].filter(Boolean).join(' ').toLowerCase(); return q.toLowerCase().split(/\s+/).every(w => hay.includes(w)); }
    return true;
  }), [rates, filterOrigin, filterDest, filterVendor, filterLine, filterMode, filterExpiry, q]);

  const routeGroups = useMemo(() => {
    const groups = {};
    filtered.forEach(r => { const key = (r.origin||'?') + ' → ' + (r.destination||'?'); if (!groups[key]) groups[key] = { origin: r.origin, destination: r.destination, rates: [], vendors: new Set(), lines: new Set(), modes: new Set() }; groups[key].rates.push(r); if (r.vendor_name) groups[key].vendors.add(r.vendor_name); if (r.shipping_line) groups[key].lines.add(r.shipping_line); if (r.transport_mode) groups[key].modes.add(r.transport_mode); });
    return Object.entries(groups).map(([key, data]) => { const ar = data.rates.filter(r => !isExpired(r.expiry_date)); const ch = ar.length > 0 ? ar.reduce((a,b) => (a.rate_amount||Infinity) < (b.rate_amount||Infinity) ? a : b) : null; return { key, ...data, cheapest: ch, activeCount: ar.length, expiredCount: data.rates.length - ar.length, bookingCount: data.rates.filter(r => r.booked).length, count: data.rates.length }; }).sort((a,b) => b.count - a.count);
  }, [filtered]);

  const routeHistory = useMemo(() => { if (!selectedRoute) return []; return rates.filter(r => r.origin === selectedRoute.origin && r.destination === selectedRoute.destination).sort((a,b) => (b.effective_date||'').localeCompare(a.effective_date||'')); }, [selectedRoute, rates]);
  const routeQuotes = useMemo(() => { if (!selectedRoute) return []; return quotes.filter(q => q.origin === selectedRoute.origin && q.destination === selectedRoute.destination).sort((a,b) => (b.quote_date||'').localeCompare(a.quote_date||'')); }, [selectedRoute, quotes]);

  const ExpiryBadge = ({ date }) => { if (!date) return <span className="text-[9px] text-slate-400">No expiry</span>; const d = daysUntil(date); const exp = d < 0; const soon = d >= 0 && d <= 7; return <span className={'px-1.5 py-0.5 rounded text-[9px] font-bold ' + (exp ? 'bg-red-100 text-red-600' : soon ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-700')}>{exp ? 'Expired ' + Math.abs(d) + 'd ago' : d === 0 ? 'Expires today' : d + 'd left'}</span>; };

  // ACTIONS
  const handleSaveRate = async () => {
    if (!f.origin || !f.destination || !f.vendorName) { alert('Fill Origin, Destination, Vendor'); return; }
    const record = { origin: f.origin, destination: f.destination, vendor_name: f.vendorName, shipping_line: f.shippingLine || '', transport_mode: f.transportMode || 'Ocean', container_type: f.containerType || '40ft', rate_amount: Number(f.rateAmount) || 0, currency: f.currency || 'USD', transit_days: f.transitDays ? Number(f.transitDays) : null, free_days: f.freeDays ? Number(f.freeDays) : null, port_fees: Number(f.portFees) || 0, thc_fees: Number(f.thcFees) || 0, documentation_fees: Number(f.docFees) || 0, customs_fees: Number(f.customsFees) || 0, other_fees: Number(f.otherFees) || 0, other_fees_desc: f.otherFeesDesc || '', total_cost: Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), effective_date: f.effectiveDate || new Date().toISOString().substring(0,10), expiry_date: f.expiryDate || null, port_of_loading: f.pol || '', port_of_discharge: f.pod || '', notes: f.notes || '', is_active: true, booked: f.booked || false, shipment_reference: f.shipmentRef || '', booking_date: f.bookingDate || null, booking_notes: f.bookingNotes || '' };
    try { if (editingRate) await dbUpdate('shipping_rates', editingRate.id, record, user?.id); else await dbInsert('shipping_rates', record, user?.id); setF({}); setEditingRate(null); setView(selectedRoute ? 'route_detail' : 'routes'); await loadData(); } catch (err) { alert('Error: ' + err.message); }
  };

  const handleMarkBooked = async (rate) => { const ref = prompt('Shipment reference #:'); if (ref === null) return; try { await dbUpdate('shipping_rates', rate.id, { booked: true, shipment_reference: ref, booking_date: new Date().toISOString().substring(0,10) }, user?.id); await loadData(); } catch (err) { alert(err.message); } };

  const handleSaveQuote = async () => {
    if (!f.qCustomer || !f.qOrigin || !f.qDest) { alert('Fill Customer, Origin, Destination'); return; }
    const iT = Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0);
    const cT = Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0);
    const profit = cT - iT;
    const record = { quote_number: f.qNumber || ('Q-' + Date.now().toString(36).toUpperCase()), quote_date: f.qDate || new Date().toISOString().substring(0,10), customer_name: f.qCustomer, customer_email: f.qEmail || '', origin: f.qOrigin, destination: f.qDest, port_of_loading: f.qPol || '', port_of_discharge: f.qPod || '', container_type: f.qContainer || '40ft', shipping_rate_id: f.qRateId || null, shipping_cost: Number(f.qShipCost)||0, shipping_vendor: f.qShipVendor || '', shipping_line: f.qShipLine || '', trucking_cost: Number(f.qTruckCost)||0, trucking_vendor: f.qTruckVendor || '', customs_cost: Number(f.qCustomsCost)||0, other_internal_cost: Number(f.qOtherInternal)||0, other_internal_desc: f.qOtherInternalDesc || '', total_internal_cost: iT, client_shipping_fee: Number(f.qClientShip)||0, client_trucking_fee: Number(f.qClientTruck)||0, client_customs_fee: Number(f.qClientCustoms)||0, client_service_fee: Number(f.qClientService)||0, client_other_fee: Number(f.qClientOther)||0, client_other_desc: f.qClientOtherDesc || '', client_total: cT, client_display_text: f.qDisplayText || '', client_show_breakdown: f.qShowBreakdown || false, profit, profit_pct: iT > 0 ? Math.round((profit/iT)*10000)/100 : 0, currency: f.qCurrency || 'USD', status: f.qStatus || 'draft', valid_until: f.qValidUntil || null, notes: f.qNotes || '' };
    try { if (editingQuote) await dbUpdate('shipping_quotes', editingQuote.id, record, user?.id); else await dbInsert('shipping_quotes', record, user?.id); setF({}); setEditingQuote(null); setView('quotes'); await loadData(); } catch (err) { alert('Error: ' + err.message); }
  };

  const handleDeleteRate = async (rate) => { if (!confirm('Delete this rate?')) return; try { await dbDelete('shipping_rates', rate.id, user?.id); await loadData(); } catch (err) { alert(err.message); } };

  const processImportFile = async (file) => { const d = await file.arrayBuffer(); const wb = XLSX.read(d); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); if (!rows.length) { alert('Empty'); return; } const parsed = rows.map(row => { const get = (...keys) => { for (const k of keys) { const v = row[k]||row[k?.toLowerCase?.()]||row[k?.toUpperCase?.()]; if (v!=null&&v!=='') return String(v).trim(); } return ''; }; const getNum = (...keys) => { const v = get(...keys); return v ? Number(v.replace(/[^0-9.-]/g,''))||0 : 0; }; const r = { origin:get('Origin','From','المنشأ'), destination:get('Destination','To','الوجهة'), vendor_name:get('Vendor','Forwarder','المورد'), shipping_line:get('Shipping Line','Line','Carrier','الناقل'), transport_mode:get('Mode','Transport')||'Ocean', container_type:get('Container','Size')||'40ft', rate_amount:getNum('Rate','Amount','Freight'), currency:get('Currency','Cur')||'USD', transit_days:getNum('Transit','Transit Days')||null, free_days:getNum('Free Days','Free')||null, port_fees:getNum('Port Fees'), thc_fees:getNum('THC'), documentation_fees:getNum('Doc Fees'), customs_fees:getNum('Customs'), other_fees:getNum('Other Fees'), effective_date:get('Date','Effective')||new Date().toISOString().substring(0,10), expiry_date:get('Expiry','Valid Until')||null, port_of_loading:get('POL','Loading Port'), port_of_discharge:get('POD','Discharge Port'), notes:get('Notes','Remarks'), is_active:true }; r.total_cost=(r.rate_amount||0)+(r.port_fees||0)+(r.thc_fees||0)+(r.documentation_fees||0)+(r.customs_fees||0)+(r.other_fees||0); return r; }).filter(r=>r.origin&&r.destination); setImportData(parsed); setImportStep('preview'); };

  const executeImport = async () => { setImportStep('importing'); setImportProgress(0); for (let i=0;i<importData.length;i++) { try { await dbInsert('shipping_rates',importData[i],user?.id); } catch(e){} if(i%10===0) setImportProgress(Math.round((i/importData.length)*100)); } setImportProgress(100); setImportStep('done'); await loadData(); };

  const handleAiQuery = async () => { if (!aiQuery.trim()) return; setAiLoading(true); setAiAnswer(''); try { const summary = routeGroups.slice(0,50).map(rg => { const c=rg.cheapest; return rg.key+': '+rg.count+' quotes ('+rg.activeCount+' active), best: '+(c?'$'+c.rate_amount+' '+c.vendor_name+'/'+(c.shipping_line||'N/A'):'none'); }).join('\n'); const res = await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:aiQuery,context:'Shipping rates assistant for KTC.\n\nROUTES:\n'+summary+'\n\nAnswer concisely.'})}); const data = await res.json(); setAiAnswer(data.answer||'No response'); } catch(err) { setAiAnswer('Error: '+err.message); } setAiLoading(false); };

  if (loading) return <div className="text-center py-8 text-slate-400">Loading...</div>;

  // ========== ADD/EDIT RATE ==========
  if (view === 'add_rate') return (<div>
    <button onClick={()=>{setView(selectedRoute?'route_detail':'routes');setF({});setEditingRate(null);}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">{editingRate ? 'Edit Rate' : 'New Shipping Rate'}</h2>
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="bg-blue-50 rounded-lg p-3 mb-4 border border-blue-200"><h3 className="text-xs font-bold text-blue-800 mb-2">🚢 Route</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] font-semibold">Origin *</label><input list="o-l" value={f.origin||''} onChange={e=>setF({...f,origin:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="o-l">{origins.map(o=><option key={o} value={o}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Destination *</label><input list="d-l" value={f.destination||''} onChange={e=>setF({...f,destination:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="d-l">{destinations.map(d=><option key={d} value={d}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Port of Loading</label><input list="pol-l" value={f.pol||''} onChange={e=>setF({...f,pol:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="pol-l">{pols.map(p=><option key={p} value={p}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Port of Discharge</label><input list="pod-l" value={f.pod||''} onChange={e=>setF({...f,pod:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="pod-l">{pods.map(p=><option key={p} value={p}/>)}</datalist></div>
        </div></div>
      <div className="bg-emerald-50 rounded-lg p-3 mb-4 border border-emerald-200"><h3 className="text-xs font-bold text-emerald-800 mb-2">🏢 Vendor & Shipping Line (2 separate fields)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Vendor / Forwarder *</label><input list="v-l" value={f.vendorName||''} onChange={e=>setF({...f,vendorName:e.target.value})} placeholder="Freight forwarder, broker..." className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="v-l">{vendors.map(v=><option key={v} value={v}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Shipping Line / الناقل</label><input list="l-l" value={f.shippingLine||''} onChange={e=>setF({...f,shippingLine:e.target.value})} placeholder="MSC, Maersk, CMA CGM..." className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="l-l">{lines.map(l=><option key={l} value={l}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Transport Mode</label><select value={f.transportMode||'Ocean'} onChange={e=>setF({...f,transportMode:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{TRANSPORT_MODES.map(m=><option key={m}>{m}</option>)}</select></div>
          <div><label className="text-[10px] font-semibold">Container Type</label><select value={f.containerType||'40ft'} onChange={e=>setF({...f,containerType:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CONTAINER_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
        </div></div>
      <div className="bg-amber-50 rounded-lg p-3 mb-4 border border-amber-200"><h3 className="text-xs font-bold text-amber-800 mb-2">💰 Rates & Fees</h3>
        <div className="grid grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Base Rate</label><input type="number" value={f.rateAmount||''} onChange={e=>setF({...f,rateAmount:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Currency</label><select value={f.currency||'USD'} onChange={e=>setF({...f,currency:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><label className="text-[10px] font-semibold">Transit Days</label><input type="number" value={f.transitDays||''} onChange={e=>setF({...f,transitDays:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Free Days</label><input type="number" value={f.freeDays||''} onChange={e=>setF({...f,freeDays:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Port Fees</label><input type="number" value={f.portFees||''} onChange={e=>setF({...f,portFees:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">THC</label><input type="number" value={f.thcFees||''} onChange={e=>setF({...f,thcFees:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Documentation</label><input type="number" value={f.docFees||''} onChange={e=>setF({...f,docFees:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Customs</label><input type="number" value={f.customsFees||''} onChange={e=>setF({...f,customsFees:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Other Fees</label><input type="number" value={f.otherFees||''} onChange={e=>setF({...f,otherFees:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div className="col-span-3"><label className="text-[10px] font-semibold">Other Fees Desc</label><input value={f.otherFeesDesc||''} onChange={e=>setF({...f,otherFeesDesc:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>
        <div className="mt-2 text-right"><span className="text-xs text-slate-500">Total: </span><span className="text-lg font-extrabold text-amber-700">{fCur(Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), f.currency||'USD')}</span></div></div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Effective Date</label><input type="date" value={f.effectiveDate||new Date().toISOString().substring(0,10)} onChange={e=>setF({...f,effectiveDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold text-red-600">Expiry Date</label><input type="date" value={f.expiryDate||''} onChange={e=>setF({...f,expiryDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm border-red-200" /></div>
        <div><label className="text-[10px] font-semibold">Notes</label><input value={f.notes||''} onChange={e=>setF({...f,notes:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div className="flex items-end"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.booked||false} onChange={e=>setF({...f,booked:e.target.checked})} className="w-4 h-4" /> Booked ✓</label></div>
      </div>
      {f.booked && (<div className="grid grid-cols-3 gap-3 mb-4 bg-green-50 rounded-lg p-3 border border-green-200">
        <div><label className="text-[10px] font-semibold text-green-800">Shipment Reference</label><input value={f.shipmentRef||''} onChange={e=>setF({...f,shipmentRef:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold text-green-800">Booking Date</label><input type="date" value={f.bookingDate||''} onChange={e=>setF({...f,bookingDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold text-green-800">Booking Notes</label><input value={f.bookingNotes||''} onChange={e=>setF({...f,bookingNotes:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      </div>)}
      <div className="flex gap-2"><button onClick={handleSaveRate} className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">{editingRate?'Update':'Save Rate'} ✓</button><button onClick={()=>{setView(selectedRoute?'route_detail':'routes');setF({});setEditingRate(null);}} className="px-5 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button></div>
    </div></div>);

  // ========== QUOTES LIST ==========
  if (view === 'quotes') return (<div>
    <button onClick={()=>setView('routes')} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Routes</button>
    <div className="flex justify-between items-center mb-3"><h2 className="text-xl font-extrabold">📋 Quotes ({quotes.length})</h2><button onClick={()=>{setView('add_quote');setF({});setEditingQuote(null);}} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ New Quote</button></div>
    <div className="grid grid-cols-4 gap-3 mb-4">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{quotes.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Accepted</div><div className="text-lg font-extrabold text-emerald-600">{quotes.filter(q=>q.status==='accepted'||q.status==='booked').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Pending</div><div className="text-lg font-extrabold text-amber-600">{quotes.filter(q=>q.status==='draft'||q.status==='sent').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Total Profit</div><div className="text-lg font-extrabold text-emerald-600">{fCur(quotes.reduce((a,q)=>a+Number(q.profit||0),0),'USD')}</div></div>
    </div>
    <div className="overflow-auto rounded-lg border bg-white max-h-[500px]"><table className="w-full border-collapse text-xs"><thead className="sticky top-0"><tr className="bg-slate-50">
      <th className="px-2 py-2 text-[10px] text-left">Quote #</th><th className="px-2 py-2 text-[10px] text-left">Date</th><th className="px-2 py-2 text-[10px] text-left">Customer</th><th className="px-2 py-2 text-[10px] text-left">Route</th><th className="px-2 py-2 text-[10px] text-right">Our Cost</th><th className="px-2 py-2 text-[10px] text-right">Client</th><th className="px-2 py-2 text-[10px] text-right">Profit</th><th className="px-2 py-2 text-[10px]">Status</th>
    </tr></thead><tbody>{quotes.map(q => { const sc = {draft:'bg-slate-100 text-slate-600',sent:'bg-blue-100 text-blue-700',accepted:'bg-green-100 text-green-700',rejected:'bg-red-100 text-red-600',expired:'bg-red-50 text-red-400',booked:'bg-emerald-100 text-emerald-700'}; return (
      <tr key={q.id} className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={()=>{setEditingQuote(q);setF({qNumber:q.quote_number,qDate:q.quote_date,qCustomer:q.customer_name,qEmail:q.customer_email,qOrigin:q.origin,qDest:q.destination,qPol:q.port_of_loading,qPod:q.port_of_discharge,qContainer:q.container_type,qShipCost:q.shipping_cost,qShipVendor:q.shipping_vendor,qShipLine:q.shipping_line,qTruckCost:q.trucking_cost,qTruckVendor:q.trucking_vendor,qCustomsCost:q.customs_cost,qOtherInternal:q.other_internal_cost,qClientShip:q.client_shipping_fee,qClientTruck:q.client_trucking_fee,qClientCustoms:q.client_customs_fee,qClientService:q.client_service_fee,qClientOther:q.client_other_fee,qDisplayText:q.client_display_text,qShowBreakdown:q.client_show_breakdown,qCurrency:q.currency,qStatus:q.status,qValidUntil:q.valid_until,qNotes:q.notes});setView('add_quote');}}>
        <td className="px-2 py-2 font-bold text-blue-600">{q.quote_number}</td><td className="px-2 py-2">{q.quote_date}</td><td className="px-2 py-2 font-semibold">{q.customer_name}</td><td className="px-2 py-2">{q.origin}→{q.destination}</td><td className="px-2 py-2 text-right text-red-500">{fCur(q.total_internal_cost,q.currency)}</td><td className="px-2 py-2 text-right font-bold">{fCur(q.client_total,q.currency)}</td><td className="px-2 py-2 text-right font-bold" style={{color:q.profit>0?'#10b981':'#ef4444'}}>{fCur(q.profit,q.currency)}</td><td className="px-2 py-2"><span className={'px-2 py-0.5 rounded-full text-[9px] font-bold '+(sc[q.status]||'bg-slate-100')}>{q.status}</span></td>
      </tr>); })}</tbody></table></div></div>);

  // ========== CREATE/EDIT QUOTE ==========
  if (view === 'add_quote') return (<div>
    <button onClick={()=>{setView('quotes');setF({});setEditingQuote(null);}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">{editingQuote?'Edit Quote':'Create Quote'}</h2>
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Quote #</label><input value={f.qNumber||''} onChange={e=>setF({...f,qNumber:e.target.value})} placeholder="Auto" className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Customer *</label><input list="cl" value={f.qCustomer||''} onChange={e=>setF({...f,qCustomer:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="cl">{(customers||[]).map(c=><option key={c.id} value={c.name}/>)}</datalist></div>
        <div><label className="text-[10px] font-semibold">Origin *</label><input list="qol" value={f.qOrigin||''} onChange={e=>setF({...f,qOrigin:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="qol">{origins.map(o=><option key={o} value={o}/>)}</datalist></div>
        <div><label className="text-[10px] font-semibold">Destination *</label><input list="qdl" value={f.qDest||''} onChange={e=>setF({...f,qDest:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="qdl">{destinations.map(d=><option key={d} value={d}/>)}</datalist></div>
        <div><label className="text-[10px] font-semibold">Container</label><select value={f.qContainer||'40ft'} onChange={e=>setF({...f,qContainer:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CONTAINER_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Currency</label><select value={f.qCurrency||'USD'} onChange={e=>setF({...f,qCurrency:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Valid Until</label><input type="date" value={f.qValidUntil||''} onChange={e=>setF({...f,qValidUntil:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Email</label><input value={f.qEmail||''} onChange={e=>setF({...f,qEmail:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      </div>
      <div className="bg-red-50 rounded-lg p-3 mb-4 border border-red-200"><h3 className="text-xs font-bold text-red-800 mb-2">🔒 Internal Costs (hidden from client)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Shipping Cost</label><input type="number" value={f.qShipCost||''} onChange={e=>setF({...f,qShipCost:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Shipping Vendor</label><input list="qsvl" value={f.qShipVendor||''} onChange={e=>setF({...f,qShipVendor:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="qsvl">{vendors.map(v=><option key={v} value={v}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Shipping Line</label><input list="qsll" value={f.qShipLine||''} onChange={e=>setF({...f,qShipLine:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="qsll">{lines.map(l=><option key={l} value={l}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Trucking Cost</label><input type="number" value={f.qTruckCost||''} onChange={e=>setF({...f,qTruckCost:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Trucking Vendor</label><input value={f.qTruckVendor||''} onChange={e=>setF({...f,qTruckVendor:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Customs Cost</label><input type="number" value={f.qCustomsCost||''} onChange={e=>setF({...f,qCustomsCost:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Other Internal</label><input type="number" value={f.qOtherInternal||''} onChange={e=>setF({...f,qOtherInternal:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>
        <div className="mt-2 text-right"><span className="text-xs">Our Total: </span><span className="text-lg font-extrabold text-red-700">{fCur(Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0),f.qCurrency||'USD')}</span></div></div>
      <div className="bg-emerald-50 rounded-lg p-3 mb-4 border border-emerald-200"><h3 className="text-xs font-bold text-emerald-800 mb-2">👤 Client Quote (what customer sees)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Shipping Fee</label><input type="number" value={f.qClientShip||''} onChange={e=>setF({...f,qClientShip:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Trucking Fee</label><input type="number" value={f.qClientTruck||''} onChange={e=>setF({...f,qClientTruck:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Customs Fee</label><input type="number" value={f.qClientCustoms||''} onChange={e=>setF({...f,qClientCustoms:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Service Fee</label><input type="number" value={f.qClientService||''} onChange={e=>setF({...f,qClientService:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm bg-emerald-100" /></div>
          <div><label className="text-[10px] font-semibold">Other Fee</label><input type="number" value={f.qClientOther||''} onChange={e=>setF({...f,qClientOther:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div className="col-span-3"><label className="text-[10px] font-semibold">Display Text (what client reads)</label><input value={f.qDisplayText||''} onChange={e=>setF({...f,qDisplayText:e.target.value})} placeholder="e.g. All-in shipping fee, door to port..." className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs mt-2"><input type="checkbox" checked={f.qShowBreakdown||false} onChange={e=>setF({...f,qShowBreakdown:e.target.checked})} /> Show breakdown to client</label>
        <div className="mt-2 text-right"><span className="text-xs">Client Total: </span><span className="text-lg font-extrabold text-emerald-700">{fCur(Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0),f.qCurrency||'USD')}</span></div></div>
      {(() => { const iT=Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0); const cT=Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0); const p=cT-iT; const pct=iT>0?((p/iT)*100).toFixed(1):0; return (<div className={'rounded-lg p-4 mb-4 border-2 '+(p>0?'bg-green-50 border-green-300':p<0?'bg-red-50 border-red-300':'bg-slate-50 border-slate-200')}><div className="flex justify-between items-center"><div className="text-sm font-bold">Profit</div><div><span className={'text-2xl font-extrabold '+(p>0?'text-green-600':'text-red-600')}>{fCur(p,f.qCurrency||'USD')}</span><span className="text-xs text-slate-500 ml-2">({pct}%)</span></div></div></div>); })()}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Status</label><select value={f.qStatus||'draft'} onChange={e=>setF({...f,qStatus:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{QUOTE_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Notes</label><input value={f.qNotes||''} onChange={e=>setF({...f,qNotes:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      </div>
      <div className="flex gap-2"><button onClick={handleSaveQuote} className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">{editingQuote?'Update':'Save Quote'} ✓</button><button onClick={()=>{setView('quotes');setF({});setEditingQuote(null);}} className="px-5 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button></div>
    </div></div>);

  // ========== ROUTE DETAIL ==========
  if (view === 'route_detail' && selectedRoute) {
    const bookings = routeHistory.filter(r=>r.booked); const active = routeHistory.filter(r=>!isExpired(r.expiry_date)); const byVL = {}; active.forEach(r => { const k=(r.vendor_name||'?')+' / '+(r.shipping_line||'N/A'); if(!byVL[k])byVL[k]=[]; byVL[k].push(r); });
    const chartData = {}; routeHistory.forEach(r => { const m=(r.effective_date||'').substring(0,7); if(!m)return; if(!chartData[m])chartData[m]={month:m,rates:[],min:Infinity,max:0}; chartData[m].rates.push(Number(r.rate_amount||0)); chartData[m].min=Math.min(chartData[m].min,Number(r.rate_amount||0)); chartData[m].max=Math.max(chartData[m].max,Number(r.rate_amount||0)); }); Object.values(chartData).forEach(d=>{d.avg=Math.round(d.rates.reduce((a,b)=>a+b,0)/d.rates.length);}); const chartSorted=Object.values(chartData).sort((a,b)=>a.month.localeCompare(b.month));
    return (<div>
      <button onClick={()=>{setSelectedRoute(null);setView('routes');}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
      <h2 className="text-xl font-extrabold mb-1">🚢 {selectedRoute.origin} → {selectedRoute.destination}</h2>
      <p className="text-xs text-slate-500 mb-3">{routeHistory.length} rates • {active.length} active • {bookings.length} booked</p>
      <div className="grid grid-cols-5 gap-3 mb-4">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Best Active</div><div className="text-lg font-extrabold text-emerald-600">{active.length>0?fCur(Math.min(...active.map(r=>r.rate_amount||Infinity)),active[0]?.currency):'—'}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Highest</div><div className="text-lg font-extrabold text-red-500">{fCur(Math.max(...routeHistory.map(r=>r.rate_amount||0)),routeHistory[0]?.currency)}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Avg</div><div className="text-lg font-extrabold">{fCur(Math.round(routeHistory.reduce((a,r)=>a+Number(r.rate_amount||0),0)/routeHistory.length),routeHistory[0]?.currency)}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Vendors</div><div className="text-lg font-extrabold">{Object.keys(byVL).length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Booked</div><div className="text-lg font-extrabold">{bookings.length}</div></div>
      </div>
      {chartSorted.length > 1 && (<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">📈 Rate Trend</h3><div className="flex items-end gap-1 h-[120px]">{chartSorted.map((d,i)=>{const mx=Math.max(...chartSorted.map(x=>x.max)); const h=mx>0?(d.avg/mx)*100:0; return (<div key={d.month} className="flex-1 flex flex-col items-center" title={d.month+': avg $'+d.avg}><div className="text-[8px] text-slate-400 mb-1">${d.avg}</div><div className="w-full rounded-t" style={{height:h+'%',background:i===chartSorted.length-1?'#0ea5e9':'#cbd5e1',minHeight:4}}></div><div className="text-[8px] text-slate-400 mt-1 -rotate-45">{d.month.substring(5)}</div></div>);})}</div></div>)}
      {Object.keys(byVL).length > 0 && (<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">🏆 Active Vendor / Line Comparison</h3><div className="overflow-auto"><table className="w-full border-collapse text-xs"><thead><tr className="bg-slate-50"><th className="px-3 py-2 text-left text-[10px]">Vendor / Line</th><th className="px-3 py-2 text-right text-[10px]">Best Rate</th><th className="px-3 py-2 text-right text-[10px]">Transit</th><th className="px-3 py-2 text-right text-[10px]">Free Days</th><th className="px-3 py-2 text-[10px]">Expiry</th><th className="px-3 py-2 text-right text-[10px]">Quotes</th></tr></thead><tbody>{Object.entries(byVL).sort((a,b)=>(a[1][0]?.rate_amount||Infinity)-(b[1][0]?.rate_amount||Infinity)).map(([key,vr],i)=>{const b=vr.reduce((a,b)=>(a.rate_amount||Infinity)<(b.rate_amount||Infinity)?a:b); return (<tr key={key} className={'border-b border-slate-50 '+(i===0?'bg-emerald-50':'')}><td className="px-3 py-2 font-semibold">{i===0&&<span className="text-emerald-500 mr-1">★</span>}{key}</td><td className="px-3 py-2 text-right font-bold text-blue-600">{fCur(b.rate_amount,b.currency)}</td><td className="px-3 py-2 text-right">{b.transit_days?b.transit_days+'d':'—'}</td><td className="px-3 py-2 text-right">{b.free_days||'—'}</td><td className="px-3 py-2"><ExpiryBadge date={b.expiry_date}/></td><td className="px-3 py-2 text-right text-slate-400">{vr.length}</td></tr>);})}</tbody></table></div></div>)}
      {bookings.length > 0 && (<div className="bg-green-50 rounded-xl p-4 mb-4 border border-green-200"><h3 className="text-sm font-bold text-green-800 mb-2">✅ Booking History ({bookings.length})</h3>{bookings.map(b=>(<div key={b.id} className="flex justify-between items-center py-2 border-b border-green-100"><div><div className="text-xs font-semibold">{b.vendor_name} / {b.shipping_line||'N/A'}</div><div className="text-[10px] text-slate-500">{b.booking_date} • Ref: {b.shipment_reference||'—'}</div></div><div className="text-right"><div className="text-xs font-bold text-blue-600">{fCur(b.rate_amount,b.currency)}</div><div className="text-[10px] text-slate-400">{b.container_type}</div></div></div>))}</div>)}
      <div className="bg-white rounded-xl p-4 border border-slate-200"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-bold">All Rates</h3><button onClick={()=>{setF({origin:selectedRoute.origin,destination:selectedRoute.destination});setView('add_rate');}} className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">+ Add Rate</button></div>
      <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200"><table className="w-full border-collapse text-xs"><thead className="sticky top-0"><tr className="bg-slate-50"><th className="px-2 py-2 text-[10px] text-left">Date</th><th className="px-2 py-2 text-[10px] text-left">Vendor</th><th className="px-2 py-2 text-[10px] text-left">Line</th><th className="px-2 py-2 text-[10px]">Container</th><th className="px-2 py-2 text-[10px] text-right">Rate</th><th className="px-2 py-2 text-[10px] text-right">Total</th><th className="px-2 py-2 text-[10px]">Expiry</th><th className="px-2 py-2 text-[10px]">Booked</th><th className="px-2 py-2 text-[10px]"></th></tr></thead><tbody>{routeHistory.map(r=>{const exp=isExpired(r.expiry_date); return (<tr key={r.id} className={'border-b border-slate-50 '+(exp?'bg-red-50/50':'')+(r.booked?' bg-green-50/50':'')}><td className="px-2 py-1.5">{r.effective_date}</td><td className="px-2 py-1.5 font-semibold">{r.vendor_name}</td><td className="px-2 py-1.5">{r.shipping_line||'—'}</td><td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{r.container_type}</span></td><td className={'px-2 py-1.5 text-right font-bold '+(exp?'text-red-400 line-through':'text-blue-600')}>{fCur(r.rate_amount,r.currency)}</td><td className="px-2 py-1.5 text-right font-bold text-amber-600">{fCur(r.total_cost,r.currency)}</td><td className="px-2 py-1.5"><ExpiryBadge date={r.expiry_date}/></td><td className="px-2 py-1.5">{r.booked?<span className="text-emerald-600 text-[10px] font-bold">✓ {r.shipment_reference}</span>:''}</td><td className="px-2 py-1.5 flex gap-1">{!r.booked&&!exp&&<button onClick={()=>handleMarkBooked(r)} className="px-2 py-0.5 rounded border border-green-300 text-green-600 text-[10px]">Book</button>}<button onClick={()=>{setEditingRate(r);setF({origin:r.origin,destination:r.destination,vendorName:r.vendor_name,shippingLine:r.shipping_line,transportMode:r.transport_mode,containerType:r.container_type,rateAmount:r.rate_amount,currency:r.currency,transitDays:r.transit_days,freeDays:r.free_days,portFees:r.port_fees,thcFees:r.thc_fees,docFees:r.documentation_fees,customsFees:r.customs_fees,otherFees:r.other_fees,otherFeesDesc:r.other_fees_desc,effectiveDate:r.effective_date,expiryDate:r.expiry_date,pol:r.port_of_loading,pod:r.port_of_discharge,notes:r.notes,booked:r.booked,shipmentRef:r.shipment_reference,bookingDate:r.booking_date,bookingNotes:r.booking_notes});setView('add_rate');}} className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]">Edit</button>{isAdmin&&<button onClick={()=>handleDeleteRate(r)} className="px-2 py-0.5 rounded border border-red-300 text-red-500 text-[10px]">Del</button>}</td></tr>);})}</tbody></table></div></div>
      {routeQuotes.length > 0 && (<div className="bg-white rounded-xl p-4 mt-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">📋 Quotes ({routeQuotes.length})</h3>{routeQuotes.map(q=>(<div key={q.id} className="flex justify-between items-center py-2 border-b border-slate-50"><div><div className="text-xs font-semibold">{q.quote_number} — {q.customer_name}</div><div className="text-[10px] text-slate-500">{q.quote_date} • {q.status}</div></div><div className="text-right"><div className="text-xs">Client: <span className="font-bold">{fCur(q.client_total,q.currency)}</span></div><div className="text-[10px]" style={{color:q.profit>0?'#10b981':'#ef4444'}}>Profit: {fCur(q.profit,q.currency)}</div></div></div>))}</div>)}
    </div>);
  }

  // ========== IMPORT ==========
  if (view === 'import') return (<div>
    <button onClick={()=>{setView('routes');setImportData([]);setImportStep('select');}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">Import Shipping Rates</h2>
    {importStep==='select'&&<div className="bg-white rounded-xl p-6 text-center border-2 border-dashed border-blue-300"><div className="text-4xl mb-2">📁</div><p className="text-xs text-slate-400 mb-3">Columns: Origin, Destination, Vendor, Shipping Line, Rate, Container, Transit, Free Days, Expiry...</p><label className="px-6 py-3 bg-blue-500 text-white rounded-lg text-sm font-semibold cursor-pointer inline-block">Select File<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async(e)=>{if(e.target.files[0])await processImportFile(e.target.files[0]);}}/></label></div>}
    {importStep==='preview'&&importData.length>0&&<div><div className="bg-emerald-50 rounded-xl p-4 mb-3 border border-emerald-200 flex justify-between items-center"><span className="text-sm font-bold text-emerald-800">Found {importData.length} rates</span><div className="flex gap-2"><button onClick={()=>{setImportStep('select');setImportData([]);}} className="px-3 py-1.5 border rounded-lg text-xs">Cancel</button><button onClick={executeImport} className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold">Import</button></div></div><div className="overflow-auto max-h-[350px] rounded-lg border bg-white text-xs"><table className="w-full border-collapse"><thead><tr className="bg-slate-50"><th className="px-2 py-1.5 text-[10px]">Origin</th><th className="px-2 py-1.5 text-[10px]">Dest</th><th className="px-2 py-1.5 text-[10px]">Vendor</th><th className="px-2 py-1.5 text-[10px]">Line</th><th className="px-2 py-1.5 text-[10px] text-right">Rate</th><th className="px-2 py-1.5 text-[10px]">Expiry</th></tr></thead><tbody>{importData.slice(0,30).map((r,i)=>(<tr key={i} className="border-b border-slate-50"><td className="px-2 py-1">{r.origin}</td><td className="px-2 py-1">{r.destination}</td><td className="px-2 py-1">{r.vendor_name}</td><td className="px-2 py-1">{r.shipping_line}</td><td className="px-2 py-1 text-right font-bold">{fCur(r.rate_amount,r.currency)}</td><td className="px-2 py-1">{r.expiry_date||'—'}</td></tr>))}</tbody></table></div></div>}
    {importStep==='importing'&&<div className="bg-white rounded-xl p-8 text-center"><div className="text-4xl mb-3">⏳</div><div className="w-full bg-slate-200 rounded-full h-3"><div className="bg-blue-500 h-3 rounded-full" style={{width:importProgress+'%'}}></div></div><p className="text-sm mt-2">{importProgress}%</p></div>}
    {importStep==='done'&&<div className="bg-white rounded-xl p-8 text-center"><div className="text-4xl mb-3">✅</div><h3 className="text-lg font-bold text-emerald-700">Done!</h3><button onClick={()=>{setView('routes');setImportData([]);setImportStep('select');}} className="mt-3 px-6 py-2 bg-blue-500 text-white rounded-lg font-semibold">Done</button></div>}
  </div>);

  // ========== AI ==========
  if (view === 'ai') return (<div>
    <button onClick={()=>setView('routes')} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">🤖 AI Shipping Assistant</h2>
    <div className="bg-white rounded-xl p-5 border mb-3"><div className="flex gap-2 mb-3"><input value={aiQuery} onChange={e=>setAiQuery(e.target.value)} placeholder="Ask about rates..." onKeyDown={e=>{if(e.key==='Enter')handleAiQuery();}} className="flex-1 px-4 py-3 rounded-lg border text-sm" /><button onClick={handleAiQuery} disabled={aiLoading} className="px-5 py-3 bg-blue-500 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{aiLoading?'...':'Ask'}</button></div>
    <div className="flex gap-2 flex-wrap">{['Cheapest active from China?','Compare vendors Turkey','Rates expiring this week?','Quote profit summary','Most booked route?'].map(q=>(<button key={q} onClick={()=>setAiQuery(q)} className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px]">{q}</button>))}</div></div>
    {aiAnswer&&<div className="bg-blue-50 rounded-xl p-5 border border-blue-200"><div className="text-sm whitespace-pre-wrap">{aiAnswer}</div></div>}
  </div>);

  // ========== MAIN ROUTES ==========
  return (<div>
    <div className="flex justify-between flex-wrap gap-2 mb-3">
      <h2 className="text-xl font-extrabold">🚢 Shipping Rates</h2>
      <div className="flex gap-2 items-center flex-wrap">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search..." className="px-3 py-1.5 rounded-lg border text-xs w-32" />
        <button onClick={()=>{setView('add_rate');setF({});setEditingRate(null);}} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Rate</button>
        <button onClick={()=>setView('quotes')} className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-semibold">📋 Quotes</button>
        <button onClick={()=>setView('import')} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold">📥 Import</button>
        <button onClick={()=>setView('ai')} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold">🤖 AI</button>
      </div>
    </div>
    <div className="grid grid-cols-5 gap-3 mb-4">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{rates.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Active</div><div className="text-lg font-extrabold text-emerald-600">{rates.filter(r=>!isExpired(r.expiry_date)).length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Expired</div><div className="text-lg font-extrabold text-red-500">{rates.filter(r=>isExpired(r.expiry_date)).length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Routes</div><div className="text-lg font-extrabold">{routeGroups.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Booked</div><div className="text-lg font-extrabold">{rates.filter(r=>r.booked).length}</div></div>
    </div>
    <div className="flex gap-2 mb-3 flex-wrap">
      <select value={filterOrigin} onChange={e=>setFilterOrigin(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Origins</option>{origins.map(o=><option key={o} value={o}>{o}</option>)}</select>
      <select value={filterDest} onChange={e=>setFilterDest(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Destinations</option>{destinations.map(d=><option key={d} value={d}>{d}</option>)}</select>
      <select value={filterVendor} onChange={e=>setFilterVendor(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Vendors</option>{vendors.map(v=><option key={v} value={v}>{v}</option>)}</select>
      <select value={filterLine} onChange={e=>setFilterLine(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Lines</option>{lines.map(l=><option key={l} value={l}>{l}</option>)}</select>
      <select value={filterExpiry} onChange={e=>setFilterExpiry(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Rates</option><option value="active">Active Only</option><option value="expired">Expired Only</option></select>
    </div>
    {routeGroups.length===0?(<div className="bg-white rounded-xl p-8 text-center border"><div className="text-4xl mb-2">🚢</div><p className="text-sm text-slate-400">No rates yet</p></div>):(<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{routeGroups.map(rg=>{const c=rg.cheapest; return (<div key={rg.key} onClick={()=>{setSelectedRoute({origin:rg.origin,destination:rg.destination});setView('route_detail');}} className="bg-white rounded-xl p-4 cursor-pointer border border-slate-200 hover:shadow-lg hover:-translate-y-0.5 transition-all">
      <div className="flex justify-between items-start mb-2"><div><div className="text-sm font-extrabold text-blue-700">{rg.origin}</div><div className="text-[10px] text-slate-400">↓</div><div className="text-sm font-extrabold text-emerald-700">{rg.destination}</div></div><div className="text-right">{c?(<><div className="text-[9px] text-slate-400">Best Active</div><div className="text-lg font-extrabold text-emerald-600">{fCur(c.rate_amount,c.currency)}</div><div className="text-[9px] text-blue-500">{c.vendor_name}{c.shipping_line?' / '+c.shipping_line:''}</div><ExpiryBadge date={c.expiry_date}/></>):(<div className="text-xs text-red-400 font-bold">All Expired</div>)}</div></div>
      <div className="flex gap-1 flex-wrap mb-2">{[...rg.lines].filter(Boolean).map(l=><span key={l} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px]">{l}</span>)}{[...rg.modes].map(m=><span key={m} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{m}</span>)}</div>
      <div className="flex justify-between text-[10px] text-slate-500 border-t border-slate-100 pt-2"><span>{rg.activeCount} active{rg.expiredCount>0&&<span className="text-red-400 ml-1">({rg.expiredCount} expired)</span>}</span><span>{[...rg.vendors].length} vendors</span>{rg.bookingCount>0&&<span className="text-emerald-600">✓ {rg.bookingCount}x booked</span>}</div>
    </div>);})}</div>)}
  </div>);
}
