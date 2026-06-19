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

    var plaidRes = await fetch(base + '/transactions/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: conn.access_token,
        start_date: start_date || thirtyAgo,
        end_date: end_date || today,
        options: { count: 500, offset: 0 },
      }),
    });
    var data = await plaidRes.json();
    if (data.error_code === 'PRODUCT_NOT_READY') {
      try { await supabase.from('bank_connections').update({ last_sync_status: 'preparing', last_sync_error: 'Plaid is still preparing transactions' }).eq('id', conn.id); } catch (ePrep) {}
      return NextResponse.json({ pending: true, error_code: 'PRODUCT_NOT_READY', message: 'Your bank is connected. Plaid is still preparing the first batch of transactions (usually under a minute). It will retry automatically.' });
    }
    if (data.error_code) return NextResponse.json({ error: data.error_message || data.error_code }, { status: 400 });

    var rawTxns = data.transactions || [];
    // Index Plaid accounts so each transaction knows its account type/subtype
    // (depository vs credit). Credit/loan accounts get flagged unsupported.
    var accountsById = {};
    (data.accounts || []).forEach(function (a) { if (a && a.account_id) accountsById[a.account_id] = a; });

    // v55.83-IV — ACCOUNT-LEVEL silo: build a map of plaid_account_id -> wave_business_id from the
    // per-account assignment, so each transaction is stamped by its OWN account (6338 vs 6353), not
    // the whole connection. Also UPSERT plaid_accounts (names/masks) WITHOUT clobbering the assignment.
    var acctSiloMap = {};
    try {
      var paRes = await supabase.from('plaid_accounts').select('plaid_account_id, wave_business_id').eq('connection_id', conn.id);
      ((paRes && paRes.data) || []).forEach(function (a) { if (a && a.plaid_account_id && a.wave_business_id) { acctSiloMap[a.plaid_account_id] = a.wave_business_id; } });
    } catch (eMap) {}
    if (data.accounts && data.accounts.length) {
      var paRows = data.accounts.map(function (a) {
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

    await supabase.from('bank_connections').update({ last_synced: new Date().toISOString(), last_sync_status: 'ok', last_sync_error: null }).eq('id', conn.id);

    return NextResponse.json({ synced: synced, superseded: superseded.length, accounts: data.accounts || [], total: data.total_transactions });
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
