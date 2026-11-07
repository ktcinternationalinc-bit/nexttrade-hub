// /api/admin/visibility — v55.83-JE. ADMIN HISTORY-VISIBILITY WINDOW.
// GET  -> returns the current org-wide visibility window (any authenticated caller may read it).
// POST -> sets it (SUPER-ADMIN only). Stored in app_settings under 'accounting_visibility_window'.
// Service-role (bypasses RLS); degrades gracefully to {window:'all'} if the app_settings table has
// not been created yet (tells the admin to run sql/v55-83-JE-visibility-window.sql).
// SWC-safe: var + string concat, no template literals/arrows/optional-chaining.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidWindowKey } from '../../../../lib/visibility-window';

var API_BUILD_MARKER = 'v55.83-JE-visibility';
var SETTING_KEY = 'accounting_visibility_window';
var DEFAULT_VALUE = { window: 'all', customDays: null, customFrom: null };

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function readSetting(db) {
  // v55.83-JW (Codex) — read robustly across BOTH app_settings shapes: the new key/value(jsonb) AND
  // the legacy setting_key/setting_value(text). Match the row by key OR setting_key, and take the value
  // from `value` jsonb, falling back to a parsed `setting_value` text — so a live legacy-only row still
  // shows the right window after refresh/readback. Select '*' so missing columns don't error the query.
  var res = await db.from('app_settings').select('*').or('key.eq.' + SETTING_KEY + ',setting_key.eq.' + SETTING_KEY).limit(1);
  if (res && res.error) {
    // Fallback for DBs without the legacy setting_key column (the .or would reference a missing column).
    res = await db.from('app_settings').select('*').eq('key', SETTING_KEY).limit(1);
    if (res && res.error) { return { ok: false, error: res.error.message, value: DEFAULT_VALUE, table_missing: true }; }
  }
  var row = (res && res.data && res.data.length) ? res.data[0] : null;
  var val = null;
  if (row) {
    if (row.value && typeof row.value === 'object') { val = row.value; }
    else if (row.setting_value) { try { val = JSON.parse(row.setting_value); } catch (eP) { val = null; } }
  }
  return { ok: true, value: val || DEFAULT_VALUE, updated_at: row ? row.updated_at : null };
}

export async function GET() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { return NextResponse.json({ ok: true, value: DEFAULT_VALUE, note: 'server key missing — defaulting to all history', api_build_marker: API_BUILD_MARKER }); }
  var db = admin();
  var r = await readSetting(db);
  // A missing table is not an error to the caller — it just means "no restriction set yet".
  return NextResponse.json({ ok: true, value: r.value, updated_at: r.updated_at || null, table_missing: r.table_missing === true, api_build_marker: API_BUILD_MARKER });
}

export async function POST(req) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;

    // Super-admin only (real role check, not a client flag).
    var isSuper = false;
    if (by) {
      var uRes = await db.from('users').select('role').eq('id', by);
      var urow = (uRes && uRes.data && uRes.data.length) ? uRes.data[0] : null;
      if (urow && urow.role === 'super_admin') { isSuper = true; }
    }
    if (!isSuper) { return NextResponse.json({ ok: false, error: 'Only a super admin can change the history-visibility window.', api_build_marker: API_BUILD_MARKER }, { status: 403 }); }

    var win = String(body.window || '').trim();
    if (!isValidWindowKey(win)) { return NextResponse.json({ ok: false, error: 'Invalid window "' + win + '".', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var customDays = null;
    var customFrom = null;
    if (win === 'custom') {
      if (body.customFrom) { customFrom = String(body.customFrom).substring(0, 10); }
      else { var cd = parseInt(body.customDays, 10); if (!(cd > 0)) { return NextResponse.json({ ok: false, error: 'Custom window needs a positive number of days or a from-date.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); } customDays = cd; }
    }
    var value = { window: win, customDays: customDays, customFrom: customFrom };

    // v55.83-JV — older app_settings rows use setting_key/setting_value (often NOT NULL). Write BOTH
    // the new (key/value jsonb) AND the legacy (setting_key/setting_value text) shapes so the insert
    // satisfies a NOT-NULL setting_key constraint. If the legacy columns don't exist on this DB, retry
    // with the new shape only.
    var fullRow = { key: SETTING_KEY, value: value, setting_key: SETTING_KEY, setting_value: JSON.stringify(value), updated_by: by, updated_at: new Date().toISOString() };
    var up = await db.from('app_settings').upsert(fullRow, { onConflict: 'key' }).select();
    if (up && up.error && /setting_key|setting_value|column/.test(up.error.message || '')) {
      up = await db.from('app_settings').upsert({ key: SETTING_KEY, value: value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select();
    }
    if (up && up.error) {
      var msg = up.error.message || '';
      if (/relation .*app_settings.* does not exist|could not find the table|schema cache/i.test(msg)) {
        return NextResponse.json({ ok: false, error: 'The settings table is not set up yet. Run sql/v55-83-JE-visibility-window.sql, then try again. (' + msg + ')', api_build_marker: API_BUILD_MARKER }, { status: 400 });
      }
      if (/null value in column "setting_key"|not-null constraint/i.test(msg)) {
        return NextResponse.json({ ok: false, error: 'Your app_settings table requires setting_key. This build now writes it; if you still see this, re-run sql/v55-83-JE-visibility-window.sql (it backfills setting_key) and retry. (' + msg + ')', api_build_marker: API_BUILD_MARKER }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: 'Could not save the window: ' + msg, api_build_marker: API_BUILD_MARKER }, { status: 400 });
    }
    if (!(up && up.data && up.data.length)) { return NextResponse.json({ ok: false, error: 'Saved nothing (0 rows). Refresh and retry.', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
    return NextResponse.json({ ok: true, value: value, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
