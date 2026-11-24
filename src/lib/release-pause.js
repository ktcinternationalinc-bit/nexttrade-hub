// v55.83-YQ — the STOP switch for warehouse releases (Max, 24 Nov 2026: "make the changes necessary to make change mgt better").
// One setting in app_settings. While it is ON:
//   · nobody can approve a new move or roll back (the approval route refuses; taking a request back is still allowed)
//   · the office worker is refused every request it tries to pick up, so nothing already approved starts
// It does NOT stop a move that is already running, and it changes nothing on the warehouse.
// Only the super admin switches it. If the setting cannot be read, it counts as ON (nothing starts) — fail closed.
// Server-safe: no imports. SWC-safe: var + concatenation.
export var RELEASE_PAUSE_KEY = 'warehouse_release_pause';
export var PAUSE_REASON_MIN = 5;

export async function readReleasePause(db) {
  var res;
  try { res = await db.from('app_settings').select('key, value').eq('key', RELEASE_PAUSE_KEY).limit(1); }
  catch (e) { return { paused: true, unreadable: true, error: 'The stop switch could not be read.' }; }
  if (!res || res.error) { return { paused: true, unreadable: true, error: 'The stop switch could not be read.' }; }
  var row = res.data && res.data.length ? res.data[0] : null;
  var v = row && row.value && typeof row.value === 'object' ? row.value : null;
  if (!v) { return { paused: false, unreadable: false, by_name: null, at: null, reason: null }; }
  return { paused: v.paused === true, unreadable: false, by_name: v.by_name || null, at: v.at || null, reason: v.reason || null };
}

export function pauseReason(text) {
  var t = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  if (t.length < PAUSE_REASON_MIN) { return { ok: false, error: 'Say in a few words why (at least ' + PAUSE_REASON_MIN + ' characters). It is kept with your name.' }; }
  return { ok: true, reason: t.substring(0, 300) };
}

export async function writeReleasePause(db, value, by) {
  var now = new Date().toISOString();
  var full = { key: RELEASE_PAUSE_KEY, value: value, setting_key: RELEASE_PAUSE_KEY, setting_value: JSON.stringify(value), updated_by: by || null, updated_at: now };
  var up = await db.from('app_settings').upsert(full, { onConflict: 'key' }).select('key');
  if (up && up.error && /setting_key|setting_value|column/.test(up.error.message || '')) { up = await db.from('app_settings').upsert({ key: RELEASE_PAUSE_KEY, value: value, updated_by: by || null, updated_at: now }, { onConflict: 'key' }).select('key'); }
  return up && up.error ? { error: up.error.message } : { ok: true };
}

export function pauseSentence(p) {
  if (!p || !p.paused) { return ''; }
  if (p.unreadable) { return 'Warehouse releases are stopped: the stop switch could not be read, so nothing may start.'; }
  return 'Warehouse releases are STOPPED' + (p.by_name ? ' by ' + p.by_name : '') + (p.reason ? ' — “' + p.reason + '”' : '') + '. Nothing new can be approved or started until the super admin switches them back on.';
}
