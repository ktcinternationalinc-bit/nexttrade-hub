// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QS — Manual (CSV-only) bank accounts + twin-aware dedupe (Max,
// Nov 8 01:00: "i need to be able to add a csv file for an account i cannot
// add from plaid. i need it to add a new account such as pnc and that it
// should disregard duplicates.. whether through another csv upload or if
// plaid ever gets to work").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QS — manual accounts + twin dedupe');
var si = R('src/app/api/accounting/statement-import/route.js');
var tw = R('src/lib/account-twins-server.js');
var tr = R('src/app/api/plaid/transactions/route.js');
var sy = R('src/app/api/plaid/sync/route.js');
var ui = R('src/components/StatementImport.jsx');

// FUNCTIONAL: twin rule with a fake db
var src = tw.replace(/export async function/g, 'async function');
src += '\n;module.exports = { accountTwins: accountTwins };';
var mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
var data = {
  plaid_accounts: [
    { plaid_account_id: 'plaid-pnc', mask: '1234', connection_id: 'c-plaid-pnc' },
    { plaid_account_id: 'manual-acct-x', mask: '1234', connection_id: 'c-man-pnc' },
    { plaid_account_id: 'plaid-chase', mask: '1234', connection_id: 'c-chase' },
  ],
  bank_connections: [
    { id: 'c-plaid-pnc', institution_name: 'PNC Bank' },
    { id: 'c-man-pnc', institution_name: 'PNC' },
    { id: 'c-chase', institution_name: 'Chase' },
  ],
};
function fakeDb() {
  return { from: function (t) { var rows = data[t]; var q = {
    select: function () { return q; },
    in: function (col, vals) { var r2 = rows.filter(function (r) { return vals.indexOf(String(r[col])) >= 0 || vals.indexOf(r[col]) >= 0; }); return Promise.resolve({ data: r2, error: null }); },
  }; return q; } };
}
mod.exports.accountTwins(fakeDb(), ['plaid-pnc']).then(function (res) {
  ok('1 (functional): Plaid PNC •1234 ⇄ manual PNC •1234 are TWINS; Chase •1234 is NOT (bank first-word must match)',
    res['plaid-pnc'].indexOf('manual-acct-x') >= 0 && res['plaid-pnc'].indexOf('plaid-chase') < 0);

  ok('2: create_manual_account — bank + 4-digit last-4 REQUIRED, same bank+last-4 reuses the existing account (never a second copy), status manual with an "active" fallback if a rule refuses it, US books, audited',
    /if \(maskM\.length !== 4\)/.test(si) && /existing: true/.test(si) &&
    /status: 'manual'/.test(si) && /connRowM\.status = 'active';/.test(si) &&
    /'manual_account_created'/.test(si));
  ok('3: CSV import dedupes across TWINS (and ignores rows already marked duplicate) — re-uploads and Plaid copies both skipped',
    /var twinsI = await accountTwins\(d, \[target\]\);/.test(si) &&
    /\.in\('account_id', twinsI\[target\] \|\| \[target\]\)\.neq\('review_status', 'duplicate'\)/.test(si));
  ok('4: Plaid sync skips what a CSV brought in on a TWIN manual account, keyed as the Plaid account',
    /var twinsMD = await accountTwins\(supabase, Object\.keys\(mdAccts\)\);/.test(tr) &&
    /\(asPlaid\[m0\.account_id\] \|\| m0\.account_id\)/.test(tr));
  ok('5: a manual account is NEVER pulled from Plaid — scheduled sync skips it, the transactions route refuses politely',
    /c\.status === 'manual' \|\| \/\^manual-\/\.test\(String\(c\.plaid_item_id/.test(sy) &&
    /Manual \(CSV\) account — add its transactions with 📄 Import statement CSV\./.test(tr));
  ok('6: UI — "➕ account not in the list (e.g. PNC)" inline form (bank, name, last 4) in the importer; new account auto-selected; manual accounts labeled in the dropdown',
    /➕ account not in the list \(e\.g\. PNC\)/.test(ui) && /setTarget\(a\.plaid_account_id\)/.test(ui) &&
    /\(manual — CSV only\)/.test(ui));
  console.log('');
  console.log('QS: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
});
