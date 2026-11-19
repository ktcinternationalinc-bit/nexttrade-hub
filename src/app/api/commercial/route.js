// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SV — Project 1 (commercial agent), Stage 1: the Sourcing desk.
// Max, Nov 15 2026: "I need also an agent to procure goods find suppliers … Compare prices … Is it doable. Worth it." ·
// "You need to find a way to organize communication and requests to you." · approvers: "Super admin. And those permissioned".
//
// What this stage does: a request becomes a numbered assignment (owner, stage, next action, due date); the agent researches
// the public web and proposes a shortlist where every fact carries its source link; a person keeps or drops each supplier;
// an outreach draft is prepared for a person to read. NOTHING IS SENT, bought or paid here.
// Permissions: commercial.access (see and work the desk) · commercial.research (start paid web research).
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../lib/server-permissions';
import { verifiedCaller } from '../../../lib/verified-caller'; // v55.83-UH
import { audit } from '../../../lib/audit-server';
import { validateRequest, requestLabel, nameKey, websiteKey, ROLES, STAGES, isDate, outreachDraft, draftLeaks, SEARCHES_PER_RUN } from '../../../lib/sourcing';
import { monthUsage, integrationHealth, runNextJob } from '../../../lib/sourcing-server';
import { mailConfig, sendApproved, testMailbox, checkInbox, prepareFollowUps } from '../../../lib/commercial-mail-server'; // v55.83-SW
import { isEmail, statusWords, signatureLines } from '../../../lib/commercial-mail';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

var SQL_HINT = ' — run sql/v55-83-SV-sourcing-desk.sql and sql/v55-83-SW-outreach-approval.sql in Supabase first.';
var LIVE = ['draft', 'pending_approval', 'approved', 'sending', 'failed']; // v55.83-SW — an outgoing message not yet finished
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function fail(msg, status) { return NextResponse.json({ ok: false, error: msg }, { status: status || 400 }); }
function dbErr(e) { var m = (e && e.message) || 'database error'; return fail(m + (/sourcing_|supplier|outreach_|agent_job|commercial_|schema cache/i.test(m) && !/LOCKED|duplicate key/i.test(m) ? SQL_HINT : ''), /LOCKED/.test(m) ? 409 : 400); }
function isUuid(s) { return /^[0-9a-f-]{36}$/i.test(String(s || '')); }
function nowIso() { return new Date().toISOString(); }
function txt(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().substring(0, max || 400); }

async function names(db, ids) {
  var out = {}; var want = ids.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!want.length) { return out; }
  var u = await db.from('users').select('id, name').in('id', want);
  ((u && u.data) || []).forEach(function (r) { out[r.id] = r.name || 'user'; });
  return out;
}

export async function POST(req) {
  try {
    var body = {}; try { body = await req.json(); } catch (eB) { body = {}; }
    var action = String(body.action || '');
    // v55.83-UH (Codex 18 Nov 12:40, P1): WHO is calling comes from the verified sign-in token, checked BEFORE any
    // permission, data or action work. A body.user_id that is not the signed-in person is refused and never used.
    // Every action below (listing, research, approval, sending, audit) uses only this verified identity.
    var who = await verifiedCaller(req, body, createClient);
    if (!who || who.error || !who.userId) { return fail((who && who.error) || 'Sign in again — your sign-in could not be verified.', (who && who.status) || 401); }
    var userId = who.userId;
    var db = admin();
    var g = await assertPermission(db, userId, 'commercial.access', req);
    if (!g || !g.ok) { return fail('The Sourcing desk needs the “Commercial: Sourcing desk” permission — ask an admin in Settings.', 403); }
    var canResearch = !!((await assertPermission(db, userId, 'commercial.research', req)) || {}).ok;
    var canApprove = !!((await assertPermission(db, userId, 'commercial.approve', req)) || {}).ok; // v55.83-SW (Max: "Super admin or anyone with the permission to")

    // ── what is connected, and this month's paid search use
    if (action === 'health') {
      var h = await integrationHealth(db); var mu = await monthUsage(db);
      // v55.83-SW — the mailbox replaces the "not in this stage" lines for email
      var mc = mailConfig(); var ms = await db.from('commercial_mail_state').select('*').eq('id', 1).maybeSingle();
      var lr0 = ms && ms.data && ms.data.last_result;
      h = h.filter(function (x) { return x.key !== 'email'; });
      h.push({ key: 'email_send', label: 'Sending from ' + (mc.user || 'info@ktcus.com') + ' as ' + signatureLines(mc.sender).slice(0, 2).join(', '), ok: mc.configured, unknown: false,
        detail: mc.configured ? 'Set up on the server (' + mc.smtp_host + ':' + mc.smtp_port + '). Every message is approved by a person before it goes. Use “Test the mailbox” to check the sign-in.' : 'Not connected — add COMMERCIAL_MAIL_USER and COMMERCIAL_MAIL_PASSWORD in Vercel → Settings → Environment Variables, then redeploy.' });
      // v55.83-UY (Max's screen, Nov 19: "CONNECTED" beside a failed reading test) — a check that never opened the mailbox (nothing sent yet) proves nothing
      var readProven = !!(mc.configured && lr0 && lr0.ok && !lr0.nothing_sent && (Number(lr0.scanned) > 0 || lr0.nothing_sent === false));
      h.push({ key: 'email_read', label: 'Reading replies', ok: readProven, unknown: !!(mc.configured && (!lr0 || (lr0.ok && !readProven))),
        detail: !mc.configured ? 'Not connected (same mailbox settings).' : !lr0 ? 'Not checked yet — it runs every 5 minutes once a message has been sent.' : (lr0.ok && !readProven) ? 'Not proven yet: nothing has been sent, so the mailbox has not been opened for reading. Use “Test the mailbox” — it must show a green “Reading” line.' : lr0.ok ? 'Last checked ' + String(lr0.at || '').substring(0, 16).replace('T', ' ') + ' UTC — ' + (lr0.stored || 0) + ' new reply(ies).' : 'Last check failed: ' + (lr0.error || 'unknown') });
      return NextResponse.json({ ok: true, health: h, usage: mu.error ? null : mu, can_research: canResearch, can_approve: canApprove });
    }

    // ── the list of assignments
    if (action === 'list') {
      var lr = await db.from('sourcing_requests').select('*').order('created_at', { ascending: false }).limit(300);
      if (lr.error) { return dbErr(lr.error); }
      var rows = lr.data || [];
      var ids = rows.map(function (r) { return r.id; }); var counts = {};
      for (var i = 0; i < ids.length; i += 200) {
        var sl = await db.from('sourcing_shortlist').select('request_id, status').in('request_id', ids.slice(i, i + 200));
        ((sl && sl.data) || []).forEach(function (x) { var c = counts[x.request_id] = counts[x.request_id] || { proposed: 0, kept: 0, dropped: 0 }; c[x.status] = (c[x.status] || 0) + 1; });
      }
      var nm = await names(db, rows.map(function (r) { return r.owner_id; }));
      var today = nowIso().substring(0, 10);
      return NextResponse.json({ ok: true, can_research: canResearch, requests: rows.map(function (r) {
        return { id: r.id, label: requestLabel(r.seq), company: r.company, direction: r.direction, title: r.title, product: r.product, stage: r.stage, stage_label: (STAGES[r.stage] || {}).label || r.stage,
          next_action: r.next_action, due_date: r.due_date, overdue: !!(r.due_date && r.due_date < today && r.stage !== 'closed'), owner_id: r.owner_id, owner: nm[r.owner_id] || null,
          shortlist: counts[r.id] || { proposed: 0, kept: 0, dropped: 0 }, created_at: r.created_at };
      }) });
    }

    // ── a new request → a numbered assignment
    if (action === 'create_request') {
      var v = validateRequest(body.request || {});
      if (!v.ok) { return fail(v.errors.join(' ')); }
      var att = Array.isArray(body.request.attachments) ? body.request.attachments.filter(function (a) { return a && /^pv\//.test(String(a.path || '')); }).slice(0, 10).map(function (a) { return { path: String(a.path), name: txt(a.name, 120) }; }) : [];
      var ownerId = isUuid(body.request.owner_id) ? body.request.owner_id : userId;
      var ins = await db.from('sourcing_requests').insert(Object.assign({}, v.row, { attachments: att, owner_id: ownerId, created_by: userId, stage: 'new', next_action: 'Start the supplier research, or add suppliers you already know.' })).select('id, seq').single();
      if (ins.error) { return dbErr(ins.error); }
      await audit(db, userId, 'sourcing_request_created', 'sourcing_request', ins.data.id, { request: requestLabel(ins.data.seq), company: v.row.company, direction: v.row.direction, product: v.row.product });
      return NextResponse.json({ ok: true, id: ins.data.id, label: requestLabel(ins.data.seq) });
    }

    // ── suppliers directory + adding one by hand (duplicates refused, pointing at the existing record)
    if (action === 'suppliers') {
      var q = txt(body.q, 80).toLowerCase();
      var sr = await db.from('suppliers').select('*').order('legal_name').limit(500);
      if (sr.error) { return dbErr(sr.error); }
      var list = (sr.data || []).filter(function (s) { return !q || (String(s.legal_name || '') + ' ' + String(s.trading_name || '') + ' ' + String(s.products || '') + ' ' + String(s.country || '')).toLowerCase().indexOf(q) >= 0; });
      return NextResponse.json({ ok: true, suppliers: list.slice(0, 200) });
    }
    if (action === 'add_supplier') {
      var sName = txt(body.legal_name, 200); var k = nameKey(sName);
      if (!k) { return fail('Type the supplier’s name.'); }
      var wk = websiteKey(body.website);
      var d1 = await db.from('suppliers').select('id, legal_name').eq('name_key', k).limit(1);
      if (d1.error) { return dbErr(d1.error); }
      var dupS = d1.data && d1.data[0];
      if (!dupS && wk) { var d2 = await db.from('suppliers').select('id, legal_name').eq('website_key', wk).limit(1); dupS = d2 && d2.data && d2.data[0]; }
      var supId = dupS ? dupS.id : null;
      if (!dupS) {
        var si = await db.from('suppliers').insert({ legal_name: sName, trading_name: txt(body.trading_name, 200) || null, name_key: k, role: ROLES.indexOf(body.role) >= 0 ? body.role : 'unknown', country: txt(body.country, 80) || null, city: txt(body.city, 80) || null,
          website: wk ? 'https://' + wk : null, website_key: wk || null, products: txt(body.products, 600) || null, notes: txt(body.notes, 1000) || null, added_by_kind: 'person', created_by: userId }).select('id').single();
        if (si.error) { return dbErr(si.error); }
        supId = si.data.id;
        await audit(db, userId, 'supplier_added', 'supplier', supId, { name: sName, website: wk || null });
      }
      var onList = false;
      if (isUuid(body.request_id)) {
        var has = await db.from('sourcing_shortlist').select('id').eq('request_id', body.request_id).eq('supplier_id', supId).limit(1);
        if (!(has.data && has.data[0])) {
          var sli = await db.from('sourcing_shortlist').insert({ request_id: body.request_id, supplier_id: supId, status: 'kept', decided_by: userId, decided_at: nowIso(), added_by_kind: 'person', fit_note: txt(body.fit_note, 800) || null });
          if (sli.error) { return dbErr(sli.error); }
          onList = true;
        }
      }
      return NextResponse.json({ ok: true, id: supId, existing: !!dupS, existing_name: dupS ? dupS.legal_name : null, added_to_request: onList });
    }

    // ── v55.83-SW — messages waiting for approval, across every request
    if (action === 'approvals') {
      var pa = await db.from('commercial_messages').select('id, request_id, supplier_id, to_address, subject, kind, submitted_by, submitted_at').eq('status', 'pending_approval').order('submitted_at', { ascending: true });
      if (pa.error) { return dbErr(pa.error); }
      var pr = (pa.data || []); var rIds = pr.map(function (x) { return x.request_id; }); var sIds = pr.map(function (x) { return x.supplier_id; });
      var rqs = rIds.length ? await db.from('sourcing_requests').select('id, seq, title').in('id', rIds) : { data: [] };
      var sps = sIds.length ? await db.from('suppliers').select('id, legal_name').in('id', sIds) : { data: [] };
      var rB = {}; ((rqs && rqs.data) || []).forEach(function (x) { rB[x.id] = x; }); var sB = {}; ((sps && sps.data) || []).forEach(function (x) { sB[x.id] = x; });
      var nmA = await names(db, pr.map(function (x) { return x.submitted_by; }));
      return NextResponse.json({ ok: true, can_approve: canApprove, items: pr.map(function (x) { return { id: x.id, request_id: x.request_id, label: rB[x.request_id] ? requestLabel(rB[x.request_id].seq) : '', title: rB[x.request_id] ? rB[x.request_id].title : '', supplier: sB[x.supplier_id] ? sB[x.supplier_id].legal_name : '', to: x.to_address, subject: x.subject, kind: x.kind, by: nmA[x.submitted_by] || null, at: x.submitted_at }; }) });
    }
    if (action === 'mail_test') {
      if (!canApprove) { return fail('Testing the mailbox needs the “Commercial: Approve outgoing messages” permission.', 403); }
      var tm = await testMailbox();
      await audit(db, userId, 'commercial_mailbox_tested', 'commercial_mail', 'info', { ok: tm.ok });
      return NextResponse.json({ ok: true, test: tm });
    }
    if (action === 'check_mail_now') {
      var ci = await checkInbox(db, { budgetMs: 45000 }); var fu = await prepareFollowUps(db, {});
      return NextResponse.json({ ok: true, inbox: { ok: ci.ok, stored: ci.stored, bounces: ci.bounces, scanned: ci.scanned, error: ci.error || null, not_configured: !!ci.not_configured, nothing_sent: !!ci.nothing_sent }, followups: fu.made || 0 });
    }

    // everything below works on ONE request
    var rid = body.id || body.request_id;
    if (!isUuid(rid)) { return fail('Which request?'); }
    var rq = await db.from('sourcing_requests').select('*').eq('id', rid).maybeSingle();
    if (rq.error) { return dbErr(rq.error); }
    var R = rq.data;
    if (!R) { return fail('That request was not found.', 404); }

    if (action === 'get') {
      var slr = await db.from('sourcing_shortlist').select('*').eq('request_id', R.id).order('rank', { ascending: true });
      if (slr.error) { return dbErr(slr.error); }
      var sids = (slr.data || []).map(function (x) { return x.supplier_id; });
      var sups = sids.length ? await db.from('suppliers').select('*').in('id', sids) : { data: [] };
      var facts = sids.length ? await db.from('supplier_facts').select('*').in('supplier_id', sids).order('created_at', { ascending: true }) : { data: [] };
      var cons = sids.length ? await db.from('supplier_contacts').select('*').in('supplier_id', sids).order('created_at', { ascending: true }) : { data: [] };
      var msgsR = await db.from('commercial_messages').select('*').eq('request_id', R.id).order('created_at', { ascending: true }); // v55.83-SW — the correspondence
      var msgs = (msgsR && !msgsR.error && msgsR.data) || [];
      var nmM = await names(db, msgs.map(function (m) { return m.approved_by; }).concat(msgs.map(function (m) { return m.submitted_by; })));
      var jobs = await db.from('agent_jobs').select('id, status, attempts, max_attempts, last_error, result, searches, created_at, finished_at, run_after').eq('kind', 'sourcing_research').eq('ref_id', R.id).order('created_at', { ascending: false }).limit(5);
      var supBy = {}; ((sups && sups.data) || []).forEach(function (s) { supBy[s.id] = s; });
      var nm2 = await names(db, [R.owner_id, R.created_by]);
      var shortlist = (slr.data || []).map(function (x) {
        var s = supBy[x.supplier_id] || {};
        return { shortlist_id: x.id, supplier_id: x.supplier_id, status: x.status, dropped_reason: x.dropped_reason, fit_note: x.fit_note, concerns: x.concerns, rank: x.rank, added_by_kind: x.added_by_kind,
          supplier: { legal_name: s.legal_name, trading_name: s.trading_name, role: s.role, country: s.country, city: s.city, website: s.website, products: s.products, status: s.status, added_by_kind: s.added_by_kind },
          facts: ((facts && facts.data) || []).filter(function (f) { return f.supplier_id === x.supplier_id; }).map(function (f) { return { id: f.id, topic: f.topic, statement: f.statement, grade: f.grade, confidence: f.confidence, source_url: f.source_url, source_title: f.source_title, observed_on: f.observed_on, evidence_note: f.evidence_note, added_by_kind: f.added_by_kind, retracted: !!f.retracted_at, retracted_why: f.retracted_why, this_request: f.request_id === R.id }; }),
          contacts: ((cons && cons.data) || []).filter(function (c) { return c.supplier_id === x.supplier_id; }).map(function (c) { return { id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone, whatsapp: c.whatsapp, source_url: c.source_url, found_on: c.found_on, verified: !!c.verified_at }; }),
          thread: msgs.filter(function (m) { return m.supplier_id === x.supplier_id && m.status !== 'discarded'; }).map(function (m) { return { id: m.id, direction: m.direction, kind: m.kind, followup_no: m.followup_no, status: m.status, status_words: statusWords(m),
            from_address: m.from_address, to_address: m.to_address, subject: m.subject, body: m.body, attachments: m.attachments || [], flags: m.flags || [], sent_at: m.sent_at, received_at: m.received_at, created_at: m.created_at,
            approved_by: nmM[m.approved_by] || null, approved_at: m.approved_at, submitted_by: nmM[m.submitted_by] || null, last_error: m.last_error, content_hash: m.content_hash, outcome_unknown: /OUTCOME UNKNOWN/.test(m.last_error || '') }; }) };
      });
      var mu2 = await monthUsage(db);
      return NextResponse.json({ ok: true, can_research: canResearch, can_approve: canApprove, mail_ready: mailConfig().configured, threads_ready: !(msgsR && msgsR.error), usage: mu2.error ? null : mu2,
        request: { id: R.id, label: requestLabel(R.seq), seq: R.seq, company: R.company, direction: R.direction, title: R.title, product: R.product, specs: R.specs, quantity: R.quantity, destination: R.destination, needed_by: R.needed_by,
          internal_note: R.internal_note, attachments: R.attachments || [], stage: R.stage, stage_label: (STAGES[R.stage] || {}).label || R.stage, stage_words: (STAGES[R.stage] || {}).words || '', next_action: R.next_action, due_date: R.due_date,
          closed_reason: R.closed_reason, owner: nm2[R.owner_id] || null, created_by: nm2[R.created_by] || null, created_at: R.created_at },
        shortlist: shortlist, jobs: (jobs && jobs.data) || [] });
    }

    if (R.stage === 'closed' && action !== 'reopen') { return fail('This request is closed. Reopen it to change it.', 409); }

    // v55.83-UY (Max, Nov 19: "edit the request") — change what was asked for after the request was created.
    // Same checks as creating one. Not while research is waiting or running (a paid run must not read a half-changed request).
    if (action === 'edit_request') {
      if (R.stage === 'researching') { return fail('Research is running for this request. Wait until it finishes, then edit it.', 409); }
      var liveJ = await db.from('agent_jobs').select('id').eq('ref_id', R.id).in('status', ['queued', 'running']).limit(1);
      if (liveJ.error) { return dbErr(liveJ.error); }
      if (liveJ.data && liveJ.data[0]) { return fail('Research is waiting or running for this request. Wait until it finishes, then edit it.', 409); }
      var ve = validateRequest(Object.assign({}, body.request || {}, { due_date: R.due_date || null }));
      if (!ve.ok) { return fail(ve.errors.join(' ')); }
      var EDITABLE = ['company', 'direction', 'product', 'specs', 'quantity', 'destination', 'needed_by', 'internal_note'];
      var ePatch = {}; var before = {}; var after = {}; var changed = [];
      EDITABLE.forEach(function (k) {
        var was = R[k] == null || R[k] === '' ? null : R[k]; var now = ve.row[k] == null || ve.row[k] === '' ? null : ve.row[k];
        if (String(was == null ? '' : was) === String(now == null ? '' : now)) { return; }
        ePatch[k] = now; changed.push(k);
        if (k !== 'internal_note') { before[k] = was; after[k] = now; }   // the internal note's text never goes into the audit log (it is read more widely)
      });
      if (!changed.length) { return NextResponse.json({ ok: true, changed: [], unsent_drafts: 0 }); }
      // the title follows the product only when it was never given its own wording
      if (ePatch.product && String(R.title || '') === String(R.product || '').substring(0, 140)) { ePatch.title = String(ePatch.product).substring(0, 140); }
      ePatch.updated_at = nowIso();
      var eu = await db.from('sourcing_requests').update(ePatch).eq('id', R.id).neq('stage', 'researching').neq('stage', 'closed').select('id');
      if (eu.error) { return dbErr(eu.error); }
      if (!eu.data || !eu.data.length) { return fail('The request changed while you were editing (research started or it was closed). Open it again.', 409); }
      var unsent = 0;
      try { var dq = await db.from('commercial_messages').select('id, status').eq('request_id', R.id).in('status', ['draft', 'pending_approval', 'approved', 'failed']); unsent = (dq && !dq.error && dq.data) ? dq.data.length : 0; } catch (eD) { unsent = 0; }
      await audit(db, userId, 'sourcing_request_edited', 'sourcing_request', R.id, { request: requestLabel(R.seq), changed: changed, before: before, after: after, internal_note_changed: changed.indexOf('internal_note') >= 0, unsent_drafts: unsent });
      return NextResponse.json({ ok: true, changed: changed, unsent_drafts: unsent });
    }

    // ── stage, next action, due date
    if (action === 'update') {
      var patch = { updated_at: nowIso() };
      if (Object.prototype.hasOwnProperty.call(body, 'next_action')) { patch.next_action = txt(body.next_action, 300) || null; }
      if (Object.prototype.hasOwnProperty.call(body, 'due_date')) { if (body.due_date && !isDate(body.due_date)) { return fail('The due date is not a valid date.'); } patch.due_date = body.due_date || null; }
      if (Object.prototype.hasOwnProperty.call(body, 'owner_id')) { if (!isUuid(body.owner_id)) { return fail('Pick an owner.'); } patch.owner_id = body.owner_id; }
      if (body.stage === 'on_hold') { patch.stage = 'on_hold'; }
      if (body.stage === 'closed') { var why = txt(body.closed_reason, 400); if (why.length < 3) { return fail('Say why this request is closed (done, cancelled, not worth it…).'); } patch.stage = 'closed'; patch.closed_reason = why; patch.next_action = null; }
      if (body.stage === 'resume' && R.stage === 'on_hold') { patch.stage = 'new'; }
      var up = await db.from('sourcing_requests').update(patch).eq('id', R.id);
      if (up.error) { return dbErr(up.error); }
      await audit(db, userId, 'sourcing_request_updated', 'sourcing_request', R.id, { request: requestLabel(R.seq), changes: patch });
      return NextResponse.json({ ok: true });
    }
    if (action === 'reopen') {
      if (R.stage !== 'closed') { return fail('This request is not closed.', 409); }
      var ro = await db.from('sourcing_requests').update({ stage: 'new', closed_reason: null, next_action: 'Reopened — decide the next step.', updated_at: nowIso() }).eq('id', R.id);
      if (ro.error) { return dbErr(ro.error); }
      await audit(db, userId, 'sourcing_request_reopened', 'sourcing_request', R.id, { request: requestLabel(R.seq), was_closed_because: R.closed_reason });
      return NextResponse.json({ ok: true });
    }

    // ── start the web research (paid; counted against the monthly cap; one live job per request)
    if (action === 'start_research') {
      if (!canResearch) { return fail('Starting paid web research needs the “Commercial: Start web research” permission.', 403); }
      var mu3 = await monthUsage(db);
      if (mu3.error) { return fail(mu3.error + SQL_HINT, 400); }
      if (!mu3.fits) { return fail('The monthly research limit is reached: $' + mu3.spent.toFixed(2) + ' used of $' + mu3.cap.toFixed(2) + ' (searches and AI work together). One run needs up to $' + mu3.run_cost_max.toFixed(2) + ' free.', 409); }
      // v55.83-UY rev 2 (Codex 19 Nov, P2 "edit_request is not atomic against start_research"): the request is marked "researching" FIRST, in one
      // conditional statement, and only then is the job created. An edit changes the request only with stage <> researching in its own statement, so
      // the two can never both win: no job can exist for a request that an edit is still allowed to change, and a worker only ever reads the brief
      // after the stage is set. If the job cannot be created the stage is put back.
      var prevStage = R.stage; var prevNext = R.next_action || null;
      var lk = await db.from('sourcing_requests').update({ stage: 'researching', next_action: 'The agent is researching suppliers on the web.', updated_at: nowIso() }).eq('id', R.id).neq('stage', 'researching').neq('stage', 'closed').select('id');
      if (lk.error) { return dbErr(lk.error); }
      var took = !!(lk.data && lk.data.length);
      var putBack = async function () { if (took) { await db.from('sourcing_requests').update({ stage: prevStage, next_action: prevNext, updated_at: nowIso() }).eq('id', R.id).eq('stage', 'researching'); } };
      var ji = await db.from('agent_jobs').insert({ kind: 'sourcing_research', ref_id: R.id, created_by: userId }).select('id').single();
      if (ji.error) { await putBack(); if (/duplicate key|uq_agent_job_live/i.test(ji.error.message || '')) { return fail('Research for this request is already running or waiting — it will not be started (or paid for) twice.', 409); } return dbErr(ji.error); }
      await audit(db, userId, 'sourcing_research_started', 'sourcing_request', R.id, { request: requestLabel(R.seq), job: ji.data.id, max_searches: SEARCHES_PER_RUN, month_spent_before: mu3.spent });
      return NextResponse.json({ ok: true, job_id: ji.data.id });
    }
    // run the worker now instead of waiting for the timer (same code path as the timer)
    if (action === 'run_now') {
      if (!canResearch) { return fail('This needs the “Commercial: Start web research” permission.', 403); }
      var rn = await runNextJob(db, { budgetMs: 240000 });
      return NextResponse.json({ ok: true, ran: rn.ran, result: rn });
    }

    // ── keep or drop a proposed supplier
    if (action === 'decide') {
      if (!isUuid(body.shortlist_id)) { return fail('Which supplier?'); }
      var want = body.decision === 'keep' ? 'kept' : body.decision === 'drop' ? 'dropped' : body.decision === 'undo' ? 'proposed' : null;
      if (!want) { return fail('Keep or drop?'); }
      var whyD = txt(body.reason, 300);
      if (want === 'dropped' && whyD.length < 3) { return fail('Say why this supplier is dropped.'); }
      var du = await db.from('sourcing_shortlist').update({ status: want, dropped_reason: want === 'dropped' ? whyD : null, decided_by: userId, decided_at: nowIso() }).eq('id', body.shortlist_id).eq('request_id', R.id).select('id, supplier_id');
      if (du.error) { return dbErr(du.error); }
      if (!du.data || !du.data.length) { return fail('That supplier is not on this request’s shortlist.', 404); }
      if (want !== 'kept') { await db.from('commercial_messages').update({ status: 'discarded', discarded_why: 'supplier no longer kept' }).eq('request_id', R.id).eq('supplier_id', du.data[0].supplier_id).in('status', ['draft', 'pending_approval', 'approved', 'failed']); }
      await audit(db, userId, 'sourcing_shortlist_decided', 'sourcing_request', R.id, { request: requestLabel(R.seq), supplier: du.data[0].supplier_id, decision: want, reason: whyD || null });
      return NextResponse.json({ ok: true, status: want });
    }

    // ── a fact a person adds (VERIFIED needs what they saw); retract a wrong one (never erased)
    if (action === 'add_fact') {
      if (!isUuid(body.supplier_id)) { return fail('Which supplier?'); }
      var grade = ['verified', 'claim', 'estimate'].indexOf(body.grade) >= 0 ? body.grade : 'claim';
      var st = txt(body.statement, 600); var ev = txt(body.evidence_note, 600); var su = String(body.source_url || '').trim();
      if (st.length < 3) { return fail('Type the fact.'); }
      if (grade === 'verified' && ev.length < 5) { return fail('For a VERIFIED fact say what you saw: the reply, the document, the call.'); }
      if (su && !/^https?:\/\//i.test(su)) { return fail('The source link must start with http:// or https://'); }
      var fi = await db.from('supplier_facts').insert({ supplier_id: body.supplier_id, request_id: R.id, topic: txt(body.topic, 80) || 'note', statement: st, grade: grade, confidence: ['high', 'medium', 'low'].indexOf(body.confidence) >= 0 ? body.confidence : 'medium',
        source_url: su || null, evidence_note: ev || null, added_by_kind: 'person', created_by: userId }).select('id').single();
      if (fi.error) { return dbErr(fi.error); }
      await audit(db, userId, 'supplier_fact_added', 'supplier', body.supplier_id, { fact: fi.data.id, grade: grade, request: requestLabel(R.seq) });
      return NextResponse.json({ ok: true, id: fi.data.id });
    }
    if (action === 'retract_fact') {
      if (!isUuid(body.fact_id)) { return fail('Which fact?'); }
      var whyR = txt(body.reason, 300);
      if (whyR.length < 5) { return fail('Say why this fact is wrong.'); }
      var rf = await db.from('supplier_facts').update({ retracted_at: nowIso(), retracted_by: userId, retracted_why: whyR }).eq('id', body.fact_id).is('retracted_at', null).select('id, supplier_id');
      if (rf.error) { return dbErr(rf.error); }
      if (!rf.data || !rf.data.length) { return fail('That fact was not found, or was already retracted.', 404); }
      await audit(db, userId, 'supplier_fact_retracted', 'supplier', rf.data[0].supplier_id, { fact: body.fact_id, reason: whyR });
      return NextResponse.json({ ok: true });
    }

    // ── prepare an outreach draft for a KEPT supplier — a fixed template from the request; nothing is sent
    if (action === 'prepare_draft') {
      if (!isUuid(body.supplier_id)) { return fail('Which supplier?'); }
      var ks = await db.from('sourcing_shortlist').select('status').eq('request_id', R.id).eq('supplier_id', body.supplier_id).maybeSingle();
      if (!ks.data || ks.data.status !== 'kept') { return fail('Keep this supplier on the shortlist first — drafts are only prepared for suppliers you kept.', 409); }
      var sp = await db.from('suppliers').select('*').eq('id', body.supplier_id).maybeSingle();
      if (!sp.data) { return fail('That supplier was not found.', 404); }
      var ct = await db.from('supplier_contacts').select('*').eq('supplier_id', body.supplier_id).order('created_at', { ascending: true });
      var withMail = ((ct && ct.data) || []).filter(function (c) { return c.email; });
      var contact = withMail.filter(function (c) { return c.verified_at; })[0] || withMail[0] || null;
      var d = outreachDraft(R, sp.data, contact, null);
      var leaks = draftLeaks(d.subject + '\n' + d.body, R.internal_note);
      if (leaks.length) { return fail('The draft was not prepared: it would repeat text from the internal note (“' + leaks[0].substring(0, 60) + '”). Move that text out of the product or specifications.', 409); }
      var busyM = await db.from('commercial_messages').select('id').eq('request_id', R.id).eq('supplier_id', body.supplier_id).eq('status', 'sending').limit(1);
      if (busyM.error) { return dbErr(busyM.error); }
      if (busyM.data && busyM.data.length) { return fail('A message to this supplier is being sent right now — wait a moment.', 409); }
      var firstSent = await db.from('commercial_messages').select('id').eq('request_id', R.id).eq('supplier_id', body.supplier_id).eq('direction', 'out').in('status', ['sent', 'bounced']).limit(1);
      if (firstSent.data && firstSent.data.length && body.again !== true) { return fail('This supplier was already written to. Use “Write again” in the conversation instead.', 409); }
      await db.from('commercial_messages').update({ status: 'discarded', discarded_why: 'replaced by a new draft' }).eq('request_id', R.id).eq('supplier_id', body.supplier_id).in('status', ['draft', 'pending_approval', 'approved', 'failed']);
      var di = await db.from('commercial_messages').insert({ request_id: R.id, supplier_id: body.supplier_id, direction: 'out', kind: 'first', to_address: d.to_address, subject: d.subject, body: d.body, status: 'draft', created_by: userId }).select('id').single();
      if (di.error) { return dbErr(di.error); }
      await db.from('sourcing_requests').update({ stage: 'drafts_ready', next_action: 'Read the draft, correct it if needed, and send it for approval.', updated_at: nowIso() }).eq('id', R.id).in('stage', ['new', 'shortlist', 'drafts_ready']);
      await audit(db, userId, 'outreach_draft_prepared', 'sourcing_request', R.id, { request: requestLabel(R.seq), supplier: body.supplier_id, draft: di.data.id, to: d.to_address, sent: false });
      return NextResponse.json({ ok: true, id: di.data.id, draft: d, has_contact: !!contact });
    }

    // ── v55.83-SW — working one outgoing message: edit, send for approval, approve (and send), send back, discard, try again
    if (['edit_message', 'submit', 'approve', 'send_back', 'discard', 'retry', 'write_again'].indexOf(action) >= 0) {
      if (action === 'write_again') {
        if (!isUuid(body.supplier_id)) { return fail('Which supplier?'); }
        var liveW = await db.from('commercial_messages').select('id').eq('request_id', R.id).eq('supplier_id', body.supplier_id).in('status', LIVE).limit(1);
        if (liveW.error) { return dbErr(liveW.error); }
        if (liveW.data && liveW.data.length) { return fail('There is already a message being prepared for this supplier.', 409); }
        var lastIn = await db.from('commercial_messages').select('*').eq('request_id', R.id).eq('supplier_id', body.supplier_id).order('created_at', { ascending: false }).limit(5);
        var ref = ((lastIn && lastIn.data) || []).filter(function (m) { return m.status === 'received' || m.status === 'sent'; })[0];
        var toW = ref ? (ref.direction === 'in' ? ref.from_address : ref.to_address) : '';
        var subjW = ref ? (/^re:/i.test(ref.subject) ? ref.subject : 'Re: ' + ref.subject) : 'Re: ' + requestLabel(R.seq);
        var bodyW = 'Dear ' + (ref && ref.direction === 'in' ? 'Sir or Madam' : 'Sir or Madam') + ',\n\n\n\nKind regards,\n\n' + signatureLines(mailConfig().sender).join('\n');
        var iw = await db.from('commercial_messages').insert({ request_id: R.id, supplier_id: body.supplier_id, direction: 'out', kind: 'reply', to_address: toW || null, subject: subjW.substring(0, 300), body: bodyW, status: 'draft', created_by: userId }).select('id').single();
        if (iw.error) { return dbErr(iw.error); }
        return NextResponse.json({ ok: true, id: iw.data.id });
      }
      if (!isUuid(body.message_id)) { return fail('Which message?'); }
      var cm = await db.from('commercial_messages').select('*').eq('id', body.message_id).eq('request_id', R.id).maybeSingle();
      if (cm.error) { return dbErr(cm.error); }
      var M = cm.data;
      if (!M || M.direction !== 'out') { return fail('That outgoing message was not found on this request.', 404); }
      if (action === 'edit_message') {
        if (['draft', 'pending_approval', 'approved', 'failed'].indexOf(M.status) < 0) { return fail('A ' + M.status + ' message cannot be changed.', 409); }
        var to = String(body.to_address || '').trim(); var subj = txt(body.subject, 300); var bdy = String(body.body || '').replace(/\r\n/g, '\n').trim().substring(0, 20000);
        if (to && !isEmail(to)) { return fail('“' + to + '” is not an email address.'); }
        if (subj.length < 3 || bdy.length < 10) { return fail('The subject and the text cannot be empty.'); }
        var leakE = draftLeaks(subj + '\n' + bdy, R.internal_note);
        if (leakE.length) { return fail('Not saved: the text repeats the internal note (“' + leakE[0].substring(0, 60) + '”). That stays inside KTC.', 409); }
        var ue = await db.from('commercial_messages').update({ to_address: to || null, subject: subj, body: bdy, status: M.status === 'failed' ? 'draft' : M.status, message_id: M.status === 'failed' ? null : M.message_id }).eq('id', M.id).in('status', ['draft', 'pending_approval', 'approved', 'failed']).select('status');
        if (ue.error) { return dbErr(ue.error); }
        var nowSt = ue.data && ue.data[0] && ue.data[0].status;
        await audit(db, userId, 'commercial_message_edited', 'sourcing_request', R.id, { message: M.id, was: M.status, now: nowSt });
        return NextResponse.json({ ok: true, status: nowSt, approval_cleared: (M.status === 'pending_approval' || M.status === 'approved') && nowSt === 'draft' });
      }
      if (action === 'submit') {
        if (M.status !== 'draft') { return fail('Only a draft can be sent for approval (it is ' + M.status + ').', 409); }
        if (!isEmail(M.to_address)) { return fail('Add the recipient’s email address first.'); }
        var leakS = draftLeaks(M.subject + '\n' + M.body, R.internal_note);
        if (leakS.length) { return fail('Not sent for approval: the text repeats the internal note.', 409); }
        var us = await db.from('commercial_messages').update({ status: 'pending_approval', submitted_by: userId, submitted_at: nowIso() }).eq('id', M.id).eq('status', 'draft').select('id');
        if (us.error) { return dbErr(us.error); }
        if (!us.data || !us.data.length) { return fail('It changed in the meantime — open it again.', 409); }
        await audit(db, userId, 'commercial_message_submitted', 'sourcing_request', R.id, { message: M.id, to: M.to_address });
        return NextResponse.json({ ok: true });
      }
      if (action === 'discard') {
        if (['draft', 'pending_approval', 'approved', 'failed'].indexOf(M.status) < 0) { return fail('A ' + M.status + ' message cannot be discarded.', 409); }
        var whyX = txt(body.reason, 300) || 'discarded';
        var ud = await db.from('commercial_messages').update({ status: 'discarded', discarded_why: whyX }).eq('id', M.id).eq('status', M.status);
        if (ud.error) { return dbErr(ud.error); }
        await audit(db, userId, 'commercial_message_discarded', 'sourcing_request', R.id, { message: M.id, was: M.status, reason: whyX });
        return NextResponse.json({ ok: true });
      }
      // approving, sending back and trying again are for approvers only
      if (!canApprove) { return fail('This needs the “Commercial: Approve outgoing messages” permission.', 403); }
      if (action === 'send_back') {
        if (M.status !== 'pending_approval') { return fail('Only a message waiting for approval can be sent back.', 409); }
        var whyB = txt(body.reason, 300);
        if (whyB.length < 3) { return fail('Say what should change.'); }
        var ub = await db.from('commercial_messages').update({ status: 'draft', submitted_by: null, submitted_at: null, last_error: 'Sent back: ' + whyB }).eq('id', M.id).eq('status', 'pending_approval');
        if (ub.error) { return dbErr(ub.error); }
        await audit(db, userId, 'commercial_message_sent_back', 'sourcing_request', R.id, { message: M.id, reason: whyB });
        return NextResponse.json({ ok: true });
      }
      if (action === 'approve' || action === 'retry') {
        if (action === 'approve' && M.status !== 'pending_approval') { return fail('Only a message waiting for approval can be approved (it is ' + M.status + ').', 409); }
        if (action === 'retry') {
          if (M.status !== 'failed') { return fail('Only a message that was not sent can be tried again.', 409); }
          if (/OUTCOME UNKNOWN/.test(M.last_error || '') && body.checked_sent_folder !== true) { return fail('It is not known whether the first attempt went out. Check the Sent folder of info@ktcus.com, then tick “I checked — it is not there”.', 409); }
        }
        if (String(body.seen_hash || '') !== String(M.content_hash || '')) { return fail('The message changed while you were reading it — open it again and approve what is there now.', 409); }
        var mcfg = mailConfig();
        if (!mcfg.configured) { return fail('The info@ktcus.com mailbox is not connected yet — nothing can be sent. Add COMMERCIAL_MAIL_USER and COMMERCIAL_MAIL_PASSWORD in Vercel, then redeploy.', 409); }
        var ua = await db.from('commercial_messages').update({ status: 'approved', approved_by: userId, approved_at: nowIso(), approved_hash: M.content_hash, message_id: null, last_error: null })
          .eq('id', M.id).eq('status', M.status).eq('content_hash', M.content_hash).select('id');
        if (ua.error) { return dbErr(ua.error); }
        if (!ua.data || !ua.data.length) { return fail('It changed in the meantime — open it again.', 409); }
        await audit(db, userId, action === 'approve' ? 'commercial_message_approved' : 'commercial_message_retry_approved', 'sourcing_request', R.id, { message: M.id, to: M.to_address, version: M.content_hash, submitted_by: M.submitted_by || null, own_message: M.submitted_by === userId || M.created_by === userId });
        var sr = await sendApproved(db, M.id, { actorId: userId });
        return NextResponse.json({ ok: true, sent: sr.ok === true, send: sr });
      }
    }

    return fail('Unknown action.');
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'server error' }, { status: 500 });
  }
}
