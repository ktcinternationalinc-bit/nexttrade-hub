import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================
// SEO Audit
// Enter a site URL (or pick a saved one), crawl it, and get a
// prioritized list of technical SEO issues with a score. Detects
// titles, meta, headings, alt text, canonical, mobile, schema,
// placeholder text, and injected-spam red flags.
//
// This flags + explains. Auto-fixing the live site is a later,
// separate, repo-based capability.
// ============================================================

var PRESET_SITES = [
  'https://ktcus.com',
  'https://stocklotwarehouse.com',
  'https://nextradeindustries.com',
];

var SEV_META = {
  critical: { label: 'Critical', cls: 'bg-red-100 text-red-800 border-red-300', dot: '#dc2626' },
  high: { label: 'High', cls: 'bg-orange-100 text-orange-800 border-orange-300', dot: '#ea580c' },
  medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-800 border-amber-300', dot: '#d97706' },
  low: { label: 'Low', cls: 'bg-slate-100 text-slate-700 border-slate-300', dot: '#64748b' },
};

function scoreColor(score) {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

export default function SEOAuditTab(props) {
  var toast = props.toast || function () {};

  var [url, setUrl] = useState('');
  var [auditing, setAuditing] = useState(false);
  var [result, setResult] = useState(null);
  var [history, setHistory] = useState([]);

  useEffect(function () { loadHistory(); }, []);

  async function loadHistory() {
    try {
      var res = await supabase.from('seo_audits').select('*').order('created_at', { ascending: false }).limit(50);
      setHistory(res.data || []);
    } catch (e) { /* table may not exist yet */ }
  }

  async function runAudit(targetUrl) {
    var u = (targetUrl || url || '').trim();
    if (!u) { toast('Enter a URL', 'error'); return; }
    setAuditing(true);
    setResult(null);
    try {
      var resp = await fetch('/api/seo-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        toast(data.error || 'Audit failed', 'error');
      } else {
        setResult(data);
        loadHistory();
      }
    } catch (e) {
      toast('Audit error', 'error');
    }
    setAuditing(false);
  }

  var orderedIssues = result && result.issues
    ? result.issues.slice().sort(function (a, b) {
        var order = { critical: 0, high: 1, medium: 2, low: 3 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
      })
    : [];

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-slate-900">🔍 SEO Audit</h1>
        <p className="text-sm text-slate-600 mt-1">
          Crawl a site and get a prioritized list of what to fix to rank better on Google. Flags titles, descriptions, headings,
          alt text, mobile-friendliness, schema, and security red flags. This reports issues — fixing the live site is a separate step.
        </p>
      </div>

      {/* ── Run an audit ────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-6">
        <div className="flex gap-2 mb-3">
          <input type="text" value={url} onChange={function (e) { setUrl(e.target.value); }}
            placeholder="https://yoursite.com"
            onKeyDown={function (e) { if (e.key === 'Enter') runAudit(); }}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <button onClick={function () { runAudit(); }} disabled={auditing}
            className={'px-5 py-2 rounded-lg font-bold text-sm ' + (auditing ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700')}>
            {auditing ? '🔍 Auditing…' : '🔍 Audit'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 self-center">Your sites:</span>
          {PRESET_SITES.map(function (s) {
            return (
              <button key={s} onClick={function () { setUrl(s); runAudit(s); }}
                className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">
                {s.replace('https://', '')}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Result ──────────────────────────────────────────── */}
      {result && (
        <div className="mb-8">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Audited</div>
                <div className="text-lg font-extrabold text-slate-900">{result.url}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Platform: <span className="font-semibold">{result.platform}</span> ·
                  HTTP {result.statusCode} · {result.loadMs} ms · {result.sizeKb} KB
                </div>
              </div>
              <div className="text-center">
                <div className="text-5xl font-black" style={{ color: scoreColor(result.score) }}>{result.score}</div>
                <div className="text-xs font-bold text-slate-500">SEO SCORE</div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              {['critical', 'high', 'medium', 'low'].map(function (sev) {
                var n = (result.counts && result.counts[sev]) || 0;
                if (n === 0) return null;
                return (
                  <span key={sev} className={'px-2.5 py-1 rounded-lg text-xs font-bold border ' + SEV_META[sev].cls}>
                    {n} {SEV_META[sev].label}
                  </span>
                );
              })}
              {orderedIssues.length === 0 && <span className="text-sm text-emerald-700 font-bold">✓ No issues found — clean!</span>}
            </div>
          </div>

          {orderedIssues.length > 0 && (
            <div className="space-y-2">
              {orderedIssues.map(function (iss, i) {
                var meta = SEV_META[iss.severity] || SEV_META.low;
                return (
                  <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 flex gap-3 items-start">
                    <span className="flex-shrink-0 mt-0.5 w-2.5 h-2.5 rounded-full" style={{ background: meta.dot }}></span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={'px-2 py-0.5 rounded text-[10px] font-bold border ' + meta.cls}>{meta.label}</span>
                        <span className="text-xs font-bold text-slate-500 uppercase">{iss.area}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-800 mt-1">{iss.message}</div>
                      {iss.detail && <div className="text-xs text-slate-600 mt-0.5">{iss.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── History ─────────────────────────────────────────── */}
      {history.length > 0 && (
        <div>
          <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide mb-3">Recent Audits</h2>
          <div className="space-y-1.5">
            {history.map(function (h) {
              return (
                <div key={h.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800">{(h.url || '').replace('https://', '')}</span>
                    <span className="text-xs text-slate-500 ml-2">{new Date(h.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {h.counts && h.counts.critical > 0 && <span className="text-xs font-bold text-red-700">{h.counts.critical} critical</span>}
                    <span className="font-black" style={{ color: scoreColor(h.score) }}>{h.score}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
