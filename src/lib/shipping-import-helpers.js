// src/lib/shipping-import-helpers.js
// =====================================
// Shared helpers used by ShippingRatesTab's import flow.
//
// PURPOSE:
//   processImportFile() and reparseFromMapping() were duplicating these
//   functions inline, which led to bugs being fixed in one path but not
//   the other. v55.80 BD-AUDIT FIX consolidates them here so:
//   - one parseDate() handles every date format we've seen
//   - historical dates (in the past) round-trip cleanly
//   - timezone slide is impossible (we never use ISO-from-Date for
//     calendar-day output)
//
// EXPORTS:
//   parseNumberSmart(raw) → Number | NaN
//     "$2,500.00" / "USD 2500" / "2.500,00" (EU) / 2500 → 2500
//   parseDate(row, col) → "YYYY-MM-DD" | null
//     Handles Excel serial, ISO, MM/DD/YYYY, DD-MMM-YYYY, Date objects.
//     NEVER returns "today" — caller decides the fallback.
//   normalizeContainer(v) → "20' GP" / "40' HC" / "40' GP" / etc.

// ----- NUMERIC PARSER -----
export function parseNumberSmart(raw) {
  if (raw == null || raw === '') return NaN;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim();
  if (!s) return NaN;
  let clean = s.replace(/[^0-9.,\-]/g, '');
  if (!clean) return NaN;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1 && lastComma > lastDot) {
    // EU: . = thousands, , = decimal
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1 && lastDot === -1) {
    const commaCount = (clean.match(/,/g) || []).length;
    const afterComma = clean.length - lastComma - 1;
    if (commaCount > 1 || afterComma >= 3) clean = clean.replace(/,/g, '');
    else clean = clean.replace(',', '.');
  } else {
    clean = clean.replace(/,/g, '');
  }
  const n = Number(clean);
  return isNaN(n) ? NaN : n;
}

// ----- DATE PARSER (the heart of the historical-import fix) -----
// Returns "YYYY-MM-DD" string OR null if the cell can't be parsed.
// Caller must decide whether to fall back to today() or skip the row.
//
// IMPORTANT: this function NEVER assumes today's date. It also never
// uses .toISOString() on a Date constructed from a string, because
// that path is timezone-poisoned. We always extract the calendar
// components (year/month/day) explicitly.
export function parseDate(row, col) {
  const raw = col ? row[col] : null;
  if (raw == null || raw === '') return null;

  // 1. Native Date object
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return _fmtCal(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }

  // 2. Excel serial (days since 1899-12-30 — but we treat it as UTC days
  //    so the calendar date doesn't slide based on the runner's TZ).
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    return _fromExcelSerial(raw);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // 3. Numeric string that's actually an Excel serial
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    return _fromExcelSerial(Number(s));
  }

  // 4. ISO format YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return _fmtCal(y, m, d);
  }

  // 5. MM/DD/YYYY or DD/MM/YYYY (US default; switches to DD/MM if first part > 12)
  const slashMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slashMatch) {
    let a = Number(slashMatch[1]);
    let b = Number(slashMatch[2]);
    let y = Number(slashMatch[3]);
    if (y < 100) y += 2000;
    let m, d;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else { m = a; d = b; }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return _fmtCal(y, m, d);
  }

  // 6. DD-MMM-YYYY (5-Oct-2024)
  const monMatch = s.match(/^(\d{1,2})[-\s]+([A-Za-z]{3,})[-\s,]+(\d{2,4})/);
  if (monMatch) {
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
    const monKey = monMatch[2].toLowerCase().substring(0, 4);
    let mon = months[monKey] || months[monKey.substring(0, 3)];
    if (mon) {
      const d = Number(monMatch[1]);
      let y = Number(monMatch[3]);
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31) return _fmtCal(y, mon, d);
    }
  }

  // 7. MMMM DD, YYYY (October 5, 2024)
  const longMonMatch = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})/);
  if (longMonMatch) {
    const months2 = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
    const monKey2 = longMonMatch[1].toLowerCase().substring(0, 4);
    let mon2 = months2[monKey2] || months2[monKey2.substring(0, 3)];
    if (mon2) {
      const d2 = Number(longMonMatch[2]);
      let y2 = Number(longMonMatch[3]);
      if (y2 < 100) y2 += 2000;
      if (d2 >= 1 && d2 <= 31) return _fmtCal(y2, mon2, d2);
    }
  }

  // 8. Last-resort fallback — but use UTC components to avoid TZ slide.
  const lastTry = new Date(s);
  if (!isNaN(lastTry.getTime())) {
    return _fmtCal(lastTry.getUTCFullYear(), lastTry.getUTCMonth() + 1, lastTry.getUTCDate());
  }

  return null;
}

function _fmtCal(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function _fromExcelSerial(serial) {
  // Excel epoch: 1899-12-30. We add days as UTC ms then read UTC components.
  const ms = (serial - 25569) * 86400000;
  const dt = new Date(ms);
  return _fmtCal(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// ----- CONTAINER NORMALIZER -----
export function normalizeContainer(v) {
  if (!v) return '40ft';
  v = v.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  if ((v.includes('20') && v.includes('gp')) || v === '20' || v.includes('20ft') || v.includes('20st')) return "20' GP";
  if ((v.includes('40') && v.includes('hc')) || v.includes('40hc') || v.includes('40hq')) return "40' HC";
  if ((v.includes('40') && v.includes('gp')) || v === '40' || v.includes('40ft') || v.includes('40st')) return "40' GP";
  if (v.includes('45')) return "45' HC";
  if ((v.includes('20') && v.includes('rf')) || v.includes('20reefer')) return "20' RF";
  if ((v.includes('40') && v.includes('rf')) || v.includes('40reefer')) return "40' RF";
  return v.length > 0 ? v : '40ft';
}
