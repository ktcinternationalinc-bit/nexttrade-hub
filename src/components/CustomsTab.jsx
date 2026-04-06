'use client';
import { useState } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { fE } from '../lib/utils';

const STATUS_COLORS_SHIP = {Pending:'#f59e0b','In Transit':'#3b82f6','At Port':'#8b5cf6',Clearing:'#ec4899',Cleared:'#10b981',Delivered:'#374151'};
const SHIP_STATUSES = ['Pending','In Transit','At Port','Clearing','Cleared','Delivered'];

export default function CustomsTab({ customers, user }) {
  const [shipments, setShipments] = useState([]);
  const [shipLoaded, setShipLoaded] = useState(false);
  const [showAddShipment, setShowAddShipment] = useState(false);
  const [shipForm, setShipForm] = useState({});
  const [selShipment, setSelShipment] = useState(null);

  const loadShipments = async () => {
    try {
      const { data } = await supabase.from('shipments').select('*').order('created_at', { ascending: false });
      setShipments(data || []);
    } catch(e) { /* table may not exist yet */ }
    setShipLoaded(true);
  };
  if (!shipLoaded) loadShipments();

  const handleAddShipment = async () => {
    if (!shipForm.origin || !shipForm.destination) return;
    try {
      await dbInsert('shipments', {
        origin: shipForm.origin, destination: shipForm.destination,
        container_type: shipForm.containerType || '20ft',
        container_count: Number(shipForm.containerCount || 1),
        broker_name: shipForm.broker || '', rate_usd: shipForm.rate ? Number(shipForm.rate) : null,
        status: 'Pending', customer_id: shipForm.customerId || null,
        order_number: shipForm.orderNumber || '', notes: shipForm.notes || '',
        eta: shipForm.eta || null,
      }, user?.id);
      await logActivity(user?.id, 'Created shipment: ' + shipForm.origin + ' → ' + shipForm.destination);
      setShowAddShipment(false); setShipForm({}); loadShipments();
    } catch(err) { alert('Error: ' + err.message); }
  };

  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">Customs & Broker / الجمارك والتخليص</h2>
        <button onClick={() => { setShowAddShipment(true); setShipForm({}); }}
          className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Shipment / شحنة</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}>
          <div className="text-[10px] text-slate-500">Pending / معلق</div>
          <div className="text-lg font-extrabold">{shipments.filter(s=>s.status==='Pending'||s.status==='In Transit').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}>
          <div className="text-[10px] text-slate-500">At Port/Clearing</div>
          <div className="text-lg font-extrabold">{shipments.filter(s=>s.status==='At Port'||s.status==='Clearing').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
          <div className="text-[10px] text-slate-500">Cleared / تم التخليص</div>
          <div className="text-lg font-extrabold">{shipments.filter(s=>s.status==='Cleared'||s.status==='Delivered').length}</div></div>
      </div>

      {showAddShipment && (
        <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
          <h3 className="text-sm font-bold text-blue-800 mb-3">New Shipment / شحنة جديدة</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] font-semibold">Origin / المنشأ</label>
              <input value={shipForm.origin||''} onChange={e=>setShipForm({...shipForm,origin:e.target.value})} placeholder="e.g. China, Turkey" className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Destination / الوجهة</label>
              <input value={shipForm.destination||''} onChange={e=>setShipForm({...shipForm,destination:e.target.value})} placeholder="e.g. Egypt, Syria" className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Container Type</label>
              <select value={shipForm.containerType||'20ft'} onChange={e=>setShipForm({...shipForm,containerType:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="20ft">20ft</option><option value="40ft">40ft</option><option value="40ft HC">40ft HC</option><option value="LCL">LCL</option>
              </select></div>
            <div><label className="text-[10px] font-semibold">Count / عدد</label>
              <input type="number" value={shipForm.containerCount||1} onChange={e=>setShipForm({...shipForm,containerCount:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Broker / المخلص</label>
              <input value={shipForm.broker||''} onChange={e=>setShipForm({...shipForm,broker:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Rate (USD)</label>
              <input type="number" value={shipForm.rate||''} onChange={e=>setShipForm({...shipForm,rate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">ETA</label>
              <input type="date" value={shipForm.eta||''} onChange={e=>setShipForm({...shipForm,eta:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Order # / رقم الأمر</label>
              <input value={shipForm.orderNumber||''} onChange={e=>setShipForm({...shipForm,orderNumber:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Client / العميل</label>
              <select value={shipForm.customerId||''} onChange={e=>setShipForm({...shipForm,customerId:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">None</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="col-span-2"><label className="text-[10px] font-semibold">Notes / ملاحظات</label>
              <textarea value={shipForm.notes||''} onChange={e=>setShipForm({...shipForm,notes:e.target.value})} rows={2} className="w-full px-3 py-2 rounded border text-sm" /></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddShipment} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Create / إنشاء</button>
            <button onClick={()=>setShowAddShipment(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {selShipment ? (
        <div className="bg-white rounded-xl p-4">
          <button onClick={()=>setSelShipment(null)} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back / رجوع</button>
          <h3 className="text-lg font-extrabold mb-2">{selShipment.origin} → {selShipment.destination}</h3>
          <div className="flex gap-2 flex-wrap mb-3">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{background:STATUS_COLORS_SHIP[selShipment.status]}}>{selShipment.status}</span>
            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">{selShipment.container_count}x {selShipment.container_type}</span>
            {selShipment.broker_name && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px]">Broker: {selShipment.broker_name}</span>}
            {selShipment.rate_usd && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px]">${selShipment.rate_usd}</span>}
            {selShipment.eta && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px]">ETA: {selShipment.eta}</span>}
          </div>
          {selShipment.notes && <p className="text-xs text-slate-600 mb-3">{selShipment.notes}</p>}
          <div className="flex gap-1 flex-wrap">
            <span className="text-[10px] text-slate-500 mr-1">Change status:</span>
            {SHIP_STATUSES.filter(s=>s!==selShipment.status).map(s=>(
              <button key={s} onClick={async()=>{
                try {
                  await dbUpdate('shipments', selShipment.id, {status:s}, user?.id);
                  await logActivity(user?.id, 'Shipment status → ' + s + ': ' + selShipment.origin + ' → ' + selShipment.destination);
                  setSelShipment({...selShipment, status:s}); loadShipments();
                } catch(err){ alert('Error: '+err.message); }
              }} className="px-2 py-0.5 rounded text-[10px] font-semibold border hover:shadow" style={{borderColor:STATUS_COLORS_SHIP[s],color:STATUS_COLORS_SHIP[s]}}>{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {shipments.length > 0 ? shipments.map(s => (
            <div key={s.id} onClick={()=>setSelShipment(s)}
              className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-bold">{s.origin} → {s.destination}</div>
                  <div className="text-[10px] text-slate-500">{s.container_count}x {s.container_type} {s.broker_name ? '| Broker: '+s.broker_name : ''}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{background:STATUS_COLORS_SHIP[s.status]}}>{s.status}</span>
              </div>
              <div className="flex gap-2 mt-1 text-[10px] text-slate-400">
                {s.rate_usd && <span className="text-emerald-600">${s.rate_usd}</span>}
                {s.eta && <span>ETA: {s.eta}</span>}
                {s.order_number && <span>Order #{s.order_number}</span>}
              </div>
            </div>
          )) : (
            <div className="bg-white rounded-xl p-6 text-center text-slate-400">
              <p className="text-4xl mb-2">🚢</p>
              <p className="text-sm font-semibold">No shipments yet</p>
              <p className="text-xs mt-1">Add a shipment to track customs clearance and broker rates</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
