import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

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
export async function dbInsert(table, record, userId) {
  const { data, error } = await supabase.from(table).insert(record).select().single();
  if (error) throw error;
  if (userId) {
    await supabase.from('audit_log').insert({
      table_name: table, record_id: data.id, action: 'create',
      changed_by: userId, new_values: record
    });
  }
  return data;
}

// Helper: update with audit
export async function dbUpdate(table, id, changes, userId) {
  // Get old values for audit
  const { data: old } = await supabase.from(table).select('*').eq('id', id).single();
  const { data, error } = await supabase.from(table).update(changes).eq('id', id).select().single();
  if (error) throw error;
  if (userId) {
    // Check if this is a late edit (24h+ after creation)
    const createdAt = old?.created_at || old?.date;
    const hoursSinceCreation = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 3600000 : 0;
    const isLateEdit = hoursSinceCreation > 24;

    // Detect sensitive field changes
    const SENSITIVE_FIELDS = ['amount', 'total', 'cash_in', 'cash_out', 'price', 'unit_price', 'rate', 'date', 'description', 'customer', 'order_number', 'invoice_number', 'qty', 'quantity', 'vat_rate'];
    const changedFields = Object.keys(changes).filter(k => old && old[k] !== changes[k]);
    const sensitiveChanges = changedFields.filter(f => SENSITIVE_FIELDS.includes(f));

    await supabase.from('audit_log').insert({
      table_name: table, record_id: id, action: 'update',
      changed_by: userId, old_values: old, new_values: changes,
      is_late_edit: isLateEdit,
      hours_since_creation: Math.round(hoursSinceCreation),
      sensitive_fields_changed: sensitiveChanges.length > 0 ? sensitiveChanges : null,
    });
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

// Recalculate invoice from treasury
export async function recalcInvoice(orderNumber) {
  const { data: txns } = await supabase
    .from('treasury')
    .select('cash_in')
    .eq('order_number', orderNumber);
  
  const totalCollected = (txns || []).reduce((sum, t) => sum + (t.cash_in || 0), 0);
  
  await supabase
    .from('invoices')
    .update({ total_collected: totalCollected })
    .eq('order_number', orderNumber);
}
