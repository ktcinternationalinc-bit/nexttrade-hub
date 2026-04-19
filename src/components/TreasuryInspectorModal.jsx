'use client';
import React, { useMemo } from 'react';
import { classifyTreasuryTransaction } from '../lib/treasury-classifier';

// ============================================================
// TREASURY INSPECTOR MODAL
// Bilingual (AR/EN) full explanation of how a treasury transaction
// was handled, what it affects, and what other records it ties to.
// ============================================================

function fE(n) {
  var num = Number(n || 0);
  return 'EGP ' + num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
      (s.length > 10 ? ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '');
  } catch (e) { return s; }
}

function colorClasses(color) {
  var map = {
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', ring: 'ring-emerald-200' },
    red: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-800', ring: 'ring-red-200' },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-800', ring: 'ring-indigo-200' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', ring: 'ring-amber-200' },
    slate: { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700', ring: 'ring-slate-200' }
  };
  return map[color] || map.slate;
}

export default function TreasuryInspectorModal(props) {
  var txn = props.txn;
  var onClose = props.onClose || function () {};
  var lang = props.lang || 'en'; // 'en' | 'ar'
  var ctx = {
    invoices: props.invoices || [],
    checks: props.checks || [],
    egyptBankTxns: props.egyptBankTxns || [],
    treasury: props.treasury || []
  };

  var c = useMemo(function () {
    return classifyTreasuryTransaction(txn, ctx);
  }, [txn, ctx.invoices, ctx.checks, ctx.egyptBankTxns, ctx.treasury]);

  if (!txn) return null;
  var cc = colorClasses(c.color);

  // Small helper to print a bilingual label pair
  function Bi(props) {
    return (
      <div className={props.className || ''}>
        <div className="text-xs text-slate-800">{props.en}</div>
        <div className="text-xs text-slate-600" style={{ direction: 'rtl' }}>{props.ar}</div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-2 md:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4"
        onClick={function (e) { e.stopPropagation(); }}
      >
        {/* ---- Header ---- */}
        <div className={'px-5 py-4 rounded-t-2xl border-b ' + cc.bg + ' ' + cc.border}>
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-2xl">{c.emoji}</span>
                <span className={'text-sm font-extrabold ' + cc.text}>{c.titleEn}</span>
              </div>
              <div className={'text-sm font-bold mt-1 ' + cc.text} style={{ direction: 'rtl' }}>{c.titleAr}</div>
              <div className="text-[11px] text-slate-700 mt-2">{c.subtypeEn}</div>
              <div className="text-[11px] text-slate-600 mt-0.5" style={{ direction: 'rtl' }}>{c.subtypeAr}</div>
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
          {/* ---- Warnings ---- */}
          {c.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
              <div className="text-[11px] font-extrabold text-amber-800">⚠️ Reconciliation Warnings / تنبيهات المطابقة</div>
              {c.warnings.map(function (w, i) {
                return (
                  <div key={i} className="text-[11px] text-amber-900">
                    <div>• {w.en}</div>
                    <div style={{ direction: 'rtl' }}>• {w.ar}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Core facts ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Transaction / المعاملة</div>
              <div className="text-xs text-slate-500">Date</div>
              <div className="text-sm font-bold">{fmtDate(txn.transaction_date)}</div>
              <div className="text-xs text-slate-500 mt-2">Order # / رقم الأمر</div>
              <div className="text-sm font-bold">{txn.order_number || '—'}</div>
              <div className="text-xs text-slate-500 mt-2">Description / الوصف</div>
              <div className="text-[11px] text-slate-700" style={{ direction: 'rtl', wordBreak: 'break-word' }}>{txn.description || '—'}</div>
              {txn.category && (
                <>
                  <div className="text-xs text-slate-500 mt-2">Category / التصنيف</div>
                  <div className="text-[11px] font-semibold">{txn.category}{txn.subcategory ? ' › ' + txn.subcategory : ''}</div>
                </>
              )}
            </div>

            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Amount / المبلغ</div>
              {c.amounts.cashIn > 0 && (
                <div className="flex justify-between"><span className="text-xs">Cash In / وارد</span><span className="text-sm font-extrabold text-emerald-600">{fE(c.amounts.cashIn)}</span></div>
              )}
              {c.amounts.cashOut > 0 && (
                <div className="flex justify-between"><span className="text-xs">Cash Out / صادر</span><span className="text-sm font-extrabold text-red-500">{fE(c.amounts.cashOut)}</span></div>
              )}
              {c.amounts.usdIn > 0 && (
                <div className="flex justify-between"><span className="text-xs">USD In / وارد دولار</span><span className="text-sm font-extrabold text-emerald-600">${c.amounts.usdIn.toLocaleString()}</span></div>
              )}
              {c.amounts.usdOut > 0 && (
                <div className="flex justify-between"><span className="text-xs">USD Out / صادر دولار</span><span className="text-sm font-extrabold text-red-500">${c.amounts.usdOut.toLocaleString()}</span></div>
              )}
              {c.amounts.foreignAmt > 0 && (
                <div className="flex justify-between"><span className="text-xs">{c.amounts.foreignCur || 'Foreign'} {c.amounts.foreignDir === 'in' ? 'In' : 'Out'}</span><span className="text-sm font-extrabold">{c.amounts.foreignAmt.toLocaleString()}</span></div>
              )}
              {c.amounts.cashIn === 0 && c.amounts.cashOut === 0 && c.amounts.usdIn === 0 && c.amounts.usdOut === 0 && c.amounts.foreignAmt === 0 && (
                <div className="text-xs text-slate-400 italic">No amount / بدون مبلغ</div>
              )}
              {txn.is_bank_placeholder && txn.expected_amount > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <div className="text-xs text-indigo-600">Expected / متوقع: {c.amounts.foreignDir === 'out' ? '-' : ''}{fE(txn.expected_amount)}</div>
                </div>
              )}
            </div>
          </div>

          {/* ---- Effects ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Effect on Treasury Net / صافي الخزنة</div>
              <div className="text-[11px] text-slate-700">{c.netEffect.en}</div>
              <div className="text-[11px] text-slate-600" style={{ direction: 'rtl' }}>{c.netEffect.ar}</div>
              {c.netEffect.delta !== 0 && (
                <div className={'text-sm font-extrabold mt-1 ' + (c.netEffect.delta > 0 ? 'text-emerald-600' : 'text-red-500')}>
                  {c.netEffect.delta > 0 ? '+' : ''}{c.netEffect.delta.toLocaleString()} EGP
                </div>
              )}
            </div>

            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Effect on Invoice Collected / المحصّل</div>
              <div className="text-[11px] text-slate-700">{c.collectedEffect.en}</div>
              <div className="text-[11px] text-slate-600" style={{ direction: 'rtl' }}>{c.collectedEffect.ar}</div>
              {c.collectedEffect.delta !== 0 && (
                <div className="text-sm font-extrabold mt-1 text-emerald-600">+{c.collectedEffect.delta.toLocaleString()} EGP</div>
              )}
            </div>
          </div>

          {/* ---- Linked Invoice ---- */}
          {c.related.invoice && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-emerald-700 uppercase mb-2">🧾 Linked Invoice / الفاتورة المرتبطة</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Customer:</span> <span className="font-semibold" style={{ direction: 'rtl' }}>{c.related.invoice.customer_name || '—'}</span></div>
                <div><span className="text-slate-500">Order #:</span> <span className="font-bold">{c.related.invoice.order_number || '—'}</span></div>
                <div><span className="text-slate-500">Invoice total:</span> <span className="font-bold">{fE(c.related.invoice.total_amount)}</span></div>
                <div><span className="text-slate-500">Collected so far:</span> <span className="font-bold text-emerald-600">{fE(c.related.invoice.total_collected)}</span></div>
                <div><span className="text-slate-500">Outstanding:</span> <span className={'font-bold ' + (Number(c.related.invoice.outstanding || 0) > 0 ? 'text-red-500' : 'text-slate-400')}>{fE(c.related.invoice.outstanding)}</span></div>
                <div><span className="text-slate-500">Status:</span> <span className="font-semibold">{c.related.invoice.status || '—'}</span></div>
              </div>
              {props.onOpenInvoice && (
                <button
                  onClick={function () { props.onOpenInvoice(c.related.invoice); onClose(); }}
                  className="mt-2 text-[11px] text-emerald-700 font-bold hover:underline"
                >
                  → Open invoice / فتح الفاتورة
                </button>
              )}
            </div>
          )}

          {/* ---- Linked Check ---- */}
          {c.related.linkedCheck && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-blue-700 uppercase mb-2">📝 Linked Check / الشيك المرتبط</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Check #:</span> <span className="font-bold">{c.related.linkedCheck.check_number || '—'}</span></div>
                <div><span className="text-slate-500">Amount:</span> <span className="font-bold">{fE(c.related.linkedCheck.amount)}</span></div>
                <div><span className="text-slate-500">Due date:</span> <span className="font-semibold">{c.related.linkedCheck.due_date || c.related.linkedCheck.check_date || '—'}</span></div>
                <div><span className="text-slate-500">Status:</span> <span className="font-semibold text-emerald-600">{c.related.linkedCheck.status}</span></div>
                {c.related.linkedCheck.collection_date && (
                  <div className="col-span-2"><span className="text-slate-500">Collected on:</span> <span className="font-bold">{c.related.linkedCheck.collection_date}</span></div>
                )}
                {c.related.linkedCheck.bank_name && (
                  <div className="col-span-2"><span className="text-slate-500">Bank:</span> <span className="font-semibold">{c.related.linkedCheck.bank_name}</span></div>
                )}
              </div>
            </div>
          )}

          {/* ---- Linked Egypt Bank Transaction ---- */}
          {c.related.linkedBank && (
            <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-indigo-700 uppercase mb-2">🏦 Linked Bank Transaction / المعاملة البنكية المرتبطة</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Date:</span> <span className="font-bold">{c.related.linkedBank.date}</span></div>
                <div><span className="text-slate-500">Amount:</span> <span className={'font-bold ' + (Number(c.related.linkedBank.amount) > 0 ? 'text-emerald-600' : 'text-red-500')}>{fE(Math.abs(Number(c.related.linkedBank.amount)))}</span></div>
                <div className="col-span-2">
                  <span className="text-slate-500">Description:</span>
                  <div className="text-[11px] mt-0.5" style={{ wordBreak: 'break-word' }}>{c.related.linkedBank.description || '—'}</div>
                </div>
              </div>
            </div>
          )}

          {/* ---- Dedup Sibling ---- */}
          {c.related.dedupSibling && (
            <div className="border border-slate-300 bg-slate-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-700 uppercase mb-2">🔗 Original Entry (Where the Money Counted) / القيد الأصلي (المُحتسب)</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Date:</span> <span className="font-bold">{c.related.dedupSibling.transaction_date}</span></div>
                <div><span className="text-slate-500">Cash in:</span> <span className="font-bold text-emerald-600">{fE(c.related.dedupSibling.cash_in)}</span></div>
                <div className="col-span-2">
                  <span className="text-slate-500">Description:</span>
                  <div className="text-[11px] mt-0.5" style={{ direction: 'rtl', wordBreak: 'break-word' }}>{c.related.dedupSibling.description || '—'}</div>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                This current row exists only to record that the bank confirmed the deposit. The actual +{fE(c.related.dedupSibling.cash_in)} landed on the row shown here.
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5" style={{ direction: 'rtl' }}>
                هذا القيد موجود فقط لتسجيل تأكيد البنك للإيداع. المبلغ الفعلي +{fE(c.related.dedupSibling.cash_in)} مسجّل على القيد أعلاه.
              </div>
            </div>
          )}

          {/* ---- Split Family ---- */}
          {c.related.splitFamily.length > 0 && (
            <div className="border border-purple-200 bg-purple-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-purple-700 uppercase mb-2">🪓 Related Entries (Same Order, Same Day) / قيود ذات صلة</div>
              {c.related.splitFamily.map(function (s) {
                return (
                  <div key={s.id} className="text-[11px] flex justify-between py-0.5">
                    <span className="truncate" style={{ direction: 'rtl' }}>{(s.description || '').substring(0, 50)}</span>
                    <span className="font-bold ml-2">
                      {Number(s.cash_in) > 0 ? '+' + fE(s.cash_in) : ''}
                      {Number(s.cash_out) > 0 ? '-' + fE(s.cash_out) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Timeline ---- */}
          {c.timeline.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">🕐 Timeline / السجل الزمني</div>
              <div className="space-y-1.5">
                {c.timeline.map(function (t, i) {
                  return (
                    <div key={i} className="text-[11px] flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <div className="font-semibold text-slate-700">{t.labelEn}</div>
                        <div className="text-slate-500" style={{ direction: 'rtl' }}>{t.labelAr}</div>
                      </div>
                      <div className="text-slate-500 whitespace-nowrap">{fmtDate(t.when)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---- Debug row id (small, for support / audit) ---- */}
          <div className="text-[9px] text-slate-400 text-center pt-1">
            txn id: {txn.id}{txn.created_by ? ' · created_by: ' + String(txn.created_by).substring(0, 8) : ''}
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
