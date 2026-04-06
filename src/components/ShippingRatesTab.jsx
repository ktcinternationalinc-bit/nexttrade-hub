'use client';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { fE, fmt } from '../lib/utils';
import * as XLSX from 'xlsx';

const CONTAINER_TYPES = ['20ft', '40ft', '40ft HC', '45ft', 'LCL', 'Bulk', 'Flatbed', 'Reefer', 'Open Top', 'Truck', 'Trailer'];
const TRANSPORT_MODES = ['Ocean', 'Trucking', 'Air', 'Rail', 'Multi-modal'];
const RATE_TYPES = ['Shipping', 'Trucking', 'Customs/Brokerage'];
const CURRENCIES = ['USD', 'EUR', 'EGP', 'GBP', 'SAR', 'AED', 'CNY', 'TRY'];
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'booked'];
const fCur = (amount, currency) => { if (!amount && amount !== 0) return '—'; const sym = { USD: '\$', EUR: '€', EGP: 'E£', GBP: '£', CNY: '¥', TRY: '₺', SAR: 'SR', AED: 'AED ' }; return (sym[currency] || currency + ' ') + Number(amount).toLocaleString(); };
const isExpired = (d) => d && d < new Date().toISOString().substring(0, 10);
const daysUntil = (d) => { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); };

function ExpiryBadge({ date }) {
  if (!date) return <span className="text-[9px] text-slate-400">No expiry</span>;
  const d = daysUntil(date); const exp = d < 0; const soon = d >= 0 && d <= 7;
  return <span className={'px-1.5 py-0.5 rounded text-[9px] font-bold ' + (exp ? 'bg-red-100 text-red-600' : soon ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-700')}>{exp ? 'Expired ' + Math.abs(d) + 'd ago' : d === 0 ? 'Expires today' : d + 'd left'}</span>;
}

// ========== RATE PICKER ==========
function RatePicker({ rates, label, rateType, origin, destination, selected, onSelect, onClear }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const available = useMemo(() => {
    let arr = rates.filter(r => !isExpired(r.expiry_date));
    if (rateType) arr = arr.filter(r => (r.rate_type || '').toLowerCase() === rateType.toLowerCase());
    if (origin) arr = arr.filter(r => r.origin === origin);
    if (destination) arr = arr.filter(r => r.destination === destination);
    if (search) { const s = search.toLowerCase(); arr = arr.filter(r => [r.vendor_name, r.shipping_line, r.origin, r.destination, r.container_type].filter(Boolean).join(' ').toLowerCase().includes(s)); }
    return arr.sort((a, b) => (a.rate_amount || Infinity) - (b.rate_amount || Infinity));
  }, [rates, rateType, origin, destination, search]);

  if (selected) {
    const r = rates.find(x => x.id === selected);
    if (!r) return null;
    return (<div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[10px] font-bold text-blue-600 mb-0.5">{label} — Selected</div>
          <div className="text-sm font-bold">{r.vendor_name} {r.shipping_line ? '/ ' + r.shipping_line : ''}</div>
          <div className="text-[10px] text-slate-500">{r.origin} → {r.destination} • {r.container_type} • {r.rate_type || r.transport_mode}{r.transit_days ? ' • ' + r.transit_days + 'd transit' : ''}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold text-blue-700">{fCur(r.total_cost || r.rate_amount, r.currency)}</div>
          <button onClick={onClear} className="text-[10px] text-red-500 underline mt-1">Change</button>
        </div>
      </div>
    </div>);
  }

  return (<div className="border rounded-lg overflow-hidden">
    <div className="flex justify-between items-center bg-slate-50 px-3 py-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <span className="text-xs font-bold">{label} — Pick from DB ({available.length} rates)</span>
      <span className="text-xs text-slate-400">{expanded ? '▲' : '▼'}</span>
    </div>
    {expanded && (<div className="p-2 bg-white">
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, line..." className="w-full px-3 py-1.5 border rounded text-xs mb-2" />
      {available.length === 0 ? <div className="text-center text-xs text-slate-400 py-3">No rates found{origin ? ` for ${origin} → ${destination}` : '. Set origin & destination first.'}</div> : (
        <div className="max-h-[180px] overflow-auto space-y-1">{available.map(r => (
          <div key={r.id} onClick={() => { onSelect(r); setExpanded(false); setSearch(''); }}
            className="flex justify-between items-center p-2 rounded hover:bg-blue-50 cursor-pointer border border-transparent hover:border-blue-200">
            <div>
              <div className="text-xs font-semibold">{r.vendor_name} {r.shipping_line ? '/ ' + r.shipping_line : ''}</div>
              <div className="text-[10px] text-slate-500">{r.origin}→{r.destination} • {r.container_type} • <span className="font-semibold text-indigo-600">{r.rate_type || r.transport_mode}</span>{r.transit_days ? ' • ' + r.transit_days + 'd' : ''}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-extrabold text-blue-600">{fCur(r.total_cost || r.rate_amount, r.currency)}</div>
              <ExpiryBadge date={r.expiry_date} />
            </div>
          </div>
        ))}</div>
      )}
      <div className="text-center mt-2"><button onClick={() => { onSelect(null); setExpanded(false); }} className="text-[10px] text-slate-400 underline">Enter manually instead</button></div>
    </div>)}
  </div>);
}

// ========== QUOTE PRINT PREVIEW ==========
function QuotePrintView({ quote, onClose }) {
  const printRef = useRef(null);
  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank', 'width=800,height=1100');
    win.document.write(`<!DOCTYPE html><html><head><title>Quote ${quote.quote_number}</title><style>
      @media print { body { margin: 0; } @page { margin: 20mm 15mm; } }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; line-height: 1.5; padding: 40px; }
      .hdr { display: flex; justify-content: space-between; border-bottom: 3px solid #0ea5e9; padding-bottom: 20px; margin-bottom: 30px; }
      .co { font-size: 24px; font-weight: 800; } .co-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
      .qt { font-size: 20px; font-weight: 800; color: #0ea5e9; text-align: right; }
      .qm { font-size: 11px; color: #64748b; text-align: right; margin-top: 4px; }
      .sec { margin-bottom: 24px; } .st { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
      .ig { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .il { font-size: 10px; color: #94a3b8; text-transform: uppercase; } .iv { font-size: 13px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; }
      td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; } .am { text-align: right; font-weight: 700; }
      .tr td { border-top: 2px solid #0ea5e9; font-weight: 800; font-size: 15px; background: #f0f9ff; }
      .ft { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
      .vl { background: #fef3c7; padding: 10px 16px; border-radius: 6px; font-size: 12px; color: #92400e; margin-top: 16px; text-align: center; }
      .nt { background: #f8fafc; padding: 12px 16px; border-radius: 6px; font-size: 12px; color: #475569; margin-top: 12px; }
    </style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };
  const cur = quote.currency || 'USD';
  const showBD = quote.client_show_breakdown;
  return (<div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-[700px] my-8">
      <div className="flex justify-between items-center p-4 border-b">
        <h3 className="text-lg font-bold">Quote Preview — {quote.quote_number}</h3>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold">🖨️ Print / Save PDF</button>
          <button onClick={onClose} className="px-3 py-2 border rounded-lg text-sm">Close</button>
        </div>
      </div>
      <div className="p-6 text-sm" ref={printRef}>
        <div className="hdr"><div><div className="co">KTC Trading Operations</div><div className="co-sub">International Trading & Logistics</div></div><div><div className="qt">SHIPPING QUOTE</div><div className="qm">{quote.quote_number}<br/>{quote.quote_date}</div></div></div>
        <div className="sec"><div className="st">Client</div><div className="ig"><div><div className="il">Customer</div><div className="iv">{quote.customer_name}</div></div>{quote.customer_email&&<div><div className="il">Email</div><div className="iv">{quote.customer_email}</div></div>}</div></div>
        <div className="sec"><div className="st">Shipment Details</div><div className="ig">
          <div><div className="il">Origin</div><div className="iv">{quote.origin}</div></div>
          <div><div className="il">Destination</div><div className="iv">{quote.destination}</div></div>
          {quote.port_of_loading&&<div><div className="il">POL</div><div className="iv">{quote.port_of_loading}</div></div>}
          {quote.port_of_discharge&&<div><div className="il">POD</div><div className="iv">{quote.port_of_discharge}</div></div>}
          <div><div className="il">Container</div><div className="iv">{quote.container_type}</div></div>
          <div><div className="il">Currency</div><div className="iv">{cur}</div></div>
        </div></div>
        <div className="sec"><div className="st">Pricing</div>
          {showBD ? (<table><thead><tr><th>Service</th><th className="am">Amount</th></tr></thead><tbody>
            {quote.client_shipping_fee>0&&<tr><td>Ocean Freight / Shipping</td><td className="am">{fCur(quote.client_shipping_fee,cur)}</td></tr>}
            {quote.client_trucking_fee>0&&<tr><td>Inland Trucking</td><td className="am">{fCur(quote.client_trucking_fee,cur)}</td></tr>}
            {quote.client_customs_fee>0&&<tr><td>Customs & Brokerage</td><td className="am">{fCur(quote.client_customs_fee,cur)}</td></tr>}
            {quote.client_service_fee>0&&<tr><td>Service Fee</td><td className="am">{fCur(quote.client_service_fee,cur)}</td></tr>}
            {quote.client_other_fee>0&&<tr><td>{quote.client_other_desc||'Other'}</td><td className="am">{fCur(quote.client_other_fee,cur)}</td></tr>}
            <tr className="tr"><td>TOTAL</td><td className="am">{fCur(quote.client_total,cur)}</td></tr>
          </tbody></table>) : (<div>
            {quote.client_display_text&&<p style={{fontSize:13,color:'#475569',marginBottom:12}}>{quote.client_display_text}</p>}
            <table><tbody><tr className="tr"><td>{quote.client_display_text||'All-inclusive Shipping'}</td><td className="am">{fCur(quote.client_total,cur)}</td></tr></tbody></table>
          </div>)}
        </div>
        {quote.valid_until&&<div className="vl">This quote is valid until <strong>{quote.valid_until}</strong></div>}
        {quote.notes&&<div className="nt"><strong>Notes:</strong> {quote.notes}</div>}
        <div className="ft"><div>KTC Trading Operations — International Trading & Logistics</div><div style={{marginTop:4}}>Generated {new Date().toLocaleDateString()}</div></div>
      </div>
    </div>
  </div>);
}

// ========== REQUEST QUOTE MODAL ==========
function RequestQuoteModal({ data, onClose, origins, destinations, openWhatsApp, openEmail, generateQuoteRequest }) {
  const [origin, setOrigin] = useState(data.origin || '');
  const [dest, setDest] = useState(data.destination || 'Egypt');
  const [container, setContainer] = useState(data.container || '40ft');
  const [commodity, setCommodity] = useState('General cargo / Trading materials');
  const vendor = data.vendor;
  const { subject, body } = generateQuoteRequest(vendor, origin, dest, container);
  // Custom body with commodity
  const customBody = body.replace('General cargo / Trading materials', commodity);

  return (<div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-4" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-[600px] my-8">
      <div className="p-4 border-b flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold">📋 Request Rate Quote</h3>
          <p className="text-xs text-slate-500">From: {vendor.company_name}{vendor.contact_name ? ' — ' + vendor.contact_name : ''}</p>
        </div>
        <button onClick={onClose} className="text-2xl text-slate-400">×</button>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] font-semibold">Origin</label><input list="rq-origins" value={origin} onChange={e=>setOrigin(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="e.g. China, Turkey..." /><datalist id="rq-origins">{origins.map(o=><option key={o} value={o}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Destination</label><input list="rq-dests" value={dest} onChange={e=>setDest(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="rq-dests">{destinations.map(d=><option key={d} value={d}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Container</label><select value={container} onChange={e=>setContainer(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm">{CONTAINER_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><label className="text-[10px] font-semibold">Commodity</label><input value={commodity} onChange={e=>setCommodity(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>

        {/* Preview */}
        <div className="bg-slate-50 rounded-lg p-3 mb-4 border max-h-[200px] overflow-auto">
          <div className="text-[10px] font-semibold text-slate-500 mb-1">Message Preview:</div>
          <pre className="text-xs whitespace-pre-wrap text-slate-700" style={{fontFamily:'inherit'}}>{customBody}</pre>
        </div>

        {/* Action Buttons — BIG for mobile */}
        <div className="space-y-2">
          {vendor.whatsapp && (
            <button onClick={()=>{openWhatsApp(vendor.whatsapp, customBody);onClose();}}
              className="w-full py-4 rounded-xl text-base font-bold bg-emerald-500 text-white flex items-center justify-center gap-2 hover:bg-emerald-600 transition"
              style={{boxShadow:'0 4px 15px rgba(52,211,153,0.3)'}}>
              💬 Send via WhatsApp
            </button>
          )}
          {vendor.email && (
            <button onClick={()=>{openEmail(vendor.email, subject, customBody);onClose();}}
              className="w-full py-4 rounded-xl text-base font-bold bg-blue-500 text-white flex items-center justify-center gap-2 hover:bg-blue-600 transition"
              style={{boxShadow:'0 4px 15px rgba(56,189,248,0.3)'}}>
              📧 Send via Email
            </button>
          )}
          {vendor.phone && (
            <a href={'tel:'+vendor.phone}
              className="w-full py-3 rounded-xl text-sm font-bold border-2 border-slate-200 text-slate-600 flex items-center justify-center gap-2 hover:bg-slate-50 transition block text-center">
              📞 Call {vendor.contact_name || vendor.company_name}
            </a>
          )}
          {!vendor.whatsapp && !vendor.email && (
            <div className="text-center text-sm text-red-500 py-4">No email or WhatsApp on file for this vendor. Edit the vendor to add contact info.</div>
          )}
        </div>
      </div>
    </div>
  </div>);
}

export default function ShippingRatesTab({ user, isAdmin, customers }) {
  const [rates, setRates] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [bookings, setBookings] = useState([]);
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
  const [previewQuote, setPreviewQuote] = useState(null);
  const [pickedShipRate, setPickedShipRate] = useState(null);
  const [pickedTruckRate, setPickedTruckRate] = useState(null);
  const [pickedBrokerRate, setPickedBrokerRate] = useState(null);
  const [manualShip, setManualShip] = useState(false);
  const [manualTruck, setManualTruck] = useState(false);
  const [manualBroker, setManualBroker] = useState(false);
  const [vendorContacts, setVendorContacts] = useState([]);
  const [editingVendor, setEditingVendor] = useState(null);
  const [requestQuoteData, setRequestQuoteData] = useState(null);

  const fetchAll = async (table, orderCol) => { let all = [], from = 0; while (true) { const { data } = await supabase.from(table).select('*').order(orderCol, { ascending: false }).range(from, from + 999); if (!data || data.length === 0) break; all = all.concat(data); if (data.length < 1000) break; from += 1000; } return all; };
  const loadData = useCallback(async () => { setLoading(true); try { const [r, q, b, vc] = await Promise.all([fetchAll('shipping_rates', 'effective_date'), fetchAll('shipping_quotes', 'quote_date').catch(() => []), fetchAll('shipping_bookings', 'booking_date').catch(() => []), supabase.from('vendor_contacts').select('*').order('company_name').then(r => r.data || []).catch(() => [])]); setRates(r); setQuotes(q); setBookings(b); setVendorContacts(vc); } catch (err) { console.error(err); } setLoading(false); }, []);
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
    return Object.entries(groups).map(([key, data]) => { const ar = data.rates.filter(r => !isExpired(r.expiry_date)); const ch = ar.length > 0 ? ar.reduce((a,b) => (a.rate_amount||Infinity) < (b.rate_amount||Infinity) ? a : b) : null; return { key, ...data, cheapest: ch, activeCount: ar.length, expiredCount: data.rates.length - ar.length, count: data.rates.length }; }).sort((a,b) => b.count - a.count);
  }, [filtered]);

  const routeHistory = useMemo(() => { if (!selectedRoute) return []; return rates.filter(r => r.origin === selectedRoute.origin && r.destination === selectedRoute.destination).sort((a,b) => (b.effective_date||'').localeCompare(a.effective_date||'')); }, [selectedRoute, rates]);
  const routeQuotes = useMemo(() => { if (!selectedRoute) return []; return quotes.filter(q => q.origin === selectedRoute.origin && q.destination === selectedRoute.destination).sort((a,b) => (b.quote_date||'').localeCompare(a.quote_date||'')); }, [selectedRoute, quotes]);
  const rateBookings = (rateId) => bookings.filter(b => b.rate_id === rateId);
  const routeBookings = (origin, dest) => { const rateIds = new Set(rates.filter(r => r.origin === origin && r.destination === dest).map(r => r.id)); return bookings.filter(b => rateIds.has(b.rate_id)); };

  const handleSaveRate = async () => {
    if (!f.origin || !f.destination || !f.vendorName) { alert('Fill Origin, Destination, Vendor'); return; }
    if (!f.rateType) { alert('Rate Type is required! Select Shipping, Trucking, or Customs/Brokerage.\n\nنوع السعر مطلوب! اختر شحن أو نقل بري أو جمارك'); return; }
    const record = { origin: f.origin, destination: f.destination, vendor_name: f.vendorName, shipping_line: f.shippingLine || '', transport_mode: f.transportMode || 'Ocean', rate_type: f.rateType, container_type: f.containerType || '40ft', rate_amount: Number(f.rateAmount) || 0, currency: f.currency || 'USD', transit_days: f.transitDays ? Number(f.transitDays) : null, free_days: f.freeDays ? Number(f.freeDays) : null, port_fees: Number(f.portFees) || 0, thc_fees: Number(f.thcFees) || 0, documentation_fees: Number(f.docFees) || 0, customs_fees: Number(f.customsFees) || 0, other_fees: Number(f.otherFees) || 0, other_fees_desc: f.otherFeesDesc || '', total_cost: Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), effective_date: f.effectiveDate || new Date().toISOString().substring(0,10), expiry_date: f.expiryDate || null, port_of_loading: f.pol || '', port_of_discharge: f.pod || '', notes: f.notes || '', is_active: true, booked: f.booked || false, shipment_reference: f.shipmentRef || '', booking_date: f.bookingDate || null, booking_notes: f.bookingNotes || '' };
    try { if (editingRate) await dbUpdate('shipping_rates', editingRate.id, record, user?.id); else await dbInsert('shipping_rates', record, user?.id); setF({}); setEditingRate(null); setView(selectedRoute ? 'route_detail' : 'routes'); await loadData(); } catch (err) { alert('Error: ' + err.message); }
  };

  const handleMarkBooked = async (rate) => { const ref = prompt('Shipment reference #:'); if (ref === null || !ref.trim()) return; const cust = prompt('Customer name (optional):') || ''; try { await dbInsert('shipping_bookings', { rate_id: rate.id, shipment_reference: ref, customer_name: cust, booking_date: new Date().toISOString().substring(0,10) }, user?.id); await dbUpdate('shipping_rates', rate.id, { booked: true }, user?.id); await loadData(); } catch (err) { alert(err.message); } };

  const handleSaveQuote = async () => {
    if (!f.qCustomer || !f.qOrigin || !f.qDest) { alert('Fill Customer, Origin, Destination'); return; }
    const iT = Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0);
    const cT = Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0);
    const profit = cT - iT;
    const record = { quote_number: f.qNumber || ('Q-' + Date.now().toString(36).toUpperCase()), quote_date: f.qDate || new Date().toISOString().substring(0,10), customer_name: f.qCustomer, customer_email: f.qEmail || '', origin: f.qOrigin, destination: f.qDest, port_of_loading: f.qPol || '', port_of_discharge: f.qPod || '', container_type: f.qContainer || '40ft', shipping_rate_id: pickedShipRate || f.qRateId || null, shipping_cost: Number(f.qShipCost)||0, shipping_vendor: f.qShipVendor || '', shipping_line: f.qShipLine || '', trucking_cost: Number(f.qTruckCost)||0, trucking_vendor: f.qTruckVendor || '', customs_cost: Number(f.qCustomsCost)||0, other_internal_cost: Number(f.qOtherInternal)||0, other_internal_desc: f.qOtherInternalDesc || '', total_internal_cost: iT, client_shipping_fee: Number(f.qClientShip)||0, client_trucking_fee: Number(f.qClientTruck)||0, client_customs_fee: Number(f.qClientCustoms)||0, client_service_fee: Number(f.qClientService)||0, client_other_fee: Number(f.qClientOther)||0, client_other_desc: f.qClientOtherDesc || '', client_total: cT, client_display_text: f.qDisplayText || '', client_show_breakdown: f.qShowBreakdown || false, profit, profit_pct: iT > 0 ? Math.round((profit/iT)*10000)/100 : 0, currency: f.qCurrency || 'USD', status: f.qStatus || 'draft', valid_until: f.qValidUntil || null, notes: f.qNotes || '' };
    try { if (editingQuote) await dbUpdate('shipping_quotes', editingQuote.id, record, user?.id); else await dbInsert('shipping_quotes', record, user?.id); await logActivity(user?.id, `Quote ${record.quote_number} ${editingQuote?'updated':'created'} for ${record.customer_name}`); resetQuoteForm(); setView('quotes'); await loadData(); } catch (err) { alert('Error: ' + err.message); }
  };

  const handleDeleteRate = async (rate) => { if (!confirm('Delete this rate?')) return; try { await dbDelete('shipping_rates', rate.id, user?.id); await loadData(); } catch (err) { alert(err.message); } };
  const processImportFile = async (file) => { const d = await file.arrayBuffer(); const wb = XLSX.read(d); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); if (!rows.length) { alert('Empty'); return; } const parsed = rows.map(row => { const get = (...keys) => { for (const k of keys) { const v = row[k]||row[k?.toLowerCase?.()]||row[k?.toUpperCase?.()]; if (v!=null&&v!=='') return String(v).trim(); } return ''; }; const getNum = (...keys) => { const v = get(...keys); return v ? Number(v.replace(/[^0-9.-]/g,''))||0 : 0; }; const r = { origin:get('Origin','From','المنشأ'), destination:get('Destination','To','الوجهة'), vendor_name:get('Vendor','Forwarder','المورد'), shipping_line:get('Shipping Line','Line','Carrier','الناقل'), transport_mode:get('Mode','Transport')||'Ocean', container_type:get('Container','Size')||'40ft', rate_amount:getNum('Rate','Amount','Freight'), currency:get('Currency','Cur')||'USD', transit_days:getNum('Transit','Transit Days')||null, free_days:getNum('Free Days','Free')||null, port_fees:getNum('Port Fees'), thc_fees:getNum('THC'), documentation_fees:getNum('Doc Fees'), customs_fees:getNum('Customs'), other_fees:getNum('Other Fees'), effective_date:get('Date','Effective')||new Date().toISOString().substring(0,10), expiry_date:get('Expiry','Valid Until')||null, port_of_loading:get('POL','Loading Port'), port_of_discharge:get('POD','Discharge Port'), notes:get('Notes','Remarks'), is_active:true }; r.total_cost=(r.rate_amount||0)+(r.port_fees||0)+(r.thc_fees||0)+(r.documentation_fees||0)+(r.customs_fees||0)+(r.other_fees||0); return r; }).filter(r=>r.origin&&r.destination); setImportData(parsed); setImportStep('preview'); };
  const executeImport = async () => { setImportStep('importing'); setImportProgress(0); for (let i=0;i<importData.length;i++) { try { await dbInsert('shipping_rates',importData[i],user?.id); } catch(e){} if(i%10===0) setImportProgress(Math.round((i/importData.length)*100)); } setImportProgress(100); setImportStep('done'); await loadData(); };
  const handleAiQuery = async () => { if (!aiQuery.trim()) return; setAiLoading(true); setAiAnswer(''); try { const summary = routeGroups.slice(0,50).map(rg => { const c=rg.cheapest; return rg.key+': '+rg.count+' quotes ('+rg.activeCount+' active), best: '+(c?'$'+c.rate_amount+' '+c.vendor_name+'/'+(c.shipping_line||'N/A'):'none'); }).join('\n'); const res = await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:aiQuery,context:'Shipping rates assistant for KTC.\n\nROUTES:\n'+summary+'\n\nAnswer concisely.'})}); const data = await res.json(); setAiAnswer(data.answer||'No response'); } catch(err) { setAiAnswer('Error: '+err.message); } setAiLoading(false); };
  const resetQuoteForm = () => { setF({}); setEditingQuote(null); setPickedShipRate(null); setPickedTruckRate(null); setPickedBrokerRate(null); setManualShip(false); setManualTruck(false); setManualBroker(false); };

  // ===== VENDOR CONTACT HANDLERS =====
  const handleSaveVendor = async () => {
    if (!f.vcCompany) { alert('Company name required'); return; }
    const record = { company_name: f.vcCompany, contact_name: f.vcContact || '', role: f.vcRole || '', vendor_type: f.vcType || 'Shipping', email: f.vcEmail || '', phone: f.vcPhone || '', whatsapp: f.vcWhatsapp || f.vcPhone || '', origin_regions: f.vcOrigins || '', destination_regions: f.vcDests || '', notes: f.vcNotes || '', is_active: true };
    try {
      if (editingVendor) await dbUpdate('vendor_contacts', editingVendor.id, record, user?.id);
      else await dbInsert('vendor_contacts', record, user?.id);
      await logActivity(user?.id, (editingVendor ? 'Updated' : 'Added') + ' vendor: ' + record.company_name);
      setF({}); setEditingVendor(null); setView('vendors'); await loadData();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const openWhatsApp = (phone, message) => {
    let clean = (phone || '').replace(/[^0-9+]/g, '');
    if (clean.startsWith('0')) clean = '+2' + clean;
    if (!clean.startsWith('+')) clean = '+' + clean;
    const url = 'https://wa.me/' + clean.replace('+', '') + (message ? '?text=' + encodeURIComponent(message) : '');
    window.open(url, '_blank');
  };

  const openEmail = (email, subject, body) => {
    window.open('mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank');
  };

  const generateQuoteRequest = (vendor, origin, destination, containerType) => {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const subject = 'Rate Request — ' + (origin || 'Origin') + ' to ' + (destination || 'Egypt') + ' — KTC International';
    const body = `Dear ${vendor?.contact_name || vendor?.company_name || 'Team'},

I hope this message finds you well.

We are requesting your best rates for the following:

Origin: ${origin || '[Origin]'}
Destination: ${destination || '[Destination]'}
Container: ${containerType || '40ft Standard'}
Commodity: General cargo / Trading materials

Please include:
• Ocean freight / Trucking rate
• Transit time
• Free days at destination
• Any additional fees (THC, documentation, etc.)
• Rate validity period

If you have any available space in the coming weeks, please advise.

Thank you for your continued partnership.

Best regards,
KTC International Trading
Kandil Trading Company
Date: ${today}`;
    return { subject, body };
  };

  if (loading) return <div className="text-center py-8 text-slate-400">Loading...</div>;

  // ========== VENDOR CONTACTS LIST ==========
  if (view === 'vendors') return (<div>
    <button onClick={()=>setView('routes')} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <div className="flex justify-between items-center mb-3">
      <h2 className="text-xl font-extrabold">📇 Vendor Contacts ({vendorContacts.length})</h2>
      <div className="flex gap-2">
        <button onClick={()=>{setView('add_vendor');setF({});setEditingVendor(null);}} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Add Vendor</button>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3 mb-4">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Shipping</div><div className="text-lg font-extrabold">{vendorContacts.filter(v=>v.vendor_type==='Shipping').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Trucking</div><div className="text-lg font-extrabold">{vendorContacts.filter(v=>v.vendor_type==='Trucking').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Customs</div><div className="text-lg font-extrabold">{vendorContacts.filter(v=>v.vendor_type==='Customs/Brokerage').length}</div></div>
    </div>
    <div className="space-y-2">
      {vendorContacts.map(vc => (
        <div key={vc.id} className="bg-white rounded-xl p-4 border border-slate-200">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-sm font-bold">{vc.company_name}</div>
              {vc.contact_name && <div className="text-xs text-slate-500">{vc.contact_name}{vc.role ? ' — ' + vc.role : ''}</div>}
              <div className="flex gap-1 mt-1">
                <span className={'px-1.5 py-0.5 rounded text-[9px] font-semibold ' + (vc.vendor_type === 'Shipping' ? 'bg-blue-100 text-blue-700' : vc.vendor_type === 'Trucking' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700')}>{vc.vendor_type}</span>
                {vc.origin_regions && <span className="text-[9px] text-slate-400">📍 {vc.origin_regions}</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              {vc.whatsapp && <button onClick={()=>openWhatsApp(vc.whatsapp, '')} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white">💬 WhatsApp</button>}
              {vc.email && <button onClick={()=>{const {subject,body}=generateQuoteRequest(vc);openEmail(vc.email,subject,body);}} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white">📧 Email</button>}
              {vc.phone && <a href={'tel:'+vc.phone} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-500 text-white">📞</a>}
              <button onClick={()=>{setEditingVendor(vc);setF({vcCompany:vc.company_name,vcContact:vc.contact_name,vcRole:vc.role,vcType:vc.vendor_type,vcEmail:vc.email,vcPhone:vc.phone,vcWhatsapp:vc.whatsapp,vcOrigins:vc.origin_regions,vcDests:vc.destination_regions,vcNotes:vc.notes});setView('add_vendor');}} className="px-2 py-1.5 rounded-lg text-xs border border-slate-200">Edit</button>
            </div>
          </div>
          <div className="flex gap-2 mt-2 text-[10px] text-slate-400">
            {vc.email && <span>📧 {vc.email}</span>}
            {vc.phone && <span>📞 {vc.phone}</span>}
          </div>
          {/* Quick Request Rate Button */}
          <button onClick={()=>setRequestQuoteData({vendor:vc, origin:'', destination:'Egypt', container:'40ft'})}
            className="mt-2 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-blue-300 text-blue-500 hover:bg-blue-50 transition w-full">
            📋 Request Rate Quote from {vc.company_name}
          </button>
        </div>
      ))}
      {vendorContacts.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">No vendor contacts yet. Add your freight forwarders, truckers, and brokers.</div>}
    </div>
    {requestQuoteData && <RequestQuoteModal data={requestQuoteData} onClose={()=>setRequestQuoteData(null)} origins={origins} destinations={destinations} openWhatsApp={openWhatsApp} openEmail={openEmail} generateQuoteRequest={generateQuoteRequest} />}
  </div>);

  // ========== ADD/EDIT VENDOR ==========
  if (view === 'add_vendor') return (<div>
    <button onClick={()=>{setView('vendors');setF({});setEditingVendor(null);}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">{editingVendor ? 'Edit Vendor' : 'New Vendor Contact'}</h2>
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Company Name *</label><input value={f.vcCompany||''} onChange={e=>setF({...f,vcCompany:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="e.g. MSC, Maersk Logistics..." /></div>
        <div><label className="text-[10px] font-semibold">Contact Person</label><input value={f.vcContact||''} onChange={e=>setF({...f,vcContact:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="Name" /></div>
        <div><label className="text-[10px] font-semibold">Role / Title</label><input value={f.vcRole||''} onChange={e=>setF({...f,vcRole:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="Sales Rep, Account Manager..." /></div>
        <div><label className="text-[10px] font-semibold">Vendor Type *</label>
          <div className="flex gap-2 mt-1">{RATE_TYPES.map(rt=>(
            <button key={rt} onClick={()=>setF({...f,vcType:rt})} className={'flex-1 px-3 py-2 rounded-lg text-xs font-bold border-2 transition ' + (f.vcType===rt ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-slate-600 border-slate-200')}>
              {rt==='Shipping'?'🚢':rt==='Trucking'?'🚛':'📋'} {rt}
            </button>
          ))}</div>
        </div>
      </div>
      <div className="bg-blue-50 rounded-lg p-3 mb-4 border border-blue-200">
        <h3 className="text-xs font-bold text-blue-800 mb-2">📱 Contact Info</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] font-semibold">Email</label><input type="email" value={f.vcEmail||''} onChange={e=>setF({...f,vcEmail:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="rates@company.com" /></div>
          <div><label className="text-[10px] font-semibold">Phone</label><input value={f.vcPhone||''} onChange={e=>setF({...f,vcPhone:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="+1 555 123 4567" /></div>
          <div className="col-span-2"><label className="text-[10px] font-semibold">WhatsApp Number (if different)</label><input value={f.vcWhatsapp||''} onChange={e=>setF({...f,vcWhatsapp:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="Leave blank to use phone number" /></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Origin Regions / Coverage</label><input value={f.vcOrigins||''} onChange={e=>setF({...f,vcOrigins:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="China, Turkey, USA..." /></div>
        <div><label className="text-[10px] font-semibold">Destination Regions</label><input value={f.vcDests||''} onChange={e=>setF({...f,vcDests:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="Egypt, Middle East..." /></div>
      </div>
      <div className="mb-4"><label className="text-[10px] font-semibold">Notes</label><textarea value={f.vcNotes||''} onChange={e=>setF({...f,vcNotes:e.target.value})} rows={2} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      <div className="flex gap-2">
        <button onClick={handleSaveVendor} className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">{editingVendor?'Update':'Save Vendor'} ✓</button>
        <button onClick={()=>{setView('vendors');setF({});setEditingVendor(null);}} className="px-5 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
        {editingVendor && isAdmin && <button onClick={async()=>{if(!confirm('Delete this vendor?'))return;try{await supabase.from('vendor_contacts').delete().eq('id',editingVendor.id);setView('vendors');setF({});setEditingVendor(null);await loadData();}catch(err){alert(err.message);}}} className="px-5 py-2 bg-red-500 text-white rounded-lg text-sm ml-auto">Delete</button>}
      </div>
    </div>
  </div>);

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
      <div className="bg-indigo-50 rounded-lg p-3 mb-4 border-2 border-indigo-300"><h3 className="text-xs font-bold text-indigo-800 mb-2">🏷️ Rate Type / نوع السعر * (Required / مطلوب)</h3>
        <div className="flex gap-2">
          {RATE_TYPES.map(rt => (
            <button key={rt} onClick={() => setF({...f, rateType: rt})}
              className={'flex-1 px-4 py-3 rounded-lg text-sm font-bold border-2 transition ' +
                (f.rateType === rt ? 'bg-indigo-500 text-white border-indigo-500 shadow-lg' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300')}>
              {rt === 'Shipping' ? '🚢' : rt === 'Trucking' ? '🚛' : '📋'} {rt}
            </button>
          ))}
        </div>
        {!f.rateType && <div className="text-[10px] text-red-500 mt-1 font-semibold">⚠️ You must select a rate type before saving</div>}
      </div>
      <div className="bg-emerald-50 rounded-lg p-3 mb-4 border border-emerald-200"><h3 className="text-xs font-bold text-emerald-800 mb-2">🏢 Vendor & Shipping Line</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Vendor *</label><input list="v-l" value={f.vendorName||''} onChange={e=>setF({...f,vendorName:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="v-l">{vendors.map(v=><option key={v} value={v}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Shipping Line</label><input list="l-l" value={f.shippingLine||''} onChange={e=>setF({...f,shippingLine:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="l-l">{lines.map(l=><option key={l} value={l}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Mode</label><select value={f.transportMode||'Ocean'} onChange={e=>setF({...f,transportMode:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{TRANSPORT_MODES.map(m=><option key={m}>{m}</option>)}</select></div>
          <div><label className="text-[10px] font-semibold">Container</label><select value={f.containerType||'40ft'} onChange={e=>setF({...f,containerType:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CONTAINER_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
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
          <div className="col-span-3"><label className="text-[10px] font-semibold">Other Desc</label><input value={f.otherFeesDesc||''} onChange={e=>setF({...f,otherFeesDesc:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>
        <div className="mt-2 text-right"><span className="text-xs text-slate-500">Total: </span><span className="text-lg font-extrabold text-amber-700">{fCur(Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), f.currency||'USD')}</span></div></div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Effective Date</label><input type="date" value={f.effectiveDate||new Date().toISOString().substring(0,10)} onChange={e=>setF({...f,effectiveDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold text-red-600">Expiry Date</label><input type="date" value={f.expiryDate||''} onChange={e=>setF({...f,expiryDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm border-red-200" /></div>
        <div><label className="text-[10px] font-semibold">Notes</label><input value={f.notes||''} onChange={e=>setF({...f,notes:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div className="flex items-end"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.booked||false} onChange={e=>setF({...f,booked:e.target.checked})} className="w-4 h-4" /> Booked</label></div>
      </div>
      {f.booked && (<div className="grid grid-cols-3 gap-3 mb-4 bg-green-50 rounded-lg p-3 border border-green-200">
        <div><label className="text-[10px] font-semibold text-green-800">Shipment Ref</label><input value={f.shipmentRef||''} onChange={e=>setF({...f,shipmentRef:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold text-green-800">Booking Date</label><input type="date" value={f.bookingDate||''} onChange={e=>setF({...f,bookingDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold text-green-800">Notes</label><input value={f.bookingNotes||''} onChange={e=>setF({...f,bookingNotes:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      </div>)}
      <div className="flex gap-2"><button onClick={handleSaveRate} className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">{editingRate?'Update':'Save Rate'} ✓</button><button onClick={()=>{setView(selectedRoute?'route_detail':'routes');setF({});setEditingRate(null);}} className="px-5 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button></div>
    </div></div>);

  // ========== QUOTES LIST ==========
  if (view === 'quotes') return (<div>
    <button onClick={()=>setView('routes')} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Routes</button>
    <div className="flex justify-between items-center mb-3"><h2 className="text-xl font-extrabold">📋 Quotes ({quotes.length})</h2><button onClick={()=>{setView('add_quote');resetQuoteForm();}} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ New Quote</button></div>
    <div className="grid grid-cols-4 gap-3 mb-4">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{quotes.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Accepted</div><div className="text-lg font-extrabold text-emerald-600">{quotes.filter(q=>q.status==='accepted'||q.status==='booked').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Pending</div><div className="text-lg font-extrabold text-amber-600">{quotes.filter(q=>q.status==='draft'||q.status==='sent').length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Total Profit</div><div className="text-lg font-extrabold text-emerald-600">{fCur(quotes.reduce((a,q)=>a+Number(q.profit||0),0),'USD')}</div></div>
    </div>
    <div className="overflow-auto rounded-lg border bg-white max-h-[500px]"><table className="w-full border-collapse text-xs"><thead className="sticky top-0"><tr className="bg-slate-50">
      <th className="px-2 py-2 text-[10px] text-left">Quote #</th><th className="px-2 py-2 text-[10px] text-left">Date</th><th className="px-2 py-2 text-[10px] text-left">Customer</th><th className="px-2 py-2 text-[10px] text-left">Route</th><th className="px-2 py-2 text-[10px] text-right">Our Cost</th><th className="px-2 py-2 text-[10px] text-right">Client</th><th className="px-2 py-2 text-[10px] text-right">Profit</th><th className="px-2 py-2 text-[10px]">Status</th><th className="px-2 py-2 text-[10px]"></th>
    </tr></thead><tbody>{quotes.map(qt => { const sc = {draft:'bg-slate-100 text-slate-600',sent:'bg-blue-100 text-blue-700',accepted:'bg-green-100 text-green-700',rejected:'bg-red-100 text-red-600',expired:'bg-red-50 text-red-400',booked:'bg-emerald-100 text-emerald-700'}; return (
      <tr key={qt.id} className="border-b border-slate-50 hover:bg-blue-50">
        <td className="px-2 py-2 font-bold text-blue-600 cursor-pointer" onClick={()=>{setEditingQuote(qt);setF({qNumber:qt.quote_number,qDate:qt.quote_date,qCustomer:qt.customer_name,qEmail:qt.customer_email,qOrigin:qt.origin,qDest:qt.destination,qPol:qt.port_of_loading,qPod:qt.port_of_discharge,qContainer:qt.container_type,qShipCost:qt.shipping_cost,qShipVendor:qt.shipping_vendor,qShipLine:qt.shipping_line,qTruckCost:qt.trucking_cost,qTruckVendor:qt.trucking_vendor,qCustomsCost:qt.customs_cost,qOtherInternal:qt.other_internal_cost,qClientShip:qt.client_shipping_fee,qClientTruck:qt.client_trucking_fee,qClientCustoms:qt.client_customs_fee,qClientService:qt.client_service_fee,qClientOther:qt.client_other_fee,qDisplayText:qt.client_display_text,qShowBreakdown:qt.client_show_breakdown,qCurrency:qt.currency,qStatus:qt.status,qValidUntil:qt.valid_until,qNotes:qt.notes});setManualShip(true);setManualTruck(true);setManualBroker(true);setView('add_quote');}}>{qt.quote_number}</td>
        <td className="px-2 py-2">{qt.quote_date}</td><td className="px-2 py-2 font-semibold">{qt.customer_name}</td><td className="px-2 py-2">{qt.origin}→{qt.destination}</td><td className="px-2 py-2 text-right text-red-500">{fCur(qt.total_internal_cost,qt.currency)}</td><td className="px-2 py-2 text-right font-bold">{fCur(qt.client_total,qt.currency)}</td><td className="px-2 py-2 text-right font-bold" style={{color:qt.profit>0?'#10b981':'#ef4444'}}>{fCur(qt.profit,qt.currency)}</td><td className="px-2 py-2"><span className={'px-2 py-0.5 rounded-full text-[9px] font-bold '+(sc[qt.status]||'bg-slate-100')}>{qt.status}</span></td>
        <td className="px-2 py-2"><button onClick={()=>setPreviewQuote(qt)} className="px-2 py-0.5 rounded border border-purple-300 text-purple-600 text-[10px] font-semibold">📄 PDF</button></td>
      </tr>); })}</tbody></table></div>
    {previewQuote && <QuotePrintView quote={previewQuote} onClose={() => setPreviewQuote(null)} />}
  </div>);

  // ========== CREATE/EDIT QUOTE ==========
  if (view === 'add_quote') return (<div>
    <button onClick={()=>{setView('quotes');resetQuoteForm();}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">{editingQuote?'Edit Quote':'Create Quote'}</h2>
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Quote #</label><input value={f.qNumber||''} onChange={e=>setF({...f,qNumber:e.target.value})} placeholder="Auto" className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Customer * (type or select / اكتب أو اختر)</label><input list="cl" value={f.qCustomer||''} onChange={e=>setF({...f,qCustomer:e.target.value})} placeholder="Type name or pick from list..." className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="cl">{(customers||[]).map(c=><option key={c.id} value={c.name}/>)}</datalist></div>
        <div><label className="text-[10px] font-semibold">Origin *</label><input list="qol" value={f.qOrigin||''} onChange={e=>setF({...f,qOrigin:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="qol">{origins.map(o=><option key={o} value={o}/>)}</datalist></div>
        <div><label className="text-[10px] font-semibold">Destination *</label><input list="qdl" value={f.qDest||''} onChange={e=>setF({...f,qDest:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="qdl">{destinations.map(d=><option key={d} value={d}/>)}</datalist></div>
        <div><label className="text-[10px] font-semibold">Container</label><select value={f.qContainer||'40ft'} onChange={e=>setF({...f,qContainer:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CONTAINER_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Currency</label><select value={f.qCurrency||'USD'} onChange={e=>setF({...f,qCurrency:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Valid Until</label><input type="date" value={f.qValidUntil||''} onChange={e=>setF({...f,qValidUntil:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Email</label><input value={f.qEmail||''} onChange={e=>setF({...f,qEmail:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      </div>

      {/* INTERNAL COSTS with RATE PICKERS */}
      <div className="bg-red-50 rounded-lg p-3 mb-4 border border-red-200">
        <h3 className="text-xs font-bold text-red-800 mb-3">🔒 Internal Costs — Select from your rates or enter manually</h3>
        <div className="space-y-3">
          {/* SHIPPING */}
          {!manualShip ? (
            <RatePicker rates={rates} label="🚢 Shipping" rateType="Shipping" origin={f.qOrigin} destination={f.qDest} selected={pickedShipRate}
              onSelect={(r) => { if (!r) { setManualShip(true); return; } setPickedShipRate(r.id); setF(p=>({...p,qShipCost:r.total_cost||r.rate_amount,qShipVendor:r.vendor_name,qShipLine:r.shipping_line||''})); }}
              onClear={() => { setPickedShipRate(null); setF(p=>({...p,qShipCost:'',qShipVendor:'',qShipLine:''})); }} />
          ) : (
            <div className="border rounded-lg p-3 bg-white">
              <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold">🚢 Shipping — Manual</span><button onClick={()=>{setManualShip(false);setPickedShipRate(null);}} className="text-[10px] text-blue-500 underline">Pick from DB</button></div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] font-semibold">Cost</label><input type="number" value={f.qShipCost||''} onChange={e=>setF({...f,qShipCost:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Vendor</label><input list="qsvl" value={f.qShipVendor||''} onChange={e=>setF({...f,qShipVendor:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /><datalist id="qsvl">{vendors.map(v=><option key={v} value={v}/>)}</datalist></div>
                <div><label className="text-[10px] font-semibold">Line</label><input list="qsll" value={f.qShipLine||''} onChange={e=>setF({...f,qShipLine:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /><datalist id="qsll">{lines.map(l=><option key={l} value={l}/>)}</datalist></div>
              </div>
            </div>
          )}
          {/* TRUCKING */}
          {!manualTruck ? (
            <RatePicker rates={rates} label="🚛 Trucking" rateType="Trucking" origin={f.qOrigin} destination={f.qDest} selected={pickedTruckRate}
              onSelect={(r) => { if (!r) { setManualTruck(true); return; } setPickedTruckRate(r.id); setF(p=>({...p,qTruckCost:r.total_cost||r.rate_amount,qTruckVendor:r.vendor_name})); }}
              onClear={() => { setPickedTruckRate(null); setF(p=>({...p,qTruckCost:'',qTruckVendor:''})); }} />
          ) : (
            <div className="border rounded-lg p-3 bg-white">
              <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold">🚛 Trucking — Manual</span><button onClick={()=>{setManualTruck(false);setPickedTruckRate(null);}} className="text-[10px] text-blue-500 underline">Pick from DB</button></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-semibold">Cost</label><input type="number" value={f.qTruckCost||''} onChange={e=>setF({...f,qTruckCost:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Vendor</label><input value={f.qTruckVendor||''} onChange={e=>setF({...f,qTruckVendor:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /></div>
              </div>
            </div>
          )}
          {/* CUSTOMS/BROKERAGE */}
          {!manualBroker ? (
            <RatePicker rates={rates} label="📋 Customs / Brokerage" rateType="Customs/Brokerage" origin={f.qOrigin} destination={f.qDest} selected={pickedBrokerRate}
              onSelect={(r) => { if (!r) { setManualBroker(true); return; } setPickedBrokerRate(r.id); setF(p=>({...p,qCustomsCost:r.total_cost||r.rate_amount})); }}
              onClear={() => { setPickedBrokerRate(null); setF(p=>({...p,qCustomsCost:''})); }} />
          ) : (
            <div className="border rounded-lg p-3 bg-white">
              <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold">📋 Customs — Manual</span><button onClick={()=>{setManualBroker(false);setPickedBrokerRate(null);}} className="text-[10px] text-blue-500 underline">Pick from DB</button></div>
              <div><label className="text-[10px] font-semibold">Customs Cost</label><input type="number" value={f.qCustomsCost||''} onChange={e=>setF({...f,qCustomsCost:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] font-semibold">Other Internal</label><input type="number" value={f.qOtherInternal||''} onChange={e=>setF({...f,qOtherInternal:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Desc</label><input value={f.qOtherInternalDesc||''} onChange={e=>setF({...f,qOtherInternalDesc:e.target.value})} className="w-full px-2 py-1.5 rounded border text-sm" /></div>
          </div>
        </div>
        <div className="mt-3 text-right"><span className="text-xs">Our Total: </span><span className="text-lg font-extrabold text-red-700">{fCur(Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0),f.qCurrency||'USD')}</span></div>
      </div>

      {/* CLIENT FEES */}
      <div className="bg-emerald-50 rounded-lg p-3 mb-4 border border-emerald-200"><h3 className="text-xs font-bold text-emerald-800 mb-2">👤 Client Quote</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Shipping Fee</label><input type="number" value={f.qClientShip||''} onChange={e=>setF({...f,qClientShip:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Trucking Fee</label><input type="number" value={f.qClientTruck||''} onChange={e=>setF({...f,qClientTruck:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Customs Fee</label><input type="number" value={f.qClientCustoms||''} onChange={e=>setF({...f,qClientCustoms:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div><label className="text-[10px] font-semibold">Service Fee</label><input type="number" value={f.qClientService||''} onChange={e=>setF({...f,qClientService:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm bg-emerald-100" /></div>
          <div><label className="text-[10px] font-semibold">Other</label><input type="number" value={f.qClientOther||''} onChange={e=>setF({...f,qClientOther:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
          <div className="col-span-3"><label className="text-[10px] font-semibold">Display Text</label><input value={f.qDisplayText||''} onChange={e=>setF({...f,qDisplayText:e.target.value})} placeholder="e.g. All-in shipping fee..." className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs mt-2"><input type="checkbox" checked={f.qShowBreakdown||false} onChange={e=>setF({...f,qShowBreakdown:e.target.checked})} /> Show breakdown to client</label>
        <div className="mt-2 text-right"><span className="text-xs">Client Total: </span><span className="text-lg font-extrabold text-emerald-700">{fCur(Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0),f.qCurrency||'USD')}</span></div>
      </div>

      {(() => { const iT=Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0); const cT=Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0); const p=cT-iT; const pct=iT>0?((p/iT)*100).toFixed(1):0; return (<div className={'rounded-lg p-4 mb-4 border-2 '+(p>0?'bg-green-50 border-green-300':p<0?'bg-red-50 border-red-300':'bg-slate-50 border-slate-200')}><div className="flex justify-between items-center"><div className="text-sm font-bold">Profit</div><div><span className={'text-2xl font-extrabold '+(p>0?'text-green-600':'text-red-600')}>{fCur(p,f.qCurrency||'USD')}</span><span className="text-xs text-slate-500 ml-2">({pct}%)</span></div></div></div>); })()}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold">Status</label><select value={f.qStatus||'draft'} onChange={e=>setF({...f,qStatus:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{QUOTE_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Notes</label><input value={f.qNotes||''} onChange={e=>setF({...f,qNotes:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
      </div>
      <div className="flex gap-2"><button onClick={handleSaveQuote} className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">{editingQuote?'Update':'Save Quote'} ✓</button><button onClick={()=>{setView('quotes');resetQuoteForm();}} className="px-5 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button></div>
    </div>
  </div>);

  // ========== ROUTE DETAIL ==========
  if (view === 'route_detail' && selectedRoute) {
    const bk = routeHistory.filter(r=>r.booked); const active = routeHistory.filter(r=>!isExpired(r.expiry_date)); const byVL = {}; active.forEach(r => { const k=(r.vendor_name||'?')+' / '+(r.shipping_line||'N/A'); if(!byVL[k])byVL[k]=[]; byVL[k].push(r); });
    const chartData = {}; routeHistory.forEach(r => { const m=(r.effective_date||'').substring(0,7); if(!m)return; if(!chartData[m])chartData[m]={month:m,rates:[],min:Infinity,max:0}; chartData[m].rates.push(Number(r.rate_amount||0)); chartData[m].min=Math.min(chartData[m].min,Number(r.rate_amount||0)); chartData[m].max=Math.max(chartData[m].max,Number(r.rate_amount||0)); }); Object.values(chartData).forEach(d=>{d.avg=Math.round(d.rates.reduce((a,b)=>a+b,0)/d.rates.length);}); const chartSorted=Object.values(chartData).sort((a,b)=>a.month.localeCompare(b.month));
    return (<div>
      <button onClick={()=>{setSelectedRoute(null);setView('routes');}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
      <h2 className="text-xl font-extrabold mb-1">🚢 {selectedRoute.origin} → {selectedRoute.destination}</h2>
      <p className="text-xs text-slate-500 mb-3">{routeHistory.length} rates • {active.length} active • {bk.length} booked</p>
      <div className="grid grid-cols-5 gap-3 mb-4">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Best Active</div><div className="text-lg font-extrabold text-emerald-600">{active.length>0?fCur(Math.min(...active.map(r=>r.rate_amount||Infinity)),active[0]?.currency):'—'}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Highest</div><div className="text-lg font-extrabold text-red-500">{fCur(Math.max(...routeHistory.map(r=>r.rate_amount||0)),routeHistory[0]?.currency)}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Avg</div><div className="text-lg font-extrabold">{fCur(Math.round(routeHistory.reduce((a,r)=>a+Number(r.rate_amount||0),0)/routeHistory.length),routeHistory[0]?.currency)}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Vendors</div><div className="text-lg font-extrabold">{Object.keys(byVL).length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Bookings</div><div className="text-lg font-extrabold">{routeBookings(selectedRoute.origin,selectedRoute.destination).length}</div></div>
      </div>
      {chartSorted.length>1&&(<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">📈 Rate Trend</h3><div className="flex items-end gap-1 h-[120px]">{chartSorted.map((d,i)=>{const mx=Math.max(...chartSorted.map(x=>x.max)); const h=mx>0?(d.avg/mx)*100:0; return (<div key={d.month} className="flex-1 flex flex-col items-center" title={d.month+': avg $'+d.avg}><div className="text-[8px] text-slate-400 mb-1">${d.avg}</div><div className="w-full rounded-t" style={{height:h+'%',background:i===chartSorted.length-1?'#0ea5e9':'#cbd5e1',minHeight:4}}></div><div className="text-[8px] text-slate-400 mt-1 -rotate-45">{d.month.substring(5)}</div></div>);})}</div></div>)}
      {Object.keys(byVL).length>0&&(<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">🏆 Vendor Comparison</h3><div className="overflow-auto"><table className="w-full border-collapse text-xs"><thead><tr className="bg-slate-50"><th className="px-3 py-2 text-left text-[10px]">Vendor / Line</th><th className="px-3 py-2 text-right text-[10px]">Best Rate</th><th className="px-3 py-2 text-right text-[10px]">Transit</th><th className="px-3 py-2 text-right text-[10px]">Free Days</th><th className="px-3 py-2 text-[10px]">Expiry</th></tr></thead><tbody>{Object.entries(byVL).sort((a,b)=>(a[1][0]?.rate_amount||Infinity)-(b[1][0]?.rate_amount||Infinity)).map(([key,vr],i)=>{const best=vr.reduce((a,b)=>(a.rate_amount||Infinity)<(b.rate_amount||Infinity)?a:b); return (<tr key={key} className={'border-b border-slate-50 '+(i===0?'bg-emerald-50':'')}><td className="px-3 py-2 font-semibold">{i===0&&<span className="text-emerald-500 mr-1">★</span>}{key}</td><td className="px-3 py-2 text-right font-bold text-blue-600">{fCur(best.rate_amount,best.currency)}</td><td className="px-3 py-2 text-right">{best.transit_days?best.transit_days+'d':'—'}</td><td className="px-3 py-2 text-right">{best.free_days||'—'}</td><td className="px-3 py-2"><ExpiryBadge date={best.expiry_date}/></td></tr>);})}</tbody></table></div></div>)}
      {routeQuotes.length>0&&(<div className="bg-white rounded-xl p-4 mt-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">📋 Quotes ({routeQuotes.length})</h3>{routeQuotes.map(qt=>(<div key={qt.id} className="flex justify-between items-center py-2 border-b border-slate-50"><div><div className="text-xs font-semibold">{qt.quote_number} — {qt.customer_name}</div><div className="text-[10px] text-slate-500">{qt.quote_date} • {qt.status}</div></div><div className="flex items-center gap-3"><div className="text-right"><div className="text-xs">Client: <span className="font-bold">{fCur(qt.client_total,qt.currency)}</span></div><div className="text-[10px]" style={{color:qt.profit>0?'#10b981':'#ef4444'}}>Profit: {fCur(qt.profit,qt.currency)}</div></div><button onClick={()=>setPreviewQuote(qt)} className="px-2 py-1 rounded border border-purple-300 text-purple-600 text-[10px]">📄</button></div></div>))}</div>)}
      <div className="bg-white rounded-xl p-4 border border-slate-200 mt-4"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-bold">All Rates</h3><div className="flex gap-1"><button onClick={()=>{const matchVendors=vendorContacts.filter(v=>!v.origin_regions||(v.origin_regions||'').toLowerCase().includes((selectedRoute.origin||'').toLowerCase().substring(0,4)));if(matchVendors.length>0)setRequestQuoteData({vendor:matchVendors[0],origin:selectedRoute.origin,destination:selectedRoute.destination,container:'40ft'});else alert('No vendor contacts found. Add vendors first (📇 Vendors).');}} className="px-3 py-1 bg-cyan-500 text-white rounded text-[10px] font-semibold">📋 Request Rate</button><button onClick={()=>{setF({origin:selectedRoute.origin,destination:selectedRoute.destination});setView('add_rate');}} className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">+ Add Rate</button></div></div>
      <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200"><table className="w-full border-collapse text-xs"><thead className="sticky top-0"><tr className="bg-slate-50"><th className="px-2 py-2 text-[10px] text-left">Date</th><th className="px-2 py-2 text-[10px] text-left">Vendor</th><th className="px-2 py-2 text-[10px] text-left">Line</th><th className="px-2 py-2 text-[10px]">Container</th><th className="px-2 py-2 text-[10px] text-right">Rate</th><th className="px-2 py-2 text-[10px] text-right">Total</th><th className="px-2 py-2 text-[10px]">Expiry</th><th className="px-2 py-2 text-[10px]"></th></tr></thead><tbody>{routeHistory.map(r=>{const exp=isExpired(r.expiry_date); return (<tr key={r.id} className={'border-b border-slate-50 '+(exp?'bg-red-50/50':'')+(r.booked?' bg-green-50/50':'')}><td className="px-2 py-1.5">{r.effective_date}</td><td className="px-2 py-1.5 font-semibold">{r.vendor_name}</td><td className="px-2 py-1.5">{r.shipping_line||'—'}</td><td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{r.container_type}</span></td><td className={'px-2 py-1.5 text-right font-bold '+(exp?'text-red-400 line-through':'text-blue-600')}>{fCur(r.rate_amount,r.currency)}</td><td className="px-2 py-1.5 text-right font-bold text-amber-600">{fCur(r.total_cost,r.currency)}</td><td className="px-2 py-1.5"><ExpiryBadge date={r.expiry_date}/></td><td className="px-2 py-1.5 flex gap-1">{!exp&&<button onClick={()=>handleMarkBooked(r)} className="px-2 py-0.5 rounded border border-green-300 text-green-600 text-[10px]">Book</button>}<button onClick={()=>{setEditingRate(r);setF({origin:r.origin,destination:r.destination,vendorName:r.vendor_name,shippingLine:r.shipping_line,transportMode:r.transport_mode,rateType:r.rate_type||'',containerType:r.container_type,rateAmount:r.rate_amount,currency:r.currency,transitDays:r.transit_days,freeDays:r.free_days,portFees:r.port_fees,thcFees:r.thc_fees,docFees:r.documentation_fees,customsFees:r.customs_fees,otherFees:r.other_fees,otherFeesDesc:r.other_fees_desc,effectiveDate:r.effective_date,expiryDate:r.expiry_date,pol:r.port_of_loading,pod:r.port_of_discharge,notes:r.notes,booked:r.booked,shipmentRef:r.shipment_reference,bookingDate:r.booking_date,bookingNotes:r.booking_notes});setView('add_rate');}} className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]">Edit</button>{isAdmin&&<button onClick={()=>handleDeleteRate(r)} className="px-2 py-0.5 rounded border border-red-300 text-red-500 text-[10px]">Del</button>}</td></tr>);})}</tbody></table></div></div>
      {previewQuote && <QuotePrintView quote={previewQuote} onClose={() => setPreviewQuote(null)} />}
      {requestQuoteData && <RequestQuoteModal data={requestQuoteData} onClose={()=>setRequestQuoteData(null)} origins={origins} destinations={destinations} openWhatsApp={openWhatsApp} openEmail={openEmail} generateQuoteRequest={generateQuoteRequest} />}
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
    <div className="flex gap-2 flex-wrap">{['Cheapest active from China?','Compare vendors Turkey','Rates expiring this week?'].map(qx=>(<button key={qx} onClick={()=>setAiQuery(qx)} className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px]">{qx}</button>))}</div></div>
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
        <button onClick={()=>setView('vendors')} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-semibold">📇 Vendors</button>
        <button onClick={()=>{if(vendorContacts.length===0){alert('Add vendor contacts first (📇 Vendors button)');return;}setRequestQuoteData({vendor:vendorContacts[0],origin:'',destination:'Egypt',container:'40ft'});}} className="px-3 py-1.5 bg-cyan-500 text-white rounded-lg text-xs font-semibold">📋 Request Rate</button>
      </div>
    </div>
    <div className="grid grid-cols-5 gap-3 mb-4">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{rates.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Active</div><div className="text-lg font-extrabold text-emerald-600">{rates.filter(r=>!isExpired(r.expiry_date)).length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Expired</div><div className="text-lg font-extrabold text-red-500">{rates.filter(r=>isExpired(r.expiry_date)).length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Routes</div><div className="text-lg font-extrabold">{routeGroups.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Bookings</div><div className="text-lg font-extrabold">{bookings.length}</div></div>
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
      <div className="flex justify-between text-[10px] text-slate-500 border-t border-slate-100 pt-2"><span>{rg.activeCount} active{rg.expiredCount>0&&<span className="text-red-400 ml-1">({rg.expiredCount} exp)</span>}</span><span>{[...rg.vendors].length} vendors</span>{(() => { const rb = routeBookings(rg.origin,rg.destination); return rb.length > 0 && <span className="text-emerald-600">✓ {rb.length}x</span>; })()}</div>
    </div>);})}</div>)}
    {previewQuote && <QuotePrintView quote={previewQuote} onClose={() => setPreviewQuote(null)} />}
    {requestQuoteData && <RequestQuoteModal data={requestQuoteData} onClose={()=>setRequestQuoteData(null)} origins={origins} destinations={destinations} openWhatsApp={openWhatsApp} openEmail={openEmail} generateQuoteRequest={generateQuoteRequest} />}
  </div>);
}
