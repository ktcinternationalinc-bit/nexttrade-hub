// /api/wave/refresh-names — v55.83-KX. Pull the CURRENT business names from Wave and update each Hub
// silo's label to match (you renamed a business in Wave; Hub kept the old label). READ-ONLY on Wave.
// Super-admin (wave.settings.manage). Service-role so the registry UPDATE isn't RLS-trapped. Reports
// every change. Placeholder silos (not bound to a real Wave business) are skipped + flagged. SWC-safe.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business';

var API_BUILD_MARKER = 'v55.83-KX-refresh-names';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = null; try { body = await req.json(); } catch (eB) { body = {}; }
    var gate = await assertPermission(db, (body && body.user_id) || null, 'wave.settings.manage', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error || 'Super-admin only.', api_build_marker: API_BUILD_MARKER }, { status: gate.status || 403 }); }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ ok: false, error: 'No Wave token configured (WAVE_ACCESS_TOKEN).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // 1) current names from Wave (id -> name).
    var query = 'query { businesses { edges { node { id name } } } }';
    var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query }) });
    var data = null; try { data = await resp.json(); } catch (eP) { data = null; }
    if (!resp.ok) { return NextResponse.json({ ok: false, error: 'Wave rejected the request: ' + ((data && data.errors && data.errors[0] && data.errors[0].message) || ('HTTP ' + resp.status)), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (data && data.errors && data.errors.length) { return NextResponse.json({ ok: false, error: 'Wave API error: ' + (data.errors[0].message || 'unknown'), api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var edges = (data && data.data && data.data.businesses && data.data.businesses.edges) || [];
    var nameById = {}; var ei;
    for (ei = 0; ei < edges.length; ei++) { if (edges[ei] && edges[ei].node && edges[ei].node.id) { nameById[edges[ei].node.id] = edges[ei].node.name || null; } }

    // 2) walk the registry; update label where Wave's current name differs.
    var regRes = await db.from('wave_business_registry').select('wave_business_id, label');
    if (regRes && regRes.error) { return NextResponse.json({ ok: false, error: 'Registry read failed: ' + regRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var rows = (regRes && regRes.data) || [];
    var updated = []; var unchanged = 0; var placeholders = []; var notInWave = []; var errors = [];
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      if (isPlaceholderWaveBusiness(r.wave_business_id)) { placeholders.push(r.label || r.wave_business_id); continue; }
      if (!Object.prototype.hasOwnProperty.call(nameById, r.wave_business_id)) { notInWave.push(r.label || r.wave_business_id); continue; }
      var waveName = nameById[r.wave_business_id];
      if (!waveName || waveName === r.label) { unchanged = unchanged + 1; continue; }
      var uRes = await db.from('wave_business_registry').update({ label: waveName }).eq('wave_business_id', r.wave_business_id);
      if (uRes && uRes.error) { errors.push((r.label || r.wave_business_id) + ': ' + uRes.error.message); continue; }
      updated.push({ wave_business_id: r.wave_business_id, old: r.label || null, new: waveName });
    }

    var parts = [];
    parts.push(updated.length + ' name(s) updated');
    if (unchanged) { parts.push(unchanged + ' already current'); }
    if (placeholders.length) { parts.push(placeholders.length + ' not bound to Wave yet (' + placeholders.join(', ') + ')'); }
    if (notInWave.length) { parts.push(notInWave.length + " not visible to this token (" + notInWave.join(', ') + ')'); }
    return NextResponse.json({ ok: errors.length === 0, updated: updated, unchanged: unchanged, placeholders: placeholders, not_in_wave: notInWave, errors: errors, message: parts.join(' · ') + (errors.length ? (' · ' + errors.length + ' error(s)') : '') + '.', api_build_marker: API_BUILD_MARKER }, { status: errors.length === 0 ? 200 : 207 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/refresh-names', marker: API_BUILD_MARKER }); }
