// ═══════════════════════════════════════════════════════════════════════════
// v55.83-ZI — Max 25 Nov: calling Aman's line (+17326529850) while nobody answered
// played "an application error has occurred". Live log: incoming → voicemail-record
// (dial=no-answer) → incoming AGAIN 70 ms later → voicemail-record → error.
// Cause: voicemail-record's no-answer TwiML put "?call_id=…&assigned_to=…" into an
// XML attribute with a RAW "&" → invalid XML → Twilio used the number's fallback URL.
// This runs the REAL handlers (fake DB, signature check skipped, no network) and
// checks every TwiML reply is well-formed XML a strict parser would accept.
// Run: node __tests__/test-v55-83-zi-phone-twiml-valid.js
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }

var state = { db: null };
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return { from: function (t) { return state.db.from(t); } }; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
process.env.NEXT_PUBLIC_APP_URL = 'https://nexttrade-hub.vercel.app';
process.env.SKIP_TWILIO_SIGNATURE = 'true';
global.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } }); };

// Strict well-formedness: every "&" starts a real entity, tags nest and close, one root.
function xmlProblems(x) {
  var probs = [];
  var body = String(x).replace(/^<\?xml[^?]*\?>/, '');
  var amp = body.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g);
  if (amp) probs.push('raw & (' + amp.length + ')');
  var stack = []; var re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g; var m; var last = 0; var roots = 0;
  while ((m = re.exec(body))) {
    var between = body.slice(last, m.index); if (/[<>]/.test(between)) probs.push('stray < or > near ' + m.index);
    last = re.lastIndex;
    if (m[1]) { if (stack.pop() !== m[2]) probs.push('mismatched </' + m[2] + '>'); }
    else if (!m[4]) { if (!stack.length) roots++; stack.push(m[2]); }
    else if (!stack.length) roots++;
  }
  if (/[<>]/.test(body.slice(last))) probs.push('trailing stray < or >');
  if (stack.length) probs.push('unclosed ' + stack.join(','));
  if (roots !== 1) probs.push('root elements: ' + roots);
  return probs;
}
function attr(x, tag, name) { var m = new RegExp('<' + tag + '\\b[^>]*\\s' + name + '="([^"]*)"').exec(x); return m ? m[1].replace(/&amp;/g, '&') : null; }

function form(obj) { var p = new URLSearchParams(); Object.keys(obj).forEach(function (k) { p.append(k, obj[k]); }); return p; }
function post(R, url, fields) { return R.POST(new Request(url, { method: 'POST', body: form(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); }); }

function seed() {
  var db = new FakeDb({});
  db.t.phone_numbers = [
    { id: 'n1', phone_number: '+17326529850', label: 'Team Line — Bound Brook NJ', number_type: 'personal', assigned_to: 'u-aman', recording_enabled: true, voicemail_enabled: true },
    { id: 'n2', phone_number: '+18886007096', label: 'KTC Main Line', number_type: 'main', assigned_to: 'u-max', recording_enabled: true, voicemail_enabled: true },
  ];
  db.t.users = [
    { id: 'u-aman', name: 'Aman', phone_routing: 'browser', forwarding_number: null, phone_vacation_mode: false },
    { id: 'u-max', name: 'Max', phone_routing: 'browser_cell', forwarding_number: '+15550001111', phone_vacation_mode: false },
  ];
  db.t.phone_calls = []; db.t.phone_voicemails = []; db.t.customers = []; db.t.crm_customers = [];
  return db;
}

var VM = require(path.join(root, 'src/app/api/phone/voicemail-record/route.js'));
var IN = require(path.join(root, 'src/app/api/phone/incoming/route.js'));

(async function () {
  console.log('ZI — voicemail-record replies are valid TwiML');
  state.db = seed();
  var base = 'https://nexttrade-hub.vercel.app/api/phone/voicemail-record?call_id=c1&assigned_to=u-aman&customer_id=';
  var statuses = ['no-answer', 'failed', 'busy', 'canceled'];
  for (var i = 0; i < statuses.length; i++) {
    var r = await post(VM, base, { CallSid: 'CA1', DialCallStatus: statuses[i] });
    var p = xmlProblems(r.text);
    check('Dial ' + statuses[i] + ' → 200 and well-formed XML (no raw &)', r.status === 200 && p.length === 0, { status: r.status, problems: p, body: r.text.substring(0, 300) });
    if (i === 0) {
      var act = attr(r.text, 'Record', 'action');
      check('<Record action> still carries call_id, assigned_to and customer_id once decoded', act && /call_id=c1&assigned_to=u-aman&customer_id=$/.test(act), act);
      check('<Record recordingStatusCallback> decodes to the same address', attr(r.text, 'Record', 'recordingStatusCallback') === act);
    }
  }
  var r2 = await post(VM, base, { CallSid: 'CA1', DialCallStatus: 'completed' });
  check('answered call → well-formed hang-up reply', r2.status === 200 && xmlProblems(r2.text).length === 0, r2.text);
  var r3 = await post(VM, base, { CallSid: 'CA1' });
  check('record callback with no recording yet → well-formed reply', r3.status === 200 && xmlProblems(r3.text).length === 0, r3.text);

  console.log('ZI — incoming replies are valid TwiML');
  var numbers = ['+17326529850', '+18886007096', '+19999999999'];
  for (var j = 0; j < numbers.length; j++) {
    state.db = seed();
    var ri = await post(IN, 'https://nexttrade-hub.vercel.app/api/phone/incoming', { CallSid: 'CA' + j, From: '+15551234567', To: numbers[j], CallStatus: 'ringing' });
    var pi = xmlProblems(ri.text);
    check('incoming to ' + numbers[j] + ' → well-formed XML', ri.status === 200 && pi.length === 0, { status: ri.status, problems: pi, body: ri.text.substring(0, 400) });
  }
  state.db = seed();
  var ra = await post(IN, 'https://nexttrade-hub.vercel.app/api/phone/incoming', { CallSid: 'CAx', From: '+15551234567', To: '+17326529850', CallStatus: 'ringing' });
  check("Aman's line rings his browser (<Client>u-aman</Client>) and the Dial action goes to voicemail-record", /<Client>u-aman<\/Client>/.test(ra.text) && /\/api\/phone\/voicemail-record/.test(attr(ra.text, 'Dial', 'action') || ''), ra.text.substring(0, 500));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
