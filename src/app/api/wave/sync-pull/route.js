// /api/wave/sync-pull — SCHEDULED Wave -> Hub pull (cron).
// Re-runs the EXISTING, tested import routes (import-customers then import-invoices)
// for every registered Wave business, so Wave-side edits land in the Hub automatically
// on a schedule instead of only when someone clicks Import. Pulling is read-only on
// Wave's side — it never writes to Wave — so it is safe for all businesses, including
// production. Deduping/updating is handled by the import routes (match on wave ids).
//
// Protected by CRON_SECRET: if set, the caller must send Authorization: Bearer <secret>
// (Vercel cron is configured to send this). Writes one wave_sync_log row per business.
// SWC-safe: var + string concat, no template literals/arrows/const.
import { createClient } from '@supabase/supabase-js';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function callImport(base, routePath, businessId) {
  return fetch(base + routePath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: businessId, userId: null, scheduled: true })
  }).then(function (r) { return r.json(); }).catch(function (e) { return { ok: false, error: (e && e.message) || String(e) }; });
}

async function runPull(request) {
  // Auth: if CRON_SECRET is configured, require it.
  var secret = process.env.CRON_SECRET;
  if (secret) {
    var auth = request.headers.get('authorization') || '';
    if (auth !== ('Bearer ' + secret)) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  var db = admin();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Server database key missing.' }, { status: 500 });
  }
  if (!process.env.WAVE_ACCESS_TOKEN) {
    return Response.json({ ok: false, error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 });
  }

  // Derive the deployment origin so we can call our own import routes.
  var base;
  try { var u = new URL(request.url); base = u.protocol + '//' + u.host; } catch (eUrl) { base = ''; }

  var regRes = await db.from('wave_business_registry').select('wave_business_id, label, is_production');
  var allBusinesses = (regRes && regRes.data) || [];
  // v55.83-DV — TEST DATA FIRST: by default the scheduled pull runs for TEST businesses
  // only (is_production === false). Production is pulled ONLY when explicitly opted in via
  // ?includeProduction=true (or body.includeProduction), so we validate against test data
  // before any production data flows in automatically.
  var includeProduction = false;
  try {
    var urlInc = new URL(request.url);
    if (urlInc.searchParams.get('includeProduction') === 'true') { includeProduction = true; }
  } catch (eInc) {}
  if (!includeProduction) {
    try { var b = await request.clone().json(); if (b && b.includeProduction === true) { includeProduction = true; } } catch (eBody) {}
  }
  var businesses = includeProduction ? allBusinesses : allBusinesses.filter(function (x) { return x.is_production === false; });
  if (businesses.length === 0) {
    return Response.json({ ok: true, message: includeProduction ? 'No registered Wave businesses to pull.' : 'No TEST Wave businesses to pull (production excluded — add ?includeProduction=true to include it).', results: [] });
  }

  var results = [];
  var i;
  for (i = 0; i < businesses.length; i++) {
    var biz = businesses[i];
    var custReport = await callImport(base, '/api/wave/import-customers', biz.wave_business_id);
    var invReport = await callImport(base, '/api/wave/import-invoices', biz.wave_business_id);
    var rowOk = !(custReport && custReport.ok === false) && !(invReport && invReport.ok === false);

    try {
      await db.from('wave_sync_log').insert({
        wave_business_id: biz.wave_business_id,
        entity_type: 'pull',
        action: 'scheduled_pull',
        dry_run: false,
        success: rowOk,
        request_payload: { business: biz.label, is_production: biz.is_production },
        response_payload: { customers: custReport, invoices: invReport },
        error_message: rowOk ? null : 'One or both imports reported an error — see response_payload',
        attempted_at: new Date().toISOString()
      });
    } catch (eLog) { /* logging is best-effort */ }

    results.push({
      business: biz.label,
      wave_business_id: biz.wave_business_id,
      customers: custReport && (custReport.report || custReport),
      invoices: invReport && (invReport.report || invReport),
      ok: rowOk
    });
  }

  return Response.json({ ok: true, ran_at: new Date().toISOString(), scope: includeProduction ? 'all_businesses' : 'test_only', businesses: businesses.length, results: results });
}

// GET is what Vercel cron calls.
export async function GET(request) { return runPull(request); }
// POST allowed too, so it can be triggered manually for validation.
export async function POST(request) { return runPull(request); }
