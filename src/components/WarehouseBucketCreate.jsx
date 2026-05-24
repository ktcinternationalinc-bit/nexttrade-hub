'use client';
// v55.83-A.6.27.69 — Warehouse Bucket Create Modal (Phase 2).
//
// COMPLETELY SEPARATE from the Treasury transaction modal. Shares zero
// state, zero handlers. The treasury modal flow is untouched by this
// component. Calls createBucket() from lib/warehouse-buckets.js which
// does its own dbInsert sequence with rollback.
//
// Triggered from:
//   • Treasury tab → "+ Warehouse Advance" button (next to "+ New Transaction")
//   • Warehouse tab → "+ Create Bucket" button
// Both call setBucketModalOpen(true) and present this modal.
//
// Form fields:
//   • Recipient Name — autocomplete combobox (existing users + past recipients + free text)
//   • Reference / Purpose — free text
//   • Date — defaults to today, manually changeable
//   • Amount — required positive number
//   • Currency — EGP/USD dropdown
//   • Notes — optional textarea
//
// Auto-built reference (display-only preview): {name_slug}_{ref_slug}_{mmddyy}

import { useState, useEffect, useMemo } from 'react';
import { createBucket, buildReferenceSlug, listPastRecipients } from '../lib/warehouse-buckets';

function todayIso() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

export default function WarehouseBucketCreate(props) {
  // Props:
  //   open: boolean
  //   onClose: () => void
  //   onCreated: (bucket) => void  — called after successful create
  //   userId: current user's UUID
  //   users: array of {id, name} for the combobox
  //   toast: { success, error, warning, info }
  var open = !!props.open;
  var onClose = props.onClose || function () {};
  var onCreated = props.onCreated || function () {};
  var userId = props.userId;
  var users = props.users || [];
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  var [recipientName, setRecipientName] = useState('');
  var [showRecipientDropdown, setShowRecipientDropdown] = useState(false);
  var [reference, setReference] = useState('');
  var [issueDate, setIssueDate] = useState(todayIso());
  var [amount, setAmount] = useState('');
  var [currency, setCurrency] = useState('EGP');
  var [notes, setNotes] = useState('');
  var [busy, setBusy] = useState(false);
  var [pastRecipients, setPastRecipients] = useState([]);
  var [error, setError] = useState(null);

  // Load past recipients when the modal opens (autocomplete source)
  useEffect(function () {
    if (!open) return;
    listPastRecipients().then(setPastRecipients).catch(function (e) {
      console.warn('[bucket-create] could not load past recipients:', e);
    });
  }, [open]);

  // Reset form whenever the modal is reopened
  useEffect(function () {
    if (open) {
      setRecipientName('');
      setReference('');
      setIssueDate(todayIso());
      setAmount('');
      setCurrency('EGP');
      setNotes('');
      setBusy(false);
      setError(null);
      setShowRecipientDropdown(false);
    }
  }, [open]);

  // Combobox suggestions: users + past recipients (deduped, case-insensitive)
  var suggestions = useMemo(function () {
    var seen = {};
    var out = [];
    var typed = recipientName.trim().toLowerCase();
    // System users first
    users.forEach(function (u) {
      var name = (u && u.name) ? String(u.name).trim() : '';
      if (!name) return;
      var k = name.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      if (!typed || k.indexOf(typed) >= 0) out.push({ name: name, source: 'user' });
    });
    // Then past recipients
    pastRecipients.forEach(function (n) {
      var name = String(n || '').trim();
      if (!name) return;
      var k = name.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      if (!typed || k.indexOf(typed) >= 0) out.push({ name: name, source: 'past' });
    });
    return out.slice(0, 10);
  }, [recipientName, users, pastRecipients]);

  // Live preview of the auto-built slug
  var slugPreview = useMemo(function () {
    if (!recipientName.trim() || !reference.trim() || !issueDate) return '';
    return buildReferenceSlug(recipientName, reference, issueDate);
  }, [recipientName, reference, issueDate]);

  async function handleSave() {
    setError(null);
    // Client-side validation
    if (!recipientName.trim()) { setError('Recipient name is required.'); return; }
    if (!reference.trim()) { setError('Reference / purpose is required.'); return; }
    if (!issueDate) { setError('Issue date is required.'); return; }
    var amt = Number(amount);
    if (!amt || amt <= 0) { setError('Amount must be a positive number.'); return; }

    setBusy(true);
    try {
      var res = await createBucket({
        recipientName: recipientName.trim(),
        reference: reference.trim(),
        issueDate: issueDate,
        amount: amt,
        currency: currency,
        notes: notes.trim() || null,
        userId: userId,
      });
      if (!res.ok) {
        setError(res.error || 'Unknown error');
        setBusy(false);
        return;
      }
      toast.success('Bucket created: ' + res.bucket.reference_slug);
      onCreated(res.bucket);
      onClose();
    } catch (err) {
      setError((err && err.message) || String(err));
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[210] bg-black/70 flex items-start justify-center pt-10 px-4 overflow-y-auto"
      onClick={function () { if (!busy) onClose(); }}
    >
      <div
        className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-lg"
        onClick={function (e) { e.stopPropagation(); }}
      >
        {/* Header — amber theme makes this visually distinct from regular treasury modal */}
        <div className="bg-gradient-to-r from-amber-700 to-orange-700 text-white rounded-t-2xl px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-extrabold">🏭 New Warehouse Advance</div>
            <div className="text-[11px] text-amber-100 mt-0.5">Creates a treasury cash-out + opens a reconciliation bucket.</div>
          </div>
          <button
            onClick={function () { if (!busy) onClose(); }}
            disabled={busy}
            className="text-2xl text-white hover:text-amber-100 leading-none disabled:opacity-50"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Recipient combobox */}
          <div className="relative">
            <label className="block text-xs font-extrabold text-slate-900 mb-1">
              Recipient Name <span className="text-red-600">*</span>
              <span className="ml-1 text-[10px] font-semibold text-slate-500">(team member or warehouse worker)</span>
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={function (e) { setRecipientName(e.target.value); setShowRecipientDropdown(true); }}
              onFocus={function () { setShowRecipientDropdown(true); }}
              onBlur={function () { setTimeout(function () { setShowRecipientDropdown(false); }, 180); }}
              disabled={busy}
              placeholder="e.g. Abdelnassar Hassan"
              className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900"
              autoComplete="off"
            />
            {showRecipientDropdown && suggestions.length > 0 && (
              <div className="absolute z-10 mt-0.5 w-full bg-white border-2 border-slate-300 rounded shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map(function (s, i) {
                  return (
                    <div
                      key={s.name + '_' + i}
                      onMouseDown={function (e) {
                        e.preventDefault();
                        setRecipientName(s.name);
                        setShowRecipientDropdown(false);
                      }}
                      className="px-3 py-1.5 cursor-pointer hover:bg-amber-50 flex items-center justify-between text-sm"
                    >
                      <span className="text-slate-900">{s.name}</span>
                      <span className={'text-[10px] font-semibold ' + (s.source === 'user' ? 'text-blue-600' : 'text-slate-500')}>
                        {s.source === 'user' ? '👤 Team' : '🕘 Past'}
                      </span>
                    </div>
                  );
                })}
                <div className="px-3 py-1.5 text-[10px] text-slate-500 italic border-t border-slate-200 bg-slate-50">
                  Or just keep typing for a new recipient
                </div>
              </div>
            )}
          </div>

          {/* Reference */}
          <div>
            <label className="block text-xs font-extrabold text-slate-900 mb-1">
              Reference / Purpose <span className="text-red-600">*</span>
              <span className="ml-1 text-[10px] font-semibold text-slate-500">(e.g. "america 101", "container ABC-7821")</span>
            </label>
            <input
              type="text"
              value={reference}
              onChange={function (e) { setReference(e.target.value); }}
              disabled={busy}
              placeholder="e.g. america 101"
              className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900"
              autoComplete="off"
            />
          </div>

          {/* Date + Amount + Currency row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-extrabold text-slate-900 mb-1">Date <span className="text-red-600">*</span></label>
              <input
                type="date"
                value={issueDate}
                onChange={function (e) { setIssueDate(e.target.value); }}
                disabled={busy}
                className="w-full px-2 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-900 mb-1">Amount <span className="text-red-600">*</span></label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={function (e) { setAmount(e.target.value); }}
                disabled={busy}
                placeholder="5000.00"
                className="w-full px-2 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 text-right font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-900 mb-1">Currency <span className="text-red-600">*</span></label>
              <select
                value={currency}
                onChange={function (e) { setCurrency(e.target.value); }}
                disabled={busy}
                className="w-full px-2 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold"
              >
                <option value="EGP">EGP</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          {/* Auto-slug preview */}
          {slugPreview && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-amber-900 uppercase tracking-wider mb-0.5">Auto-Generated Reference</div>
              <div className="font-mono text-sm font-bold text-amber-900">{slugPreview}</div>
              <div className="text-[10px] text-amber-700 mt-0.5">This identifier appears in Treasury, the bucket card, and audit logs.</div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-extrabold text-slate-900 mb-1">
              Notes <span className="text-[10px] font-semibold text-slate-500">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={function (e) { setNotes(e.target.value); }}
              disabled={busy}
              rows={2}
              placeholder="Any context for the recipient or accountant..."
              className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900"
            />
          </div>

          {/* What happens explainer */}
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-[11px] text-slate-700">
            <div className="font-extrabold text-slate-900 mb-1">What happens when I save?</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Treasury gets a <span className="font-bold">{currency} cash-out</span> tagged "Warehouse Bucket"</li>
              <li>A bucket card appears in the Warehouse tab for the accountant to log spending against</li>
              <li>Once spending fully accounts for the amount, the bucket can be submitted for approval and reconciled into proper expense categories</li>
              <li><span className="font-extrabold text-slate-900">The original cash-out NEVER changes — only how it's categorized in Expense Reports does.</span></li>
            </ul>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border-2 border-red-400 rounded p-2 text-sm text-red-900 font-semibold">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button
            onClick={function () { if (!busy) onClose(); }}
            disabled={busy}
            className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !recipientName.trim() || !reference.trim() || !issueDate || !Number(amount)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Creating...' : '🏭 Create Bucket'}
          </button>
        </div>
      </div>
    </div>
  );
}
