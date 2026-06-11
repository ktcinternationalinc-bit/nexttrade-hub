// v55.83-AI — Wave connection / compatibility check screen (owner-only).
// Calls /api/wave/check (server-side token). Read-only — confirms the link works
// and which businesses are API-invoice compatible (isClassicInvoicing === false).
import { useState } from 'react';

export default function WaveConnectionTab(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');

  var [state, setState] = useState(null);
  var [loading, setLoading] = useState(false);
  var [audit, setAudit] = useState(null);
  var [auditing, setAuditing] = useState(false);

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
        <div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 text-amber-950">
          <div className="font-extrabold">🔒 Owner only</div>
          <div className="text-sm font-medium mt-1">Only the account owner can connect or check Wave.</div>
        </div>
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
                  return (
                    <div key={i} className="flex items-center justify-between bg-white rounded px-2 py-1.5 mb-1 text-xs">
                      <span className="font-bold text-slate-900">{b.name}{b.isPersonal ? ' (personal)' : ''}</span>
                      {b.isClassicInvoicing
                        ? <span className="bg-amber-200 text-amber-950 rounded px-2 py-0.5 font-bold">⚠ Classic invoicing — needs Wave-side migration before invoice sync</span>
                        : <span className="bg-emerald-200 text-emerald-950 rounded px-2 py-0.5 font-bold">✓ New invoicing — API invoice sync supported</span>}
                    </div>
                  );
                })}
              <div className="text-[11px] text-emerald-900 mt-2">Pick the KTC business that shows <b>✓ New invoicing</b> — that's the one we'll sync approved invoices into later.</div>
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
