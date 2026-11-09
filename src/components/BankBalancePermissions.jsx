'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';
import { useBankVisibility, refreshBankVisibility } from '../lib/use-bank-visibility';

var SPECIAL_PERMISSIONS = [
  { key: 'canViewFullDashboard', label: 'Full dashboard access' },
  { key: 'canViewBankBalances', label: 'Bank Balances (banking information) — super admin grants only' }, // v55.83-RF (Max 15:25 "yes in settings bank balances")
];

export default function BankBalancePermissions() {
  var visibility = useBankVisibility();
  var canManage = visibility.isVerifiedSuperAdmin === true;
  var [grants, setGrants] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState('');
  var [saving, setSaving] = useState(null);
  var [version, setVersion] = useState(0);
  var epoch = useRef(0);
  var mutation = useRef(null);

  useEffect(function () {
    epoch.current += 1;
    var current = epoch.current;
    var controller = new AbortController();
    setGrants([]); setError(''); setSaving(null);
    if (mutation.current) mutation.current.abort();
    if (!canManage) { setLoading(false); return; }
    setLoading(true);
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    async function load() {
      try {
        var headers = await bankSessionHeaders(supabase, false);
        if (current !== epoch.current) return;
        var response = await fetch('/api/bank-visibility?scope=grants', { headers: headers, cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Financial data permissions could not be loaded.');
        var body = await response.json();
        if (!response.ok || body.ok !== true || body.capabilities?.isVerifiedSuperAdmin !== true || !Array.isArray(body.grants)) throw new Error(body.error || 'Financial data permissions could not be loaded.');
        if (body.grants.some(function (row) { return !row || typeof row.profileId !== 'string' || typeof row.canViewFullDashboard !== 'boolean' || typeof row.canViewBankBalances !== 'boolean' || typeof row.isVerifiedSuperAdmin !== 'boolean'; })) throw new Error('Financial data permissions could not be loaded.');
        if (current === epoch.current) setGrants(body.grants);
      } catch (failure) {
        if (current === epoch.current) { setGrants([]); setError(failure.name === 'AbortError' ? 'Financial data permissions could not be loaded. They will be checked again automatically.' : failure.message); }
      } finally {
        clearTimeout(timeout);
        if (current === epoch.current) setLoading(false);
      }
    }
    void load();
    return function () { epoch.current += 1; controller.abort(); clearTimeout(timeout); if (mutation.current) mutation.current.abort(); };
  }, [canManage, version]);

  useEffect(function () {
    if (!canManage) return;
    function reload() { if (!mutation.current && document.visibilityState !== 'hidden') setVersion(function (value) { return value + 1; }); }
    var timer = setInterval(reload, 60000);
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return function () { clearInterval(timer); window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, [canManage]);

  async function changeGrant(grant, capability) {
    if (!canManage || saving || grant.isVerifiedSuperAdmin || !grant.authUserId) return;
    if (!SPECIAL_PERMISSIONS.some(function (permission) { return permission.key === capability; })) return;
    var current = epoch.current;
    var controller = new AbortController();
    mutation.current = controller;
    setSaving(grant.profileId + ':' + capability); setError('');
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var headers = await bankSessionHeaders(supabase, true);
      if (current !== epoch.current) return;
      var response = await fetch('/api/bank-visibility', {
        method: 'PUT', headers: headers, cache: 'no-store', redirect: 'error', signal: controller.signal,
        // Send only the selected flag. The server preserves the other grant.
        body: JSON.stringify({ profileId: grant.profileId, [capability]: !grant[capability] }),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The permission update could not be confirmed.');
      var body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(body.error || 'The permission update could not be confirmed.');
      if (current !== epoch.current) return;
      // Re-read the server's grants rather than displaying an optimistic grant.
      refreshBankVisibility();
      setVersion(function (value) { return value + 1; });
    } catch (failure) {
      if (current === epoch.current) {
        setError(failure.name === 'AbortError' ? 'The permission update could not be confirmed. Access will be checked again automatically.' : failure.message);
        if (failure.name === 'AbortError') refreshBankVisibility();
      }
    } finally {
      clearTimeout(timeout);
      if (mutation.current === controller) mutation.current = null;
      if (current === epoch.current) setSaving(null);
    }
  }

  return <section className="mb-5 rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid #c7d2fe' }} aria-label="Financial data access">
    <h3 className="text-sm font-bold" style={{ color: '#1e1b4b' }}>Financial data access</h3>
    <div className="grid sm:grid-cols-2 gap-3 mt-2 text-xs leading-relaxed" style={{ color: '#334155' }}><p><strong style={{ color: '#0f172a' }}>Full dashboard access</strong> shows the shared company financial overview and ClickBooks non-bank financial/tax reports.</p><p><strong style={{ color: '#0f172a' }}>Banking information access</strong> additionally shows account balances, balance-sheet bank totals, trial balance, general ledger, cash-flow and bank-reconciliation detail.</p></div>
    <p className="text-xs mt-2" style={{ color: '#334155' }}>These permissions are independent. Existing permissions still control invoices, bills, expense entry, transaction matching and reports.</p>
    {visibility.loading ? <p className="text-xs mt-3" style={{ color: '#475569' }}>Checking access…</p> : !canManage ? <p className="text-xs mt-3" style={{ color: '#334155' }}>Only a verified super administrator can change these permissions.{visibility.error ? ' ' + visibility.error : ''}</p> : <>
      <p className="text-xs mt-3" style={{ color: '#334155' }}>Verified super administrators have both permissions. Other users need separate grants below. Only active profiles with a verified sign-in appear.</p>
      {error && <p role="alert" className="text-xs rounded-lg p-2 mt-3" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fecaca' }}>{error}</p>}
      {loading ? <p className="text-xs mt-3" style={{ color: '#475569' }}>Loading approved users…</p> : <div className="overflow-x-auto mt-3"><table className="w-full text-xs text-left"><thead><tr style={{ borderBottom: '1px solid #c7d2fe', color: '#475569' }}><th className="py-2 pr-3 font-semibold">Team member</th>{SPECIAL_PERMISSIONS.map(function (permission) { return <th key={permission.key} className="py-2 px-3 font-semibold text-right">{permission.label}</th>; })}</tr></thead><tbody>{grants.map(function (grant) {
        var disabled = !!saving || grant.isVerifiedSuperAdmin || !grant.authUserId;
        return <tr key={grant.profileId} style={{ borderBottom: '1px solid #e0e7ff' }}><td className="py-2 pr-3"><div className="font-semibold" style={{ color: '#0f172a' }}>{grant.name || grant.email || 'Team member'}</div>{grant.name && grant.email && <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>{grant.email}</div>}{!grant.authUserId && <div className="text-[10px] mt-0.5" style={{ color: '#92400e' }}>No verified sign-in linked</div>}</td>{SPECIAL_PERMISSIONS.map(function (permission) { return <td key={permission.key} className="py-2 px-3 text-right">{grant.isVerifiedSuperAdmin ? <span className="font-semibold" style={{ color: '#3730a3' }}>Always allowed</span> : <button type="button" role="switch" aria-checked={grant[permission.key]} aria-label={permission.label + ' for ' + (grant.name || grant.email || 'team member')} disabled={disabled} onClick={function () { void changeGrant(grant, permission.key); }} className="rounded px-3 py-1 font-bold disabled:opacity-50" style={grant[permission.key] ? { background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0' } : { background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>{saving === grant.profileId + ':' + permission.key ? 'Saving…' : grant[permission.key] ? 'Allowed' : 'Hidden'}</button>}</td>; })}</tr>;
      })}</tbody></table>{!grants.length && !error && <p className="text-xs py-3" style={{ color: '#475569' }}>No active team profiles are available.</p>}</div>}
    </>}
  </section>;
}
