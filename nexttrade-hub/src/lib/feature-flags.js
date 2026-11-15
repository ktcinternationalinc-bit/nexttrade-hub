// v55.83-A.6.27.68 — Feature flag system.
//
// Tiny Supabase-backed feature flag system. Flags live in the
// `app_feature_flags` table. Super-admin reads/writes via Settings UI.
// All other code reads via getFeatureFlag(name, defaultValue).
//
// Why: lets us ship new features (like warehouse buckets) with the UI
// hidden behind a flag, so we can deploy safely, soak for a few days,
// then flip on when ready. If the feature causes problems, flip OFF
// instantly — no rollback needed, no code change, no redeploy.
//
// Storage shape: simple key/value JSON. Cache hits in-memory for
// 30 seconds to avoid hammering the DB on every render.
//
// Schema (run once, idempotent):
//   CREATE TABLE IF NOT EXISTS app_feature_flags (
//     key         TEXT PRIMARY KEY,
//     value       BOOLEAN NOT NULL DEFAULT FALSE,
//     description TEXT,
//     updated_at  TIMESTAMPTZ DEFAULT NOW(),
//     updated_by  UUID
//   );

import { supabase } from './supabase';

var _cache = {};        // key -> { value, expiresAt }
var CACHE_TTL_MS = 30 * 1000;  // 30 seconds

// Read a flag. Returns defaultValue if the flag doesn't exist or load fails.
// Safe to call on every render — cached.
export async function getFeatureFlag(key, defaultValue) {
  if (defaultValue === undefined) defaultValue = false;
  var cached = _cache[key];
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    var res = await supabase
      .from('app_feature_flags')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (res && res.error) {
      // Table may not exist yet, or RLS denied. Either way, fail safe to default.
      console.warn('[feature-flags] read failed for "' + key + '":', res.error.message);
      return defaultValue;
    }
    var value = res && res.data ? !!res.data.value : defaultValue;
    _cache[key] = { value: value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn('[feature-flags] read threw for "' + key + '":', (err && err.message) || err);
    return defaultValue;
  }
}

// Synchronous version that returns the cached value or defaultValue.
// Use in render paths where you can't await; warm the cache via getFeatureFlag
// in a useEffect first.
export function getFeatureFlagSync(key, defaultValue) {
  if (defaultValue === undefined) defaultValue = false;
  var cached = _cache[key];
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return defaultValue;
}

// Write a flag (super-admin only — gate at the call site).
// Invalidates the local cache for this key so next read picks up the new value.
export async function setFeatureFlag(key, value, userId, description) {
  try {
    var payload = {
      key: key,
      value: !!value,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    };
    if (description) payload.description = description;
    var res = await supabase.from('app_feature_flags').upsert(payload, { onConflict: 'key' });
    if (res && res.error) {
      console.error('[feature-flags] write failed for "' + key + '":', res.error.message);
      return { ok: false, error: res.error.message };
    }
    delete _cache[key];  // invalidate so next read fetches fresh
    return { ok: true };
  } catch (err) {
    console.error('[feature-flags] write threw for "' + key + '":', (err && err.message) || err);
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// List all flags (super-admin only). Used by the Settings UI.
export async function listFeatureFlags() {
  try {
    var res = await supabase.from('app_feature_flags').select('*').order('key');
    if (res && res.error) {
      console.warn('[feature-flags] list failed:', res.error.message);
      return [];
    }
    return res.data || [];
  } catch (err) {
    console.warn('[feature-flags] list threw:', (err && err.message) || err);
    return [];
  }
}

// Clear the in-memory cache for one or all flags. Useful if you just changed
// a flag from outside this module.
export function invalidateFeatureFlagCache(key) {
  if (key) delete _cache[key];
  else _cache = {};
}

// ─── Known flag keys (registry — extend as features are added) ───
// Listed here so we have one place to find all flags + their defaults.
// Settings UI reads this list to render toggleable rows even for flags
// that haven't been written to the DB yet.
export var KNOWN_FLAGS = [
  {
    key: 'warehouse_buckets_enabled',
    defaultValue: false,
    label: 'Warehouse Expense Buckets',
    description: 'Enables the bucket workflow for warehouse advances: dedicated create button in Treasury + Warehouse tab, bucket ledgers with categorized spend tracking, approval workflow, and Expense Report recategorization on close. Treasury cash totals are NEVER affected by this feature — it only changes how reconciled advances appear in the Expense Report categorization view.',
    category: 'Workflow',
  },
];
