'use client';
// v55.83-A.6.27.63 — FX Rates panel.
//
// WHAT IT DOES:
//   • Lets super admin (or anyone with Edit Treasury permission) log daily FX rates
//   • Shows a history of all rates with date / pair / rate / source
//   • Quick-add for "today's USD/EGP rate" — one click + amount
//   • Edit + delete existing rates (super admin only delete)
//
// USAGE:
//   <FxRatesPanel toast={toast} userProfile={userProfile} canEdit={canEdit} />

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmtRate(r) {
  if (r == null || isNaN(Number(r))) return '—';
  return Number(r).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}
function todayISO() { return new Date().toISOString().substring(0, 10); }

var COMMON_PAIRS = [
  ['USD', 'EGP'],
  ['EUR', 'EGP'],
  ['EGP', 'USD'],
];

export default function FxRatesPanel(props) {
  var toast = props.toast || { success: function(){}, error: function(){}, info: function(){} };
  var userProfile = props.userProfile || null;
  var canEdit = props.canEdit !== false;
  var isSuperAdmin = userProfile && userProfile.role === 'super_admin';

  var [rates, setRates] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [busy, setBusy] = useState(false);

  var [draft, setDraft] = useState(null); // null = closed; object = open
  var [editingId, setEditingId] = useState(null);

  var [filterPair, setFilterPair] = useState('USD>EGP'); // 'all' | 'USD>EGP' | 'EUR>EGP' | ...

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var res = await supabase
          .from('fx_rates')
          .select('*')
          .order('rate_date', { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (res.error) {
          var msg = (res.error && res.error.message) || String(res.error);
          if (/relation.*fx_rates.*does not exist/i.test(msg)) {
            setError('FX Rates not set up yet. Run SQL migration v55.83-A.6.27.63 in Supabase.');
          } else {
            setError(msg);
          }
          setRates([]);
        } else {
          setRates(res.data || []);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[fx-rates] load failed:', e);
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
      var res = await supabase.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(500);
      if (!res.error) setRates(res.data || []);
    } catch (e) { console.error('[fx-rates] reload failed:', e); }
  }

  var filteredRates = useMemo(function () {
    if (filterPair === 'all') return rates;
    var parts = filterPair.split('>');
    if (parts.length !== 2) return rates;
    return rates.filter(function (r) {
      return r.from_currency === parts[0] && r.to_currency === parts[1];
    });
  }, [rates, filterPair]);

  // Most recent rate per pair (for quick reference at the top)
  var latestByPair = useMemo(function () {
    var byPair = {};
    rates.forEach(function (r) {
      var key = r.from_currency + '>' + r.to_currency;
      if (!byPair[key] || r.rate_date > byPair[key].rate_date) byPair[key] = r;
    });
    return byPair;
  }, [rates]);

  function openNew(pairKey) {
    if (!canEdit) return;
    var parts = (pairKey || 'USD>EGP').split('>');
    setEditingId(null);
    setDraft({
      rate_date: todayISO(),
      from_currency: parts[0] || 'USD',
      to_currency: parts[1] || 'EGP',
      rate: '',
      source: 'manual',
      notes: '',
    });
  }

  function openEdit(r) {
    if (!canEdit) return;
    setEditingId(r.id);
    setDraft({
      rate_date: r.rate_date,
      from_currency: r.from_currency,
      to_currency: r.to_currency,
      rate: String(r.rate || ''),
      source: r.source || '',
      notes: r.notes || '',
    });
  }

  async function saveDraft() {
    if (!draft) return;
    var rate = Number(draft.rate);
    if (!rate || rate <= 0) { alert('Rate must be a positive number'); return; }
    if (!draft.rate_date) { alert('Date is required'); return; }
    if (!draft.from_currency || !draft.to_currency) { alert('From + To currencies required'); return; }
    if (draft.from_currency === draft.to_currency) { alert('From and To must be different'); return; }

    setBusy(true);
    try {
      var payload = {
        rate_date: draft.rate_date,
        from_currency: String(draft.from_currency).toUpperCase().trim(),
        to_currency: String(draft.to_currency).toUpperCase().trim(),
        rate: rate,
        source: (draft.source || '').trim() || null,
        notes: (draft.notes || '').trim() || null,
        created_by: userProfile && userProfile.id,
      };
      var res;
      if (editingId) {
        res = await supabase.from('fx_rates').update(payload).eq('id', editingId);
      } else {
        // Try insert; on unique violation, upsert by date+pair
        res = await supabase.from('fx_rates').upsert(payload, {
          onConflict: 'rate_date,from_currency,to_currency',
        });
      }
      if (res.error) throw res.error;
      toast.success(editingId ? 'Rate updated' : 'Rate saved');
      setDraft(null);
      setEditingId(null);
      await reload();
    } catch (e) {
      console.error('[fx-rates] save failed:', e);
      var em = (e && e.message) || String(e);
      var hint = '';
      if (/relation.*fx_rates.*does not exist/i.test(em)) {
        hint = '\n\nRun SQL migration v55.83-A.6.27.63 in Supabase first.';
      }
      alert('Save failed: ' + em + hint);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRate(r) {
    if (!r) return;
    if (!isSuperAdmin) { alert('Only super admin can delete FX rates.'); return; }
    var msg = 'Delete this FX rate?\n\n' +
      r.rate_date + ' · ' + r.from_currency + '→' + r.to_currency + ' = ' + fmtRate(r.rate) +
      '\n\nThis does NOT affect inventory or movements that already used this rate.';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      var res = await supabase.from('fx_rates').delete().eq('id', r.id);
      if (res.error) throw res.error;
      toast.success('Rate deleted');
      await reload();
    } catch (e) {
      console.error('[fx-rates] delete failed:', e);
      alert('Delete failed: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-center text-slate-600 font-semibold">Loading FX rates...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-700 text-white rounded-lg p-4">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-extrabold">💱 FX Rates / أسعار الصرف</h2>
            <div className="text-xs font-semibold text-blue-100 mt-1">
              Daily exchange rates · used by P&L for FX gain/loss
            </div>
          </div>
          {canEdit && !error && (
            <div className="flex gap-2 flex-wrap">
              {COMMON_PAIRS.map(function (pair) {
                var key = pair[0] + '>' + pair[1];
                return (
                  <button
                    key={key}
                    onClick={function () { openNew(key); }}
                    className="px-3 py-1.5 bg-white text-blue-800 text-xs font-extrabold rounded shadow hover:bg-blue-50"
                  >+ {pair[0]}→{pair[1]}</button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 text-red-900 font-semibold">
          ⚠️ {error}
        </div>
      )}

      {/* Latest rate cards (most recent per pair) */}
      {!error && Object.keys(latestByPair).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {Object.keys(latestByPair).sort().map(function (key) {
            var r = latestByPair[key];
            return (
              <div key={key} className="bg-white border-2 border-blue-200 rounded-lg p-3">
                <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">
                  Latest · {r.from_currency} → {r.to_currency}
                </div>
                <div className="text-xl font-mono font-extrabold text-slate-900 mt-0.5">
                  1 {r.from_currency} = {fmtRate(r.rate)} {r.to_currency}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  Logged {r.rate_date}{r.source ? ' · ' + r.source : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter pills */}
      {!error && rates.length > 0 && (
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs font-extrabold text-slate-700">Show:</span>
          <button
            onClick={function () { setFilterPair('all'); }}
            className={'px-3 py-1 text-xs font-extrabold rounded ' +
              (filterPair === 'all' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300')}
          >All</button>
          {COMMON_PAIRS.map(function (pair) {
            var key = pair[0] + '>' + pair[1];
            return (
              <button
                key={key}
                onClick={function () { setFilterPair(key); }}
                className={'px-3 py-1 text-xs font-extrabold rounded ' +
                  (filterPair === key ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300')}
              >{pair[0]}→{pair[1]}</button>
            );
          })}
        </div>
      )}

      {/* Rates table */}
      {!error && (filteredRates.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-8 text-center text-slate-600 italic">
          No FX rates logged yet. Click a button above to add the first one.
        </div>
      ) : (
        <div className="overflow-auto border-2 border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Date</th>
                <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Pair</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Rate</th>
                <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Source</th>
                <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Notes</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRates.map(function (r) {
                return (
                  <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-mono text-slate-800 font-semibold">{r.rate_date}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-700">
                      <span className="inline-block bg-blue-100 text-blue-900 font-extrabold rounded px-1.5">{r.from_currency}</span>
                      <span className="text-slate-500 mx-1">→</span>
                      <span className="inline-block bg-blue-100 text-blue-900 font-extrabold rounded px-1.5">{r.to_currency}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-extrabold text-slate-900">{fmtRate(r.rate)}</td>
                    <td className="px-3 py-1.5 text-slate-700">{r.source || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-700 italic">{r.notes || ''}</td>
                    <td className="px-3 py-1.5 text-right">
                      {canEdit && (
                        <button onClick={function () { openEdit(r); }} className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold rounded mr-1">Edit</button>
                      )}
                      {isSuperAdmin && (
                        <button onClick={function () { deleteRate(r); }} className="px-2 py-0.5 bg-red-700 hover:bg-red-800 text-white text-[10px] font-extrabold rounded">🗑</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Add/Edit modal */}
      {draft && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl">
            <div className="bg-gradient-to-r from-indigo-700 to-blue-700 text-white rounded-t-2xl px-5 py-3 flex justify-between items-center">
              <div>
                <div className="text-lg font-extrabold">{editingId ? '✏️ Edit FX Rate' : '+ Log FX Rate'}</div>
                <div className="text-xs font-semibold text-blue-100">Adds to history · used by P&L going forward</div>
              </div>
              <button onClick={function () { setDraft(null); setEditingId(null); }} className="bg-white text-blue-700 w-9 h-9 rounded-full font-bold text-lg shadow">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Date *</span>
                  <input type="date" value={draft.rate_date} onChange={function (e) { setDraft(Object.assign({}, draft, { rate_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">From *</span>
                  <select value={draft.from_currency} onChange={function (e) { setDraft(Object.assign({}, draft, { from_currency: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold">
                    <option value="USD">USD</option>
                    <option value="EGP">EGP</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">To *</span>
                  <select value={draft.to_currency} onChange={function (e) { setDraft(Object.assign({}, draft, { to_currency: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold">
                    <option value="EGP">EGP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Rate * (1 {draft.from_currency} = N {draft.to_currency})</span>
                <input type="number" step="0.000001" min="0" value={draft.rate} onChange={function (e) { setDraft(Object.assign({}, draft, { rate: e.target.value })); }} placeholder="e.g. 50.0000" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono font-bold text-right" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Source (optional)</span>
                <input type="text" value={draft.source} onChange={function (e) { setDraft(Object.assign({}, draft, { source: e.target.value })); }} placeholder="e.g. CBE, banking app, manual" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Notes (optional)</span>
                <textarea value={draft.notes} onChange={function (e) { setDraft(Object.assign({}, draft, { notes: e.target.value })); }} rows={2} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 resize-none" />
              </label>
              {!editingId && (
                <div className="text-[11px] bg-amber-50 border border-amber-300 rounded p-2 text-amber-900 font-semibold">
                  💡 If a rate already exists for this date + pair, it will be REPLACED (last entry wins).
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setDraft(null); setEditingId(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={saveDraft} disabled={busy} className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Save Rate'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
