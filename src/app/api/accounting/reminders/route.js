// v55.83-PF — LATE-INVOICE REMINDERS (Max, Nov 6): "if something's late, we're
// able to send an email automatically... or connected to WhatsApp... a quick
// button that's a reminder."
//
// Channels: EMAIL sends immediately through the hub's existing Resend setup;
// WHATSAPP composes the message and hands off a wa.me link (one tap to send
// from the user's own WhatsApp — no cold-template infrastructure needed).
// Every reminder is LOGGED on the invoice: who, when, channel, tone, exact text.
// Permissions: suggest = ar.view_invoice_balances · send = ar.send_reminders.
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { businessOfInvoice } from '../../../../lib/business-of';
import { isArEligible } from '../../../../lib/ar-eligibility';
import { isPaymentVoid } from '../../../../lib/payment-matching';

var PAGE = 1000; var MAX_ROWS = 20000;
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  while (out.length < MAX_ROWS) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function daysLate(d, today) { return d ? Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000)) : 0; }

function composeMessage(opts) {
  var money = '$' + opts.open.toLocaleString('en-US', { minimumFractionDigits: 2 });
  if (opts.lang === 'ar') {
    if (opts.tone === 'firm') {
      return 'السادة ' + opts.customer + ' المحترمين،\n\nنود إحاطتكم بأن الفاتورة رقم ' + opts.number + ' لا تزال غير مسددة منذ ' + opts.days + ' يومًا بعد تاريخ الاستحقاق، برصيد مستحق قدره ' + money + '.\n\nنرجو سداد المبلغ خلال خمسة أيام عمل أو التواصل معنا فورًا لمناقشة الأمر.\n\nمع التحية،\nKTC International Enterprises LLC';
    }
    return 'السادة ' + opts.customer + ' المحترمين،\n\nتحية طيبة، نذكّركم بلطف بأن الفاتورة رقم ' + opts.number + ' بتاريخ ' + (opts.date || '-') + ' عليها رصيد مستحق قدره ' + money + ' (متأخر ' + opts.days + ' يومًا).\n\nنرجو ترتيب السداد، وإذا كان المبلغ قد تم تحويله بالفعل نرجو إفادتنا مشكورين.\n\nمع خالص الشكر،\nKTC International Enterprises LLC';
  }
  if (opts.tone === 'firm') {
    return 'Dear ' + opts.customer + ',\n\nInvoice ' + opts.number + ' remains unpaid ' + opts.days + ' days past its date, with an outstanding balance of ' + money + '.\n\nPlease settle this balance within 5 business days, or contact us immediately to discuss.\n\nRegards,\nKTC International Enterprises LLC';
  }
  return 'Dear ' + opts.customer + ',\n\nA friendly reminder: invoice ' + opts.number + ' (' + (opts.date || '-') + ') has an outstanding balance of ' + money + ', now ' + opts.days + ' days past due.\n\nKindly arrange payment — and if it is already on the way, please disregard this note and let us know.\n\nThank you,\nKTC International Enterprises LLC';
}

async function loadLate(db, minDays) {
  var today = new Date().toISOString().substring(0, 10);
  var invs = await fetchAll(function () {
    return db.from('accounting_invoices')
      .select('id, invoice_number, invoice_date, due_date, currency, total_amount, wave_imported_paid, record_status, approval_status, wave_status, wave_invoice_id, wave_business_id, source, accounting_customer_id')
      .order('created_at', { ascending: false });
  });
  var pays = await fetchAll(function () {
    return db.from('accounting_invoice_payments').select('id, accounting_invoice_id, amount, voided, sync_status');
  });
  var custs = await fetchAll(function () {
    return db.from('accounting_customers').select('id, company_name, contact_name, email, phone, business_tag');
  });
  var custById = {}; custs.forEach(function (c) { custById[c.id] = c; });
  var tagById = {}; custs.forEach(function (c) { tagById[c.id] = c.business_tag || null; });
  var paidBy = {};
  pays.forEach(function (p) { if (!isPaymentVoid(p)) { paidBy[p.accounting_invoice_id] = (paidBy[p.accounting_invoice_id] || 0) + (Number(p.amount) || 0); } });
  var out = [];
  invs.forEach(function (inv) {
    if (!isArEligible(inv)) { return; }
    // v55.83-PQ (Max, Nov 7 05:07): "late customers... only after april 1st
    // 2026 showing should be displayed" — pre-system invoices (whose payments
    // were often never matched) don't belong on the reminder list; nobody
    // should get dunned over history.
    if ((inv.invoice_date || '') < '2026-04-01') { return; }
    if (businessOfInvoice(inv, tagById) !== 'US') { return; }
    if ((inv.currency || 'USD') !== 'USD') { return; }
    var open = r2((Number(inv.total_amount) || 0) - (Number(inv.wave_imported_paid) || 0) - (paidBy[inv.id] || 0));
    if (open <= 0.005) { return; }
    var basis = inv.due_date || inv.invoice_date;
    var late = daysLate(basis, today);
    if (late < minDays) { return; }
    var c = custById[inv.accounting_customer_id] || {};
    out.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, due_date: inv.due_date,
      open: open, days_late: late, customer: c.company_name || c.contact_name || '?', email: c.email || null, phone: c.phone || null });
  });
  out.sort(function (a, b) { return b.open - a.open; });
  return out;
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var action = body.action; var userId = body.user_id;
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }
    var permKey = action === 'send' ? 'ar.send_reminders' : 'ar.view_invoice_balances';
    var gate = await assertPermission(db, userId, permKey, req);
    if (!gate || gate.ok !== true) {
      return NextResponse.json({ error: 'This needs the "' + (permKey === 'ar.send_reminders' ? 'AR: Send reminders' : 'AR: View invoice balances') + '" permission — Settings → Module Access.' }, { status: gate && gate.status ? gate.status : 403 });
    }

    if (action === 'suggest') {
      var minDays = Number(body.min_days) > 0 ? Number(body.min_days) : 30;
      var late = await loadLate(db, minDays);
      var ids = late.map(function (r) { return r.invoice_id; });
      var lastBy = {};
      if (ids.length > 0) {
        var rem = await db.from('invoice_reminders').select('invoice_id, channel, created_at').in('invoice_id', ids.slice(0, 500)).order('created_at', { ascending: false });
        (rem.data || []).forEach(function (r) { if (!lastBy[r.invoice_id]) { lastBy[r.invoice_id] = { channel: r.channel, at: r.created_at }; } });
      }
      return NextResponse.json({ ok: true, min_days: minDays,
        rows: late.slice(0, 100).map(function (r) { return Object.assign({}, r, { last_reminder: lastBy[r.invoice_id] || null }); }),
        total_late: late.length, total_open: r2(late.reduce(function (s, r) { return s + r.open; }, 0)) });
    }

    if (action === 'send') {
      var late2 = await loadLate(db, 0);
      var row = null;
      late2.forEach(function (r) { if (r.invoice_id === body.invoice_id) { row = r; } });
      if (!row) { return NextResponse.json({ error: 'That invoice has no open balance — nothing to remind about.' }, { status: 404 }); }
      var tone = body.tone === 'firm' ? 'firm' : 'gentle';
      var lang = body.lang === 'ar' ? 'ar' : 'en';
      var msg = composeMessage({ customer: row.customer, number: row.invoice_number, date: row.invoice_date, open: row.open, days: row.days_late, tone: tone, lang: lang });
      var channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';

      if (channel === 'email') {
        var to = String(body.to || row.email || '').trim();
        if (!to || to.indexOf('@') < 1) { return NextResponse.json({ error: 'No email on file for ' + row.customer + ' — add it on the customer, or type one.' }, { status: 400 }); }
        var key = process.env.RESEND_API_KEY;
        if (!key) { return NextResponse.json({ error: 'Email sending is not configured (RESEND_API_KEY).' }, { status: 503 }); }
        var fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
        var subj = (tone === 'firm' ? 'Action required: ' : 'Payment reminder: ') + 'Invoice ' + row.invoice_number + ' — KTC International';
        var html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:650px;margin:0 auto"><div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#1e293b">'
          + msg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
          + '</div><div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">KTC International Enterprises LLC · NextTrade Hub</div></div>';
        var resp = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ from: 'KTC International <' + fromEmail + '>', to: [to], subject: subj, html: html }),
        });
        var rj = await resp.json();
        if (!resp.ok) { return NextResponse.json({ error: 'Email failed: ' + ((rj && rj.message) || resp.status) }, { status: 502 }); }
        await db.from('invoice_reminders').insert({ invoice_id: row.invoice_id, channel: 'email', sent_to: to, tone: tone + '/' + lang, body: msg, status: 'sent', sent_by: userId });
        return NextResponse.json({ ok: true, sent: true, channel: 'email', to: to });
      }

      // WhatsApp: compose + log + hand back a one-tap wa.me link
      var digits = String(body.to || row.phone || '').replace(/[^0-9]/g, '');
      if (digits.length < 8) { return NextResponse.json({ error: 'No usable phone on file for ' + row.customer + ' — add it on the customer, or type one.' }, { status: 400 }); }
      var link = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
      await db.from('invoice_reminders').insert({ invoice_id: row.invoice_id, channel: 'whatsapp', sent_to: '+' + digits, tone: tone + '/' + lang, body: msg, status: 'handoff', sent_by: userId });
      return NextResponse.json({ ok: true, sent: false, channel: 'whatsapp', wa_link: link, note: 'Opens WhatsApp with the message ready — one tap to send.' });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'Reminders request failed.' }, { status: 500 });
  }
}
