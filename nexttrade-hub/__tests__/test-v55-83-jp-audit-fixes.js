// ============================================================
// v55.83-JP — fixes from the 3-agent fine-tooth-comb audit (accounting + banking). Real, user-impacting
// issues only (silo isolation, silent balance corruption, lost Wave product on conversion, stale modal,
// hidden overpayment, production-unlock missing-column diagnosis).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var bw = rd('src/app/api/accounting/bank-write/route.js');
var pp = rd('src/app/api/wave/push-payment/route.js');
var inv = rd('src/components/AccountingInvoicesTab.jsx');
var rf = rd('src/app/api/wave/registry-flags/route.js');

// Silo isolation (server-side, service-role routes bypass RLS)
ok('1: match_invoice blocks a cross-silo match (deposit silo != invoice silo), re-read from DB',
  /Cross-silo match blocked/.test(bw) && /tSilo && iSilo && tSilo !== iSilo/.test(bw));
ok('2: unmatch blocks a cross-silo void when a silo is declared',
  /Cross-silo unmatch blocked/.test(bw) && /umSilo && umSilo !== body\.wave_business_id/.test(bw));

// Silent corruption guards
ok('3: match_invoice recompute is non-fatal (no 500 after money rows written)',
  /try \{ recomputed = await recompute\(db, inv\.id\); \} catch \(eRc\) \{ recomputeFailed = true; \}/.test(bw) && /recompute_failed: recomputeFailed/.test(bw));
ok('4: categorize auto-review now records reviewed_by/reviewed_at (audit completeness)',
  /else \{ cPatch\.reviewed_by = by; cPatch\.reviewed_at = new Date\(\)\.toISOString\(\); \}/.test(bw));
ok('5: push-payment recompute checks BOTH reads for error and skips writing a wrong balance',
  /if \(\(allPays && allPays\.error\) \|\| \(invR && invR\.error\)\)/.test(pp) && /recompute_skipped/.test(pp));
ok('6: push-payment invoice balance update is silo-scoped',
  /invUpdQ = invUpdQ\.eq\('wave_business_id', waveBusinessId\)/.test(pp));

// Invoices UI
ok('7: reducing an invoice below its paid amount is BLOCKED (no hidden overpayment)',
  /total < roundMoney\(realPaid\) - 0\.01/.test(inv) && /would hide an overpayment/.test(inv));
ok('8: proforma -> invoice conversion carries the per-line Wave product',
  /wave_product_id: it\.wave_product_id \|\| null, wave_product_name: it\.wave_product_name \|\| null, wave_product_source: it\.wave_product_id \? \(it\.wave_product_source \|\| 'selected'\) : null/.test(inv));
ok('9: approving an invoice closes the modal that showed it (no stale buttons)',
  /setEditing\(function \(ed\) \{ return \(ed && ed !== 'new' && ed\.id === row\.id\) \? null : ed; \}\)/.test(inv) &&
  /setViewing\(function \(v\) \{ return \(v && v\.id === row\.id\) \? null : v; \}\)/.test(inv));

// Production unlock missing-column diagnosis
ok('10: registry-flags points to the JP SQL when a flag column is missing',
  /missing on wave_business_registry/.test(rf) && /v55-83-JP-registry-flags-ensure\.sql/.test(rf));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JP audit-fix tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
