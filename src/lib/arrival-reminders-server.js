// v55.83-XG — ARRIVAL + FINAL-PAYMENT REMINDERS, server side (Max, 22 Nov 2026).
//  · buildReminderRows: the warehouse orders that are inside the reminder window (arrival 21 days away or less, or past),
//    joined to the Hub's invoices and payments BY RELEASE NUMBER — the same join and the same balance rule as the Orders
//    report and the late-invoice reminders (total − paid in Wave − payments that are not void).
//  · sendReminderMail: one message from the info@ktcus.com mailbox (the mailbox the Hub already sends from), with a copy
//    in its Sent folder so people using webmail see it.
// Server-only (no 'use client'). SWC-safe: var + string concatenation only.
import { isArEligible } from './ar-eligibility';
import { isPaymentVoid } from './payment-matching';
import { businessOfInvoice } from './business-of';
import { relKey } from './profitability';
import { releasesOf, sameCustomer } from './order-lifecycle';
import { isEmail, uncertainFailure } from './commercial-mail';
import { daysBetween, phaseOf, slotOf, balanceOf, langOf, missingFields, statusOf, polOfRelease, releaseList, SIGNATURE } from './arrival-reminders';

// the same orders the warehouse lists under "Arrival Dates": shipped and not closed
export var ARRIVAL_STATUSES = ['shipped', 'post_loading_documentation', 'end_stage'];
function truthy(v) { return v === true || Number(v) === 1; }
function latest(rows) { return rows.slice().sort(function (a, b) { return String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || (Number(a.id) - Number(b.id)); }).pop() || null; }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// The existing rule of the late-invoice reminders (v55.83-PQ, Max 7 Nov): nobody is reminded about an invoice from before the
// system. Kept here (Codex 22 Nov): an invoice dated before this day blocks the reminder for everyone.
export var NO_REMINDER_BEFORE = '2026-04-01';
export var LIMITED_WORDS = 'Part of this order\u2019s invoice or payment history is before the history you may see, so the figures are not shown and you cannot send this reminder. A super admin can.';
// every release written on an invoice, as written (for the customer to read), in the order they appear
function releasesAsWritten(text) { return String(text || '').split(/\s*(?:[,;&\/+]|\band\b)\s*/i).map(function (p) { return p.trim(); }).filter(function (p) { return !!relKey(p); }); }
function dayOf(x) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(x || '')); return m ? m[1] : ''; }

// input: { feed, invoices, payments, customers, log, today, floor }  →  { rows, counts }
// floor = the first day this person may see (null = everything, the super admin). THE HISTORY WINDOW (Max's rule; Codex 22 Nov P1):
// an order whose balance depends on an invoice dated before the floor (or with no date), or on a payment dated before it (or with
// no date), is LIMITED for this person — no figure, no invoice, no text, no send. A balance is never restated without the hidden
// part (that would overstate what the customer owes). Money recorded in Wave before the Hub (wave_imported_paid) belongs to its
// invoice and follows the invoice's date, as in Customers overview.
export function buildReminderRows(input) {
  var feed = input.feed || {}; var today = input.today; var floor = dayOf(input.floor);
  var stageRows = Array.isArray(feed.requirements) ? feed.requirements : (feed.stages || []);
  var shipBy = {}; stageRows.forEach(function (s) { if (s && s.order_status === 'shipping_in_process') { (shipBy[s.order_id] = shipBy[s.order_id] || []).push(s); } });
  var relCount = {}; (feed.orders || []).forEach(function (o) { var k = relKey(o.release_number); if (k && o.status !== 'cancelled') { relCount[k] = (relCount[k] || 0) + 1; } });
  var custById = {}; var tagById = {}; (input.customers || []).forEach(function (c) { custById[c.id] = c; tagById[c.id] = c.business_tag || null; });
  var paidBy = {}; var hiddenPay = {};
  (input.payments || []).forEach(function (p) {
    if (isPaymentVoid(p)) { return; }
    paidBy[p.accounting_invoice_id] = (paidBy[p.accounting_invoice_id] || 0) + Math.round((Number(p.amount) || 0) * 100);
    var pd = dayOf(p.payment_date); if (floor && (!pd || pd < floor)) { hiddenPay[p.accounting_invoice_id] = true; }
  });
  var invByRel = {}; var poByRel = {};
  (input.invoices || []).forEach(function (i) {
    if (!isArEligible(i)) { return; } // void / cancelled / archived / deleted / Wave draft: never counted, never stated to a customer
    releasesOf(i.release_number).forEach(function (k) { (invByRel[k] = invByRel[k] || []).push(i); });
    releasesOf(i.po_so_number).forEach(function (k) { (poByRel[k] = poByRel[k] || []).push(i); });
  });
  var logBy = {}; (input.log || []).forEach(function (l) { (logBy[String(l.order_id)] = logBy[String(l.order_id)] || []).push(l); });
  var rows = [];
  (feed.orders || []).forEach(function (o) {
    if (ARRIVAL_STATUSES.indexOf(String(o.status || '')) < 0) { return; }
    if (truthy(o.order_closed) || truthy(o.is_draft) || truthy(o.in_house_order)) { return; }
    var st = latest(shipBy[o.id] || []); var arrival = st && st.arrival_date ? String(st.arrival_date).substring(0, 10) : null;
    var days = daysBetween(today, arrival); var phase = phaseOf(days);
    if (!phase) { return; } // no date, or more than 21 days away: not in the reminder window yet
    var rk = relKey(o.release_number);
    var list = []; var seen = {}; var poOnly = false;
    (rk ? (invByRel[rk] || []) : []).forEach(function (i) { if (!seen[i.id]) { seen[i.id] = true; list.push(i); } });
    if (!list.length) { (rk ? (poByRel[rk] || []) : []).forEach(function (i) { if (!seen[i.id]) { seen[i.id] = true; list.push(i); poOnly = true; } }); }
    var invs = list.map(function (i) {
      var c = custById[i.accounting_customer_id] || null;
      return { id: i.id, number: i.invoice_number, total: r2(i.total_amount), paid: r2((Number(i.wave_imported_paid) || 0) + (paidBy[i.id] || 0) / 100), currency: i.currency || 'USD',
        customer_id: i.accounting_customer_id || null, customer_name: c ? (c.company_name || c.contact_name || null) : null, releases: releasesOf(i.release_number || i.po_so_number).length, release_names: releasesAsWritten(i.release_number || i.po_so_number),
        us: businessOfInvoice(i, tagById) === 'US', date: dayOf(i.invoice_date), restricted: !!(floor && (!dayOf(i.invoice_date) || dayOf(i.invoice_date) < floor || hiddenPay[i.id])) };
    });
    var limited = invs.some(function (i) { return i.restricted; });
    var bal = limited ? { ok: false, reason: LIMITED_WORDS } : balanceOf(invs);
    var custIds = {}; invs.forEach(function (i) { custIds[String(i.customer_id)] = true; });
    var cust = Object.keys(custIds).length === 1 && invs.length ? (custById[invs[0].customer_id] || null) : null;
    var polR = polOfRelease(o.release_number); // XG (Max 22 Nov): 1002 = Houston, 1001 = Canada; any other prefix is confirmed by a person, never guessed
    // the salutation: the warehouse contact person only when the warehouse and the Hub invoice agree on who the customer is (Codex 22 Nov)
    var differs = !!(cust && !sameCustomer(o.customer_name, cust.company_name || cust.contact_name));
    var fields = { name: String((differs ? '' : o.customer_contact_person) || (cust && (cust.contact_name || cust.company_name)) || o.customer_name || '').trim(),
      release: o.release_number, pol: polR.certain ? polR.pol : '', destination: o.country, container: o.container, arrival_date: arrival, days: days,
      total: bal.ok ? bal.total : null, received: bal.ok ? bal.received : null, remaining: bal.ok ? bal.remaining : null,
      // Max 22 Nov: an invoice covering several releases → the message lists them all (this order's release first) with the invoice totals
      releases: invs.some(function (i) { return i.releases > 1; }) ? releaseList([o.release_number].concat.apply([o.release_number], invs.map(function (i) { return i.release_names; }))) : [] };
    var blocks = []; var warnings = [];
    if (/^\s*test\b/i.test(String(o.customer_name || ''))) { blocks.push('This is a test order on the warehouse copy.'); }
    if (rk && relCount[rk] > 1) { blocks.push('This release number is on ' + relCount[rk] + ' warehouse orders — it is not certain which one the invoice belongs to.'); }
    if (!bal.ok) { blocks.push(bal.reason); }
    else if (bal.paid_in_full) { blocks.push('The invoice is paid in full — there is nothing to ask for.'); }
    // KTC USA only (the same business rule as the late-invoice reminders, businessOfInvoice): an invoice of the Egypt books is never
    // reminded about from here — these texts, this mailbox and the dollar figures are the USA company's (Codex 22 Nov 14:19).
    var notUs = invs.filter(function (i) { return !i.us; });
    if (!limited && notUs.length) { blocks.push('An invoice on this release is not a KTC USA invoice (' + notUs.map(function (i) { return i.number; }).join(', ') + ') — these reminders are for KTC USA invoices only.'); }
    var tooOld = invs.filter(function (i) { return !i.date || i.date < NO_REMINDER_BEFORE; });
    if (!limited && tooOld.length) { blocks.push('An invoice on this release is dated before 1 April 2026 (' + tooOld.map(function (i) { return i.number; }).join(', ') + ') — the Hub does not send reminders about invoices from before the system.'); }
    if (invs.length && Object.keys(custIds).length > 1) { blocks.push('The invoices on this release belong to different customers in the Hub.'); }
    var miss = missingFields(polR.certain ? fields : Object.assign({}, fields, { pol: 'to be confirmed' })); if (miss.length) { blocks.push('Missing: ' + miss.join(', ') + '.'); }
    if (differs) { warnings.push('The warehouse names the customer "' + (o.customer_name || '?') + '", the Hub invoice is for "' + (cust.company_name || cust.contact_name) + '". Check it is the same customer before sending.'); }
    if (invs.some(function (i) { return i.releases > 1; })) { warnings.push('An invoice here covers more than one release (' + fields.releases.join(', ') + '). The message lists all of them and states the totals of the WHOLE invoice, not only this release.'); }
    if (poOnly) { warnings.push('The invoice was found by its P.O./S.O. number (its Release Number field is empty).'); }
    if (truthy(o.payment_made) && bal.ok && !bal.paid_in_full) { warnings.push('The warehouse has "Payment Received" ticked for this order, but the Hub still shows ' + bal.remaining.toFixed(2) + ' owed.'); }
    var hubEmail = cust && isEmail(cust.email) ? String(cust.email).trim() : null;
    var whEmail = isEmail(o.customer_email) ? String(o.customer_email).trim() : null;
    if (hubEmail && whEmail && hubEmail.toLowerCase() !== whEmail.toLowerCase()) { warnings.push('The warehouse has a different e-mail for this customer (' + whEmail + ') than the Hub (' + hubEmail + ').'); }
    var slot = slotOf(days, today); var mine = logBy[String(o.id)] || [];
    function inSlot(l) { return l.slot === slot && l.channel === 'email' && l.mode !== 'test'; }
    var slotSent = mine.some(function (l) { return inSlot(l) && l.status === 'sent'; });
    // delivery unconfirmed (Codex 22 Nov P2): the mail server did not answer, or the send never finished. It may have reached the customer.
    var slotUnconfirmed = mine.some(function (l) { return inSlot(l) && (l.status === 'unknown' || l.status === 'sending'); });
    var rem = statusOf(mine);
    if (limited) { blocks = [LIMITED_WORDS]; warnings = []; fields = Object.assign({}, fields, { total: null, received: null, remaining: null, releases: [] }); if (rem.last) { rem.last = Object.assign({}, rem.last, { total: null, received: null, remaining: null }); } }
    rows.push({ order_id: Number(o.id), release_number: o.release_number || null, release_key: rk, customer: o.customer_name || null, hub_customer: cust ? (cust.company_name || cust.contact_name || null) : null,
      warehouse: o.warehouse_name || null, country: o.country || null, container: o.container || null, status: o.status, arrival_date: arrival, days: days, phase: phase, slot: slot, slot_sent: slotSent, slot_unconfirmed: slotUnconfirmed, limited: limited,
      language: langOf(o.customer_language), language_from_warehouse: !!o.customer_language, email: hubEmail || whEmail || null, email_from: hubEmail ? 'hub' : (whEmail ? 'warehouse' : null), whatsapp: o.customer_whatsapp || null,
      invoices: limited ? [] : invs.map(function (i) { return { id: i.id, number: i.number, total: i.total, paid: i.paid }; }), invoice_count: invs.length, balance: bal.ok ? { total: bal.total, received: bal.received, remaining: bal.remaining, overpaid: bal.overpaid } : null,
      pol: polR.certain ? polR.pol : null, pol_needs_confirm: !polR.certain, pol_suggestion: polR.certain ? null : (o.warehouse_name || null), release_prefix: polR.prefix,
      fields: fields, blocks: blocks, warnings: warnings, reminders: rem });
  });
  rows.sort(function (a, b) { return (a.days - b.days) || String(a.release_number || '').localeCompare(String(b.release_number || '')); });
  var counts = { friendly: 0, firmer: 0, urgent: 0, overdue: 0, ready: 0, blocked: 0 };
  rows.forEach(function (r) { counts[r.phase]++; if (r.blocks.length) { counts.blocked++; } else { counts.ready++; } });
  return { rows: rows, counts: counts };
}

// ── the mailbox (the one the Hub already sends from: COMMERCIAL_MAIL_USER / COMMERCIAL_MAIL_PASSWORD in Vercel) ──
export function reminderMailConfig(env) {
  var e = env || process.env;
  var user = String(e.COMMERCIAL_MAIL_USER || '').trim().toLowerCase(); var pass = String(e.COMMERCIAL_MAIL_PASSWORD || '');
  return { user: user, pass: pass, configured: isEmail(user) && pass.length > 0, smtp_host: e.COMMERCIAL_SMTP_HOST || 'smtp.hostinger.com', smtp_port: Number(e.COMMERCIAL_SMTP_PORT || 465), imap_host: e.COMMERCIAL_IMAP_HOST || 'imap.hostinger.com',
    from: '"' + SIGNATURE + '" <' + user + '>' };
}
function makeTransport(cfg, o) {
  if (o && o.transport) { return o.transport; }
  var nodemailer = require('nodemailer');
  return nodemailer.createTransport({ host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_port === 465, requireTLS: cfg.smtp_port !== 465, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
}
async function buildRaw(mail, o) {
  if (o && o.buildRaw) { return o.buildRaw(mail); }
  try { var MailComposer = require('nodemailer/lib/mail-composer'); return await new Promise(function (res, rej) { new MailComposer(mail).compile().build(function (e, msg) { if (e) { rej(e); } else { res(msg); } }); }); } catch (e) { return null; }
}
async function copyToSent(cfg, mail, o) {
  if (o && o.copyToSent === false) { return false; }
  try {
    var raw = await buildRaw(mail, o); if (!raw) { return false; }
    var c = o && o.imap ? o.imap() : new (require('imapflow').ImapFlow)({ host: cfg.imap_host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
    await c.connect();
    try {
      var boxes = await c.list();
      var sentBox = (boxes || []).filter(function (b) { return b.specialUse === '\\Sent'; })[0] || (boxes || []).filter(function (b) { return /^(inbox[./])?sent( items| messages)?$/i.test(b.path); })[0];
      if (!sentBox) { return false; }
      await c.append(sentBox.path, raw, ['\\Seen']); return true;
    } finally { try { await c.logout(); } catch (eL) { /* ignore */ } }
  } catch (eC) { return false; }
}
// m: { to, subject, text, html, id }  →  { ok, message_id, smtp_response, copied_to_sent } | { ok:false, error, outcome_unknown }
export async function sendReminderMail(m, opts) {
  var o = opts || {}; var cfg = o.config || reminderMailConfig();
  if (!cfg.configured) { return { ok: false, not_configured: true, error: 'The info@ktcus.com mailbox is not connected on the server (COMMERCIAL_MAIL_USER and COMMERCIAL_MAIL_PASSWORD in Vercel).' }; }
  if (!isEmail(m.to)) { return { ok: false, error: 'The recipient address is not valid.' }; }
  var dom = cfg.user.substring(cfg.user.indexOf('@') + 1);
  var mid = '<arrival-' + String(m.id || Date.now().toString(36)).replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 40) + '@' + dom + '>';
  var mail = { from: cfg.from, to: String(m.to).trim(), subject: m.subject, text: m.text, html: m.html, messageId: mid, replyTo: cfg.user, headers: { 'X-KTC-Reference': 'arrival-reminder' } };
  var info = null; var err = null;
  try { info = await makeTransport(cfg, o).sendMail(mail); } catch (e) { err = e; }
  if (err) {
    var unsure = uncertainFailure(err);
    // a timeout can come AFTER the mail server accepted the message. The Sent folder does not settle it: the copy is only saved after a confirmed send.
    return { ok: false, outcome_unknown: unsure, error: (unsure ? 'DELIVERY UNCONFIRMED — the mail server did not answer in time, so the message may or may not have reached the customer. ' : '') + String((err && err.message) || err).substring(0, 300) };
  }
  var resp = String((info && info.response) || '').substring(0, 200);
  if (!info || !info.accepted || info.accepted.length === 0) { return { ok: false, error: 'The mail server did not accept the recipient: ' + (resp || 'no answer') }; }
  var copied = await copyToSent(cfg, mail, o);
  return { ok: true, message_id: mid, smtp_response: resp, copied_to_sent: copied, from: cfg.user };
}
