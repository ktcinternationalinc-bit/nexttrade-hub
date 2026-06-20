import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapPlaidTransaction, supersededPendingIds } from '../../../../lib/bank-ingest';

// v55.83-X — Phase 1 bank ingestion. var + string-concat only (SWC constraint).
var PLAID_BASE = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

// v55.83-IS (Codex FAIL) — bank ingestion MUST use the service-role key. Falling back to the anon
// key re-introduces the RLS trap (email-auth: users.id != auth.uid()) and would silently filter the
// upsert to 0 rows. Return null if it's missing so callers fail loud instead of writing nothing.
function sb() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { return null; }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } });
}

// POST — pull from Plaid (read-only) and upsert into bank_transactions.
export async function POST(req) {
  try {
    var supabase = sb();
    if (!supabase) { return NextResponse.json({ error: 'Server bank-ingestion key missing (SUPABASE_SERVICE_ROLE_KEY). Bank sync is disabled until it is configured — set it in the server environment.' }, { status: 500 }); }
    var body = await req.json();
    var connection_id = body.connection_id;
    var start_date = body.start_date;
    var end_date = body.end_date;
    var env = process.env.PLAID_ENV || 'sandbox';
    var base = PLAID_BASE[env] || PLAID_BASE.sandbox;

    var connRes = await supabase.from('bank_connections').select('*').eq('id', connection_id).single();
    if (connRes.error || !connRes.data) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    var conn = connRes.data;
    // v55.83-DB — never sync an unassigned bank connection (would create untagged transactions that leak across silos)
    if (!conn.wave_business_id) { return NextResponse.json({ error: 'This bank connection is not assigned to an accounting silo. Assign it (Bank tab -> Unassigned Bank Data) before syncing.' }, { status: 409 }); }

    var today = new Date().toISOString().split('T')[0];
    var thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    // v55.83-JR (Codex FAIL) — gap-free INCREMENTAL sync. Normal sync must pull FORWARD from the last
    // successful point, not the UI date window. Resolve the effective start_date in priority order:
    //   1. explicit start_date in the request (a deliberate full re-pull / admin backfill),
    //   2. last_successful_posted_date minus a 7-day overlap (catch late-posting / gap-fill),
    //   3. the admin's initial_backfill_start_date chosen at connect/re-link,
    //   4. 30 days ago (legacy default).
    // The end_date is always today. Ingestion stores the COMPLETE authorized history regardless of the
    // per-user UI visibility window (those are separate — visibility limits what employees SEE).
    var OVERLAP_DAYS = 7;
    var effStart = start_date || null;
    if (!effStart && conn.last_successful_posted_date) {
      effStart = new Date(new Date(conn.last_successful_posted_date).getTime() - OVERLAP_DAYS * 86400000).toISOString().split('T')[0];
    }
    if (!effStart && conn.initial_backfill_start_date) { effStart = String(conn.initial_backfill_start_date).split('T')[0]; }
    if (!effStart) { effStart = thirtyAgo; }
    var effEnd = end_date || today;

    // PAGE through /transactions/get until we've fetched every transaction in the window (Plaid caps a
    // single call at 500). Previously this only fetched offset:0 → a >500 backfill silently imported the
    // first page only. Now loop to total_transactions or fail loudly.
    var allTxns = [];
    var acctsFromPlaid = [];
    var totalAvail = null;
    var offset = 0;
    var pageGuard = 0;
    var data = null;
    while (pageGuard < 60) { // 60 pages * 500 = 30k cap (safety)
      pageGuard = pageGuard + 1;
      var plaidRes = await fetch(base + '/transactions/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.PLAID_CLIENT_ID,
          secret: process.env.PLAID_SECRET,
          access_token: conn.access_token,
          start_date: effStart,
          end_date: effEnd,
          options: { count: 500, offset: offset },
        }),
      });
      data = await plaidRes.json();
      if (data.error_code === 'PRODUCT_NOT_READY') {
        try { await supabase.from('bank_connections').update({ last_sync_status: 'preparing', last_sync_error: 'Plaid is still preparing transactions' }).eq('id', conn.id); } catch (ePrep) {}
        return NextResponse.json({ pending: true, error_code: 'PRODUCT_NOT_READY', message: 'Your bank is connected. Plaid is still preparing the first batch of transactions (usually under a minute). It will retry automatically.' });
      }
      if (data.error_code) { break; } // handled below
      var pageTxns = data.transactions || [];
      if (offset === 0) { acctsFromPlaid = data.accounts || []; totalAvail = data.total_transactions; }
      allTxns = allTxns.concat(pageTxns);
      if (!data.total_transactions || allTxns.length >= data.total_transactions || pageTxns.length === 0) { break; }
      offset = allTxns.length;
    }
    if (data && data.error_code) {
      // v55.83-JO — ITEM_LOGIN_REQUIRED / PENDING_EXPIRATION mean Plaid needs the user to re-auth this
      // bank (common in production, e.g. after a password change). Surface a re-link CTA + record the
      // error so the connection clearly shows WHY it stopped pulling (this is the "stale at June 11"
      // symptom: the item silently stopped syncing). Other error codes still surface their message.
      var needsRelink = (data.error_code === 'ITEM_LOGIN_REQUIRED' || data.error_code === 'PENDING_EXPIRATION');
      try { await supabase.from('bank_connections').update({ last_sync_status: 'error', last_sync_error: (data.error_message || data.error_code) }).eq('id', conn.id); } catch (eErr) {}
      return NextResponse.json({ error: data.error_message || data.error_code, error_code: data.error_code, needs_relink: needsRelink, connection_id: conn.id }, { status: 400 });
    }

    var rawTxns = allTxns; // v55.83-JR — ALL pages, not just the first 500
    // Index Plaid accounts so each transaction knows its account type/subtype
    // (depository vs credit). Credit/loan accounts get flagged unsupported.
    var accountsById = {};
    (acctsFromPlaid || []).forEach(function (a) { if (a && a.account_id) accountsById[a.account_id] = a; });

    // v55.83-IV — ACCOUNT-LEVEL silo: build a map of plaid_account_id -> wave_business_id from the
    // per-account assignment, so each transaction is stamped by its OWN account (6338 vs 6353), not
    // the whole connection. Also UPSERT plaid_accounts (names/masks) WITHOUT clobbering the assignment.
    var acctSiloMap = {};
    try {
      var paRes = await supabase.from('plaid_accounts').select('plaid_account_id, wave_business_id').eq('connection_id', conn.id);
      ((paRes && paRes.data) || []).forEach(function (a) { if (a && a.plaid_account_id && a.wave_business_id) { acctSiloMap[a.plaid_account_id] = a.wave_business_id; } });
    } catch (eMap) {}
    if (acctsFromPlaid && acctsFromPlaid.length) {
      var paRows = acctsFromPlaid.map(function (a) {
        return { connection_id: conn.id, plaid_account_id: a.account_id, name: a.name || null, official_name: a.official_name || null, mask: a.mask || null, type: a.type || null, subtype: a.subtype || null };
      });
      // upsert names/masks; assignment columns are intentionally NOT in the payload so existing
      // wave_business_id assignments are preserved across syncs.
      try { await supabase.from('plaid_accounts').upsert(paRows, { onConflict: 'plaid_account_id' }); } catch (ePA) { console.warn('[plaid] plaid_accounts upsert failed:', (ePA && ePA.message) || ePA); }
    }

    var rows = rawTxns.map(function (t) { return mapPlaidTransaction(t, conn, accountsById, acctSiloMap); });

    var synced = 0;
    if (rows.length > 0) {
      // onConflict on plaid_transaction_id => idempotent dedupe. Payload carries
      // only bank-sourced fields, so a re-sync never clobbers a user's review
      // status / classification / links.
      var up = await supabase.from('bank_transactions').upsert(rows, { onConflict: 'plaid_transaction_id' });
      if (up.error) {
        console.error('[plaid] upsert error:', up.error.message);
        return NextResponse.json({ error: up.error.message }, { status: 500 });
      }
      synced = rows.length;
    }

    // Remove pending rows that have now posted (avoid double-count).
    var superseded = supersededPendingIds(rawTxns);
    if (superseded.length > 0) {
      try { await supabase.from('bank_transactions').delete().in('plaid_transaction_id', superseded); }
      catch (e) { console.warn('[plaid] supersede cleanup failed:', (e && e.message) || e); }
    }

    // v55.83-JR — compute the newest posted date overall + per account, and STORE the incremental
    // markers so the next sync pulls forward from here (the cursor for /transactions/get). Stored only
    // AFTER the upsert succeeded above (so a failed write never advances the marker → no gaps).
    var newestOverall = conn.last_successful_posted_date ? String(conn.last_successful_posted_date).split('T')[0] : null;
    var newestByAccount = {};
    rawTxns.forEach(function (t) {
      var d = (t.date || '').substring(0, 10);
      if (!d) { return; }
      if (!newestOverall || d > newestOverall) { newestOverall = d; }
      var aid = t.account_id;
      if (aid && (!newestByAccount[aid] || d > newestByAccount[aid])) { newestByAccount[aid] = d; }
    });
    var connPatch = { last_synced: new Date().toISOString(), last_sync_status: 'ok', last_sync_error: null, last_successful_plaid_sync_at: new Date().toISOString() };
    if (newestOverall) { connPatch.last_successful_posted_date = newestOverall; }
    // schema-safe: if the JR columns aren't present yet, retry with the base fields only — but DO NOT
    // pretend the markers saved. v55.83-JT (Codex) — surface markers_persisted:false so the UI warns the
    // admin (otherwise the next sync silently falls back to the legacy 30-day window = the gap we fix).
    var markersPersisted = true;
    var markerError = null;
    var cu = await supabase.from('bank_connections').update(connPatch).eq('id', conn.id);
    if (cu && cu.error) {
      markersPersisted = false;
      markerError = cu.error.message || 'marker columns missing';
      try { await supabase.from('bank_connections').update({ last_synced: new Date().toISOString(), last_sync_status: 'ok', last_sync_error: null }).eq('id', conn.id); } catch (eBase) {}
    }

    return NextResponse.json({
      synced: synced,
      superseded: superseded.length,
      accounts: acctsFromPlaid || [],
      total: totalAvail,
      pages: pageGuard,
      window: { start: effStart, end: effEnd, incremental: !start_date },
      newest_posted_date: newestOverall,
      newest_by_account: newestByAccount,
      markers_persisted: markersPersisted,
      marker_error: markerError
    });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}

// GET — read stored transactions (no Plaid call). Filter by connection / review_status.
export async function GET(req) {
  try {
    var supabase = sb();
    if (!supabase) { return NextResponse.json({ error: 'Server bank-ingestion key missing (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 }); }
    var url = new URL(req.url);
    var connectionId = url.searchParams.get('connection_id');
    var reviewStatus = url.searchParams.get('review_status');
    var query = supabase.from('bank_transactions').select('*').order('posted_date', { ascending: false, nullsFirst: false });
    if (connectionId) query = query.eq('connection_id', connectionId);
    if (reviewStatus) query = query.eq('review_status', reviewStatus);
    var r = await query.limit(500);
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    return NextResponse.json({ transactions: r.data });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}
