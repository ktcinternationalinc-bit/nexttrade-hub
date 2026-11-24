const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const identitySource = fs.readFileSync(path.join(root, 'src/lib/phone-identity.js'), 'utf8');
const { resolvePhoneIdentity } = vm.runInNewContext(identitySource.replace('export async function', 'async function') + '\n({resolvePhoneIdentity})');
const auth = { id: 'auth-id', email: 'Team_Member@example.com', email_confirmed_at: '2026-01-01' };
const profile = { id: 'hub-id', email: 'team_member@example.com', active: true };
let checks = 0;
function dbFor({ direct = null, candidates = [profile], directError = null, emailError = null } = {}) {
  const reads = [];
  return { reads, from(table) {
    assert.equal(table, 'users');
    return { select() { return this; }, eq(key, value) {
      reads.push({ key, value }); return this;
    }, async maybeSingle() { return { data: direct, error: directError }; },
    ilike(key, value) { reads.push({ key, value }); return this; },
    async limit(n) { assert.equal(n, 3); return { data: candidates, error: emailError }; } };
  } };
}
async function run(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await run('Legacy team ID maps from verified login', async () => {
    const db = dbFor();
    assert.equal((await resolvePhoneIdentity(db, auth, profile.id)).identity, profile.id);
    assert.equal(db.reads[1].value, 'team\\_member@example.com');
  });
  for (const requested of [undefined, null, auth.id]) await run('Missing/Auth ID still returns Hub routing identity: ' + requested, async () => {
    assert.equal((await resolvePhoneIdentity(dbFor(), auth, requested)).identity, profile.id);
  });
  await run('Main line matching UUID remains supported', async () => {
    const db = dbFor({ direct: { ...profile, id: auth.id } });
    assert.equal((await resolvePhoneIdentity(db, auth, auth.id)).identity, auth.id);
    assert.equal(db.reads.length, 1);
  });
  for (const requested of ['another-user', '', {}, 123]) await run('Reject impersonation/invalid requested ID: ' + JSON.stringify(requested), async () => {
    assert.equal((await resolvePhoneIdentity(dbFor(), auth, requested)).status, 403);
  });
  for (const badAuth of [null, { ...auth, is_anonymous: true }, { ...auth, deleted_at: 'now' }, { ...auth, banned_until: '2999-01-01' }, { ...auth, email_confirmed_at: null }]) {
    await run('Reject invalid/unverified login ' + JSON.stringify(badAuth), async () => {
      assert.equal((await resolvePhoneIdentity(dbFor(), badAuth, profile.id)).status, 403);
    });
  }
  for (const options of [{ candidates: [] }, { candidates: [profile, profile] }, { candidates: [{ ...profile, active: false }] }, { direct: { ...profile, active: false } }, { candidates: [{ ...profile, email: 'teamXmember@example.com' }] }]) {
    await run('Reject missing, ambiguous, inactive or nonliteral profile ' + JSON.stringify(options), async () => {
      assert.equal((await resolvePhoneIdentity(dbFor(options), auth, profile.id)).status, 403);
    });
  }
  for (const options of [{ directError: { message: 'offline' } }, { emailError: { message: 'offline' } }]) await run('Database errors fail closed', async () => {
    assert.equal((await resolvePhoneIdentity(dbFor(options), auth, profile.id)).status, 503);
  });

  // Execute the actual token route with only its network boundary mocked.
  // The real Twilio SDK signs/verifies the grants and identity below.
  const twilio = require('twilio');
  const routeSource = fs.readFileSync(path.join(root, 'src/app/api/phone/token/route.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export const runtime = 'nodejs';/, '')
    .replace('export async function POST', 'async function POST');
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_API_KEY_SID: 'SK' + 'b'.repeat(32),
    TWILIO_API_KEY_SECRET: 'test-signing-secret', TWILIO_TWIML_APP_SID: 'AP' + 'c'.repeat(32) };
  function routeFor(login = auth, options = {}, limited = false) {
    const db = dbFor(options);
    const baseFrom = db.from;
    db.from = table => table === 'users' ? baseFrom(table) : {
      select() { return this; }, eq(key, value) { db.assignedTo = value; return this; },
      async maybeSingle() { return { data: { phone_number: '+15555550100', label: 'Test' } }; }
    };
    const POST = vm.runInNewContext(routeSource + '\nPOST', {
      NextResponse: { json: (body, init) => Response.json(body, init) },
      createClient: () => db, twilio, resolvePhoneIdentity,
      requireUser: async () => ({ user: login }), checkRateLimit: () => ({ ok: !limited, retryAfter: 60 }),
      getRateLimitKey: () => 'test', process: { env }, console
    });
    return { POST, db };
  }
  for (const [label, login, options, requested, expected] of [
    ['team', auth, {}, profile.id, profile.id],
    ['main', auth, { direct: { ...profile, id: auth.id } }, auth.id, auth.id],
    ['refresh', auth, {}, auth.id, profile.id]
  ]) await run('Actual route issues signed token and assigned number for ' + label, async () => {
    const { POST, db } = routeFor(login, options);
    const response = await POST({ json: async () => ({ user_id: requested }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const data = await response.json();
    const jwt = require('jsonwebtoken').verify(data.token, env.TWILIO_API_KEY_SECRET, { algorithms: ['HS256'] });
    assert.equal(jwt.grants.identity, expected);
    assert.equal(jwt.grants.voice.incoming.allow, true);
    assert.equal(jwt.grants.voice.outgoing.application_sid, env.TWILIO_TWIML_APP_SID);
    assert.equal(data.identity, expected);
    assert.equal(db.assignedTo, expected);
    assert.equal(jwt.exp - jwt.iat, 3600);
  });
  for (const [label, login, limited, body, expected] of [
    ['anonymous', null, false, {}, 401], ['rate limit', auth, true, {}, 429],
    ['impersonation', auth, false, { user_id: 'someone-else' }, 403],
    ['null body', auth, false, null, 400], ['array body', auth, false, [], 400]
  ]) await run('Actual route rejects ' + label, async () => {
    assert.equal((await routeFor(login, {}, limited).POST({ json: async () => body })).status, expected);
  });
  await run('Actual route rejects malformed JSON', async () => {
    assert.equal((await routeFor().POST({ json: async () => { throw new Error('invalid'); } })).status, 400);
  });
  const incoming = fs.readFileSync(path.join(root, 'src/app/api/phone/incoming/route.js'), 'utf8');
  const outbound = fs.readFileSync(path.join(root, 'src/app/api/phone/outbound/route.js'), 'utf8');
  await run('Token identity matches existing incoming and outgoing assignment contract', async () => {
    assert.match(incoming, /<Client>.*assignment\.assigned_to/);
    assert.match(outbound, /\.eq\('assigned_to', identity\)/);
  });
  for (const mode of ['browser', 'browser_cell']) await run('Incoming TwiML rings resolved identity: ' + mode, async () => {
    const assignment = { id: 'number-id', assigned_to: profile.id, number_type: mode === 'browser' ? 'personal' : 'main', recording_enabled: false };
    const inserts = [];
    const fakeDb = { from(table) { return {
      select() { return this; }, eq() { return this; }, or() { return this; },
      async limit() { return { data: [] }; },
      async maybeSingle() { return { data: table === 'phone_numbers' ? assignment : { phone_routing: mode, forwarding_number: '+15555550200', phone_vacation_mode: false } }; },
      insert(row) { inserts.push(row); return this; }, async single() { return { data: { id: 'call-id' } }; }
    }; } };
    const code = incoming.replace(/^import .*;\r?\n/gm, '').replace('export async function POST', 'async function POST');
    const POST = vm.runInNewContext(code + '\nPOST', { createClient: () => fakeDb,
      verifyTwilioSignature: () => true, readFormDataAsObject: async () => ({ To: '+15555550100', From: '+15555550300', CallSid: 'CA-test' }),
      Response, URL, process: { env: { NEXT_PUBLIC_APP_URL: 'https://nexttrade-hub.vercel.app' } }, console });
    const request = new Request('https://nexttrade-hub.vercel.app/api/phone/incoming', { method: 'POST', body: new URLSearchParams({ To: '+15555550100', From: '+15555550300', CallSid: 'CA-test' }) });
    const response = await POST(request);
    const xml = await response.text();
    assert.match(xml, /<Client>hub-id<\/Client>/);
    assert.equal(xml.includes('<Number>+15555550200</Number>'), mode === 'browser_cell');
    assert.equal(inserts[0].user_id, profile.id);
    assert.ok(xml.includes('/api/phone/voicemail-record'));
  });
  console.log('\n' + checks + ' checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
