// v55.83-VZ (Max, 20 Nov 2026: "Proforma invoices need to be linked to invoices and that we need to upload a signed proforma
// that is saved and archived with them.") — the shared rules for proforma ↔ invoice links and signed proforma files.
// Plain module (no 'use client'): used by the server route /api/accounting/proforma-links AND by the screen.
// Pure functions only: no database, no React. var + string concatenation.

export var SIGNED_BUCKET = 'proforma-signed';
export var SIGNED_MAX_BYTES = 15728640; // 15 MB — the same limit the store itself enforces
export var SIGNED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export var SIGNED_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
export var PROFORMA_LINKS_SQL_MISSING = 'Linking proformas and saving signed copies needs one database update first: sql/v55-83-VZ-proforma-links-signed.sql (Supabase → SQL Editor). Nothing was changed.';

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(x) { return UUID.test(String(x || '')); }

// the real kind of a file, read from its first bytes — never from the name or from what the browser says it is
export function sniffSignedFile(bytes) {
  var b = bytes || [];
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) { return 'application/pdf'; }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { return 'image/jpeg'; }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) { return 'image/png'; }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) { return 'image/webp'; }
  return null;
}

// a file name that is safe inside a storage path: letters, digits, dot, dash, underscore; never empty; at most 80 characters
export function safeFileName(name) {
  var n = String(name || '').replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+/, '');
  if (n.length > 80) { var dot = n.lastIndexOf('.'); var ext = dot > 0 && n.length - dot <= 6 ? n.substring(dot) : ''; n = n.substring(0, 80 - ext.length) + ext; }
  return n || 'signed-proforma';
}

// the only shape a signed-proforma storage path may have: pf/<proforma id>/<milliseconds>-<16 hex>-<safe name>
export function signedPathFor(proformaId, nowMs, randomHex, fileName) {
  return 'pf/' + String(proformaId).toLowerCase() + '/' + String(nowMs) + '-' + String(randomHex) + '-' + safeFileName(fileName);
}
export function isSignedPathOf(path, proformaId) {
  var p = String(path || ''); var head = 'pf/' + String(proformaId || '').toLowerCase() + '/';
  if (!isUuid(proformaId) || p.indexOf(head) !== 0) { return false; }
  return /^[0-9]{10,16}-[0-9a-f]{16}-[A-Za-z0-9._-]{1,80}$/.test(p.substring(head.length));
}

// what the browser may check BEFORE sending (a courtesy: the server checks the real bytes again). → '' when fine, else the reason
export function signedFileProblem(file) {
  var f = file || {};
  if (!(Number(f.size) > 0)) { return 'That file is empty.'; }
  if (Number(f.size) > SIGNED_MAX_BYTES) { return 'That file is ' + sizeWords(f.size) + ' — the limit is 15 MB. Scan it at a lower quality or as a PDF.'; }
  if (f.type && SIGNED_TYPES.indexOf(String(f.type).toLowerCase()) < 0) { return 'A signed proforma must be a PDF or a picture (JPG, PNG or WEBP).'; }
  return '';
}

export function sizeWords(n) {
  var v = Number(n) || 0;
  if (v >= 1048576) { return (Math.round(v / 104857.6) / 10) + ' MB'; }
  if (v >= 1024) { return Math.round(v / 1024) + ' KB'; }
  return v + ' bytes';
}

// the next version number for a proforma, from the versions it already has (1 when none)
export function nextVersion(versions) {
  var m = 0; (versions || []).forEach(function (v) { var x = Number(v && v.version !== undefined ? v.version : v); if (x > m) { m = x; } });
  return m + 1;
}

// the history window: is this document's own date on or after the first day the person may see? (no floor = everything)
export function insideWindow(dateText, floor) {
  if (!floor) { return true; }
  var d = String(dateText || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { return false; }
  return d >= floor;
}

// may these two be linked? → { ok: true } or { ok: false, code, msg }. confirmOtherCustomer: the person said yes to a different customer
export function linkProblem(proforma, invoice, confirmOtherCustomer) {
  var p = proforma || {}; var i = invoice || {};
  if (p.record_status === 'deleted' || i.record_status === 'deleted') { return { ok: false, code: 'deleted', msg: 'One of the two was deleted — it cannot be linked.' }; }
  if (p.business_id && i.business_id && String(p.business_id) !== String(i.business_id)) { return { ok: false, code: 'other_business', msg: 'The proforma and the invoice belong to different businesses — they cannot be linked.' }; }
  if (p.wave_business_id && i.wave_business_id && String(p.wave_business_id) !== String(i.wave_business_id)) { return { ok: false, code: 'other_business', msg: 'The proforma and the invoice belong to different Wave businesses — they cannot be linked.' }; }
  if (p.accounting_customer_id && i.accounting_customer_id && String(p.accounting_customer_id) !== String(i.accounting_customer_id) && confirmOtherCustomer !== true) {
    return { ok: false, code: 'other_customer', msg: 'The proforma and the invoice are for different customers. Link them anyway?' };
  }
  return { ok: true };
}
