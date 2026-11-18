// v55.83-UD (Codex 12:00 P1 · Max's rule): employees see ONLY the permitted history window in EVERY accounting number; only the
// super admin sees all-time. The window is the org-wide setting 'accounting_visibility_window' (app_settings, set in Settings by the
// super admin — see /api/admin/visibility). Server side: a report route clamps its start date to the window's first day.
// Fails CLOSED: if the setting cannot be read, a non-super-admin gets an error, never all history.
// SWC-safe: var + string concatenation.
import { floorDateFor, isValidWindowKey } from './visibility-window';

var SETTING_KEY = 'accounting_visibility_window';
function realDate(x) { var t = String(x || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) { return false; } var d = new Date(t + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().substring(0, 10) === t; }

async function readWindowSetting(db) {
  var res = await db.from('app_settings').select('*').or('key.eq.' + SETTING_KEY + ',setting_key.eq.' + SETTING_KEY).limit(1);
  if (res && res.error) { res = await db.from('app_settings').select('*').eq('key', SETTING_KEY).limit(1); }
  if (res && res.error) {
    return { error: res.error.message }; // a missing / unreadable table is never taken as "all history" (fails closed)
  }
  var row = (res && res.data && res.data.length) ? res.data[0] : null;
  if (!row) { return { value: null }; } // the table is there and the super admin never set a window = no limit (as /api/admin/visibility shows)
  if (row.value && typeof row.value === 'object') { return { value: row.value }; }
  if (row.setting_value) { try { return { value: JSON.parse(row.setting_value) }; } catch (eP) { return { error: 'the history window setting is not readable' }; } }
  return { error: 'the history window setting is empty' };
}

// ctx = the permission context from assertPermission (…ctx.isSuperAdmin). → { floor: 'YYYY-MM-DD' | null } or { error }
export async function windowFloorFor(db, ctx) {
  if (ctx && ctx.isSuperAdmin === true) { return { floor: null }; }
  var s = await readWindowSetting(db);
  if (s.error) { return { error: 'Could not read the history window (' + s.error + ') — nothing shown.' }; }
  var v = s.value || {};
  if (s.value && !isValidWindowKey(v.window)) { return { error: 'Could not read the history window (unknown setting) — nothing shown.' }; } // malformed = fail closed
  // 'custom' must be complete: a real calendar date (customFrom), or else a whole number of days from 1 to 3650 (customDays)
  if (s.value && v.window === 'custom') {
    if (v.customFrom !== null && v.customFrom !== undefined && v.customFrom !== '') {
      if (!realDate(v.customFrom)) { return { error: 'Could not read the history window (custom start date is not a real date) — nothing shown.' }; }
    } else {
      var cd = v.customDays; var cdn = typeof cd === 'number' ? cd : (typeof cd === 'string' && /^\d+$/.test(cd.trim()) ? Number(cd.trim()) : NaN);
      if (!(cdn >= 1 && cdn <= 3650 && Math.floor(cdn) === cdn)) { return { error: 'Could not read the history window (custom number of days is missing or wrong) — nothing shown.' }; }
    }
  }
  return { floor: floorDateFor({ isSuperAdmin: false, window: v.window, customDays: v.customDays, customFrom: v.customFrom }) };
}

// the start date a report may use: never before the window's first day
export function clampFrom(dateFrom, floor) {
  if (!floor) { return dateFrom || null; }
  if (!dateFrom || String(dateFrom).substring(0, 10) < floor) { return floor; }
  return dateFrom;
}
