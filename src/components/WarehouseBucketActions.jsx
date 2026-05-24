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
} from '../lib/warehouse-buckets';

export default function WarehouseBucketActions(props) {
  // Props:
  //   bucket: the bucket object
  //   spent: current spent total (so we can show "submit blocked: overspend pending")
  //   userId, isSuperAdmin
  //   canManage     — bool (Manage Warehouse Buckets perm OR super-admin)
  //   canApprove    — bool (Approve Warehouse Buckets perm OR super-admin)
  //   canReopen     — bool (Reopen Closed Buckets perm OR super-admin)
  //   onChanged: () => void  — called after any state change
  //   toast: { success, error }

  var bucket = props.bucket;
  var spent = Number(props.spent || 0);
  var userId = props.userId;
  var isSuperAdmin = !!props.isSuperAdmin;
  var canManage = !!props.canManage;
  var canApprove = !!props.canApprove;
  var canReopen = !!props.canReopen;
  var onChanged = props.onChanged || function () {};
  var toast = props.toast || { success: function(){}, error: function(){} };

  var [busy, setBusy] = useState(false);
  var [showCancelModal, setShowCancelModal] = useState(false);
  var [cancelReason, setCancelReason] = useState('');
  var [showReopenModal, setShowReopenModal] = useState(false);
  var [reopenReason, setReopenReason] = useState('');

  if (!bucket) return null;

  var remaining = Number(bucket.amount || 0) - spent;
  var isCreator = bucket.created_by === userId;
  var canDoOneClick = canManage && canApprove;
  var overspent = remaining < -0.001;

  // ─── Action handlers ────────────────────────────────────────────

  async function handleSubmit() {
    if (overspent) {
      toast.error('Cannot submit — bucket is overspent. Reduce or split entries first.');
      return;
    }
    setBusy(true);
    try {
      var res = await submitBucketForApproval(bucket.id, userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Submitted for approval');
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
        if (confirm('You created this bucket. As super-admin you can override the self-approve protection. Continue?')) {
          return doApprove(true);
        }
        return;
      }
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Approved & closed');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitAndApprove() {
    if (overspent) {
      toast.error('Cannot submit — bucket is overspent. Reduce or split entries first.');
      return;
    }
    // Self-approve check FIRST (so the user gets a confirm before submit)
    if (isCreator && !isSuperAdmin) {
      toast.error('You created this bucket — someone else must approve it. Use "Submit for Approval" and wait for another approver.');
      return;
    }
    if (isCreator && isSuperAdmin) {
      if (!confirm('You created this bucket. As super-admin you can self-approve, but this is unusual. Continue?')) return;
    }
    setBusy(true);
    try {
      // Submit + approve in one shot (approveAndCloseBucket auto-fills
      // submitted_at if it wasn't already set — implemented in Phase 1 helper)
      var res = await approveAndCloseBucket({
        bucketId: bucket.id,
        userId: userId,
        isSuperAdmin: isSuperAdmin,
        forceSelfApprove: isCreator && isSuperAdmin,
      });
      if (!res.ok) {
        // If the helper still complains about self-approve, retry with force=true
        if (res.selfApproveWarning && isSuperAdmin) {
          var retry = await approveAndCloseBucket({
            bucketId: bucket.id, userId: userId, isSuperAdmin: true, forceSelfApprove: true,
          });
          if (!retry.ok) { toast.error(retry.error); return; }
          toast.success('Submitted & approved');
          onChanged();
          return;
        }
        toast.error(res.error);
        return;
      }
      toast.success('Submitted & approved');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleReopenConfirm() {
    if (!reopenReason.trim()) { toast.error('Provide a reason — this is audit-logged.'); return; }
    setBusy(true);
    try {
      var res = await reopenBucket(bucket.id, userId, reopenReason.trim());
      if (!res.ok) { toast.error(res.error); return; }
      toast.success('Bucket reopened');
      setShowReopenModal(false);
      setReopenReason('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelConfirm() {
    if (!cancelReason.trim()) { toast.error('Provide a reason — this creates a refund credit and is audit-logged.'); return; }
    setBusy(true);
    try {
      var res = await cancelBucket({ bucketId: bucket.id, userId: userId, reason: cancelReason.trim() });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success('Bucket cancelled — refund credit posted to Treasury');
      setShowCancelModal(false);
      setCancelReason('');
      onChanged();
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
      // One-click "Submit & Approve" (Option C ideal case)
      buttons.push(
        <button key="submitApprove" onClick={handleSubmitAndApprove} disabled={busy || overspent}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
          title={overspent ? 'Overspent — resolve first' : 'Submit AND approve in one click (you have both perms)'}>
          ✓ Submit & Approve
        </button>
      );
    } else if (canDoOneClick && isCreator && isSuperAdmin) {
      // Super-admin who's also creator — single button but with override confirm
      buttons.push(
        <button key="submitApproveOverride" onClick={handleSubmitAndApprove} disabled={busy || overspent}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
          title="Super-admin override: you'll be asked to confirm self-approve">
          ✓ Submit & Approve (override)
        </button>
      );
    } else if (canDoOneClick && isCreator) {
      // Has both perms but isn't super-admin and IS creator → must use two-click path
      if (st === 'fully_spent') {
        buttons.push(
          <button key="submit" onClick={handleSubmit} disabled={busy || overspent}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
            title="Submit for approval (you can't self-approve — another approver must close)">
            ⏳ Submit for Approval
          </button>
        );
      }
    } else {
      // Just manage — two-click path
      if (st === 'fully_spent') {
        buttons.push(
          <button key="submit" onClick={handleSubmit} disabled={busy || overspent}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
            ⏳ Submit for Approval
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
          ✓ Approve & Close
        </button>
      );
    }
  }
  // CANCEL — pre-close states only
  if ((st === 'open' || st === 'fully_spent' || st === 'pending_approval') && (canManage || isSuperAdmin)) {
    buttons.push(
      <button key="cancel" onClick={function () { setShowCancelModal(true); }} disabled={busy}
        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 text-xs font-extrabold rounded disabled:opacity-50"
        title="Cancel the bucket and refund the advance back to Treasury">
        ✗ Cancel Bucket
      </button>
    );
  }
  // REOPEN — closed buckets only
  if (st === 'closed' && canReopen) {
    buttons.push(
      <button key="reopen" onClick={function () { setShowReopenModal(true); }} disabled={busy}
        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 border border-slate-300 text-xs font-extrabold rounded disabled:opacity-50"
        title="Reopen — reverses the close. Audit-logged.">
        ↩ Reopen Bucket
      </button>
    );
  }

  if (buttons.length === 0 && !showCancelModal && !showReopenModal) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {buttons}
      {overspent && (
        <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-300 rounded px-2 py-1">
          ⚠️ Bucket is overspent — submit blocked
        </span>
      )}

      {/* Cancel modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-[220] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) setShowCancelModal(false); }}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-red-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">✗ Cancel Bucket</div>
              <div className="text-[11px] text-red-100 mt-0.5">A refund credit will be posted to Treasury. Audit-logged.</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-slate-700">
                You're about to cancel <strong className="font-mono">{bucket.reference_slug}</strong>. A {Number(bucket.amount).toLocaleString(undefined, {minimumFractionDigits:2})} {bucket.currency} cash-in entry will appear in Treasury to undo the original cash-out.
              </div>
              <label className="block">
                <span className="block text-xs font-extrabold text-slate-900 mb-1">Reason <span className="text-red-600">*</span></span>
                <textarea value={cancelReason} onChange={function (e) { setCancelReason(e.target.value); }} disabled={busy} rows={3}
                  placeholder="e.g. Recipient returned the advance — task was cancelled"
                  className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { if (!busy) { setShowCancelModal(false); setCancelReason(''); } }} disabled={busy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded">Back</button>
              <button onClick={handleCancelConfirm} disabled={busy || !cancelReason.trim()}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-extrabold rounded disabled:opacity-50">
                {busy ? 'Cancelling...' : '✗ Cancel & Refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-[220] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) setShowReopenModal(false); }}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-slate-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">↩ Reopen Bucket</div>
              <div className="text-[11px] text-slate-200 mt-0.5">Reverses the close. Audit-logged.</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-slate-700">
                The bucket will revert to <strong>fully_spent</strong>, the Treasury row's "Reconciled" badge will revert to "Pending," and the Expense Report categorization will revert to the "Warehouse Bucket" placeholder. Entries are preserved.
              </div>
              <label className="block">
                <span className="block text-xs font-extrabold text-slate-900 mb-1">Reason <span className="text-red-600">*</span></span>
                <textarea value={reopenReason} onChange={function (e) { setReopenReason(e.target.value); }} disabled={busy} rows={3}
                  placeholder="e.g. Found a misclassified entry — need to fix before re-closing"
                  className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { if (!busy) { setShowReopenModal(false); setReopenReason(''); } }} disabled={busy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded">Back</button>
              <button onClick={handleReopenConfirm} disabled={busy || !reopenReason.trim()}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded disabled:opacity-50">
                {busy ? 'Reopening...' : '↩ Reopen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
