// Snapshot creation accepts an already-authorized server client.
// It never creates a client or accepts browser-supplied actor identity.
import { redactBackupData } from './backup-security.js';

export async function createBusinessBackup(supabase, opts, env) {
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
      return { rows: [], error: 'Table could not be read', count: 0 };
    }
    var rows = res.data || [];
    return { rows: rows, error: null, count: rows.length };
  } catch (e) {
    return { rows: [], error: 'Table could not be read', count: 0 };
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
    console.warn('[backup] retention pass could not complete');
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

  // Strip provider credentials before any persistent backup write.
  var secured = redactBackupData(data, env);
  data = secured.data;
  tablesIncluded = Object.keys(data);
  rowCounts = {};
  tablesIncluded.forEach(function (table) { rowCounts[table] = data[table].length; });

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

  combinedNotes = secured.scrub(combinedNotes);
  combinedNotes = (combinedNotes ? combinedNotes + ' | ' : '') + 'Provider credentials excluded. Restore business metadata only; preserve live server credentials.';

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
    throw new Error('The backup snapshot could not be saved.');
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


  return performBackup(opts);
}
