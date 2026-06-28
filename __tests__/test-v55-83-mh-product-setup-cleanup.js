// ============================================================
// v55.83-MH - Wave Settings product setup cleanup.
// Max screenshot: the Default Invoice Product panel dumped raw Wave JSON and
// productCreate sent isSold/isBought, which current live Wave rejects.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];

function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function ok(label, cond) {
  if (cond) { console.log('OK ' + label); }
  else { failures.push(label); console.log('FAIL ' + label); }
}

var route = rd('src/app/api/wave/product-setup/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var page = rd('src/app/page.jsx');
var wn = rd('src/components/WhatsNewWidget.jsx');
var pcv = (route.match(/var pcVars = .*/) || [''])[0];

ok('1: product-setup carries a current M-series marker (not pinned to one letter)', /API_BUILD_MARKER = 'v55\.83-M[A-Z]-product-setup/.test(route));
ok('2: productCreate omits Wave-rejected isSold/isBought and keeps incomeAccountId',
  !/isSold: true/.test(pcv) && !/isBought: false/.test(pcv) && /incomeAccountId: incomeAccountId/.test(pcv));
ok('3: route returns a compact Wave error summary while retaining raw response for details',
  /function waveMessages\(payload\)/.test(route) && /wave_error_summary: reasons\.join\('\\n'\)/.test(route) && /response: pcData/.test(route));
ok('4: Settings UI keeps raw product details collapsed instead of appending JSON to prodMsg',
  /var ps4 = useState\(null\); var prodDetails = ps4\[0\]; var setProdDetails = ps4\[1\];/.test(sync) &&
  /setProdDetails\(d\.response \|\| d\)/.test(sync) &&
  !/JSON\.stringify\(d\.response/.test(sync) &&
  /Technical details/.test(sync));
ok('5: visible app build + changelog carry a current v55.83 M-series build (badge not pinned to one letter — avoids marker-churn breakage)',
  />v55\.83-M[A-Z]</.test(page) && /version: 'v55\.83-M[A-Z]'/.test(wn));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MH product setup cleanup tests passed'); process.exit(0); }
console.log(failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
