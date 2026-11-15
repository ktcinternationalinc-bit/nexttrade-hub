// ============================================================
// /api/backup/snapshot — v55.74
// Creates a snapshot of all business-critical tables and stores
// it in the `backups` table as a JSONB blob.
//
// Invocation:
//   GET  ?kind=daily        — used by the Vercel cron (no auth needed,
//                             cron runs server-side)
//   POST body { kind, triggered_by, triggered_by_name, notes, pinned }
//                           — used by the "Run backup now" button.
//                             Caller is the super_admin's UID.
//
// At end of each successful snapshot we run a tiny retention pass:
//   - keep last 7 daily
//   - keep last 4 weekly
//   - keep last 12 monthly
//   - keep manual backups for 30 days unless pinned
//
// The snapshot stores per-table row arrays with all columns.
// Row counts + size are captured for display.
//
// Per the SWC/Vercel rule, this file uses var + string concat only.
// ============================================================

import { createClient } from '@supabase/supabase-js';

// Vercel Pro plan: serverless functions can run up to 300s. Backup may take
// 30-90s on a large database; default 10s would cut us off mid-snapshot.
export var maxDuration = 300;

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Defensive cap: if cumulative snapshot size crosses this, we abort writing
// new tables to the data column (still record metadata) and flag in notes.
// Postgres JSONB max is ~1GB but we want to stay well below that.
var MAX_TOTAL_SIZE_BYTES = 200 * 1024 * 1024;  // 200MB

// Tables we back up. Two tiers: tier 1 is must-have (financial,
// operational core); tier 2 is nice-to-have. Both go in the snapshot
// since storage is cheap.
//
// Tier 3 (notifications, phone, whatsapp, login, AI memory caches)
// is deliberately EXCLUDED — those are operational logs that:
//   (a) regenerate quickly
//   (b) bloat the snapshot for no business value
//   (c) are retained separately (Twilio, Meta, etc.)
var BACKUP_TABLES = [
  // ─── Tier 1: business-critical financial ───
  'tickets',
  'ticket_comments',
  'invoices',
  'invoice_items',
  'treasury',
  'egypt_bank_transactions',
  'egypt_bank_accounts',
  'bank_transactions',
  'bank_connections',
  'checks',
  'debts',
  'customers',
  'customer_quotes',
  'inventory',
  'inventory_adjustments',
  'inventory_expected',
  'users',
  'hr_requests',
  'hr_complaints',
  'system_tickets',
  // ─── Tier 2: operational ───
  'calendar_events',
  'meeting_notes',
  'crm_leads',
  'client_notes',
  'contact_log',
  'shipments',
  'shipping_quotes',
  'shipping_rates',
  'customs_clearances',
  'customs_rates',
  'customs_settings',
  'daily_log',
  'team_reminders',
  'reminders',
  'announcements',
  'announcement_acks',
  'audit_log',
  'follow_ups',
  'team_profiles',
  'app_settings',
  'expense_rules',
  'categories',
  'module_permissions',
  'quote_companies',
  'vendor_contacts',
  'warehouse_expenses',
  'import_batches',
];

// Per-table row cap — defensive. If a table somehow has 200k rows
// (treasury after 10 years, say), we don't want one snapshot to
// blow out the JSONB size limit (~1GB but we want to stay well below).
// At 50k rows × ~300 bytes/row = 15MB per table, well within reason.
var ROW_CAP_PER_TABLE = 50000;

async function snapshotOneTable(tableName) {
  // Defensive: each table fetched in its own try/catch. One missing
  // table (e.g. brand new install where some table doesn't exist
  // yet) must not kill the whole backup.
  try {
    var res = await supabase
      .from(tableName)
      .select('*')
      .limit(ROW_CAP_PER_TABLE);
    if (res.error) {
      // Table missing or RLS denial — record empty + a note rather than fail
      return { rows: [], error: res.error.message || 'unknown error', count: 0 };
    }
    var rows = res.data || [];
    return { rows: rows, error: null, count: rows.length };
  } catch (e) {
    return { rows: [], error: (e && e.message) || 'exception', count: 0 };
  }
}

async function runRetention() {
  // Returns count of backups deleted
  var deleted = 0;
  try {
    // Daily: keep last 7
    var dailyRes = await supabase
      .from('backups')
      .select('id, created_at')
      .eq('kind', 'daily')
      .eq('pinned', false)
      .order('created_at', { ascending: false });
    if (dailyRes.data && dailyRes.data.length > 7) {
      var dailyToDelete = dailyRes.data.slice(7).map(function (b) { return b.id; });
      if (dailyToDelete.length) {
        await supabase.from('backups').delete().in('id', dailyToDelete);
        deleted += dailyToDelete.length;
      }
    }
    // Weekly: keep last 4
    var weeklyRes = await supabase
      .from('backups')
      .select('id, created_at')
      .eq('kind', 'weekly')
      .eq('pinned', false)
      .order('created_at', { ascending: false });
    if (weeklyRes.data && weeklyRes.data.length > 4) {
      var weeklyToDelete = weeklyRes.data.slice(4).map(function (b) { return b.id; });
      if (weeklyToDelete.length) {
        await supabase.from('backups').delete().in('id', weeklyToDelete);
        deleted += weeklyToDelete.length;
      }
    }
    // Monthly: keep last 12
    var monthlyRes = await supabase
      .from('backups')
      .select('id, created_at')
      .eq('kind', 'monthly')
      .eq('pinned', false)
      .order('created_at', { ascending: false });
    if (monthlyRes.data && monthlyRes.data.length > 12) {
      var monthlyToDelete = monthlyRes.data.slice(12).map(function (b) { return b.id; });
      if (monthlyToDelete.length) {
        await supabase.from('backups').delete().in('id', monthlyToDelete);
        deleted += monthlyToDelete.length;
      }
    }
    // Manual: keep 30 days unless pinned
    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    var oldManualRes = await supabase
      .from('backups')
      .select('id')
      .eq('kind', 'manual')
      .eq('pinned', false)
      .lt('created_at', thirtyDaysAgo);
    if (oldManualRes.data && oldManualRes.data.length > 0) {
      var manualToDelete = oldManualRes.data.map(function (b) { return b.id; });
      await supabase.from('backups').delete().in('id', manualToDelete);
      deleted += manualToDelete.length;
    }
  } catch (e) {
    console.warn('[backup] retention pass error:', (e && e.message) || e);
  }
  return deleted;
}

async function performBackup(opts) {
  var startMs = Date.now();
  var kind = (opts && opts.kind) || 'manual';
  var triggeredBy = (opts && opts.triggered_by) || null;
  var triggeredByName = (opts && opts.triggered_by_name) || (kind === 'manual' ? 'manual' : 'cron');
  var notes = (opts && opts.notes) || null;
  var pinned = !!(opts && opts.pinned);

  console.log('[backup] starting ' + kind + ' snapshot...');

  var data = {};
  var rowCounts = {};
  var tablesWithErrors = [];
  var tablesIncluded = [];
  var skippedForSize = [];
  var cumulativeSize = 0;

  // Snapshot each table sequentially — keeps memory predictable
  // and avoids hammering Supabase with 47 parallel large fetches.
  for (var i = 0; i < BACKUP_TABLES.length; i++) {
    var t = BACKUP_TABLES[i];
    // Check size budget before fetching the next table
    if (cumulativeSize > MAX_TOTAL_SIZE_BYTES) {
      skippedForSize.push(t);
      rowCounts[t] = 0;
      data[t] = [];
      continue;
    }
    var r = await snapshotOneTable(t);
    data[t] = r.rows;
    rowCounts[t] = r.count;
    tablesIncluded.push(t);
    if (r.error) {
      tablesWithErrors.push(t + ': ' + r.error);
    }
    // Track approximate size as we go
    if (r.rows && r.rows.length > 0) {
      try {
        cumulativeSize += Buffer.byteLength(JSON.stringify(r.rows), 'utf8');
      } catch (_) {}
    }
  }

  // Compute approximate size for display. We don't store this as
  // the source of truth — Postgres will report the JSONB column's
  // actual storage on disk. But this gives users a useful "this
  // backup contains ~12.4MB of data" number.
  var sizeBytes = 0;
  try {
    sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  } catch (e) {
    sizeBytes = 0;
  }

  var combinedNotes = notes;
  if (tablesWithErrors.length > 0) {
    combinedNotes = (combinedNotes ? combinedNotes + ' | ' : '') + 'Errors: ' + tablesWithErrors.join('; ');
  }
  if (skippedForSize.length > 0) {
    combinedNotes = (combinedNotes ? combinedNotes + ' | ' : '') + 'Skipped (size cap): ' + skippedForSize.join(', ');
  }

  var insertRow = {
    kind: kind,
    triggered_by: triggeredBy,
    triggered_by_name: triggeredByName,
    tables_included: tablesIncluded,
    row_counts: rowCounts,
    size_bytes: sizeBytes,
    duration_ms: Date.now() - startMs,
    notes: combinedNotes,
    pinned: pinned,
    data: data,
  };

  var insertRes = await supabase.from('backups').insert(insertRow).select('id, created_at, size_bytes, duration_ms').maybeSingle();
  if (insertRes.error) {
    throw new Error('Insert backup row failed: ' + insertRes.error.message);
  }

  // Run retention. Failure here is non-fatal — backup row is already
  // saved, retention runs again next time.
  var retentionDeleted = await runRetention();

  var totalRows = 0;
  for (var k in rowCounts) {
    if (Object.prototype.hasOwnProperty.call(rowCounts, k)) totalRows += rowCounts[k];
  }

  return {
    ok: true,
    backup_id: insertRes.data && insertRes.data.id,
    created_at: insertRes.data && insertRes.data.created_at,
    kind: kind,
    duration_ms: Date.now() - startMs,
    size_bytes: sizeBytes,
    tables_count: tablesIncluded.length,
    total_rows: totalRows,
    tables_with_errors: tablesWithErrors,
    retention_deleted: retentionDeleted,
  };
}

// ============================================================
// Handlers
// ============================================================
export async function GET(req) {
  // Cron path — Vercel hits this with no query string by default.
  // We always do a daily snapshot. On Sundays we additionally do
  // a weekly. On the 1st of the month we additionally do a monthly.
  // Manual override via ?kind=X is supported for debugging.
  try {
    var url = new URL(req.url);
    var explicitKind = url.searchParams.get('kind');
    if (explicitKind) {
      // Manual debug invocation
      if (explicitKind !== 'manual' && explicitKind !== 'daily' && explicitKind !== 'weekly' && explicitKind !== 'monthly') {
        return new Response(JSON.stringify({ ok: false, error: 'invalid kind' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      var single = await performBackup({ kind: explicitKind });
      return new Response(JSON.stringify(single), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Default cron flow: always daily; promote to weekly on Sundays; promote to monthly on day 1.
    // Compute these in Eastern Time so promotion aligns with KTC's business calendar.
    var nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var dayOfWeek = nowET.getDay();      // 0 = Sunday
    var dayOfMonth = nowET.getDate();    // 1 = first of month
    var results = [];
    var dailyRes = await performBackup({ kind: 'daily' });
    results.push(dailyRes);
    if (dayOfWeek === 0) {
      var weeklyRes = await performBackup({ kind: 'weekly' });
      results.push(weeklyRes);
    }
    if (dayOfMonth === 1) {
      var monthlyRes = await performBackup({ kind: 'monthly' });
      results.push(monthlyRes);
    }
    return new Response(JSON.stringify({ ok: true, snapshots: results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e && e.message) || 'unknown' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function POST(req) {
  try {
    var body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    var kind = body.kind || 'manual';
    if (kind !== 'manual' && kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly') {
      return new Response(JSON.stringify({ ok: false, error: 'invalid kind' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    var result = await performBackup({
      kind: kind,
      triggered_by: body.triggered_by || null,
      triggered_by_name: body.triggered_by_name || null,
      notes: body.notes || null,
      pinned: !!body.pinned,
    });
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e && e.message) || 'unknown' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
