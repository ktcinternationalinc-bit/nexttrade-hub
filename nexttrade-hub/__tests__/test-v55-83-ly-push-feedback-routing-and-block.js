// ============================================================
// v55.83-LY — Codex hard-FAIL #1: push errors were written into the INVOICE-PRODUCT message box
// (setProdMsg) → a bank-txn push failure showed under "Default Invoice Product". Fixed: push results use a
// dedicated pushMsg, rendered in Pending Sync. (The client-side deposit hard-block was superseded by LZ
// per-account server resolution — a categorized txn is pushable; the server resolves/diagnoses the anchor.)
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: push results use a DEDICATED pushMsg state (not the invoice-product prodMsg)',
  /var psPush = useState\(''\); var pushMsg = psPush\[0\]; var setPushMsg = psPush\[1\];/.test(sync) &&
  /if \(failed > 0\) \{ setPushMsg\('Push: '/.test(sync) &&
  !/setProdMsg\('Push: '/.test(sync));
ok('2: pushMsg renders in the Pending Sync tab (push failures no longer appear in Default Invoice Product)',
  /\{pushMsg && <div className="px-3 py-2 text-\[11px\] whitespace-pre-wrap[\s\S]{0,80}\{pushMsg\}/.test(sync));
ok('3: a categorized transaction is pushable (blocked ONLY on a missing category — server resolves the bank anchor per-account, no client global-deposit hard-block)',
  /blocked: hasCat \? null : 'Pick a Wave category first \(Bank Review\)\.'/.test(sync) &&
  !/needsDepositAccount/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LY push-routing tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
