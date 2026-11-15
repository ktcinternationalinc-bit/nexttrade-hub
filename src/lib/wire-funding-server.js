// v55.83-SP — server helpers for requests drawn from a transfer. Var + concat only.
import { US_WAVE_BUSINESS_ID } from './business-of';
import { fundingLeft, payeeKey } from './wire-funding';
import { packageLabel } from './wire-audit';
import { inChunks } from './wire-package-server';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// Transfers already marked as sent to a paid-through company (optionally one company), newest first,
// each with what is used and what is left. opts: { payee, ids, limit }
export async function fundingLines(db, opts) {
  var o = opts || {};
  var q = db.from('bank_transactions').select('id, date, posted_date, amount_abs, direction, pending, name, merchant_name, review_status, third_party_payer, transfer_group_id, classification, wave_business_id, iso_currency')
    .eq('direction', 'out').eq('wave_business_id', US_WAVE_BUSINESS_ID).not('third_party_payer', 'is', null);
  if (o.ids && o.ids.length) { q = q.in('id', o.ids); }
  var tr = await q.order('date', { ascending: false }).limit(o.limit || 300);
  if (tr.error) { return { error: tr.error.message, lines: [] }; }
  var want = o.payee ? payeeKey(o.payee) : null;
  var rows = (tr.data || []).filter(function (t) {
    return t.pending !== true && t.review_status !== 'duplicate' && !t.transfer_group_id && (!want || payeeKey(t.third_party_payer) === want);
  });
  var ids = rows.map(function (t) { return t.id; });
  if (!ids.length) { return { lines: [] }; }
  var pays = await inChunks(db, 'vendor_bill_payments', 'id, bank_transaction_id, amount, voided', 'bank_transaction_id', ids);
  var wires = await inChunks(db, 'wire_packages', 'id, seq, status, fee_amount, approved_total, bank_transaction_id, payee_name', 'bank_transaction_id', ids);
  var drafts = [];
  try { drafts = await inChunks(db, 'wire_packages', 'id, seq, status, fee_amount, funding_txn_id, payee_name', 'funding_txn_id', ids); } catch (e) { drafts = []; }
  var draftIds = drafts.filter(function (d) { return d.status === 'draft'; }).map(function (d) { return d.id; });
  var dLines = draftIds.length ? await inChunks(db, 'wire_package_lines', 'package_id, amount', 'package_id', draftIds) : [];
  return { lines: rows.map(function (t) {
    var bills = 0; pays.forEach(function (p) { if (p.bank_transaction_id === t.id && p.voided !== true) { bills += Number(p.amount) || 0; } });
    var fees = 0; var reqs = [];
    wires.forEach(function (w) { if (w.bank_transaction_id === t.id && w.status === 'attached') { fees += Number(w.fee_amount) || 0; reqs.push({ id: w.id, label: packageLabel(w), total: r2(w.approved_total), fee: r2(w.fee_amount) }); } });
    var planned = 0; var plans = [];
    drafts.forEach(function (d) {
      if (d.funding_txn_id !== t.id || d.status !== 'draft') { return; }
      var tot = Number(d.fee_amount) || 0; dLines.forEach(function (l) { if (l.package_id === d.id) { tot += Number(l.amount) || 0; } });
      planned += tot; plans.push({ id: d.id, label: packageLabel(d), total: r2(tot) });
    });
    var f = fundingLeft(t.amount_abs, bills, fees);
    return { id: t.id, date: t.posted_date || t.date, name: t.merchant_name || t.name || '', payee: t.third_party_payer, category: t.classification || null, currency: String(t.iso_currency || 'USD').toUpperCase(),
      amount: f.amount, bills: f.bills, fees: f.fees, used: f.used, remaining: f.remaining, fully_used: f.fully_used,
      requests: reqs, planned: r2(planned), planned_requests: plans };
  }) };
}

// v55.83-SQ — bills whose currency is not the transfer's currency (a bill with no currency on file counts as USD,
// the same default the bills screen uses). Flagged for a person; never converted or guessed.
export async function currencyMismatch(db, transferCurrency, billIds) {
  var cur = String(transferCurrency || 'USD').toUpperCase();
  var ids = (billIds || []).filter(Boolean);
  if (!ids.length) { return []; }
  var rows = [];
  try { rows = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, currency', 'id', ids); } catch (e) { return []; }
  return rows.filter(function (b) { return String(b.currency || 'USD').toUpperCase() !== cur; })
    .map(function (b) { return { bill_id: b.id, vendor: b.vendor_name || '', bill_number: b.bill_number || '', currency: String(b.currency || 'USD').toUpperCase(), transfer_currency: cur }; });
}
