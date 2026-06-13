'use client';
// v55.83-BZ — single source of truth for "which Wave business is active" and
// whether writing to it is allowed. Keeps real KTC (production) data walled off
// from a test Wave business. Used by any screen that shows or syncs Wave data.

var ACTIVE_KEY = 'ktc_active_wave_business';

export function getActiveWaveBusiness() {
  try { return (typeof window !== 'undefined' && window.localStorage.getItem(ACTIVE_KEY)) || ''; }
  catch (e) { return ''; }
}
export function setActiveWaveBusiness(id) {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(ACTIVE_KEY, id || ''); }
  catch (e) {}
}

// A registry row: { wave_business_id, label, is_production, writes_enabled }
// Writing (push/edit/delete to Wave) is allowed ONLY when the business is not
// production, OR production with writes explicitly enabled. Default = locked.
export function canWriteToWaveBusiness(reg) {
  if (!reg) { return false; }
  if (reg.is_production === false) { return true; }
  return reg.writes_enabled === true;
}

export function waveBusinessLabel(reg, id) {
  if (reg && reg.label) { return reg.label; }
  return id ? ('Business ' + String(id).slice(0, 8)) : 'Unknown business';
}

// Filter a list of Wave-linked records to one business. Untagged legacy rows
// (wave_business_id null) are treated as belonging to the given business only
// when includeLegacy is true (used before backfill completes).
export function scopeToBusiness(rows, businessId, includeLegacy) {
  if (!businessId || businessId === 'all') { return rows; }
  return (rows || []).filter(function (r) {
    if (r.wave_business_id === businessId) { return true; }
    if (includeLegacy && (r.wave_business_id == null || r.wave_business_id === '')) { return true; }
    return false;
  });
}
