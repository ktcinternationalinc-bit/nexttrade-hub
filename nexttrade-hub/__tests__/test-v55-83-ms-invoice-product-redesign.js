// v55.83-MS — Codex Round-3 agreed BUILD SPEC: combined Approve&Push + catalog-first Default Invoice Product.
// Covers the 7 Codex release checks (static shape) + the picker + the prerequisite ladder.
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) { if (cond) console.log('OK ' + label); else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('FAIL ' + label + (hint ? ' — ' + hint : '')); } }
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var push = rd('src/app/api/wave/push-invoice-v2/route.js');
var psetup = rd('src/app/api/wave/product-setup/route.js');
var invui = rd('src/components/AccountingInvoicesTab.jsx');
var sync = rd('src/components/WaveSyncCenter.jsx');
var icsv = rd('src/app/api/wave/import-transaction-csv/route.js');
var bank = rd('src/components/BankReviewTab.jsx');

// ── push-invoice-v2 (deltas 1-3) ──
ok('1 (Codex test1): default required ONLY for unmapped lines — per-line product wins, block scans finalItems',
  /var lineProd = items\[k\]\.wave_product_id \|\| productId \|\| null/.test(push) &&
  /var missingProduct = false/.test(push) && /if \(missingProduct\)/.test(push) &&
  /var noDefault = \(productMode === 'none'\)/.test(push));
ok('1b: the OLD unconditional no-default early block is gone (no `if (!productId) {` pre-block)',
  !/if \(!productId\) \{\s*\n\s*var setupMsg/.test(push));
ok('2 (Codex test2): block message is catalog-first (Refresh from Wave / Choose a Wave product), NOT Create NextTrade Hub Item',
  /Refresh from Wave/.test(push) && /Choose a Wave product/.test(push));
ok('3 (delta 3): exact-name "NextTrade Hub Item" push fallback is RETIRED',
  !/found_by_name/.test(push) && !/name === 'NextTrade Hub Item'/.test(push));
ok('4 (delta 2 / Codex test4): hideName:true sent; exact Hub line description pushed',
  /hideName: true/.test(push) && /description: items\[k\]\.description \|\| 'Hub invoice line'/.test(push));

// ── product-setup (delta 4 + cached) ──
ok('5 (Codex test3 / delta 4): select verifies via wave_products MIRROR (beyond page 1), rejects archived + not-sold',
  /from\('wave_products'\)\.select\('wave_product_id, name, is_sold, is_archived'\)/.test(psetup) &&
  /match\.is_archived === true/.test(psetup) && /match\.is_sold === false/.test(psetup));
ok('6: product-setup has mode:cached returning the wave_products mirror (the picker source)',
  /mode === 'cached'/.test(psetup) && /from\('wave_products'\)\.select\('wave_product_id, name, description, is_sold, is_archived'\)/.test(psetup));

// ── AccountingInvoicesTab (delta 5) ──
ok('7 (Codex test5): selecting a Wave product is metadata-only — NO description clobber',
  /function setLineWaveProduct\(i, productId\)/.test(invui) && !/c\[i\]\.description = waveDesc/.test(invui) &&
  /c\[i\]\.wave_product_id = productId \|\| ''/.test(invui));

// ── WaveSyncCenter — combined Approve & Push (Codex test6) ──
ok('8 (Codex test6): approveAndPushInvoice approves the Hub invoice THEN pushes to Wave, surfacing a blocked prereq',
  /function approveAndPushInvoice\(invoiceId\)/.test(sync) &&
  /action: 'set_approval'/.test(sync) && /\/api\/wave\/push-invoice-v2/.test(sync) &&
  /pj && pj\.blocked/.test(sync));

// ── WaveSyncCenter — catalog-first picker ──
ok('9: Default Invoice Product picker = Refresh from Wave (sync-products) + cached dropdown + auto-link on select',
  /function refreshProductsFromWave\(\)/.test(sync) && /\/api\/wave\/sync-products/.test(sync) &&
  /mode: 'cached'/.test(sync) && /runProductSetup\('select', pid/.test(sync));

// ── WaveSyncCenter — prerequisite ladder + labels ──
ok('10: blocked payment shows the dependency chain (approve invoice -> push invoice -> push payment), not a flat message',
  /Approve invoice ' \+ invNo \+ ' first/.test(sync) && /Push invoice ' \+ invNo \+ ' to Wave first/.test(sync));
ok('11: v55.83-MT — invoice rows show customer + number; the duplicate "Needs approval" invoice row is REMOVED (the payment row covers it)',
  /var invLabel = 'Invoice · '/.test(sync) && !/key: 'invneedsapproval:'/.test(sync) && !/var invoiceIdsWithPendingPayment = /.test(sync));
ok('12: payment row carries prereq fields + an Approve&Push button',
  /prereqNeedsApproval: prereqNeedsApproval/.test(sync) && /approveAndPushInvoice\(q\.prereqInvoiceId\)/.test(sync));

// ── Round-2 category/historical (folded into this batch) ──
ok('13: import-csv uses the shared detectAmountCol helper + paginates the category resolution read',
  /import \{ detectAmountCol \}/.test(icsv) && /var amountCol = detectAmountCol\(headers\)/.test(icsv) &&
  /while \(catGuard < 60\)/.test(icsv));
ok('14: BankReview no longer seeds the dropdown from the capped client fallback + clears on route failure',
  /void cats;/.test(bank) && /else \{ setWaveCategories\(\[\]\); setCatDiag\(\{ error:/.test(bank));
ok('15: the 4 cap-exposed category reads are paginated (push-transaction/push-payment/account-feed-owner/import-csv)',
  /var wcAll = \[\];/.test(rd('src/app/api/wave/push-transaction/route.js')) &&
  /var payCatsAll = \[\];/.test(rd('src/app/api/wave/push-payment/route.js')) &&
  /var afoAll = \[\];/.test(rd('src/app/api/wave/account-feed-owner/route.js')));

// ── Codex QA round (post-build) — #1 approved-invoice mapping, #2 dry-run preflight, #3 readiness ──
var invwrite = rd('src/app/api/accounting/invoice-write/route.js');
ok('16 (Codex QA #1): mapping-only server action set_line_product updates ONLY wave_product_id/name on a line (no financial edit), gated on invoices.edit',
  /action === 'set_line_product'/.test(invwrite) &&
  /var lpatch = \{ wave_product_id: body\.wave_product_id \|\| null, wave_product_name: body\.wave_product_name \|\| null \}/.test(invwrite) &&
  /assertPermission\(db, by, 'invoices\.edit', req\)/.test(invwrite));
ok('16b: invoice editor can map a product on a LOCKED (approved) existing line + persists via set_line_product',
  /function onLineProductChange\(i, productId\)/.test(invui) && /action: 'set_line_product'/.test(invui) &&
  /disabled=\{locked\(editing\) && !it\.id\}/.test(invui));
ok('17 (Codex QA #2): invoice dry-run runs the REAL product preflight (returns blocked) + the queue routes invoice dry-run to push-invoice-v2',
  /for \(dk = 0; dk < items\.length; dk\+\+\) \{ if \(!items\[dk\]\.wave_product_id && !dryDefault\)/.test(push) &&
  /dry_run: true, blocked: true/.test(push) &&
  /q\.action === 'invoice' \? '\/api\/wave\/push-invoice-v2'/.test(sync));
var msInvChecks = (sync.match(/var invChecks = \[[\s\S]{0,300}?\];/) || [''])[0];
ok('18 (Codex QA #3): invoice readiness no longer hard-requires a default product; default is NOT a blocking check and the blocked copy does not tell users to set it globally',
  /var invReady = !ph && canOperate && canWrite && !!\(reg && reg\.allow_invoice_push === true\);/.test(sync) &&
  !/var invReady =[^;]*&& hasInvProd;/.test(sync) &&
  !/default_invoice_product_id/.test(msInvChecks) &&
  !/before pushing invoices\. \(Set the Default Invoice Product/.test(sync) &&
  /A <b>Default Invoice Product is optional<\/b>/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MS invoice/product redesign tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
