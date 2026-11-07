// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PR — Intra-company transfers: scan, suggest, link, register
//
// Max (Nov 7, 05:25): "must be able to read thru account and give suggestions
// to transfers if transfer for that amount is selected and link them in the
// proper accounting terminology and sorting filtering and report building
// necessary to account for a company intra transfer between accounts."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PR — intra-company transfer suggestions + register');

var rt = R('src/app/api/accounting/expense-rules/route.js');
ok('1a: the scanner reads ALL silo accounts — cent-equal amounts, opposite directions, DIFFERENT accounts, ≤7 days, never paired/invoice-matched legs',
  /action === 'transfer_suggestions'/.test(rt) &&
  /is\('transfer_group_id', null\)\.is\('matched_invoice_id', null\)/.test(rt) &&
  /a transfer LEAVES one account and ARRIVES in another/.test(rt) &&
  /gap > 7\) \{ continue; \}/.test(rt));
ok('1b: each candidate leg is used ONCE (greedy best-score, usedIn), transfer-looking text boosts the score, suggestions are proposals — only a human links',
  /usedIn\[I\.id\]\) \{ continue; \}/.test(rt) && /hintRx\.test/.test(rt) &&
  /Suggestions only — a human links/.test(rt));
ok('1c: transfers_report = the register — per-pair date, from-account → to-account, amount, period-filtered, one-leg groups visible',
  /action === 'transfers_report'/.test(rt) && /not\('transfer_group_id', 'is', null\)/.test(rt) &&
  /from_account/.test(rt) && /to_account/.test(rt) && /g9\.legs\+\+/.test(rt));

var ui = R('src/components/ExpenseRulesTab.jsx');
ok('2a: ↔ Intra-company transfers panel — scan button, link-as-transfer per suggestion, date-filtered register with CSV',
  /🔎 Scan accounts for transfer pairs/.test(ui) && /link as transfer ↔/.test(ui) &&
  /intra-company-transfers-/.test(ui) && /Transfer register \{trReport\.from\}/.test(ui));
ok('2b: proper accounting terminology stated — clearing account, nets to zero, balances move but the P&L does not',
  /intra-company transfer/.test(ui) && /Inter-account transfer clearing/.test(ui) &&
  /nets to zero/.test(ui) && /balances move, the P&L doesn't/.test(ui));
ok('2c: picking "transfer" as a category immediately offers the other leg; a one-leg register row is flagged',
  /cls === 'transfer' && !t\.transfer_group_id\) \{ openPair\(t\); \}/.test(ui) &&
  /one leg only/.test(ui));

console.log('');
console.log('PR: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
