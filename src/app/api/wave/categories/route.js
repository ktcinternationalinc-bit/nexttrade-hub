// /api/wave/categories — v55.83-JA. Service-role READ of the silo's usable Wave categories for the
// Bank Review categorize dropdown. The browser query could silently return empty under RLS (so
// "89 loaded" in Sync Center but an empty dropdown). This reads with the service-role key and applies
// the SAME usability filters Bank Review uses, returning diagnostic counts so the UI can explain an
// empty dropdown (query failed / wrong silo / all filtered / truly missing). SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-JA-categories';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function isReceivable(c) {
  var sub = String(c.subtype || '').toUpperCase();
  var nm = String(c.wave_account_name || '').toUpperCase();
  return sub.indexOf('RECEIVABLE') >= 0 || nm.indexOf('RECEIVABLE') >= 0;
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
    var hiddenReceivable = 0;
    var seen = {}; var usable = [];
    active.forEach(function (c) {
      if (!c.wave_account_id || seen[c.wave_account_id]) { return; }
      if (isReceivable(c)) { hiddenReceivable++; return; }
      seen[c.wave_account_id] = true; usable.push(c);
    });
    return NextResponse.json({ ok: true, wave_business_id: waveBusinessId, total: total, active_count: active.length, usable_count: usable.length, hidden_receivable_count: hiddenReceivable, categories: usable, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/categories', marker: API_BUILD_MARKER }); }
