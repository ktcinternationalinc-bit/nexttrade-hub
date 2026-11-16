// v55.83-SV — Sourcing desk, server side: the web-research worker and saving what it found.
// The AI searches the public web (a paid tool, counted against the monthly cap) and records candidates through a tool call;
// only what vetShortlist() can tie to a page the search really returned is saved. Nothing here sends a message.
import { audit } from './audit-server';
import { researchBrief, RESEARCH_SYSTEM, RECORD_TOOL, sourcesFromResponse, vetShortlist, SEARCHES_PER_RUN, searchBudget, DEFAULT_MONTHLY_CAP_USD, requestLabel } from './sourcing';

export function monthlyCap() { var c = Number(process.env.COMMERCIAL_SEARCH_MONTHLY_CAP_USD); return c >= 0 && process.env.COMMERCIAL_SEARCH_MONTHLY_CAP_USD ? c : DEFAULT_MONTHLY_CAP_USD; }
export function agentModel() { return process.env.COMMERCIAL_AGENT_MODEL || 'claude-sonnet-4-6'; }

// paid searches used since the first of this month (UTC), as reported by the provider on each job
export async function monthUsage(db) {
  var first = new Date().toISOString().substring(0, 7) + '-01T00:00:00Z';
  var r = await db.from('agent_jobs').select('searches, input_tokens, output_tokens, status').gte('created_at', first);
  if (r.error) { return { error: r.error.message }; }
  var s = 0, it = 0, ot = 0, jobs = 0;
  (r.data || []).forEach(function (j) { s += Number(j.searches) || 0; it += Number(j.input_tokens) || 0; ot += Number(j.output_tokens) || 0; jobs++; });
  var b = searchBudget(s, monthlyCap(), SEARCHES_PER_RUN);
  b.jobs = jobs; b.input_tokens = it; b.output_tokens = ot;
  return b;
}

// one conversation with the model: web search (server tool) + record_shortlist (our tool). → { input, sources, usage } or { error }
export async function researchCall(request, opts) {
  var o = opts || {}; var key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) { return { error: 'The AI key is not set on the server (ANTHROPIC_API_KEY).', fatal: true }; }
  var doFetch = o.fetch || fetch;
  var messages = [{ role: 'user', content: researchBrief(request) }];
  var sources = {}; var usage = { searches: 0, input_tokens: 0, output_tokens: 0 }; var recorded = null; var nudged = false;
  var deadline = Date.now() + (o.budgetMs || 240000);
  for (var turn = 0; turn < 5; turn++) {
    if (Date.now() > deadline) { return { error: 'The research ran out of time before it finished.', usage: usage, sources: sources }; }
    var left = SEARCHES_PER_RUN - usage.searches;
    var tools = [RECORD_TOOL];
    if (left > 0) { tools.unshift({ type: 'web_search_20250305', name: 'web_search', max_uses: left }); }
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (eA) { /* ignore */ } }, Math.max(5000, deadline - Date.now())) : null;
    var res, j;
    try {
      res = await doFetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: agentModel(), max_tokens: 4000, system: RESEARCH_SYSTEM, tools: tools, messages: messages }) });
      j = await res.json();
    } catch (eF) { if (timer) { clearTimeout(timer); } return { error: 'Could not reach the AI service (' + ((eF && eF.message) || 'network') + ').', usage: usage, sources: sources }; }
    if (timer) { clearTimeout(timer); }
    if (!res.ok) {
      var msg = (j && j.error && j.error.message) || ('HTTP ' + res.status);
      return { error: 'The AI service refused the request: ' + msg, fatal: res.status === 400 || res.status === 401 || res.status === 403, usage: usage, sources: sources,
        web_search_off: /web search/i.test(msg) && /not enabled|disabled/i.test(msg) };
    }
    var u = j.usage || {};
    usage.input_tokens += Number(u.input_tokens) || 0; usage.output_tokens += Number(u.output_tokens) || 0;
    usage.searches += Number(u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    var content = j.content || [];
    sourcesFromResponse(content, sources);
    var call = content.filter(function (b) { return b && b.type === 'tool_use' && b.name === 'record_shortlist'; })[0];
    if (call) { recorded = call.input || {}; break; }
    if (j.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: content }); continue; }   // long turn: send it back unchanged
    if (nudged) { break; }
    nudged = true;
    messages.push({ role: 'assistant', content: content });
    messages.push({ role: 'user', content: 'Record what you found now by calling record_shortlist. Use only pages you opened above.' });
  }
  if (!recorded) { return { error: 'The research finished without recording a shortlist.', usage: usage, sources: sources }; }
  return { input: recorded, sources: sources, usage: usage };
}

// save a vetted shortlist. An existing supplier (same name key or website) is reused, never duplicated.
export async function saveShortlist(db, request, vetted, actorId) {
  var saved = { suppliers_new: 0, suppliers_existing: 0, facts: 0, contacts: 0, shortlisted: 0, errors: [] };
  for (var i = 0; i < vetted.suppliers.length; i++) {
    var s = vetted.suppliers[i]; var sup = null;
    var ex = await db.from('suppliers').select('id, legal_name, name_key, website_key').eq('name_key', s.name_key).limit(1);
    if (!ex.error && ex.data && ex.data[0]) { sup = ex.data[0]; }
    if (!sup && s.website_key) { var ex2 = await db.from('suppliers').select('id, legal_name, name_key, website_key').eq('website_key', s.website_key).limit(1); if (!ex2.error && ex2.data && ex2.data[0]) { sup = ex2.data[0]; } }
    if (sup) { saved.suppliers_existing++; }
    else {
      var ins = await db.from('suppliers').insert({ legal_name: s.legal_name, trading_name: s.trading_name, name_key: s.name_key, role: s.role, country: s.country, city: s.city, website: s.website, website_key: s.website_key,
        products: s.products, status: 'candidate', added_by_kind: 'agent', created_by: actorId || null }).select('id').single();
      if (ins.error) { saved.errors.push(s.legal_name + ': ' + ins.error.message); continue; }
      sup = { id: ins.data.id }; saved.suppliers_new++;
    }
    var today = new Date().toISOString().substring(0, 10);
    for (var f = 0; f < s.facts.length; f++) {
      var ft = s.facts[f];
      var fi = await db.from('supplier_facts').insert({ supplier_id: sup.id, request_id: request.id, topic: ft.topic, statement: ft.statement, grade: ft.grade, confidence: ft.confidence,
        source_url: ft.source_url, source_title: ft.source_title, observed_on: today, added_by_kind: 'agent', created_by: actorId || null });
      if (fi.error) { saved.errors.push('fact for ' + s.legal_name + ': ' + fi.error.message); } else { saved.facts++; }
    }
    for (var c = 0; c < s.contacts.length; c++) {
      var ct = s.contacts[c];
      var dupQ = db.from('supplier_contacts').select('id').eq('supplier_id', sup.id);
      dupQ = ct.email ? dupQ.eq('email', ct.email) : (ct.phone ? dupQ.eq('phone', ct.phone) : dupQ.eq('whatsapp', ct.whatsapp));
      var dup = await dupQ.limit(1);
      if (!dup.error && dup.data && dup.data[0]) { continue; }
      var ci = await db.from('supplier_contacts').insert({ supplier_id: sup.id, name: ct.name, title: ct.title, email: ct.email, phone: ct.phone, whatsapp: ct.whatsapp, source_url: ct.source_url, found_on: today, added_by_kind: 'agent' });
      if (ci.error) { saved.errors.push('contact for ' + s.legal_name + ': ' + ci.error.message); } else { saved.contacts++; }
    }
    var sl = await db.from('sourcing_shortlist').select('id').eq('request_id', request.id).eq('supplier_id', sup.id).limit(1);
    if (!sl.error && sl.data && sl.data[0]) { continue; }
    var si = await db.from('sourcing_shortlist').insert({ request_id: request.id, supplier_id: sup.id, fit_note: s.fit_note, concerns: s.concerns, rank: s.rank, status: 'proposed', added_by_kind: 'agent' });
    if (si.error) { saved.errors.push('shortlist ' + s.legal_name + ': ' + si.error.message); } else { saved.shortlisted++; }
  }
  return saved;
}

// run ONE due job (claimed atomically in the database). → { ran, job_id, ok, … }
export async function runNextJob(db, opts) {
  var o = opts || {};
  var cl = await db.rpc('agent_job_claim', { p_stuck_minutes: 10 });
  if (cl.error) { return { ran: false, error: cl.error.message, needs_sql: /agent_job|schema cache|does not exist/i.test(cl.error.message || '') }; }
  var job = Array.isArray(cl.data) ? cl.data[0] : cl.data;
  if (!job || !job.id) { return { ran: false }; }
  var rq = await db.from('sourcing_requests').select('*').eq('id', job.ref_id).maybeSingle();
  var request = rq && rq.data;
  var finish = async function (patch) { await db.from('agent_jobs').update(Object.assign({ locked_at: null }, patch)).eq('id', job.id); };
  if (!request || request.stage === 'closed') { await finish({ status: 'cancelled', finished_at: new Date().toISOString(), last_error: 'the request no longer exists or is closed' }); return { ran: true, job_id: job.id, ok: false, cancelled: true }; }
  // the cap is checked again at run time (several jobs could have been queued)
  var mu = await monthUsage(db);
  if (!mu.error && !mu.fits) {
    await finish({ status: 'failed', finished_at: new Date().toISOString(), last_error: 'Monthly web-search cap reached ($' + mu.spent.toFixed(2) + ' of $' + mu.cap.toFixed(2) + ').' });
    await db.from('sourcing_requests').update({ stage: 'new', next_action: 'Research did not run: the monthly web-search cap is reached.', updated_at: new Date().toISOString() }).eq('id', request.id).eq('stage', 'researching');
    return { ran: true, job_id: job.id, ok: false, cap: true };
  }
  var r = await researchCall(request, { fetch: o.fetch, budgetMs: o.budgetMs });
  var usage = r.usage || { searches: 0, input_tokens: 0, output_tokens: 0 };
  var usePatch = { searches: (Number(job.searches) || 0) + usage.searches, input_tokens: (Number(job.input_tokens) || 0) + usage.input_tokens, output_tokens: (Number(job.output_tokens) || 0) + usage.output_tokens };
  if (r.error) {
    var giveUp = r.fatal || job.attempts >= job.max_attempts;
    await finish(Object.assign({}, usePatch, giveUp ? { status: 'failed', finished_at: new Date().toISOString(), last_error: r.error } : { status: 'queued', run_after: new Date(Date.now() + 5 * 60000 * job.attempts).toISOString(), last_error: r.error }));
    if (giveUp) { await db.from('sourcing_requests').update({ stage: 'new', next_action: 'Research failed: ' + String(r.error).substring(0, 200), updated_at: new Date().toISOString() }).eq('id', request.id).eq('stage', 'researching'); }
    return { ran: true, job_id: job.id, ok: false, error: r.error, will_retry: !giveUp, web_search_off: !!r.web_search_off };
  }
  var vetted = vetShortlist(r.input, r.sources);
  var saved = await saveShortlist(db, request, vetted, job.created_by);
  var result = { summary: vetted.summary, found: vetted.suppliers.length, dropped: vetted.dropped, facts_dropped: vetted.facts_dropped, contacts_dropped: vetted.contacts_dropped, saved: saved, pages_seen: Object.keys(r.sources).length };
  await finish(Object.assign({}, usePatch, { status: 'done', finished_at: new Date().toISOString(), result: result, last_error: null }));
  await db.from('sourcing_requests').update({ stage: vetted.suppliers.length ? 'shortlist' : 'new', updated_at: new Date().toISOString(),
    next_action: vetted.suppliers.length ? 'Review the shortlist: keep or drop each supplier.' : 'Research found nothing usable — refine the product or specifications and try again.' }).eq('id', request.id).eq('stage', 'researching');
  try { await audit(db, job.created_by || null, 'sourcing_research_done', 'sourcing_request', request.id, { request: requestLabel(request.seq), found: vetted.suppliers.length, dropped: vetted.dropped.length, facts: saved.facts, facts_dropped: vetted.facts_dropped, searches: usage.searches, by: 'agent' }); } catch (eAu) { /* the job row holds the result */ }
  return { ran: true, job_id: job.id, ok: true, result: result, usage: usage };
}

// what is connected and what is not — shown as it is, never as working when it is not
export async function integrationHealth(db) {
  var out = [];
  var t = await db.from('sourcing_requests').select('id', { count: 'exact', head: true });
  out.push({ key: 'tables', label: 'Sourcing desk records', ok: !t.error, detail: t.error ? 'Not installed — run sql/v55-83-SV-sourcing-desk.sql in Supabase.' : 'Installed.' });
  out.push({ key: 'ai', label: 'AI service', ok: !!process.env.ANTHROPIC_API_KEY, detail: process.env.ANTHROPIC_API_KEY ? 'Key present on the server (model ' + agentModel() + ').' : 'No key on the server — research cannot run.' });
  var last = null;
  if (!t.error) { var lj = await db.from('agent_jobs').select('status, last_error, finished_at, searches').eq('kind', 'sourcing_research').order('created_at', { ascending: false }).limit(1); last = lj && lj.data && lj.data[0]; }
  var wsOff = last && last.status === 'failed' && /web search/i.test(last.last_error || '');
  out.push({ key: 'web_search', label: 'Paid web search', ok: !!(last && last.status === 'done' && (Number(last.searches) || 0) > 0), unknown: !last || (last.status !== 'done' && !wsOff) || (last.status === 'done' && !(Number(last.searches) > 0)),
    detail: !last ? 'Not tried yet — the first research run will show whether it is switched on for the AI account.' : wsOff ? 'The AI account refused web search: ' + String(last.last_error).substring(0, 160) : last.status === 'done' && Number(last.searches) > 0 ? 'Working — last run used ' + last.searches + ' search(es).' : 'Last run: ' + last.status + (last.last_error ? ' — ' + String(last.last_error).substring(0, 160) : '') });
  var cronOk = String(process.env.CRON_SECRET || '').length >= 16;
  out.push({ key: 'worker', label: 'Background worker', ok: cronOk, detail: cronOk ? 'Runs on a timer every 5 minutes; “Run now” starts it immediately.' : 'The timer is not authorised on the server (CRON_SECRET) — use “Run now” after starting research.' });
  out.push({ key: 'email', label: 'Sending email (info@ktcus.com)', ok: false, planned: true, detail: 'Not connected in this stage. Drafts are prepared for a person to copy; sending with approval is Stage 2.' });
  out.push({ key: 'whatsapp', label: 'WhatsApp outreach', ok: false, planned: true, detail: 'Not connected for outreach: no first-contact templates are approved by Meta yet.' });
  return out;
}
