// Server-safe Wave business helpers. Keep browser-only state in wave-business.js.

// A silo whose wave_business_id is a seed placeholder, never bound to a real Wave business.
export var PLACEHOLDER_WAVE_BUSINESS_IDS = { 'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1 };

export function isPlaceholderWaveBusiness(id) {
  return !!(id && PLACEHOLDER_WAVE_BUSINESS_IDS[String(id)]);
}
