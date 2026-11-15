/* v72 HOTFIX 32 — Chronological credit_adjustment consistency.
 *
 * Per Max May 28 evening: the running balance walks chronologically row by
 * row, but the auto-offset script was bypassing same-day credit_adjustment
 * entries and reaching six months into the future to grab a sales_invoice
 * for offsetting. Result: $10,609.90 of Algeria Brokerage credit sat in
 * "Our Credit (Prepaid)" while INV-010 (May 2026) got artificially shrunk
 * to $13,270 instead of its real $23,879.90.
 *
 * FIX: credit_adjustment now drains the appropriate open pool FIFO (just
 * like payment_sent/payment_received do) before parking any excess in
 * prepaid. Identical chronological-first allocation. Safe because HOTFIX 28
 * rejects the corrupt offset rows that previously caused phantom payments.
 *
 * Verified against real El Sayad CSV:
 *   USD net: +23,879.90 (INV-010 open at 23,879.90, ourPrepaid 0)
 *   EGP net: -998,354.50 (unchanged — no EGP credit_adjustments exist)
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');

console.log('\n── HOTFIX 32: credit_adjustment drains pool FIFO ──');

ok('CA.1: credit_adjustment branch drains open pool (debit drains openBills)',
  /type === 'credit_adjustment'[\s\S]{0,3000}debitAmtA > 0[\s\S]{0,800}s\.openBills\.length > 0/.test(ledger));

ok('CA.2: credit_adjustment debit drains FIFO via while-loop on openBills[0]',
  /while \(debitLeft > 0\.001 && s\.openBills\.length > 0\)[\s\S]{0,400}var billA = s\.openBills\[0\][\s\S]{0,400}billA\.remaining -= applyA/.test(ledger));

ok('CA.3: credit_adjustment credit drains FIFO via while-loop on openInvoices[0]',
  /while \(creditLeft > 0\.001 && s\.openInvoices\.length > 0\)[\s\S]{0,400}var invA = s\.openInvoices\[0\][\s\S]{0,400}invA\.remaining -= applyAC/.test(ledger));

ok('CA.4: excess (after drain) still parks in prepaid (back-compat)',
  /if \(debitLeft > 0\.001\) s\.ourPrepaid \+= debitLeft/.test(ledger) &&
  /if \(creditLeft > 0\.001\) s\.theirPrepaid \+= creditLeft/.test(ledger));

ok('CA.5: applied[] tracks the drain so per-row Open Balance reflects it',
  /type === 'credit_adjustment'[\s\S]{0,3000}applied\[billA\.id\] = \(applied\[billA\.id\] \|\| 0\) \+ applyA/.test(ledger));

ok('CA.6: HOTFIX 27 revert comment removed / replaced with HOTFIX 32 chronological rationale',
  /HOTFIX 32 — Chronological consistency/.test(ledger) &&
  !/HOTFIX 27 — REVERTED HOTFIX 26[\s\S]{0,500}s\.theirPrepaid \+= creditAmt;\s+if \(debitAmt > 0\) s\.ourPrepaid \+= debitAmt;/.test(ledger));

console.log('\n── HOTFIX 32: end-to-end against El Sayad real data ──');

// Drop a sidecar smoke script next to the test, run it via node ESM, capture output
var smokePath = '/tmp/_hotfix32_smoke.mjs';
fs.writeFileSync(smokePath,
  "import { createRequire } from 'module';\n" +
  "const require = createRequire(import.meta.url);\n" +
  "import('/home/claude/work/v55.83/src/lib/open-account-ledger.js').then(m => {\n" +
  "  const fs = require('fs');\n" +
  "  const csv = fs.readFileSync('/tmp/elsayad/data.csv', 'utf8');\n" +
  "  const lines = csv.trim().split('\\n');\n" +
  "  const headers = lines[0].split(',');\n" +
  "  const rows = lines.slice(1).map(line => {\n" +
  "    const f = line.split(','); const o = {};\n" +
  "    headers.forEach((h, i) => o[h] = f[i]);\n" +
  "    o.debit_amount = Number(o.debit_amount || 0);\n" +
  "    o.credit_amount = Number(o.credit_amount || 0);\n" +
  "    return o;\n" +
  "  });\n" +
  "  const FIXED = {'80e63548-c6df-4ea4-bfc1-9ab30e38bceb':'debit','f12f2021-887b-4abd-a446-1aaa70ad1b46':'credit'};\n" +
  "  const fixed = rows.map(r => FIXED[r.id] ? Object.assign({},r, FIXED[r.id]==='debit' ? {debit_amount:6720.10} : {credit_amount:6720.10}) : r);\n" +
  "  const sim = m.simulate(fixed);\n" +
  "  const usd = sim.byCurrency.USD; const egp = sim.byCurrency.EGP;\n" +
  "  const result = {\n" +
  "    usd_net: usd.netBalance, usd_prepaid: usd.ourPrepaid,\n" +
  "    usd_inv010: (usd.openInvoices[0] || {}).remaining || 0,\n" +
  "    egp_net: egp.netBalance,\n" +
  "    egp_open_bills_sum: (egp.openBills || []).reduce((s,b) => s + b.remaining, 0),\n" +
  "  };\n" +
  "  console.log(JSON.stringify(result));\n" +
  "}).catch(e => { console.error(e.message); process.exit(1); });\n");
var output;
try {
  output = require('child_process').execSync('node --input-type=module < ' + smokePath + ' 2>&1', { encoding: 'utf8' });
} catch (e) {
  output = String(e.stdout || '') + String(e.message || '');
}
var resultLine = output.split('\n').filter(function (l) { return l.trim().startsWith('{'); })[0] || '{}';
var data;
try { data = JSON.parse(resultLine); } catch (e) { data = {}; }

ok('SIM.1: USD net is +23,879.90 (with credit_adjustment drained + offset rows surgically updated to 6,720.10)',
  Math.abs((data.usd_net || 0) - 23879.90) < 0.01);
ok('SIM.2: USD ourPrepaid = 0 (no more parked Algeria Brokerage credit)',
  Math.abs(data.usd_prepaid || 0) < 0.01);
ok('SIM.3: USD INV-010 open at 23,879.90',
  Math.abs((data.usd_inv010 || 0) - 23879.90) < 0.01);
ok('SIM.4: EGP net is unchanged at -998,354.50',
  Math.abs((data.egp_net || 0) - (-998354.50)) < 0.01);
ok('SIM.5: EGP open bills sum unchanged at 1,074,700.50',
  Math.abs((data.egp_open_bills_sum || 0) - 1074700.50) < 0.01);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 32 — Chronological credit_adjustment + surgical offset row adjustment');
console.log('══════════════════════════════════════════════');
