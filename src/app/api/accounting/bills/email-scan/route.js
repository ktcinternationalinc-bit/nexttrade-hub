// v55.83-QI — EMAIL SCANNER (Max, Nov 7 12:34: "i still need it to filter to
// any emails looking for key words then to download the attached bill and
// update to the hub"). No forwarding, no third-party parse service: the hub
// itself signs into the mailbox over IMAP (a Google App Password — never
// your main password), searches recent mail for YOUR keywords, downloads
// PDF/image attachments, and runs them through the SAME ingest as every
// other door: extraction that never guesses, the wide duplicate radar, and
// PENDING VALIDATION on every bill it creates.
//
// Setup (Vercel env):
//   BILLS_IMAP_EMAIL         the mailbox to scan (e.g. ktcinternationalinc@gmail.com)
//   BILLS_IMAP_APP_PASSWORD  a Google App Password (Google Account → Security
//                            → 2-Step Verification → App passwords)
//   BILLS_IMAP_HOST          optional, default imap.gmail.com
//   BILLS_EMAIL_KEYWORDS     optional, comma list; default:
//                            invoice,bill,فاتورة,statement of account,amount due
// Runs: Vercel cron (CRON_SECRET bearer) or a manual "Scan now" (bills.manage).
// Already-processed messages are remembered by Message-ID in the audit log —
// the scanner NEVER changes anything in the mailbox (read-only: no flags, no
// moves, no deletes).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { readBillFromBase64 } from '../../../../../lib/bill-extract-server';
import { billDupVerdict } from '../../../../../lib/bill-dup-server';
import { audit } from '../../../../../lib/audit-server';
import { assertPermission } from '../../../../../lib/server-permissions';
import { US_WAVE_BUSINESS_ID } from '../../../../../lib/business-of';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

var OK_TYPES = { 'application/pdf': 1, 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function isCron(req) {
  var secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) { return false; }
  return (req.headers.get('authorization') || '') === 'Bearer ' + secret;
}

export async function POST(req) {
  try {
    var db = admin();
    var byId = null;
    if (!isCron(req)) {
      var body = {};
      try { body = await req.json(); } catch (eB) { body = {}; }
      byId = body.user_id || null;
      if (!byId) { return NextResponse.json({ ok: false, error: 'user_id required.' }, { status: 401 }); }
      var gate = await assertPermission(db, byId, 'bills.manage', req);
      if (!gate.ok) { return NextResponse.json({ ok: false, error: 'Scanning the bills mailbox needs the "Bills: Manage" permission.' }, { status: gate.status || 403 }); }
    }
    var email = process.env.BILLS_IMAP_EMAIL || '';
    var pass = process.env.BILLS_IMAP_APP_PASSWORD || '';
    if (!email || !pass) {
      return NextResponse.json({ ok: false, needs_setup: true, error: 'Email scanning is not configured — set BILLS_IMAP_EMAIL and BILLS_IMAP_APP_PASSWORD (a Google App Password) in Vercel, then redeploy.' }, { status: 503 });
    }
    var host = process.env.BILLS_IMAP_HOST || 'imap.gmail.com';
    var kws = String(process.env.BILLS_EMAIL_KEYWORDS || 'invoice,bill,فاتورة,statement of account,amount due')
      .split(',').map(function (k) { return k.trim(); }).filter(function (k) { return k.length >= 3; }).slice(0, 10);

    var client = new ImapFlow({ host: host, port: 993, secure: true, auth: { user: email, pass: pass }, logger: false });
    var scanned = 0; var created = []; var skipped = []; var matchedMsgs = 0;
    await client.connect();
    try {
      await client.mailboxOpen('INBOX', { readOnly: true }); // read-only — the mailbox is never changed
      var since = new Date(Date.now() - 14 * 86400000);
      // one UID set per keyword (subject OR body), merged
      var uidSet = {}; var k2;
      for (k2 = 0; k2 < kws.length; k2++) {
        var found1 = await client.search({ since: since, or: [{ subject: kws[k2] }, { body: kws[k2] }] }, { uid: true });
        (found1 || []).forEach(function (u) { uidSet[u] = true; });
      }
      var uids = Object.keys(uidSet).map(Number).sort(function (a, b) { return b - a; }).slice(0, 25);
      matchedMsgs = uids.length;
      for (var ui = 0; ui < uids.length; ui++) {
        var msg = await client.fetchOne(String(uids[ui]), { envelope: true, bodyStructure: true }, { uid: true });
        if (!msg || !msg.envelope) { continue; }
        var mid = String(msg.envelope.messageId || ('uid-' + uids[ui] + '@' + email)).substring(0, 80);
        // already processed? (remembered in the audit log — mailbox untouched)
        var seen = await db.from('hub_audit_log').select('id').eq('action', 'email_scan_message').eq('entity_id', mid).limit(1);
        if (!seen.error && seen.data && seen.data.length) { continue; }
        scanned++;
        var from = (msg.envelope.from && msg.envelope.from[0] && (msg.envelope.from[0].address || msg.envelope.from[0].name)) || '';
        var subject = String(msg.envelope.subject || '').substring(0, 300);
        // walk the structure for attachments
        var parts = [];
        (function walk(node) {
          if (!node) { return; }
          var ct = ((node.type || '') + '/' + (node.subtype || '')).toLowerCase();
          if (node.disposition === 'attachment' || OK_TYPES[ct]) {
            if (OK_TYPES[ct] && node.part) { parts.push({ part: node.part, type: ct, name: (node.dispositionParameters && node.dispositionParameters.filename) || (node.parameters && node.parameters.name) || 'bill' }); }
          }
          (node.childNodes || []).forEach(walk);
        })(msg.bodyStructure);
        var madeHere = 0;
        for (var pi = 0; pi < parts.length && pi < 4; pi++) {
          var dl = await client.download(String(uids[ui]), parts[pi].part, { uid: true });
          if (!dl || !dl.content) { continue; }
          var chunks = []; var sz = 0;
          for await (var ch of dl.content) { sz += ch.length; if (sz > 10 * 1024 * 1024) { break; } chunks.push(ch); }
          if (sz > 10 * 1024 * 1024) { skipped.push({ file: parts[pi].name, reason: 'over 10 MB' }); continue; }
          var b64 = Buffer.concat(chunks).toString('base64');
          var rd = await readBillFromBase64(b64, parts[pi].type);
          if (rd.error) { skipped.push({ file: parts[pi].name, reason: rd.error }); continue; }
          var d = rd.draft;
          var verdict = await billDupVerdict(db, { vendor_name: d.vendor_name, bill_number: d.bill_number, bill_date: d.bill_date, total_amount: d.total_amount, notes: (d.notes || '') + ' ' + subject });
          if (verdict.skip) { skipped.push({ file: parts[pi].name, reason: verdict.skip }); continue; }
          var safeName = String(parts[pi].name || 'bill').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
          var path = 'pv/scan-' + Date.now() + '-' + pi + '-' + safeName;
          var upErr = null;
          try {
            var up = await db.storage.from('bills-private').upload(path, Buffer.from(b64, 'base64'), { contentType: parts[pi].type, upsert: false });
            if (up.error) { upErr = up.error.message; }
          } catch (eU) { upErr = (eU && eU.message) || 'upload failed'; }
          var ins = await db.from('vendor_bills').insert({
            vendor_name: d.vendor_name || ('UNREAD VENDOR (email from ' + (from || '?') + ')'),
            bill_number: d.bill_number, bill_date: d.bill_date || new Date().toISOString().substring(0, 10),
            due_date: d.due_date, total_amount: d.total_amount || 0.01,
            category: d.category, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID,
            notes: ((verdict.warn ? verdict.warn + ' · ' : '') + 'Found by the email scanner — from ' + from + ' — "' + subject + '"' +
                    (rd.problems.length ? ' · READER FLAGS: ' + rd.problems.join(' ') : '')).substring(0, 900),
            validation_status: 'pending',
            attachment_path: upErr ? null : path,
          }).select('id').maybeSingle();
          if (ins.error) { skipped.push({ file: parts[pi].name, reason: ins.error.message }); continue; }
          madeHere++;
          created.push({ id: ins.data.id, vendor: d.vendor_name, amount: d.total_amount, warned: !!verdict.warn });
          await audit(db, byId, 'bill_email_scanned_in', 'vendor_bill', ins.data.id, { from: from, subject: subject, file: parts[pi].name, message_id: mid, duplicate_warning: verdict.warn, reader_flags: rd.problems });
        }
        // remember the MESSAGE so it is never re-processed (even if it had no usable attachment)
        await audit(db, byId, 'email_scan_message', 'email', mid, { from: from, subject: subject, bills_created: madeHere, attachments_seen: parts.length });
      }
    } finally {
      try { await client.logout(); } catch (eL) {}
    }
    return NextResponse.json({ ok: true, mailbox: email, keywords: kws, matched_messages: matchedMsgs,
      new_messages_processed: scanned, bills_created: created.length, bills: created, skipped: skipped,
      note: 'Read-only scan — nothing in the mailbox was changed. Every bill enters as PENDING VALIDATION.' });
  } catch (e) {
    var m = (e && e.message) || 'scan failed';
    if (/auth|login|credentials/i.test(m)) { m = 'The mailbox refused the sign-in — check BILLS_IMAP_EMAIL / BILLS_IMAP_APP_PASSWORD (it must be a Google APP password, not the normal password, and 2-Step Verification must be ON).'; }
    return NextResponse.json({ ok: false, error: m }, { status: 500 });
  }
}
