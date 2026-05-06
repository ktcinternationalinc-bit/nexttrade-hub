'use client';
// ============================================================
// CustomsTab — v55.51.
//
// Two sub-tabs:
//   - Clearances   — NEW. Customs clearance records that mirror the
//                    PVC invoice 1676 format. Each clearance captures:
//                    product + customs duty %, USD price/kg, quantity in
//                    kg, FX rate, all four taxes, eight fixed fees,
//                    grand total. All math runs live as you type.
//   - Shipments    — existing shipments tracker (unchanged behavior).
//
// Numbers are SNAPSHOTTED on save so historical rows don't drift if
// government rates change in Settings → Customs Rates later.
//
// Phase 1: single product per clearance. Multi-product line items come
// in Phase 2 (rare case per Max).
// ============================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { fE } from '../lib/utils';

const STATUS_COLORS_SHIP = {Pending:'#f59e0b','In Transit':'#3b82f6','At Port':'#8b5cf6',Clearing:'#ec4899',Cleared:'#10b981',Delivered:'#374151'};
const SHIP_STATUSES = ['Pending','In Transit','At Port','Clearing','Cleared','Delivered'];
const CLEARANCE_STATUS_COLORS = { draft: '#94a3b8', paid: '#10b981', reconciled: '#3b82f6', cancelled: '#dc2626' };
const CLEARANCE_STATUSES = ['draft', 'paid', 'reconciled', 'cancelled'];

function fmtEgp(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EGP';
}
function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CustomsTab({ customers, user, fxRate }) {
  var [subTab, setSubTab] = useState('clearances');

  // ===== SHIPMENTS state (unchanged) =====
  var [shipments, setShipments] = useState([]);
  var [shipLoaded, setShipLoaded] = useState(false);
  var [showAddShipment, setShowAddShipment] = useState(false);
  var [shipForm, setShipForm] = useState({});
  var [selShipment, setSelShipment] = useState(null);

  // ===== CLEARANCES state =====
  var [clearances, setClearances] = useState([]);
  var [clrLoaded, setClrLoaded] = useState(false);
  var [showAddClr, setShowAddClr] = useState(false);
  var [selClr, setSelClr] = useState(null);
  var [clrFilter, setClrFilter] = useState({ status: '', product: '', from: '', to: '' });
  var [productList, setProductList] = useState([]);
  var [govRates, setGovRates] = useState(null);
  var [tablesReady, setTablesReady] = useState(true);
  var [tableError, setTableError] = useState(null);
  var [form, setForm] = useState({});
  var [savingClr, setSavingClr] = useState(false);

  // ===== Loaders =====
  var loadShipments = useCallback(async function () {
    try {
      var res = await supabase.from('shipments').select('*').order('created_at', { ascending: false });
      setShipments(res.data || []);
    } catch (e) { /* table may not exist yet */ }
    setShipLoaded(true);
  }, []);

  var loadClearances = useCallback(async function () {
    setClrLoaded(false);
    try {
      var res = await supabase.from('customs_clearances').select('*').order('clearance_date', { ascending: false });
      if (res.error) throw res.error;
      setClearances(res.data || []);
      setTablesReady(true);
      setTableError(null);
    } catch (e) {
      var msg = (e && e.message) || '';
      if (/does not exist|relation.*customs/i.test(msg)) {
        setTablesReady(false);
        setTableError('Customs tables not yet created. Run supabase/customs-phase-1.sql in Supabase first.');
      } else {
        setTableError(msg);
      }
      setClearances([]);
    }
    setClrLoaded(true);
  }, []);

  var loadConfig = useCallback(async function () {
    try {
      var setRes = await supabase.from('customs_settings').select('*').eq('id', 1).maybeSingle();
      if (!setRes.error && setRes.data) setGovRates(setRes.data);
      else setGovRates({ vat_pct: 14, advance_income_tax_pct: 1, bank_commission_pct: 10 });
      var ratesRes = await supabase.from('customs_rates').select('*').eq('active', true).order('product_name', { ascending: true });
      if (!ratesRes.error) setProductList(ratesRes.data || []);
    } catch (e) { /* tables may not exist yet */ }
  }, []);

  // v55.61 — Moved data loaders into useEffect. The previous version called
  // loadShipments() / loadClearances() / loadConfig() DURING render with
  // `if (!loaded) load()`. That set state during render which triggered
  // another render which fired the loaders again — React error #301
  // ("too many re-renders"). useEffect runs AFTER render so it's safe.
  useEffect(function () {
    loadShipments();
    loadClearances();
    loadConfig();
  }, [loadShipments, loadClearances, loadConfig]);

  // ===== Live calculations =====
  var calcs = useMemo(function () {
    var usdPerKg = Number(form.usd_price_per_kg) || 0;
    var qtyKg = Number(form.quantity_kg) || 0;
    var fx = Number(form.fx_rate) || 0;
    var customsPct = Number(form.customs_duty_pct) || 0;
    var vatPct = Number((govRates && govRates.vat_pct) ?? 14);
    var aitPct = Number((govRates && govRates.advance_income_tax_pct) ?? 1);
    var bcPct = Number((govRates && govRates.bank_commission_pct) ?? 10);
    var totalUsd = usdPerKg * qtyKg;
    var totalEgp = totalUsd * fx;
    var customsDutyEgp = totalEgp * (customsPct / 100);
    var vatEgp = (totalEgp + customsDutyEgp) * (vatPct / 100);
    var aitEgp = (totalEgp + customsDutyEgp) * (aitPct / 100);
    var bcEgp = aitEgp * (bcPct / 100);
    var fixedSum =
      (Number(form.permit_withdrawal_egp) || 0) +
      (Number(form.unloading_egp) || 0) +
      (Number(form.cranes_loading_egp) || 0) +
      (Number(form.storage_egp) || 0) +
      (Number(form.road_fees_egp) || 0) +
      (Number(form.pricing_committee_egp) || 0) +
      (Number(form.misc_clearance_egp) || 0) +
      (Number(form.transport_egp) || 0);
    var totalClearance = customsDutyEgp + vatEgp + aitEgp + bcEgp + fixedSum;
    return { totalUsd, totalEgp, customsDutyEgp, vatEgp, aitEgp, bcEgp, vatPct, aitPct, bcPct, fixedSum, totalClearance };
  }, [form, govRates]);

  var openNewClearance = function () {
    setForm({
      clearance_date: new Date().toISOString().substring(0, 10),
      fx_rate: (fxRate && fxRate.rate) ? Number(fxRate.rate).toFixed(2) : '',
      status: 'draft',
    });
    setShowAddClr(true);
  };

  var pickProduct = function (productName) {
    if (!productName) {
      setForm(Object.assign({}, form, { product_name: '', customs_duty_pct: '' }));
      return;
    }
    var p = productList.find(function (x) { return x.product_name === productName; });
    if (!p) return;
    setForm(Object.assign({}, form, {
      product_name: p.product_name,
      customs_duty_pct: p.customs_duty_pct,
    }));
  };

  var saveClearance = async function () {
    if (savingClr) return;
    var errs = [];
    if (!form.clearance_date) errs.push('Clearance date is required.');
    if (!form.product_name) errs.push('Product is required (pick from the list, or add it in Settings → Customs Rates).');
    if (!form.usd_price_per_kg || Number(form.usd_price_per_kg) <= 0) errs.push('USD price per kg is required.');
    if (!form.quantity_kg || Number(form.quantity_kg) <= 0) errs.push('Quantity (kg) is required.');
    if (!form.fx_rate || Number(form.fx_rate) <= 0) errs.push('FX rate is required.');
    if (errs.length > 0) { alert('Cannot save:\n\n• ' + errs.join('\n• ')); return; }
    setSavingClr(true);
    try {
      var nowIso = new Date().toISOString();
      var payload = {
        reference_number: form.reference_number || null,
        shipment_id: form.shipment_id || null,
        clearance_date: form.clearance_date,
        product_name: form.product_name,
        customs_duty_pct: Number(form.customs_duty_pct) || 0,
        usd_price_per_kg: Number(form.usd_price_per_kg),
        quantity_kg: Number(form.quantity_kg),
        fx_rate: Number(form.fx_rate),
        total_usd: calcs.totalUsd,
        total_egp: calcs.totalEgp,
        customs_duty_egp: calcs.customsDutyEgp,
        vat_egp: calcs.vatEgp,
        advance_income_tax_egp: calcs.aitEgp,
        bank_commission_egp: calcs.bcEgp,
        vat_pct: calcs.vatPct,
        advance_income_tax_pct: calcs.aitPct,
        bank_commission_pct: calcs.bcPct,
        permit_withdrawal_egp: Number(form.permit_withdrawal_egp) || 0,
        unloading_egp: Number(form.unloading_egp) || 0,
        cranes_loading_egp: Number(form.cranes_loading_egp) || 0,
        storage_egp: Number(form.storage_egp) || 0,
        road_fees_egp: Number(form.road_fees_egp) || 0,
        pricing_committee_egp: Number(form.pricing_committee_egp) || 0,
        misc_clearance_egp: Number(form.misc_clearance_egp) || 0,
        transport_egp: Number(form.transport_egp) || 0,
        total_clearance_egp: calcs.totalClearance,
        status: form.status || 'draft',
        notes: form.notes || null,
        created_at: nowIso,
        created_by: user?.id || null,
        updated_at: nowIso,
        updated_by: user?.id || null,
      };
      var res = await supabase.from('customs_clearances').insert(payload).select().maybeSingle();
      if (res.error) throw new Error(res.error.message);
      try { logActivity(user?.id, 'Created customs clearance: ' + (form.reference_number || form.product_name) + ' total ' + Math.round(calcs.totalClearance) + ' EGP', 'customs').catch(function () {}); } catch (_) {}
      setShowAddClr(false);
      setForm({});
      await loadClearances();
    } catch (e) {
      alert('Could not save clearance: ' + ((e && e.message) || 'unknown error'));
    } finally {
      setSavingClr(false);
    }
  };

  var filteredClearances = useMemo(function () {
    return clearances.filter(function (c) {
      if (clrFilter.status && c.status !== clrFilter.status) return false;
      if (clrFilter.product && c.product_name !== clrFilter.product) return false;
      if (clrFilter.from && c.clearance_date < clrFilter.from) return false;
      if (clrFilter.to && c.clearance_date > clrFilter.to) return false;
      return true;
    });
  }, [clearances, clrFilter]);

  var totals = useMemo(function () {
    var byStatus = {};
    var grand = 0;
    var byProduct = {};
    filteredClearances.forEach(function (c) {
      var t = Number(c.total_clearance_egp) || 0;
      byStatus[c.status] = (byStatus[c.status] || 0) + t;
      grand += t;
      byProduct[c.product_name] = (byProduct[c.product_name] || 0) + t;
    });
    return { byStatus, grand, byProduct };
  }, [filteredClearances]);

  var handleAddShipment = async function () {
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
      await logActivity(user?.id, 'Created shipment: ' + shipForm.origin + ' → ' + shipForm.destination, 'customs');
      setShowAddShipment(false); setShipForm({}); loadShipments();
    } catch (err) { alert('Error: ' + err.message); }
  };

  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">Customs & Broker / الجمارك والتخليص</h2>
      </div>

      <div className="flex gap-1 mb-3 border-b border-slate-200">
        <button onClick={() => setSubTab('clearances')}
          className={'px-4 py-2 text-xs font-bold transition border-b-2 ' + (subTab === 'clearances' ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          📋 Clearances / تخليص جمركي
        </button>
        <button onClick={() => setSubTab('shipments')}
          className={'px-4 py-2 text-xs font-bold transition border-b-2 ' + (subTab === 'shipments' ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          🚢 Shipments / الشحنات
        </button>
      </div>

      {/* CLEARANCES TAB */}
      {subTab === 'clearances' && (
        <div>
          {!tablesReady && tableError && (
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-300 mb-3">
              <div className="text-sm font-bold text-amber-800 mb-1">⚠️ Customs tables not set up yet</div>
              <div className="text-xs text-amber-700 mb-2">{tableError}</div>
              <div className="text-xs text-amber-700"><b>To fix:</b> open Supabase → SQL Editor → paste the contents of <code className="bg-white px-1 rounded">supabase/customs-phase-1.sql</code> from the latest build → Run.</div>
            </div>
          )}

          <div className="flex justify-between flex-wrap gap-2 mb-3">
            <div className="flex gap-2 flex-wrap">
              {tablesReady && (
                <button onClick={openNewClearance}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600">
                  + New Clearance / تخليص جديد
                </button>
              )}
              <button onClick={() => { loadClearances(); loadConfig(); }}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold hover:bg-slate-50">
                ↻ Refresh
              </button>
            </div>
            {fxRate && fxRate.rate && (
              <div className="text-[10px] text-slate-500">
                Live FX rate (auto-pulled): <b className="text-emerald-600">1 USD = {Number(fxRate.rate).toFixed(2)} EGP</b>
              </div>
            )}
          </div>

          {tablesReady && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase">Status</label>
                <select value={clrFilter.status} onChange={e => setClrFilter(Object.assign({}, clrFilter, { status: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs bg-white">
                  <option value="">All</option>
                  {CLEARANCE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase">Product</label>
                <select value={clrFilter.product} onChange={e => setClrFilter(Object.assign({}, clrFilter, { product: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs bg-white">
                  <option value="">All</option>
                  {productList.map(p => <option key={p.id} value={p.product_name}>{p.product_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase">From</label>
                <input type="date" value={clrFilter.from} onChange={e => setClrFilter(Object.assign({}, clrFilter, { from: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs" />
              </div>
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase">To</label>
                <input type="date" value={clrFilter.to} onChange={e => setClrFilter(Object.assign({}, clrFilter, { to: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs" />
              </div>
            </div>
          )}

          {tablesReady && filteredClearances.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div className="bg-white rounded-lg p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase font-semibold">Total Customs Paid</div>
                <div className="text-sm font-extrabold text-slate-800">{fmtEgp(totals.grand)}</div>
              </div>
              <div className="bg-white rounded-lg p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase font-semibold">Records</div>
                <div className="text-sm font-extrabold text-slate-800">{filteredClearances.length}</div>
              </div>
              <div className="bg-white rounded-lg p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase font-semibold">Draft</div>
                <div className="text-sm font-extrabold text-slate-500">{fmtEgp(totals.byStatus.draft || 0)}</div>
              </div>
              <div className="bg-white rounded-lg p-2 border border-slate-200">
                <div className="text-[9px] text-slate-500 uppercase font-semibold">Paid</div>
                <div className="text-sm font-extrabold text-emerald-600">{fmtEgp(totals.byStatus.paid || 0)}</div>
              </div>
            </div>
          )}

          {/* New Clearance form */}
          {showAddClr && (
            <div className="bg-blue-50 rounded-xl p-4 mb-3 border-2 border-blue-300">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-extrabold text-blue-900">📋 New Clearance / تخليص جديد</h3>
                <button onClick={() => { setShowAddClr(false); setForm({}); }}
                  className="text-xl text-slate-400 hover:text-slate-600">×</button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                <div>
                  <label className="text-[10px] font-semibold text-slate-700">Reference # / رقم المرجع</label>
                  <input value={form.reference_number || ''} onChange={e => setForm(Object.assign({}, form, { reference_number: e.target.value }))}
                    placeholder="e.g. 1676"
                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-700">Clearance Date *</label>
                  <input type="date" value={form.clearance_date || ''} onChange={e => setForm(Object.assign({}, form, { clearance_date: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-700">Link to Shipment (optional)</label>
                  <select value={form.shipment_id || ''} onChange={e => setForm(Object.assign({}, form, { shipment_id: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm bg-white">
                    <option value="">None</option>
                    {shipments.map(s => <option key={s.id} value={s.id}>{s.origin} → {s.destination} {s.order_number ? '(#' + s.order_number + ')' : ''}</option>)}
                  </select>
                </div>
              </div>

              <div className="bg-white rounded-lg p-3 mb-3 border border-slate-200">
                <div className="text-[11px] font-extrabold text-slate-700 mb-2">📦 Product & Quantity / المنتج والكمية</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-700">Product *</label>
                    <select value={form.product_name || ''} onChange={e => pickProduct(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm bg-white">
                      <option value="">— pick a product —</option>
                      {productList.map(p => <option key={p.id} value={p.product_name}>{p.product_name} ({Number(p.customs_duty_pct).toFixed(1)}%)</option>)}
                    </select>
                    {productList.length === 0 && (
                      <div className="text-[9px] text-amber-600 mt-1">No products yet. Add them in Settings → Customs Rates.</div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-700">Customs Duty %</label>
                    <input type="number" step="0.01" value={form.customs_duty_pct ?? ''} onChange={e => setForm(Object.assign({}, form, { customs_duty_pct: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm bg-amber-50" />
                    <div className="text-[9px] text-slate-400 mt-0.5">Auto-fills; editable for one-offs</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-700">USD/kg / السعر بالدولار *</label>
                    <input type="number" step="0.01" value={form.usd_price_per_kg ?? ''} onChange={e => setForm(Object.assign({}, form, { usd_price_per_kg: e.target.value }))}
                      placeholder="e.g. 1.6"
                      className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-700">Quantity kg / الكمية *</label>
                    <input type="number" step="0.01" value={form.quantity_kg ?? ''} onChange={e => setForm(Object.assign({}, form, { quantity_kg: e.target.value }))}
                      placeholder="e.g. 25471"
                      className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-700">FX Rate (USD→EGP) *</label>
                    <input type="number" step="0.01" value={form.fx_rate ?? ''} onChange={e => setForm(Object.assign({}, form, { fx_rate: e.target.value }))}
                      placeholder="e.g. 53"
                      className="w-full px-2 py-1.5 rounded border border-emerald-300 text-sm bg-emerald-50" />
                    {fxRate && fxRate.rate && (
                      <div className="text-[9px] text-emerald-600 mt-0.5 cursor-pointer" onClick={() => setForm(Object.assign({}, form, { fx_rate: Number(fxRate.rate).toFixed(2) }))}>
                        Click to use today's: {Number(fxRate.rate).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 mb-3">
                <div className="text-[11px] font-extrabold text-emerald-900 mb-2">💵 Calculated Values (auto)</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <div className="bg-white rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Total USD</div>
                    <div className="font-extrabold text-slate-800">{fmtUsd(calcs.totalUsd)}</div>
                  </div>
                  <div className="bg-white rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Total EGP / القيمة</div>
                    <div className="font-extrabold text-slate-800">{fmtEgp(calcs.totalEgp)}</div>
                  </div>
                  <div className="bg-white rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Customs Duty / رسوم</div>
                    <div className="font-extrabold text-blue-700">{fmtEgp(calcs.customsDutyEgp)}</div>
                    <div className="text-[9px] text-slate-400">@{Number(form.customs_duty_pct || 0).toFixed(2)}%</div>
                  </div>
                  <div className="bg-white rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase">VAT / ض ق م</div>
                    <div className="font-extrabold text-purple-700">{fmtEgp(calcs.vatEgp)}</div>
                    <div className="text-[9px] text-slate-400">@{calcs.vatPct.toFixed(2)}%</div>
                  </div>
                  <div className="bg-white rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Income Tax / ض ا ت</div>
                    <div className="font-extrabold text-indigo-700">{fmtEgp(calcs.aitEgp)}</div>
                    <div className="text-[9px] text-slate-400">@{calcs.aitPct.toFixed(2)}%</div>
                  </div>
                  <div className="bg-white rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Bank Commission</div>
                    <div className="font-extrabold text-amber-700">{fmtEgp(calcs.bcEgp)}</div>
                    <div className="text-[9px] text-slate-400">@{calcs.bcPct.toFixed(2)}% of income tax</div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-3 mb-3 border border-slate-200">
                <div className="text-[11px] font-extrabold text-slate-700 mb-2">💰 Fixed Fees (EGP) / رسوم ثابتة</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { k: 'permit_withdrawal_egp', en: 'Permit Withdrawal', ar: 'سحب الاذن' },
                    { k: 'unloading_egp', en: 'Unloading', ar: 'عوائد تفريغ' },
                    { k: 'cranes_loading_egp', en: 'Cranes & Loading', ar: 'اوناش وتحميل' },
                    { k: 'storage_egp', en: 'Storage', ar: 'ارضيات' },
                    { k: 'road_fees_egp', en: 'Road Fees', ar: 'رسوم طريق' },
                    { k: 'pricing_committee_egp', en: 'Pricing Committee', ar: 'لجنة تسعير' },
                    { k: 'misc_clearance_egp', en: 'Misc & Clearance', ar: 'نثريات' },
                    { k: 'transport_egp', en: 'Transport', ar: 'النقل' },
                  ].map(function (f) {
                    return (
                      <div key={f.k}>
                        <label className="text-[10px] font-semibold text-slate-700">{f.en} / {f.ar}</label>
                        <input type="number" step="0.01" value={form[f.k] ?? ''} onChange={e => { var o = {}; o[f.k] = e.target.value; setForm(Object.assign({}, form, o)); }}
                          placeholder="0"
                          className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm" />
                      </div>
                    );
                  })}
                </div>
                <div className="text-right mt-2 text-xs">
                  <span className="text-slate-500">Fixed fees subtotal: </span>
                  <span className="font-extrabold text-slate-800">{fmtEgp(calcs.fixedSum)}</span>
                </div>
              </div>

              <div className="mb-3">
                <label className="text-[10px] font-semibold text-slate-700">Notes / ملاحظات</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(Object.assign({}, form, { notes: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm" />
              </div>

              <div className="bg-slate-900 text-white rounded-lg p-3 mb-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Grand Total / الإجمالي</div>
                <div className="text-2xl font-black text-emerald-400">{fmtEgp(calcs.totalClearance)}</div>
              </div>

              <div className="flex gap-2">
                <button onClick={saveClearance} disabled={savingClr}
                  className={'flex-1 px-4 py-2.5 rounded-lg text-sm font-bold ' + (savingClr ? 'bg-slate-300 text-slate-500' : 'bg-emerald-500 text-white hover:bg-emerald-600')}>
                  {savingClr ? '⏳ Saving…' : '💾 Save Clearance / حفظ'}
                </button>
                <button onClick={() => { setShowAddClr(false); setForm({}); }}
                  className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-bold hover:bg-slate-50">
                  Cancel / إلغاء
                </button>
              </div>
            </div>
          )}

          {/* Detail view */}
          {selClr && !showAddClr && (
            <div className="bg-white rounded-xl p-4 border border-slate-200 mb-3">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <button onClick={() => setSelClr(null)} className="px-2 py-0.5 text-[10px] border border-slate-300 rounded mb-2">← Back</button>
                  <h3 className="text-lg font-extrabold">{selClr.product_name} {selClr.reference_number ? '· #' + selClr.reference_number : ''}</h3>
                  <div className="text-xs text-slate-500">{selClr.clearance_date}</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: CLEARANCE_STATUS_COLORS[selClr.status] || '#94a3b8' }}>{selClr.status}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div><span className="text-slate-500">Product:</span> <b>{selClr.product_name}</b> ({Number(selClr.customs_duty_pct).toFixed(2)}%)</div>
                <div><span className="text-slate-500">USD/kg:</span> <b>{fmtUsd(selClr.usd_price_per_kg)}</b></div>
                <div><span className="text-slate-500">Qty:</span> <b>{Number(selClr.quantity_kg).toLocaleString()} kg</b></div>
                <div><span className="text-slate-500">FX:</span> <b>{Number(selClr.fx_rate).toFixed(2)}</b></div>
                <div><span className="text-slate-500">Total USD:</span> <b>{fmtUsd(selClr.total_usd)}</b></div>
                <div><span className="text-slate-500">Total EGP:</span> <b>{fmtEgp(selClr.total_egp)}</b></div>
                <div><span className="text-slate-500">Customs:</span> <b>{fmtEgp(selClr.customs_duty_egp)}</b></div>
                <div><span className="text-slate-500">VAT ({Number(selClr.vat_pct).toFixed(1)}%):</span> <b>{fmtEgp(selClr.vat_egp)}</b></div>
                <div><span className="text-slate-500">Income Tax ({Number(selClr.advance_income_tax_pct).toFixed(1)}%):</span> <b>{fmtEgp(selClr.advance_income_tax_egp)}</b></div>
                <div><span className="text-slate-500">Bank Comm:</span> <b>{fmtEgp(selClr.bank_commission_egp)}</b></div>
                <div><span className="text-slate-500">Permit:</span> <b>{fmtEgp(selClr.permit_withdrawal_egp)}</b></div>
                <div><span className="text-slate-500">Unloading:</span> <b>{fmtEgp(selClr.unloading_egp)}</b></div>
                <div><span className="text-slate-500">Cranes:</span> <b>{fmtEgp(selClr.cranes_loading_egp)}</b></div>
                <div><span className="text-slate-500">Storage:</span> <b>{fmtEgp(selClr.storage_egp)}</b></div>
                <div><span className="text-slate-500">Road fees:</span> <b>{fmtEgp(selClr.road_fees_egp)}</b></div>
                <div><span className="text-slate-500">Pricing comm:</span> <b>{fmtEgp(selClr.pricing_committee_egp)}</b></div>
                <div><span className="text-slate-500">Misc/clearance:</span> <b>{fmtEgp(selClr.misc_clearance_egp)}</b></div>
                <div><span className="text-slate-500">Transport:</span> <b>{fmtEgp(selClr.transport_egp)}</b></div>
              </div>
              <div className="mt-3 p-3 bg-slate-900 text-white rounded text-center">
                <div className="text-[10px] uppercase text-slate-400">Total Clearance Cost</div>
                <div className="text-xl font-black text-emerald-400">{fmtEgp(selClr.total_clearance_egp)}</div>
              </div>
              {selClr.notes && <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-2 rounded">📝 {selClr.notes}</div>}
              <div className="mt-3 flex gap-1 flex-wrap items-center">
                <span className="text-[10px] text-slate-500 mr-1">Set status:</span>
                {CLEARANCE_STATUSES.filter(s => s !== selClr.status).map(s => (
                  <button key={s} onClick={async () => {
                    try {
                      var patch = { status: s };
                      if (s === 'paid') { patch.paid_at = new Date().toISOString(); patch.paid_by = user?.id || null; }
                      var r = await supabase.from('customs_clearances').update(patch).eq('id', selClr.id).select().maybeSingle();
                      if (r.error) throw r.error;
                      setSelClr(r.data);
                      await loadClearances();
                    } catch (e) { alert('Could not change status: ' + ((e && e.message) || 'unknown error')); }
                  }} className="px-2 py-0.5 rounded text-[10px] font-semibold border hover:shadow"
                    style={{ borderColor: CLEARANCE_STATUS_COLORS[s], color: CLEARANCE_STATUS_COLORS[s] }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {tablesReady && !selClr && !showAddClr && (
            <div className="space-y-2">
              {filteredClearances.length === 0 ? (
                <div className="bg-white rounded-xl p-6 text-center text-slate-400 border border-slate-200">
                  <p className="text-4xl mb-2">📋</p>
                  <p className="text-sm font-semibold">{clearances.length === 0 ? 'No clearances yet' : 'No clearances match your filters'}</p>
                  {clearances.length === 0 && <p className="text-xs mt-1">Tap "+ New Clearance" to add your first one.</p>}
                </div>
              ) : filteredClearances.map(function (c) {
                return (
                  <div key={c.id} onClick={() => setSelClr(c)}
                    className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
                    <div className="flex justify-between items-start flex-wrap gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-800">
                          {c.product_name}
                          {c.reference_number ? <span className="ml-2 text-[11px] font-mono bg-slate-100 px-1.5 py-0.5 rounded">#{c.reference_number}</span> : null}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {c.clearance_date} · {Number(c.quantity_kg).toLocaleString()} kg @ {fmtUsd(c.usd_price_per_kg)}/kg · FX {Number(c.fx_rate).toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-extrabold text-emerald-700">{fmtEgp(c.total_clearance_egp)}</div>
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold text-white" style={{ background: CLEARANCE_STATUS_COLORS[c.status] || '#94a3b8' }}>{c.status}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SHIPMENTS TAB (preserved) */}
      {subTab === 'shipments' && (
        <div>
          <div className="flex justify-between flex-wrap gap-2 mb-3">
            <div></div>
            <button onClick={() => { setShowAddShipment(true); setShipForm({}); }}
              className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Shipment / شحنة</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#f59e0b' }}>
              <div className="text-[10px] text-slate-500">Pending / معلق</div>
              <div className="text-lg font-extrabold">{shipments.filter(s => s.status === 'Pending' || s.status === 'In Transit').length}</div>
            </div>
            <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5cf6' }}>
              <div className="text-[10px] text-slate-500">At Port/Clearing</div>
              <div className="text-lg font-extrabold">{shipments.filter(s => s.status === 'At Port' || s.status === 'Clearing').length}</div>
            </div>
            <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#10b981' }}>
              <div className="text-[10px] text-slate-500">Cleared / تم التخليص</div>
              <div className="text-lg font-extrabold">{shipments.filter(s => s.status === 'Cleared' || s.status === 'Delivered').length}</div>
            </div>
          </div>
          {showAddShipment && (
            <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
              <h3 className="text-sm font-bold text-blue-800 mb-3">New Shipment / شحنة جديدة</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold">Origin / المنشأ</label>
                  <input value={shipForm.origin || ''} onChange={e => setShipForm({ ...shipForm, origin: e.target.value })} placeholder="e.g. China, Turkey" className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Destination / الوجهة</label>
                  <input value={shipForm.destination || ''} onChange={e => setShipForm({ ...shipForm, destination: e.target.value })} placeholder="e.g. Egypt, Syria" className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Container Type</label>
                  <select value={shipForm.containerType || '20ft'} onChange={e => setShipForm({ ...shipForm, containerType: e.target.value })} className="w-full px-3 py-2 rounded border text-sm">
                    <option value="20ft">20ft</option><option value="40ft">40ft</option><option value="40ft HC">40ft HC</option><option value="LCL">LCL</option>
                  </select></div>
                <div><label className="text-[10px] font-semibold">Count / عدد</label>
                  <input type="number" value={shipForm.containerCount || 1} onChange={e => setShipForm({ ...shipForm, containerCount: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Broker / المخلص</label>
                  <input value={shipForm.broker || ''} onChange={e => setShipForm({ ...shipForm, broker: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Rate (USD)</label>
                  <input type="number" value={shipForm.rate || ''} onChange={e => setShipForm({ ...shipForm, rate: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">ETA</label>
                  <input type="date" value={shipForm.eta || ''} onChange={e => setShipForm({ ...shipForm, eta: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Order # / رقم الأمر</label>
                  <input value={shipForm.orderNumber || ''} onChange={e => setShipForm({ ...shipForm, orderNumber: e.target.value })} className="w-full px-3 py-2 rounded border text-sm" /></div>
                <div><label className="text-[10px] font-semibold">Client / العميل</label>
                  <select value={shipForm.customerId || ''} onChange={e => setShipForm({ ...shipForm, customerId: e.target.value })} className="w-full px-3 py-2 rounded border text-sm">
                    <option value="">None</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div className="col-span-2"><label className="text-[10px] font-semibold">Notes / ملاحظات</label>
                  <textarea value={shipForm.notes || ''} onChange={e => setShipForm({ ...shipForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 rounded border text-sm" /></div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAddShipment} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Create / إنشاء</button>
                <button onClick={() => setShowAddShipment(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          )}
          {selShipment ? (
            <div className="bg-white rounded-xl p-4">
              <button onClick={() => setSelShipment(null)} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← Back / رجوع</button>
              <h3 className="text-lg font-extrabold mb-2">{selShipment.origin} → {selShipment.destination}</h3>
              <div className="flex gap-2 flex-wrap mb-3">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: STATUS_COLORS_SHIP[selShipment.status] }}>{selShipment.status}</span>
                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">{selShipment.container_count}x {selShipment.container_type}</span>
                {selShipment.broker_name && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px]">Broker: {selShipment.broker_name}</span>}
                {selShipment.rate_usd && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px]">${selShipment.rate_usd}</span>}
                {selShipment.eta && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px]">ETA: {selShipment.eta}</span>}
              </div>
              {selShipment.notes && <p className="text-xs text-slate-600 mb-3">{selShipment.notes}</p>}
              <div className="flex gap-1 flex-wrap">
                <span className="text-[10px] text-slate-500 mr-1">Change status:</span>
                {SHIP_STATUSES.filter(s => s !== selShipment.status).map(s => (
                  <button key={s} onClick={async () => {
                    try {
                      await dbUpdate('shipments', selShipment.id, { status: s }, user?.id);
                      await logActivity(user?.id, 'Shipment status → ' + s + ': ' + selShipment.origin + ' → ' + selShipment.destination, 'customs');
                      setSelShipment({ ...selShipment, status: s }); loadShipments();
                    } catch (err) { alert('Error: ' + err.message); }
                  }} className="px-2 py-0.5 rounded text-[10px] font-semibold border hover:shadow" style={{ borderColor: STATUS_COLORS_SHIP[s], color: STATUS_COLORS_SHIP[s] }}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {shipments.length > 0 ? shipments.map(s => (
                <div key={s.id} onClick={() => setSelShipment(s)}
                  className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-bold">{s.origin} → {s.destination}</div>
                      <div className="text-[10px] text-slate-500">{s.container_count}x {s.container_type} {s.broker_name ? '| Broker: ' + s.broker_name : ''}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ background: STATUS_COLORS_SHIP[s.status] }}>{s.status}</span>
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
      )}
    </div>
  );
}
