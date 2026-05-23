'use client';
// v55.83-A.6.27.62 — Warehouse Advances tab.
//
// WHAT IT DOES:
//   • Issue cash advances to people who'll spend on your behalf
//     (warehouse manager, driver, broker, etc.)
//   • Each advance auto-creates a DEBIT in treasury
//   • Warehouse expenses can be tagged to an advance (advance_id)
//   • Running balance for each advance: issued - sum(spent) = remaining
//   • Close an advance manually when reconciled
//
// USAGE:
//   <WarehouseAdvancesTab toast={toast} userProfile={userProfile} canEdit={canEdit} />

import { useState, useEffect, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

function fmtMoney(n, cur) {
  if (n == null || isNaN(Number(n))) return '0.00';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
}
function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s).toISOString().substring(0, 10); } catch (e) { return s; }
}

export default function WarehouseAdvancesTab(props) {
  var toast = props.toast || { success: function(){}, error: function(){}, info: function(){} };
  var userProfile = props.userProfile || null;
  var canEdit = props.canEdit !== false;
  var isSuperAdmin = userProfile && userProfile.role === 'super_admin';

  var [advances, setAdvances] = useState([]);
  var [expenses, setExpenses] = useState([]); // warehouse_expenses with advance_id
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [busy, setBusy] = useState(false);

  // Modal state
  var [issueModalOpen, setIssueModalOpen] = useState(false);
  var [issueDraft, setIssueDraft] = useState(null);
  // shape: { issue_date, amount, currency, recipient_name, recipient_role, description, reference_number }

  var [detailAdvance, setDetailAdvance] = useState(null); // when set, opens detail drawer

  var [closeModal, setCloseModal] = useState(null); // { advance, reason }

  var [filterStatus, setFilterStatus] = useState('open'); // 'all' | 'open' | 'closed'

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var [advRes, expRes] = await Promise.all([
          supabase.from('warehouse_advances').select('*').order('issue_date', { ascending: false }),
          supabase.from('warehouse_expenses').select('id, expense_date, description, amount, category, subcategory, advance_id').not('advance_id', 'is', null),
        ]);
        if (cancelled) return;
        if (advRes.error) {
          var msg = (advRes.error && advRes.error.message) || String(advRes.error);
          if (/relation.*warehouse_advances.*does not exist/i.test(msg)) {
            setError('Warehouse Advances not set up yet. Run SQL migration v55.83-A.6.27.62 in Supabase.');
          } else {
            setError(msg);
          }
          setAdvances([]);
        } else {
          setAdvances(advRes.data || []);
        }
        if (expRes && !expRes.error) setExpenses(expRes.data || []);
      } catch (e) {
        if (!cancelled) {
          console.error('[advances] load failed:', e);
          setError((e && e.message) || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, []);

  async function reload() {
    try {
      var [advRes, expRes] = await Promise.all([
        supabase.from('warehouse_advances').select('*').order('issue_date', { ascending: false }),
        supabase.from('warehouse_expenses').select('id, expense_date, description, amount, category, subcategory, advance_id').not('advance_id', 'is', null),
      ]);
      if (advRes && !advRes.error) setAdvances(advRes.data || []);
      if (expRes && !expRes.error) setExpenses(expRes.data || []);
    } catch (e) { console.error('[advances] reload failed:', e); }
  }

  // Compute spent + remaining for each advance from the expenses list
  var summary = useMemo(function () {
    var spentMap = {}; // advance_id → sum
    var countMap = {}; // advance_id → count
    expenses.forEach(function (e) {
      if (!e.advance_id) return;
      spentMap[e.advance_id] = (spentMap[e.advance_id] || 0) + Number(e.amount || 0);
      countMap[e.advance_id] = (countMap[e.advance_id] || 0) + 1;
    });
    return advances.map(function (a) {
      var issued = Number(a.amount || 0);
      var spent = spentMap[a.id] || 0;
      var remaining = issued - spent;
      return Object.assign({}, a, {
        spent_amount: spent,
        remaining_amount: remaining,
        expense_count: countMap[a.id] || 0,
        percent_spent: issued > 0 ? Math.min(100, (spent / issued) * 100) : 0,
      });
    });
  }, [advances, expenses]);

  var filteredSummary = useMemo(function () {
    if (filterStatus === 'all') return summary;
    return summary.filter(function (a) { return a.status === filterStatus; });
  }, [summary, filterStatus]);

  var grandTotals = useMemo(function () {
    var byCurrency = {};
    summary.forEach(function (a) {
      var cur = a.currency || 'EGP';
      if (!byCurrency[cur]) byCurrency[cur] = { issued: 0, spent: 0, remaining: 0, count: 0 };
      byCurrency[cur].issued += Number(a.amount || 0);
      byCurrency[cur].spent += a.spent_amount;
      byCurrency[cur].remaining += a.remaining_amount;
      byCurrency[cur].count++;
    });
    return byCurrency;
  }, [summary]);

  function openIssueModal() {
    if (!canEdit) return;
    setIssueDraft({
      issue_date: new Date().toISOString().substring(0, 10),
      amount: '',
      currency: 'EGP',
      recipient_name: '',
      recipient_role: '',
      description: '',
      reference_number: '',
    });
    setIssueModalOpen(true);
  }

  async function saveIssue() {
    if (!issueDraft) return;
    var amt = Number(issueDraft.amount);
    if (!amt || amt <= 0) { alert('Amount must be a positive number'); return; }
    if (!issueDraft.recipient_name || !issueDraft.recipient_name.trim()) {
      alert('Recipient name required (who is getting this advance?)');
      return;
    }
    if (!issueDraft.issue_date) { alert('Issue date required'); return; }
    var cur = String(issueDraft.currency || 'EGP').toUpperCase().trim();
    if (cur.length < 2) { alert('Currency required'); return; }

    setBusy(true);
    try {
      var nowUserId = userProfile && userProfile.id;

      // 1. Create the treasury debit first
      var treasuryPayload = {
        transaction_date: issueDraft.issue_date,
        description: 'Advance to ' + issueDraft.recipient_name.trim() +
          (issueDraft.recipient_role ? ' (' + issueDraft.recipient_role.trim() + ')' : '') +
          ' — ' + fmtDate(issueDraft.issue_date),
        cash_in: null,
        cash_out: cur === 'EGP' ? amt : null,
        usd_in: null,
        usd_out: cur === 'USD' ? amt : null,
        currency: cur,
        category: 'Warehouse Advance',
        subcategory: issueDraft.recipient_role || 'Advance',
        source: 'warehouse_advance',
        created_by: nowUserId,
      };
      var treasuryRes = await supabase.from('treasury').insert(treasuryPayload).select().single();
      if (treasuryRes.error) {
        console.warn('[advances] treasury insert failed (advance still created):', treasuryRes.error.message);
      }
      var treasuryId = treasuryRes.data && treasuryRes.data.id;

      // 2. Create the advance row
      var advPayload = {
        issue_date: issueDraft.issue_date,
        amount: amt,
        currency: cur,
        recipient_name: issueDraft.recipient_name.trim(),
        recipient_role: (issueDraft.recipient_role || '').trim() || null,
        description: (issueDraft.description || '').trim() || null,
        reference_number: (issueDraft.reference_number || '').trim() || null,
        linked_treasury_id: treasuryId || null,
        status: 'open',
        created_by: nowUserId,
      };
      var advRes = await supabase.from('warehouse_advances').insert(advPayload).select().single();
      if (advRes.error) throw advRes.error;

      toast.success('Advance issued: ' + fmtMoney(amt, cur) + ' to ' + issueDraft.recipient_name);
      setIssueModalOpen(false);
      setIssueDraft(null);
      await reload();
    } catch (e) {
      console.error('[advances] saveIssue failed:', e);
      var em = (e && e.message) || String(e);
      var hint = '';
      if (/relation.*warehouse_advances.*does not exist/i.test(em)) {
        hint = '\n\nRun SQL migration v55.83-A.6.27.62 in Supabase first.';
      }
      alert('Failed to issue advance: ' + em + hint);
    } finally {
      setBusy(false);
    }
  }

  async function closeAdvance() {
    if (!closeModal || !closeModal.advance) return;
    setBusy(true);
    try {
      var nowUserId = userProfile && userProfile.id;
      var updRes = await supabase.from('warehouse_advances').update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: nowUserId,
        close_reason: (closeModal.reason || '').trim() || null,
      }).eq('id', closeModal.advance.id);
      if (updRes.error) throw updRes.error;
      toast.success('Advance closed');
      setCloseModal(null);
      await reload();
    } catch (e) {
      console.error('[advances] closeAdvance failed:', e);
      alert('Failed to close: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function reopenAdvance(adv) {
    if (!adv) return;
    if (!confirm('Reopen this closed advance? Status returns to open.')) return;
    setBusy(true);
    try {
      var updRes = await supabase.from('warehouse_advances').update({
        status: 'open',
        closed_at: null,
        closed_by: null,
        close_reason: null,
      }).eq('id', adv.id);
      if (updRes.error) throw updRes.error;
      toast.success('Advance reopened');
      await reload();
    } catch (e) {
      console.error('[advances] reopenAdvance failed:', e);
      alert('Failed to reopen: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAdvance(adv) {
    if (!adv) return;
    if (!isSuperAdmin) { alert('Only super admin can delete advances.'); return; }
    var expCount = expenses.filter(function (e) { return e.advance_id === adv.id; }).length;
    var msg = 'Permanently DELETE this advance?\n\n' +
      adv.recipient_name + ' — ' + fmtMoney(adv.amount, adv.currency) + ' on ' + fmtDate(adv.issue_date) + '\n\n';
    if (expCount > 0) {
      msg += 'WARNING: ' + expCount + ' warehouse expense(s) are linked to this advance. They will be UNLINKED (advance_id set to NULL) but kept.\n\n';
    }
    msg += 'The linked treasury entry will NOT be deleted automatically — you must remove it manually if desired.\n\nThis cannot be undone.';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      // FK is ON DELETE SET NULL, so expenses keep their data, just lose the link
      var delRes = await supabase.from('warehouse_advances').delete().eq('id', adv.id);
      if (delRes.error) throw delRes.error;
      toast.success('Advance deleted');
      await reload();
    } catch (e) {
      console.error('[advances] deleteAdvance failed:', e);
      alert('Delete failed: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-center text-slate-600 font-semibold">Loading warehouse advances...</div>;
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
      <div className="bg-gradient-to-r from-amber-700 via-orange-600 to-red-600 text-white rounded-lg p-4">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-extrabold">💵 Warehouse Advances / السلف</h2>
            <div className="text-xs font-semibold text-orange-100 mt-1">
              Issue cash advances · track spending · auto-debit treasury
            </div>
          </div>
          {canEdit && (
            <button
              onClick={openIssueModal}
              className="px-4 py-2 bg-white text-orange-700 text-sm font-extrabold rounded shadow hover:bg-orange-50"
            >+ Issue Advance / إصدار سلفة</button>
          )}
        </div>
      </div>

      {/* Grand totals tiles per currency */}
      {Object.keys(grandTotals).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {Object.keys(grandTotals).map(function (cur) {
            var t = grandTotals[cur];
            return (
              <div key={cur} className="bg-white border-2 border-slate-200 rounded-lg p-3">
                <div className="text-[10px] font-extrabold text-slate-700 tracking-wider mb-1">{cur} · {t.count} ADVANCES</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[9px] text-slate-600 font-bold">Issued</div>
                    <div className="text-sm font-mono font-extrabold text-slate-900">{fmtMoney(t.issued, cur)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-600 font-bold">Spent</div>
                    <div className="text-sm font-mono font-extrabold text-red-700">{fmtMoney(t.spent, cur)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-600 font-bold">Remaining</div>
                    <div className={'text-sm font-mono font-extrabold ' + (t.remaining > 0 ? 'text-emerald-700' : 'text-slate-500')}>
                      {fmtMoney(t.remaining, cur)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter pills */}
      <div className="flex gap-2 items-center">
        <span className="text-xs font-extrabold text-slate-700">Show:</span>
        {['open', 'closed', 'all'].map(function (s) {
          return (
            <button
              key={s}
              onClick={function () { setFilterStatus(s); }}
              className={'px-3 py-1 text-xs font-extrabold rounded ' +
                (filterStatus === s ? 'bg-orange-600 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300')}
            >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
          );
        })}
      </div>

      {/* Advances list */}
      {filteredSummary.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-8 text-center text-slate-600 italic">
          No {filterStatus !== 'all' ? filterStatus + ' ' : ''}advances yet.
          {canEdit && filterStatus !== 'closed' && ' Click "+ Issue Advance" to create the first one.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSummary.map(function (a) {
            var isClosed = a.status === 'closed';
            return (
              <div
                key={a.id}
                className={'bg-white border-2 rounded-lg p-3 ' + (isClosed ? 'border-slate-300 opacity-75' : 'border-orange-200')}
              >
                <div className="flex justify-between items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-extrabold text-slate-900">
                        {a.recipient_name}
                        {a.recipient_role && <span className="text-xs text-slate-600 font-semibold"> · {a.recipient_role}</span>}
                      </div>
                      {isClosed && <span className="text-[10px] bg-slate-700 text-white font-bold rounded px-2 py-0.5">CLOSED</span>}
                      {!isClosed && a.remaining_amount <= 0 && <span className="text-[10px] bg-red-700 text-white font-bold rounded px-2 py-0.5">FULLY SPENT</span>}
                    </div>
                    <div className="text-[11px] text-slate-700 mt-0.5">
                      Issued {fmtDate(a.issue_date)}
                      {a.description && <span className="italic"> · {a.description}</span>}
                      {a.reference_number && <span className="font-mono"> · ref {a.reference_number}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-mono font-extrabold text-slate-900">{fmtMoney(a.amount, a.currency)}</div>
                    <div className="text-[10px] text-slate-600">Issued</div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2 bg-slate-200 rounded h-2 overflow-hidden">
                  <div
                    className={'h-full transition-all ' + (a.percent_spent >= 100 ? 'bg-red-600' : a.percent_spent > 75 ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: Math.min(100, a.percent_spent) + '%' }}
                  ></div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="bg-red-50 border border-red-200 rounded px-2 py-1">
                    <div className="text-[9px] text-red-900 font-bold uppercase tracking-wider">Spent</div>
                    <div className="font-mono font-extrabold text-red-900">{fmtMoney(a.spent_amount, a.currency)}</div>
                    <div className="text-[9px] text-red-800">{a.expense_count} expense{a.expense_count === 1 ? '' : 's'}</div>
                  </div>
                  <div className={'border rounded px-2 py-1 ' + (a.remaining_amount > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-100 border-slate-200')}>
                    <div className="text-[9px] text-emerald-900 font-bold uppercase tracking-wider">Remaining</div>
                    <div className={'font-mono font-extrabold ' + (a.remaining_amount > 0 ? 'text-emerald-900' : 'text-slate-600')}>
                      {fmtMoney(a.remaining_amount, a.currency)}
                    </div>
                    <div className="text-[9px] text-emerald-800">{Math.round(a.percent_spent)}% spent</div>
                  </div>
                  <div className="flex flex-col gap-1 justify-center">
                    <button
                      onClick={function () { setDetailAdvance(a); }}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold rounded"
                    >View Expenses</button>
                    {canEdit && !isClosed && (
                      <button
                        onClick={function () { setCloseModal({ advance: a, reason: '' }); }}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-800 text-white text-[10px] font-extrabold rounded"
                      >Close</button>
                    )}
                    {canEdit && isClosed && (
                      <button
                        onClick={function () { reopenAdvance(a); }}
                        className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-extrabold rounded"
                      >Reopen</button>
                    )}
                    {isSuperAdmin && (
                      <button
                        onClick={function () { deleteAdvance(a); }}
                        className="px-2 py-1 bg-red-700 hover:bg-red-800 text-white text-[10px] font-extrabold rounded"
                      >🗑 Delete</button>
                    )}
                  </div>
                </div>

                {a.close_reason && (
                  <div className="mt-1 text-[10px] text-slate-700 italic bg-slate-50 border border-slate-200 rounded px-2 py-1">
                    Closure: {a.close_reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Issue Advance modal */}
      {issueModalOpen && issueDraft && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 overflow-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4">
            <div className="bg-gradient-to-r from-amber-700 to-orange-600 text-white rounded-t-2xl px-5 py-3 flex justify-between items-center">
              <div>
                <div className="text-lg font-extrabold">💵 Issue New Advance</div>
                <div className="text-xs font-semibold text-orange-100">Auto-debits treasury · creates linked entry</div>
              </div>
              <button onClick={function () { setIssueModalOpen(false); setIssueDraft(null); }} className="bg-white text-orange-700 w-9 h-9 rounded-full font-bold text-lg shadow">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Issue Date * / تاريخ الإصدار</span>
                  <input type="date" value={issueDraft.issue_date} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { issue_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Currency * / العملة</span>
                  <select value={issueDraft.currency} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { currency: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold">
                    <option value="EGP">EGP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Amount * / المبلغ</span>
                <input type="number" step="0.01" min="0" value={issueDraft.amount} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { amount: e.target.value })); }} placeholder="0.00" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono font-bold text-right" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Recipient Name * / المستلم</span>
                  <input type="text" value={issueDraft.recipient_name} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { recipient_name: e.target.value })); }} placeholder="e.g. Mohamed Oraby" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold" />
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Role / الدور (optional)</span>
                  <input type="text" value={issueDraft.recipient_role} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { recipient_role: e.target.value })); }} placeholder="e.g. Warehouse Manager / Driver" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Description / الوصف</span>
                <textarea value={issueDraft.description} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { description: e.target.value })); }} rows={2} placeholder="e.g. Q3 warehouse operations float" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 resize-none" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Reference # / رقم المرجع (optional)</span>
                <input type="text" value={issueDraft.reference_number} onChange={function (e) { setIssueDraft(Object.assign({}, issueDraft, { reference_number: e.target.value })); }} placeholder="e.g. ADV-2026-005" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
              </label>
              <div className="text-[11px] bg-amber-50 border border-amber-300 rounded p-2 text-amber-900 font-semibold">
                💡 When you save, this also creates a DEBIT in treasury: &quot;Advance to {issueDraft.recipient_name || '[recipient]'} — {fmtDate(issueDraft.issue_date)}&quot;
              </div>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setIssueModalOpen(false); setIssueDraft(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={saveIssue} disabled={busy} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Issue Advance'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Close Advance modal */}
      {closeModal && closeModal.advance && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="bg-slate-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">Close Advance</div>
              <div className="text-xs font-semibold text-slate-300">{closeModal.advance.recipient_name} · {fmtMoney(closeModal.advance.amount, closeModal.advance.currency)}</div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Closure Reason (optional)</span>
                <textarea value={closeModal.reason} onChange={function (e) { setCloseModal(Object.assign({}, closeModal, { reason: e.target.value })); }} rows={3} placeholder="e.g. Reconciled, returned 250 EGP cash to safe" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 resize-none" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setCloseModal(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={closeAdvance} disabled={busy} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Closing...' : 'Close Advance'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer (expenses for one advance) */}
      {detailAdvance && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 overflow-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4">
            <div className="bg-gradient-to-r from-amber-700 to-orange-600 text-white rounded-t-2xl px-5 py-3 flex justify-between items-center">
              <div>
                <div className="text-lg font-extrabold">📜 Advance Detail</div>
                <div className="text-xs font-semibold text-orange-100">{detailAdvance.recipient_name} · {fmtMoney(detailAdvance.amount, detailAdvance.currency)} on {fmtDate(detailAdvance.issue_date)}</div>
              </div>
              <button onClick={function () { setDetailAdvance(null); }} className="bg-white text-orange-700 w-9 h-9 rounded-full font-bold text-lg shadow">✕</button>
            </div>
            <div className="px-5 py-4">
              {(function () {
                var rows = expenses.filter(function (e) { return e.advance_id === detailAdvance.id; });
                rows.sort(function (a, b) { return (b.expense_date || '').localeCompare(a.expense_date || ''); });
                if (rows.length === 0) {
                  return <div className="text-sm text-slate-600 italic text-center py-6">No expenses tagged to this advance yet. Tag warehouse expenses to this advance from the Warehouse Expenses page.</div>;
                }
                return (
                  <div className="overflow-auto border border-slate-200 rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Date</th>
                          <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Description</th>
                          <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Category</th>
                          <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(function (e) {
                          return (
                            <tr key={e.id} className="border-b border-slate-200">
                              <td className="px-2 py-1.5 font-mono text-slate-700">{fmtDate(e.expense_date)}</td>
                              <td className="px-2 py-1.5 text-slate-800">{e.description || '—'}</td>
                              <td className="px-2 py-1.5 text-slate-700">{e.category || '—'}{e.subcategory ? ' / ' + e.subcategory : ''}</td>
                              <td className="px-2 py-1.5 text-right font-mono font-extrabold text-red-700">{fmtMoney(e.amount, detailAdvance.currency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-extrabold">
                          <td colSpan={3} className="px-2 py-1.5 text-right">Total spent:</td>
                          <td className="px-2 py-1.5 text-right font-mono text-red-800">{fmtMoney(detailAdvance.spent_amount, detailAdvance.currency)}</td>
                        </tr>
                        <tr className="bg-emerald-50 font-extrabold">
                          <td colSpan={3} className="px-2 py-1.5 text-right">Remaining:</td>
                          <td className={'px-2 py-1.5 text-right font-mono ' + (detailAdvance.remaining_amount > 0 ? 'text-emerald-800' : 'text-slate-600')}>{fmtMoney(detailAdvance.remaining_amount, detailAdvance.currency)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })()}
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setDetailAdvance(null); }} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
