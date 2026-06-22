// /api/wave/categories — v55.83-JA. Service-role READ of the silo's usable Wave categories for the
// Bank Review categorize dropdown. The browser query could silently return empty under RLS (so
// "89 loaded" in Sync Center but an empty dropdown). This reads with the service-role key and applies
// the SAME usability filters Bank Review uses, returning diagnostic counts so the UI can explain an
// empty dropdown (query failed / wrong silo / all filtered / truly missing). SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-LE-categories';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
// v55.83-KY — hide accounts that are NOT bank-categorization targets. The big one: Wave auto-creates a
// SYSTEM payable/receivable sub-account per bill/invoice, so the list floods with dozens of identical
// "Accounts Payable (System Payable Bill)" rows that bury the real expense/income accounts. You categorize
// a bank transaction as an expense/income account (or match it to an invoice) — never as these system AP/AR
// sub-accounts. Hide subtype/name containing SYSTEM, PAYABLE, or RECEIVABLE.
function isHiddenForCategorize(c) {
  var sub = String(c.subtype || '').toUpperCase();
  var nm = String(c.wave_account_name || '').toUpperCase();
  // v55.83-LE (workflow 2b) — hide ONLY Wave's auto-generated SYSTEM rows, not legitimate hand-named
  // Payable/Receivable accounts. The KY/LA rule hid ANY name containing PAYABLE/RECEIVABLE, which wrongly
  // dropped real accounts a bank txn legitimately classifies to (Loan Payable, Sales Tax Payable, Credit
  // Card Payable, Notes Payable, Accounts Receivable). Wave's flood rows are named "... (System ... )"
  // and/or carry a SYSTEM subtype, so match the "(SYSTEM" parenthetical OR a SYSTEM subtype only.
  return nm.indexOf('(SYSTEM') >= 0 || sub.indexOf('SYSTEM') >= 0;
}

export async function POST(req) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var waveBusinessId = body.wave_business_id || null;
    var gate = await assertPermission(db, by, 'bank.classify', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!waveBusinessId) { return NextResponse.json({ ok: false, error: 'wave_business_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    var res = await db.from('wave_categories').select('wave_business_id, wave_account_id, wave_account_name, type, subtype, is_active').eq('wave_business_id', waveBusinessId);
    if (res && res.error) { return NextResponse.json({ ok: false, error: 'Category read failed: ' + res.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var all = (res && res.data) || [];
    var total = all.length;
    var active = all.filter(function (c) { return c.is_active !== false; });
    var hiddenSystem = 0; var hiddenDupName = 0;
    var seen = {}; var usable = [];
    // v55.83-LE (workflow 2b) — dedupe by wave_account_id ONLY. The old name-collapse dropped legitimately
    // DISTINCT accounts that happen to share a display name (the UI label appends subtype + type, so they
    // are distinguishable). True duplicate rows are already prevented by the per-id dedup below.
    active.forEach(function (c) {
      if (!c.wave_account_id || seen[c.wave_account_id]) { return; }
      seen[c.wave_account_id] = true;
      if (isHiddenForCategorize(c)) { hiddenSystem++; return; }
      usable.push(c);
    });
    // stable, human-friendly order: by name.
    usable.sort(function (a, b) { var an = String(a.wave_account_name || '').toLowerCase(); var bn = String(b.wave_account_name || '').toLowerCase(); return an < bn ? -1 : (an > bn ? 1 : 0); });
    return NextResponse.json({ ok: true, wave_business_id: waveBusinessId, total: total, active_count: active.length, usable_count: usable.length, hidden_receivable_count: hiddenSystem, hidden_system_count: hiddenSystem, hidden_duplicate_name_count: hiddenDupName, categories: usable, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/categories', marker: API_BUILD_MARKER }); }
