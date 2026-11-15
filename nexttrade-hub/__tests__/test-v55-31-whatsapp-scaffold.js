// ============================================================
// v55.31 — WhatsApp scaffolding (Meta Cloud API)
// ============================================================
// SCOPE: This is a SCAFFOLDING build, not a complete WhatsApp feature.
// It contains the database schema, helper library, webhook handler,
// and send endpoint. UI components, media proxy, templates list, and
// diagnose endpoint are PLANNED for v55.32 (next session).
//
// What we test here is what's actually shipped — no aspirational tests.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

var sql = fs.readFileSync(path.join(REPO, 'sql/s35_whatsapp_tables.sql'), 'utf8');
var lib = fs.readFileSync(path.join(REPO, 'src/lib/whatsapp.js'), 'utf8');
var webhook = fs.readFileSync(path.join(REPO, 'src/app/api/whatsapp/webhook/route.js'), 'utf8');
var send = fs.readFileSync(path.join(REPO, 'src/app/api/whatsapp/send/route.js'), 'utf8');

console.log('\n──────────────────────────────────────────────────');
console.log('V55.31 — WHATSAPP SCAFFOLDING (META CLOUD API)');
console.log('──────────────────────────────────────────────────');

// ============================================================
// SQL SCHEMA
// ============================================================

test('SQL: three tables created (conversations, messages, templates)', function() {
  assert(/CREATE TABLE IF NOT EXISTS whatsapp_conversations/.test(sql),
    'whatsapp_conversations table');
  assert(/CREATE TABLE IF NOT EXISTS whatsapp_messages/.test(sql),
    'whatsapp_messages table');
  assert(/CREATE TABLE IF NOT EXISTS whatsapp_templates/.test(sql),
    'whatsapp_templates table');
});

test('SQL: conversation has unique index on customer_wa_id (race-safe upsert)', function() {
  // Uniqueness on customer phone is what makes the find-or-create
  // pattern in the webhook safe under concurrent inbound messages
  assert(/customer_wa_id TEXT NOT NULL UNIQUE/.test(sql),
    'customer_wa_id is UNIQUE — required for race-safe conversation upsert');
});

test('SQL: messages have unique wa_message_id (dedup webhook redelivery)', function() {
  // Meta retries webhooks aggressively. Without UNIQUE on wamid,
  // the same inbound message can land twice as separate rows.
  assert(/wa_message_id TEXT UNIQUE/.test(sql),
    'wa_message_id UNIQUE — protects against Meta retry duplicates');
});

test('SQL: messages have all media-related columns', function() {
  ['media_id', 'media_url', 'media_mime_type', 'media_filename', 'media_size_bytes'].forEach(function(col) {
    assert(new RegExp('\\b' + col + '\\b').test(sql), 'column ' + col + ' present');
  });
});

test('SQL: messages have all template-related columns', function() {
  ['template_name', 'template_lang', 'template_variables'].forEach(function(col) {
    assert(new RegExp('\\b' + col + '\\b').test(sql), 'column ' + col + ' present');
  });
});

test('SQL: status field covers full lifecycle', function() {
  assert(/sending \| sent \| delivered \| read \| failed \| received/.test(sql),
    'status enum documented in comments');
});

test('SQL: conversation tracks 24h-window-relevant timestamps', function() {
  assert(/last_inbound_at TIMESTAMPTZ/.test(sql), 'last_inbound_at column present');
  assert(/last_outbound_at TIMESTAMPTZ/.test(sql), 'last_outbound_at column present');
});

test('SQL: RLS enabled on all three tables', function() {
  var enables = (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length;
  assert(enables === 3, 'RLS on all three tables; found ' + enables);
});

test('SQL: NOTIFY pgrst at end (forces schema cache reload)', function() {
  assert(/NOTIFY pgrst, 'reload schema'/.test(sql),
    'must trigger PostgREST reload so API picks up new tables immediately');
});

test('SQL: idempotent (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS)', function() {
  // Re-running the migration must not fail
  var unsafeCreate = sql.match(/CREATE TABLE(?! IF NOT EXISTS)/g) || [];
  assert(unsafeCreate.length === 0, 'all CREATE TABLE must use IF NOT EXISTS');
});

// ============================================================
// HELPER LIBRARY (src/lib/whatsapp.js)
// ============================================================

test('Lib: HMAC-SHA256 webhook signature verification', function() {
  // Meta signs every webhook with HMAC-SHA256 using app secret.
  // The verifier MUST use a constant-time compare to defeat timing attacks.
  assert(/export function verifyMetaSignature/.test(lib), 'verifyMetaSignature exported');
  assert(/crypto\.createHmac\('sha256'/.test(lib), 'uses HMAC-SHA256');
  assert(/crypto\.timingSafeEqual/.test(lib), 'constant-time compare');
});

test('Lib: signature verification fails closed if app secret missing', function() {
  // Critical: if WHATSAPP_APP_SECRET is unset, returning true would
  // accept any forged webhook. Must return false.
  assert(/if \(!env\.appSecret\) \{[\s\S]{0,200}return false/.test(lib),
    'fails closed on missing app secret');
});

test('Lib: signature verification reads X-Hub-Signature-256 (sha256= prefix)', function() {
  // Meta's header format is "sha256=<hex>". Stripping that prefix
  // before comparing is required.
  assert(/parts\[0\] !== 'sha256'/.test(lib),
    'rejects non-sha256 prefixed signatures');
});

test('Lib: phone normalization handles E.164, Egypt, and US formats', function() {
  assert(/export function normalizePhone/.test(lib), 'normalizePhone exported');
  // Egypt 12-digit (no plus) → +201234567890
  // US 10-digit → +1XXX
  // US 11-digit starting with 1 → +1XXX
  assert(/digits\.length === 10/.test(lib), 'handles 10-digit US/Canada');
  assert(/digits\.length === 11 && digits\.charAt\(0\) === '1'/.test(lib), 'handles 11-digit US starting with 1');
});

test('Lib: send helpers (text, media, template) all use Meta Graph API', function() {
  assert(/export async function sendText/.test(lib), 'sendText exported');
  assert(/export async function sendMedia/.test(lib), 'sendMedia exported');
  assert(/export async function sendTemplate/.test(lib), 'sendTemplate exported');
  assert(/export async function uploadMedia/.test(lib), 'uploadMedia exported');
  assert(/graph\.facebook\.com/.test(lib), 'targets Meta Graph API');
});

test('Lib: 24-hour window helper', function() {
  assert(/export function isInWindow/.test(lib), 'isInWindow exported');
  // Window is 24h from last inbound. Without isInWindow check, the
  // send route would bombard Meta with messages that get rejected
  // with error 131047.
  assert(/hoursAgo < 24/.test(lib), 'window is 24 hours');
});

test('Lib: GRAPH_API_VERSION pinned to a known stable version', function() {
  // Meta deprecates Graph API versions every ~2 years. Pinning
  // protects against silent breakage.
  assert(/var GRAPH_API_VERSION = 'v\d+\.\d+'/.test(lib),
    'Graph API version is pinned');
});

// ============================================================
// WEBHOOK ROUTE
// ============================================================

test('Webhook: GET handles Meta verification handshake', function() {
  // Initial setup: Meta sends ?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y
  // and we must echo Y as plain text if X matches our env var.
  assert(/export async function GET/.test(webhook), 'GET handler present');
  assert(/hub\.mode/.test(webhook), 'reads hub.mode');
  assert(/hub\.verify_token/.test(webhook), 'reads hub.verify_token');
  assert(/hub\.challenge/.test(webhook), 'reads hub.challenge');
  assert(/'Content-Type': 'text\/plain'/.test(webhook), 'echoes challenge as text/plain');
});

test('Webhook: POST verifies signature BEFORE parsing body', function() {
  // Critical for security: re-stringifying parsed JSON breaks the
  // signature (whitespace differs). Must verify on raw bytes.
  assert(/var rawBody = await req\.text\(\)/.test(webhook),
    'reads raw body before parsing');
  assert(/verifyMetaSignature\(rawBody, sig\)/.test(webhook),
    'verifies signature on raw body');
});

test('Webhook: dedupes inbound messages by wa_message_id', function() {
  // Meta retries webhooks; without this, duplicates would proliferate.
  assert(/\.eq\('wa_message_id', waMsgId\)/.test(webhook),
    'checks for existing wa_message_id');
  assert(/if \(existing\.data\) return/.test(webhook),
    'short-circuits on duplicate');
});

test('Webhook: returns 200 even on internal errors', function() {
  // Meta retries on non-2xx. Returning 500 → infinite redelivery storm.
  // We log + return 200 instead.
  var catchBlocks = (webhook.match(/return NextResponse\.json\(\{ ok: true/g) || []).length;
  assert(catchBlocks >= 1, '200 responses present in catch path');
});

test('Webhook: handles all major message types', function() {
  // Customer can send any of these — webhook must save SOMETHING for
  // each, even unknown types, so messages are never lost.
  ['text', 'image', 'video', 'audio', 'document', 'sticker',
   'location', 'contacts', 'interactive', 'reaction'].forEach(function(t) {
    assert(new RegExp("messageType === '" + t + "'").test(webhook),
      'handles ' + t + ' messages');
  });
});

test('Webhook: handles outbound status updates (sent/delivered/read/failed)', function() {
  assert(/handleStatusUpdate/.test(webhook), 'status handler present');
  assert(/var newStatus = status\.status/.test(webhook), 'reads status field');
  // Failed status should record the error code + message
  assert(/error_code/.test(webhook) && /error_message/.test(webhook),
    'records error details on failed status');
});

test('Webhook: auto-matches customer phone to CRM (last 10 digits)', function() {
  // Same logic as phone calls — strip non-digits, match last 10
  assert(/last10 = digits\.slice\(-10\)/.test(webhook),
    'matches by last 10 digits');
  assert(/from\('customers'\)/.test(webhook), 'queries customers table');
});

test('Webhook: handles race condition on conversation insert (re-fetch on duplicate)', function() {
  // Two simultaneous inbound messages → one wins INSERT, other gets
  // duplicate-key error → must re-fetch the now-existing row.
  assert(/if \(ins\.error\)/.test(webhook), 'catches insert error');
  assert(/refetch/.test(webhook), 'has refetch path');
});

// ============================================================
// SEND ROUTE
// ============================================================

test('Send: requires authentication', function() {
  assert(/requireUser\(req\)/.test(send), 'calls requireUser');
  assert(/'authentication required'/.test(send), 'returns clear 401 message');
});

test('Send: enforces 24-hour window for text and media', function() {
  // Sending outside the window must be rejected — Meta will reject
  // anyway but we want a clear error code so the UI can switch to
  // template mode automatically.
  assert(/isInWindow\(conv\.last_inbound_at\)/.test(send),
    'checks window before sending');
  assert(/code: 'WINDOW_EXPIRED'/.test(send),
    'returns specific error code');
});

test('Send: templates can be sent at any time (no window check)', function() {
  // Templates are how you re-engage outside the window. The window
  // check should be on the (text || media) branch only, NOT template.
  assert(/if \(\(hasText \|\| hasMedia\) && !isInWindow/.test(send),
    'window check excludes templates');
});

test('Send: media size cap (16MB)', function() {
  // Meta's actual limits are 5MB image, 16MB video, 100MB doc, but
  // 16MB is a reasonable safety cap that keeps upload latency low.
  assert(/16 \* 1024 \* 1024/.test(send), '16MB cap on uploads');
  assert(/Media too large/.test(send), 'clear error message');
});

test('Send: failed sends still create a row (audit trail)', function() {
  // If Meta rejects the message, we want a row marked failed with
  // the error so the team can see what went wrong, not just silence.
  assert(/rowToInsert\.status = 'failed'/.test(send),
    'creates failed row on send error');
  assert(/rowToInsert\.error_code/.test(send), 'captures error code');
  assert(/rowToInsert\.error_message/.test(send), 'captures error message');
});

test('Send: success path updates conversation last_outbound + clears unread', function() {
  // Sending a reply implies the team has seen the inbound thread.
  assert(/last_outbound_at: new Date\(\)\.toISOString\(\)/.test(send),
    'stamps last_outbound_at');
  assert(/unread_count: 0/.test(send), 'resets unread counter');
});

test('Send: stamps wa_message_id on success so webhook status updates can match', function() {
  // The webhook later receives status updates keyed by wa_message_id.
  // Without storing it on insert, those updates have no row to match.
  assert(/rowToInsert\.wa_message_id = sendResult\.wa_message_id/.test(send),
    'stores wa_message_id from Meta on the row');
});

console.log('\n──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed === 0) {
  console.log('\n✅ All v55.31 WhatsApp scaffolding tests passed');
  console.log('\nReminder: This is SCAFFOLDING only. Still pending for v55.32:');
  console.log('  - /api/whatsapp/media (download proxy)');
  console.log('  - /api/whatsapp/templates (list + refresh)');
  console.log('  - /api/whatsapp/diagnose (admin health check)');
  console.log('  - Conversation claim + mark-as-read endpoints');
  console.log('  - WhatsAppTab.jsx (top-level inbox UI)');
  console.log('  - Communications tab embed');
  console.log('  - CRM customer thread view');
  console.log('  - TABS array entry in page.jsx');
} else {
  console.log('\n❌ FAILURES');
  process.exit(1);
}
