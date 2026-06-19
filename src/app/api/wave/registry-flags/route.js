// /api/wave/registry-flags — v55.83-IZ. Save Wave business registry flags (production unlock + push
// flags) through the SERVICE-ROLE key so they actually persist. The client toggle wrote
// wave_business_registry directly and ignored the error/0-row result — under RLS (email-auth:
// users.id != auth.uid()) the write was silently filtered, so super-admins "couldn't unlock real KTC."
// Production push authorization is a real-money control and must not be a direct browser table write.
// SWC-safe: var + string concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-IZ-registry-flags';
// Only these flags may be set through this route.
var ALLOWED = { production_push_unlocked: 1, writes_enabled: 1, allow_customer_push: 1, allow_invoice_push: 1, allow_payment_push: 1, allow_auto_push: 1 };

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function POST(req) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var waveBusinessId = body.waveBusinessId || body.wave_business_id;
    var field = body.field;
    var value = body.value === true;

    var gate = await assertPermission(db, by, 'wave.settings.manage', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!waveBusinessId || !field) { return NextResponse.json({ ok: false, error: 'waveBusinessId and field are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!ALLOWED[field]) { return NextResponse.json({ ok: false, error: 'Field not allowed: ' + field, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // production_push_unlocked is the real-money master switch — require an actual super admin.
    if (field === 'production_push_unlocked') {
      var isSuper = false;
      if (by) {
        var uRes = await db.from('users').select('role').eq('id', by);
        var urow = (uRes && uRes.data && uRes.data.length) ? uRes.data[0] : null;
        if (urow && (urow.role === 'super_admin')) { isSuper = true; }
      }
      if (!isSuper) { return NextResponse.json({ ok: false, error: 'Only a super admin can enable/disable real production Wave push.', api_build_marker: API_BUILD_MARKER }, { status: 403 }); }
    }

    // Verify the registry row exists, then update + read back.
    var regRes = await db.from('wave_business_registry').select('id, wave_business_id, is_production').eq('wave_business_id', waveBusinessId);
    if (regRes && regRes.error) { return NextResponse.json({ ok: false, error: regRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!(regRes && regRes.data && regRes.data.length)) { return NextResponse.json({ ok: false, error: 'No registry row for that Wave business — register it first.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }

    var patch = {}; patch[field] = value;
    var up = await db.from('wave_business_registry').update(patch).eq('wave_business_id', waveBusinessId).select();
    if (up && up.error) { return NextResponse.json({ ok: false, error: up.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!(up && up.data && up.data.length)) { return NextResponse.json({ ok: false, error: 'Update affected 0 rows — flag not saved.', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
    var row = up.data[0];
    return NextResponse.json({ ok: true, field: field, value: row[field], row: row, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/registry-flags', marker: API_BUILD_MARKER }); }
