// ============================================================
// v55.56 — Phone webhook fail-open regression test
//
// Bug fixed: inbound calls hit "an application error has occurred"
// when Twilio's webhook signature didn't match the URL Vercel
// reconstructed. Routes returned 403 Forbidden, which Twilio
// translates to that error message for the caller.
//
// Fix: phone routes now log the signature failure but return real
// TwiML so calls keep working. Plus a new health endpoint at
// /api/phone/health for diagnosing webhook reachability.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.56 — Phone webhook fail-open regression');
console.log('============================================================\n');

// ---------- A: Phone routes no longer return 403 on bad signature ----------
console.log('A. Phone webhooks return TwiML instead of 403 on signature fail');

var routes = [
  ['incoming', 'src/app/api/phone/incoming/route.js'],
  ['outbound', 'src/app/api/phone/outbound/route.js'],
  ['voicemail-record', 'src/app/api/phone/voicemail-record/route.js'],
  ['call-status', 'src/app/api/phone/call-status/route.js'],
  ['recording-callback', 'src/app/api/phone/recording-callback/route.js'],
];

routes.forEach(function (r) {
  var src = read(r[1]);
  // The "rejecting" + 403 pattern should NOT exist after the fix
  var hasReject = /signature check FAILED — rejecting/.test(src);
  check('A.' + r[0] + '.1 no longer says "signature check FAILED — rejecting"', !hasReject);
  // The fail-open marker should be present
  check('A.' + r[0] + '.2 has SIGNATURE CHECK FAILED — proceeding anyway',
    /SIGNATURE CHECK FAILED — proceeding anyway/.test(src));
});

// ---------- B: incoming + voicemail-record still return TwiML on signature fail ----------
console.log('\nB. Inbound + voicemail-record fall through to TwiML, not 403');

var incomingSrc = read('src/app/api/phone/incoming/route.js');
// After the failed-signature log we should NOT see `return new Response('Forbidden'`
// in the same try block — fall-through means the next code runs
var afterSigCheck = incomingSrc.match(/SIGNATURE CHECK FAILED[\s\S]{0,500}/);
check('B.1 incoming: no Forbidden return immediately after signature fail',
  afterSigCheck && !/return new Response\('Forbidden'/.test(afterSigCheck[0]));

var vmSrc = read('src/app/api/phone/voicemail-record/route.js');
var afterVmSig = vmSrc.match(/SIGNATURE CHECK FAILED[\s\S]{0,500}/);
check('B.2 voicemail-record: no Forbidden return immediately after signature fail',
  afterVmSig && !/return new Response\('Forbidden'/.test(afterVmSig[0]));

// ---------- C: New /api/phone/health endpoint exists ----------
console.log('\nC. New /api/phone/health endpoint');

var healthPath = path.join(REPO, 'src/app/api/phone/health/route.js');
check('C.1 health route file exists', fs.existsSync(healthPath));
if (fs.existsSync(healthPath)) {
  var healthSrc = read('src/app/api/phone/health/route.js');
  check('C.2 health exports GET', /export async function GET/.test(healthSrc));
  check('C.3 health exports POST (Twilio always POSTs)', /export async function POST/.test(healthSrc));
  check('C.4 health returns valid TwiML for non-browser callers',
    /<Response>/.test(healthSrc) && /<Hangup \/>/.test(healthSrc));
  check('C.5 health returns JSON for browser callers',
    /Response\.json\(\{/.test(healthSrc));
  check('C.6 health surfaces presence of TWILIO env vars',
    /TWILIO_ACCOUNT_SID/.test(healthSrc) && /TWILIO_AUTH_TOKEN/.test(healthSrc) && /TWILIO_TWIML_APP_SID/.test(healthSrc));
  check('C.7 health surfaces presence of NEXT_PUBLIC_APP_URL',
    /NEXT_PUBLIC_APP_URL/.test(healthSrc));
}

// ---------- D: Build stamp current ----------
console.log('\nD. Build stamp current');
var pageSrc = read('src/app/page.jsx');
check('D.1 header pill v55.56+',
  />v55\.(5[6-9]|[6-9]\d)(?:-[A-Z][0-9]*(?:\.\d+)?)?</.test(pageSrc));
var anyBuildLabel = pageSrc.match(/BUILD v55\.\d+-/g);
check('D.2 build modal stamp v55.56+',
  anyBuildLabel && anyBuildLabel.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 56;
  }));

// ---------- E: Earlier session fixes intact ----------
console.log('\nE. Earlier session fixes still intact');
check('E.1 v55.55 monthly drill-down still wired',
  /navigate\('sales', \{ from: monthFrom, to: monthTo \}\)/.test(read('src/components/PersonalDashboard.jsx')));
check('E.2 SafeSection wraps MyPerformance (in AssistantsBar after v55.71 move)',
  /<SafeSection label="My Performance">/.test(read('src/components/AssistantsBar.jsx')));
check('E.3 v55.51 customs SQL file present',
  true /* v55.83-A.4 RETIRED: v55.51 customs feature was rearchitected; SQL no longer required */);

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate the v55.56 phone fail-open fix has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.56 phone fail-open tests passed.\n');
