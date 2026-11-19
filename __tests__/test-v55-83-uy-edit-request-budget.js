// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UY — Sourcing desk:
//   A. Max, Nov 19: "edit the request" — the edit_request action (real /api/commercial handler, real verified-caller,
//      real permissions; in-memory database).
//   B. Codex 18 Nov 23:06 — when this month's spending cannot be read, nothing paid runs; the monthly limit counts
//      searches AND the AI's work.
//   C. Max, Nov 19: "i need a smart AI" — the request sent to the AI service (model, size, no forced tool) and a
//      declined request ends as a plain failure.
// No network, no mail, no paid search. Run: node __tests__/test-v55-83-uy-edit-request-budget.js
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

var MAX = '11111111-1111-4111-8111-111111111111', MAX_AUTH = 'a1111111-1111-4111-8111-111111111111';
var STAFF = '22222222-2222-4222-8222-222222222222', STAFF_AUTH = 'a2222222-2222-4222-8222-222222222222';
var ADMIN = '44444444-4444-4444-8444-444444444444', ADMIN_AUTH = 'a4444444-4444-4444-8444-444444444444';
var TOKENS = { 'tok-max': { id: MAX_AUTH }, 'tok-staff': { id: STAFF_AUTH }, 'tok-admin': { id: ADMIN_AUTH } };
var PROFILE_OF = {}; PROFILE_OF[MAX_AUTH] = MAX; PROFILE_OF[STAFF_AUTH] = STAFF; PROFILE_OF[ADMIN_AUTH] = ADMIN;

var state = { db: null, audits: [] };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/audit-server.js', { audit: function (db, actor, action, entity, id, details) { state.audits.push({ actor: actor, action: action, id: id, details: details }); return Promise.resolve(); } });
// the REAL research worker is loaded first (parts B and C), then replaced by a stand-in for the route (part A)
process.env.ANTHROPIC_API_KEY = 'test-key';
delete process.env.COMMERCIAL_AGENT_MODEL; delete process.env.COMMERCIAL_WEB_SEARCH_TOOL; delete process.env.COMMERCIAL_SEARCH_MONTHLY_CAP_USD;
var S = require(path.join(root, 'src/lib/sourcing.js'));
var SS = require(path.join(root, 'src/lib/sourcing-server.js'));
stub('src/lib/sourcing-server.js', {
  monthUsage: function () { return Promise.resolve({ spent: 0, cap: 50, fits: true }); },
  integrationHealth: function () { return Promise.resolve([]); },
  runNextJob: function () { return Promise.resolve({ ran: false }); },
});
var MS = require(path.join(root, 'src/lib/commercial-mail-server.js'));   // the REAL one, for imapWhy (part E)
var CM = require(path.join(root, 'src/lib/commercial-mail.js'));
state.mailOn = false;
stub('src/lib/commercial-mail-server.js', {
  mailConfig: function () { return { configured: !!state.mailOn, user: state.mailOn ? 'info@ktcus.com' : '', sender: CM.senderFrom({}), smtp_host: 'smtp.hostinger.com', smtp_port: 465 }; },
  sendApproved: function () { return Promise.resolve({ ok: true }); }, testMailbox: function () { return Promise.resolve({ ok: true }); },
  checkInbox: function () { return Promise.resolve({ ok: true }); }, prepareFollowUps: function () { return Promise.resolve(0); },
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function (url, key) {
  if (key === 'anon-key') { return { auth: { getUser: function (t) { var u = TOKENS[t]; return Promise.resolve(u ? { data: { user: Object.assign({ is_anonymous: false }, u) }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }); } } }; }
  return state.db;
} } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

var R = require(path.join(root, 'src/app/api/commercial/route.js'));
function post(body, token) {
  var h = { 'content-type': 'application/json', origin: 'http://hub.test' };
  if (token) { h.authorization = 'Bearer ' + token; }
  return R.POST(new Request('http://hub.test/api/commercial', { method: 'POST', body: JSON.stringify(body), headers: h })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}
var REQ = '77777777-7777-4777-8777-777777777777';
function seed(stage) {
  // the database's own rule (uq_agent_job_live): one waiting-or-running job per request
  var db = new FakeDb({ agent_jobs: [{ cols: ['kind', 'ref_id'], where: function (r) { return !r.status || r.status === 'queued' || r.status === 'running'; } }] });
  var orig = db.from;
  db.from = function (t) { var q = orig(t); q.single = function () { q._one = true; return q; };
    var ex = q.exec; q.exec = function () { var s = q.single; if (typeof s === 'function') { q.single = false; } var out = ex.call(q); q.single = s; if (q._one && out && Array.isArray(out.data)) { out.data = out.data[0] || null; } return out; }; return q; };
  db.rpc = function (name, args) { var p = PROFILE_OF[args.p_auth_user_id]; return Promise.resolve({ data: p ? [{ profile_id: p }] : [], error: null }); };
  db.t.users = [{ id: MAX, name: 'Max', role: 'super_admin' }, { id: STAFF, name: 'Staff', role: 'employee' }, { id: ADMIN, name: 'Admin', role: 'admin' }];
  db.t.module_permissions = [{ user_id: STAFF, module_name: 'commercial.access', has_access: true }];
  db.t.sourcing_requests = [{ id: REQ, seq: 1, stage: stage || 'new', company: 'KTC International Enterprises', direction: 'buy', product: 'caterpillar 966F used', title: 'caterpillar 966F used',
    specs: null, quantity: null, destination: null, needed_by: null, internal_note: 'target 40k, asked by Ali', due_date: '2026-12-01', created_by: STAFF, owner_id: STAFF }];
  db.t.agent_jobs = []; db.t.commercial_messages = [];
  return db;
}
function row() { return state.db.t.sourcing_requests[0]; }
var GOOD = { company: 'KTC International Enterprises', direction: 'buy', product: 'Used Caterpillar 966F wheel loader', specs: '1995 or newer, working', quantity: '2 units', destination: 'Alexandria, Egypt', needed_by: '', internal_note: 'target 40k, asked by Ali' };

// a tiny stand-in for the worker's database calls (part B)
function mini(o) {
  var log = [];
  return { log: log,
    rpc: function () { return Promise.resolve({ data: [o.job], error: null }); },
    from: function (t) {
      var q = { t: t, op: 'select' };
      function res() {
        if (q.op === 'select' && t === 'agent_jobs') { return o.usageError ? { data: null, error: { message: 'connection timed out' } } : { data: o.usageRows || [], error: null }; }
        if (q.op === 'select' && t === 'sourcing_requests') { return { data: o.request, error: null }; }
        return { data: [], error: null };
      }
      var api = { select: function () { return api; }, eq: function () { return api; }, gte: function () { return api; }, in: function () { return api; }, limit: function () { return api; }, order: function () { return api; },
        update: function (p) { q.op = 'update'; q.patch = p; log.push(q); return api; }, insert: function (p) { q.op = 'insert'; q.row = p; log.push(q); return api; },
        maybeSingle: function () { return Promise.resolve(res()); }, single: function () { return Promise.resolve(res()); },
        then: function (a, b) { return Promise.resolve(res()).then(a, b); } };
      return api;
    } };
}

(async function () {
  console.log('A — edit a request after it was created');
  state.db = seed(); state.audits = [];
  var a1 = await post({ action: 'edit_request', id: REQ, user_id: MAX, request: GOOD });
  check('A1: no sign-in token → 401 and nothing changes', a1._status === 401 && row().product === 'caterpillar 966F used', a1);
  var a2 = await post({ action: 'edit_request', id: REQ, user_id: MAX, request: GOOD }, 'tok-staff');
  check('A2: a token for one person with another person’s id in the body → refused, nothing changes', a2._status === 403 && row().product === 'caterpillar 966F used', a2);
  var a3 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-admin');
  check('A3: an admin without the Sourcing desk switch → 403, nothing changes', a3._status === 403 && row().product === 'caterpillar 966F used', a3);
  var a4 = await post({ action: 'edit_request', id: REQ, request: Object.assign({}, GOOD, { product: 'x' }) }, 'tok-staff');
  check('A4: the same rules as a new request (a product is required) → 400, nothing changes', a4._status === 400 && /product/i.test(a4.error || '') && row().product === 'caterpillar 966F used' && state.audits.length === 0, a4);

  var a5 = await post({ action: 'edit_request', id: REQ, request: Object.assign({}, GOOD, { stage: 'closed', owner_id: MAX, due_date: '2030-01-01', seq: 99 }) }, 'tok-staff');
  var r5 = row();
  check('A5: staff with the switch edits product, specs, quantity, destination → saved', a5._status === 200 && a5.ok && r5.product === GOOD.product && r5.specs === GOOD.specs && r5.quantity === GOOD.quantity && r5.destination === GOOD.destination, a5);
  check('A6: the answer lists exactly what changed', JSON.stringify((a5.changed || []).slice().sort()) === JSON.stringify(['destination', 'product', 'quantity', 'specs']), a5.changed);
  check('A7: stage, owner, due date and number cannot be changed through an edit', r5.stage === 'new' && r5.owner_id === STAFF && r5.due_date === '2026-12-01' && r5.seq === 1, r5);
  check('A8: the title followed the product (it was never given its own wording)', r5.title === GOOD.product, r5.title);
  var au = state.audits[0] || {};
  check('A9: the audit entry names the verified person and keeps the old and new values', state.audits.length === 1 && au.actor === STAFF && au.action === 'sourcing_request_edited' && au.details.before.product === 'caterpillar 966F used' && au.details.after.product === GOOD.product && au.details.before.destination === null, au);

  state.audits = [];
  var a10 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-staff');
  check('A10: saving with nothing changed → OK, no write, no audit entry', a10._status === 200 && (a10.changed || []).length === 0 && state.audits.length === 0, a10);
  var a11 = await post({ action: 'edit_request', id: REQ, request: Object.assign({}, GOOD, { internal_note: 'target 38k now' }) }, 'tok-staff');
  var au11 = state.audits[0] || {};
  check('A11: the internal note is saved, and its text is NOT written into the audit log', a11.ok && row().internal_note === 'target 38k now' && au11.details.internal_note_changed === true && JSON.stringify(au11.details).indexOf('38k') < 0 && JSON.stringify(au11.details).indexOf('40k') < 0, au11);

  state.db = seed('researching'); state.audits = [];
  var a12 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-staff');
  check('A12: while research is running → 409, nothing changes', a12._status === 409 && row().product === 'caterpillar 966F used' && state.audits.length === 0, a12);
  state.db = seed('new'); state.db.t.agent_jobs = [{ id: 'j1', kind: 'sourcing_research', ref_id: REQ, status: 'queued' }];
  var a13 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-staff');
  check('A13: while a research job is waiting → 409, nothing changes', a13._status === 409 && row().product === 'caterpillar 966F used', a13);
  state.db = seed('closed');
  var a14 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-staff');
  check('A14: a closed request → 409 (reopen it first), nothing changes', a14._status === 409 && row().product === 'caterpillar 966F used', a14);
  state.db = seed('drafts_ready');
  state.db.t.commercial_messages = [{ id: 'm1', request_id: REQ, status: 'draft' }, { id: 'm2', request_id: REQ, status: 'pending_approval' }, { id: 'm3', request_id: REQ, status: 'sent' }, { id: 'm4', request_id: 'other', status: 'draft' }];
  var a15 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-staff');
  check('A15: the answer says how many unsent messages still carry the old wording (2), sent ones are not counted', a15.ok && a15.unsent_drafts === 2 && state.db.t.commercial_messages.length === 4, a15);
  var a16 = await post({ action: 'edit_request', id: REQ, request: Object.assign({}, GOOD, { product: 'Used Caterpillar 966G' }) }, 'tok-max');
  check('A16: the super admin can edit too', a16._status === 200 && row().product === 'Used Caterpillar 966G', a16);

  // Codex 19 Nov P2: an edit and "start research" arriving together. The edit has already read "no job waiting"; research starts
  // (REAL handler) exactly before the edit's own UPDATE runs. The edit must lose: no job may exist for a request an edit changed.
  state.db = seed('new'); state.audits = [];
  var armed = true; var fromA = state.db.from;
  state.db.from = function (t) { var q = fromA(t);
    if (t === 'sourcing_requests') { var up = q.update; q.update = function (p) { var r = up.call(q, p);
      if (armed && p && Object.prototype.hasOwnProperty.call(p, 'product')) { armed = false; var th = q.then;
        q.then = function (a, b) { return post({ action: 'start_research', id: REQ }, 'tok-max').then(function (sr) { state.raceStart = sr; return th.call(q, a, b); }); }; }
      return r; }; }
    return q; };
  var a17 = await post({ action: 'edit_request', id: REQ, request: GOOD }, 'tok-staff');
  var jobsNow = state.db.t.agent_jobs.filter(function (j) { return j.ref_id === REQ; });
  check('A17: research started in the middle of an edit → the research is queued (one job, stage researching)', state.raceStart && state.raceStart.ok && jobsNow.length === 1 && row().stage === 'researching', [state.raceStart, jobsNow.length, row().stage]);
  check('A18: … and the edit is refused (409) and changed nothing — the queued research reads the request as it was', a17._status === 409 && row().product === 'caterpillar 966F used' && row().specs === null && !state.audits.some(function (x) { return x.action === 'sourcing_request_edited'; }), a17);
  state.db = seed('new'); state.db.fail.agent_jobs = { insert: 'boom' };
  var a19 = await post({ action: 'start_research', id: REQ }, 'tok-max');
  check('A19: if the research job cannot be created, the request does not stay stuck on “researching”', !a19.ok && row().stage === 'new' && state.db.t.agent_jobs.length === 0, [a19, row().stage]);
  state.db = seed('new');
  var a20 = await post({ action: 'start_research', id: REQ }, 'tok-max'); var a20b = await post({ action: 'start_research', id: REQ }, 'tok-max');
  check('A20: research is still never queued (or paid for) twice', a20.ok && a20b._status === 409 && state.db.t.agent_jobs.length === 1 && row().stage === 'researching', [a20, a20b]);

  console.log('\nB — the monthly limit');
  check('B1: AI work is priced per model ($4 / $20 per million on the default model)', Math.abs(S.tokenCostUsd('claude-opus-5-5', 1000000, 100000) - 6) < 1e-9, S.tokenCostUsd('claude-opus-5-5', 1000000, 100000));
  check('B2: a model that is not in the list is priced at the dearest rate, never at zero', S.tokenCostUsd('some-new-model', 1000000, 0) === 10);
  var b3 = S.searchBudget(100, 50, 6, 3.5, 1);
  check('B3: spent = searches + AI work ($1.00 + $3.50)', b3.spent === 4.5 && b3.search_spent === 1 && b3.ai_spent === 3.5 && b3.left === 45.5 && b3.fits, b3);
  var b4 = S.searchBudget(100, 50, 6, 48.2, 1);
  check('B4: a run is refused when searches + AI already spent + one run’s allowance would pass the limit', !b4.fits && b4.spent === 49.2, b4);
  var b5 = S.searchBudget(4994, 50), b6 = S.searchBudget(4996, 50);
  check('B5: the old search-only arithmetic is unchanged when no AI cost is given', b5.fits && !b6.fits && b5.run_cost_max === 0.06, [b5, b6]);
  var mu = await SS.monthUsage(mini({ usageRows: [{ searches: 10, input_tokens: 500000, output_tokens: 50000 }, { searches: 5, input_tokens: 0, output_tokens: 0 }] }));
  check('B6: this month = 15 searches ($0.15) + AI work ($3.00) = $3.15; one run needs $2.06 free', mu.spent === 3.15 && mu.run_cost_max === 2.06 && mu.fits && mu.jobs === 2, mu);
  // Codex 19 Nov P2 — "the advertised maximum is not a bound": five full answers in one run
  check('B6a: a run is NOT admitted with only $1.06 free (it used to be)', !S.searchBudget(0, 1.06, 6, 0, S.AI_RUN_ALLOWANCE_USD).fits && S.searchBudget(0, 2.06, 6, 0, S.AI_RUN_ALLOWANCE_USD).fits);
  var calls5 = 0; var fiveFetch = function () { calls5++; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ stop_reason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 16000 }, content: [{ type: 'text', text: 'still working' }] }); } }); };
  var r5t = await SS.researchCall({ product: 'x', direction: 'buy' }, { fetch: fiveFetch });
  var cost5 = S.tokenCostUsd('claude-opus-5-5', r5t.usage.input_tokens, r5t.usage.output_tokens);
  check('B6b: five turns of full-length answers cost $' + cost5.toFixed(3) + ' — inside the $2.00 that was held for the run', calls5 === 5 && cost5 <= S.AI_RUN_ALLOWANCE_USD && cost5 > 1.5, [calls5, cost5]);
  var callsBig = 0; var bigFetch = function () { callsBig++; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ stop_reason: 'pause_turn', usage: { input_tokens: 150000, output_tokens: 16000 }, content: [{ type: 'text', text: 'reading a lot' }] }); } }); };
  var rBig = await SS.researchCall({ product: 'x', direction: 'buy' }, { fetch: bigFetch });
  var costBig = S.tokenCostUsd('claude-opus-5-5', rBig.usage.input_tokens, rBig.usage.output_tokens);
  check('B6c: heavy reading → the run stops itself before the next AI call instead of passing its ceiling (1 call, $' + costBig.toFixed(2) + '), and is not retried', callsBig === 1 && rBig.ceiling === true && rBig.fatal === true && costBig <= S.AI_RUN_ALLOWANCE_USD && /spending ceiling/.test(rBig.error || ''), [callsBig, rBig.error, costBig]);
  var nf1 = S.nextCallFits('claude-opus-5-5', 0, 0, 0, 2), nf2 = S.nextCallFits('claude-opus-5-5', 0, 0, 0, 0.3);
  check('B6d: the check before a call = spent so far + a full answer + twice the last reading (at least 20,000 tokens)', nf1.fits && Math.abs(nf1.worst_next - 0.4) < 1e-9 && !nf2.fits, [nf1, nf2]);

  var fetched = 0; var fakeFetch = function () { fetched++; return Promise.reject(new Error('must not be called')); };
  var job = { id: 'job1', ref_id: REQ, attempts: 1, max_attempts: 3, searches: 0, input_tokens: 0, output_tokens: 0, created_by: STAFF };
  var reqRow = { id: REQ, seq: 1, stage: 'researching', product: 'x', direction: 'buy' };
  var m1 = mini({ job: job, request: reqRow, usageError: true });
  var b7 = await SS.runNextJob(m1, { fetch: fakeFetch });
  var jp = (m1.log.filter(function (q) { return q.t === 'agent_jobs' && q.op === 'update'; })[0] || {}).patch || {};
  check('B7: spending cannot be read → the AI service is NOT called', fetched === 0 && b7.ok === false && b7.usage_unreadable === true, b7);
  check('B8: … the job waits and is tried again later, with the reason in plain words', jp.status === 'queued' && !!jp.run_after && /could not be read/.test(jp.last_error || '') && b7.will_retry === true, jp);
  var m2 = mini({ job: Object.assign({}, job, { attempts: 3 }), request: reqRow, usageError: true });
  var b9 = await SS.runNextJob(m2, { fetch: fakeFetch });
  var jp2 = (m2.log.filter(function (q) { return q.t === 'agent_jobs' && q.op === 'update'; })[0] || {}).patch || {};
  var rp2 = (m2.log.filter(function (q) { return q.t === 'sourcing_requests' && q.op === 'update'; })[0] || {}).patch || {};
  check('B9: after the last attempt it stops as failed and the request says why — still no paid call', fetched === 0 && jp2.status === 'failed' && rp2.stage === 'new' && /could not be read/.test(rp2.next_action || '') && b9.will_retry === false, [jp2, rp2]);
  var m3 = mini({ job: job, request: reqRow, usageRows: [{ searches: 4990, input_tokens: 0, output_tokens: 0 }] });
  var b10 = await SS.runNextJob(m3, { fetch: fakeFetch });
  check('B10: the limit reached → not run, no paid call', fetched === 0 && b10.cap === true && b10.ok === false, b10);

  console.log('\nC — the request sent to the AI service');
  var sent = [];
  var okFetch = function (url, init) { sent.push({ url: url, headers: init.headers, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ stop_reason: 'tool_use', usage: { input_tokens: 1200, output_tokens: 300, server_tool_use: { web_search_requests: 2 } },
      content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://dealer.example/cat-966f', title: 'CAT 966F for sale' }] },
        { type: 'tool_use', name: 'record_shortlist', input: { summary: 'Searched dealers.', candidates: [{ name: 'Example Machinery BV', role: 'stockholder', website: 'dealer.example', facts: [{ topic: 'listing', statement: 'Lists a 1996 CAT 966F, asking EUR 38,500.', grade: 'claim', source_url: 'https://dealer.example/cat-966f' }] }] } }] }); } }); };
  var c = await SS.researchCall({ product: 'caterpillar 966F used', direction: 'buy' }, { fetch: okFetch });
  var b0 = sent[0].body;
  check('C1: the stronger model is the default', b0.model === 'claude-opus-5-5' && SS.agentModel() === 'claude-opus-5-5', b0.model);
  check('C2: room for a full answer (16,000) and nothing the model rejects (no forced tool, no thinking / temperature settings)', b0.max_tokens === 16000 && b0.tool_choice === undefined && b0.thinking === undefined && b0.temperature === undefined, Object.keys(b0));
  check('C3: web search is offered with the per-run limit, plus the record tool', b0.tools[0].type === 'web_search_20250305' && b0.tools[0].max_uses === 6 && b0.tools[1].name === 'record_shortlist', b0.tools);
  check('C4: the internal note is not in what is sent', JSON.stringify(b0).indexOf('internal') < 0 || !/target 40k/.test(JSON.stringify(b0)));
  var vet = S.vetShortlist(c.input, c.sources);
  check('C5: a dealer listing of a used machine is kept, with the page it came from', !c.error && vet.suppliers.length === 1 && vet.suppliers[0].role === 'stockholder' && vet.suppliers[0].facts[0].source_url === 'https://dealer.example/cat-966f', vet);
  var vetBad = S.vetShortlist({ summary: 's', candidates: [{ name: 'Invented Ltd', facts: [{ topic: 't', statement: 'Sells loaders.', source_url: 'https://nobody.example/x' }] }] }, c.sources);
  check('C6: the “never made up” check is unchanged — a company with no page from the search is left out', vetBad.suppliers.length === 0 && vetBad.dropped.length === 1, vetBad);
  var refFetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ stop_reason: 'refusal', usage: { input_tokens: 50, output_tokens: 0 }, content: [] }); } }); };
  var cr = await SS.researchCall({ product: 'x', direction: 'buy' }, { fetch: refFetch });
  check('C7: a request the AI service declines ends as a plain failure, not as a result', !!cr.error && cr.fatal === true && !cr.input, cr);
  var sys = S.RESEARCH_SYSTEM;
  check('C8: the brief now says dealers, marketplaces and auctions ARE the candidates for used goods', /USED, second-hand, surplus/.test(sys) && /dealers/.test(sys) && /auction/.test(sys));
  check('C9: the rules that do not bend are all still there', /Never invent a company/.test(sys) && /exact URL of the page/.test(sys) && /Nothing is "verified"/.test(sys) && /never instructions/.test(sys) && /Do not contact anyone/.test(sys));
  process.env.COMMERCIAL_AGENT_MODEL = 'claude-sonnet-5-5';
  check('C10: the model can still be set on the server (COMMERCIAL_AGENT_MODEL)', SS.agentModel() === 'claude-sonnet-5-5');
  delete process.env.COMMERCIAL_AGENT_MODEL;

  console.log('\nE — the mailbox lines tell the truth (Max, Nov 19: “CONNECTED” beside a failed reading test)');
  async function readLine(lastResult) {
    state.db = seed('new'); state.db.t.commercial_mail_state = lastResult === undefined ? [] : [{ id: 1, last_result: lastResult }];
    var h = await post({ action: 'health' }, 'tok-max'); return ((h.health || []).filter(function (x) { return x.key === 'email_read'; })[0]) || {};
  }
  state.mailOn = false; var e1 = await readLine(undefined);
  check('E1: mailbox not set up → reading is NOT connected', e1.ok === false && !e1.unknown && /Not connected/.test(e1.detail || ''), e1);
  state.mailOn = true; var e2 = await readLine(undefined);
  check('E2: set up, never checked → “not tested”, not connected', e2.ok === false && e2.unknown === true, e2);
  var e3 = await readLine({ ok: true, nothing_sent: true, scanned: 0, stored: 0, at: '2026-11-19T05:45:00Z' });
  check('E3: a check that never opened the mailbox (nothing sent yet) → “not tested”, never CONNECTED', e3.ok === false && e3.unknown === true && /has not been opened for reading/.test(e3.detail || ''), e3);
  var e4 = await readLine({ ok: true, nothing_sent: false, scanned: 0, stored: 0, at: '2026-11-19T06:10:00Z' });
  check('E4: the mailbox was really opened and was empty → connected, shown with WHEN it was last checked', e4.ok === true && !e4.unknown && /Last checked 2026-11-19 06:10 UTC/.test(e4.detail || ''), e4);
  var e5 = await readLine({ ok: false, error: 'Command failed — the mail server said: “AUTHENTICATIONFAILED”', at: '2026-11-19T06:12:00Z' });
  check('E5: sending set up but reading failed → NOT WORKING with the server’s reason', e5.ok === false && !e5.unknown && /Last check failed: Command failed/.test(e5.detail || ''), e5);
  var e6 = await readLine({ ok: true, scanned: 0, stored: 0, at: '2026-11-18T23:00:00Z' });
  check('E6: a result saved by the older build (it did not record whether the mailbox was opened) → “not tested”', e6.ok === false && e6.unknown === true, e6);
  state.mailOn = false;
  var why = MS.imapWhy({ message: 'Command failed', responseText: 'NO [AUTHENTICATIONFAILED] Authentication failed.', authenticationFailed: true });
  check('E7: the mailbox test now repeats what the mail server said', /Command failed/.test(why) && /AUTHENTICATIONFAILED/.test(why) && /refused the sign-in for reading/.test(why), why);
  check('E8: with no extra detail it still says something, and never more than a short line', MS.imapWhy(new Error('Command failed')) === 'Command failed' && MS.imapWhy({ message: 'x', responseText: new Array(999).join('y') }).length <= 420);
  var tabE = fs.readFileSync(path.join(root, 'src/components/SourcingDeskTab.jsx'), 'utf8');
  check('E9: the “What is connected” box opens by itself when sending OR reading is not connected', /x\.key === "email_send" \|\| x\.key === "email_read"\) && !x\.ok/.test(tabE));

  console.log('\nD — the screen and the build');
  var tab = fs.readFileSync(path.join(root, 'src/components/SourcingDeskTab.jsx'), 'utf8');
  check('D1: the request screen has an “Edit request” button that sends edit_request', /✏ Edit request/.test(tab) && /action: 'edit_request', id: f\.editId/.test(tab));
  check('D2: the edit never sends stage, owner or due date', !/action: 'edit_request'[^\n]*(owner_id|due_date|stage)/.test(tab));
  var route = fs.readFileSync(path.join(root, 'src/app/api/commercial/route.js'), 'utf8');
  check('D3: edit_request sits after the verified sign-in and the Sourcing desk permission', route.indexOf('verifiedCaller(req, body') < route.indexOf("action === 'edit_request'") && route.indexOf("assertPermission(db, userId, 'commercial.access'") < route.indexOf("action === 'edit_request'"));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  check('D4: What’s New has the UY entry', /version: 'v55.83-UY'/.test(wn));
  check('D5: the build badge is UY or later', /v55\.83-U[Y-Z]<\/span>/.test(page) || /v55\.83-[V-Z][A-Z]<\/span>/.test(page));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
