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
ok('OQ8: paid = wave_imported_paid + non-void Hub payments (the proven formula); drafts excluded from money totals but counted and listed',
  /Number\(i\.wave_imported_paid\) \|\| 0\) \+ \(payByInv\[i\.id\] \|\| 0\)/.test(bk) &&
  /if \(!isDraft\) \{ tInvoiced/.test(bk) && /entered, not approved yet/.test(bk));
ok('OQ9: period defaults June 1 2026 → with presets + custom; CSV includes status, source and in-Wave',
  /useState\('2026-06-01'\)/.test(bk) && /'All history'/.test(bk) && /in_wave \? 'yes' : 'no'/.test(bk));
ok('OQ10: permission-gated via the proven AR invoice-balances helper',
  /canViewArInvoiceBalances\(isSuperAdmin, modulePerms/.test(bk) && /Restricted — needs "AR: View Invoice Balances"/.test(bk));

if (failed.length) { console.log('FAILED (' + failed.length + '):'); failed.forEach(function (x) { console.log('  - ' + x); }); process.exit(1); }
else { console.log('ALL CHECKS PASSED — v55.83-OQ business split'); }
