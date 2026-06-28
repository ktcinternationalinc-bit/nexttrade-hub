// ============================================================
// v55.83-MC — ONE shared bank-account resolver (Codex). push-transaction, push-payment, and
// prefill-payment-links must all use src/lib/wave-bank-account-resolver.js (no drifting copies). Behavior:
// Plaid mask 6338 resolves to Wave "PLAT BUS CHECKING (338)" by suffix; the silo-default branch carries the
// account's wave_feed_owner (the bug the verdict caught); the firewall blocks UNSET + WAVE_FEED.
// ============================================================
var fs = require('fs');
var path = require('path');
var url = require('url');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
(async function () {
  // --- grep: all three routes import the shared resolver ---
  var pt = rd('src/app/api/wave/push-transaction/route.js');
  var pp = rd('src/app/api/wave/push-payment/route.js');
  var pf = rd('src/app/api/wave/prefill-payment-links/route.js');
  ok('1: push-transaction uses the shared resolver + firewall',
    /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/wave-bank-account-resolver'/.test(pt) &&
    /resolveWaveBankAnchor\(\{/.test(pt) && !/feedOwnerVerdict/.test(pt));
  ok('2: push-payment uses the shared resolver (feed-owner firewall REMOVED per owner directive — always push, duplicates accepted)',
    /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/wave-bank-account-resolver'/.test(pp) &&
    /resolveWaveBankAnchor\(\{/.test(pp) && !/feedOwnerVerdict/.test(pp));
  ok('3: prefill-payment-links uses the shared maskMatches (no private 4-digit copy)',
    /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/wave-bank-account-resolver'/.test(pf) &&
    /maskMatches\(nm, dm\)/.test(pf) && !/nm\.match\(\/\\d\{4\}\/g\)/.test(pf));

  // --- behavior: import the lib and exercise it ---
  var lib = await import(url.pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'wave-bank-account-resolver.js')).href);
  ok('4: mask match is suffix-tolerant — Plaid 6338 matches Wave "PLAT BUS CHECKING (338)"',
    lib.maskMatches('PLAT BUS CHECKING (338)', '6338') === true &&
    lib.maskMatches('M&T Tailored Business Checking (8311)', '8311') === true &&
    lib.maskMatches('Some Other Account (9999)', '6338') === false);
  var cands = [
    { wave_account_id: 'A', wave_account_name: 'PLAT BUS CHECKING (338)', type: 'ASSET', subtype: 'CASH_AND_BANK', wave_feed_owner: 'HUB' },
    { wave_account_id: 'B', wave_account_name: 'M&T CHECKING (311)', type: 'ASSET', subtype: 'CASH_AND_BANK', wave_feed_owner: 'WAVE_FEED' }
  ];
  var r1 = lib.resolveWaveBankAnchor({ waveBankAccts: cands, txnMask: '6338' });
  ok('5: resolves a txn to ITS OWN account by mask and carries that account\'s feed owner',
    r1.acct === 'A' && r1.feedOwner === 'HUB' && /matched-by-mask/.test(r1.via));
  var r2 = lib.resolveWaveBankAnchor({ waveBankAccts: cands, txnMask: '0000', globalAcct: 'A', globalName: 'PLAT BUS CHECKING (338)' });
  ok('6: silo-default branch carries the default account\'s feed owner (the bug the verdict caught — NOT null)',
    r2.acct === 'A' && r2.via === 'silo-default' && r2.feedOwner === 'HUB');
  ok('7: firewall — HUB ok; WAVE_FEED + UNSET blocked',
    lib.feedOwnerVerdict('HUB').ok === true &&
    lib.feedOwnerVerdict('WAVE_FEED').ok === false &&
    lib.feedOwnerVerdict(null).ok === false);

  console.log('');
  if (failures.length === 0) { console.log('✅ All v55.83-MC shared-resolver tests passed'); process.exit(0); }
  else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
})().catch(function (e) { console.log('❌ test crashed: ' + (e && e.stack || e)); process.exit(1); });
