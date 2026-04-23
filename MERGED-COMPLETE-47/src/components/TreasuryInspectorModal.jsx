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
    emerald: { bg: 'bg-emerald-700', border: 'border-emerald-900', text: 'text-white', subText: 'text-white' },
    red: { bg: 'bg-red-700', border: 'border-red-900', text: 'text-white', subText: 'text-white' },
    indigo: { bg: 'bg-indigo-700', border: 'border-indigo-900', text: 'text-white', subText: 'text-white' },
    amber: { bg: 'bg-amber-700', border: 'border-amber-900', text: 'text-white', subText: 'text-white' },
    slate: { bg: 'bg-slate-800', border: 'border-slate-950', text: 'text-white', subText: 'text-white' }
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
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 'max(16px, env(safe-area-inset-top))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        paddingLeft: 8,
        paddingRight: 8
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl"
        onClick={function (e) { e.stopPropagation(); }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '100%',
          minHeight: 0
        }}
      >
        {/* ---- Header (dark, high contrast, ALWAYS VISIBLE) ---- */}
        <div
          className={'px-5 py-4 rounded-t-2xl ' + cc.bg + ' border-b-4 ' + cc.border}
          style={{ flexShrink: 0 }}
        >
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-3xl">{c.emoji}</span>
                <span className={'text-lg font-extrabold ' + cc.text}>{c.titleEn}</span>
              </div>
              <div className={'text-lg font-bold mt-1 ' + cc.text} style={{ direction: 'rtl' }}>{c.titleAr}</div>
              <div className={'text-sm mt-2 font-semibold ' + cc.subText}>{c.subtypeEn}</div>
              <div className={'text-sm mt-0.5 font-semibold ' + cc.subText} style={{ direction: 'rtl' }}>{c.subtypeAr}</div>
            </div>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-base font-extrabold text-slate-900 bg-white hover:bg-slate-100 shadow"
              style={{ flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ---- Scrolling body ---- */}
        <div
          className="p-5 space-y-4"
          style={{
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: '1 1 auto',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {/* ---- Warnings ---- */}
          {c.warnings.length > 0 && (
            <div className="bg-amber-100 border-2 border-amber-500 rounded-lg p-3 space-y-2">
              <div className="text-sm font-extrabold text-amber-900">⚠️ Reconciliation Warnings / تنبيهات المطابقة</div>
              {c.warnings.map(function (w, i) {
                return (
                  <div key={i} className="text-sm text-amber-950 font-medium leading-relaxed">
                    <div>• {w.en}</div>
                    <div style={{ direction: 'rtl' }}>• {w.ar}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Core facts ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-100 border-2 border-slate-300 rounded-lg p-3">
              <div className="text-xs font-extrabold text-slate-700 uppercase mb-2 tracking-wider">Transaction / المعاملة</div>
              <div className="text-xs text-slate-700 font-semibold">Date</div>
              <div className="text-sm font-extrabold text-slate-900">{fmtDate(txn.transaction_date)}</div>
              <div className="text-xs text-slate-700 font-semibold mt-2">Order # / رقم الأمر</div>
              <div className="text-sm font-extrabold text-slate-900">{txn.order_number || '—'}</div>
              <div className="text-xs text-slate-700 font-semibold mt-2">Description / الوصف</div>
              <div className="text-sm text-slate-900 font-medium leading-relaxed" style={{ direction: 'rtl', wordBreak: 'break-word' }}>{txn.description || '—'}</div>
              {txn.category && (
                <>
                  <div className="text-xs text-slate-700 font-semibold mt-2">Category / التصنيف</div>
                  <div className="text-sm font-extrabold text-slate-900">{txn.category}{txn.subcategory ? ' › ' + txn.subcategory : ''}</div>
                </>
              )}
            </div>

            <div className="bg-slate-100 border-2 border-slate-300 rounded-lg p-3">
              <div className="text-xs font-extrabold text-slate-700 uppercase mb-2 tracking-wider">Amount / المبلغ</div>
              {c.amounts.cashIn > 0 && (
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-sm font-semibold text-slate-800">
                    Cash In / وارد نقدي
                    {txn.cash_method === 'vodafone' && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-bold">📱 Vodafone</span>}
                    {txn.cash_method === 'instapay' && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">⚡ InstaPay</span>}
                  </span>
                  <span className="text-base font-extrabold text-emerald-700">{fE(c.amounts.cashIn)}</span>
                </div>
              )}
              {c.amounts.cashOut > 0 && (
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-sm font-semibold text-slate-800">
                    Cash Out / صادر نقدي
                    {txn.cash_method === 'vodafone' && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-bold">📱 Vodafone</span>}
                    {txn.cash_method === 'instapay' && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">⚡ InstaPay</span>}
                  </span>
                  <span className="text-base font-extrabold text-red-700">{fE(c.amounts.cashOut)}</span>
                </div>
              )}
              {Number(txn.bank_in || 0) > 0 && (
                <div className="flex justify-between items-center py-0.5"><span className="text-sm font-semibold text-indigo-800">🏦 Bank In / وارد بنكي</span><span className="text-base font-extrabold text-indigo-700">{fE(txn.bank_in)}</span></div>
              )}
              {Number(txn.bank_out || 0) > 0 && (
                <div className="flex justify-between items-center py-0.5"><span className="text-sm font-semibold text-indigo-800">🏦 Bank Out / صادر بنكي</span><span className="text-base font-extrabold text-indigo-700">{fE(txn.bank_out)}</span></div>
              )}
              {c.amounts.usdIn > 0 && (
                <div className="flex justify-between items-center py-0.5"><span className="text-sm font-semibold text-slate-800">USD In / وارد دولار</span><span className="text-base font-extrabold text-emerald-700">${c.amounts.usdIn.toLocaleString()}</span></div>
              )}
              {c.amounts.usdOut > 0 && (
                <div className="flex justify-between items-center py-0.5"><span className="text-sm font-semibold text-slate-800">USD Out / صادر دولار</span><span className="text-base font-extrabold text-red-700">${c.amounts.usdOut.toLocaleString()}</span></div>
              )}
              {c.amounts.foreignAmt > 0 && (
                <div className="flex justify-between items-center py-0.5"><span className="text-sm font-semibold text-slate-800">{c.amounts.foreignCur || 'Foreign'} {c.amounts.foreignDir === 'in' ? 'In' : 'Out'}</span><span className="text-base font-extrabold text-slate-900">{c.amounts.foreignAmt.toLocaleString()}</span></div>
              )}
              {c.amounts.cashIn === 0 && c.amounts.cashOut === 0 && Number(txn.bank_in || 0) === 0 && Number(txn.bank_out || 0) === 0 && c.amounts.usdIn === 0 && c.amounts.usdOut === 0 && c.amounts.foreignAmt === 0 && !(txn.matched_bank_txn_id && Number(txn.expected_amount || 0) > 0) && !txn.is_bank_placeholder && (
                <div className="text-sm text-slate-700 italic font-medium">No amount / بدون مبلغ</div>
              )}
              {txn.is_bank_placeholder && txn.expected_amount > 0 && (
                <div className="mt-2 pt-2 border-t-2 border-slate-300">
                  <div className="text-sm font-extrabold text-indigo-800">Expected / متوقع: {c.amounts.foreignDir === 'out' ? '-' : ''}{fE(txn.expected_amount)}</div>
                </div>
              )}
              {/* Legacy matched row — amount is in cash_in/expected_amount instead of bank_in.
                  Still display the figure so the user isn't looking at a blank. */}
              {txn.matched_bank_txn_id && !txn.is_bank_placeholder
                && Number(txn.bank_in || 0) === 0 && Number(txn.bank_out || 0) === 0
                && (Number(txn.expected_amount || 0) > 0 || Number(txn.cash_in || 0) > 0 || Number(txn.cash_out || 0) > 0) && (
                <div className="mt-2 pt-2 border-t-2 border-amber-300 bg-amber-50 -mx-3 px-3 py-2">
                  <div className="text-sm font-extrabold text-amber-900">
                    Matched bank amount / المبلغ المطابق: {fE(Number(txn.expected_amount || 0) || Number(txn.cash_in || 0) || Number(txn.cash_out || 0))}
                  </div>
                  <div className="text-[11px] text-amber-800 mt-1 italic">
                    This row was matched before the bank-separation migration ran. Amount currently sits in cash_in/expected_amount instead of bank_in. Running the migration will move it.
                  </div>
                  <div className="text-[11px] text-amber-800 mt-1 italic" style={{direction:'rtl'}}>
                    تمت مطابقة هذا القيد قبل تشغيل ترقية الفصل البنكي. المبلغ حاليًا في cash_in بدلًا من bank_in. شغّل الترقية لنقله.
                  </div>
                </div>
              )}
              {(Number(txn.bank_in || 0) > 0 || Number(txn.bank_out || 0) > 0 || txn.is_bank_placeholder || txn.matched_bank_txn_id) && (
                <div className="mt-2 pt-2 border-t-2 border-indigo-300 bg-indigo-50 -mx-3 -mb-3 px-3 pb-3 rounded-b">
                  <div className="text-[11px] font-extrabold text-indigo-900 uppercase tracking-wider mb-1">🏦 Bank Entry Notice</div>
                  <div className="text-xs text-indigo-900 leading-snug">
                    This row is a bank entry. It affects the linked invoice's collected amount only — it does <b>NOT</b> affect the treasury (safe) Cash In, Cash Out, or Net.
                  </div>
                  <div className="text-xs text-indigo-900 leading-snug mt-1" style={{ direction: 'rtl' }}>
                    هذا القيد بنكي. يؤثر على المبلغ المحصّل في الفاتورة فقط — لا يؤثر على رصيد الخزنة.
                  </div>
                  {txn.bank_nonorder_category && (
                    <div className="mt-1.5 text-[11px] font-bold text-indigo-800">Non-Order category: {txn.bank_nonorder_category}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---- Effects ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-100 border-2 border-slate-300 rounded-lg p-3">
              <div className="text-xs font-extrabold text-slate-700 uppercase mb-2 tracking-wider">Effect on Treasury Net / صافي الخزنة</div>
              <div className="text-sm text-slate-900 font-medium leading-relaxed">{c.netEffect.en}</div>
              <div className="text-sm text-slate-800 font-medium leading-relaxed mt-1" style={{ direction: 'rtl' }}>{c.netEffect.ar}</div>
              {c.netEffect.delta !== 0 && (
                <div className={'text-lg font-extrabold mt-2 ' + (c.netEffect.delta > 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {c.netEffect.delta > 0 ? '+' : ''}{c.netEffect.delta.toLocaleString()} EGP
                </div>
              )}
            </div>

            <div className="bg-slate-100 border-2 border-slate-300 rounded-lg p-3">
              <div className="text-xs font-extrabold text-slate-700 uppercase mb-2 tracking-wider">Effect on Invoice Collected / المحصّل</div>
              <div className="text-sm text-slate-900 font-medium leading-relaxed">{c.collectedEffect.en}</div>
              <div className="text-sm text-slate-800 font-medium leading-relaxed mt-1" style={{ direction: 'rtl' }}>{c.collectedEffect.ar}</div>
              {c.collectedEffect.delta !== 0 && (
                <div className="text-lg font-extrabold mt-2 text-emerald-700">+{c.collectedEffect.delta.toLocaleString()} EGP</div>
              )}
            </div>
          </div>

          {/* ---- MISSING LINK WARNING ----
              If the row has an order# + inflow + there's an invoice with that order# in
              the system BUT the treasury row isn't linked to it, surface the fix. */}
          {(function () {
            if (!txn || !txn.order_number) return null;
            if (txn.linked_invoice_id) return null;
            if (txn.is_bank_placeholder) return null;
            var inflow = Number(txn.cash_in || 0) + Number(txn.bank_in || 0);
            if (inflow <= 0 && !(txn.matched_bank_txn_id && Number(txn.expected_amount || 0) > 0)) return null;
            var match = (ctx.invoices || []).find(function (i) { return String(i.order_number || '').trim() === String(txn.order_number || '').trim(); });
            if (!match) {
              // Truly orphan — no invoice exists yet. Different message.
              return (
                <div className="border-2 border-amber-500 bg-amber-50 rounded-lg p-3">
                  <div className="text-xs font-extrabold text-amber-900 uppercase mb-2 tracking-wider">⏳ Waiting for invoice / بانتظار الفاتورة</div>
                  <div className="text-sm text-amber-900 font-semibold">Invoice #{txn.order_number} does not exist yet. This amount is tracked but not yet credited to any invoice. When you create invoice #{txn.order_number}, this row will auto-link and the invoice's collected total will update.</div>
                  <div className="text-sm text-amber-800 mt-1 font-semibold" style={{ direction: 'rtl' }}>
                    الفاتورة رقم {txn.order_number} غير موجودة بعد. هذا المبلغ مُسجّل لكن لم يُضف بعد إلى أي فاتورة. عند إنشاء الفاتورة، سيتم الربط تلقائيًا وسيتحدّث المحصّل.
                  </div>
                </div>
              );
            }
            // Invoice EXISTS — the row just isn't linked. This is a bug state to fix.
            return (
              <div className="border-2 border-red-500 bg-red-50 rounded-lg p-3">
                <div className="text-xs font-extrabold text-red-900 uppercase mb-2 tracking-wider">⚠️ Missing link detected / ربط مفقود</div>
                <div className="text-sm text-red-900 font-semibold">Invoice #{txn.order_number} exists (customer: <span style={{direction:'rtl'}}>{match.customer_name || '—'}</span>), but this treasury row is NOT linked to it. The invoice's collected total is missing this amount. Click "Link Now" to fix.</div>
                <div className="text-sm text-red-800 mt-1 font-semibold" style={{ direction: 'rtl' }}>
                  الفاتورة رقم {txn.order_number} موجودة لكن هذا القيد غير مربوط بها. المبلغ المحصّل للفاتورة ناقص. اضغط "ربط الآن" للإصلاح.
                </div>
                {props.onLinkInvoice && (
                  <button onClick={function () { props.onLinkInvoice(txn, match); }}
                    className="mt-3 w-full px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold">
                    🔗 Link Now to Invoice #{match.order_number} ({fE(match.total_amount)})
                  </button>
                )}
              </div>
            );
          })()}

          {/* ---- Linked Invoice ---- */}
          {c.related.invoice && (
            <div className="border-2 border-emerald-500 bg-emerald-100 rounded-lg p-3">
              <div className="text-xs font-extrabold text-emerald-900 uppercase mb-2 tracking-wider">🧾 Linked Invoice / الفاتورة المرتبطة</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-700 font-semibold">Customer:</span> <span className="font-extrabold text-slate-900" style={{ direction: 'rtl' }}>{c.related.invoice.customer_name || '—'}</span></div>
                <div><span className="text-slate-700 font-semibold">Order #:</span> <span className="font-extrabold text-slate-900">{c.related.invoice.order_number || '—'}</span></div>
                <div><span className="text-slate-700 font-semibold">Invoice total:</span> <span className="font-extrabold text-slate-900">{fE(c.related.invoice.total_amount)}</span></div>
                <div><span className="text-slate-700 font-semibold">Collected so far:</span> <span className="font-extrabold text-emerald-800">{fE(c.related.invoice.total_collected)}</span></div>
                <div><span className="text-slate-700 font-semibold">Outstanding:</span> <span className={'font-extrabold ' + (Number(c.related.invoice.outstanding || 0) > 0 ? 'text-red-700' : 'text-slate-600')}>{fE(c.related.invoice.outstanding)}</span></div>
                <div><span className="text-slate-700 font-semibold">Status:</span> <span className="font-extrabold text-slate-900">{c.related.invoice.status || '—'}</span></div>
              </div>
              {props.onOpenInvoice && (
                <button
                  onClick={function () { props.onOpenInvoice(c.related.invoice); onClose(); }}
                  className="mt-3 text-sm text-white bg-emerald-700 px-3 py-1.5 rounded-lg font-extrabold hover:bg-emerald-800 shadow"
                >
                  → Open invoice / فتح الفاتورة
                </button>
              )}
            </div>
          )}

          {/* ---- Linked Check ---- */}
          {c.related.linkedCheck && (
            <div className="border-2 border-blue-500 bg-blue-100 rounded-lg p-3">
              <div className="text-xs font-extrabold text-blue-900 uppercase mb-2 tracking-wider">📝 Linked Check / الشيك المرتبط</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-700 font-semibold">Check #:</span> <span className="font-extrabold text-slate-900">{c.related.linkedCheck.check_number || '—'}</span></div>
                <div><span className="text-slate-700 font-semibold">Amount:</span> <span className="font-extrabold text-slate-900">{fE(c.related.linkedCheck.amount)}</span></div>
                <div><span className="text-slate-700 font-semibold">Due date:</span> <span className="font-extrabold text-slate-900">{c.related.linkedCheck.due_date || c.related.linkedCheck.check_date || '—'}</span></div>
                <div><span className="text-slate-700 font-semibold">Status:</span> <span className="font-extrabold text-emerald-800">{c.related.linkedCheck.status}</span></div>
                {c.related.linkedCheck.collection_date && (
                  <div className="col-span-2"><span className="text-slate-700 font-semibold">Collected on:</span> <span className="font-extrabold text-slate-900">{c.related.linkedCheck.collection_date}</span></div>
                )}
                {c.related.linkedCheck.bank_name && (
                  <div className="col-span-2"><span className="text-slate-700 font-semibold">Bank:</span> <span className="font-extrabold text-slate-900">{c.related.linkedCheck.bank_name}</span></div>
                )}
              </div>
            </div>
          )}

          {/* ---- Linked Egypt Bank Transaction ---- */}
          {c.related.linkedBank && (
            <div className="border-2 border-indigo-500 bg-indigo-100 rounded-lg p-3">
              <div className="text-xs font-extrabold text-indigo-900 uppercase mb-2 tracking-wider">🏦 Linked Bank Transaction / المعاملة البنكية المرتبطة</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-700 font-semibold">Date:</span> <span className="font-extrabold text-slate-900">{c.related.linkedBank.date}</span></div>
                <div><span className="text-slate-700 font-semibold">Amount:</span> <span className={'font-extrabold ' + (Number(c.related.linkedBank.amount) > 0 ? 'text-emerald-800' : 'text-red-700')}>{fE(Math.abs(Number(c.related.linkedBank.amount)))}</span></div>
                <div className="col-span-2">
                  <span className="text-slate-700 font-semibold">Description:</span>
                  <div className="text-sm mt-1 text-slate-900 font-medium leading-relaxed" style={{ wordBreak: 'break-word' }}>{c.related.linkedBank.description || '—'}</div>
                </div>
              </div>
            </div>
          )}

          {/* ---- Dedup Sibling ---- */}
          {c.related.dedupSibling && (
            <div className="border-2 border-slate-500 bg-slate-200 rounded-lg p-3">
              <div className="text-xs font-extrabold text-slate-900 uppercase mb-2 tracking-wider">🔗 Original Entry (Where the Money Counted) / القيد الأصلي (المُحتسب)</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-700 font-semibold">Date:</span> <span className="font-extrabold text-slate-900">{c.related.dedupSibling.transaction_date}</span></div>
                <div><span className="text-slate-700 font-semibold">Cash in:</span> <span className="font-extrabold text-emerald-800">{fE(c.related.dedupSibling.cash_in)}</span></div>
                <div className="col-span-2">
                  <span className="text-slate-700 font-semibold">Description:</span>
                  <div className="text-sm mt-1 text-slate-900 font-medium leading-relaxed" style={{ direction: 'rtl', wordBreak: 'break-word' }}>{c.related.dedupSibling.description || '—'}</div>
                </div>
              </div>
              <div className="text-sm text-slate-800 font-medium leading-relaxed mt-2 pt-2 border-t-2 border-slate-400">
                This current row exists only to record that the bank confirmed the deposit. The actual +{fE(c.related.dedupSibling.cash_in)} landed on the row shown here.
              </div>
              <div className="text-sm text-slate-800 font-medium leading-relaxed mt-1" style={{ direction: 'rtl' }}>
                هذا القيد موجود فقط لتسجيل تأكيد البنك للإيداع. المبلغ الفعلي +{fE(c.related.dedupSibling.cash_in)} مسجّل على القيد أعلاه.
              </div>
            </div>
          )}

          {/* ---- Split Family ---- */}
          {c.related.splitFamily.length > 0 && (
            <div className="border-2 border-purple-500 bg-purple-100 rounded-lg p-3">
              <div className="text-xs font-extrabold text-purple-900 uppercase mb-2 tracking-wider">🪓 Related Entries (Same Order, Same Day) / قيود ذات صلة</div>
              {c.related.splitFamily.map(function (s) {
                return (
                  <div key={s.id} className="text-sm flex justify-between py-1 border-b border-purple-200 last:border-0">
                    <span className="truncate text-slate-900 font-medium" style={{ direction: 'rtl' }}>{(s.description || '').substring(0, 50)}</span>
                    <span className="font-extrabold ml-2 text-slate-900">
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
            <div className="bg-slate-100 border-2 border-slate-300 rounded-lg p-3">
              <div className="text-xs font-extrabold text-slate-700 uppercase mb-2 tracking-wider">🕐 Timeline / السجل الزمني</div>
              <div className="space-y-2">
                {c.timeline.map(function (t, i) {
                  return (
                    <div key={i} className="text-sm flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <div className="font-extrabold text-slate-900">{t.labelEn}</div>
                        <div className="text-slate-700 font-medium" style={{ direction: 'rtl' }}>{t.labelAr}</div>
                      </div>
                      <div className="text-slate-800 font-semibold whitespace-nowrap">{fmtDate(t.when)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---- Debug row id (small, for support / audit) ---- */}
          <div className="text-xs text-slate-600 text-center pt-1 font-medium">
            txn id: {txn.id}{txn.created_by ? ' · created_by: ' + String(txn.created_by).substring(0, 8) : ''}
          </div>
        </div>

        <div
          className="px-5 py-3 border-t-2 border-slate-200 flex justify-end gap-2 rounded-b-2xl bg-slate-100"
          style={{ flexShrink: 0 }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-extrabold hover:bg-black shadow"
          >
            Close / إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
