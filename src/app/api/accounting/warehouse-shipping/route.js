// v55.83-TG — SHIPPING COSTS FROM THE NEXTRADE WAREHOUSE (Max, Nov 16 2026).
//
// Reads the warehouse's read-only feed (STAGING until Max asks for live), turns it into one record per warehouse order
// (freight + trucking kept separate, quote vs final, every reason flagged — lib/warehouse-shipping.js), matches each to
// Hub invoices by RELEASE NUMBER only, compares it with the Hub's own outbound bills, and stores it in
// pl_warehouse_shipping with a change history. It NEVER writes an invoice, a bill, inventory or the ledger, and it never
// writes to the warehouse.
//
//   GET  — the automatic run every 3 hours (Vercel cron, CRON_SECRET; stored with trigger 'daily' = automatic).
//   POST — list · history · sync (the "Sync Shipping Costs" button) · set_manual · set_use_in_pnl
//
// Codex review 16 Nov, built in:
//   • the caller is the VERIFIED signed-in user (Supabase session token checked on the server); a user_id in the body that
//     is not that user is refused — the body never selects who you are;
//   • one sync at a time: a database unique index on unfinished runs (the second cannot even start); stale runs expire;
//   • a sync publishes ALL rows + their history + "ok" in ONE database transaction (pl_warehouse_publish). A failure keeps
//     NOTHING of that run, so the old values and the full history stay intact and a retry starts clean;
//   • the feed must say who it is (nextrade-staging / nextrade-live) and it must be the source this Hub expects;
//   • the P&L and the lists read only the ACTIVE source (one setting), and only orders still in the latest feed.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { authorizeBankIdentity } from '../../../../lib/bank-visibility';
import { audit } from '../../../../lib/audit-server';
import { buildRecords, matchInvoices, compareBills, comparable, rowComparable, diffComparable, toRow, BACKFILL_FROM } from '../../../../lib/warehouse-shipping';
import { warehouseFeedConfig } from '../../../../lib/warehouse-feed-config'; // v55.83-UU — approved warehouse addresses only
import { readFeedBody } from '../../../../lib/warehouse-feed-read'; // v55.83-YA

var API_BUILD_MARKER = 'v55.83-TG-warehouse-shipping';
var PAGE = 1000; var MAX_ROWS = 40000; var STALE_RUN_MINUTES = 10;
var SQL_HINT = 'Run sql/v55-83-TG-warehouse-shipping.sql in Supabase once (it only adds four new tables and two functions).';
export const maxDuration = 60;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function bad(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 400 }); }
function missingTable(msg) { return /pl_warehouse/.test(String(msg || '')) && /does not exist|schema cache|not find|could not find the function/i.test(String(msg || '')); }
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

// where the warehouse data comes from. Staging only, unless Max has explicitly allowed live (a separate env value).
function feedConfig() {
  // v55.83-UU (Codex 05:56) — same approved-address rule as the Orders report (https; staging domain; live only by exact name + Max's go-ahead)
  return warehouseFeedConfig(process.env);
}
async function setting(db, key, dflt) {
  var r = await db.from('pl_warehouse_settings').select('value, updated_by, updated_at').eq('key', key).maybeSingle();
  if (r.error) { throw new Error(r.error.message); }
  return r.data ? r.data : { value: dflt };
}

// take the one-sync lock: expire a run that never finished, then insert ours (the unique index refuses a second one)
async function acquireRun(db, trigger, userId, cfg) {
  await db.from('pl_warehouse_sync_runs').update({ finished_at: new Date().toISOString(), ok: false, error: 'abandoned — did not finish within ' + STALE_RUN_MINUTES + ' minutes; nothing of it was published' })
    .is('finished_at', null).lt('started_at', new Date(Date.now() - STALE_RUN_MINUTES * 60000).toISOString());
  var ins = await db.from('pl_warehouse_sync_runs').insert({ trigger: trigger, triggered_by: userId || null, source: cfg.source || 'unknown', source_host: cfg.host || null }).select('id').single();
  if (ins.error) {
    if (/duplicate key|unique/i.test(ins.error.message || '')) { return { busy: true }; }
    throw new Error(ins.error.message);
  }
  return { id: ins.data.id };
}

async function runSync(db, trigger, userId) {
  var cfg = feedConfig();
  var nowIso = new Date().toISOString();
  var lock = await acquireRun(db, trigger, userId, cfg);
  if (lock.busy) { return { ok: false, busy: true, error: 'Another sync is running right now. Nothing was changed — try again in a minute.' }; }
  var runId = lock.id;
  async function failRun(msg) {
    // nothing of this run has been published (publishing is one transaction, and it is the LAST step)
    await db.from('pl_warehouse_sync_runs').update({ finished_at: new Date().toISOString(), ok: false, error: String(msg).substring(0, 1000) }).eq('id', runId).is('finished_at', null);
    return { ok: false, run_id: runId, error: 'SYNC FAILED — the figures already in the Hub were kept unchanged. ' + msg };
  }
  try {
    if (cfg.error) { return await failRun(cfg.error); }
    var active = await setting(db, 'active_source', 'nextrade-staging');
    if (active.value !== cfg.source) { return await failRun('The feed is ' + cfg.source + ' but the Hub is set to read ' + active.value + '. Change one of them on purpose first.'); }

    // 1. the warehouse feed
    var feed;
    try {
      var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, 40000);
      var res = await fetch(cfg.url, { headers: { 'X-Hub-Feed-Token': cfg.token, 'Accept': 'application/json' }, signal: ctl.signal, cache: 'no-store', redirect: 'error' }); // UU (Codex 06:13) — no redirect carries the token
      clearTimeout(tm);
      if (!res.ok) { return await failRun('The warehouse answered HTTP ' + res.status + (res.status === 401 ? ' (the token was refused)' : '') + '.'); }
      var rdF = await readFeedBody(res, ctl, 40); // v55.83-YA — an incomplete or non-list answer is named plainly
      if (rdF.error) { return await failRun(rdF.error); }
      feed = rdF.json;
    } catch (eF) { return await failRun('Could not read the warehouse feed (' + ((eF && eF.name === 'AbortError') ? 'no answer within 40 seconds' : ((eF && eF.message) || 'network error')) + ').'); }
    if (!feed || feed.ok !== true || !Array.isArray(feed.orders) || !Array.isArray(feed.stages)) { return await failRun('The warehouse feed answered, but not in the expected shape.'); }
    if (feed.source !== cfg.source) { return await failRun('The feed says it is "' + (feed.source || 'unknown') + '", not the expected "' + cfg.source + '" — refused.'); }
    if (!feed.orders.length) { return await failRun('The warehouse feed returned NO orders — treated as a failure, not as "nothing changed".'); }

    // 2. records, invoices, bills
    var recs = buildRecords(feed, { source: cfg.source, site: feed.site || cfg.host });
    var inv = await fetchAll(function () { return db.from('accounting_invoices').select('id, invoice_number, release_number, po_so_number, accounting_customer_id, invoice_date, total_amount, currency, record_status, wave_status'); });
    // customer names only to NOTE a difference (Max 16 Nov) — matching stays release number only
    var custNames = {};
    try { var cs = await fetchAll(function () { return db.from('accounting_customers').select('id, company_name, contact_name'); }); cs.forEach(function (c) { custNames[c.id] = c.company_name || c.contact_name || null; }); } catch (eC) { custNames = {}; }
    matchInvoices(recs, inv, custNames);
    var bills = [];
    try { bills = await fetchAll(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, record_status, bill_type, shipment_direction, release_number'); }); }
    catch (eB) { recs.forEach(function (r) { r.flags.push('hub_bills_could_not_be_read'); }); }
    compareBills(recs, bills);

    // 3. compare with what is stored
    var existing = await fetchAll(function () { return db.from('pl_warehouse_shipping').select('id, section, order_id, release_number, customer_name, status, ship_date, ship_date_basis, freight_estimate, freight_final, freight_used, freight_kind, trucking_estimate, trucking_final, trucking_used, trucking_kind, combined_used, cost_status, invoice_matches, flags, last_changed_at').eq('source', cfg.source); });
    var byKey = {}; existing.forEach(function (r) { byKey[r.section + '|' + r.order_id] = r; });
    var rows = []; var changes = {}; var counts = { orders_in_feed: feed.orders.length, obsolete_in_feed: (feed.obsolete_orders || []).length, records: recs.length, created: 0, changed: 0, unchanged: 0 };
    recs.forEach(function (rec) {
      var k = rec.section + '|' + rec.order_id; var old = byKey[k];
      var row = toRow(rec, nowIso, runId);
      if (!old) { counts.created++; row.last_changed_at = nowIso; changes[k] = { kind: 'created', changes: comparable(rec) }; }
      else {
        var diff = diffComparable(rowComparable(old), comparable(rec));
        if (Object.keys(diff).length) { counts.changed++; row.last_changed_at = nowIso; changes[k] = { kind: 'sync_change', changes: diff }; }
        else { counts.unchanged++; row.last_changed_at = old.last_changed_at || nowIso; }
      }
      rows.push(row);
    });

    // 4. the run's summary
    var main = recs.filter(function (r) { return r.section === 'main'; });
    var bf = main.filter(function (r) { return r.in_backfill; });
    function tally(list, f) { var m = {}; list.forEach(function (r) { var key = f(r); m[key] = (m[key] || 0) + 1; }); return m; }
    var totals = {}; bf.forEach(function (r) { if (r.combined_used === null) { return; } var c = (r.currency || '?') + (r.currency_confirmed ? '' : ' (unconfirmed)'); var t = totals[c] || (totals[c] = { combined: 0, freight: 0, trucking: 0, orders: 0 }); t.combined = Math.round((t.combined + r.combined_used) * 100) / 100; t.freight = Math.round((t.freight + r.freight.used) * 100) / 100; t.trucking = Math.round((t.trucking + r.trucking.used) * 100) / 100; t.orders++; });
    counts.backfill_orders = bf.length; counts.backfill_from = BACKFILL_FROM;
    counts.backfill_cost_status = tally(bf, function (r) { return r.cost_status; });
    counts.backfill_matched_to_invoice = bf.filter(function (r) { return (r.invoices || []).length > 0; }).length;
    counts.backfill_unmatched = bf.filter(function (r) { return !(r.invoices || []).length; }).map(function (r) { return r.release_number || ('order ' + r.order_id); }).slice(0, 300);
    counts.backfill_totals_by_currency = totals;
    counts.open_orders = main.filter(function (r) { return r.is_open; }).length;
    counts.flags = tally([].concat.apply([], bf.map(function (r) { return r.flags; })), function (f) { return f; });
    counts.feed_site = feed.site || cfg.host; counts.feed_source = feed.source; counts.feed_generated_at = feed.generated_at || null;

    // 5. publish: rows + history + run status in ONE transaction (all or nothing)
    var pub = await db.rpc('pl_warehouse_publish', { p_run_id: runId, p_source: cfg.source, p_rows: rows, p_changes: changes, p_counts: counts });
    if (pub.error) { return await failRun('Publishing was refused by the database (' + pub.error.message + '). Nothing of this run was kept.'); }
    return { ok: true, run_id: runId, counts: Object.assign(counts, { rows_published: pub.data && pub.data.rows, history_written: pub.data && pub.data.history }) };
  } catch (e) {
    return await failRun((e && e.message) || 'unexpected error');
  }
}

// who is calling: the VERIFIED signed-in Hub user (never a body field)
async function verifiedCaller(req, body) {
  try {
    var who = await authorizeBankIdentity(req, createClient, process.env);
    if (body.user_id && String(body.user_id).toLowerCase() !== String(who.profileId).toLowerCase()) { return { error: 'The user in the request is not the signed-in user.', status: 403 }; }
    return { userId: who.profileId };
  } catch (e) {
    var st = (e && e.status) || 401;
    return { error: st === 401 ? 'Sign in again — your sign-in could not be verified.' : st === 403 ? 'Your sign-in does not resolve to one active Hub user.' : 'Your sign-in could not be checked right now.', status: st };
  }
}

export async function GET(req) {
  var authHeader = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || authHeader !== 'Bearer ' + process.env.CRON_SECRET) { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }); }
  var db = admin();
  try { var out = await runSync(db, 'daily', null); return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, out), { status: out.ok ? 200 : (out.busy ? 409 : 502) }); }
  catch (e) { return NextResponse.json({ ok: false, error: missingTable(e && e.message) ? SQL_HINT : ((e && e.message) || 'daily sync failed'), api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var action = body.action || 'list';
    var who = await verifiedCaller(req, body);
    if (who.error) { return bad(who.error, who.status); }
    var userId = who.userId;
    var pv = await assertPermission(db, userId, 'pnl.view', req);
    if (!pv || pv.ok !== true) { return bad('This needs the "P&L: View" permission — grant it in Settings → Module Access.', 403); }

    if (action === 'list') {
      var active; var rows;
      try {
        active = await setting(db, 'active_source', 'nextrade-staging');
        rows = await fetchAll(function () { return db.from('pl_warehouse_shipping').select('*').eq('source', active.value).eq('superseded', false).eq('in_latest_feed', true).order('order_id', { ascending: false }); });
      } catch (eL) { if (missingTable(eL && eL.message)) { return NextResponse.json({ ok: true, setup_needed: true, setup_message: SQL_HINT, api_build_marker: API_BUILD_MARKER }); } throw eL; }
      var runs = await db.from('pl_warehouse_sync_runs').select('id, started_at, finished_at, trigger, triggered_by, source, source_host, ok, error, counts').order('started_at', { ascending: false }).limit(10);
      var lastOk = await db.from('pl_warehouse_sync_runs').select('id, finished_at, source_host').eq('ok', true).order('finished_at', { ascending: false }).limit(1);
      var st = await setting(db, 'use_in_pnl', false);
      var canEdit = await assertPermission(db, userId, 'pnl.edit_costs', req);
      var two = new Date(); two.setFullYear(two.getFullYear() - 2); var twoIso = two.toISOString().substring(0, 10);
      return NextResponse.json({ ok: true, rows: rows, active_source: active.value, open_from: twoIso, backfill_from: BACKFILL_FROM, runs: runs.data || [], last_success: (lastOk.data || [])[0] || null,
        use_in_pnl: st.value === true, use_in_pnl_changed: st.updated_at ? { by: st.updated_by, at: st.updated_at } : null,
        can_edit: !!(canEdit && canEdit.ok === true), feed_host: feedConfig().host || null, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'history') {
      if (!body.record_id) { return bad('record_id required'); }
      var hr = await db.from('pl_warehouse_shipping_history').select('id, run_id, changed_by, changed_at, kind, changes').eq('record_id', body.record_id).order('changed_at', { ascending: false }).limit(100);
      if (hr.error) { return bad(hr.error.message); }
      return NextResponse.json({ ok: true, history: hr.data || [], api_build_marker: API_BUILD_MARKER });
    }

    // ── everything below changes something: P&L: Edit Product Costs ──
    var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);
    if (!pe || pe.ok !== true) { return bad('This needs the "P&L: Edit Product Costs" permission — grant it in Settings → Module Access.', 403); }
    if (action === 'sync') {
      var out = await runSync(db, 'button', userId);
      await audit(db, userId, 'pl_warehouse_sync', 'pl_warehouse_sync_run', out.run_id || null, { ok: out.ok, error: out.error || null });
      return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, out), { status: out.ok ? 200 : (out.busy ? 409 : 502) });
    }
    if (action === 'set_manual') {
      if (!body.record_id) { return bad('record_id required'); }
      function num(v) { if (v === '' || v === null || v === undefined) { return null; } var n = Number(String(v).replace(/[$,\s]/g, '')); return isNaN(n) || n < 0 ? NaN : Math.round(n * 100) / 100; }
      var mf = num(body.manual_freight); var mt = num(body.manual_trucking);
      if ((mf !== null && isNaN(mf)) || (mt !== null && isNaN(mt))) { return bad('Amounts must be numbers, zero or more (leave blank to use the warehouse figure).'); }
      var note = String(body.note || '').trim().substring(0, 300);
      if ((mf !== null || mt !== null) && note.length < 3) { return bad('Say why (a short note) — corrections are kept in the history.'); }
      var rm = await db.rpc('pl_warehouse_set_manual', { p_record_id: body.record_id, p_by: userId, p_freight: mf, p_trucking: mt, p_note: note || null });
      if (rm.error) { return bad('NOT SAVED — ' + (missingTable(rm.error.message) ? SQL_HINT : rm.error.message)); }
      await audit(db, userId, 'pl_warehouse_manual_correction', 'pl_warehouse_shipping', body.record_id, { manual_freight: mf, manual_trucking: mt, note: note || null });
      return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'set_use_in_pnl') {
      // the switch that changes report numbers: the VERIFIED super admin only
      var ur = await db.from('users').select('id, role').eq('id', userId).limit(1);
      var role = ur && ur.data && ur.data[0] ? ur.data[0].role : '';
      if (role !== 'super_admin') { return bad('Only the super admin can switch the P&L to use the warehouse costs.', 403); }
      var on = body.on === true;
      var upS = await db.from('pl_warehouse_settings').upsert({ key: 'use_in_pnl', value: on, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (upS.error) { return bad(upS.error.message); }
      await audit(db, userId, 'pl_warehouse_use_in_pnl', 'pl_warehouse_settings', 'use_in_pnl', { on: on });
      return NextResponse.json({ ok: true, use_in_pnl: on, api_build_marker: API_BUILD_MARKER });
    }
    return bad('Unknown action.');
  } catch (e) {
    return NextResponse.json({ ok: false, error: missingTable(e && e.message) ? SQL_HINT : ((e && e.message) || 'warehouse shipping failed'), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
