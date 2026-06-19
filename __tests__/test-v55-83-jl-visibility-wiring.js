// ============================================================
// v55.83-JL — wire the admin history-visibility floor into the accounting list screens at the QUERY
// (no fetch-then-hide), and keep the AccountingVisibilityPanel's claim matching reality (Codex guard).
// This pass: Invoices + Open Accounts (query-level floor). Customer Ledger + AR History deferred (JM)
// and the panel no longer claims them as enforced.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var far = rd('src/lib/fetch-all-rows.js');
var inv = rd('src/components/AccountingInvoicesTab.jsx');
var oa = rd('src/components/OpenAccountsTab.jsx');
var panel = rd('src/components/AccountingVisibilityPanel.jsx');

// --- fetchAllRows supports a query-level gte floor ---
ok('1: fetchAllRows accepts a gteFilter and applies it at the query (before rows enter state)',
  /function fetchAllRows\(table, columns, orderCol, asc, gteFilter\)/.test(far) &&
  /if \(gteFilter && gteFilter\.col && gteFilter\.value\) \{ q = q\.gte\(gteFilter\.col, gteFilter\.value\)/.test(far));

// --- Invoices: query-level floor on invoice_date / proforma_date, super-admin bypass ---
ok('2: AccountingInvoicesTab fetches the policy and floors at the query (invoice_date / proforma_date)',
  /fetch\('\/api\/admin\/visibility'\)/.test(inv) &&
  /_invFloor = _floor \? \{ col: 'invoice_date', value: _floor \}/.test(inv) &&
  /_proFloor = _floor \? \{ col: 'proforma_date', value: _floor \}/.test(inv) &&
  /fetchAllRows\('accounting_invoices', '\*', 'created_at', false, _invFloor\)/.test(inv) &&
  /fetchAllRows\('accounting_proformas', '\*', 'created_at', false, _proFloor\)/.test(inv));
ok('3: invoice floor respects super-admin (floorDateFor with isSuperAdmin) + shows a Visibility chip',
  /floorDateFor\(\{ window: _vr\.value\.window[\s\S]{0,80}isSuperAdmin: isSuperAdmin \}/.test(inv) && /Visibility:/.test(inv));
// JM — child payment rows must NOT load all history when a floor is active (Codex)
ok('3b: invoice payments are SCOPED to in-window invoice ids when a floor applies (no all-history fetch)',
  /if \(_floor\) \{[\s\S]{0,400}\.in\('accounting_invoice_id', chunk\)/.test(inv) &&
  /invRows\.map\(function \(i\) \{ return i\.id; \}\)/.test(inv));
ok('3c: invoice + OA visibility chips show the newest-loaded date',
  /· Newest: /.test(inv) && /· Newest: /.test(oa));

// --- Open Accounts: query-level floor on both load + reload paths ---
ok('4: OpenAccountsTab floors open_account_invoices at the query on the main load',
  /_oaInvQ = _oaInvQ\.gte\('invoice_date', _oaFloor\)/.test(oa));
ok('5: OpenAccountsTab floors the reload path too',
  /_oaInvQR = _oaInvQR\.gte\('invoice_date', _oaFloorR\)/.test(oa) && /function oaiFloorValue\(\)/.test(oa));
ok('6: OpenAccountsTab shows an invoice-visibility chip',
  /Invoice visibility:/.test(oa));

// --- Codex GUARD: every screen the panel CLAIMS as enforced must actually wire the policy ---
// Parse the "Enforced now:" line and verify each named screen's source uses the visibility policy.
var SCREEN_SOURCES = {
  'Bank Review': 'src/components/BankReviewTab.jsx',
  'Bank tab': 'src/components/BankTab.jsx',
  'Invoices': 'src/components/AccountingInvoicesTab.jsx',
  'Open Accounts': 'src/components/OpenAccountsTab.jsx'
};
function usesPolicy(src) {
  var s = rd(src);
  return /floorDateFor/.test(s) || /isWithinWindow/.test(s) || /\/api\/admin\/visibility/.test(s);
}
var enforcedMatch = panel.match(/Enforced now:<\/b>\s*([^<]+)</);
ok('7: panel states an explicit "Enforced now" list', !!enforcedMatch);
if (enforcedMatch) {
  var named = enforcedMatch[1].split(',').map(function (x) { return x.replace(/\.$/, '').trim(); }).filter(Boolean);
  var allWired = named.every(function (n) { return SCREEN_SOURCES[n] && usesPolicy(SCREEN_SOURCES[n]); });
  ok('8: GUARD — every screen the panel claims as enforced actually imports/uses the visibility policy',
    allWired, 'claimed: ' + named.join(' | '));
}
// And the panel must NOT claim Ledger / AR History as enforced yet (they are deferred to JM).
ok('9: panel does NOT overclaim Customer Ledger / AR History as enforced (still show full history — deferred)',
  /Coming next:[\s\S]{0,160}Customer Ledger/.test(panel) && /AR History/.test(panel));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JL visibility-wiring tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
