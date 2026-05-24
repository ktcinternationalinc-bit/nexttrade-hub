'use client';
import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { notifyShippingRate, notifyShippingBooked } from '../lib/notify';
import { fE, fmt } from '../lib/utils';
import { fmtET, todayET, daysAgoET } from '../lib/et-time';
import EmailComposer from './EmailComposer';
import * as XLSX from 'xlsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend as RLegend, ResponsiveContainer, ComposedChart, Scatter } from 'recharts';
import { parseNumberSmart as _parseNumberSmartShared, parseDate as _parseDateShared, normalizeContainer as _normalizeContainerShared } from '../lib/shipping-import-helpers';

const CONTAINER_TYPES = ['20ft', '40ft', '40ft HC', '45ft', 'LCL', 'Bulk', 'Flatbed', 'Reefer', 'Open Top', 'Truck', 'Trailer'];
const TRANSPORT_MODES = ['Ocean', 'Trucking', 'Air', 'Rail', 'Multi-modal'];
const RATE_TYPES = ['Shipping', 'Trucking', 'Customs/Brokerage'];
const CURRENCIES = ['USD', 'EUR', 'EGP', 'GBP', 'SAR', 'AED', 'CNY', 'TRY'];
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'booked'];

// v55.82-J (Max May 11 2026): country → continent map for the destination
// continent dropdown filter. Lists are not exhaustive — they cover the
// common shipping destinations KTC actually trades to plus everything else
// I could find with a clear continent. Any country we encounter that
// isn't in this map falls into "Other" so the dropdown never hides a route.
// Matching is case-insensitive and uses normalized country names (trimmed,
// punctuation-aware) so "USA", "U.S.A.", "United States", "United States of
// America" all resolve to North America.
const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Other'];
const COUNTRY_TO_CONTINENT = (function () {
  var m = {};
  var add = function (continent, names) {
    names.forEach(function (n) { m[String(n).trim().toLowerCase()] = continent; });
  };
  add('Africa', [
    'Egypt', 'EG', 'مصر', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'Mauritania', 'Sudan', 'South Sudan',
    'Ethiopia', 'Eritrea', 'Djibouti', 'Somalia', 'Kenya', 'Uganda', 'Rwanda', 'Burundi', 'Tanzania',
    'Mozambique', 'Madagascar', 'Mauritius', 'Comoros', 'Seychelles', 'South Africa', 'Namibia',
    'Botswana', 'Zimbabwe', 'Zambia', 'Malawi', 'Angola', 'Congo', 'DRC', 'Democratic Republic of the Congo',
    'Republic of the Congo', 'Gabon', 'Equatorial Guinea', 'Cameroon', 'Central African Republic',
    'Chad', 'Niger', 'Nigeria', 'Benin', 'Togo', 'Ghana', "Côte d'Ivoire", 'Ivory Coast',
    'Burkina Faso', 'Mali', 'Senegal', 'Gambia', 'Guinea', 'Guinea-Bissau', 'Sierra Leone', 'Liberia',
    'Cape Verde', 'Cabo Verde', 'São Tomé and Príncipe', 'Sao Tome', 'Lesotho', 'Eswatini', 'Swaziland',
  ]);
  add('Asia', [
    'China', 'CN', 'الصين', 'Hong Kong', 'Taiwan', 'Japan', 'JP', 'South Korea', 'Korea',
    'North Korea', 'Mongolia', 'Vietnam', 'Cambodia', 'Laos', 'Thailand', 'Myanmar', 'Burma',
    'Malaysia', 'Singapore', 'SG', 'Indonesia', 'Brunei', 'Philippines', 'Timor-Leste',
    'India', 'IN', 'Pakistan', 'Bangladesh', 'Nepal', 'Bhutan', 'Sri Lanka', 'Maldives',
    'Afghanistan', 'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Tajikistan', 'Kyrgyzstan',
    'Iran', 'Iraq', 'Syria', 'Lebanon', 'Jordan', 'Israel', 'Palestine',
    'Saudi Arabia', 'SA', 'KSA', 'United Arab Emirates', 'UAE', 'Qatar', 'Bahrain', 'Kuwait',
    'Oman', 'Yemen', 'Turkey', 'TR', 'Cyprus', 'Armenia', 'Azerbaijan', 'Georgia',
  ]);
  add('Europe', [
    'United Kingdom', 'UK', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland',
    'Ireland', 'France', 'FR', 'Germany', 'DE', 'Netherlands', 'NL', 'Holland', 'Belgium', 'Luxembourg',
    'Spain', 'ES', 'Portugal', 'Italy', 'IT', 'Switzerland', 'Austria', 'Liechtenstein',
    'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland', 'Estonia', 'Latvia', 'Lithuania',
    'Poland', 'Czech Republic', 'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria',
    'Greece', 'Albania', 'North Macedonia', 'Macedonia', 'Serbia', 'Montenegro', 'Bosnia and Herzegovina',
    'Croatia', 'Slovenia', 'Kosovo', 'Moldova', 'Ukraine', 'Belarus', 'Russia', 'RU',
    'Malta', 'Andorra', 'Monaco', 'San Marino', 'Vatican',
  ]);
  add('North America', [
    'United States', 'United States of America', 'USA', 'US', 'U.S.', 'U.S.A.', 'America',
    'Canada', 'CA', 'Mexico', 'MX',
    'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama',
    'Cuba', 'Jamaica', 'Haiti', 'Dominican Republic', 'Bahamas', 'Barbados', 'Trinidad and Tobago',
    'Puerto Rico', 'Antigua and Barbuda', 'Saint Lucia', 'Grenada', 'Dominica',
  ]);
  add('South America', [
    'Brazil', 'BR', 'Argentina', 'Chile', 'Peru', 'Colombia', 'Venezuela', 'Ecuador', 'Bolivia',
    'Paraguay', 'Uruguay', 'Guyana', 'Suriname', 'French Guiana',
  ]);
  add('Oceania', [
    'Australia', 'AU', 'New Zealand', 'NZ', 'Fiji', 'Papua New Guinea', 'Solomon Islands',
    'Samoa', 'Tonga', 'Vanuatu', 'Kiribati', 'Tuvalu', 'Marshall Islands', 'Micronesia', 'Palau',
  ]);
  return m;
})();
const continentOf = function (country) {
  if (!country) return 'Other';
  var key = String(country).trim().toLowerCase();
  if (!key) return 'Other';
  return COUNTRY_TO_CONTINENT[key] || 'Other';
};

const fCur = (amount, currency) => { if (!amount && amount !== 0) return '—'; const sym = { USD: '\$', EUR: '€', EGP: 'E£', GBP: '£', CNY: '¥', TRY: '₺', SAR: 'SR', AED: 'AED ' }; return (sym[currency] || currency + ' ') + Number(amount).toLocaleString(); };
const isExpired = (d) => d && d < todayET();
const daysUntil = (d) => { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); };

function ExpiryBadge({ date }) {
  if (!date) return <span className="text-[9px] text-slate-500">No expiry</span>;
  const d = daysUntil(date); const exp = d < 0; const soon = d >= 0 && d <= 7;
  return <span className={'px-1.5 py-0.5 rounded text-[9px] font-bold ' + (exp ? 'bg-red-100 text-red-900 border border-red-300' : soon ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-700')}>{exp ? 'Expired ' + Math.abs(d) + 'd ago' : d === 0 ? 'Expires today' : d + 'd left'}</span>;
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

export default function ShippingRatesTab({ toast, user, userProfile, isAdmin, customers, canBulkDeleteBubbles }) {
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
  // v55.83-A.6.27.67 (Max May 23 2026) — bulk-select for route detail page.
  // Tracks which rate IDs the user has ticked inside a bubble. Cleared when
  // route changes or the view leaves the route detail. Empty Set = nothing
  // selected = bulk-action bar hidden.
  const [selectedRateIds, setSelectedRateIds] = useState(new Set());
  // v55.83-A.6.27.69 (Phase 2) — bulk-delete permission. Falls back to
  // isAdmin if the prop isn't passed, so existing super-admin behavior
  // is preserved. When the new `Delete Shipping Bubbles` permission is
  // granted to a non-admin user, canBulkDeleteBubbles=true is passed in.
  const canBulkDelete = canBulkDeleteBubbles !== undefined ? !!canBulkDeleteBubbles : !!isAdmin;
  // Lifecycle: clear selection whenever the user navigates to a different
  // route or leaves the route detail view entirely. Prevents "I deleted
  // these in one bubble and now the ticks are still there in a different
  // bubble" bugs. Declared right after the state vars it depends on.
  useEffect(function () {
    setSelectedRateIds(new Set());
  }, [selectedRoute, view]);

  // v55.82-J (Max May 11 2026): destination-continent filter for the
  // Routes grid. Lets the user narrow to "show me only routes going to
  // Europe" / "Africa" / etc. Persists across reloads like the other
  // filter prefs.
  const [continentFilter, setContinentFilter] = useState(function() {
    try {
      if (typeof window !== 'undefined') {
        var stored = window.localStorage.getItem('ktc_shipping_continent_filter');
        if (stored) return stored;
      }
    } catch (_) {}
    return 'all';
  });
  const setContinentFilterPersist = function(v) {
    setContinentFilter(v);
    try { if (typeof window !== 'undefined') window.localStorage.setItem('ktc_shipping_continent_filter', v); } catch (_) {}
  };
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
  // v55.82-L Stage 2 — Shipping import per Max May 11 2026 full spec.
  //
  //   'update_only' — DEFAULT, SAFE.
  //                     Add new records, update changed records, leave
  //                     unchanged records untouched. NEVER deletes any row,
  //                     even if it's missing from the import file. This is
  //                     the safest default and the one used for any normal
  //                     spreadsheet upload.
  //
  //   'full_sync'   — INTENTIONAL, DESTRUCTIVE.
  //                     Add new, update changed, leave unchanged alone, AND
  //                     delete any existing record that doesn't appear in
  //                     the import file. Requires typed "FULL SYNC" confirm
  //                     plus a deliberate radio-button selection. Pre-flight
  //                     validation must pass for EVERY row before any delete
  //                     is allowed to run.
  //
  // Matching: a row is considered MATCH ONLY if all 5 of these fields match
  // (case-insensitive, whitespace-trimmed):
  //   1. origin           (Point of Origin / Port of Loading)
  //   2. destination      (Point of Destination)
  //   3. expiry_date      (Expiration Date)
  //   4. vendor_name      (Freight Forwarder)
  //   5. shipping_line    (Shipping Line)
  //
  // Per-row error policy: a row that fails validation OR fails the DB write
  // is skipped — its error captured for the summary report — and the
  // remaining rows continue processing. ONE BAD ROW NEVER FAILS THE BATCH.
  const [importMode, setImportMode] = useState('update_only');
  // v55.82-L Stage 2 — Typed confirmation for full_sync. Must match
  // exactly "FULL SYNC" (case-sensitive) before Import All is enabled.
  const [fullSyncConfirm, setFullSyncConfirm] = useState('');
  // v55.82-L Stage 2 — detailed error log + counts displayed on the
  // done screen. Each error: { row, field, reason }.
  const [importErrors, setImportErrors] = useState([]);
  const [importCounts, setImportCounts] = useState({ added: 0, updated: 0, unchanged: 0, failed: 0, deleted: 0 });
  // v55.82-N — Per-field capture report. After parsing, computeCaptureReport()
  // produces an array of { field, label, detected, captured, total } objects
  // (one per template field) so the user can see EXACTLY which template
  // columns came through into the parsed records and which didn't, BEFORE
  // running the actual import. Closes the "did the import silently drop
  // fields" visibility gap that has burned us repeatedly.
  const [importCaptureReport, setImportCaptureReport] = useState([]);
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
    // v55.83-A.6.27.15 (Max May 16 2026) — group by the FULL 4-tuple:
    // (origin country, POL, destination country, POD). Each unique
    // combination is its own bubble. Per Max: "bubbles need to have
    // country/pol and country of destination/pod MUST HAVE and broken
    // down by this and displayed -- if anything is different in those
    // 4 combinations then you need a separate bubble".
    //
    // Previously the key was just (origin country, destination country),
    // so rates with the same country pair but different ports got merged
    // into one bubble that could only show one port label. Now they
    // properly split into multiple bubbles, one per port pair.
    //
    // Case/whitespace insensitive for the KEY, but display labels keep
    // the best-cased version seen across rates in the group.
    var normForKey = function (s) { return (s || '').trim().toLowerCase(); };
    var pickLabel = function (existing, candidate) {
      if (!existing) return candidate || '';
      if (!candidate) return existing;
      var isAllCaps = function (s) { return s === s.toUpperCase() && /[A-Z]/.test(s); };
      if (isAllCaps(existing) && !isAllCaps(candidate)) return candidate;
      return existing;
    };
    const groups = {};
    filtered.forEach(r => {
      var originRaw = r.origin || '?';
      var destRaw = r.destination || '?';
      var polRaw = r.port_of_loading || '';   // empty string in key when missing
      var podRaw = r.port_of_discharge || '';
      // 4-part key: any difference in any of the four creates a new bubble.
      var key = normForKey(originRaw) + '|' + normForKey(polRaw)
              + '||' + normForKey(destRaw) + '|' + normForKey(podRaw);
      // Display labels for the bubble — port preferred as main, country as sub.
      var leftLabel, rightLabel;
      if (polRaw && normForKey(polRaw) !== normForKey(originRaw)) {
        leftLabel = polRaw + ' (' + originRaw + ')';
      } else {
        leftLabel = originRaw;
      }
      if (podRaw && normForKey(podRaw) !== normForKey(destRaw)) {
        rightLabel = podRaw + ' (' + destRaw + ')';
      } else {
        rightLabel = destRaw;
      }
      if (!groups[key]) groups[key] = {
        origin: originRaw,
        destination: destRaw,
        pol: polRaw || null,
        pod: podRaw || null,
        leftLabel: leftLabel,
        rightLabel: rightLabel,
        rates: [], vendors: new Set(), lines: new Set(), modes: new Set()
      };
      groups[key].leftLabel = pickLabel(groups[key].leftLabel, leftLabel);
      groups[key].rightLabel = pickLabel(groups[key].rightLabel, rightLabel);
      groups[key].rates.push(r);
      if (r.vendor_name) groups[key].vendors.add(r.vendor_name);
      if (r.shipping_line) groups[key].lines.add(r.shipping_line);
      if (r.transport_mode) groups[key].modes.add(r.transport_mode);
    });
    return Object.entries(groups).map(([key, data]) => {
      const ar = data.rates.filter(r => !isExpired(r.expiry_date));
      const ch = ar.length > 0 ? ar.reduce((a,b) => (a.rate_amount||Infinity) < (b.rate_amount||Infinity) ? a : b) : null;
      return { key, ...data, cheapest: ch, activeCount: ar.length, expiredCount: data.rates.length - ar.length, count: data.rates.length, historicalGroup: ar.length === 0, destContinent: continentOf(data.destination) };
    }).filter(function (rg) {
      // v55.82-J — apply destination-continent filter. 'all' (default) is no-op.
      if (continentFilter === 'all') return true;
      return rg.destContinent === continentFilter;
    }).sort(function (a, b) {
      // Active groups first, then alphabetical by destination, then POD,
      // then origin, then POL — keeps related routes near each other.
      if (a.historicalGroup !== b.historicalGroup) return a.historicalGroup ? 1 : -1;
      var ad = (a.destination || '').toLowerCase();
      var bd = (b.destination || '').toLowerCase();
      if (ad !== bd) return ad < bd ? -1 : 1;
      var apd = (a.pod || '').toLowerCase();
      var bpd = (b.pod || '').toLowerCase();
      if (apd !== bpd) return apd < bpd ? -1 : 1;
      var ao = (a.origin || '').toLowerCase();
      var bo = (b.origin || '').toLowerCase();
      if (ao !== bo) return ao < bo ? -1 : 1;
      var apl = (a.pol || '').toLowerCase();
      var bpl = (b.pol || '').toLowerCase();
      return apl < bpl ? -1 : (apl > bpl ? 1 : 0);
    });
  }, [filtered, continentFilter]);

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
  const routeHistory = useMemo(() => { if (!selectedRoute) return []; 
    // v55.83-A.6.2 (Max May 13 2026) — case/whitespace-insensitive route match.
    // The old strict equality `r.origin !== selectedRoute.origin` was silently
    // dropping rates whose origin/destination was entered with different
    // casing or trailing whitespace ("USA" vs "Usa" vs " USA "). On Max's
    // USA→ALGERIA route the route card aggregated 14 rates but the chart
    // saw fewer because some had slightly different origin/destination
    // strings. Normalize both sides before comparing.
    var norm = function(s) { return (s || '').trim().toLowerCase(); };
    var routeOrigin = norm(selectedRoute.origin);
    var routeDest = norm(selectedRoute.destination);
    var routePol = norm(selectedRoute.pol);
    var routePod = norm(selectedRoute.pod);
    return rates.filter(r => {
      if (routeOrigin && norm(r.origin) !== routeOrigin) return false;
      if (routeDest && norm(r.destination) !== routeDest) return false;
      // POL/POD are nullable on rate rows. If the route card has a POL/POD
      // value, only filter when the rate ALSO has one (don't punish rates
      // missing POL/POD just because the route card has them aggregated).
      if (routePol && r.port_of_loading && norm(r.port_of_loading) !== routePol) return false;
      if (routePod && r.port_of_discharge && norm(r.port_of_discharge) !== routePod) return false;
      return true;
    }).sort((a,b) => (b.effective_date||'').localeCompare(a.effective_date||''));
  }, [selectedRoute, rates]);
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
    // v55.83-A.6.27.57 — Full diagnostic instrumentation. Previously the save
    // handler had a buggy "toast ? toast.error : toast ? toast.error : alert"
    // chain that swallowed silently when toast was malformed. Now BOTH toast
    // AND alert fire so save failures are always visible. Also logs to console
    // so we can diagnose what's actually going wrong with trucking-rate saves.
    console.log('[shipping-rates] save attempt:', { editingRate: editingRate && editingRate.id, formState: f });

    if (!f.origin || !f.destination || !f.vendorName) {
      var missingMsg = 'Cannot save: missing required field(s).\n\n' +
        'Origin: ' + (f.origin || '(empty)') + '\n' +
        'Destination: ' + (f.destination || '(empty)') + '\n' +
        'Vendor: ' + (f.vendorName || '(empty)') + '\n\n' +
        'Please fill in all three before saving.';
      alert(missingMsg);
      return;
    }
    if (!f.rateType) {
      alert('Cannot save: Rate Type is required.\n\nSelect one of: Shipping, Trucking, or Customs/Brokerage.\n\nنوع السعر مطلوب! اختر شحن أو نقل بري أو جمارك');
      return;
    }
    // v55.83-A.6.27.57 — Trucking-specific sanity check.
    // The form defaults transport_mode to 'Ocean'. If the user picked rate_type
    // = 'Trucking' but never changed transport_mode away from Ocean, that's
    // almost always a mistake — surface a confirm dialog so they can fix it
    // (or proceed anyway if intentional). Saves data quality.
    if (f.rateType === 'Trucking' && (!f.transportMode || f.transportMode === 'Ocean')) {
      var proceed = confirm(
        'Heads-up: this is a TRUCKING rate but Transport Mode is set to "' + (f.transportMode || 'Ocean') + '".\n\n' +
        'Did you mean to set Mode = Trucking?\n\n' +
        'Click OK to save anyway, or Cancel to go back and change the Mode dropdown.'
      );
      if (!proceed) return;
    }

    const record = { origin: f.origin, destination: f.destination, vendor_name: f.vendorName, shipping_line: f.shippingLine || '', transport_mode: f.transportMode || 'Ocean', rate_type: f.rateType, container_type: f.containerType || '40ft', rate_amount: Number(f.rateAmount) || 0, currency: f.currency || 'USD', transit_days: f.transitDays ? Number(f.transitDays) : null, free_days: f.freeDays ? Number(f.freeDays) : null, port_fees: Number(f.portFees) || 0, thc_fees: Number(f.thcFees) || 0, documentation_fees: Number(f.docFees) || 0, customs_fees: Number(f.customsFees) || 0, other_fees: Number(f.otherFees) || 0, other_fees_desc: f.otherFeesDesc || '', total_cost: Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), effective_date: f.effectiveDate || todayET(), expiry_date: f.expiryDate || null, port_of_loading: f.pol || '', port_of_discharge: f.pod || '', notes: f.notes || '', booked: f.booked || false, shipment_reference: f.shipmentRef || '', booking_date: f.bookingDate || null, booking_notes: f.bookingNotes || '' };
    console.log('[shipping-rates] record to save:', record);
    try {
      var saved;
      if (editingRate) {
        saved = await dbUpdate('shipping_rates', editingRate.id, record, myId);
        console.log('[shipping-rates] dbUpdate returned:', saved);
      } else {
        saved = await dbInsert('shipping_rates', record, myId);
        console.log('[shipping-rates] dbInsert returned:', saved);
        notifyShippingRate('all', f.origin, f.destination, myId);
      }
      // v55.83-A.6.27.57 — Verify that critical fields made it through dbInsert
      // (which strips columns the table doesn't have, silently).
      if (saved && saved.id) {
        if (saved.rate_type !== record.rate_type) {
          console.warn('[shipping-rates] rate_type mismatch after save — wanted "' + record.rate_type + '", got "' + saved.rate_type + '". Check that the shipping_rates table has a rate_type column.');
          alert('⚠ Warning: rate_type was stripped during save.\n\nWanted: ' + record.rate_type + '\nActual: ' + (saved.rate_type || '(null)') + '\n\nThe shipping_rates table may be missing the rate_type column. Tell Claude this happened.');
        }
        if (saved.transport_mode !== record.transport_mode) {
          console.warn('[shipping-rates] transport_mode mismatch after save.');
        }
      }
      await logActivity(myId, (editingRate ? 'Updated' : 'Created') + ' ' + (f.rateType || 'shipping') + ' rate: ' + f.origin + ' → ' + f.destination + ' (' + f.vendorName + ', ' + (f.currency || 'USD') + ' ' + (f.rateAmount || 0) + ')', 'shipping');
      // v55.83-A.6.27.57 — Explicit success toast + alert so user KNOWS it saved.
      var successMsg = (editingRate ? 'Updated' : 'Saved') + ' ' + (f.rateType || 'shipping') + ' rate: ' + f.origin + ' → ' + f.destination + ' (' + f.vendorName + ', ' + (f.currency || 'USD') + ' ' + (f.rateAmount || 0) + ')';
      try { if (toast && toast.success) toast.success(successMsg); } catch (_) {}
      console.log('[shipping-rates] save SUCCESS:', successMsg);
      setF({});
      setEditingRate(null);
      setView(selectedRoute ? 'route_detail' : 'routes');
      await loadData();
    } catch (err) {
      console.error('[shipping-rates] save FAILED:', err);
      var errMsg = (err && err.message) || String(err);
      // v55.83-A.6.27.57 — Defense in depth: try toast AND alert (toast may be
      // broken or undefined). User MUST see the actual error message.
      try { if (toast && toast.error) toast.error('Save failed: ' + errMsg); } catch (_) {}
      // Map common error patterns to actionable messages.
      var actionable = '';
      if (/relation.*shipping_rates.*does not exist/i.test(errMsg)) {
        actionable = '\n\nThe shipping_rates table is missing entirely. The setup SQL was never run.';
      } else if (/column.*does not exist/i.test(errMsg)) {
        actionable = '\n\nA column is missing from the shipping_rates table. Tell Claude which column the error message names — that points to which SQL migration is missing.';
      } else if (/violates row-level security policy|new row violates row-level security/i.test(errMsg)) {
        actionable = '\n\nRow-level security blocked this save. The shipping_rates table has an RLS policy that does not allow you to insert. Ask Claude to check the policy.';
      } else if (/duplicate key|already exists/i.test(errMsg)) {
        actionable = '\n\nA rate already exists with this combination of (origin, destination, vendor, dates). Edit the existing one instead, or change one of those fields.';
      }
      alert('Save failed:\n\n' + errMsg + actionable);
    }
  };

  const [bookingModal, setBookingModal] = useState(null);
  // v55.82-D — Two-stage booking flow per Max May 10 2026:
  //   1. REQUEST BOOKING — opens an email/WhatsApp template pre-filled with
  //      route + rate + container info to send to the freight forwarder.
  //      Marks the rate as `booking_requested` so the user knows they're
  //      waiting on the forwarder's reply (and so it shows up on dashboards
  //      as "in flight" rather than mistaken for booked).
  //   2. CONFIRM BOOKING — once the forwarder replies with a booking#,
  //      the user clicks "Confirm Booking" and enters the booking#,
  //      customer name, customer release#, and expected ship date. This
  //      is what flips `booked = true` and seeds the bookings table for
  //      the trend-chart star.
  // The old single-step bookingModal kept around for backward compat (used
  // by the "Book" button on rates that already have everything in hand —
  // e.g. importing a historical booking that already happened).
  const [bookingRequestModal, setBookingRequestModal] = useState(null);  // rate being requested
  const [bookingConfirmModal, setBookingConfirmModal] = useState(null);  // rate being confirmed
  const handleMarkBooked = async (rate) => { setBookingModal(rate); };
  const handleRequestBooking = (rate) => { setBookingRequestModal(rate); };
  const handleConfirmBooking = (rate) => { setBookingConfirmModal(rate); };
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

  // v55.82-D — Generate freight-forwarder booking-request message body.
  // Mirror of generateQuoteRequest's shape but oriented around "we want to
  // book THIS rate" rather than "we want a quote." Includes the rate#,
  // expiry, container, fees, and route so the forwarder has everything
  // they need to issue a booking confirmation. Fields default to safe
  // strings if missing (no "undefined" in user-facing text).
  const generateBookingRequest = (rate, vendor, customerName, orderNumber, releaseNumber, expectedDate) => {
    var today = fmtET(new Date(), 'longdate', { tag: false });
    var subject = 'Booking Request — ' + (rate.origin || 'Origin') + ' to ' + (rate.destination || 'Destination') + ' — ' + (rate.container_type || '40ft') + ' — KTC International';
    var body = ''
      + 'Dear ' + (vendor && (vendor.contact_name || vendor.company_name) ? (vendor.contact_name || vendor.company_name) : (rate.vendor_name || 'Team')) + ',\n'
      + '\n'
      + 'We would like to confirm a booking against your rate below. Please issue a booking number at your earliest convenience.\n'
      + '\n'
      + 'BOOKING DETAILS\n'
      + '--------------------------------\n'
      + 'Origin: ' + (rate.origin || '—') + (rate.port_of_loading ? ' (POL: ' + rate.port_of_loading + ')' : '') + '\n'
      + 'Destination: ' + (rate.destination || '—') + (rate.port_of_discharge ? ' (POD: ' + rate.port_of_discharge + ')' : '') + '\n'
      + 'Container Type: ' + (rate.container_type || '40ft') + '\n'
      + 'Carrier / Line: ' + (rate.shipping_line || '—') + '\n'
      + 'Rate: ' + (rate.currency || 'USD') + ' ' + (rate.rate_amount || 0) + (rate.total_cost && rate.total_cost !== rate.rate_amount ? '  (Total all-in: ' + (rate.currency || 'USD') + ' ' + rate.total_cost + ')' : '') + '\n'
      + 'Rate Validity: ' + (rate.expiry_date || 'open') + '\n'
      + (rate.transit_days ? 'Transit Days: ' + rate.transit_days + '\n' : '')
      + (rate.free_days ? 'Free Days: ' + rate.free_days + '\n' : '')
      + '\n'
      + 'CUSTOMER / SHIPPER INFORMATION\n'
      + '--------------------------------\n'
      + 'Customer: ' + (customerName || '[to be provided]') + '\n'
      + (orderNumber ? 'Our Order #: ' + orderNumber + '\n' : '')
      + (releaseNumber ? 'Release #: ' + releaseNumber + '\n' : '')
      + (expectedDate ? 'Expected Cargo Ready Date: ' + expectedDate + '\n' : '')
      + '\n'
      + 'Please send the booking number, vessel/voyage details, and cut-off times once available.\n'
      + '\n'
      + 'Thank you for your continued partnership.\n'
      + '\n'
      + 'Best regards,\n'
      + 'KTC International Trading\n'
      + 'Kandil Trading Company\n'
      + 'Date: ' + today;
    return { subject: subject, body: body };
  };

  // v55.82-D — Stage 1: Stamp the rate as "booking requested" so we can
  // distinguish it from rates that are still merely quoted, AND from
  // rates that have a confirmed booking number. The rate row is NOT yet
  // marked booked=true — that happens in finalizeBookingConfirm. This
  // is just a "we sent the request, waiting on reply" marker.
  const submitBookingRequest = async (rate) => {
    try {
      var updates = {
        booking_requested: true,
        booking_requested_at: new Date().toISOString(),
        booking_requested_customer: f.bookReqCustomer || '',
        booking_requested_order: f.bookReqOrder || '',
        booking_requested_release: f.bookReqRelease || '',
        booking_requested_expected_date: f.bookReqExpected || null,
      };
      try {
        await dbUpdate('shipping_rates', rate.id, updates, myId);
      } catch (e) {
        // If the booking_requested* columns don't exist yet, log and
        // continue — the email/whatsapp message still gets sent and the
        // user has the audit-log entry. Migration ships separately.
        console.warn('[booking-request] schema may be missing booking_requested columns:', e && e.message);
      }
      await logActivity(myId, 'Requested booking: ' + (rate.vendor_name || '?') + ' ' + rate.origin + '→' + rate.destination + (f.bookReqCustomer ? ' for ' + f.bookReqCustomer : ''), 'shipping');
      setBookingRequestModal(null);
      setF(function(prev) { return Object.assign({}, prev, { bookReqCustomer: '', bookReqOrder: '', bookReqRelease: '', bookReqExpected: '' }); });
      await loadData();
      if (toast && toast.success) toast.success('Booking request sent. Waiting on forwarder reply.');
    } catch (err) {
      console.error('[booking-request] failed', err);
      try { (toast && toast.error) ? toast.error('Could not save booking request: ' + (err && err.message)) : alert(err && err.message); } catch (_) {}
    }
  };

  // v55.82-D — Stage 2: forwarder replied with a booking number. Capture
  // it + customer/release info, mark the rate booked=true, write a row
  // into shipping_bookings (so it appears as a chart star + on the route
  // bookings list).
  const finalizeBookingConfirm = async (rate) => {
    if (!rate || !f.bookConfirmNumber) {
      if (toast && toast.warning) toast.warning('Booking number is required to confirm.');
      return;
    }
    try {
      // 1. Insert the bookings row (the trend chart picks this up via the
      //    booked rates → stars layer).
      await dbInsert('shipping_bookings', {
        rate_id: rate.id,
        shipment_reference: f.bookConfirmNumber,
        customer_name: f.bookConfirmCustomer || '',
        order_number: f.bookConfirmOrder || '',
        booking_date: todayET(),
        notes: ''
          + (f.bookConfirmRelease ? 'Release #: ' + f.bookConfirmRelease + '. ' : '')
          + (f.bookConfirmExpected ? 'Expected ship date: ' + f.bookConfirmExpected + '. ' : '')
          + (f.bookConfirmNotes ? f.bookConfirmNotes : ''),
        booked_by: myId,
      }, myId);

      // 2. Stamp the rate row.
      var rateUpdates = {
        booked: true,
        shipment_reference: f.bookConfirmNumber,
        booking_date: todayET(),
        booking_notes: ''
          + (f.bookConfirmCustomer ? 'Customer: ' + f.bookConfirmCustomer + '. ' : '')
          + (f.bookConfirmOrder ? 'Order: ' + f.bookConfirmOrder + '. ' : '')
          + (f.bookConfirmRelease ? 'Release #: ' + f.bookConfirmRelease + '. ' : '')
          + (f.bookConfirmExpected ? 'Expected ship: ' + f.bookConfirmExpected + '. ' : ''),
      };
      // Try to also clear the booking_requested flag now that we have a
      // confirmed booking. If the column doesn't exist, the dbUpdate retry
      // path handles it gracefully.
      try { rateUpdates.booking_requested = false; } catch (_) {}
      await dbUpdate('shipping_rates', rate.id, rateUpdates, myId);

      await logActivity(myId, 'Confirmed booking: ' + rate.vendor_name + ' ' + rate.origin + '→' + rate.destination + ' Booking#: ' + f.bookConfirmNumber + (f.bookConfirmCustomer ? ' for ' + f.bookConfirmCustomer : ''), 'shipping');
      try { notifyShippingBooked('all', f.bookConfirmNumber, myId); } catch (_) {}
      setBookingConfirmModal(null);
      setF(function(prev) { return Object.assign({}, prev, { bookConfirmNumber: '', bookConfirmCustomer: '', bookConfirmOrder: '', bookConfirmRelease: '', bookConfirmExpected: '', bookConfirmNotes: '' }); });
      await loadData();
      if (toast && toast.success) toast.success('Booking confirmed ✓');
    } catch (err) {
      console.error('[booking-confirm] failed', err);
      try { (toast && toast.error) ? toast.error('Could not confirm booking: ' + (err && err.message)) : alert(err && err.message); } catch (_) {}
    }
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
  // v55.83-A.6 (Max May 13 2026) — three toggleable chart views.
  //   'floor'  — single line, lowest price across ALL vendors/lines each month
  //              (true market floor — the cheapest available)
  //   'vendor' — one line per vendor (vendor_name field on each rate)
  //   'line'   — one line per shipping_line (Maersk / MSC / etc, the prior default)
  // 'floor' is the new default because Max said the chart should answer
  // "what was the best price at any point in time" first, with vendor /
  // shipping-line breakdowns as deliberate drill-downs.
  const [chartView, setChartView] = useState('floor');
  // v55.83-A.6 — user-selectable currency for the chart, overrides the
  // auto-pick. Default '' = let the chart pick most-common currency.
  const [chartCurrencyOverride, setChartCurrencyOverride] = useState('');
  // v55.82-M — Click-on-chart-point → scroll to + highlight the matching
  // rate row in the historical table below. Stores the rate ID currently
  // highlighted (or null). Auto-clears after 3 seconds so the flash fades.
  const [highlightedRateId, setHighlightedRateId] = useState(null);
  useEffect(function() {
    if (!highlightedRateId) return;
    var t = setTimeout(function() { setHighlightedRateId(null); }, 3000);
    return function() { clearTimeout(t); };
  }, [highlightedRateId]);

  const handleSaveQuote = async () => {
    if (!f.qCustomer || !f.qOrigin || !f.qDest) { alert('Fill Customer, Origin, Destination'); return; }
    const iT = Number(f.qShipCost||0)+Number(f.qTruckCost||0)+Number(f.qCustomsCost||0)+Number(f.qOtherInternal||0);
    const cT = Number(f.qClientShip||0)+Number(f.qClientTruck||0)+Number(f.qClientCustoms||0)+Number(f.qClientService||0)+Number(f.qClientOther||0);
    const profit = cT - iT;
    const record = { quote_number: f.qNumber || ('Q-' + Date.now().toString(36).toUpperCase()), quote_date: f.qDate || todayET(), customer_name: f.qCustomer, customer_email: f.qEmail || '', origin: f.qOrigin, destination: f.qDest, port_of_loading: f.qPol || '', port_of_discharge: f.qPod || '', container_type: f.qContainer || '40ft', shipping_rate_id: pickedShipRate || f.qRateId || null, shipping_cost: Number(f.qShipCost)||0, shipping_vendor: f.qShipVendor || '', shipping_line: f.qShipLine || '', trucking_cost: Number(f.qTruckCost)||0, trucking_vendor: f.qTruckVendor || '', customs_cost: Number(f.qCustomsCost)||0, other_internal_cost: Number(f.qOtherInternal)||0, other_internal_desc: f.qOtherInternalDesc || '', total_internal_cost: iT, client_shipping_fee: Number(f.qClientShip)||0, client_trucking_fee: Number(f.qClientTruck)||0, client_customs_fee: Number(f.qClientCustoms)||0, client_service_fee: Number(f.qClientService)||0, client_other_fee: Number(f.qClientOther)||0, client_other_desc: f.qClientOtherDesc || '', client_total: cT, client_display_text: f.qDisplayText || '', client_show_breakdown: f.qShowBreakdown || false, profit, profit_pct: iT > 0 ? Math.round((profit/iT)*10000)/100 : 0, currency: f.qCurrency || 'USD', status: f.qStatus || 'draft', valid_until: f.qValidUntil || null, notes: f.qNotes || '' };
    try { if (editingQuote) await dbUpdate('shipping_quotes', editingQuote.id, record, myId); else await dbInsert('shipping_quotes', record, myId); await logActivity(myId, `Quote ${record.quote_number} ${editingQuote?'updated':'created'} for ${record.customer_name}`); resetQuoteForm(); setView('quotes'); await loadData(); } catch (err) { toast ? toast.error(err.message) : toast ? toast.error(err.message) : alert(err.message); }
  };

  const handleDeleteRate = async (rate) => { if (!confirm('Delete this rate?')) return; try { await dbDelete('shipping_rates', rate.id, myId); await loadData(); } catch (err) { toast ? toast.error(err.message) : alert(err.message); } };

  // v55.83-A.6.27.67 (Max May 23 2026) — Bulk-delete inside a bubble.
  // Deletes all rates whose IDs are in the provided list. Each delete goes
  // through dbDelete so the audit_log gets a per-rate entry. We don't use
  // Promise.all here — sequential deletes give us per-rate progress AND if
  // one fails midway, the user knows exactly how far we got. Returns count
  // of successful deletes; throws if first delete fails (so user knows
  // nothing happened).
  const handleBulkDeleteRates = async (ids, label) => {
    var arr = Array.from(ids || []);
    if (arr.length === 0) { alert('No rates selected.'); return; }
    var prompt = 'Delete ' + arr.length + ' rate' + (arr.length === 1 ? '' : 's') +
      (label ? ' (' + label + ')' : '') +
      '?\n\nThis permanently removes the rows from the database. Cannot be undone. Each delete is logged to the audit trail.';
    if (!confirm(prompt)) return;
    var succeeded = 0;
    var failed = [];
    for (var i = 0; i < arr.length; i++) {
      var rateId = arr[i];
      try {
        await dbDelete('shipping_rates', rateId, myId);
        succeeded++;
      } catch (err) {
        console.error('[bulk-delete] rate ' + rateId + ' failed:', err);
        failed.push({ id: rateId, error: (err && err.message) || String(err) });
        // If the first one fails, bail — likely a permission or auth issue
        // that will fail for all of them, no point in spamming the audit log.
        if (succeeded === 0) {
          alert('Bulk delete aborted on first failure: ' + (err && err.message) +
            '\n\nNo rates were deleted. Check your permissions and try again.');
          return;
        }
      }
    }
    var msg = 'Deleted ' + succeeded + ' of ' + arr.length + ' rate' + (arr.length === 1 ? '' : 's') + '.';
    if (failed.length > 0) {
      msg += '\n\n' + failed.length + ' failed:\n' + failed.slice(0, 5).map(function (f) { return '  • ' + f.error; }).join('\n');
      if (failed.length > 5) msg += '\n  ... and ' + (failed.length - 5) + ' more (see console).';
    }
    if (toast && toast.success) {
      toast.success('Bulk delete: ' + succeeded + '/' + arr.length + ' deleted' + (failed.length > 0 ? ' (' + failed.length + ' failed)' : ''));
    }
    if (failed.length > 0) alert(msg);
    setSelectedRateIds(new Set());
    await loadData();
  };

  // v55.82-N — Compute a per-field "did this come through" report for the
  // 21 template fields. Returns an array of { field, label, dbField,
  // detected, captured, total, status } where:
  //   detected — was a source column auto-detected at all?
  //   captured — how many parsed rows ended up with a non-empty value
  //   total    — total parsed rows
  //   status   — "ok" (>= 90% capture), "partial" (1-89%), "missing"
  //              (no column detected), or "empty" (column detected but
  //              every value blank — usually means the template column
  //              was left empty by the user)
  // This is what gets displayed on the preview screen so the user sees
  // whether POL/POD/transit/etc. actually made it through BEFORE clicking
  // Import. Spec section 6+7 of the import requirements.
  const computeCaptureReport = (colMap, parsed, useContainerExpansion) => {
    // [templateLabel, colMapKey, dbField]. Order matches the template's
    // 21-column layout exactly so the report reads top-to-bottom like the
    // spreadsheet.
    const FIELD_SPEC = [
      ['Origin',                  'origin',        'origin'],
      ['Destination',             'destination',   'destination'],
      ['Port of Loading (POL)',   'pol',           'port_of_loading'],
      ['Port of Discharge (POD)', 'pod',           'port_of_discharge'],
      ['Vendor / Forwarder',      'vendor',        'vendor_name'],
      ['Shipping Line / Carrier', 'line',          'shipping_line'],
      ['Transport Mode',          'mode',          'transport_mode'],
      ['Container Type',          'container',     'container_type'],
      ['Rate Amount',             'rate',          'rate_amount'],
      ['Currency',                'currency',      'currency'],
      ['Effective Date',          'date',          'effective_date'],
      ['Expiry Date',             'expiry',        'expiry_date'],
      ['Transit Days',            'transit',       'transit_days'],
      ['Free Days',               'free',          'free_days'],
      ['Port Fees',               'portFees',      'port_fees'],
      ['THC Fees',                'thc',           'thc_fees'],
      ['Documentation Fees',      'docFees',       'documentation_fees'],
      ['Customs Fees',            'customsFees',   'customs_fees'],
      ['Other Fees',              'otherFees',     'other_fees'],
      ['Other Fees Description',  'otherFeesDesc', 'other_fees_desc'],
      ['Notes',                   'notes',         'notes'],
    ];
    const total = parsed.length;
    return FIELD_SPEC.map(function (spec) {
      const label = spec[0]; const key = spec[1]; const dbField = spec[2];
      // container_type is handled specially when useContainerExpansion is
      // on — there's no single "container" column then, the container
      // comes from the column header (20GP / 40HC / etc.). So we mark
      // detection as "ok via expansion" in that case.
      const sourceCol = colMap[key] || null;
      let detected = !!sourceCol;
      if (!detected && key === 'container' && useContainerExpansion) {
        detected = true; // synthesized from per-container columns
      }
      // Count rows where the DB field has a non-empty, non-zero value.
      // For numeric fee fields, 0 is treated as "captured" (zero is a
      // valid value — many templates leave fees at 0). For text fields,
      // empty string counts as missing.
      let captured = 0;
      const numericFields = { rate_amount:1, transit_days:1, free_days:1, port_fees:1, thc_fees:1, documentation_fees:1, customs_fees:1, other_fees:1 };
      parsed.forEach(function (r) {
        const v = r[dbField];
        if (numericFields[dbField]) {
          if (v != null && !isNaN(Number(v))) captured++;
        } else {
          if (v != null && String(v).trim() !== '') captured++;
        }
      });
      let status;
      if (!detected) status = 'missing';
      else if (total === 0) status = 'empty';
      else if (captured === 0) status = 'empty';
      else if (captured / total >= 0.9) status = 'ok';
      else status = 'partial';
      return {
        field: key,
        label: label,
        dbField: dbField,
        sourceCol: sourceCol,
        detected: detected,
        captured: captured,
        total: total,
        status: status,
      };
    });
  };

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
      // v55.82-C — Pull "Other Fees Description" column. Previously dropped
      // on the floor on every import, so the BAF/CAF/ISPS labels never made
      // it into the rate record. Template column 20.
      otherFeesDesc: findColSmart(['other fees description', 'other fees desc', 'other fees label', 'fee description', 'surcharge label', 'surcharge description'], { exclude: ['amount', 'value'] }),
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
        // v55.82-C — Capture Other Fees Description so the label that goes
        // with the surcharge (BAF / CAF / ISPS / etc.) survives the import.
        other_fees_desc: getVal(row, colMap.otherFeesDesc),
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

    // v55.82-N — Per-field capture diagnostic. For each of the 21 template
    // fields, compute (a) was the column auto-detected at all? (b) how
    // many of the parsed rows ended up with a non-empty value? Surface
    // this on the preview screen so the user sees BEFORE importing
    // whether POL/POD/transit/etc. actually made it through.
    var captureReport = computeCaptureReport(colMap, parsed, useContainerExpansion);
    setImportCaptureReport(captureReport);

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
        // v55.82-C — see processImportFile comment. Mirror here so user-
        // remapped columns also pick up the surcharge label.
        other_fees_desc: getVal(row, newColMap.otherFeesDesc),
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
    // v55.82-N — refresh capture report after remap so user sees fields
    // that came through after they fixed the column mapping.
    setImportCaptureReport(computeCaptureReport(newColMap, parsed, useContainerExpansion));
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
    // v55.82-L Stage 2 — spec-correct, line-by-line, never-wipes-on-error.
    //
    // Flow:
    //   1. Pre-flight validate every row (date sanity, required fields).
    //      Rows that fail validation are recorded as errors and SKIPPED —
    //      they do NOT abort the import.
    //   2. Fetch existing rows scoped to the vendors+origins in the import
    //      (one bulk SELECT, fast).
    //   3. For each valid row:
    //        - find existing by 5-key match (origin + destination +
    //          expiry_date + vendor_name + shipping_line)
    //        - if found AND values changed → UPDATE (single-row, isolated)
    //        - if found AND no changes        → SKIP (counted as unchanged)
    //        - if not found                   → INSERT (single-row, isolated)
    //      Each row's DB operation runs in its own try/catch with timeout.
    //      One row failing NEVER affects another row.
    //   4. If mode === 'full_sync' AND zero validation errors AND zero row
    //      errors, delete any existing rows that don't appear in the import.
    //      If ANY error occurred, the full_sync delete step is skipped —
    //      we never destroy data when there's any sign of trouble.
    //   5. Show summary: New / Updated / Unchanged / Failed (+ Deleted if
    //      full_sync ran).
    setImportStep('importing'); setImportProgress(0);
    setImportStatus('Validating ' + importData.length + ' rows…');

    // --- counters & error log
    var counts = { added: 0, updated: 0, unchanged: 0, failed: 0, deleted: 0 };
    var errors = []; // { row, field, reason }

    // --- date validation helper. Postgres rejects '0-01-01', empty strings
    // on DATE columns, and anything that doesn't parse. Return true if the
    // value is null/undefined/blank (OK, will store as null) or a valid
    // YYYY-MM-DD with year 1900-2100. Return the reason string on failure.
    var validateDate = function (val, fieldLabel) {
      if (val === null || val === undefined || val === '') return null; // blank is OK
      var s = String(val).trim();
      if (s === '') return null;
      // Strip a time component if present
      var datePart = s.indexOf('T') >= 0 ? s.substring(0, s.indexOf('T')) : s.split(' ')[0];
      var m2 = datePart.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
      if (!m2) return fieldLabel + ' is not a valid date ("' + s + '")';
      var y = parseInt(m2[1], 10), mo = parseInt(m2[2], 10), d = parseInt(m2[3], 10);
      if (y < 1900 || y > 2100) return fieldLabel + ' year out of range ("' + s + '")';
      if (mo < 1 || mo > 12) return fieldLabel + ' month out of range ("' + s + '")';
      if (d < 1 || d > 31) return fieldLabel + ' day out of range ("' + s + '")';
      return null;
    };

    // --- v55.83-A.6.27.7 (Max May 15 2026) — BAD-DATA PATTERN detector.
    //
    // We've watched real imports produce rows that are syntactically valid
    // (parseable dates, non-empty fields) but SEMANTICALLY broken — they
    // poison the chart and the historical table. Per Max:
    //   "BAD DATA - DO NOT IMPORT - CREATE A RECORD FOR THE USER TO FIX
    //    LATER IF HE WANTS OTHERWISE DO NOT IMPORT THE BAD RECORDS"
    //
    // So instead of failing the row (which forces a re-import) OR letting
    // it through (which poisons the chart), we quarantine it: store it in
    // shipping_rates_import_quarantine for user review. User can fix dates
    // in the quarantine UI and import; or discard it.
    //
    // Returns array of reason strings if bad, [] if OK.
    var validateBadDataPatterns = function (raw) {
      var reasons = [];
      var eff = raw.effective_date ? String(raw.effective_date).substring(0, 10) : '';
      var exp = raw.expiry_date ? String(raw.expiry_date).substring(0, 10) : '';
      var amt = Number(raw.rate_amount || 0);

      // Pattern 1: effective and expiry on the same day (zero-day window).
      // Real shipping rates have a validity window — even short-tender rates
      // have at least a few days. Same-day is almost always a botched import
      // where the date column got copied into both. (Caught Max's 44-row
      // USA→India case where every row had eff=exp=2025-12-31.)
      if (eff && exp && eff === exp) {
        reasons.push('Effective and expiry dates are identical (' + eff + ') — likely import error');
      }

      // Pattern 2: expiry BEFORE effective (impossible window).
      if (eff && exp && exp < eff) {
        reasons.push('Expiry date (' + exp + ') is before effective date (' + eff + ')');
      }

      // Pattern 3: effective_date too far in the past (before 2020).
      // The year-2000 BIC row was driving Max's chart to span 317 months.
      // Real freight rates are not still valid from before 2020.
      if (eff && eff < '2020-01-01') {
        reasons.push('Effective date is before 2020 (' + eff + ') — likely import error');
      }

      // Pattern 4: effective_date too far in the future (more than 2 years out).
      var today = todayET();
      var twoYearsOut = new Date(); twoYearsOut.setFullYear(twoYearsOut.getFullYear() + 2);
      var twoYearsOutStr = twoYearsOut.toISOString().substring(0, 10);
      if (eff && eff > twoYearsOutStr) {
        reasons.push('Effective date is more than 2 years in the future (' + eff + ')');
      }

      // Pattern 5: zero or missing rate (a shipping rate of $0 is meaningless).
      if (!amt || amt <= 0) {
        reasons.push('Rate amount is missing or zero');
      }

      // Pattern 6: rate_amount suspiciously high (likely currency mismatch
      // where EGP got loaded into a USD column or similar). Threshold: anything
      // over $100,000 per container is almost certainly wrong.
      if (amt > 100000) {
        reasons.push('Rate amount unusually high ($' + amt.toLocaleString() + ') — possible currency mismatch');
      }

      return reasons;
    };

    // --- normalize a row for DB write: strip blanks, fix common date issues
    var cleanForDB = function (r) {
      var clean = {};
      for (var k in r) {
        var v = r[k];
        if (v === undefined) continue;
        // Empty-string dates → null (Postgres rejects '' on DATE).
        if (k === 'effective_date' || k === 'expiry_date' || k === 'booking_date') {
          if (v === '' || v === null) { continue; }
        }
        clean[k] = v;
      }
      return clean;
    };

    // --- 30-second timeout wrapper (resolves to {error} on timeout, never throws)
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

    // --- 5-key match builder per spec
    // v55.82-W (Max May 12 2026 — "make sure you use smart AI so if
    // something is capitalized or small cased they are the same and if
    // they are almost the same spelling then they are the same"):
    // normName collapses common variations so "CMA CGM" / "CMA-CGM" /
    // "cma cgm" all produce the same match key. Strips non-alphanumeric
    // characters and collapses whitespace. This is the SAFE half of
    // fuzzy matching — exact-after-normalization, not approximate.
    // Approximate (edit-distance) matching is too risky for silent
    // merges; see comments below for the flag-for-review path.
    var normName = function (s) {
      return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')   // strip punctuation/symbols, keep word boundaries
        .replace(/\s+/g, ' ')           // collapse whitespace
        .trim();
    };
    // v55.83-A.6.27.47 — Match key updated for expiry_date backfill use case.
    //
    // OLD key (broken for backfill): origin|destination|expiry_date|vendor|line
    //   Problem: many historical rows have NULL expiry_date. When the import file
    //   has expiry_date filled in, the key doesn't match, so the system inserts a
    //   duplicate row instead of updating the existing one to fill in expiry_date.
    //
    // NEW key: port_of_loading|port_of_discharge|effective_date|vendor|shipping_line
    //   - Identifies a unique shipping quote: specific port pair + specific sailing
    //     date (effective_date colloquially called "ETD") + specific vendor + line.
    //   - effective_date is well-populated on historical rows (unlike expiry_date).
    //   - Falls back to origin/destination when port_of_loading/discharge are blank
    //     (handles rows imported before the port fields existed).
    //
    // Reasoning for excluding expiry_date from the key: it's the field we're trying
    // to BACKFILL. If we keyed on it, the match would always fail for the rows we
    // most need to update.
    var keyFor = function (r) {
      var pol = normName(r.port_of_loading) || normName(r.origin);
      var pod = normName(r.port_of_discharge) || normName(r.destination);
      return [
        pol,
        pod,
        String(r.effective_date || '').trim(),
        normName(r.vendor_name),
        normName(r.shipping_line),
      ].join('|');
    };

    // --- compare an import row against an existing DB row to decide
    // "changed" vs "unchanged". We only compare fields that the import
    // provides (excluding match-key fields, which are by definition equal).
    var rowChanged = function (newRow, existingRow) {
      // v55.83-A.6.27.47 — skipKeys now matches the NEW match key fields.
      // expiry_date is NO LONGER in the skip list — it's a field we want to
      // detect changes on (e.g., NULL → real date) so it triggers the update.
      var skipKeys = {
        id: 1, created_at: 1, updated_at: 1,
        port_of_loading: 1, port_of_discharge: 1,
        origin: 1, destination: 1,           // also exempt — used as port fallback
        effective_date: 1,
        vendor_name: 1, shipping_line: 1,
      };
      for (var k in newRow) {
        if (skipKeys[k]) continue;
        var nv = newRow[k];
        var ev = existingRow[k];
        // Treat null/undefined/'' as equivalent so a blank import doesn't
        // count as a "change" vs an existing blank.
        if ((nv === null || nv === undefined || nv === '') && (ev === null || ev === undefined || ev === '')) continue;
        // Numeric compare for fee/numeric columns
        if (typeof ev === 'number' || typeof nv === 'number') {
          if (Number(nv || 0) !== Number(ev || 0)) return true;
          continue;
        }
        if (String(nv) !== String(ev)) return true;
      }
      return false;
    };

    // ============================================================
    // STEP 1 — pre-flight validation
    // ============================================================
    setImportStatus('Validating rows…');
    var validRows = []; // rows that passed validation, will attempt DB write
    var quarantineRows = []; // v55.83-A.6.27.7 — bad-data rows held for review
    // Generate a single batch_id for all quarantined rows from this import
    // so the user can see "the 44 rows from Tuesday's botched import" together.
    var batchId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(36).substring(2, 10));
    for (var vi = 0; vi < importData.length; vi++) {
      var rowNum = vi + 1;
      var raw = importData[vi];
      // Required fields per spec
      if (!raw.origin || String(raw.origin).trim() === '') {
        errors.push({ row: rowNum, field: 'origin', reason: 'Point of Origin / Loading is required' });
        counts.failed++;
        continue;
      }
      if (!raw.destination || String(raw.destination).trim() === '') {
        errors.push({ row: rowNum, field: 'destination', reason: 'Point of Destination is required' });
        counts.failed++;
        continue;
      }
      if (!raw.vendor_name || String(raw.vendor_name).trim() === '') {
        errors.push({ row: rowNum, field: 'vendor_name', reason: 'Freight Forwarder is required' });
        counts.failed++;
        continue;
      }
      // Date validations — these are the values that historically blew up
      // the whole import. Now they only fail their own row.
      var dErr = validateDate(raw.expiry_date, 'Expiration Date')
              || validateDate(raw.effective_date, 'Effective Date')
              || validateDate(raw.booking_date, 'Booking Date');
      if (dErr) {
        errors.push({ row: rowNum, field: 'date', reason: dErr });
        counts.failed++;
        continue;
      }
      // v55.83-A.6.27.7 — bad-data PATTERNS: row is parseable but semantically
      // broken (eff=exp, year-2000, etc.). Quarantine instead of importing.
      var badPatterns = validateBadDataPatterns(raw);
      if (badPatterns.length > 0) {
        quarantineRows.push({
          row_num: rowNum,
          raw_row: raw,
          errors: badPatterns,
          origin: raw.origin || '',
          destination: raw.destination || '',
          vendor_name: raw.vendor_name || '',
          effective_date_raw: raw.effective_date ? String(raw.effective_date) : '',
          expiry_date_raw: raw.expiry_date ? String(raw.expiry_date) : '',
          rate_amount: Number(raw.rate_amount || 0),
        });
        counts.quarantined = (counts.quarantined || 0) + 1;
        continue;
      }
      validRows.push({ rowNum: rowNum, data: cleanForDB(raw) });
    }
    setImportProgress(10);

    // ============================================================
    // STEP 2 — fetch existing rows scoped to vendors+origins seen
    // ============================================================
    setImportStatus('Looking up existing rates…');
    var existingByKey = {};
    var allExistingRows = [];
    if (validRows.length > 0) {
      var distinctVendors = Array.from(new Set(validRows
        .map(function (vr) { return String(vr.data.vendor_name || '').trim(); })
        .filter(function (v) { return v.length > 0; })));
      var distinctOrigins = Array.from(new Set(validRows
        .map(function (vr) { return String(vr.data.origin || '').trim(); })
        .filter(function (v) { return v.length > 0; })));

      var existingRes = await withTimeout(
        supabase.from('shipping_rates').select('*')
          .in('vendor_name', distinctVendors.length > 0 ? distinctVendors : ['__none__'])
          .in('origin', distinctOrigins.length > 0 ? distinctOrigins : ['__none__']),
        30000,
        'Fetch existing rates'
      );
      if (existingRes && !existingRes.error) {
        allExistingRows = existingRes.data || [];
        allExistingRows.forEach(function (row) { existingByKey[keyFor(row)] = row; });
      } else {
        // SELECT failed — abort BEFORE any writes. No data has been
        // touched. Show the error and bail out clean.
        setImportStep('done');
        setImportStatus('');
        alert('Could not load existing rates to compare against. Nothing was saved or changed.\n\n' +
              ((existingRes && existingRes.error && existingRes.error.message) || 'Unknown error.'));
        return;
      }
    }
    setImportProgress(20);

    // ============================================================
    // STEP 3 — per-row write loop, isolated try/catch each
    // ============================================================
    var importedKeySet = {}; // for full_sync diff later
    setImportStatus('Saving rows…');
    for (var ri = 0; ri < validRows.length; ri++) {
      var vr = validRows[ri];
      var rowKey = keyFor(vr.data);
      importedKeySet[rowKey] = true;
      var existing = existingByKey[rowKey];

      try {
        if (existing) {
          // CASE A or B — match exists
          if (!rowChanged(vr.data, existing)) {
            // CASE B — unchanged, skip
            counts.unchanged++;
          } else {
            // CASE A — update
            // Build a patch object: only fields the import provides + that differ
            var patch = {};
            for (var f in vr.data) {
              if (f === 'id') continue; // never touch primary key
              patch[f] = vr.data[f];
            }
            var updRes = await withTimeout(
              supabase.from('shipping_rates').update(patch).eq('id', existing.id),
              10000,
              'Update row ' + vr.rowNum
            );
            if (updRes && !updRes.error) {
              counts.updated++;
            } else {
              counts.failed++;
              errors.push({
                row: vr.rowNum,
                field: 'database',
                reason: 'Update failed: ' + ((updRes && updRes.error && updRes.error.message) || 'unknown')
              });
            }
          }
        } else {
          // CASE C — no match, insert as new
          var insRes = await withTimeout(
            supabase.from('shipping_rates').insert(vr.data),
            10000,
            'Insert row ' + vr.rowNum
          );
          if (insRes && !insRes.error) {
            counts.added++;
          } else {
            // CASE D — row failed. Try once more with any missing-column
            // stripped, then give up on this row only.
            var msg = ((insRes && insRes.error && insRes.error.message) || '').toLowerCase();
            var mm = msg.match(/column ['"]?(\w+)['"]? of relation/);
            if (!mm) mm = msg.match(/could not find the ['"]?(\w+)['"]? column/);
            if (mm) {
              var stripCol = mm[1];
              var retryData = Object.assign({}, vr.data);
              delete retryData[stripCol];
              var insRetry = await withTimeout(
                supabase.from('shipping_rates').insert(retryData),
                10000,
                'Insert row ' + vr.rowNum + ' retry'
              );
              if (insRetry && !insRetry.error) {
                counts.added++;
              } else {
                counts.failed++;
                errors.push({
                  row: vr.rowNum,
                  field: 'database',
                  reason: 'Insert failed: ' + ((insRetry && insRetry.error && insRetry.error.message) || 'unknown')
                });
              }
            } else {
              counts.failed++;
              errors.push({
                row: vr.rowNum,
                field: 'database',
                reason: 'Insert failed: ' + ((insRes && insRes.error && insRes.error.message) || 'unknown')
              });
            }
          }
        }
      } catch (rowErr) {
        // Catch-all so a JS error on one row never breaks the loop.
        counts.failed++;
        errors.push({
          row: vr.rowNum,
          field: 'database',
          reason: 'Unexpected error: ' + ((rowErr && rowErr.message) || String(rowErr))
        });
      }

      // Progress update every 10 rows or on the last row
      if (ri % 10 === 0 || ri === validRows.length - 1) {
        setImportProgress(20 + Math.floor((ri / Math.max(1, validRows.length)) * 70));
        setImportStatus('Saving rows… ' + (ri + 1) + ' / ' + validRows.length);
      }
    }
    setImportProgress(92);

    // ============================================================
    // STEP 4 — full_sync deletion (only if requested AND zero errors)
    // ============================================================
    if (importMode === 'full_sync') {
      if (counts.failed > 0) {
        // Spec: never destroy data when there's any sign of trouble.
        errors.push({
          row: 0,
          field: 'full_sync',
          reason: 'Full Sync delete step skipped because ' + counts.failed + ' row' + (counts.failed === 1 ? '' : 's') + ' failed validation/insert. Fix those rows and re-import.'
        });
      } else if (validRows.length === 0) {
        errors.push({
          row: 0,
          field: 'full_sync',
          reason: 'Full Sync delete step skipped because no valid rows were imported.'
        });
      } else {
        // Find existing rows NOT present in the import file. Restrict
        // deletion to the vendor+origin combos the import covered — we
        // only delete from the "world the import claims to fully cover."
        // This protects historical data for vendors/origins not in this file.
        var importedVendorsLower = {};
        var importedOriginsLower = {};
        validRows.forEach(function (vr2) {
          importedVendorsLower[String(vr2.data.vendor_name || '').trim().toLowerCase()] = true;
          importedOriginsLower[String(vr2.data.origin || '').trim().toLowerCase()] = true;
        });
        var toDelete = [];
        allExistingRows.forEach(function (er) {
          var k = keyFor(er);
          if (importedKeySet[k]) return; // matched in this import, keep
          // Only consider deleting if the row's vendor + origin both appear
          // somewhere in the import file. Otherwise leave it alone.
          var erVendor = String(er.vendor_name || '').trim().toLowerCase();
          var erOrigin = String(er.origin || '').trim().toLowerCase();
          if (importedVendorsLower[erVendor] && importedOriginsLower[erOrigin]) {
            toDelete.push(er.id);
          }
        });
        if (toDelete.length > 0) {
          setImportStatus('Removing ' + toDelete.length + ' rate' + (toDelete.length === 1 ? '' : 's') + ' missing from the file…');
          var delRes = await withTimeout(
            supabase.from('shipping_rates').delete().in('id', toDelete),
            30000,
            'Full sync delete'
          );
          if (delRes && !delRes.error) {
            counts.deleted = toDelete.length;
          } else {
            errors.push({
              row: 0,
              field: 'full_sync',
              reason: 'Full Sync delete failed: ' + ((delRes && delRes.error && delRes.error.message) || 'unknown') + '. New/updated rows above are still saved.'
            });
          }
        }
      }
    }

    // ============================================================
    // STEP 5 — audit log + summary
    // ============================================================
    var totalSaved = counts.added + counts.updated;
    if (totalSaved > 0 && myId) {
      try {
        await withTimeout(
          supabase.from('audit_log').insert({
            table_name: 'shipping_rates',
            record_id: null,
            action: 'bulk_import',
            changed_by: myId,
            new_values: {
              source: 'shipping-rate-import',
              mode: importMode,
              added: counts.added,
              updated: counts.updated,
              unchanged: counts.unchanged,
              failed: counts.failed,
              deleted: counts.deleted
            }
          }),
          5000,
          'Audit log'
        );
      } catch (_) {}
    }

    // v55.83-A.6.27.7 — persist quarantined rows to the holding table
    // so the user can review/fix/discard them later. If the table doesn't
    // exist yet (SQL not run), warn but don't fail the import — the user
    // will see the count in the result banner and can run the SQL.
    if (quarantineRows.length > 0) {
      setImportStatus('Saving ' + quarantineRows.length + ' row(s) to quarantine for review…');
      try {
        var qRecords = quarantineRows.map(function (q) {
          return {
            batch_id: batchId,
            row_num: q.row_num,
            raw_row: q.raw_row,
            errors: q.errors,
            origin: q.origin,
            destination: q.destination,
            vendor_name: q.vendor_name,
            effective_date_raw: q.effective_date_raw,
            expiry_date_raw: q.expiry_date_raw,
            rate_amount: q.rate_amount,
            imported_by: myId || null,
            outcome: 'pending',
          };
        });
        var qResp = await supabase.from('shipping_rates_import_quarantine').insert(qRecords);
        if (qResp && qResp.error) {
          console.warn('[import-quarantine] save failed:', qResp.error.message);
          // Mark quarantine save failure visibly so the user knows
          if (qResp.error.message && qResp.error.message.indexOf('does not exist') >= 0) {
            errors.push({
              row: 0,
              field: 'quarantine',
              reason: 'Quarantine table not created yet. Bad rows were SKIPPED but not saved for review. Ask the admin to run sql/v55-83-a-6-27-7-quarantine.sql in Supabase.'
            });
          } else {
            errors.push({
              row: 0,
              field: 'quarantine',
              reason: 'Could not save bad rows to quarantine: ' + qResp.error.message
            });
          }
        }
      } catch (qe) {
        console.warn('[import-quarantine] threw:', qe && qe.message);
      }
    }

    setImportProgress(100);
    setImportStep('done');
    setImportStatus('');
    // expose errors via state so the UI can render the detailed list
    setImportErrors(errors);
    setImportCounts(counts);

    // v55.82-P — REMOVED the modal alert() summary. The done screen below
    // already shows everything (count cards + scrollable error list +
    // field capture summary), and the alert pop-up had three problems:
    //   1. Browser-native alerts can't be copied from on most browsers
    //   2. Truncated to first 5 errors — full list was below anyway
    //   3. Blocked the UI thread + required an extra click to dismiss
    // The user sees the same data on the inline done screen, fully
    // scrollable, with copy buttons.
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
      <div className="bg-amber-50 rounded-lg p-3 mb-4 border border-amber-200"><h3 className="text-xs font-bold text-amber-900 mb-2">💰 Rates & Fees</h3>
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
        <div className="mt-2 text-right"><span className="text-xs text-slate-500">Total: </span><span className="text-lg font-extrabold text-amber-900">{fCur(Number(f.rateAmount||0)+Number(f.portFees||0)+Number(f.thcFees||0)+Number(f.docFees||0)+Number(f.customsFees||0)+Number(f.otherFees||0), f.currency||'USD')}</span></div></div>
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
      <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Pending</div><div className="text-lg font-extrabold text-amber-900">{quotes.filter(q=>q.status==='draft'||q.status==='sent').length}</div></div>
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
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-2 mb-3 text-[11px] text-amber-900">
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
        // v55.82-C — Rate trend chart, REWRITTEN per Max May 10 2026 spec:
        //   • X-axis = EXPIRATION DATE (was effective_date). Expiry tells us
        //     "this is the last day this price was good for" — that's how
        //     freight forwarders quote, and the right shape for negotiating.
        //   • Y per period = BEST PRICE (lowest = best for buyer) of any
        //     forwarder. Was AVG before, which let one expensive outlier
        //     drag the line up and disguise the real floor.
        //   • Bookings show as STARS at the booked rate on the date booked.
        //     Multiple bookings → multiple stars. Star tooltip shows
        //     vendor + reference + rate.
        //   • Empty fields safe: rows with no expiry_date or rate=0 are
        //     excluded from the trend; bookings with no booking_date or
        //     rate=0 are excluded from the stars layer. No NaN, no
        //     undefined-key explosions, no chart crashes.
        //
        // Filtering still respects rateHistoryDf / rateHistoryDt / hideExpired
        // controls so the chart and the table below stay in sync.
        // v55.83-A.6 (Max May 13 2026) — DATE FILTER LOGIC FIX.
        //
        // OLD logic kept a rate if (expiry || effective) was inside the window.
        // That dropped rates whose effective_date AND expiry_date were both
        // BEFORE the window's "from" date — even if they were carried forward
        // and still in use during the window. Result: the chart looked empty
        // or started its timeline LATE.
        //
        // NEW logic: keep a rate if its active window [effective, expiry]
        // overlaps the user's filter window [from, to] at all.
        //   rate active in window iff:
        //     effective_date <= filter_to (or no filter_to)
        //     AND (expiry_date >= filter_from OR expiry_date is null)
        var trendRates = routeHistory;
        if (rateHistoryDf || rateHistoryDt) {
          var fwFrom = rateHistoryDf || '';
          var fwTo = rateHistoryDt || '';
          trendRates = trendRates.filter(function (r) {
            var eff = r.effective_date || '';
            var exp = r.expiry_date || '';
            // Rate has to have started by the end of the window
            if (fwTo && eff && eff > fwTo) return false;
            // Rate has to still be active by the start of the window
            // (no expiry = still active forever)
            if (fwFrom && exp && exp < fwFrom) return false;
            return true;
          });
        }
        if (hideExpired) trendRates = trendRates.filter(r => !isExpired(r.expiry_date));

        var SYM = { USD: '$', EUR: '€', EGP: 'E£', GBP: '£', CNY: '¥', TRY: '₺', SAR: 'SR', AED: 'AED ' };
        var trendCurrencyCounts = {};
        trendRates.forEach(function(r) {
          var c = r.currency || 'USD';
          trendCurrencyCounts[c] = (trendCurrencyCounts[c] || 0) + 1;
        });
        var trendCurrencies = Object.keys(trendCurrencyCounts);
        // v55.83-A.6 — user override beats auto-pick. If the user clicked
        // a currency tab, honor it; otherwise pick the most-common currency.
        var autoCurrency = trendCurrencies.length > 0
          ? trendCurrencies.reduce(function(a, b) { return trendCurrencyCounts[a] > trendCurrencyCounts[b] ? a : b; })
          : 'USD';
        var chartCurrency = (chartCurrencyOverride && trendCurrencies.indexOf(chartCurrencyOverride) >= 0)
          ? chartCurrencyOverride
          : autoCurrency;
        var chartSym = SYM[chartCurrency] || (chartCurrency + ' ');
        var chartMixed = trendCurrencies.length > 1;
        var trendRatesForChart = trendRates.filter(function(r) { return (r.currency || 'USD') === chartCurrency; });

        // v55.82-C — period-over-period uses BEST price (Math.min) too,
        // matching the new chart aggregation. Was avg before; switching
        // to min keeps period-comparison consistent with what's plotted.
        var priorBest = null;
        var currentBest = null;
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
            var anchor = r.expiry_date || r.effective_date || '';
            return (r.currency || 'USD') === chartCurrency
              && anchor >= pStartIso
              && anchor <= pEndIso
              && Number(r.rate_amount || 0) > 0;
          });
          if (priorRates.length > 0) {
            priorBest = Math.min.apply(null, priorRates.map(function(r){ return Number(r.rate_amount || 0); }));
          }
          var currentValid = trendRatesForChart.filter(function(r){ return Number(r.rate_amount || 0) > 0; });
          if (currentValid.length > 0) {
            currentBest = Math.min.apply(null, currentValid.map(function(r){ return Number(r.rate_amount || 0); }));
          }
        }

        var allLinesInRoute = Array.from(new Set(routeHistory.map(r => r.shipping_line || '(no line)'))).sort();

        // v55.82-M — Chart logic REWRITTEN per Max May 12 2026 spec:
        //   1. X-axis is months along the EFFECTIVE-DATE timeline (was
        //      expiry_date), starting from the earliest effective month
        //      seen in this route's rates and running continuously to the
        //      latest meaningful month (no gaps).
        //   2. Each rate has an active window [effective_date, expiry_date].
        //      A rate is considered "active" in month M if it overlaps M
        //      at all — its effective_date is on/before the last day of M
        //      AND its expiry_date is null OR on/after the first day of M.
        //   3. For each month, look at all rates active that month and
        //      pick the BEST (lowest valid) price. Exclude expired ones
        //      if any active alternative exists.
        //   4. Carry-forward: if a month has zero active rates, repeat the
        //      most recent month's best price BUT marked "stale" so the
        //      UI can grey/dash it.
        //   5. Continuous months — every month from first to last (or
        //      today) is rendered.
        //   6. Each point carries sourceRateIds[] so a click resolves to
        //      the actual rate record in the table below.
        //
        // Filters above (chartShippingLine, period) still narrow the input
        // ratesForChart.

        // --- helper: zero-pad a month integer
        var pad2 = function(n) { return n < 10 ? '0' + n : '' + n; };
        // --- helper: increment a YYYY-MM string by one month
        var nextMonth = function(ym) {
          var y = parseInt(ym.substring(0,4), 10);
          var m = parseInt(ym.substring(5,7), 10);
          m += 1; if (m > 12) { m = 1; y += 1; }
          return y + '-' + pad2(m);
        };
        // --- helper: first day & last day of a YYYY-MM (as YYYY-MM-DD)
        var firstDayOf = function(ym) { return ym + '-01'; };
        var lastDayOf = function(ym) {
          var y = parseInt(ym.substring(0,4), 10);
          var m = parseInt(ym.substring(5,7), 10);
          // Last day = day 0 of next month
          var d = new Date(Date.UTC(m === 12 ? y+1 : y, m === 12 ? 0 : m, 0));
          return d.toISOString().substring(0,10);
        };

        // Filter rates: in selected currency, has effective_date, rate > 0.
        // Expiry can be null (means "still active, no end date").
        var validRatesForChart = trendRatesForChart.filter(function(r) {
          var eff = r.effective_date || '';
          var amt = Number(r.rate_amount || 0);
          return eff.length >= 10 && amt > 0;
        });

        // Build the continuous month timeline.
        // v55.83-A.6.27.2 → A.6.27.6 (Max May 15 2026) — Cap the start to
        // a sensible window. Previously bad data (year-2000 effective_date)
        // could make this loop generate 300+ months, collapsing every dot
        // into a single pixel column on the chart canvas.
        //
        // RULE (A.6.27.6): start = max of:
        //   - earliestInData (the actual oldest rate)
        //   - 24 months ago (default look-back; protects against bad data)
        //   - rateHistoryDf (user period filter, if set)
        // ... but NEVER more than 36 months ago, period. Even if a user
        // explicitly picks "3 Years", we cap at 36 months. Wider needs are
        // satisfied by the Historical Rates table below, not by the chart.
        var months = [];
        if (validRatesForChart.length > 0) {
          var earliestInData = validRatesForChart.reduce(function(acc, r) {
            var m = r.effective_date.substring(0,7);
            return (!acc || m < acc) ? m : acc;
          }, null);

          // Build candidate start dates and pick the LATEST (most-recent).
          var todayD = new Date();
          var monthsAgo = function (n) {
            var d = new Date(todayD); d.setMonth(d.getMonth() - n);
            return d.toISOString().slice(0, 7);
          };
          var defaultStart = monthsAgo(24);
          var hardCap = monthsAgo(36);   // absolute oldest the chart will go

          // Start with the LATER of (earliest data) and (default 24-mo).
          var firstMonth = earliestInData > defaultStart ? earliestInData : defaultStart;

          // If user explicitly set a period filter, respect it — but only
          // if it's NEWER than the 36-month hard cap. If user picked "All
          // Time" (rateHistoryDf=''), we keep the 24-month default.
          if (rateHistoryDf && rateHistoryDf.length >= 7) {
            var filterStart = rateHistoryDf.substring(0, 7);
            if (filterStart > firstMonth) firstMonth = filterStart;     // narrower wins
            // Otherwise their filter is wider than our default — keep default.
          }

          // Absolute hard floor: never go past 36 months even if data exists earlier.
          if (firstMonth < hardCap) firstMonth = hardCap;

          // Sanity: never go past today (end will fix the other side)
          var nowStr = todayD.toISOString().slice(0, 10);
          var endDateStr = rateHistoryDt && rateHistoryDt.length >= 10 ? rateHistoryDt : nowStr;
          validRatesForChart.forEach(function(r) {
            if (r.expiry_date && r.expiry_date > endDateStr) endDateStr = r.expiry_date;
          });
          var endMonth = endDateStr.substring(0,7);

          if (firstMonth > endMonth) firstMonth = endMonth;  // safety

          var cur = firstMonth;
          var safety = 0;
          while (cur <= endMonth && safety < 48) { // hard ceiling: 48 iterations
            months.push(cur);
            cur = nextMonth(cur);
            safety++;
          }
        }

        var LINE_COLORS = ['#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899','#14b8a6','#6366f1', '#06b6d4', '#a855f7', '#84cc16', '#f97316'];

        // v55.83-A.6 (Max May 13 2026) — THREE CHART VIEWS.
        //
        // chartView = 'floor'  → one line, market floor (lowest across all rates each month)
        // chartView = 'vendor' → one line per vendor_name (vendor comparison)
        // chartView = 'line'   → one line per shipping_line (Maersk / MSC / etc, legacy view)
        //
        // The chartShippingLine dropdown still works as a SCOPE filter:
        //   - 'all' = all data feeds the selected view
        //   - specific line = only rates from that shipping line feed the view
        //
        // breakdownField determines which field we group by. For 'floor' it's
        // null (no breakdown, just market-wide). For 'vendor' it's vendor_name,
        // for 'line' it's shipping_line.
        var breakdownField = null;
        if (chartView === 'vendor') breakdownField = 'vendor_name';
        else if (chartView === 'line') breakdownField = 'shipping_line';

        // Build the list of groups to plot. For 'floor', this stays empty —
        // we ONLY plot the market floor (_bestActive / _bestStale series).
        // For 'vendor' / 'line', we collect every distinct value of the
        // breakdown field that has at least one rate in our filtered set.
        var groupsToPlot = [];
        var ratesForView = validRatesForChart;
        if (chartShippingLine !== 'all') {
          ratesForView = ratesForView.filter(function (r) {
            return (r.shipping_line || '(no line)') === chartShippingLine;
          });
        }
        if (breakdownField) {
          var groupSet = {};
          ratesForView.forEach(function (r) {
            var v = (r[breakdownField] || '(none)').trim() || '(none)';
            groupSet[v] = true;
          });
          groupsToPlot = Object.keys(groupSet).sort();
          // Cap at 10 visible lines to avoid spaghetti — drop the least-data ones.
          if (groupsToPlot.length > 10) {
            var groupCounts = {};
            ratesForView.forEach(function (r) {
              var v = (r[breakdownField] || '(none)').trim() || '(none)';
              groupCounts[v] = (groupCounts[v] || 0) + 1;
            });
            groupsToPlot.sort(function (a, b) { return groupCounts[b] - groupCounts[a]; });
            groupsToPlot = groupsToPlot.slice(0, 10);
            groupsToPlot.sort();
          }
        }

        // Backward-compat: keep linesToPlot/breakdownActiveForLine names so
        // the rest of the chart code (legacy per-shipping-line path) still
        // works when chartView === 'line'.
        var linesToPlot = groupsToPlot;

        // v55.82-M — For each month, find the rates active that month and
        // pick the lowest. Carry forward the last known best if no active
        // rate exists. Each point gets a sourceRateIds[] for click → scroll.
        //
        // "Active in month M" definition:
        //   effective_date <= lastDayOf(M)  AND
        //   (expiry_date is null OR expiry_date >= firstDayOf(M))
        //
        // Per-line carry-forward state: lastBestForLine[L] = { price, rateId, asOfMonth }.
        // Same for the "_best" market floor: lastBest = { ... }.
        var lastBestForLine = {};
        var lastBest = null;
        // v55.83-A.6.24 (Max May 14 2026) — Track the previous point so we
        // can BACK-WRITE _bestStale onto it at a solid→dashed transition.
        // Without this back-write, the dashed line starts at month N+1 with
        // no value at month N, leaving a visual gap between the solid line
        // (ending at N) and the dashed line (starting at N+1). The dashed→solid
        // bridge already works because we write _bestStale on the CURRENT
        // (newly active) point, completing the dashed segment's endpoint.
        // Symmetric back-write needed here.
        var prevPoint = null;

        var trendPoints = months.map(function(m) {
          var monthStart = firstDayOf(m);
          var monthEnd = lastDayOf(m);
          // v55.83-A.6.27.8 (Max May 15 2026) — UNIFIED ACTIVE-IN-MONTH RULE
          //
          // The chart MUST match the "Best Active" stat tile and the Vendor
          // Comparison table for the current month. Previously two attempts:
          //   A.6.27.7: rate active in M iff (eff <= monthEnd AND exp >= monthEnd)
          //             → broke May 2026 because a $3,575 rate expiring May 30
          //                doesn't survive through May 31, so it got dropped.
          //                Chart showed $3,050 (lowest historical) instead of $3,575.
          //   Pre-A.6.27.7: rate active in M iff window overlaps M at any point
          //             → broke May because a rate effective May 1 expiring May 3
          //                counted as "active in May" even though it's long expired.
          //
          // CORRECT RULE — use a REFERENCE DATE that's:
          //   - For the current month (or future): today's date (matches "Best Active")
          //   - For past months: last day of that month (was it bookable at month-end?)
          //
          // In one line: refDate = min(monthEnd, today). The rate is "active in M"
          // iff effective <= refDate AND (no expiry OR expiry >= refDate).
          //
          // This means for May 2026 viewed today (May 15), refDate = May 15:
          //   - Miami $3,575 exp May 30: eff <= May 15 ✓, exp May 30 >= May 15 ✓ → ACTIVE
          //   - Chart's May point = $3,575 → matches stat tile + Vendor Comparison
          //
          // For April 2026 (past), refDate = April 30:
          //   - A rate that expired April 13 → not active at month-end → drops to
          //     CASE 2 (stale dashed grey) if no fresher April rate exists
          //
          // The expiry-marker layer (red ✕) is unchanged — it still marks every
          // month a rate expired in, so the user sees the expiry events. It's
          // SECONDARY visual data; it does NOT drive the main trend line.
          var todayStrForChart = todayET();
          var refDate = monthEnd < todayStrForChart ? monthEnd : todayStrForChart;
          var activeInMonth = ratesForView.filter(function(r) {
            var eff = r.effective_date;
            var exp = r.expiry_date || ''; // empty = never expires
            return eff <= refDate && (exp === '' || exp >= refDate);
          });

          var point = { month: m };
          var pointSourceIds = [];

          // v55.83-A.6.3 → A.6.24 (Max May 14 2026) — spec update:
          // "The same logic must apply across all toggles: Market Floor,
          // By Vendor, By Line." Previously CASE 2 carried forward as solid
          // (single dataKey per group). Now each group writes to TWO data
          // keys — `G__active` (solid color) and `G__stale` (dashed grey
          // version of the same color) — mirroring the market floor's
          // _bestActive / _bestStale system. The line stays visually
          // continuous (solid → dashed → solid) without gaps.
          linesToPlot.forEach(function(G) {
            var activeForGroup = activeInMonth.filter(function(r) {
              if (!breakdownField) return false;
              var v = (r[breakdownField] || '(none)').trim() || '(none)';
              return v === G;
            });
            var prevPriceForG = lastBestForLine[G] && lastBestForLine[G].price;
            var prevWasStaleForG = lastBestForLine[G] && lastBestForLine[G].wasStale;

            if (activeForGroup.length > 0) {
              // CASE 1 — active rate this month for this group. Solid.
              var winner = activeForGroup.reduce(function(acc, r) {
                if (!acc) return r;
                return Number(r.rate_amount) < Number(acc.rate_amount) ? r : acc;
              }, null);
              var winPrice = Number(winner.rate_amount);
              point[G + '__active'] = winPrice;
              // Keep legacy `G` field too so existing tooltip/click code that
              // reads `point[G]` keeps working.
              point[G] = winPrice;
              point['__stale__' + G] = false;
              point['__source__' + G] = winner.id;
              pointSourceIds.push(winner.id);
              // Bridge dashed → solid: if prev month was stale, write
              // G__stale at this same Y so the dashed segment ends here.
              if (prevWasStaleForG) {
                point[G + '__stale'] = winPrice;
              }
              lastBestForLine[G] = { price: winPrice, rateId: winner.id, asOfMonth: m, wasStale: false };
            } else if (lastBestForLine[G]) {
              // CASE 2 — carry forward last known best as STALE (dashed).
              // Bridge solid → dashed: if previous month was fresh, back-write
              // G__stale onto the PREVIOUS point at its active value so the
              // dashed line starts from the previous point.
              if (prevWasStaleForG === false && prevPoint && prevPoint[G + '__active'] != null) {
                prevPoint[G + '__stale'] = prevPoint[G + '__active'];
              }
              point[G + '__stale'] = lastBestForLine[G].price;
              point[G] = lastBestForLine[G].price; // back-compat
              point['__stale__' + G] = true;
              point['__source__' + G] = lastBestForLine[G].rateId;
              pointSourceIds.push(lastBestForLine[G].rateId);
              lastBestForLine[G].wasStale = true;
            } else {
              // CASE 3 — no prior best known. Bootstrap as ACTIVE (solid).
              var fallbackForGroup = null;
              for (var fbgi = 0; fbgi < ratesForView.length; fbgi++) {
                var fbgr = ratesForView[fbgi];
                if (!fbgr.effective_date || fbgr.effective_date > monthEnd) continue;
                if (Number(fbgr.rate_amount || 0) <= 0) continue;
                if (!breakdownField) continue;
                var fbgrG = (fbgr[breakdownField] || '(none)').trim() || '(none)';
                if (fbgrG !== G) continue;
                if (!fallbackForGroup || Number(fbgr.rate_amount) < Number(fallbackForGroup.rate_amount)) {
                  fallbackForGroup = fbgr;
                }
              }
              if (fallbackForGroup) {
                var fbPrice = Number(fallbackForGroup.rate_amount);
                point[G + '__active'] = fbPrice;
                point[G] = fbPrice;
                point['__stale__' + G] = false;
                point['__source__' + G] = fallbackForGroup.id;
                pointSourceIds.push(fallbackForGroup.id);
                lastBestForLine[G] = { price: fbPrice, rateId: fallbackForGroup.id, asOfMonth: m, wasStale: false };
              }
            }
          });

          // v55.83-A.6.4 (Max May 13 2026 — "the icon should still be a line
          // but like a dashed grey line to indicate expired and no fresh rate"):
          //
          // The chart now uses TWO continuous lines:
          //   _bestActive (solid dark) — months where a fresh rate IS active
          //   _bestStale  (dashed grey) — months where the best known rate has
          //                               EXPIRED and no fresh replacement exists
          //
          // The line is ALWAYS continuous from the earliest effective_date
          // forward — no blank gaps. The visual switches from solid to dashed
          // grey at the point of expiration, then back to solid when a new
          // fresh rate appears. The two lines join visually because they
          // share the same Y value at the transition month.
          //
          // The ✕ markers (added in v55.83-A.6.2) still show each rate's
          // exact expiry date. Combined with the dashed grey segment, you
          // see both WHEN a rate expired AND that there's no fresh data
          // covering that period.
          if (activeInMonth.length > 0) {
            // CASE 1: Active rate exists in this month — solid line.
            var bestRow = activeInMonth.reduce(function(acc, r) {
              if (!acc) return r;
              return Number(r.rate_amount) < Number(acc.rate_amount) ? r : acc;
            }, null);
            point._bestActive = Number(bestRow.rate_amount);
            // Also write _bestStale at the SAME value at transition month
            // so the dashed line "meets" the solid line — no visual gap.
            // Only at transition though; clear it elsewhere via undefined.
            point._best = Number(bestRow.rate_amount); // back-compat for tooltip
            point.__stale___best = false;
            point.__source___best = bestRow.id;
            if (pointSourceIds.indexOf(bestRow.id) < 0) pointSourceIds.push(bestRow.id);
            // Bridge dashed → solid: if the previous month was stale, write
            // _bestStale on THIS point too so the dashed line ends here cleanly.
            if (lastBest && lastBest.wasStale) {
              point._bestStale = Number(bestRow.rate_amount);
            }
            lastBest = { price: Number(bestRow.rate_amount), rateId: bestRow.id, asOfMonth: m, wasStale: false };
          } else if (lastBest) {
            // CASE 2: No active rate this month — carry forward as STALE
            // (dashed grey line). Write _bestStale, NOT _bestActive.
            // v55.83-A.6.24 (Max May 14 2026) — Detect solid→dashed transition
            // and back-write _bestStale onto the PREVIOUS point so the dashed
            // line starts at the previous month (joining the solid line
            // visually) instead of starting at the current month (leaving a
            // gap). Detection: `lastBest.wasStale === false` here means the
            // previous month was active (solid). prevPoint is the trendPoint
            // object for that previous month — give it _bestStale at the
            // active value so the dashed segment has an anchor there.
            if (lastBest.wasStale === false && prevPoint && prevPoint._bestActive != null) {
              prevPoint._bestStale = prevPoint._bestActive;
            }
            point._bestStale = lastBest.price;
            point._best = lastBest.price; // back-compat for tooltip
            point.__stale___best = true;
            point.__source___best = lastBest.rateId;
            if (pointSourceIds.indexOf(lastBest.rateId) < 0) pointSourceIds.push(lastBest.rateId);
            // Bridge solid → dashed: if the PREVIOUS month was fresh, also
            // write _bestStale at the PRIOR fresh value so dashed starts
            // exactly where solid ends. (Handled by previous-month write below.)
            lastBest.wasStale = true;
          } else {
            // CASE 3: No active rate AND no prior best known. Look BACKWARD
            // through all rates for the most recent effective_date <= this
            // month's end. Bootstrap case — should fire for the very first
            // month if no rate is active in it yet but the timeline started
            // there. Without this, the first month would be blank.
            var fallbackBest = null;
            for (var fbi = 0; fbi < ratesForView.length; fbi++) {
              var fbr = ratesForView[fbi];
              if (!fbr.effective_date || fbr.effective_date > monthEnd) continue;
              if (Number(fbr.rate_amount || 0) <= 0) continue;
              if (!fallbackBest || Number(fbr.rate_amount) < Number(fallbackBest.rate_amount)) {
                fallbackBest = fbr;
              }
            }
            if (fallbackBest) {
              // Bootstrap as ACTIVE (solid) because we just found a rate
              // whose effective_date covers this month even though
              // activeInMonth missed it (this can happen if the rate's
              // active-in-month check fails for some edge case).
              point._bestActive = Number(fallbackBest.rate_amount);
              point._best = Number(fallbackBest.rate_amount);
              point.__stale___best = false;
              point.__source___best = fallbackBest.id;
              if (pointSourceIds.indexOf(fallbackBest.id) < 0) pointSourceIds.push(fallbackBest.id);
              lastBest = { price: Number(fallbackBest.rate_amount), rateId: fallbackBest.id, asOfMonth: m, wasStale: false };
            }
          }

          point.__sourceIds__ = pointSourceIds;
          // v55.83-A.6.24 — capture this point as prevPoint so the NEXT
          // iteration's back-write (solid→dashed bridge) can see it.
          prevPoint = point;
          return point;
        });

        // v55.83-A.6.5 (Max May 13 2026 — "from left to right it should be
        // the older date to the newer dates first of all"):
        //
        // PROBLEM: passing expiryMarkers as a separate <Scatter data={...}>
        // caused Recharts to APPEND those months to the X-axis AFTER the
        // sorted trendPoints months — resulting in "2026-05, 2026-05, ...,
        // 2025-12, 2025-12" (mixed order). The X-axis categories are derived
        // from the UNION of every <Line> and <Scatter> data array in
        // ComposedChart, in the order encountered.
        //
        // FIX: deduplicate expiry markers BY MONTH (so 3 rates expiring in
        // the same month show as ONE ✕), and write them directly into the
        // matching trendPoint as an `__expiredCount__` field + an
        // `__expiredAtY__` field carrying the average expired price. Then
        // <Scatter> reads from trendPoints (same data array) — X-axis stays
        // sorted.
        var rawExpiryRows = ratesForView
          .filter(function (r) {
            var exp = r.expiry_date || '';
            var amt = Number(r.rate_amount || 0);
            return exp.length >= 7 && amt > 0;
          });

        // Group by month for dedup
        var expiryByMonth = {};
        rawExpiryRows.forEach(function (r) {
          var m = (r.expiry_date || '').substring(0, 7);
          if (!expiryByMonth[m]) expiryByMonth[m] = { rates: [], total: 0, count: 0 };
          expiryByMonth[m].rates.push(r);
          expiryByMonth[m].total += Number(r.rate_amount || 0);
          expiryByMonth[m].count++;
        });

        // Write dedup-by-month info into the matching trendPoint
        Object.keys(expiryByMonth).forEach(function (m) {
          var bucket = expiryByMonth[m];
          var avgPrice = bucket.total / bucket.count;
          // Find or create the trendPoint for this month
          var pt = trendPoints.find(function (p) { return p.month === m; });
          if (!pt) {
            // Expiry month not in trendPoints (extends past last data month
            // or before first). Add a sparse point so the ✕ renders, with
            // no line value.
            pt = { month: m };
            trendPoints.push(pt);
            if (months.indexOf(m) < 0) months.push(m);
          }
          pt.__expiredCount__ = bucket.count;
          pt.__expiredAtY__ = avgPrice;
          pt.__expiredVendors__ = bucket.rates.map(function (r) {
            return (r.vendor_name || '?') + (r.shipping_line ? '/' + r.shipping_line : '');
          }).join(', ');
        });

        // Re-sort after potential additions
        trendPoints.sort(function(a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
        months.sort();

        // For backwards compatibility with the rest of the chart code,
        // expose a count of how many distinct expiry months exist.
        var expiryMarkersCount = Object.keys(expiryByMonth).length;

        // v55.83-A.6.2 — data-quality counters surfaced in the chart caption
        // so the user can SEE why fewer rates show than total. Counts include
        // rates dropped from this chart's view due to specific exclusions.
        var dataQuality = {
          totalInRoute: routeHistory.length,
          inSelectedCurrency: trendRatesForChart.length,
          afterPeriodFilter: trendRates.length,
          validForChart: validRatesForChart.length,
          missingEffective: routeHistory.filter(function (r) {
            var eff = r.effective_date || '';
            return eff.length < 10;
          }).length,
          missingAmount: routeHistory.filter(function (r) {
            return !(Number(r.rate_amount || 0) > 0);
          }).length,
          missingCurrency: routeHistory.filter(function (r) {
            return !r.currency || r.currency.trim() === '';
          }).length,
          expiryBeforeEffective: routeHistory.filter(function (r) {
            return r.expiry_date && r.effective_date && r.expiry_date < r.effective_date;
          }).length,
        };

        // v55.82-C — Booking stars layer. Each booked rate becomes a dot
        // on the chart at (booking_date_month, rate_amount). Plotting on
        // booking_date because the user wants to see "what price did we
        // book at, when". Defensively skip booked rows where booking_date
        // or rate is missing.
        var bookingStars = trendRatesForChart
          .filter(function(r) {
            if (!r.booked) return false;
            var bd = r.booking_date || r.effective_date || '';
            var amt = Number(r.rate_amount || 0);
            return bd.length >= 7 && amt > 0;
          })
          .map(function(r) {
            return {
              month: (r.booking_date || r.effective_date || '').substring(0,7),
              booked_rate: Number(r.rate_amount || 0),
              vendor: r.vendor_name || '',
              line: r.shipping_line || '',
              ref: r.shipment_reference || '',
              container: r.container_type || '',
              full_date: r.booking_date || r.effective_date || '',
              __sourceId__: r.id,
            };
          });
        // Make sure every booking-star month is also a valid X-axis category.
        bookingStars.forEach(function(b) {
          if (months.indexOf(b.month) < 0) {
            trendPoints.push({ month: b.month, __sourceIds__: [b.__sourceId__] });
            months.push(b.month);
          }
        });
        trendPoints.sort(function(a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
        months.sort();

        // v55.83-A.6.27.4 (Max May 15 2026) — write bookings into trendPoints.
        //
        // ROOT CAUSE OF THE "CHART ONLY SHOWS 2026-05" BUG:
        // Recharts ComposedChart was given THREE data arrays:
        //   1. trendPoints (13 months, attached to chart-level `data` prop)
        //   2. bookingStars (1 entry, 2026-05, attached to Scatter's own `data` prop)
        //   3. expiryMarkers (was a separate array — fixed in v55.83-A.6.5)
        //
        // With the booking Scatter still using its own data array, Recharts
        // re-builds the X-axis from the union — but when one of the data
        // arrays is much shorter, the auto-scale compresses the dense data
        // toward one side. Result: 12 of the 13 trendPoints rendered at
        // ~0 pixel width on the left edge (invisible), with everything
        // crammed into 2026-05 on the right.
        //
        // FIX (same pattern as A.6.5 applied to expirations): write the
        // booking value into the matching trendPoint as a __bookedAtY__
        // field. The Scatter then reads from trendPoints (chart-level data)
        // and the X-axis stops scrambling.
        bookingStars.forEach(function (b) {
          var pt = trendPoints.find(function (p) { return p.month === b.month; });
          if (pt) {
            // Multiple bookings in the same month: keep the highest (most
            // visible). Could average or list — keeping max for clarity.
            if (!pt.__bookedAtY__ || b.booked_rate > pt.__bookedAtY__) {
              pt.__bookedAtY__ = b.booked_rate;
              pt.__bookedRef__ = b.ref;
              pt.__bookedVendor__ = b.vendor;
              pt.__bookedFullDate__ = b.full_date;
            }
          }
        });

        if (trendPoints.length === 0 && bookingStars.length === 0) {
          return (<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold">📈 Best Rate Over Time</h3>
            </div>
            <div className="text-xs text-slate-500 py-6 text-center">No rate data with effective dates in the selected period. Add effective dates to your rates so they show up on the trend, or try a longer time range.</div>
          </div>);
        }

        // Custom star shape for the booking dots. Recharts' Scatter takes
        // a "shape" prop that can be a function returning SVG. Drawing a
        // 5-point star — gold fill, black stroke for visibility on any
        // backing line color.
        var StarShape = function(props) {
          var cx = props.cx;
          var cy = props.cy;
          if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return null;
          var s = 9; // size
          // 5-point star path
          var pts = [];
          for (var i = 0; i < 10; i++) {
            var r = i % 2 === 0 ? s : s * 0.45;
            var a = (Math.PI / 5) * i - Math.PI / 2;
            pts.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2));
          }
          return (<polygon points={pts.join(' ')} fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" />);
        };

        // v55.83-A.6.5 (Max May 13 2026) — Expiration marker shape with
        // dedup count badge. When multiple rates expire in the same month,
        // show ✕ with a small "×N" label so the chart isn't cluttered with
        // 14 separate ✕'s when 5 rates expired in the same month.
        var ExpiryMarkerShape = function(props) {
          var cx = props.cx;
          var cy = props.cy;
          if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return null;
          var pl = props.payload || {};
          var count = Number(pl.__expiredCount__ || 1);
          var s = 5;
          return (
            <g style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
              <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} stroke="#dc2626" strokeWidth="2" />
              <line x1={cx - s} y1={cy + s} x2={cx + s} y2={cy - s} stroke="#dc2626" strokeWidth="2" />
              {count > 1 && (
                <text x={cx + 8} y={cy - 4} fontSize={9} fill="#dc2626" fontWeight="bold" style={{userSelect:'none', pointerEvents:'none'}}>×{count}</text>
              )}
            </g>
          );
        };

        // v55.82-M — Click handler: when user clicks a chart point, scroll
        // to and flash-highlight the matching rate row in the table below.
        // Recharts passes the clicked datapoint's payload to onClick of the
        // chart container; we pull the first sourceId from __sourceIds__.
        var handleChartClick = function(state) {
          if (!state || !state.activePayload || !state.activePayload[0]) return;
          var payload = state.activePayload[0].payload;
          if (!payload || !payload.__sourceIds__ || payload.__sourceIds__.length === 0) return;
          var firstId = payload.__sourceIds__[0];
          setHighlightedRateId(firstId);
          // Defer the scroll so React paints the highlight class first.
          setTimeout(function() {
            if (typeof document !== 'undefined') {
              var el = document.getElementById('rate-row-' + firstId);
              if (el && el.scrollIntoView) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }
          }, 50);
        };

        // v55.83-A.6.4 (Max May 13 2026) — Dot renderer. With the new
        // _bestActive solid + _bestStale dashed-grey two-line system, the
        // ⏳ icon overlay is no longer needed — the dashed grey line itself
        // visually indicates "expired, no fresh rate". Just draw a solid
        // dot in the line's color.
        var makeDotRenderer = function(lineKey, fillColor) {
          return function(dotProps) {
            var cx = dotProps.cx;
            var cy = dotProps.cy;
            if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return null;
            return (<circle cx={cx} cy={cy} r={3.5} fill={fillColor} stroke={fillColor} strokeWidth={1} />);
          };
        };

        return (<div className="bg-white rounded-xl p-4 mb-4 border border-slate-200">
          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold">📈 Best Rate Over Time ({chartCurrency})</h3>
              <div className="text-[10px] text-slate-500">X-axis: month · Y-axis: best historical rate · <b>solid line</b> = active rate · <span className="text-slate-600">dashed grey</span> = expired, no fresh rate · ⭐ = booking · ✕ = rate expired · click any point → jump to the rate below</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* v55.83-A.6 — View toggle (Floor / Vendor / Line) */}
              <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 text-[11px] font-bold">
                <button
                  onClick={function(){ setChartView('floor'); }}
                  className={'px-2.5 py-1 ' + (chartView === 'floor' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}
                  title="One line — lowest price each month across all vendors/lines">
                  🏆 Market Floor
                </button>
                <button
                  onClick={function(){ setChartView('vendor'); }}
                  className={'px-2.5 py-1 ' + (chartView === 'vendor' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}
                  title="One line per vendor, each showing their best monthly rate">
                  🏢 By Vendor
                </button>
                <button
                  onClick={function(){ setChartView('line'); }}
                  className={'px-2.5 py-1 ' + (chartView === 'line' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}
                  title="One line per shipping line (Maersk / MSC / etc)">
                  🚢 By Line
                </button>
              </div>
              {/* Shipping-line SCOPE filter (independent of view) */}
              <span className="text-[10px] text-slate-500">Scope:</span>
              <select value={chartShippingLine} onChange={function(e){ setChartShippingLine(e.target.value); }} className="px-2 py-1 rounded border text-xs">
                <option value="all">All lines</option>
                {allLinesInRoute.map(function(L){ return (<option key={L} value={L}>{L}</option>); })}
              </select>
            </div>
          </div>
          {/* v55.83-A.6 — Currency tabs (only show when there's more than one) */}
          {trendCurrencies.length > 1 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-slate-500">Currency:</span>
              <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 text-[10px] font-bold">
                {trendCurrencies.map(function(c) {
                  return (
                    <button key={c}
                      onClick={function(){ setChartCurrencyOverride(c); }}
                      className={'px-2 py-0.5 ' + (chartCurrency === c ? 'bg-violet-700 text-white' : 'bg-white text-slate-700 hover:bg-violet-50')}
                      title={'Show ' + c + ' rates only (' + trendCurrencyCounts[c] + ' rate' + (trendCurrencyCounts[c] === 1 ? '' : 's') + ')'}>
                      {(SYM[c] || c).trim()} {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {chartMixed && (
            <div className="bg-amber-50 border border-amber-300 rounded p-2 mb-2 text-[11px] text-amber-900">
              ⚠️ This route has rates in {trendCurrencies.length} currencies ({trendCurrencies.join(', ')}). Currently showing {chartCurrency}. Use the currency tabs above to switch.
            </div>
          )}
          {priorBest !== null && currentBest !== null && (
            <div className={'rounded p-2 mb-2 text-[11px] ' + (currentBest > priorBest ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800')}>
              {currentBest > priorBest ? '↗' : '↘'} Period-over-period (best price): {chartSym}{Math.round(currentBest).toLocaleString()} vs prior best {chartSym}{Math.round(priorBest).toLocaleString()} ({(((currentBest - priorBest) / priorBest) * 100).toFixed(1)}%)
            </div>
          )}
          <div style={{width: '100%', height: 300}}>
            <ResponsiveContainer>
              <ComposedChart data={trendPoints} margin={{top: 10, right: 20, left: 0, bottom: 10}} onClick={handleChartClick}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{fontSize: 10}} />
                <YAxis tick={{fontSize: 10}} tickFormatter={function(v){ return chartSym + v; }} />
                <RTooltip
                  formatter={function(v, name, p){
                    // v55.83-A.6.27.4 — bookings dataKey changed from
                    // booked_rate (own data array) to __bookedAtY__
                    // (trendPoints-attached). Tooltip accepts either.
                    if (name === 'booked_rate' || name === '__bookedAtY__' || name === 'Bookings') {
                      var pl = p && p.payload ? p.payload : {};
                      // Field names differ between old data array and new
                      // trendPoint embedding. Pull from either source.
                      var vendor = pl.vendor || pl.__bookedVendor__ || '?';
                      var ref = pl.ref || pl.__bookedRef__ || '';
                      var fullDate = pl.full_date || pl.__bookedFullDate__ || '';
                      return [chartSym + Number(v).toLocaleString() + ' ⭐ ' + vendor + (ref ? ' (' + ref + ')' : ''), 'Booking ' + fullDate];
                    }
                    if (name === '__expiredAtY__' || name === 'Expirations') {
                      // v55.83-A.6.5 — expiry marker tooltip, deduplicated by month
                      var pl3 = p && p.payload ? p.payload : {};
                      var cnt = Number(pl3.__expiredCount__ || 1);
                      var label = chartSym + Number(v).toLocaleString() + ' ✕ ' + (cnt > 1 ? cnt + ' rates expired' : '1 rate expired');
                      return [label, pl3.__expiredVendors__ || 'Expired'];
                    }
                    // v55.82-M — append "stale (last known)" indicator if this
                    // point is a carry-forward.
                    var pl2 = p && p.payload ? p.payload : {};
                    var staleKey = (name === 'Market best' || name === '_best') ? '__stale___best' : ('__stale__' + name);
                    var isStale = !!pl2[staleKey];
                    var label = chartSym + Number(v).toLocaleString() + (isStale ? ' (last known — no newer rate)' : '');
                    return [label, name];
                  }}
                />
                <RLegend wrapperStyle={{fontSize: 11}} />
                {/* v55.83-A.6.4 (Max May 13 2026) — TWO continuous lines for
                    Market Floor view:
                      _bestActive (solid dark, weight 3) — fresh rates
                      _bestStale  (dashed grey, weight 2) — expired with no replacement
                    Both use connectNulls so the line draws across the entire
                    timeline. Bridge writes at transition months ensure the
                    solid and dashed segments visually meet. */}
                {chartView === 'floor' ? (
                  <>
                    {/* v55.83-A.6.26 (Max May 14 2026) — color fix.
                        Previously stroke="#0f172a" (slate-950) which was
                        invisible against the dark theme background — looked
                        like the line had a gap between 2026-04 and 2026-05
                        when in fact the segment WAS being drawn, just in
                        a near-black color on a near-black background. Switched
                        to #38bdf8 (sky-400) which is high-contrast on both
                        dark and light themes. */}
                    <Line type="monotone" dataKey="_bestActive" name="Active rate" stroke="#38bdf8" strokeWidth={3} connectNulls={true} dot={{r: 4, fill: '#38bdf8', stroke: '#38bdf8'}} activeDot={{r: 7, stroke: '#38bdf8', strokeWidth: 2, fill: '#fff', cursor: 'pointer'}} />
                    <Line type="monotone" dataKey="_bestStale" name="Expired — no fresh rate" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 4" connectNulls={true} dot={{r: 3, fill: '#94a3b8', stroke: '#94a3b8'}} activeDot={{r: 6, stroke: '#94a3b8', strokeWidth: 2, fill: '#fff', cursor: 'pointer'}} />
                  </>
                ) : (
                  // v55.83-A.6.24 (Max May 14 2026) — per-group view (By Vendor /
                  // By Line) now emits TWO <Line> elements per group, mirroring
                  // the market floor's active/stale pair:
                  //   `${G}__active` — solid in the group's color
                  //   `${G}__stale`  — dashed in a desaturated/grey-tinted version
                  // connectNulls on both makes the line bridge transition months
                  // (the data layer already writes the bridge values).
                  groupsToPlot.map(function(G, i) {
                    var col = LINE_COLORS[i % LINE_COLORS.length];
                    return (
                      <Fragment key={G}>
                        <Line type="monotone" dataKey={G + '__active'} name={G}
                          stroke={col} strokeWidth={2} connectNulls={true}
                          dot={makeDotRenderer(G, col)}
                          activeDot={{r: 6, stroke: col, strokeWidth: 2, fill: '#fff', cursor: 'pointer'}}
                          legendType="none" />
                        <Line type="monotone" dataKey={G + '__stale'} name={G + ' (expired)'}
                          stroke={col} strokeWidth={2} strokeOpacity={0.5}
                          strokeDasharray="6 4" connectNulls={true}
                          dot={{r: 3, fill: col, stroke: col, fillOpacity: 0.5}}
                          activeDot={{r: 6, stroke: col, strokeWidth: 2, fill: '#fff', cursor: 'pointer'}}
                          legendType="none" />
                      </Fragment>
                    );
                  })
                )}
                {/* v55.83-A.6.27.4 — Bookings Scatter now reads from
                    trendPoints (chart-level data) via __bookedAtY__ field
                    instead of having its own data array. This was the
                    silent bug crushing 12 of 13 month dots into a single
                    pixel column. Same fix that A.6.5 applied to Expirations. */}
                {bookingStars.length > 0 && (
                  <Scatter
                    name="Bookings"
                    dataKey="__bookedAtY__"
                    shape={StarShape}
                  />
                )}
                {/* v55.83-A.6.5 — Expiry markers scatter now reads from
                    trendPoints (same data array as the lines) so the X-axis
                    stays sorted chronologically. Each trendPoint may carry
                    an __expiredAtY__ field (avg of all rates expiring that
                    month) that drives the ✕ Y position. dataKey is the
                    deduplicated value. */}
                {expiryMarkersCount > 0 && (
                  <Scatter
                    name="Expirations"
                    dataKey="__expiredAtY__"
                    shape={ExpiryMarkerShape}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {/* v55.83-A.6.2 — Inline data-quality warning. Surface the gap between
              "rates in this route" and "rates the chart can plot" so the user
              knows WHY a number is smaller. Max screenshot: 14 rates / 10 active
              in the header, but only some show on the chart. This row tells
              you exactly which exclusions ate the difference. */}
          {(dataQuality.totalInRoute > dataQuality.validForChart) && (
            <div className="bg-amber-50 border border-amber-300 rounded p-2 mb-2 mt-2 text-[11px] text-amber-900">
              <div className="font-bold mb-1">📊 Chart shows {dataQuality.validForChart} of {dataQuality.totalInRoute} rates on this route:</div>
              <ul className="ml-4 space-y-0.5">
                {dataQuality.totalInRoute - dataQuality.inSelectedCurrency > 0 && (
                  <li>• {dataQuality.totalInRoute - dataQuality.inSelectedCurrency} in other currencies — switch currency tabs above to see them</li>
                )}
                {dataQuality.inSelectedCurrency - dataQuality.afterPeriodFilter > 0 && (
                  <li>• {dataQuality.inSelectedCurrency - dataQuality.afterPeriodFilter} outside the period filter — change the Period buttons below to widen</li>
                )}
                {dataQuality.missingEffective > 0 && (
                  <li>• {dataQuality.missingEffective} have no <b>effective_date</b> — chart can't place them on a timeline. Edit those rates to add a date.</li>
                )}
                {dataQuality.missingAmount > 0 && (
                  <li>• {dataQuality.missingAmount} have a <b>rate amount of 0</b> — chart can't plot them. Edit the rate amount.</li>
                )}
                {dataQuality.expiryBeforeEffective > 0 && (
                  <li>• {dataQuality.expiryBeforeEffective} have <b>expiry before effective</b> (impossible window) — fix the dates on those rates.</li>
                )}
                {dataQuality.missingCurrency > 0 && (
                  <li>• {dataQuality.missingCurrency} have no <b>currency</b> set — bucketed as USD by default. Edit to confirm currency.</li>
                )}
              </ul>
            </div>
          )}
          <div className="text-[10px] text-slate-500 mt-1">
            {/* v55.83-A.6 — informative caption: view mode + data scope */}
            {chartView === 'floor' && <span>Showing <b>market floor</b> — the lowest active rate each month. </span>}
            {chartView === 'vendor' && <span>Showing <b>{groupsToPlot.length} vendor{groupsToPlot.length === 1 ? '' : 's'}</b> — each line is one vendor's best monthly rate. </span>}
            {chartView === 'line' && <span>Showing <b>{groupsToPlot.length} shipping line{groupsToPlot.length === 1 ? '' : 's'}</b> — each line is one shipping company's best monthly rate. </span>}
            {validRatesForChart.length} rate{validRatesForChart.length === 1 ? '' : 's'} across {months.length} month{months.length === 1 ? '' : 's'}
            {months.length > 0 && <span> ({months[0]} → {months[months.length - 1]})</span>}
            {bookingStars.length > 0 && <span className="ml-2 text-amber-900 font-semibold">• {bookingStars.length} booking{bookingStars.length === 1 ? '' : 's'} ⭐</span>}
            {hideExpired && <span className="ml-2 text-amber-900 font-semibold">• Expired rates hidden</span>}
          </div>
          {/* v55.83-A.6.1 (Max May 13 2026) — DIAGNOSTIC ROW for chart debugging.
              Shows per-month status: how many rates were active, what _best was,
              whether it came from a fresh or stale source. Super-admin only,
              tucked behind a toggle so it doesn't clutter the chart for end-users.
              Click "Show data table" to expand. */}
          {chartView === 'floor' && trendPoints.length > 0 && (
            <details className="mt-2">
              <summary className="text-[10px] text-slate-600 cursor-pointer hover:text-slate-800">🔍 Show per-month diagnostic table (debug)</summary>
              <div className="mt-1 max-h-60 overflow-auto border border-slate-200 rounded">
                <table className="w-full text-[10px]">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">Month</th>
                      <th className="px-2 py-1 text-right">Active rates</th>
                      <th className="px-2 py-1 text-right">_best</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Source rate ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendPoints.map(function(pt) {
                      var monthStart = firstDayOf(pt.month);
                      var monthEnd = lastDayOf(pt.month);
                      // v55.83-A.6.27.8 — use same min(monthEnd, today) rule
                      // as the main chart filter so the diagnostic table
                      // counts reflect what's actually plotted.
                      var todayStrDiag = todayET();
                      var refDateDiag = monthEnd < todayStrDiag ? monthEnd : todayStrDiag;
                      var actCount = ratesForView.filter(function(r) {
                        var eff = r.effective_date || '';
                        var exp = r.expiry_date || '';
                        return eff <= refDateDiag && (exp === '' || exp >= refDateDiag);
                      }).length;
                      var status = '∅ no data';
                      if (pt._best !== undefined) {
                        status = pt.__stale___best ? '⏳ stale (carry-forward)' : '✓ fresh';
                      }
                      return (
                        <tr key={pt.month} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono">{pt.month}</td>
                          <td className="px-2 py-1 text-right">{actCount}</td>
                          <td className="px-2 py-1 text-right font-mono">{pt._best !== undefined ? chartSym + Math.round(pt._best).toLocaleString() : '—'}</td>
                          <td className="px-2 py-1">{status}</td>
                          <td className="px-2 py-1 font-mono text-[9px]">{(pt.__source___best || '').substring(0, 8)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-2 py-1 text-[10px] text-slate-500 bg-slate-50 border-t border-slate-200">
                  Total rates in ratesForView: {ratesForView.length} · chart currency: {chartCurrency} · scope: {chartShippingLine}
                </div>
              </div>
            </details>
          )}
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
        return (<><button onClick={() => {
          // v55.83-A.6.27.5 — Export CSV honors the same "always include
          // still-active rates" rule as the table below. Otherwise an export
          // would omit a rate that's clearly visible (and driving costs)
          // on screen.
          var todayStrCSV = todayET();
          function activeCSV(r) { return !r.expiry_date || r.expiry_date >= todayStrCSV; }
          var filtered = routeHistory;
          if (rateHistoryDf) filtered = filtered.filter(function(r) {
            if (activeCSV(r)) return true;
            return (r.effective_date || '') >= rateHistoryDf;
          });
          if (rateHistoryDt) filtered = filtered.filter(function(r) {
            if (activeCSV(r)) return true;
            return (r.effective_date || '') <= rateHistoryDt;
          });
          if (hideExpired) filtered = filtered.filter(function(r) { return !isExpired(r.expiry_date); });
          exportCSV(filtered);
        }} className="px-3 py-1 bg-emerald-500 text-white rounded text-[10px] font-semibold" title="Download as CSV">📥 Export</button><button onClick={()=>{setRequestQuoteData({vendor:null,origin:selectedRoute.origin,destination:selectedRoute.destination,container:'40ft'});}} className="px-3 py-1 bg-cyan-500 text-white rounded text-[10px] font-semibold">📋 Request Rate</button><button onClick={()=>{setF({origin:selectedRoute.origin,destination:selectedRoute.destination});setView('add_rate');}} className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">+ Add Rate</button></>);
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
        // v55.83-A.6.27.5 (Max May 15 2026) — date window filter no longer
        // drops rates that are STILL ACTIVE (no expiry, or expiry in future).
        // Otherwise a long-lived "no-expiry" rate with an old effective_date
        // becomes invisible in the table and the user can't see, edit, or
        // delete it — even though it's still driving the floor on the chart.
        //
        // Rule: a rate stays visible when EITHER
        //   (a) its effective_date is inside the period window, OR
        //   (b) it's still active (no expiry, or expiry >= today)
        var todayStrForFilter = todayET();
        function isStillActive(r) {
          if (!r.expiry_date) return true;        // no expiry = still active
          return r.expiry_date >= todayStrForFilter;
        }
        if (rateHistoryDf) {
          filtered = filtered.filter(function(r) {
            if (isStillActive(r)) return true;     // always show active rates
            return (r.effective_date || '') >= rateHistoryDf;
          });
        }
        if (rateHistoryDt) {
          filtered = filtered.filter(function(r) {
            if (isStillActive(r)) return true;     // always show active rates
            return (r.effective_date || '') <= rateHistoryDt;
          });
        }
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
        {/* v55.83-A.6.27.67 (Max May 23 2026) — bulk-action bar.
            Super-admin only. Quick-select buttons + selection count + bulk
            delete. Calculated from `filtered` so it respects the current
            date-window + hide-expired filters above (you can't accidentally
            bulk-delete rates that aren't visible). Stays hidden until
            something is selected, so non-super-admin users never see it.
            Quick-select buttons: "All Visible", "Historical (Expired)",
            "Not Booked", "Clear". Each operates on `filtered` for safety. */}
        {canBulkDelete && (() => {
          var visibleIds = filtered.map(function (r) { return r.id; });
          var expiredIds = filtered.filter(function (r) { return isExpired(r.expiry_date); }).map(function (r) { return r.id; });
          var notBookedIds = filtered.filter(function (r) { return !r.booked; }).map(function (r) { return r.id; });
          var notBookedExpiredIds = filtered.filter(function (r) { return isExpired(r.expiry_date) && !r.booked; }).map(function (r) { return r.id; });
          var selectedInView = visibleIds.filter(function (id) { return selectedRateIds.has(id); }).length;
          return (
            <div className="bg-slate-100 rounded-lg px-3 py-2 mb-2 border border-slate-200 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-slate-700">Bulk select / تحديد متعدد:</span>
              <button
                type="button"
                onClick={function () {
                  var s = new Set(selectedRateIds);
                  visibleIds.forEach(function (id) { s.add(id); });
                  setSelectedRateIds(s);
                }}
                className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 text-[10px] font-semibold hover:bg-slate-50"
                title={'Tick all ' + visibleIds.length + ' rates currently visible (respects your filters above)'}
              >
                ☑ All Visible ({visibleIds.length})
              </button>
              <button
                type="button"
                onClick={function () {
                  var s = new Set(selectedRateIds);
                  expiredIds.forEach(function (id) { s.add(id); });
                  setSelectedRateIds(s);
                }}
                disabled={expiredIds.length === 0}
                className={'px-2 py-0.5 rounded border text-[10px] font-semibold ' + (expiredIds.length === 0 ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100')}
                title="Tick all expired rates in the visible list"
              >
                🗓️ Historical / Expired ({expiredIds.length})
              </button>
              <button
                type="button"
                onClick={function () {
                  var s = new Set(selectedRateIds);
                  notBookedIds.forEach(function (id) { s.add(id); });
                  setSelectedRateIds(s);
                }}
                disabled={notBookedIds.length === 0}
                className={'px-2 py-0.5 rounded border text-[10px] font-semibold ' + (notBookedIds.length === 0 ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100')}
                title="Tick everything that isn't a confirmed booking"
              >
                📭 Not Booked ({notBookedIds.length})
              </button>
              <button
                type="button"
                onClick={function () {
                  var s = new Set(selectedRateIds);
                  notBookedExpiredIds.forEach(function (id) { s.add(id); });
                  setSelectedRateIds(s);
                }}
                disabled={notBookedExpiredIds.length === 0}
                className={'px-2 py-0.5 rounded border text-[10px] font-semibold ' + (notBookedExpiredIds.length === 0 ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-orange-50 border-orange-300 text-orange-800 hover:bg-orange-100')}
                title="Safest bulk delete — expired + unused rates. Booked rates are PROTECTED."
              >
                💡 Expired & Not Booked ({notBookedExpiredIds.length})
              </button>
              {selectedRateIds.size > 0 && (
                <>
                  <button
                    type="button"
                    onClick={function () { setSelectedRateIds(new Set()); }}
                    className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 text-[10px] font-semibold hover:bg-slate-50"
                    title="Untick everything"
                  >
                    ✗ Clear
                  </button>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-800 bg-yellow-100 px-2 py-0.5 rounded">
                      {selectedRateIds.size} selected{selectedInView !== selectedRateIds.size ? ' (' + selectedInView + ' visible)' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={function () {
                        var label = (selectedRoute && (selectedRoute.pol || selectedRoute.origin)) +
                          ' → ' + (selectedRoute && (selectedRoute.pod || selectedRoute.destination));
                        handleBulkDeleteRates(selectedRateIds, label);
                      }}
                      className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold shadow"
                      title="Delete the ticked rates permanently. Each deletion is audit-logged."
                    >
                      🗑️ Delete Selected ({selectedRateIds.size})
                    </button>
                  </span>
                </>
              )}
            </div>
          );
        })()}
      <div className="overflow-auto max-h-[420px] rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10"><tr className="bg-slate-50">
            {/* v55.83-A.6.27.67 — checkbox column for bulk-select. Header
                tick = toggle all visible (in `filtered`). Only rendered for
                super-admin. */}
            {canBulkDelete && (
              <th className="px-2 py-2 text-[10px] text-center" style={{ width: 28 }}>
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 cursor-pointer"
                  title="Tick all visible rates"
                  checked={filtered.length > 0 && filtered.every(function (r) { return selectedRateIds.has(r.id); })}
                  onChange={function (e) {
                    var s = new Set(selectedRateIds);
                    if (e.target.checked) {
                      filtered.forEach(function (r) { s.add(r.id); });
                    } else {
                      filtered.forEach(function (r) { s.delete(r.id); });
                    }
                    setSelectedRateIds(s);
                  }}
                />
              </th>
            )}
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
            // v55.82-M — chart-click highlight: when user clicks a chart
            // point, highlightedRateId is set to a rate.id. We pulse this
            // row with a yellow ring + slight scale so it pops without
            // breaking the table layout.
            const isHighlighted = highlightedRateId === r.id;
            return (<tr
              key={r.id}
              id={'rate-row-' + r.id}
              className={'border-b border-slate-50 transition-all duration-300 ' + (isBest ? 'bg-emerald-50 ' : exp ? 'bg-slate-50 ' : '') + (r.booked ? ' bg-green-50' : '') + (isHighlighted ? ' ring-4 ring-yellow-400 ring-offset-1 bg-yellow-50' : '') + (selectedRateIds.has(r.id) ? ' bg-yellow-100 ring-1 ring-yellow-400' : '')}
            >
              {/* v55.83-A.6.27.67 — per-row select checkbox.
                  Click toggles the rate's id in the selectedRateIds Set. Row
                  background switches to yellow when selected for visual feedback.
                  v55.83-A.6.27.69 — now gated on canBulkDelete (Delete Shipping
                  Bubbles permission, falls back to isAdmin). */}
              {canBulkDelete && (
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 cursor-pointer"
                    checked={selectedRateIds.has(r.id)}
                    onChange={function (e) {
                      var s = new Set(selectedRateIds);
                      if (e.target.checked) s.add(r.id); else s.delete(r.id);
                      setSelectedRateIds(s);
                    }}
                    title={selectedRateIds.has(r.id) ? 'Untick to remove from bulk selection' : 'Tick to include in bulk delete'}
                  />
                </td>
              )}
              <td className="px-2 py-1.5">{r.effective_date}</td>
              <td className="px-2 py-1.5 font-semibold">{isBest && <span className="text-emerald-500 mr-1">★</span>}{r.vendor_name}</td>
              <td className="px-2 py-1.5">{r.shipping_line || '—'}</td>
              <td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px]">{r.container_type}</span></td>
              {/* v55.63 — POL / POD / ETD / TT / FT inline. */}
              <td className="px-2 py-1.5 text-[10px]">{r.port_of_loading || <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-[10px]">{r.port_of_discharge || <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-center text-[10px] text-violet-600">{r.effective_date || <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-center text-[10px]">{r.transit_days != null ? <span className="font-semibold text-sky-700">{r.transit_days}d</span> : <span className="text-slate-300">—</span>}</td>
              <td className="px-2 py-1.5 text-center text-[10px]">{r.free_days != null ? <span className="font-semibold text-amber-900">{r.free_days}d</span> : <span className="text-slate-300">—</span>}</td>
              <td className={'px-2 py-1.5 text-right font-bold ' + (exp ? 'text-slate-500' : 'text-blue-600')}>{fCur(r.rate_amount, r.currency)}</td>
              <td className="px-2 py-1.5 text-right text-[10px]" title={dlt ? ('Previous: ' + fCur(dlt.prevRate, r.currency) + ' on ' + dlt.prevDate) : 'No prior rate for this vendor + line + container + currency'}>
                {dlt
                  ? (<span className={dlt.diff > 0 ? 'text-red-600 font-semibold' : dlt.diff < 0 ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                      {dlt.diff > 0 ? '▲' : dlt.diff < 0 ? '▼' : '='} {fCur(Math.abs(dlt.diff), r.currency)}
                      {dlt.pct !== null && <span className="ml-1 text-[9px]">({dlt.pct > 0 ? '+' : ''}{dlt.pct.toFixed(1)}%)</span>}
                    </span>)
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className={'px-2 py-1.5 text-right font-bold ' + (exp ? 'text-slate-500' : 'text-amber-900')}>{fCur(r.total_cost, r.currency)}</td>
              <td className="px-2 py-1.5">
                {exp
                  ? <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[9px] font-bold" title={'Expired ' + (r.expiry_date || '')}>EXPIRED</span>
                  : <ExpiryBadge date={r.expiry_date} />}
              </td>
              <td className="px-2 py-1.5">
                {/* v55.82-D — three-state booking display:
                    • Booked (green) — has a confirmed booking number
                    • Requested (amber) — sent a request, waiting on forwarder
                    • Idle — no action yet */}
                {r.booked
                  ? <div className="flex flex-col">
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold w-fit">✓ BOOKED</span>
                      {r.shipment_reference && <span className="text-[9px] text-slate-500 mt-0.5">Ref: {r.shipment_reference}</span>}
                      {r.booking_date && <span className="text-[9px] text-slate-500">{r.booking_date}</span>}
                    </div>
                  : r.booking_requested
                    ? <div className="flex flex-col">
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded text-[9px] font-bold w-fit" title="Waiting on the forwarder's booking number">⏳ REQUESTED</span>
                        {r.booking_requested_customer && <span className="text-[9px] text-slate-500 mt-0.5">For: {r.booking_requested_customer}</span>}
                        {r.booking_requested_at && <span className="text-[9px] text-slate-500">{(r.booking_requested_at || '').substring(0,10)}</span>}
                      </div>
                    : <span className="text-[9px] text-slate-500">—</span>}
              </td>
              <td className="px-2 py-1.5 flex gap-1 flex-wrap">
                {/* v55.82-D — booking flow buttons.
                    • Stage 1 (no request yet, not booked, not expired) → "Request Booking"
                      opens the email/WhatsApp modal pre-filled with rate info.
                    • Stage 2 (request sent OR rate is active) → "Confirm Booking"
                      opens the modal that captures booking# + release# + expected date.
                    • Both visible at once on a fresh active rate, since the user might
                      already have a booking number in hand and want to skip the request. */}
                {!exp && !r.booked && !r.booking_requested && (
                  <button onClick={() => handleRequestBooking(r)} className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]" title="Send email or WhatsApp to the forwarder asking them to confirm a booking">📨 Request Booking</button>
                )}
                {!exp && !r.booked && (
                  <button onClick={() => handleConfirmBooking(r)} className="px-2 py-0.5 rounded border border-emerald-300 text-emerald-600 text-[10px] font-semibold" title="You received the booking number — record it">✅ Confirm Booking</button>
                )}
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

      {/* v55.82-D — REQUEST BOOKING modal.
          Two-step booking flow per Max May 10 2026:
          step 1 = ask the forwarder to confirm a booking (this modal)
          step 2 = once they reply with a booking number, click Confirm.
          The buttons at the bottom open WhatsApp / email / copy with a
          fully-formed message body that includes route, container, rate,
          expiry, customer, release#, expected date — everything the
          forwarder needs to issue a booking number. The user can edit
          fields then send. */}
      {bookingRequestModal && (() => {
        var rate = bookingRequestModal;
        var vendor = (vendorContacts || []).find(function(v) {
          return (v.company_name || '').toLowerCase() === (rate.vendor_name || '').toLowerCase();
        }) || null;
        var generated = generateBookingRequest(rate, vendor, f.bookReqCustomer || '', f.bookReqOrder || '', f.bookReqRelease || '', f.bookReqExpected || '');
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBookingRequestModal(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-bold mb-1">📨 Request Booking — {rate.vendor_name || 'Forwarder'}</h3>
              <p className="text-[11px] text-slate-500 mb-3">{rate.origin} → {rate.destination} · {rate.container_type} · {fCur(rate.total_cost || rate.rate_amount, rate.currency)} · expires {rate.expiry_date || '—'}</p>

              {/* Customer / release / expected date — these go into both the
                  message body AND the rate's booking_requested_* columns so
                  the rest of the system knows we're waiting on this one. */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="text-[10px] font-semibold">Customer Name</label>
                  <input value={f.bookReqCustomer || ''} onChange={e => setF({...f, bookReqCustomer: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="Who's this for?" /></div>
                <div><label className="text-[10px] font-semibold">Our Order #</label>
                  <input value={f.bookReqOrder || ''} onChange={e => setF({...f, bookReqOrder: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="PO# / Order#" /></div>
                <div><label className="text-[10px] font-semibold">Customer Release #</label>
                  <input value={f.bookReqRelease || ''} onChange={e => setF({...f, bookReqRelease: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="If known" /></div>
                <div><label className="text-[10px] font-semibold">Expected Cargo Ready Date</label>
                  <input type="date" value={f.bookReqExpected || ''} onChange={e => setF({...f, bookReqExpected: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
              </div>

              {/* Show the auto-generated message and let the user edit it
                  before sending. Mirrors the quote-request UX. */}
              <div className="mb-3">
                <label className="text-[10px] font-semibold">Message preview (edit before sending)</label>
                <textarea value={f.bookReqBody == null ? generated.body : f.bookReqBody} onChange={e => setF({...f, bookReqBody: e.target.value})} rows={12} className="w-full px-3 py-2 rounded border text-xs font-mono" />
                <div className="text-[9px] text-slate-500 mt-1">Subject: {generated.subject}</div>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                {/* Channel buttons — same pattern as RequestQuoteModal */}
                {vendor && vendor.email && (
                  <button onClick={async () => {
                    var body = (f.bookReqBody == null ? generated.body : f.bookReqBody);
                    openEmail(vendor.email, generated.subject, body);
                    await submitBookingRequest(rate);
                  }} className="px-3 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">📧 Email {vendor.email}</button>
                )}
                {vendor && vendor.whatsapp && (
                  <button onClick={async () => {
                    var body = (f.bookReqBody == null ? generated.body : f.bookReqBody);
                    openWhatsApp(vendor.whatsapp, body);
                    await submitBookingRequest(rate);
                  }} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold">💬 WhatsApp {vendor.whatsapp}</button>
                )}
                {!vendor && (
                  <div className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mb-1 w-full">
                    ⚠️ No vendor contact saved for "{rate.vendor_name}". Add this forwarder under Vendor Contacts to enable one-click email / WhatsApp. You can still copy the message below.
                  </div>
                )}
                <button onClick={async () => {
                  var body = (f.bookReqBody == null ? generated.body : f.bookReqBody);
                  try { await navigator.clipboard.writeText(generated.subject + '\n\n' + body); if (toast && toast.success) toast.success('Message copied'); } catch (_) { try { alert('Copied'); } catch (__) {} }
                  await submitBookingRequest(rate);
                }} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold">📋 Copy &amp; mark as requested</button>
                <button onClick={() => { setBookingRequestModal(null); setF(function(prev) { return Object.assign({}, prev, { bookReqBody: undefined }); }); }} className="px-3 py-2 border border-slate-200 rounded-lg text-xs">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* v55.82-D — CONFIRM BOOKING modal.
          Stage 2 of the two-step flow. The forwarder has replied with a
          booking number, the user enters it here along with the customer
          info / release# / expected ship date. On submit:
            • inserts a row into shipping_bookings (so the trend chart
              picks it up as a star at the booked rate / booked date)
            • flips the rate's booked = true
            • clears the booking_requested flag if it was set
          Booking number is REQUIRED — disabled save button until typed. */}
      {bookingConfirmModal && (() => {
        var rate = bookingConfirmModal;
        // If we previously sent a request, prefill the customer fields with
        // what we typed back then. Saves re-typing.
        var preCust  = f.bookConfirmCustomer != null ? f.bookConfirmCustomer : (rate.booking_requested_customer || '');
        var preOrder = f.bookConfirmOrder    != null ? f.bookConfirmOrder    : (rate.booking_requested_order || '');
        var preRel   = f.bookConfirmRelease  != null ? f.bookConfirmRelease  : (rate.booking_requested_release || '');
        var preExp   = f.bookConfirmExpected != null ? f.bookConfirmExpected : (rate.booking_requested_expected_date || '');
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBookingConfirmModal(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-bold mb-1">✅ Confirm Booking — {rate.vendor_name || 'Forwarder'}</h3>
              <p className="text-[11px] text-slate-500 mb-3">{rate.origin} → {rate.destination} · {rate.container_type} · {fCur(rate.total_cost || rate.rate_amount, rate.currency)}</p>

              {rate.booking_requested && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-[11px] text-amber-900">
                  ⏳ Booking was requested on {(rate.booking_requested_at || '').substring(0,10)} — fields below are pre-filled from that request.
                </div>
              )}

              <div className="space-y-3">
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <label className="text-[10px] font-bold text-blue-800">Booking Number / BL # *</label>
                  <input value={f.bookConfirmNumber || ''} onChange={e => setF({...f, bookConfirmNumber: e.target.value})} className="w-full px-3 py-2 rounded border text-sm font-mono" placeholder="MSCU-1234567 / BKG#xxxxxx" autoFocus />
                  <p className="text-[10px] text-blue-700 mt-1">The reference number the forwarder gave you when they confirmed. Required.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-semibold">Customer Name</label>
                    <input value={preCust} onChange={e => setF({...f, bookConfirmCustomer: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="Who is this booking for?" /></div>
                  <div><label className="text-[10px] font-semibold">Our Order #</label>
                    <input value={preOrder} onChange={e => setF({...f, bookConfirmOrder: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="PO# / Order#" /></div>
                  <div><label className="text-[10px] font-semibold">Customer Release #</label>
                    <input value={preRel} onChange={e => setF({...f, bookConfirmRelease: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="From customer" /></div>
                  <div><label className="text-[10px] font-semibold">Expected Ship Date</label>
                    <input type="date" value={preExp || ''} onChange={e => setF({...f, bookConfirmExpected: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
                </div>

                <div><label className="text-[10px] font-semibold">Notes</label>
                  <input value={f.bookConfirmNotes || ''} onChange={e => setF({...f, bookConfirmNotes: e.target.value})} className="w-full px-3 py-2 rounded border text-sm" placeholder="Vessel, voyage, cut-off times, etc." /></div>
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={() => finalizeBookingConfirm(rate)} disabled={!f.bookConfirmNumber} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50">✅ Confirm Booking</button>
                <button onClick={() => setBookingConfirmModal(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

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
    <button onClick={()=>{setView('routes');setImportData([]);setImportStep('select');setImportRawRows([]);setImportHeaders([]);setImportContainerCols([]);setImportCaptureReport([]);}} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back</button>
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
        // v55.82-C — surface "Other Fees Description" in the mapping UI so
        // users can correct it if auto-detection picked the wrong column.
        ['otherFeesDesc', 'Other Fees Description'],
        ['notes', 'Notes'],
      ];
      return (<div>
      {/* SUMMARY + WARNINGS BANNER */}
      <div className={'rounded-xl p-4 mb-3 border ' + (zeroRateCount>0 ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-200')}>
        <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
          <div>
            <span className="text-sm font-bold text-slate-800">Found {importData.length} rate{importData.length!==1?'s':''} ready to import</span>
            {zeroRateCount > 0 && <div className="text-[11px] text-amber-900 font-semibold mt-0.5">⚠️ {zeroRateCount} row{zeroRateCount!==1?'s':''} have rate = 0 — fix or remove them below before importing</div>}
            {noDateCount > 0 && <div className="text-[11px] text-amber-900 font-semibold mt-0.5">⚠️ {noDateCount} row{noDateCount!==1?'s':''} couldn't parse the effective date — they'll save with today's date as a fallback. Check the source data.</div>}
            {noExpiryCount > 0 && <div className="text-[10px] text-slate-500 mt-0.5">{noExpiryCount} row{noExpiryCount!==1?'s':''} missing expiry date — they'll never auto-expire</div>}
            {/* v55.80 — Surface historical / already-expired counts so user knows what they're importing */}
            {historicalCount > 0 && <div className="text-[10px] text-blue-600 mt-0.5">📅 {historicalCount} row{historicalCount!==1?'s':''} have historical effective dates — they'll be saved as-is for trend analysis</div>}
            {expiredCount > 0 && <div className="text-[10px] text-rose-600 mt-0.5">⏰ {expiredCount} row{expiredCount!==1?'s':''} are already expired — kept in the record but won't show as active rates</div>}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {/* v55.82-L Stage 2 — Spec-correct 2-mode selector.
                DEFAULT = update_only (safe). full_sync requires explicit
                opt-in AND a typed confirmation phrase. */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-slate-700">Mode:</span>
              <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                <input type="radio" name="importMode" value="update_only" checked={importMode === 'update_only'} onChange={() => { setImportMode('update_only'); setFullSyncConfirm(''); }} />
                <span className="font-semibold">Update Only</span>
                <span className="text-[9px] font-bold text-emerald-900 bg-emerald-100 px-1.5 py-0.5 rounded">SAFE · DEFAULT</span>
              </label>
              <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                <input type="radio" name="importMode" value="full_sync" checked={importMode === 'full_sync'} onChange={() => setImportMode('full_sync')} />
                <span className="font-semibold">Full Sync</span>
                <span className="text-[9px] font-bold text-rose-900 bg-rose-100 px-1.5 py-0.5 rounded">⚠️ DELETES MISSING ROWS</span>
              </label>
            </div>
            <button onClick={()=>{setImportStep('select');setImportData([]);setImportCaptureReport([]);setFullSyncConfirm('');}} className="px-3 py-1.5 border rounded-lg text-xs">Cancel</button>
            <button
              onClick={executeImport}
              disabled={importMode === 'full_sync' && fullSyncConfirm !== 'FULL SYNC'}
              className={'px-4 py-1.5 rounded-lg text-xs font-semibold text-white ' + (importMode === 'full_sync' && fullSyncConfirm !== 'FULL SYNC' ? 'bg-slate-300 cursor-not-allowed' : (importMode === 'full_sync' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'))}
            >
              {importMode === 'full_sync' ? '⚠️ Run Full Sync' : '✅ Import All'} ({importData.length})
            </button>
          </div>
        </div>
        {/* v55.82-L Stage 2 — Plain-language explainer per mode, with clear
            colour coding. Update Only = green/safe. Full Sync = red/danger. */}
        <div className="mt-2 px-3 py-2 rounded-lg text-[11px] border" style={{
          background: importMode === 'full_sync' ? '#fef2f2' : '#f0fdf4',
          borderColor: importMode === 'full_sync' ? '#fecaca' : '#bbf7d0',
          color: importMode === 'full_sync' ? '#7f1d1d' : '#14532d',
        }}>
          {importMode === 'update_only' && (
            <span>
              <strong>Update Only mode (safe):</strong> for each row in the file, the system checks all 5 key fields (Origin, Destination, Expiration Date, Freight Forwarder, Shipping Line).
              {' '}If all 5 match an existing rate → <strong>that rate is updated</strong> with the new values.
              {' '}If no match → <strong>the row is added as a new rate</strong>.
              {' '}Existing rates that are NOT in your file are <strong>left alone</strong>. One bad row never affects the others — failed rows are skipped and listed in the summary.
            </span>
          )}
          {importMode === 'full_sync' && (
            <span>
              <strong>⚠️ Full Sync mode — DESTRUCTIVE:</strong> like Update Only, BUT <strong>any existing rate that is NOT in your import file will be DELETED</strong> (within the vendor + origin combinations covered by this file).
              {' '}Use only when this file is intended to fully replace the matching part of your shipping rate history.
              {' '}If any row in the file has a validation error, the delete step is skipped automatically — your data is preserved.
            </span>
          )}
        </div>
        {/* v55.82-L Stage 2 — Typed confirmation, only when full_sync is
            selected. User must type the exact phrase "FULL SYNC" before
            the Run button is enabled. */}
        {importMode === 'full_sync' && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-rose-100 border-2 border-rose-400">
            <div className="text-[11px] font-bold text-rose-900 mb-1">⚠️ To enable Full Sync, type <code className="px-1 bg-white rounded">FULL SYNC</code> in the box below:</div>
            <input
              type="text"
              value={fullSyncConfirm}
              onChange={e => setFullSyncConfirm(e.target.value)}
              placeholder="Type: FULL SYNC"
              className="w-full px-2 py-1 text-xs rounded border border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
            />
            <div className="text-[10px] text-rose-800 mt-1">
              {fullSyncConfirm === 'FULL SYNC'
                ? '✅ Confirmation matches — Run Full Sync button is now enabled.'
                : 'Run button stays disabled until the phrase matches exactly.'}
            </div>
          </div>
        )}
      </div>

      {/* v55.82-N — Per-field capture diagnostic. Shows for every template
          field whether a source column was detected and how many rows
          ended up with a non-empty value. This makes silent field-drops
          impossible to hide. */}
      {importCaptureReport && importCaptureReport.length > 0 && (
        <div className="bg-white rounded-xl p-3 mb-3 border border-slate-200">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div>
              <span className="text-xs font-bold text-slate-700">📋 Field Capture Report</span>
              <span className="ml-2 text-[10px] text-slate-500">Shows which template fields made it into the parsed records (before save). Adjust mapping below if anything is missing.</span>
            </div>
            <div className="flex gap-2 text-[9px]">
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold">OK ≥90%</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">PARTIAL 1–89%</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-bold">EMPTY (no values)</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 font-bold">MISSING (no col)</span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {importCaptureReport.map(function(r) {
              var bg, label;
              if (r.status === 'ok') { bg = 'bg-emerald-100 border-emerald-400'; label = 'OK'; }
              else if (r.status === 'partial') { bg = 'bg-amber-100 border-amber-400'; label = 'PARTIAL'; }
              else if (r.status === 'empty') { bg = 'bg-slate-100 border-slate-400'; label = 'EMPTY'; }
              else { bg = 'bg-rose-100 border-rose-400'; label = 'MISSING'; }
              var rateStr = r.total > 0 ? (r.captured + '/' + r.total) : '0/0';
              return (
                <div key={r.field} className={'rounded p-2 border ' + bg + ' flex items-center justify-between'}>
                  <div className="text-[11px]">
                    <div className="font-bold text-slate-950">{r.label}</div>
                    <div className="text-[10px] text-slate-700">
                      {r.detected
                        ? <span>from <code className="bg-white px-1 rounded">{r.sourceCol || '(container split)'}</code></span>
                        : <span className="text-rose-800 font-bold">no source column found</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] font-extrabold text-slate-900">{label}</div>
                    <div className="text-[10px] font-mono font-bold text-slate-900">{rateStr}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {(function() {
            var missing = importCaptureReport.filter(function(r) { return r.status === 'missing'; });
            var empty   = importCaptureReport.filter(function(r) { return r.status === 'empty'; });
            var partial = importCaptureReport.filter(function(r) { return r.status === 'partial'; });
            if (missing.length === 0 && empty.length === 0 && partial.length === 0) {
              return (<div className="mt-2 text-[10px] text-emerald-700 font-semibold">✅ Every template field has a source column and is bringing in data.</div>);
            }
            return (
              <div className="mt-2 text-[10px] text-slate-700">
                {missing.length > 0 && <div className="text-rose-800">⚠️ <strong>{missing.length} field{missing.length===1?'':'s'} have no detected source column</strong> — check the file's header row and use the Column Mapping below to remap.</div>}
                {empty.length > 0 && <div className="text-slate-600 mt-0.5">ℹ️ {empty.length} field{empty.length===1?'':'s'} were detected but had no values in any row — that's fine if your template legitimately leaves them blank.</div>}
                {partial.length > 0 && <div className="text-amber-800 mt-0.5">⚠️ {partial.length} field{partial.length===1?'':'s'} are only partially filled — some rows have data, others don't.</div>}
              </div>
            );
          })()}
        </div>
      )}

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
    {importStep==='done'&&<div className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center gap-3 mb-3">
        <div className="text-3xl">{importCounts.failed > 0 ? '⚠️' : '✅'}</div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Import {importCounts.failed > 0 && (importCounts.added + importCounts.updated === 0) ? 'finished with errors' : 'complete'}</h3>
          <div className="text-[11px] text-slate-600">{importMode === 'full_sync' ? 'Full Sync' : 'Update Only'} mode</div>
        </div>
      </div>
      {/* v55.82-P — Clear "your data is safe" banner when every row failed.
          Without this the user sees a wall of errors and panics that data
          was lost — but Update Only mode never deletes anything, and a
          failed insert doesn't write either. So "210/210 failed" actually
          means "nothing changed in the database — existing rates are intact". */}
      {importCounts.failed > 0 && (importCounts.added + importCounts.updated) === 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 mb-4">
          <div className="text-sm font-bold text-amber-900 mb-1">📌 Nothing was saved — and nothing was lost</div>
          <div className="text-[11px] text-amber-900 leading-snug">
            Every row in your file hit an error and was skipped. No rates were added, updated, or deleted — your existing shipping rates database is untouched.
            {' '}Fix the issues listed below (most likely a column-mapping problem or a database constraint mismatch), then re-import the same file. Update Only mode is safe to retry as many times as you need.
          </div>
        </div>
      )}
      {/* v55.82-L Stage 2 — Detailed result summary per spec section 6.
          v55.82-Q — bumped from -50 surfaces to -100 + saturated text so
          the numbers actually read on dark themes. Previously the FAILED
          number was rose-900 on rose-50 which was invisible against the
          surrounding cream/dark theme. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <div className="bg-emerald-100 border border-emerald-300 rounded-lg p-3">
          <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wide">New Added</div>
          <div className="text-3xl font-black text-emerald-900">{importCounts.added}</div>
        </div>
        <div className="bg-blue-100 border border-blue-300 rounded-lg p-3">
          <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wide">Updated</div>
          <div className="text-3xl font-black text-blue-900">{importCounts.updated}</div>
        </div>
        <div className="bg-slate-100 border border-slate-300 rounded-lg p-3">
          <div className="text-[10px] font-extrabold text-slate-900 uppercase tracking-wide">Unchanged</div>
          <div className="text-3xl font-black text-slate-900">{importCounts.unchanged}</div>
        </div>
        <div className={(importCounts.failed > 0 ? 'bg-rose-200 border-rose-400' : 'bg-slate-100 border-slate-300') + ' border rounded-lg p-3'}>
          <div className={'text-[10px] font-extrabold uppercase tracking-wide ' + (importCounts.failed > 0 ? 'text-rose-950' : 'text-slate-700')}>Failed</div>
          <div className={'text-3xl font-black ' + (importCounts.failed > 0 ? 'text-rose-950' : 'text-slate-500')}>{importCounts.failed}</div>
        </div>
        {/* v55.83-A.6.27.7 — Quarantined tile: rows that had bad-data
            patterns (eff=exp same day, year < 2020, expiry < effective,
            zero rate, etc.). NOT imported. NOT failed. Held for the user
            to review and either fix-and-import or discard. */}
        <div className={((importCounts.quarantined || 0) > 0 ? 'bg-amber-100 border-amber-400' : 'bg-slate-100 border-slate-300') + ' border rounded-lg p-3'}>
          <div className={'text-[10px] font-extrabold uppercase tracking-wide ' + ((importCounts.quarantined || 0) > 0 ? 'text-amber-950' : 'text-slate-700')}>Quarantined</div>
          <div className={'text-3xl font-black ' + ((importCounts.quarantined || 0) > 0 ? 'text-amber-950' : 'text-slate-500')}>{importCounts.quarantined || 0}</div>
          {(importCounts.quarantined || 0) > 0 && (
            <div className="text-[9px] text-amber-900 mt-1">Bad-data patterns — review later</div>
          )}
        </div>
        {importMode === 'full_sync' && (
          <div className={(importCounts.deleted > 0 ? 'bg-rose-200 border-rose-400' : 'bg-slate-100 border-slate-300') + ' border rounded-lg p-3'}>
            <div className={'text-[10px] font-extrabold uppercase tracking-wide ' + (importCounts.deleted > 0 ? 'text-rose-950' : 'text-slate-700')}>Deleted</div>
            <div className={'text-3xl font-black ' + (importCounts.deleted > 0 ? 'text-rose-950' : 'text-slate-500')}>{importCounts.deleted}</div>
          </div>
        )}
      </div>
      {/* v55.82-N — Per-field capture summary on the done screen.
          Confirms (or denies) which template fields actually wrote to
          the database. Builds confidence the import worked end-to-end. */}
      {importCaptureReport && importCaptureReport.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3">
          <div className="text-xs font-bold text-slate-800 mb-2">📋 Field capture summary</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[11px]">
            {importCaptureReport.map(function(r) {
              var pillBg, pillText;
              if (r.status === 'ok') { pillBg = 'bg-emerald-200'; pillText = 'text-emerald-950'; }
              else if (r.status === 'partial') { pillBg = 'bg-amber-200'; pillText = 'text-amber-950'; }
              else if (r.status === 'empty') { pillBg = 'bg-slate-200'; pillText = 'text-slate-800'; }
              else { pillBg = 'bg-rose-200'; pillText = 'text-rose-950'; }
              return (
                <div key={r.field} className="flex items-center justify-between gap-1">
                  <span className="text-slate-800 font-medium truncate" title={r.label}>{r.label}</span>
                  <span className={'px-1.5 py-0.5 rounded font-mono font-bold text-[9px] ' + pillBg + ' ' + pillText}>
                    {r.captured + '/' + r.total}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* v55.82-L Stage 2 — Expandable error report per spec section 5.
          v55.82-P — taller (max-h-96), with Copy All + Download CSV
          buttons so user can paste the full error list into a message
          or share it with support. */}
      {importErrors.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-xs font-bold text-rose-900">⚠️ {importErrors.length} issue{importErrors.length === 1 ? '' : 's'} during import (these rows were skipped — your other rows are saved):</div>
            <div className="flex gap-1">
              <button
                onClick={function () {
                  var txt = importErrors.map(function (e) {
                    return 'Row ' + e.row + ' (' + e.field + '): ' + e.reason;
                  }).join('\n');
                  try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(txt);
                    } else {
                      var ta = document.createElement('textarea');
                      ta.value = txt; document.body.appendChild(ta); ta.select();
                      document.execCommand('copy'); document.body.removeChild(ta);
                    }
                  } catch (_) {}
                }}
                className="px-2 py-1 rounded border border-rose-300 text-rose-800 hover:bg-rose-100 text-[10px] font-semibold"
              >
                📋 Copy all errors
              </button>
              <button
                onClick={function () {
                  var headers = ['Row', 'Field', 'Reason'];
                  var esc = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
                  var lines = [headers.join(',')];
                  importErrors.forEach(function (e) { lines.push([esc(e.row), esc(e.field), esc(e.reason)].join(',')); });
                  var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
                  var url = URL.createObjectURL(blob);
                  var a = document.createElement('a');
                  a.href = url;
                  a.download = 'import-errors-' + (new Date()).toISOString().slice(0, 10) + '.csv';
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                }}
                className="px-2 py-1 rounded border border-rose-300 text-rose-800 hover:bg-rose-100 text-[10px] font-semibold"
              >
                ⬇️ CSV
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-1 border border-rose-100 rounded bg-white">
            {importErrors.map((e, i) => (
              <div key={i} className="text-[11px] border-b border-rose-50 last:border-b-0 p-2">
                <div className="font-semibold text-rose-900">
                  {e.row > 0 ? 'Row ' + e.row : 'Import step'}{e.field ? ' — ' + e.field : ''}
                </div>
                <div className="text-slate-700 mt-0.5">{e.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={()=>{setView('routes');setImportData([]);setImportStep('select');setImportRawRows([]);setImportHeaders([]);setImportContainerCols([]);setImportErrors([]);setImportCounts({added:0,updated:0,unchanged:0,failed:0,deleted:0});setImportCaptureReport([]);setFullSyncConfirm('');}} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold text-sm">Back to Shipping Rates</button>
    </div>}
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

    {/* v55.83-A.6.27.11 (Max May 15 2026) — Transport mode tabs. Per Max:
        "in the shipping rates section we need to create a section also for
        trucking rates from different loading destination to destination
        ports a separate tab". Uses the existing filterMode which already
        scopes the entire view (cards, table, chart). Adding "+ Rate" while
        on the Trucking tab pre-fills transport_mode='Truck'. */}
    <div className="flex gap-1 mb-3 bg-slate-100 rounded-lg p-1 inline-flex">
      <button onClick={() => setFilterMode('all')}
        className={'px-4 py-1.5 rounded-md text-xs font-bold transition ' + (filterMode === 'all' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900')}>
        🌐 All Modes
      </button>
      <button onClick={() => setFilterMode('Ocean')}
        className={'px-4 py-1.5 rounded-md text-xs font-bold transition ' + (filterMode === 'Ocean' ? 'bg-white shadow text-blue-700' : 'text-slate-600 hover:text-slate-900')}>
        🚢 Ocean
      </button>
      <button onClick={() => setFilterMode('Truck')}
        className={'px-4 py-1.5 rounded-md text-xs font-bold transition ' + (filterMode === 'Truck' ? 'bg-white shadow text-amber-700' : 'text-slate-600 hover:text-slate-900')}>
        🚛 Trucking
      </button>
      <button onClick={() => setFilterMode('Air')}
        className={'px-4 py-1.5 rounded-md text-xs font-bold transition ' + (filterMode === 'Air' ? 'bg-white shadow text-violet-700' : 'text-slate-600 hover:text-slate-900')}>
        ✈️ Air
      </button>
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
      {/* v55.82-J — Destination continent dropdown (Max May 11 2026).
          "Shipping bubbles should be sorted by destination countries by
          continent. Drop down". Counts come from the unfiltered (by
          continent) dataset so the dropdown always shows what's available;
          selecting a continent narrows the grid below. */}
      {(function () {
        // Pre-compute per-continent counts from the filtered-but-not-continent-
        // filtered set so the dropdown labels show how many routes exist per
        // continent. We rebuild a quick groups map from `filtered`.
        var byContinent = {};
        CONTINENTS.forEach(function (c) { byContinent[c] = 0; });
        var seenKey = {};
        filtered.forEach(function (r) {
          // v55.83-A.6.27.15 — match the bubble's 4-part grouping so the
          // dropdown count reflects what the user actually sees.
          var key = (r.origin || '').toLowerCase().trim() + '|'
                  + (r.port_of_loading || '').toLowerCase().trim() + '||'
                  + (r.destination || '').toLowerCase().trim() + '|'
                  + (r.port_of_discharge || '').toLowerCase().trim();
          if (seenKey[key]) return;
          seenKey[key] = true;
          var c = continentOf(r.destination);
          if (byContinent[c] == null) byContinent[c] = 0;
          byContinent[c]++;
        });
        var totalRoutes = Object.keys(seenKey).length;
        return (
          <div className="flex items-center gap-1">
            <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide" htmlFor="continent-filter">Destination:</label>
            <select
              id="continent-filter"
              value={continentFilter}
              onChange={function (e) { setContinentFilterPersist(e.target.value); }}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700"
              title="Filter the route grid by destination continent"
            >
              <option value="all">🌍 All continents ({totalRoutes})</option>
              {CONTINENTS.map(function (c) {
                var n = byContinent[c] || 0;
                if (n === 0 && c !== continentFilter) return null;
                var emoji = c === 'Africa' ? '🌍' : c === 'Asia' ? '🌏' : c === 'Europe' ? '🇪🇺' : c === 'North America' ? '🌎' : c === 'South America' ? '🌎' : c === 'Oceania' ? '🌏' : '📍';
                return <option key={c} value={c}>{emoji} {c} ({n})</option>;
              })}
            </select>
            {continentFilter !== 'all' && (
              <button
                onClick={function () { setContinentFilterPersist('all'); }}
                className="px-2 py-1 rounded border text-xs text-slate-600 hover:bg-slate-100"
                title="Show all continents">
                ✕
              </button>
            )}
          </div>
        );
      })()}
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
        // v55.83-A.6.27.11 (Max May 15 2026) — Always show port + country
        // format when port info exists, regardless of groupByPort toggle.
        // Per Max: "shipping rates on bubble should state POL and country
        // to the POD and country so easier to identify".
        var fromLabel, fromSub, toLabel, toSub;
        if (rg.pol && rg.pol !== rg.origin) {
          fromLabel = rg.pol;
          fromSub = rg.origin; // country name
        } else {
          fromLabel = rg.origin;
          fromSub = null;
        }
        if (rg.pod && rg.pod !== rg.destination) {
          toLabel = rg.pod;
          toSub = rg.destination;
        } else {
          toLabel = rg.destination;
          toSub = null;
        }
        return (
          <div key={rg.key} onClick={function(){setSelectedRoute({origin:rg.origin,destination:rg.destination,pol:rg.pol||null,pod:rg.pod||null});setView('route_detail');}} className="bg-white rounded-xl p-4 cursor-pointer border border-slate-200 hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex justify-between items-start mb-2"><div><div className="text-sm font-extrabold text-blue-700">{fromLabel}{fromSub && <span className="text-[9px] text-slate-500 font-normal ml-1">, {fromSub}</span>}</div><div className="text-[10px] text-slate-500">↓</div><div className="text-sm font-extrabold text-emerald-700">{toLabel}{toSub && <span className="text-[9px] text-slate-500 font-normal ml-1">, {toSub}</span>}</div></div><div className="text-right">{c?(<><div className="text-[9px] text-slate-500">Best Active</div><div className="text-lg font-extrabold text-emerald-600">{fCur(c.rate_amount,c.currency)}</div><div className="text-[9px] text-blue-500">{c.vendor_name}{c.shipping_line?' / '+c.shipping_line:''}</div><ExpiryBadge date={c.expiry_date}/></>):(<div className="text-xs text-red-400 font-bold">All Expired</div>)}</div></div>
            {/* v55.63 — show TT / FT / ETD on the cheapest active rate.
                v55.83-A.6.27.15 — show always (every bubble is now per-port,
                so this info is always specific to ONE port pair). */}
            {c && (
              <div className="flex gap-2 flex-wrap text-[10px] mb-2">
                {c.transit_days != null && <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded"><strong>TT:</strong> {c.transit_days}d</span>}
                {c.free_days != null && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-900 rounded"><strong>FT:</strong> {c.free_days}d</span>}
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
                  <span className="text-[10px] text-slate-500">({activeRouteGroups.length} {activeRouteGroups.length === 1 ? 'route' : 'routes'} · {continentFilter === 'all' ? 'grouped by destination continent' : 'sorted by destination'})</span>
                </div>
              )}
              {/* v55.82-J — When no continent filter is selected, group the
                  active bubbles into continent sections so the user can scan
                  by region. When a specific continent IS selected, flat grid
                  (no inner header needed, the filter dropdown already
                  communicates the filter). */}
              {continentFilter === 'all' ? (
                (function () {
                  var groupedByContinent = {};
                  activeRouteGroups.forEach(function (rg) {
                    var c = rg.destContinent || 'Other';
                    if (!groupedByContinent[c]) groupedByContinent[c] = [];
                    groupedByContinent[c].push(rg);
                  });
                  // Render continents in the canonical order, skipping empties.
                  return CONTINENTS.filter(function (c) { return groupedByContinent[c] && groupedByContinent[c].length > 0; }).map(function (c) {
                    var emoji = c === 'Africa' ? '🌍' : c === 'Asia' ? '🌏' : c === 'Europe' ? '🇪🇺' : c === 'North America' ? '🌎' : c === 'South America' ? '🌎' : c === 'Oceania' ? '🌏' : '📍';
                    return (
                      <div key={c} className="mb-4">
                        <div className="flex items-center gap-2 mb-1.5 mt-3 first:mt-0">
                          <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">{emoji} {c}</span>
                          <span className="text-[10px] text-slate-500">({groupedByContinent[c].length})</span>
                          <div className="flex-1 border-t border-slate-200"></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {groupedByContinent[c].map(renderRouteCard)}
                        </div>
                      </div>
                    );
                  });
                })()
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeRouteGroups.map(renderRouteCard)}
                </div>
              )}
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
                  still scan the details.
                  v55.82-J: historical bubbles also group by continent when no
                  continent filter is selected, for symmetry with active. */}
              {continentFilter === 'all' ? (
                (function () {
                  var histByContinent = {};
                  historicalRouteGroups.forEach(function (rg) {
                    var c = rg.destContinent || 'Other';
                    if (!histByContinent[c]) histByContinent[c] = [];
                    histByContinent[c].push(rg);
                  });
                  return CONTINENTS.filter(function (c) { return histByContinent[c] && histByContinent[c].length > 0; }).map(function (c) {
                    var emoji = c === 'Africa' ? '🌍' : c === 'Asia' ? '🌏' : c === 'Europe' ? '🇪🇺' : c === 'North America' ? '🌎' : c === 'South America' ? '🌎' : c === 'Oceania' ? '🌏' : '📍';
                    return (
                      <div key={c} className="mb-4 opacity-60 hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-2 mb-1.5 mt-3 first:mt-0">
                          <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">{emoji} {c}</span>
                          <span className="text-[10px] text-slate-500">({histByContinent[c].length})</span>
                          <div className="flex-1 border-t border-slate-200"></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {histByContinent[c].map(renderRouteCard)}
                        </div>
                      </div>
                    );
                  });
                })()
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60 hover:opacity-100 transition-opacity">
                  {historicalRouteGroups.map(renderRouteCard)}
                </div>
              )}
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
                        <td className="px-2 py-1.5 text-right text-[10px]">{r.free_days != null ? <span className="font-semibold text-amber-900">{r.free_days}d</span> : <span className="text-slate-300">—</span>}</td>
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
