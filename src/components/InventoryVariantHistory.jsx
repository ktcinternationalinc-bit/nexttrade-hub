'use client';
// v55.83-A.6.27.44d.1 — Inventory Variant History modal.
//
// Opens from Product List "🔍 History" button. Shows everywhere a variant has
// been touched: receipts (Inbound), invoice consumptions (Outbound), adjustments,
// and a stock summary.
//
// Bilingual UI. High-contrast. Read-only — no edits from this modal.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmtDate(s) {
  if (!s) return '—';
  try {
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toISOString().substring(0, 10);
  } catch (e) { return s; }
}

function fmtNum(n, dp) {
  if (n == null || n === '') return '—';
  var v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toFixed(dp == null ? 2 : dp);
}

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  var v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InventoryVariantHistory({ variant, onClose, isOpen }) {
  var [tab, setTab] = useState('summary');
  var [loading, setLoading] = useState(true);
  var [receipts, setReceipts] = useState([]);   // Inbound: inventory_stock_receipts
  var [outbound, setOutbound] = useState([]);   // Outbound: invoice_items where uses_inventory + variant_id
  var [adjustments, setAdjustments] = useState([]);
  var [layers, setLayers] = useState([]);       // Current FIFO layers for stock summary
  var [error, setError] = useState(null);

  useEffect(function () {
    if (!isOpen || !variant || !variant.id) return;
    var cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Query all four data sources in parallel, tolerating any missing tables.
        var safeQuery = function (promise) {
          return promise.then(function (r) { return r; }).catch(function (e) {
            console.warn('[variant-history]', e && e.message);
            return { data: [], error: e };
          });
        };

        var resReceipts = await safeQuery(
          supabase
            .from('inventory_stock_receipts')
            .select('id, receipt_number, receipt_date, quantity, cost_per_uom, supplier, warehouse_id, status, header_id')
            .eq('product_id', variant.id)
            .order('receipt_date', { ascending: false })
            .limit(200)
        );
        if (cancelled) return;
        setReceipts((resReceipts && resReceipts.data) || []);

        // Outbound: invoice_items where this variant was sold (44b/c flow)
        // Old/legacy invoices may not have these columns yet — handle gracefully.
        var resOutbound = await safeQuery(
          supabase
            .from('invoice_items')
            .select('id, invoice_id, description, sale_quantity, sale_price_per_uom, cogs_total, gross_profit, inventory_status, inventory_consumed_at, backorder_qty, rolls_sold')
            .eq('variant_id', variant.id)
            .order('inventory_consumed_at', { ascending: false, nullsFirst: false })
            .limit(200)
        );
        if (cancelled) return;
        var outboundRows = (resOutbound && resOutbound.data) || [];
        // Enrich with parent invoice metadata (order_number + customer)
        if (outboundRows.length > 0) {
          var invIds = Array.from(new Set(outboundRows.map(function (r) { return r.invoice_id; }).filter(Boolean)));
          if (invIds.length > 0) {
            var resInvoices = await safeQuery(
              supabase
                .from('invoices')
                .select('id, order_number, customer_name, invoice_date')
                .in('id', invIds)
            );
            var invMap = {};
            ((resInvoices && resInvoices.data) || []).forEach(function (inv) { invMap[inv.id] = inv; });
            outboundRows = outboundRows.map(function (r) {
              var parent = invMap[r.invoice_id] || {};
              return Object.assign({}, r, {
                _invoice_order_number: parent.order_number,
                _invoice_customer_name: parent.customer_name,
                _invoice_date: parent.invoice_date,
              });
            });
          }
        }
        if (cancelled) return;
        setOutbound(outboundRows);

        // Adjustments (table may not exist yet on some installs)
        var resAdj = await safeQuery(
          supabase
            .from('inventory_adjustments')
            .select('id, adjustment_date, adjustment_type, qty_change, reason, notes, status, approved_at, created_at')
            .eq('product_id', variant.id)
            .order('created_at', { ascending: false })
            .limit(200)
        );
        if (cancelled) return;
        setAdjustments((resAdj && resAdj.data) || []);

        // FIFO layers for current stock-on-hand summary (table may not exist)
        var resLayers = await safeQuery(
          supabase
            .from('inventory_layers')
            .select('id, warehouse_id, qty_remaining, cost_per_uom, received_at')
            .eq('product_id', variant.id)
            .gt('qty_remaining', 0)
            .order('received_at', { ascending: true })
        );
        if (cancelled) return;
        setLayers((resLayers && resLayers.data) || []);
      } catch (e) {
        if (!cancelled) {
          console.error('[variant-history] load failed:', e);
          setError((e && e.message) || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return function () { cancelled = true; };
  }, [variant && variant.id, isOpen]);

  var stockSummary = useMemo(function () {
    // Totals across all loaded data
    var totalReceived = 0;
    receipts.forEach(function (r) { totalReceived += Number(r.quantity || 0); });
    var totalSold = 0;
    var totalCogs = 0;
    var totalRevenue = 0;
    outbound.forEach(function (r) {
      if (r.inventory_status === 'consumed') {
        totalSold += Number(r.sale_quantity || 0);
        totalCogs += Number(r.cogs_total || 0);
        totalRevenue += Number(r.sale_quantity || 0) * Number(r.sale_price_per_uom || 0);
      }
    });
    var totalAdjusted = 0;
    adjustments.forEach(function (a) {
      if (a.status === 'approved' || a.status === 'consumed') {
        totalAdjusted += Number(a.qty_change || 0);
      }
    });
    var currentOnHand = 0;
    var weightedCost = 0;
    var totalRemaining = 0;
    layers.forEach(function (l) {
      var qty = Number(l.qty_remaining || 0);
      currentOnHand += qty;
      weightedCost += qty * Number(l.cost_per_uom || 0);
      totalRemaining += qty;
    });
    var avgCost = totalRemaining > 0 ? weightedCost / totalRemaining : 0;
    var gp = totalRevenue - totalCogs;
    var margin = totalRevenue > 0 ? (gp / totalRevenue) * 100 : 0;
    // Most recent sale price
    var lastSale = outbound.find(function (r) {
      return r.inventory_status === 'consumed' && r.sale_price_per_uom != null;
    });
    return {
      totalReceived: totalReceived,
      totalSold: totalSold,
      totalAdjusted: totalAdjusted,
      currentOnHand: currentOnHand,
      avgCost: avgCost,
      totalRevenue: totalRevenue,
      totalCogs: totalCogs,
      grossProfit: gp,
      margin: margin,
      lastSalePrice: lastSale ? lastSale.sale_price_per_uom : null,
      lastSaleDate: lastSale ? lastSale.inventory_consumed_at : null,
    };
  }, [receipts, outbound, adjustments, layers]);

  if (!isOpen || !variant) return null;

  var displayCode = variant.quick_code + (variant.variant_suffix ? '-' + variant.variant_suffix : '');

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-start justify-center pt-6 pb-6 px-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white text-slate-900 rounded-2xl shadow-2xl mx-auto flex flex-col"
        onClick={function (e) { e.stopPropagation(); }}
        style={{ width: '95vw', maxWidth: 1600, maxHeight: 'calc(100vh - 60px)' }}
      >
        {/* Header */}
        <div className="bg-indigo-700 text-white rounded-t-2xl px-6 py-4 flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-indigo-100">Variant History / سجل المنتج</div>
            <div className="text-xl font-extrabold mt-0.5 font-mono">{displayCode}</div>
            <div className="text-sm font-bold text-indigo-50">{variant.name_en}</div>
            <div className="text-sm font-bold text-indigo-50" style={{ direction: 'rtl' }}>{variant.name_ar}</div>
          </div>
          <button onClick={onClose} className="px-3 py-1 bg-white text-indigo-700 hover:bg-indigo-100 text-sm font-extrabold rounded-lg">
            ✕ Close / إغلاق
          </button>
        </div>

        {/* Tabs — v55.83-A.6.27.50: high-contrast (black on white when active, white on slate-800 when inactive, no opacity tricks) */}
        <div className="flex gap-1 px-4 pt-3 bg-indigo-100 border-b-2 border-indigo-400">
          {[
            { id: 'summary', label_en: '📊 Stock Summary', label_ar: 'ملخص المخزون' },
            { id: 'inbound', label_en: '📥 Inbound', label_ar: 'الوارد', count: receipts.length },
            { id: 'outbound', label_en: '📤 Outbound', label_ar: 'المباع', count: outbound.length },
            { id: 'adjustments', label_en: '⚖️ Adjustments', label_ar: 'التسويات', count: adjustments.length },
          ].map(function (t) {
            var active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={function () { setTab(t.id); }}
                className={'px-4 py-2 text-sm font-extrabold rounded-t-lg transition-colors ' + (active ? 'bg-white text-slate-900 border-2 border-b-0 border-indigo-600 shadow-md' : 'bg-slate-800 text-white hover:bg-slate-700 border-2 border-transparent')}
              >
                {t.label_en} <span className="mx-1">/</span> <span style={{ direction: 'rtl' }}>{t.label_ar}</span>
                {t.count != null && <span className="ml-1 text-xs">({t.count})</span>}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {loading && (
            <div className="text-center py-10 text-slate-600 font-bold">Loading history... / جاري التحميل</div>
          )}
          {error && !loading && (
            <div className="bg-red-100 border-2 border-red-400 text-red-900 rounded p-3 font-semibold">
              <strong>Error / خطأ:</strong> {error}
            </div>
          )}
          {!loading && !error && tab === 'summary' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card label_en="Total Received" label_ar="إجمالي الوارد" value={fmtNum(stockSummary.totalReceived, 3)} accent="indigo" />
              <Card label_en="Total Sold" label_ar="إجمالي المباع" value={fmtNum(stockSummary.totalSold, 3)} accent="emerald" />
              <Card label_en="Total Adjusted" label_ar="إجمالي التسويات" value={fmtNum(stockSummary.totalAdjusted, 3)} accent="amber" />
              <Card label_en="Current On Hand" label_ar="المتاح حالياً" value={fmtNum(stockSummary.currentOnHand, 3)} accent="blue" big />
              <Card label_en="Weighted Avg Cost" label_ar="متوسط التكلفة" value={fmtMoney(stockSummary.avgCost)} accent="slate" />
              <Card label_en="Total Revenue" label_ar="إجمالي الإيرادات" value={fmtMoney(stockSummary.totalRevenue)} accent="emerald" />
              <Card label_en="Total COGS" label_ar="إجمالي التكلفة" value={fmtMoney(stockSummary.totalCogs)} accent="amber" />
              <Card label_en="Gross Profit" label_ar="الربح الإجمالي" value={fmtMoney(stockSummary.grossProfit)} accent={stockSummary.grossProfit >= 0 ? 'emerald' : 'red'} big />
              <Card label_en="Gross Margin %" label_ar="هامش الربح" value={fmtNum(stockSummary.margin, 1) + '%'} accent={stockSummary.margin >= 0 ? 'emerald' : 'red'} />
              <Card label_en="Last Sale Price" label_ar="آخر سعر بيع" value={fmtMoney(stockSummary.lastSalePrice)} accent="slate" />
              <Card label_en="Last Sale Date" label_ar="آخر تاريخ بيع" value={fmtDate(stockSummary.lastSaleDate)} accent="slate" />
              <Card label_en="Open Layers" label_ar="الطبقات المفتوحة" value={layers.length} accent="slate" />
            </div>
          )}
          {!loading && !error && tab === 'inbound' && (
            <Table
              empty_en="No inbound receipts yet."
              empty_ar="لا يوجد وارد بعد"
              rows={receipts}
              cols={[
                { en: 'Date', ar: 'التاريخ', get: function (r) { return fmtDate(r.receipt_date); } },
                { en: 'Receipt #', ar: 'رقم الإيصال', get: function (r) { return r.receipt_number || '—'; }, mono: true },
                { en: 'Supplier', ar: 'المورد', get: function (r) { return r.supplier || '—'; } },
                { en: 'Quantity', ar: 'الكمية', get: function (r) { return fmtNum(r.quantity, 3); }, right: true },
                { en: 'Cost / unit', ar: 'التكلفة', get: function (r) { return fmtMoney(r.cost_per_uom); }, right: true },
                { en: 'Total Cost', ar: 'التكلفة الإجمالية', get: function (r) { return fmtMoney(Number(r.quantity || 0) * Number(r.cost_per_uom || 0)); }, right: true, bold: true },
                { en: 'Status', ar: 'الحالة', get: function (r) { return r.status || '—'; }, badge: true },
              ]}
            />
          )}
          {!loading && !error && tab === 'outbound' && (
            <Table
              empty_en="No sales yet for this variant."
              empty_ar="لا توجد مبيعات بعد"
              rows={outbound}
              cols={[
                { en: 'Date', ar: 'التاريخ', get: function (r) { return fmtDate(r._invoice_date || r.inventory_consumed_at); } },
                { en: 'Invoice #', ar: 'رقم الفاتورة', get: function (r) { return r._invoice_order_number || '—'; }, mono: true },
                { en: 'Customer', ar: 'العميل', get: function (r) { return r._invoice_customer_name || '—'; } },
                { en: 'Qty Sold', ar: 'الكمية المباعة', get: function (r) { return fmtNum(r.sale_quantity, 3); }, right: true },
                { en: 'Rolls Sold', ar: 'اللفات المباعة', get: function (r) { return (r.rolls_sold != null && r.rolls_sold !== '') ? fmtNum(r.rolls_sold, 0) : '—'; }, right: true },
                { en: 'Sale $/unit', ar: 'سعر البيع', get: function (r) { return fmtMoney(r.sale_price_per_uom); }, right: true },
                { en: 'COGS', ar: 'التكلفة', get: function (r) { return fmtMoney(r.cogs_total); }, right: true },
                { en: 'Gross Profit', ar: 'الربح', get: function (r) { return fmtMoney(r.gross_profit); }, right: true, bold: true,
                  cls: function (r) { return Number(r.gross_profit || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'; } },
                { en: 'Backorder', ar: 'طلب معلق', get: function (r) { return Number(r.backorder_qty || 0) > 0 ? fmtNum(r.backorder_qty, 3) : '—'; }, right: true,
                  cls: function (r) { return Number(r.backorder_qty || 0) > 0 ? 'text-amber-700 font-bold' : ''; } },
                { en: 'Status', ar: 'الحالة', get: function (r) { return r.inventory_status || '—'; }, badge: true },
              ]}
            />
          )}
          {!loading && !error && tab === 'adjustments' && (
            <Table
              empty_en="No adjustments recorded for this variant."
              empty_ar="لا توجد تسويات"
              rows={adjustments}
              cols={[
                { en: 'Date', ar: 'التاريخ', get: function (r) { return fmtDate(r.adjustment_date || r.created_at); } },
                { en: 'Type', ar: 'النوع', get: function (r) { return r.adjustment_type || '—'; }, badge: true },
                { en: 'Qty Change', ar: 'تغيير الكمية', get: function (r) { return fmtNum(r.qty_change, 3); }, right: true, bold: true,
                  cls: function (r) { return Number(r.qty_change || 0) > 0 ? 'text-emerald-700' : Number(r.qty_change || 0) < 0 ? 'text-red-700' : ''; } },
                { en: 'Reason', ar: 'السبب', get: function (r) { return r.reason || r.notes || '—'; } },
                { en: 'Status', ar: 'الحالة', get: function (r) { return r.status || '—'; }, badge: true },
                { en: 'Approved', ar: 'موافق', get: function (r) { return fmtDate(r.approved_at); } },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Stock-summary card — solid bg + white text for high contrast
function Card({ label_en, label_ar, value, accent, big }) {
  var bg = {
    indigo:  'bg-indigo-700',
    emerald: 'bg-emerald-700',
    amber:   'bg-amber-700',
    blue:    'bg-blue-700',
    slate:   'bg-slate-700',
    red:     'bg-red-700',
  }[accent || 'slate'] || 'bg-slate-700';
  return (
    <div className={bg + ' rounded-lg p-3 text-white'}>
      <div className="text-[11px] font-bold uppercase tracking-wider opacity-90">{label_en}</div>
      <div className="text-[11px] font-bold opacity-90" style={{ direction: 'rtl' }}>{label_ar}</div>
      <div className={(big ? 'text-3xl' : 'text-xl') + ' font-extrabold mt-1'}>{value}</div>
    </div>
  );
}

// Generic table for the three list tabs
function Table({ rows, cols, empty_en, empty_ar }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-center py-10 text-slate-600">
        <div className="text-sm font-bold">{empty_en}</div>
        <div className="text-sm font-bold" style={{ direction: 'rtl' }}>{empty_ar}</div>
      </div>
    );
  }
  return (
    <div className="overflow-auto border-2 border-slate-200 rounded">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 sticky top-0">
          <tr>
            {cols.map(function (c, i) {
              return (
                <th key={i} className={'px-3 py-2 text-' + (c.right ? 'right' : 'left') + ' text-xs font-extrabold text-slate-900 border-b-2 border-slate-300'}>
                  {c.en}
                  <div className="text-[10px] opacity-75 font-bold" style={{ direction: 'rtl' }}>{c.ar}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(function (row, idx) {
            return (
              <tr key={row.id || idx} className="border-b border-slate-200 hover:bg-slate-50">
                {cols.map(function (c, i) {
                  var val = c.get(row);
                  var cls = 'px-3 py-1.5 text-' + (c.right ? 'right' : 'left');
                  if (c.mono) cls += ' font-mono';
                  if (c.bold) cls += ' font-extrabold';
                  cls += ' text-slate-900';
                  if (c.cls) cls += ' ' + c.cls(row);
                  if (c.badge) {
                    return (
                      <td key={i} className={cls}>
                        <span className="inline-block px-2 py-0.5 text-xs font-extrabold text-white bg-slate-700 rounded">{val}</span>
                      </td>
                    );
                  }
                  return <td key={i} className={cls}>{val}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
