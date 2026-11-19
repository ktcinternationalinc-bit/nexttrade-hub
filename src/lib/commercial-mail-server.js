// v55.83-SW — Project 1, Stage 2: sending approved messages from info@ktcus.com and reading the replies.
// Mailbox: Hostinger — SMTP smtp.hostinger.com:465 (SSL), IMAP imap.hostinger.com:993 (SSL), the full address as user name.
// The password lives only in the server's environment (COMMERCIAL_MAIL_PASSWORD) and is never sent to the browser.
// The inbox is opened READ-ONLY: nothing is moved, marked read or deleted there. The only change made to the mailbox is
// a copy of each sent message added to its Sent folder, so people using webmail see what Roma sent.
import { audit } from './audit-server';
import { senderFrom, fromHeader, signatureLines, newMessageId, isEmail, threadMatch, isBounceSender, idsIn, inboundFlags, followUpDue, followUpBody, uncertainFailure, normId } from './commercial-mail';
import { requestLabel } from './sourcing';

export function mailConfig(env) {
  var e = env || process.env;
  var user = String(e.COMMERCIAL_MAIL_USER || '').trim(); var pass = String(e.COMMERCIAL_MAIL_PASSWORD || '');
  return { user: user, has_password: pass.length > 0, pass: pass, smtp_host: e.COMMERCIAL_SMTP_HOST || 'smtp.hostinger.com', smtp_port: Number(e.COMMERCIAL_SMTP_PORT || 465),
    imap_host: e.COMMERCIAL_IMAP_HOST || 'imap.hostinger.com', configured: isEmail(user) && pass.length > 0, sender: senderFrom(e) };
}
function makeTransport(cfg, opts) {
  if (opts && opts.transport) { return opts.transport; }
  var nodemailer = require('nodemailer');
  return nodemailer.createTransport({ host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_port === 465, requireTLS: cfg.smtp_port !== 465, auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
}
function makeImap(cfg, opts) {
  if (opts && opts.imap) { return opts.imap(); }
  var ImapFlow = require('imapflow').ImapFlow;
  return new ImapFlow({ host: cfg.imap_host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
}
function now() { return new Date().toISOString(); }

// ── send ONE approved message. The claim (approved → sending) is conditional, so two callers can never both send it.
export async function sendApproved(db, messageId, opts) {
  var o = opts || {}; var cfg = o.config || mailConfig();
  if (!cfg.configured) { return { ok: false, error: 'The info@ktcus.com mailbox is not connected on the server (COMMERCIAL_MAIL_USER and COMMERCIAL_MAIL_PASSWORD in Vercel).', not_configured: true }; }
  var cur = await db.from('commercial_messages').select('*').eq('id', messageId).maybeSingle();
  var m = cur && cur.data;
  if (!m) { return { ok: false, error: 'That message was not found.' }; }
  if (m.status !== 'approved') { return { ok: false, error: m.status === 'sent' ? 'Already sent.' : 'Only an approved message can be sent (it is ' + m.status + ').' }; }
  if (!m.approved_hash || m.approved_hash !== m.content_hash) { return { ok: false, error: 'The message changed after it was approved — it must be approved again.' }; }
  if (!isEmail(m.to_address)) { return { ok: false, error: 'The recipient address is not valid.' }; }
  var rq = await db.from('sourcing_requests').select('id, seq, stage').eq('id', m.request_id).maybeSingle();
  var R = (rq && rq.data) || { seq: 0 };
  // threading: a follow-up answers the last message we sent on this thread
  var prev = await db.from('commercial_messages').select('message_id, sent_at, direction, status').eq('request_id', m.request_id).eq('supplier_id', m.supplier_id).eq('direction', 'out').eq('status', 'sent').order('sent_at', { ascending: true });
  var chain = ((prev && prev.data) || []).map(function (x) { return x.message_id; }).filter(Boolean);
  var mid = newMessageId(R.seq, String(m.id).replace(/-/g, '').substring(0, 12) + Date.now().toString(36), cfg.user);
  var claim = await db.from('commercial_messages').update({ status: 'sending', message_id: mid, from_address: cfg.user, attempts: (Number(m.attempts) || 0) + 1, last_error: null })
    .eq('id', m.id).eq('status', 'approved').eq('approved_hash', m.content_hash).select('id');
  if (claim.error) { return { ok: false, error: claim.error.message }; }
  if (!claim.data || !claim.data.length) { return { ok: false, error: 'Someone else is already sending this message — it will not be sent twice.' }; }
  var mail = { from: fromHeader(cfg.sender), to: m.to_address, subject: m.subject, text: m.body, messageId: mid, replyTo: cfg.user,
    headers: { 'X-KTC-Reference': requestLabel(R.seq) } };
  if (chain.length) { mail.inReplyTo = chain[chain.length - 1]; mail.references = chain.join(' '); }
  var info = null; var err = null;
  try { info = await makeTransport(cfg, o).sendMail(mail); } catch (e) { err = e; }
  if (err) {
    var unsure = uncertainFailure(err);
    var why = (unsure ? 'OUTCOME UNKNOWN — check the Sent folder of info@ktcus.com before sending again. ' : '') + String((err && err.message) || err).substring(0, 300);
    await db.from('commercial_messages').update({ status: 'failed', last_error: why }).eq('id', m.id).eq('status', 'sending');
    try { await audit(db, o.actorId || null, 'commercial_message_send_failed', 'sourcing_request', m.request_id, { message: m.id, to: m.to_address, error: why, outcome_unknown: unsure }); } catch (eA) { /* the row holds the reason */ }
    return { ok: false, error: why, outcome_unknown: unsure };
  }
  var resp = String((info && info.response) || '').substring(0, 200);
  var accepted = (info && info.accepted) || [];
  if (accepted.length === 0) {
    var whyR = 'The mail server did not accept the recipient: ' + (resp || 'no answer');
    await db.from('commercial_messages').update({ status: 'failed', last_error: whyR, smtp_response: resp }).eq('id', m.id).eq('status', 'sending');
    return { ok: false, error: whyR };
  }
  var done = await db.from('commercial_messages').update({ status: 'sent', sent_at: now(), smtp_response: resp }).eq('id', m.id).eq('status', 'sending').select('id');
  // a copy in the Sent folder (best effort — the message is already sent)
  var copied = false;
  if (o.copyToSent !== false) {
    try {
      var raw = await buildRaw(mail, o);
      if (raw) {
        var c = makeImap(cfg, o); await c.connect();
        try { var boxes = await c.list(); var sentBox = (boxes || []).filter(function (b) { return b.specialUse === '\\Sent'; })[0] || (boxes || []).filter(function (b) { return /^(inbox[./])?sent( items| messages)?$/i.test(b.path); })[0];
          if (sentBox) { await c.append(sentBox.path, raw, ['\\Seen']); copied = true; } } finally { try { await c.logout(); } catch (eL) { /* ignore */ } }
      }
    } catch (eC) { copied = false; }
  }
  await db.from('sourcing_requests').update({ stage: 'in_contact', next_action: 'Waiting for replies. Follow-ups are prepared for approval after ' + 5 + ' days without an answer.', updated_at: now() }).eq('id', m.request_id).in('stage', ['new', 'shortlist', 'drafts_ready', 'in_contact']);
  await db.from('suppliers').update({ status: 'contacted', updated_at: now() }).eq('id', m.supplier_id).eq('status', 'candidate');
  try { await audit(db, o.actorId || null, 'commercial_message_sent', 'sourcing_request', m.request_id, { message: m.id, request: requestLabel(R.seq), to: m.to_address, message_id: mid, approved_by: m.approved_by, smtp: resp, copied_to_sent: copied }); } catch (eA2) { /* ok */ }
  return { ok: true, message_id: mid, accepted: accepted, smtp_response: resp, copied_to_sent: copied, updated: !!(done && done.data && done.data.length) };
}
async function buildRaw(mail, o) {
  if (o && o.buildRaw) { return o.buildRaw(mail); }
  try {
    var MailComposer = require('nodemailer/lib/mail-composer');
    return await new Promise(function (res, rej) { new MailComposer(mail).compile().build(function (e, msg) { if (e) { rej(e); } else { res(msg); } }); });
  } catch (e) { return null; }
}

// a message stuck in "sending" (the server stopped mid-send) is never re-sent by itself: a person checks first
export async function recoverStuck(db, minutes) {
  var cut = new Date(Date.now() - (minutes || 10) * 60000).toISOString();
  var r = await db.from('commercial_messages').select('id, request_id, updated_at').eq('status', 'sending');
  var n = 0;
  for (var i = 0; i < ((r && r.data) || []).length; i++) {
    var x = r.data[i]; if (String(x.updated_at) > cut) { continue; }
    var u = await db.from('commercial_messages').update({ status: 'failed', last_error: 'OUTCOME UNKNOWN — the sending step stopped before it finished. Check the Sent folder of info@ktcus.com before sending again.' }).eq('id', x.id).eq('status', 'sending').select('id');
    if (u && u.data && u.data.length) { n++; }
  }
  return n;
}

// ── read replies from the inbox (read-only). Only messages certainly on one of our threads are stored.
export async function checkInbox(db, opts) {
  var o = opts || {}; var cfg = o.config || mailConfig();
  var out = { ok: false, scanned: 0, stored: 0, bounces: 0, ignored: 0, skipped_known: 0, errors: [] };
  if (!cfg.configured) { out.error = 'not configured'; out.not_configured = true; return out; }
  var st = await db.from('commercial_mail_state').select('*').eq('id', 1).maybeSingle();
  var last = st && st.data && st.data.last_check_at;
  var since = new Date(Math.min(Date.now() - 2 * 86400000, last ? Date.parse(last) - 2 * 86400000 : Date.now() - 14 * 86400000));
  var sentR = await db.from('commercial_messages').select('id, request_id, supplier_id, message_id, to_address, status').eq('direction', 'out').in('status', ['sent', 'bounced']);
  if (sentR.error) { out.error = sentR.error.message; return out; }
  var sent = sentR.data || [];
  if (!sent.length) { out.ok = true; out.nothing_sent = true; await saveState(db, out); return out; }
  var reqIds = sent.map(function (s) { return s.request_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
  var seqBy = {}; var rr = await db.from('sourcing_requests').select('id, seq').in('id', reqIds); ((rr && rr.data) || []).forEach(function (r) { seqBy[r.id] = r.seq; });
  sent.forEach(function (s) { s.seq = seqBy[s.request_id]; });
  var parse = o.parse || function (src) { return require('mailparser').simpleParser(src); };
  var client = makeImap(cfg, o); var budget = Date.now() + (o.budgetMs || 40000);
  try {
    await client.connect();
    var lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      var uidSet = {};
      var searches = [{ since: since, subject: 'SR-' }, { since: since, header: { 'in-reply-to': 'sourcing-' } }, { since: since, from: 'mailer-daemon' }, { since: since, from: 'postmaster' }];
      for (var si = 0; si < searches.length; si++) { var f = await client.search(searches[si], { uid: true }); (f || []).forEach(function (u) { uidSet[u] = true; }); }
      var uids = Object.keys(uidSet).map(Number).sort(function (a, b) { return a - b; }).slice(-60);
      for (var ui = 0; ui < uids.length; ui++) {
        if (Date.now() > budget) { out.out_of_time = true; break; }
        var msg = await client.fetchOne(String(uids[ui]), { envelope: true, size: true, source: true }, { uid: true });
        if (!msg || !msg.source) { continue; }
        out.scanned++;
        if ((msg.size || 0) > 15 * 1024 * 1024) { out.errors.push('a message over 15 MB was skipped'); continue; }
        var p; try { p = await parse(msg.source); } catch (eP) { out.errors.push('could not read one message'); continue; }
        var mid = normId(p.messageId || ('uid-' + uids[ui] + '@' + cfg.imap_host));
        var known = await db.from('commercial_messages').select('id').eq('message_id', mid).limit(1);
        if (known && known.data && known.data.length) { out.skipped_known++; continue; }
        var from = String((p.from && p.from.value && p.from.value[0] && p.from.value[0].address) || '').toLowerCase();
        var text = String(p.text || '').substring(0, 20000);
        if (isBounceSender(from)) {
          var ours = idsIn(text + '\n' + String(p.subject || '')).concat(idsIn((p.attachments || []).map(function (a) { return a && a.content ? String(a.content).substring(0, 20000) : ''; }).join('\n')));
          var hitB = sent.filter(function (s) { return ours.indexOf(normId(s.message_id)) >= 0; })[0];
          if (!hitB) { out.ignored++; continue; }
          await db.from('commercial_messages').update({ status: 'bounced', last_error: ('Bounced: ' + String(p.subject || '') + ' — ' + text.replace(/\s+/g, ' ').substring(0, 240)).substring(0, 400) }).eq('id', hitB.id).eq('status', 'sent');
          await db.from('commercial_messages').insert({ request_id: hitB.request_id, supplier_id: hitB.supplier_id, direction: 'in', kind: 'bounce', from_address: from, subject: String(p.subject || '(no subject)').substring(0, 300), body: text || '(empty)', status: 'received', message_id: mid, in_reply_to: hitB.message_id, received_at: (p.date ? new Date(p.date).toISOString() : now()), flags: [{ key: 'bounce', words: 'The address ' + hitB.to_address + ' did not receive our message. Find another contact before writing again.' }] });
          await db.from('sourcing_requests').update({ next_action: 'A message bounced (' + hitB.to_address + ') — find another contact for this supplier.', updated_at: now() }).eq('id', hitB.request_id).neq('stage', 'closed');
          out.bounces++; continue;
        }
        var refs = []; var rh = p.references; if (Array.isArray(rh)) { refs = rh; } else if (rh) { refs = String(rh).split(/\s+/); }
        var t = threadMatch({ from: from, subject: p.subject, inReplyTo: p.inReplyTo, references: refs }, sent);
        if (!t) { out.ignored++; continue; }
        var files = [];
        var atts = (p.attachments || []).filter(function (a) { return a && a.content && /^(application\/(pdf|vnd\.openxmlformats|vnd\.ms-excel|msword)|image\/|text\/csv)/i.test(a.contentType || '') && (a.size || a.content.length) <= 10 * 1024 * 1024; }).slice(0, 5);
        for (var ai = 0; ai < atts.length; ai++) {
          var a = atts[ai]; var safe = String(a.filename || ('file-' + ai)).replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
          var path = 'pv/commercial-' + Date.now().toString(36) + '-' + ai + '-' + safe;
          try { var up = await db.storage.from('bills-private').upload(path, a.content, { contentType: a.contentType, upsert: false }); if (!up.error) { files.push({ path: path, name: a.filename || safe, size: a.size || a.content.length }); } else { out.errors.push('attachment not saved: ' + up.error.message); } }
          catch (eU) { out.errors.push('attachment not saved'); }
        }
        var flags = inboundFlags(text, p.subject);
        var dropped = (p.attachments || []).length - atts.length;
        if (dropped > 0) { flags.push({ key: 'attachments_skipped', words: dropped + ' attachment(s) were not saved (type not accepted or over 10 MB) — open the email in the mailbox to see them.' }); }
        var ins = await db.from('commercial_messages').insert({ request_id: t.request_id, supplier_id: t.supplier_id, direction: 'in', kind: 'inbound', from_address: from, to_address: cfg.user,
          subject: String(p.subject || '(no subject)').substring(0, 300), body: text || '(no text — see the attachments)', status: 'received', message_id: mid, in_reply_to: t.answers || (p.inReplyTo ? normId(p.inReplyTo) : null),
          received_at: (p.date ? new Date(p.date).toISOString() : now()), attachments: files, flags: flags });
        if (ins.error) { if (!/duplicate key|uq_cm_message_id/i.test(ins.error.message || '')) { out.errors.push(ins.error.message); } continue; }
        out.stored++;
        var supName = ''; var sp = await db.from('suppliers').select('legal_name').eq('id', t.supplier_id).maybeSingle(); if (sp && sp.data) { supName = sp.data.legal_name; }
        await db.from('sourcing_requests').update({ next_action: 'Reply from ' + (supName || from) + ' — read it' + (flags.some(function (fl) { return fl.key === 'bank_details' || fl.key === 'asks_if_human'; }) ? ' (it has a warning)' : '') + '.', updated_at: now() }).eq('id', t.request_id).neq('stage', 'closed');
        try { await audit(db, null, 'commercial_reply_received', 'sourcing_request', t.request_id, { supplier: t.supplier_id, from: from, matched: t.how, attachments: files.length, flags: flags.map(function (fl) { return fl.key; }) }); } catch (eA) { /* ok */ }
      }
    } finally { try { lock.release(); } catch (eR) { /* ignore */ } }
    out.ok = true;
  } catch (e) {
    out.error = imapWhy(e).substring(0, 300);
    out.auth_failed = /auth|login|credentials|AUTHENTICATIONFAILED/i.test(out.error);
  } finally { try { await client.logout(); } catch (eL) { /* ignore */ } }
  await saveState(db, out);
  return out;
}
async function saveState(db, out) {
  var rec = { id: 1, last_result: { ok: out.ok, stored: out.stored, bounces: out.bounces, scanned: out.scanned, error: out.error || null, nothing_sent: !!out.nothing_sent, at: now() }, updated_at: now() };   // v55.83-UY — nothing_sent = the mailbox was NOT opened
  if (out.ok) { rec.last_check_at = now(); }
  try { await db.from('commercial_mail_state').upsert(rec, { onConflict: 'id' }); } catch (e) { /* the table may not exist yet */ }
}

// ── follow-ups: PREPARED for approval only; stop after two, or when they reply, or when the request / supplier is closed
export async function prepareFollowUps(db, opts) {
  var o = opts || {}; var nowIso = o.now || now(); var made = 0; var cfg = o.config || mailConfig();
  var sl = await db.from('sourcing_shortlist').select('request_id, supplier_id, status').eq('status', 'kept');
  if (sl.error) { return { made: 0, error: sl.error.message }; }
  for (var i = 0; i < (sl.data || []).length; i++) {
    var k = sl.data[i];
    var rq = await db.from('sourcing_requests').select('id, seq, stage').eq('id', k.request_id).maybeSingle();
    if (!rq.data || rq.data.stage === 'closed' || rq.data.stage === 'on_hold') { continue; }
    var th = await db.from('commercial_messages').select('*').eq('request_id', k.request_id).eq('supplier_id', k.supplier_id).order('created_at', { ascending: true });
    var due = followUpDue((th && th.data) || [], nowIso, { days: o.days, max: o.max });
    if (!due.due) { continue; }
    var ct = await db.from('supplier_contacts').select('name, email').eq('supplier_id', k.supplier_id).eq('email', due.to_address).limit(1);
    var cname = ct && ct.data && ct.data[0] && ct.data[0].name;
    var fb = followUpBody(rq.data, cname, cfg.sender, due.followup_no, due.subject);
    var ins = await db.from('commercial_messages').insert({ request_id: k.request_id, supplier_id: k.supplier_id, direction: 'out', kind: 'followup', followup_no: due.followup_no, to_address: due.to_address, subject: fb.subject, body: fb.body, status: 'draft', created_by: null });
    if (ins.error) { continue; }
    made++;
    await db.from('sourcing_requests').update({ next_action: 'No reply yet — follow-up ' + due.followup_no + ' of 2 is prepared for approval.', updated_at: now() }).eq('id', k.request_id);
  }
  return { made: made };
}

// ── "Test the mailbox": sign in to sending and reading, send nothing
// v55.83-UY (Max, Nov 19: the test said only "Command failed") — the mail server's own answer, in plain words. Never the password.
export function imapWhy(e) {
  var base = String((e && e.message) || e || 'unknown error');
  var said = String((e && (e.responseText || e.response)) || '').replace(/\s+/g, ' ').trim();
  var out = base + (said && said !== base ? ' — the mail server said: “' + said.substring(0, 200) + '”' : '');
  if (e && e.authenticationFailed) { out += ' (the mail server refused the sign-in for reading: check that IMAP is switched on for this mailbox, and that the password is the mailbox password)'; }
  return out.substring(0, 420);
}
export async function testMailbox(opts) {
  var o = opts || {}; var cfg = o.config || mailConfig(); var steps = [];
  steps.push({ ok: isEmail(cfg.user), text: 'Mailbox name (COMMERCIAL_MAIL_USER): ' + (cfg.user || 'not set') });
  steps.push({ ok: cfg.has_password, text: 'Password (COMMERCIAL_MAIL_PASSWORD): ' + (cfg.has_password ? 'set — never shown' : 'not set') });
  if (!cfg.configured) { return { ok: false, steps: steps }; }
  try { await makeTransport(cfg, o).verify(); steps.push({ ok: true, text: 'Sending: signed in to ' + cfg.smtp_host + ':' + cfg.smtp_port }); }
  catch (e) { steps.push({ ok: false, text: 'Sending: could not sign in to ' + cfg.smtp_host + ':' + cfg.smtp_port + ' — ' + String((e && e.message) || e).substring(0, 160) + (cfg.smtp_port === 465 ? ' (if this is an encryption error, set COMMERCIAL_SMTP_PORT=587)' : '') }); }
  var c = makeImap(cfg, o);
  try { await c.connect(); steps.push({ ok: true, text: 'Reading: signed in to ' + cfg.imap_host + ':993' }); }
  catch (e2) { steps.push({ ok: false, text: 'Reading: could not sign in to ' + cfg.imap_host + ':993 — ' + imapWhy(e2) }); }
  finally { try { await c.logout(); } catch (eL) { /* ignore */ } }
  return { ok: steps.every(function (s) { return s.ok; }), steps: steps, sender: signatureLines(cfg.sender).join(' · ') };
}

// one pass of the mail side of the worker
export async function mailCycle(db, opts) {
  var o = opts || {}; var cfg = o.config || mailConfig(); var res = { stuck: 0, sent: 0, inbox: null, followups: 0 };
  try { res.stuck = await recoverStuck(db, 10); } catch (e) { res.stuck_error = e.message; }
  if (!cfg.configured) { res.not_configured = true; return res; }
  // an approval whose send never started (the page closed) is sent here — the claim makes a double send impossible
  try {
    var ap = await db.from('commercial_messages').select('id, approved_at').eq('status', 'approved');
    var cut = new Date(Date.now() - 2 * 60000).toISOString();
    for (var i = 0; i < ((ap && ap.data) || []).length; i++) { if (String(ap.data[i].approved_at) > cut) { continue; } var s = await sendApproved(db, ap.data[i].id, o); if (s.ok) { res.sent++; } }
  } catch (e1) { res.send_error = e1.message; }
  try { res.inbox = await checkInbox(db, o); } catch (e2) { res.inbox = { ok: false, error: e2.message }; }
  try { res.followups = (await prepareFollowUps(db, o)).made; } catch (e3) { res.followup_error = e3.message; }
  return res;
}
