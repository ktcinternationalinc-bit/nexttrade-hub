// v55.83-TW — NEXTRADE EXPENSE → KTC BILL (Max, Nov 17 2026).
// When a Nextrade bank or credit-card line (money OUT) is categorized as an expense, KTC owes Nextrade for it: a KTC bill
// is made AT ONCE — full amount, due at the end of that month, vendor from the line, "Created from Nextrade", paid via
// NextTrade, KTC category from the mapping set once per Nextrade category. It stays OPEN (owed to Nextrade); the Nextrade
// line never marks it paid.
//   • ONE bill per Nextrade line, EVER (company_bill_links, unique on the line) — two clicks at once cannot make two.
//   • An open KTC bill already there for the same vendor + amount within 10 days (e.g. a repeating rent bill) is ATTACHED
//     instead of making a second one.
//   • Payroll categories never make a bill (the repeating "Warehouse staff" bill covers payroll).
//   • Re-categorizing updates the bill; no longer an expense → the bill is VOIDED (never deleted) and comes back if the
//     line is categorized as an expense again. A bill with money recorded on it, or on a wire, is never voided here — the
//     change is refused and says why.
// Every step reads first and fails closed. Server only. SWC-safe (var + concatenation).
import { US_WAVE_BUSINESS_ID } from './business-of';
import { NEXTRADE_COMPANY_ID, isExpenseKind, endOfMonth } from './companies';
import { normVendor, checkOne } from './bill-dup-scan';

var ATTACH_DAYS = 10;
var DEFAULT_PARTY = 'NextTrade Industries';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function dayNo(s) { var t = Date.parse(String(s || '').substring(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : Math.round(t / 86400000); }
function addDays(s, n) { var d = dayNo(s); return d === null ? null : new Date((d + n) * 86400000).toISOString().substring(0, 10); }

// Should this line, with this category, have a KTC bill?  Pure.
export function wantsBill(line, cat) {
  if (!line || !cat) { return false; }
  if (line.direction !== 'out') { return false; }           // money in (refund, money from KTC) never makes a bill
  // v55.83-UD (Max, Nov 18: "warehouse staff is also a bill KTC has to pay") — a category can say "KTC pays this" or not;
  // when it says nothing (null) the old rule stands. Must match hub_company_categorize (sql/v55-83-UD-pay-nextrade.sql).
  if (typeof cat.makes_ktc_bill === 'boolean') { return cat.makes_ktc_bill; }
  if (cat.is_payroll === true) { return false; }            // payroll (old rule) → no bill
  return isExpenseKind(cat.kind);
}

export function vendorOfLine(line) {
  var v = String((line && (line.merchant_name || line.name)) || '').replace(/\s+/g, ' ').trim();
  return (v || 'Nextrade expense').substring(0, 120);
}
export function billNumberFor(line) { return 'NXT-' + String(line.date || '').replace(/-/g, '') + '-' + String(line.id || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase(); }

// The KTC bill row for a Nextrade line.  Pure.
export function nextradeBillRow(line, ktcCategory, partyName, actorId, accountLabel) {
  return {
    wave_business_id: US_WAVE_BUSINESS_ID, vendor_name: vendorOfLine(line), bill_number: billNumberFor(line),
    bill_date: String(line.date).substring(0, 10), due_date: endOfMonth(line.date), total_amount: r2(line.amount_abs),
    category: ktcCategory || null, paid_via: partyName || DEFAULT_PARTY, currency: 'USD', record_status: 'active',
    notes: ('Created from Nextrade — ' + String(line.name || line.merchant_name || '') + (accountLabel ? ' (' + accountLabel + ')' : '') + ', ' + String(line.date).substring(0, 10) + (ktcCategory ? '' : ' · needs a KTC category: set it in Accounting → 🟦 Nextrade → Category mapping')).substring(0, 900),
    created_by: actorId || null, updated_at: new Date().toISOString(),
  };
}

// Pick the open KTC bill to attach instead of making a new one: same vendor, same amount, within 10 days, not fully paid,
// not already attached to another Nextrade line.  Pure.
export function pickAttachable(line, bills, paidByBill, linkedBillIds) {
  var v = normVendor(vendorOfLine(line)); var amt = r2(line.amount_abs); var d = dayNo(line.date); var best = null;
  (bills || []).forEach(function (b) {
    if (!b || b.record_status !== 'active' || b.wave_business_id !== US_WAVE_BUSINESS_ID) { return; }
    if (linkedBillIds && linkedBillIds[b.id]) { return; }
    if (normVendor(b.vendor_name) !== v || Math.abs(r2(b.total_amount) - amt) > 0.01) { return; }
    var bd = dayNo(b.bill_date); if (bd === null || d === null || Math.abs(bd - d) > ATTACH_DAYS) { return; }
    if ((paidByBill && paidByBill[b.id] || 0) + 0.005 >= r2(b.total_amount)) { return; } // already paid — not owed any more
    if (!best || Math.abs(dayNo(best.bill_date) - d) > Math.abs(bd - d)) { best = b; }
  });
  return best;
}

export async function partyName(db) {
  try {
    var r = await db.from('paid_through_parties').select('name, kind').eq('kind', 'affiliate');
    if (!r.error && r.data && r.data.length) { return r.data[0].name; }
  } catch (e) { /* table missing — default name */ }
  return DEFAULT_PARTY;
}

// v55.83-TW (Codex QA 17 Nov, P1-2) — the KTC side is now written by ONE database function, hub_company_categorize
// (sql/v55-83-TW-company-books.sql): the line's category, the KTC bill (made / updated / voided / attached) and the link are
// saved together or not at all, under a lock on the line. This file only PREPARES the proposal the function re-checks:
// which open bill could be attached, the new bill's fields, and the duplicate check. Every read fails closed.
export async function prepareCategorize(db, line, cat, ctx) {
  var c = ctx || {};
  var payload = { line_id: line.id, company_id: line.wave_business_id, category_key: cat ? cat.key : null, actor: c.actorId, source: c.source || 'manual' };
  if (line.wave_business_id !== NEXTRADE_COMPANY_ID || !wantsBill(line, cat)) { return { ok: true, payload: payload }; }
  payload.ktc_category = c.ktcCategory || null; payload.party = c.party || DEFAULT_PARTY;
  // an open KTC bill already there for the same vendor + amount within 10 days → propose attaching it
  var from = addDays(line.date, -ATTACH_DAYS); var to = addDays(line.date, ATTACH_DAYS);
  var cand = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, record_status, wave_business_id, paid_via')
    .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('record_status', 'active').gte('bill_date', from).lte('bill_date', to);
  if (cand.error) { return { ok: false, error: 'Could not read KTC bills (' + cand.error.message + ') — nothing changed.' }; }
  var near = (cand.data || []).filter(function (b) { return Math.abs(r2(b.total_amount) - r2(line.amount_abs)) <= 0.01; });
  var paidBy = {}; var linked = {};
  if (near.length) {
    var ids = near.map(function (b) { return b.id; });
    var pr = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', ids);
    var lk = await db.from('company_bill_links').select('bill_id, status, source_bank_transaction_id').in('bill_id', ids).eq('status', 'active');
    if (pr.error || lk.error) { return { ok: false, error: 'Could not read KTC bill payments (' + ((pr.error || lk.error).message) + ') — nothing changed.' }; }
    (pr.data || []).forEach(function (p) { if (p.voided !== true) { paidBy[p.bill_id] = (paidBy[p.bill_id] || 0) + (Number(p.amount) || 0); } });
    (lk.data || []).forEach(function (l) { if (l.source_bank_transaction_id !== line.id) { linked[l.bill_id] = true; } });
  }
  var hit = pickAttachable(line, near, paidBy, linked);
  if (hit) { payload.attach_bill_id = hit.id; }
  // the new bill (used only if nothing is attached and the line has no bill yet) — duplicate check first, like every way
  // a bill enters the Hub
  var row = nextradeBillRow(line, c.ktcCategory, payload.party, c.actorId, c.accountLabel);
  // v55.83-UD (Codex 11:40) — a payroll line never carries a name onto the KTC side: the KTC bill says "Warehouse staff" only (as the
  // Nextrade screens do), and no description from the bank line goes into its notes.
  if (cat && cat.is_payroll === true) { row.vendor_name = 'Warehouse staff (Nextrade payroll)'; row.notes = ('Created from Nextrade — warehouse staff payroll, ' + String(line.date).substring(0, 10) + (c.ktcCategory ? '' : ' · needs a KTC category: set it in Accounting → 🟦 Nextrade → Category mapping')).substring(0, 900); }
  var all = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, release_number, other_reference, bill_type, record_status').eq('vendor_name', row.vendor_name);
  if (all.error) { return { ok: false, error: 'Could not run the duplicate check (' + all.error.message + ') — nothing changed.' }; }
  var dup = checkOne({ vendor_name: row.vendor_name, bill_number: row.bill_number, bill_date: row.bill_date, total_amount: row.total_amount }, all.data || [], {});
  if (dup.level === 'strong' && !hit) { return { ok: false, error: 'Not saved — the KTC bill for this line looks like a duplicate: ' + dup.reasons.join(' · ') }; }
  payload.bill = { wave_business_id: row.wave_business_id, vendor_name: row.vendor_name, bill_number: row.bill_number, bill_date: row.bill_date, due_date: row.due_date, notes: row.notes };
  return { ok: true, payload: payload };
}

// Run it. Returns { ok, action, bill_id, bill_number } or { ok: false, error } — on an error NOTHING was saved.
export async function categorizeLine(db, line, cat, ctx) {
  var prep = await prepareCategorize(db, line, cat, ctx);
  if (!prep.ok) { return prep; }
  var r = await db.rpc('hub_company_categorize', { p: prep.payload });
  if (r.error) {
    var m = String(r.error.message || '');
    if (/HUB_GUARD:/.test(m)) { return { ok: false, error: m.replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Nothing was changed.' }; }
    if (r.error.code === '23505') { return { ok: false, error: 'Someone else changed this line or its bill at the same moment — refresh and try again. Nothing was changed.' }; }
    return { ok: false, error: 'Not saved (' + (m || 'database error') + '). Nothing was changed.' };
  }
  var d = r.data || {};
  return { ok: true, action: d.action || 'none', bill_id: d.bill_id || null, bill_number: d.bill_number || null };
}
