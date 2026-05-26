// v55.83-A.6.27.58 — Open Accounts print + Excel helpers (multi-currency).
//
// Two exported functions:
//   - printAccountLedger(account, entity, entries, summary)
//     Opens a new window with a printable statement. PDF-suitable. Per
//     currency: split the table into a section per currency (cleaner on
//     paper than one mega-table with parallel running balance columns).
//
//   - exportAccountLedgerToExcel(account, entity, entries, summary)
//     Generates an .xlsx file. One sheet, per-currency total rows at the
//     bottom. Numeric values stay numeric so Excel SUM works.
//
// `summary` must be the multi-currency shape from .58:
//   { byCurrency: {USD: {credit, debit, balance, count}, ...},
//     currencies: ['USD', 'EGP'],
//     totalEntryCount: N }
//
// `entries` is the array as returned by entriesByAccount[accountId] — each
// row carries _currency and _running_by_currency from the upstream walk.

import * as XLSX from 'xlsx';

function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return '';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// v55.83-A.6.27.72 HOTFIX 6 — signed amount helper (mirrors OpenAccountsTab).
// Returns the entry's net-effect contribution: + improves our position, − worsens.
// Cumulative sum within a currency = FIFO net for that currency.
function signedAmount(e) {
  if (!e) return 0;
  var cr = Number(e.credit_amount || 0);
  var dr = Number(e.debit_amount || 0);
  switch (e.transaction_type) {
    case 'payment_sent':     return +dr;
    case 'sales_invoice':    return +cr;
    case 'payment_received': return -cr;
    case 'vendor_bill':      return -dr;
    case 'credit_adjustment': return dr - cr;
    case 'offset':
      if (cr > 0 && e.offset_bill_id) return +cr;
      if (dr > 0 && e.offset_invoice_id) return -dr;
      return 0;
    default: return cr - dr;
  }
}

// Format a signed money value: '−' prefix for negatives, plain for positives, '0.00' for zero.
function fmtSignedMoney(n) {
  if (n == null || isNaN(Number(n))) return '';
  var v = Number(n);
  if (Math.abs(v) < 0.005) return '0.00';
  var abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? '−' + abs : abs;
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
// Layout: entity header → statement-for box → ONE section per currency
//   (each section has its own running-balance walk + totals + balance box).
// ──────────────────────────────────────────────────────────────────
// v55.83-A.6.27.72 — Print accepts `opts` with:
//   perspective: 'internal' (default) shows OUR view, or 'customer' shows their mirror
//   simulation: optional simulation result from open-account-ledger.simulate(), used to
//               render the 4-pot summary at the top of each currency section
export function printAccountLedger(account, entity, entries, summary, opts) {
  if (!account) return;
  opts = opts || {};
  var perspective = opts.perspective === 'customer' ? 'customer' : 'internal';
  var simulation = opts.simulation || null;
  var win;
  try { win = window.open('', '_blank', 'width=900,height=700'); }
  catch (e) { alert('Could not open print window. Please allow popups for this site.'); return; }
  if (!win) { alert('Could not open print window. Please allow popups for this site.'); return; }

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

  // v55.83-A.6.27.58 — Per-currency sections.
  // Group entries by currency, walk each group with its own running balance.
  var currencies = (summary && summary.currencies) || [];
  var byCurrency = (summary && summary.byCurrency) || {};

  function sectionHtml(cur) {
    var cs = byCurrency[cur] || { credit: 0, debit: 0, balance: 0, count: 0 };
    var simCur = (simulation && simulation.byCurrency && simulation.byCurrency[cur]) || null;
    var applications = (simulation && simulation.applications) || {};
    // v55.83-A.6.27.72 — labels are mirrored for customer perspective
    var TYPE_LABEL = {
      sales_invoice:    perspective === 'customer' ? 'Vendor Bill (you billed us)' : 'Sales Invoice (we billed them)',
      vendor_bill:      perspective === 'customer' ? 'Sales Invoice (we billed you)' : 'Vendor Bill (they billed us)',
      payment_received: perspective === 'customer' ? 'Payment Sent (you paid us)'   : 'Payment Received (they paid us)',
      payment_sent:     perspective === 'customer' ? 'Payment Received (we paid you)' : 'Payment Sent (we paid them)',
      credit_adjustment:'Adjustment',
      offset:           'Offset',
    };
    var rowsHtml = '';
    var running = 0;
    var anyRows = false;
    entries.forEach(function (e) {
      var entryCur = e._currency || String(e.currency || 'USD').toUpperCase();
      if (entryCur !== cur) return;
      anyRows = true;
      var credit = Number(e.credit_amount || 0);
      var debit  = Number(e.debit_amount  || 0);
      // Running net walks signed amounts (matches Running Balance column)
      var signed = signedAmount(e);
      if (perspective === 'customer') signed = -signed;
      running += signed;
      var paid = applications[e.id] || 0;
      var remaining = 0;
      var faceAmt = credit || debit;
      var isInvoiceOrBill = (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill');
      if (isInvoiceOrBill) {
        remaining = Math.max(0, faceAmt - paid);
      }
      var typeLabel = TYPE_LABEL[e.transaction_type] || 'Entry';
      // v55.83-A.6.27.72 HOTFIX 11 — AR Side / AP Side routing per the spec.
      // Sales Invoice + Payment Received → AR Side
      // Vendor Bill + Payment Sent       → AP Side
      var arSide = 0;
      var apSide = 0;
      switch (e.transaction_type) {
        case 'sales_invoice':    arSide = credit; break;
        case 'payment_received': arSide = credit; break;
        case 'vendor_bill':      apSide = debit; break;
        case 'payment_sent':     apSide = debit; break;
        case 'credit_adjustment': arSide = credit; apSide = debit; break;
        case 'offset':           arSide = credit; apSide = debit; break;
        default: arSide = credit; apSide = debit;
      }
      // Customer perspective: AR ↔ AP swap (their receivable = our payable)
      if (perspective === 'customer') { var tmp = arSide; arSide = apSide; apSide = tmp; }
      var arCellHtml = arSide > 0.005
        ? '<span style="color:#15803d">' + escapeHtml(fmtMoney(arSide)) + '</span>' : '';
      var apCellHtml = apSide > 0.005
        ? '<span style="color:#b91c1c">' + escapeHtml(fmtMoney(apSide)) + '</span>' : '';
      // Single Remaining column — fills only on invoice/bill rows, colored by side
      var remainingCellHtml = '';
      if (isInvoiceOrBill) {
        if (remaining > 0.005) {
          // Color by which side this row affects (after any perspective swap)
          var isAREffective = perspective === 'customer'
            ? (e.transaction_type === 'vendor_bill')
            : (e.transaction_type === 'sales_invoice');
          var color = isAREffective ? '#15803d' : '#b91c1c';
          remainingCellHtml = '<span style="color:' + color + '">' + escapeHtml(fmtMoney(remaining)) + '</span>';
        } else {
          remainingCellHtml = '<span style="color:#15803d; font-size:10px">✓ paid</span>';
        }
      }
      var runCellHtml = '<span style="color:' + (running > 0.005 ? '#15803d' : running < -0.005 ? '#b91c1c' : '#475569') + '">' + escapeHtml(fmtSignedMoney(running)) + '</span>';
      rowsHtml += '<tr>'
        + '<td>' + escapeHtml(fmtDate(e.entry_date)) + '</td>'
        + '<td style="font-size:10px"><strong>' + escapeHtml(typeLabel) + '</strong></td>'
        + '<td>' + escapeHtml(e.description || '') + (e.notes ? '<br><em style="color:#666;font-size:10px">' + escapeHtml(e.notes) + '</em>' : '') + '</td>'
        + '<td class="mono">' + escapeHtml(e.reference_number || '') + '</td>'
        + '<td class="num" style="background:#f0fdf4">' + arCellHtml + '</td>'
        + '<td class="num" style="background:#fef2f2">' + apCellHtml + '</td>'
        + '<td class="num" style="background:#fffbeb">' + remainingCellHtml + '</td>'
        + '<td class="num">' + runCellHtml + '</td>'
        + '</tr>';
    });
    if (!anyRows) {
      rowsHtml = '<tr><td colspan="8" style="padding:20px; text-align:center; color:#666;">No entries in ' + escapeHtml(cur) + '</td></tr>';
    }
    var balanceLabel = cs.balance > 0 ? (perspective === 'customer' ? 'You owe us' : 'They owe us')
                     : cs.balance < 0 ? (perspective === 'customer' ? 'We owe you' : 'We owe them')
                     : 'Settled';
    var balanceColor = cs.balance > 0 ? '#15803d' : cs.balance < 0 ? '#b91c1c' : '#475569';
    var bgColor = cs.balance >= 0 ? '#f0fdf4' : '#fef2f2';

    // 4-pot summary tiles for this currency
    var potTilesHtml = '';
    if (simCur) {
      potTilesHtml = ''
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">'
        + '<div style="flex:1;min-width:90px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:6px 8px">'
        + '<div style="font-size:9px;color:#1e3a8a;font-weight:700;text-transform:uppercase">'
        + (perspective === 'customer' ? 'We owe you' : 'They owe us')
        + '</div><div style="font-size:13px;font-family:monospace;font-weight:800;color:#1e3a8a">' + fmtMoney(simCur.theirOpenInvoices) + '</div></div>'
        + '<div style="flex:1;min-width:90px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:6px 8px">'
        + '<div style="font-size:9px;color:#78350f;font-weight:700;text-transform:uppercase">'
        + (perspective === 'customer' ? 'You owe us' : 'We owe them')
        + '</div><div style="font-size:13px;font-family:monospace;font-weight:800;color:#78350f">' + fmtMoney(simCur.ourOpenBills) + '</div></div>'
        + '<div style="flex:1;min-width:90px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:6px 8px">'
        + '<div style="font-size:9px;color:#14532d;font-weight:700;text-transform:uppercase">'
        + (perspective === 'customer' ? 'Your credit (prepaid)' : 'Their credit (prepaid)')
        + '</div><div style="font-size:13px;font-family:monospace;font-weight:800;color:#14532d">' + fmtMoney(simCur.theirPrepaid) + '</div></div>'
        + '<div style="flex:1;min-width:90px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:6px 8px">'
        + '<div style="font-size:9px;color:#7f1d1d;font-weight:700;text-transform:uppercase">'
        + (perspective === 'customer' ? 'Our credit (prepaid)' : 'Our credit (prepaid)')
        + '</div><div style="font-size:13px;font-family:monospace;font-weight:800;color:#7f1d1d">' + fmtMoney(simCur.ourPrepaid) + '</div></div>'
        + '</div>';
    }

    return ''
      + '<div class="currency-section">'
      + '<h2>' + escapeHtml(cur) + ' Ledger</h2>'
      + potTilesHtml
      + '<table>'
      + '<thead><tr>'
      + '<th style="width:70px">Date</th>'
      + '<th style="width:110px">Type</th>'
      + '<th>Description</th>'
      + '<th style="width:85px">Reference</th>'
      + '<th class="num" style="width:80px; background:#f0fdf4">AR Side</th>'
      + '<th class="num" style="width:80px; background:#fef2f2">AP Side</th>'
      + '<th class="num" style="width:80px; background:#fffbeb">Open Balance</th>'
      + '<th class="num" style="width:110px">Running Balance ' + escapeHtml(cur) + '</th>'
      + '</tr></thead>'
      + '<tbody>' + rowsHtml + '</tbody>'
      + (cs.count > 0
          ? (function () {
              // v55.83-A.6.27.72 HOTFIX 11 — Per-currency Summary block per the spec format:
              //   <CUR> Summary:
              //     Total AR (They Owe Us): X
              //     Total AP (We Owe Them): Y
              //     Net <CUR> Position: X − Y  (sub-label: "in our favor" / "against us")
              var totAR = 0, totAP = 0;
              entries.forEach(function (e) {
                var eCur = e._currency || String(e.currency || 'USD').toUpperCase();
                if (eCur !== cur) return;
                if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
                  var pp = applications[e.id] || 0;
                  var fa = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
                  var rem = Math.max(0, fa - pp);
                  // AR/AP swap in customer perspective
                  var asAR = perspective === 'customer'
                    ? (e.transaction_type === 'vendor_bill')
                    : (e.transaction_type === 'sales_invoice');
                  if (asAR) totAR += rem; else totAP += rem;
                }
              });
              var netP = totAR - totAP;
              var netColor = netP > 0.005 ? '#15803d' : netP < -0.005 ? '#b91c1c' : '#475569';
              var subLabel = netP > 0.005 ? 'in our favor' : netP < -0.005 ? 'against us' : 'settled';
              return '<tfoot>'
                + '<tr style="background:#1e293b; color:#fff"><td colspan="8" style="padding:8px 6px; text-align:left; text-transform:uppercase; font-size:10px; letter-spacing:1px; font-weight:800">' + escapeHtml(cur) + ' Summary</td></tr>'
                + '<tr style="background:#334155; color:#fff"><td colspan="4" style="padding:4px 6px; text-align:right">Total AR (They Owe Us):</td><td class="num" style="color:#86efac; background:rgba(34,197,94,0.15)">' + escapeHtml(fmtMoney(totAR)) + ' ' + escapeHtml(cur) + '</td><td colspan="3"></td></tr>'
                + '<tr style="background:#334155; color:#fff"><td colspan="4" style="padding:4px 6px; text-align:right">Total AP (We Owe Them):</td><td></td><td class="num" style="color:#fca5a5; background:rgba(239,68,68,0.15)">' + escapeHtml(fmtMoney(totAP)) + ' ' + escapeHtml(cur) + '</td><td colspan="2"></td></tr>'
                + '<tr style="background:#0f172a; color:#fff; font-weight:800">'
                + '<td colspan="4" style="padding:8px 6px; text-align:right; text-transform:uppercase; font-size:11px">Net ' + escapeHtml(cur) + ' Position:</td>'
                + '<td colspan="3" class="num" style="color:' + (netP > 0 ? '#86efac' : netP < 0 ? '#fca5a5' : '#fff') + '; font-size:14px">'
                + escapeHtml(fmtMoney(totAR)) + ' − ' + escapeHtml(fmtMoney(totAP)) + ' = ' + escapeHtml(fmtSignedMoney(netP)) + ' ' + escapeHtml(cur)
                + '<div style="font-size:9px; opacity:0.85; margin-top:2px; text-transform:uppercase; letter-spacing:1px">' + escapeHtml(subLabel) + '</div>'
                + '</td>'
                + '<td class="num" style="color:' + netColor + '">' + escapeHtml(fmtSignedMoney(perspective === 'customer' ? -cs.balance : cs.balance)) + '</td>'
                + '</tr>'
                + '</tfoot>';
            })()
          : '')
      + '</table>'
      + '<div class="balance-box" style="border-color:' + balanceColor + '; background:' + bgColor + ';">'
      + '<div class="balance-label">' + balanceLabel + '</div>'
      + '<div class="balance-value" style="color:' + balanceColor + ';">' + fmtMoney(Math.abs(cs.balance)) + ' ' + escapeHtml(cur) + '</div>'
      + '</div>'
      + '</div>';
  }

  var allSections = currencies.length > 0
    ? currencies.map(sectionHtml).join('')
    : '<p style="text-align:center; color:#666; padding:24px;">No ledger entries yet.</p>';

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
    + '.currency-section { page-break-inside: avoid; margin-bottom: 28px; }'
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
    + '.balance-box { margin-top: 12px; padding: 12px 16px; border: 2px solid; border-radius: 4px; }'
    + '.balance-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; }'
    + '.balance-value { font-size: 22px; font-weight: 800; }'
    + '.convention { margin-top: 24px; padding: 8px 12px; background: #fafafa; border-left: 3px solid #999; font-size: 10px; color: #555; }'
    + '.multi-currency-note { margin: 12px 0 0 0; padding: 6px 10px; background: #fef3c7; border-left: 3px solid #d97706; font-size: 10px; color: #451a03; }'
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
    + '<div class="statement-title">' + (perspective === 'customer' ? 'Customer Statement' : 'Statement') + '</div>'
    + '<div class="meta">Generated: ' + escapeHtml(generatedAt) + '</div>'
    + (firstDate ? '<div class="meta">Period: ' + escapeHtml(firstDate) + ' to ' + escapeHtml(lastDate) + '</div>' : '')
    + (currencies.length > 1 ? '<div class="meta">Currencies: ' + currencies.map(escapeHtml).join(', ') + '</div>' : '')
    + (perspective === 'customer' ? '<div class="meta" style="color:#7c2d12;font-weight:700">Your perspective</div>' : '')
    + '</div></div>'
    + '<div class="recipient">'
    + '<div class="recipient-label">Statement For / كشف حساب</div>'
    + '<div class="recipient-name">' + escapeHtml(account.account_name) + (account.account_name_ar ? '  &middot;  <span dir="rtl">' + escapeHtml(account.account_name_ar) + '</span>' : '') + '</div>'
    + (account.notes ? '<div style="font-size:11px;color:#555;margin-top:4px">' + escapeHtml(account.notes) + '</div>' : '')
    + '</div>'
    + (currencies.length > 1
        ? '<div class="multi-currency-note"><strong>Multi-currency account.</strong> This statement shows a separate section per currency. Currency balances are NOT added together — each currency has its own running balance.</div>'
        : '')
    + allSections
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
// One sheet. Entries listed chronologically (regardless of currency), each
// with its currency column. Per-currency totals at the bottom (one row each).
// Each currency has its own running-balance column so the recipient can
// trace both balances side-by-side.
// ──────────────────────────────────────────────────────────────────
export function exportAccountLedgerToExcel(account, entity, entries, summary) {
  if (!account) return;

  var rows = [];
  // Entity header block
  rows.push([(entity && entity.entity_name) || 'KTC', '', '', '', '', '', '']);
  if (entity && entity.entity_name_ar) rows.push([entity.entity_name_ar, '', '', '', '', '', '']);
  var addrLine = [entity && entity.address_line1, entity && entity.address_line2].filter(Boolean).join(' / ');
  if (addrLine) rows.push([addrLine, '', '', '', '', '', '']);
  var cityLine = [entity && entity.city, entity && entity.region, entity && entity.postal_code, entity && entity.country].filter(Boolean).join(', ');
  if (cityLine) rows.push([cityLine, '', '', '', '', '', '']);
  var contactLine = [entity && entity.phone ? 'Tel: ' + entity.phone : '', entity && entity.email].filter(Boolean).join(' · ');
  if (contactLine) rows.push([contactLine, '', '', '', '', '', '']);
  if (entity && entity.tax_id) rows.push(['Tax ID: ' + entity.tax_id, '', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '']);

  rows.push(['Statement of Account', '', '', '', '', '', '']);
  rows.push(['Account:', account.account_name + (account.account_name_ar ? ' / ' + account.account_name_ar : ''), '', '', '', '', '']);
  rows.push(['Generated:', new Date().toISOString().substring(0, 16).replace('T', ' '), '', '', '', '', '']);
  var currencies = (summary && summary.currencies) || [];
  if (currencies.length > 0) rows.push(['Currencies:', currencies.join(', '), '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '']);

  // v55.83-A.6.27.72 HOTFIX 11 — Excel column headers match the spec's two-column layout:
  // Date, Type, Description, Reference, Currency, AR Side, AP Side, Remaining,
  // then one "Running Balance CUR" column per currency.
  var colHeaders = ['Date', 'Type', 'Description', 'Reference', 'Currency', 'AR Side', 'AP Side', 'Open Balance'];
  currencies.forEach(function (cur) { colHeaders.push('Running Balance ' + cur); });
  rows.push(colHeaders);

  // Per-currency running totals (rolling)
  var running = {}; // cur → running balance
  currencies.forEach(function (c) { running[c] = 0; });

  // v55.83-A.6.27.72 — Type label map for display in Excel
  var TYPE_LABEL = {
    sales_invoice: 'Sales Invoice',
    vendor_bill: 'Vendor Bill',
    payment_received: 'Payment Received',
    payment_sent: 'Payment Sent',
    credit_adjustment: 'Adjustment',
    offset: 'Offset',
  };

  // v55.83-A.6.27.72 — compute paid amounts via FIFO simulation
  // We need the applications map. Caller didn't pass simulation here, so we
  // inline a minimal sim — but to keep this file self-contained, just defer
  // to the entry's reported credit/debit for Amount and leave Paid/Remaining
  // blank for non-invoice rows. For invoices/bills, compute remaining from
  // FIFO by summing same-direction payments after the row's date.
  // Lightweight approach: re-run a mini-simulation here.
  function entryAmount(e) {
    return Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
  }
  var sortedForSim = entries.slice().sort(function (a, b) {
    var da = String(a.entry_date || '');
    var db = String(b.entry_date || '');
    if (da !== db) return da < db ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  var simApplied = {};
  var simState = {};
  function s(cur) {
    if (!simState[cur]) simState[cur] = { theirPrepaid: 0, ourPrepaid: 0, openInvoices: [], openBills: [] };
    return simState[cur];
  }
  sortedForSim.forEach(function (e) {
    var cur = String(e.currency || 'USD').toUpperCase();
    var st = s(cur);
    var type = e.transaction_type;
    var amt = entryAmount(e);
    if (type === 'sales_invoice') {
      var f = Math.min(st.theirPrepaid, amt); st.theirPrepaid -= f;
      simApplied[e.id] = f;
      if (amt - f > 0.001) st.openInvoices.push({ id: e.id, remaining: amt - f });
    } else if (type === 'vendor_bill') {
      var f2 = Math.min(st.ourPrepaid, amt); st.ourPrepaid -= f2;
      simApplied[e.id] = f2;
      if (amt - f2 > 0.001) st.openBills.push({ id: e.id, remaining: amt - f2 });
    } else if (type === 'payment_received') {
      var c = amt;
      while (c > 0.001 && st.openInvoices.length > 0) {
        var inv = st.openInvoices[0];
        var ap = Math.min(inv.remaining, c);
        inv.remaining -= ap; simApplied[inv.id] = (simApplied[inv.id] || 0) + ap; c -= ap;
        if (inv.remaining < 0.001) st.openInvoices.shift();
      }
      if (c > 0.001) st.theirPrepaid += c;
    } else if (type === 'payment_sent') {
      var c2 = amt;
      while (c2 > 0.001 && st.openBills.length > 0) {
        var bill = st.openBills[0];
        var ap2 = Math.min(bill.remaining, c2);
        bill.remaining -= ap2; simApplied[bill.id] = (simApplied[bill.id] || 0) + ap2; c2 -= ap2;
        if (bill.remaining < 0.001) st.openBills.shift();
      }
      if (c2 > 0.001) st.ourPrepaid += c2;
    }
  });

  entries.forEach(function (e) {
    var entryCur = e._currency || String(e.currency || 'USD').toUpperCase();
    var credit = Number(e.credit_amount || 0);
    var debit  = Number(e.debit_amount  || 0);
    if (!(entryCur in running)) running[entryCur] = 0;
    // Running balance walks signed amounts (matches Running column on screen)
    var signed = signedAmount(e);
    running[entryCur] += signed;
    var paid = simApplied[e.id] || 0;
    var remaining = 0;
    var isInvoiceOrBill = e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill';
    var faceAmt = credit || debit;
    if (isInvoiceOrBill) remaining = Math.max(0, faceAmt - paid);
    // v55.83-A.6.27.72 HOTFIX 11 — AR Side / AP Side per spec.
    var arSide = 0, apSide = 0;
    switch (e.transaction_type) {
      case 'sales_invoice':    arSide = credit; break;
      case 'payment_received': arSide = credit; break;
      case 'vendor_bill':      apSide = debit; break;
      case 'payment_sent':     apSide = debit; break;
      case 'credit_adjustment': arSide = credit; apSide = debit; break;
      case 'offset':           arSide = credit; apSide = debit; break;
      default: arSide = credit; apSide = debit;
    }
    var row = [
      fmtDate(e.entry_date),
      TYPE_LABEL[e.transaction_type] || '',
      (e.description || '') + (e.notes ? ' — ' + e.notes : ''),
      e.reference_number || '',
      entryCur,
      arSide > 0.005 ? arSide : '',         // AR Side
      apSide > 0.005 ? apSide : '',         // AP Side
      isInvoiceOrBill && remaining > 0.005 ? remaining : '',  // Single Remaining column
    ];
    currencies.forEach(function (cur) {
      row.push(running[cur] !== undefined ? running[cur] : 0);
    });
    rows.push(row);
  });

  // v55.83-A.6.27.72 HOTFIX 11 — Per-currency Summary block per the spec format.
  //   <CUR> Summary:
  //     Total AR (They Owe Us): X
  //     Total AP (We Owe Them): Y
  //     Net <CUR> Position: X − Y  (sub-label: "in our favor" / "against us")
  rows.push(['', '', '', '', '', '', '', '']);
  var byCurrency = (summary && summary.byCurrency) || {};
  currencies.forEach(function (cur) {
    var totAR = 0, totAP = 0;
    entries.forEach(function (e) {
      var eCur = e._currency || String(e.currency || 'USD').toUpperCase();
      if (eCur !== cur) return;
      if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
        var pp = simApplied[e.id] || 0;
        var fa = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
        var rem = Math.max(0, fa - pp);
        if (e.transaction_type === 'sales_invoice') totAR += rem; else totAP += rem;
      }
    });
    var netP = totAR - totAP;
    var subLabel = netP > 0.005 ? 'in our favor' : netP < -0.005 ? 'against us' : 'settled';
    rows.push([cur + ' Summary:', '', '', '', '', '', '', '']);
    rows.push(['', '', 'Total AR (They Owe Us):', '', cur, totAR, '', '']);
    rows.push(['', '', 'Total AP (We Owe Them):', '', cur, '', totAP, '']);
    rows.push(['', '', 'Net ' + cur + ' Position:', subLabel, cur, '', '', netP]);
    rows.push(['', '', '', '', '', '', '', '']);
  });

  rows.push(['', '', '', '', '', '', '', '']);
  currencies.forEach(function (cur) {
    var cs = byCurrency[cur] || { balance: 0 };
    var label = cs.balance > 0 ? 'They owe us' : cs.balance < 0 ? 'We owe them' : 'Settled';
    rows.push([label + ' (' + cur + '):', Math.abs(cs.balance), cur, '', '', '', '', '']);
  });

  // Build sheet
  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },  // Date
    { wch: 18 },  // Type
    { wch: 38 },  // Description
    { wch: 16 },  // Reference
    { wch: 10 },  // Currency
    { wch: 14 },  // AR Side
    { wch: 14 },  // AP Side
    { wch: 14 },  // Remaining
  ];
  currencies.forEach(function () { ws['!cols'].push({ wch: 18 }); });  // one per currency running

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger');

  var dateStr = new Date().toISOString().substring(0, 10);
  var fname = 'OpenAccount-' + sanitizeFilename(account.account_name) + '-' + dateStr + '.xlsx';
  XLSX.writeFile(wb, fname);
}
