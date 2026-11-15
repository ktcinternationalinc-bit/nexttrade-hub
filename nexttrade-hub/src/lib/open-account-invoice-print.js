// v55.83-A.6.27.59 — Print a single Open Account mini-invoice.
//
// Used from the Open Account Invoice modal (when an invoice exists). Opens
// a new window with a clean printable layout matching standard invoice
// expectations: entity header (issuer) on top-left, INVOICE big on top-right
// with number + date + due date, recipient block, line-item table, totals
// (subtotal / shipping / tax / TOTAL), then notes + terms at the bottom.
//
// Direction handling:
//   - direction='credit' (we billed them): entity = issuer, counterparty = recipient
//   - direction='debit'  (they billed us): counterparty = issuer, entity = recipient

function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return '0.00';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s).toISOString().substring(0, 10); } catch (e) { return s; }
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function printOpenAccountInvoice(invoice, items, entity) {
  if (!invoice) return;
  var win;
  try { win = window.open('', '_blank', 'width=900,height=700'); }
  catch (e) { alert('Could not open print window. Please allow popups for this site.'); return; }
  if (!win) { alert('Could not open print window. Please allow popups for this site.'); return; }

  var weBilledThem = invoice.direction === 'credit';

  function entityBlockHtml() {
    var lines = [];
    if (entity) {
      if (entity.entity_name) lines.push('<div class="party-name">' + escapeHtml(entity.entity_name) + '</div>');
      if (entity.entity_name_ar) lines.push('<div class="party-name-ar" dir="rtl">' + escapeHtml(entity.entity_name_ar) + '</div>');
      var addr = [];
      if (entity.address_line1) addr.push(escapeHtml(entity.address_line1));
      if (entity.address_line2) addr.push(escapeHtml(entity.address_line2));
      var cityLine = [entity.city, entity.region, entity.postal_code].filter(Boolean).join(', ');
      if (cityLine) addr.push(escapeHtml(cityLine));
      if (entity.country) addr.push(escapeHtml(entity.country));
      if (addr.length) lines.push('<div class="party-addr">' + addr.join('<br>') + '</div>');
      var contact = [];
      if (entity.phone) contact.push('Tel: ' + escapeHtml(entity.phone));
      if (entity.email) contact.push(escapeHtml(entity.email));
      if (contact.length) lines.push('<div class="party-contact">' + contact.join(' &middot; ') + '</div>');
      if (entity.tax_id) lines.push('<div class="party-tax">Tax ID: ' + escapeHtml(entity.tax_id) + '</div>');
    } else {
      lines.push('<em style="color:#666">No entity selected for this account</em>');
    }
    return lines.join('');
  }

  function counterpartyBlockHtml() {
    var lines = [];
    if (invoice.counterparty_name) lines.push('<div class="party-name">' + escapeHtml(invoice.counterparty_name) + '</div>');
    if (invoice.counterparty_name_ar) lines.push('<div class="party-name-ar" dir="rtl">' + escapeHtml(invoice.counterparty_name_ar) + '</div>');
    if (invoice.counterparty_address) lines.push('<div class="party-addr">' + escapeHtml(invoice.counterparty_address).replace(/\n/g, '<br>') + '</div>');
    var contact = [];
    if (invoice.counterparty_phone) contact.push('Tel: ' + escapeHtml(invoice.counterparty_phone));
    if (invoice.counterparty_email) contact.push(escapeHtml(invoice.counterparty_email));
    if (contact.length) lines.push('<div class="party-contact">' + contact.join(' &middot; ') + '</div>');
    return lines.join('');
  }

  var issuerHtml = weBilledThem ? entityBlockHtml() : counterpartyBlockHtml();
  var recipientHtml = weBilledThem ? counterpartyBlockHtml() : entityBlockHtml();

  var lineItemRows = '';
  (items || []).forEach(function (it) {
    var qty = Number(it.quantity || 0);
    var unitPrice = Number(it.unit_price || 0);
    var lineTotal = Number(it.line_total || (qty * unitPrice));
    lineItemRows += '<tr>'
      + '<td>' + escapeHtml(it.description || '') + '</td>'
      + '<td class="num">' + fmtMoney(qty) + '</td>'
      + '<td class="num">' + fmtMoney(unitPrice) + '</td>'
      + '<td class="num">' + fmtMoney(lineTotal) + '</td>'
      + '</tr>';
  });
  if (!lineItemRows) {
    lineItemRows = '<tr><td colspan="4" style="padding:20px; text-align:center; color:#666;">No line items</td></tr>';
  }

  var cur = escapeHtml(invoice.currency || 'USD');
  var subtotal = Number(invoice.subtotal || 0);
  var shipping = Number(invoice.shipping_amount || 0);
  var taxAmount = Number(invoice.tax_amount || 0);
  var taxRatePct = invoice.tax_rate_pct != null ? Number(invoice.tax_rate_pct) : null;
  var total = Number(invoice.total_amount || 0);
  var showTax = (taxRatePct != null && taxRatePct > 0) || taxAmount > 0;

  var html = ''
    + '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<title>Invoice ' + escapeHtml(invoice.invoice_number || '') + '</title>'
    + '<style>'
    + 'body { font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; margin: 32px; color: #111; font-size: 12px; }'
    + '.top-grid { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; }'
    + '.issuer-block { flex: 1; }'
    + '.invoice-title-block { text-align: right; }'
    + '.invoice-title { font-size: 32px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #1e293b; }'
    + '.invoice-meta { font-size: 11px; color: #555; margin-top: 8px; line-height: 1.5; }'
    + '.invoice-meta strong { color: #111; }'
    + '.party-name { font-size: 16px; font-weight: 800; margin-bottom: 2px; }'
    + '.party-name-ar { font-size: 14px; font-weight: 700; margin-bottom: 4px; }'
    + '.party-addr { font-size: 11px; line-height: 1.5; color: #333; margin-top: 4px; }'
    + '.party-contact { font-size: 11px; color: #555; margin-top: 4px; }'
    + '.party-tax { font-size: 10px; color: #777; margin-top: 4px; }'
    + '.parties-grid { display: flex; gap: 24px; margin-bottom: 24px; }'
    + '.party-block { flex: 1; padding: 12px 16px; background: #f1f5f9; border-radius: 4px; }'
    + '.party-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #555; font-weight: 700; margin-bottom: 6px; }'
    + 'table { width: 100%; border-collapse: collapse; margin: 16px 0; }'
    + 'th { background: #1e293b; color: white; padding: 10px 8px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }'
    + 'th.num { text-align: right; }'
    + 'td { padding: 8px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }'
    + 'td.num { text-align: right; font-family: "SF Mono", Menlo, monospace; }'
    + '.totals { margin-left: auto; width: 280px; margin-top: 8px; }'
    + '.totals-row { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 12px; }'
    + '.totals-row.line { border-bottom: 1px solid #e2e8f0; }'
    + '.totals-row.grand { background: #1e293b; color: white; font-weight: 800; font-size: 16px; padding: 12px; margin-top: 4px; border-radius: 4px; }'
    + '.totals-label { color: #555; }'
    + '.totals-row.grand .totals-label { color: white; }'
    + '.totals-value { font-family: "SF Mono", Menlo, monospace; font-weight: 700; }'
    + '.notes-block { margin-top: 24px; padding: 12px 16px; background: #fafafa; border-left: 3px solid #999; font-size: 11px; color: #444; }'
    + '.notes-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #777; font-weight: 700; margin-bottom: 4px; }'
    + '.direction-banner { display: inline-block; padding: 4px 10px; background: ' + (weBilledThem ? '#dcfce7' : '#fee2e2') + '; color: ' + (weBilledThem ? '#166534' : '#991b1b') + '; font-size: 11px; font-weight: 700; border-radius: 3px; margin-top: 8px; }'
    + '@media print { body { margin: 16px; } .no-print { display: none; } }'
    + '.no-print { margin-bottom: 12px; padding: 8px; background: #fef3c7; border: 1px solid #fde68a; border-radius: 4px; font-size: 11px; }'
    + '.no-print button { padding: 6px 12px; background: #1e293b; color: white; border: 0; border-radius: 3px; font-weight: 700; cursor: pointer; margin-right: 8px; }'
    + '</style>'
    + '</head><body>'
    + '<div class="no-print">'
    + '<strong>Print this page</strong> to save as PDF or print on paper. Use your browser&apos;s Print → Save as PDF option. '
    + '<button onclick="window.print()">🖨️ Print Now</button>'
    + '<button onclick="window.close()" style="background:#94a3b8">Close</button>'
    + '</div>'

    + '<div class="top-grid">'
    + '<div class="issuer-block">' + issuerHtml + '</div>'
    + '<div class="invoice-title-block">'
    + '<div class="invoice-title">Invoice</div>'
    + '<div class="invoice-meta">'
    + '<div><strong>Invoice #:</strong> ' + escapeHtml(invoice.invoice_number || '—') + '</div>'
    + '<div><strong>Date:</strong> ' + escapeHtml(fmtDate(invoice.invoice_date)) + '</div>'
    + (invoice.due_date ? '<div><strong>Due:</strong> ' + escapeHtml(fmtDate(invoice.due_date)) + '</div>' : '')
    + '<div><strong>Currency:</strong> ' + cur + '</div>'
    + '<div class="direction-banner">' + (weBilledThem ? 'We billed them' : 'They billed us') + '</div>'
    + '</div>'
    + '</div>'
    + '</div>'

    + '<div class="parties-grid">'
    + '<div class="party-block"><div class="party-label">From / من</div>' + issuerHtml + '</div>'
    + '<div class="party-block"><div class="party-label">Bill To / إلى</div>' + recipientHtml + '</div>'
    + '</div>'

    + '<table>'
    + '<thead><tr>'
    + '<th>Description</th>'
    + '<th class="num" style="width:90px">Qty</th>'
    + '<th class="num" style="width:110px">Unit Price (' + cur + ')</th>'
    + '<th class="num" style="width:120px">Line Total (' + cur + ')</th>'
    + '</tr></thead>'
    + '<tbody>' + lineItemRows + '</tbody>'
    + '</table>'

    + '<div class="totals">'
    + '<div class="totals-row line"><span class="totals-label">Subtotal</span><span class="totals-value">' + fmtMoney(subtotal) + ' ' + cur + '</span></div>'
    + (shipping > 0 ? '<div class="totals-row line"><span class="totals-label">Shipping</span><span class="totals-value">' + fmtMoney(shipping) + ' ' + cur + '</span></div>' : '')
    + (showTax ? '<div class="totals-row line"><span class="totals-label">Tax' + (taxRatePct != null ? ' (' + fmtMoney(taxRatePct) + '%)' : '') + '</span><span class="totals-value">' + fmtMoney(taxAmount) + ' ' + cur + '</span></div>' : '')
    + '<div class="totals-row grand"><span class="totals-label">TOTAL</span><span class="totals-value">' + fmtMoney(total) + ' ' + cur + '</span></div>'
    + '</div>'

    + (invoice.terms ? '<div class="notes-block"><div class="notes-label">Payment Terms</div>' + escapeHtml(invoice.terms).replace(/\n/g, '<br>') + '</div>' : '')
    + (invoice.notes ? '<div class="notes-block"><div class="notes-label">Notes</div>' + escapeHtml(invoice.notes).replace(/\n/g, '<br>') + '</div>' : '')

    + '<script>setTimeout(function(){ try { window.print(); } catch (e) {} }, 350);</script>'
    + '</body></html>';

  win.document.open();
  win.document.write(html);
  win.document.close();
}
