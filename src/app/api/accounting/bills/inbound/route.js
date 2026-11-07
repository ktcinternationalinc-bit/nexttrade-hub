// v55.83-PF — EMAIL-IN BILLS (Max, Nov 6): "linked to an email where you check
// for any bills that come in, automatically open those bills and put it into
// the system, and make sure it's been human validated... the actual documents
// are saved in that line item."
//
// This endpoint IS the underlying machinery: point any inbound-email service
// (SendGrid Inbound Parse, Mailgun routes, a forwarding script) at
// POST /api/accounting/bills/inbound with the shared token, and every attached
// bill is read by AI and entered as a PENDING-VALIDATION bill with the original
// document stored privately on the line item. Nothing it creates is validated —
// a human must run the three checks, always.
//
// Auth: x-inbound-token header must equal BILLS_INBOUND_TOKEN (>= 24 chars).
// Accepts JSON {from, subject, attachments:[{filename, content_type, content_base64}]}
// or multipart form-data with File fields (SendGrid style).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readBillFromBase64 } from '../../../../../lib/bill-extract-server';
import { US_WAVE_BUSINESS_ID } from '../../../../../lib/business-of';

export const dynamic = 'force-dynamic';
var OK_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1 };

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(req) {
  var token = process.env.BILLS_INBOUND_TOKEN || '';
  if (token.length < 24) { return NextResponse.json({ ok: false, error: 'Inbound bills are not configured on this server (BILLS_INBOUND_TOKEN).' }, { status: 503 }); }
  var got = req.headers.get('x-inbound-token') || '';
  if (got !== token) { return NextResponse.json({ ok: false }, { status: 401 }); }

  var from = ''; var subject = ''; var files = []; // {filename, content_type, b64}
  var ctype = String(req.headers.get('content-type') || '');
  try {
    if (ctype.indexOf('application/json') >= 0) {
      var body = await req.json();
      from = String(body.from || '').substring(0, 200);
      subject = String(body.subject || '').substring(0, 300);
      (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 5).forEach(function (a) {
        if (a && OK_TYPES[a.content_type] && typeof a.content_base64 === 'string') {
          files.push({ filename: String(a.filename || 'bill'), content_type: a.content_type, b64: a.content_base64 });
        }
      });
    } else {
      var fd = await req.formData();
      from = String(fd.get('from') || '').substring(0, 200);
      subject = String(fd.get('subject') || '').substring(0, 300);
      var entries = Array.from(fd.entries()).slice(0, 30);
      for (var i = 0; i < entries.length && files.length < 5; i++) {
        var v = entries[i][1];
        if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function' && OK_TYPES[v.type]) {
          var buf = Buffer.from(await v.arrayBuffer());
          if (buf.length > 10 * 1024 * 1024) { continue; }
          files.push({ filename: String(v.name || 'bill'), content_type: v.type, b64: buf.toString('base64') });
        }
      }
    }
  } catch (eP) {
    return NextResponse.json({ ok: false, error: 'Unreadable payload.' }, { status: 400 });
  }
  if (files.length === 0) { return NextResponse.json({ ok: true, created: 0, note: 'No supported attachments (JPG/PNG/WebP/PDF).' }); }

  var db = admin();
  var created = []; var skipped = [];
  for (var f = 0; f < files.length; f++) {
    var file = files[f];
    var rd = await readBillFromBase64(file.b64, file.content_type);
    if (rd.error) { skipped.push({ file: file.filename, reason: rd.error }); continue; }
    var d = rd.draft;
    // Duplicate guard: same vendor + bill number already active → never enter twice.
    if (d.vendor_name && d.bill_number) {
      var dup = await db.from('vendor_bills').select('id')
        .ilike('vendor_name', d.vendor_name).ilike('bill_number', d.bill_number)
        .eq('record_status', 'active').limit(1);
      if (!dup.error && dup.data && dup.data.length > 0) {
        await db.from('vendor_bill_events').insert({ bill_id: dup.data[0].id, kind: 'email_duplicate_skipped', details: { from: from, subject: subject, file: file.filename } });
        skipped.push({ file: file.filename, reason: 'Duplicate of an existing active bill (' + d.vendor_name + ' ' + d.bill_number + ').' });
        continue;
      }
    }
    // Store the ORIGINAL document privately — the line item carries the proof.
    var safeName = String(file.filename || 'bill').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
    var path = 'pv/email-' + Date.now() + '-' + f + '-' + safeName;
    var upErr = null;
    try {
      var up = await db.storage.from('bills-private').upload(path, Buffer.from(file.b64, 'base64'), { contentType: file.content_type, upsert: false });
      if (up.error) { upErr = up.error.message; }
    } catch (eU) { upErr = (eU && eU.message) || 'upload failed'; }
    var ins = await db.from('vendor_bills').insert({
      vendor_name: d.vendor_name || ('UNREAD VENDOR (email from ' + (from || '?') + ')'),
      bill_number: d.bill_number, bill_date: d.bill_date || new Date().toISOString().substring(0, 10),
      due_date: d.due_date, total_amount: d.total_amount || 0.01,
      category: d.category, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID,
      notes: ('Received by email' + (from ? ' from ' + from : '') + (subject ? ' — "' + subject + '"' : '') +
              (rd.problems.length ? ' · READER FLAGS: ' + rd.problems.join(' ') : '')).substring(0, 900),
      validation_status: 'pending',
      attachment_path: upErr ? null : path,
    }).select('id').maybeSingle();
    if (ins.error) { skipped.push({ file: file.filename, reason: ins.error.message }); continue; }
    await db.from('vendor_bill_events').insert({ bill_id: ins.data.id, kind: 'email_ingested',
      details: { from: from, subject: subject, file: file.filename, reader_flags: rd.problems, attachment_stored: !upErr, upload_error: upErr } });
    created.push({ id: ins.data.id, vendor: d.vendor_name, amount: d.total_amount, flags: rd.problems.length });
  }
  return NextResponse.json({ ok: true, created: created.length, skipped: skipped, bills: created,
    note: 'Every emailed bill enters as PENDING VALIDATION — a human must run the three checks before it counts as verified.' });
}
