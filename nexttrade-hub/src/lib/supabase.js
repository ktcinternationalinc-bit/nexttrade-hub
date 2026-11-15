import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'sb-ktc-auth',
    // Opt out of the buggy LockManager. Falls back to a direct
    // passthrough that has never produced the orphaned-lock symptom.
    lock: async (name, acquireTimeout, fn) => fn(),
  },
});

// Helper: fetch with error handling
export async function dbQuery(table, options = {}) {
  let query = supabase.from(table).select(options.select || '*');
  if (options.eq) Object.entries(options.eq).forEach(([k, v]) => { query = query.eq(k, v); });
  if (options.gte) Object.entries(options.gte).forEach(([k, v]) => { query = query.gte(k, v); });
  if (options.lte) Object.entries(options.lte).forEach(([k, v]) => { query = query.lte(k, v); });
  if (options.ilike) Object.entries(options.ilike).forEach(([k, v]) => { query = query.ilike(k, `%${v}%`); });
  if (options.order) query = query.order(options.order.col, { ascending: options.order.asc ?? true });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Helper: insert with audit
//
// v55.30 — resilient to missing columns. If Postgres rejects the insert
// because a column doesn't exist (typically because a SQL migration wasn't
// run yet), we strip that column from the record and retry ONCE. The
// missing column is logged so it's still visible in dev tools, but the
// user-visible save succeeds. This prevents the entire feature from
// breaking when one optional column is added to the UI before the DB
// migration has been applied. (The concrete trigger was the "Could not
// find the 'all_day' column of 'calendar_events' in the schema cache"
// error after the s26 migration hadn't been run.)
//
// We only strip ONE column per attempt and retry once — if a second
// missing-column error appears after the retry, we surface it normally
// so the developer knows to fix the migration. This is intentional:
// silently stripping fields forever could mask real schema drift.
function extractMissingColumn(error) {
  if (!error || !error.message) return null;
  // Postgres / supabase-js error messages we care about:
  //   "Could not find the 'all_day' column of 'calendar_events' in the schema cache"
  //   "column \"all_day\" of relation \"calendar_events\" does not exist"
  var m1 = error.message.match(/Could not find the '([^']+)' column/);
  if (m1) return m1[1];
  var m2 = error.message.match(/column "([^"]+)" of relation .* does not exist/);
  if (m2) return m2[1];
  return null;
}

export async function dbInsert(table, record, userId) {
  var attemptRecord = record;
  var strippedColumns = [];
  var data, error;

  // v55.83-A.6.7 (Max May 13 2026) — CRIT-1 fix: when inserting into
  // treasury with order_number set but linked_invoice_id missing, auto-
  // resolve the invoice id so the row joins to the correct invoice from
  // the start. Without this, recalcInvoiceCollected (which joins on
  // linked_invoice_id) silently misses these rows — invoice 2303 had
  // 4 placeholder rows totaling 1.32M but invoice showed Collected = 0.
  if (table === 'treasury'
      && attemptRecord
      && typeof attemptRecord === 'object'
      && attemptRecord.order_number
      && !attemptRecord.linked_invoice_id) {
    try {
      var lookup = await supabase.from('invoices')
        .select('id')
        .eq('order_number', String(attemptRecord.order_number).trim())
        .maybeSingle();
      if (lookup && lookup.data && lookup.data.id) {
        attemptRecord = Object.assign({}, attemptRecord, { linked_invoice_id: lookup.data.id });
      }
    } catch (lookupErr) {
      // Don't block insert; log so a missed link is debuggable.
      console.warn('[dbInsert] treasury auto-link lookup failed:', lookupErr && lookupErr.message);
    }
  }

  // First attempt
  var first = await supabase.from(table).insert(attemptRecord).select().single();
  data = first.data;
  error = first.error;

  // v55.82-Y (Max May 12 2026 — "creating tickets is not working"): if a
  // record has MULTIPLE not-yet-migrated columns (e.g. both is_private
  // and private_to on tickets), the old single-retry logic stripped one,
  // retried, then bombed on the next missing column. Loop up to 8 times,
  // stripping one column per iteration, so any number of pending columns
  // are gracefully removed before giving up.
  var safety = 0;
  while (error && safety < 8) {
    var missing = extractMissingColumn(error);
    if (!missing || !(missing in attemptRecord)) break;
    console.warn('[dbInsert] ' + table + ' missing column "' + missing + '" — stripping and retrying. Run the SQL migration that adds this column.');
    var retryRecord = Object.assign({}, attemptRecord);
    delete retryRecord[missing];
    strippedColumns.push(missing);
    var retry = await supabase.from(table).insert(retryRecord).select().single();
    data = retry.data;
    error = retry.error;
    attemptRecord = retryRecord;
    safety++;
  }

  if (error) throw error;
  if (userId) {
    // v55.83-A.6.27.NEXT (Issue 11, Max May 23 2026): audit_log insert
    // was awaited but the {data, error} result was never checked. Supabase
    // doesn't throw on DB errors — they come back in the .error field.
    // So a broken audit_log table silently swallowed every write event,
    // which made debugging "nothing happened" complaints very hard.
    // Now we surface the error to the console so it shows up in DevTools,
    // but DON'T fail the parent insert (audit is best-effort).
    try {
      var auditRes = await supabase.from('audit_log').insert({
        table_name: table, record_id: data && data.id, action: 'create',
        changed_by: userId, new_values: attemptRecord
      });
      if (auditRes && auditRes.error) {
        console.warn('[dbInsert] audit_log insert failed (write itself succeeded):', auditRes.error.message || auditRes.error);
      }
    } catch (auditErr) {
      console.warn('[dbInsert] audit_log threw (write itself succeeded):', (auditErr && auditErr.message) || auditErr);
    }
  }
  // Tag the returned row with diagnostic info so callers can see what was
  // dropped without changing the public API. Read-only consumers ignore
  // this; tools that want to surface a migration warning can check it.
  if (strippedColumns.length > 0 && data && typeof data === 'object') {
    try { Object.defineProperty(data, '__strippedColumns', { value: strippedColumns, enumerable: false }); } catch (_) {}
  }
  return data;
}

// Helper: update with audit
//
// v55.30 — same missing-column resilience as dbInsert. See comment there.
export async function dbUpdate(table, id, changes, userId) {
  // Get old values for audit
  const { data: old } = await supabase.from(table).select('*').eq('id', id).single();

  var attemptChanges = changes;
  var strippedColumns = [];
  var first = await supabase.from(table).update(attemptChanges).eq('id', id).select().single();
  var data = first.data;
  var error = first.error;

  if (error) {
    // v55.82-Y — iterate stripping missing columns. Same fix as dbInsert.
    var safetyU = 0;
    while (error && safetyU < 8) {
      var missing = extractMissingColumn(error);
      if (!missing || !(missing in attemptChanges)) break;
      console.warn('[dbUpdate] ' + table + ' missing column "' + missing + '" — stripping and retrying. Run the SQL migration that adds this column.');
      var retryChanges = Object.assign({}, attemptChanges);
      delete retryChanges[missing];
      strippedColumns.push(missing);
      // If stripping the only field leaves nothing to update, just return the row
      if (Object.keys(retryChanges).length === 0) {
        return old;
      }
      var retry = await supabase.from(table).update(retryChanges).eq('id', id).select().single();
      data = retry.data;
      error = retry.error;
      attemptChanges = retryChanges;
      safetyU++;
    }
  }

  if (error) throw error;
  if (userId) {
    // Check if this is a late edit (24h+ after creation)
    const createdAt = old?.created_at || old?.date;
    const hoursSinceCreation = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 3600000 : 0;
    const isLateEdit = hoursSinceCreation > 24;

    // Detect sensitive field changes. List covers both legacy short names
    // (preserved for backward compat) AND actual schema column names across
    // invoices / treasury / checks / bank. Without the long forms, audit trail
    // would miss edits to bank_in, total_amount, transaction_date, etc.
    const SENSITIVE_FIELDS = [
      // Short forms (legacy; preserved)
      'amount', 'total', 'cash_in', 'cash_out', 'price', 'unit_price', 'rate', 'date', 'description', 'customer', 'order_number', 'invoice_number', 'qty', 'quantity', 'vat_rate',
      // Schema column names (real ones the UI edits)
      'total_amount', 'total_collected', 'outstanding',
      'bank_in', 'bank_out', 'expected_amount', 'usd_in', 'usd_out', 'foreign_amount',
      'transaction_date', 'invoice_date', 'due_date', 'check_date', 'collection_date',
      'customer_name', 'customer_name_en', 'check_number',
    ];
    const changedFields = Object.keys(attemptChanges).filter(k => old && old[k] !== attemptChanges[k]);
    const sensitiveChanges = changedFields.filter(f => SENSITIVE_FIELDS.includes(f));

    await supabase.from('audit_log').insert({
      table_name: table, record_id: id, action: 'update',
      changed_by: userId, old_values: old, new_values: attemptChanges,
      is_late_edit: isLateEdit,
      hours_since_creation: Math.round(hoursSinceCreation),
      sensitive_fields_changed: sensitiveChanges.length > 0 ? sensitiveChanges : null,
    });
  }
  // Same diagnostic tag as dbInsert
  if (strippedColumns.length > 0 && data && typeof data === 'object') {
    try { Object.defineProperty(data, '__strippedColumns', { value: strippedColumns, enumerable: false }); } catch (_) {}
  }
  return data;
}

// Helper: delete with audit
export async function dbDelete(table, id, userId) {
  const { data: old } = await supabase.from(table).select('*').eq('id', id).single();
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  if (userId) {
    await supabase.from('audit_log').insert({
      table_name: table, record_id: id, action: 'delete',
      changed_by: userId, old_values: old
    });
  }
}

// Activity logger — auto-captures all user actions to daily_log
export async function logActivity(userId, text, category) {
  if (!userId) return;
  try {
    const today = new Date().toISOString().substring(0, 10);
    var record = { user_id: userId, entry_text: text, auto_generated: true, log_date: today };
    if (category) record.log_category = category;
    await supabase.from('daily_log').insert(record);
  } catch(e) { console.log('Log error:', e); }
}

// Auth helpers
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// NOTE: the legacy `recalcInvoice(orderNumber)` helper was removed on
// 2026-04-20 — it summed only `cash_in` (pre-bank-separation math) and
// would have silently dropped every bank payment from collected totals.
// All invoice recalculation MUST go through `recalcInvoiceCollected(id)`
// in src/app/page.jsx, which sums `cash_in + bank_in`, skips placeholders
// and bank-confirmation dedup markers, caps at invoice total, and updates
// `outstanding`.
