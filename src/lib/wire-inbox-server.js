// v55.83-XC — the server part of the bank-confirmation inbox: who gets the discrepancy e-mails, writing a discrepancy ONCE (persisted
// dedupe key), mailing it through the Hub's existing mail sender, and the "sent wire with no bank confirmation" check.
// Recipients (Max, 21 Nov: "all people with clickbook permissioning" / "The 4 staff + Max"): every ACTIVE user for whom the
// server's own check for accounting.clickbooks.access passes — the people with that switch, and the super admins.
import { createHash } from 'crypto';
import { loadUserPermissions, userHasPermission } from './server-permissions';
import { notifyServer } from './notify-server';
import { audit } from './audit-server';
import { noticeMail, kindWords, matchCandidates, discrepanciesFor, inboxPathOk } from './wire-inbox';

export var RECIPIENT_PERMISSION = 'accounting.clickbooks.access';
export var MISSING_PROOF_DAYS = 3;
// wires sent BEFORE the inbox existed are not nagged about (several were recorded after the fact, without the bank's file)
export var MISSING_PROOF_FROM = '2026-11-21';
export var OPEN_STATUSES = ['new', 'read', 'unreadable', 'proposed', 'several', 'no_wire'];
export var XC_HINT = 'The bank-confirmation inbox needs its database step first: sql/v55-83-XC-wire-confirmation-inbox.sql (the super admin runs it once in Supabase).';
var MAX_FILES = 20;

export async function noticeRecipients(db) {
  var u = await db.from('users').select('id, active, email').limit(1000);
  var ids = [];
  var rows = ((u && u.data) || []).filter(function (x) { return x && x.active !== false && x.email; });
  for (var i = 0; i < rows.length; i++) {
    try { var ctx = await loadUserPermissions(db, rows[i].id); if (userHasPermission(ctx, RECIPIENT_PERMISSION)) { ids.push(rows[i].id); } } catch (e) { /* skip that person */ }
  }
  return ids;
}

function isDup(err) { var m = String((err && (err.message || err.code)) || ''); return /23505|duplicate key|uq_wdn_dedupe/.test(m); }

// n = { dedupe_key, kind, package_id, inbox_id, note, details, wire_label } → { created, notice, mail }
// The same dedupe_key never makes a second note or a second e-mail. mail_status only becomes 'sent' / 'partly_sent' when the
// mail sender says mails really went out; a missing mail service or no recipients is recorded as such, never as sent.
export async function raiseNotice(db, n, actorId, opts) {
  var o = opts || {};
  var row = { dedupe_key: String(n.dedupe_key).substring(0, 200), kind: n.kind, package_id: n.package_id || null, inbox_id: n.inbox_id || null,
    note: String(n.note || kindWords(n.kind)).substring(0, 1000), details: n.details || null, created_by: actorId || null, mail_status: 'pending' };
  var ins = await db.from('wire_discrepancy_notices').insert(row).select('*');
  if (ins.error) {
    if (isDup(ins.error)) { return { created: false, duplicate: true }; }
    return { created: false, error: ins.error.message };
  }
  var notice = (ins.data && ins.data[0]) || row;
  await audit(db, actorId, 'wire_discrepancy_noted', n.package_id ? 'wire_package' : 'wire_inbox', n.package_id || n.inbox_id || null, { kind: n.kind, note: row.note, dedupe_key: row.dedupe_key, inbox_id: n.inbox_id || null });
  var ids = o.recipients || await noticeRecipients(db);
  var mailRes; var patch;
  if (!ids.length) { patch = { mail_status: 'no_recipients', mail_recipients: 0, mail_sent: 0 }; }
  else {
    var m = noticeMail(n.kind, n.wire_label || null, o.hubUrl || process.env.NEXT_PUBLIC_APP_URL || null);
    try { mailRes = await (o.send || notifyServer)('wire_discrepancy', ids, m.subject, m.html, actorId || null); } catch (eM) { mailRes = { attempted: ids.length, sent: 0, error: eM.message }; }
    var sent = Number(mailRes && mailRes.sent) || 0; var tried = Number(mailRes && mailRes.attempted) || 0;
    patch = { mail_recipients: ids.length, mail_sent: sent, mail_status: sent > 0 && sent >= tried ? 'sent' : (sent > 0 ? 'partly_sent' : 'not_sent'),
      mail_at: sent > 0 ? new Date().toISOString() : null, mail_error: sent > 0 ? null : String((mailRes && (mailRes.error || (mailRes.skipped ? 'the mail service did not send (not set up, or turned off for these people)' : ''))) || 'nothing was sent').substring(0, 300) };
  }
  if (notice.id) { await db.from('wire_discrepancy_notices').update(patch).eq('id', notice.id).eq('mail_status', 'pending'); }
  return { created: true, notice: Object.assign({}, notice, patch), mail: patch };
}

// sent wires (not requests) with no bank confirmation file, MISSING_PROOF_DAYS after their sent date → one note each, ever
export async function checkMissingConfirmations(db, actorId, today, opts) {
  var pk = await db.from('wire_packages').select('id, seq, status, sent_date, funding_txn_id, after_the_fact').in('status', ['sent', 'attached']).limit(500);
  if (pk.error) { return { error: pk.error.message, raised: 0 }; }
  var cut = new Date(Date.parse(today + 'T00:00:00Z') - MISSING_PROOF_DAYS * 86400000).toISOString().substring(0, 10);
  var list = ((pk && pk.data) || []).filter(function (p) { var sd = String(p.sent_date || '').substring(0, 10); return !p.funding_txn_id && p.after_the_fact !== true && sd && sd <= cut && sd >= MISSING_PROOF_FROM; });
  if (!list.length) { return { raised: 0 }; }
  var fl = await db.from('wire_package_files').select('package_id, kind').in('package_id', list.map(function (p) { return p.id; })).eq('kind', 'bank_confirmation');
  var has = {}; ((fl && fl.data) || []).forEach(function (f) { has[f.package_id] = true; });
  var raised = 0; var recips = null;
  for (var i = 0; i < list.length; i++) {
    var p = list[i]; if (has[p.id]) { continue; }
    var lab = 'WP-' + String(p.seq || '').padStart(4, '0');
    recips = recips || await noticeRecipients(db);
    var r = await raiseNotice(db, { dedupe_key: 'missing_confirmation:' + p.id, kind: 'missing_confirmation', package_id: p.id, wire_label: lab,
      note: 'Wire ' + lab + ' was sent on ' + String(p.sent_date).substring(0, 10) + ' and has no bank confirmation attached.' }, actorId, Object.assign({}, opts || {}, { recipients: recips }));
    if (r.created) { raised++; }
  }
  return { raised: raised };
}

// ═══ the inbox actions (🏦 Wires → 📥 Bank confirmations) ═══
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function isUuid(s) { return /^[0-9a-f-]{36}$/i.test(String(s || '')); }
function nowIso() { return new Date().toISOString(); }
function label(p) { return 'WP-' + String((p && p.seq) || 0).padStart(4, '0'); }
function out(status, json) { return { status: status, json: json }; }
function no(msg, status) { return out(status || 400, { ok: false, error: msg }); }
export function inboxTableMissing(e) { return /wire_confirmation_inbox|wire_discrepancy_notices|schema cache|does not exist|42P01/i.test(String((e && (e.message || e.code)) || '')); }
function dbNo(e) { return inboxTableMissing(e) ? no(XC_HINT, 503) : no((e && e.message) || 'database error', 400); }

async function inIds(db, table, cols, col, ids) {
  var outR = [];
  for (var i = 0; i < ids.length; i += 200) {
    var r = await db.from(table).select(cols).in(col, ids.slice(i, i + 200));
    if (r.error) { throw new Error('Could not read ' + table + ': ' + r.error.message); }
    outR = outR.concat(r.data || []);
  }
  return outR;
}
async function names(db, ids) {
  var want = ids.filter(function (x, i, a) { return x && a.indexOf(x) === i; }); var m = {};
  if (!want.length) { return m; }
  var u = await db.from('users').select('id, name').in('id', want);
  ((u && u.data) || []).forEach(function (x) { m[x.id] = x.name || 'user'; });
  return m;
}

// the wires a bank confirmation can belong to: real wires (a request drawn from a transfer never has one), not cancelled / undone
export async function wireChoices(db) {
  var pl = await db.from('wire_packages').select('id, seq, status, payee_name, payee_kind, fee_amount, approved_total, sent_date, planned_send_date, bank_reference, funding_txn_id, created_at').order('created_at', { ascending: false }).limit(300);
  if (pl.error) { return { error: pl.error }; }
  var all = pl.data || []; var labels = {};
  all.forEach(function (p) { labels[p.id] = label(p); });
  var pk = all.filter(function (p) { return !p.funding_txn_id && p.status !== 'cancelled' && p.status !== 'reversed'; });
  var need = pk.filter(function (p) { return p.approved_total == null; }).map(function (p) { return p.id; });
  var sum = {};
  if (need.length) { (await inIds(db, 'wire_package_lines', 'package_id, amount', 'package_id', need)).forEach(function (l) { sum[l.package_id] = r2((sum[l.package_id] || 0) + (Number(l.amount) || 0)); }); }
  var list = pk.map(function (p) {
    return { id: p.id, label: label(p), payee_name: p.payee_name, status: p.status, funding_txn_id: null,
      total: p.approved_total != null ? r2(p.approved_total) : r2((sum[p.id] || 0) + (Number(p.fee_amount) || 0)),
      sent_date: p.sent_date ? String(p.sent_date).substring(0, 10) : null, planned_send_date: p.planned_send_date ? String(p.planned_send_date).substring(0, 10) : null, bank_reference: p.bank_reference || null };
  });
  return { list: list, labels: labels };
}

async function loadRow(db, id) {
  if (!isUuid(id)) { return { res: no('Pick the bank confirmation.') }; }
  var q = await db.from('wire_confirmation_inbox').select('*').eq('id', id).maybeSingle();
  if (q.error) { return { res: dbNo(q.error) }; }
  if (!q.data) { return { res: no('That bank confirmation is not in the inbox.', 404) }; }
  if (OPEN_STATUSES.indexOf(q.data.status) < 0) { return { res: no(q.data.status === 'linked' ? 'This confirmation is already attached to its wire.' : 'This confirmation was set aside.', 409) }; }
  return { row: q.data };
}

// deps = { canSend, today, readConfirmation(db, path), loadPackage(db, id), compare(read, wire, today), sha(db, path)?, recipients?, send? }
// → { status, json }. Every write needs "Wires: Send"; viewing needs only what the route already checked (ClickBooks + Wires: View).
export async function handleInbox(db, userId, action, body, deps) {
  var d = deps || {}; var b = body || {};
  var mailOpts = { recipients: d.recipients, send: d.send, hubUrl: d.hubUrl };
  if (action !== 'inbox_list' && !d.canSend) { return no('The bank-confirmation inbox needs "Wires: Send" to add, read, attach or set aside a confirmation — Settings → 🏦 Banking & Accounting Access.', 403); }

  if (action === 'inbox_list') {
    var rq = await db.from('wire_confirmation_inbox').select('*').order('uploaded_at', { ascending: false }).limit(300);
    if (rq.error) { return dbNo(rq.error); }
    // sent wires that never got their bank's file: one note each, ever (only the people who can act run the check)
    var missing = null;
    if (d.canSend) { try { missing = await checkMissingConfirmations(db, userId, d.today, mailOpts); } catch (eM) { missing = { error: eM.message }; } }
    var nq = await db.from('wire_discrepancy_notices').select('*').order('created_at', { ascending: false }).limit(100);
    if (nq.error) { return dbNo(nq.error); }
    var wc; try { wc = await wireChoices(db); } catch (eW) { wc = { error: eW }; }
    if (wc.error) { return no('The wires could not be loaded: ' + ((wc.error && wc.error.message) || 'database error'), 500); }
    var rows = rq.data || [];
    var nm = await names(db, [].concat(rows.map(function (r) { return r.uploaded_by; }), rows.map(function (r) { return r.linked_by; }), rows.map(function (r) { return r.dismissed_by; })));
    return out(200, { ok: true, can_send: !!d.canSend, missing_check: missing,
      rows: rows.map(function (r) { return Object.assign({}, r, { uploaded_by_name: nm[r.uploaded_by] || null, linked_by_name: nm[r.linked_by] || null, dismissed_by_name: nm[r.dismissed_by] || null, linked_label: r.linked_package_id ? (wc.labels[r.linked_package_id] || 'its wire') : null }); }),
      notices: nq.data || [], wires: wc.list });
  }

  // ── files the screen just uploaded to the PRIVATE bucket: registered once each (the server's own fingerprint of the file)
  if (action === 'inbox_add') {
    var files = Array.isArray(b.files) ? b.files : [];
    if (!files.length) { return no('Pick at least one confirmation.'); }
    if (files.length > MAX_FILES) { return no('At most ' + MAX_FILES + ' files at a time.'); }
    var added = []; var refused = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i] || {}; var nameF = String(f.file_name || '').substring(0, 120) || null;
      if (!inboxPathOk(f.path)) { refused.push({ file_name: nameF, why: 'not an inbox upload — add it again.' }); continue; }
      var sha = null;
      try { sha = await (d.sha || fileSha)(db, f.path); } catch (eS) { sha = null; }
      if (!sha) { refused.push({ file_name: nameF, why: 'the upload did not arrive — add it again.' }); continue; }
      var ex = await db.from('wire_confirmation_inbox').select('id, file_name, uploaded_at, status').eq('file_sha256', sha).limit(1);
      if (ex.error) { return dbNo(ex.error); }
      if (ex.data && ex.data.length) { refused.push({ file_name: nameF, why: 'this exact file is already in the inbox (added ' + String(ex.data[0].uploaded_at || '').substring(0, 10) + (ex.data[0].file_name ? ' as ' + ex.data[0].file_name : '') + ').' }); continue; }
      var ins = await db.from('wire_confirmation_inbox').insert({ path: f.path, file_name: nameF, file_sha256: sha, uploaded_by: userId, status: 'new' }).select('id, file_name');
      if (ins.error) {
        if (/23505|duplicate key|uq_wci/.test(String(ins.error.message || ins.error.code || ''))) { refused.push({ file_name: nameF, why: 'this file is already in the inbox.' }); continue; }
        return dbNo(ins.error);
      }
      var rowA = ins.data && ins.data[0];
      added.push({ id: rowA.id, file_name: rowA.file_name });
      await audit(db, userId, 'wire_inbox_added', 'wire_inbox', rowA.id, { path: f.path, file_name: nameF, sha256: sha });
    }
    return out(200, { ok: true, added: added, refused: refused });
  }

  // ── read one confirmation and PROPOSE its wire (nothing is attached until a person confirms)
  if (action === 'inbox_read') {
    var L = await loadRow(db, b.inbox_id); if (L.res) { return L.res; }
    var row = L.row;
    var rc = await d.readConfirmation(db, row.path);
    if (rc.error) {
      var uU = await db.from('wire_confirmation_inbox').update({ status: 'unreadable', read_error: String(rc.error).substring(0, 300), read_at: nowIso() }).eq('id', row.id).in('status', OPEN_STATUSES).select('id');
      if (uU.error) { return dbNo(uU.error); }
      await audit(db, userId, 'wire_inbox_read', 'wire_inbox', row.id, { status: 'unreadable', error: String(rc.error).substring(0, 300) });
      return out(200, { ok: true, status: 'unreadable', error: rc.error });
    }
    var wcR; try { wcR = await wireChoices(db); } catch (eW2) { wcR = { error: eW2 }; }
    if (wcR.error) { return no('The wires could not be loaded: ' + ((wcR.error && wcR.error.message) || 'database error'), 500); }
    var m = matchCandidates(rc.read, wcR.list);
    var uR = await db.from('wire_confirmation_inbox').update({ status: m.status, read: rc.read, read_at: nowIso(), read_error: null, candidates: m.candidates, proposed_package_id: m.proposed })
      .eq('id', row.id).in('status', OPEN_STATUSES).select('id');
    if (uR.error) { return dbNo(uR.error); }
    if (!uR.data || !uR.data.length) { return no('Someone attached or set aside this confirmation at the same moment — reload.', 409); }
    await audit(db, userId, 'wire_inbox_read', 'wire_inbox', row.id, { status: m.status, proposed: m.proposed, candidates: m.candidates.map(function (c) { return c.id; }), read: rc.read });
    var noticeR = null;
    if (m.status === 'no_wire') {
      var rd = rc.read || {};
      noticeR = await raiseNotice(db, { dedupe_key: 'no_wire:' + row.id, kind: 'no_wire', inbox_id: row.id,
        note: 'The bank confirmation ' + (row.file_name || '') + ' matches no wire in the Hub (reference ' + (rd.reference || '—') + ', ' + (rd.amount != null ? (rd.currency || '') + ' ' + r2(rd.amount).toFixed(2) : 'no amount') + ', to ' + (rd.beneficiary || '—') + ', dated ' + (rd.sent_date || '—') + ').' }, userId, mailOpts);
    }
    return out(200, { ok: true, status: m.status, proposed: m.proposed, candidates: m.candidates, notice: noticeR && noticeR.mail ? noticeR.mail : null });
  }

  // ── a person confirms the wire: the file is attached to it as its bank confirmation. This does NOT mark the wire sent.
  if (action === 'inbox_link') {
    var L2 = await loadRow(db, b.inbox_id); if (L2.res) { return L2.res; }
    var rowL = L2.row;
    if (!isUuid(b.package_id)) { return no('Pick the wire.'); }
    var P = await d.loadPackage(db, b.package_id);
    if (P.error) { return no((P.error && P.error.message) || 'The wire could not be loaded.', 400); }
    if (P.missing) { return no('Wire not found.', 404); }
    var pkg = P.pkg; var lab = label(pkg);
    if (pkg.funding_txn_id) { return no(lab + ' is a request drawn from money already sent to ' + pkg.payee_name + ' — no wire leaves our bank for it, so it has no bank confirmation.', 409); }
    if (pkg.status === 'cancelled' || pkg.status === 'reversed') { return no(lab + ' was ' + (pkg.status === 'cancelled' ? 'cancelled' : 'undone') + ' — pick the wire that really went.', 409); }
    var total = pkg.approved_total != null ? r2(pkg.approved_total) : r2(P.live && P.live.total);
    var wireView = { total: total, payee_name: pkg.payee_name, sent_date: pkg.sent_date ? String(pkg.sent_date).substring(0, 10) : null, planned_send_date: pkg.planned_send_date ? String(pkg.planned_send_date).substring(0, 10) : null };
    var diffs = rowL.read ? discrepanciesFor(rowL.read, wireView) : [];
    // claim the confirmation first (only one person can attach it), then attach the file to the wire
    var uL = await db.from('wire_confirmation_inbox').update({ status: 'linked', linked_package_id: pkg.id, linked_by: userId, linked_at: nowIso(), note: diffs.length ? diffs.map(function (x) { return x.note; }).join(' ').substring(0, 1000) : null })
      .eq('id', rowL.id).in('status', OPEN_STATUSES).select('id');
    if (uL.error) { return dbNo(uL.error); }
    if (!uL.data || !uL.data.length) { return no('Someone attached or set aside this confirmation at the same moment — reload.', 409); }
    var exF = await db.from('wire_package_files').select('id').eq('package_id', pkg.id).eq('path', rowL.path).limit(1);
    if (!(exF && exF.data && exF.data.length)) {
      var fI = await db.from('wire_package_files').insert({ package_id: pkg.id, kind: 'bank_confirmation', path: rowL.path, file_name: rowL.file_name || null, uploaded_by: userId });
      if (fI.error) {
        await audit(db, userId, 'wire_inbox_file_not_attached', 'wire_package', pkg.id, { inbox_id: rowL.id, path: rowL.path, error: fI.error.message });
        return no('The confirmation is marked for ' + lab + ' but its file could not be put on the wire (' + fI.error.message + '). Tell the super admin — nothing was lost.', 500);
      }
    }
    // what the SERVER read from this exact file, kept on the wire: "Mark as sent" records whether its date / reference are the ones read
    if (rowL.read && d.compare) {
      var cmp = d.compare(rowL.read, { total: total, payee_name: pkg.payee_name }, d.today);
      await audit(db, userId, 'wire_confirmation_read', 'wire_package', pkg.id, { path: rowL.path, read: rowL.read, fill: cmp.fill, warnings: cmp.warnings, via: 'inbox', inbox_id: rowL.id });
    }
    await audit(db, userId, 'wire_inbox_linked', 'wire_package', pkg.id, { inbox_id: rowL.id, path: rowL.path, file_name: rowL.file_name || null, proposed: rowL.proposed_package_id || null,
      followed_proposal: rowL.proposed_package_id ? rowL.proposed_package_id === pkg.id : null, discrepancies: diffs.map(function (x) { return x.kind; }), wire_status: pkg.status });
    var mails = [];
    if (diffs.length) {
      var rcp = d.recipients || await noticeRecipients(db);
      for (var k = 0; k < diffs.length; k++) {
        var nR = await raiseNotice(db, { dedupe_key: 'link:' + rowL.id + ':' + diffs[k].kind, kind: diffs[k].kind, package_id: pkg.id, inbox_id: rowL.id, wire_label: lab, note: lab + ': ' + diffs[k].note }, userId, Object.assign({}, mailOpts, { recipients: rcp }));
        mails.push({ kind: diffs[k].kind, mail: nR.mail ? nR.mail.mail_status : (nR.duplicate ? 'already noted' : 'not recorded') });
      }
    }
    var next = pkg.status === 'draft' ? 'To mark it sent, open ' + lab + ' and press “📥 Use the confirmation from the inbox”, then Mark as sent.' : (pkg.status === 'sent' ? lab + ' waits for its bank line.' : '');
    return out(200, { ok: true, wire: lab, wire_status: pkg.status, notes: diffs, mails: mails, next: next });
  }

  // ── set a confirmation aside (wrong file, not ours, a copy): kept forever, with who and why
  if (action === 'inbox_dismiss') {
    var why = String(b.reason || '').trim().substring(0, 300);
    if (why.length < 5) { return no('Say why it is set aside (at least 5 characters).'); }
    var L3 = await loadRow(db, b.inbox_id); if (L3.res) { return L3.res; }
    var uD = await db.from('wire_confirmation_inbox').update({ status: 'dismissed', dismissed_by: userId, dismissed_at: nowIso(), dismiss_reason: why }).eq('id', L3.row.id).in('status', OPEN_STATUSES).select('id');
    if (uD.error) { return dbNo(uD.error); }
    if (!uD.data || !uD.data.length) { return no('Someone attached or set aside this confirmation at the same moment — reload.', 409); }
    await audit(db, userId, 'wire_inbox_dismissed', 'wire_inbox', L3.row.id, { reason: why, path: L3.row.path });
    return out(200, { ok: true });
  }

  return no('Unknown inbox action.');
}

// the server's own fingerprint of an uploaded file (never the browser's): the same file is never added twice
export async function fileSha(db, path) {
  var dl = await db.storage.from('bills-private').download(path);
  if (!dl || dl.error || !dl.data) { return null; }
  var buf = typeof dl.data.arrayBuffer === 'function' ? Buffer.from(await dl.data.arrayBuffer()) : Buffer.from(dl.data);
  if (!buf.length) { return null; }
  return createHash('sha256').update(buf).digest('hex');
}

// for "Mark as sent": a path from the inbox counts only when that confirmation is attached to THIS wire
export async function inboxPathLinkedTo(db, path, packageId) {
  var q = await db.from('wire_confirmation_inbox').select('id').eq('path', path).eq('linked_package_id', packageId).eq('status', 'linked').limit(1);
  return !q.error && !!(q.data && q.data.length);
}

// for opening a draft wire: the confirmation attached to it from the inbox (latest), so "Mark as sent" can use it
export async function linkedConfirmation(db, packageId) {
  var q = await db.from('wire_confirmation_inbox').select('id, path, file_name, read, linked_at').eq('linked_package_id', packageId).eq('status', 'linked').order('linked_at', { ascending: false }).limit(1);
  if (q.error) { return null; }
  return (q.data && q.data[0]) || null;
}
