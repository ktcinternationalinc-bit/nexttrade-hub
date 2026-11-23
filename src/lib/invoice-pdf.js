// v55.83-XY — A COPY OF THE CUSTOMER INVOICE AS A PDF, made on the server (Max, 23 Nov 2026: "please attach a copy of the invoice").
// The Hub had no way to make a PDF on the server: the invoice "Print / Save PDF" page is built in the browser and the browser makes
// the file. This is a small PDF writer of its own (no package to install). It writes the SAME content as that print page
// (AccountingInvoicesTab printDoc): company, INVOICE number / date / due date, bill-to, the lines (description, quantity, unit price,
// line total), subtotal / discount when they differ from the total, total, amount paid, balance due, notes, terms.
// NEVER anything internal: it is given only the invoice, its lines, the customer and the company profile — no shipping cost, no
// margin, no "inside the shipping" breakdown, no SKU / product reference, and never the customs invoice.
// LIMITS (said plainly to Max): no company logo yet; plain Western letters only — if a text has letters the PDF's built-in font
// cannot show (Arabic, Chinese, …) NO PDF is made for that invoice and the reason is returned, rather than a file with wrong text.
// Plain module (no 'use client'). Pure: no database, no network. SWC-safe: var + string concatenation only.

// Helvetica widths (per 1000 units) for the printable ASCII letters; every other letter is taken as 556 (only used to wrap text and
// to right-align amounts, which are made of digits and . , $ - only — all exact here).
var W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
function widthOf(s, size) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += (c >= 32 && c <= 126) ? W[c - 32] : 556; } return n * size / 1000; }

// → { ok, text }. Common typographic characters are written in their plain form; anything else outside Western letters = not ok.
export function pdfText(v) {
  var s = String(v === null || v === undefined ? '' : v)
    .replace(/[‘’‚′]/g, '\'').replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
    .replace(/[    ]/g, ' ').replace(/→/g, '->').replace(/•/g, '-').replace(/€/g, 'EUR ').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c === 10) { continue; } if (c < 32 || (c > 126 && c < 161) || c > 255) { return { ok: false, text: s, bad: s.charAt(i) }; } }
  return { ok: true, text: s };
}
function esc(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function money(x) { var n = Math.round((Number(x) || 0) * 100) / 100; var t = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '-$' : '$') + t; }
function qty(x) { var n = Number(x); if (isNaN(n)) { return ''; } return (Math.round(n * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }); }
function wrap(s, maxW, size) {
  var out = [];
  String(s).split('\n').forEach(function (para) {
    var words = para.split(' '); var line = '';
    words.forEach(function (w0) {
      var w = w0;
      while (widthOf(w, size) > maxW && w.length > 1) { // one very long word: cut it
        var k = w.length; while (k > 1 && widthOf(w.substring(0, k), size) > maxW) { k--; }
        if (line) { out.push(line); line = ''; } out.push(w.substring(0, k)); w = w.substring(k);
      }
      var t = line ? line + ' ' + w : w;
      if (widthOf(t, size) > maxW && line) { out.push(line); line = w; } else { line = t; }
    });
    out.push(line);
  });
  return out;
}

// input: { invoice, items, customer, company, paid }  (paid = everything received on this invoice so far, a number)
// → { ok: true, bytes (Buffer), filename, pages }  |  { ok: false, reason }
export function buildInvoicePdf(input) {
  var inv = (input && input.invoice) || null; if (!inv) { return { ok: false, reason: 'the invoice was not found' }; }
  var items = (input.items || []).slice().sort(function (a, b) { return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0); });
  var cust = input.customer || {}; var co = input.company || {};
  var bad = null;
  function T(v) { var r = pdfText(v); if (!r.ok && !bad) { bad = r.bad; } return r.text; }
  var number = T(inv.invoice_number || '');
  var coName = T(co.company_name || 'KTC International Enterprises LLC');
  var coLines = [co.address, [co.phone, co.email].filter(Boolean).join('  |  '), co.website, co.tax_id ? 'Tax ID: ' + co.tax_id : ''].filter(Boolean).map(T);
  var billTo = [cust.company_name, cust.contact_name, cust.billing_address, cust.email, cust.phone].filter(Boolean).map(T);
  var rows = items.map(function (it) { return { d: T(it.description || ''), q: qty(it.quantity), u: money(it.unit_price), t: money(it.line_total !== null && it.line_total !== undefined ? it.line_total : (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)) }; });
  var lineSum = items.reduce(function (a, it) { return a + Math.round((it.line_total !== null && it.line_total !== undefined ? Number(it.line_total) || 0 : (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)) * 100); }, 0) / 100;
  var total = Math.round((Number(inv.total_amount) || 0) * 100) / 100; var paid = Math.round((Number(input.paid) || 0) * 100) / 100; var balance = Math.round((total - paid) * 100) / 100;
  var notes = T(inv.notes || co.default_invoice_notes || ''); var terms = T(inv.terms || co.default_payment_terms || '');
  var dateS = T(String(inv.invoice_date || '').substring(0, 10)); var dueS = T(String(inv.due_date || '').substring(0, 10));
  if (bad) { return { ok: false, reason: 'the invoice has a letter the PDF cannot show ("' + bad + '")' }; }
  if (!number) { return { ok: false, reason: 'the invoice has no number' }; }

  // ── layout: US Letter, 50 pt margins. Every page is a list of drawing commands. ──
  var PW = 612; var PH = 792; var L = 50; var R = 562; var pages = []; var cur = null; var y = 0;
  function txt(x, yy, size, bold, s) { if (s) { cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' Td (' + esc(s) + ') Tj ET'); } }
  function right(xr, yy, size, s) { txt(xr - widthOf(s, size), yy, size, false, s); }
  function rule(yy, w) { cur.push((w || 0.7) + ' w ' + L + ' ' + yy.toFixed(2) + ' m ' + R + ' ' + yy.toFixed(2) + ' l S'); }
  function tableHead() { txt(L, y, 9, true, 'Description'); txt(352, y, 9, true, 'Qty'); txt(418, y, 9, true, 'Unit price'); txt(510, y, 9, true, 'Line total'); y -= 5; rule(y, 1); y -= 13; }
  function newPage(first) {
    cur = []; pages.push(cur); y = PH - 60;
    if (first) {
      txt(L, y, 16, true, coName); txt(400, y, 20, true, 'INVOICE'); y -= 16;
      var yl = y; coLines.forEach(function (ln) { wrap(ln, 320, 9).forEach(function (w1) { txt(L, yl, 9, false, w1); yl -= 11; }); });
      var yr = y - 4; txt(400, yr, 10, true, 'No. ' + number); yr -= 13; if (dateS) { txt(400, yr, 9, false, 'Date: ' + dateS); yr -= 11; } if (dueS) { txt(400, yr, 9, false, 'Due: ' + dueS); yr -= 11; }
      y = Math.min(yl, yr) - 12; txt(L, y, 9, true, 'Bill to'); y -= 12;
      billTo.forEach(function (ln) { wrap(ln, 330, 10).forEach(function (w1) { txt(L, y, 10, false, w1); y -= 12; }); });
      y -= 12;
    } else { txt(L, y, 10, true, coName + '  -  Invoice ' + number + ' (continued)'); y -= 22; }
  }
  function need(h) { if (y - h < 70) { newPage(false); tableHead(); } }
  newPage(true); tableHead();
  if (!rows.length) { txt(L, y, 9, false, '(no lines on this invoice)'); y -= 13; }
  rows.forEach(function (r) {
    var dl = wrap(r.d || '-', 285, 9); need(dl.length * 11 + 4);
    right(372, y, 9, r.q); right(465, y, 9, r.u); right(R, y, 9, r.t);
    dl.forEach(function (w1) { txt(L, y, 9, false, w1); y -= 11; });
    y -= 4;
  });
  need(96); y -= 2; rule(y, 0.7); y -= 15;
  function totalRow(label, amount, bold) { txt(400, y, bold ? 11 : 10, bold, label); right(R, y, bold ? 11 : 10, amount); y -= bold ? 16 : 14; }
  if (Math.abs(lineSum - total) > 0.005) { totalRow('Subtotal', money(lineSum), false); totalRow('Discount / adjustment', money(total - lineSum), false); }
  totalRow('Total', money(total), true); totalRow('Amount paid', money(paid), false); totalRow('Balance due', money(balance), true);
  function block(title, body) {
    if (!body) { return; }
    var bl = wrap(body, R - L, 9); y -= 8; need(14 + Math.min(bl.length, 4) * 11); txt(L, y, 9, true, title); y -= 12;
    bl.forEach(function (w1) { if (y < 70) { newPage(false); } txt(L, y, 9, false, w1); y -= 11; });
  }
  block('Notes', notes); block('Terms', terms);
  pages.forEach(function (pg, i) { cur = pg; txt(L, 40, 8, false, coName + '  -  Invoice ' + number); right(R, 40, 8, 'Page ' + (i + 1) + ' of ' + pages.length); });

  // ── the file: catalog, page tree, two built-in fonts, then one page object + one content stream per page ──
  var objs = []; var n = pages.length; var kids = []; for (var i = 0; i < n; i++) { kids.push((5 + i * 2) + ' 0 R'); }
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  for (var p = 0; p < n; p++) {
    var body = pages[p].join('\n');
    objs[5 + p * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + p * 2) + ' 0 R >>';
    objs[6 + p * 2] = '<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream';
  }
  var out = '%PDF-1.4\n%âãÏÓ\n'; var offs = [];
  for (var k = 1; k < objs.length; k++) { offs[k] = out.length; out += k + ' 0 obj\n' + objs[k] + '\nendobj\n'; }
  var xref = out.length; var pad = function (v) { var t = String(v); while (t.length < 10) { t = '0' + t; } return t; };
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (var m = 1; m < objs.length; m++) { out += pad(offs[m]) + ' 00000 n \n'; }
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info << /Title (Invoice ' + esc(number) + ') /Producer (NextTrade Hub) >> >>\nstartxref\n' + xref + '\n%%EOF\n';
  // every character above is one byte (Latin-1), so the offsets written are the real byte positions
  return { ok: true, bytes: Buffer.from(out, 'latin1'), filename: 'Invoice-' + number.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60) + '.pdf', pages: n };
}
