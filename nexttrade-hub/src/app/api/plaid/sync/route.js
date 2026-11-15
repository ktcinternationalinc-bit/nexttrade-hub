// /api/plaid/sync — SCHEDULED Plaid pull (cron). For every assigned bank connection,
// re-runs the EXISTING, tested /api/plaid/transactions route (read-only pull + upsert),
// so each account's current transactions come into the Hub automatically per silo,
// instead of someone clicking Sync in the Bank tab.
//
// TEST businesses only by default ("test data first"): a connection is included only if
// its wave_business_id belongs to a registered TEST business (is_production === false).
// Production via ?includeProduction=true (or body.includeProduction). Unassigned
// connections (no wave_business_id) are SKIPPED — the transactions route would reject
// them anyway (they'd create untagged cross-silo data).
//
// CRON_SECRET protected. Writes nothing to Plaid (read-only). SWC-safe: var + concat.
import { createClient } from '@supabase/supabase-js';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function callTransactions(base, connectionId, bearer) {
  var url = base + '/api/plaid/transactions';
  var headers = { 'Content-Type': 'application/json' };
  if (bearer) { headers['Authorization'] = 'Bearer ' + bearer; }
  // Vercel Deployment Protection gates our own URL behind a 401 HTML login page for server-to-
  // server calls. If a Protection-Bypass-for-Automation secret is configured, forward it so the
  // cron's internal call is allowed through instead of bouncing off the auth wall.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) { headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET; }
  return fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ connection_id: connectionId, scheduled: true })
  }).then(function (r) {
    var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    return r.text().then(function (text) {
      // Got an HTML page (404/500/redirect/login) instead of JSON — surface the real cause
      // instead of letting JSON.parse throw an opaque "Unexpected token '<'".
      if (!r.ok || ct.indexOf('application/json') < 0) {
        var preview = (text || '').slice(0, 500);
        return { error: 'Expected JSON but got HTTP ' + r.status + ' (' + (ct || 'no content-type') + ') from ' + url + ' :: ' + preview, http_status: r.status, content_type: ct, non_json: true };
      }
      try { return JSON.parse(text); }
      catch (eParse) { return { error: 'JSON parse failed from ' + url + ': ' + ((eParse && eParse.message) || 'parse error') + ' :: ' + (text || '').slice(0, 500), non_json: true }; }
    });
  }).catch(function (e) { return { error: 'fetch failed for ' + url + ': ' + ((e && e.message) || String(e)) }; });
}

async function runSync(request) {
  var secret = process.env.CRON_SECRET;
  if (secret) {
    var auth = request.headers.get('authorization') || '';
    if (auth !== ('Bearer ' + secret)) { return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 }); }
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Server database key missing.' }, { status: 500 });
  }
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return Response.json({ ok: false, error: 'Plaid credentials not configured (PLAID_CLIENT_ID / PLAID_SECRET).' }, { status: 400 });
  }

  var db = admin();

  var includeProduction = false;
  try { var u = new URL(request.url); if (u.searchParams.get('includeProduction') === 'true') { includeProduction = true; } } catch (eUrl) {}
  if (!includeProduction) { try { var b = await request.clone().json(); if (b && b.includeProduction === true) { includeProduction = true; } } catch (eBody) {} }

  // Which silos are in scope? TEST only by default.
  var regRes = await db.from('wave_business_registry').select('wave_business_id, label, is_production');
  var allBiz = (regRes && regRes.data) || [];
  var inScope = {};
  var i;
  for (i = 0; i < allBiz.length; i++) {
    if (includeProduction || allBiz[i].is_production === false) { inScope[allBiz[i].wave_business_id] = allBiz[i].label || allBiz[i].wave_business_id; }
  }

  // All bank connections that are assigned to an in-scope silo.
  var connRes = await db.from('bank_connections').select('id, institution_name, wave_business_id');
  var conns = (connRes && connRes.data) || [];

  // Derive the deployment origin so we can call our own transactions route. Prefer an
  // explicitly configured absolute URL; fall back to VERCEL_URL, then the request host.
  // A wrong host is the usual cause of an HTML 404 coming back instead of JSON.
  var base = '';
  if (process.env.NEXT_PUBLIC_APP_URL) { base = String(process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, ''); }
  else if (process.env.NEXT_PUBLIC_SITE_URL) { base = String(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, ''); }
  else if (process.env.VERCEL_URL) { base = 'https://' + String(process.env.VERCEL_URL).replace(/\/+$/, ''); }
  else { try { var ur = new URL(request.url); base = ur.protocol + '//' + ur.host; } catch (eU) { base = ''; } }

  // If the transactions route is CRON_SECRET-protected, forward the bearer.
  var forwardBearer = process.env.CRON_SECRET || null;

  var results = [];
  var skippedUnassigned = 0;
  var skippedOutOfScope = 0;
  var k;
  for (k = 0; k < conns.length; k++) {
    var c = conns[k];
    if (!c.wave_business_id) { skippedUnassigned = skippedUnassigned + 1; continue; }
    if (!inScope[c.wave_business_id]) { skippedOutOfScope = skippedOutOfScope + 1; continue; }

    var rep = await callTransactions(base, c.id, forwardBearer);
    var okPull = !(rep && (rep.error || rep.error_code));
    results.push({
      connection_id: c.id,
      institution: c.institution_name || null,
      silo: inScope[c.wave_business_id],
      wave_business_id: c.wave_business_id,
      ok: okPull,
      pending: rep && rep.pending === true,
      inserted: rep && (rep.inserted != null ? rep.inserted : (rep.report && rep.report.inserted)),
      error: okPull ? null : (rep && (rep.error || rep.error_code))
    });

    try {
      var logPayload = rep || null;
      // Avoid storing a huge HTML error page in the log; keep a bounded preview.
      if (logPayload && logPayload.error && String(logPayload.error).length > 800) {
        logPayload = { error: String(logPayload.error).slice(0, 800), http_status: logPayload.http_status || null, content_type: logPayload.content_type || null, non_json: true };
      }
      await db.from('wave_sync_log').insert({
        wave_business_id: c.wave_business_id,
        entity_type: 'plaid_transactions',
        action: 'scheduled_sync',
        dry_run: false,
        success: okPull,
        response_payload: logPayload,
        error_message: okPull ? null : ((rep && (rep.error || rep.error_code)) || 'sync failed'),
        attempted_at: new Date().toISOString()
      });
    } catch (eLog) { /* best-effort */ }
  }

  return Response.json({
    ok: true,
    ran_at: new Date().toISOString(),
    scope: includeProduction ? 'all_businesses' : 'test_only',
    connections_synced: results.length,
    skipped_unassigned: skippedUnassigned,
    skipped_out_of_scope: skippedOutOfScope,
    results: results
  });
}

export async function GET(request) { return runSync(request); }
export async function POST(request) { return runSync(request); }
