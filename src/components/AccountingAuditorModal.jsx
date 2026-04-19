'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { runAccountingAudit } from '../lib/accounting-auditor';

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
  if (s === 'critical') return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', dot: 'bg-red-500', label: 'CRITICAL / حرج' };
  if (s === 'warning') return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', dot: 'bg-amber-500', label: 'WARNING / تنبيه' };
  return { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', dot: 'bg-blue-500', label: 'INFO / معلومة' };
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
        setAiResult(json);
      }
    } catch (e) {
      setAiError(String(e.message || e));
    }
    setAiLoading(false);
  }

  function Badge(propsB) {
    var c = sevColor(propsB.severity);
    return <span className={'px-1.5 py-0.5 rounded text-[9px] font-extrabold text-white ' + c.dot}>{c.label}</span>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-2 md:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-4"
        onClick={function (e) { e.stopPropagation(); }}
      >
        {/* ---------- Header ---------- */}
        <div className="px-5 py-4 rounded-t-2xl border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-blue-50">
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <span className="text-base font-extrabold text-slate-800">AI Accountant Review</span>
              </div>
              <div className="text-sm font-bold text-slate-700 mt-0.5" style={{ direction: 'rtl' }}>مراجعة المحاسب الذكي</div>
              <div className="text-[11px] text-slate-500 mt-1">
                Scans treasury, invoices, checks, Egypt Bank, and debts for reconciliation issues.
              </div>
              <div className="text-[11px] text-slate-500" style={{ direction: 'rtl' }}>
                يفحص الخزنة والفواتير والشيكات وبنك مصر والمديونيات للبحث عن مشاكل مطابقة.
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 hover:bg-white bg-white/70 shrink-0"
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
                <div className="text-sm font-extrabold">
                  {audit.cleanBillOfHealth ? '✅ Clean Bill of Health' : audit.bySeverity.critical > 0 ? '🚨 ' + audit.bySeverity.critical + ' critical issue(s) found' : '⚠️ ' + audit.bySeverity.warning + ' warning(s) found'}
                </div>
                <div className="text-sm font-bold" style={{ direction: 'rtl' }}>
                  {audit.cleanBillOfHealth ? '✅ الحسابات في حالة جيدة' : audit.bySeverity.critical > 0 ? '🚨 وُجدت ' + audit.bySeverity.critical + ' مشكلة حرجة' : '⚠️ وُجد ' + audit.bySeverity.warning + ' تنبيه'}
                </div>
              </div>
              <div className="flex gap-2">
                {audit.bySeverity.critical > 0 && (
                  <div className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-extrabold">{audit.bySeverity.critical}</div>
                )}
                {audit.bySeverity.warning > 0 && (
                  <div className="px-2.5 py-1 rounded bg-amber-500 text-white text-xs font-extrabold">{audit.bySeverity.warning}</div>
                )}
                {audit.bySeverity.info > 0 && (
                  <div className="px-2.5 py-1 rounded bg-blue-500 text-white text-xs font-extrabold">{audit.bySeverity.info}</div>
                )}
              </div>
            </div>
          </div>

          {/* ---------- Metrics strip ---------- */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-[9px] text-slate-500 font-bold">Treasury Net / صافي الخزنة</div>
              <div className={'text-sm font-extrabold ' + (audit.metrics.treasuryNet >= 0 ? 'text-emerald-600' : 'text-red-500')}>{fE(audit.metrics.treasuryNet)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-[9px] text-slate-500 font-bold">Outstanding / المتبقي</div>
              <div className="text-sm font-extrabold text-amber-600">{fE(audit.metrics.totalOutstanding)}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-[9px] text-slate-500 font-bold">Pending Checks / شيكات معلقة</div>
              <div className="text-sm font-extrabold text-blue-600">{fE(audit.metrics.pendingChecksTotal)}</div>
              <div className="text-[9px] text-slate-400">{audit.metrics.pendingCheckCount}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="text-[9px] text-slate-500 font-bold">Unmatched Bank / بنك غير مطابق</div>
              <div className="text-sm font-extrabold text-indigo-600">{audit.metrics.unmatchedBankCount}</div>
            </div>
          </div>

          {/* ---------- AI Analysis Section ---------- */}
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold text-indigo-800">🧠 Get AI Executive Summary</div>
                <div className="text-[10px] text-indigo-700 mt-0.5">Claude reads the findings above and writes a plain-language summary + top 3 actions (bilingual).</div>
              </div>
              {!aiResult && !aiLoading && (
                <button
                  onClick={requestAiAnalysis}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shrink-0"
                >
                  Analyze / حلّل
                </button>
              )}
              {aiLoading && (
                <div className="text-xs text-indigo-600 font-bold animate-pulse">Thinking... / جارٍ التحليل...</div>
              )}
            </div>
            {aiError && (
              <div className="mt-2 text-[11px] text-red-600">Error: {aiError}</div>
            )}
            {aiResult && (
              <div className="mt-3 space-y-3">
                {aiResult.en && aiResult.en.verdict && (
                  <div className="bg-white rounded p-3 border border-indigo-100">
                    <div className="text-[10px] text-slate-500 font-bold mb-1">VERDICT / الحكم</div>
                    <div className="text-xs font-semibold">{aiResult.en.verdict}</div>
                    <div className="text-xs font-semibold mt-1" style={{ direction: 'rtl' }}>{aiResult.ar && aiResult.ar.verdict}</div>
                  </div>
                )}
                {aiResult.en && aiResult.en.summary && (
                  <div className="bg-white rounded p-3 border border-indigo-100">
                    <div className="text-[10px] text-slate-500 font-bold mb-1">SUMMARY / الملخص</div>
                    <div className="text-[11px] leading-relaxed whitespace-pre-wrap">{aiResult.en.summary}</div>
                    {aiResult.ar && aiResult.ar.summary && (
                      <div className="text-[11px] leading-relaxed whitespace-pre-wrap mt-2 pt-2 border-t border-slate-100" style={{ direction: 'rtl' }}>{aiResult.ar.summary}</div>
                    )}
                  </div>
                )}
                {aiResult.en && aiResult.en.topActions && aiResult.en.topActions.length > 0 && (
                  <div className="bg-white rounded p-3 border border-indigo-100">
                    <div className="text-[10px] text-slate-500 font-bold mb-1">TOP ACTIONS / أهم الإجراءات</div>
                    <ol className="text-[11px] list-decimal ml-4 space-y-1">
                      {aiResult.en.topActions.map(function (a, i) { return <li key={i}>{a}</li>; })}
                    </ol>
                    {aiResult.ar && aiResult.ar.topActions && aiResult.ar.topActions.length > 0 && (
                      <ol className="text-[11px] list-decimal mr-4 space-y-1 mt-2 pt-2 border-t border-slate-100" style={{ direction: 'rtl' }}>
                        {aiResult.ar.topActions.map(function (a, i) { return <li key={i}>{a}</li>; })}
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
              <div className="text-sm font-bold text-emerald-600">Everything reconciles cleanly</div>
              <div className="text-xs text-slate-500" style={{ direction: 'rtl' }}>كل الحسابات متطابقة بنجاح</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-extrabold text-slate-600 mt-2">📋 Detailed Findings / النتائج التفصيلية</div>
              {audit.findings.map(function (f, i) {
                var c = sevColor(f.severity);
                var open = expandedFinding === i;
                return (
                  <div key={i} className={'rounded-lg border ' + c.bg + ' ' + c.border}>
                    <button
                      onClick={function () { setExpandedFinding(open ? null : i); }}
                      className="w-full px-3 py-2.5 text-left"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge severity={f.severity} />
                            <span className={'text-xs font-extrabold ' + c.text}>{f.titleEn}</span>
                          </div>
                          <div className={'text-xs font-bold mt-0.5 ' + c.text} style={{ direction: 'rtl' }}>{f.titleAr}</div>
                          {f.totalImpact && f.totalImpact > 0 && (
                            <div className="text-[10px] text-slate-600 mt-1">Impact: {fE(f.totalImpact)}</div>
                          )}
                        </div>
                        <div className="text-slate-400 text-lg shrink-0">{open ? '▲' : '▼'}</div>
                      </div>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2 border-t border-white/50 pt-2">
                        <div className="text-[11px] text-slate-700">{f.descEn}</div>
                        <div className="text-[11px] text-slate-600" style={{ direction: 'rtl' }}>{f.descAr}</div>

                        <div className="bg-white/70 rounded p-2">
                          <div className="text-[10px] font-bold text-slate-600 mb-1">💡 Recommended Action / الإجراء المقترح</div>
                          <div className="text-[11px] text-slate-700">{f.actionEn}</div>
                          <div className="text-[11px] text-slate-600 mt-0.5" style={{ direction: 'rtl' }}>{f.actionAr}</div>
                        </div>

                        {f.items && f.items.length > 0 && (
                          <div className="bg-white/70 rounded p-2">
                            <div className="text-[10px] font-bold text-slate-600 mb-1">Affected records ({f.count}){f.items.length < f.count ? ' — showing first ' + f.items.length : ''}</div>
                            <div className="text-[10px] font-mono text-slate-700 space-y-0.5 max-h-48 overflow-auto">
                              {f.items.map(function (item, idx) {
                                return (
                                  <div key={idx} className="truncate">
                                    {Object.entries(item).map(function (entry, ei) {
                                      return (
                                        <span key={ei} className="mr-2">
                                          <span className="text-slate-400">{entry[0]}:</span> <span>{typeof entry[1] === 'number' ? entry[1].toLocaleString() : String(entry[1] || '—').substring(0, 40)}</span>
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

          <div className="text-[9px] text-slate-400 text-center">
            Generated {new Date(audit.generatedAt).toLocaleString()} · {audit.metrics.treasuryRowCount} treasury rows · {audit.metrics.invoiceRowCount} invoices
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
