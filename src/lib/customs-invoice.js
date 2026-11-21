// v55.83-XD (Max, 21 Nov 2026: "an abiltiy to create a custom invoice that has no bearing on amount due or tax implications or is
// even part of any data ... just saved under te original invoice like a proforma invoice") — the shared rules of a customs invoice.
// Plain module (no 'use client'): used by the server route /api/accounting/customs-invoices AND by the screen (CustomsInvoiceBox).
// Pure functions only: no database, no React. var + string concatenation.
// A customs invoice lives in its OWN tables (sql/v55-83-XD-customs-invoices.sql). No report, balance, Wave push, reminder, invoice
// number, duplicate check or payment match reads those tables, so nothing here can change any Hub number.
// Max 21 Nov: the printed number is the original invoice number, and it can be changed by hand ("original number with abiltiy to
// manually change it").

export var CUSTOMS_SQL_MISSING = 'Customs invoices need one database update first: sql/v55-83-XD-customs-invoices.sql (Supabase → SQL Editor). Nothing was changed.';
export var CUSTOMS_TITLES = ['CUSTOMS INVOICE', 'COMMERCIAL INVOICE'];
export var CUSTOMS_MAX_LINES = 200;
export var CUSTOMS_DEFAULT_DECLARATION = 'We certify that the information on this invoice is true and correct and that the contents of this shipment are as stated above.';

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(x) { return UUID.test(String(x || '')); }

// the short text fields and how long each may be
var SHORT = { printed_number: 60, doc_date: 10, currency: 8, country_of_origin: 80, country_of_destination: 80, incoterms: 40, reference: 200,
  packages: 80, gross_weight: 40, net_weight: 40, weight_unit: 8, signer_name: 120, signer_title: 120 };
var LONG = { exporter: 1000, consignee: 1000, ship_to: 1000, notes: 2000, declaration: 1000 };
var MONEY_FIELDS = ['freight', 'insurance', 'other_charges'];

function txt(v, max) { var s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim(); return s.length > max ? s.substring(0, max) : s; }
export function roundMoney(n) { var x = Number(n) || 0; return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
function num(v) {
  if (v === '' || v === null || v === undefined) { return { ok: true, v: 0 }; }
  var s = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!isFinite(s)) { return { ok: false }; }
  return { ok: true, v: s };
}

export function lineAmount(line) { var q = num(line && line.quantity); var p = num(line && line.unit_price); return roundMoney((q.ok ? q.v : 0) * (p.ok ? p.v : 0)); }
export function linesTotal(lines) { var t = 0; (lines || []).forEach(function (l) { t += lineAmount(l); }); return roundMoney(t); }
export function docTotal(doc) {
  var d = doc || {}; var t = linesTotal(d.lines);
  MONEY_FIELDS.forEach(function (k) { var n = num(d[k]); if (n.ok) { t += n.v; } });
  return roundMoney(t);
}
function realDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { return false; } var d = new Date(s + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().substring(0, 10) === s; }

// the one check every saved customs invoice goes through (the server runs it again; the browser total is never trusted)
// → { ok: true, doc, total, currency } or { ok: false, error }
export function cleanDoc(input) {
  var d = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!d) { return { ok: false, error: 'The customs invoice is empty.' }; }
  var out = {};
  var title = String(d.title || '').trim().toUpperCase();
  out.title = CUSTOMS_TITLES.indexOf(title) >= 0 ? title : CUSTOMS_TITLES[0];
  Object.keys(SHORT).forEach(function (k) { out[k] = txt(d[k], SHORT[k]).replace(/\n/g, ' '); });
  Object.keys(LONG).forEach(function (k) { out[k] = txt(d[k], LONG[k]); });
  if (!out.printed_number) { return { ok: false, error: 'Type the invoice number to print.' }; }
  if (out.doc_date && !realDate(out.doc_date)) { return { ok: false, error: 'The date is not a real date.' }; }
  out.currency = (out.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(out.currency)) { return { ok: false, error: 'The currency must be a 3-letter code (USD, EUR, EGP …).' }; }
  for (var m = 0; m < MONEY_FIELDS.length; m++) {
    var mv = num(d[MONEY_FIELDS[m]]);
    if (!mv.ok || mv.v < 0 || mv.v > 1e10) { return { ok: false, error: 'The ' + MONEY_FIELDS[m].replace('_', ' ') + ' must be a number of 0 or more.' }; }
    out[MONEY_FIELDS[m]] = roundMoney(mv.v);
  }
  var rawLines = Array.isArray(d.lines) ? d.lines : [];
  var lines = [];
  for (var i = 0; i < rawLines.length; i++) {
    var l = rawLines[i] || {};
    var desc = txt(l.description, 500); var hs = txt(l.hs_code, 40).replace(/\n/g, ' '); var org = txt(l.origin, 80).replace(/\n/g, ' '); var unit = txt(l.unit, 20).replace(/\n/g, ' ');
    var q = num(l.quantity); var p = num(l.unit_price);
    var blank = !desc && !hs && (!q.ok || q.v === 0) && (!p.ok || p.v === 0);
    if (blank) { continue; }
    if (!desc) { return { ok: false, error: 'Line ' + (i + 1) + ' has no description.' }; }
    if (!q.ok || q.v < 0 || q.v > 1e9) { return { ok: false, error: 'Line ' + (i + 1) + ': the quantity must be a number of 0 or more.' }; }
    if (!p.ok || p.v < 0 || p.v > 1e10) { return { ok: false, error: 'Line ' + (i + 1) + ': the unit price must be a number of 0 or more.' }; }
    var line = { description: desc, hs_code: hs, origin: org, quantity: q.v, unit: unit, unit_price: p.v };
    line.amount = lineAmount(line);
    lines.push(line);
  }
  if (!lines.length) { return { ok: false, error: 'Add at least one line.' }; }
  if (lines.length > CUSTOMS_MAX_LINES) { return { ok: false, error: 'At most ' + CUSTOMS_MAX_LINES + ' lines.' }; }
  out.lines = lines;
  var total = docTotal(out);
  if (total > 1e11) { return { ok: false, error: 'The total is too large.' }; }
  out.total = total;
  return { ok: true, doc: out, total: total, currency: out.currency };
}

// the history window (Max's rule): the customs paper is seen only if the invoice's date — as saved when it was made, AND the
// invoice's date today while the invoice still exists — is inside the person's window. No floor = everything (super admin).
export function insideWindow(dateText, floor) {
  if (!floor) { return true; }
  var d = String(dateText || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { return false; }
  return d >= floor;
}
export function customsVisible(identity, currentInvoice, floor) {
  if (!floor) { return true; }
  if (!insideWindow(identity && identity.invoice_date_at_creation, floor)) { return false; }
  if (currentInvoice && !insideWindow(currentInvoice.invoice_date, floor)) { return false; }
  return true;
}

// the label in the list: "Customs #1" (a list label only — never an invoice number)
export function customsLabel(seq) { return 'Customs #' + (Number(seq) || 1); }

// a database step's refusal → { status, code, msg } a person can act on
export function stepError(err) {
  var m = String((err && err.message) || err || '');
  if (/HUB_STALE/.test(m)) { return { status: 409, code: 'stale', msg: m.replace(/^.*HUB_STALE:\s*/, '') }; }
  if (/HUB_VOIDED/.test(m)) { return { status: 409, code: 'voided', msg: m.replace(/^.*HUB_VOIDED:\s*/, '') }; }
  if (/HUB_NOT_FOUND/.test(m)) { return { status: 404, code: 'not_found', msg: m.replace(/^.*HUB_NOT_FOUND:\s*/, '') }; }
  if (/HUB_INPUT/.test(m)) { return { status: 400, code: 'input', msg: m.replace(/^.*HUB_INPUT:\s*/, '') }; }
  if (/uq_customs_inv_seq|uq_customs_inv_version|duplicate key/i.test(m) || (err && err.code === '23505')) { return { status: 409, code: 'stale', msg: 'Someone saved this customs invoice a moment ago. Reload to see it, then make your change again.' }; }
  if (/hub_customs_invoice_|accounting_customs_invoice/.test(m) && /does not exist|Could not find|schema cache/i.test(m)) { return { status: 409, code: 'not_installed', msg: CUSTOMS_SQL_MISSING }; }
  return { status: 500, code: 'error', msg: 'Not saved (' + m + '). Nothing was changed.' };
}

// a starting point made from the customer invoice (every field stays editable; nothing is saved until the person presses Save)
export function prefillDoc(invoice, items, company, customer) {
  var inv = invoice || {}; var c = company || {}; var cu = customer || {};
  var exporter = [c.company_name, c.address, c.phone, c.email, c.tax_id ? 'Tax ID: ' + c.tax_id : ''].filter(Boolean).join('\n');
  var consignee = [cu.company_name, cu.contact_name, cu.billing_address, [cu.email, cu.phone].filter(Boolean).join('  ')].filter(Boolean).join('\n');
  var lines = (items || []).map(function (it) {
    return { description: String(it.description || ''), hs_code: '', origin: '', quantity: Number(it.quantity) || 0, unit: '', unit_price: Number(it.unit_price) || 0 };
  });
  if (!lines.length) { lines = [{ description: '', hs_code: '', origin: '', quantity: 1, unit: '', unit_price: 0 }]; }
  return {
    title: CUSTOMS_TITLES[0], printed_number: String(inv.invoice_number || ''), doc_date: String(inv.invoice_date || '').substring(0, 10),
    currency: String(inv.currency || 'USD').toUpperCase(), exporter: exporter, consignee: consignee, ship_to: '',
    country_of_origin: '', country_of_destination: '', incoterms: '', reference: inv.release_number ? 'Release ' + inv.release_number : '',
    packages: '', gross_weight: '', net_weight: '', weight_unit: 'kg', lines: lines, freight: 0, insurance: 0, other_charges: 0,
    notes: '', declaration: CUSTOMS_DEFAULT_DECLARATION, signer_name: '', signer_title: ''
  };
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function money(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function nl(s) { return esc(s).replace(/\n/g, '<br>'); }

// the printable page of ONE saved version (what the PDF shows). Never shows amount paid / balance due — it is not a demand for payment
// in the Hub's books. logoDataUrl: the company logo (data: URL only).
export function customsPrintHtml(doc, meta) {
  var d = doc || {}; var m = meta || {};
  var logo = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(String(m.logoDataUrl || '')) ? '<img src="' + m.logoDataUrl + '" style="max-height:70px;max-width:200px;margin-bottom:6px"/>' : '';
  var cur = esc(d.currency || 'USD');
  var rows = (d.lines || []).map(function (l) {
    return '<tr><td>' + nl(l.description) + '</td><td>' + esc(l.hs_code) + '</td><td>' + esc(l.origin) + '</td><td class="r">' + esc(l.quantity) + (l.unit ? ' ' + esc(l.unit) : '') + '</td><td class="r">' + money(l.unit_price) + '</td><td class="r">' + money(l.amount != null ? l.amount : lineAmount(l)) + '</td></tr>';
  }).join('');
  var sub = linesTotal(d.lines);
  var extras = '';
  if (Number(d.freight)) { extras += '<tr><td colspan="5" class="r">Freight</td><td class="r">' + money(d.freight) + '</td></tr>'; }
  if (Number(d.insurance)) { extras += '<tr><td colspan="5" class="r">Insurance</td><td class="r">' + money(d.insurance) + '</td></tr>'; }
  if (Number(d.other_charges)) { extras += '<tr><td colspan="5" class="r">Other charges</td><td class="r">' + money(d.other_charges) + '</td></tr>'; }
  var facts = [['Country of origin', d.country_of_origin], ['Country of destination', d.country_of_destination], ['Incoterms', d.incoterms], ['Reference', d.reference],
    ['Packages', d.packages], ['Gross weight', d.gross_weight ? d.gross_weight + ' ' + (d.weight_unit || '') : ''], ['Net weight', d.net_weight ? d.net_weight + ' ' + (d.weight_unit || '') : ''], ['Currency', d.currency]]
    .filter(function (f) { return String(f[1] || '').trim(); })
    .map(function (f) { return '<div><b>' + esc(f[0]) + ':</b> ' + esc(f[1]) + '</div>'; }).join('');
  return '<html><head><meta charset="utf-8"><title>' + esc(d.title || 'CUSTOMS INVOICE') + ' ' + esc(d.printed_number) + '</title><style>'
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:820px;margin:auto}'
    + 'h1{font-size:22px;margin:0}.muted{color:#555}.r{text-align:right}'
    + 'table{width:100%;border-collapse:collapse;margin-top:18px}'
    + 'th,td{border-bottom:1px solid #ddd;padding:7px;font-size:12px;vertical-align:top}th{background:#f4f4f4;text-align:left}'
    + '.tot{font-size:14px;font-weight:bold}.head{display:flex;justify-content:space-between;align-items:flex-start}'
    + '.box{font-size:12px;line-height:1.5}.cols{display:flex;gap:24px;margin-top:18px}.cols>div{flex:1}'
    + '.facts{margin-top:14px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:2px 24px}'
    + '.terms{margin-top:14px;font-size:12px;color:#333;white-space:pre-wrap}.sig{margin-top:44px;width:50%}.sigline{border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:12px;color:#555}'
    + '</style></head><body>'
    + '<div class="head"><div>' + logo + '<div class="box"><b>Exporter / Shipper:</b><br>' + nl(d.exporter) + '</div></div>'
    + '<div class="r"><h1>' + esc(d.title || 'CUSTOMS INVOICE') + '</h1><div class="muted">Invoice # ' + esc(d.printed_number) + '</div>'
    + '<div class="muted box" style="margin-top:6px">Date: ' + esc(d.doc_date || '') + '</div></div></div>'
    + '<div class="cols"><div class="box"><b>Consignee:</b><br>' + nl(d.consignee) + '</div>' + (d.ship_to ? '<div class="box"><b>Ship to:</b><br>' + nl(d.ship_to) + '</div>' : '') + '</div>'
    + (facts ? '<div class="facts">' + facts + '</div>' : '')
    + '<table><thead><tr><th>Description of goods</th><th>HS code</th><th>Origin</th><th class="r">Quantity</th><th class="r">Unit price (' + cur + ')</th><th class="r">Amount (' + cur + ')</th></tr></thead>'
    + '<tbody>' + rows + '</tbody><tfoot>'
    + (extras ? '<tr><td colspan="5" class="r">Subtotal</td><td class="r">' + money(sub) + '</td></tr>' + extras : '')
    + '<tr><td colspan="5" class="r tot">Total (' + cur + ')</td><td class="r tot">' + money(docTotal(d)) + '</td></tr></tfoot></table>'
    + (d.notes ? '<div class="terms"><b>Notes:</b>\n' + esc(d.notes) + '</div>' : '')
    + (d.declaration ? '<div class="terms">' + esc(d.declaration) + '</div>' : '')
    + '<div class="sig"><div class="sigline">' + esc(d.signer_name || 'Authorized signature') + (d.signer_title ? ', ' + esc(d.signer_title) : '') + '</div></div>'
    + '<script>window.onload=function(){window.print();}<\/script></body></html>';
}
