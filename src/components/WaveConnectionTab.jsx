// v55.83-AI — Wave connection / compatibility check screen (owner-only).
// Calls /api/wave/check (server-side token). Read-only — confirms the link works
// and which businesses are API-invoice compatible (isClassicInvoicing === false).
import { useState, useEffect } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { isPlaceholderWaveBusiness, setActiveWaveBusiness, getActiveWaveBusiness } from '../lib/wave-business';

export default function WaveConnectionTab(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');

  var [state, setState] = useState(null);
  var [loading, setLoading] = useState(false);
  var [audit, setAudit] = useState(null);
  var [auditing, setAuditing] = useState(false);
  // v55.83-KN — bind a silo to a real Wave business (fix the placeholder-id root cause).
  var [registry, setRegistry] = useState([]);
  var [bindSel, setBindSel] = useState({}); // { waveBusinessId(real) : siloWaveBusinessId(to rebind) }
  var [binding, setBinding] = useState(false);
  var [bindMsg, setBindMsg] = useState('');
  var [advancedRebind, setAdvancedRebind] = useState(false); // v55.83-KQ — normal mode binds placeholder silos ONLY
  useEffect(function () { fetchAllRows('wave_business_registry', '*').then(function (r) { setRegistry((r && r.data) || []); }).catch(function () {}); }, []);
  function reloadRegistry() { fetchAllRows('wave_business_registry', '*').then(function (r) { setRegistry((r && r.data) || []); }).catch(function () {}); }
  function bindBusiness(realId, realName) {
    var siloFrom = bindSel[realId];
    if (!siloFrom) { setBindMsg('Pick which silo to bind to "' + (realName || realId) + '" first.'); return; }
    // v55.83-KQ — rebinding an ALREADY-connected (non-placeholder) silo is a migration, not first-time
    // setup; require an extra, explicit confirmation so it can't happen by accident.
    if (!isPlaceholderWaveBusiness(siloFrom)) {
      if (!window.confirm('⚠ ADVANCED: that silo is already connected to a real Wave business (' + siloFrom + '). Rebinding it MOVES all its data to a different Wave business and is rarely what you want. Are you sure you want to re-bind an already-connected silo?')) { setBindMsg('Cancelled — already-connected silo not rebound.'); return; }
    }
    setBinding(true); setBindMsg('Checking…');
    var payload = { from_wave_business_id: siloFrom, to_wave_business_id: realId, to_label: realName || null, user_id: (userProfile && userProfile.id) || null, dry_run: true };
    fetch('/api/wave/bind-business', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok === false) { setBinding(false); setBindMsg('✕ ' + ((j && j.error) || 'Could not preview the bind.')); return null; }
        if (!window.confirm(j.message + '\n\nBind this silo to "' + (realName || realId) + '" now? This re-tags the silo\'s data to the real Wave business (all-or-nothing — it rolls back if anything fails).')) { setBinding(false); setBindMsg('Cancelled — nothing changed.'); return null; }
        return fetch('/api/wave/bind-business', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, payload, { dry_run: false })) }).then(function (r2) { return r2.json(); });
      })
      .then(function (j2) { if (!j2) { return; } setBindMsg((j2.ok ? '✓ ' : '✕ ') + (j2.message || j2.error || 'Done.')); if (j2.ok) { /* v55.83-KW (Codex) — if the silo we just bound was the active one, point the browser at the new real GUID so the app stops showing the placeholder. */ try { if (getActiveWaveBusiness() === siloFrom) { setActiveWaveBusiness(realId); } } catch (eS) {} } reloadRegistry(); })
      .catch(function (e) { setBindMsg('✕ Bind failed: ' + ((e && e.message) || 'network error')); })
      .finally(function () { setBinding(false); });
  }

  function runAudit() {
    setAuditing(true); setAudit(null);
    fetch('/api/wave/audit').then(function (r) { return r.json(); })
      .then(function (d) { setAudit(d); })
      .catch(function (e) { setAudit({ ok: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setAuditing(false); });
  }

  function test() {
    setLoading(true); setState(null);
    fetch('/api/wave/check').then(function (r) { return r.json(); })
      .then(function (d) { setState(d); })
      .catch(function (e) { setState({ connected: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setLoading(false); });
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <RestrictedNotice title="Owner only" message="Only the account owner can connect or check Wave." />
      </div>
    );
  }

  return (
    <div className="p-4 text-slate-100 max-w-2xl">
      <div className="text-lg font-extrabold mb-1">🌊 Wave Connection</div>
      <div className="bg-white text-slate-900 rounded p-3 text-xs font-medium mb-3">
        Wave stays your official accounting ledger. This screen only <b>checks</b> the connection — it never changes anything in Wave. Your token is stored securely on the server (Vercel env var <code>WAVE_ACCESS_TOKEN</code>) and is never shown in the browser.
      </div>

      <button onClick={test} disabled={loading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold disabled:opacity-50">
        {loading ? 'Checking…' : 'Test Wave connection'}
      </button>

      {state && (
        <div className="mt-4">
          {state.connected ? (
            <div className="bg-emerald-100 text-emerald-950 rounded-lg p-3">
              <div className="font-extrabold mb-2">✅ Connected to Wave</div>
              <div className="text-xs font-semibold mb-1">Businesses Wave returned for this token:</div>
              {(state.businesses || []).length === 0 ? <div className="text-xs">No businesses found on this token.</div> :
                (state.businesses || []).map(function (b, i) {
                  var boundSilo = null; registry.forEach(function (r) { if (r.wave_business_id === b.id) { boundSilo = r; } });
                  // v55.83-KQ — NORMAL mode lists only UNBOUND (placeholder) silos, so an already-connected
                  // silo can't be rebound by accident. Advanced repair (rebind a real silo) is opt-in.
                  var bindable = registry.filter(function (r) { return advancedRebind ? (r.wave_business_id !== b.id) : isPlaceholderWaveBusiness(r.wave_business_id); });
                  return (
                    <div key={i} className="bg-white rounded px-2 py-1.5 mb-1 text-xs">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-bold text-slate-900">{b.name}{b.isPersonal ? ' (personal)' : ''}</span>
                        {b.isClassicInvoicing
                          ? <span className="bg-amber-200 text-amber-950 rounded px-2 py-0.5 font-bold">⚠ Classic invoicing — needs Wave-side migration before invoice sync</span>
                          : <span className="bg-emerald-200 text-emerald-950 rounded px-2 py-0.5 font-bold">✓ New invoicing — API invoice sync supported</span>}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 font-mono break-all">Wave id: {b.id}</div>
                      {/* v55.83-KN — bind a Hub silo to THIS real Wave business (fixes the placeholder-id root cause). */}
                      {boundSilo
                        ? <div className="text-[10px] text-emerald-800 font-bold mt-1">✓ Bound to Hub silo: {boundSilo.label || boundSilo.wave_business_id}</div>
                        : (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <span className="text-[10px] text-slate-600">Bind a silo →</span>
                            <select value={bindSel[b.id] || ''} onChange={function (e) { var v = e.target.value; setBindSel(function (p) { var n = Object.assign({}, p); n[b.id] = v; return n; }); }} className="border border-slate-300 rounded px-1 py-0.5 text-[10px] text-slate-900 bg-white">
                              <option value="">— choose Hub silo —</option>
                              {bindable.map(function (r) { return <option key={r.wave_business_id} value={r.wave_business_id}>{(r.label || r.wave_business_id) + (isPlaceholderWaveBusiness(r.wave_business_id) ? ' (placeholder — needs binding)' : '')}</option>; })}
                            </select>
                            <button onClick={function () { bindBusiness(b.id, b.name); }} disabled={binding} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold disabled:opacity-50">{binding ? '…' : 'Bind this business'}</button>
                          </div>
                        )}
                    </div>
                  );
                })}
              {bindMsg && <div className="text-[11px] mt-2 bg-slate-900 text-slate-100 rounded px-2 py-1 whitespace-pre-wrap">{bindMsg}</div>}
              <div className="text-[11px] text-emerald-900 mt-2">Bind your <b>Real KTC</b> silo to the matching business above (it shows its real Wave id). That replaces the placeholder id and unblocks categories, products and payment push for that silo. Binding is <b>all-or-nothing</b> — if anything fails it rolls back and nothing changes.</div>
              <label className="flex items-center gap-1 text-[10px] text-slate-600 mt-1"><input type="checkbox" checked={advancedRebind} onChange={function (e) { setAdvancedRebind(e.target.checked); }} /> Advanced: allow rebinding an already-connected silo (migration — use with care)</label>
            </div>
          ) : (
            <div className="bg-rose-100 text-rose-950 rounded-lg p-3">
              <div className="font-extrabold mb-1">{state.configured === false ? '⚙️ Not configured yet' : '❌ Not connected'}</div>
              <div className="text-xs font-medium">{state.error || 'Unknown error.'}</div>
            </div>
          )}
        </div>
      )}

      {state && state.connected && (
        <div className="mt-4">
          <button onClick={runAudit} disabled={auditing} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded text-sm font-bold disabled:opacity-50">
            {auditing ? 'Auditing…' : 'Run capability audit (what can we import?)'}
          </button>
          {audit && (audit.ok ? (
            <div className="bg-white text-slate-900 rounded-lg p-3 mt-3 border border-slate-200">
              <div className="font-extrabold mb-2">📋 What your Wave account holds (live)</div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-600 text-left"><th className="py-1">Business</th><th className="text-right">Customers</th><th className="text-right">Invoices</th><th className="text-right">Products</th></tr></thead>
                <tbody>
                  {(audit.businesses || []).map(function (b, i) {
                    return <tr key={i} className="border-t border-slate-100 text-slate-900"><td className="py-1 font-bold">{b.name}</td><td className="text-right">{b.customers == null ? '—' : b.customers}</td><td className="text-right">{b.invoices == null ? '—' : b.invoices}</td><td className="text-right">{b.products == null ? '—' : b.products}</td></tr>;
                  })}
                </tbody>
              </table>
              <div className="text-[11px] text-slate-600 mt-2">These counts are existing records (including historical) we can <b>read and import</b> from Wave. Creating/updating customers, invoices, and recording payments back to Wave is also supported by the API — that's the push direction we build next.</div>
            </div>
          ) : (
            <div className="bg-rose-100 text-rose-950 rounded-lg p-3 mt-3 text-xs font-medium">{audit.error || 'Audit failed.'}</div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-slate-700 pt-3 text-[11px] text-slate-400">
        <div className="font-bold text-slate-300 mb-1">Sync framework status (not active yet)</div>
        <div>Customers, invoices, and proformas already carry their Wave mapping fields (wave_*_id, wave_sync_status, ready_for_wave). Actual push-to-Wave is built only after this check passes and you approve turning it on.</div>
      </div>
    </div>
  );
}
