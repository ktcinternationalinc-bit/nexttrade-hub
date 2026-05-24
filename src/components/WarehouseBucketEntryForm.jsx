'use client';
// v55.83-A.6.27.70 — Warehouse Bucket spend-entry form + overspend modal.
//
// Mounted inside WarehouseBucketList's detail view when the bucket is in
// 'open' or 'fully_spent' state. Submits an entry against the bucket via
// addBucketEntry() from lib/warehouse-buckets.js, which enforces the
// OVERSPEND HARD BLOCK by returning {ok:false, overspend:{...}} instead of
// inserting when the entry would push total over.
//
// On overspend, we show a 3-option modal:
//   • Split — automatically populates two sub-entries: one filling the
//     remainder of this bucket, one for the difference on a different bucket
//     (user picks from their other open buckets OR creates new one inline)
//   • Reduce This Entry — clamps the amount to the remaining bucket capacity
//   • Cancel — bails out, returns to the form

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { addBucketEntry, listBuckets, createBucket } from '../lib/warehouse-buckets';

function todayIso() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function fmtMoney(n, cur) {
  if (n == null || isNaN(Number(n))) return '0.00 ' + (cur || '');
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || '');
}

export default function WarehouseBucketEntryForm(props) {
  // Props:
  //   bucket: the bucket object (with id, recipient_name, amount, currency, etc.)
  //   spent: current spent total (sum of existing entries)
  //   onCreated: () => void  - called after successful entry create
  //   userId, isSuperAdmin
  //   canManageCategories: bool — controls whether "+ Add new subcategory" appears
  //   toast: { success, error }
  var bucket = props.bucket || {};
  var spent = Number(props.spent || 0);
  var onCreated = props.onCreated || function () {};
  var userId = props.userId;
  var canManageCategories = !!props.canManageCategories;
  var toast = props.toast || { success: function(){}, error: function(){} };

  var remaining = Number(bucket.amount || 0) - spent;

  var [entryDate, setEntryDate] = useState(todayIso());
  var [amount, setAmount] = useState('');
  var [category, setCategory] = useState('');
  var [subcategory, setSubcategory] = useState('');
  var [description, setDescription] = useState('');
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState(null);

  // Category options loaded from treasury (distinct categories used to date)
  var [allCategories, setAllCategories] = useState([]);
  var [allSubcategories, setAllSubcategories] = useState([]);
  // Pop-up state for adding a brand-new subcategory inline
  var [addingNewSubcat, setAddingNewSubcat] = useState(false);
  var [newSubcatText, setNewSubcatText] = useState('');

  // Overspend modal state
  var [overspendInfo, setOverspendInfo] = useState(null);
  // Split flow state — populated when user clicks "Split"
  var [splitDestBucketId, setSplitDestBucketId] = useState('');
  var [otherOpenBuckets, setOtherOpenBuckets] = useState([]);
  var [splitNewBucketMode, setSplitNewBucketMode] = useState(false);
  var [splitNewBucketName, setSplitNewBucketName] = useState('');
  var [splitNewBucketRef, setSplitNewBucketRef] = useState('');
  var [splitBusy, setSplitBusy] = useState(false);

  // Load category/subcategory options on mount
  useEffect(function () {
    var cancelled = false;
    (async function () {
      try {
        // Pull distinct categories + subcategories from treasury (use as suggestion list)
        var res = await supabase.from('treasury').select('category, subcategory').limit(2000);
        if (cancelled || res.error) return;
        var cats = {};
        var subs = {};
        (res.data || []).forEach(function (r) {
          if (r.category && r.category !== 'Warehouse Bucket' && r.category !== 'Warehouse Bucket Refund') {
            cats[r.category] = true;
            if (r.subcategory) {
              var k = r.category + '||' + r.subcategory;
              subs[k] = true;
            }
          }
        });
        setAllCategories(Object.keys(cats).sort());
        setAllSubcategories(Object.keys(subs).sort());
      } catch (e) {
        console.warn('[bucket-entry-form] category load failed:', e);
      }
    })();
    return function () { cancelled = true; };
  }, []);

  // Filter subcategories by selected category
  var subcatOptions = useMemo(function () {
    if (!category) return [];
    var prefix = category + '||';
    return allSubcategories
      .filter(function (k) { return k.indexOf(prefix) === 0; })
      .map(function (k) { return k.substring(prefix.length); });
  }, [category, allSubcategories]);

  function resetForm() {
    setEntryDate(todayIso());
    setAmount('');
    setCategory('');
    setSubcategory('');
    setDescription('');
    setError(null);
    setAddingNewSubcat(false);
    setNewSubcatText('');
  }

  async function handleSave() {
    setError(null);
    var amt = Number(amount);
    if (!amt || amt <= 0) { setError('Amount must be positive.'); return; }
    if (!category.trim()) { setError('Category is required.'); return; }
    if (!entryDate) { setError('Date is required.'); return; }

    // If user is adding a new subcategory inline, use the new text as the value
    var finalSubcat = addingNewSubcat ? newSubcatText.trim() : subcategory.trim();

    setBusy(true);
    try {
      var res = await addBucketEntry({
        bucketId: bucket.id,
        entryDate: entryDate,
        amount: amt,
        category: category.trim(),
        subcategory: finalSubcat || null,
        description: description.trim() || null,
        userId: userId,
      });
      if (res.overspend) {
        // OVERSPEND HARD BLOCK — show resolution modal instead of saving
        setOverspendInfo(res.overspend);
        // Pre-load other open buckets for the same recipient (split destination options)
        var open = await listBuckets({ status: 'open' });
        var others = (open || []).filter(function (b) {
          return b.id !== bucket.id && b.currency === bucket.currency;
        });
        setOtherOpenBuckets(others);
        setSplitDestBucketId('');
        setSplitNewBucketMode(false);
        setSplitNewBucketName(bucket.recipient_name || '');
        setSplitNewBucketRef('');
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(res.error || 'Unknown error');
        setBusy(false);
        return;
      }
      toast.success('Entry added: ' + fmtMoney(amt, bucket.currency));
      resetForm();
      onCreated();
    } catch (err) {
      setError((err && err.message) || String(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Overspend resolution: Reduce ───
  async function handleReduce() {
    if (!overspendInfo) return;
    var newAmount = overspendInfo.remaining;
    if (newAmount <= 0) {
      setError('Bucket has no remaining capacity. Use Split or Cancel instead.');
      setOverspendInfo(null);
      return;
    }
    setBusy(true);
    try {
      var res = await addBucketEntry({
        bucketId: bucket.id,
        entryDate: entryDate,
        amount: newAmount,
        category: category.trim(),
        subcategory: addingNewSubcat ? newSubcatText.trim() : subcategory.trim() || null,
        description: description.trim() || null,
        userId: userId,
      });
      if (!res.ok) {
        setError(res.error || 'Reduce failed');
        setOverspendInfo(null);
        setBusy(false);
        return;
      }
      toast.success('Entry added (reduced to ' + fmtMoney(newAmount, bucket.currency) + ')');
      setOverspendInfo(null);
      resetForm();
      onCreated();
    } catch (err) {
      setError((err && err.message) || String(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Overspend resolution: Split ───
  // First leg: fills remaining on THIS bucket.
  // Second leg: overage goes to splitDestBucketId (or to a freshly-created bucket).
  async function handleSplit() {
    if (!overspendInfo) return;
    setSplitBusy(true);
    setError(null);
    try {
      var firstLegAmount = overspendInfo.remaining;
      var secondLegAmount = overspendInfo.byAmount;
      if (firstLegAmount <= 0) {
        setError('No remaining capacity on this bucket — pick "Cancel" and create a new bucket directly.');
        setSplitBusy(false);
        return;
      }
      // Resolve destination bucket id
      var destBucketId = splitDestBucketId;
      if (splitNewBucketMode) {
        if (!splitNewBucketName.trim() || !splitNewBucketRef.trim()) {
          setError('Provide name + reference for the new bucket.');
          setSplitBusy(false);
          return;
        }
        // Create new bucket to absorb the overage
        var newBucketRes = await createBucket({
          recipientName: splitNewBucketName.trim(),
          reference: splitNewBucketRef.trim(),
          issueDate: todayIso(),
          amount: secondLegAmount,  // exactly the overage amount
          currency: bucket.currency,
          notes: 'Auto-created from split overspend of ' + (bucket.reference_slug || bucket.id),
          userId: userId,
        });
        if (!newBucketRes.ok) {
          setError('Could not create destination bucket: ' + newBucketRes.error);
          setSplitBusy(false);
          return;
        }
        destBucketId = newBucketRes.bucket.id;
      }
      if (!destBucketId) {
        setError('Pick a destination bucket OR check "Create new bucket" to absorb the overage.');
        setSplitBusy(false);
        return;
      }

      // First leg — fill this bucket
      var firstLegRes = await addBucketEntry({
        bucketId: bucket.id,
        entryDate: entryDate,
        amount: firstLegAmount,
        category: category.trim(),
        subcategory: addingNewSubcat ? newSubcatText.trim() : subcategory.trim() || null,
        description: (description.trim() || category.trim()) + ' (split 1 of 2)',
        userId: userId,
        isSplitPart: true,
      });
      if (!firstLegRes.ok) {
        setError('First leg failed: ' + firstLegRes.error);
        setSplitBusy(false);
        return;
      }

      // Second leg — overage on destination
      var secondLegRes = await addBucketEntry({
        bucketId: destBucketId,
        entryDate: entryDate,
        amount: secondLegAmount,
        category: category.trim(),
        subcategory: addingNewSubcat ? newSubcatText.trim() : subcategory.trim() || null,
        description: (description.trim() || category.trim()) + ' (split 2 of 2)',
        userId: userId,
        isSplitPart: true,
        splitPairId: firstLegRes.entry && firstLegRes.entry.id,
      });
      if (!secondLegRes.ok) {
        // Best-effort: delete the first leg (rollback). If that fails, surface a clear warning.
        try {
          await supabase.from('warehouse_bucket_entries').delete().eq('id', firstLegRes.entry.id);
          setError('Second leg failed (' + secondLegRes.error + '). First leg was rolled back; please retry.');
        } catch (rb) {
          setError('Second leg failed AND rollback failed. The first leg amount ' + fmtMoney(firstLegAmount, bucket.currency) + ' is sitting in this bucket — delete it manually before retrying. Error: ' + secondLegRes.error);
        }
        setSplitBusy(false);
        return;
      }

      toast.success('Split saved: ' + fmtMoney(firstLegAmount, bucket.currency) + ' here + ' + fmtMoney(secondLegAmount, bucket.currency) + ' on the other bucket.');
      setOverspendInfo(null);
      resetForm();
      onCreated();
    } catch (err) {
      setError((err && err.message) || String(err));
    } finally {
      setSplitBusy(false);
    }
  }

  // ─── Render: locked-out states ───
  if (bucket.status === 'closed' || bucket.status === 'cancelled') {
    return (
      <div className="bg-slate-50 border-2 border-slate-200 rounded p-3 text-sm text-slate-600">
        This bucket is {bucket.status} — entries cannot be added or edited.
      </div>
    );
  }
  if (bucket.status === 'pending_approval') {
    return (
      <div className="bg-amber-50 border-2 border-amber-300 rounded p-3 text-sm text-amber-900">
        ⏳ Awaiting approval — entries are locked until the bucket is approved or reopened.
      </div>
    );
  }

  // ─── Render: form ───
  return (
    <>
      <div className="bg-white rounded-lg border-2 border-amber-300 p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-extrabold text-slate-900">+ Add Spend Entry</h4>
          <span className="text-[11px] text-slate-600">Remaining: <strong className={remaining < 0 ? 'text-red-700' : remaining === 0 ? 'text-emerald-700' : 'text-slate-900'}>{fmtMoney(remaining, bucket.currency)}</strong></span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {/* Date */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-extrabold text-slate-700 mb-0.5">Date</label>
            <input type="date" value={entryDate} onChange={function (e) { setEntryDate(e.target.value); }} disabled={busy}
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900" />
          </div>
          {/* Amount */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-extrabold text-slate-700 mb-0.5">Amount {bucket.currency}</label>
            <input type="number" step="0.01" min="0.01" value={amount} onChange={function (e) { setAmount(e.target.value); }} disabled={busy}
              placeholder="0.00"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900 text-right font-mono" />
          </div>
          {/* Category */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-extrabold text-slate-700 mb-0.5">Category</label>
            <input type="text" value={category}
              onChange={function (e) { setCategory(e.target.value); setSubcategory(''); setAddingNewSubcat(false); }}
              disabled={busy}
              list="bucket-category-list"
              placeholder="e.g. Logistics"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900" />
            <datalist id="bucket-category-list">
              {allCategories.map(function (c) { return <option key={c} value={c} />; })}
            </datalist>
          </div>
          {/* Subcategory */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-extrabold text-slate-700 mb-0.5">Subcategory</label>
            {!addingNewSubcat ? (
              <div className="flex gap-1">
                <select value={subcategory} onChange={function (e) {
                  if (e.target.value === '__add_new__') {
                    setAddingNewSubcat(true);
                    setNewSubcatText('');
                  } else {
                    setSubcategory(e.target.value);
                  }
                }} disabled={busy || !category}
                  className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900">
                  <option value="">— pick one —</option>
                  {subcatOptions.map(function (s) { return <option key={s} value={s}>{s}</option>; })}
                  {canManageCategories && category && (
                    <option value="__add_new__">+ Add new subcategory…</option>
                  )}
                </select>
              </div>
            ) : (
              <div className="flex gap-1">
                <input type="text" value={newSubcatText} onChange={function (e) { setNewSubcatText(e.target.value); }}
                  disabled={busy} placeholder="New subcategory"
                  className="flex-1 px-2 py-1.5 border-2 border-emerald-300 rounded text-sm bg-emerald-50 text-slate-900" autoFocus />
                <button type="button" onClick={function () { setAddingNewSubcat(false); setNewSubcatText(''); }} disabled={busy}
                  className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold rounded">×</button>
              </div>
            )}
          </div>
          {/* Description */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-extrabold text-slate-700 mb-0.5">Description</label>
            <input type="text" value={description} onChange={function (e) { setDescription(e.target.value); }} disabled={busy}
              placeholder="optional"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900" />
          </div>
        </div>
        {error && (
          <div className="mt-2 bg-red-50 border border-red-300 rounded p-2 text-sm text-red-900 font-semibold">⚠️ {error}</div>
        )}
        <div className="mt-2 flex justify-end">
          <button onClick={handleSave} disabled={busy || !amount || !category}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? 'Adding...' : '+ Add Entry'}
          </button>
        </div>
      </div>

      {/* ─── OVERSPEND RESOLUTION MODAL ─── */}
      {overspendInfo && (
        <div className="fixed inset-0 z-[220] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!splitBusy) setOverspendInfo(null); }}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-lg" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-gradient-to-r from-red-700 to-orange-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">⚠️ Overspend Detected</div>
              <div className="text-[11px] text-red-100 mt-0.5">This entry would push the bucket over its limit.</div>
            </div>
            <div className="p-5 space-y-3">
              {/* Overspend summary */}
              <div className="bg-slate-50 border border-slate-200 rounded p-3 grid grid-cols-2 gap-2 text-xs">
                <div className="col-span-2 font-extrabold text-slate-900 text-sm pb-1 border-b border-slate-200">{bucket.reference_slug}</div>
                <div>Bucket total:</div>
                <div className="text-right font-mono font-bold">{fmtMoney(overspendInfo.bucketAmount, bucket.currency)}</div>
                <div>Already spent:</div>
                <div className="text-right font-mono">{fmtMoney(overspendInfo.spent, bucket.currency)}</div>
                <div className="text-emerald-700">Remaining:</div>
                <div className="text-right font-mono font-bold text-emerald-700">{fmtMoney(overspendInfo.remaining, bucket.currency)}</div>
                <div>This entry:</div>
                <div className="text-right font-mono">{fmtMoney(overspendInfo.attemptAmount, bucket.currency)}</div>
                <div className="text-red-700 font-extrabold">Over by:</div>
                <div className="text-right font-mono font-extrabold text-red-700">{fmtMoney(overspendInfo.byAmount, bucket.currency)}</div>
              </div>

              {/* Resolution options */}
              <div className="space-y-2">
                {/* Option A — Reduce */}
                <button type="button" onClick={handleReduce} disabled={splitBusy}
                  className="w-full text-left bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 rounded p-3 disabled:opacity-50">
                  <div className="font-extrabold text-amber-900 text-sm">↓ Reduce This Entry</div>
                  <div className="text-[11px] text-amber-800 mt-0.5">Clamp this entry to {fmtMoney(overspendInfo.remaining, bucket.currency)} (fills the remaining capacity exactly).</div>
                </button>

                {/* Option B — Split */}
                <div className="bg-blue-50 border-2 border-blue-300 rounded p-3">
                  <div className="font-extrabold text-blue-900 text-sm mb-1">⇄ Split Entry</div>
                  <div className="text-[11px] text-blue-800 mb-2">
                    Save {fmtMoney(overspendInfo.remaining, bucket.currency)} here, push {fmtMoney(overspendInfo.byAmount, bucket.currency)} to another bucket.
                  </div>
                  {!splitNewBucketMode ? (
                    <>
                      <label className="block text-[10px] font-extrabold text-blue-900 mb-0.5">Destination bucket (same currency, open status):</label>
                      <select value={splitDestBucketId} onChange={function (e) { setSplitDestBucketId(e.target.value); }} disabled={splitBusy}
                        className="w-full px-2 py-1.5 border border-blue-300 rounded text-sm bg-white text-slate-900">
                        <option value="">— pick a bucket —</option>
                        {otherOpenBuckets.map(function (b) {
                          return <option key={b.id} value={b.id}>{b.recipient_name} · {b.reference_slug} ({fmtMoney(b.amount, b.currency)})</option>;
                        })}
                      </select>
                      <button type="button" onClick={function () { setSplitNewBucketMode(true); setSplitDestBucketId(''); }} disabled={splitBusy}
                        className="mt-2 text-[11px] font-bold text-blue-700 hover:text-blue-900 underline">
                        + Or create a new bucket to absorb the overage
                      </button>
                    </>
                  ) : (
                    <div className="bg-white border-2 border-emerald-300 rounded p-2 space-y-1.5">
                      <div className="text-[10px] font-extrabold text-emerald-900">Create new bucket for the overage ({fmtMoney(overspendInfo.byAmount, bucket.currency)}):</div>
                      <input type="text" value={splitNewBucketName} onChange={function (e) { setSplitNewBucketName(e.target.value); }} disabled={splitBusy}
                        placeholder="Recipient name"
                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900" />
                      <input type="text" value={splitNewBucketRef} onChange={function (e) { setSplitNewBucketRef(e.target.value); }} disabled={splitBusy}
                        placeholder={'Reference (e.g. continued from ' + (bucket.reference || '') + ')'}
                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900" />
                      <button type="button" onClick={function () { setSplitNewBucketMode(false); setSplitNewBucketName(bucket.recipient_name || ''); setSplitNewBucketRef(''); }} disabled={splitBusy}
                        className="text-[11px] font-bold text-slate-700 hover:text-slate-900 underline">
                        ← Use existing bucket instead
                      </button>
                    </div>
                  )}
                  <button type="button" onClick={handleSplit} disabled={splitBusy || (!splitDestBucketId && !splitNewBucketMode)}
                    className="mt-2 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
                    {splitBusy ? 'Splitting…' : '⇄ Save Split'}
                  </button>
                </div>

                {/* Option C — Cancel */}
                <button type="button" onClick={function () { if (!splitBusy) setOverspendInfo(null); }} disabled={splitBusy}
                  className="w-full bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 rounded p-2 disabled:opacity-50">
                  <div className="font-extrabold text-slate-800 text-sm">✗ Cancel — Go Back</div>
                  <div className="text-[11px] text-slate-600">Return to the form. No entry is saved.</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
