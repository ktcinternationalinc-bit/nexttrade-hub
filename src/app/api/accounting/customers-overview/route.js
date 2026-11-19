// v55.83-VN — CUSTOMERS OVERVIEW (Max, Nov 19 2026). READ ONLY: this route never writes.
//   POST { user_id, date_from, date_to, business: 'US' | 'EG' }  with the sign-in token in Authorization.
// Who is calling comes from the verified token (a different body.user_id is refused). Needs "AR: View Invoice Balances".
// Employees see ONLY the permitted history window (super admin sees all-time): the window is applied to the invoices listed
// AND to the payments: an invoice with a payment dated before the window (or with no date) has its paid and balance withheld,
// never shown as unpaid. Company-wide totals, in every currency, are sent only to people with the totals switch.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { assertPermission } from '../../../../lib/server-permissions';
import { windowFloorFor } from '../../../../lib/visibility-window-server';
import { buildCustomersOverview, maskOverviewTotals } from '../../../../lib/customers-overview';

var API_BUILD_MARKER = 'v55.83-VN-customers-overview';
var PAGE = 1000; var MAX_ROWS = 60000;
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function bad(msg, status) { return NextResponse.json({ error: msg }, { status: status || 400 }); }
function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  while (out.length < MAX_ROWS) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status); }
    var userId = who.userId;
    var perm = await assertPermission(db, userId, 'ar.view_invoice_balances', req);
    if (!perm || perm.ok !== true) { return bad('This needs the "AR: View Invoice Balances" permission — grant it in Settings → Module Access.', 403); }
    var vwin = await windowFloorFor(db, perm.ctx); if (vwin.error) { return bad(vwin.error, 503); }
    var tot = await assertPermission(db, userId, 'accounting.view_totals', req); var canTotals = !!(tot && tot.ok === true);
    if (body.date_from && !isDay(body.date_from)) { return bad('The start date is not a date.', 400); }
    if (body.date_to && !isDay(body.date_to)) { return bad('The end date is not a date.', 400); }

    var invoices = await fetchAll(function () {
      return db.from('accounting_invoices').select('id, invoice_number, release_number, accounting_customer_id, invoice_date, due_date, total_amount, wave_imported_paid, record_status, wave_status, currency, source, wave_invoice_id, wave_business_id').order('id', { ascending: true });
    });
    var customers = await fetchAll(function () { return db.from('accounting_customers').select('id, company_name, contact_name, business_tag').order('id', { ascending: true }); });
    var payments = await fetchAll(function () { return db.from('accounting_invoice_payments').select('id, accounting_invoice_id, amount, payment_date, voided, sync_status').order('id', { ascending: true }); });

    // arrival dates: the Nextrade warehouse feed the Hub is set to read (staging until production is switched). When that
    // feed cannot be read the report still comes back, without arrival dates, and says so.
    var whSource = 'nextrade-staging'; var warehouse = []; var whNote = '';
    try {
      var st = await db.from('pl_warehouse_settings').select('value').eq('key', 'active_source').maybeSingle();
      if (st.error) { throw new Error(st.error.message); }
      if (st.data && st.data.value) { whSource = String(st.data.value); }
      warehouse = await fetchAll(function () {
        return db.from('pl_warehouse_shipping').select('id, release_key, arrival_date, section, superseded, in_latest_feed, flags').eq('source', whSource).eq('superseded', false).eq('in_latest_feed', true).order('id', { ascending: true });
      });
    } catch (eW) { warehouse = []; whNote = 'The warehouse arrival dates could not be read just now, so none are shown.'; }

    var report = buildCustomersOverview({
      invoices: invoices, customers: customers, payments: payments, warehouse: warehouse,
      from: body.date_from || '', to: body.date_to || '', floor: vwin.floor || null,
      today: new Date().toISOString().substring(0, 10), business: body.business === 'EG' ? 'EG' : 'US'
    });
    report = maskOverviewTotals(report, canTotals);
    report.ok = true;
    report.warehouse_source = whSource; report.warehouse_is_staging = whSource !== 'nextrade-live'; report.warehouse_note = whNote;
    report.api_build_marker = API_BUILD_MARKER;
    return NextResponse.json(report);
  } catch (e) { return bad((e && e.message) || 'customers overview failed', 500); }
}
