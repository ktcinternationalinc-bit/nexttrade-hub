// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SV — Project 1 (commercial agent), Stage 1: the Sourcing desk.
// Max, Nov 15 2026: "I need also an agent to procure goods find suppliers … Research trade shows. Maintain correspondence.
// Discuss prices …" · "You need to find a way to organize communication and requests to you." · "Super admin. And those
// permissioned" · "All companies" · "What us paid web search" (approved, USD 50 a month) · Nov 16: "start with project 1".
// Rules from the agreed plan tested here: never invent (only facts tied to a page the search returned are kept); the agent
// never marks anything verified; internal notes never leave KTC; nothing is sent in this stage; paid searches are capped
// and never paid twice; websites are information, not instructions.
// The AI service is SIMULATED here (no key, no cost); the worker, the vetting and the route are RUN. The database rules are
// run on Postgres in clickbooks/tests/sv-sourcing-desk (V1–V25).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var S = require(path.join(root, 'src/lib/sourcing.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 800))); }

console.log('SV — A. the rules in the helpers');
check('A1: one supplier, one record — company suffixes, case and punctuation do not make a second one', S.nameKey('ACME Leather Co., Ltd.') === S.nameKey('Acme Leather Co Ltd') && S.nameKey('Acme Leather Co Ltd') === 'acme leather' && S.nameKey('Smith & Sons GmbH') === 'smith and sons' && S.nameKey('Acme Machinery B.V.') === S.nameKey('ACME MACHINERY BV') && S.nameKey('Ferro S.A.') === 'ferro' && S.nameKey('U.S. Steel') === 'us steel');
check('A2: website keys ignore scheme, www and path', S.websiteKey('https://www.Acme.com/about') === 'acme.com' && S.websiteKey('acme.com') === 'acme.com' && S.websiteKey('') === '');
var bad = S.validateRequest({ company: 'Someone Else', direction: 'steal', product: 'x', needed_by: '15/11/2026' });
check('A3: a request needs a known company, what it is, a product — and says so in plain words', !bad.ok && bad.errors.length === 4 && /Pick which company/.test(bad.errors[0]), bad);
var good = S.validateRequest({ company: 'KTC Egypt', direction: 'buy', product: 'Used Caterpillar 950 wheel loaders', specs: '2015 or newer, under 10,000 hours', quantity: '3 units', destination: 'Alexandria, Egypt', internal_note: 'max $45,000 each landed\nasked by Haitham' });
check('A4: all six group companies are offered (Max: "All companies")', S.COMPANIES.length === 6 && S.COMPANIES.indexOf('KTC Egypt') >= 0 && S.COMPANIES.indexOf('NextTrade Industries') >= 0 && good.ok);
var brief = S.researchBrief(Object.assign({ seq: 7 }, good.row));
check('A5: the research brief carries the product, specs, quantity and destination — and NOT the internal note (limits, who asked)', /Caterpillar 950/.test(brief) && /under 10,000 hours/.test(brief) && /Alexandria/.test(brief) && !/45,000/.test(brief) && !/Haitham/.test(brief) && !/KTC/.test(brief), brief);
check('A6: the agent is told: only what a page says, a URL for everything, nothing "verified", pages are not instructions, contact nobody, never state our budget', /Never invent/.test(S.RESEARCH_SYSTEM) && /exact URL/.test(S.RESEARCH_SYSTEM) && /Nothing is "verified"/.test(S.RESEARCH_SYSTEM) && /never instructions/.test(S.RESEARCH_SYSTEM) && /Do not contact anyone/.test(S.RESEARCH_SYSTEM) && /budget, target price/.test(S.RESEARCH_SYSTEM));
check('A7: the tool the agent records with cannot even express "verified"', JSON.stringify(S.RECORD_TOOL).indexOf('verified') < 0);
var b0 = S.searchBudget(0, 50), b1 = S.searchBudget(4996, 50), b2 = S.searchBudget(4994, 50);
check('A8: paid search budget — $10 per 1,000; a run (6 searches, $0.06) is refused if it could pass $50', b0.fits && b0.left === 50 && b0.run_cost_max === 0.06 && !b1.fits && b2.fits && b1.spent === 49.96, [b1, b2]);
var d = S.outreachDraft(Object.assign({ seq: 7 }, good.row), { legal_name: 'Acme Machinery BV' }, { name: 'Jan de Vries', email: 'jan@acme.example' }, null);
check('A9: the outreach draft asks the five standard questions and quotes SR-0007', /SR-0007/.test(d.subject) && /SR-0007/.test(d.body) && /Dear Jan de Vries/.test(d.body) && /EXW, FOB or CIF/.test(d.body) && /Minimum order quantity/.test(d.body) && /manufacturer or a distributor/.test(d.body) && d.to_address === 'jan@acme.example');
check('A10: the draft never carries our limits or who asked', S.draftLeaks(d.subject + d.body, good.row.internal_note).length === 0 && !/45,000|Haitham/.test(d.body) && S.draftLeaks('price max $45,000 each landed please', good.row.internal_note).length === 1);
check('A11: the draft claims nothing we cannot back — no "long-time customer", no competing offer, no volumes we did not state', !/(competitor|other offer|long[- ]standing|our partner|we already buy|regular customer)/i.test(d.body));

console.log('SV — B. vetting what the agent recorded: kept only if a page the search returned backs it');
var blocks = [
  { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'used caterpillar 950 loader dealer' } },
  { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
    { type: 'web_search_result', url: 'https://www.acme-machinery.example/used/cat-950', title: 'Used CAT 950 — Acme Machinery', page_age: 'Nov 2026', encrypted_content: 'x' },
    { type: 'web_search_result', url: 'https://www.acme-machinery.example/contact', title: 'Contact — Acme Machinery', encrypted_content: 'x' },
    { type: 'web_search_result', url: 'https://ritchie.example/auction/950', title: 'Auction listing', encrypted_content: 'x' }] },
  { type: 'text', text: 'Acme lists several units.', citations: [{ type: 'web_search_result_location', url: 'https://heavyquip.example/stock#units', title: 'HeavyQuip stock', encrypted_index: 'x', cited_text: '...' }] }];
var src = S.sourcesFromResponse(blocks);
check('B1: the sources are exactly the pages the search returned (results and citations), normalised', Object.keys(src).sort().join(' ') === ['https://acme-machinery.example/contact', 'https://acme-machinery.example/used/cat-950', 'https://heavyquip.example/stock', 'https://ritchie.example/auction/950'].join(' '), Object.keys(src));
var recorded = { summary: 'Found two dealers.', candidates: [
  { name: 'Acme Machinery B.V.', role: 'distributor', country: 'Netherlands', website: 'https://www.acme-machinery.example', fit_note: 'Lists 950 loaders', concerns: 'Hours not shown',
    facts: [{ topic: 'stock', statement: 'Lists four used CAT 950 loaders, 2016–2019', grade: 'claim', confidence: 'high', source_url: 'https://www.acme-machinery.example/used/cat-950' },
            { topic: 'certification', statement: 'ISO 9001 certified', grade: 'verified', source_url: 'https://www.acme-machinery.example/used/cat-950/' },
            { topic: 'price', statement: 'About $48,000 each', grade: 'estimate', source_url: 'https://made-up-prices.example/cat950' }],
    contacts: [{ name: 'Sales desk', email: 'sales@acme-machinery.example', source_url: 'https://acme-machinery.example/contact' }, { email: 'ceo@acme-machinery.example', source_url: 'https://linkedin.example/ceo' }, { email: 'not-an-email', source_url: 'https://acme-machinery.example/contact' }] },
  { name: 'Ghost Equipment LLC', role: 'manufacturer', website: 'ghost.example', facts: [{ topic: 'stock', statement: '20 units ready', source_url: 'https://ghost.example/stock' }] },
  { name: 'ACME MACHINERY BV', facts: [{ topic: 'x', statement: 'listed twice', source_url: 'https://www.acme-machinery.example/used/cat-950' }] },
  { name: 'HeavyQuip Ltd', role: 'stockholder', website: 'https://unseen-site.example', facts: [{ topic: 'stock', statement: 'Two 950M units in stock', source_url: 'https://heavyquip.example/stock' }] }] };
var v = S.vetShortlist(recorded, src);
check('B2: a company backed by no page the search returned is NOT saved (an invented supplier never reaches the desk)', !v.suppliers.some(function (s) { return /Ghost/.test(s.legal_name); }) && v.dropped.some(function (x) { return /Ghost/.test(x.name) && /could be tied/.test(x.why); }), v.dropped);
check('B3: the same company listed twice is saved once', v.suppliers.filter(function (s) { return s.name_key === 'acme machinery'; }).length === 1 && v.dropped.some(function (x) { return x.why === 'listed twice'; }));
var acme = v.suppliers[0];
check('B4: a fact whose link is not one of the pages seen is dropped (the "$48,000" price from a made-up page)', acme.facts.length === 2 && !acme.facts.some(function (f) { return /48,000/.test(f.statement); }) && v.facts_dropped === 2 /* the made-up price + the ghost company's only fact */, acme.facts);
check('B5: "verified" from the agent is turned into a claim', acme.facts.every(function (f) { return f.grade === 'claim' || f.grade === 'estimate'; }) && acme.facts.filter(function (f) { return /ISO/.test(f.statement); })[0].grade === 'claim');
check('B6: contacts are kept only from a page seen and only with a real address (the LinkedIn guess and the broken email are dropped)', acme.contacts.length === 1 && acme.contacts[0].email === 'sales@acme-machinery.example' && v.contacts_dropped === 2, acme.contacts);
var hq = v.suppliers.filter(function (s) { return /HeavyQuip/.test(s.legal_name); })[0];
check('B7: a website the search never showed is not recorded (HeavyQuip claimed unseen-site.example); a seen one is (Acme)', hq && hq.website === null && acme.website === 'https://acme-machinery.example' && acme.website_key === 'acme-machinery.example');
check('B8: at most 8 candidates, in the agent’s order', S.vetShortlist({ candidates: new Array(12).fill(0).map(function (x, i) { return { name: 'Co ' + i, facts: [{ topic: 't', statement: 'abc', source_url: 'https://acme-machinery.example/contact' }] }; }) }, src).suppliers.length === 8);

// ── the worker and the route on an in-memory database, with the AI service simulated
function fresh() {
  return new MemDB({ users: [{ id: 'u1', name: 'Max', role: 'staff', active: true }, { id: 'u2', name: 'Sales', role: 'staff', active: true }, { id: 'u3', name: 'Nobody', role: 'staff', active: true }],
    module_permissions: [{ user_id: 'u1', module_name: 'commercial.access', has_access: true }, { user_id: 'u1', module_name: 'commercial.research', has_access: true }, { user_id: 'u2', module_name: 'commercial.access', has_access: true }],
    sourcing_requests: [], suppliers: [], supplier_contacts: [], supplier_facts: [], sourcing_shortlist: [], outreach_drafts: [], commercial_messages: [], agent_jobs: [], hub_audit_log: [] });
}
var db = fresh();
function claimStandIn() { // mirrors public.agent_job_claim (the real one runs on Postgres: V18–V22b)
  var now = new Date().toISOString(); var j = db.t.agent_jobs.filter(function (x) { return x.status === 'queued' && x.run_after <= now; })[0];
  if (!j) { return []; }
  if (j.attempts >= j.max_attempts) { j.status = 'failed'; return []; }
  j.status = 'running'; j.attempts++; j.locked_at = now; return [Object.assign({}, j)];
}
function jobDefaults(r) { if (r.kind) { r.status = r.status || 'queued'; r.attempts = 0; r.max_attempts = 3; r.searches = 0; r.input_tokens = 0; r.output_tokens = 0; r.run_after = r.run_after || new Date(Date.now() - 1000).toISOString();
  if (db.t.agent_jobs.some(function (x) { return x.ref_id === r.ref_id && (x.status === 'queued' || x.status === 'running'); })) { return 'duplicate key value violates unique constraint "uq_agent_job_live"'; } } return null; }
function setup() { db.rpcs = { agent_job_claim: claimStandIn }; db.hooks = { agent_jobs: { insert: jobDefaults } }; global.__db = db; }
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
setup();
var SS = require(path.join(root, 'src/lib/sourcing-server.js'));
var route = require(path.join(root, 'src/app/api/commercial/route.js'));
async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var sent = [];
function aiReply(parts) { return { ok: true, status: 200, json: function () { return Promise.resolve(parts); } }; }
function simulatedAI(script) {
  var i = 0; return function (url, init) { sent.push({ url: url, body: JSON.parse(init.body), headers: init.headers }); var r = script[Math.min(i, script.length - 1)]; i++; return Promise.resolve(typeof r === 'function' ? r() : r); };
}
var happy = simulatedAI([
  aiReply({ stop_reason: 'pause_turn', content: blocks.slice(0, 2), usage: { input_tokens: 1200, output_tokens: 100, server_tool_use: { web_search_requests: 2 } } }),
  aiReply({ stop_reason: 'tool_use', content: [blocks[2], { type: 'tool_use', id: 'toolu_1', name: 'record_shortlist', input: recorded }], usage: { input_tokens: 3000, output_tokens: 900, server_tool_use: { web_search_requests: 1 } } })]);

(async function () {
  console.log('SV — C. the desk: permissions, a request, the research run');
  var n0 = await call('u3', { action: 'list' });
  check('C1: no “Sourcing desk” switch → no access at all', !n0.ok && /Sourcing desk/.test(n0.error));
  var c1 = await call('u1', { action: 'create_request', request: Object.assign({}, { company: 'KTC Egypt', direction: 'buy', product: 'Used Caterpillar 950 wheel loaders', specs: '2015 or newer, under 10,000 hours', quantity: '3 units', destination: 'Alexandria, Egypt', internal_note: 'max $45,000 each landed\nasked by Haitham', due_date: '2026-11-20', attachments: [{ path: 'pv/sourcing-1-photo.jpg', name: 'photo.jpg' }, { path: 'public/x.jpg', name: 'leak.jpg' }] }) });
  var RQ = db.t.sourcing_requests[0];
  check('C2: a request becomes a numbered assignment with an owner, a next action and a due date; only private-bucket files are kept', c1.ok && /^SR-\d{4}$/.test(c1.label) && RQ.owner_id === 'u1' && RQ.stage === 'new' && /Start the supplier research/.test(RQ.next_action) && RQ.due_date === '2026-11-20' && RQ.attachments.length === 1 && RQ.attachments[0].path === 'pv/sourcing-1-photo.jpg', RQ);
  var s2 = await call('u2', { action: 'start_research', id: RQ.id });
  check('C3: without the “Start web research” switch a person can work the desk but cannot spend on searches', !s2.ok && /Start web research/.test(s2.error) && db.t.agent_jobs.length === 0);
  var s1 = await call('u1', { action: 'start_research', id: RQ.id }); var s1b = await call('u1', { action: 'start_research', id: RQ.id });
  check('C4: research queued once; pressing again is refused — it is never run or paid for twice', s1.ok && !s1b.ok && /never be started \(or paid for\) twice|will not be started/.test(s1b.error) && db.t.agent_jobs.length === 1 && db.t.sourcing_requests[0].stage === 'researching', s1b);
  delete process.env.ANTHROPIC_API_KEY;
  var noKey = await SS.runNextJob(db, { fetch: happy });
  check('C5: with no AI key on the server the job fails plainly, the request goes back to "new" with the reason, nothing is invented', noKey.ran && !noKey.ok && /ANTHROPIC_API_KEY/.test(noKey.error) && db.t.agent_jobs[0].status === 'failed' && db.t.sourcing_requests[0].stage === 'new' && /Research failed/.test(db.t.sourcing_requests[0].next_action) && db.t.suppliers.length === 0 && sent.length === 0, noKey);
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
  await call('u1', { action: 'start_research', id: RQ.id });
  var run = await SS.runNextJob(db, { fetch: happy });
  check('C6: the run finished: 3 paid searches counted, tokens counted, the request moved to "Shortlist ready"', run.ran && run.ok && run.usage.searches === 3 && db.t.agent_jobs[1].searches === 3 && db.t.agent_jobs[1].input_tokens === 4200 && db.t.agent_jobs[1].status === 'done' && db.t.sourcing_requests[0].stage === 'shortlist', run);
  check('C7: a long turn (“pause_turn”) was sent back unchanged to continue, as the provider requires', sent.length === 2 && JSON.stringify(sent[1].body.messages[1].content) === JSON.stringify(blocks.slice(0, 2)));
  check('C8: the second call asked for at most the searches left (6 − 2 = 4); the key travels only in the header', sent[0].body.tools[0].type === 'web_search_20250305' && sent[0].body.tools[0].max_uses === 6 && sent[1].body.tools[0].max_uses === 4 && sent[0].headers['x-api-key'] === 'sk-test-not-real' && JSON.stringify(sent[0].body).indexOf('sk-test') < 0);
  check('C9: what reached the AI had NO internal note, no company name of ours and no limits', sent.every(function (x) { var t = JSON.stringify(x.body); return t.indexOf('45,000') < 0 && t.indexOf('Haitham') < 0 && t.indexOf('KTC Egypt') < 0; }));
  check('C10: saved: two suppliers backed by pages seen (not the ghost), their facts as CLAIM/ESTIMATE with links, one contact', db.t.suppliers.length === 2 && !db.t.suppliers.some(function (s) { return /Ghost/.test(s.legal_name); }) && db.t.supplier_facts.length === 3 && db.t.supplier_facts.every(function (f) { return f.added_by_kind === 'agent' && f.grade !== 'verified' && /^https?:\/\//.test(f.source_url); }) && db.t.supplier_contacts.length === 1, { s: db.t.suppliers.map(function (s) { return s.legal_name; }), f: db.t.supplier_facts.length, c: db.t.supplier_contacts.length });
  check('C11: the history says the agent did it and how many searches it used', db.t.hub_audit_log.some(function (h) { return h.action === 'sourcing_research_done' && h.details && h.details.by === 'agent' && h.details.searches === 3 && h.details.found === 2; }));
  await call('u1', { action: 'start_research', id: RQ.id });
  sent = []; await SS.runNextJob(db, { fetch: simulatedAI([aiReply({ stop_reason: 'tool_use', content: blocks.concat([{ type: 'tool_use', id: 't2', name: 'record_shortlist', input: recorded }]), usage: { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } })]) });
  check('C12: researching again reuses the same supplier records — no duplicate suppliers, contacts or shortlist rows', db.t.suppliers.length === 2 && db.t.supplier_contacts.length === 1 && db.t.sourcing_shortlist.length === 2);

  console.log('SV — D. failures are reported, never dressed up as results');
  var dbHold = db; db = fresh(); setup();
  var c2 = await call('u1', { action: 'create_request', request: { company: 'NextTrade Industries', direction: 'buy', product: 'PVC automotive leather, 1.2 mm' } });
  await call('u1', { action: 'start_research', id: c2.id });
  var off = await SS.runNextJob(db, { fetch: simulatedAI([{ ok: false, status: 400, json: function () { return Promise.resolve({ type: 'error', error: { type: 'invalid_request_error', message: 'web search is not enabled for this organization' } }); } }]) });
  var h = await SS.integrationHealth(db); var ws = h.filter(function (x) { return x.key === 'web_search'; })[0];
  check('D1: web search switched off on the AI account → the job fails at once (no retries), and the health panel says exactly that', !off.ok && off.web_search_off && db.t.agent_jobs[0].status === 'failed' && ws && ws.ok === false && /refused web search/.test(ws.detail), { off: off, ws: ws });
  await call('u1', { action: 'start_research', id: c2.id });
  var net = await SS.runNextJob(db, { fetch: function () { return Promise.reject(new Error('ECONNRESET')); } });
  check('D2: a network failure is retried later (queued again with a delay), the request stays "researching"', !net.ok && net.will_retry && db.t.agent_jobs[1].status === 'queued' && db.t.agent_jobs[1].run_after > new Date().toISOString() && db.t.sourcing_requests[0].stage === 'researching', db.t.agent_jobs[1]);
  db.t.agent_jobs[1].run_after = new Date(Date.now() - 1000).toISOString();
  var nothing = await SS.runNextJob(db, { fetch: simulatedAI([aiReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'I could not find anything.' }], usage: { input_tokens: 5, output_tokens: 5 } })]) });
  check('D3: if the agent never records a shortlist, nothing is saved and it says so', !nothing.ok && /without recording a shortlist/.test(nothing.error) && db.t.suppliers.length === 0);
  db.t.agent_jobs[1].run_after = new Date(Date.now() - 1000).toISOString();
  var empty = await SS.runNextJob(db, { fetch: simulatedAI([aiReply({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'record_shortlist', input: { summary: 'No maker of 1.2 mm found.', candidates: [] } }], usage: { input_tokens: 5, output_tokens: 5, server_tool_use: { web_search_requests: 2 } } })]) });
  check('D4: an honest "found nothing" goes back to the person with a next step (not a made-up list)', empty.ok && empty.result.found === 0 && db.t.sourcing_requests[0].stage === 'new' && /found nothing usable/.test(db.t.sourcing_requests[0].next_action));
  db.t.agent_jobs.push({ id: 'cap', kind: 'sourcing_research', ref_id: 'other', status: 'done', searches: 4996, input_tokens: 0, output_tokens: 0, created_at: new Date().toISOString() });
  var capd = await call('u1', { action: 'start_research', id: c2.id });
  check('D5: the $50 monthly cap blocks a new run before anything is spent, with the numbers', !capd.ok && /monthly web-search cap is reached: \$49\.9\d used of \$50\.00/.test(capd.error), capd);
  db = dbHold; setup();

  console.log('SV — E. a person decides; drafts are prepared, never sent');
  var g = await call('u1', { action: 'get', id: RQ.id });
  var acmeRow = g.shortlist.filter(function (x) { return /Acme/.test(x.supplier.legal_name); })[0]; var hqRow = g.shortlist.filter(function (x) { return /HeavyQuip/.test(x.supplier.legal_name); })[0];
  check('E1: the request shows each supplier with its facts, grade, source link and contacts', g.ok && acmeRow.facts.length >= 2 && acmeRow.facts.every(function (f) { return f.source_url; }) && acmeRow.contacts[0].email === 'sales@acme-machinery.example' && acmeRow.contacts[0].verified === false && g.request.internal_note);
  var pd0 = await call('u1', { action: 'prepare_draft', id: RQ.id, supplier_id: acmeRow.supplier_id });
  check('E2: no draft for a supplier nobody has kept yet', !pd0.ok && /Keep this supplier/.test(pd0.error));
  var dr0 = await call('u1', { action: 'decide', id: RQ.id, shortlist_id: hqRow.shortlist_id, decision: 'drop' });
  check('E3: dropping needs a reason', !dr0.ok && /Say why/.test(dr0.error));
  await call('u1', { action: 'decide', id: RQ.id, shortlist_id: hqRow.shortlist_id, decision: 'drop', reason: 'stockholder, no hours data' });
  var k = await call('u1', { action: 'decide', id: RQ.id, shortlist_id: acmeRow.shortlist_id, decision: 'keep' });
  var pd = await call('u1', { action: 'prepare_draft', id: RQ.id, supplier_id: acmeRow.supplier_id });
  var dr = /* v55.83-SW realign — drafts now live in the supplier's conversation (commercial_messages) */ db.t.commercial_messages.filter(function (x) { return x.status === 'draft'; });
  check('E4: kept → a draft to the address found on their contact page, with our five questions — status DRAFT, nothing sent', k.ok && pd.ok && dr.length === 1 && dr[0].to_address === 'sales@acme-machinery.example' && dr[0].status === 'draft' && /Inquiry: Used Caterpillar 950/.test(dr[0].subject) && db.t.sourcing_requests[0].stage === 'drafts_ready' && db.t.hub_audit_log.some(function (h) { return h.action === 'outreach_draft_prepared' && h.details.sent === false; }));
  check('E5: the draft carries neither the limit nor who asked', dr[0].body.indexOf('45,000') < 0 && dr[0].body.indexOf('Haitham') < 0);
  await call('u1', { action: 'prepare_draft', id: RQ.id, supplier_id: acmeRow.supplier_id });
  check('E6: preparing again replaces the draft — one live draft per supplier', db.t.commercial_messages.filter(function (x) { return x.status === 'draft'; }).length === 1 && db.t.commercial_messages.length === 2);
  var leakRq = await call('u1', { action: 'create_request', request: { company: 'KTC Egypt', direction: 'buy', product: 'Loaders — budget 40000 per unit', internal_note: 'budget 40000 per unit' } });
  var SX = 'c9900000-0000-0000-0000-000000000001'; db.t.suppliers.push({ id: SX, legal_name: 'X', name_key: 'x' }); db.t.sourcing_shortlist.push({ id: 'sl-x', request_id: leakRq.id, supplier_id: SX, status: 'kept' });
  var lk = await call('u1', { action: 'prepare_draft', id: leakRq.id, supplier_id: SX });
  check('E7: if the internal note was typed into the product line, the draft is refused rather than leak it', !lk.ok && /internal note/.test(lk.error) && !db.t.commercial_messages.some(function (x) { return x.request_id === leakRq.id; }), lk);
  var vf0 = await call('u1', { action: 'add_fact', id: RQ.id, supplier_id: acmeRow.supplier_id, grade: 'verified', topic: 'price', statement: '$41,500 FOB Rotterdam' });
  var vf1 = await call('u1', { action: 'add_fact', id: RQ.id, supplier_id: acmeRow.supplier_id, grade: 'verified', topic: 'price', statement: '$41,500 FOB Rotterdam', evidence_note: 'their email of Nov 16, quote Q-8812' });
  check('E8: a person can mark a fact VERIFIED only by saying what they saw', !vf0.ok && /what you saw/.test(vf0.error) && vf1.ok && db.t.supplier_facts.some(function (f) { return f.grade === 'verified' && f.added_by_kind === 'person' && /Q-8812/.test(f.evidence_note); }));
  var rf = await call('u1', { action: 'retract_fact', id: RQ.id, fact_id: vf1.id, reason: 'they withdrew the quote' });
  check('E9: a wrong fact is retracted with a reason and kept on file (never erased)', rf.ok && db.t.supplier_facts.some(function (f) { return f.id === vf1.id && f.retracted_at && /withdrew/.test(f.retracted_why); }));
  var dupS = await call('u1', { action: 'add_supplier', request_id: RQ.id, legal_name: 'ACME MACHINERY, B.V.' });
  check('E10: adding a supplier already on file uses that record and says so — no duplicate', dupS.ok && dupS.existing && /Acme Machinery/.test(dupS.existing_name) && db.t.suppliers.filter(function (s) { return s.name_key === 'acme machinery'; }).length === 1);
  var cl0 = await call('u1', { action: 'update', id: RQ.id, stage: 'closed' }); var cl1 = await call('u1', { action: 'update', id: RQ.id, stage: 'closed', closed_reason: 'bought 3 units from Acme' });
  var after = await call('u1', { action: 'prepare_draft', id: RQ.id, supplier_id: acmeRow.supplier_id });
  check('E11: closing needs a reason; a closed request cannot be changed until reopened', !cl0.ok && cl1.ok && !after.ok && /closed/.test(after.error));

  console.log('SV — F. the build');
  var sql = R('sql/v55-83-SV-sourcing-desk.sql');
  check('F1 (pin): the database script: row level security on all tables, no access for web users, the agent cannot verify, facts cannot be rewritten', (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length === 7 && /REVOKE ALL ON public\.sourcing_requests[\s\S]*FROM anon, authenticated/.test(sql) && /supplier_fact_agent_never_verifies/.test(sql) && /SUPPLIER_FACT_LOCKED/.test(sql) && /uq_agent_job_live/.test(sql) && !/\bDROP TABLE\b|\bDELETE FROM\b/i.test(sql));
  check('F2 (pin): the Postgres proof is kept with the build', fs.existsSync(path.join(root, 'clickbooks/tests/sv-sourcing-desk/01_scen.sql')) && fs.existsSync(path.join(root, 'clickbooks/tests/sv-sourcing-desk/README.md')));
  var api = R('src/app/api/commercial/route.js') + R('src/lib/sourcing-server.js') + R('src/lib/sourcing.js') + R('src/app/api/commercial/worker/route.js');
  check('F3 (pin): nothing in this stage can send an email or a WhatsApp message', !/gmail|resend|sendMail|nodemailer|graph\.facebook|whatsapp\/send|messages\.send/i.test(api.replace(/\/\/.*$/gm, '').replace(/'[^'\n]*WhatsApp[^'\n]*'/g, '')));
  check('F4 (pin): house rules — var only, no template strings, no public secrets; the timer route accepts the timer only', !/\b(let|const)\s/.test(api.replace(/export const (dynamic|maxDuration)/g, '')) && api.indexOf('`') < 0 && !/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET)/.test(api.replace(/NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_URL/g, '')) && /Timer only\./.test(R('src/app/api/commercial/worker/route.js')));
  var ui = R('src/components/SourcingDeskTab.jsx');
  check('F5 (pin): the screen — no browser pop-ups, every field readable in the dark skin, the draft marked NOT SENT, the cost shown before research', !/window\.(prompt|confirm|alert)\(/.test(ui) && /* v55.83-SW realign — the draft's state now comes from the conversation (“Draft — not sent”); the only unstyled input is a checkbox */ (ui.match(/<(input|select|textarea)(?![^>]*type="(file|checkbox)")[^>]*>/g) || []).every(function (t) { return /className=\{inp/.test(t); }) && /draft: 'Draft — not sent'/.test(R('src/lib/commercial-mail.js')) && /m\.status_words\.toUpperCase\(\)/.test(ui) && /This uses paid web search/.test(ui) && /NOT IN THIS STAGE/.test(ui));
  var page = R('src/app/page.jsx'); var st = R('src/components/SettingsTab.jsx'); var vj = JSON.parse(R('vercel.json'));
  check('F6 (pin): the tab shows only with its switch; the two switches are in Settings; the worker timer every 5 minutes', /if \(t\.id === 'sourcing'\) \{ return modulePerms\['commercial\.access'\] === true; \}/.test(page) && /\{tab === 'sourcing' && \(/.test(page) && /key: 'commercial\.access'/.test(st) && /key: 'commercial\.research'/.test(st) && vj.crons.some(function (c) { return c.path === '/api/commercial/worker' && c.schedule === '*/5 * * * *'; }));
  var wn = R('src/components/WhatsNewWidget.jsx');
  check('F7 (pin): What’s New has v55.83-SV with one technical line; badge at SV', /version: 'v55\.83-TF'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-TF'"), wn.indexOf("version: 'v55.83-TE'"))) && /Sourcing desk/.test(wn.substring(wn.indexOf("version: 'v55.83-TF'"), wn.indexOf("version: 'v55.83-TE'"))) && />v55\.83-(?:T[F-Z])<\/span>/.test(page)); // v55.83-TF realign: the web chat's SV was merged onto the live line as TF (SV was already used there)
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
