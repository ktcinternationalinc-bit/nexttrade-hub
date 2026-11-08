// v55.83-QZ2 (review of Nov 8, Max 12:00: "look thru the changes we made today
// and look for any logical gaps") — ONE server-side money-conservation check
// for the ClickBooks screens, the same math bank-write uses before a
// transaction may become 'reviewed' (v55.83-JC/JG): invoice payments + saved
// splits + open parked deposits/credits must account for every dollar, or the
// transaction is categorized as one whole (no piecewise rows at all).
import { summarizeBankAllocation } from './payment-matching';

export async function bankAllocationFor(db, txnId) {
  var tR = await db.from('bank_transactions').select('amount, amount_abs').eq('id', txnId).limit(1);
  if (tR && tR.error) { throw tR.error; }
  var t = (tR && tR.data && tR.data.length) ? tR.data[0] : null;
  if (!t) { return { missing: true }; }
  var total = Number(t.amount_abs != null ? t.amount_abs : Math.abs(Number(t.amount) || 0));
  var pR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('bank_transaction_id', txnId);
  if (pR && pR.error) { throw pR.error; }
  var sR = await db.from('bank_transaction_splits').select('split_amount, linked_type').eq('bank_transaction_id', txnId);
  if (sR && sR.error) { throw sR.error; }
  var uR = await db.from('unapplied_deposits').select('amount, status').eq('bank_transaction_id', txnId);
  if (uR && uR.error) { throw uR.error; }
  var cR = await db.from('customer_credits').select('amount, status').eq('source_transaction_id', txnId);
  if (cR && cR.error) { throw cR.error; }
  return summarizeBankAllocation({ total: total, payments: (pR && pR.data) || [], splits: (sR && sR.data) || [], unapplied: (uR && uR.data) || [], credits: (cR && cR.data) || [] });
}

// A HUMAN categorization (one row picked by a person, or a transfer pair a
// person confirmed) finishes the row exactly like Bank Review does: an
// 'unreviewed' row becomes 'reviewed' (who/when stamped) ONLY when every
// dollar is accounted for. Never touches approved/duplicate/reviewed rows,
// never runs for rules or bulk picks. Fail-soft: any error leaves it as is.
// Returns the ids that were advanced.
export async function autoReviewIfComplete(db, ids, by) {
  var done = [];
  for (var i = 0; i < (ids || []).length; i++) {
    try {
      var a = await bankAllocationFor(db, ids[i]);
      if (!a || a.missing || !a.complete || a.overAllocated) { continue; }
      var u = await db.from('bank_transactions')
        .update({ review_status: 'reviewed', reviewed_by: by || null, reviewed_at: new Date().toISOString() })
        .eq('id', ids[i]).eq('review_status', 'unreviewed').select('id');
      if (!u.error && u.data && u.data.length) { done.push(ids[i]); }
    } catch (e) { /* fail-soft: the row simply stays unreviewed */ }
  }
  return done;
}
