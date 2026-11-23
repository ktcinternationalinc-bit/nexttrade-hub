// v55.83-YD — reading vendor credits on the server. FAILS CLOSED: when the applications cannot be read, the caller is told (error) and
// must not treat a bill as fully owed or paid. Before the database step (sql/v55-83-YD-vendor-credits.sql) is installed there are no
// credits at all: { installed: false, byBill: {} } (that table missing is the ONLY case read as "none").
import { creditsByBill } from './vendor-credits';

function missing(err) { return !!err && (/vendor_credit|does not exist|schema cache|Could not find/i.test(String(err.message || '')) || err.code === '42P01'); }

export async function vendorCreditsInstalled(db) {
  try { var r = await db.rpc('hub_vendor_credits_installed'); return !r.error && r.data === true; } catch (e) { return false; }
}

// { byBill: { billId: credited }, apps: [...], installed, error } for these bills (live bill-kind applications)
export async function loadBillCredits(db, billIds) {
  var ids = (billIds || []).filter(Boolean); var apps = [];
  for (var i = 0; i < ids.length; i += 200) {
    var q = await db.from('vendor_credit_applications').select('id, credit_id, kind, bill_id, amount, applied_date, voided').in('bill_id', ids.slice(i, i + 200));
    if (q.error) {
      if (missing(q.error) && !(await vendorCreditsInstalled(db))) { return { byBill: {}, apps: [], installed: false, error: null }; }
      return { byBill: null, apps: null, installed: true, error: 'The vendor credits could not be read (' + (q.error.message || 'error') + ').' };
    }
    apps = apps.concat(q.data || []);
  }
  return { byBill: creditsByBill(apps), apps: apps, installed: true, error: null };
}

// v55.83-YD (Codex 23 Nov) — the vendor credits applied to bills in these dates, NOT yet counted in Profitability / P&L by period. Shown
// there as an explicit pending adjustment (those figures are not final while it is not zero). { count, by_currency, error }
export async function creditsPendingInWindow(db, from, to) {
  var out = { count: 0, by_currency: {}, error: null };
  var q = db.from('vendor_credit_applications').select('amount, applied_date, voided, kind, bill_id, credit_id').eq('kind', 'bill');
  if (from) { q = q.gte('applied_date', from); }
  if (to) { q = q.lte('applied_date', to); }
  var r = await q.limit(5000);
  if (r.error) {
    if (missing(r.error) && !(await vendorCreditsInstalled(db))) { return out; }
    out.error = 'Vendor credits could not be read (' + (r.error.message || 'error') + ') — they may be missing from these figures.'; return out;
  }
  if ((r.data || []).length >= 5000) { out.error = 'More than 5,000 vendor credit applications in these dates — the pending total is not complete.'; return out; }
  var live = (r.data || []).filter(function (a) { return a.voided !== true; });
  if (!live.length) { return out; }
  var cIds = []; live.forEach(function (a) { if (cIds.indexOf(a.credit_id) < 0) { cIds.push(a.credit_id); } });
  var curOf = {};
  for (var i = 0; i < cIds.length; i += 200) {
    var cq = await db.from('vendor_credits').select('id, currency').in('id', cIds.slice(i, i + 200));
    if (cq.error) { out.error = 'Vendor credits could not be read (' + cq.error.message + ').'; return out; }
    (cq.data || []).forEach(function (c) { curOf[c.id] = c.currency || 'USD'; });
  }
  live.forEach(function (a) { var cur = curOf[a.credit_id] || 'USD'; out.count++; out.by_currency[cur] = Math.round(((out.by_currency[cur] || 0) + (Number(a.amount) || 0)) * 100) / 100; });
  return out;
}
