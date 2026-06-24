// ============================================================
// v55.83-MI - Wave import/settings cleanup.
// The user-facing answer to "where do I pull previous Wave categories into
// transactions?" must be on the Wave Import page, not hidden in Sync Center.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('OK ' + label);
  else { failures.push(label + (hint ? ' - ' + hint : '')); console.log('FAIL ' + label + (hint ? ' - ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var hub = rd('src/components/WaveHub.jsx');
var imp = rd('src/components/WaveImportTab.jsx');
var sync = rd('src/components/WaveSyncCenter.jsx');
var route = rd('src/app/api/wave/account-feed-owner/route.js');
var page = rd('src/app/page.jsx');
var whats = rd('src/components/WhatsNewWidget.jsx');

ok('1: visible build marker is MI',
  /v55\.83-MI/.test(page) && /version: 'v55\.83-MI'/.test(whats));
ok('2: WaveHub names the middle step Import Wave Truth',
  /2 - Import Wave Truth/.test(hub) &&
  /old transaction CSV/.test(hub) &&
  /3 - Review, Push & Setup/.test(hub));
ok('3: Wave Import page explicitly explains prior Wave transaction categorizations',
  /Wave -> Hub import map/.test(imp) &&
  /Prior transaction categorizations require Wave's Transactions CSV export/.test(imp) &&
  /Step 3 - Import old Wave transaction categories/.test(imp) &&
  /Accounting &gt; Transactions &gt; Export/.test(imp));
ok('4: Sync Center does not expose the duplicate Import from Wave tab',
  !/\['import', 'Import from Wave'\]/.test(sync));
ok('5: feed-owner route groups duplicate bank accounts and updates grouped ids',
  /v55\.83-MI-account-feed-owner-grouped/.test(route) &&
  /duplicate_count/.test(route) &&
  /wave_account_ids/.test(route) &&
  /\.in\('wave_account_id', acctIds\)/.test(route));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MI wave import reorg tests passed'); process.exit(0); }
else { console.log(failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
