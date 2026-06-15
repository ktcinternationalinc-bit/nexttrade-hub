// /api/wave/preflight-schema — read-only check that every column/table the Wave payment +
// category + settings features need actually exists in the database. Returns a red/green
// list so missing columns are caught BEFORE a user clicks something that would fail with a
// raw "column not found" error. No writes. super_admin or CRON protected. SWC-safe.
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// table -> required columns
var REQUIRED = {
  wave_business_settings: ['default_invoice_product_id', 'default_invoice_product_name', 'default_payment_account_id', 'default_payment_account_name', 'source'],
  accounting_invoice_payments: ['wave_payment_id', 'wave_invoice_id', 'wave_customer_id', 'last_synced_at', 'sync_error', 'voided', 'voided_at', 'voided_by'],
  payment_matches: ['voided', 'voided_at', 'voided_by', 'invoice_id', 'bank_transaction_id'],
  accounting_invoices: ['wave_invoice_id', 'wave_imported_paid', 'amount_paid', 'balance_due', 'payment_status'],
  wave_categories: ['wave_business_id', 'wave_account_id', 'wave_account_name', 'is_active']
};

async function runCheck(request) {
  var db = admin();

  // Auth (no user write, but it reveals schema; keep it admin-only).
  var userId = null;
  try { var b = await request.clone().json(); userId = (b && (b.user_id || b.userId)) || null; } catch (e) { userId = null; }
  var gate = await assertPermission(db, userId, 'wave.settings.manage', request);
  if (!gate.ok) { return Response.json({ ok: false, error: gate.error }, { status: gate.status }); }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Server database key missing.' }, { status: 500 });
  }

  var tables = Object.keys(REQUIRED);
  var results = [];
  var allGreen = true;
  var ti;
  for (ti = 0; ti < tables.length; ti++) {
    var tname = tables[ti];
    var need = REQUIRED[tname];
    var missing = [];
    var tableExists = true;
    // Probe each required column individually: select it with limit(1). If the column (or
    // table) is missing, PostgREST returns an error mentioning the column — that's our signal.
    var ni;
    for (ni = 0; ni < need.length; ni++) {
      var col = need[ni];
      try {
        var probe = await db.from(tname).select(col).limit(1);
        if (probe && probe.error) {
          var msg = (probe.error.message || '').toLowerCase();
          if (msg.indexOf('does not exist') >= 0 || msg.indexOf('could not find') >= 0 || msg.indexOf('column') >= 0) { missing.push(col); }
          else if (msg.indexOf('relation') >= 0 || msg.indexOf('not exist') >= 0) { tableExists = false; missing.push(col); }
          else { missing.push(col); }
        }
      } catch (eP) { missing.push(col); }
    }
    var ok = tableExists && missing.length === 0;
    if (!ok) { allGreen = false; }
    results.push({ table: tname, exists: tableExists, missing: missing, ok: ok });
  }

  return Response.json({ ok: true, all_green: allGreen, results: results });
}

export async function POST(request) { return runCheck(request); }
export async function GET(request) { return runCheck(request); }
