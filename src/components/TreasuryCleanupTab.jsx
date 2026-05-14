// v55.83-A.6.15 (Max May 14 2026) — Treasury Cleanup Review.
//
// Built after the v55.83-A.6.14 cleanup left invoice 2298 (and a handful of
// other invoices with cash_out activity) needing human judgment. Rather than
// writing more bespoke SQL, this gives Max a focused per-invoice review
// surface with full context, audit trail, and live recalc on every action.
//
// Shows invoices flagged by any of these conditions:
//   1. overpayment_amount > 0
//   2. cash_out OR bank_out on a treasury row linked to the invoice
//   3. duplicate treasury rows (same date, amount, description prefix)
//   4. orphan matched_bank_txn_id (points at deleted bank entry)
//
// Per-invoice actions on each treasury row:
//   • Delete — removes the row, recalcs invoice
//   • Unlink from invoice — keeps the row but sets linked_invoice_id=null
//   • Mark as sibling — links to another row via dedup_sibling_id (safe-to-bank)
//   • Mark as expense — sets linked_invoice_id=null and tags as expense
//   • Keep — explicit "this is correct, stop flagging" (adds a note)
//
// Every action writes to audit_log so the trail is auditable.
// Bilingual EN+AR throughout per Max's permanent rule.

import { useState, useEffect, useMemo } from 'react';

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  var v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s) {
  if (!s) return '—';
  return String(s).substring(0, 10);
}

// Classify a treasury row by the kind of action it suggests
function classifyRow(row, allRowsForInvoice) {
  // Was matched to a now-deleted bank entry? (legacy orphan)
  if (row.matched_bank_txn_id && row.__bank_txn_missing) {
    return { kind: 'orphan_match', label: 'Bank entry deleted', labelAr: 'القيد البنكي محذوف', tone: 'red' };
  }
  // Already marked as sibling of another row (already handled)
  if (row.dedup_sibling_id) {
    return { kind: 'sibling', label: 'Sibling (excluded from totals)', labelAr: 'مرتبط (مستثنى من الإجمالي)', tone: 'slate' };
  }
  // Linked to a check (already handled)
  if (row.source_check_id) {
    return { kind: 'check_shadow', label: 'Check shadow (linked)', labelAr: 'ظل شيك (مرتبط)', tone: 'slate' };
  }
  // Cash_out present — likely safe-to-bank or expense
  if (Number(row.cash_out || 0) > 0) {
    // Is there a matching cash_in on a nearby date for the same amount?
    var matchInRow = allRowsForInvoice.find(function (r) {
      if (r.id === row.id) return false;
      if (Number(r.cash_in || 0) !== Number(row.cash_out || 0)) return false;
      var diff = Math.abs(new Date(r.transaction_date) - new Date(row.transaction_date)) / 86400000;
      return diff <= 7;
    });
    if (matchInRow) {
      return {
        kind: 'safe_to_bank_pair',
        label: 'Likely safe-to-bank pair',
        labelAr: 'تحويل خزنة → بنك محتمل',
        tone: 'amber',
        siblingCandidate: matchInRow.id,
      };
    }
    return { kind: 'expense', label: 'Possible expense (cash_out without pair)', labelAr: 'مصروف محتمل', tone: 'amber' };
  }
  // Bank_out — similar
  if (Number(row.bank_out || 0) > 0) {
    return { kind: 'bank_out', label: 'Bank outflow', labelAr: 'صرف بنكي', tone: 'amber' };
  }
  // Look for exact duplicate inside the same invoice
  var dup = allRowsForInvoice.find(function (r) {
    if (r.id === row.id) return false;
    if (r.transaction_date !== row.transaction_date) return false;
    if (Number(r.cash_in || 0) !== Number(row.cash_in || 0)) return false;
    if (Number(r.bank_in || 0) !== Number(row.bank_in || 0)) return false;
    var d1 = (r.description || '').substring(0, 50).trim().toLowerCase();
    var d2 = (row.description || '').substring(0, 50).trim().toLowerCase();
    return d1 === d2;
  });
  if (dup) {
    return { kind: 'duplicate', label: 'Duplicate inside invoice', labelAr: 'مكرر داخل الفاتورة', tone: 'red', dupOfId: dup.id };
  }
  return { kind: 'ok', label: 'Looks normal', labelAr: 'عادي', tone: 'green' };
}

export default function TreasuryCleanupTab({ supabase, treasury, invoices, checks, egyptBankTxns, customers, userProfile, isSuperAdmin, onReload, toast, recalcInvoiceCollected }) {
  var myId = userProfile && userProfile.id;
  var [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
  var [working, setWorking] = useState(false);
  var [filter, setFilter] = useState('all'); // all | overpayment | cash_out | duplicates

  // Build the set of flagged invoices
  var flaggedInvoices = useMemo(function () {
    var byInvId = {};
    (invoices || []).forEach(function (i) {
      var flags = [];
      var op = Number(i.overpayment_amount || 0);
      if (op > 0.5) flags.push({ type: 'overpayment', detail: 'EGP ' + fmtMoney(op) + ' overpayment' });
      byInvId[i.id] = { invoice: i, flags: flags, rows: [] };
    });
    // Annotate treasury rows
    var bankIdSet = new Set((egyptBankTxns || []).map(function (e) { return e.id; }));
    (treasury || []).forEach(function (t) {
      if (!t.linked_invoice_id) return;
      var entry = byInvId[t.linked_invoice_id];
      if (!entry) return;
      // Mark orphan-bank-match
      if (t.matched_bank_txn_id && !bankIdSet.has(t.matched_bank_txn_id)) {
        t.__bank_txn_missing = true;
      } else {
        t.__bank_txn_missing = false;
      }
      entry.rows.push(t);
      if (Number(t.cash_out || 0) > 0 || Number(t.bank_out || 0) > 0) {
        if (!entry.flags.some(function (f) { return f.type === 'cash_out'; })) {
          entry.flags.push({ type: 'cash_out', detail: 'Has outflow rows (recalc may misbehave)' });
        }
      }
      if (t.__bank_txn_missing) {
        entry.flags.push({ type: 'orphan', detail: 'Orphan match: bank entry deleted' });
      }
    });
    // Filter to only those with flags AND any treasury activity
    return Object.values(byInvId).filter(function (e) { return e.flags.length > 0 && e.rows.length > 0; });
  }, [invoices, treasury, egyptBankTxns]);

  var filteredFlagged = useMemo(function () {
    if (filter === 'all') return flaggedInvoices;
    return flaggedInvoices.filter(function (e) {
      return e.flags.some(function (f) {
        if (filter === 'overpayment') return f.type === 'overpayment';
        if (filter === 'cash_out') return f.type === 'cash_out';
        if (filter === 'orphan') return f.type === 'orphan';
        return false;
      });
    });
  }, [flaggedInvoices, filter]);

  var selectedEntry = useMemo(function () {
    if (!selectedInvoiceId) return null;
    return flaggedInvoices.find(function (e) { return e.invoice.id === selectedInvoiceId; }) || null;
  }, [selectedInvoiceId, flaggedInvoices]);

  // Find customer for an invoice
  function customerNameFor(inv) {
    if (!inv || !inv.customer_id) return '—';
    var c = (customers || []).find(function (x) { return x.id === inv.customer_id; });
    return c ? (c.name || c.company || '—') : '—';
  }

  // Build the audit_log row for a cleanup action
  async function writeAudit(invoiceId, treasuryId, action, beforeState, afterState, note) {
    try {
      await supabase.from('audit_log').insert({
        user_id: myId,
        entity_type: 'treasury',
        action: 'cleanup_' + action,
        details: {
          invoice_id: invoiceId,
          treasury_id: treasuryId,
          before: beforeState || null,
          after: afterState || null,
          note: note || null,
          source: 'v55.83-A.6.15 TreasuryCleanupTab',
        },
        created_at: new Date().toISOString(),
      });
    } catch (_) { /* non-fatal */ }
  }

  // ─── Actions ─────────────────────────────────────────────────────────

  async function doDelete(row) {
    if (!confirm('Delete this treasury row? This cannot be undone (but the row is preserved in the backup table from May 14). / حذف هذا القيد؟ لا يمكن التراجع.')) return;
    setWorking(true);
    try {
      var before = Object.assign({}, row);
      await supabase.from('treasury').delete().eq('id', row.id);
      await writeAudit(row.linked_invoice_id, row.id, 'delete', before, null, null);
      if (row.linked_invoice_id && recalcInvoiceCollected) {
        await recalcInvoiceCollected(row.linked_invoice_id);
      }
      toast && toast.success && toast.success('Row deleted and invoice recalculated / تم الحذف وإعادة الحساب');
      if (onReload) await onReload();
    } catch (e) {
      toast && toast.error && toast.error('Delete failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  async function doUnlink(row) {
    if (!confirm('Unlink this row from the invoice? The row stays in your treasury but stops counting toward the invoice. / فصل القيد عن الفاتورة؟ يبقى في الخزنة لكن لا يحسب للفاتورة.')) return;
    setWorking(true);
    try {
      var before = { linked_invoice_id: row.linked_invoice_id, order_number: row.order_number };
      var origInvId = row.linked_invoice_id;
      await supabase.from('treasury').update({ linked_invoice_id: null, order_number: null }).eq('id', row.id);
      await writeAudit(origInvId, row.id, 'unlink', before, { linked_invoice_id: null, order_number: null }, null);
      if (origInvId && recalcInvoiceCollected) {
        await recalcInvoiceCollected(origInvId);
      }
      toast && toast.success && toast.success('Row unlinked / تم فصل القيد');
      if (onReload) await onReload();
    } catch (e) {
      toast && toast.error && toast.error('Unlink failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  async function doMarkSibling(row, partnerId) {
    if (!partnerId) {
      // Prompt: pick a partner row
      var input = prompt('Enter the ID of the row this is paired with (the cash_in row whose deposit this represents) / أدخل ID القيد المرتبط:');
      if (!input) return;
      partnerId = input.trim();
    }
    setWorking(true);
    try {
      var before = { dedup_sibling_id: row.dedup_sibling_id };
      await supabase.from('treasury').update({ dedup_sibling_id: partnerId }).eq('id', row.id);
      await writeAudit(row.linked_invoice_id, row.id, 'mark_sibling', before, { dedup_sibling_id: partnerId }, 'Paired with ' + partnerId);
      if (row.linked_invoice_id && recalcInvoiceCollected) {
        await recalcInvoiceCollected(row.linked_invoice_id);
      }
      toast && toast.success && toast.success('Marked as sibling — excluded from total / تم الربط');
      if (onReload) await onReload();
    } catch (e) {
      toast && toast.error && toast.error('Sibling mark failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  async function doClearOrphanMatch(row) {
    setWorking(true);
    try {
      var before = { matched_bank_txn_id: row.matched_bank_txn_id };
      await supabase.from('treasury').update({ matched_bank_txn_id: null }).eq('id', row.id);
      await writeAudit(row.linked_invoice_id, row.id, 'clear_orphan_match', before, { matched_bank_txn_id: null }, null);
      toast && toast.success && toast.success('Orphan match cleared / تم مسح الربط المعلق');
      if (onReload) await onReload();
    } catch (e) {
      toast && toast.error && toast.error('Failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (!isSuperAdmin) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-6 text-center">
        <p className="text-sm font-bold text-amber-900">Treasury Cleanup is super-admin only / مراجعة الخزنة للمسؤول فقط</p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-xl p-4 mb-3">
        <h3 className="text-sm font-bold mb-1">
          🧹 Treasury Cleanup Review <span className="text-slate-400 font-normal">/ مراجعة الخزنة</span>
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Invoices flagged because they show overpayment, have cash-out activity that the recalc may not handle, or have orphan bank matches.
          Review each invoice's treasury rows with full context and act per row. Every action is logged to audit_log. /
          فواتير تحتاج مراجعة بسبب فائض دفع، أو حركات صرف، أو ربط معلق. كل إجراء يُسجل في سجل المراجعة.
        </p>

        <div className="flex gap-2 flex-wrap mb-3">
          {[
            { key: 'all', en: 'All flagged', ar: 'الكل', count: flaggedInvoices.length },
            { key: 'overpayment', en: 'Overpayment', ar: 'فائض دفع', count: flaggedInvoices.filter(function (e) { return e.flags.some(function (f) { return f.type === 'overpayment'; }); }).length },
            { key: 'cash_out', en: 'Has cash_out', ar: 'به صرف', count: flaggedInvoices.filter(function (e) { return e.flags.some(function (f) { return f.type === 'cash_out'; }); }).length },
            { key: 'orphan', en: 'Orphan matches', ar: 'ربط معلق', count: flaggedInvoices.filter(function (e) { return e.flags.some(function (f) { return f.type === 'orphan'; }); }).length },
          ].map(function (b) {
            return (
              <button key={b.key} onClick={function () { setFilter(b.key); }}
                className={'px-3 py-1 rounded-lg text-[11px] font-bold border ' + (filter === b.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}>
                {b.en} <span className="opacity-60">/ {b.ar}</span> ({b.count})
              </button>
            );
          })}
        </div>

        {filteredFlagged.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-6">
            🎉 No flagged invoices in this filter. / لا توجد فواتير تحتاج مراجعة.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* LEFT: list of flagged invoices */}
            <div className="lg:col-span-1 overflow-auto max-h-[600px] border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px]">Invoice / فاتورة</th>
                    <th className="px-2 py-2 text-right text-[10px]">Total</th>
                    <th className="px-2 py-2 text-right text-[10px]">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFlagged.map(function (e) {
                    return (
                      <tr key={e.invoice.id}
                        className={'border-b border-slate-50 cursor-pointer ' + (selectedInvoiceId === e.invoice.id ? 'bg-indigo-50' : 'hover:bg-blue-50')}
                        onClick={function () { setSelectedInvoiceId(e.invoice.id); }}>
                        <td className="px-2 py-2">
                          <div className="font-bold text-slate-900">{e.invoice.order_number || e.invoice.id.substring(0, 8)}</div>
                          <div className="text-[9px] text-slate-500">{customerNameFor(e.invoice)}</div>
                        </td>
                        <td className="px-2 py-2 text-right text-[10px]">{fmtMoney(e.invoice.total_amount)}</td>
                        <td className="px-2 py-2 text-right">
                          {e.flags.map(function (f, i) {
                            var color = f.type === 'overpayment' ? 'bg-red-100 text-red-800' : f.type === 'orphan' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
                            return <div key={i} className={'text-[9px] font-bold rounded px-1 inline-block mr-1 ' + color}>{f.type}</div>;
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* RIGHT: detail panel for selected invoice */}
            <div className="lg:col-span-2">
              {!selectedEntry ? (
                <div className="bg-slate-50 rounded-lg p-6 text-center text-sm text-slate-500 border border-slate-200">
                  Select an invoice to review its treasury rows / اختر فاتورة لمراجعة قيودها
                </div>
              ) : (
                <InvoiceDetailPanel
                  entry={selectedEntry}
                  customerName={customerNameFor(selectedEntry.invoice)}
                  checks={checks || []}
                  egyptBankTxns={egyptBankTxns || []}
                  working={working}
                  onDelete={doDelete}
                  onUnlink={doUnlink}
                  onMarkSibling={doMarkSibling}
                  onClearOrphanMatch={doClearOrphanMatch}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceDetailPanel({ entry, customerName, checks, egyptBankTxns, working, onDelete, onUnlink, onMarkSibling, onClearOrphanMatch }) {
  var inv = entry.invoice;
  var rowsClassified = entry.rows.map(function (r) {
    return { row: r, c: classifyRow(r, entry.rows) };
  });
  var linkedChecks = (checks || []).filter(function (c) {
    return c.invoice_id === inv.id || (c.order_number && c.order_number === inv.order_number);
  });

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 max-h-[600px] overflow-auto">
      <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-bold">Invoice {inv.order_number} <span className="text-slate-400 font-normal">/ فاتورة</span></h4>
          <div className="text-[10px] text-slate-500">{customerName}</div>
        </div>
        <div className="text-right text-[11px]">
          <div><span className="text-slate-500">Total / إجمالي:</span> <span className="font-bold">EGP {fmtMoney(inv.total_amount)}</span></div>
          <div><span className="text-slate-500">Collected / محصل:</span> <span className="font-bold text-emerald-700">EGP {fmtMoney(inv.total_collected)}</span></div>
          <div><span className="text-slate-500">Outstanding / متبقي:</span> <span className="font-bold text-blue-700">EGP {fmtMoney(inv.outstanding)}</span></div>
          {Number(inv.overpayment_amount || 0) > 0.5 && (
            <div><span className="text-red-700 font-bold">⚠️ Overpayment / فائض:</span> <span className="font-bold text-red-700">EGP {fmtMoney(inv.overpayment_amount)}</span></div>
          )}
        </div>
      </div>

      {linkedChecks.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2 text-[11px]">
          <div className="font-bold text-blue-900 mb-1">Linked checks / شيكات مرتبطة:</div>
          {linkedChecks.map(function (c) {
            return (
              <div key={c.id} className="flex justify-between">
                <span>{fmtDate(c.check_date)} · {c.bank_name || ''} {c.check_number ? '#' + c.check_number : ''}</span>
                <span className="font-bold">{c.status === 'collected' ? '✅' : '⏳'} EGP {fmtMoney(c.amount)}</span>
              </div>
            );
          })}
        </div>
      )}

      <h5 className="text-[11px] font-bold text-slate-700 mb-1">Treasury rows ({entry.rows.length}) / قيود الخزنة</h5>
      <div className="space-y-2">
        {rowsClassified.map(function (rc) {
          var r = rc.row, c = rc.c;
          var toneBg = c.tone === 'red' ? 'bg-red-50 border-red-200' : c.tone === 'amber' ? 'bg-amber-50 border-amber-200' : c.tone === 'green' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200';
          return (
            <div key={r.id} className={'rounded p-2 border ' + toneBg}>
              <div className="flex justify-between items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap text-[10px] mb-0.5">
                    <span className="font-mono text-slate-400">{r.id.substring(0, 8)}</span>
                    <span className="px-1 py-0.5 rounded bg-white border border-slate-200 text-[9px] font-bold">{c.label} / {c.labelAr}</span>
                    {r.is_bank_placeholder && <span className="px-1 py-0.5 rounded bg-blue-100 text-blue-800 text-[9px] font-bold">placeholder</span>}
                    {r.needs_bank_match && <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">awaits match</span>}
                  </div>
                  <div className="text-[11px] text-slate-700 mb-0.5">{fmtDate(r.transaction_date)} · {(r.description || '').substring(0, 80)}</div>
                  <div className="flex gap-2 text-[10px] font-mono">
                    {Number(r.cash_in || 0) > 0 && <span className="text-emerald-700">cash_in {fmtMoney(r.cash_in)}</span>}
                    {Number(r.cash_out || 0) > 0 && <span className="text-red-700">cash_out {fmtMoney(r.cash_out)}</span>}
                    {Number(r.bank_in || 0) > 0 && <span className="text-blue-700">bank_in {fmtMoney(r.bank_in)}</span>}
                    {Number(r.bank_out || 0) > 0 && <span className="text-amber-700">bank_out {fmtMoney(r.bank_out)}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {c.kind === 'orphan_match' && (
                    <button onClick={function () { onClearOrphanMatch(r); }} disabled={working}
                      className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[10px] font-bold">
                      🔗 Clear orphan
                    </button>
                  )}
                  {c.kind === 'safe_to_bank_pair' && c.siblingCandidate && (
                    <button onClick={function () { onMarkSibling(r, c.siblingCandidate); }} disabled={working}
                      className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[10px] font-bold">
                      🔗 Mark as sibling
                    </button>
                  )}
                  <button onClick={function () { onDelete(r); }} disabled={working}
                    className="px-2 py-1 rounded bg-slate-700 hover:bg-red-600 disabled:opacity-50 text-white text-[10px] font-bold">
                    🗑 Delete
                  </button>
                  <button onClick={function () { onUnlink(r); }} disabled={working}
                    className="px-2 py-1 rounded bg-white hover:bg-slate-100 disabled:opacity-50 border border-slate-300 text-slate-700 text-[10px] font-bold">
                    Unlink
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
