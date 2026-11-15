'use client';
// v55.83-A.6.27.70 — Bucket lifecycle action bar.
//
// Renders the workflow buttons at the top of the bucket detail view based
// on (a) bucket status and (b) user permissions. Implements Option C
// workflow per Max's spec:
//   • If user has BOTH manage + approve perms → single "Submit & Approve"
//     button (one-click) when bucket is fully_spent or pending_approval
//   • Otherwise: two-click path (Submit → then someone else Approves)
//   • Self-approve protection: the user who CREATED the bucket cannot
//     approve their own work unless they're super-admin (which gets a
//     "you're approving your own bucket, continue?" confirm)

import { useState } from 'react';
import {
  submitBucketForApproval,
  approveAndCloseBucket,
  reopenBucket,
  cancelBucket,
  deleteBucket,
} from '../lib/warehouse-buckets';

export default function WarehouseBucketActions(props) {
  // Props:
  //   bucket, spent, userId, isSuperAdmin
  //   canManage, canApprove, canReopen
  //   onChanged, toast
  //   lang: 'ar' | 'en' (v55.83-A.6.27.71 HOTFIX 3)

  var bucket = props.bucket;
  var spent = Number(props.spent || 0);
  var userId = props.userId;
  var isSuperAdmin = !!props.isSuperAdmin;
  var canManage = !!props.canManage;
  var canApprove = !!props.canApprove;
  var canReopen = !!props.canReopen;
  var onChanged = props.onChanged || function () {};
  var onDeleted = props.onDeleted || function () {};
  var toast = props.toast || { success: function(){}, error: function(){} };
  var lang = props.lang === 'en' ? 'en' : 'ar';
  var ar = lang === 'ar';
  var dir = ar ? 'rtl' : 'ltr';

  var [busy, setBusy] = useState(false);
  var [showCancelModal, setShowCancelModal] = useState(false);
  var [cancelReason, setCancelReason] = useState('');
  var [showReopenModal, setShowReopenModal] = useState(false);
  var [reopenReason, setReopenReason] = useState('');
  // v55.83-A.6.27.72 HOTFIX 2 — super-admin destructive delete
  var [showDeleteModal, setShowDeleteModal] = useState(false);
  var [deleteConfirmText, setDeleteConfirmText] = useState('');

  if (!bucket) return null;

  var remaining = Number(bucket.amount || 0) - spent;
  var isCreator = bucket.created_by === userId;
  var canDoOneClick = canManage && canApprove;
  var overspent = remaining < -0.001;

  // ─── Action handlers ────────────────────────────────────────────

  async function handleSubmit() {
    if (overspent) {
      toast.error(ar ? 'لا يمكن التقديم — الدلو في حالة إنفاق زائد. خفّض الإدخالات أو قسّمها أولاً.' : 'Cannot submit — bucket is overspent. Reduce or split entries first.');
      return;
    }
    setBusy(true);
    try {
      var res = await submitBucketForApproval(bucket.id, userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(ar ? 'تم التقديم للموافقة' : 'Submitted for approval');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function doApprove(forceSelfApprove) {
    setBusy(true);
    try {
      var res = await approveAndCloseBucket({
        bucketId: bucket.id,
        userId: userId,
        isSuperAdmin: isSuperAdmin,
        forceSelfApprove: !!forceSelfApprove,
      });
      if (res.selfApproveWarning) {
        // Super-admin self-approve — confirm
        if (confirm(ar ? 'لقد أنشأت هذا الدلو. بصفتك مديرًا، يمكنك تجاوز حماية الموافقة الذاتية. هل تريد المتابعة؟' : 'You created this bucket. As super-admin you can override the self-approve protection. Continue?')) {
          return doApprove(true);
        }
        return;
      }
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(ar ? 'تمت الموافقة والإغلاق' : 'Approved & closed');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitAndApprove() {
    if (overspent) {
      toast.error(ar ? 'لا يمكن التقديم — الدلو في حالة إنفاق زائد. خفّض الإدخالات أو قسّمها أولاً.' : 'Cannot submit — bucket is overspent. Reduce or split entries first.');
      return;
    }
    if (isCreator && !isSuperAdmin) {
      toast.error(ar ? 'لقد أنشأت هذا الدلو — يجب أن يوافق عليه شخص آخر. استخدم "تقديم للموافقة" وانتظر موافِقًا آخر.' : 'You created this bucket — someone else must approve it. Use "Submit for Approval" and wait for another approver.');
      return;
    }
    if (isCreator && isSuperAdmin) {
      if (!confirm(ar ? 'لقد أنشأت هذا الدلو. بصفتك مديرًا يمكنك الموافقة على عملك، لكن هذا غير معتاد. هل تريد المتابعة؟' : 'You created this bucket. As super-admin you can self-approve, but this is unusual. Continue?')) return;
    }
    setBusy(true);
    try {
      var res = await approveAndCloseBucket({
        bucketId: bucket.id,
        userId: userId,
        isSuperAdmin: isSuperAdmin,
        forceSelfApprove: isCreator && isSuperAdmin,
      });
      if (!res.ok) {
        if (res.selfApproveWarning && isSuperAdmin) {
          var retry = await approveAndCloseBucket({
            bucketId: bucket.id, userId: userId, isSuperAdmin: true, forceSelfApprove: true,
          });
          if (!retry.ok) { toast.error(retry.error); return; }
          toast.success(ar ? 'تم التقديم والموافقة' : 'Submitted & approved');
          onChanged();
          return;
        }
        toast.error(res.error);
        return;
      }
      toast.success(ar ? 'تم التقديم والموافقة' : 'Submitted & approved');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleReopenConfirm() {
    if (!reopenReason.trim()) { toast.error(ar ? 'أدخل سببًا — هذا يُسجَّل في سجل التدقيق.' : 'Provide a reason — this is audit-logged.'); return; }
    setBusy(true);
    try {
      var res = await reopenBucket(bucket.id, userId, reopenReason.trim());
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(ar ? 'تم إعادة فتح الدلو' : 'Bucket reopened');
      setShowReopenModal(false);
      setReopenReason('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelConfirm() {
    if (!cancelReason.trim()) { toast.error(ar ? 'أدخل سببًا — هذا يُنشئ ائتمان استرداد ويُسجَّل في سجل التدقيق.' : 'Provide a reason — this creates a refund credit and is audit-logged.'); return; }
    setBusy(true);
    try {
      var res = await cancelBucket({ bucketId: bucket.id, userId: userId, reason: cancelReason.trim() });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(ar ? 'تم إلغاء الدلو — تم تسجيل ائتمان الاسترداد في الخزنة' : 'Bucket cancelled — refund credit posted to Treasury');
      setShowCancelModal(false);
      setCancelReason('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // v55.83-A.6.27.72 HOTFIX 2 — Super-admin destructive delete (typed confirmation).
  async function handleDeleteConfirm() {
    if (deleteConfirmText !== 'DELETE') {
      toast.error(ar ? 'اكتب DELETE بأحرف كبيرة للتأكيد' : 'Type DELETE in capitals to confirm');
      return;
    }
    setBusy(true);
    try {
      var res = await deleteBucket(bucket.id, userId);
      if (!res.ok) {
        toast.error(res.error);
        alert((ar ? 'فشل الحذف: ' : 'Delete failed: ') + res.error);
        return;
      }
      var msg = ar ? ('تم حذف الدلو ' + (res.reference_slug || '')) : ('Bucket deleted: ' + (res.reference_slug || ''));
      if (res.partialErrors) {
        msg += ar ? ' (مع تحذيرات: ' : ' (with warnings: ';
        msg += res.partialErrors.join('; ') + ')';
      }
      toast.success(msg);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  // ─── Decide which buttons to show based on status ───────────────

  var st = bucket.status;
  var buttons = [];

  // SUBMIT / APPROVE (only when in submittable states)
  if ((st === 'fully_spent' || st === 'pending_approval') && canManage) {
    if (canDoOneClick && !isCreator) {
      buttons.push(
        <button key="submitApprove" onClick={handleSubmitAndApprove} disabled={busy || overspent}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
          title={overspent ? (ar ? 'إنفاق زائد — حلّ الإنفاق الزائد أولاً' : 'Overspent — resolve first') : (ar ? 'التقديم والموافقة في نقرة واحدة (لديك الإذنان)' : 'Submit AND approve in one click (you have both perms)')}>
          ✓ {ar ? 'تقديم وموافقة' : 'Submit & Approve'}
        </button>
      );
    } else if (canDoOneClick && isCreator && isSuperAdmin) {
      buttons.push(
        <button key="submitApproveOverride" onClick={handleSubmitAndApprove} disabled={busy || overspent}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
          title={ar ? 'تجاوز المدير: سيتم سؤالك لتأكيد الموافقة الذاتية' : "Super-admin override: you'll be asked to confirm self-approve"}>
          ✓ {ar ? 'تقديم وموافقة (تجاوز)' : 'Submit & Approve (override)'}
        </button>
      );
    } else if (canDoOneClick && isCreator) {
      if (st === 'fully_spent') {
        buttons.push(
          <button key="submit" onClick={handleSubmit} disabled={busy || overspent}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
            title={ar ? 'تقديم للموافقة (لا يمكنك الموافقة الذاتية — يجب أن يُغلق موافِق آخر)' : "Submit for approval (you can't self-approve — another approver must close)"}>
            ⏳ {ar ? 'تقديم للموافقة' : 'Submit for Approval'}
          </button>
        );
      }
    } else {
      if (st === 'fully_spent') {
        buttons.push(
          <button key="submit" onClick={handleSubmit} disabled={busy || overspent}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
            ⏳ {ar ? 'تقديم للموافقة' : 'Submit for Approval'}
          </button>
        );
      }
    }
  }
  // Stand-alone Approve button when pending_approval and approver isn't creator
  if (st === 'pending_approval' && canApprove) {
    if (!isCreator || isSuperAdmin) {
      buttons.push(
        <button key="approve" onClick={function () { doApprove(false); }} disabled={busy}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50">
          ✓ {ar ? 'موافقة وإغلاق' : 'Approve & Close'}
        </button>
      );
    }
  }
  // CANCEL — pre-close states only
  if ((st === 'open' || st === 'fully_spent' || st === 'pending_approval') && (canManage || isSuperAdmin)) {
    buttons.push(
      <button key="cancel" onClick={function () { setShowCancelModal(true); }} disabled={busy}
        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 text-xs font-extrabold rounded disabled:opacity-50"
        title={ar ? 'إلغاء الدلو وإعادة السلفة إلى الخزنة' : 'Cancel the bucket and refund the advance back to Treasury'}>
        ✗ {ar ? 'إلغاء الدلو' : 'Cancel Bucket'}
      </button>
    );
  }
  // REOPEN — closed buckets only
  // v55.83-A.6.27.72 HOTFIX 2 — was bg-slate-200 text-slate-800 inside a bg-slate-50
  // parent panel → button blended into panel and was invisible. Now uses bold amber
  // for high contrast on any background.
  if (st === 'closed' && canReopen) {
    buttons.push(
      <button key="reopen" onClick={function () { setShowReopenModal(true); }} disabled={busy}
        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50"
        title={ar ? 'إعادة فتح — يلغي الإغلاق. مُسجَّل في سجل التدقيق.' : 'Reopen — reverses the close. Audit-logged.'}>
        ↩ {ar ? 'إعادة فتح الدلو' : 'Reopen Bucket'}
      </button>
    );
  }
  // v55.83-A.6.27.72 HOTFIX 2 — SUPER ADMIN DELETE (any status).
  // Destructive: removes bucket + entries + linked treasury rows. Typed-DELETE
  // confirmation required. For typo/test cleanup; normal flow is Cancel (which
  // preserves audit trail via a refund credit).
  if (isSuperAdmin) {
    buttons.push(
      <button key="superDelete" onClick={function () { setShowDeleteModal(true); }} disabled={busy}
        className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 ring-2 ring-red-300"
        title={ar ? 'حذف نهائي — يحذف الدلو + الإدخالات + سجلات الخزنة المرتبطة (للمدير فقط)' : 'Permanent delete — removes bucket + entries + linked treasury rows (super-admin only)'}>
        🗑 {ar ? 'حذف نهائي' : 'Super Delete'}
      </button>
    );
  }

  // Always render container so the modals work even if no action buttons
  if (buttons.length === 0 && !showCancelModal && !showReopenModal && !showDeleteModal) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap" dir={dir}>
      {buttons}
      {overspent && (
        <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-300 rounded px-2 py-1">
          ⚠️ {ar ? 'الدلو في حالة إنفاق زائد — التقديم محظور' : 'Bucket is overspent — submit blocked'}
        </span>
      )}

      {/* Cancel modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-[220] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) setShowCancelModal(false); }} dir={dir}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-red-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">✗ {ar ? 'إلغاء الدلو' : 'Cancel Bucket'}</div>
              <div className="text-[11px] text-red-100 mt-0.5">{ar ? 'سيتم تسجيل ائتمان استرداد في الخزنة. مُسجَّل في سجل التدقيق.' : 'A refund credit will be posted to Treasury. Audit-logged.'}</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-slate-700">
                {ar
                  ? <>أنت على وشك إلغاء <strong className="font-mono">{bucket.reference_slug}</strong>. سيظهر في الخزنة إيداع نقدي بقيمة {Number(bucket.amount).toLocaleString(undefined, {minimumFractionDigits:2})} {bucket.currency} لإلغاء الخصم الأصلي.</>
                  : <>You're about to cancel <strong className="font-mono">{bucket.reference_slug}</strong>. A {Number(bucket.amount).toLocaleString(undefined, {minimumFractionDigits:2})} {bucket.currency} cash-in entry will appear in Treasury to undo the original cash-out.</>}
              </div>
              <label className="block">
                <span className="block text-xs font-extrabold text-slate-900 mb-1">{ar ? 'السبب' : 'Reason'} <span className="text-red-600">*</span></span>
                <textarea value={cancelReason} onChange={function (e) { setCancelReason(e.target.value); }} disabled={busy} rows={3}
                  placeholder={ar ? 'مثال: قام المستلم بإعادة السلفة — تم إلغاء المهمة' : 'e.g. Recipient returned the advance — task was cancelled'}
                  className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { if (!busy) { setShowCancelModal(false); setCancelReason(''); } }} disabled={busy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded">{ar ? 'رجوع' : 'Back'}</button>
              <button onClick={handleCancelConfirm} disabled={busy || !cancelReason.trim()}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-extrabold rounded disabled:opacity-50">
                {busy ? (ar ? 'جاري الإلغاء...' : 'Cancelling...') : '✗ ' + (ar ? 'إلغاء واسترداد' : 'Cancel & Refund')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-[220] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) setShowReopenModal(false); }} dir={dir}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-slate-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">↩ {ar ? 'إعادة فتح الدلو' : 'Reopen Bucket'}</div>
              <div className="text-[11px] text-slate-200 mt-0.5">{ar ? 'يلغي الإغلاق. مُسجَّل في سجل التدقيق.' : 'Reverses the close. Audit-logged.'}</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-slate-700">
                {ar
                  ? 'سيعود الدلو إلى حالة "أُنفق بالكامل"، وستعود علامة "تمت التسوية" على صف الخزنة إلى "في الانتظار"، وسيعود تصنيف تقرير المصروفات إلى عنصر نائب "Warehouse Bucket". تُحفظ الإدخالات.'
                  : 'The bucket will revert to fully_spent, the Treasury row\'s "Reconciled" badge will revert to "Pending," and the Expense Report categorization will revert to the "Warehouse Bucket" placeholder. Entries are preserved.'}
              </div>
              <label className="block">
                <span className="block text-xs font-extrabold text-slate-900 mb-1">{ar ? 'السبب' : 'Reason'} <span className="text-red-600">*</span></span>
                <textarea value={reopenReason} onChange={function (e) { setReopenReason(e.target.value); }} disabled={busy} rows={3}
                  placeholder={ar ? 'مثال: وُجد إدخال مصنّف بشكل خاطئ — يجب الإصلاح قبل الإغلاق مرة أخرى' : 'e.g. Found a misclassified entry — need to fix before re-closing'}
                  className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { if (!busy) { setShowReopenModal(false); setReopenReason(''); } }} disabled={busy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded">{ar ? 'رجوع' : 'Back'}</button>
              <button onClick={handleReopenConfirm} disabled={busy || !reopenReason.trim()}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded disabled:opacity-50">
                {busy ? (ar ? 'جاري إعادة الفتح...' : 'Reopening...') : '↩ ' + (ar ? 'إعادة فتح' : 'Reopen')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* v55.83-A.6.27.72 HOTFIX 2 — Super-admin delete modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[220] bg-black/85 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) setShowDeleteModal(false); }} dir={dir}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-red-800 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">🗑 {ar ? 'حذف نهائي للدلو' : 'Permanently Delete Bucket'}</div>
              <div className="text-[11px] text-red-100 mt-0.5">{ar ? 'إجراء مدمر — لا يمكن التراجع. للمدير العام فقط.' : 'Destructive — cannot be undone. Super-admin only.'}</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-slate-900 bg-red-50 border-2 border-red-300 rounded p-3">
                {ar
                  ? <>سيحذف هذا <strong className="font-mono">{bucket.reference_slug}</strong> نهائيًا، بما في ذلك:</>
                  : <>This will permanently remove <strong className="font-mono">{bucket.reference_slug}</strong> including:</>}
                <ul className="mt-2 mr-4 list-disc text-xs space-y-1">
                  <li>{ar ? 'سجل الدلو نفسه' : 'The bucket record itself'}</li>
                  <li>{ar ? 'جميع إدخالات الإنفاق المسجَّلة عليه' : 'All spend entries logged against it'}</li>
                  <li>{ar ? 'صفوف الخزنة المرتبطة (التخصيص الأصلي + أي ائتمان استرداد)' : 'Linked Treasury rows (original placeholder + any refund credits)'}</li>
                </ul>
                <div className="mt-2 text-xs text-red-800 font-bold">
                  {ar
                    ? 'استخدم "إلغاء الدلو" بدلاً من ذلك إذا كنت تريد الحفاظ على سجل التدقيق.'
                    : 'Use "Cancel Bucket" instead if you want to preserve the audit trail.'}
                </div>
              </div>
              <label className="block">
                <span className="block text-xs font-extrabold text-slate-900 mb-1">{ar ? 'اكتب DELETE للتأكيد' : 'Type DELETE to confirm'} <span className="text-red-600">*</span></span>
                <input value={deleteConfirmText} onChange={function (e) { setDeleteConfirmText(e.target.value); }} disabled={busy}
                  placeholder="DELETE"
                  className="w-full px-3 py-2 border-2 border-red-400 rounded text-sm bg-white text-slate-900 font-mono font-bold" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-100 rounded-b-2xl">
              <button onClick={function () { if (!busy) { setShowDeleteModal(false); setDeleteConfirmText(''); } }} disabled={busy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded">{ar ? 'رجوع' : 'Back'}</button>
              <button onClick={handleDeleteConfirm} disabled={busy || deleteConfirmText !== 'DELETE'}
                className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white text-sm font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
                {busy ? (ar ? 'جاري الحذف...' : 'Deleting...') : '🗑 ' + (ar ? 'حذف نهائيًا' : 'Delete Permanently')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
