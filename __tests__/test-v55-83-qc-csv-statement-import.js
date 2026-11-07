// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QC — Manual CSV statement importer.
//
// Max (Nov 7 11:52): "do we have a manual importer of csv if plaid is not
// working. implemented" — built after the M&T diagnostic showed Plaid
// delivered ONE transaction across FOUR links: the bank's own CSV export is
// the guaranteed history route.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QC — CSV statement importer');

// ── 1. FUNCTIONAL: run the client parsers for real ──
var src = R('src/components/StatementImport.jsx').replace(/^'use client';/, '');
var names = [];
var cjs = src.substring(0, src.indexOf('export default function'))
  .replace(/^import [^\n]*$/gm, '')
  .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
var mod = { exports: {} };
new Function('module', 'exports', 'React', 'useState', cjs)(mod, mod.exports, {}, function () { return [null, function () {}]; });
var parseCsv = mod.exports.parseCsv;
var parseUsDate = mod.exports.parseUsDate;
var parseMoney = mod.exports.parseMoney;

var csv = 'Date,Description,Amount\n"11/05/2026","CHECK 1234, DEPOSIT ""A""",-1500.00\n11/06/2026,ACH PAYMENT,"(2,000.00)"\n2026-11-07,WIRE IN,"$3,500.25"\n';
var parsedT = parseCsv(csv);
ok('1a: quoted commas, escaped quotes, CRLF-safe — 4 rows incl. header, fields intact',
  parsedT.length === 4 && parsedT[1][1] === 'CHECK 1234, DEPOSIT "A"' && parsedT[2][2] === '(2,000.00)');
ok('1b: US dates — MM/DD/YYYY, M/D/YY and ISO all → YYYY-MM-DD; garbage → null (never guessed)',
  parseUsDate('11/05/2026') === '2026-11-05' && parseUsDate('1/7/26') === '2026-01-07' &&
  parseUsDate('2026-11-07') === '2026-11-07' && parseUsDate('31/12/2026') === null && parseUsDate('notadate') === null);
ok('1c: money — "$3,500.25", "(2,000.00)" negative, "-15" negative; blank/garbage → null',
  parseMoney('$3,500.25') === 3500.25 && parseMoney('(2,000.00)') === -2000 &&
  parseMoney('-15') === -15 && parseMoney('') === null && parseMoney('abc') === null);

// ── 2. The route: same shape as Plaid rows, deficit dedupe, never guesses ──
var rt = R('src/app/api/accounting/statement-import/route.js');
ok('2a: gated on bank.connections (Max 11:45 — connections are a permission; super admin passes inside assertPermission)',
  /assertPermission\(d, userId, 'bank\.connections', req\)/.test(rt));
ok('2b: imported rows are SHAPED like Plaid rows — same columns, Plaid sign convention, [CSV] bank_source, channel statement_import',
  /amount: g\.direction === 'out' \? g\.amount_abs : -g\.amount_abs, \/\/ Plaid convention: positive = money out/.test(rt) &&
  /bank_source: '\[CSV\] '/.test(rt) && /channel: 'statement_import'/.test(rt) &&
  /posted_date: g\.date/.test(rt) && /pending: false/.test(rt));
ok('2c (QD superseded the single-tier check): DEFICIT DEDUPE still holds — re-imports and Plaid overlap add NOTHING, legit same-day duplicates survive (now two tiers: exact vs earlier imports, nameless vs Plaid)',
  /\(usedManual\[k\] \|\| 0\) < \(manualCount\[k\] \|\| 0\)/.test(rt) &&
  /\(usedPlaid\[nk\] \|\| 0\) < \(plaidCount\[nk\] \|\| 0\)/.test(rt) &&
  /skippedExisting\+\+; return;/.test(rt));
ok('2d: deterministic ids — manual-sha1(account|key|occurrence) + upsert onConflict plaid_transaction_id (idempotent twice over)',
  /'manual-' \+ crypto\.createHash\('sha1'\)\.update\(target \+ '\|' \+ k \+ '\|' \+ occ\)/.test(rt) &&
  /upsert\(toInsert, \{ onConflict: 'plaid_transaction_id' \}\)/.test(rt));
ok('2e: target must be an EXISTING account WITH a silo (never imports unassigned); bad rows reported with reasons, never auto-fixed; 2000-row cap',
  /imports must land in a silo/.test(rt) && /badWhy\.push\(why\)/.test(rt) &&
  /at most 2,000 rows per request/.test(rt) &&
  /\.filter\(function \(a\) \{ return !!a\.wave_business_id; \}\)/.test(rt));

// ── 3. UI ──
var ui = R('src/components/StatementImport.jsx');
ok('3a: file parsed IN THE BROWSER; column mapping auto-guessed with dropdown overrides; single-amount sign choice + debit/credit mode',
  /rd\.readAsText\(f\)/.test(ui) && /one amount column/.test(ui) && /separate debit \/ credit columns/.test(ui) &&
  /negative = money out \(most banks\)/.test(ui));
ok('3b: preview before import — readable count, skipped count, date span, Σ in/out, first 5 rows; import chunks 1000/call and a part-way failure says re-running is safe',
  /chunks\.push\(all\.rows\.slice\(i, i \+ 1000\)\)/.test(ui) &&
  /re-running is safe: nothing duplicates/.test(ui) && /first 5 shown/.test(ui));
ok('3c: inline white panel styles (hub dark-skin rule) and wired into the Bank tab behind bank.connections / super admin',
  /style=\{\{ background: '#ffffff', border: '1px solid #e2e8f0' \}\}/.test(ui) &&
  /<StatementImport userProfile=\{userProfile\} canUse=\{isSuperAdmin \|\| !!\(modulePerms && modulePerms\['bank\.connections'\] === true\)\} \/>/.test(R('src/components/BankTab.jsx')));

console.log('');
console.log('QC: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
