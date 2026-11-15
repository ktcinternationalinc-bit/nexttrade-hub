'use client';
// v55.83-A.6.27.71 HOTFIX 4 (Max May 24 2026) — Editable bucket-entry row.
//
// Renders one row of the ledger table. By default shows the entry's values
// in read-only mode with ✏️ Edit and 🗑️ Delete icons at the end. Clicking
// Edit flips ALL cells in that row into editable inputs (date, amount,
// category, subcategory, description), with ✓ Save and ✗ Cancel icons.
// Delete shows a confirm() then calls deleteBucketEntry().
//
// Edits respect the same locked-state rules as inserts (closed/cancelled/
// pending_approval buckets reject edits — error toast surfaces this) and
// trigger bucket status recompute (open↔fully_spent) via the lib helper.
//
// Categories + subcategories autocomplete from the lists prop (passed by
// the parent — pulled from treasury distinct values just like the entry
// form's add path).

import { useState } from 'react';
import { updateBucketEntry, deleteBucketEntry } from '../lib/warehouse-buckets';

function fmtMoney(n, cur) {
  if (n == null || isNaN(Number(n))) return '0.00 ' + (cur || '');
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || '');
}
function fmtDate(d) { return d ? String(d).substring(0, 10) : '—'; }

export default function WarehouseBucketEntryRow(props) {
  // Props:
  //   entry: the entry object (id, entry_date, amount, category, subcategory, description)
  //   bucket: parent bucket (for currency display + status check)
  //   canEdit: bool — controls whether edit/delete buttons appear
  //   allCategories: array of strings (for dropdown)
  //   allSubcategories: array of "category||subcategory" composite keys
  //   userId
  //   onChanged: () => void — called after successful save or delete
  //   toast: { success, error }
  //   lang: 'ar' | 'en'
  var entry = props.entry;
  var bucket = props.bucket || {};
  var canEdit = !!props.canEdit;
  var allCategories = props.allCategories || [];
  var allSubcategories = props.allSubcategories || [];
  var userId = props.userId;
  var onChanged = props.onChanged || function () {};
  var toast = props.toast || { success: function(){}, error: function(){} };
  var lang = props.lang === 'en' ? 'en' : 'ar';
  var ar = lang === 'ar';

  var [editing, setEditing] = useState(false);
  var [busy, setBusy] = useState(false);
  var [editDate, setEditDate] = useState(entry.entry_date || '');
  var [editAmount, setEditAmount] = useState(String(entry.amount || ''));
  var [editCategory, setEditCategory] = useState(entry.category || '');
  var [editSubcategory, setEditSubcategory] = useState(entry.subcategory || '');
  var [editDescription, setEditDescription] = useState(entry.description || '');

  // Bucket-state guard — locked buckets can't be edited
  var locked = bucket.status === 'closed' || bucket.status === 'cancelled' || bucket.status === 'pending_approval';

  // Subcategory options filtered by selected category
  var subcatOptions = (function () {
    if (!editCategory) return [];
    var prefix = editCategory + '||';
    return allSubcategories
      .filter(function (k) { return k.indexOf(prefix) === 0; })
      .map(function (k) { return k.substring(prefix.length); });
  })();

  function cancelEdit() {
    setEditing(false);
    setEditDate(entry.entry_date || '');
    setEditAmount(String(entry.amount || ''));
    setEditCategory(entry.category || '');
    setEditSubcategory(entry.subcategory || '');
    setEditDescription(entry.description || '');
  }

  async function handleSave() {
    var amt = Number(editAmount);
    if (!amt || amt <= 0) { toast.error(ar ? 'يجب أن يكون المبلغ موجبًا.' : 'Amount must be positive.'); return; }
    if (!editCategory.trim()) { toast.error(ar ? 'الفئة مطلوبة.' : 'Category is required.'); return; }
    if (!editDate) { toast.error(ar ? 'التاريخ مطلوب.' : 'Date is required.'); return; }
    setBusy(true);
    try {
      var res = await updateBucketEntry({
        entryId: entry.id,
        entryDate: editDate,
        amount: amt,
        category: editCategory.trim(),
        subcategory: editSubcategory.trim() || null,
        description: editDescription.trim() || null,
        userId: userId,
      });
      if (res.overspend) {
        toast.error((ar ? 'الإنفاق الزائد: المبلغ يتجاوز سعة الدلو بمقدار ' : 'Overspend: amount exceeds bucket capacity by ') + fmtMoney(res.overspend.byAmount, bucket.currency) + (ar ? '. قلّل المبلغ أو احذف الإدخال ثم أضفه بشكل منقسم.' : '. Reduce the amount or delete this entry and re-add it as a split.'));
        setBusy(false);
        return;
      }
      if (!res.ok) {
        toast.error(res.error || (ar ? 'فشل التحديث' : 'Update failed'));
        setBusy(false);
        return;
      }
      toast.success(ar ? 'تم تحديث الإدخال' : 'Entry updated');
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error((err && err.message) || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    var msg = ar
      ? 'هل أنت متأكد من حذف هذا الإدخال؟\n\n' + (entry.category || '') + (entry.subcategory ? ' / ' + entry.subcategory : '') + ' — ' + fmtMoney(entry.amount, bucket.currency) + '\nبتاريخ ' + fmtDate(entry.entry_date)
      : 'Delete this entry?\n\n' + (entry.category || '') + (entry.subcategory ? ' / ' + entry.subcategory : '') + ' — ' + fmtMoney(entry.amount, bucket.currency) + '\non ' + fmtDate(entry.entry_date);
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      var res = await deleteBucketEntry({ entryId: entry.id, userId: userId });
      if (!res.ok) {
        toast.error(res.error || (ar ? 'فشل الحذف' : 'Delete failed'));
        return;
      }
      toast.success(ar ? 'تم حذف الإدخال' : 'Entry deleted');
      onChanged();
    } catch (err) {
      toast.error((err && err.message) || String(err));
    } finally {
      setBusy(false);
    }
  }

  // Read-only mode (default)
  if (!editing) {
    return (
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        <td className="px-3 py-1.5 font-mono text-slate-700">{fmtDate(entry.entry_date)}</td>
        <td className="px-3 py-1.5 font-semibold text-slate-900">{entry.category}</td>
        <td className="px-3 py-1.5 text-slate-700">{entry.subcategory || <span className="text-slate-400">—</span>}</td>
        <td className="px-3 py-1.5 text-slate-700">{entry.description || <span className="text-slate-400">—</span>}</td>
        <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-900">{fmtMoney(entry.amount, bucket.currency)}</td>
        <td className="px-2 py-1 text-center whitespace-nowrap">
          {canEdit && !locked ? (
            <div className="flex items-center justify-center gap-1">
              <button onClick={function () { setEditing(true); }} disabled={busy}
                className="px-1.5 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-800 text-[10px] font-bold rounded disabled:opacity-50"
                title={ar ? 'تعديل هذا الإدخال' : 'Edit this entry'}>
                ✏️ {ar ? 'تعديل' : 'Edit'}
              </button>
              <button onClick={handleDelete} disabled={busy}
                className="px-1.5 py-0.5 bg-red-100 hover:bg-red-200 text-red-800 text-[10px] font-bold rounded disabled:opacity-50"
                title={ar ? 'حذف هذا الإدخال' : 'Delete this entry'}>
                🗑️
              </button>
            </div>
          ) : locked && canEdit ? (
            <span className="text-[9px] text-slate-400 italic" title={ar ? 'الدلو مقفل — لا يمكن التعديل' : 'Bucket locked — cannot edit'}>
              🔒
            </span>
          ) : null}
        </td>
      </tr>
    );
  }

  // Edit mode — every cell becomes editable
  return (
    <tr className="border-b-2 border-blue-300 bg-blue-50">
      <td className="px-2 py-1">
        <input type="date" value={editDate} onChange={function (e) { setEditDate(e.target.value); }} disabled={busy}
          className="w-full px-1.5 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900 font-mono" />
      </td>
      <td className="px-2 py-1">
        <input type="text" value={editCategory} onChange={function (e) { setEditCategory(e.target.value); setEditSubcategory(''); }}
          disabled={busy} list={'edit-cat-list-' + entry.id}
          className="w-full px-1.5 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900" />
        <datalist id={'edit-cat-list-' + entry.id}>
          {allCategories.map(function (c) { return <option key={c} value={c} />; })}
        </datalist>
      </td>
      <td className="px-2 py-1">
        <input type="text" value={editSubcategory} onChange={function (e) { setEditSubcategory(e.target.value); }}
          disabled={busy || !editCategory} list={'edit-sub-list-' + entry.id}
          className="w-full px-1.5 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900" />
        <datalist id={'edit-sub-list-' + entry.id}>
          {subcatOptions.map(function (s) { return <option key={s} value={s} />; })}
        </datalist>
      </td>
      <td className="px-2 py-1">
        <input type="text" value={editDescription} onChange={function (e) { setEditDescription(e.target.value); }} disabled={busy}
          placeholder={ar ? 'اختياري' : 'optional'}
          className="w-full px-1.5 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900" />
      </td>
      <td className="px-2 py-1 text-right">
        <input type="number" step="0.01" min="0.01" value={editAmount} onChange={function (e) { setEditAmount(e.target.value); }} disabled={busy}
          dir="ltr"
          className="w-full px-1.5 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900 text-right font-mono font-bold" />
      </td>
      <td className="px-2 py-1 text-center whitespace-nowrap">
        <div className="flex items-center justify-center gap-1">
          <button onClick={handleSave} disabled={busy}
            className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-extrabold rounded shadow disabled:opacity-50"
            title={ar ? 'حفظ التغييرات' : 'Save changes'}>
            {busy ? '...' : '✓ ' + (ar ? 'حفظ' : 'Save')}
          </button>
          <button onClick={cancelEdit} disabled={busy}
            className="px-1.5 py-0.5 bg-slate-300 hover:bg-slate-400 text-slate-900 text-[10px] font-bold rounded disabled:opacity-50"
            title={ar ? 'إلغاء التعديل' : 'Cancel edit'}>
            ✗
          </button>
        </div>
      </td>
    </tr>
  );
}
