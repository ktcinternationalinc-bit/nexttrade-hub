// Server-safe Wave business helpers. Keep browser-only state in wave-business.js.

// A silo whose wave_business_id is a seed placeholder, never bound to a real Wave business.
// v55.83-TW — Nextrade and RTM are companies with NO Wave business: every Wave push / pull refuses them like a placeholder.
export var PLACEHOLDER_WAVE_BUSINESS_IDS = { 'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1 };
PLACEHOLDER_WAVE_BUSINESS_IDS['NEXTRADE_BOOKS'] = 1; PLACEHOLDER_WAVE_BUSINESS_IDS['RTM_BOOKS'] = 1;
export var NO_WAVE_COMPANY_IDS = { 'NEXTRADE_BOOKS': 1, 'RTM_BOOKS': 1 };
export function isNoWaveCompany(id) { return !!(id && NO_WAVE_COMPANY_IDS[String(id)]); }

export function isPlaceholderWaveBusiness(id) {
  return !!(id && PLACEHOLDER_WAVE_BUSINESS_IDS[String(id)]);
}
