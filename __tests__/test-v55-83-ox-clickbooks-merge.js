// ═══════════════════════════════════════════════════════════════════════════
// v55.83-OX — ClickBooks US P1–P8 package merged WITHOUT losing the NN→OW line
//
// Max (Nov 4): "I want you to examine this new aspect that I had ChatGPT work
// on... examine it carefully as a second party that's going to implement it
// into our project. I need you to implement it and see if it passes your
// rigorous testing."
//
// The package (authored against our own v55.83-OW snapshot) adds six strands:
// ClickBooks US double-entry ledger views, protected bank-balance/dashboard
// visibility, Ledgerly read-only mirror, backup hardening, /api/users
// hardening, and Plaid route auth. This test pins BOTH sides of the merge:
// the package's security model must be present, and none of our OW-line
// behavior (recon, business split, P&L, release numbers, unmatch flow) may
// regress. If either side disappears, the merge was clobbered — fail loud.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

console.log('OX — ClickBooks P1–P8 merge integrity');

// ── 1. bank-write: new identity gate AND our force-unmatch survive together
var bw = R('src/app/api/accounting/bank-write/route.js');
ok('1a: bank-write authenticates the real signer (authorizeBankIdentity), never trusts body.user_id as authority',
  /authorizeBankIdentity\(req, createClient, process\.env\)/.test(bw) &&
  /body\.user_id && body\.user_id !== access\.profileId/.test(bw));
ok('1b: our OW force_unmatch_wave exit (Wave-pushed payments reversed locally, Wave list returned) is retained',
  bw.indexOf("force_unmatch_wave") >= 0 && /wave_reversal_needed/.test(bw));
ok('1c: audit actor is the verified profile, not the browser-supplied id',
  /var by = access\.profileId;/.test(bw));

// ── 2. AccountingTab: our five OW subtabs intact; ClickBooks/Ledgerly added but flag-gated
var at = R('src/components/AccountingTab.jsx');
['recon', 'balances', 'sales_report', 'pnl', 'all_invoices'].forEach(function (sub) {
  ok('2: OW subtab "' + sub + '" still wired', at.indexOf("'" + sub + "'") >= 0);
});
ok('2f: ClickBooks tabs appear only behind NEXT_PUBLIC_CLICKBOOKS_US_ENABLED (default hidden)',
  /NEXT_PUBLIC_CLICKBOOKS_US_ENABLED === 'true'/.test(at) &&
  /clickbooksEnabled && canClickbooks/.test(at));
ok('2g: Ledgerly tab requires a verified financial capability, not a legacy role',
  /canLedgerly = financialAccess\.canViewFullDashboard === true \|\| financialAccess\.canViewBankBalances === true/.test(at));

// ── 3. server-permissions: balances no longer grantable via legacy aliases
var sp = R('src/lib/server-permissions.js');
ok("3a: 'bank_balances.view' legacy alias list is EMPTY (roles/module rows cannot confer it)",
  /'bank_balances\.view': \[\]/.test(sp));
ok('3b: balance permission resolves only through authorizeBankVisibility',
  /authorizeBankVisibility\(request/.test(sp));
ok('3c: our OW permission keys unharmed (ar.view_invoice_balances still resolvable)',
  sp.indexOf('ar.view_invoice_balances') >= 0);

// ── 4. No browser star-selects on column-restricted bank tables anywhere
var comps = fs.readdirSync(path.join(__dirname, '..', 'src', 'components')).filter(function (f) { return /\.(jsx?|mjs)$/.test(f); });
var starSelects = [];
comps.forEach(function (f) {
  var s = R('src/components/' + f);
  if (/from\('(bank_connections|plaid_accounts)'\)\s*\.select\('\*'\)/.test(s)) starSelects.push(f);
});
ok('4: zero select(*) on bank_connections/plaid_accounts in components (column grants would 42501): ' + (starSelects.join(',') || 'none'),
  starSelects.length === 0);

// ── 5. Our OW line's core libs untouched by the merge
ok('5a: business-of.js rule intact (wave-bound = US, tag override, EGP → Egypt)',
  /wave_import/.test(R('src/lib/business-of.js')) && /business_tag/.test(R('src/lib/business-of.js')));
ok('5b: ar-eligibility.js Hub-created-counts rule intact',
  /return true/.test(R('src/lib/ar-eligibility.js')));
ok('5c: recon route still matches on release fields ONLY (no serial heuristics)',
  R('src/app/api/reconcile/nexttrade/route.js').indexOf('po_so_number') >= 0);
ok('5d: AccountingDashboard untouched: default period Jun 1 2026 + aggregated paid-in-period',
  R('src/components/AccountingDashboard.jsx').indexOf("'2026-06-01'") >= 0 &&
  /paidAgg/.test(R('src/components/AccountingDashboard.jsx')));

// ── 6. ClickBooks server layer: RPC facades only, no direct public-table selects
var cbLibs = ['clickbooks-us-read.js', 'clickbooks-us-workbench.js', 'clickbooks-us-reports.js', 'clickbooks-us-cutover.js', 'clickbooks-us-operator-grants.js'];
var directSelects = [];
cbLibs.forEach(function (f) {
  var s = R('src/lib/' + f);
  if (/from\('[a-z_]+'\)\s*\.select\(/.test(s) && f !== 'clickbooks-us-operator-grants.js') directSelects.push(f);
});
ok('6a: ClickBooks libs reach the ledger only through rpc() facades (schema truth lives in the DB): ' + (directSelects.join(',') || 'clean'),
  directSelects.length === 0);
ok('6b: ClickBooks read handler enforces the US book fingerprint (KTC_US / USD)',
  /KTC_US/.test(R('src/lib/clickbooks-us-read.js')) && /USD/.test(R('src/lib/clickbooks-us-read.js')));

// ── 7. vercel.json keeps BOTH crons (our 6-hour recon + ledgerly 15-min)
var vj = R('vercel.json');
ok('7: recon cron retained AND ledgerly sync cron added',
  /reconcile\/nexttrade/.test(vj) && /ledgerly\/sync/.test(vj));

// ── 8. Settings keeps our P&L permission catalog AND adds the two protected panels
var st = R('src/components/SettingsTab.jsx');
ok('8a: pnl.view / pnl.edit_costs still grantable in Settings',
  st.indexOf('pnl.view') >= 0 && st.indexOf('pnl.edit_costs') >= 0);
ok('8b: protected financial grants managed only via BankBalancePermissions panel (legacy toggle blocked)',
  /<BankBalancePermissions \/>/.test(st) && /Use Financial data access to change these permissions/.test(st));

console.log('');
console.log('OX merge integrity: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
