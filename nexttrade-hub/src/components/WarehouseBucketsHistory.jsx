'use client';
// v55.83-A.6.27.71 — Warehouse Buckets History & Analytics (Phase 4).
//
// Read-only reporting view in the Warehouse tab. Reads from warehouse_buckets
// + warehouse_bucket_entries directly — does NOT query treasury (treasury
// totals are computed elsewhere; this is a separate lens).
//
// Views:
//   • Summary cards — total advances / total reconciled / pending / cancelled
//   • Per-recipient table — recipient_name → total advanced, total reconciled,
//     open count, avg days-to-close
//   • Per-subcategory table (closed buckets only) — subcategory → total
//     amount across all closed bucket entries
//   • Buckets list — all buckets ever, with filters (year, recipient, status)
//   • Excel export — full data
//
// Per Max's spec: "to keep a separate breakdown of the warehouse expenses
// I guess over the years..." — this is the multi-year warehouse-only lens
// that doesn't touch the company expense report categorization.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmtMoney(n, cur) {
  if (n == null || isNaN(Number(n))) return '0.00 ' + (cur || '');
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || '');
}
function fmtDate(d) {
  if (!d) return '—';
  return String(d).substring(0, 10);
}
function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  var a = new Date(d1);
  var b = new Date(d2);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export default function WarehouseBucketsHistory(props) {
  // Props: userId, isSuperAdmin, toast, reloadToken, lang
  var reloadToken = props.reloadToken || 0;
  var lang = props.lang === 'en' ? 'en' : 'ar';
  var ar = lang === 'ar';
  var dir = ar ? 'rtl' : 'ltr';

  var [buckets, setBuckets] = useState([]);
  var [allEntries, setAllEntries] = useState([]);  // entries across ALL buckets
  var [loading, setLoading] = useState(true);
  var [yearFilter, setYearFilter] = useState('all');
  var [recipientFilter, setRecipientFilter] = useState('all');
  var [currencyFilter, setCurrencyFilter] = useState('all');

  // Load everything on mount + when reloadToken bumps
  useEffect(function () {
    var cancelled = false;
    setLoading(true);
    (async function () {
      try {
        var bRes = await supabase.from('warehouse_buckets').select('*').order('issue_date', { ascending: false });
        if (cancelled) return;
        if (bRes.error) {
          console.warn('[buckets-history] bucket load failed:', bRes.error.message);
          setBuckets([]); setAllEntries([]); setLoading(false);
          return;
        }
        var bucketRows = bRes.data || [];
        setBuckets(bucketRows);
        if (bucketRows.length === 0) {
          setAllEntries([]); setLoading(false); return;
        }
        // Load entries for the closed/fully_spent buckets only (no point
        // showing data for open buckets in analytics yet — let detail page
        // handle live tracking). Cap at 5000 entries for safety.
        var ids = bucketRows.map(function (b) { return b.id; });
        var eRes = await supabase.from('warehouse_bucket_entries').select('*').in('bucket_id', ids).limit(5000);
        if (cancelled) return;
        if (eRes.error) {
          console.warn('[buckets-history] entries load failed:', eRes.error.message);
          setAllEntries([]); setLoading(false);
          return;
        }
        setAllEntries(eRes.data || []);
        setLoading(false);
      } catch (e) {
        console.warn('[buckets-history] threw:', e);
        if (!cancelled) { setBuckets([]); setAllEntries([]); setLoading(false); }
      }
    })();
    return function () { cancelled = true; };
  }, [reloadToken]);

  // Distinct years (from issue_date)
  var years = useMemo(function () {
    var seen = {};
    buckets.forEach(function (b) {
      var y = (b.issue_date || '').substring(0, 4);
      if (y.length === 4) seen[y] = true;
    });
    return Object.keys(seen).sort().reverse();
  }, [buckets]);

  // Distinct recipients
  var recipients = useMemo(function () {
    var seen = {};
    buckets.forEach(function (b) {
      var n = (b.recipient_name || '').trim();
      if (n) seen[n] = true;
    });
    return Object.keys(seen).sort();
  }, [buckets]);

  // Distinct currencies (just for filter dropdown)
  var currencies = useMemo(function () {
    var seen = {};
    buckets.forEach(function (b) { if (b.currency) seen[b.currency] = true; });
    return Object.keys(seen).sort();
  }, [buckets]);

  // Apply filters
  var filteredBuckets = useMemo(function () {
    return buckets.filter(function (b) {
      if (yearFilter !== 'all') {
        var y = (b.issue_date || '').substring(0, 4);
        if (y !== yearFilter) return false;
      }
      if (recipientFilter !== 'all' && (b.recipient_name || '') !== recipientFilter) return false;
      if (currencyFilter !== 'all' && (b.currency || '') !== currencyFilter) return false;
      return true;
    });
  }, [buckets, yearFilter, recipientFilter, currencyFilter]);

  // Entries filtered to buckets in the filtered set
  var filteredEntries = useMemo(function () {
    var bucketIds = {};
    filteredBuckets.forEach(function (b) { bucketIds[b.id] = true; });
    return allEntries.filter(function (e) { return bucketIds[e.bucket_id]; });
  }, [allEntries, filteredBuckets]);

  // ── SUMMARY (per currency for clarity, never mix) ──────────────
  // v55.83-A.6.27.72 HOTFIX 16 — Added actualUsed (sum of all entries) and totalRemaining
  // so the stats answer "how much of the advanced money has actually been spent so far?"
  // — was only tracking bucket-level status counts before.
  var summary = useMemo(function () {
    var byCurrency = {};
    filteredBuckets.forEach(function (b) {
      var cur = b.currency || 'EGP';
      if (!byCurrency[cur]) {
        byCurrency[cur] = {
          currency: cur,
          totalAdvanced: 0, totalReconciled: 0,
          actualUsed: 0, totalRemaining: 0,
          open: 0, fullySpent: 0, pendingApproval: 0, closed: 0, cancelled: 0,
          openAmount: 0, pendingAmount: 0, cancelledAmount: 0,
        };
      }
      var bucket = byCurrency[cur];
      var amt = Number(b.amount || 0);
      bucket.totalAdvanced += amt;
      if (b.status === 'open') { bucket.open++; bucket.openAmount += amt; }
      else if (b.status === 'fully_spent') { bucket.fullySpent++; bucket.openAmount += amt; }
      else if (b.status === 'pending_approval') { bucket.pendingApproval++; bucket.pendingAmount += amt; }
      else if (b.status === 'closed') { bucket.closed++; bucket.totalReconciled += amt; }
      else if (b.status === 'cancelled') { bucket.cancelled++; bucket.cancelledAmount += amt; }
    });
    // Now layer in entry totals per currency. Map bucket_id → currency for fast lookup.
    var bucketCur = {};
    filteredBuckets.forEach(function (b) { bucketCur[b.id] = b.currency || 'EGP'; });
    filteredEntries.forEach(function (e) {
      var cur = bucketCur[e.bucket_id];
      if (!cur || !byCurrency[cur]) return;
      byCurrency[cur].actualUsed += Number(e.amount || 0);
    });
    // Remaining = advanced − used, floored at zero (over-spends shouldn't show negative)
    Object.values(byCurrency).forEach(function (b) {
      b.totalRemaining = Math.max(0, b.totalAdvanced - b.actualUsed);
    });
    return Object.values(byCurrency).sort(function (a, b) { return a.currency.localeCompare(b.currency); });
  }, [filteredBuckets, filteredEntries]);

  // ── PER-RECIPIENT TABLE ────────────────────────────────────────
  var perRecipient = useMemo(function () {
    var bucket = {};
    filteredBuckets.forEach(function (b) {
      var name = (b.recipient_name || '(unknown)').trim();
      var cur = b.currency || 'EGP';
      var key = name + '||' + cur;
      if (!bucket[key]) {
        bucket[key] = {
          recipient: name, currency: cur,
          totalAdvanced: 0, totalReconciled: 0,
          // v55.83-A.6.27.72 HOTFIX 16 — Per-recipient "actually used" and "remaining"
          // sums (across ALL their buckets, regardless of status). Answers Max's
          // question: "what has been spent for Abdelnassar so far? for Mouhamed?"
          actualUsed: 0, remaining: 0,
          openCount: 0, closedCount: 0, cancelledCount: 0,
          closeDurations: [],
        };
      }
      var r = bucket[key];
      var amt = Number(b.amount || 0);
      r.totalAdvanced += amt;
      if (b.status === 'closed') {
        r.totalReconciled += amt;
        r.closedCount++;
        var d = daysBetween(b.issue_date, b.closed_at);
        if (d != null) r.closeDurations.push(d);
      } else if (b.status === 'cancelled') {
        r.cancelledCount++;
      } else {
        r.openCount++;
      }
    });
    // Now layer in entries — figure out which recipient+currency bucket each entry
    // belongs to via the bucket_id → recipient lookup map built above.
    var bucketMeta = {};
    filteredBuckets.forEach(function (b) {
      bucketMeta[b.id] = {
        recipient: (b.recipient_name || '(unknown)').trim(),
        currency: b.currency || 'EGP',
      };
    });
    filteredEntries.forEach(function (e) {
      var meta = bucketMeta[e.bucket_id];
      if (!meta) return;
      var key = meta.recipient + '||' + meta.currency;
      if (!bucket[key]) return;
      bucket[key].actualUsed += Number(e.amount || 0);
    });
    return Object.values(bucket).map(function (r) {
      r.avgDaysToClose = r.closeDurations.length > 0
        ? r.closeDurations.reduce(function (a, b) { return a + b; }, 0) / r.closeDurations.length
        : null;
      // Remaining = what was advanced minus what's actually been used (floored at 0).
      r.remaining = Math.max(0, r.totalAdvanced - r.actualUsed);
      return r;
    }).sort(function (a, b) {
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      return b.totalAdvanced - a.totalAdvanced;
    });
  }, [filteredBuckets]);

  // ── PER-SUBCATEGORY TABLE (closed buckets only — real categorization) ──
  var perSubcategory = useMemo(function () {
    var closedBucketIds = {};
    filteredBuckets.forEach(function (b) {
      if (b.status === 'closed') closedBucketIds[b.id] = b.currency || 'EGP';
    });
    var bucket = {};
    filteredEntries.forEach(function (e) {
      if (!closedBucketIds[e.bucket_id]) return;
      var cur = closedBucketIds[e.bucket_id];
      var cat = e.category || '(uncategorized)';
      var sub = e.subcategory || '(no subcategory)';
      var key = cur + '||' + cat + '||' + sub;
      if (!bucket[key]) {
        bucket[key] = { currency: cur, category: cat, subcategory: sub, total: 0, count: 0 };
      }
      bucket[key].total += Number(e.amount || 0);
      bucket[key].count++;
    });
    return Object.values(bucket).sort(function (a, b) {
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      return b.total - a.total;
    });
  }, [filteredEntries, filteredBuckets]);

  // ── EXCEL EXPORT ──────────────────────────────────────────────
  async function exportExcel() {
    try {
      var XLSX = await import('xlsx');
      var wb = XLSX.utils.book_new();

      // Sheet 1: Buckets
      var bucketRows = filteredBuckets.map(function (b) {
        var spent = filteredEntries
          .filter(function (e) { return e.bucket_id === b.id; })
          .reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
        return {
          'Issue Date': b.issue_date,
          'Recipient': b.recipient_name,
          'Reference': b.reference,
          'Slug': b.reference_slug,
          'Amount': Number(b.amount || 0),
          'Currency': b.currency,
          'Spent': spent,
          'Remaining': Number(b.amount || 0) - spent,
          'Status': b.status,
          'Closed Date': b.closed_at ? String(b.closed_at).substring(0, 10) : '',
          'Days to Close': b.closed_at ? daysBetween(b.issue_date, b.closed_at) : '',
          'Notes': b.notes || '',
          'Cancel Reason': b.cancel_reason || '',
        };
      });
      var ws1 = XLSX.utils.json_to_sheet(bucketRows);
      ws1['!cols'] = [
        { wch: 12 }, { wch: 28 }, { wch: 30 }, { wch: 40 }, { wch: 12 }, { wch: 8 },
        { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 40 },
      ];
      XLSX.utils.book_append_sheet(wb, ws1, 'Buckets');

      // Sheet 2: All entries (only entries from filtered buckets)
      var entryRows = filteredEntries.map(function (e) {
        var b = filteredBuckets.find(function (x) { return x.id === e.bucket_id; });
        return {
          'Entry Date': e.entry_date,
          'Bucket': b ? b.reference_slug : '(unknown)',
          'Recipient': b ? b.recipient_name : '(unknown)',
          'Category': e.category,
          'Subcategory': e.subcategory || '',
          'Amount': Number(e.amount || 0),
          'Currency': b ? b.currency : '',
          'Description': e.description || '',
          'Bucket Status': b ? b.status : '',
        };
      });
      var ws2 = XLSX.utils.json_to_sheet(entryRows);
      ws2['!cols'] = [
        { wch: 12 }, { wch: 40 }, { wch: 28 }, { wch: 20 }, { wch: 20 },
        { wch: 12 }, { wch: 8 }, { wch: 40 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'Entries');

      // Sheet 3: Per-recipient summary
      var recRows = perRecipient.map(function (r) {
        return {
          'Recipient': r.recipient,
          'Currency': r.currency,
          'Total Advanced': r.totalAdvanced,
          // v55.83-A.6.27.72 HOTFIX 16 — Actually-used + remaining columns
          'Actually Used': r.actualUsed,
          'Remaining': r.remaining,
          'Total Reconciled': r.totalReconciled,
          'Open Count': r.openCount,
          'Closed Count': r.closedCount,
          'Cancelled Count': r.cancelledCount,
          'Avg Days to Close': r.avgDaysToClose != null ? Math.round(r.avgDaysToClose * 10) / 10 : '',
        };
      });
      var ws3 = XLSX.utils.json_to_sheet(recRows);
      ws3['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'By Recipient');

      // Sheet 4: Per-subcategory summary (closed buckets only)
      var subRows = perSubcategory.map(function (s) {
        return {
          'Currency': s.currency,
          'Category': s.category,
          'Subcategory': s.subcategory,
          'Total': s.total,
          'Entry Count': s.count,
        };
      });
      var ws4 = XLSX.utils.json_to_sheet(subRows);
      ws4['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 24 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws4, 'By Subcategory (Closed)');

      // Filename
      var d = new Date();
      var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var label = yearFilter !== 'all' ? yearFilter : 'All-Years';
      XLSX.writeFile(wb, 'Warehouse-Buckets-' + label + '-' + stamp + '.xlsx');
    } catch (err) {
      console.error('[buckets-history] export failed:', err);
      alert('Excel export failed: ' + ((err && err.message) || err));
    }
  }

  if (loading) {
    return <div className="p-4 text-center text-slate-500 italic" dir={dir}>{ar ? 'جاري تحميل سجل الدلاء...' : 'Loading buckets history...'}</div>;
  }

  if (buckets.length === 0) {
    return null;  // empty state already shown by the main list — don't duplicate
  }

  return (
    <div className="space-y-3 mt-4" dir={dir}>
      {/* Header + filters */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-extrabold">📊 {ar ? 'سجل الدلاء والتحليلات' : 'Buckets History & Analytics'}</h3>
          <div className="text-[11px] text-slate-200">{ar ? 'عدسة المخزن متعددة السنوات — منفصلة عن تقارير المصروفات للشركة' : 'Multi-year warehouse-only lens — separate from company expense reports'}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={yearFilter} onChange={function (e) { setYearFilter(e.target.value); }}
            className="px-2 py-1 border border-slate-400 bg-white text-slate-900 rounded text-xs font-extrabold">
            <option value="all">{ar ? 'كل السنوات' : 'All Years'}</option>
            {years.map(function (y) { return <option key={y} value={y}>{y}</option>; })}
          </select>
          <select value={recipientFilter} onChange={function (e) { setRecipientFilter(e.target.value); }}
            className="px-2 py-1 border border-slate-400 bg-white text-slate-900 rounded text-xs max-w-[180px]">
            <option value="all">{ar ? 'كل المستلمين' : 'All Recipients'}</option>
            {recipients.map(function (r) { return <option key={r} value={r}>{r}</option>; })}
          </select>
          <select value={currencyFilter} onChange={function (e) { setCurrencyFilter(e.target.value); }}
            className="px-2 py-1 border border-slate-400 bg-white text-slate-900 rounded text-xs font-extrabold">
            <option value="all">{ar ? 'كل العملات' : 'All Currencies'}</option>
            {currencies.map(function (c) { return <option key={c} value={c}>{c}</option>; })}
          </select>
          <button onClick={exportExcel}
            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded shadow"
            title={ar ? 'تنزيل جميع البيانات كملف Excel (4 صفحات)' : 'Download all data as Excel (4 sheets)'}>
            📥 Excel
          </button>
        </div>
      </div>

      {/* Summary cards (per currency) */}
      {summary.map(function (s) {
        return (
          <div key={s.currency} className="grid grid-cols-2 md:grid-cols-7 gap-2">
            <div className="bg-slate-800 text-white rounded p-2">
              <div className="text-[9px] font-extrabold uppercase tracking-wider opacity-80">{ar ? 'العملة' : 'Currency'}</div>
              <div className="text-lg font-mono font-extrabold">{s.currency}</div>
            </div>
            <div className="bg-blue-100 border border-blue-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">{ar ? 'إجمالي المُقدَّم' : 'Total Advanced'}</div>
              <div className="text-base font-mono font-extrabold text-blue-900">{fmtMoney(s.totalAdvanced)}</div>
              <div className="text-[10px] text-blue-700">{s.open + s.fullySpent + s.pendingApproval + s.closed + s.cancelled} {ar ? 'دلو' : 'buckets'}</div>
            </div>
            {/* v55.83-A.6.27.72 HOTFIX 16 — NEW: Actually Used (sum of all entries
                across every bucket in this currency, regardless of status). Answers
                "how much of what I advanced has actually been spent so far?" */}
            <div className="bg-amber-100 border border-amber-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-amber-900 uppercase tracking-wider">{ar ? 'مستخدم فعلياً' : 'Actually Used'}</div>
              <div className="text-base font-mono font-extrabold text-amber-900">{fmtMoney(s.actualUsed)}</div>
              <div className="text-[10px] text-amber-700">
                {s.totalAdvanced > 0 ? ((s.actualUsed / s.totalAdvanced) * 100).toFixed(0) : '0'}% {ar ? 'من المُقدَّم' : 'of advanced'}
              </div>
            </div>
            {/* HOTFIX 16 — NEW: Remaining (advanced − used). The cash that's still
                sitting unspent across all buckets in this currency. */}
            <div className="bg-purple-100 border border-purple-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-purple-900 uppercase tracking-wider">{ar ? 'المتبقي' : 'Remaining'}</div>
              <div className="text-base font-mono font-extrabold text-purple-900">{fmtMoney(s.totalRemaining)}</div>
              <div className="text-[10px] text-purple-700">{ar ? 'لم يُنفق بعد' : 'unspent'}</div>
            </div>
            <div className="bg-emerald-100 border border-emerald-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider">{ar ? 'تمت التسوية' : 'Reconciled'}</div>
              <div className="text-base font-mono font-extrabold text-emerald-900">{fmtMoney(s.totalReconciled)}</div>
              <div className="text-[10px] text-emerald-700">{s.closed} {ar ? 'مُغلق' : 'closed'}</div>
            </div>
            <div className="bg-orange-100 border border-orange-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-orange-900 uppercase tracking-wider">{ar ? 'قيد الانتظار' : 'Pending'}</div>
              <div className="text-base font-mono font-extrabold text-orange-900">{fmtMoney(s.openAmount + s.pendingAmount)}</div>
              <div className="text-[10px] text-orange-700">{s.open + s.fullySpent + s.pendingApproval} {ar ? 'مفتوح' : 'open'}</div>
            </div>
            <div className="bg-slate-100 border border-slate-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">{ar ? 'مُلغى' : 'Cancelled'}</div>
              <div className="text-base font-mono font-extrabold text-slate-700">{fmtMoney(s.cancelledAmount)}</div>
              <div className="text-[10px] text-slate-600">{s.cancelled} {ar ? 'مُلغى' : 'cancelled'}</div>
            </div>
          </div>
        );
      })}

      {/* Per-recipient table */}
      {perRecipient.length > 0 && (
        <div className="bg-white rounded-lg border-2 border-slate-200 overflow-hidden">
          <div className="bg-slate-100 px-3 py-2 font-extrabold text-sm text-slate-900 border-b border-slate-200">
            {ar ? 'حسب المستلم' : 'By Recipient'} ({perRecipient.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'المستلم' : 'Recipient'}</th>
                  <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'عملة' : 'Cur'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'إجمالي المُقدَّم' : 'Total Advanced'}</th>
                  {/* v55.83-A.6.27.72 HOTFIX 16 — Per-recipient USED + REMAINING columns.
                      Answers Max's exact question: "what has been spent for Abdelnassar
                      so far? for Mouhamed?" — pulls entries.amount sums per recipient. */}
                  <th className="px-3 py-2 text-right font-extrabold text-amber-800 uppercase tracking-wider" title="Sum of all entries against this recipient's buckets — what they've actually spent so far">{ar ? 'مستخدم' : 'Used'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-purple-800 uppercase tracking-wider" title="Total advanced minus actually used — unspent balance">{ar ? 'متبقي' : 'Remaining'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'تمت التسوية' : 'Reconciled'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'مفتوح' : 'Open'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'مُغلق' : 'Closed'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'مُلغى' : 'Cancelled'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'متوسط الأيام' : 'Avg Days'}</th>
                </tr>
              </thead>
              <tbody>
                {perRecipient.map(function (r, i) {
                  return (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-semibold text-slate-900">{r.recipient}</td>
                      <td className="px-3 py-1.5 font-mono font-bold text-slate-700">{r.currency}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-900">{fmtMoney(r.totalAdvanced)}</td>
                      {/* HOTFIX 16 — actually used + remaining per recipient */}
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-amber-800">{fmtMoney(r.actualUsed)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-purple-800">{fmtMoney(r.remaining)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">{fmtMoney(r.totalReconciled)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-amber-700">{r.openCount}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{r.closedCount}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{r.cancelledCount}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-700">{r.avgDaysToClose != null ? r.avgDaysToClose.toFixed(1) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-subcategory table */}
      {perSubcategory.length > 0 && (
        <div className="bg-white rounded-lg border-2 border-slate-200 overflow-hidden">
          <div className="bg-slate-100 px-3 py-2 font-extrabold text-sm text-slate-900 border-b border-slate-200">
            {ar ? 'حسب الفئة الفرعية (الدلاء المغلقة فقط — ' : 'By Subcategory (closed buckets only — '}{perSubcategory.length} {ar ? 'سجل)' : 'rows)'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'عملة' : 'Cur'}</th>
                  <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'الفئة' : 'Category'}</th>
                  <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'الفئة الفرعية' : 'Subcategory'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'الإجمالي' : 'Total'}</th>
                  <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider"># {ar ? 'إدخالات' : 'Entries'}</th>
                </tr>
              </thead>
              <tbody>
                {perSubcategory.map(function (s, i) {
                  return (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono font-bold text-slate-700">{s.currency}</td>
                      <td className="px-3 py-1.5 font-semibold text-slate-900">{s.category}</td>
                      <td className="px-3 py-1.5 text-slate-700">{s.subcategory}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">{fmtMoney(s.total)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600">{s.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
