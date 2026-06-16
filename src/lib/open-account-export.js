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

// v55.83-A.6.27.72 — Open Account ledger export functions.
//
// v55.83-A.6.27.72 HOTFIX 30/31 — bilingual mode support + "Credit Applied"
// terminology + offset linkage explainer lines + customer-friendly headers.
// Bilingual mode: pass opts.bilingual = true to printAccountLedger() and
// exportAccountLedgerToExcel() — column headers and type labels render
// stacked (English on top, Arabic below). When omitted, EN-only is rendered
// (unchanged behavior for existing call sites).

import { T as t18n, stackedH } from './open-account-i18n.js';

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
  var bilingual = opts.bilingual === true;
  // v55.83-A.6.27.72 HOTFIX 33 (Max v2 feedback) — layout option:
  //   'per_currency' (default) — separate USD and EGP sections (classic statement)
  //   'combined'                — single chronological table interleaving all currencies,
  //                              matching the live on-screen ledger (one Running USD column
  //                              + one Running EGP column per row, dimmed by currency). For
  //                              internal audits — less customary on customer copies.
  var layout = opts.layout === 'combined' ? 'combined' : 'per_currency';
  var simulation = opts.simulation || null;
  // v55.83-A.6.27.72 HOTFIX 30 — Build offset-linkage lookup BEFORE filtering
  // out offset rows from display. Maps invoice/bill ID → array of references
  // it was offset against, so we can show "Paid by credit applied from SALE-XXX"
  // under the ✓ paid badge on the linked invoice/bill row.
  var allEntries = entries || [];
  var refById = {};
  var typeById = {};
  allEntries.forEach(function (e) { if (e && e.id) { refById[e.id] = e.reference_number; typeById[e.id] = e.transaction_type; } });
  var offsetsByTarget = {};
  allEntries.filter(function (e) { return e.transaction_type === 'offset'; }).forEach(function (o) {
    var invId = o.offset_invoice_id;
    var billId = o.offset_bill_id;
    // Skip malformed offset rows (HOTFIX 28 rejects them in simulator; we skip in UI too)
    if (typeById[invId] !== 'sales_invoice' || typeById[billId] !== 'vendor_bill') return;
    // Use the DEBIT-side row of each pair as canonical so we don't double-count.
    if (Number(o.debit_amount || 0) > 0) {
      var amt = Number(o.debit_amount);
      var billRef = refById[billId] || (billId ? billId.substring(0, 8) : '');
      var invRef = refById[invId] || (invId ? invId.substring(0, 8) : '');
      if (!offsetsByTarget[invId]) offsetsByTarget[invId] = [];
      offsetsByTarget[invId].push({ otherRef: billRef, amount: amt });
      if (!offsetsByTarget[billId]) offsetsByTarget[billId] = [];
      offsetsByTarget[billId].push({ otherRef: invRef, amount: amt });
    }
  });
  // v55.83-A.6.27.72 HOTFIX 12 — Hide offset rows from printed statement.
  // The auto-offset cascade settles opposite-side balances; the invoice/bill rows
  // show "✓ paid" without two confusing offset lines. Audit trail still in DB.
  entries = (entries || []).filter(function (e) { return e.transaction_type !== 'offset'; });
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
    // v55.83-A.6.27.72 HOTFIX 30/31 — type labels via i18n module with
    // perspective flip. Customer copy shows clean labels ("Invoice"/"Bill")
    // from THEIR perspective without the long parenthetical that was here.
    function tLabel(typeKey) {
      var en = t18n(typeKey, 'en', perspective);
      if (!bilingual) return en;
      var ar = t18n(typeKey, 'ar', perspective);
      return en + '<br><span class="ar-sub" dir="rtl">' + ar + '</span>';
    }
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
      // v55.83-GM — customer statement is LABELS-ONLY: same amounts/columns/signs as internal,
      // only the wording changes (headers flip via i18n). Do NOT negate/swap — that double-flipped
      // sales invoices into the wrong column.
      running += signed;
      var paid = applications[e.id] || 0;
      var remaining = 0;
      var faceAmt = credit || debit;
      var isInvoiceOrBill = (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill');
      if (isInvoiceOrBill) {
        remaining = Math.max(0, faceAmt - paid);
      }
      var typeLabel = tLabel(e.transaction_type);
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
      /* v55.83-GM: removed AR/AP amount swap — customer perspective is labels-only; the column
         headers already flip via i18n (they_owe_us → "You Owe Us", we_owe_them → "Owed to You"),
         so swapping the amounts too double-flipped (sales invoice showed under "Owed to You"). */
      // v55.83-A.6.27.72 HOTFIX 14 (refined HOTFIX 15) — Per Max's exact spec:
      // sales_invoice → BLUE (#1d4ed8) — we're billing them
      // vendor_bill   → PURPLE (#7e22ce) — they're billing us  (changed from orange)
      // Customer perspective swaps interpretation (their AR is our AP).
      // v55.83-GP — labels-only: colors are by transaction TYPE and do NOT flip with perspective.
      var invoiceColor = null;
      if (e.transaction_type === 'sales_invoice') {
        invoiceColor = '#1d4ed8';
      } else if (e.transaction_type === 'vendor_bill') {
        invoiceColor = '#7e22ce';
      }
      // v55.83-A.6.27.72 HOTFIX 30 — color by transaction TYPE not blanket-by-column.
      // sales_invoice/payment_received in AR column → green (asset)
      // vendor_bill in AP column → red (liability)
      // payment_sent in AP column → GREEN not red (we paid them = good for our position)
      var arColor = '#15803d';  // green default
      var apColor = '#b91c1c';  // red default for vendor bills
      if (e.transaction_type === 'payment_sent') apColor = '#15803d';  // green
      if (e.transaction_type === 'credit_adjustment') { apColor = '#15803d'; arColor = '#475569'; }
      // v55.83-GT — a payment REDUCES a balance; render it as "− amount" (teal) so it never reads
      // as new debt on a statement. Invoices/bills stay positive charges.
      var arIsPmt = (e.transaction_type === 'payment_received');
      var apIsPmt = (e.transaction_type === 'payment_sent');
      var arCellHtml = arSide > 0.005
        ? '<span style="color:' + (arIsPmt ? '#0d9488' : (invoiceColor || arColor)) + '">' + (arIsPmt ? '− ' : '') + escapeHtml(fmtMoney(arSide)) + '</span>' : '';
      var apCellHtml = apSide > 0.005
        ? '<span style="color:' + (apIsPmt ? '#0d9488' : (invoiceColor || apColor)) + '">' + (apIsPmt ? '− ' : '') + escapeHtml(fmtMoney(apSide)) + '</span>' : '';
      // Single Remaining column — fills only on invoice/bill rows, colored by invoice color
      var remainingCellHtml = '';
      if (isInvoiceOrBill) {
        // v55.83-A.6.27.72 HOTFIX 33 (Max v2 feedback) — Settlement wording.
        // The other side of an offset is the OPPOSITE document type: for a
        // vendor_bill row, the other side is a sales_invoice (and vice versa).
        // Surface that type explicitly so the customer reads "Settled by offset
        // against sales invoice INV-..." instead of the misleading "credit applied".
        var links = offsetsByTarget[e.id] || [];
        var linkLine = '';
        if (links.length > 0) {
          var sortedLinks = links.slice().sort(function (a, b) { return b.amount - a.amount; });
          var headlineRef = sortedLinks[0].otherRef;
          var moreCount = sortedLinks.length - 1;
          var moreText = moreCount > 0 ? ' + ' + moreCount + ' more' : '';
          var isPartial = remaining > 0.005;
          // The OTHER side's type — opposite of THIS row's type
          var otherTypeKey = e.transaction_type === 'vendor_bill' ? 'type_sales_invoice_short' : 'type_vendor_bill_short';
          var phraseEn = (isPartial ? t18n('partially_applied', 'en') : t18n('paid_by_credit', 'en'))
                       + ' ' + t18n(otherTypeKey, 'en');
          var phraseLineEn = phraseEn + ' <strong>' + escapeHtml(headlineRef) + '</strong>' + moreText;
          var phraseLineFull = phraseLineEn;
          if (bilingual) {
            var phraseAr = (isPartial ? t18n('partially_applied', 'ar') : t18n('paid_by_credit', 'ar'))
                         + ' ' + t18n(otherTypeKey, 'ar');
            phraseLineFull += '<br><span class="ar-sub" dir="rtl">' + phraseAr + ' <strong>' + escapeHtml(headlineRef) + '</strong></span>';
          }
          linkLine = '<div style="font-size:9px;color:#64748b;margin-top:3px;font-style:italic">' + phraseLineFull + '</div>';
        }
        if (remaining > 0.005) {
          var openTxt = bilingual
            ? t18n('open', 'en') + ' ' + escapeHtml(fmtMoney(remaining)) + '<br><span class="ar-sub" dir="rtl">' + t18n('open', 'ar') + '</span>'
            : t18n('open', 'en') + ' ' + escapeHtml(fmtMoney(remaining));
          remainingCellHtml = '<span style="color:' + invoiceColor + ';font-weight:700">' + openTxt + '</span>' + linkLine;
        } else {
          var paidTxt = bilingual
            ? t18n('paid', 'en') + '<br><span class="ar-sub" dir="rtl">' + t18n('paid', 'ar') + '</span>'
            : t18n('paid', 'en');
          remainingCellHtml = '<span style="background:#15803d;color:white;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:700">' + paidTxt + '</span>' + linkLine;
        }
      }
      var runCellHtml = '<span style="color:' + (running > 0.005 ? '#15803d' : running < -0.005 ? '#b91c1c' : '#475569') + '">' + escapeHtml(fmtSignedMoney(running)) + '</span>';
      // Description colored when it's an invoice/bill; otherwise default
      var descColorStyle = invoiceColor ? ' style="color:' + invoiceColor + '; font-weight:600"' : '';
      // v55.83-A.6.27.72 HOTFIX 33 — Description block: detect "Auto-synced
      // from invoice ..." preambles and demote them to a small italic line so
      // the main description reads cleanly. Same for Arabic notes when bilingual.
      var rawDesc = String(e.description || '');
      var autoSyncMatch = rawDesc.match(/^(.+?)\s*Auto-synced from invoice .+?\.\s*Edit the invoice to change this entry\.\s*$/i);
      var mainDesc = autoSyncMatch ? autoSyncMatch[1].trim() : rawDesc;
      var hasAutoSync = !!autoSyncMatch;
      // v55.83-GN \u2014 show entry notes (incl. invoice notes) under the description in ANY language,
      // not only Arabic. RTL styling only when the note is actually Arabic.
      // v55.83-GT \u2014 only REAL user notes belong on a statement. Strip the system "Auto-synced from
      // invoice \u2026 Edit the invoice to change this entry." text; if nothing real is left, show nothing.
      var arNoteHtml = '';
      var _userNote = e.notes ? String(e.notes).replace(/Auto-synced from invoice[\s\S]*?Edit the invoice to change this entry\.?/gi, '').trim() : '';
      if (_userNote) {
        var _isArNote = /[\u0600-\u06FF]/.test(_userNote);
        arNoteHtml = '<div class="' + (_isArNote ? 'ar-sub' : '') + '"' + (_isArNote ? ' dir="rtl"' : '') + ' style="font-size:10px;color:#64748b">' + escapeHtml(_userNote) + '</div>';
      }
      var autoSyncHtml = hasAutoSync ? '<div class="auto-sync-note">auto-synced from invoice</div>' : '';
      rowsHtml += '<tr>'
        + '<td>' + escapeHtml(fmtDate(e.entry_date)) + '</td>'
        + '<td style="font-size:10px"><strong>' + typeLabel + '</strong></td>'
        + '<td class="desc-cell"' + descColorStyle + '><div class="desc-main">' + escapeHtml(mainDesc) + '</div>' + arNoteHtml + autoSyncHtml + '</td>'
        + '<td class="mono">' + escapeHtml(e.reference_number || '') + '</td>'
        + '<td class="num">' + arCellHtml + '</td>'
        + '<td class="num">' + apCellHtml + '</td>'
        + '<td class="num">' + remainingCellHtml + '</td>'
        + '<td class="num">' + runCellHtml + '</td>'
        + '</tr>';
    });
    if (!anyRows) {
      rowsHtml = '<tr><td colspan="8" style="padding:20px; text-align:center; color:#666;">No entries in ' + escapeHtml(cur) + '</td></tr>';
    }
    var balanceLabelKey = cs.balance > 0 ? 'they_owe_us_dir'
                        : cs.balance < 0 ? 'we_owe_them_dir'
                        : 'settled';
    var balanceLabel = bilingual
      ? t18n(balanceLabelKey, 'en', perspective) + ' / ' + t18n(balanceLabelKey, 'ar', perspective)
      : t18n(balanceLabelKey, 'en', perspective);
    var balanceColor = cs.balance > 0 ? '#15803d' : cs.balance < 0 ? '#b91c1c' : '#475569';
    var bgColor = cs.balance >= 0 ? '#f0fdf4' : '#fef2f2';

    // 4-pot summary tiles for this currency
    var potTilesHtml = '';
    if (simCur) {
      potTilesHtml = ''
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">'
        + '<div style="flex:1;min-width:90px;background:#f0fdf4;border:1px solid #bfdbfe;border-radius:4px;padding:6px 8px">'
        + '<div style="font-size:9px;color:#1e3a8a;font-weight:700;text-transform:uppercase">'
        + (perspective === 'customer' ? 'You owe us' : 'They owe us')
        + '</div><div style="font-size:13px;font-family:monospace;font-weight:800;color:#1e3a8a">' + fmtMoney(simCur.theirOpenInvoices) + '</div></div>'
        + '<div style="flex:1;min-width:90px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:6px 8px">'
        + '<div style="font-size:9px;color:#78350f;font-weight:700;text-transform:uppercase">'
        + (perspective === 'customer' ? 'We owe you' : 'We owe them')
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
      + '<th class="col-date">' + (bilingual ? stackedH('date') : t18n('date', 'en')) + '</th>'
      + '<th class="col-type">' + (bilingual ? stackedH('type') : t18n('type', 'en')) + '</th>'
      + '<th class="col-desc">' + (bilingual ? stackedH('description') : t18n('description', 'en')) + '</th>'
      + '<th class="col-ref">' + (bilingual ? stackedH('reference') : t18n('reference', 'en')) + '</th>'
      + '<th class="col-money num" style="color:#15803d">' + (bilingual ? stackedH('they_owe_us', perspective) : t18n('they_owe_us', 'en', perspective)) + '</th>'
      + '<th class="col-money num" style="color:#b91c1c">' + (bilingual ? stackedH('we_owe_them', perspective) : t18n('we_owe_them', 'en', perspective)) + '</th>'
      + '<th class="col-open num" style="color:#b45309">' + (bilingual ? stackedH('open_balance') : t18n('open_balance', 'en')) + '</th>'
      + '<th class="col-run num">' + (bilingual ? stackedH('running_bal') : t18n('running_bal', 'en')) + ' ' + escapeHtml(cur) + '</th>'
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
                  // v55.83-GM — a sales invoice is ALWAYS the AR side (customer owes us); only the
                  // labels flip for customer perspective, never the amount routing.
                  var asAR = (e.transaction_type === 'sales_invoice');
                  if (asAR) totAR += rem; else totAP += rem;
                }
              });
              var netP = totAR - totAP;
              var netColor = netP > 0.005 ? '#15803d' : netP < -0.005 ? '#b91c1c' : '#475569';
              var subLabel = netP > 0.005 ? 'in our favor' : netP < -0.005 ? 'against us' : 'settled';
              return '<tfoot>'
                + '<tr style="background:#1e293b; color:#fff"><td colspan="8" style="padding:8px 6px; text-align:left; text-transform:uppercase; font-size:10px; letter-spacing:1px; font-weight:800">' + escapeHtml(cur) + ' Summary</td></tr>'
                + '<tr style="background:#334155; color:#fff"><td colspan="4" style="padding:4px 6px; text-align:right">' + (bilingual ? stackedH('total_they_owe', perspective) : t18n('total_they_owe', 'en', perspective)) + ':</td><td class="num" style="color:#86efac; background:rgba(34,197,94,0.15)">' + escapeHtml(fmtMoney(totAR)) + ' ' + escapeHtml(cur) + '</td><td colspan="3"></td></tr>'
                + '<tr style="background:#334155; color:#fff"><td colspan="4" style="padding:4px 6px; text-align:right">' + (bilingual ? stackedH('total_we_owe', perspective) : t18n('total_we_owe', 'en', perspective)) + ':</td><td></td><td class="num" style="color:#fca5a5; background:rgba(239,68,68,0.15)">' + escapeHtml(fmtMoney(totAP)) + ' ' + escapeHtml(cur) + '</td><td colspan="2"></td></tr>'
                + '<tr style="background:#0f172a; color:#fff; font-weight:800">'
                + '<td colspan="4" style="padding:8px 6px; text-align:right; text-transform:uppercase; font-size:11px">Net ' + escapeHtml(cur) + ' Position:</td>'
                + '<td colspan="3" class="num" style="color:' + (netP > 0 ? '#86efac' : netP < 0 ? '#fca5a5' : '#fff') + '; font-size:14px">'
                + escapeHtml(fmtMoney(totAR)) + ' − ' + escapeHtml(fmtMoney(totAP)) + ' = ' + escapeHtml(fmtSignedMoney(netP)) + ' ' + escapeHtml(cur)
                + '<div style="font-size:9px; opacity:0.85; margin-top:2px; text-transform:uppercase; letter-spacing:1px">' + escapeHtml(subLabel) + '</div>'
                + '</td>'
                + '<td class="num" style="color:' + netColor + '">' + escapeHtml(fmtSignedMoney(cs.balance)) + '</td>'
                + '</tr>'
                + '</tfoot>';
            })()
          : '')
      + '</table>'
      // v55.83-A.6.27.72 HOTFIX 33 — Structured breakdown card per Max v2 feedback.
      // Don't collapse Open Invoice + Our Prepaid into a single line. Show every
      // component that contributes to the net, then the net itself, big and bold.
      + (function () {
          var rowsArr = [];
          if (simCur) {
            if (simCur.theirOpenInvoices > 0.005) rowsArr.push({ label: 'Open invoice', val: simCur.theirOpenInvoices, color: '#15803d' });
            if (simCur.ourOpenBills > 0.005)      rowsArr.push({ label: 'Open bill', val: simCur.ourOpenBills, color: '#b91c1c' });
            if (simCur.theirPrepaid > 0.005)      rowsArr.push({ label: 'Their credit / prepaid', val: simCur.theirPrepaid, color: '#15803d' });
            if (simCur.ourPrepaid > 0.005)        rowsArr.push({ label: 'Our credit / prepaid', val: simCur.ourPrepaid, color: '#15803d' });
          }
          var bdHtml = rowsArr.length > 0
            ? '<table style="width:100%; border:none; margin:0; font-size:11px;">'
              + rowsArr.map(function (r) {
                  return '<tr><td style="border:none; padding:2px 0; color:#475569;">' + escapeHtml(r.label) + '</td>'
                       + '<td style="border:none; padding:2px 0; text-align:right; font-family:monospace; font-weight:700; color:' + r.color + ';">' + escapeHtml(fmtMoney(r.val)) + ' ' + escapeHtml(cur) + '</td></tr>';
                }).join('')
              + '</table>'
              + '<div style="border-top:1px solid ' + balanceColor + '; margin-top:8px; padding-top:8px;">'
            : '';
          return '<div class="balance-box" style="border-color:' + balanceColor + '; background:' + bgColor + ';">'
            + bdHtml
            + '<div class="balance-label">' + balanceLabel + '</div>'
            + '<div class="balance-value" style="color:' + balanceColor + ';">' + fmtMoney(Math.abs(cs.balance)) + ' ' + escapeHtml(cur) + '</div>'
            + (rowsArr.length > 0 ? '</div>' : '')
            + '</div>';
        })()
      + '</div>';
  }

  // v55.83-A.6.27.72 HOTFIX 33 — Combined chronological layout (Max v2: "should
  // be an option to see the same view as we see the ledger with everything
  // combined"). One table, all currencies interleaved by date, per-currency
  // running balance columns with active/dim contrast like the live ledger.
  function combinedSectionHtml() {
    var applications = (simulation && simulation.applications) || {};
    function tLabel(typeKey) {
      var en = t18n(typeKey, 'en', perspective);
      if (!bilingual) return en;
      var ar = t18n(typeKey, 'ar', perspective);
      return en + '<br><span class="ar-sub" dir="rtl">' + ar + '</span>';
    }
    // Build chronological list across all currencies
    var allRows = (entries || []).slice().sort(function (a, b) {
      var d = (a.entry_date || '').localeCompare(b.entry_date || '');
      return d !== 0 ? d : (a.created_at || '').localeCompare(b.created_at || '');
    });
    var running = {};
    currencies.forEach(function (c) { running[c] = 0; });
    var rowsHtml = '';
    allRows.forEach(function (e) {
      var entryCur = e._currency || String(e.currency || 'USD').toUpperCase();
      var credit = Number(e.credit_amount || 0);
      var debit = Number(e.debit_amount || 0);
      var signed;
      switch (e.transaction_type) {
        case 'sales_invoice':     signed = +credit; break;
        case 'vendor_bill':       signed = -debit; break;
        case 'payment_received':  signed = -credit; break;
        case 'payment_sent':      signed = +debit; break;
        case 'credit_adjustment': signed = debit - credit; break;
        default:                  signed = credit - debit;
      }
      running[entryCur] = (running[entryCur] || 0) + signed;
      // AR / AP sides
      var arSide = 0, apSide = 0;
      switch (e.transaction_type) {
        case 'sales_invoice':    arSide = credit; break;
        case 'payment_received': arSide = credit; break;
        case 'vendor_bill':      apSide = debit; break;
        case 'payment_sent':     apSide = debit; break;
        case 'credit_adjustment': arSide = credit; apSide = debit; break;
        case 'offset':           arSide = credit; apSide = debit; break;
      }
      /* v55.83-GM: removed AR/AP amount swap — customer perspective is labels-only; the column
         headers already flip via i18n (they_owe_us → "You Owe Us", we_owe_them → "Owed to You"),
         so swapping the amounts too double-flipped (sales invoice showed under "Owed to You"). */
      // Colors by type — payment_sent green not red
      var arColor = '#15803d', apColor = '#b91c1c';
      if (e.transaction_type === 'payment_sent') apColor = '#15803d';
      if (e.transaction_type === 'credit_adjustment') { apColor = '#15803d'; arColor = '#475569'; }
      var invoiceColor = e.transaction_type === 'sales_invoice' ? '#1d4ed8'
                       : e.transaction_type === 'vendor_bill' ? '#7e22ce' : null;
      var arIsPmt = (e.transaction_type === 'payment_received'); // v55.83-GT — payment = reduction
      var arCellHtml = arSide > 0.005 ? '<span style="color:' + (arIsPmt ? '#0d9488' : (invoiceColor || arColor)) + '">' + (arIsPmt ? '− ' : '') + escapeHtml(fmtMoney(arSide)) + '</span>' : '';
      var apCellHtml = apSide > 0.005
        ? (apColor === '#15803d'
            ? '<span style="color:' + apColor + '">' + escapeHtml(fmtMoney(apSide)) + '</span><div style="font-size:9px;color:#0f766e;font-style:italic;opacity:0.75;margin-top:2px;">reduces what we owe</div>'
            : '<span style="color:' + (invoiceColor || apColor) + '">' + escapeHtml(fmtMoney(apSide)) + '</span>')
        : '';
      // Open balance + linkage
      var isInvoiceOrBill = (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill');
      var remainingCellHtml = '';
      if (isInvoiceOrBill) {
        var orig = e.transaction_type === 'sales_invoice' ? credit : debit;
        var ap = applications[e.id] || 0;
        var remaining = Math.max(0, orig - ap);
        var links = offsetsByTarget[e.id] || [];
        var linkLine = '';
        if (links.length > 0) {
          var sortedLinks = links.slice().sort(function (a, b) { return b.amount - a.amount; });
          var headlineRef = sortedLinks[0].otherRef;
          var moreCount = sortedLinks.length - 1;
          var moreText = moreCount > 0 ? ' + ' + moreCount + ' more' : '';
          var isPartial = remaining > 0.005;
          var otherTypeKey = e.transaction_type === 'vendor_bill' ? 'type_sales_invoice_short' : 'type_vendor_bill_short';
          var phraseEn = (isPartial ? t18n('partially_applied', 'en') : t18n('paid_by_credit', 'en'))
                       + ' ' + t18n(otherTypeKey, 'en');
          linkLine = '<div style="font-size:9px;color:#64748b;margin-top:3px;font-style:italic">' + phraseEn + ' <strong>' + escapeHtml(headlineRef) + '</strong>' + moreText + '</div>';
        }
        if (remaining > 0.005) {
          remainingCellHtml = '<span style="color:' + (invoiceColor || '#b45309') + ';font-weight:700">' + t18n('open', 'en') + ' ' + escapeHtml(fmtMoney(remaining)) + '</span>' + linkLine;
        } else {
          remainingCellHtml = '<span style="background:#15803d;color:white;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:700">' + t18n('paid', 'en') + '</span>' + linkLine;
        }
      }
      // Description block
      var rawDesc = String(e.description || '');
      var autoSyncMatch = rawDesc.match(/^(.+?)\s*Auto-synced from invoice .+?\.\s*Edit the invoice to change this entry\.\s*$/i);
      var mainDesc = autoSyncMatch ? autoSyncMatch[1].trim() : rawDesc;
      var hasAutoSync = !!autoSyncMatch;
      var autoSyncHtml = hasAutoSync ? '<div class="auto-sync-note">auto-synced from invoice</div>' : '';
      var descColorStyle = invoiceColor ? ' style="color:' + invoiceColor + '; font-weight:600"' : '';
      // Type label
      var typeLabel = tLabel(e.transaction_type);
      // Currency tag
      var curTag = '<span style="display:inline-flex;align-items:center;gap:5px;font-weight:700;color:' + (entryCur === 'USD' ? '#0369a1' : '#b45309') + ';">'
                 + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + (entryCur === 'USD' ? '#0ea5e9' : '#f59e0b') + ';"></span>'
                 + entryCur + '</span>';
      // Row tint by currency
      var rowTint = entryCur === 'USD' ? 'background:rgba(14,165,233,0.04);' : 'background:rgba(245,158,11,0.04);';
      // Running balance cells (one per currency, active bold + dim others)
      var runCells = '';
      currencies.forEach(function (c) {
        var rb = running[c] || 0;
        var isActive = (c === entryCur);
        var cls = isActive ? 'color:' + (rb > 0 ? '#15803d' : rb < 0 ? '#b91c1c' : '#475569') + ';font-weight:800;' : 'color:#cbd5e1;opacity:0.6;';
        runCells += '<td class="num" style="' + cls + '">' + escapeHtml(fmtSignedMoney(rb)) + ' ' + escapeHtml(c) + '</td>';
      });
      if (e.transaction_type === 'offset') return;  // hide offset rows
      rowsHtml += '<tr style="' + rowTint + '">'
        + '<td>' + escapeHtml(fmtDate(e.entry_date)) + '</td>'
        + '<td style="font-size:10px"><strong>' + typeLabel + '</strong></td>'
        + '<td class="desc-cell"' + descColorStyle + '><div class="desc-main">' + escapeHtml(mainDesc) + '</div>' + autoSyncHtml + '</td>'
        + '<td class="mono">' + escapeHtml(e.reference_number || '') + '</td>'
        + '<td style="text-align:center">' + curTag + '</td>'
        + '<td class="num">' + arCellHtml + '</td>'
        + '<td class="num">' + apCellHtml + '</td>'
        + '<td class="num">' + remainingCellHtml + '</td>'
        + runCells
        + '</tr>';
    });

    // Header row with all running-bal columns per currency
    var runHeaders = currencies.map(function (c) {
      return '<th class="col-run num">' + (bilingual ? stackedH('running_bal') : t18n('running_bal', 'en')) + ' ' + escapeHtml(c) + '</th>';
    }).join('');

    // Per-currency breakdown cards at the bottom
    var breakdownCards = currencies.map(function (c) {
      var cs = byCurrency[c];
      var simC = (simulation && simulation.byCurrency && simulation.byCurrency[c]) || null;
      var balanceColor = cs.balance > 0 ? '#15803d' : cs.balance < 0 ? '#b91c1c' : '#475569';
      var bgColor = cs.balance >= 0 ? '#f0fdf4' : '#fef2f2';
      var balanceLabelKey = cs.balance > 0 ? 'they_owe_us_dir' : cs.balance < 0 ? 'we_owe_them_dir' : 'settled';
      var balanceLabel = bilingual
        ? t18n(balanceLabelKey, 'en', perspective) + ' / ' + t18n(balanceLabelKey, 'ar', perspective)
        : t18n(balanceLabelKey, 'en', perspective);
      var rowsArr = [];
      if (simC) {
        if (simC.theirOpenInvoices > 0.005) rowsArr.push({ label: 'Open invoice', val: simC.theirOpenInvoices, color: '#15803d' });
        if (simC.ourOpenBills > 0.005)      rowsArr.push({ label: 'Open bill', val: simC.ourOpenBills, color: '#b91c1c' });
        if (simC.theirPrepaid > 0.005)      rowsArr.push({ label: 'Their credit / prepaid', val: simC.theirPrepaid, color: '#15803d' });
        if (simC.ourPrepaid > 0.005)        rowsArr.push({ label: 'Our credit / prepaid', val: simC.ourPrepaid, color: '#15803d' });
      }
      var bdInner = rowsArr.length > 0
        ? '<table style="width:100%; border:none; margin:0; font-size:11px;">'
          + rowsArr.map(function (r) { return '<tr><td style="border:none;padding:2px 0;color:#475569;">' + escapeHtml(r.label) + '</td><td style="border:none;padding:2px 0;text-align:right;font-family:monospace;font-weight:700;color:' + r.color + ';">' + escapeHtml(fmtMoney(r.val)) + ' ' + escapeHtml(c) + '</td></tr>'; }).join('')
          + '</table><div style="border-top:1px solid ' + balanceColor + ';margin-top:8px;padding-top:8px;">'
        : '';
      return '<div class="balance-box" style="flex:1;border-color:' + balanceColor + ';background:' + bgColor + ';">'
        + '<div style="font-size:11px;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;color:' + (c === 'USD' ? '#0369a1' : '#b45309') + ';margin-bottom:6px;">' + escapeHtml(c) + ' Summary</div>'
        + bdInner
        + '<div class="balance-label">' + balanceLabel + '</div>'
        + '<div class="balance-value" style="color:' + balanceColor + ';">' + fmtMoney(Math.abs(cs.balance)) + ' ' + escapeHtml(c) + '</div>'
        + (rowsArr.length > 0 ? '</div>' : '')
        + '</div>';
    }).join('');

    return '<div class="currency-section">'
      + '<h2>Combined Ledger — All Currencies, Chronological</h2>'
      + '<div style="font-size:11px;color:#64748b;margin-bottom:8px;">Interleaved by date — running balance columns dim when the row\'s currency doesn\'t match the column.</div>'
      + '<table>'
      + '<thead><tr>'
      + '<th class="col-date">' + (bilingual ? stackedH('date') : t18n('date', 'en')) + '</th>'
      + '<th class="col-type">' + (bilingual ? stackedH('type') : t18n('type', 'en')) + '</th>'
      + '<th class="col-desc">' + (bilingual ? stackedH('description') : t18n('description', 'en')) + '</th>'
      + '<th class="col-ref">' + (bilingual ? stackedH('reference') : t18n('reference', 'en')) + '</th>'
      + '<th class="col-cur">Currency</th>'
      + '<th class="col-money num" style="color:#15803d">' + (bilingual ? stackedH('they_owe_us', perspective) : t18n('they_owe_us', 'en', perspective)) + '</th>'
      + '<th class="col-money num" style="color:#b91c1c">' + (bilingual ? stackedH('we_owe_them', perspective) : t18n('we_owe_them', 'en', perspective)) + '</th>'
      + '<th class="col-open num" style="color:#b45309">' + (bilingual ? stackedH('open_balance') : t18n('open_balance', 'en')) + '</th>'
      + runHeaders
      + '</tr></thead>'
      + '<tbody>' + (rowsHtml || '<tr><td colspan="' + (8 + currencies.length) + '" style="padding:20px;text-align:center;color:#666">No entries</td></tr>') + '</tbody>'
      + '</table>'
      + '<div style="display:flex;gap:14px;margin-top:14px;">' + breakdownCards + '</div>'
      + '</div>';
  }

  var allSections = currencies.length === 0
    ? '<p style="text-align:center; color:#666; padding:24px;">No ledger entries yet.</p>'
    : (layout === 'combined' ? combinedSectionHtml() : currencies.map(sectionHtml).join(''));

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
    // v55.83-A.6.27.72 HOTFIX 12 — Replaced strict `page-break-inside: avoid` which forced
    // the ENTIRE first currency section onto a new page (leaving page 1 blank) whenever the
    // section was taller than the remaining space after the header. Now we just keep the
    // section header + first few rows together, but the table body can break naturally.
    + '.currency-section { margin-bottom: 36px; padding-top: 12px; border-top: 2px solid #1e293b; }'
    + '.currency-section:first-of-type { border-top: none; padding-top: 0; }'
    + '.currency-section > h2 { font-size: 18px; font-weight: 900; letter-spacing: 0.04em; margin: 0 0 4px; text-transform: uppercase; color: #0f172a; page-break-after: avoid; break-after: avoid; }'
    + '.currency-section thead { display: table-header-group; }'
    + '.currency-section tr { page-break-inside: avoid; break-inside: avoid; }'
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
    + '.balance-box { margin-top: 14px; padding: 14px 18px; border: 2px solid; border-radius: 6px; }'
    + '.balance-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; font-weight: 800; }'
    + '.balance-value { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; line-height: 1.1; margin-top: 4px; }'
    + '.convention { margin-top: 24px; padding: 8px 12px; background: #fafafa; border-left: 3px solid #999; font-size: 10px; color: #555; }'
    + '.multi-currency-note { margin: 12px 0 0 0; padding: 6px 10px; background: #fef3c7; border-left: 3px solid #d97706; font-size: 10px; color: #451a03; }'
    // v55.83-A.6.27.72 HOTFIX 33 — Print/PDF layout enforcement per Max v2 feedback.
    // Without max-width the table stretches infinitely across whatever monitor
    // you're on, leaving huge dead space between description and numbers.
    // Lock the entire report into A4-equivalent (210mm = ~794px) for print and
    // 950px for screen preview. Lock column widths so they don't auto-expand.
    + '.report-page { max-width: 950px; margin: 0 auto; padding: 16px 24px; box-sizing: border-box; }'
    + 'table { table-layout: fixed; }'
    + 'th.col-date    { width: 9%;  }'
    + 'th.col-type    { width: 12%; }'
    + 'th.col-desc    { width: 30%; }'
    + 'th.col-ref     { width: 11%; }'
    + 'th.col-cur     { width: 6%;  text-align: center; }'
    + 'th.col-money   { width: 10%; text-align: right; }'
    + 'th.col-open    { width: 12%; text-align: right; }'
    + 'th.col-run     { text-align: right; }'  /* claims remainder */
    + 'td { word-break: break-word; overflow-wrap: anywhere; }'
    + 'td.num, th.num, .col-money, .col-open, .col-run { white-space: nowrap !important; word-break: normal !important; overflow-wrap: normal !important; }'
    + 'td.desc-cell .desc-main { font-weight: 600; }'
    + 'td.desc-cell .auto-sync-note { font-size: 9px; color: #94a3b8; margin-top: 2px; font-style: italic; }'
    + 'td.desc-cell .desc-ref { font-size: 10px; color: #64748b; font-family: "SF Mono", Menlo, monospace; margin-top: 2px; }'
    + '@page { size: A4 portrait; margin: 12mm; }'
    + '@media print {'
    + '  body { background: white; color: black; margin: 0; }'
    + '  .no-print { display: none !important; }'
    + '  .report-page { width: 100%; max-width: 100%; padding: 0; }'
    + '  table { font-size: 10px; }'
    + '  th, td { padding: 4px 5px; }'
    /* Force background colors (red/green totals + paid pill) to print */
    + '  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }'
    + '}'
    + '.no-print { margin-bottom: 16px; padding: 10px 12px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 11px; color: #334155; display: flex; align-items: center; gap: 10px; }'
    + '.no-print button { padding: 6px 14px; background: #1e293b; color: white; border: 0; border-radius: 4px; font-weight: 700; cursor: pointer; }'
    + '</style>'
    + '</head><body>'
    + '<div class="report-page">'
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
    + '<div class="statement-title">' + (function () {
        var titleKey = perspective === 'customer' ? 'customer_statement' : 'internal_statement';
        if (bilingual) {
          return t18n(titleKey, 'en') + ' / <span dir="rtl">' + t18n(titleKey, 'ar') + '</span>';
        }
        return t18n(titleKey, 'en');
      })() + '</div>'
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
    + '</div>' /* close .report-page */
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
export function exportAccountLedgerToExcel(account, entity, entries, summary, opts) {
  opts = opts || {};
  var perspective = opts.perspective === 'customer' ? 'customer' : 'internal';
  var bilingual = opts.bilingual === true;
  if (!account) return;
  // v55.83-A.6.27.72 HOTFIX 12 — Hide offset rows from Excel export to match screen view.
  entries = (entries || []).filter(function (e) { return e.transaction_type !== 'offset'; });

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

  // v55.83-A.6.27.72 HOTFIX 30/31 — Excel headers via i18n with bilingual stacking
  // (Excel cells support multi-line via \n). Customer-friendly labels via perspective.
  function xlH(key) {
    return bilingual ? (t18n(key, 'en', perspective) + '\n' + t18n(key, 'ar', perspective)) : t18n(key, 'en', perspective);
  }
  var colHeaders = [xlH('date'), xlH('type'), xlH('description'), xlH('reference'), 'Currency',
                    xlH('they_owe_us'), xlH('we_owe_them'), xlH('open_balance')];
  currencies.forEach(function (cur) { colHeaders.push((bilingual ? t18n('running_bal', 'en') + '\n' + t18n('running_bal', 'ar') : t18n('running_bal', 'en')) + ' ' + cur); });
  rows.push(colHeaders);

  // Per-currency running totals (rolling)
  var running = {}; // cur → running balance
  currencies.forEach(function (c) { running[c] = 0; });

  // v55.83-A.6.27.72 HOTFIX 30/31 — Excel type labels via i18n with perspective + bilingual
  function xlType(typeKey) {
    var en = t18n(typeKey, 'en', perspective);
    if (!bilingual) return en;
    return en + '\n' + t18n(typeKey, 'ar', perspective);
  }

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
      xlType(e.transaction_type) || '',
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
    rows.push(['', '', (perspective === 'customer' ? 'Total You Owe Us:' : 'Total AR (They Owe Us):'), '', cur, totAR, '', '']);
    rows.push(['', '', (perspective === 'customer' ? 'Total Owed to You:' : 'Total AP (We Owe Them):'), '', cur, '', totAP, '']);
    rows.push(['', '', 'Net ' + cur + ' Position:', subLabel, cur, '', '', netP]);
    rows.push(['', '', '', '', '', '', '', '']);
  });

  rows.push(['', '', '', '', '', '', '', '']);
  currencies.forEach(function (cur) {
    var cs = byCurrency[cur] || { balance: 0 };
    var label = cs.balance > 0 ? (perspective === 'customer' ? 'You owe us' : 'They owe us') : cs.balance < 0 ? (perspective === 'customer' ? 'Owed to you' : 'We owe them') : 'Settled';
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
