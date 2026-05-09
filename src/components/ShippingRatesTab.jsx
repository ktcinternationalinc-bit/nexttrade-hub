'use client';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { notifyShippingRate, notifyShippingBooked } from '../lib/notify';
import { fE, fmt } from '../lib/utils';
import { fmtET, todayET, daysAgoET } from '../lib/et-time';
import EmailComposer from './EmailComposer';
import * as XLSX from 'xlsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend as RLegend, ResponsiveContainer } from 'recharts';
import { parseNumberSmart as _parseNumberSmartShared, parseDate as _parseDateShared, normalizeContainer as _normalizeContainerShared } from '../lib/shipping-import-helpers';

const CONTAINER_TYPES = ['20ft', '40ft', '40ft HC', '45ft', 'LCL', 'Bulk', 'Flatbed', 'Reefer', 'Open Top', 'Truck', 'Trailer'];
const TRANSPORT_MODES = ['Ocean', 'Trucking', 'Air', 'Rail', 'Multi-modal'];
const RATE_TYPES = ['Shipping', 'Trucking', 'Customs/Brokerage'];
const CURRENCIES = ['USD', 'EUR', 'EGP', 'GBP', 'SAR', 'AED', 'CNY', 'TRY'];
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'booked'];
const fCur = (amount, currency) => { if (!amount && amount !== 0) return '—'; const sym = { USD: '\$', EUR: '€', EGP: 'E£', GBP: '£', CNY: '¥', TRY: '₺', SAR: 'SR', AED: 'AED ' }; return (sym[currency] || currency + ' ') + Number(amount).toLocaleString(); };
const isExpired = (d) => d && d < todayET();
const daysUntil = (d) => { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); };

function ExpiryBadge({ date }) {
  if (!date) return <span className="text-[9px] text-slate-500">No expiry</span>;
  const d = daysUntil(date); const exp = d < 0; const soon = d >= 0 && d <= 7;
  return <span className={'px-1.5 py-0.5 rounded text-[9px] font-bold ' + (exp ? 'bg-red-100 text-red-600' : soon ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-700')}>{exp ? 'Expired ' + Math.abs(d) + 'd ago' : d === 0 ? 'Expires today' : d + 'd left'}</span>;
}

// ========== RATE PICKER ==========
function RatePicker({ rates, label, rateType, origin, destination, selected, onSelect, onClear }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const available = useMemo(() => {
    let arr = rates.filter(r => !isExpired(r.expiry_date));
    // Filter by rate_type but also include rates with no rate_type set
    if (rateType) arr = arr.filter(r => {
      var rt = (r.rate_type || '').toLowerCase();
      var target = rateType.toLowerCase();
      return rt === target || rt === '' || !r.rate_type;
    });
    // Sort: matching origin+destination first, then origin only, then rest
    if (origin || destination) {
      arr = arr.sort((a, b) => {
        var aMatch = (origin && a.origin === origin ? 2 : 0) + (destination && a.destination === destination ? 2 : 0);
        var bMatch = (origin && b.origin === origin ? 2 : 0) + (destination && b.destination === destination ? 2 : 0);
        if (bMatch !== aMatch) return bMatch - aMatch;
        return (a.rate_amount || Infinity) - (b.rate_amount || Infinity);
      });
    }
    if (search) { const s = search.toLowerCase(); arr = arr.filter(r => [r.vendor_name, r.shipping_line, r.origin, r.destination, r.container_type, r.rate_type].filter(Boolean).join(' ').toLowerCase().includes(s)); }
    return arr;
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
      {available.length === 0 ? <div className="text-center text-xs text-slate-400 py-3">No matching rates found. Add rates in the Rates tab first.</div> : (
        <div className="max-h-[180px] overflow-auto space-y-1">{available.map(r => {
          var routeMatch = (origin && r.origin === origin && destination && r.destination === destination);
          return (
          <div key={r.id} onClick={() => { onSelect(r); setExpanded(false); setSearch(''); }}
            className={'flex justify-between items-center p-2 rounded cursor-pointer border ' + (routeMatch ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : 'border-transparent hover:bg-blue-50 hover:border-blue-200')}>
            <div>
              <div className="text-xs font-semibold">{r.vendor_name} {r.shipping_line ? '/ ' + r.shipping_line : ''} {routeMatch && <span className="text-[9px] text-emerald-600 font-bold ml-1">✓ Route Match</span>}</div>
              <div className="text-[10px] text-slate-500">{r.origin}→{r.destination} • {r.container_type} • <span className="font-semibold text-indigo-600">{r.rate_type || r.transport_mode}</span>{r.transit_days ? ' • ' + r.transit_days + 'd' : ''}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-extrabold text-blue-600">{fCur(r.total_cost || r.rate_amount, r.currency)}</div>
              <ExpiryBadge date={r.expiry_date} />
            </div>
          </div>
        ); })}</div>
      )}
      <div className="text-center mt-2"><button onClick={() => { onSelect(null); setExpanded(false); }} className="text-[10px] text-slate-500 underline">Enter manually instead</button></div>
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
        <div className="ft"><div>KTC Trading Operations — International Trading & Logistics</div><div style={{marginTop:4}}>Generated {fmtET(new Date(), 'date')} (ET)</div></div>
      </div>
    </div>
  </div>);
}

// ========== REQUEST QUOTE MODAL ==========
function RequestQuoteModal({ data, onClose, origins, destinations, openWhatsApp, openEmail, generateQuoteRequest, userId, allVendors }) {
  const [origin, setOrigin] = useState(data.origin || '');
  const [dest, setDest] = useState(data.destination || 'Egypt');
  const [container, setContainer] = useState(data.container || '40ft');
  const [commodity, setCommodity] = useState('General cargo / Trading materials');
  const [selectedVendors, setSelectedVendors] = useState(data.vendor ? [data.vendor.id] : []);
  const [sendingTo, setSendingTo] = useState(null); // current vendor being sent to
  const [sent, setSent] = useState([]); // vendor ids already sent
  const [showComposer, setShowComposer] = useState(null); // vendor for email composer
  const vendors = allVendors || [];
  const shippingVendors = vendors.filter(v => v.vendor_type === 'Shipping' || !v.vendor_type);
  
  const toggleVendor = (id) => {
    if (selectedVendors.includes(id)) setSelectedVendors(selectedVendors.filter(x => x !== id));
    else setSelectedVendors([...selectedVendors, id]);
  };
  const selectAll = () => setSelectedVendors(shippingVendors.map(v => v.id));
  const selectNone = () => setSelectedVendors([]);

  return (<div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-4" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-[650px] my-8">
      <div className="p-4 border-b flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold">📋 Request Rate Quote</h3>
          <p className="text-xs text-slate-500">{selectedVendors.length} vendor{selectedVendors.length !== 1 ? 's' : ''} selected</p>
        </div>
        <button onClick={onClose} className="text-2xl text-slate-400">×</button>
      </div>
      <div className="p-4">
        {/* Route Details */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] font-semibold">Origin</label><input list="rq-origins" value={origin} onChange={e=>setOrigin(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="e.g. China, Turkey..." /><datalist id="rq-origins">{origins.map(o=><option key={o} value={o}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Destination</label><input list="rq-dests" value={dest} onChange={e=>setDest(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="rq-dests">{destinations.map(d=><option key={d} value={d}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Container</label><select value={container} onChange={e=>setContainer(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm">{CONTAINER_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><label className="text-[10px] font-semibold">Commodity</label><input value={commodity} onChange={e=>setCommodity(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
        </div>

        {/* Vendor Selection */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-bold">Select Vendors</label>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-[10px] text-blue-600 font-bold hover:underline">Select All</button>
              <button onClick={selectNone} className="text-[10px] text-slate-500 hover:underline">Clear</button>
            </div>
          </div>
          <div className="max-h-[200px] overflow-auto rounded-lg border border-slate-200">
            {shippingVendors.map(v => {
              const isSel = selectedVendors.includes(v.id);
              const isSent = sent.includes(v.id);
              return (
                <div key={v.id} onClick={() => !isSent && toggleVendor(v.id)}
                  className={'flex items-center gap-3 px-3 py-2 border-b border-slate-50 cursor-pointer transition ' + (isSent ? 'bg-emerald-50 ' : isSel ? 'bg-blue-50 ' : 'hover:bg-slate-50 ')}>
                  <div className={'w-5 h-5 rounded border-2 flex items-center justify-center text-[10px] flex-shrink-0 ' + (isSent ? 'bg-emerald-500 border-emerald-500 text-white' : isSel ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300')}>
                    {isSent ? '✓' : isSel ? '✓' : ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">{v.company_name}{v.contact_name ? ' — ' + v.contact_name : ''}</div>
                    <div className="text-[10px] text-slate-500 flex gap-2">
                      {v.email && <span>📧 {v.email}</span>}
                      {v.whatsapp && <span>💬 WhatsApp</span>}
                    </div>
                  </div>
                  {isSent && <span className="text-[10px] text-emerald-600 font-bold">Sent ✓</span>}
                </div>
              );
            })}
            {shippingVendors.length === 0 && <div className="p-4 text-xs text-slate-400 text-center">No vendor contacts. Add vendors first (📇 Vendors).</div>}
          </div>
        </div>

        {/* Send Buttons */}
        {selectedVendors.length > 0 && (
          <div className="space-y-2">
            <button onClick={() => {
              const toSend = selectedVendors.filter(id => !sent.includes(id));
              toSend.forEach(id => {
                const v = vendors.find(x => x.id === id);
                if (!v) return;
                const { body } = generateQuoteRequest(v, origin, dest, container);
                const customBody = body.replace('General cargo / Trading materials', commodity);
                if (v.whatsapp) openWhatsApp(v.whatsapp, customBody);
                else if (v.email) openEmail(v.email, 'Rate Request — ' + origin + ' to ' + dest + ' — KTC', customBody);
              });
              setSent([...sent, ...toSend]);
            }} className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition">
              💬 Send All via WhatsApp/Email ({selectedVendors.filter(id => !sent.includes(id)).length} vendors)
            </button>
            {selectedVendors.filter(id => !sent.includes(id)).map(id => {
              const v = vendors.find(x => x.id === id);
              if (!v) return null;
              const { subject, body } = generateQuoteRequest(v, origin, dest, container);
              const customBody = body.replace('General cargo / Trading materials', commodity);
              return (
                <div key={id} className="flex gap-1">
                  {v.whatsapp && <button onClick={() => { openWhatsApp(v.whatsapp, customBody); setSent([...sent, id]); }}
                    className="flex-1 py-2 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200">💬 {v.company_name}</button>}
                  {v.email && <button onClick={() => setShowComposer(v)}
                    className="flex-1 py-2 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200">📧 {v.company_name}</button>}
                </div>
              );
            })}
          </div>
        )}
        {sent.length > 0 && <div className="mt-3 text-center text-xs text-emerald-600 font-bold">✅ Sent to {sent.length} vendor{sent.length !== 1 ? 's' : ''}</div>}
      </div>
    </div>
    {showComposer && (() => {
      const v = showComposer;
      const { subject, body } = generateQuoteRequest(v, origin, dest, container);
      const customBody = body.replace('General cargo / Trading materials', commodity);
      return <EmailComposer to={v.email} subject={subject} body={customBody} userId={userId} senderName="KTC International"
        onClose={() => setShowComposer(null)} onSent={() => { setShowComposer(null); setSent([...sent, v.id]); }} />;
    })()}
  </div>);
}

export default function ShippingRatesTab({ toast, user, userProfile, isAdmin, customers }) {
  const myId = userProfile?.id;
  const [rates, setRates] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('routes');
  // v55.66 — restore the missing "list" sub-view inside the routes screen.
  // Reported by Max May 7 2026: "I can't find the list view now under
  // shipping rates". Toggle between 🗂 Routes (the bucket card grid by
  // route) and 📋 List (every individual rate as one row, sortable,
  // filterable). All filters (POL, POD, vendor, line, expiry, search)
  // apply to both views — only the rendering changes.
  const [routesViewMode, setRoutesViewMode] = useState(function () {
    try { return (typeof window !== 'undefined' && window.localStorage.getItem('ktc_shipping_routes_view_mode')) || 'routes'; }
    catch (_) { return 'routes'; }
  });
  // Persist the user's preference so it sticks across sessions
  var setRoutesViewModePersist = function (mode) {
    setRoutesViewMode(mode);
    try { if (typeof window !== 'undefined') window.localStorage.setItem('ktc_shipping_routes_view_mode', mode); } catch (_) {}
  };
  // List-view sort state
  var [listSortKey, setListSortKey] = useState('effective_date');
  var [listSortDir, setListSortDir] = useState('desc');
  const [q, setQ] = useState('');
  const [filterOrigin, setFilterOrigin] = useState('all');
  const [filterDest, setFilterDest] = useState('all');
  // v55.63 — separate Port of Loading and Port of Discharge filters.
  // Previously you could only filter by destination COUNTRY, so picking
  // "Egypt" lumped Alexandria, Damietta, Sokhna, and Port Said into the
  // same card — confusing when you only care about one specific port.
  // These two filters now narrow results to the exact port.
  const [filterPol, setFilterPol] = useState('all');
  // v55.80 — Trends view filters (all default to 'all'/'12m')
  const [trendRange, setTrendRange] = useState('12m');
  const [trendOrigin, setTrendOrigin] = useState('all');
  const [trendDest, setTrendDest] = useState('all');
  const [trendCurrency, setTrendCurrency] = useState('USD');
  // v55.80 — Trends: chart vs table toggle. Persisted in localStorage like
  // the bubble/list toggle on the routes view.
  const [trendsViewMode, setTrendsViewModeRaw] = useState(function () {
    try { return (typeof window !== 'undefined' && window.localStorage.getItem('ktc_shipping_trends_view_mode')) || 'chart'; }
    catch (_) { return 'chart'; }
  });
  var setTrendsViewMode = function (mode) {
    setTrendsViewModeRaw(mode);
    try { if (typeof window !== 'undefined') window.localStorage.setItem('ktc_shipping_trends_view_mode', mode); } catch (_) {}
  };
  const [filterPod, setFilterPod] = useState('all');
  const [filterVendor, setFilterVendor] = useState('all');
  const [filterLine, setFilterLine] = useState('all');
  const [filterMode, setFilterMode] = useState('all');
  // v55.81 #17 (Max May 9 2026): default to 'active' so daily users see only
  // live rates on first load. Historical/expired rates are still preserved
  // and accessible — switch the toggle to "Historical" or "All" to surface
  // them in their own clearly-labeled section. Previously 'all' was default
  // and active + historical mixed together, which made it harder to scan.
  // v55.81 QA-6 (Max May 9 2026): persist the user's choice in localStorage
  // so flipping to "Both" or "Historical" sticks across reloads. Without
  // persistence the toggle felt like it kept resetting, which annoyed users
  // who lived in the "Both" view.
  const [filterExpiry, setFilterExpiry] = useState(function () {
    try {
      if (typeof window !== 'undefined') {
        var saved = window.localStorage.getItem('ktc_shipping_filter_expiry');
        if (saved === 'active' || saved === 'expired' || saved === 'all') return saved;
      }
    } catch (_) {}
    return 'active';
  });
  // Persist on every change. Wrapping the setter so any caller (the three
  // toggle buttons below) automatically persists without each one having to
  // remember to do it.
  var setFilterExpiryPersist = function (v) {
    setFilterExpiry(v);
    try { if (typeof window !== 'undefined') window.localStorage.setItem('ktc_shipping_filter_expiry', v); } catch (_) {}
  };
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
  // v55.81 — live status text shown alongside the progress bar so the
  // user can see what's happening (was just %).
  const [importStatus, setImportStatus] = useState('');
  const [importColMap, setImportColMap] = useState({});
  // v55.44 — keep the raw Excel rows + header list so the user can RE-MAP a
  // column from a dropdown if the auto-detect picked the wrong source. Without
  // this we'd have to ask them to re-pick the file every time. Also drives the
  // editable preview so a single bad cell doesn't force a full re-import.
  const [importRawRows, setImportRawRows] = useState([]);
  const [importHeaders, setImportHeaders] = useState([]);
  const [importContainerCols, setImportContainerCols] = useState([]); // detected container-rate columns
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
    // v55.63 — POL and POD now actually filter (previously the dropdowns
    // could be added to the UI but didn't narrow results).
    if (filterPol !== 'all' && r.port_of_loading !== filterPol) return false;
    if (filterPod !== 'all' && r.port_of_discharge !== filterPod) return false;
    if (filterVendor !== 'all' && r.vendor_name !== filterVendor) return false;
    if (filterLine !== 'all' && r.shipping_line !== filterLine) return false;
    if (filterMode !== 'all' && r.transport_mode !== filterMode) return false;
    if (filterExpiry === 'active' && isExpired(r.expiry_date)) return false;
    if (filterExpiry === 'expired' && !isExpired(r.expiry_date)) return false;
    if (q) { const hay = [r.origin, r.destination, r.vendor_name, r.shipping_line, r.port_of_loading, r.port_of_discharge, r.container_type, r.notes, r.shipment_reference].filter(Boolean).join(' ').toLowerCase(); return q.toLowerCase().split(/\s+/).every(w => hay.includes(w)); }
    return true;
  }), [rates, filterOrigin, filterDest, filterPol, filterPod, filterVendor, filterLine, filterMode, filterExpiry, q]);

  // v55.63 — when the user picks a specific Port of Discharge (or POL), the
  // route cards now group by that PORT rather than by country. So picking
  // POD = "Alexandria" gives you a card per (origin → Alexandria), no longer
  // bundling Damietta or Port Said into the same "Egypt" card. When no port
  // is picked, behaviour is unchanged (group by origin → destination country).
  const groupByPort = filterPod !== 'all' || filterPol !== 'all';
  const routeGroups = useMemo(() => {
    const groups = {};
    filtered.forEach(r => {
      var leftLabel = groupByPort ? ((r.port_of_loading || r.origin || '?') + (r.port_of_loading && r.origin && r.port_of_loading !== r.origin ? ' (' + r.origin + ')' : '')) : (r.origin || '?');
      var rightLabel = groupByPort ? ((r.port_of_discharge || r.destination || '?') + (r.port_of_discharge && r.destination && r.port_of_discharge !== r.destination ? ' (' + r.destination + ')' : '')) : (r.destination || '?');
      const key = leftLabel + ' → ' + rightLabel;
      if (!groups[key]) groups[key] = {
        origin: r.origin,
        destination: r.destination,
        pol: groupByPort ? (r.port_of_loading || null) : null,
        pod: groupByPort ? (r.port_of_discharge || null) : null,
        leftLabel: leftLabel,
        rightLabel: rightLabel,
        rates: [], vendors: new Set(), lines: new Set(), modes: new Set()
      };
      groups[key].rates.push(r);
      if (r.vendor_name) groups[key].vendors.add(r.vendor_name);
      if (r.shipping_line) groups[key].lines.add(r.shipping_line);
      if (r.transport_mode) groups[key].modes.add(r.transport_mode);
    });
    // v55.81 #16 + #19 (Max May 9 2026): mark each group as `historicalGroup`
    // when ALL its rates are expired, so the renderer can move it into a
    // separate "Historical Rates" section instead of mixing it with active
    // rates. Sort alphabetically by destination first (Max's spec), with
    // groups that have any active rates appearing before groups that are
    // fully historical when both show in the same render (i.e. the "All"
    // toggle below). Previously sorted by `count desc` which moved high-
    // volume historical routes to the top.
    return Object.entries(groups).map(([key, data]) => {
      const ar = data.rates.filter(r => !isExpired(r.expiry_date));
      const ch = ar.length > 0 ? ar.reduce((a,b) => (a.rate_amount||Infinity) < (b.rate_amount||Infinity) ? a : b) : null;
      return { key, ...data, cheapest: ch, activeCount: ar.length, expiredCount: data.rates.length - ar.length, count: data.rates.length, historicalGroup: ar.length === 0 };
    }).sort(function (a, b) {
      // Active groups first, then alphabetical by destination
      if (a.historicalGroup !== b.historicalGroup) return a.historicalGroup ? 1 : -1;
      var ad = (a.destination || a.rightLabel || '').toLowerCase();
      var bd = (b.destination || b.rightLabel || '').toLowerCase();
      if (ad !== bd) return ad < bd ? -1 : 1;
      // Same destination — secondary sort by origin so cards group sensibly
      var ao = (a.origin || a.leftLabel || '').toLowerCase();
      var bo = (b.origin || b.leftLabel || '').toLowerCase();
      return ao < bo ? -1 : (ao > bo ? 1 : 0);
    });
  }, [filtered, groupByPort]);

  // v55.81 #16 (Max May 9 2026): pre-split routeGroups for the renderer
  // when filterExpiry === 'all'. The renderer reads activeRouteGroups and
  // historicalRouteGroups directly, so it doesn't have to re-filter on
  // every render pass. When filterExpiry is 'active' or 'expired' (only
  // one side is showing), the inactive bucket is empty so nothing renders.
  const activeRouteGroups = useMemo(function () {
    return routeGroups.filter(function (rg) { return !rg.historicalGroup; });
  }, [routeGroups]);
  const historicalRouteGroups = useMemo(function () {
    return routeGroups.filter(function (rg) { return rg.historicalGroup; });
  }, [routeGroups]);

  // v55.63 — routeHistory now respects POL/POD too. When a user clicks into
  // a route card while filtered to POD = Alexandria, the detail view stays
  // scoped to Alexandria; it doesn't widen back to all Egypt ports.
  const routeHistory = useMemo(() => { if (!selectedRoute) return []; return rates.filter(r => {
    if (selectedRoute.origin && r.origin !== selectedRoute.origin) return false;
    if (selectedRoute.destination && r.destination !== selectedRoute.destination) return false;
    if (selectedRoute.pol && r.port_of_loading !== selectedRoute.pol) return false;
    if (selectedRoute.pod && r.port_of_discharge !== selectedRoute.pod) return false;
    return true;
  }).sort((a,b) => (b.effective_date||'').localeCompare(a.effective_date||'')); }, [selectedRoute, rates]);
  const routeQuotes = useMemo(() => { if (!selectedRoute) return []; return quotes.filter(q => q.origin === selectedRoute.origin && q.destination === selectedRoute.destination).sort((a,b) => (b.quote_date||'').localeCompare(a.quote_date||'')); }, [selectedRoute, quotes]);
  const rateBookings = (rateId) => bookings.filter(b => b.rate_id === rateId);
  const routeBookings = (origin, dest, pol, pod) => {
    const rateIds = new Set(rates.filter(r => {
      if (origin && r.origin !== origin) return false;
      if (dest && r.destination !== dest) return false;
      if (pol && r.port_of_loading !== pol) return false;
      if (pod && r.port_of_discharge !== pod) return false;
      return true;
    }).map(r => r.id));
    return bookings.filter(b => rateIds.has(b.rate_id));
  };

  const handleSaveRate = async () => {
    if (!f.origin || !f.destination || !f.vendorName) { alert('Fill Origin, Destination, Vendor'); return; }
    if (!f.rateType) { alert('Rate Type is required! Select Shipping, Trucking, or Customs/Brokerage.\n\nنوع السعر مطلوب! اختر شحن أو نقل بري أو جمارك'); return; }
    const record = { origin: f.origin, destination: f.destination, vendor_name: f.vendorName, shipping_line: f.shippingLine || '', transport_mode: f.transportMode || 'Ocean', rate_type: f.rateType, container_type: f.containerType || '40ft', rate_amount: Number(f.rateAmount) || 0, currency: f.currency || 'USD', transit_days: f.transitDays ? Number(f.transitDays) : null, free_days: f.freeDays ? Number(f.freeDays) : null, port_fees: Number(f.portFees) || 0, thc_fees: Number(f.thcFees) || 0, documentation_fees: Number(f.docFees) || 0, customs_fees: Number(f.customsFees) || 0, other_fees: Number(f.otherFees) || 0, other_fees_desc: f.otherFeesDesc || '', total_cost: Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), effective_date: f.effectiveDate || todayET(), expiry_date: f.expiryDate || null, port_of_loading: f.pol || '', port_of_discharge: f.pod || '', notes: f.notes || '', booked: f.booked || false, shipment_reference: f.shipmentRef || '', booking_date: f.bookingDate || null, booking_notes: f.bookingNotes || '' };
    try { if (editingRate) await dbUpdate('shipping_rates', editingRate.id, record, myId); else { await dbInsert('shipping_rates', record, myId); notifyShippingRate('all', f.origin, f.destination, myId); } await logActivity(myId, (editingRate ? 'Updated' : 'Created') + ' ' + (f.rateType || 'shipping') + ' rate: ' + f.origin + ' → ' + f.destination + ' (' + f.vendorName + ', ' + (f.currency || 'USD') + ' ' + (f.rateAmount || 0) + ')', 'shipping'); setF({}); setEditingRate(null); setView(selectedRoute ? 'route_detail' : 'routes'); await loadData(); } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
  };

  const [bookingModal, setBookingModal] = useState(null);
  const handleMarkBooked = async (rate) => { setBookingModal(rate); };
  const confirmBooking = async () => {
    if (!bookingModal || !f.bookRef) return;
    try {
      await dbInsert('shipping_bookings', { rate_id: bookingModal.id, shipment_reference: f.bookRef, customer_name: f.bookCustomer || '', order_number: f.bookOrder || '', booking_date: todayET(), notes: f.bookNotes || '', booked_by: myId }, myId);
      await dbUpdate('shipping_rates', bookingModal.id, { booked: true, shipment_reference: f.bookRef, booking_date: todayET(), booking_notes: (f.bookCustomer ? 'Customer: ' + f.bookCustomer + ' | ' : '') + (f.bookOrder ? 'Order: ' + f.bookOrder : '') }, myId);
      await logActivity(myId, 'Booked rate: ' + bookingModal.vendor_name + ' ' + bookingModal.origin + '→' + bookingModal.destination + ' Ref: ' + f.bookRef + (f.bookCustomer ? ' for ' + f.bookCustomer : ''), 'shipping');
      notifyShippingBooked('all', f.bookRef, myId);
      setBookingModal(null); setF(prev => ({...prev, bookRef:'', bookCustomer:'', bookOrder:'', bookNotes:''})); await loadData();
    } catch (err) { toast ? toast.error(err.message) : alert(err.message); }
  };
  const [rateHistoryMode, setRateHistoryMode] = useState('1y');
  const [rateHistoryDf, setRateHistoryDf] = useState(() => daysAgoET(365));
  const [rateHistoryDt, setRateHistoryDt] = useState('');
  // S17.11 (Apr 23 2026) — historical rates UX overhaul.
  // hideExpired: separate checkbox, NOT tied to the time-period buttons.
  // Default OFF so expired rates show when user picks a period. Max complained
  // he could not "uncheck" Active Only in the old button group. Now Active is
  // a checkbox he can flip freely.
  // chartShippingLine: 'all' shows one line per shipping line in the trend
  // chart; picking a specific line shows only that one.
  const [hideExpired, setHideExpired] = useState(false);
  const [chartShippingLine, setChartShippingLine] = useState('all');

  const handleSaveQuote = async () => {
    if (!f.qCustomer || !f.qOrigin || !f.qDest) { alert('Fill Customer, Origin, Destination'); return; }
    const iT = Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0);
    const cT = Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0);
    const profit = cT - iT;
    const record = { quote_number: f.qNumber || ('Q-' + Date.now().toString(36).toUpperCase()), quote_date: f.qDate || todayET(), customer_name: f.qCustomer, customer_email: f.qEmail || '', origin: f.qOrigin, destination: f.qDest, port_of_loading: f.qPol || '', port_of_discharge: f.qPod || '', container_type: f.qContainer || '40ft', shipping_rate_id: pickedShipRate || f.qRateId || null, shipping_cost: Number(f.qShipCost)||0, shipping_vendor: f.qShipVendor || '', shipping_line: f.qShipLine || '', trucking_cost: Number(f.qTruckCost)||0, trucking_vendor: f.qTruckVendor || '', customs_cost: Number(f.qCustomsCost)||0, other_internal_cost: Number(f.qOtherInternal)||0, other_internal_desc: f.qOtherInternalDesc || '', total_internal_cost: iT, client_shipping_fee: Number(f.qClientShip)||0, client_trucking_fee: Number(f.qClientTruck)||0, client_customs_fee: Number(f.qClientCustoms)||0, client_service_fee: Number(f.qClientService)||0, client_other_fee: Number(f.qClientOther)||0, client_other_desc: f.qClientOtherDesc || '', client_total: cT, client_display_text: f.qDisplayText || '', client_show_breakdown: f.qShowBreakdown || false, profit, profit_pct: iT > 0 ? Math.round((profit/iT)*10000)/100 : 0, currency: f.qCurrency || 'USD', status: f.qStatus || 'draft', valid_until: f.qValidUntil || null, notes: f.qNotes || '' };
    try { if (editingQuote) await dbUpdate('shipping_quotes', editingQuote.id, record, myId); else await dbInsert('shipping_quotes', record, myId); await logActivity(myId, `Quote ${record.quote_number} ${editingQuote?'updated':'created'} for ${record.customer_name}`); resetQuoteForm(); setView('quotes'); await loadData(); } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
  };

  const handleDeleteRate = async (rate) => { if (!confirm('Delete this rate?')) return; try { await dbDelete('shipping_rates', rate.id, myId); await loadData(); } catch (err) { toast ? toast.error(err.message) : alert(err.message); } };
  const processImportFile = async (file) => {
    const d = await file.arrayBuffer();
    const wb = XLSX.read(d);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    if (!rows.length) { alert('No data found'); return; }

    const headers = Object.keys(rows[0]);

    // v55.80 BD-AUDIT FIX: parseDate / parseNumberSmart / normalizeContainer
    // are all imported from src/lib/shipping-import-helpers.js — one source
    // of truth. Previously they were duplicated inline AND inside
    // reparseFromMapping, so bug fixes only landed in one place.
    const parseNumberSmart = _parseNumberSmartShared;

    // ---- COLUMN SCORING ----
    // For each candidate column, count how many of the first 20 non-empty rows
    // parse as numbers. We prefer columns that look numeric when we're picking
    // the "rate" or fee columns — avoids grabbing "Rate Type" (text) when a real
    // numeric rate column exists.
    const numericScore = (col) => {
      if (!col) return 0;
      let numeric = 0, seen = 0;
      for (const row of rows.slice(0, 20)) {
        const v = row[col];
        if (v == null || v === '') continue;
        seen++;
        if (!isNaN(parseNumberSmart(v))) numeric++;
      }
      return seen === 0 ? 0 : numeric / seen;
    };

    // Candidate-based matcher. Returns BEST match based on keyword hit + numeric preference.
    const findColSmart = (keywords, opts) => {
      const preferNumeric = !!(opts && opts.preferNumeric);
      const exclude = (opts && opts.exclude) || [];
      const kws = keywords.map(k => k.toLowerCase());
      const candidates = headers.filter(h => {
        const hl = h.toLowerCase().replace(/[_\-\.]/g, ' ');
        if (exclude.some(x => hl.includes(x))) return false;
        return kws.some(k => hl.includes(k));
      });
      if (candidates.length === 0) return null;
      if (!preferNumeric || candidates.length === 1) return candidates[0];
      // Sort by numeric-ratio descending, then original order
      return candidates
        .map(c => ({ c, s: numericScore(c) }))
        .sort((a, b) => b.s - a.s)[0].c;
    };

    // Is this header a container-specific rate column? (e.g. "20GP", "40HC", "40HQ Rate")
    const containerFromHeader = (h) => {
      const hl = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Need BOTH a container size AND no disqualifying word like "type"
      if (/(^|[^0-9])(20|40|45)(gp|hc|hq|st|rf|reefer|ft)/.test(hl)) {
        if (hl.includes('20gp') || /20ft|20st/.test(hl)) return "20' GP";
        if (hl.includes('40hc') || hl.includes('40hq')) return "40' HC";
        if (hl.includes('40gp') || /40ft|40st/.test(hl)) return "40' GP";
        if (hl.startsWith('45') || hl.includes('45hc')) return "45' HC";
        if (hl.includes('20rf') || hl.includes('20reefer')) return "20' RF";
        if (hl.includes('40rf') || hl.includes('40reefer')) return "40' RF";
      }
      return null;
    };

    // Find all container-specific rate columns — and ONLY if they're numeric
    const containerRateCols = headers
      .map(h => ({ h, ct: containerFromHeader(h), score: numericScore(h) }))
      .filter(x => x.ct && x.score >= 0.5);

    const colMap = {
      origin: findColSmart(['origin', 'from', 'المنشأ', 'loading country', 'pol country', 'departure']),
      destination: findColSmart(['destination', 'dest', 'الوجهة', 'pod country', 'arrival', 'consignee country']),
      vendor: findColSmart(['vendor', 'forwarder', 'freight forwarder', 'agent', 'المورد', 'supplier', 'company']),
      line: findColSmart(['shipping line', 'line', 'carrier', 'الناقل', 'steamship', 'ssl']),
      container: findColSmart(['container type', 'container size', 'container', 'حاوية', 'equipment', 'cntr'], { exclude: ['rate', 'price', 'amount', 'cost'] }),
      // RATE: prefer numeric columns, exclude "type"/"category"/"class" headers that would pick up "Rate Type"
      rate: findColSmart(['rate', 'price', 'amount', 'freight', 'cost', 'charge', 'السعر', 'ocean freight', 'total'], { preferNumeric: true, exclude: ['type', 'category', 'class', 'container', 'currency', 'mode'] }),
      currency: findColSmart(['currency', 'cur', 'ccy', 'العملة']),
      transit: findColSmart(['transit time', 'transit days', 'transit', 'tt days', 'مدة'], { preferNumeric: true }),
      free: findColSmart(['free days', 'free time', 'demurrage free', 'detention free', 'freedays'], { preferNumeric: true }),
      pol: findColSmart(['pol', 'port of loading', 'loading port', 'load port', 'port loading', 'ميناء التحميل']),
      pod: findColSmart(['pod', 'port of discharge', 'discharge port', 'port discharge', 'ميناء التفريغ', 'unloading']),
      date: findColSmart(['effective date', 'rate date', 'valid from', 'start date', 'date', 'التاريخ'], { exclude: ['expiry', 'expiration', 'until', 'end'] }),
      expiry: findColSmart(['expiry', 'expiration', 'valid until', 'valid to', 'validity', 'end date', 'الصلاحية']),
      portFees: findColSmart(['port fees', 'port charges', 'port cost', 'local charges'], { preferNumeric: true, exclude: ['loading', 'discharge'] }),
      thc: findColSmart(['thc', 'terminal handling', 'terminal'], { preferNumeric: true }),
      docFees: findColSmart(['doc fees', 'documentation', 'bl fee', 'bill of lading', 'doc'], { preferNumeric: true }),
      customsFees: findColSmart(['customs', 'duty', 'جمارك'], { preferNumeric: true }),
      otherFees: findColSmart(['other fees', 'other charges', 'surcharge', 'baf', 'caf', 'isps'], { preferNumeric: true }),
      notes: findColSmart(['notes', 'remarks', 'comment', 'ملاحظات']),
      mode: findColSmart(['transport mode', 'shipping mode', 'mode of transport', 'ship type', 'mode']),
    };

    // DIAGNOSTIC — tells you the numeric score of whatever the rate column landed on
    console.warn('📊 Column mapping:', colMap);
    console.warn('📊 Rate column numeric score:', colMap.rate, '→', numericScore(colMap.rate).toFixed(2));
    if (containerRateCols.length) console.warn('📊 Container-specific rate columns:', containerRateCols.map(x => x.h + ' (' + x.ct + ')').join(', '));

    const getVal = (row, col) => col ? String(row[col] == null ? '' : row[col]).trim() : '';
    const getNum = (row, col) => {
      const n = parseNumberSmart(row[col]);
      return isNaN(n) ? 0 : n;
    };
    const getNumOrNull = (row, col) => {
      const n = parseNumberSmart(row[col]);
      return isNaN(n) ? null : n;
    };
    // ---- DATE PARSER (v55.80 BD-AUDIT FIX) ----
    // Handles:
    //   - Excel serial date (e.g. 45567 = 2024-09-01)
    //   - ISO format YYYY-MM-DD or YYYY/MM/DD
    //   - US format MM/DD/YYYY or M/D/YYYY
    //   - DD-MMM-YYYY (e.g. "5-Oct-2024", "05-OCT-2024")
    //   - DD/MM/YYYY (when day > 12 makes the format unambiguous)
    //   - Plain Date object
    // Returns YYYY-MM-DD string OR null if unparseable.
    // NEVER returns "today" — that masks parser bugs.
    const parseDate = (row, col) => _parseDateShared(row, col);

    const normalizeContainer = _normalizeContainerShared;

    // ---- ROW PARSING ----
    // If the sheet has container-specific rate columns (20GP, 40HC, etc.) AND there
    // isn't a standalone "rate" column that scored high numerically, we expand each
    // source row into MULTIPLE output rows (one per container that has a rate > 0).
    // This is how real freight rate sheets are typically structured.
    const useContainerExpansion =
      containerRateCols.length >= 2 &&
      (!colMap.rate || numericScore(colMap.rate) < 0.5);

    const parsed = [];
    for (const row of rows) {
      const origin = getVal(row, colMap.origin) || getVal(row, colMap.pol);
      const dest = getVal(row, colMap.destination) || getVal(row, colMap.pod);
      if (!origin && !dest) continue; // skip empty rows

      // v55.80 BD-AUDIT FIX: NEVER silently overwrite a historical date
      // with todayET(). If the source has a date column, USE IT (even if
      // it's in the past). If parsing fails (returns null), only THEN
      // fall back to today, AND log a warning so we can debug bad rows.
      const parsedEffective = parseDate(row, colMap.date);
      const parsedExpiry = parseDate(row, colMap.expiry);
      if (colMap.date && parsedEffective === null) {
        console.warn('[shipping-import] could not parse effective_date in row:', row[colMap.date]);
      }
      if (colMap.expiry && parsedExpiry === null) {
        console.warn('[shipping-import] could not parse expiry_date in row:', row[colMap.expiry]);
      }

      const baseFields = {
        origin: origin,
        destination: dest,
        vendor_name: getVal(row, colMap.vendor),
        shipping_line: getVal(row, colMap.line),
        transport_mode: getVal(row, colMap.mode) || 'Ocean',
        currency: getVal(row, colMap.currency) || 'USD',
        transit_days: getNumOrNull(row, colMap.transit),
        free_days: getNumOrNull(row, colMap.free),
        port_fees: getNum(row, colMap.portFees),
        thc_fees: getNum(row, colMap.thc),
        documentation_fees: getNum(row, colMap.docFees),
        customs_fees: getNum(row, colMap.customsFees),
        other_fees: getNum(row, colMap.otherFees),
        // Use parsed historical date if present. ONLY fall back to today if
        // there's literally no date in the source. Historical dates pass
        // through and stay historical — even if already expired.
        effective_date: parsedEffective || todayET(),
        expiry_date: parsedExpiry,
        port_of_loading: getVal(row, colMap.pol),
        port_of_discharge: getVal(row, colMap.pod),
        notes: getVal(row, colMap.notes),
      };

      if (useContainerExpansion) {
        // one row per container column that has a numeric value
        for (const crc of containerRateCols) {
          const rate = getNum(row, crc.h);
          if (rate <= 0) continue;
          const r = Object.assign({}, baseFields, {
            container_type: crc.ct,
            rate_amount: rate,
          });
          r.total_cost = r.rate_amount + r.port_fees + r.thc_fees + r.documentation_fees + r.customs_fees + r.other_fees;
          parsed.push(r);
        }
      } else {
        const r = Object.assign({}, baseFields, {
          container_type: normalizeContainer(getVal(row, colMap.container)),
          rate_amount: getNum(row, colMap.rate),
        });
        r.total_cost = r.rate_amount + r.port_fees + r.thc_fees + r.documentation_fees + r.customs_fees + r.other_fees;
        parsed.push(r);
      }
    }

    if (!parsed.length) { alert('No valid rates found. Make sure columns include Origin/Destination or POL/POD.'); return; }

    // ---- VALIDATION — warn if rate is 0 ----
    const zeroRateCount = parsed.filter(r => !r.rate_amount || r.rate_amount === 0).length;
    const ratePct = ((parsed.length - zeroRateCount) / parsed.length * 100).toFixed(0);
    if (zeroRateCount > 0) {
      const detectedRateCol = useContainerExpansion
        ? containerRateCols.map(x => x.h).join(', ')
        : (colMap.rate || '(none detected)');
      const msg =
        'Heads up: ' + zeroRateCount + ' of ' + parsed.length + ' rows (' + (100 - ratePct) + '%) have rate = 0.\n\n' +
        'Rate column(s) detected: ' + detectedRateCol + '\n\n' +
        (colMap.rate && numericScore(colMap.rate) < 0.5
          ? '⚠️  The detected rate column has mostly non-numeric values. Probably the wrong column.\n\n'
          : '') +
        'Continue anyway?';
      if (!confirm(msg)) return;
    }

    // Show detected columns
    const detected = Object.entries(colMap).filter(([k, v]) => v).map(([k, v]) => k + '→' + v).join(', ');
    console.warn('✅ Detected:', detected, '| container-split:', useContainerExpansion);

    // v55.44 — save the raw rows + headers so the user can later REMAP a
    // column without re-uploading the file. The container-rate columns are
    // also saved so the same expansion logic stays available.
    setImportRawRows(rows);
    setImportHeaders(headers);
    setImportContainerCols(containerRateCols);

    setImportData(parsed);
    setImportStep('preview');
    setImportColMap(Object.assign({}, colMap, useContainerExpansion ? { __container_rate_cols: containerRateCols.map(x => x.h + ' (' + x.ct + ')').join(', ') } : {}));
  };

  // v55.44 — Re-run the parse using a user-edited column mapping. Mirrors
  // the parse loop inside processImportFile but uses the saved rows + headers
  // so the user doesn't have to re-upload the spreadsheet to fix a wrong
  // column auto-detection. Called from the "Remap" controls in the preview.
  const reparseFromMapping = (newColMap) => {
    const rows = importRawRows;
    const containerRateCols = importContainerCols;
    if (!rows || !rows.length) return;

    // v55.80 BD-AUDIT FIX: use shared helpers (was a hand-written copy of
    // processImportFile's helpers, leading to drift). Now imports from
    // src/lib/shipping-import-helpers.js.
    const parseNumberSmart = _parseNumberSmartShared;
    const getVal = (row, col) => col ? String(row[col] == null ? '' : row[col]).trim() : '';
    const getNum = (row, col) => { const n = parseNumberSmart(row[col]); return isNaN(n) ? 0 : n; };
    const getNumOrNull = (row, col) => { const n = parseNumberSmart(row[col]); return isNaN(n) ? null : n; };
    const parseDate = (row, col) => _parseDateShared(row, col);
    const normalizeContainer = _normalizeContainerShared;
    // If user picked an explicit rate column, disable container-expansion
    // (their choice wins). Otherwise fall back to expansion when applicable.
    const useContainerExpansion = !newColMap.rate && containerRateCols.length >= 2;

    const parsed = [];
    for (const row of rows) {
      const origin = getVal(row, newColMap.origin) || getVal(row, newColMap.pol);
      const dest = getVal(row, newColMap.destination) || getVal(row, newColMap.pod);
      if (!origin && !dest) continue;
      // v55.80 BD-AUDIT FIX: preserve historical dates. Same logic as
      // processImportFile — only fall back to today() if there's literally
      // no date in the source. Log a warning if parsing fails so we can
      // debug bad rows.
      const parsedEffective = parseDate(row, newColMap.date);
      const parsedExpiry = parseDate(row, newColMap.expiry);
      if (newColMap.date && parsedEffective === null) {
        console.warn('[shipping-reparse] could not parse effective_date in row:', row[newColMap.date]);
      }
      if (newColMap.expiry && parsedExpiry === null) {
        console.warn('[shipping-reparse] could not parse expiry_date in row:', row[newColMap.expiry]);
      }
      const baseFields = {
        origin: origin,
        destination: dest,
        vendor_name: getVal(row, newColMap.vendor),
        shipping_line: getVal(row, newColMap.line),
        transport_mode: getVal(row, newColMap.mode) || 'Ocean',
        currency: getVal(row, newColMap.currency) || 'USD',
        transit_days: getNumOrNull(row, newColMap.transit),
        free_days: getNumOrNull(row, newColMap.free),
        port_fees: getNum(row, newColMap.portFees),
        thc_fees: getNum(row, newColMap.thc),
        documentation_fees: getNum(row, newColMap.docFees),
        customs_fees: getNum(row, newColMap.customsFees),
        other_fees: getNum(row, newColMap.otherFees),
        effective_date: parsedEffective || todayET(),
        expiry_date: parsedExpiry,
        port_of_loading: getVal(row, newColMap.pol),
        port_of_discharge: getVal(row, newColMap.pod),
        notes: getVal(row, newColMap.notes),
      };
      if (useContainerExpansion) {
        for (const crc of containerRateCols) {
          const rate = getNum(row, crc.h);
          if (rate <= 0) continue;
          const r = Object.assign({}, baseFields, { container_type: crc.ct, rate_amount: rate });
          r.total_cost = r.rate_amount + r.port_fees + r.thc_fees + r.documentation_fees + r.customs_fees + r.other_fees;
          parsed.push(r);
        }
      } else {
        const r = Object.assign({}, baseFields, {
          container_type: normalizeContainer(getVal(row, newColMap.container)),
          rate_amount: getNum(row, newColMap.rate),
        });
        r.total_cost = r.rate_amount + r.port_fees + r.thc_fees + r.documentation_fees + r.customs_fees + r.other_fees;
        parsed.push(r);
      }
    }
    setImportData(parsed);
    // Strip internal keys (those starting with __) from the saved colMap
    const cleanMap = {};
    Object.keys(newColMap).forEach(k => { if (!k.startsWith('__')) cleanMap[k] = newColMap[k]; });
    setImportColMap(cleanMap);
  };

  // v55.44 — Update a single cell of the parsed preview. Keeps total_cost
  // in sync when a fee or rate changes. Used by the editable preview cells.
  const updateImportRow = (idx, field, value) => {
    setImportData(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = Object.assign({}, r, { [field]: value });
      // Recalculate total_cost when any fee or the base rate changes
      if (['rate_amount','port_fees','thc_fees','documentation_fees','customs_fees','other_fees'].indexOf(field) !== -1) {
        const num = (x) => { const n = Number(x); return isNaN(n) ? 0 : n; };
        updated.total_cost = num(updated.rate_amount) + num(updated.port_fees) + num(updated.thc_fees) + num(updated.documentation_fees) + num(updated.customs_fees) + num(updated.other_fees);
      }
      return updated;
    }));
  };
  // v55.44 — Remove a row from the preview. Lets the user drop a junk row
  // (e.g. a totals row at the bottom of the spreadsheet) before importing.
  const removeImportRow = (idx) => {
    setImportData(prev => prev.filter((_, i) => i !== idx));
  };
  // v55.81 — REWRITTEN for reliability. Per Max May 9 2026: import was
  // "sitting forever". Three causes addressed here:
  //   1. The per-row fallback called dbInsert() which writes audit_log per
  //      row. 210 rows = 420 round-trips serialized = up to 2 minutes.
  //   2. If the bulk insert failed because of one bad column (e.g. column
  //      doesn't exist on this DB), we'd fall through to the per-row path
  //      and hit the SAME error 210 times.
  //   3. No timeout on the Supabase calls — a hung connection meant the
  //      UI froze indefinitely.
  // The fix: try bulk, if it fails for a missing-column reason strip that
  // column FROM ALL rows and retry ONCE bulk, then per-row only for true
  // data errors. Skip audit_log per row — write a single bulk-import audit
  // entry at the end. 30-sec timeout on every Supabase call.
  const executeImport = async () => {
    setImportStep('importing'); setImportProgress(0);
    setImportStatus('Preparing ' + importData.length + ' rows…');

    // Defensive: snapshot the data and clean it up first.
    var rowsToInsert = importData.slice().map(function (r) {
      var clean = {};
      // Only keep keys with non-undefined values; null is fine for nullable
      // columns. Strip empty-string for date columns since Postgres rejects
      // '' on a DATE column.
      for (var k in r) {
        var v = r[k];
        if (v === undefined) continue;
        if ((k === 'effective_date' || k === 'expiry_date' || k === 'booking_date') && v === '') continue;
        clean[k] = v;
      }
      return clean;
    });

    var ok = 0, failed = 0;
    var errors = [];

    // 30-second timeout wrapper for any Supabase call so a stalled network
    // or long query doesn't freeze the importer.
    var withTimeout = function (promise, ms, label) {
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve({ data: null, error: { message: (label || 'Operation') + ' timed out after ' + ms + 'ms' } });
        }, ms);
        promise.then(function (res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(res);
        }).catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ data: null, error: err });
        });
      });
    };

    // Step 1 — try ALL rows in one go. Postgres handles a few hundred fine.
    setImportStatus('Inserting ' + rowsToInsert.length + ' rows…');
    var bulkRes = await withTimeout(
      supabase.from('shipping_rates').insert(rowsToInsert),
      30000,
      'Bulk insert'
    );

    if (!bulkRes.error) {
      // Happy path
      ok = rowsToInsert.length;
      setImportProgress(95);
    } else {
      // Step 2 — if the error is a missing column, strip it from every
      // row and retry once.
      var msg = (bulkRes.error.message || String(bulkRes.error || '')).toLowerCase();
      var missingCol = null;
      var m = msg.match(/column ['"]?(\w+)['"]? of relation/);
      if (!m) m = msg.match(/could not find the ['"]?(\w+)['"]? column/);
      if (!m) m = msg.match(/['"](\w+)['"]? column .* schema cache/);
      if (m) missingCol = m[1];

      if (missingCol) {
        setImportStatus('Database is missing the "' + missingCol + '" column — retrying without it…');
        rowsToInsert = rowsToInsert.map(function (r) {
          var copy = Object.assign({}, r);
          delete copy[missingCol];
          return copy;
        });
        var retry = await withTimeout(
          supabase.from('shipping_rates').insert(rowsToInsert),
          30000,
          'Bulk insert retry'
        );
        if (!retry.error) {
          ok = rowsToInsert.length;
          setImportProgress(95);
        } else {
          // Still failing — fall through to per-row to find which rows are bad
          setImportStatus('Some rows have problems — checking each row individually…');
          var perRowResult = await runPerRow(rowsToInsert, withTimeout);
          ok = perRowResult.ok; failed = perRowResult.failed; errors = perRowResult.errors;
        }
      } else {
        // Unknown error type — try per-row to surface specific bad rows
        setImportStatus('Some rows have problems — checking each row individually…');
        var perRowResult2 = await runPerRow(rowsToInsert, withTimeout);
        ok = perRowResult2.ok; failed = perRowResult2.failed; errors = perRowResult2.errors;

        // If EVERY row failed with the same error, don't pretend it's
        // a row issue — surface the original bulk error to the user.
        if (failed === rowsToInsert.length) {
          errors = [bulkRes.error.message || String(bulkRes.error)];
        }
      }
    }

    // Step 3 — single bulk audit-log entry (NOT per-row, which would be 210 writes)
    if (ok > 0 && myId) {
      try {
        await withTimeout(
          supabase.from('audit_log').insert({
            table_name: 'shipping_rates',
            record_id: null,
            action: 'bulk_import',
            changed_by: myId,
            new_values: { count: ok, source: 'shipping-rate-import' }
          }),
          5000,
          'Audit log'
        );
      } catch (_) {} // audit failure shouldn't block the import success message
    }

    setImportProgress(100);
    setImportStep('done');
    setImportStatus('');

    if (failed > 0) {
      alert('Import complete:\n' +
            ok + ' saved\n' +
            failed + ' failed\n\n' +
            (errors.length > 0 ? 'First errors:\n' + errors.slice(0, 5).join('\n') : ''));
    } else if (ok === 0) {
      alert('Import failed — nothing was saved.\n\n' +
            (errors.length > 0 ? errors.join('\n') : 'Unknown error. Check browser console for details.'));
    }
    try { await loadData(); } catch (_) {}
  };

  // Per-row fallback used by executeImport. Pulled out for readability.
  // Tries each row individually with a 5-sec timeout so one bad row never
  // freezes the importer.
  const runPerRow = async (rows, withTimeout) => {
    var ok = 0, failed = 0, errors = [];
    for (var i = 0; i < rows.length; i++) {
      var res = await withTimeout(
        supabase.from('shipping_rates').insert(rows[i]),
        5000,
        'Row ' + (i + 1) + ' insert'
      );
      if (res.error) {
        failed++;
        if (errors.length < 5) errors.push((res.error.message || String(res.error)));
      } else {
        ok++;
      }
      // Update progress every 10 rows so the bar doesn't redraw 210 times
      if (i % 10 === 0 || i === rows.length - 1) {
        setImportProgress(Math.round(((i + 1) / rows.length) * 90));
        setImportStatus('Checking row ' + (i + 1) + ' of ' + rows.length + '…');
      }
    }
    return { ok: ok, failed: failed, errors: errors };
  };
  const handleAiQuery = async () => { if (!aiQuery.trim()) return; setAiLoading(true); setAiAnswer(''); try { const summary = routeGroups.slice(0,50).map(rg => { const c=rg.cheapest; return rg.key+': '+rg.count+' quotes ('+rg.activeCount+' active), best: '+(c?'$'+c.rate_amount+' '+c.vendor_name+'/'+(c.shipping_line||'N/A'):'none'); }).join('\n'); const res = await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:aiQuery,context:'Shipping rates assistant for KTC.\n\nROUTES:\n'+summary+'\n\nAnswer concisely.'})}); const data = await res.json(); setAiAnswer(data.answer||'No response'); } catch(err) { setAiAnswer('Error: '+err.message); } setAiLoading(false); };
  const resetQuoteForm = () => { setF({}); setEditingQuote(null); setPickedShipRate(null); setPickedTruckRate(null); setPickedBrokerRate(null); setManualShip(false); setManualTruck(false); setManualBroker(false); };

  // ===== VENDOR CONTACT HANDLERS =====
  const handleSaveVendor = async () => {
    if (!f.vcCompany) { alert('Company name required'); return; }
    const record = { company_name: f.vcCompany, contact_name: f.vcContact || '', role: f.vcRole || '', vendor_type: f.vcType || 'Shipping', email: f.vcEmail || '', phone: f.vcPhone || '', whatsapp: f.vcWhatsapp || f.vcPhone || '', origin_regions: f.vcOrigins || '', destination_regions: f.vcDests || '', notes: f.vcNotes || '', is_active: true };
    try {
      if (editingVendor) await dbUpdate('vendor_contacts', editingVendor.id, record, myId);
      else await dbInsert('vendor_contacts', record, myId);
      await logActivity(myId, (editingVendor ? 'Updated' : 'Added') + ' vendor: ' + record.company_name);
      setF({}); setEditingVendor(null); setView('vendors'); await loadData();
    } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
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
    const today = fmtET(new Date(), 'longdate', { tag: false });
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
                <span className={'px-1.5 py-0.5 rounded text-[9px] font-semibold ' + (vc.vendor_type === 'Shipping' ? 'bg-blue-100 text-blue-700' : vc.vendor_type === 'Trucking' ? 'bg-amber-100 text-amber-900' : 'bg-purple-100 text-purple-700')}>{vc.vendor_type}</span>
                {vc.origin_regions && <span className="text-[9px] text-slate-500">📍 {vc.origin_regions}</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              {vc.whatsapp && <button onClick={()=>openWhatsApp(vc.whatsapp, '')} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white">💬 WhatsApp</button>}
              {vc.email && <button onClick={()=>{const {subject,body}=generateQuoteRequest(vc);openEmail(vc.email,subject,body);}} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white">📧 Email</button>}
              {vc.phone && <a href={'tel:'+vc.phone} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-500 text-white">📞</a>}
              <button onClick={()=>{setEditingVendor(vc);setF({vcCompany:vc.company_name,vcContact:vc.contact_name,vcRole:vc.role,vcType:vc.vendor_type,vcEmail:vc.email,vcPhone:vc.phone,vcWhatsapp:vc.whatsapp,vcOrigins:vc.origin_regions,vcDests:vc.destination_regions,vcNotes:vc.notes});setView('add_vendor');}} className="px-2 py-1.5 rounded-lg text-xs border border-slate-200">Edit</button>
            </div>
          </div>
          <div className="flex gap-2 mt-2 text-[10px] text-slate-500">
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
    {requestQuoteData && <RequestQuoteModal data={requestQuoteData} onClose={()=>setRequestQuoteData(null)} origins={origins} destinations={destinations} openWhatsApp={openWhatsApp} openEmail={openEmail} generateQuoteRequest={generateQuoteRequest} userId={myId} allVendors={vendorContacts} />}
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
        {editingVendor && isAdmin && <button onClick={async()=>{if(!confirm('Delete this vendor?'))return;try{await supabase.from('vendor_contacts').delete().eq('id',editingVendor.id);setView('vendors');setF({});setEditingVendor(null);await loadData();}catch(err){toast ? toast.error(err.message) : alert(err.message);}}} className="px-5 py-2 bg-red-500 text-white rounded-lg text-sm ml-auto">Delete</button>}
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
      <div className="bg-emerald-50 rounded-lg p-3 mb-4 border border-emerald-200"><h3 className="text-xs font-bold text-emerald-800 mb-2">🏢 {f.rateType === 'Trucking' ? 'Vendor & Trucking' : f.rateType === 'Customs/Brokerage' ? 'Vendor & Customs/Brokerage' : 'Vendor & Shipping Line'}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[10px] font-semibold">Vendor *</label><input list="v-l" value={f.vendorName||''} onChange={e=>setF({...f,vendorName:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="v-l">{vendors.map(v=><option key={v} value={v}/>)}</datalist></div>
          <div><label className="text-[10px] font-semibold">Mode</label><select value={f.transportMode||'Ocean'} onChange={e=>setF({...f,transportMode:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm">{TRANSPORT_MODES.map(m=><option key={m}>{m}</option>)}</select></div>
          <div><label className="text-[10px] font-semibold">{f.rateType === 'Trucking' ? 'Trucking Company' : f.rateType === 'Customs/Brokerage' ? 'Broker/Agent' : 'Shipping Line'}</label><input list="l-l" value={f.shippingLine||''} onChange={e=>setF({...f,shippingLine:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /><datalist id="l-l">{lines.map(l=><option key={l} value={l}/>)}</datalist></div>
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
        <div><label className="text-[10px] font-semibold">Effective Date</label><input type="date" value={f.effectiveDate||todayET()} onChange={e=>setF({...f,effectiveDate:e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
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
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Pending</div><div className="text-lg font-extrabold text-amber-700">{quotes.filter(q=>q.status==='draft'||q.status==='sent').length}</div></div>
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
    // v55.33 — figure out the PRIMARY currency for this route. When rates
    // come in mixed currencies (USD + EUR for example), comparing min/max/avg
    // across currencies is meaningless. We pick the most-common currency
    // and only count rates in that currency for the summary cards.
    var routeCurrencyCounts = {};
    routeHistory.forEach(function(r) {
      var c = r.currency || 'USD';
      routeCurrencyCounts[c] = (routeCurrencyCounts[c] || 0) + 1;
    });
    var routeCurrencies = Object.keys(routeCurrencyCounts);
    var primaryCurrency = routeCurrencies.length > 0
      ? routeCurrencies.reduce(function(a, b) { return routeCurrencyCounts[a] > routeCurrencyCounts[b] ? a : b; })
      : 'USD';
    var routeMixedCurrency = routeCurrencies.length > 1;
    var primaryActive = active.filter(function(r) { return (r.currency || 'USD') === primaryCurrency; });
    var primaryHistory = routeHistory.filter(function(r) { return (r.currency || 'USD') === primaryCurrency; });
    // S17.11 — The old compact bar chart was replaced by the new LineChart
    // trend below. chartData/chartSorted no longer needed.
    return (<div>
      <button onClick={()=>{setSelectedRoute(null);setView('routes');}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
      <h2 className="text-xl font-extrabold mb-1">🚢 {(selectedRoute.pol || selectedRoute.origin)} → {(selectedRoute.pod || selectedRoute.destination)}</h2>
      {(selectedRoute.pol || selectedRoute.pod) && (
        <p className="text-[11px] text-slate-500 mb-1">
          Country pair: <strong>{selectedRoute.origin || '—'} → {selectedRoute.destination || '—'}</strong>
          {selectedRoute.pol && <span className="ml-3">Loading port (POL): <strong>{selectedRoute.pol}</strong></span>}
          {selectedRoute.pod && <span className="ml-3">Discharge port (POD): <strong>{selectedRoute.pod}</strong></span>}
        </p>
      )}
      <p className="text-xs text-slate-500 mb-3">{routeHistory.length} rates • {active.length} active • {bk.length} booked</p>
      {routeMixedCurrency && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-2 mb-3 text-[11px] text-amber-800">
          ⚠️ Mixed currencies on this route ({routeCurrencies.join(', ')}). Summary cards below show only {primaryCurrency} rates ({primaryHistory.length} of {routeHistory.length}).
        </div>
      )}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Best Active ({primaryCurrency})</div><div className="text-lg font-extrabold text-emerald-600">{primaryActive.length>0?fCur(Math.min(...primaryActive.map(r=>r.rate_amount||Infinity)),primaryCurrency):'—'}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Highest ({primaryCurrency})</div><div className="text-lg font-extrabold text-red-500">{primaryHistory.length>0?fCur(Math.max(...primaryHistory.map(r=>r.rate_amount||0)),primaryCurrency):'—'}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Avg ({primaryCurrency})</div><div className="text-lg font-extrabold">{primaryHistory.length>0?fCur(Math.round(primaryHistory.reduce((a,r)=>a+Number(r.rate_amount||0),0)/primaryHistory.length),primaryCurrency):'—'}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Vendors</div><div className="text-lg font-extrabold">{Object.keys(byVL).length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Bookings</div><div className="text-lg font-extrabold">{routeBookings(selectedRoute.origin,selectedRoute.destination,selectedRoute.pol,selectedRoute.pod).length}</div></div>
      </div>
      {(() => {
        // S17.11 — proper rate trend chart with time-period + shipping-line filters.
        // Uses SAME rateHistoryMode state that drives the table below, so the chart
        // and table always stay in sync (change the period, both update).
        var trendRates = routeHistory;
        if (rateHistoryDf) trendRates = trendRates.filter(r => (r.effective_date || '') >= rateHistoryDf);
        if (rateHistoryDt) trendRates = trendRates.filter(r => (r.effective_date || '') <= rateHistoryDt);
        if (hideExpired) trendRates = trendRates.filter(r => !isExpired(r.expiry_date));

        // v55.33 — figure out the primary currency for the trend window so
        // the Y-axis and tooltip can use the right symbol (was hardcoded '$'
        // before, which read wrong on EUR / EGP / GBP routes). Currency
        // symbol map mirrors fCur() at line 15.
        var SYM = { USD: '$', EUR: '€', EGP: 'E£', GBP: '£', CNY: '¥', TRY: '₺', SAR: 'SR', AED: 'AED ' };
        var trendCurrencyCounts = {};
        trendRates.forEach(function(r) {
          var c = r.currency || 'USD';
          trendCurrencyCounts[c] = (trendCurrencyCounts[c] || 0) + 1;
        });
        var trendCurrencies = Object.keys(trendCurrencyCounts);
        var chartCurrency = trendCurrencies.length > 0
          ? trendCurrencies.reduce(function(a, b) { return trendCurrencyCounts[a] > trendCurrencyCounts[b] ? a : b; })
          : 'USD';
        var chartSym = SYM[chartCurrency] || (chartCurrency + ' ');
        var chartMixed = trendCurrencies.length > 1;
        // Restrict the chart points to the primary currency so we're not
        // averaging across $ and € on the same bar.
        var trendRatesForChart = trendRates.filter(function(r) { return (r.currency || 'USD') === chartCurrency; });

        // v55.33 — period-over-period: compute the same-length window
        // immediately preceding the current one and compare averages.
        var priorAvg = null;
        var currentAvg = null;
        if (rateHistoryDf && rateHistoryDt) {
          var df = new Date(rateHistoryDf);
          var dt = new Date(rateHistoryDt);
          var msPerDay = 24 * 60 * 60 * 1000;
          var spanDays = Math.max(1, Math.round((dt - df) / msPerDay));
          var priorEnd = new Date(df.getTime() - msPerDay);
          var priorStart = new Date(priorEnd.getTime() - spanDays * msPerDay);
          var pStartIso = priorStart.toISOString().substring(0,10);
          var pEndIso = priorEnd.toISOString().substring(0,10);
          var priorRates = routeHistory.filter(function(r) {
            return (r.currency || 'USD') === chartCurrency
              && (r.effective_date || '') >= pStartIso
              && (r.effective_date || '') <= pEndIso;
          });
          if (priorRates.length > 0) {
            priorAvg = priorRates.reduce(function(a,r){ return a + Number(r.rate_amount||0); }, 0) / priorRates.length;
          }
          if (trendRatesForChart.length > 0) {
            currentAvg = trendRatesForChart.reduce(function(a,r){ return a + Number(r.rate_amount||0); }, 0) / trendRatesForChart.length;
          }
        }

        // Available shipping lines in the full route history (not just filtered) so
        // user can always see the dropdown options.
        var allLinesInRoute = Array.from(new Set(routeHistory.map(r => r.shipping_line || '(no line)'))).sort();

        // Build: [{month, <line1>: avg, <line2>: avg, _avg: overall}]
        var monthsSet = new Set();
        trendRatesForChart.forEach(r => { var m = (r.effective_date || '').substring(0,7); if (m) monthsSet.add(m); });
        var months = Array.from(monthsSet).sort();

        // Distinct color palette for up to 8 lines.
        var LINE_COLORS = ['#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899','#14b8a6','#6366f1'];

        var linesToPlot = [];
        if (chartShippingLine === 'all') {
          linesToPlot = allLinesInRoute.filter(L => trendRatesForChart.some(r => (r.shipping_line || '(no line)') === L));
        } else {
          linesToPlot = [chartShippingLine];
        }

        var trendPoints = months.map(function(m) {
          var point = { month: m };
          linesToPlot.forEach(function(L) {
            var ratesForLine = trendRatesForChart.filter(r => (r.effective_date||'').substring(0,7) === m && (r.shipping_line || '(no line)') === L);
            if (ratesForLine.length) {
              var sum = ratesForLine.reduce((a,b) => a + Number(b.rate_amount||0), 0);
              point[L] = Math.round(sum / ratesForLine.length);
            }
          });
          // Overall avg across ALL lines in this month
          var monthRates = trendRatesForChart.filter(r => (r.effective_date||'').substring(0,7) === m);
          if (monthRates.length) {
            point._avg = Math.round(monthRates.reduce((a,b) => a + Number(b.rate_amount||0), 0) / monthRates.length);
          }
          return point;
        });

        if (trendPoints.length === 0) {
          return (<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold">📈 Rate Trend Over Time</h3>
            </div>
            <div className="text-xs text-slate-500 py-6 text-center">No rate data in the selected period. Try a longer time range or turn off "Hide expired".</div>
          </div>);
        }

        return (<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200">
          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold">📈 Rate Trend Over Time ({chartCurrency})</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">Shipping line:</span>
              <select value={chartShippingLine} onChange={function(e){ setChartShippingLine(e.target.value); }} className="px-2 py-1 rounded border text-xs">
                <option value="all">All lines (compare)</option>
                {allLinesInRoute.map(function(L){ return (<option key={L} value={L}>{L}</option>); })}
              </select>
            </div>
          </div>
          {chartMixed && (
            <div className="bg-amber-50 border border-amber-300 rounded p-2 mb-2 text-[11px] text-amber-800">
              ⚠️ This route has rates in multiple currencies ({trendCurrencies.join(', ')}). Chart shows {chartCurrency} only.
            </div>
          )}
          {priorAvg !== null && currentAvg !== null && (
            <div className={'rounded p-2 mb-2 text-[11px] ' + (currentAvg > priorAvg ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800')}>
              {currentAvg > priorAvg ? '↗' : '↘'} Period-over-period: avg {chartSym}{Math.round(currentAvg).toLocaleString()} vs prior {chartSym}{Math.round(priorAvg).toLocaleString()} ({(((currentAvg - priorAvg) / priorAvg) * 100).toFixed(1)}%)
            </div>
          )}
          <div style={{width: '100%', height: 280}}>
            <ResponsiveContainer>
              <LineChart data={trendPoints} margin={{top: 10, right: 20, left: 0, bottom: 10}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{fontSize: 10}} />
                <YAxis tick={{fontSize: 10}} tickFormatter={function(v){ return chartSym + v; }} />
                <RTooltip formatter={function(v){ return chartSym + Number(v).toLocaleString(); }} />
                <RLegend wrapperStyle={{fontSize: 11}} />
                {chartShippingLine === 'all'
                  ? linesToPlot.map(function(L, i) {
                      return (<Line key={L} type="monotone" dataKey={L} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} connectNulls={true} dot={{r: 3}} />);
                    })
                  : (<Line type="monotone" dataKey={chartShippingLine} stroke="#0ea5e9" strokeWidth={3} connectNulls={true} dot={{r: 4}} />)
                }
                {chartShippingLine === 'all' && <Line type="monotone" dataKey="_avg" name="Overall avg" stroke="#334155" strokeWidth={2} strokeDasharray="5 3" dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {trendRatesForChart.length} rates plotted across {months.length} month{months.length === 1 ? '' : 's'}
            {hideExpired && <span className="ml-2 text-amber-800 font-semibold">• Expired rates hidden</span>}
          </div>
        </div>);
      })()}
      {Object.keys(byVL).length>0&&(<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">🏆 Vendor Comparison</h3><div className="overflow-auto"><table className="w-full border-collapse text-xs"><thead><tr className="bg-slate-50"><th className="px-3 py-2 text-left text-[10px]">Vendor / Line</th><th className="px-3 py-2 text-right text-[10px]">Best Rate</th><th className="px-3 py-2 text-right text-[10px]">Transit</th><th className="px-3 py-2 text-right text-[10px]">Free Days</th><th className="px-3 py-2 text-[10px]">Expiry</th></tr></thead><tbody>{Object.entries(byVL).sort((a,b)=>(a[1][0]?.rate_amount||Infinity)-(b[1][0]?.rate_amount||Infinity)).map(([key,vr],i)=>{const best=vr.reduce((a,b)=>(a.rate_amount||Infinity)<(b.rate_amount||Infinity)?a:b); return (<tr key={key} className={'border-b border-slate-50 '+(i===0?'bg-emerald-50':'')}><td className="px-3 py-2 font-semibold">{i===0&&<span className="text-emerald-500 mr-1">★</span>}{key}</td><td className="px-3 py-2 text-right font-bold text-blue-600">{fCur(best.rate_amount,best.currency)}</td><td className="px-3 py-2 text-right">{best.transit_days?best.transit_days+'d':'—'}</td><td className="px-3 py-2 text-right">{best.free_days||'—'}</td><td className="px-3 py-2"><ExpiryBadge date={best.expiry_date}/></td></tr>);})}</tbody></table></div></div>)}
      {routeQuotes.length>0&&(<div className="bg-white rounded-xl p-4 mt-4 border border-slate-200"><h3 className="text-sm font-bold mb-2">📋 Quotes ({routeQuotes.length})</h3>{routeQuotes.map(qt=>(<div key={qt.id} className="flex justify-between items-center py-2 border-b border-slate-50"><div><div className="text-xs font-semibold">{qt.quote_number} — {qt.customer_name}</div><div className="text-[10px] text-slate-500">{qt.quote_date} • {qt.status}</div></div><div className="flex items-center gap-3"><div className="text-right"><div className="text-xs">Client: <span className="font-bold">{fCur(qt.client_total,qt.currency)}</span></div><div className="text-[10px]" style={{color:qt.profit>0?'#10b981':'#ef4444'}}>Profit: {fCur(qt.profit,qt.currency)}</div></div><button onClick={()=>setPreviewQuote(qt)} className="px-2 py-1 rounded border border-purple-300 text-purple-600 text-[10px]">📄</button></div></div>))}</div>)}
      <div className="bg-white rounded-xl p-4 border border-slate-200 mt-4"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-bold">Historical Rates</h3><div className="flex gap-1">{(() => {
        // CSV export of the currently-filtered rate history
        const exportCSV = (rows) => {
          const headers = ['Effective Date','Vendor','Shipping Line','Container','Rate','Currency','Total Cost','Transit Days','Free Days','Expiry Date','Status','Booked','Shipment Ref','Booking Date'];
          const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
          const lines = [headers.join(',')];
          rows.forEach(r => {
            lines.push([
              r.effective_date || '', r.vendor_name || '', r.shipping_line || '',
              r.container_type || '', r.rate_amount || 0, r.currency || 'USD',
              r.total_cost || 0, r.transit_days || '', r.free_days || '',
              r.expiry_date || '', isExpired(r.expiry_date) ? 'Expired' : 'Active',
              r.booked ? 'Yes' : 'No', r.shipment_reference || '', r.booking_date || '',
            ].map(esc).join(','));
          });
          const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'rates_' + selectedRoute.origin + '_to_' + selectedRoute.destination + '_' + todayET() + '.csv';
          a.click();
          URL.revokeObjectURL(url);
        };
        return (<><button onClick={() => { var filtered = routeHistory; if (rateHistoryDf) filtered = filtered.filter(r => (r.effective_date || '') >= rateHistoryDf); if (rateHistoryDt) filtered = filtered.filter(r => (r.effective_date || '') <= rateHistoryDt); if (hideExpired) filtered = filtered.filter(r => !isExpired(r.expiry_date)); exportCSV(filtered); }} className="px-3 py-1 bg-emerald-500 text-white rounded text-[10px] font-semibold" title="Download as CSV">📥 Export</button><button onClick={()=>{setRequestQuoteData({vendor:null,origin:selectedRoute.origin,destination:selectedRoute.destination,container:'40ft'});}} className="px-3 py-1 bg-cyan-500 text-white rounded text-[10px] font-semibold">📋 Request Rate</button><button onClick={()=>{setF({origin:selectedRoute.origin,destination:selectedRoute.destination});setView('add_rate');}} className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">+ Add Rate</button></>);
      })()}</div></div>
      <div className="flex gap-1 mb-2 flex-wrap items-center">
        <span className="text-[10px] text-slate-500 mr-1">Period:</span>
        {[['1m','1 Month',30],['3m','3 Months',90],['6m','6 Months',180],['1y','1 Year',365],['3y','3 Years',1095],['all','All Time',0],['custom','Custom',-1]].map(function(row){
          var v = row[0], l = row[1], days = row[2];
          return (<button key={v} onClick={function(){
            setRateHistoryMode(v);
            if (days > 0) { setRateHistoryDf(daysAgoET(days)); setRateHistoryDt(""); }
            else if (days === 0) { setRateHistoryDf(''); setRateHistoryDt(''); }
            else { setRateHistoryDf(''); setRateHistoryDt(''); }
          }}
            className={'px-2 py-1 rounded text-[10px] font-semibold '+(rateHistoryMode===v?'bg-blue-500 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{l}</button>);
        })}
        {rateHistoryMode==='custom'&&(<><input type="date" value={rateHistoryDf} onChange={e=>setRateHistoryDf(e.target.value)} className="px-2 py-1 border rounded text-[10px] w-28" /><span className="text-[10px]">→</span><input type="date" value={rateHistoryDt} onChange={e=>setRateHistoryDt(e.target.value)} className="px-2 py-1 border rounded text-[10px] w-28" /></>)}
        {/* S17.11 — separate "Hide expired" toggle. Max can freely check or
            uncheck, independent of the time period. Default OFF so expired
            rates ARE visible, matching the "show me historical rates" ask. */}
        <label className="flex items-center gap-1 ml-3 cursor-pointer select-none">
          <input type="checkbox" checked={hideExpired} onChange={function(e){ setHideExpired(e.target.checked); }} className="w-3.5 h-3.5 cursor-pointer" />
          <span className="text-[10px] text-slate-600 font-semibold">Hide expired</span>
        </label>
      </div>
      {(() => {
        var filtered = routeHistory;
        if (rateHistoryDf) filtered = filtered.filter(r => (r.effective_date || '') >= rateHistoryDf);
        if (rateHistoryDt) filtered = filtered.filter(r => (r.effective_date || '') <= rateHistoryDt);
        if (hideExpired) filtered = filtered.filter(r => !isExpired(r.expiry_date));
        // v55.33 — best-rate must be currency-aware. Compute primary currency
        // for the filtered window, restrict best-rate calc to that currency.
        // Otherwise picking min across mixed currencies is meaningless ($100 < €1000 numerically but not value-wise).
        var fCounts = {};
        filtered.forEach(function(r){ var c = r.currency || 'USD'; fCounts[c] = (fCounts[c]||0)+1; });
        var fCurs = Object.keys(fCounts);
        var bestCurrency = fCurs.length > 0
          ? fCurs.reduce(function(a,b){ return fCounts[a] > fCounts[b] ? a : b; })
          : 'USD';
        var filteredPrimary = filtered.filter(function(r){ return (r.currency || 'USD') === bestCurrency; });
        var bestRate = filteredPrimary.length > 0 ? filteredPrimary.reduce((a,b) => (a.rate_amount||Infinity) < (b.rate_amount||Infinity) ? a : b) : null;
        var expiredCount = filtered.filter(r => isExpired(r.expiry_date)).length;
        var bookedCount = filtered.filter(r => r.booked).length;
        // v55.33 — sort filtered by date ascending to compute per-row Δ vs prev
        // for the same vendor + line + container + currency combination.
        var sortedByDate = filtered.slice().sort(function(a,b){ return (a.effective_date||'').localeCompare(b.effective_date||''); });
        var deltas = {};
        sortedByDate.forEach(function(r){
          var key = (r.vendor_name||'') + '|' + (r.shipping_line||'') + '|' + (r.container_type||'') + '|' + (r.currency||'USD');
          var prevSameKey = sortedByDate.filter(function(p){
            var pKey = (p.vendor_name||'') + '|' + (p.shipping_line||'') + '|' + (p.container_type||'') + '|' + (p.currency||'USD');
            return pKey === key && (p.effective_date||'') < (r.effective_date||'');
          });
          if (prevSameKey.length > 0) {
            var prev = prevSameKey[prevSameKey.length - 1];
            var diff = Number(r.rate_amount||0) - Number(prev.rate_amount||0);
            var pct = prev.rate_amount ? (diff / prev.rate_amount) * 100 : null;
            deltas[r.id] = { diff: diff, pct: pct, prevRate: prev.rate_amount, prevDate: prev.effective_date };
          }
        });
        return (<>
        {bestRate && <div className="bg-emerald-50 rounded-lg px-3 py-2 mb-2 border border-emerald-200 flex justify-between items-center">
          <span className="text-[10px] font-bold text-emerald-700">🏆 Best rate in period ({bestCurrency}): {bestRate.vendor_name} {bestRate.shipping_line ? '/ '+bestRate.shipping_line : ''}</span>
          <span className="text-sm font-extrabold text-emerald-600">{fCur(bestRate.rate_amount, bestRate.currency)} <span className="text-[10px] font-normal">({bestRate.effective_date})</span></span>
        </div>}
      <div className="overflow-auto max-h-[420px] rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10"><tr className="bg-slate-50">
            <th className="px-2 py-2 text-[10px] text-left">Date</th>
            <th className="px-2 py-2 text-[10px] text-left">Vendor / Forwarder</th>
            <th className="px-2 py-2 text-[10px] text-left">Shipping Line</th>
            <th className="px-2 py-2 text-[10px]">Container</th>
            {/* v55.63 — surface port + transit + free-time data inline so you
                don't have to hunt for them in the edit modal. */}
            <th className="px-2 py-2 text-[10px] text-left" title="Port of Loading">POL</th>
            <th className="px-2 py-2 text-[10px] text-left" title="Port of Discharge">POD</th>
            <th className="px-2 py-2 text-[10px] text-center" title="Estimated Time of Departure (effective date)">ETD</th>
            <th className="px-2 py-2 text-[10px] text-center" title="Transit Time in days">TT</th>
            <th className="px-2 py-2 text-[10px] text-center" title="Free Time / free days at destination">FT</th>
            <th className="px-2 py-2 text-[10px] text-right">Rate</th>
            <th className="px-2 py-2 text-[10px] text-right">Δ vs prev</th>
            <th className="px-2 py-2 text-[10px] text-right">Total</th>
            <th className="px-2 py-2 text-[10px] text-left">Status</th>
            <th className="px-2 py-2 text-[10px] text-left">Booked</th>
            <th className="px-2 py-2 text-[10px]"></th>
          </tr></thead>
          <tbody>{filtered.map(r => {
            const exp = isExpired(r.expiry_date);
            const isBest = bestRate && r.id === bestRate.id;
            const dlt = deltas[r.id];
            return (<tr key={r.id} className={'border-b border-slate-50 ' + (isBest ? 'bg-emerald-50 ' : exp ? 'bg-slate-50 ' : '') + (r.booked ? ' bg-green-50' : '')}>
              <td className="px-2 py-1.5">{r.effective_date}</td>
              <td className="px-2 py-1.5 font-semibold">{isBest && <span className="text-emerald-500 mr-1">★</span>}{r.vendor_name}</td>
              <td className="px-2 py-1.5">{r.shipping_line || '—'}</td>
              <td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{r.container_type}</span></td>
              {/* v55.63 — POL / POD / ETD / TT / FT inline. */}
              <td className="px-2 py-1.5 text-[10px]">{r.port_of_loading || <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-[10px]">{r.port_of_discharge || <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-center text-[10px] text-violet-600">{r.effective_date || <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-center text-[10px]">{r.transit_days != null ? <span className="font-semibold text-sky-700">{r.transit_days}d</span> : <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-center text-[10px]">{r.free_days != null ? <span className="font-semibold text-amber-700">{r.free_days}d</span> : <span className="text-slate-300">—</span>}</td>
              <td className={'px-2 py-1.5 text-right font-bold ' + (exp ? 'text-slate-500' : 'text-blue-600')}>{fCur(r.rate_amount, r.currency)}</td>
              <td className="px-2 py-1.5 text-right text-[10px]" title={dlt ? ('Previous: ' + fCur(dlt.prevRate, r.currency) + ' on ' + dlt.prevDate) : 'No prior rate for this vendor + line + container + currency'}>
                {dlt
                  ? (<span className={dlt.diff > 0 ? 'text-red-600 font-semibold' : dlt.diff < 0 ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                      {dlt.diff > 0 ? '▲' : dlt.diff < 0 ? '▼' : '='} {fCur(Math.abs(dlt.diff), r.currency)}
                      {dlt.pct !== null && <span className="ml-1 text-[9px]">({dlt.pct > 0 ? '+' : ''}{dlt.pct.toFixed(1)}%)</span>}
                    </span>)
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className={'px-2 py-1.5 text-right font-bold ' + (exp ? 'text-slate-500' : 'text-amber-800')}>{fCur(r.total_cost, r.currency)}</td>
              <td className="px-2 py-1.5">
                {exp
                  ? <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[9px] font-bold" title={'Expired ' + (r.expiry_date || '')}>EXPIRED</span>
                  : <ExpiryBadge date={r.expiry_date} />}
              </td>
              <td className="px-2 py-1.5">
                {r.booked
                  ? <div className="flex flex-col">
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold w-fit">✓ BOOKED</span>
                      {r.shipment_reference && <span className="text-[9px] text-slate-500 mt-0.5">Ref: {r.shipment_reference}</span>}
                      {r.booking_date && <span className="text-[9px] text-slate-500">{r.booking_date}</span>}
                    </div>
                  : <span className="text-[9px] text-slate-500">—</span>}
              </td>
              <td className="px-2 py-1.5 flex gap-1">
                {!exp && !r.booked && <button onClick={() => handleMarkBooked(r)} className="px-2 py-0.5 rounded border border-green-300 text-green-600 text-[10px]">Book</button>}
                <button onClick={() => { setEditingRate(r); setF({ origin: r.origin, destination: r.destination, vendorName: r.vendor_name, shippingLine: r.shipping_line, transportMode: r.transport_mode, rateType: r.rate_type || '', containerType: r.container_type, rateAmount: r.rate_amount, currency: r.currency, transitDays: r.transit_days, freeDays: r.free_days, portFees: r.port_fees, thcFees: r.thc_fees, docFees: r.documentation_fees, customsFees: r.customs_fees, otherFees: r.other_fees, otherFeesDesc: r.other_fees_desc, effectiveDate: r.effective_date, expiryDate: r.expiry_date, pol: r.port_of_loading, pod: r.port_of_discharge, notes: r.notes, booked: r.booked, shipmentRef: r.shipment_reference, bookingDate: r.booking_date, bookingNotes: r.booking_notes }); setView('add_rate'); }} className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]">Edit</button>
                {isAdmin && <button onClick={() => handleDeleteRate(r)} className="px-2 py-0.5 rounded border border-red-300 text-red-500 text-[10px]" title="Danger: deletes historical pricing data">Del</button>}
              </td>
            </tr>);
          })}</tbody>
        </table>
      </div>
      <div className="text-[10px] text-slate-500 mt-1 flex gap-4">
        <span>Showing <strong>{filtered.length}</strong> of {routeHistory.length} rates</span>
        {expiredCount > 0 && <span className="text-red-600">• {expiredCount} expired (preserved for history)</span>}
        {bookedCount > 0 && <span className="text-green-600">• {bookedCount} booked</span>}
      </div>
      </>); })()}</div>
      {previewQuote && <QuotePrintView quote={previewQuote} onClose={() => setPreviewQuote(null)} />}
      {requestQuoteData && <RequestQuoteModal data={requestQuoteData} onClose={()=>setRequestQuoteData(null)} origins={origins} destinations={destinations} openWhatsApp={openWhatsApp} openEmail={openEmail} generateQuoteRequest={generateQuoteRequest} userId={myId} allVendors={vendorContacts} />}

      {/* Booking Modal */}
      {bookingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setBookingModal(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3">📦 Book Rate — {bookingModal.vendor_name} ({fCur(bookingModal.total_cost||bookingModal.rate_amount, bookingModal.currency)})</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-semibold">Shipment Reference # *</label>
                <input value={f.bookRef||''} onChange={e=>setF({...f,bookRef:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="BL# / Container# / Ref#" /></div>
              <div><label className="text-[10px] font-semibold">Customer Name</label>
                <input value={f.bookCustomer||''} onChange={e=>setF({...f,bookCustomer:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="Who is this booking for?" /></div>
              <div><label className="text-[10px] font-semibold">Order Number</label>
                <input value={f.bookOrder||''} onChange={e=>setF({...f,bookOrder:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="PO# / Order#" /></div>
              <div><label className="text-[10px] font-semibold">Notes</label>
                <input value={f.bookNotes||''} onChange={e=>setF({...f,bookNotes:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="Optional notes" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={confirmBooking} disabled={!f.bookRef} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50">✅ Confirm Booking</button>
              <button onClick={()=>setBookingModal(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Bookings List */}
      {bookings.filter(b => routeHistory.some(r => r.id === b.rate_id)).length > 0 && (
        <div className="bg-white rounded-xl p-4 mt-4 border border-slate-200">
          <h3 className="text-sm font-bold mb-2">📦 Bookings for this route ({bookings.filter(b => routeHistory.some(r => r.id === b.rate_id)).length})</h3>
          <div className="space-y-2">
            {bookings.filter(b => routeHistory.some(r => r.id === b.rate_id)).map(b => {
              const rate = rates.find(r => r.id === b.rate_id);
              return (
                <div key={b.id} className="flex justify-between items-center py-2 px-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div>
                    <div className="text-xs font-bold">📦 {b.shipment_reference}</div>
                    <div className="text-[10px] text-slate-500">
                      {b.customer_name && <span className="font-semibold text-purple-600">{b.customer_name} </span>}
                      {b.order_number && <span>• Order: {b.order_number} </span>}
                      • {b.booking_date} • {rate ? rate.vendor_name : 'Unknown vendor'}
                    </div>
                    {b.notes && <div className="text-[10px] text-slate-500">{b.notes}</div>}
                  </div>
                  {rate && <div className="text-sm font-bold text-emerald-600">{fCur(rate.total_cost || rate.rate_amount, rate.currency)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>);
  }

  // ========== TRENDS (v55.80 — line chart of rates over time per container) ==========
  // Per Max May 8 2026: "create a graph showing how the rates have changed
  // for a 40 footer or a 20 footer over a period of time with a line graph"
  if (view === 'trends') {
    // Build trend data: group by month + container_type, average rates.
    // Default window: last 12 months. Optionally filter by route.
    const TREND_RANGES = [
      { key: '6m',  label: '6 months',  days: 180 },
      { key: '12m', label: '12 months', days: 365 },
      { key: '24m', label: '2 years',   days: 730 },
      { key: 'all', label: 'All time',  days: 99999 },
    ];
    const cutoffDays = trendRange === '6m' ? 180 : trendRange === '24m' ? 730 : trendRange === 'all' ? 99999 : 365;
    const cutoffStr = daysAgoET(cutoffDays);

    // v55.81 (Max May 9 2026): Use expiry_date as the time-axis anchor.
    // Max's logic: "The date should be the historical of when it is from
    // the date of the expiration ... that's what you're using the charts
    // as well." A rate that expired 2024-12-31 was historically valid
    // through that date — that's where the data point goes on the chart.
    // Fall back to effective_date for any row missing expiry_date.
    const dateAnchor = function (r) { return r.expiry_date || r.effective_date || ''; };

    // Filter rates by date + optional route + currency
    const trendRates = rates.filter(r => {
      var anchor = dateAnchor(r);
      if (!anchor || anchor < cutoffStr) return false;
      if (trendCurrency !== 'all' && (r.currency || 'USD') !== trendCurrency) return false;
      if (trendOrigin !== 'all' && r.origin !== trendOrigin) return false;
      if (trendDest !== 'all' && r.destination !== trendDest) return false;
      return true;
    });

    // Group by year-month, then by container type. Average rate per group.
    // Container types of interest: 20' GP, 40' GP, 40' HC. Other types
    // pooled into "Other".
    const TARGETS = ["20' GP", "40' GP", "40' HC"];
    const byMonth = {};   // { 'YYYY-MM': { "20' GP": [rate, rate, ...], ... } }
    trendRates.forEach(r => {
      const ym = dateAnchor(r).substring(0, 7);
      if (!ym) return;
      let ct = r.container_type || '40ft';
      // Map legacy values to the TARGETS list
      const ctLower = ct.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (ctLower.includes('20') && (ctLower.includes('gp') || ctLower === '20' || ctLower.includes('20ft'))) ct = "20' GP";
      else if (ctLower.includes('40') && (ctLower.includes('hc') || ctLower.includes('hq'))) ct = "40' HC";
      else if (ctLower.includes('40') && (ctLower.includes('gp') || ctLower === '40' || ctLower.includes('40ft'))) ct = "40' GP";
      if (!byMonth[ym]) byMonth[ym] = {};
      if (!byMonth[ym][ct]) byMonth[ym][ct] = [];
      byMonth[ym][ct].push(Number(r.rate_amount) || 0);
    });

    // Convert to chart-friendly array: [{month: '2024-01', "20' GP": 1500, "40' GP": 2200, "40' HC": 2400}, ...]
    const trendData = Object.keys(byMonth).sort().map(ym => {
      const point = { month: ym };
      TARGETS.forEach(ct => {
        const vals = byMonth[ym][ct];
        if (vals && vals.length > 0) {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          point[ct] = Math.round(avg);
        }
      });
      return point;
    });

    // Per-container summary (latest, oldest, % change)
    const summaryByCT = TARGETS.map(ct => {
      const allWithCT = trendData.filter(p => p[ct] != null);
      if (allWithCT.length === 0) return { ct, latest: null, oldest: null, change: null, count: 0 };
      const latest = allWithCT[allWithCT.length - 1][ct];
      const oldest = allWithCT[0][ct];
      const change = oldest > 0 ? Math.round(((latest - oldest) / oldest) * 100) : null;
      return { ct, latest, oldest, change, count: allWithCT.length };
    });

    return (<div>
      <button onClick={() => setView('routes')} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
      <h2 className="text-xl font-extrabold mb-1">📈 Rate Trends</h2>
      <p className="text-xs text-slate-500 mb-4">How shipping rates have changed over time. Each line is a container size; each point is the average rate that month, anchored to the rate's <strong>expiration date</strong> (when it was last valid).</p>

      {/* v55.80 — Trends view also has Bubble (chart) vs Detail (table) toggle */}
      <div className="flex items-center gap-1 mb-3 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTrendsViewMode('chart')}
          className={'px-3 py-1.5 rounded text-xs font-bold transition ' + (trendsViewMode === 'chart' ? 'bg-white text-pink-700 shadow' : 'text-slate-500 hover:text-slate-700')}
          title="Show as line chart">
          📈 Chart View
        </button>
        <button
          onClick={() => setTrendsViewMode('table')}
          className={'px-3 py-1.5 rounded text-xs font-bold transition ' + (trendsViewMode === 'table' ? 'bg-white text-pink-700 shadow' : 'text-slate-500 hover:text-slate-700')}
          title="Show monthly average prices as a table">
          📋 Table View
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-4 items-center">
        <div className="flex gap-1">
          {TREND_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setTrendRange(r.key)}
              className={'px-3 py-1 rounded text-xs font-semibold ' + (trendRange === r.key ? 'bg-pink-500 text-white' : 'bg-white border border-slate-200 text-slate-700')}
            >
              {r.label}
            </button>
          ))}
        </div>
        <select value={trendOrigin} onChange={e => setTrendOrigin(e.target.value)} className="px-2 py-1 rounded border text-xs">
          <option value="all">All Origin Countries</option>
          {origins.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={trendDest} onChange={e => setTrendDest(e.target.value)} className="px-2 py-1 rounded border text-xs">
          <option value="all">All Destinations</option>
          {destinations.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={trendCurrency} onChange={e => setTrendCurrency(e.target.value)} className="px-2 py-1 rounded border text-xs">
          <option value="all">All Currencies</option>
          {Array.from(new Set(rates.map(r => r.currency || 'USD'))).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-[10px] text-slate-500 ml-auto">{trendRates.length} of {rates.length} rates in window</span>
      </div>

      {/* Per-container summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {summaryByCT.map(s => {
          const tone = s.change == null ? 'text-slate-500' : s.change > 0 ? 'text-red-600' : s.change < 0 ? 'text-emerald-600' : 'text-slate-700';
          const arrow = s.change == null ? '' : s.change > 0 ? '↑' : s.change < 0 ? '↓' : '→';
          return (
            <div key={s.ct} className="bg-white rounded-lg p-3 border border-slate-200">
              <div className="text-[11px] text-slate-500 font-semibold">{s.ct}</div>
              <div className="text-lg font-extrabold">
                {s.latest != null ? s.latest.toLocaleString() : '—'}
                <span className={'text-xs ml-2 ' + tone}>{arrow} {s.change != null ? Math.abs(s.change) + '%' : 'no data'}</span>
              </div>
              <div className="text-[10px] text-slate-500">
                {s.count > 0 ? s.count + ' month' + (s.count === 1 ? '' : 's') + ' of data' : 'no rates in window'}
              </div>
            </div>
          );
        })}
      </div>

      {/* The chart itself */}
      {trendData.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center border">
          <div className="text-4xl mb-2">📉</div>
          <p className="text-sm text-slate-400">No rates in this window. Try widening the range or removing filters.</p>
        </div>
      ) : trendsViewMode === 'chart' ? (
        <div className="bg-white rounded-xl p-4 border" style={{height: 380}}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RTooltip />
              <RLegend />
              <Line type="monotone" dataKey="20' GP" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="40' GP" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="40' HC" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        // v55.80 — Table mode: same data, shown as a sortable monthly grid.
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-auto" style={{maxHeight: '60vh'}}>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Month</th>
                  <th className="px-3 py-2 text-right font-semibold text-sky-700">20' GP</th>
                  <th className="px-3 py-2 text-right font-semibold text-emerald-700">40' GP</th>
                  <th className="px-3 py-2 text-right font-semibold text-purple-700">40' HC</th>
                </tr>
              </thead>
              <tbody>
                {trendData.slice().reverse().map(point => (
                  <tr key={point.month} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-bold">{point.month}</td>
                    <td className="px-3 py-2 text-right">{point["20' GP"] != null ? point["20' GP"].toLocaleString() : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-right">{point["40' GP"] != null ? point["40' GP"].toLocaleString() : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-right">{point["40' HC"] != null ? point["40' HC"].toLocaleString() : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-500 mt-3 text-center">
        Data points anchored to expiration date • average rate per month per container type • {trendCurrency === 'all' ? 'mixed currencies' : trendCurrency + ' only'}
      </p>
    </div>);
  }

  // ========== IMPORT ==========
  if (view === 'import') return (<div>
    <button onClick={()=>{setView('routes');setImportData([]);setImportStep('select');setImportRawRows([]);setImportHeaders([]);setImportContainerCols([]);}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
    <h2 className="text-xl font-extrabold mb-3">Import Shipping Rates</h2>
    {importStep==='select'&&<div className="bg-white rounded-xl p-6 text-center border-2 border-dashed border-blue-300">
      <div className="text-4xl mb-2">📁</div>
      <p className="text-sm font-bold mb-2">Upload shipping rates spreadsheet</p>
      <p className="text-[10px] text-slate-500 mb-1">Auto-detects columns by name (any order). Supports:</p>
      <div className="text-[9px] text-slate-500 mb-3 leading-relaxed">
        <span className="font-semibold text-slate-500">Origin/Destination:</span> Origin, From, Destination, To, POL, POD, Port of Loading, Port of Discharge<br/>
        <span className="font-semibold text-slate-500">Shipping:</span> Vendor, Forwarder, Shipping Line, Carrier, Container, Container Type/Size<br/>
        <span className="font-semibold text-slate-500">Pricing:</span> Rate, Price, Amount, Freight, Port Fees, THC, Doc Fees, Customs<br/>
        <span className="font-semibold text-slate-500">Timing:</span> Transit Days, Free Days, Date, Effective, Expiry, Valid Until
      </div>
      <label className="px-6 py-3 bg-blue-500 text-white rounded-lg text-sm font-semibold cursor-pointer inline-block">Select File<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async(e)=>{if(e.target.files[0])await processImportFile(e.target.files[0]);}}/></label>
      {/* v55.44 — COMPREHENSIVE TEMPLATE. Includes EVERY field the importer
           reads + clearly-named example rows. The previous template only had
           14 columns and was missing transport_mode, all fees columns, and
           Other Fees Description. With this template the user always knows
           what gets pulled in. */}
      <button onClick={() => {
        const headers = [
          'Origin',
          'Destination',
          'Port of Loading (POL)',
          'Port of Discharge (POD)',
          'Vendor / Forwarder',
          'Shipping Line / Carrier',
          'Transport Mode',
          'Container Type',
          'Rate Amount',
          'Currency',
          'Effective Date',
          'Expiry Date',
          'Transit Days',
          'Free Days',
          'Port Fees',
          'THC Fees',
          'Documentation Fees',
          'Customs Fees',
          'Other Fees',
          'Other Fees Description',
          'Notes',
        ];
        const examples = [
          ['China',   'Egypt', 'Shanghai', 'Alexandria', 'MSC Egypt',     'MSC',       'Ocean', "40' HC", 2850, 'USD', '2025-03-01', '2025-04-30', 28, 14,  85, 320, 50, 0,    0,   '',           'Direct service'],
          ['Turkey',  'Egypt', 'Mersin',   'Alexandria', 'ZIM',           'ZIM',       'Ocean', "40' HC", 1200, 'USD', '2025-03-15', '2025-06-15', 8,  14,  60, 280, 45, 0,    0,   '',           'Weekly sailing'],
          ['China',   'USA',   'Ningbo',   'Los Angeles','OOCL Shipping', 'OOCL',      'Ocean', "20' GP", 1850, 'USD', '2025-04-01', '2025-05-31', 18, 7,   75, 240, 50, 120,  35,  'BAF',        'Includes BAF'],
          ['Italy',   'Egypt', 'Genoa',    'Alexandria', 'Express Cargo', 'Hapag',     'Ocean', "40' HC", 1450, 'EUR', '2025-04-10', '2025-07-10', 6,  10,  55, 220, 40, 0,    25,  'ISPS',       ''],
        ];
        const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
        // Column widths
        ws['!cols'] = [
          {wch:12},{wch:12},{wch:18},{wch:18},{wch:18},{wch:16},{wch:14},{wch:14},
          {wch:12},{wch:10},{wch:14},{wch:14},{wch:12},{wch:10},
          {wch:12},{wch:12},{wch:18},{wch:14},{wch:12},{wch:22},{wch:24},
        ];
        const twb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(twb, ws, 'Rates Template');
        // Add a second sheet with field instructions so users know what each
        // column expects. This is the "show the template complete" Max asked for.
        const instructions = [
          ['Field', 'Required?', 'Example', 'Notes'],
          ['Origin', 'Yes (or POL)', 'China', 'Country or main hub'],
          ['Destination', 'Yes (or POD)', 'Egypt', 'Country or main hub'],
          ['Port of Loading (POL)', 'Recommended', 'Shanghai', 'Specific port name'],
          ['Port of Discharge (POD)', 'Recommended', 'Alexandria', 'Specific port name'],
          ['Vendor / Forwarder', 'Yes', 'MSC Egypt', 'The freight forwarder you book through'],
          ['Shipping Line / Carrier', 'No', 'MSC', 'The actual ocean carrier (separate from forwarder)'],
          ['Transport Mode', 'No', 'Ocean', 'Ocean / Trucking / Air / Multi-modal — defaults to Ocean'],
          ['Container Type', 'Yes', "40' HC", "20' GP, 40' GP, 40' HC, 45' HC, 20' RF, 40' RF"],
          ['Rate Amount', 'Yes', '2850', 'Number only — main freight cost'],
          ['Currency', 'No', 'USD', 'USD / EUR / EGP — defaults to USD'],
          ['Effective Date', 'No', '2025-03-01', 'YYYY-MM-DD — defaults to today'],
          ['Expiry Date', 'Recommended', '2025-04-30', 'YYYY-MM-DD — when the rate expires'],
          ['Transit Days', 'No', '28', 'Number of days door-to-door'],
          ['Free Days', 'No', '14', 'Free demurrage / detention days'],
          ['Port Fees', 'No', '85', 'Local port handling charges'],
          ['THC Fees', 'No', '320', 'Terminal Handling Charges'],
          ['Documentation Fees', 'No', '50', 'BL / paperwork fees'],
          ['Customs Fees', 'No', '0', 'Customs clearance (often charged separately)'],
          ['Other Fees', 'No', '0', 'Surcharges (BAF, CAF, ISPS, etc.)'],
          ['Other Fees Description', 'No', 'BAF', 'Label for the Other Fees value'],
          ['Notes', 'No', 'Weekly sailing', 'Free-text notes'],
        ];
        const wsInst = XLSX.utils.aoa_to_sheet(instructions);
        wsInst['!cols'] = [{wch:24},{wch:14},{wch:18},{wch:50}];
        XLSX.utils.book_append_sheet(twb, wsInst, 'Field Guide');
        XLSX.writeFile(twb, 'Shipping-Rates-Import-Template.xlsx');
      }} className="ml-2 px-4 py-3 bg-slate-100 text-slate-600 rounded-lg text-sm font-semibold cursor-pointer inline-block hover:bg-slate-200">📄 Download Full Template</button>
      <p className="text-[9px] text-slate-500 mt-2">Template has 21 columns covering rates, dates, fees + a Field Guide sheet</p>
    </div>}
    {importStep==='preview'&&importData.length>0&&(()=>{
      const zeroRateCount = importData.filter(r => !r.rate_amount || Number(r.rate_amount) === 0).length;
      const noDateCount = importData.filter(r => !r.effective_date).length;
      const noExpiryCount = importData.filter(r => !r.expiry_date).length;
      // v55.80 — Surface how many rows are historical / already expired
      // BEFORE the user clicks Import, so they know what's getting saved.
      const todayStrPv = todayET();
      const expiredCount = importData.filter(r => r.expiry_date && r.expiry_date < todayStrPv).length;
      const historicalCount = importData.filter(r => r.effective_date && r.effective_date < todayStrPv).length;
      // Field name → human label for the remap UI. Order matches importance.
      const FIELD_LABELS = [
        ['origin', 'Origin'],
        ['destination', 'Destination'],
        ['pol', 'Port of Loading'],
        ['pod', 'Port of Discharge'],
        ['vendor', 'Vendor'],
        ['line', 'Shipping Line'],
        ['mode', 'Transport Mode'],
        ['container', 'Container Type'],
        ['rate', 'Rate Amount'],
        ['currency', 'Currency'],
        ['date', 'Effective Date'],
        ['expiry', 'Expiry Date'],
        ['transit', 'Transit Days'],
        ['free', 'Free Days'],
        ['portFees', 'Port Fees'],
        ['thc', 'THC Fees'],
        ['docFees', 'Documentation Fees'],
        ['customsFees', 'Customs Fees'],
        ['otherFees', 'Other Fees'],
        ['notes', 'Notes'],
      ];
      return (<div>
      {/* SUMMARY + WARNINGS BANNER */}
      <div className={'rounded-xl p-4 mb-3 border ' + (zeroRateCount>0 ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-200')}>
        <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
          <div>
            <span className="text-sm font-bold text-slate-800">Found {importData.length} rate{importData.length!==1?'s':''} ready to import</span>
            {zeroRateCount > 0 && <div className="text-[11px] text-amber-700 font-semibold mt-0.5">⚠️ {zeroRateCount} row{zeroRateCount!==1?'s':''} have rate = 0 — fix or remove them below before importing</div>}
            {noDateCount > 0 && <div className="text-[11px] text-amber-700 font-semibold mt-0.5">⚠️ {noDateCount} row{noDateCount!==1?'s':''} couldn't parse the effective date — they'll save with today's date as a fallback. Check the source data.</div>}
            {noExpiryCount > 0 && <div className="text-[10px] text-slate-500 mt-0.5">{noExpiryCount} row{noExpiryCount!==1?'s':''} missing expiry date — they'll never auto-expire</div>}
            {/* v55.80 — Surface historical / already-expired counts so user knows what they're importing */}
            {historicalCount > 0 && <div className="text-[10px] text-blue-600 mt-0.5">📅 {historicalCount} row{historicalCount!==1?'s':''} have historical effective dates — they'll be saved as-is for trend analysis</div>}
            {expiredCount > 0 && <div className="text-[10px] text-rose-600 mt-0.5">⏰ {expiredCount} row{expiredCount!==1?'s':''} are already expired — kept in the record but won't show as active rates</div>}
          </div>
          <div className="flex gap-2">
            <button onClick={()=>{setImportStep('select');setImportData([]);}} className="px-3 py-1.5 border rounded-lg text-xs">Cancel</button>
            <button onClick={executeImport} className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold">✅ Import All ({importData.length})</button>
          </div>
        </div>
      </div>

      {/* COLUMN MAPPING — auto-detected, user can override */}
      <div className="bg-white rounded-xl p-3 mb-3 border border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700">Column Mapping</span>
          <span className="text-[9px] text-slate-500">If a column was picked wrong, change it here — the preview updates</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
          {FIELD_LABELS.map(([fld, lbl]) => {
            const isCriticalRate = fld === 'rate';
            const isMissing = !importColMap[fld];
            return (
              <div key={fld} className={'flex flex-col gap-0.5 p-1.5 rounded ' + (isCriticalRate ? 'bg-blue-50' : isMissing ? 'bg-slate-50' : '')}>
                <label className={'text-[9px] font-semibold ' + (isCriticalRate ? 'text-blue-700' : 'text-slate-500')}>
                  {lbl}{isCriticalRate ? ' ⭐' : ''}
                </label>
                <select
                  value={importColMap[fld] || ''}
                  onChange={e => {
                    const nv = e.target.value || null;
                    const next = Object.assign({}, importColMap, { [fld]: nv });
                    reparseFromMapping(next);
                  }}
                  className={'px-1.5 py-1 border rounded text-[10px] bg-white ' + (isMissing && !isCriticalRate ? 'border-slate-200 text-slate-500' : isCriticalRate && isMissing ? 'border-red-300 text-red-600' : 'border-slate-300')}
                >
                  <option value="">— not mapped —</option>
                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* PREVIEW TABLE — every cell editable. Tap any cell to fix it before
          import. Zero-rate rows highlighted red. */}
      <div className="overflow-auto max-h-[480px] rounded-lg border bg-white text-xs">
        <table className="w-full border-collapse">
          <thead><tr className="bg-slate-50 sticky top-0 z-10">
            <th className="px-2 py-1.5 text-[10px]">#</th>
            <th className="px-2 py-1.5 text-[10px]">Origin</th>
            <th className="px-2 py-1.5 text-[10px]">Dest</th>
            <th className="px-2 py-1.5 text-[10px]">POL</th>
            <th className="px-2 py-1.5 text-[10px]">POD</th>
            <th className="px-2 py-1.5 text-[10px]">Vendor</th>
            <th className="px-2 py-1.5 text-[10px]">Line</th>
            <th className="px-2 py-1.5 text-[10px]">Mode</th>
            <th className="px-2 py-1.5 text-[10px]">Container</th>
            <th className="px-2 py-1.5 text-[10px] text-right bg-blue-50">Rate ⭐</th>
            <th className="px-2 py-1.5 text-[10px]">Curr</th>
            <th className="px-2 py-1.5 text-[10px]">Effective</th>
            <th className="px-2 py-1.5 text-[10px]">Expiry</th>
            <th className="px-2 py-1.5 text-[10px]">Transit</th>
            <th className="px-2 py-1.5 text-[10px]">Free</th>
            <th className="px-2 py-1.5 text-[10px] text-right">Port</th>
            <th className="px-2 py-1.5 text-[10px] text-right">THC</th>
            <th className="px-2 py-1.5 text-[10px] text-right">Doc</th>
            <th className="px-2 py-1.5 text-[10px] text-right">Customs</th>
            <th className="px-2 py-1.5 text-[10px] text-right">Other</th>
            <th className="px-2 py-1.5 text-[10px] text-right bg-emerald-50">Total</th>
            <th className="px-2 py-1.5 text-[10px]"></th>
          </tr></thead>
          <tbody>{importData.slice(0,100).map((r,i)=>{
            const isZero = !r.rate_amount || Number(r.rate_amount) === 0;
            const cellInput = 'w-full px-1 py-0.5 border-0 bg-transparent text-[10px] focus:bg-yellow-50 focus:outline-1 outline-blue-400';
            return (
            <tr key={i} className={'border-b border-slate-50 hover:bg-slate-50 ' + (isZero ? 'bg-red-50' : '')}>
              <td className="px-2 py-0.5 text-[9px] text-slate-500">{i+1}</td>
              <td className="px-1"><input value={r.origin||''} onChange={e=>updateImportRow(i,'origin',e.target.value)} className={cellInput} /></td>
              <td className="px-1"><input value={r.destination||''} onChange={e=>updateImportRow(i,'destination',e.target.value)} className={cellInput} /></td>
              <td className="px-1"><input value={r.port_of_loading||''} onChange={e=>updateImportRow(i,'port_of_loading',e.target.value)} className={cellInput+' text-slate-500'} /></td>
              <td className="px-1"><input value={r.port_of_discharge||''} onChange={e=>updateImportRow(i,'port_of_discharge',e.target.value)} className={cellInput+' text-slate-500'} /></td>
              <td className="px-1"><input value={r.vendor_name||''} onChange={e=>updateImportRow(i,'vendor_name',e.target.value)} className={cellInput} /></td>
              <td className="px-1"><input value={r.shipping_line||''} onChange={e=>updateImportRow(i,'shipping_line',e.target.value)} className={cellInput} /></td>
              <td className="px-1"><input value={r.transport_mode||''} onChange={e=>updateImportRow(i,'transport_mode',e.target.value)} className={cellInput} /></td>
              <td className="px-1"><input value={r.container_type||''} onChange={e=>updateImportRow(i,'container_type',e.target.value)} className={cellInput+' font-semibold'} /></td>
              <td className={'px-1 ' + (isZero ? 'bg-red-100' : 'bg-blue-50/50')}><input type="number" step="0.01" value={r.rate_amount||0} onChange={e=>updateImportRow(i,'rate_amount',Number(e.target.value)||0)} className={cellInput+' text-right font-bold ' + (isZero ? 'text-red-600' : '')} /></td>
              <td className="px-1"><input value={r.currency||'USD'} onChange={e=>updateImportRow(i,'currency',e.target.value.toUpperCase().slice(0,3))} className={cellInput+' uppercase text-center'} maxLength="3" /></td>
              <td className="px-1"><input type="date" value={r.effective_date||''} onChange={e=>updateImportRow(i,'effective_date',e.target.value)} className={cellInput} /></td>
              <td className="px-1"><input type="date" value={r.expiry_date||''} onChange={e=>updateImportRow(i,'expiry_date',e.target.value||null)} className={cellInput} /></td>
              <td className="px-1"><input type="number" value={r.transit_days||''} placeholder="—" onChange={e=>updateImportRow(i,'transit_days',e.target.value?Number(e.target.value):null)} className={cellInput+' text-right'} /></td>
              <td className="px-1"><input type="number" value={r.free_days||''} placeholder="—" onChange={e=>updateImportRow(i,'free_days',e.target.value?Number(e.target.value):null)} className={cellInput+' text-right'} /></td>
              <td className="px-1"><input type="number" step="0.01" value={r.port_fees||0} onChange={e=>updateImportRow(i,'port_fees',Number(e.target.value)||0)} className={cellInput+' text-right'} /></td>
              <td className="px-1"><input type="number" step="0.01" value={r.thc_fees||0} onChange={e=>updateImportRow(i,'thc_fees',Number(e.target.value)||0)} className={cellInput+' text-right'} /></td>
              <td className="px-1"><input type="number" step="0.01" value={r.documentation_fees||0} onChange={e=>updateImportRow(i,'documentation_fees',Number(e.target.value)||0)} className={cellInput+' text-right'} /></td>
              <td className="px-1"><input type="number" step="0.01" value={r.customs_fees||0} onChange={e=>updateImportRow(i,'customs_fees',Number(e.target.value)||0)} className={cellInput+' text-right'} /></td>
              <td className="px-1"><input type="number" step="0.01" value={r.other_fees||0} onChange={e=>updateImportRow(i,'other_fees',Number(e.target.value)||0)} className={cellInput+' text-right'} /></td>
              <td className="px-2 py-0.5 text-right font-bold bg-emerald-50/50 text-emerald-700">{fCur(r.total_cost||0, r.currency)}</td>
              <td className="px-1 text-center">
                <button onClick={()=>removeImportRow(i)} title="Remove this row from import" className="text-red-400 hover:text-red-600 text-xs">✕</button>
              </td>
            </tr>
          );})}</tbody>
        </table>
        {importData.length>100&&<div className="text-center py-2 text-[10px] text-slate-500">Showing 100 of {importData.length} — all rows will be imported</div>}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">💡 Tap any cell to edit. Red rows have rate = 0. Click ✕ to drop a row before importing.</p>
    </div>);})()}
    {importStep==='importing'&&(
      <div className="bg-white rounded-xl p-8 text-center">
        <div className="text-4xl mb-3 animate-pulse">⏳</div>
        <div className="w-full bg-slate-200 rounded-full h-3 mb-2">
          <div className="bg-blue-500 h-3 rounded-full transition-all" style={{width: importProgress + '%'}}></div>
        </div>
        <p className="text-sm font-bold text-slate-700">{importProgress}%</p>
        {importStatus && <p className="text-xs text-slate-500 mt-2">{importStatus}</p>}
        {/* v55.81 — Cancel button so user is never stuck if something hangs.
            Also a "30 sec timeout per call" reassurance so they know the
            import won't run forever silently. */}
        <p className="text-[10px] text-slate-500 mt-3 italic">Each step has a 30-second timeout — won't run forever.</p>
        <button
          onClick={() => {
            if (confirm('Cancel the import? Rows already saved will stay in the database.')) {
              setImportStep('preview');
              setImportStatus('');
              setImportProgress(0);
            }
          }}
          className="mt-3 px-4 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    )}
    {importStep==='done'&&<div className="bg-white rounded-xl p-8 text-center"><div className="text-4xl mb-3">✅</div><h3 className="text-lg font-bold text-emerald-700">Done!</h3><button onClick={()=>{setView('routes');setImportData([]);setImportStep('select');setImportRawRows([]);setImportHeaders([]);setImportContainerCols([]);}} className="mt-3 px-6 py-2 bg-blue-500 text-white rounded-lg font-semibold">Done</button></div>}
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
        <button onClick={()=>setView('trends')} className="px-3 py-1.5 bg-pink-500 text-white rounded-lg text-xs font-semibold">📈 Trends</button>
        <button onClick={()=>setView('ai')} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold">🤖 AI</button>
        <button onClick={()=>setView('vendors')} className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-semibold">📇 Vendors</button>
        <button onClick={()=>{setRequestQuoteData({vendor:null,origin:'',destination:'Egypt',container:'40ft'});}} className="px-3 py-1.5 bg-cyan-500 text-white rounded-lg text-xs font-semibold">📋 Request Rate</button>
      </div>
    </div>
    <div className="grid grid-cols-5 gap-3 mb-4">
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{rates.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Active</div><div className="text-lg font-extrabold text-emerald-600">{rates.filter(r=>!isExpired(r.expiry_date)).length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Expired</div><div className="text-lg font-extrabold text-red-500">{rates.filter(r=>isExpired(r.expiry_date)).length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Routes</div><div className="text-lg font-extrabold">{routeGroups.length}</div></div>
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Bookings</div><div className="text-lg font-extrabold">{bookings.length}</div></div>
    </div>
    <div className="flex gap-2 mb-3 flex-wrap items-center">
      <select value={filterOrigin} onChange={e=>setFilterOrigin(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Origin Countries</option>{origins.map(o=><option key={o} value={o}>{o}</option>)}</select>
      <select value={filterDest} onChange={e=>setFilterDest(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Destination Countries</option>{destinations.map(d=><option key={d} value={d}>{d}</option>)}</select>
      {/* v55.63 — POL / POD now actually narrow results AND change the
          card grouping so you only see the exact port you picked. */}
      <select value={filterPol} onChange={e=>setFilterPol(e.target.value)} className={'px-2 py-1 rounded border text-xs ' + (filterPol !== 'all' ? 'border-blue-400 bg-blue-50 text-blue-700 font-semibold' : '')}><option value="all">All POL (loading ports)</option>{pols.map(p=><option key={p} value={p}>{p}</option>)}</select>
      <select value={filterPod} onChange={e=>setFilterPod(e.target.value)} className={'px-2 py-1 rounded border text-xs ' + (filterPod !== 'all' ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold' : '')}><option value="all">All POD (discharge ports)</option>{pods.map(p=><option key={p} value={p}>{p}</option>)}</select>
      <select value={filterVendor} onChange={e=>setFilterVendor(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Vendors</option>{vendors.map(v=><option key={v} value={v}>{v}</option>)}</select>
      <select value={filterLine} onChange={e=>setFilterLine(e.target.value)} className="px-2 py-1 rounded border text-xs"><option value="all">All Lines</option>{lines.map(l=><option key={l} value={l}>{l}</option>)}</select>
      {/* v55.81 #17 (Max May 9 2026): three-button toggle replaces the
          dropdown — clearer, faster to scan, and the "Show Historical"
          option is no longer hidden behind a dropdown click. Default is
          Active so daily users see only live rates on first load. The
          "All" mode renders Active rates first, then a clearly-labeled
          "Historical Rates" section below (see #16). v55.81 QA-6: the
          three buttons now go through setFilterExpiryPersist so the
          choice sticks across reloads. */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
        <button
          onClick={function () { setFilterExpiryPersist('active'); }}
          className={'px-3 py-1 rounded text-xs font-bold transition ' + (filterExpiry === 'active' ? 'bg-white text-emerald-700 shadow' : 'text-slate-500 hover:text-slate-700')}
          title="Show only rates whose expiry date is in the future">
          ✅ Active
        </button>
        <button
          onClick={function () { setFilterExpiryPersist('expired'); }}
          className={'px-3 py-1 rounded text-xs font-bold transition ' + (filterExpiry === 'expired' ? 'bg-white text-slate-700 shadow' : 'text-slate-500 hover:text-slate-700')}
          title="Show only historical rates whose expiry date has passed">
          📜 Historical
        </button>
        <button
          onClick={function () { setFilterExpiryPersist('all'); }}
          className={'px-3 py-1 rounded text-xs font-bold transition ' + (filterExpiry === 'all' ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700')}
          title="Show all rates — active first, then historical">
          Both
        </button>
      </div>
      {(filterPol !== 'all' || filterPod !== 'all') && (
        <button
          onClick={() => { setFilterPol('all'); setFilterPod('all'); }}
          className="px-2 py-1 rounded border text-xs text-slate-600 hover:bg-slate-100"
          title="Clear port filters and return to country-level grouping">
          ✕ Clear ports
        </button>
      )}
      {(filterPol !== 'all' || filterPod !== 'all') && (
        <span className="text-[10px] text-emerald-700 font-semibold">
          Showing rates by port only — Damietta vs Alexandria etc. are now separate cards.
        </span>
      )}
    </div>

    {/* v55.66 — Routes / List view toggle. The card grid is the default
        (intuitive at-a-glance browse), the list view is for when you want
        every rate in one sortable, scannable table — back by popular
        demand. The same filtered dataset feeds both views; only the
        rendering changes. Preference persists in localStorage. */}
    {/* v55.80 — Toggle: Bubble view (grouped by route) vs Detail line view
        (one row per rate). Per Max May 8 2026: "Need also toggle to show
        bubble view vs detail line view." Same data feeds both — only the
        rendering changes. Preference persists in localStorage. */}
    <div className="flex items-center gap-1 mb-3 bg-slate-100 rounded-lg p-1 w-fit">
      <button
        onClick={function () { setRoutesViewModePersist('routes'); }}
        className={'px-3 py-1.5 rounded text-xs font-bold transition ' + (routesViewMode === 'routes' ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700')}
        title="Group rates by route — one bubble per origin → destination">
        🫧 Bubble View
      </button>
      <button
        onClick={function () { setRoutesViewModePersist('list'); }}
        className={'px-3 py-1.5 rounded text-xs font-bold transition ' + (routesViewMode === 'list' ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700')}
        title="Show every individual rate as a row in a sortable list">
        📋 Detail Line View ({filtered.length})
      </button>
    </div>

    {/* ROUTES VIEW (the card grid by route) — original layout
        v55.81 #16 + #18 (Max May 9 2026): when filter is "Both" (all),
        Active rates render first, then a clearly-labeled "Historical
        Rates" section below at reduced opacity. When filter is "Active"
        only, historical bucket is empty so only the active grid shows.
        When filter is "Historical" only, active bucket is empty so only
        the historical grid shows. */}
    {routesViewMode === 'routes' && (() => {
      // Local helper that renders one route card. Extracted so we can
      // render Active and Historical sections without duplicating the
      // 14-line card markup. Behaves IDENTICALLY to the previous inline
      // version — only the wrapper changed.
      var renderRouteCard = function (rg) {
        var c = rg.cheapest;
        return (
          <div key={rg.key} onClick={function(){setSelectedRoute({origin:rg.origin,destination:rg.destination,pol:rg.pol||null,pod:rg.pod||null});setView('route_detail');}} className="bg-white rounded-xl p-4 cursor-pointer border border-slate-200 hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex justify-between items-start mb-2"><div><div className="text-sm font-extrabold text-blue-700">{groupByPort && rg.pol ? rg.pol : rg.origin}{groupByPort && rg.pol && rg.origin && rg.pol !== rg.origin && <span className="text-[9px] text-slate-500 font-normal ml-1">({rg.origin})</span>}</div><div className="text-[10px] text-slate-500">↓</div><div className="text-sm font-extrabold text-emerald-700">{groupByPort && rg.pod ? rg.pod : rg.destination}{groupByPort && rg.pod && rg.destination && rg.pod !== rg.destination && <span className="text-[9px] text-slate-500 font-normal ml-1">({rg.destination})</span>}</div></div><div className="text-right">{c?(<><div className="text-[9px] text-slate-500">Best Active</div><div className="text-lg font-extrabold text-emerald-600">{fCur(c.rate_amount,c.currency)}</div><div className="text-[9px] text-blue-500">{c.vendor_name}{c.shipping_line?' / '+c.shipping_line:''}</div><ExpiryBadge date={c.expiry_date}/></>):(<div className="text-xs text-red-400 font-bold">All Expired</div>)}</div></div>
            {/* v55.63 — show TT / FT / ETD on the cheapest active rate when a port
                is picked, so you can compare at a glance without opening the card. */}
            {groupByPort && c && (
              <div className="flex gap-2 flex-wrap text-[10px] mb-2">
                {c.transit_days != null && <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded"><strong>TT:</strong> {c.transit_days}d</span>}
                {c.free_days != null && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded"><strong>FT:</strong> {c.free_days}d</span>}
                {c.effective_date && <span className="px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded"><strong>ETD:</strong> {c.effective_date}</span>}
              </div>
            )}
            <div className="flex gap-1 flex-wrap mb-2">{[...rg.lines].filter(Boolean).map(function(l){return <span key={l} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px]">{l}</span>;})}{[...rg.modes].map(function(m){return <span key={m} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{m}</span>;})}</div>
            <div className="flex justify-between text-[10px] text-slate-500 border-t border-slate-100 pt-2"><span>{rg.activeCount} active{rg.expiredCount>0&&<span className="text-red-400 ml-1">({rg.expiredCount} exp)</span>}</span><span>{[...rg.vendors].length} vendors</span>{(function(){var rb=routeBookings(rg.origin,rg.destination,rg.pol,rg.pod);return rb.length>0&&<span className="text-emerald-600">✓ {rb.length}x</span>;})()}</div>
          </div>
        );
      };

      // Both buckets empty → unified empty state (preserves the original
      // "No rates yet" UX for fresh installs).
      if (activeRouteGroups.length === 0 && historicalRouteGroups.length === 0) {
        return (<div className="bg-white rounded-xl p-8 text-center border"><div className="text-4xl mb-2">🚢</div><p className="text-sm text-slate-400">No rates match your filters</p></div>);
      }

      return (
        <>
          {activeRouteGroups.length > 0 && (
            <div>
              {/* v55.81 #16 + QA-4 (Max May 9 2026): show the header
                  whenever the user is in "Both" mode, even if the
                  historical bucket happens to be empty. Without this,
                  Both mode looks identical to Active mode whenever
                  there are no historical rates — confusing. */}
              {filterExpiry === 'all' && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-extrabold text-emerald-700 uppercase tracking-wide">✅ Active Rates</span>
                  <span className="text-[10px] text-slate-500">({activeRouteGroups.length} {activeRouteGroups.length === 1 ? 'route' : 'routes'} · sorted by destination)</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeRouteGroups.map(renderRouteCard)}
              </div>
            </div>
          )}

          {historicalRouteGroups.length > 0 && (
            <div className={activeRouteGroups.length > 0 ? 'mt-6 pt-5 border-t-2 border-dashed border-slate-200' : ''}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-extrabold text-slate-600 uppercase tracking-wide">📜 Historical Rates</span>
                <span className="text-[10px] text-slate-500">({historicalRouteGroups.length} {historicalRouteGroups.length === 1 ? 'route' : 'routes'} · all rates expired · kept for reference)</span>
              </div>
              {/* v55.81 #18: dimmed at 60% opacity to make the active/historical
                  distinction immediate. Hover restores full opacity so you can
                  still scan the details. */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60 hover:opacity-100 transition-opacity">
                {historicalRouteGroups.map(renderRouteCard)}
              </div>
            </div>
          )}
        </>
      );
    })()}

    {/* v55.66 — LIST VIEW. Every individual rate as a row. Click a row to
        open the same route detail screen the card grid would. Sortable
        columns, expired rates dimmed but visible. */}
    {routesViewMode === 'list' && (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><div className="text-4xl mb-2">🚢</div><p className="text-sm text-slate-400">No rates match your filters</p></div>
        ) : (
          <div className="overflow-auto" style={{maxHeight: '70vh'}}>
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  {[
                    {k:'effective_date', l:'ETD', w:'88px'},
                    {k:'origin', l:'Origin', w:''},
                    {k:'destination', l:'Destination', w:''},
                    {k:'port_of_loading', l:'POL', w:''},
                    {k:'port_of_discharge', l:'POD', w:''},
                    {k:'vendor_name', l:'Vendor', w:''},
                    {k:'shipping_line', l:'Line', w:''},
                    {k:'container_type', l:'Container', w:'70px'},
                    {k:'transit_days', l:'TT', w:'40px', align:'right'},
                    {k:'free_days', l:'FT', w:'40px', align:'right'},
                    {k:'rate_amount', l:'Rate', w:'90px', align:'right'},
                    {k:'expiry_date', l:'Expires', w:'88px'},
                  ].map(function (col) {
                    var active = listSortKey === col.k;
                    return (
                      <th
                        key={col.k}
                        onClick={function () {
                          if (active) { setListSortDir(listSortDir === 'asc' ? 'desc' : 'asc'); }
                          else { setListSortKey(col.k); setListSortDir('desc'); }
                        }}
                        className={'px-2 py-2 text-[10px] font-bold uppercase tracking-wide cursor-pointer hover:bg-slate-100 select-none ' + (col.align === 'right' ? 'text-right' : 'text-left')}
                        style={{minWidth: col.w}}
                        title={'Sort by ' + col.l}>
                        {col.l}
                        {active && <span className="ml-1 text-blue-500">{listSortDir === 'asc' ? '▲' : '▼'}</span>}
                      </th>
                    );
                  })}
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(function () {
                  // v55.81 #16 + #19 (Max May 9 2026): primary sort is
                  // active-first (so historical rows always appear after
                  // active rows), secondary is the user-selected column.
                  // When both buckets exist, a divider row labels each
                  // section. Historical rows are dimmed at 60% opacity
                  // (already in the row className) for visual distinction.
                  // v55.81 QA-12 (Max May 9 2026): divider colSpan is now
                  // computed from LIST_COL_COUNT (defined at the top of
                  // the list view) so adding/removing a column doesn't
                  // visually break the dividers.
                  var LIST_COL_COUNT = 13; // 12 data columns + 1 edit col — matches the <thead> map() above + trailing <th>
                  var sorted = filtered.slice().sort(function (a, b) {
                    var ax = isExpired(a.expiry_date) ? 1 : 0;
                    var bx = isExpired(b.expiry_date) ? 1 : 0;
                    if (ax !== bx) return ax - bx; // active first, always
                    var av = a[listSortKey];
                    var bv = b[listSortKey];
                    if (av == null && bv == null) return 0;
                    if (av == null) return 1;
                    if (bv == null) return -1;
                    var cmp;
                    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
                    else cmp = String(av).localeCompare(String(bv));
                    return listSortDir === 'asc' ? cmp : -cmp;
                  });
                  // Insert a divider row when transitioning from active to
                  // historical (only if BOTH buckets have rows AND the user
                  // is showing both — i.e. filterExpiry === 'all').
                  var rows = [];
                  var activeCount = sorted.filter(function (r) { return !isExpired(r.expiry_date); }).length;
                  var historicalCount = sorted.length - activeCount;
                  var dividerInserted = false;
                  var showDivider = filterExpiry === 'all' && activeCount > 0 && historicalCount > 0;
                  if (showDivider && activeCount > 0) {
                    rows.push(
                      <tr key="hdr-active" className="bg-emerald-50/60 border-t-2 border-emerald-200">
                        <td colSpan={LIST_COL_COUNT} className="px-3 py-2 text-[10px] font-extrabold text-emerald-700 uppercase tracking-wide">✅ Active Rates ({activeCount})</td>
                      </tr>
                    );
                  }
                  sorted.forEach(function (r) {
                    var exp = isExpired(r.expiry_date);
                    if (showDivider && exp && !dividerInserted) {
                      rows.push(
                        <tr key="hdr-historical" className="bg-slate-100 border-t-2 border-slate-300">
                          <td colSpan={LIST_COL_COUNT} className="px-3 py-2 text-[10px] font-extrabold text-slate-700 uppercase tracking-wide">📜 Historical Rates ({historicalCount}) · expired · kept for reference</td>
                        </tr>
                      );
                      dividerInserted = true;
                    }
                    rows.push(
                      <tr
                        key={r.id}
                        onClick={function () { setSelectedRoute({origin: r.origin, destination: r.destination, pol: r.port_of_loading || null, pod: r.port_of_discharge || null}); setView('route_detail'); }}
                        className={'border-t border-slate-100 cursor-pointer hover:bg-blue-50/40 ' + (exp ? 'opacity-60' : '')}>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-violet-600">{r.effective_date || '—'}</td>
                        <td className="px-2 py-1.5 font-semibold text-blue-700">{r.origin || '—'}</td>
                        <td className="px-2 py-1.5 font-semibold text-emerald-700">{r.destination || '—'}</td>
                        <td className="px-2 py-1.5 text-[10px]">{r.port_of_loading || <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-[10px]">{r.port_of_discharge || <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5">{r.vendor_name || <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5">{r.shipping_line || <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{r.container_type || '—'}</span></td>
                        <td className="px-2 py-1.5 text-right text-[10px]">{r.transit_days != null ? <span className="font-semibold text-sky-700">{r.transit_days}d</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-right text-[10px]">{r.free_days != null ? <span className="font-semibold text-amber-700">{r.free_days}d</span> : <span className="text-slate-300">—</span>}</td>
                        <td className={'px-2 py-1.5 text-right font-extrabold ' + (exp ? 'text-slate-500' : 'text-emerald-600')}>{fCur(r.rate_amount, r.currency)}</td>
                        <td className="px-2 py-1.5 text-[10px]"><ExpiryBadge date={r.expiry_date} /></td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            onClick={function (e) { e.stopPropagation(); setEditingRate(r); setF({rateType: r.rate_type, origin: r.origin, destination: r.destination, vendorName: r.vendor_name, shippingLine: r.shipping_line, portOfLoading: r.port_of_loading, portOfDischarge: r.port_of_discharge, containerType: r.container_type, rateAmount: r.rate_amount, currency: r.currency, effectiveDate: r.effective_date, expiryDate: r.expiry_date, transitDays: r.transit_days, freeDays: r.free_days, transportMode: r.transport_mode, notes: r.notes}); setView('add_rate'); }}
                            className="text-[10px] text-blue-600 hover:underline">edit</button>
                        </td>
                      </tr>
                    );
                  });
                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}
    {previewQuote && <QuotePrintView quote={previewQuote} onClose={() => setPreviewQuote(null)} />}
    {requestQuoteData && <RequestQuoteModal data={requestQuoteData} onClose={()=>setRequestQuoteData(null)} origins={origins} destinations={destinations} openWhatsApp={openWhatsApp} openEmail={openEmail} generateQuoteRequest={generateQuoteRequest} userId={myId} allVendors={vendorContacts} />}
  </div>);
}
