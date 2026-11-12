// v55.83-RZ — Max, Nov 10 00:17 (confirmed 00:22):
//  "when the wire is actually sent and you see a transaction for that amount in clickbooks...you automatically match those
//   underlying bills to that transaction and the status of the bills become PAID"
//  extra charge: a bank line up to $50 OVER the wire total still matches by itself. Max, Nov 10 16:37: "if wire sent straight
//  to vendor...it will go toward the actual bill it was paid toward... what bank fee. it would be Cost of goods as a default
//  for Rtm or nextrade it would be professional fees" — so the extra is NOT a bank fee: on a vendor wire ClickBooks books it
//  with the bill it paid (SQL RZ §3); on an RTM / NextTrade wire the bank line is filed under professional fees.
//  (The column stays named bank_fee; the words on screen say "extra charge".)
// One engine, used by: the 🏦 Wires screen (attach by hand + "match now"), the Plaid sync and the statement import.
// It never guesses: it attaches only when exactly ONE bank line fits; otherwise it lists the candidates for a person.
import { audit } from './audit-server';
import { autoReviewIfComplete } from './bank-allocation-server';
import { US_WAVE_BUSINESS_ID } from './business-of';
import { packageLabel } from './wire-audit';
import { inChunks } from './wire-package-server';

// v55.83-SB — Max, Nov 12 09:31 (answers to the bug review): "if it matches ... the amount within like $50 or within $100, then do
//  it, okay? And it should also still have the option of being manually overridden and matched ... or ... manually selected"
//  → up to $100 over still matches by itself, but ONLY a line that reads like a wire (or is exact to the cent), that no person
//    has verified, and that no OTHER sent wire could also claim. Everything else is listed for a person to pick by hand.
export var AUTO_FEE_MAX = 100;     // dollars over the wire total that still match (Max Nov 12: "within like $50 or within $100")
export var MATCH_DAYS_AFTER = 7;   // the bank line is dated on / after the sent date, within a week
export var MATCH_DAYS_BEFORE = 1;  // (one day of slack: banks post overnight)

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function dayAdd(iso, n) { return new Date(new Date(String(iso).substring(0, 10) + 'T00:00:00Z').getTime() + n * 86400000).toISOString().substring(0, 10); }

// bank lines that could be this wire: money out, US books, settled, around the sent date, not used by anything else
export async function wireCandidates(db, pkg, opts) {
  var o = opts || {};
  var want = r2(pkg.approved_total);
  var from = dayAdd(pkg.sent_date, -(o.before != null ? o.before : MATCH_DAYS_BEFORE)); var to = dayAdd(pkg.sent_date, o.after != null ? o.after : MATCH_DAYS_AFTER);
  var tq = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, direction, pending, name, merchant_name, wave_business_id, review_status, third_party_payer, category_verified')
    .eq('direction', 'out').eq('wave_business_id', US_WAVE_BUSINESS_ID).gte('date', from).lte('date', to).limit(1000);
  if (tq.error) { return { error: tq.error.message }; }
  var near = (tq.data || []).filter(function (t) { return t.pending !== true && t.review_status !== 'duplicate' && r2(t.amount_abs) >= want - 0.005 && r2(t.amount_abs) <= want + (o.wide ? Math.max(AUTO_FEE_MAX, want * 0.02) : AUTO_FEE_MAX) + 0.005; });
  var ids = near.map(function (t) { return t.id; });
  var used = {};
  if (ids.length) {
    (await inChunks(db, 'vendor_bill_payments', 'bank_transaction_id, voided', 'bank_transaction_id', ids)).forEach(function (p) { if (p.voided !== true) { used[p.bank_transaction_id] = true; } });
    (await inChunks(db, 'wire_packages', 'id, bank_transaction_id', 'bank_transaction_id', ids)).forEach(function (k) { if (k.id !== pkg.id) { used[k.bank_transaction_id] = true; } });
  }
  return { want: want, list: near.filter(function (t) { return !used[t.id]; }).map(function (t) {
    var amt = r2(t.amount_abs);
    return { id: t.id, date: t.posted_date || t.date, amount: amt, fee: r2(amt - want), name: t.merchant_name || t.name || '', exact: Math.abs(amt - want) <= 0.005, row: t, verified: t.category_verified === true,
      looks_like_wire: /\bWIRE\b|\bWT\b|FEDWIRE|SWIFT/i.test(String(t.name || '') + ' ' + String(t.merchant_name || '')) };
  }).sort(function (a, b) { return (b.exact - a.exact) || (a.fee - b.fee) || String(a.date).localeCompare(String(b.date)); }) };
}

// record the bills paid by this bank line (the same guards as by hand; all or nothing)
// fee: dollars the bank line is OVER the wire total (0 … AUTO_FEE_MAX), kept on the wire; booked with the bill (vendor) or
// inside the professional-fees line (RTM / NextTrade)
export async function attachWire(db, pkg, bankRow, actorId, opts) {
  var o = opts || {};
  if (pkg.status !== 'sent') { return { ok: false, status: 409, error: pkg.status === 'attached' ? 'Already attached.' : 'Mark the wire sent first.' }; }
  var t0 = bankRow;
  if (t0.direction !== 'out') { return { ok: false, status: 409, error: 'A wire is MONEY OUT — that bank line is money in.' }; }
  if (t0.pending === true) { return { ok: false, status: 409, error: 'That bank line is still pending — attach it once it settles.' }; }
  if (t0.wave_business_id !== US_WAVE_BUSINESS_ID) { return { ok: false, status: 409, error: 'That bank line is not on the US books.' }; }
  if (t0.review_status === 'duplicate') { return { ok: false, status: 409, error: 'That bank line is marked a duplicate copy.' }; }
  var usedA = await db.from('vendor_bill_payments').select('id, voided').eq('bank_transaction_id', t0.id);
  if (((usedA && usedA.data) || []).some(function (p) { return p.voided !== true; })) { return { ok: false, status: 409, error: 'That bank line already pays other bills — pick the right line.' }; }
  var diff = r2(r2(t0.amount_abs) - r2(pkg.approved_total));
  var fee = 0;
  if (Math.abs(diff) > 0.005) {
    if (diff > 0 && diff <= AUTO_FEE_MAX + 0.005) { fee = diff; } // an extra charge of up to $50: accepted (Max 00:22), recorded
    else if (!o.allowDifferent) { return { ok: false, status: 409, error: 'The bank line is $' + r2(t0.amount_abs).toFixed(2) + ' but the wire is $' + r2(pkg.approved_total).toFixed(2) + ' (' + (diff > 0 ? '+' : '') + diff.toFixed(2) + '). More than a $' + AUTO_FEE_MAX + ' extra charge — only a super admin or the owner can accept it, with the reason.' }; }
  }
  var lr = await db.from('wire_package_lines').select('*').eq('package_id', pkg.id);
  var lines = (lr && lr.data) || [];
  var billIds = lines.map(function (l) { return l.bill_id; });
  var bills = billIds.length ? await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, total_amount, record_status, paid_via', 'id', billIds) : [];
  var billBy = {}; bills.forEach(function (b) { billBy[b.id] = b; });
  var pays = billIds.length ? await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', billIds) : [];
  for (var i = 0; i < lines.length; i++) {
    var la = lines[i]; var ba = billBy[la.bill_id] || {};
    var paid = 0; pays.forEach(function (p) { if (p.bill_id === la.bill_id && p.voided !== true) { paid += Number(p.amount) || 0; } });
    if (ba.record_status !== 'active') { return { ok: false, status: 409, error: (ba.vendor_name || 'A bill') + ' ' + (ba.bill_number || '') + ' was voided / deleted after approval — nothing was recorded. Sort it out first.' }; }
    if (r2(la.amount) > r2((Number(ba.total_amount) || 0) - paid) + 0.005) { return { ok: false, status: 409, error: (ba.vendor_name || 'A bill') + ' ' + (ba.bill_number || '') + ' was paid some other way after approval — recording this wire would overpay it. Nothing was recorded.' }; }
  }
  // v55.83-SB (bug review 3) — CLAIM the wire for this bank line BEFORE writing any payment: two matchers in the same second
  // (bank sync + someone opening Wires) used to both write payments and the loser's clean-up reopened the winner's lines.
  // The claim is one conditional update (and bank_transaction_id is UNIQUE in the database — two wires can never hold one line).
  if (pkg.bank_transaction_id && pkg.updated_at && (Date.now() - new Date(pkg.updated_at).getTime()) > 180000) {
    await db.from('wire_packages').update({ bank_transaction_id: null }).eq('id', pkg.id).eq('status', 'sent').eq('bank_transaction_id', pkg.bank_transaction_id).eq('updated_at', pkg.updated_at); // a claim left by a crashed run
  }
  var claim = await db.from('wire_packages').update({ bank_transaction_id: t0.id, updated_at: new Date().toISOString() }).eq('id', pkg.id).eq('status', 'sent').is('bank_transaction_id', null).select('id');
  if (claim.error || !claim.data || !claim.data.length) {
    return { ok: false, status: 409, error: (claim.error && /duplicate|unique/i.test(claim.error.message || '')) ? 'That bank line already belongs to another wire.' : 'This wire is being matched by someone else right now — nothing was written. Look again in a moment.' };
  }
  var release = async function () { await db.from('wire_packages').update({ bank_transaction_id: null }).eq('id', pkg.id).eq('status', 'sent').eq('bank_transaction_id', t0.id); };
  var payDate = t0.posted_date || t0.date;
  var method = pkg.payee_kind === 'vendor' ? 'wire' : 'rtm';
  var made = [];
  for (var j = 0; j < lines.length; j++) {
    var lb = lines[j];
    var ip = await db.from('vendor_bill_payments').insert({ bill_id: lb.bill_id, amount: r2(lb.amount), paid_date: payDate, bank_transaction_id: t0.id, method: method, created_by: actorId || null }).select('id').single();
    if (ip.error) {
      for (var k = 0; k < made.length; k++) { await db.from('vendor_bill_payments').update({ voided: true }).eq('id', made[k].payment_id); }
      await release();
      return { ok: false, status: 500, error: 'Recording the bill payments failed (' + ip.error.message + ') — the ones already written were voided again; nothing changed.' };
    }
    made.push({ line_id: lb.id, payment_id: ip.data.id });
  }
  for (var m = 0; m < made.length; m++) { await db.from('wire_package_lines').update({ is_open: false, payment_id: made[m].payment_id }).eq('id', made[m].line_id); }
  var note = String(o.note || '').trim().substring(0, 500) || (fee ? 'extra charge $' + fee.toFixed(2) + ' (the bank line is $' + r2(t0.amount_abs).toFixed(2) + ')' : null);
  var patch = { status: 'attached', bank_transaction_id: t0.id, attached_by: actorId || null, attached_at: new Date().toISOString(), attach_note: note, updated_at: new Date().toISOString() };
  var upA = await db.from('wire_packages').update(Object.assign({}, patch, { bank_fee: fee, matched_auto: !!o.auto })).eq('id', pkg.id).eq('status', 'sent').select('id');
  if (upA.error && /bank_fee|matched_auto/.test(upA.error.message || '')) { upA = await db.from('wire_packages').update(patch).eq('id', pkg.id).eq('status', 'sent').select('id'); } // RZ SQL not run yet
  if (upA.error || !upA.data || !upA.data.length) {
    for (var n = 0; n < made.length; n++) { await db.from('vendor_bill_payments').update({ voided: true }).eq('id', made[n].payment_id); }
    await db.from('wire_package_lines').update({ is_open: true, payment_id: null }).eq('package_id', pkg.id);
    await release();
    return { ok: false, status: 409, error: ((upA && upA.error && upA.error.message) || 'Someone attached this wire at the same moment') + ' — the bill payments were voided again; nothing changed.' };
  }
  var reviewed = false; var pf = null;
  if (pkg.payee_kind !== 'vendor') {
    try { await db.from('wire_packages').update({ prev_third_party_payer: t0.third_party_payer || null }).eq('id', pkg.id); } catch (ePv) { /* RL SQL not run */ }
    await db.from('bank_transactions').update({ third_party_payer: pkg.payee_name }).eq('id', t0.id);
    pf = await fileAsProfessionalFees(db, t0.id, actorId, pkg); // Max 16:37: "for Rtm or nextrade it would be professional fees"
    if (pkg.payee_kind === 'affiliate') { try { reviewed = (await autoReviewIfComplete(db, [t0.id], actorId)).length > 0; } catch (eR) { reviewed = false; } }
  }
  await audit(db, actorId || null, 'wire_package_attached', 'wire_package', pkg.id, { bank_transaction_id: t0.id, bills: made.length, approved_total: r2(pkg.approved_total), bank_amount: r2(t0.amount_abs), difference: diff, bank_fee: fee, matched: o.auto ? 'automatically by the Hub' : 'by hand', override_note: o.note || null });
  await audit(db, actorId || null, 'bill_payments_from_wire', 'bank_transaction', t0.id, { package: packageLabel(pkg), payments: made.map(function (x) { return x.payment_id; }), bank_fee: fee });
  return { ok: true, bills_paid: made.length, bank_fee: fee, reviewed: reviewed, filed_as: pf };
}

// RTM Capital / NextTrade wire → its bank line goes under the PROFESSIONAL FEES category (the bills, any extra charge — one line).
// Only when the line has no category yet (a person's choice is never overwritten), and only when exactly ONE category is named
// "professional…" — two or none → left for a person (never guessed). Fail-soft.
export async function fileAsProfessionalFees(db, txnId, actorId, pkg) {
  try {
    var tr = await db.from('bank_transactions').select('id, classification').eq('id', txnId).limit(1);
    var t = tr && tr.data && tr.data[0];
    if (!t || (t.classification && String(t.classification).trim())) { return null; }
    var cr = await db.from('expense_categories').select('key, label, active');
    var hits = ((cr && cr.data) || []).filter(function (c) { return c.active !== false && /professional/i.test(String(c.label || '') + ' ' + String(c.key || '')); });
    if (hits.length !== 1) { return null; }
    var up = await db.from('bank_transactions').update({ classification: hits[0].key }).eq('id', txnId).is('classification', null).select('id');
    if (up.error || !up.data || !up.data.length) { return null; }
    await audit(db, actorId || null, 'bank_line_filed_professional_fees', 'bank_transaction', txnId, { category: hits[0].key, label: hits[0].label, wire: packageLabel(pkg), payee: pkg.payee_name });
    return hits[0].label;
  } catch (e) { return null; }
}

// every SENT wire → its bank line, by itself, ONLY when all of this holds (v55.83-SB, bug review 1 + 2):
//   • exactly one line fits (exact to the cent first; else one line up to $100 over),
//   • that line is exact to the cent OR reads like a wire (WIRE / FEDWIRE / SWIFT in its description),
//   • no person has verified that line's category (automation never touches verified rows),
//   • no OTHER sent wire could also claim the same line (two wires of the same amount → both go to a person).
// Otherwise nothing is attached; the wire screen lists the lines for a person to pick. Fail-soft: never throws.
export async function autoMatchSentWires(db, opts) {
  var o = opts || {}; var started = Date.now(); var out = { matched: [], ambiguous: [], waiting: 0 };
  try {
    var r = await db.from('wire_packages').select('*').eq('status', 'sent');
    var sent = ((r && r.data) || []).filter(function (p) { return p.sent_date && Number(p.approved_total) > 0; });
    var cand = {}; var claims = {};
    for (var i = 0; i < sent.length; i++) {
      if (Date.now() - started > (o.budgetMs || 20000)) { break; }
      var c = await wireCandidates(db, sent[i]);
      if (c.error) { continue; }
      cand[sent[i].id] = c.list;
      c.list.forEach(function (x) { claims[x.id] = (claims[x.id] || 0) + 1; });
    }
    for (var j = 0; j < sent.length; j++) {
      var pkg = sent[j]; var list = cand[pkg.id];
      if (!list || (o.packageId && pkg.id !== o.packageId)) { continue; }
      if (Date.now() - started > (o.budgetMs || 20000)) { break; }
      var exact = list.filter(function (x) { return x.exact; });
      var pick = exact.length === 1 ? exact[0] : (exact.length === 0 && list.length === 1 ? list[0] : null);
      var why = null;
      if (!pick) { why = list.length > 1 ? list.length + ' bank lines fit' : null; }
      else if (claims[pick.id] > 1) { why = 'another sent wire of the same amount could be this bank line'; }
      else if (pick.verified) { why = 'a person already verified that bank line’s category'; }
      else if (!pick.exact && !pick.looks_like_wire) { why = 'the only line that fits is $' + pick.fee.toFixed(2) + ' more and does not read like a wire'; }
      if (why || !pick) {
        if (why) { out.ambiguous.push({ id: pkg.id, label: packageLabel(pkg), candidates: list.length, why: why }); } else { out.waiting++; }
        continue;
      }
      var a = await attachWire(db, pkg, pick.row, o.actorId || null, { auto: true });
      if (a.ok) { out.matched.push({ id: pkg.id, label: packageLabel(pkg), bank_transaction_id: pick.id, bills_paid: a.bills_paid, bank_fee: a.bank_fee }); }
    }
  } catch (e) { out.error = (e && e.message) || 'auto-match failed'; }
  return out;
}
