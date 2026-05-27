'use client';
// v55.83-A.6.27.69 — Warehouse Buckets list + detail view (Phase 2).
//
// Renders the bucket cards grid in the Warehouse tab + click-into detail view.
// READ-ONLY in this phase — spend-entry form arrives in Phase 3.
//
// View states:
//   • 'list' — grid of bucket cards, each card showing status + progress + summary
//   • 'detail' — single bucket's ledger view with entries table (read-only)

import { useState, useEffect, useMemo } from 'react';
import { listBuckets, getBucketWithEntries } from '../lib/warehouse-buckets';
import { supabase } from '../lib/supabase';
// v55.83-A.6.27.70 — Phase 3: entry form + lifecycle actions
import WarehouseBucketEntryForm from './WarehouseBucketEntryForm';
import WarehouseBucketActions from './WarehouseBucketActions';
// v55.83-A.6.27.71 HOTFIX 4 — Editable entry row (edit/delete in ledger)
import WarehouseBucketEntryRow from './WarehouseBucketEntryRow';

function fmtMoney(n, cur) {
  if (n == null || isNaN(Number(n))) return '0.00';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || '');
}
function fmtDate(d) {
  if (!d) return '—';
  return String(d).substring(0, 10);
}

// Status visual treatment — colors picked for clear contrast (Permanent Rule 8)
// v55.83-A.6.27.71 HOTFIX 3 (Max May 24 2026): Arabic labels added.
function statusBadge(status, ar) {
  switch (status) {
    case 'open':
      return { bg: 'bg-blue-100', text: 'text-blue-900', label: ar ? '📭 مفتوح' : '📭 Open', tooltip: ar ? 'يقبل إدخالات الإنفاق' : 'Accepting spend entries' };
    case 'fully_spent':
      return { bg: 'bg-emerald-100', text: 'text-emerald-900', label: ar ? '✓ أُنفق بالكامل' : '✓ Fully Spent', tooltip: ar ? 'تم إنفاق المبلغ كاملاً — جاهز للتقديم للموافقة' : 'All amount accounted — ready to submit for approval' };
    case 'pending_approval':
      return { bg: 'bg-amber-100', text: 'text-amber-900', label: ar ? '⏳ في انتظار الموافقة' : '⏳ Pending Approval', tooltip: ar ? 'في انتظار الموافِق' : 'Waiting for approver' };
    case 'closed':
      return { bg: 'bg-green-200', text: 'text-green-900', label: ar ? '🔒 مُغلق ومُسوّى' : '🔒 Closed & Reconciled', tooltip: ar ? 'تمت الموافقة وتحديث تقرير المصروفات' : 'Approved & expense report updated' };
    case 'cancelled':
      return { bg: 'bg-slate-200', text: 'text-slate-700', label: ar ? '✗ مُلغى' : '✗ Cancelled', tooltip: ar ? 'تم رد المبلغ إلى الخزنة' : 'Refunded back to treasury' };
    default:
      return { bg: 'bg-slate-100', text: 'text-slate-900', label: status, tooltip: '' };
  }
}

export default function WarehouseBucketList(props) {
  // Props:
  //   userId, isSuperAdmin, canCreate, canApprove, toast
  //   onRequestCreate: () => void  — open the create modal
  //   reloadToken: number  — bump to force a reload (caller increments after creating)
  //   lang: 'ar' | 'en' — for bilingual UI (v55.83-A.6.27.71 HOTFIX 3)

  var userId = props.userId;
  var isSuperAdmin = !!props.isSuperAdmin;
  var canCreate = !!props.canCreate;
  var onRequestCreate = props.onRequestCreate || function () {};
  var reloadToken = props.reloadToken || 0;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };
  var lang = props.lang === 'en' ? 'en' : 'ar';
  var ar = lang === 'ar';
  var dir = ar ? 'rtl' : 'ltr';

  var [view, setView] = useState('list');   // 'list' | 'detail'
  var [buckets, setBuckets] = useState([]);
  var [loading, setLoading] = useState(true);
  var [statusFilter, setStatusFilter] = useState('all');
  var [searchTerm, setSearchTerm] = useState('');
  var [selectedBucketId, setSelectedBucketId] = useState(null);
  var [selectedBucket, setSelectedBucket] = useState(null);
  var [selectedEntries, setSelectedEntries] = useState([]);
  var [detailLoading, setDetailLoading] = useState(false);
  // v55.83-A.6.27.71 HOTFIX 4 — Category lists for inline row edit autocomplete.
  // Loaded once on mount; never changes during the session unless user re-mounts.
  var [allCategories, setAllCategories] = useState([]);
  var [allSubcategories, setAllSubcategories] = useState([]);
  useEffect(function () {
    var cancelled = false;
    (async function () {
      try {
        var res = await supabase.from('treasury').select('category, subcategory').limit(2000);
        if (cancelled || res.error) return;
        var cats = {};
        var subs = {};
        (res.data || []).forEach(function (r) {
          if (r.category && r.category !== 'Warehouse Bucket' && r.category !== 'Warehouse Bucket Refund') {
            cats[r.category] = true;
            if (r.subcategory) subs[r.category + '||' + r.subcategory] = true;
          }
        });
        setAllCategories(Object.keys(cats).sort());
        setAllSubcategories(Object.keys(subs).sort());
      } catch (e) {
        console.warn('[bucket-list] category load failed:', e);
      }
    })();
    return function () { cancelled = true; };
  }, []);

  // v55.83-A.6.27.72 HOTFIX 16 — spent-amount-per-bucket map.
  // Loads all entries once on mount/reload so each bucket card can show its USED total
  // (not just the headline advance amount). Same source as the detail view but
  // pre-aggregated so the cards display "Spent: X / Y · Remaining: Z" at a glance.
  var [spentByBucket, setSpentByBucket] = useState({});

  // Load buckets on mount and whenever reloadToken changes
  useEffect(function () {
    var cancelled = false;
    setLoading(true);
    listBuckets({}).then(function (rows) {
      if (cancelled) return;
      setBuckets(rows || []);
      setLoading(false);
      // After buckets load, fetch entry sums per bucket
      var ids = (rows || []).map(function (r) { return r.id; });
      if (ids.length === 0) { setSpentByBucket({}); return; }
      supabase.from('warehouse_bucket_entries')
        .select('bucket_id, amount')
        .in('bucket_id', ids)
        .limit(10000)
        .then(function (eRes) {
          if (cancelled) return;
          if (eRes.error) {
            console.warn('[buckets-list] spent aggregation failed:', eRes.error);
            setSpentByBucket({});
            return;
          }
          var map = {};
          (eRes.data || []).forEach(function (e) {
            map[e.bucket_id] = (map[e.bucket_id] || 0) + Number(e.amount || 0);
          });
          setSpentByBucket(map);
        });
    }).catch(function (err) {
      console.warn('[buckets-list] load failed:', err);
      if (!cancelled) {
        setBuckets([]);
        setLoading(false);
      }
    });
    return function () { cancelled = true; };
  }, [reloadToken]);

  // Load detail when entering detail view
  useEffect(function () {
    if (view !== 'detail' || !selectedBucketId) return;
    var cancelled = false;
    setDetailLoading(true);
    getBucketWithEntries(selectedBucketId).then(function (res) {
      if (cancelled) return;
      setSelectedBucket(res.bucket);
      setSelectedEntries(res.entries || []);
      setDetailLoading(false);
    }).catch(function (err) {
      console.warn('[buckets-detail] load failed:', err);
      if (!cancelled) {
        setDetailLoading(false);
        toast.error('Could not load bucket: ' + ((err && err.message) || err));
      }
    });
    return function () { cancelled = true; };
  }, [view, selectedBucketId, reloadToken]);

  // Filtered list
  var filtered = useMemo(function () {
    var arr = buckets;
    if (statusFilter !== 'all') arr = arr.filter(function (b) { return b.status === statusFilter; });
    var q = searchTerm.trim().toLowerCase();
    if (q) {
      arr = arr.filter(function (b) {
        return (
          (b.recipient_name || '').toLowerCase().indexOf(q) >= 0 ||
          (b.reference || '').toLowerCase().indexOf(q) >= 0 ||
          (b.reference_slug || '').toLowerCase().indexOf(q) >= 0
        );
      });
    }
    return arr;
  }, [buckets, statusFilter, searchTerm]);

  // ─── DETAIL VIEW ─────────────────────────────────────────────────
  if (view === 'detail' && selectedBucketId) {
    if (detailLoading) {
      return (
        <div className="p-6 text-center text-slate-500 italic" dir={dir}>{ar ? 'جاري تحميل الدلو...' : 'Loading bucket...'}</div>
      );
    }
    if (!selectedBucket) {
      return (
        <div className="p-6" dir={dir}>
          <button onClick={function () { setView('list'); setSelectedBucketId(null); }} className="text-blue-600 hover:underline text-sm mb-3">{ar ? '→ العودة للدلاء' : '← Back to buckets'}</button>
          <div className="bg-amber-50 border-2 border-amber-400 rounded p-4 text-amber-900">{ar ? 'لم يتم العثور على الدلو أو تعذر تحميله.' : 'Bucket not found or could not be loaded.'}</div>
        </div>
      );
    }
    var b = selectedBucket;
    var spent = selectedEntries.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
    var remaining = Number(b.amount) - spent;
    var pct = b.amount > 0 ? Math.min(100, (spent / Number(b.amount)) * 100) : 0;
    var badge = statusBadge(b.status, ar);
    return (
      <div className="space-y-3" dir={dir}>
        <button onClick={function () { setView('list'); setSelectedBucketId(null); }} className="text-blue-600 hover:underline text-sm">{ar ? '→ العودة للدلاء' : '← Back to buckets'}</button>

        {/* Bucket summary card */}
        <div className={'rounded-lg border-2 p-4 ' + (b.status === 'closed' ? 'bg-emerald-50 border-emerald-400' : b.status === 'cancelled' ? 'bg-slate-100 border-slate-300' : 'bg-amber-50 border-amber-400')}>
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">🏭</span>
                <h3 className="text-lg font-extrabold text-slate-900">{b.recipient_name}</h3>
                <span className={'px-2 py-0.5 rounded text-[10px] font-extrabold ' + badge.bg + ' ' + badge.text} title={badge.tooltip}>{badge.label}</span>
                {b.status === 'closed' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-green-300 text-green-950" title={(ar ? 'تمت التسوية في ' : 'Reconciled on ') + fmtDate(b.closed_at)}>{ar ? '✓ تمت التسوية' : '✓ RECONCILED'}</span>
                )}
              </div>
              <div className="font-mono text-sm text-slate-700" dir="ltr">{b.reference_slug}</div>
              <div className="text-xs text-slate-600 mt-1">
                {ar ? 'تم الإصدار في ' : 'Issued '}<strong>{fmtDate(b.issue_date)}</strong> · {ar ? 'المرجع:' : 'Reference:'} <strong>{b.reference}</strong>
                {b.closed_at && <> · {ar ? 'مُغلق في ' : 'Closed '}<strong>{fmtDate(b.closed_at)}</strong></>}
                {b.cancelled_at && <> · {ar ? 'مُلغى في ' : 'Cancelled '}<strong>{fmtDate(b.cancelled_at)}</strong></>}
              </div>
              {b.notes && <div className="text-xs text-slate-600 italic mt-1">"{b.notes}"</div>}
            </div>
            <div className={ar ? 'text-left' : 'text-right'}>
              <div className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">{ar ? 'السلفة' : 'Advance'}</div>
              <div className="text-2xl font-mono font-extrabold text-slate-900">{fmtMoney(b.amount, b.currency)}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="bg-white rounded p-2 border border-slate-200">
              <div className="text-[10px] font-extrabold text-slate-600 uppercase">{ar ? 'تم إنفاقه' : 'Spent'}</div>
              <div className="font-mono font-bold text-blue-900">{fmtMoney(spent, b.currency)}</div>
            </div>
            <div className="bg-white rounded p-2 border border-slate-200">
              <div className="text-[10px] font-extrabold text-slate-600 uppercase">{ar ? 'متبقي' : 'Remaining'}</div>
              <div className={'font-mono font-bold ' + (remaining < 0 ? 'text-red-700' : remaining === 0 ? 'text-emerald-700' : 'text-slate-900')}>{fmtMoney(remaining, b.currency)}</div>
            </div>
            <div className="bg-white rounded p-2 border border-slate-200">
              <div className="text-[10px] font-extrabold text-slate-600 uppercase">{ar ? 'الإدخالات' : 'Entries'}</div>
              <div className="font-mono font-bold text-slate-900">{selectedEntries.length}</div>
            </div>
          </div>
          <div className="mt-2 w-full h-2 bg-slate-200 rounded overflow-hidden">
            <div style={{ width: pct + '%', background: pct >= 100 ? '#10b981' : '#f59e0b', height: '100%', transition: 'width 0.3s' }} />
          </div>
        </div>

        {/* v55.83-A.6.27.70 (Phase 3) — Lifecycle action bar.
            v55.83-A.6.27.72 HOTFIX 2 — Panel was bg-slate-50 → action buttons
            were invisible against it. Now bg-slate-100 with a visible header
            so users can see + find the controls (was "hiding in the middle"). */}
        {props.canManage || props.canApprove || props.canReopen || isSuperAdmin ? (
          <div className="bg-slate-100 border-2 border-slate-300 rounded-lg overflow-hidden shadow-sm">
            <div className="bg-slate-700 text-white px-4 py-2 flex items-center gap-2">
              <span className="text-base">⚙️</span>
              <span className="text-sm font-extrabold uppercase tracking-wide">{lang === 'ar' ? 'إجراءات الدلو' : 'Bucket Actions'}</span>
              <span className="text-[10px] text-slate-300 font-semibold ml-auto rtl:ml-0 rtl:mr-auto">
                {b.status === 'open' && (lang === 'ar' ? 'مفتوح — يمكن إضافة الإدخالات' : 'Open — add entries')}
                {b.status === 'fully_spent' && (lang === 'ar' ? 'أُنفق بالكامل — جاهز للتقديم' : 'Fully spent — ready to submit')}
                {b.status === 'pending_approval' && (lang === 'ar' ? 'بانتظار الموافقة' : 'Pending approval')}
                {b.status === 'closed' && (lang === 'ar' ? 'مُغلق — يمكن إعادة الفتح' : 'Closed — can be reopened')}
                {b.status === 'cancelled' && (lang === 'ar' ? 'مُلغى' : 'Cancelled')}
              </span>
            </div>
            <div className="p-3">
              <WarehouseBucketActions
                bucket={b}
                spent={spent}
                userId={userId}
                isSuperAdmin={isSuperAdmin}
                canManage={!!props.canManage || isSuperAdmin}
                canApprove={!!props.canApprove || isSuperAdmin}
                canReopen={!!props.canReopen || isSuperAdmin}
                lang={lang}
                onChanged={function () {
                  // Reload this detail view AND the parent list
                  getBucketWithEntries(selectedBucketId).then(function (res) {
                    setSelectedBucket(res.bucket);
                    setSelectedEntries(res.entries || []);
                  });
                  if (props.onBucketChanged) props.onBucketChanged();
                }}
                onDeleted={function () {
                  // After super-admin delete, bucket no longer exists — go back to list
                  setSelectedBucket(null);
                  setSelectedEntries([]);
                  setSelectedBucketId(null);
                  if (props.onBucketChanged) props.onBucketChanged();
                }}
                toast={toast}
              />
            </div>
          </div>
        ) : null}

        {/* v55.83-A.6.27.70 (Phase 3) — Spend-entry form. */}
        {(b.status === 'open' || b.status === 'fully_spent') && (props.canManage || isSuperAdmin) && (
          <WarehouseBucketEntryForm
            bucket={b}
            spent={spent}
            userId={userId}
            isSuperAdmin={isSuperAdmin}
            canManageCategories={!!props.canManageCategories || isSuperAdmin}
            lang={lang}
            onCreated={function () {
              getBucketWithEntries(selectedBucketId).then(function (res) {
                setSelectedBucket(res.bucket);
                setSelectedEntries(res.entries || []);
              });
              if (props.onBucketChanged) props.onBucketChanged();
            }}
            toast={toast}
          />
        )}

        {/* Entries table (read-only in Phase 2) */}
        <div className="bg-white rounded-lg border-2 border-slate-200 overflow-hidden">
          <div className="bg-slate-100 px-3 py-2 font-extrabold text-sm text-slate-900 border-b border-slate-200">
            {ar ? 'دفتر القيود — ' : 'Ledger — '}{selectedEntries.length} {ar ? (selectedEntries.length === 1 ? 'إدخال' : 'إدخالات') : (selectedEntries.length === 1 ? 'entry' : 'entries')}
          </div>
          {selectedEntries.length === 0 ? (
            <div className="p-6 text-center text-slate-500 italic text-sm">{ar ? 'لا توجد إدخالات إنفاق بعد.' : 'No spend entries yet.'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'التاريخ' : 'Date'}</th>
                    <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'الفئة' : 'Category'}</th>
                    <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'الفئة الفرعية' : 'Subcategory'}</th>
                    <th className="px-3 py-2 text-left font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'الوصف' : 'Description'}</th>
                    <th className="px-3 py-2 text-right font-extrabold text-slate-800 uppercase tracking-wider">{ar ? 'المبلغ' : 'Amount'}</th>
                    {/* v55.83-A.6.27.71 HOTFIX 4 — Actions column for edit/delete */}
                    {(props.canManage || isSuperAdmin) && (
                      <th className="px-2 py-2 text-center font-extrabold text-slate-800 uppercase tracking-wider w-24">{ar ? 'إجراءات' : 'Actions'}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {selectedEntries.map(function (e) {
                    return (
                      <WarehouseBucketEntryRow
                        key={e.id}
                        entry={e}
                        bucket={b}
                        canEdit={!!props.canManage || isSuperAdmin}
                        allCategories={allCategories}
                        allSubcategories={allSubcategories}
                        userId={userId}
                        lang={lang}
                        toast={toast}
                        onChanged={function () {
                          getBucketWithEntries(selectedBucketId).then(function (res) {
                            setSelectedBucket(res.bucket);
                            setSelectedEntries(res.entries || []);
                          });
                          if (props.onBucketChanged) props.onBucketChanged();
                        }}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-extrabold">
                    <td colSpan={4} className="px-3 py-2 text-right text-slate-900">{ar ? 'إجمالي ما تم إنفاقه' : 'Total Spent'}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-900">{fmtMoney(spent, b.currency)}</td>
                    {(props.canManage || isSuperAdmin) && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── LIST VIEW ───────────────────────────────────────────────────
  return (
    <div className="space-y-3" dir={dir}>
      {/* Header + create button */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">🏭 {ar ? 'دلاء المخزن' : 'Warehouse Buckets'} / {ar ? 'Warehouse Buckets' : 'دلاء المخزن'}</h3>
          <div className="text-[11px] text-slate-600">{buckets.length} {ar ? 'إجمالي · اضغط على أي دلو لرؤية دفتر قيوده' : 'total · click any bucket to see its ledger'}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={searchTerm}
            onChange={function (e) { setSearchTerm(e.target.value); }}
            placeholder={ar ? 'بحث عن مستلم أو مرجع...' : 'Search recipient or reference...'}
            className="px-2 py-1 border-2 border-slate-300 rounded text-xs bg-white text-slate-900"
          />
          <select
            value={statusFilter}
            onChange={function (e) { setStatusFilter(e.target.value); }}
            className="px-2 py-1 border-2 border-slate-300 rounded text-xs bg-white text-slate-900 font-extrabold"
          >
            <option value="all">{ar ? 'الكل' : 'All'} ({buckets.length})</option>
            <option value="open">{ar ? 'مفتوح' : 'Open'} ({buckets.filter(function (b) { return b.status === 'open'; }).length})</option>
            <option value="fully_spent">{ar ? 'أُنفق بالكامل' : 'Fully Spent'} ({buckets.filter(function (b) { return b.status === 'fully_spent'; }).length})</option>
            <option value="pending_approval">{ar ? 'في انتظار الموافقة' : 'Pending Approval'} ({buckets.filter(function (b) { return b.status === 'pending_approval'; }).length})</option>
            <option value="closed">{ar ? 'مُغلق' : 'Closed'} ({buckets.filter(function (b) { return b.status === 'closed'; }).length})</option>
            <option value="cancelled">{ar ? 'مُلغى' : 'Cancelled'} ({buckets.filter(function (b) { return b.status === 'cancelled'; }).length})</option>
          </select>
          {canCreate && (
            <button
              onClick={onRequestCreate}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow"
            >
              + {ar ? 'إنشاء دلو' : 'Create Bucket'}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="p-6 text-center text-slate-500 italic">{ar ? 'جاري تحميل الدلاء...' : 'Loading buckets...'}</div>
      ) : filtered.length === 0 ? (
        <div className="p-6 text-center bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg text-slate-600">
          {buckets.length === 0 ? (
            <>
              <div className="text-4xl mb-2">🏭</div>
              <div className="font-extrabold text-slate-900 mb-1">{ar ? 'لا توجد دلاء بعد' : 'No buckets yet'}</div>
              <div className="text-xs">{ar ? 'أنشئ أول سلفة مخزن من تبويب الخزنة أو اضغط "+ إنشاء دلو" أعلاه.' : 'Create your first warehouse advance from the Treasury tab or click "+ Create Bucket" above.'}</div>
            </>
          ) : (
            <div className="text-sm">{ar ? 'لا توجد دلاء مطابقة للفلتر.' : 'No buckets match your filter.'}</div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(function (b) {
            var badge = statusBadge(b.status, ar);
            // v55.83-A.6.27.72 HOTFIX 16 — Card now shows spent + remaining + progress bar.
            var spent = Number(spentByBucket[b.id] || 0);
            var advance = Number(b.amount || 0);
            var remaining = Math.max(0, advance - spent);
            var pct = advance > 0 ? Math.min(100, (spent / advance) * 100) : 0;
            // Pick bar color by status: closed = emerald, fully_spent = blue,
            // open + nothing spent yet = slate, open + some spent = amber, cancelled = slate
            var barColor =
              b.status === 'closed'      ? 'bg-emerald-500' :
              b.status === 'fully_spent' ? 'bg-blue-500' :
              b.status === 'cancelled'   ? 'bg-slate-400' :
              spent > 0                  ? 'bg-amber-500' :
                                           'bg-slate-300';
            return (
              <div
                key={b.id}
                onClick={function () { setSelectedBucketId(b.id); setView('detail'); }}
                className={'cursor-pointer rounded-lg border-2 p-3 hover:shadow-lg transition-all hover:-translate-y-0.5 ' + (b.status === 'closed' ? 'bg-emerald-50 border-emerald-300' : b.status === 'cancelled' ? 'bg-slate-100 border-slate-300 opacity-70' : 'bg-white border-slate-200 hover:border-amber-400')}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-base">🏭</span>
                      <div className="font-extrabold text-slate-900 truncate" title={b.recipient_name}>{b.recipient_name}</div>
                    </div>
                    <div className="font-mono text-[10px] text-slate-600 truncate" title={b.reference_slug}>{b.reference_slug}</div>
                  </div>
                  <span className={'px-1.5 py-0.5 rounded text-[9px] font-extrabold whitespace-nowrap ' + badge.bg + ' ' + badge.text} title={badge.tooltip}>{badge.label}</span>
                </div>
                {/* Advance amount + date */}
                <div className="flex items-end justify-between mb-2">
                  <div className="text-[10px] text-slate-500">{fmtDate(b.issue_date)}</div>
                  <div className="font-mono font-extrabold text-slate-900 text-lg">{fmtMoney(advance, b.currency)}</div>
                </div>
                {/* HOTFIX 16 — Spent + Remaining + progress bar.
                    Shows at-a-glance: USED N of M (P%) · LEFT R */}
                <div className="border-t border-slate-200 pt-2">
                  <div className="flex items-center justify-between text-[10px] font-bold mb-1">
                    <div>
                      <span className="text-slate-500 uppercase tracking-wider">{ar ? 'مستخدم' : 'Used'}: </span>
                      <span className={'font-mono ' + (spent > 0 ? 'text-amber-700' : 'text-slate-400')}>{fmtMoney(spent, b.currency)}</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-500">{pct.toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase tracking-wider">{ar ? 'متبقي' : 'Left'}: </span>
                      <span className={'font-mono ' + (remaining > 0.005 ? 'text-emerald-700' : 'text-slate-400')}>{fmtMoney(remaining, b.currency)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
                    <div className={barColor + ' h-full transition-all'} style={{ width: pct + '%' }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
