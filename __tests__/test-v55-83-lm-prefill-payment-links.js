// ============================================================
// v55.83-LM — Max: "how do we prefill existing transactions and links to invoices". This back-links
// existing bank deposits to the invoices Wave already shows them paying. Verified-design (wf_6bd10609)
// v1 = DISPLAY-LINK ONLY: write a payment_matches row + stamp bank_transactions.matched_invoice_id (exactly
// like the Hub match path) but DO NOT insert an accounting_invoice_payments row and DO NOT touch
// wave_imported_paid — so paid/balance are provably unchanged. Dry-run-first, unique-match-only, idempotent,
// no Wave writes.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function exists(p) { try { fs.accessSync(path.join(__dirname, '..', p)); return true; } catch (e) { return false; } }
var route = rd('src/app/api/wave/prefill-payment-links/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var lib = rd('src/lib/payment-matching.js');

ok('1: route exists, gated (wave.import.run), placeholder-blocked, default dry-run, NO Wave writes (read query only)',
  exists('src/app/api/wave/prefill-payment-links/route.js') &&
  /assertPermission\(db, by, 'wave\.import\.run', req\)/.test(route) &&
  /isPlaceholderWaveBusiness\(waveBusinessId\)/.test(route) &&
  /var isDry = body\.dry_run !== false;/.test(route) &&
  !/mutation/.test(route));
ok('2: imports resolve — roundMoney is a real export of payment-matching (static-tests-miss-runtime guard)',
  /import \{ roundMoney \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/payment-matching'/.test(route) &&
  /export function roundMoney/.test(lib));
ok('3: DISPLAY-LINK — writes a payment_matches row + stamps bank_transactions.matched_invoice_id (mirrors the match path)',
  /from\('payment_matches'\)\.insert\(/.test(route) &&
  /matched_invoice_id: inv\.id/.test(route) &&
  /from\('bank_transactions'\)\.update\(\{ linked_type: 'invoice'/.test(route));
ok('3b: NO payment row + NO wave_imported_paid write (paid/balance invariant provably untouched)',
  !/from\('accounting_invoice_payments'\)\.insert\(/.test(route) &&
  !/wave_imported_paid:/.test(route));
ok('4: unique-candidate-only — 0 or >1 matches link nothing (ambiguous/none reported, not auto-applied)',
  /if \(hits\.length === 0\) \{ counts\.no_candidate\+\+;/.test(route) &&
  /if \(hits\.length > 1\) \{ counts\.ambiguous\+\+;/.test(route) &&
  /var dep = hits\[0\];/.test(route));
ok('5: idempotent + payment-classify-safe — skips payments already materialized (wave_payment_id) and deposits already linked (matched_invoice_id is null guard)',
  /if \(paidWaveIds\[pay\.id\]\) \{ counts\.already_materialized\+\+; continue; \}/.test(route) &&
  /\.eq\('id', dep\.id\)\.is\('matched_invoice_id', null\)/.test(route) &&
  /!t\.matched_invoice_id && !t\.wave_transaction_id/.test(route));
ok('6: match amount = the Wave payment amount capped at the deposit (NOT classifyApplication, which would mis-read it as $0 overpayment)',
  /var matchAmt = roundMoney\(Math\.min\(amt, depAmt > 0 \? depAmt : amt\)\);/.test(route) &&
  !/classifyApplication\(/.test(route));
ok('7: Wave Sync Center has a "Prefill invoice links" dry-run/apply UI wired to the route',
  /function runPrefillLinks\(apply\)/.test(sync) &&
  /fetch\('\/api\/wave\/prefill-payment-links'/.test(sync) &&
  /Prefill invoice links/.test(sync) &&
  /Preview links \(dry run\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LM prefill-payment-links tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
