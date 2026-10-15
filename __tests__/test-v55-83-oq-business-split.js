// v55.83-OQ — US vs Egypt business split (Max, Oct 13): dashboard shows ONE
// business at a time (US/USD default, Egypt/EGP its own toggle), a Paid-in-
// period card, and an All Invoices tab with open+closed+drafts per business —
// counting every Hub-entered invoice whether pushed to Wave or not.
var fs = require('fs');
var path = require('path');
function rd(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
var dash = rd('src/components/AccountingDashboard.jsx');
var bk = rd('src/components/BusinessBooksTab.jsx');
var at = rd('src/components/AccountingTab.jsx');
var failed = [];
function ok(l, c) { if (c) console.log('✓ ' + l); else { failed.push(l); console.log('✗ ' + l); } }

ok('OQ1: dashboard has the US/Egypt business toggle, US (USD) default',
  /useState\('US'\)/.test(dash) && /🇺🇸 US \(USD\)/.test(dash) && /🇪🇬 Egypt \(EGP\)/.test(dash) &&
  /bz === 'EG' \? 'EGP' : 'USD'/.test(dash));
ok('OQ2: the books split on the ACTIVE currency — the other business is never mixed in',
  /if \(cur !== activeCur\) \{/.test(dash) && /never mixed into/.test(dash));
ok('OQ3: money labels follow the active currency (EGP prefix on the Egypt book)',
  /function csym\(\) \{ return d && d\.activeCur === 'EGP' \? 'EGP ' : '\$'; \}/.test(dash) &&
  (dash.match(/csym\(\) \+ fmt\(n\)/g) || []).length >= 5);
ok('OQ4: new Paid-in-period card — payment rows dated in the window, business-scoped, clickable, honest about Wave lifetime amounts',
  /Paid in period \(/.test(dash) && /paidPeriodTotal/.test(dash) &&
  /pf && pd < pf\) \{ return; \}/.test(dash) && /curByInv\[p\.accounting_invoice_id\] !== activeCur/.test(dash) &&
  /carry no per-payment dates/.test(dash));
ok('OQ5: All Invoices tab exists under Accounting with the same US/Egypt toggle',
  /\['all_invoices', '📚 All Invoices'\]/.test(at) && /useState\('US'\)/.test(bk) &&
  /🇪🇬 Egypt \(EGP\)/.test(bk));
ok('OQ6: it shows EVERYTHING live — paid, partial, unpaid, drafts, credits — with status chips and filters',
  /'PAID'/.test(bk) && /'PARTIAL'/.test(bk) && /'UNPAID'/.test(bk) && /'DRAFT'/.test(bk) && /'CREDIT'/.test(bk) &&
  /\['open', 'Open'\]/.test(bk) && /\['paid', 'Closed \(paid\)'\]/.test(bk) && /\['draft', 'Drafts'\]/.test(bk));
ok('OQ7: Hub-entered invoices count whether pushed to Wave or not — push status is DISPLAY ONLY (In Wave column), never a filter',
  /in_wave: !!i\.wave_invoice_id/.test(bk) && /nothing hidden/.test(bk) &&
  !/wave_invoice_id\) \{ return; \}/.test(bk) && !/wave_sync_status[^,]*\) \{ return; \}/.test(bk));
ok('OQ8 (OV): paid = wave_imported_paid + non-void Hub payments; Hub drafts count, true Wave drafts stay out of money (matches the dashboard)',
  /Number\(i\.wave_imported_paid\) \|\| 0\) \+ \(payByInv\[i\.id\] \|\| 0\)/.test(bk) &&
  /rowCur === activeCur && !isWaveDraft\) \{ tInvoiced/.test(bk) && /entered, not approved yet/.test(bk));
ok('OQ9: period defaults June 1 2026 → with presets + custom; CSV includes status, source and in-Wave',
  /useState\('2026-06-01'\)/.test(bk) && /'All history'/.test(bk) && /in_wave \? 'yes' : 'no'/.test(bk));
ok('OQ10: permission-gated via the proven AR invoice-balances helper',
  /canViewArInvoiceBalances\(isSuperAdmin, modulePerms/.test(bk) && /Restricted — needs "AR: View Invoice Balances"/.test(bk));

if (failed.length) { console.log('FAILED (' + failed.length + '):'); failed.forEach(function (x) { console.log('  - ' + x); }); process.exit(1); }
else { console.log('ALL CHECKS PASSED — v55.83-OQ business split'); }

// ══════════════════════════════════════════════════════════════════
// v55.83-OR ADDENDUM — Max: "there are still EGP customers from the Egypt
// database in the USD invoices." Currency alone can't split the books; the
// BUSINESS is a property of the CUSTOMER (business_tag), seeded from EGP
// history, flippable in one click on the Customers screen.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fr2 = require('fs'); var pr2 = require('path');
  function rr(rel) { return fr2.readFileSync(pr2.join(__dirname, '..', rel), 'utf8'); }
  var dash2 = rr('src/components/AccountingDashboard.jsx');
  var bk2 = rr('src/components/BusinessBooksTab.jsx');
  var cu2 = rr('src/components/AccountingCustomersTab.jsx');
  var sq2 = rr('sql/v55-83-OR-customer-business.sql');
  var f = [];
  function okR(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okR('OR1: SQL adds business_tag and SEEDS egypt from customers with any EGP invoice (idempotent)',
    /ADD COLUMN IF NOT EXISTS business_tag text;/.test(sq2) &&
    /WHERE business_tag IS NULL/.test(sq2) && /currency = 'EGP'/.test(sq2));
  okR('OR2/OS/OV: dashboard uses the SHARED Wave-bound rule — arBizAll = eligible + this business, arInv adds the period',
    /businessOfInvoice\(i, custBizTag\)/.test(dash2) &&
    /isArEligible\(i\) && bizOf\(i\) === bz/.test(dash2));
  okR('OR3/OS: All Invoices uses the same shared rule',
    /businessOfInvoice\(i, custBizTag\)/.test(bk2) && /if \(bizOfInv\(i\) !== biz\) \{ return; \}/.test(bk2));
  okR('OR4 (OV): money cards stay single-currency (Wave drafts excluded); other-currency rows listed with their OWN symbol, counted, never summed',
    /rowCur === activeCur && !isWaveDraft\) \{ tInvoiced/.test(bk2) && /otherCurCount/.test(bk2) &&
    /r\.cur === 'EGP' \? 'EGP ' : '\$'/.test(bk2));
  okR('OR5: paid-in-period respects the business classification too',
    /bizOfInv\(parent\) !== biz/.test(bk2));
  okR('OR6: the Customers screen has the one-click US↔Egypt switch, logged, with stopPropagation',
    /business_tag: next/.test(cu2) && /🇪🇬 Egypt/.test(cu2) && /🇺🇸 US/.test(cu2) &&
    /e\.stopPropagation\(\)/.test(cu2) && /Set ' \+ \(r\.company_name/.test(cu2));
  if (f.length) { console.log('OR FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OR ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-OS ADDENDUM — Max's definitive rule, verbatim: "they should only
// come from the ones that are entered or subject to pending move to wave.
// that is the usa business." US = Wave-bound; Egypt = everything else.
// FUNCTIONAL tests run the real shared rule.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fs3 = require('fs'); var ps3 = require('path');
  function r3(rel) { return fs3.readFileSync(ps3.join(__dirname, '..', rel), 'utf8'); }
  var libSrc = r3('src/lib/business-of.js').replace(/export function/g, 'function');
  libSrc += '\nmodule.exports = { businessOfInvoice: businessOfInvoice };';
  var tmp3 = ps3.join(__dirname, '.tmp-business-of.cjs');
  fs3.writeFileSync(tmp3, libSrc);
  var bo = require(tmp3).businessOfInvoice;
  fs3.unlinkSync(tmp3);
  var inv = r3('src/components/AccountingInvoicesTab.jsx');
  var f = [];
  function okS(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okS('OS1 functional: Wave-imported, Wave-pushed, and silo-bound (pending push) invoices are US',
    bo({ source: 'wave_import', currency: 'USD' }, {}) === 'US' &&
    bo({ wave_invoice_id: 'w1', currency: 'USD' }, {}) === 'US' &&
    bo({ wave_business_id: 'biz1', currency: 'USD', approval_status: 'draft' }, {}) === 'US');
  okS('OS2 functional: a USD invoice with NO Wave linkage is EGYPT — exactly the leak Max reported',
    bo({ currency: 'USD', source: 'hub' }, {}) === 'EG' &&
    bo({ currency: 'EGP', wave_business_id: 'biz1' }, {}) === 'EG');
  okS('OS3 functional: the customer tag overrides in BOTH directions',
    bo({ source: 'wave_import', currency: 'USD', accounting_customer_id: 'c1' }, { c1: 'egypt' }) === 'EG' &&
    bo({ currency: 'USD', source: 'hub', accounting_customer_id: 'c2' }, { c2: 'us' }) === 'US');
  okS('OS4: the main Invoices LIST opens on the US business with US/Egypt/All chips',
    /useState\('US'\)/.test(inv) && /businessOfInvoice\(r, custTagByIdOS\) === bizFilter/.test(inv) &&
    /🇺🇸 US/.test(inv) && /🇪🇬 Egypt/.test(inv) &&
    /invoices in Wave or pending push to Wave/.test(inv));
  okS('OS5: proformas and the ALL chip bypass the filter (nothing becomes unreachable)',
    /if \(!isInvoice\(\)\) \{ return true; \}/.test(inv) && /bizFilter === 'ALL'/.test(inv));
  if (f.length) { console.log('OS FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OS ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-OT ADDENDUM — Max, Oct 14: 65 of 75 US invoices were invisible on
// the dashboard (approved-only AR rule vs his draft-based workflow), and
// Egyptian test customers with Wave linkage sat in the US book.
// ══════════════════════════════════════════════════════════════════
(function () {
  var ft = require('fs'); var pt4 = require('path');
  function r4(rel) { return ft.readFileSync(pt4.join(__dirname, '..', rel), 'utf8'); }
  var el = r4('src/lib/ar-eligibility.js');
  var dash4 = r4('src/components/AccountingDashboard.jsx');
  var bk4 = r4('src/components/BusinessBooksTab.jsx');
  var sq4 = r4('sql/v55-83-OT-egypt-customers.sql');
  var f = [];
  function okT4(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okT4('OT1: Hub-entered invoices count toward AR regardless of approval status (Max\'s rule, quoted in the lib)',
    /return true;\s*\/\/ Hub-created: entered = counts/.test(el) &&
    /ALL invoices that have been/.test(el) && !/approval_status === 'approved';\s*\/\/ Hub-created: must be approved/.test(el));
  okT4('OT2: dead record statuses and true Wave drafts are still excluded (the guard that matters stays)',
    /rs === 'void' \|\| rs === 'cancelled' \|\| rs === 'archived' \|\| rs === 'deleted'/.test(el) &&
    /return ws !== 'DRAFT';/.test(el));
  okT4('OT3: the dashboard no longer claims drafts are excluded',
    /every entered invoice counts/.test(dash4) && !/drafts excluded/.test(dash4));
  okT4('OT4 (OV): All Invoices money totals include HUB drafts (entered = real); only true Wave drafts stay out, matching the dashboard',
    /Hub drafts are REAL invoices/.test(bk4) && /rowCur === activeCur && !isWaveDraft\) \{ tInvoiced/.test(bk4) &&
    /drafts counted — entered = real/.test(bk4));
  okT4('OT5: the Egyptian-side customers from Max\'s CSV are tagged by SQL (override beats Wave linkage), SAAD EGYPT deliberately not among them',
    /ILIKE 'Adel Saeed'/.test(sq4) && /ILIKE 'Ahmed Abdel Hafiz'/.test(sq4) && /ILIKE 'ABU FASIF'/.test(sq4) &&
    /ILIKE 'A K TRADERS'/.test(sq4) && /ILIKE '1 is 3 Company Limited'/.test(sq4) &&
    !/SAAD EGYPT'/.test(sq4) && /SAAD EGYPT is NOT here/.test(sq4));
  if (f.length) { console.log('OT FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OT ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-OU ADDENDUM — Max's screenshot: Paid-in-period drill showed
// Balance 0.00 on partially-paid invoices (hardcoded 0) and "Paid 0.00"
// noise rows; overpayments must show.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fu = require('fs'); var pu = require('path');
  var du = fu.readFileSync(pu.join(__dirname, '..', 'src/components/AccountingDashboard.jsx'), 'utf8');
  var f = [];
  function okU2(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okU2('OU1: ONE ROW PER INVOICE — payments in the period aggregated (summed), latest payment date kept',
    /paidAgg\[iid\]\.paid = r2\(paidAgg\[iid\]\.paid \+ \(Number\(p\.amount\) \|\| 0\)\)/.test(du) &&
    /if \(pd > paidAgg\[iid\]\.inv_date\) \{ paidAgg\[iid\]\.inv_date = pd; \}/.test(du) &&
    /ONE ROW PER INVOICE/.test(du));
  okU2('OU1b: Balance = the invoice real remaining balance (openOf), never a hardcoded 0',
    /balance: mi\.id \? openOf\(mi\) : 0/.test(du) && !/paid: r2\(p\.amount\), balance: 0,/.test(du));
  okU2('OU2: zero-amount payment rows are skipped (no "Paid 0.00" noise)',
    /Math\.abs\(Number\(p\.amount\) \|\| 0\) < 0\.005\) \{ return; \}/.test(du));
  okU2('OU3: the card shows invoices AND payment count; the drill note explains the aggregated columns',
    /invoice\(s\) · ' \+ \(d\.paidPayCount \|\| 0\) \+ ' payment\(s\)'/.test(du) &&
    /One row per INVOICE/.test(du) && /\{drill\.unit \|\| 'invoice\(s\)'\}/.test(du));
  okU2('OU4: negative balances render violet in the drill (overpayment visible)',
    /t\.balance < 0 \? 'text-violet-700'/.test(du));
  if (f.length) { console.log('OU FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OU ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-OV ADDENDUM — consistency audit (Max: "make sure there's no
// inconsistencies between all the different cards"). Five drifts found
// and pinned to ONE canon: dashboard formula + shared business rule.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fv = require('fs'); var pv = require('path');
  function rv(rel) { return fv.readFileSync(pv.join(__dirname, '..', rel), 'utf8'); }
  var dv = rv('src/components/AccountingDashboard.jsx');
  var bv = rv('src/components/BusinessBooksTab.jsx');
  var rr = rv('src/app/api/reconcile/nexttrade/route.js');
  var sv = rv('src/app/api/accounting/sales-report/route.js');
  var pvr = rv('src/app/api/accounting/pnl/route.js');
  var ov = rv('src/components/OpenBalancesTab.jsx');
  var f = [];
  function okV(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okV('OV1: Paid-in-period counts payments by PAYMENT date — invoice date no longer gates them (arBizAll feeds the maps)',
    /var arBizAll = inv\.filter\(function \(i\) \{ return isArEligible\(i\) && bizOf\(i\) === bz; \}\);/.test(dv) &&
    /arBizAll\.forEach\(function \(i\) \{ curByInv\[i\.id\]/.test(dv));
  okV('OV2: All Invoices money totals exclude true Wave drafts (matches the dashboard), Hub drafts still count',
    /var isWaveDraft = i\.wave_status === 'DRAFT';/.test(bv) && /rowCur === activeCur && !isWaveDraft\) \{ tInvoiced/.test(bv));
  okV('OV3: open_balances = ONE CANON — live only, no Wave drafts, business param, balance from payments not the stale column',
    /biz2 = body\.business === 'EG' \? 'EG' : 'US'/.test(rr) && /businessOfInvoice\(v, tag2\) !== biz2\) \{ return; \}/.test(rr) &&
    /payBy2\[v\.id\]/.test(rr) && !/gt\('balance_due', 0\.009\)/.test(rr));
  okV('OV4: the recon standing 💰 section uses the same canon (live, no Wave drafts, US business, payments-computed balance)',
    /businessOfInvoice\(v, custTagR\) !== 'US'\) \{ return; \}/.test(rr) && /paidC = r2OB\(\(Number\(v\.wave_imported_paid\)/.test(rr));
  okV('OV5: Sales Report AND P&L are business-aware via the shared rule (US default) — the Egyptian-USD leak is closed there too',
    /businessOfInvoice\(i, custTag\) === bizSel/.test(sv) && /businessOfInvoice\(i, custTag\) === bizSel/.test(pvr));
  okV('OV6: Open Balances screen has the US/Egypt toggle wired to the business param',
    /JSON\.stringify\(\{ action: 'open_balances'[^}]*business: b \|\| biz/.test(ov) && /🇪🇬 Egypt/.test(ov));
  if (f.length) { console.log('OV FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OV ADDENDUM CHECKS PASSED'); }
})();
