'use client';
// v55.83-CC — Wave category protection. THE guard that makes it impossible for a
// Hub blank/unknown category to ever clear, null, or downgrade a category that
// already exists in Wave. Wave is the official ledger for historical records.
//
// THE ONE RULE: a missing Hub category means "Hub does not know yet" — it is
// NEVER an instruction to remove Wave's category. So when Hub category is blank
// or unmapped we OMIT the category field from any Wave payload entirely (we never
// send category: null / account_id: null / "Uncategorized").

function isBlank(v) { return v == null || String(v).trim() === ''; }

// Resolve a Hub category to a Wave account mapping row from wave_categories.
// mappings: [{ hub_category, wave_account_id, wave_account_name, is_active }]
export function findMapping(hubCategory, mappings) {
  if (isBlank(hubCategory)) { return null; }
  var hit = null;
  (mappings || []).forEach(function (m) {
    if (!hit && m && m.is_active !== false && String(m.hub_category || '').toLowerCase() === String(hubCategory).toLowerCase()) { hit = m; }
  });
  return hit;
}

// Build the category portion of a Hub -> Wave payload. Returns either
//   { skip: true, reason }                      -> do NOT touch Wave's category
//   { skip: false, fields: { accountId: ... } } -> safe to set this mapped account
// It NEVER returns a null/blank account field, and NEVER an "Uncategorized"
// value unless the caller passes a mapping that explicitly points at a real Wave
// "Uncategorized" account (i.e. the user chose it).
export function buildWaveCategoryPayload(hubCategory, mappings) {
  if (isBlank(hubCategory)) {
    return { skip: true, reason: 'hub_blank', message: 'Hub category is blank — Wave category left untouched.' };
  }
  var m = findMapping(hubCategory, mappings);
  if (!m || isBlank(m.wave_account_id)) {
    return { skip: true, reason: 'hub_unmapped', message: 'Hub category has no Wave account mapping — push blocked, Wave left untouched.' };
  }
  return { skip: false, fields: { accountId: m.wave_account_id }, wave_account_name: m.wave_account_name || null };
}

// Classify the relationship between Wave's existing category and Hub's category.
// waveAccountId = the category Wave currently has (or null/unknown).
export function categoryConflict(waveAccountId, hubCategory, mappings) {
  var hubBlank = isBlank(hubCategory);
  var waveHas = !isBlank(waveAccountId);
  if (hubBlank) { return waveHas ? 'hub_missing' : 'both_unknown'; }
  var m = findMapping(hubCategory, mappings);
  if (!m || isBlank(m.wave_account_id)) { return 'needs_mapping'; }
  if (!waveHas) { return 'wave_missing'; }            // Hub knows, Wave doesn't
  return m.wave_account_id === waveAccountId ? 'match' : 'conflict';
}

// Default resolution for any conflict is ALWAYS to keep Wave.
export function defaultConflictResolution() { return 'keep_wave'; }

// Whether a Hub -> Wave category push is permitted at all, given business safety.
// reg = wave_business_registry row for the active business.
export function canPushCategory(reg, hubCategory, mappings, opts) {
  opts = opts || {};
  if (!reg) { return { ok: false, reason: 'no_business' }; }
  if (reg.is_production !== false && reg.writes_enabled !== true) { return { ok: false, reason: 'production_read_only' }; }
  if (reg.is_production !== false && opts.allowProductionPush !== true) { return { ok: false, reason: 'production_push_flag_off' }; }
  var payload = buildWaveCategoryPayload(hubCategory, mappings);
  if (payload.skip) { return { ok: false, reason: payload.reason }; }
  if (opts.waveLocked === true && opts.override !== true) { return { ok: false, reason: 'wave_locked' }; }
  return { ok: true, fields: payload.fields };
}

// UI label for a record's Wave category state. NEVER says "Uncategorized" unless
// Wave itself recorded Uncategorized.
export function waveCategoryLabel(rec) {
  if (!rec) { return 'Wave category unknown in Hub'; }
  if (!isBlank(rec.wave_category_name)) { return rec.wave_category_name; }
  if (!isBlank(rec.wave_account_name)) { return rec.wave_account_name; }
  if (rec.category_source === 'wave' && rec.wave_category_is_uncategorized === true) { return 'Uncategorized (in Wave)'; }
  return 'Not imported from Wave';
}

// Build a sync-log row for a skipped/attempted category action (for wave_sync_log).
export function categorySyncLogEntry(args) {
  args = args || {};
  return {
    entity_type: 'bank_transaction_category',
    hub_record_id: args.hubRecordId || null,
    wave_record_id: args.waveRecordId || null,
    old_wave_category: args.oldWaveCategory || null,
    new_wave_category: args.newWaveCategory || null,
    hub_category: args.hubCategory || null,
    action: args.action || 'skip',
    success: args.success === true,
    error_message: args.errorMessage || null,
    attempted_by: args.attemptedBy || null,
    attempted_at: new Date().toISOString()
  };
}
