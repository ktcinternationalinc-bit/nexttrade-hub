// /api/wave/default-bank-account — save the per-silo DEFAULT bank/Plaid account (the account
// Bank Review auto-loads when this Wave business is active). The account list comes from LOCAL
// bank data (bank_transactions/plaid_accounts), so this route only PERSISTS the choice into
// wave_business_settings. Requires wave.settings.manage (super_admin = all). SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-GD-default-bank-account';
var API_ROUTE = '/api/wave/default-bank-account';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function GET() {
  return NextResponse.json({ route: API_ROUTE, api_build_marker: API_BUILD_MARKER });
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var bid = body.wave_business_id;

    // SECURITY: service-role route — requires wave.settings.manage.
    var _perm = await assertPermission(db, body.user_id, 'wave.settings.manage', req);
    if (!_perm.ok) { return NextResponse.json({ error: _perm.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: _perm.status }); }
    if (!bid) { return NextResponse.json({ error: 'No Wave business selected.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }

    var accId = body.default_plaid_account_id || null;
    var accName = body.default_plaid_account_name || null;
    var connId = body.default_bank_connection_id || null;

    // When setting (not clearing), confirm the account actually has transactions in THIS silo —
    // never let a silo default to another silo's account.
    if (accId) {
      var chk = await db.from('bank_transactions').select('id').eq('wave_business_id', bid).eq('account_id', accId).limit(1);
      if (chk && chk.error) { return NextResponse.json({ db_error: chk.error.message || String(chk.error), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 }); }
      if (!(chk && chk.data && chk.data.length)) {
        return NextResponse.json({ error: 'That account has no transactions in this silo — pick an account that belongs to this Wave business.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 });
      }
    }

    var row = { wave_business_id: bid, default_plaid_account_id: accId, default_plaid_account_name: accName, default_bank_connection_id: connId, updated_at: new Date().toISOString() };
    var r = await db.from('wave_business_settings').upsert(row, { onConflict: 'wave_business_id' }).select();
    if (r && r.error) { return NextResponse.json({ db_error: r.error.message || String(r.error), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 }); }
    return NextResponse.json({ saved: true, default_plaid_account_id: accId, default_plaid_account_name: accName, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
