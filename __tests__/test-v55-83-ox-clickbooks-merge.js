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
// (PB superseded the original 2f/2g pins: Max ordered the 4 ClickBooks tabs
// collapsed and Ledgerly hidden entirely. New truth pinned here + in PB.)
ok('2f (PB): ClickBooks surfaces stay flag-gated — reports behind flag+capability, admin behind flag+verified super admin',
  /NEXT_PUBLIC_CLICKBOOKS_US_ENABLED === 'true'/.test(at) &&
  /reportsEnabled && canClickbooks/.test(at) &&
  /clickbooksEnabled && financialAccess\.isVerifiedSuperAdmin === true/.test(at));
ok('2g (PB): Ledgerly is hidden — no tab entry survives',
  at.indexOf("['ledgerly'") < 0);

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
ok('7 (PB): recon cron retained; ledgerly cron REMOVED per Max; shadow + rules crons present',
  /reconcile\/nexttrade/.test(vj) && !/ledgerly\/sync/.test(vj) && /shadow-job/.test(vj) && /rules-job/.test(vj));

// ── 8. Settings keeps our P&L permission catalog AND adds the two protected panels
var st = R('src/components/SettingsTab.jsx');
ok('8a: pnl.view / pnl.edit_costs still grantable in Settings',
  st.indexOf('pnl.view') >= 0 && st.indexOf('pnl.edit_costs') >= 0);
ok('8b: protected financial grants managed only via BankBalancePermissions panel (legacy toggle blocked)',
  // superseded pin (v55.83-RI, Max Nov 9 10:38 "i need all of the banking permissions in one box"): the two protected grants
  // are now switched inside BankingAccessPanel (same /api/bank-visibility PUT, super admin only); the legacy toggle stays blocked
  /<BankingAccessPanel users=\{nonSuperUsers\}/.test(st) && /bank-visibility/.test(R('src/components/BankingAccessPanel.jsx')) && /Use Settings → 🏦 Banking & Accounting Access to change these permissions/.test(st));

// ── 9. OZ addendum — contrast. Max (Nov 5): "fix font color or background as
// notes are invicsible in next build". The hub's dark skin overrides tailwind
// color utilities, so the two new permission panels must use explicit hex
// inline styles (standing UI contrast rule) and no translucent /NN backgrounds.
['BankBalancePermissions.jsx', 'ClickBooksOperatorPermissions.jsx'].forEach(function (f) {
  var s = R('src/components/' + f);
  ok('9 OZ: ' + f + ' has no translucent bg-*/NN classes and paints a solid white panel',
    !/bg-(indigo|sky|slate|zinc)-\d+\/\d+/.test(s) && s.indexOf("background: '#ffffff'") >= 0);
  ok('9 OZ: ' + f + ' body text uses explicit dark hex (#334155) per contrast rule',
    s.indexOf("color: '#334155'") >= 0);
});

// ── 10. PA addendum — Phase 4 activation. Max (Nov 5): parallel mode enabled in
// DB; the shadow scheduler needs a 15-min cron, and the Bank "Sync done" banner
// was red-on-yellow (same dark-skin contrast disease).
ok('10 PA: vercel.json schedules the ClickBooks shadow job every 15 min (and keeps recon + ledgerly)',
  /clickbooks-us\/shadow-job/.test(R('vercel.json')) && /\*\/15 \* \* \* \*/.test(R('vercel.json')) && /reconcile\/nexttrade/.test(R('vercel.json')));
ok('10 PA: Bank notice banner uses explicit hex (no amber-utility classes)',
  (function(){ var s2 = R('src/components/BankTab.jsx'); return s2.indexOf("background: '#fef3c7'") >= 0 && !/\{notice\}[\s\S]{0,200}bg-amber/.test(s2); })());
ok('10 PA: shadow job stays fail-closed (env flag + 32-char secret + system actor uuid required)',
  (function(){ var s2 = R('src/lib/clickbooks-us-shadow-job.js'); return /CLICKBOOKS_US_SHADOW_SYNC_ENABLED!=='true'/.test(s2) && /secret\.length<32/.test(s2) && /CLICKBOOKS_US_SYSTEM_AUTH_USER_ID/.test(s2); })());

console.log('');
console.log('OX merge integrity: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
