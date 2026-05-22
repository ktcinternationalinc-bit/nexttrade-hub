// v55.83-A.6.27.53 — Open Accounts print + Excel helpers.
//
// Two exported functions:
//   - printAccountLedger(account, entity, entries, summary)
//     Opens a new window with a printable statement and auto-fires window.print().
//
//   - exportAccountLedgerToExcel(account, entity, entries, summary)
//     Generates an .xlsx file using the already-installed xlsx package and
//     triggers a download.
//
// Both are pure functions. No DB calls. Caller is responsible for passing
// the correct entity + entries + summary computed upstream.

import * as XLSX from 'xlsx';

function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return '';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s).toISOString().substring(0, 10); } catch (e) { return s; }
}
function sanitizeFilename(s) {
  return String(s || 'account').replace(/[^a-zA-Z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '') || 'account';
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

// ──────────────────────────────────────────────────────────────────
// PRINTABLE LEDGER STATEMENT (opens new window, auto-prints)
// ──────────────────────────────────────────────────────────────────
export function printAccountLedger(account, entity, entries, summary) {
  if (!account) return;
  var win;
  try {
    win = window.open('', '_blank', 'width=900,height=700');
  } catch (e) {
    alert('Could not open print window. Please allow popups for this site.');
    return;
  }
  if (!win) {
    alert('Could not open print window. Please allow popups for this site.');
    return;
  }

  var generatedAt = new Date().toISOString().substring(0, 16).replace('T', ' ');
  var firstDate = entries.length > 0 ? fmtDate(entries[0].entry_date) : '';
  var lastDate  = entries.length > 0 ? fmtDate(entries[entries.length - 1].entry_date) : '';

  // Build entity header lines (only show what's filled in)
  var entityLines = [];
  if (entity) {
    if (entity.entity_name) entityLines.push(escapeHtml(entity.entity_name));
    if (entity.entity_name_ar) entityLines.push('<span dir="rtl">' + escapeHtml(entity.entity_name_ar) + '</span>');
    var addrParts = [];
    if (entity.address_line1) addrParts.push(escapeHtml(entity.address_line1));
    if (entity.address_line2) addrParts.push(escapeHtml(entity.address_line2));
    var cityLine = [entity.city, entity.region, entity.postal_code].filter(Boolean).join(', ');
    if (cityLine) addrParts.push(escapeHtml(cityLine));
    if (entity.country) addrParts.push(escapeHtml(entity.country));
    if (addrParts.length) entityLines.push(addrParts.join('<br>'));
    var contactParts = [];
    if (entity.phone) contactParts.push('Tel: ' + escapeHtml(entity.phone));
    if (entity.email) contactParts.push(escapeHtml(entity.email));
    if (contactParts.length) entityLines.push(contactParts.join(' &middot; '));
    if (entity.tax_id) entityLines.push('Tax ID: ' + escapeHtml(entity.tax_id));
  } else {
    entityLines.push('<em style="color:#666">No business entity selected for this account</em>');
  }

  // Build ledger rows HTML
  var rowsHtml = '';
  if (entries.length === 0) {
    rowsHtml = '<tr><td colspan="6" style="padding:20px; text-align:center; color:#666;">No entries yet</td></tr>';
  } else {
    var running = 0;
    rowsHtml = entries.map(function (e) {
      var credit = Number(e.credit_amount || 0);
      var debit  = Number(e.debit_amount  || 0);
      running += credit - debit;
      return '<tr>'
        + '<td>' + escapeHtml(fmtDate(e.entry_date)) + '</td>'
        + '<td>' + escapeHtml(e.description || '') + (e.notes ? '<br><em style="color:#666;font-size:10px">' + escapeHtml(e.notes) + '</em>' : '') + '</td>'
        + '<td class="mono">' + escapeHtml(e.reference_number || '') + '</td>'
        + '<td class="num credit">' + (credit > 0 ? fmtMoney(credit) : '') + '</td>'
        + '<td class="num debit">'  + (debit  > 0 ? fmtMoney(debit)  : '') + '</td>'
        + '<td class="num">' + fmtMoney(running) + '</td>'
        + '</tr>';
    }).join('');
  }

  var balance = summary.balance;
  var balanceLabel = balance > 0 ? 'They owe us'
                   : balance < 0 ? 'We owe them'
                   : 'Settled';
  var balanceColor = balance > 0 ? '#15803d' : balance < 0 ? '#b91c1c' : '#475569';

  var html = ''
    + '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<title>Statement — ' + escapeHtml(account.account_name) + '</title>'
    + '<style>'
    + 'body { font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; margin: 32px; color: #111; font-size: 12px; }'
    + 'h1 { margin: 0 0 4px 0; font-size: 18px; }'
    + 'h2 { margin: 24px 0 8px 0; font-size: 14px; border-bottom: 2px solid #111; padding-bottom: 4px; }'
    + '.header-grid { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 16px; }'
    + '.entity-block { flex: 1; }'
    + '.entity-name { font-size: 16px; font-weight: 800; margin-bottom: 4px; }'
    + '.entity-lines { font-size: 11px; line-height: 1.5; color: #333; }'
    + '.statement-block { text-align: right; }'
    + '.statement-title { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }'
    + '.meta { font-size: 10px; color: #555; margin-top: 4px; }'
    + '.recipient { background: #f1f5f9; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }'
    + '.recipient-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #555; }'
    + '.recipient-name { font-size: 14px; font-weight: 700; margin-top: 2px; }'
    + 'table { width: 100%; border-collapse: collapse; margin-top: 8px; }'
    + 'th { background: #1e293b; color: white; padding: 8px 6px; text-align: left; font-size: 11px; font-weight: 700; }'
    + 'th.num { text-align: right; }'
    + 'td { padding: 6px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }'
    + 'td.num { text-align: right; font-family: "SF Mono", Menlo, monospace; }'
    + 'td.mono { font-family: "SF Mono", Menlo, monospace; color: #444; }'
    + 'td.credit { color: #166534; font-weight: 700; }'
    + 'td.debit { color: #991b1b; font-weight: 700; }'
    + 'tr.totals { background: #f1f5f9; font-weight: 800; }'
    + 'tr.totals td { border-top: 2px solid #111; border-bottom: 2px solid #111; }'
    + '.balance-box { margin-top: 20px; padding: 12px 16px; border: 2px solid ' + balanceColor + '; background: ' + (balance >= 0 ? '#f0fdf4' : '#fef2f2') + '; border-radius: 4px; }'
    + '.balance-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; }'
    + '.balance-value { font-size: 22px; font-weight: 800; color: ' + balanceColor + '; }'
    + '.balance-note { font-size: 11px; color: #444; margin-top: 4px; }'
    + '.convention { margin-top: 24px; padding: 8px 12px; background: #fafafa; border-left: 3px solid #999; font-size: 10px; color: #555; }'
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
    + '<div class="header-grid">'
    + '<div class="entity-block">'
    + '<div class="entity-name">' + (entityLines[0] || '') + '</div>'
    + (entityLines[1] ? '<div class="entity-name" style="font-weight:600">' + entityLines[1] + '</div>' : '')
    + '<div class="entity-lines">' + entityLines.slice(2).join('<br>') + '</div>'
    + '</div>'
    + '<div class="statement-block">'
    + '<div class="statement-title">Statement</div>'
    + '<div class="meta">Generated: ' + escapeHtml(generatedAt) + '</div>'
    + (firstDate ? '<div class="meta">Period: ' + escapeHtml(firstDate) + ' to ' + escapeHtml(lastDate) + '</div>' : '')
    + (entity && entity.default_currency ? '<div class="meta">Currency: ' + escapeHtml(entity.default_currency) + '</div>' : '')
    + '</div></div>'
    + '<div class="recipient">'
    + '<div class="recipient-label">Statement For / كشف حساب</div>'
    + '<div class="recipient-name">' + escapeHtml(account.account_name) + (account.account_name_ar ? '  &middot;  <span dir="rtl">' + escapeHtml(account.account_name_ar) + '</span>' : '') + '</div>'
    + (account.notes ? '<div style="font-size:11px;color:#555;margin-top:4px">' + escapeHtml(account.notes) + '</div>' : '')
    + '</div>'
    + '<h2>Ledger Entries</h2>'
    + '<table>'
    + '<thead><tr>'
    + '<th style="width:80px">Date</th>'
    + '<th>Description</th>'
    + '<th style="width:110px">Reference</th>'
    + '<th class="num" style="width:90px">Credit</th>'
    + '<th class="num" style="width:90px">Debit</th>'
    + '<th class="num" style="width:100px">Running Balance</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + (entries.length > 0
        ? '<tfoot><tr class="totals">'
          + '<td colspan="3" style="text-align:right; text-transform:uppercase; font-size:10px">Totals</td>'
          + '<td class="num credit">' + fmtMoney(summary.totalCredit) + '</td>'
          + '<td class="num debit">'  + fmtMoney(summary.totalDebit)  + '</td>'
          + '<td class="num">' + fmtMoney(summary.balance) + '</td>'
          + '</tr></tfoot>'
        : '')
    + '</table>'
    + '<div class="balance-box">'
    + '<div class="balance-label">' + balanceLabel + '</div>'
    + '<div class="balance-value">' + fmtMoney(Math.abs(balance)) + ' ' + escapeHtml((entity && entity.default_currency) || '') + '</div>'
    + (balance !== 0 ? '<div class="balance-note">Net balance as of ' + escapeHtml(generatedAt) + '</div>' : '')
    + '</div>'
    + '<div class="convention">'
    + 'Convention: <strong>Credit</strong> = money paid to us. <strong>Debit</strong> = money paid by us. '
    + 'A positive running balance means the counterparty owes us; a negative balance means we owe them.'
    + '</div>'
    + '<script>setTimeout(function(){ try { window.print(); } catch (e) {} }, 350);</script>'
    + '</body></html>';

  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ──────────────────────────────────────────────────────────────────
// EXCEL EXPORT (.xlsx via SheetJS)
// ──────────────────────────────────────────────────────────────────
export function exportAccountLedgerToExcel(account, entity, entries, summary) {
  if (!account) return;

  var rows = [];
  // Header block
  rows.push([(entity && entity.entity_name) || 'KTC', '', '', '', '', '']);
  if (entity && entity.entity_name_ar) rows.push([entity.entity_name_ar, '', '', '', '', '']);
  var addrLine = [entity && entity.address_line1, entity && entity.address_line2].filter(Boolean).join(' / ');
  if (addrLine) rows.push([addrLine, '', '', '', '', '']);
  var cityLine = [entity && entity.city, entity && entity.region, entity && entity.postal_code, entity && entity.country].filter(Boolean).join(', ');
  if (cityLine) rows.push([cityLine, '', '', '', '', '']);
  var contactLine = [entity && entity.phone ? 'Tel: ' + entity.phone : '', entity && entity.email].filter(Boolean).join(' · ');
  if (contactLine) rows.push([contactLine, '', '', '', '', '']);
  if (entity && entity.tax_id) rows.push(['Tax ID: ' + entity.tax_id, '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);

  rows.push(['Statement of Account', '', '', '', '', '']);
  rows.push(['Account:', account.account_name + (account.account_name_ar ? ' / ' + account.account_name_ar : ''), '', '', '', '']);
  rows.push(['Generated:', new Date().toISOString().substring(0, 16).replace('T', ' '), '', '', '', '']);
  if (entity && entity.default_currency) rows.push(['Currency:', entity.default_currency, '', '', '', '']);
  rows.push(['', '', '', '', '', '']);

  // Column headers
  rows.push(['Date', 'Description', 'Reference', 'Credit', 'Debit', 'Running Balance']);

  // Ledger rows — keep numeric values as Numbers so Excel SUM() works
  var running = 0;
  entries.forEach(function (e) {
    var credit = Number(e.credit_amount || 0);
    var debit  = Number(e.debit_amount  || 0);
    running += credit - debit;
    rows.push([
      fmtDate(e.entry_date),
      (e.description || '') + (e.notes ? ' — ' + e.notes : ''),
      e.reference_number || '',
      credit > 0 ? credit : '',
      debit  > 0 ? debit  : '',
      running,
    ]);
  });

  // Totals
  if (entries.length > 0) {
    rows.push(['', '', 'TOTALS', summary.totalCredit, summary.totalDebit, summary.balance]);
  }

  // Plain-English balance line
  rows.push(['', '', '', '', '', '']);
  var balanceLabel = summary.balance > 0 ? 'They owe us'
                   : summary.balance < 0 ? 'We owe them'
                   : 'Settled';
  rows.push([balanceLabel + ':', Math.abs(summary.balance), '', '', '', '']);

  // Build sheet
  var ws = XLSX.utils.aoa_to_sheet(rows);
  // Set column widths
  ws['!cols'] = [
    { wch: 14 }, // Date
    { wch: 42 }, // Description
    { wch: 16 }, // Reference
    { wch: 14 }, // Credit
    { wch: 14 }, // Debit
    { wch: 18 }, // Running Balance
  ];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger');

  var dateStr = new Date().toISOString().substring(0, 10);
  var fname = 'OpenAccount-' + sanitizeFilename(account.account_name) + '-' + dateStr + '.xlsx';
  XLSX.writeFile(wb, fname);
}
