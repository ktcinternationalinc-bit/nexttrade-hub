// v55.83-WZ — Bills → "Duplicates to resolve" (Max, 21 Nov 2026: "i don't want any duplicate bills"). READ ONLY: the active bills
// that share a vendor and a bill number in the same company's books (pairs already on file before the database rule
// sql/v55-83-WZ-same-number-bills.sql). Voiding the extra copies is done with the Bills route's own void_bill action, which
// refuses a bill with money on it or on a wire. Same permission as managing bills; the caller comes from the verified sign-in.
import { payrollBillScope, payrollFilteredDb, requestNamesPayroll, withPayrollLabel } from '../../../../lib/payroll-bills'; // v55.83-ZD
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { assertPermission } from '../../../../lib/server-permissions';
import { duplicateGroups } from '../../../../lib/bill-duplicates';

var API_BUILD_MARKER = 'v55.83-WZ-bill-duplicates';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function bad(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 400 }); }
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  for (var pg = 0; pg < 50; pg++) {
    var r = await buildQ().range(from, from + 999);
    if (r.error) { throw new Error(r.error.message); }
    var rows = r.data || []; out = out.concat(rows);
    if (rows.length < 1000) { break; }
    from += 1000;
  }
  return out;
}

async function postZD(req) {
  var db = admin();
  try {
    var body = await req.json();
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return Response.json({ ok: false, error: who.error }, { status: who.status || 401 }); }
    // v55.83-ZD — payroll bills: SUPER ADMIN ONLY. Who is calling + the payroll list, read once (fails closed); for anyone else a request
    // naming a payroll bill / wire package is "not found", and every read below leaves payroll out (so every total excludes it).
    var payZD = await payrollBillScope(db, who.userId); if (payZD.error) { return Response.json({ ok: false, error: payZD.error }, { status: payZD.status }); }
    if (requestNamesPayroll(payZD, body)) { return Response.json({ ok: false, error: 'Not found.' }, { status: 404 }); }
    db = payrollFilteredDb(db, payZD); try { req.__payZD = payZD; } catch (eZD) { /* read-only request */ }
    if (who.error) { return bad(who.error, who.status); }
    var gate = await assertPermission(db, who.userId, 'bills.manage', req);
    if (!gate || gate.ok !== true) { return bad('This needs the "Bills: manage" permission.', 403); }
    if ((body.action || 'list') !== 'list') { return bad('Unknown action.', 400); }
    var bills = await fetchAll(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, currency, record_status, wave_business_id, bill_type, disputed, validation_status, release_number, created_at, attachment_path').order('id', { ascending: true }); });
    var groups = duplicateGroups(bills, {}, {});
    var ids = []; groups.forEach(function (g) { g.copies.forEach(function (c) { ids.push(c.id); }); });
    var paidOf = {}; var wireOf = {};
    if (ids.length) {
      var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', ids);
      if (pq.error) { return bad('The payments could not be read (' + pq.error.message + ') — nothing shown.', 503); }
      (pq.data || []).forEach(function (p) { if (p.voided !== true) { paidOf[p.bill_id] = (paidOf[p.bill_id] || 0) + (Number(p.amount) || 0); } });
      var wl = await db.from('wire_package_lines').select('bill_id, package_id, is_open').in('bill_id', ids);
      if (wl.error) { return bad('The wires could not be read (' + wl.error.message + ') — nothing shown.', 503); }
      var pkgIds = []; (wl.data || []).forEach(function (l) { if (l.is_open !== false && pkgIds.indexOf(l.package_id) < 0) { pkgIds.push(l.package_id); } });
      var pk = pkgIds.length ? await db.from('wire_packages').select('id, seq, status').in('id', pkgIds) : { data: [] };
      if (pk.error) { return bad('The wires could not be read (' + pk.error.message + ') — nothing shown.', 503); }
      var pkOf = {}; (pk.data || []).forEach(function (p) { pkOf[p.id] = p; });
      (wl.data || []).forEach(function (l) { var p = pkOf[l.package_id]; if (l.is_open !== false && p && p.status !== 'cancelled') { wireOf[l.bill_id] = { label: 'WP-' + String(p.seq || 0).padStart(4, '0'), status: p.status }; } });
    }
    return NextResponse.json({ ok: true, groups: duplicateGroups(bills, paidOf, wireOf), api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return bad('Could not list duplicate bills (' + ((e && e.message) || 'error') + ').', 500);
  }
}

// v55.83-ZD — the answer says "excluding payroll" to a non-super-admin whenever payroll bills exist (they are left out of it)
export async function POST(req) { return withPayrollLabel(req, await postZD(req)); }
