'use client';
// v55.83-A.6.27.63 — FX P&L Report.
//
// Separates total profit into:
//   • REAL MARGIN — would have earned if USD/EGP stayed constant
//   • REALIZED FX P&L — extra (or lost) profit from currency movement
//                        between RECEIPT date and SALE date
//   • UNREALIZED FX — for stock STILL on hand, what would happen if you
//                     sold today vs the receipt-day cost
//
// HOW THE MATH WORKS (per movement of a sold unit):
//   real_margin     = revenue_egp - cost_egp_at_receipt
//   realized_fx_pnl = cost_egp_at_sale - cost_egp_at_receipt
//   total_gross_profit = revenue_egp - cost_egp_at_sale
//                      = real_margin + realized_fx_pnl
//
// Per unit STILL on hand:
//   unrealized_fx = (today_rate × usd_cost) - cost_egp_at_receipt
//   (Only meaningful for stock bought in USD; EGP-purchased stock has no FX exposure.)
//
// GRACEFUL FALLBACK:
//   If a layer was created before v55.83-A.6.27.63 (no cost_egp_at_receipt
//   recorded), the report shows it under "Backfill Estimate" using today's
//   rate as a placeholder, with a clear badge.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { canSeeInventoryPnL } from '../lib/inventory-permissions';

function fmtNum(n, dp) {
  if (n == null || isNaN(Number(n))) return '0.' + '0'.repeat(dp == null ? 2 : dp);
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
}
function todayISO() { return new Date().toISOString().substring(0, 10); }
function firstOfYearISO() { return new Date().getFullYear() + '-01-01'; }
function firstOfMonthISO() { var d = new Date(); d.setDate(1); return d.toISOString().substring(0, 10); }

export default function FxPnLReport(props) {
  var userProfile = props.userProfile || null;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = !!props.isSuperAdmin;
  var toast = props.toast || { success: function(){}, error: function(){}, info: function(){} };

  var canSeePnL = isSuperAdmin || canSeeInventoryPnL(modulePerms);

  var [layers, setLayers] = useState([]);
  var [movements, setMovements] = useState([]);
  var [fxRates, setFxRates] = useState([]);
  var [products, setProducts] = useState([]);
  var [saleItems, setSaleItems] = useState([]);        // v55.83-U: consumed invoice lines
  var [invoicesById, setInvoicesById] = useState({});  // v55.83-U: id -> {invoice_date}
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  var [dateFrom, setDateFrom] = useState(firstOfMonthISO());
  var [dateTo, setDateTo] = useState(todayISO());

  useEffect(function () {
    if (!canSeePnL) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var [layRes, movRes, fxRes, prodRes, itemRes, invRes] = await Promise.all([
          supabase.from('inventory_layers').select('*'),
          supabase.from('inventory_movements').select('*'),
          supabase.from('fx_rates').select('*').order('rate_date', { ascending: false }),
          supabase.from('inventory_products').select('id, quick_code, name_en').eq('active', true),
          // v55.83-U — sales come from consumed invoice lines (where the EGP P&L is stamped),
          // NOT inventory_movements (which only logs receipts). This is the real sale data.
          supabase.from('invoice_items').select('id, invoice_id, variant_id, product_id, sale_quantity, line_total, cogs_total, cogs_egp_at_receipt, cost_egp_at_sale, gross_profit_egp, realized_fx_egp, consumed_layers, inventory_status, uses_inventory').eq('uses_inventory', true),
          supabase.from('invoices').select('id, invoice_date'),
        ]);
        if (cancelled) return;
        if (layRes && !layRes.error) setLayers(layRes.data || []);
        else if (layRes && layRes.error) console.warn('[fx-pnl] layers:', layRes.error.message);
        if (movRes && !movRes.error) setMovements(movRes.data || []);
        else if (movRes && movRes.error) console.warn('[fx-pnl] movements:', movRes.error.message);
        if (fxRes && !fxRes.error) setFxRates(fxRes.data || []);
        else if (fxRes && fxRes.error) {
          if (/relation.*fx_rates.*does not exist/i.test(fxRes.error.message)) {
            setError('FX Rates not set up yet. Run SQL migration v55.83-A.6.27.63 in Supabase.');
          }
        }
        if (prodRes && !prodRes.error) setProducts(prodRes.data || []);
        if (itemRes && !itemRes.error) setSaleItems((itemRes.data || []).filter(function (it) { return it.inventory_status === 'consumed'; }));
        else if (itemRes && itemRes.error) console.warn('[fx-pnl] invoice_items:', itemRes.error.message);
        if (invRes && !invRes.error) {
          var im = {}; (invRes.data || []).forEach(function (iv) { im[iv.id] = iv; }); setInvoicesById(im);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[fx-pnl] load failed:', e);
          setError((e && e.message) || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canSeePnL]);

  // Helper: get effective rate for a date + pair (most recent rate <= date)
  function rateForDate(fromCur, toCur, dateStr) {
    if (!fromCur || !toCur || fromCur === toCur) return 1;
    if (!dateStr) return null;
    var candidates = fxRates.filter(function (r) {
      return r.from_currency === fromCur && r.to_currency === toCur && r.rate_date <= dateStr;
    });
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) { return b.rate_date.localeCompare(a.rate_date); });
    return Number(candidates[0].rate);
  }

  // Build a lookup product_id → product
  var productsById = useMemo(function () {
    var m = {};
    products.forEach(function (p) { m[p.id] = p; });
    return m;
  }, [products]);

  // Build layer_id → layer lookup
  var layersById = useMemo(function () {
    var m = {};
    layers.forEach(function (l) { m[l.id] = l; });
    return m;
  }, [layers]);

  // Latest available USD→EGP rate (for today's unrealized math)
  var latestUsdEgp = useMemo(function () {
    var candidates = fxRates.filter(function (r) { return r.from_currency === 'USD' && r.to_currency === 'EGP'; });
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) { return b.rate_date.localeCompare(a.rate_date); });
    return Number(candidates[0].rate);
  }, [fxRates]);

  // v55.83-A.6.27.66 (H2, Max May 23 2026): helper to look up the FX rate
  // for a given date + source currency → EGP. Used when a movement's
  // cost_egp_at_receipt / cost_egp_at_sale snapshot isn't set yet (pre-.64
  // data). Without this we used to assume `cogs` was already EGP and use
  // it verbatim — which silently produced wrong numbers by ~50× when the
  // underlying receipt was in USD.
  function fxToEgp(date, sourceCurrency) {
    var src = String(sourceCurrency || 'EGP').toUpperCase();
    if (src === 'EGP') return 1;  // no conversion needed
    if (!date) return null;
    // Find the most recent rate at or before `date` for src→EGP
    var candidates = fxRates.filter(function (r) {
      return r.from_currency === src && r.to_currency === 'EGP' && r.rate_date <= date;
    });
    if (candidates.length === 0) {
      // Fall back to latest rate of any date
      var anyDate = fxRates.filter(function (r) { return r.from_currency === src && r.to_currency === 'EGP'; });
      if (anyDate.length === 0) return null;
      anyDate.sort(function (a, b) { return b.rate_date.localeCompare(a.rate_date); });
      return Number(anyDate[0].rate);
    }
    candidates.sort(function (a, b) { return b.rate_date.localeCompare(a.rate_date); });
    return Number(candidates[0].rate);
  }

  // ── REALIZED P&L (per sold movement) ────────────────────────
  // v55.83-U — REALIZED FX is driven by CONSUMED INVOICE LINES (where the EGP P&L
  // is stamped by consume_invoice_item_inventory), not by inventory_movements
  // (which only logs receipts). Signs follow the validated model
  // (__tests__/mock-fx-pnl-model.js): realized_fx = cost@receipt - cost@sale
  // (NEGATIVE when the pound devalued), and real_margin + realized_fx == total_gp.
  var realized = useMemo(function () {
    var rows = [];
    var totals = { real_margin: 0, realized_fx: 0, total_gp: 0, sold_qty: 0, revenue: 0, backfill_count: 0, unconvertable_count: 0 };

    saleItems.forEach(function (it) {
      var inv = invoicesById[it.invoice_id];
      var d = inv && inv.invoice_date ? String(inv.invoice_date).substring(0, 10) : '';
      if (dateFrom && d && d < dateFrom) return;
      if (dateTo && d && d > dateTo) return;

      var pid = it.variant_id || it.product_id;
      var product = productsById[pid];
      var label = product ? ((product.quick_code || '') + ' · ' + (product.name_en || '')) : (pid || '(unknown)');

      var qty = Number(it.sale_quantity || 0);
      var revenue = Number(it.line_total || 0);
      var nativeCogs = Number(it.cogs_total || 0);

      // Entry-rate EGP cost (real cost locked at purchase). Prefer the stamped
      // value; fall back to summing the consumed layers' per-uom snapshot.
      var costAtReceipt = Number(it.cogs_egp_at_receipt || 0);
      var costAtSale = Number(it.cost_egp_at_sale || 0);
      var backfill = false;
      var unconvertable = false;

      if (!costAtReceipt && Array.isArray(it.consumed_layers)) {
        it.consumed_layers.forEach(function (cl) {
          var per = Number(cl.cost_egp_at_receipt_per_uom || 0);
          if (per > 0) costAtReceipt += per * Number(cl.qty_consumed || 0);
        });
        backfill = costAtReceipt > 0;
      }
      // Last-resort: convert native COGS at the sale-date rate for BOTH sides so
      // FX delta is 0 rather than inventing a snapshot. Flag as unconvertable if
      // no rate exists for a non-EGP line.
      if (!costAtReceipt && nativeCogs > 0) {
        var srcCur = 'EGP';
        if (Array.isArray(it.consumed_layers) && it.consumed_layers[0]) srcCur = String(it.consumed_layers[0].cost_currency || 'EGP').toUpperCase();
        if (srcCur === 'EGP') { costAtReceipt = nativeCogs; }
        else {
          var r = fxToEgp(d, srcCur);
          if (r && r > 0) { costAtReceipt = nativeCogs * r; backfill = true; }
          else { costAtReceipt = 0; unconvertable = true; }
        }
      }
      if (!costAtSale) { costAtSale = costAtReceipt; } // no sale snapshot -> no FX delta

      var realMargin = revenue - costAtReceipt;
      var realizedFx = costAtReceipt - costAtSale;   // NEG = FX loss (devaluation)
      var totalGp = revenue - costAtSale;            // == realMargin + realizedFx

      rows.push({
        key: it.id, date: d, label: label, qty: qty, revenue: revenue,
        cost_at_receipt: costAtReceipt, cost_at_sale: costAtSale,
        real_margin: realMargin, realized_fx: realizedFx, total_gp: totalGp,
        backfill: backfill, unconvertable: unconvertable,
      });

      totals.real_margin += realMargin;
      totals.realized_fx += realizedFx;
      totals.total_gp += totalGp;
      totals.sold_qty += qty;
      totals.revenue += revenue;
      if (backfill) totals.backfill_count++;
      if (unconvertable) totals.unconvertable_count++;
    });

    rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return { rows: rows, totals: totals };
  }, [saleItems, invoicesById, productsById, dateFrom, dateTo]);

  // ── UNREALIZED FX (per layer still on hand) ─────────────────
  var unrealized = useMemo(function () {
    var rows = [];
    var totals = { qty_on_hand: 0, cost_at_receipt: 0, today_value: 0, unrealized_fx: 0, backfill_count: 0 };

    layers.forEach(function (l) {
      var remaining = Number(l.qty_remaining || 0);
      if (remaining <= 0) return;

      var product = productsById[l.product_id];
      var label = product ? ((product.quick_code || '') + ' · ' + (product.name_en || '')) : (l.product_id || '(unknown)');

      var unitCost = Number(l.unit_cost || 0);
      var costCur = l.cost_currency || 'EGP';

      // Per-layer cost at receipt (in EGP)
      var costAtReceipt = Number(l.cost_egp_at_receipt || 0) * remaining; // stored is per-unit? Assume stored is per-layer total in EGP.
      // If empty, recalc from unit_cost × remaining_qty using historical rate if USD, else EGP
      var backfill = false;
      if (!costAtReceipt) {
        if (costCur === 'EGP') {
          costAtReceipt = unitCost * remaining;
        } else {
          // Need to convert USD cost → EGP at receipt date
          var rcvDate = (l.received_at || l.receipt_date) ? String(l.received_at || l.receipt_date).substring(0, 10) : '';
          var rcvRate = rateForDate(costCur, 'EGP', rcvDate);
          if (rcvRate) {
            costAtReceipt = unitCost * rcvRate * remaining;
          } else {
            // No historical rate — fallback to latest
            if (latestUsdEgp) {
              costAtReceipt = unitCost * latestUsdEgp * remaining;
              backfill = true;
            }
          }
        }
      }

      // Today's value in EGP
      var todayValue;
      if (costCur === 'EGP') {
        todayValue = costAtReceipt; // No FX exposure
      } else {
        if (latestUsdEgp) {
          todayValue = unitCost * latestUsdEgp * remaining;
        } else {
          todayValue = costAtReceipt;
        }
      }

      var unrealizedFx = costAtReceipt - todayValue;  // v55.83-U: NEG = would cost more EGP today (FX loss)

      // Only include rows with non-zero on-hand stock
      rows.push({
        key: l.id,
        label: label,
        qty: remaining,
        cur: costCur,
        cost_at_receipt: costAtReceipt,
        today_value: todayValue,
        unrealized_fx: unrealizedFx,
        backfill: backfill,
      });

      totals.qty_on_hand += remaining;
      totals.cost_at_receipt += costAtReceipt;
      totals.today_value += todayValue;
      totals.unrealized_fx += unrealizedFx;
      if (backfill) totals.backfill_count++;
    });

    rows.sort(function (a, b) { return Math.abs(b.unrealized_fx) - Math.abs(a.unrealized_fx); });

    return { rows: rows, totals: totals };
  }, [layers, productsById, fxRates, latestUsdEgp]);

  async function exportExcel() {
    try {
      var XLSX = await import('xlsx');
      var wb = XLSX.utils.book_new();

      // Sheet 1: Realized
      var realAOA = [['Date', 'Product', 'Qty', 'Revenue (EGP)', 'Cost @ Receipt (EGP)', 'Cost @ Sale (EGP)', 'Real Margin', 'Realized FX', 'Total Gross Profit', 'Backfill']];
      realized.rows.forEach(function (r) {
        realAOA.push([r.date, r.label, r.qty, r.revenue, r.cost_at_receipt, r.cost_at_sale, r.real_margin, r.realized_fx, r.total_gp, r.backfill ? 'YES' : '']);
      });
      realAOA.push(['TOTAL', '', realized.totals.sold_qty, realized.totals.revenue, '', '', realized.totals.real_margin, realized.totals.realized_fx, realized.totals.total_gp, '']);
      var realSheet = XLSX.utils.aoa_to_sheet(realAOA);
      realSheet['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, realSheet, 'Realized P&L');

      // Sheet 2: Unrealized
      var unAOA = [['Product', 'Qty On Hand', 'Currency', 'Cost @ Receipt (EGP)', 'Today Value (EGP)', 'Unrealized FX', 'Backfill']];
      unrealized.rows.forEach(function (r) {
        unAOA.push([r.label, r.qty, r.cur, r.cost_at_receipt, r.today_value, r.unrealized_fx, r.backfill ? 'YES' : '']);
      });
      unAOA.push(['TOTAL', unrealized.totals.qty_on_hand, '', unrealized.totals.cost_at_receipt, unrealized.totals.today_value, unrealized.totals.unrealized_fx, '']);
      var unSheet = XLSX.utils.aoa_to_sheet(unAOA);
      unSheet['!cols'] = [{ wch: 35 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, unSheet, 'Unrealized FX');

      // Sheet 3: Filters
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['KTC NextTrade Hub — FX P&L Report'],
        [''],
        ['Generated', new Date().toISOString()],
        ['Date from', dateFrom],
        ['Date to', dateTo],
        ['Latest USD/EGP', latestUsdEgp != null ? latestUsdEgp : '(none logged)'],
        ['Realized rows', realized.rows.length],
        ['Unrealized rows', unrealized.rows.length],
      ]), 'Filters');

      var stamp = todayISO();
      XLSX.writeFile(wb, 'KTC-FX-PnL-Report-' + stamp + '.xlsx');
      toast.success('FX P&L report exported');
    } catch (e) {
      console.error('[fx-pnl] export failed:', e);
      toast.error('Export failed: ' + ((e && e.message) || String(e)));
    }
  }

  // ── Render ───────────────────────────────────────────────────
  if (!canSeePnL) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border-2 border-amber-300 rounded p-4 text-amber-900 font-semibold">
          🔒 You don&apos;t have permission to view inventory P&amp;L reports.
        </div>
      </div>
    );
  }
  if (loading) {
    return <div className="p-6 text-center text-slate-600 font-semibold">Loading FX P&L...</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 text-red-900 font-semibold">
          ⚠️ {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-700 via-purple-700 to-fuchsia-700 text-white rounded-lg p-4">
        <h2 className="text-xl font-extrabold">💱 FX P&L Report / تقرير ربح وخسارة الصرف</h2>
        <div className="text-xs font-semibold text-purple-100 mt-1">
          Separates real margin from currency-movement gain/loss.
          {latestUsdEgp != null && (
            <span> Latest USD→EGP: <span className="font-mono font-extrabold text-white">{latestUsdEgp.toFixed(4)}</span></span>
          )}
        </div>
      </div>

      {(realized.totals.backfill_count > 0 || unrealized.totals.backfill_count > 0) && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded p-3 text-amber-900 text-xs font-semibold">
          ⚠️ <span className="font-extrabold">Backfill estimate in use.</span> Some receipts and/or movements
          don&apos;t have FX rate snapshots from when they happened (they pre-date this feature).
          Those rows are shown using today&apos;s rate as a fallback. Going forward, every new receipt + sale
          will snapshot the rate automatically.
          Backfill rows: {realized.totals.backfill_count} realized · {unrealized.totals.backfill_count} unrealized
        </div>
      )}

      {/* Date filters */}
      <div className="bg-white border-2 border-slate-200 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="block">
            <span className="text-xs font-extrabold text-slate-900">Date From</span>
            <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
          </label>
          <label className="block">
            <span className="text-xs font-extrabold text-slate-900">Date To</span>
            <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-extrabold text-slate-900">Quick</span>
            <div className="flex gap-1 flex-wrap">
              <button onClick={function () { setDateFrom(firstOfMonthISO()); setDateTo(todayISO()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">MTD</button>
              <button onClick={function () { setDateFrom(firstOfYearISO()); setDateTo(todayISO()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">YTD</button>
              <button onClick={function () { setDateFrom('2014-01-01'); setDateTo(todayISO()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">All</button>
            </div>
          </div>
          <div className="flex flex-col gap-1 justify-end">
            <button onClick={exportExcel} className="px-3 py-1.5 bg-violet-700 hover:bg-violet-800 text-white text-xs font-extrabold rounded shadow">📊 Export Excel</button>
          </div>
        </div>
      </div>

      {/* ============ REALIZED P&L ============ */}
      <div className="bg-white border-2 border-slate-200 rounded-lg p-4">
        <h3 className="text-lg font-extrabold text-slate-900 mb-2">✅ Realized P&L (sales in date range)</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <div className="bg-blue-100 border border-blue-300 rounded p-2">
            <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">Sold Qty</div>
            <div className="text-base font-mono font-extrabold text-blue-900">{fmtNum(realized.totals.sold_qty, 2)}</div>
          </div>
          <div className="bg-emerald-100 border border-emerald-300 rounded p-2">
            <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider">Revenue (EGP)</div>
            <div className="text-base font-mono font-extrabold text-emerald-900">{fmtNum(realized.totals.revenue, 2)}</div>
          </div>
          <div className={'border rounded p-2 ' + (realized.totals.real_margin >= 0 ? 'bg-teal-100 border-teal-300' : 'bg-red-100 border-red-300')}>
            <div className={'text-[10px] font-extrabold uppercase tracking-wider ' + (realized.totals.real_margin >= 0 ? 'text-teal-900' : 'text-red-900')}>Real Margin</div>
            <div className={'text-base font-mono font-extrabold ' + (realized.totals.real_margin >= 0 ? 'text-teal-900' : 'text-red-900')}>{fmtNum(realized.totals.real_margin, 2)}</div>
          </div>
          <div className={'border rounded p-2 ' + (realized.totals.realized_fx >= 0 ? 'bg-violet-100 border-violet-300' : 'bg-orange-100 border-orange-300')}>
            <div className={'text-[10px] font-extrabold uppercase tracking-wider ' + (realized.totals.realized_fx >= 0 ? 'text-violet-900' : 'text-orange-900')}>Realized FX</div>
            <div className={'text-base font-mono font-extrabold ' + (realized.totals.realized_fx >= 0 ? 'text-violet-900' : 'text-orange-900')}>{fmtNum(realized.totals.realized_fx, 2)}</div>
          </div>
          <div className={'border rounded p-2 ' + (realized.totals.total_gp >= 0 ? 'bg-slate-100 border-slate-300' : 'bg-red-100 border-red-300')}>
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-900">Total Gross Profit</div>
            <div className={'text-base font-mono font-extrabold ' + (realized.totals.total_gp >= 0 ? 'text-slate-900' : 'text-red-900')}>{fmtNum(realized.totals.total_gp, 2)}</div>
          </div>
        </div>
        {realized.rows.length === 0 ? (
          <div className="text-sm text-slate-600 italic text-center py-4">No sales in selected date range.</div>
        ) : (
          <div className="overflow-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Date</th>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Product</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Qty</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Revenue</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Cost @ Receipt</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Cost @ Sale</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-teal-900">Real Margin</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-violet-900">Realized FX</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Total GP</th>
                </tr>
              </thead>
              <tbody>
                {realized.rows.slice(0, 200).map(function (r) {
                  return (
                    <tr key={r.key} className="border-b border-slate-200">
                      <td className="px-2 py-1 font-mono text-slate-700">{r.date}{r.backfill && <span className="ml-1 text-[9px] bg-amber-200 text-amber-900 rounded px-1 font-bold">EST</span>}</td>
                      <td className="px-2 py-1 text-slate-800">{r.label}</td>
                      <td className="px-2 py-1 text-right font-mono text-blue-900">{fmtNum(r.qty, 2)}</td>
                      <td className="px-2 py-1 text-right font-mono text-emerald-800">{fmtNum(r.revenue, 2)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-700">{fmtNum(r.cost_at_receipt, 2)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-700">{fmtNum(r.cost_at_sale, 2)}</td>
                      <td className={'px-2 py-1 text-right font-mono font-extrabold ' + (r.real_margin >= 0 ? 'text-teal-800' : 'text-red-700')}>{fmtNum(r.real_margin, 2)}</td>
                      <td className={'px-2 py-1 text-right font-mono font-extrabold ' + (r.realized_fx >= 0 ? 'text-violet-800' : 'text-orange-700')}>{fmtNum(r.realized_fx, 2)}</td>
                      <td className={'px-2 py-1 text-right font-mono font-extrabold ' + (r.total_gp >= 0 ? 'text-slate-900' : 'text-red-700')}>{fmtNum(r.total_gp, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {realized.rows.length > 200 && (
              <div className="text-[10px] text-slate-600 italic p-2 bg-slate-50 border-t border-slate-200">
                Showing first 200 of {realized.rows.length} rows. Export to Excel for full data.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============ UNREALIZED FX ============ */}
      <div className="bg-white border-2 border-slate-200 rounded-lg p-4">
        <h3 className="text-lg font-extrabold text-slate-900 mb-2">⏳ Unrealized FX (stock still on hand)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div className="bg-blue-100 border border-blue-300 rounded p-2">
            <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">Qty On Hand</div>
            <div className="text-base font-mono font-extrabold text-blue-900">{fmtNum(unrealized.totals.qty_on_hand, 2)}</div>
          </div>
          <div className="bg-amber-100 border border-amber-300 rounded p-2">
            <div className="text-[10px] font-extrabold text-amber-900 uppercase tracking-wider">Cost @ Receipt (EGP)</div>
            <div className="text-base font-mono font-extrabold text-amber-900">{fmtNum(unrealized.totals.cost_at_receipt, 2)}</div>
          </div>
          <div className="bg-slate-100 border border-slate-300 rounded p-2">
            <div className="text-[10px] font-extrabold text-slate-900 uppercase tracking-wider">Today Value (EGP)</div>
            <div className="text-base font-mono font-extrabold text-slate-900">{fmtNum(unrealized.totals.today_value, 2)}</div>
          </div>
          <div className={'border rounded p-2 ' + (unrealized.totals.unrealized_fx >= 0 ? 'bg-violet-100 border-violet-300' : 'bg-orange-100 border-orange-300')}>
            <div className={'text-[10px] font-extrabold uppercase tracking-wider ' + (unrealized.totals.unrealized_fx >= 0 ? 'text-violet-900' : 'text-orange-900')}>Unrealized FX</div>
            <div className={'text-base font-mono font-extrabold ' + (unrealized.totals.unrealized_fx >= 0 ? 'text-violet-900' : 'text-orange-900')}>{fmtNum(unrealized.totals.unrealized_fx, 2)}</div>
          </div>
        </div>
        {unrealized.rows.length === 0 ? (
          <div className="text-sm text-slate-600 italic text-center py-4">No stock on hand to evaluate.</div>
        ) : (
          <div className="overflow-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Product</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Qty</th>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Cur</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Cost @ Receipt</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Today Value</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-violet-900">Unrealized FX</th>
                </tr>
              </thead>
              <tbody>
                {unrealized.rows.slice(0, 200).map(function (r) {
                  return (
                    <tr key={r.key} className="border-b border-slate-200">
                      <td className="px-2 py-1 text-slate-800">{r.label}{r.backfill && <span className="ml-1 text-[9px] bg-amber-200 text-amber-900 rounded px-1 font-bold">EST</span>}</td>
                      <td className="px-2 py-1 text-right font-mono text-blue-900">{fmtNum(r.qty, 2)}</td>
                      <td className="px-2 py-1 text-slate-700">{r.cur}</td>
                      <td className="px-2 py-1 text-right font-mono text-amber-800">{fmtNum(r.cost_at_receipt, 2)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-700">{fmtNum(r.today_value, 2)}</td>
                      <td className={'px-2 py-1 text-right font-mono font-extrabold ' + (r.unrealized_fx >= 0 ? 'text-violet-800' : 'text-orange-700')}>{fmtNum(r.unrealized_fx, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {unrealized.rows.length > 200 && (
              <div className="text-[10px] text-slate-600 italic p-2 bg-slate-50 border-t border-slate-200">
                Showing first 200 of {unrealized.rows.length} rows. Export to Excel for full data.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
