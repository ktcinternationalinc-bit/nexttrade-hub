// v55.83-TV — REPEATING BILLS, the part that writes. Server only (service-role client passed in). SWC-safe.
//
// For each ACTIVE repeating bill, makes the bills whose date has come (see dueDates in repeating-bills.js):
//   1. CLAIM the date — insert a recurring_bill_runs row; the database allows only one per repeating bill per date, so two
//      runs at the same moment (the daily job + someone pressing "Make due bills now") can never both make it.
//   2. DUPLICATE CHECK — the same check as a bill typed by hand (bill-dup-scan checkOne, against every bill on file).
//      A strong duplicate is NOT made: the date is marked "skipped — looks like a duplicate of …" for a person to decide
//      ("Make it anyway" on the screen).
//   3. MAKE THE BILL — with the repeating bill's id and date on it (a second unique rule in vendor_bills), the vendor's
//      remembered category when none was set, and an audit row.
// Fails closed: when the bills on file cannot be read, nothing is made (the date stays open for the next run).
import { dueDates, autoBillNumber, scheduleWords, MAX_PER_RUN } from './repeating-bills';
import { checkOne } from './bill-dup-scan';
import { audit } from './audit-server';
import { autoValidatePayroll } from './payroll-auto-validate-server'; // v55.83-ZY
import { categoryForNewBill, loadBillRules, provenanceFields } from './bill-rules-server'; // v55.83-WX — bill rules, then the vendor memory

var PAGE = 1000;
var STALE_PENDING_MS = 10 * 60 * 1000; // a claim left 'pending' this long (a run that crashed) may be taken again

async function fetchAll(buildQ) {
  var out = []; var from = 0;
  while (out.length < 50000) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}

export function todayNY() {
  // the business runs on New York time; the date a bill is "due" is a New York date
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString().substring(0, 10); }
}

// every bill the duplicate check compares with (all companies' bills are in vendor_bills; deleted/void ones are ignored by checkOne)
export async function loadBillsForDupCheck(db) {
  return fetchAll(function () {
    return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, release_number, other_reference, bill_type, record_status').order('id', { ascending: true });
  });
}

// { 'YYYY-MM-DD': run } for one repeating bill
export async function loadRuns(db, recurringId) {
  var rows = await fetchAll(function () { return db.from('recurring_bill_runs').select('id, occurrence_date, outcome, bill_id, message, updated_at').eq('recurring_id', recurringId).order('occurrence_date', { ascending: true }); });
  var map = {};
  rows.forEach(function (r) { map[String(r.occurrence_date).substring(0, 10)] = r; });
  return map;
}

function isDone(run, nowMs) {
  if (!run) { return false; }
  if (run.outcome === 'created' || run.outcome === 'skipped_duplicate') { return true; }
  if (run.outcome === 'pending') { var t = Date.parse(run.updated_at || ''); return !(t > 0) || (nowMs - t) < STALE_PENDING_MS; }
  return false; // 'failed' → try again
}

// Take the date for this run. Returns the run row id, or null when someone else holds it.
async function claim(db, rb, date, existing) {
  var stamp = new Date().toISOString();
  if (!existing) {
    var ins = await db.from('recurring_bill_runs').insert({ recurring_id: rb.id, occurrence_date: date, outcome: 'pending', updated_at: stamp }).select('id').maybeSingle();
    if (ins.error) { if (ins.error.code === '23505') { return null; } throw new Error(ins.error.message); }
    return ins.data ? ins.data.id : null;
  }
  // a failed or crashed attempt: take it over only if it is still exactly as we read it (nobody else took it meanwhile)
  var up = await db.from('recurring_bill_runs').update({ outcome: 'pending', message: null, updated_at: stamp })
    .eq('id', existing.id).eq('outcome', existing.outcome).eq('updated_at', existing.updated_at).select('id');
  if (up.error) { throw new Error(up.error.message); }
  return up.data && up.data.length ? existing.id : null;
}

async function finish(db, runId, outcome, billId, message) {
  await db.from('recurring_bill_runs').update({ outcome: outcome, bill_id: billId || null, message: message ? String(message).substring(0, 900) : null, updated_at: new Date().toISOString() }).eq('id', runId);
}

// The bill row for one date of one repeating bill.
export function billRowFor(rb, date, category) {
  var row = {
    wave_business_id: rb.wave_business_id, vendor_name: rb.vendor_name, bill_number: autoBillNumber(rb.vendor_name, date),
    bill_date: date, due_date: date, total_amount: Number(rb.amount), category: category || null,
    notes: ('🔁 Repeating bill (' + scheduleWords(rb) + ')' + (rb.notes ? ' — ' + rb.notes : '')).substring(0, 900),
    currency: 'USD', record_status: 'active', created_by: rb.created_by || null,
    recurring_id: rb.id, recurring_date: date, updated_at: new Date().toISOString(),
  };
  if (rb.release_number) { row.release_number = rb.release_number; row.shipment_direction = 'outbound'; row.direction_source = 'release_number'; }
  return row;
}

async function makeBill(db, rb, date, runId, bills, actorId, forced, reasons) {
  var cat = rb.category || null; var autoCat = false;
  // v55.83-WX — a category set on the repeating bill is the person's; otherwise the bill rules first, then the vendor memory
  var pick = null;
  if (!cat) { pick = await categoryForNewBill(db, { vendor_name: rb.vendor_name, total_amount: rb.amount, currency: 'USD', wave_business_id: rb.wave_business_id, bill_number: autoBillNumber(rb.vendor_name, date), notes: rb.notes || '', release_number: rb.release_number || null }, []); cat = pick.category || null; autoCat = !!cat; }
  var row = billRowFor(rb, date, cat);
  Object.assign(row, pick ? provenanceFields(pick, pick.ready) : provenanceFields({ source: 'manual' }, (await loadBillRules(db)).ready));
  var ins = await db.from('vendor_bills').insert(row).select('id').maybeSingle();
  if (ins.error && ins.error.code === '23505') {
    // the bill for this date already exists (made a moment ago by another run) — point the run at it, make nothing
    var ex = await db.from('vendor_bills').select('id').eq('recurring_id', rb.id).eq('recurring_date', date).maybeSingle();
    await finish(db, runId, 'created', ex && ex.data ? ex.data.id : null, 'Already made.');
    return { date: date, outcome: 'created', bill_id: ex && ex.data ? ex.data.id : null, already: true };
  }
  if (ins.error) { await finish(db, runId, 'failed', null, ins.error.message); return { date: date, outcome: 'failed', message: ins.error.message }; }
  var billId = ins.data && ins.data.id;
  await autoValidatePayroll(db, billId); // v55.83-ZY — a repeating payroll bill is validated by the system (never throws)
  await finish(db, runId, 'created', billId, forced ? 'Made anyway by a person (looked like a duplicate).' : null);
  bills.push({ id: billId, vendor_name: row.vendor_name, bill_number: row.bill_number, bill_date: row.bill_date, total_amount: row.total_amount, release_number: row.release_number || null, other_reference: null, bill_type: null, record_status: 'active' });
  await audit(db, actorId || rb.created_by || null, forced ? 'bill_duplicate_override' : 'bill_created', 'vendor_bill', billId,
    { vendor: row.vendor_name, amount: row.total_amount, category: cat, auto_category: autoCat, repeating_bill_id: rb.id, repeating_date: date, by_schedule: !actorId, reasons: reasons || undefined });
  return { date: date, outcome: 'created', bill_id: billId, bill_number: row.bill_number };
}

// Make every due bill. opts: { today, onlyId, actorId }. Returns { ok, made, skipped, failed, results: [...] }.
export async function runRepeatingBills(db, opts) {
  var o = opts || {};
  var today = o.today || todayNY();
  var q = db.from('recurring_bills').select('*').eq('status', 'active');
  if (o.onlyId) { q = q.eq('id', o.onlyId); }
  var rbR = await q;
  if (rbR.error) { return { ok: false, error: 'Could not read the repeating bills (' + rbR.error.message + ') — nothing was made.' }; }
  var list = rbR.data || [];
  var out = { ok: true, today: today, made: 0, skipped: 0, failed: 0, results: [] };
  if (!list.length) { return out; }
  var bills;
  try { bills = await loadBillsForDupCheck(db); }
  catch (eB) { return { ok: false, error: 'Could not read the bills on file for the duplicate check (' + eB.message + ') — nothing was made.' }; }
  var nowMs = Date.now();
  for (var i = 0; i < list.length; i++) {
    var rb = list[i]; var msgs = [];
    try {
      var runs = await loadRuns(db, rb.id);
      var done = {}; Object.keys(runs).forEach(function (d) { if (isDone(runs[d], nowMs)) { done[d] = true; } });
      var dates = dueDates(rb, today, done, MAX_PER_RUN);
      for (var j = 0; j < dates.length; j++) {
        var date = dates[j];
        var runId = await claim(db, rb, date, runs[date] || null);
        if (!runId) { continue; } // someone else is making it right now
        var cand = { vendor_name: rb.vendor_name, bill_number: autoBillNumber(rb.vendor_name, date), bill_date: date, total_amount: Number(rb.amount), release_number: rb.release_number || null, other_reference: null, bill_type: null };
        var v = checkOne(cand, bills, {});
        if (v.level === 'strong') {
          var why = 'Not made — looks like a duplicate: ' + v.reasons.join(' · ');
          await finish(db, runId, 'skipped_duplicate', null, why);
          await audit(db, o.actorId || null, 'repeating_bill_skipped_duplicate', 'recurring_bill', rb.id, { date: date, reasons: v.reasons, others: v.others });
          out.skipped++; msgs.push(date + ' skipped (duplicate?)');
          out.results.push({ recurring_id: rb.id, vendor: rb.vendor_name, date: date, outcome: 'skipped_duplicate', message: why });
          continue;
        }
        var r = await makeBill(db, rb, date, runId, bills, o.actorId || null, false, null);
        r.recurring_id = rb.id; r.vendor = rb.vendor_name;
        if (r.outcome === 'created') { if (!r.already) { out.made++; msgs.push(date + ' made'); } } else { out.failed++; msgs.push(date + ' failed'); }
        out.results.push(r);
      }
    } catch (eR) {
      out.failed++; msgs.push('error: ' + eR.message);
      out.results.push({ recurring_id: rb.id, vendor: rb.vendor_name, outcome: 'failed', message: eR.message });
    }
    try { await db.from('recurring_bills').update({ last_run_at: new Date().toISOString(), last_message: msgs.length ? msgs.join(' · ').substring(0, 500) : 'Nothing due.' }).eq('id', rb.id); } catch (eU) { /* fail-soft */ }
  }
  return out;
}

// A person looked at a date that was skipped as a likely duplicate and wants the bill anyway.
export async function makeSkippedAnyway(db, recurringId, date, actorId) {
  var rbR = await db.from('recurring_bills').select('*').eq('id', recurringId).maybeSingle();
  if (rbR.error) { return { ok: false, status: 503, error: 'Could not read the repeating bill (' + rbR.error.message + ').' }; }
  if (!rbR.data) { return { ok: false, status: 404, error: 'Repeating bill not found.' }; }
  if (rbR.data.status === 'stopped') { return { ok: false, status: 409, error: 'This repeating bill is stopped.' }; }
  var runR = await db.from('recurring_bill_runs').select('id, outcome, updated_at, message').eq('recurring_id', recurringId).eq('occurrence_date', date).maybeSingle();
  if (runR.error) { return { ok: false, status: 503, error: 'Could not read that date (' + runR.error.message + ').' }; }
  if (!runR.data || runR.data.outcome !== 'skipped_duplicate') { return { ok: false, status: 409, error: 'That date was not skipped — refresh the list.' }; }
  var bills;
  try { bills = await loadBillsForDupCheck(db); } catch (eB) { return { ok: false, status: 503, error: 'Could not read the bills on file (' + eB.message + ') — nothing was made.' }; }
  var runId = await claim(db, rbR.data, date, runR.data);
  if (!runId) { return { ok: false, status: 409, error: 'Someone else is handling that date right now — refresh.' }; }
  var r = await makeBill(db, rbR.data, date, runId, bills, actorId, true, [runR.data.message || '']);
  if (r.outcome !== 'created') { return { ok: false, status: 500, error: 'Not made (' + (r.message || 'error') + ').' }; }
  return { ok: true, bill_id: r.bill_id, bill_number: r.bill_number };
}
