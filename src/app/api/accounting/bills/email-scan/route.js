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
import { readBillFromBase64, insertImportedBill } from '../../../../../lib/bill-extract-server';
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
    var body = {};
    if (!isCron(req)) {
      try { body = await req.json(); } catch (eB) { body = {}; }
      byId = body.user_id || null;
      if (!byId) { return NextResponse.json({ ok: false, error: 'user_id required.' }, { status: 401 }); }
      var gate = await assertPermission(db, byId, 'bills.manage', req);
      if (!gate.ok) { return NextResponse.json({ ok: false, error: 'Scanning the bills mailbox needs the "Bills: Manage" permission.' }, { status: gate.status || 403 }); }
    }
    var email = process.env.BILLS_IMAP_EMAIL || '';
    var pass = process.env.BILLS_IMAP_APP_PASSWORD || '';
    // ── v55.83-QL (Max 13:19: "we need to figure out how to examine
    //    investigate if it is actually working and why it is not") —
    //    DIAGNOSE mode: checks every layer separately and reports each one
    //    in plain words, so "not working" always has a named reason. ──
    if (body && body.diagnose === true) {
      var steps = [];
      steps.push((email ? '✅' : '❌') + ' 1. BILLS_IMAP_EMAIL is ' + (email ? 'set: ' + email : 'MISSING in Vercel (set it, then REDEPLOY — env only loads at deploy)'));
      steps.push((pass ? '✅' : '❌') + ' 2. BILLS_IMAP_APP_PASSWORD is ' + (pass ? 'set (' + pass.length + ' characters — value never shown)' : 'MISSING in Vercel (set it, then REDEPLOY)'));
      var hostD = process.env.BILLS_IMAP_HOST || 'imap.gmail.com';
      steps.push('ℹ️ 3. IMAP host: ' + hostD + ':993 (SSL)' + (process.env.BILLS_IMAP_HOST ? '' : ' — DEFAULT; for Hostinger set BILLS_IMAP_HOST=imap.hostinger.com'));
      if (!email || !pass) { return NextResponse.json({ ok: true, diagnose: true, working: false, steps: steps }); }
      var kwsD = String(process.env.BILLS_EMAIL_KEYWORDS || 'invoice,bill,فاتورة,statement of account,amount due')
        .split(',').map(function (k) { return k.trim(); }).filter(function (k) { return k.length >= 3; }).slice(0, 10);
      var cD = new ImapFlow({ host: hostD, port: 993, secure: true, auth: { user: email, pass: pass }, logger: false });
      try {
        await cD.connect();
        steps.push('✅ 4. Signed into the mailbox — credentials and host are CORRECT.');
      } catch (eC) {
        var mC = (eC && eC.message) || 'connect failed';
        steps.push('❌ 4. Sign-in FAILED: ' + mC + (/auth|login|credential|AUTHENTICATIONFAILED/i.test(mC) ? ' → the password or email is wrong (use the MAILBOX password from Hostinger hPanel → Emails; reset it there if unsure).' : ' → network/host problem — check BILLS_IMAP_HOST.'));
        return NextResponse.json({ ok: true, diagnose: true, working: false, steps: steps });
      }
      try {
        var mb = await cD.mailboxOpen('INBOX', { readOnly: true });
        steps.push('✅ 5. INBOX opened read-only — it holds ' + (mb.exists || 0) + ' email(s) total.');
        var daysD = Number((body && body.days) || 14); if (!(daysD >= 1)) { daysD = 14; } if (daysD > 120) { daysD = 120; }
        var sinceD = new Date(Date.now() - daysD * 86400000);
        steps.push('ℹ️ 6. Keywords in effect: ' + kwsD.join(', ') + (process.env.BILLS_EMAIL_KEYWORDS ? ' (from BILLS_EMAIL_KEYWORDS)' : ' (defaults — set BILLS_EMAIL_KEYWORDS to your own words)'));
        var totalHits = {}; var perKw = [];
        for (var kd = 0; kd < kwsD.length; kd++) {
          var fD = await cD.search({ since: sinceD, or: [{ subject: kwsD[kd] }, { body: kwsD[kd] }] }, { uid: true });
          perKw.push('"' + kwsD[kd] + '": ' + ((fD && fD.length) || 0));
          (fD || []).forEach(function (u) { totalHits[u] = true; });
        }
        var hitUids = Object.keys(totalHits).map(Number).sort(function (a, b) { return b - a; });
        steps.push((hitUids.length ? '✅' : '⚠️') + ' 7. Last ' + daysD + ' days, matches per keyword — ' + perKw.join(' · ') + ' → ' + hitUids.length + ' matching email(s)' + (hitUids.length ? '' : '. If you expected hits: the bills may be in a DIFFERENT mailbox, use different wording, sit in Spam (only INBOX is scanned), or arrived earlier than the window.'));
        var shown = 0;
        for (var hd = 0; hd < hitUids.length && shown < 5; hd++) {
          var mD = await cD.fetchOne(String(hitUids[hd]), { envelope: true, bodyStructure: true }, { uid: true });
          if (!mD || !mD.envelope) { continue; }
          var attD = [];
          (function walkD(n0) {
            if (!n0) { return; }
            var ct0 = ((n0.type || '') + '/' + (n0.subtype || '')).toLowerCase();
            if (OK_TYPES[ct0] && n0.part) { attD.push(ct0.split('/')[1]); }
            (n0.childNodes || []).forEach(walkD);
          })(mD.bodyStructure);
          var midD = String(mD.envelope.messageId || '').substring(0, 80);
          var doneD = false;
          try { var sD = await db.from('hub_audit_log').select('id').eq('action', 'email_scan_message').eq('entity_id', midD).limit(1); doneD = !!(sD.data && sD.data.length); } catch (eS) {}
          steps.push('   📨 ' + String(mD.envelope.date || '').substring(0, 10) + ' · from ' + ((mD.envelope.from && mD.envelope.from[0] && mD.envelope.from[0].address) || '?') + ' · "' + String(mD.envelope.subject || '').substring(0, 48) + '" · ' + (attD.length ? attD.length + ' readable attachment(s): ' + attD.join(', ') : 'NO readable attachment (only PDF/JPG/PNG count — a link in the email is not an attachment)') + (doneD ? ' · already processed ✓' : ' · NOT yet processed'));
          shown++;
        }
        steps.push('✅ 8. Verdict: the scanner CAN reach and search this mailbox. ' + (hitUids.length ? 'Click 📧 Scan mailbox now to process the matches above.' : 'It is working — there is simply nothing matching to pull in this window.'));
        return NextResponse.json({ ok: true, diagnose: true, working: true, steps: steps });
      } catch (eM) {
        steps.push('❌ 5. Could not open INBOX: ' + ((eM && eM.message) || 'failed'));
        return NextResponse.json({ ok: true, diagnose: true, working: false, steps: steps });
      } finally { try { await cD.logout(); } catch (eL2) {} }
    }
    if (!email || !pass) {
      return NextResponse.json({ ok: false, needs_setup: true, error: 'Email scanning is not configured — set BILLS_IMAP_EMAIL and BILLS_IMAP_APP_PASSWORD in Vercel, then redeploy (for Hostinger also BILLS_IMAP_HOST=imap.hostinger.com).' }, { status: 503 });
    }
    var host = process.env.BILLS_IMAP_HOST || 'imap.gmail.com';
    var kws = String(process.env.BILLS_EMAIL_KEYWORDS || 'invoice,bill,فاتورة,statement of account,amount due')
      .split(',').map(function (k) { return k.trim(); }).filter(function (k) { return k.length >= 3; }).slice(0, 10);

    // v55.83-QK (Max 13:10: "i want to check the last 3 months of emails...
    // can we select how far back") — the lookback is selectable per scan
    // (body.days), defaulted by env BILLS_EMAIL_LOOKBACK_DAYS, capped at 120.
    var days = Number((typeof body !== 'undefined' && body && body.days) || process.env.BILLS_EMAIL_LOOKBACK_DAYS || 14);
    if (!(days >= 1)) { days = 14; } if (days > 120) { days = 120; }
    var client = new ImapFlow({ host: host, port: 993, secure: true, auth: { user: email, pass: pass }, logger: false });
    var scanned = 0; var created = []; var skipped = []; var matchedMsgs = 0; var remainingNew = 0;
    var NEW_PER_PASS = 8; // extraction is an AI read per attachment — budget per pass, repeat passes walk the backlog
    // v55.83-QZ2 (review fix) — the scanner remembers processed emails in the
    // audit log (QI SQL). Without that memory every pass would re-read the
    // same emails and create the same bill drafts again (and spend AI reads),
    // so it refuses to run until the memory exists.
    var memProbe = await db.from('hub_audit_log').select('id').limit(1);
    if (memProbe.error) {
      return NextResponse.json({ ok: false, error: 'The email scanner needs its memory table first — run sql/v55-83-QI-audit-log.sql in Supabase (it records which emails were already read, so the same bill is never imported twice). Nothing was scanned.' }, { status: 503 });
    }
    await client.connect();
    try {
      await client.mailboxOpen('INBOX', { readOnly: true }); // read-only — the mailbox is never changed
      var since = new Date(Date.now() - days * 86400000);
      // one UID set per keyword (subject OR body), merged
      var uidSet = {}; var k2;
      for (k2 = 0; k2 < kws.length; k2++) {
        var found1 = await client.search({ since: since, or: [{ subject: kws[k2] }, { body: kws[k2] }] }, { uid: true });
        (found1 || []).forEach(function (u) { uidSet[u] = true; });
      }
      var uids = Object.keys(uidSet).map(Number).sort(function (a, b) { return b - a; });
      matchedMsgs = uids.length;
      for (var ui = 0; ui < uids.length; ui++) {
        if (scanned >= NEW_PER_PASS) { remainingNew++; continue; } // budget spent — counted, picked up next pass
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
          var ins = await insertImportedBill(db, {
            vendor_name: d.vendor_name || ('UNREAD VENDOR (email from ' + (from || '?') + ')'),
            bill_number: d.bill_number, bill_date: d.bill_date || new Date().toISOString().substring(0, 10),
            due_date: d.due_date, total_amount: d.total_amount || 0.01,
            category: d.category, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID,
            notes: ((verdict.warn ? verdict.warn + ' · ' : '') + 'Found by the email scanner — from ' + from + ' — "' + subject + '"' +
                    (rd.problems.length ? ' · READER FLAGS: ' + rd.problems.join(' ') : '')).substring(0, 900),
            validation_status: 'pending',
            attachment_path: upErr ? null : path,
          }, d); // v55.83-RP — type / release / direction sorted on import
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
    return NextResponse.json({ ok: true, mailbox: email, keywords: kws, days: days, matched_messages: matchedMsgs,
      new_messages_processed: scanned, remaining_new: remainingNew, bills_created: created.length, bills: created, skipped: skipped,
      note: 'Read-only scan — nothing in the mailbox was changed. Every bill enters as PENDING VALIDATION.' });
  } catch (e) {
    var m = (e && e.message) || 'scan failed';
    if (/auth|login|credentials/i.test(m)) { m = 'The mailbox refused the sign-in — check BILLS_IMAP_EMAIL / BILLS_IMAP_APP_PASSWORD (it must be a Google APP password, not the normal password, and 2-Step Verification must be ON).'; }
    return NextResponse.json({ ok: false, error: m }, { status: 500 });
  }
}
