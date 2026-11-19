// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UF — Codex QA 18 Nov: run the REAL /api/phone/transcribe-cron GET and
// /api/phone/transcribe-async POST handlers with an in-memory database and a
// stubbed fetch (no Twilio, no OpenAI, no network, no real database).
// Run: node __tests__/test-v55-83-uf-transcribe-handlers.js
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

var state = { db: null, fetches: [], whisperStatus: 200, audioStatus: 200 };
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
var proxyClient = { from: function (t) { return state.db.from(t); } };
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return proxyClient; } } };

process.env.NODE_ENV = 'production';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
process.env.CRON_SECRET = 'cron-test-secret'; process.env.INTERNAL_SECRET = 'internal-test-secret';
process.env.OPENAI_API_KEY = 'sk-test'; process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok';
process.env.NEXT_PUBLIC_APP_URL = 'https://hub.example.test';

global.fetch = function (url, opts) {
  state.fetches.push({ url: String(url), opts: opts || {} });
  if (/\/api\/phone\/transcribe-async$/.test(url)) { return Promise.resolve({ ok: true, status: 200 }); }
  if (/^https:\/\/api\.twilio\.com\//.test(url)) { return Promise.resolve({ ok: state.audioStatus === 200, status: state.audioStatus, blob: function () { return Promise.resolve(new Blob(['x'])); } }); }
  if (/api\.openai\.com/.test(url)) { return Promise.resolve({ ok: state.whisperStatus === 200, status: state.whisperStatus, text: function () { return Promise.resolve(state.whisperStatus === 200 ? ' hello from the caller ' : 'unavailable'); } }); }
  return Promise.reject(new Error('unexpected fetch ' + url));
};

function seed() {
  var db = new FakeDb({});
  var proto = Object.getPrototypeOf(db.from('phone_voicemails'));
  if (!proto.lt) { proto.lt = function (k, v) { this.filters.push(function (r) { return String(r[k]) < String(v); }); return this; }; }
  var old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  var url = 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE1';
  db.t.phone_voicemails = [
    { id: 'vm1', recording_url: url, transcript_status: 'pending', created_at: old },
    { id: 'vm2', recording_url: url, transcript_status: 'failed', created_at: old },
  ];
  db.t.phone_recordings = [];
  return db;
}

var CRON = require(path.join(root, 'src/app/api/phone/transcribe-cron/route.js'));
var WORK = require(path.join(root, 'src/app/api/phone/transcribe-async/route.js'));
function cron(headers) { return CRON.GET(new Request('http://x/api/phone/transcribe-cron', { headers: headers || {} })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function work(headers, body) { return WORK.POST(new Request('http://x/api/phone/transcribe-async', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function asyncCalls() { return state.fetches.filter(function (f) { return /transcribe-async$/.test(f.url); }); }

(async function () {
  console.log('UF — transcribe-cron authorization (production mode)');
  state.db = seed(); state.fetches = [];
  var a = await cron({});
  check('no headers → 401, nothing dispatched', a._status === 401 && asyncCalls().length === 0, a);
  var b = await cron({ 'x-manual-trigger': 'yes' });
  check('only x-manual-trigger: yes → 401 (bypass removed), nothing dispatched', b._status === 401 && asyncCalls().length === 0, b);
  var c = await cron({ authorization: 'Bearer wrong' });
  check('wrong cron secret → 401', c._status === 401 && asyncCalls().length === 0, c);
  var saved = process.env.CRON_SECRET; process.env.CRON_SECRET = '';
  var d = await cron({ authorization: 'Bearer ' });
  check('CRON_SECRET empty + "Bearer " → 401 (empty secret never matches)', d._status === 401 && asyncCalls().length === 0, d);
  process.env.CRON_SECRET = saved;
  process.env.NODE_ENV = 'development';
  var e = await cron({});
  check('not production + no secret → still 401 (dev shortcut removed)', e._status === 401 && asyncCalls().length === 0, e);
  process.env.NODE_ENV = 'production';

  console.log('UF — transcribe-cron with the valid cron secret');
  state.fetches = [];
  var ok = await cron({ authorization: 'Bearer cron-test-secret' });
  var calls = asyncCalls();
  check('valid cron secret → 200 ok', ok._status === 200 && ok.ok === true, ok);
  check('dispatches only the pending voicemail (vm1), never the failed one (vm2)', calls.length === 1 && /"id":"vm1"/.test(calls[0].opts.body), calls.map(function (x) { return x.opts.body; }));
  check('dispatch carries the internal secret header', calls.length === 1 && calls[0].opts.headers['X-Internal-Trigger'] === 'internal-test-secret', calls[0] && calls[0].opts.headers);

  console.log('UF — transcribe-cron: a failed queue read is not an empty queue');
  state.db = seed(); state.fetches = [];
  state.db.fail.phone_voicemails = { select: 'relation does not exist' };
  state.db.fail.phone_recordings = { select: 'permission denied' };
  var bad = await cron({ authorization: 'Bearer cron-test-secret' });
  check('both reads fail → 500 ok:false with both read errors', bad._status === 500 && bad.ok === false && bad.results.read_errors.length === 2, bad);
  state.db = seed(); state.db.fail.phone_recordings = { select: 'timeout' };
  var half = await cron({ authorization: 'Bearer cron-test-secret' });
  check('one read fails → still 500 (named), the readable table is still processed', half._status === 500 && /phone_recordings/.test(half.results.read_errors[0]) && half.results.voicemails === 1, half);

  console.log('UF — transcribe-async worker');
  var url = 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE1';
  state.db = seed(); state.fetches = [];
  var f0 = await work({}, { kind: 'voicemail', id: 'vm1', recording_url: url });
  check('no internal secret in production → 403, nothing fetched', f0._status === 403 && state.fetches.length === 0, f0);
  state.whisperStatus = 503;
  var f1 = await work({ 'x-internal-trigger': 'internal-test-secret' }, { kind: 'voicemail', id: 'vm1', recording_url: url });
  check('Whisper 503 → 500 and the row is marked failed (documented: not retried by the cron)', f1._status === 500 && state.db.t.phone_voicemails[0].transcript_status === 'failed', [f1, state.db.t.phone_voicemails[0]]);
  state.whisperStatus = 200; state.db = seed();
  var f2 = await work({ 'x-internal-trigger': 'internal-test-secret' }, { kind: 'voicemail', id: 'vm1', recording_url: url });
  check('success → 200 saved:true and the row is completed with the text', f2._status === 200 && f2.saved === true && state.db.t.phone_voicemails[0].transcript_status === 'completed' && state.db.t.phone_voicemails[0].transcript === 'hello from the caller', [f2, state.db.t.phone_voicemails[0]]);
  state.db = seed(); state.db.fail.phone_voicemails = { update: 'database unavailable' };
  var f3 = await work({ 'x-internal-trigger': 'internal-test-secret' }, { kind: 'voicemail', id: 'vm1', recording_url: url });
  check('transcript produced but the save fails → 500 saved:false (never reported as saved)', f3._status === 500 && f3.saved === false && f3.ok === false && /could not be saved/.test(f3.error), f3);
  state.db = seed(); state.fetches = [];
  var f5 = await work({ 'x-internal-trigger': 'internal-test-secret' }, { kind: 'voicemail', id: 'missing-row', recording_url: url });
  check('unknown voicemail id → 404 before any Twilio/Whisper call (no paid work)', f5._status === 404 && f5.ok === false && state.fetches.length === 0, [f5, state.fetches.length]);
  state.db = seed(); state.fetches = [];
  var realFetch = global.fetch;
  global.fetch = function (u, o) { if (/api\.openai\.com/.test(u)) { state.db.t.phone_voicemails = state.db.t.phone_voicemails.filter(function (r) { return r.id !== 'vm1'; }); } return realFetch(u, o); };
  var f6 = await work({ 'x-internal-trigger': 'internal-test-secret' }, { kind: 'voicemail', id: 'vm1', recording_url: url });
  global.fetch = realFetch;
  check('voicemail removed while Whisper was working → 500 saved:false, never "saved"', f6._status === 500 && f6.saved === false && f6.ok === false && /row not found/.test(f6.error) && state.db.t.phone_voicemails.length === 1, f6);
  var f4 = await work({ 'x-internal-trigger': 'internal-test-secret' }, { kind: 'voicemail', id: 'vm1', recording_url: 'https://evil.example/x' });
  check('non-Twilio recording URL still refused → 400', f4._status === 400, f4);

  console.log('UF — schedule and labels');
  var vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  check('transcribe-cron is NOT scheduled in vercel.json (retry needs a reviewed design first)', !vj.crons.some(function (c) { return /transcribe-cron/.test(c.path); }));
  var health = fs.readFileSync(path.join(root, 'src/app/api/phone/health/route.js'), 'utf8');
  check('health reports TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET (the names the token route reads)', /process\.env\.TWILIO_API_KEY_SID/.test(health) && /process\.env\.TWILIO_API_KEY_SECRET/.test(health) && !/process\.env\.TWILIO_API_KEY\b(?!_)/.test(health) && !/process\.env\.TWILIO_API_SECRET/.test(health));
  var token = fs.readFileSync(path.join(root, 'src/app/api/phone/token/route.js'), 'utf8');
  check('token route really reads those names', /TWILIO_API_KEY_SID/.test(token) && /TWILIO_API_KEY_SECRET/.test(token));
  check('the cron route no longer reads the x-manual-trigger header', !/headers\.get\(\s*['"]x-manual-trigger['"]\s*\)/i.test(fs.readFileSync(path.join(root, 'src/app/api/phone/transcribe-cron/route.js'), 'utf8')));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
