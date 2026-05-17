'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { runAccountingAudit } from '../lib/accounting-auditor';
import { fmtET } from '../lib/et-time';

// ============================================================
// AI ACCOUNTANT MODAL
// Button triggers a full deterministic audit sweep of:
// treasury vs invoices vs checks vs Egypt Bank vs debts.
// Shows categorized findings (critical/warning/info) in AR+EN.
// Optional "Get AI Analysis" sends findings to Anthropic for
// executive summary and prioritized action list.
// ============================================================

function fE(n) {
  return 'EGP ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function sevColor(s) {
  if (s === 'critical') return { bg: 'bg-red-100', border: 'border-red-500', text: 'text-red-900', dot: 'bg-red-600', label: 'CRITICAL / حرج' };
  if (s === 'warning') return { bg: 'bg-amber-100', border: 'border-amber-500', text: 'text-amber-900', dot: 'bg-amber-600', label: 'WARNING / تنبيه' };
  return { bg: 'bg-blue-100', border: 'border-blue-500', text: 'text-blue-900', dot: 'bg-blue-600', label: 'INFO / معلومة' };
}

export default function AccountingAuditorModal(props) {
  var onClose = props.onClose || function () {};
  var data = {
    treasury: props.treasury || [],
    invoices: props.invoices || [],
    checks: props.checks || [],
    egyptBankTxns: props.egyptBankTxns || [],
    warehouse: props.warehouse || [],
    customers: props.customers || [],
    debts: props.debts || []
  };

  var [expandedFinding, setExpandedFinding] = useState(null);
  var [aiLoading, setAiLoading] = useState(false);
  var [aiResult, setAiResult] = useState(null);
  var [aiError, setAiError] = useState(null);

  // v55.83-A.6.27.21 (Max May 17 2026) — Max reported "no way to go back
  // unless I click back on the browser." The close X was a tiny low-contrast
  // button on a light header. This effect adds an Esc key listener so the
  // user always has a guaranteed escape hatch regardless of where the
  // close button ends up rendered.
  useEffect(function () {
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        try { onClose(); } catch (_) {}
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  var audit = useMemo(function () {
    return runAccountingAudit(data);
  }, [data.treasury, data.invoices, data.checks, data.egyptBankTxns, data.warehouse, data.customers, data.debts]);

  async function requestAiAnalysis() {
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      var res = await fetch('/api/accountant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit: audit })
      });
      var json = await res.json();
      if (json.error) {
        setAiError(json.error);
      } else {
        // v55.83-A.6.27.21 — defensive: if Claude double-wrapped (summary
        // field contains a stringified JSON object), unwrap it. Previously
        // this rendered as raw "{" "en": { "summary": "..." }" in the UI.
        try {
          if (json.en && typeof json.en.summary === 'string' && json.en.summary.trim().startsWith('{')) {
            var maybeInner = JSON.parse(json.en.summary);
            if (maybeInner && (maybeInner.en || maybeInner.ar)) {
              json = maybeInner;
            }
          }
        } catch (_) { /* swallow; render whatever we got */ }
        setAiResult(json);
      }
    } catch (e) {
      setAiError(String(e.message || e));
    }
    setAiLoading(false);
  }

  function Badge(propsB) {
    var c = sevColor(propsB.severity);
    return <span className={'px-2 py-1 rounded text-[10px] font-extrabold text-white ' + c.dot}>{c.label}</span>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', paddingLeft: 8, paddingRight: 8 }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-2"
        onClick={function (e) { e.stopPropagation(); }}
      >
        {/* ---------- Header ----------
            v55.83-A.6.27.21 — per Max: previous header had white-ish text
            on light bg-indigo-100. Switched to SOLID DARK bg (indigo-700)
            with white text, using inline style for color to defend against
            any class-loading failure. Close button is now BIG, DARK, and
            obvious (was small slate-300 border on white/70 — easily missed). */}
        <div
          className="px-5 py-4 rounded-t-2xl"
          style={{ background: '#3730a3', borderBottom: '2px solid #4338ca' }}
        >
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-3xl">🤖</span>
                <span className="text-lg font-extrabold" style={{ color: '#ffffff' }}>AI Accountant Review</span>
              </div>
              <div className="text-base font-extrabold mt-1" style={{ direction: 'rtl', color: '#e0e7ff' }}>مراجعة المحاسب الذكي</div>
              <div className="text-sm mt-2 font-medium" style={{ color: '#e0e7ff' }}>
                Scans treasury, invoices, checks, Egypt Bank, and debts for reconciliation issues.
              </div>
              <div className="text-sm font-medium mt-0.5" style={{ direction: 'rtl', color: '#e0e7ff' }}>
                يفحص الخزنة والفواتير والشيكات وبنك مصر والمديونيات للبحث عن مشاكل مطابقة.
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-full font-extrabold hover:opacity-80 active:scale-95 transition"
              style={{ background: '#ffffff', color: '#1e293b', width: 40, height: 40, fontSize: 22, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* ---------- Headline verdict ---------- */}
          <div className={'rounded-lg p-4 border ' + (audit.cleanBillOfHealth ? 'bg-emerald-50 border-emerald-300' : audit.bySeverity.critical > 0 ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-extrabold text-slate-900">
                  {audit.cleanBillOfHealth ? '✅ Clean Bill of Health' : audit.bySeverity.critical > 0 ? '🚨 ' + audit.bySeverity.critical + ' critical issue(s) found' : '⚠️ ' + audit.bySeverity.warning + ' warning(s) found'}
                </div>
                <div className="text-base font-bold text-slate-800 mt-0.5" style={{ direction: 'rtl' }}>
                  {audit.cleanBillOfHealth ? '✅ الحسابات في حالة جيدة' : audit.bySeverity.critical > 0 ? '🚨 وُجدت ' + audit.bySeverity.critical + ' مشكلة حرجة' : '⚠️ وُجد ' + audit.bySeverity.warning + ' تنبيه'}
                </div>
              </div>
              <div className="flex gap-2">
                {audit.bySeverity.critical > 0 && (
                  <div className="px-3 py-1.5 rounded bg-red-600 text-white text-sm font-extrabold shadow">{audit.bySeverity.critical}</div>
                )}
                {audit.bySeverity.warning > 0 && (
                  <div className="px-3 py-1.5 rounded bg-amber-600 text-white text-sm font-extrabold shadow">{audit.bySeverity.warning}</div>
                )}
                {audit.bySeverity.info > 0 && (
                  <div className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-extrabold shadow">{audit.bySeverity.info}</div>
                )}
              </div>
            </div>
          </div>

          {/* ---------- Metrics strip ---------- */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="text-[11px] text-slate-700 font-extrabold">Treasury Net / صافي الخزنة</div>
              <div className={'text-base font-extrabold ' + (audit.metrics.treasuryNet >= 0 ? 'text-emerald-700' : 'text-red-700')}>{fE(audit.metrics.treasuryNet)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="text-[11px] text-slate-700 font-extrabold">Outstanding / المتبقي</div>
              <div className="text-base font-extrabold text-amber-700">{fE(audit.metrics.totalOutstanding)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="text-[11px] text-slate-700 font-extrabold">Pending Checks / شيكات معلقة</div>
              <div className="text-base font-extrabold text-blue-700">{fE(audit.metrics.pendingChecksTotal)}</div>
              <div className="text-[10px] text-slate-700 font-semibold">{audit.metrics.pendingCheckCount} checks</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="text-[11px] text-slate-700 font-extrabold">Unmatched Bank / بنك غير مطابق</div>
              <div className="text-base font-extrabold text-indigo-700">{audit.metrics.unmatchedBankCount}</div>
            </div>
          </div>

          {/* ---------- AI Analysis Section ---------- */}
          <div className="rounded-lg border-2 border-indigo-400 bg-indigo-100 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-indigo-900">🧠 Get AI Executive Summary</div>
                <div className="text-xs text-indigo-800 mt-0.5 font-medium">Claude reads the findings above and writes a plain-language summary + top 3 actions (bilingual).</div>
              </div>
              {!aiResult && !aiLoading && (
                <button
                  onClick={requestAiAnalysis}
                  className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-extrabold hover:bg-indigo-800 shrink-0 shadow"
                >
                  Analyze / حلّل
                </button>
              )}
              {aiLoading && (
                <div className="text-sm text-indigo-800 font-extrabold animate-pulse">Thinking... / جارٍ التحليل...</div>
              )}
            </div>
            {aiError && (
              <div className="mt-2 text-base text-red-700 font-extrabold bg-red-50 border-2 border-red-300 rounded-lg p-2">⚠ Error: {aiError}</div>
            )}
            {aiResult && (
              <div className="mt-3 space-y-3">
                {aiResult.en && aiResult.en.verdict && (
                  <div className="bg-white rounded-lg p-4 border-2 border-indigo-500 shadow-sm">
                    <div className="text-[11px] text-indigo-700 font-extrabold mb-1.5 tracking-wider">VERDICT / الحكم</div>
                    <div className="text-base font-extrabold text-slate-900 leading-relaxed">{aiResult.en.verdict}</div>
                    <div className="text-base font-extrabold text-slate-800 mt-2 leading-relaxed pt-2 border-t border-slate-200" style={{ direction: 'rtl' }}>{aiResult.ar && aiResult.ar.verdict}</div>
                  </div>
                )}
                {aiResult.en && aiResult.en.summary && (
                  <div className="bg-white rounded-lg p-4 border-2 border-indigo-500 shadow-sm">
                    <div className="text-[11px] text-indigo-700 font-extrabold mb-1.5 tracking-wider">SUMMARY / الملخص</div>
                    <div className="text-base leading-relaxed whitespace-pre-wrap text-slate-900 font-medium">{aiResult.en.summary}</div>
                    {aiResult.ar && aiResult.ar.summary && (
                      <div className="text-base leading-relaxed whitespace-pre-wrap mt-3 pt-3 border-t border-slate-200 text-slate-800 font-medium" style={{ direction: 'rtl' }}>{aiResult.ar.summary}</div>
                    )}
                  </div>
                )}
                {aiResult.en && aiResult.en.topActions && aiResult.en.topActions.length > 0 && (
                  <div className="bg-white rounded-lg p-4 border-2 border-indigo-500 shadow-sm">
                    <div className="text-[11px] text-indigo-700 font-extrabold mb-2 tracking-wider">TOP ACTIONS / أهم الإجراءات</div>
                    <ol className="text-base list-decimal ml-5 space-y-1.5 text-slate-900 font-semibold">
                      {aiResult.en.topActions.map(function (a, i) { return <li key={i} className="leading-relaxed">{a}</li>; })}
                    </ol>
                    {aiResult.ar && aiResult.ar.topActions && aiResult.ar.topActions.length > 0 && (
                      <ol className="text-base list-decimal mr-5 space-y-1.5 mt-3 pt-3 border-t border-slate-200 text-slate-800 font-semibold" style={{ direction: 'rtl' }}>
                        {aiResult.ar.topActions.map(function (a, i) { return <li key={i} className="leading-relaxed">{a}</li>; })}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---------- Findings list ---------- */}
          {audit.findings.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">✅</div>
              <div className="text-base font-extrabold text-emerald-700">Everything reconciles cleanly</div>
              <div className="text-sm text-slate-700 font-semibold" style={{ direction: 'rtl' }}>كل الحسابات متطابقة بنجاح</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-extrabold text-slate-800 mt-2">📋 Detailed Findings / النتائج التفصيلية</div>
              {audit.findings.map(function (f, i) {
                var c = sevColor(f.severity);
                var open = expandedFinding === i;
                return (
                  <div key={i} className={'rounded-lg border-2 ' + c.bg + ' ' + c.border}>
                    <button
                      onClick={function () { setExpandedFinding(open ? null : i); }}
                      className="w-full px-3 py-3 text-left"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge severity={f.severity} />
                            <span className={'text-base font-extrabold ' + c.text}>{f.titleEn}</span>
                          </div>
                          <div className={'text-base font-extrabold mt-1 ' + c.text} style={{ direction: 'rtl' }}>{f.titleAr}</div>
                          {f.totalImpact && f.totalImpact > 0 && (
                            <div className="text-sm text-slate-900 mt-1.5 font-extrabold">💰 Impact: {fE(f.totalImpact)}</div>
                          )}
                        </div>
                        <div className="text-slate-700 text-xl shrink-0 font-bold">{open ? '▲' : '▼'}</div>
                      </div>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2 border-t-2 border-white pt-3">
                        <div className="text-base text-slate-900 font-semibold leading-relaxed">{f.descEn}</div>
                        <div className="text-base text-slate-800 font-semibold leading-relaxed" style={{ direction: 'rtl' }}>{f.descAr}</div>

                        <div className="bg-white rounded-lg p-3 border-2 border-emerald-400 shadow-sm">
                          <div className="text-[11px] font-extrabold text-emerald-700 mb-1.5 tracking-wider">💡 RECOMMENDED ACTION / الإجراء المقترح</div>
                          <div className="text-base text-slate-900 font-semibold leading-relaxed">{f.actionEn}</div>
                          <div className="text-base text-slate-800 font-semibold leading-relaxed mt-1.5 pt-1.5 border-t border-slate-200" style={{ direction: 'rtl' }}>{f.actionAr}</div>
                        </div>

                        {f.items && f.items.length > 0 && (
                          <div className="bg-white rounded-lg p-3 border-2 border-amber-400 shadow-sm">
                            <div className="text-[11px] font-extrabold text-amber-700 mb-1.5 tracking-wider">📄 AFFECTED RECORDS ({f.count}){f.items.length < f.count ? ' — showing first ' + f.items.length : ''}</div>
                            <div className="text-xs font-mono text-slate-900 space-y-1 max-h-56 overflow-auto">
                              {f.items.map(function (item, idx) {
                                return (
                                  <div key={idx} className="pb-1 border-b border-slate-200 last:border-0">
                                    {Object.entries(item).map(function (entry, ei) {
                                      return (
                                        <span key={ei} className="mr-3 inline-block">
                                          <span className="text-amber-700 font-bold">{entry[0]}:</span> <span className="text-slate-900 font-semibold">{typeof entry[1] === 'number' ? entry[1].toLocaleString() : String(entry[1] || '—').substring(0, 50)}</span>
                                        </span>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-xs text-slate-600 text-center font-semibold pt-2">
            Generated {fmtET(audit.generatedAt, 'datetime')} · {audit.metrics.treasuryRowCount} treasury rows · {audit.metrics.invoiceRowCount} invoices
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 rounded-b-2xl bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-900"
          >
            Close / إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
