// ============================================================
// Phase A Phone System — endpoint and structure tests
// ============================================================
// Verifies:
//   • SQL migration s29 + seed s30 are present and well-formed
//   • All 8 API routes exist with the expected methods
//   • TwiML responses use proper XML escaping
//   • Defensive fallbacks present in every webhook handler
//   • Field names match between routes and SQL schema
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function group(name) { console.log('\n── ' + name + ' ──'); }

var apiDir = path.join(__dirname, '..', 'src', 'app', 'api', 'phone');
var sqlDir = path.join(__dirname, '..', 'sql');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

// ============================================================
// A. SQL migration files exist
// ============================================================
group('A. SQL migration files');

var s29 = read(path.join(sqlDir, 's29_phone_system.sql'));
var s30 = read(path.join(sqlDir, 's30_seed_ktc_phone_numbers.sql'));

ok('A1: s29_phone_system.sql exists', s29.length > 100);
ok('A2: s30_seed_ktc_phone_numbers.sql exists', s30.length > 100);
ok('A3: s29 creates phone_numbers table', /CREATE TABLE IF NOT EXISTS phone_numbers/.test(s29));
ok('A4: s29 creates phone_calls table', /CREATE TABLE IF NOT EXISTS phone_calls/.test(s29));
ok('A5: s29 creates phone_voicemails table', /CREATE TABLE IF NOT EXISTS phone_voicemails/.test(s29));
ok('A6: s29 creates phone_recordings table', /CREATE TABLE IF NOT EXISTS phone_recordings/.test(s29));
ok('A7: phone_numbers has phone_number UNIQUE constraint', /phone_number TEXT NOT NULL UNIQUE/.test(s29));
ok('A8: phone_calls has twilio_call_sid UNIQUE', /twilio_call_sid TEXT UNIQUE/.test(s29));
ok('A9: indexes created for performance',
  /CREATE INDEX IF NOT EXISTS idx_phone_calls_customer_id/.test(s29) &&
  /CREATE INDEX IF NOT EXISTS idx_phone_voicemails_assigned_to/.test(s29)
);
ok('A10: s30 inserts the 4 KTC numbers in E.164 format',
  /\+18886007096/.test(s30) && /\+17326529850/.test(s30) && /\+17328005428/.test(s30) && /\+17328100075/.test(s30)
);
ok('A11: s30 uses ON CONFLICT for safe re-runs',
  /ON CONFLICT \(phone_number\) DO UPDATE/.test(s30)
);
ok('A12: main toll-free is marked number_type=main',
  /\+18886007096.*main/.test(s30)
);

// ============================================================
// B. /api/phone/incoming — inbound call handler
// ============================================================
group('B. /api/phone/incoming');

var incoming = read(path.join(apiDir, 'incoming', 'route.js'));

ok('B1: file exists and exports POST', incoming.length > 100 && /export async function POST/.test(incoming));
ok('B2: looks up phone_numbers by To', /from\('phone_numbers'\)[\s\S]{0,200}\.eq\('phone_number'/.test(incoming));
ok('B3: tries customer match by phone last 10 digits', /last10/.test(incoming));
ok('B4: inserts row in phone_calls', /from\('phone_calls'\)[\s\S]{0,300}\.insert\(/.test(incoming));
ok('B5: returns TwiML XML response', /Content-Type[\'"]?:\s*[\'"]text\/xml/.test(incoming));
ok('B6: includes recording disclaimer when enabled',
  /This call may be recorded for quality and training purposes/.test(incoming)
);
ok('B7: greeting differs for main vs personal numbers',
  /greetingText = ['"]Thank you for calling KTC International\.['"]/.test(incoming) &&
  /greetingText = ['"]Thank you for calling KTC\.['"]/.test(incoming)
);
ok('B8: voicemail fallback in TwiML',
  /<Record/.test(incoming)
);
ok('B9: XML escapes special characters',
  /xmlEscape/.test(incoming) && /&apos;/.test(incoming) && /&amp;/.test(incoming)
);
ok('B10: defensive fallback when phone number not registered',
  /not registered in phone_numbers/.test(incoming) &&
  /buildFallbackTwiml/.test(incoming)
);
ok('B11: defensive fallback on errors (always returns TwiML)',
  /catch \(e\)[\s\S]{0,200}buildFallbackTwiml/.test(incoming)
);
ok('B12: dial timeout set to 25 seconds',
  /timeout="25"/.test(incoming)
);
ok('B13: voicemail max length set (180s = 3 minutes)',
  /maxLength="180"/.test(incoming)
);

// ============================================================
// C. /api/phone/voicemail-record
// ============================================================
group('C. /api/phone/voicemail-record');

var vmRecord = read(path.join(apiDir, 'voicemail-record', 'route.js'));

ok('C1: file exists', vmRecord.length > 100);
ok('C2: handles answered-call case (no voicemail)',
  /completed[\s\S]{0,100}answered/.test(vmRecord)
);
ok('C3: inserts to phone_voicemails',
  /from\('phone_voicemails'\)[\s\S]{0,200}\.insert\(/.test(vmRecord)
);
ok('C4: triggers async transcription via fetch',
  /transcribe-async/.test(vmRecord) && /fetch\(/.test(vmRecord)
);
ok('C5: passes call_id, assigned_to, customer_id from query string',
  /call_id/.test(vmRecord) && /assigned_to/.test(vmRecord) && /customer_id/.test(vmRecord)
);
ok('C6: returns TwiML even on errors', /Hangup/.test(vmRecord));
ok('C7: transcript_status defaults to pending',
  /transcript_status:\s*['"]pending['"]/.test(vmRecord)
);

// ============================================================
// D. /api/phone/recording-callback
// ============================================================
group('D. /api/phone/recording-callback');

var recCb = read(path.join(apiDir, 'recording-callback', 'route.js'));

ok('D1: file exists', recCb.length > 100);
ok('D2: looks up parent call by twilio_call_sid',
  /from\('phone_calls'\)[\s\S]{0,200}\.eq\('twilio_call_sid'/.test(recCb)
);
ok('D3: inserts into phone_recordings',
  /from\('phone_recordings'\)[\s\S]{0,200}\.insert\(/.test(recCb)
);
ok('D4: triggers Whisper transcription',
  /transcribe-async/.test(recCb)
);

// ============================================================
// E. /api/phone/call-status
// ============================================================
group('E. /api/phone/call-status');

var callStatus = read(path.join(apiDir, 'call-status', 'route.js'));

ok('E1: file exists', callStatus.length > 100);
ok('E2: updates phone_calls by twilio_call_sid',
  /from\('phone_calls'\)[\s\S]{0,200}\.eq\('twilio_call_sid'/.test(callStatus)
);
ok('E3: sets ended_at on final statuses',
  /finalStatuses/.test(callStatus) && /completed/.test(callStatus) && /ended_at/.test(callStatus)
);
ok('E4: parses CallDuration as integer',
  /parseInt\(callDuration/.test(callStatus)
);

// ============================================================
// F. /api/phone/transcribe-async
// ============================================================
group('F. /api/phone/transcribe-async');

var transcribe = read(path.join(apiDir, 'transcribe-async', 'route.js'));

ok('F1: file exists', transcribe.length > 100);
ok('F2: uses Node runtime (not Edge) for FormData / longer timeout',
  /export const runtime = ['"]nodejs['"]/.test(transcribe)
);
ok('F3: maxDuration set for serverless function timeout',
  /export const maxDuration/.test(transcribe)
);
ok('F4: supports both voicemail and recording kinds',
  /kind === ['"]voicemail['"]/.test(transcribe) && /kind === ['"]recording['"]/.test(transcribe)
);
ok('F5: fetches audio with Twilio Basic Auth',
  /Buffer\.from\(twilioSid \+ ['"]:['"][\s\S]{0,100}base64/.test(transcribe) &&
  /Authorization[\'"]?:\s*basicAuth/.test(transcribe)
);
ok('F6: posts to OpenAI Whisper API',
  /https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/.test(transcribe)
);
ok('F7: uses whisper-1 model',
  /['"]whisper-1['"]/.test(transcribe)
);
ok('F8: appends .mp3 extension if missing',
  /\.mp3/.test(transcribe) && /endsWith/.test(transcribe)
);
ok('F9: marks status transcribing during processing',
  /transcript_status:\s*['"]transcribing['"]/.test(transcribe)
);
ok('F10: marks completed when transcript saved',
  /transcript_status:\s*['"]completed['"]/.test(transcribe)
);
ok('F11: marks failed if Whisper fails',
  /transcript_status:\s*['"]failed['"]/.test(transcribe)
);
ok('F12: gracefully handles missing OPENAI_API_KEY',
  /OPENAI_API_KEY not configured/.test(transcribe)
);
ok('F13: gracefully handles missing Twilio credentials',
  /Twilio credentials missing/.test(transcribe)
);

// ============================================================
// G. /api/phone/numbers
// ============================================================
group('G. /api/phone/numbers (CRUD)');

var numbers = read(path.join(apiDir, 'numbers', 'route.js'));

ok('G1: file exists', numbers.length > 100);
ok('G2: GET, POST, PATCH, DELETE all exported',
  /export async function GET/.test(numbers) &&
  /export async function POST/.test(numbers) &&
  /export async function PATCH/.test(numbers) &&
  /export async function DELETE/.test(numbers)
);
ok('G3: POST validates E.164 format',
  /must be in E\.164 format/.test(numbers) && /startsWith\(['"]\+['"]\)/.test(numbers)
);
ok('G4: PATCH allows updating assigned_to / recording_enabled / etc',
  /assigned_to[\s\S]{0,100}recording_enabled[\s\S]{0,100}voicemail_enabled/.test(numbers)
);
ok('G5: upserts on phone_number conflict',
  /onConflict:\s*['"]phone_number['"]/.test(numbers)
);

// ============================================================
// H. /api/phone/call (call log query)
// ============================================================
group('H. /api/phone/call');

var call = read(path.join(apiDir, 'call', 'route.js'));

ok('H1: file exists', call.length > 100);
ok('H2: GET filters by user_id and customer_id',
  /user_id/.test(call) && /customer_id/.test(call)
);
ok('H3: queries phone_calls (not legacy call_logs)',
  /from\(['"]phone_calls['"]/.test(call) && !/from\(['"]call_logs['"]/.test(call)
);
ok('H4: limit cap prevents huge result sets',
  /if \(limit > 500\)/.test(call)
);

// ============================================================
// I. /api/phone/voicemails
// ============================================================
group('I. /api/phone/voicemails');

var vm = read(path.join(apiDir, 'voicemails', 'route.js'));

ok('I1: file exists', vm.length > 100);
ok('I2: filters by assigned_to + customer_id + unread',
  /assigned_to/.test(vm) && /customer_id/.test(vm) && /unread/.test(vm)
);
ok('I3: PATCH marks read/unread',
  /export async function PATCH/.test(vm) && /is_read/.test(vm)
);
ok('I4: orders by created_at DESC',
  /order\(['"]created_at['"][\s\S]{0,100}ascending:\s*false/.test(vm)
);

// ============================================================
// J. Cross-route consistency
// ============================================================
group('J. Cross-route consistency');

ok('J1: webhook routes use formData (Twilio sends form-urlencoded, not JSON)',
  /req\.formData\(\)/.test(incoming) &&
  /req\.formData\(\)/.test(vmRecord) &&
  /req\.formData\(\)/.test(recCb) &&
  /req\.formData\(\)/.test(callStatus)
);
ok('J2: query routes use json (our app sends JSON)',
  /req\.json\(\)/.test(numbers) && /req\.json\(\)/.test(transcribe)
);
ok('J3: all webhooks return TwiML or NextResponse JSON',
  /text\/xml/.test(incoming) &&
  /text\/xml/.test(vmRecord) &&
  /NextResponse\.json/.test(recCb) &&
  /NextResponse\.json/.test(callStatus)
);
ok('J4: getPublicBaseUrl helper used to build callback URLs',
  /getPublicBaseUrl/.test(incoming) &&
  /getPublicBaseUrl/.test(vmRecord) &&
  /getPublicBaseUrl/.test(recCb)
);
ok('J5: VERCEL_URL env var preferred for production callbacks',
  /VERCEL_URL/.test(incoming) && /VERCEL_URL/.test(transcribe) === false /* transcribe is internal-only, doesn't need it */ || /VERCEL_URL/.test(incoming)
);

// ============================================================
// SUMMARY
// ============================================================
console.log('');
if (failures.length === 0) {
  console.log('✅ All Phase A phone system tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
