import { authorizePlaidOperation, plaidJson, plaidError } from '../_auth';
import { mapPlaidTransaction, supersededPendingIds } from '../../../../lib/bank-ingest';
import { readBankJson, projectPlaidAccountMetadata } from '../../../../lib/bank-visibility';
import { accountTwins } from '../../../../lib/account-twins-server'; // v55.83-QS
import { hubNewestForConnection } from '../../../../lib/bank-continue'; // v55.83-SH
import { autoMatchSentWires } from '../../../../lib/wire-auto-match'; // v55.83-RZ — new bank lines → sent wires matched, bills PAID

// v55.83-X — Phase 1 bank ingestion. var + string-concat only (SWC constraint).
var PLAID_BASE = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

// POST — pull from Plaid (read-only) and upsert into bank_transactions.
// v55.83-SF (Max Nov 12 09:57: "i synced new transactions ... not getting new transactions") — this route had NO time limit set,
// and since RZ it also runs the wire matcher after saving the bank lines. Give it a full minute, and keep the matcher short.
export var maxDuration = 60;

export async function POST(req) {
  try {
    var access = await authorizePlaidOperation(req, 'bank_transactions.view', true);
    var supabase = access.db;
    var body = await readBankJson(req);
    var connection_id = body.connection_id;
    var start_date = body.start_date;
    // v55.83-QB — Deep re-pull (an explicit start_date backfill) is a
    // CONNECTION-management operation: require bank.connections unless the
    // caller is the cron or a verified super admin. Legacy behavior for
    // normal incremental sync is unchanged.
    if (body && body.start_date && access && access.via !== 'cron' && access.isVerifiedSuperAdmin !== true) {
      try { await authorizePlaidOperation(req, 'bank.connections', false); }
      catch (eQB2) { return plaidJson({ error: 'Deep re-pull history needs the "Bank: Manage Connections" permission — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: 403 }); }
    }
    var end_date = body.end_date;
    var env = process.env.PLAID_ENV || 'sandbox';
    var base = PLAID_BASE[env] || PLAID_BASE.sandbox;

    var connRes = await supabase.from('bank_connections').select('*').eq('id', connection_id).single();
    // v55.83-QS — a MANUAL (CSV-only) account has nothing to pull from Plaid.
    if (connRes && connRes.data && (connRes.data.status === 'manual' || /^manual-/.test(String(connRes.data.plaid_item_id || '')))) {
      return plaidJson({ ok: true, manual: true, inserted: 0, synced: 0, note: 'Manual (CSV) account — add its transactions with 📄 Import statement CSV.' });
    }
    if (connRes.error || !connRes.data) return plaidJson({ error: 'Connection not found' }, { status: 404 });
    var conn = connRes.data;
    // v55.83-DB — never sync an unassigned bank connection (would create untagged transactions that leak across silos)
    if (!conn.wave_business_id) { return plaidJson({ error: 'This bank connection is not assigned to an accounting silo. Assign it (Bank tab -> Unassigned Bank Data) before syncing.' }, { status: 409 }); }

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
    // v55.83-SH (Max Nov 12 10:30: "only sync from last date if i reconnect ... not bring all of it again") — a link that has
    // never finished a sync (a reconnect) continues from the newest transaction the Hub already shows for the same real
    // accounts (minus the overlap). The whole history is pulled only when asked: ⏬ Re-pull history (an explicit start_date).
    var continuedFrom = null; var otherTwinAccts = [];
    try { var hn = await hubNewestForConnection(supabase, conn); otherTwinAccts = hn.others || []; if (!effStart && hn.date) { continuedFrom = hn.date; effStart = new Date(new Date(hn.date).getTime() - OVERLAP_DAYS * 86400000).toISOString().split('T')[0]; } } catch (eHN) { continuedFrom = null; }
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
        return plaidJson({ pending: true, error_code: 'PRODUCT_NOT_READY', message: 'Your bank is connected. Plaid is still preparing the first batch of transactions (usually under a minute). It will retry automatically.' });
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
      return plaidJson({ error: data.error_message || data.error_code, error_code: data.error_code, needs_relink: needsRelink, connection_id: conn.id }, { status: 400 });
    }

    // v55.83-JU (Codex) — FAIL LOUD if we hit the page-safety cap before fetching the whole window.
    // Importing a partial set AND advancing last_successful_posted_date would create exactly the
    // silent historical gap we are eliminating. Do NOT upsert or move the marker — tell the admin to
    // narrow the backfill window (or sync in smaller passes).
    if (totalAvail != null && allTxns.length < totalAvail) {
      try { await supabase.from('bank_connections').update({ last_sync_status: 'error', last_sync_error: 'Backfill window too large: ' + totalAvail + ' transactions exceed the ' + (60 * 500) + '-row single-pass cap.' }).eq('id', conn.id); } catch (eCap) {}
      return plaidJson({ error: 'This backfill window has ' + totalAvail + ' transactions — more than one sync can pull in a single pass (' + (60 * 500) + '). Nothing was imported (to avoid a partial/gap). Narrow the backfill start date and try again, or backfill in smaller windows.', total: totalAvail, fetched: allTxns.length, partial: true, api_build_marker: 'v55.83-JU' }, { status: 400 });
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

    // v55.83-QD (Max, Nov 7 11:59): "imports and plaid can be done for same
    // account and any duplicates to be flagged and ignored." The importer
    // already skips what Plaid pulled; this is the OTHER direction — a Plaid
    // sync skips transactions the CSV already brought in. Match is COUNTED
    // per (account, posted date, amount, direction) — descriptions differ
    // between a bank's CSV and Plaid, so the name is deliberately not part
    // of the key; the counting keeps legitimate same-day twins (the CSV had
    // both lines, so both slots exist). Stateless and deterministic: every
    // sync re-derives the same skips. Fail-soft: a lookup error means no
    // dedupe this pass (upsert idempotency still protects exact ids).
    var manualDeduped = 0;
    try {
      if (rows.length > 0) {
        var mdMin = null; var mdMax = null; var mdAccts = {};
        rows.forEach(function (r0) { var d0 = r0.posted_date || r0.date; if (d0) { if (!mdMin || d0 < mdMin) { mdMin = d0; } if (!mdMax || d0 > mdMax) { mdMax = d0; } } if (r0.account_id) { mdAccts[r0.account_id] = 1; } });
        // v55.83-QS — look across TWIN accounts too: a MANUAL "PNC •1234"
        // filled by CSV before Plaid could connect is the same real account
        // as the Plaid PNC •1234 — its rows count as already stored.
        var twinsMD = await accountTwins(supabase, Object.keys(mdAccts));
        var asPlaid = {}; var lookIds = [];
        Object.keys(twinsMD).forEach(function (pa) { twinsMD[pa].forEach(function (tw) { asPlaid[tw] = pa; if (lookIds.indexOf(tw) < 0) { lookIds.push(tw); } }); });
        var manQ = await supabase.from('bank_transactions')
          .select('id, account_id, date, posted_date, amount_abs, direction')
          .like('plaid_transaction_id', 'manual-%')
          .in('account_id', lookIds)
          .gte('date', mdMin).lte('date', mdMax).limit(20000);
        // v55.83-SH — the SAME real account on an older (still shown) link: its rows are already on the Hub under other Plaid
        // ids — the overlap days would otherwise come in twice after a reconnect.
        var oldRows = [];
        try {
          var otherIds = otherTwinAccts.filter(function (x) { return !mdAccts[x]; });
          if (otherIds.length) {
            var oq = await supabase.from('bank_transactions').select('id, account_id, date, posted_date, amount_abs, direction, plaid_transaction_id').in('account_id', otherIds).gte('date', mdMin).lte('date', mdMax).limit(20000);
            if (!oq.error && oq.data) { oldRows = oq.data.filter(function (x) { return !/^manual-/.test(String(x.plaid_transaction_id || '')); }); }
          }
        } catch (eOld) { oldRows = []; }
        var seenRows = ((!manQ.error && manQ.data) || []).concat(oldRows);
        if (seenRows.length) {
          var manCount = {};
          seenRows.forEach(function (m0) {
            var k0 = (asPlaid[m0.account_id] || m0.account_id) + '|' + (m0.posted_date || m0.date) + '|' + (Math.round((Number(m0.amount_abs) || 0) * 100) / 100).toFixed(2) + '|' + m0.direction;
            manCount[k0] = (manCount[k0] || 0) + 1;
          });
          rows = rows.filter(function (r1) {
            var k1 = r1.account_id + '|' + (r1.posted_date || r1.date) + '|' + (Math.round((Number(r1.amount_abs) || 0) * 100) / 100).toFixed(2) + '|' + r1.direction;
            if ((manCount[k1] || 0) > 0) { manCount[k1]--; manualDeduped++; return false; }
            return true;
          });
        }
      }
    } catch (eMD) { manualDeduped = 0; }

    var synced = 0;
    if (rows.length > 0) {
      // onConflict on plaid_transaction_id => idempotent dedupe. Payload carries
      // only bank-sourced fields, so a re-sync never clobbers a user's review
      // status / classification / links.
      var up = await supabase.from('bank_transactions').upsert(rows, { onConflict: 'plaid_transaction_id' });
      if (up.error) {
        console.error('[plaid] upsert error:', up.error.message);
        return plaidJson({ error: up.error.message }, { status: 500 });
      }
      synced = rows.length;
    }

    // Remove pending rows that have now posted (avoid double-count).
    var superseded = supersededPendingIds(rawTxns);
    if (superseded.length > 0) {
      try { await supabase.from('bank_transactions').delete().in('plaid_transaction_id', superseded); }
      catch (e) { console.warn('[plaid] supersede cleanup failed:', (e && e.message) || e); }
    }

    // v55.83-RZ (Max: "when the wire is actually sent and you see a transaction for that amount ... automatically match") —
    // fail-soft: a matcher problem never fails the bank sync.
    var wireMatch = null;
    if (synced > 0) { try { wireMatch = await autoMatchSentWires(supabase, { actorId: null, budgetMs: 4000 }); } catch (eWM) { wireMatch = null; } }

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

    return plaidJson({
      synced: synced,
      superseded: superseded.length,
      accounts: projectPlaidAccountMetadata(acctsFromPlaid),
      total: totalAvail,
      pages: pageGuard,
      window: { start: effStart, end: effEnd, incremental: !start_date },
      newest_posted_date: newestOverall,
      newest_by_account: newestByAccount,
      markers_persisted: markersPersisted,
      marker_error: markerError,
      manual_deduped: manualDeduped, // v55.83-QD — flagged + ignored CSV twins (SH: + lines already on the Hub from the older link)
      continued_from: continuedFrom, // v55.83-SH
      wires_matched: wireMatch ? wireMatch.matched.length : 0 // v55.83-RZ
    });
  } catch (e) {
    return plaidError(e);
  }
}

// GET — read stored transactions (no Plaid call). Filter by connection / review_status.
export async function GET(req) {
  try {
    var access = await authorizePlaidOperation(req, 'bank_transactions.view', false);
    var supabase = access.db;
    var url = new URL(req.url);
    var connectionId = url.searchParams.get('connection_id');
    var reviewStatus = url.searchParams.get('review_status');
    var query = supabase.from('bank_transactions').select('*').order('posted_date', { ascending: false, nullsFirst: false });
    if (connectionId) query = query.eq('connection_id', connectionId);
    if (reviewStatus) query = query.eq('review_status', reviewStatus);
    var r = await query.limit(500);
    if (r.error) return plaidJson({ error: r.error.message }, { status: 500 });
    return plaidJson({ transactions: r.data });
  } catch (e) {
    return plaidError(e);
  }
}
