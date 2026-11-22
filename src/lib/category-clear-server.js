// v55.83-XU — "Remove category" on KTC bank lines (Max, 22 Nov 2026: "i need to be able to uncATEORIZE A SELCTION AFTER I
// CATEGORIZE IT."). A person takes the category off one or many lines at any later time; they go back to Uncategorized.
// Revision 2 (Codex 22 Nov 18:08):
//   • a line this person may not see (private account, another company, older than their history, or not found) comes back as
//     its ID and "restricted" ONLY — no payee, date, amount, direction or reason (P1);
//   • each line is cleared by ONE guarded database step (sql/v55-83-XU-clear-category.sql, hub_bank_clear_category): it locks the
//     line, checks it is still exactly as read, re-checks every money association at that moment (ledger, closed month, Wave,
//     invoice / bill payments, payment matches, splits, held money, wires, company funds, adjustments, order deposits, treasury,
//     verified, pending, duplicate) and writes the change and its audit row together or not at all (P2 ×2);
//   • the step not installed / not answering → NOTHING is changed (fail closed);
//   • 'cleared' is a person's choice of "no category": rule runs, look-alike fills, wire auto-filing and the bank sync never fill it.
// Server only. var + concat.
import { outOfScope } from './category-undo-server';

export var CLEAR_MAX = 500;
export var CLEARED = 'cleared';
var COLS = 'id, name, merchant_name, account_id, wave_business_id, date, posted_date, amount_abs, direction, pending, transfer_group_id, matched_invoice_id, classification, category_source, category_verified, review_status, wave_account_id, category_status, wave_sync_status, sync_status';
// the fields the database step compares with what was read (null-safe)
var EXPECT = ['classification', 'category_source', 'category_verified', 'review_status', 'wave_account_id', 'category_status', 'wave_sync_status', 'sync_status', 'transfer_group_id', 'matched_invoice_id', 'pending', 'account_id', 'date', 'posted_date'];

function day(t) { return String((t && (t.posted_date || t.date)) || '').substring(0, 10); }
function money(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// plain words for each refusal code of the database step (for lines the person may see)
export function reasonFor(code, extra) {
  var x = extra || {};
  switch (code) {
    case 'ledger': return 'it is already in the ClickBooks ledger — reverse the entry in ClickBooks first';
    case 'wave': return 'it has already been sent to Wave — change it in Wave';
    case 'closed': return 'its month is closed (books closed through ' + String(x.through || '').substring(0, 10) + ')';
    case 'transfer': return 'it is paired as a transfer — unpair it first (↔)';
    case 'invoice': return 'it is matched to an invoice payment — unmatch it in Bank Review first';
    case 'match': return 'it has a payment match — undo the match in Bank Review first';
    case 'bill': return 'it pays a bill — take the payment off the bill first (Bills)';
    case 'split': return 'it is split into parts — change or remove the split in Bank Review first';
    case 'held': return 'it has money held as an unapplied deposit or customer credit — apply or release it first (Bank Review)';
    case 'wire': return 'it is linked to a wire — change it on the Wires screen first';
    case 'funds': return 'it is linked to company funds (RTM / NextTrade money, a funding transfer or a Nextrade bill) — change it there first';
    case 'adjustment': return 'it has a manual bank adjustment in ClickBooks — reverse that first';
    case 'order': return 'it is linked to an order deposit — unlink it on the order first';
    case 'treasury': return 'it is matched in Treasury — unmatch it there first';
    case 'verified': return 'its category is verified — take the ✓ verified mark off first';
    case 'pending': return 'it is still pending at the bank';
    case 'duplicate': return 'it is a marked duplicate copy';
    case 'changed': return 'it was changed by someone a moment ago — refresh and look again';
    default: return 'it could not be changed (' + String(code || 'unknown') + ')';
  }
}
function needsSql(err) { var m = String((err && (err.message || err.code)) || ''); return /hub_bank_clear_category|PGRST202|schema cache|does not exist|Could not find the function/i.test(m); }

// The clear. Returns { ok: false, status, error } (nothing changed) or { ok: true, cleared: [ids], refused: [...], already }.
// refused items: { id, restricted: true } for lines this person may not see; { id, who, date, amount, direction, why } otherwise.
export async function clearCategories(db, by, ids, scope) {
  if (!Array.isArray(ids) || !ids.length) { return { ok: false, status: 400, error: 'Pick at least one line.' }; }
  if (!by) { return { ok: false, status: 401, error: 'Sign in again — nothing was changed.' }; }
  var uniq = []; var seen = {};
  ids.forEach(function (x) { var k = String(x || ''); if (k && !seen[k]) { seen[k] = true; uniq.push(k); } });
  if (uniq.length > CLEAR_MAX) { return { ok: false, status: 400, error: 'At most ' + CLEAR_MAX + ' lines at a time — narrow the selection.' }; }
  var byId = {};
  for (var i = 0; i < uniq.length; i += 200) {
    var r = await db.from('bank_transactions').select(COLS).in('id', uniq.slice(i, i + 200));
    if (!r || r.error) { return { ok: false, status: 503, error: 'The lines could not be read. Nothing was changed — try again in a moment.' }; }
    (r.data || []).forEach(function (t) { byId[String(t.id)] = t; });
  }
  var s = scope || {};
  var cleared = []; var refused = []; var already = 0; var started = false;
  for (var j = 0; j < uniq.length; j++) {
    var id = uniq[j]; var t = byId[id];
    // (Codex P1) not found / not this person's to see → its ID and "restricted" only, decided BEFORE anything about it is formatted
    if (!t || outOfScope(t, s)) { refused.push({ id: id, restricted: true, why: 'restricted' }); continue; }
    if (!t.classification) { already++; continue; }
    var expect = {}; EXPECT.forEach(function (k) { var v = t[k] === undefined ? null : t[k]; expect[k] = (k === 'date' || k === 'posted_date') && v ? String(v).substring(0, 10) : v; });
    var res = null; var err = null;
    try { var rr = await db.rpc('hub_bank_clear_category', { p: { id: id, actor: by, business: s.business || null, expect: expect } }); if (rr && rr.error) { err = rr.error; } else { res = rr ? rr.data : null; } }
    catch (eR) { err = eR; }
    if (err || !res) {
      // the step is not installed (or not answering) before anything was cleared → nothing at all is changed, said plainly
      if (!started) { return { ok: false, status: needsSql(err) ? 409 : 503, needs_sql: needsSql(err), error: needsSql(err) ? 'Remove category needs a one-time database step first (sql/v55-83-XU-clear-category.sql). Nothing was changed.' : 'The database did not answer. Nothing was changed — try again in a moment.' }; }
      refused.push({ id: id, who: String(t.merchant_name || t.name || '').substring(0, 60), date: day(t), amount: money(t.amount_abs), direction: t.direction || null, why: 'it could not be saved just now — try it again' });
      continue;
    }
    started = true;
    if (res.ok === true) { cleared.push(id); continue; }
    if (res.code === 'blank') { already++; continue; }
    if (res.code === 'restricted' || res.code === 'missing') { refused.push({ id: id, restricted: true, why: 'restricted' }); continue; }
    refused.push({ id: id, who: String(t.merchant_name || t.name || '').substring(0, 60), date: day(t), amount: money(t.amount_abs), direction: t.direction || null, code: res.code, why: reasonFor(res.code, res) });
  }
  return { ok: true, cleared: cleared, refused: refused, already: already };
}

// one sentence for the person (the list of lines left is shown on the screen)
export function clearWords(r) {
  if (!r || r.ok !== true) { return (r && r.error) || 'Nothing was changed.'; }
  var n = (r.cleared || []).length; var m = (r.refused || []).length;
  var out = n ? 'Category taken off ' + n + ' line(s) — they are Uncategorized now and rules will not fill them again.' : 'No category was taken off.';
  if (r.already) { out += ' ' + r.already + ' had no category already.'; }
  if (m) {
    var rest = (r.refused || []).filter(function (x) { return x.restricted; }).length;
    out += ' ' + m + ' line(s) were LEFT as they are' + (m - rest ? ' (listed with the reason)' : '') + (rest ? '; ' + rest + ' you may not change' : '') + '.';
  }
  return out;
}
